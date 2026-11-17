// src/mcp/client.ts
// Cliente MCP: gerencia vários servidores (stdio e http) ao mesmo tempo.
// Sem SDK externo: JSON-RPC 2.0 bruto sobre os transportes de ./transport.ts e ./http.ts.
//
// Recursos: handshake `initialize`, descoberta paginada (tools/resources/prompts),
// cache de tools invalidado por `tools/list_changed`, roots/list, sampling/createMessage,
// notificações de progresso e de log, conexão preguiçosa e deduplicada.

import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpTransport, assertSafeMcpUrl, isPrivateHost } from './http.js';
import { SERVER_NAME_RE } from './security.js';
import { StdioTransport, toMcpError, type McpTransport, type RequestOptions } from './transport.js';
import {
  MCP_PROTOCOL_VERSION,
  McpError,
  RPC_ERR,
  SUPPORTED_PROTOCOL_VERSIONS,
  type McpGetPromptResult,
  type McpInitializeResult,
  type McpLogEvent,
  type McpProgressEvent,
  type McpPrompt,
  type McpReadResourceResult,
  type McpResource,
  type McpRoot,
  type McpSamplingRequest,
  type McpSamplingResult,
  type McpServerConfig,
  type McpServerStatus,
  type McpTool,
  type McpToolAnnotations,
  type McpToolCallResult,
} from './types.js';

export interface McpClientOptions {
  clientInfo?: { name: string; version: string } | undefined;
  /** Timeout padrão por requisição, em ms (padrão 30000). */
  timeoutMs?: number | undefined;
  /** Diretórios (absolutos) que os servidores podem enxergar via roots/list. Sem isto, roots não é anunciado. */
  roots?: readonly string[] | (() => readonly string[]) | undefined;
  /** Habilita `sampling`: o servidor pede uma completion ao modelo do Vektor (ex.: router.complete). O host deve pedir confirmação. */
  onSampling?: ((server: string, req: McpSamplingRequest) => Promise<McpSamplingResult>) | undefined;
  onProgress?: ((e: McpProgressEvent) => void) | undefined;
  onLog?: ((e: McpLogEvent) => void) | undefined;
  onToolsChanged?: ((server: string) => void) | undefined;
  /** Injeções para testes offline / integração com src/tools/web.ts. */
  fetchImpl?: typeof fetch | undefined;
  isPrivateHost?: ((host: string) => boolean) | undefined;
  resolveHost?: ((host: string) => Promise<string[]>) | undefined;
  transportFactory?: ((cfg: McpServerConfig) => McpTransport) | undefined;
}

export interface CallToolOptions {
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((e: McpProgressEvent) => void) | undefined;
}

interface Entry {
  config: McpServerConfig;
  state: McpServerStatus['state'];
  transport?: McpTransport | undefined;
  info?: McpInitializeResult | undefined;
  tools?: McpTool[] | undefined;
  error?: string | undefined;
  connecting?: Promise<void> | undefined;
  progress: Map<string, (e: McpProgressEvent) => void>;
}

const MAX_PAGES = 20;
const MAX_ITEMS = 2000;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function cleanLabel(s: unknown, max = 100): string | undefined {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : undefined;
}

function normalizeTool(raw: unknown): McpTool | undefined {
  const r = asRecord(raw);
  const name = r['name'];
  if (typeof name !== 'string' || !name || name.length > 128) return undefined;
  const schema = asRecord(r['inputSchema']);
  const ann = asRecord(r['annotations']);
  const annotations: McpToolAnnotations = {};
  for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
    if (typeof ann[k] === 'boolean') annotations[k] = ann[k] as boolean;
  }
  return {
    name,
    description: typeof r['description'] === 'string' ? r['description'].slice(0, 2000) : undefined,
    inputSchema: Object.keys(schema).length > 0 ? schema : { type: 'object' },
    annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
  };
}

