// src/mcp/http.ts
// Transporte HTTP do cliente MCP ("Streamable HTTP"): cada mensagem é um POST;
// a resposta vem como application/json OU como stream SSE (text/event-stream).
// Regras de segurança:
//  - somente https:// (sem credenciais na URL: use headers)
//  - hosts privados/locais bloqueados (literal E resolvido via DNS)
//  - redirecionamentos NUNCA são seguidos (poderiam levar a http:// ou a IP privado)
//  - respostas com tamanho máximo
// Só builtins do Node (fetch global, node:dns, node:net).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ReadableStream } from 'node:stream/web';
import { BaseTransport, toMcpError, type SendOptions } from './transport.js';
import { McpError, RPC_ERR, isJsonRpcRequest, type JsonRpcMessage } from './types.js';

/* ───────────── Validação de host / URL ───────────── */

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  const a = p[0] ?? 0;
  const b = p[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / metadata de nuvem
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && p[2] === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224; // multicast / reservado
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  const first = parseInt(s.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast
  const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPrivateIPv4(dotted[1] as string);
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1] as string, 16);
    const lo = parseInt(hex[2] as string, 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

/** Bloqueia localhost, IPs privados/reservados e nomes de intranet. (No Vektor real, pode ser substituída por `isPrivateHost` de src/tools/web.ts.) */
export function isPrivateHost(hostname: string): boolean {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (!h) return true;
  const kind = isIP(h);
  if (kind === 4) return isPrivateIPv4(h);
  if (kind === 6) return isPrivateIPv6(h);
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (!h.includes('.')) return true; // nome de uma só parte = intranet
  return /\.(local|localdomain|internal|intranet|lan|home|corp|private|home\.arpa)$/.test(h);
}

/** Valida e devolve a URL do servidor MCP, ou lança McpError. */
export function assertSafeMcpUrl(raw: string, isPrivate: (host: string) => boolean = isPrivateHost): URL {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^https:\/\//i.test(text)) {
    throw new McpError(RPC_ERR.SECURITY, 'servidor MCP http exige URL https://');
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new McpError(RPC_ERR.SECURITY, 'URL do servidor MCP inválida');
  }
  if (url.protocol !== 'https:') throw new McpError(RPC_ERR.SECURITY, 'servidor MCP http exige URL https://');
  if (url.username || url.password) {
    throw new McpError(RPC_ERR.SECURITY, 'credenciais na URL não são permitidas; use headers');
  }
  if (isPrivate(url.hostname)) {
    throw new McpError(RPC_ERR.SECURITY, `host bloqueado (privado/local): ${url.hostname}`);
  }
  return url;
}

/** URL sem query/fragmento, segura para mensagens de erro (query pode conter tokens). */
function urlLabel(url: URL): string {
  return url.origin + url.pathname;
}

/* ───────────── Leitura de corpo / SSE ───────────── */

async function readBodyText(res: Response, max: number, truncate = false): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let total = 0;
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        if (truncate) break;
        throw new McpError(RPC_ERR.SECURITY, `resposta do servidor MCP excede ${max} bytes`);
      }
      out += dec.decode(value, { stream: true });
    }
    return out + dec.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const SSE_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

function parseSseBlock(block: string): string | undefined {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return event === 'message' && data.length > 0 ? data.join('\n') : undefined;
}

/** Itera os payloads `data:` dos eventos "message" de um stream SSE. */
async function* readSseData(body: ReadableStream<Uint8Array> | null, max: number): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new McpError(RPC_ERR.SECURITY, `stream do servidor MCP excede ${max} bytes`);
      buf += dec.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = SSE_BOUNDARY.exec(buf)) !== null) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const data = parseSseBlock(block);
        if (data !== undefined) yield data;
      }
    }
    buf += dec.decode();
    if (buf.trim()) {
      const data = parseSseBlock(buf);
      if (data !== undefined) yield data;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/* ───────────── HttpTransport ───────────── */

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  /** Tamanho máximo de resposta/stream (padrão 10 MB). */
  maxResponseBytes?: number | undefined;
  /** Injeções (testes offline / integração com o web.ts do Vektor). */
  fetchImpl?: typeof fetch | undefined;
  isPrivateHost?: ((host: string) => boolean) | undefined;
  resolveHost?: ((host: string) => Promise<string[]>) | undefined;
}

const RESERVED_HEADERS = new Set([
  'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version',
  'host', 'content-length', 'connection', 'transfer-encoding',
]);

async function defaultResolve(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true });
  return rows.map((r) => r.address);
}

export class HttpTransport extends BaseTransport {
  readonly name: string;
  private readonly url: URL;
  private readonly userHeaders: Record<string, string> = {};
  private readonly fetchImpl: typeof fetch;
  private readonly privateCheck: (host: string) => boolean;
  private readonly resolveHost: (host: string) => Promise<string[]>;
  private readonly maxBytes: number;
  private sessionId?: string | undefined;
  private protocolVersion?: string | undefined;
  private dnsOkUntil = 0;