function normalizeResource(raw: unknown): McpResource | undefined {
  const r = asRecord(raw);
  if (typeof r['uri'] !== 'string' || !r['uri'] || r['uri'].length > 2048) return undefined;
  return {
    uri: r['uri'],
    name: cleanLabel(r['name'], 200),
    description: typeof r['description'] === 'string' ? r['description'].slice(0, 1000) : undefined,
    mimeType: cleanLabel(r['mimeType'], 100),
  };
}

function normalizePrompt(raw: unknown): McpPrompt | undefined {
  const r = asRecord(raw);
  if (typeof r['name'] !== 'string' || !r['name'] || r['name'].length > 128) return undefined;
  const args = Array.isArray(r['arguments'])
    ? (r['arguments'] as unknown[]).flatMap((a) => {
        const x = asRecord(a);
        return typeof x['name'] === 'string'
          ? [{
              name: x['name'],
              description: typeof x['description'] === 'string' ? x['description'].slice(0, 500) : undefined,
              required: x['required'] === true,
            }]
          : [];
      })
    : undefined;
  return {
    name: r['name'],
    description: typeof r['description'] === 'string' ? r['description'].slice(0, 1000) : undefined,
    arguments: args,
  };
}

export class McpClient {
  private readonly servers = new Map<string, Entry>();
  private readonly opts: McpClientOptions;
  private progressSeq = 0;

  constructor(opts: McpClientOptions = {}) {
    this.opts = opts;
  }

  /* ───────────── Configuração ───────────── */

  addServer(config: McpServerConfig): void {
    if (!config || typeof config !== 'object') throw new McpError(RPC_ERR.INVALID_PARAMS, 'configuração de servidor MCP inválida');
    if (typeof config.name !== 'string' || !SERVER_NAME_RE.test(config.name)) {
      throw new McpError(RPC_ERR.INVALID_PARAMS, `nome de servidor MCP inválido: ${JSON.stringify(config.name)} (use letras, números, _ ou -, até 32)`);
    }
    if (this.servers.has(config.name)) throw new McpError(RPC_ERR.INVALID_PARAMS, `servidor MCP já cadastrado: ${config.name}`);
    if (config.type === 'stdio') {
      if (typeof config.command !== 'string' || !config.command.trim()) {
        throw new McpError(RPC_ERR.INVALID_PARAMS, `servidor "${config.name}" (stdio) exige "command"`);
      }
    } else if (config.type === 'http') {
      assertSafeMcpUrl(config.url ?? '', this.opts.isPrivateHost ?? isPrivateHost);
    } else {
      throw new McpError(RPC_ERR.INVALID_PARAMS, `tipo de servidor MCP inválido: ${String((config as { type?: unknown }).type)}`);
    }
    this.servers.set(config.name, {
      config: {
        ...config,
        args: config.args ? [...config.args] : undefined,
        headers: config.headers ? { ...config.headers } : undefined,
        env: config.env ? { ...config.env } : undefined,
      },
      state: 'disconnected',
      progress: new Map(),
    });
  }

  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  isEnabled(name: string): boolean {
    return this.servers.get(name)?.config.enabled === true;
  }

  isConnected(name: string): boolean {
    const e = this.servers.get(name);
    return !!e && e.state === 'connected' && e.transport?.isConnected === true;
  }

  getServerNames(): string[] {
    return [...this.servers.keys()];
  }

  getEnabledServerNames(): string[] {
    return [...this.servers.values()].filter((e) => e.config.enabled).map((e) => e.config.name);
  }

  /** Status para o comando /mcp (nunca expõe headers/env). */
  listServers(): McpServerStatus[] {
    return [...this.servers.values()].map((e) => ({
      name: e.config.name,
      type: e.config.type,
      enabled: e.config.enabled,
      state: e.state,
      serverName: cleanLabel(e.info?.serverInfo?.name),
      serverVersion: cleanLabel(e.info?.serverInfo?.version, 40),
      toolCount: e.tools?.length,
      error: e.error,
    }));
  }

  getCachedTools(name: string): McpTool[] | undefined {
    return this.servers.get(name)?.tools;
  }

  /* ───────────── Conexão ───────────── */