  constructor(opts: HttpTransportOptions) {
    super(opts.timeoutMs);
    this.privateCheck = opts.isPrivateHost ?? isPrivateHost;
    this.url = assertSafeMcpUrl(opts.url, this.privateCheck); // lança aqui se não for https:// / host privado
    this.name = `http:${urlLabel(this.url)}`;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.resolveHost = opts.resolveHost ?? defaultResolve;
    this.maxBytes = opts.maxResponseBytes ?? 10 * 1024 * 1024;
    for (const [k, v] of Object.entries(opts.headers ?? {})) {
      if (!/^[A-Za-z0-9-]+$/.test(k) || /[\r\n\0]/.test(v)) {
        throw new McpError(RPC_ERR.SECURITY, `header HTTP inválido: ${k}`);
      }
      if (!RESERVED_HEADERS.has(k.toLowerCase())) this.userHeaders[k] = v;
    }
  }

  setProtocolVersion(v: string): void {
    this.protocolVersion = v;
  }

  async connect(): Promise<void> {
    await this.checkDns();
    this.connected = true;
  }

  /** Resolve o host e recusa se QUALQUER endereço for privado (defesa contra DNS apontando para rede interna). */
  private async checkDns(): Promise<void> {
    const host = this.url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) || Date.now() < this.dnsOkUntil) return;
    let addrs: string[];
    try {
      addrs = await this.resolveHost(host);
    } catch (e) {
      throw new McpError(RPC_ERR.CONNECTION, `não foi possível resolver ${host}: ${toMcpError(e).message}`);
    }
    if (addrs.length === 0) throw new McpError(RPC_ERR.CONNECTION, `${host} não resolveu para nenhum endereço`);
    const bad = addrs.find((a) => this.privateCheck(a));
    if (bad !== undefined) throw new McpError(RPC_ERR.SECURITY, `${host} resolve para endereço privado (${bad}); bloqueado`);
    this.dnsOkUntil = Date.now() + 30_000;
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { ...this.userHeaders };
    h['Content-Type'] = 'application/json';
    h['Accept'] = 'application/json, text/event-stream';
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) h['MCP-Protocol-Version'] = this.protocolVersion;
    return h;
  }

  protected async send(msg: JsonRpcMessage, opts?: SendOptions): Promise<void> {
    await this.checkDns();
    const reqId = isJsonRpcRequest(msg) ? msg.id : undefined;
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;

    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(msg),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new McpError(
        isTimeout ? RPC_ERR.TIMEOUT : RPC_ERR.CONNECTION,
        isTimeout ? `timeout de ${timeoutMs}ms em ${urlLabel(this.url)}` : `falha de rede em ${urlLabel(this.url)}: ${toMcpError(e).message}`,
      );
    }

    const sid = res.headers.get('mcp-session-id');
    if (sid && /^[\x21-\x7e]{1,256}$/.test(sid)) this.sessionId = sid;

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      throw new McpError(RPC_ERR.SECURITY, `redirecionamento bloqueado (HTTP ${res.status}) em ${urlLabel(this.url)}`);
    }
    if (res.status === 202) {
      await res.body?.cancel().catch(() => {});
      return;
    }
    if (res.status === 404 && this.sessionId) {
      this.sessionId = undefined;
      await res.body?.cancel().catch(() => {});
      throw new McpError(RPC_ERR.CONNECTION, 'sessão MCP expirada; reconecte ao servidor');
    }
    if (!res.ok) {
      const body = await readBodyText(res, 2048, true).catch(() => '');
      throw new McpError(RPC_ERR.CONNECTION, `HTTP ${res.status} de ${urlLabel(this.url)}${body ? `: ${body.trim().slice(0, 300)}` : ''}`);
    }

    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('text/event-stream')) {
      for await (const data of readSseData(res.body, this.maxBytes)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // evento malformado: ignora
        }
        this.handleMessage(parsed);
      }
    } else if (ct.includes('application/json')) {
      const text = await readBodyText(res, this.maxBytes);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new McpError(RPC_ERR.PARSE, 'resposta JSON inválida do servidor MCP');
      }
      this.handleMessage(parsed);
    } else if (reqId !== undefined) {
      await res.body?.cancel().catch(() => {});
      throw new McpError(RPC_ERR.INVALID_REQUEST, `Content-Type inesperado do servidor MCP: ${ct || '(vazio)'}`);
    } else {
      await res.body?.cancel().catch(() => {});
    }

    if (reqId !== undefined && this.pending.has(reqId)) {
      this.failPending(reqId, new McpError(RPC_ERR.CONNECTION, 'a resposta HTTP terminou sem resultado para a requisição'));
    }
  }

  protected async doClose(): Promise<void> {
    const sid = this.sessionId;
    this.sessionId = undefined;
    if (!sid) return;
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'DELETE',
        headers: { ...this.userHeaders, 'Mcp-Session-Id': sid },
        redirect: 'manual',
        signal: AbortSignal.timeout(2000),
      });
      await res.body?.cancel().catch(() => {});
    } catch {
      /* encerramento de sessão é best-effort */
    }
  }
}