  private entry(name: string): Entry {
    const e = this.servers.get(name);
    if (!e) throw new McpError(RPC_ERR.INVALID_PARAMS, `servidor MCP desconhecido: "${name}"`);
    return e;
  }

  private makeTransport(cfg: McpServerConfig): McpTransport {
    if (this.opts.transportFactory) return this.opts.transportFactory(cfg);
    const timeoutMs = cfg.timeoutMs ?? this.opts.timeoutMs;
    if (cfg.type === 'stdio') {
      return new StdioTransport({ command: cfg.command ?? '', args: cfg.args, cwd: cfg.cwd, env: cfg.env, timeoutMs });
    }
    return new HttpTransport({
      url: cfg.url ?? '',
      headers: cfg.headers,
      timeoutMs,
      fetchImpl: this.opts.fetchImpl,
      isPrivateHost: this.opts.isPrivateHost,
      resolveHost: this.opts.resolveHost,
    });
  }

  private clientCapabilities(): Record<string, unknown> {
    return {
      ...(this.opts.roots !== undefined ? { roots: { listChanged: false } } : {}),
      ...(this.opts.onSampling ? { sampling: {} } : {}),
    };
  }

  /** Handshake `initialize` + `notifications/initialized`. Chamadas concorrentes compartilham a mesma tentativa. */
  connect(name: string): Promise<void> {
    const e = this.entry(name);
    if (!e.config.enabled) return Promise.reject(new McpError(RPC_ERR.SECURITY, `servidor MCP "${name}" está desabilitado`));
    if (e.state === 'connected' && e.transport?.isConnected) return Promise.resolve();
    if (e.connecting) return e.connecting;
    e.connecting = this.doConnect(e).finally(() => {
      e.connecting = undefined;
    });
    return e.connecting;
  }

  private async doConnect(e: Entry): Promise<void> {
    e.state = 'connecting';
    e.error = undefined;
    e.tools = undefined;
    const cfg = e.config;
    let transport: McpTransport;
    try {
      transport = this.makeTransport(cfg);
    } catch (err) {
      e.state = 'error';
      e.error = toMcpError(err).message;
      throw toMcpError(err);
    }
    transport.setHandlers({
      onNotification: (m, p) => this.onNotification(e, m, p),
      onRequest: (m, p) => this.onServerRequest(e, m, p),
      onClose: (reason) => {
        if (e.transport !== transport) return;
        e.state = reason ? 'error' : 'disconnected';
        e.error = reason?.message;
        e.transport = undefined;
        e.tools = undefined;
        e.progress.clear();
      },
    });

    try {
      await transport.connect();
      const base = cfg.timeoutMs ?? this.opts.timeoutMs ?? 30_000;
      const timeoutMs = cfg.type === 'stdio' ? Math.max(base, 60_000) : base; // npx pode baixar o pacote na 1ª vez
      const raw = await transport.request<McpInitializeResult>(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: this.clientCapabilities(),
          clientInfo: this.opts.clientInfo ?? { name: 'vektor', version: '1.0.0' },
        },
        { timeoutMs },
      );
      const init = asRecord(raw);
      const version = init['protocolVersion'];
      if (typeof version !== 'string' || !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
        throw new McpError(RPC_ERR.INVALID_REQUEST, `versão de protocolo MCP não suportada pelo servidor: ${String(version)}`);
      }
      transport.setProtocolVersion?.(version);
      transport.notification('notifications/initialized');
      e.info = {
        protocolVersion: version,
        capabilities: asRecord(init['capabilities']),
        serverInfo: { name: cleanLabel(asRecord(init['serverInfo'])['name']) ?? cfg.name, version: cleanLabel(asRecord(init['serverInfo'])['version'], 40) },
        instructions: typeof init['instructions'] === 'string' ? init['instructions'] : undefined,
      };
      e.transport = transport;
      e.state = 'connected';
    } catch (err) {
      await transport.close().catch(() => {});
      e.transport = undefined;
      e.state = 'error';
      e.error = toMcpError(err).message;
      throw toMcpError(err);
    }
  }

  private async ready(name: string): Promise<{ e: Entry; t: McpTransport }> {
    const e = this.entry(name);
    if (e.state !== 'connected' || !e.transport?.isConnected) await this.connect(name);
    const t = e.transport;
    if (!t || !t.isConnected) throw new McpError(RPC_ERR.CONNECTION, `servidor MCP "${name}" não está conectado`);
    return { e, t };
  }

  /* ───────────── Eventos vindos do servidor ───────────── */

  private onNotification(e: Entry, method: string, params: unknown): void {
    const p = asRecord(params);
    switch (method) {
      case 'notifications/progress': {
        const token = p['progressToken'];
        if (typeof token !== 'string' && typeof token !== 'number') return;
        const ev: McpProgressEvent = {
          server: e.config.name,
          token,
          progress: typeof p['progress'] === 'number' ? p['progress'] : 0,
          total: typeof p['total'] === 'number' ? p['total'] : undefined,
          message: cleanLabel(p['message'], 300),
        };
        const listener = e.progress.get(String(token));
        if (listener) listener(ev);
        else this.opts.onProgress?.(ev);
        return;
      }
      case 'notifications/message':
        this.opts.onLog?.({
          server: e.config.name,
          level: cleanLabel(p['level'], 20) ?? 'info',
          logger: cleanLabel(p['logger'], 100),
          data: p['data'],
        });
        return;
      case 'notifications/tools/list_changed':
        e.tools = undefined;
        this.opts.onToolsChanged?.(e.config.name);
        return;
      default:
    }
  }

  private currentRoots(): readonly string[] | undefined {
    const r = this.opts.roots;
    return typeof r === 'function' ? r() : r;
  }

  private async onServerRequest(e: Entry, method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return {};
      case 'roots/list': {
        const roots = this.currentRoots();
        if (!roots) throw new McpError(RPC_ERR.METHOD_NOT_FOUND, 'roots não suportado por este cliente');
        const list: McpRoot[] = roots.map((r) => ({ uri: pathToFileURL(r).href, name: basename(r) || r }));
        return { roots: list };
      }
      case 'sampling/createMessage': {
        if (!this.opts.onSampling) throw new McpError(RPC_ERR.METHOD_NOT_FOUND, 'sampling não suportado por este cliente');
        const req = asRecord(params);
        if (!Array.isArray(req['messages'])) throw new McpError(RPC_ERR.INVALID_PARAMS, 'sampling/createMessage sem "messages"');
        return this.opts.onSampling(e.config.name, params as McpSamplingRequest);
      }
      default:
        throw new McpError(RPC_ERR.METHOD_NOT_FOUND, `método não suportado: ${method}`);
    }
  }

  /* ───────────── Descoberta ───────────── */

  private async paginate(name: string, method: string, key: 'tools' | 'resources' | 'prompts'): Promise<unknown[]> {
    const { t } = await this.ready(name);
    const out: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = asRecord(await t.request(method, cursor ? { cursor } : {}));
      const items = res[key];
      if (!Array.isArray(items)) throw new McpError(RPC_ERR.INVALID_REQUEST, `resposta inválida de ${method}`);
      out.push(...items);
      const next = res['nextCursor'];
      if (typeof next !== 'string' || !next || seen.has(next) || out.length >= MAX_ITEMS) break;
      seen.add(next);
      cursor = next;
    }
    return out.slice(0, MAX_ITEMS);
  }

  private hasCapability(name: string, cap: 'tools' | 'resources' | 'prompts'): boolean {
    return !!this.entry(name).info?.capabilities?.[cap];
  }

  async listTools(name: string, opts: { refresh?: boolean } = {}): Promise<McpTool[]> {
    const { e } = await this.ready(name);
    if (e.tools && !opts.refresh) return e.tools;
    if (!this.hasCapability(name, 'tools')) {
      e.tools = [];
      return e.tools;
    }
    const raw = await this.paginate(name, 'tools/list', 'tools');
    e.tools = raw.flatMap((r) => normalizeTool(r) ?? []);
    return e.tools;
  }

  async listResources(name: string): Promise<McpResource[]> {
    await this.ready(name);
    if (!this.hasCapability(name, 'resources')) return [];
    return (await this.paginate(name, 'resources/list', 'resources')).flatMap((r) => normalizeResource(r) ?? []);
  }

  async listPrompts(name: string): Promise<McpPrompt[]> {
    await this.ready(name);
    if (!this.hasCapability(name, 'prompts')) return [];
    return (await this.paginate(name, 'prompts/list', 'prompts')).flatMap((r) => normalizePrompt(r) ?? []);
  }

  /* ───────────── Chamadas ───────────── */

  async callTool(name: string, tool: string, args: Record<string, unknown> = {}, opts: CallToolOptions = {}): Promise<McpToolCallResult> {
    if (typeof tool !== 'string' || !tool || tool.length > 128) throw new McpError(RPC_ERR.INVALID_PARAMS, 'nome de tool MCP inválido');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new McpError(RPC_ERR.INVALID_PARAMS, 'args da tool MCP deve ser um objeto');
    const { e, t } = await this.ready(name);

    const params: Record<string, unknown> = { name: tool, arguments: args };
    let token: string | undefined;
    if (opts.onProgress || this.opts.onProgress) {
      token = `vektor-${++this.progressSeq}`;
      params['_meta'] = { progressToken: token };
      if (opts.onProgress) e.progress.set(token, opts.onProgress);
    }
    const reqOpts: RequestOptions = { timeoutMs: opts.timeoutMs, signal: opts.signal };
    try {
      const raw = asRecord(await t.request('tools/call', params, reqOpts));
      return {
        content: Array.isArray(raw['content']) ? (raw['content'] as McpToolCallResult['content']) : undefined,
        structuredContent: raw['structuredContent'],
        isError: raw['isError'] === true,
      };
    } finally {
      if (token) e.progress.delete(token);
    }
  }

  async readResource(name: string, uri: string, opts: RequestOptions = {}): Promise<McpReadResourceResult> {
    if (typeof uri !== 'string' || !uri || uri.length > 2048) throw new McpError(RPC_ERR.INVALID_PARAMS, 'URI de recurso MCP inválida');
    const { t } = await this.ready(name);
    const res = asRecord(await t.request('resources/read', { uri }, opts));
    if (!Array.isArray(res['contents'])) throw new McpError(RPC_ERR.INVALID_REQUEST, 'resposta inválida de resources/read');
    return { contents: res['contents'] as McpReadResourceResult['contents'] };
  }

  /** Atenção: o guia lista `getPrompt(name, args?)`, mas é preciso o servidor E o nome do prompt. */
  async getPrompt(server: string, prompt: string, args?: Record<string, string>, opts: RequestOptions = {}): Promise<McpGetPromptResult> {
    if (typeof prompt !== 'string' || !prompt || prompt.length > 128) throw new McpError(RPC_ERR.INVALID_PARAMS, 'nome de prompt MCP inválido');
    const { t } = await this.ready(server);
    const res = asRecord(await t.request('prompts/get', { name: prompt, ...(args ? { arguments: args } : {}) }, opts));
    if (!Array.isArray(res['messages'])) throw new McpError(RPC_ERR.INVALID_REQUEST, 'resposta inválida de prompts/get');
    return {
      description: typeof res['description'] === 'string' ? res['description'] : undefined,
      messages: res['messages'] as McpGetPromptResult['messages'],
    };
  }

  /* ───────────── Encerramento ───────────── */

  async closeAsync(name: string): Promise<void> {
    const e = this.entry(name);
    const t = e.transport;
    e.transport = undefined;
    e.tools = undefined;
    e.progress.clear();
    e.state = 'disconnected';
    e.error = undefined;
    if (t) await t.close().catch(() => {});
  }

  close(name: string): void {
    void this.closeAsync(name).catch(() => {});
  }

  async closeAllAsync(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((n) => this.closeAsync(n)));
  }

  closeAll(): void {
    void this.closeAllAsync().catch(() => {});
  }
}
