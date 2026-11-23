// src/mcp/transport.ts
// Transportes do cliente MCP. Só builtins do Node.
//  - BaseTransport: correlação de ids, timeouts, cancelamento, roteamento de mensagens
//  - StdioTransport: servidor local via child_process.spawn (shell: false)
// O HttpTransport (https + SSE) vive em ./http.ts.

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import {
  McpError,
  RPC_ERR,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './types.js';

export interface RequestOptions {
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface SendOptions {
  timeoutMs?: number | undefined;
}

/** Callbacks que o cliente registra para eventos vindos do servidor. */
export interface TransportHandlers {
  onNotification(method: string, params: unknown): void;
  /** Requisições servidor → cliente (ping, roots/list, sampling/createMessage). */
  onRequest(method: string, params: unknown): Promise<unknown>;
  onClose(reason?: Error): void;
}

export interface McpTransport {
  readonly name: string;
  readonly isConnected: boolean;
  setHandlers(h: TransportHandlers): void;
  /** Só HTTP: versão negociada, enviada no header MCP-Protocol-Version. */
  setProtocolVersion?(v: string): void;
  connect(): Promise<void>;
  request<T = unknown>(method: string, params?: unknown, opts?: RequestOptions): Promise<T>;
  notification(method: string, params?: unknown): void;
  close(): Promise<void>;
}

export function toMcpError(e: unknown): McpError {
  if (e instanceof McpError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new McpError(RPC_ERR.INTERNAL, msg);
}

interface Pending {
  method: string;
  resolve(v: unknown): void;
  reject(e: Error): void;
  timer: NodeJS.Timeout;
  cleanup?: () => void;
}

/* ───────────────────────── BaseTransport ───────────────────────── */

export abstract class BaseTransport implements McpTransport {
  abstract readonly name: string;
  protected handlers: TransportHandlers = {
    onNotification: () => {},
    onRequest: async (m) => {
      throw new McpError(RPC_ERR.METHOD_NOT_FOUND, `método não suportado: ${m}`);
    },
    onClose: () => {},
  };
  protected readonly pending = new Map<JsonRpcId, Pending>();
  protected connected = false;
  protected readonly defaultTimeoutMs: number;
  private nextId = 1;

  constructor(defaultTimeoutMs = 30_000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  setHandlers(h: TransportHandlers): void {
    this.handlers = h;
  }

  abstract connect(): Promise<void>;
  protected abstract send(msg: JsonRpcMessage, opts?: SendOptions): Promise<void>;
  protected abstract doClose(): Promise<void>;

  request<T = unknown>(method: string, params?: unknown, opts: RequestOptions = {}): Promise<T> {
    if (!this.connected) {
      return Promise.reject(new McpError(RPC_ERR.CONNECTION, `transporte ${this.name} não está conectado`));
    }
    if (opts.signal?.aborted) {
      return Promise.reject(new McpError(RPC_ERR.CONNECTION, `requisição ${method} abortada`));
    }
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.settle(id);
        if (!p) return;
        p.reject(new McpError(RPC_ERR.TIMEOUT, `timeout de ${timeoutMs}ms em ${method}`));
        this.cancelRemote(id, 'timeout');
      }, timeoutMs);
      timer.unref();

      const onAbort = (): void => {
        const p = this.settle(id);
        if (!p) return;
        p.reject(new McpError(RPC_ERR.CONNECTION, `requisição ${method} abortada`));
        this.cancelRemote(id, 'abortada pelo cliente');
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, {
        method,
        resolve: (v) => resolve(v as T),
        reject,
        timer,
        cleanup: () => opts.signal?.removeEventListener('abort', onAbort),
      });

      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
      this.send(req, { timeoutMs }).catch((err: unknown) => {
        this.settle(id)?.reject(toMcpError(err));
      });
    });
  }

  notification(method: string, params?: unknown): void {
    if (!this.connected) return;
    const msg: JsonRpcMessage = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    this.send(msg).catch(() => {});
  }

  async close(): Promise<void> {
    this.markClosed();
    await this.doClose().catch(() => {});
  }

  /* ── internos ── */

  /** Remove a requisição pendente (limpa timer/listeners) e a devolve para ser resolvida/rejeitada. */
  protected settle(id: JsonRpcId): Pending | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.cleanup?.();
    return p;
  }

  protected failPending(id: JsonRpcId, err: Error): void {
    this.settle(id)?.reject(err);
  }

  protected failAll(err: Error): void {
    for (const id of [...this.pending.keys()]) this.failPending(id, err);
  }

  protected markClosed(reason?: Error): void {
    const was = this.connected;
    this.connected = false;
    this.failAll(reason ?? new McpError(RPC_ERR.CONNECTION, 'conexão encerrada'));
    if (was) {
      try {
        this.handlers.onClose(reason);
      } catch {
        /* handler do host não pode derrubar o transporte */
      }
    }
  }

  private cancelRemote(id: JsonRpcId, reason: string): void {
    this.notification('notifications/cancelled', { requestId: id, reason });
  }

  /** Ponto único de entrada de mensagens vindas do servidor (stdio ou http). */
  protected handleMessage(raw: unknown): void {
    if (Array.isArray(raw)) {
      for (const m of raw) this.handleMessage(m);
      return;
    }
    if (!raw || typeof raw !== 'object') return;
    const m = raw as JsonRpcMessage;
    if ((m as { jsonrpc?: unknown }).jsonrpc !== '2.0') return;

    if (isJsonRpcResponse(m)) {
      if (m.id === null || m.id === undefined) return;
      const p = this.settle(m.id);
      if (!p) return;
      if (m.error) {
        p.reject(new McpError(m.error.code ?? RPC_ERR.INTERNAL, String(m.error.message ?? 'erro desconhecido'), m.error.data));
      } else {
        p.resolve(m.result);
      }
      return;
    }
    if (isJsonRpcRequest(m)) {
      void this.answerServerRequest(m);
      return;
    }
    if (isJsonRpcNotification(m)) {
      try {
        this.handlers.onNotification(m.method, m.params);
      } catch {
        /* ignora falhas de handler */
      }
    }
  }

  private async answerServerRequest(req: JsonRpcRequest): Promise<void> {
    let reply: JsonRpcResponse;
    try {
      const result = await this.handlers.onRequest(req.method, req.params);
      reply = { jsonrpc: '2.0', id: req.id, result: result ?? {} };
    } catch (e) {
      const err = toMcpError(e);
      reply = { jsonrpc: '2.0', id: req.id, error: { code: err.code, message: err.message } };
    }
    try {
      await this.send(reply);
    } catch {
      /* conexão caiu antes da resposta */
    }
  }
}

/* ───────────────────────── StdioTransport ───────────────────────── */

export interface StdioTransportOptions {
  command: string;
  args?: readonly string[] | undefined;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  /** Tamanho máximo de uma linha JSON vinda do servidor (padrão 8 MB). */
  maxLineBytes?: number | undefined;
}

/** Variáveis herdadas pelo servidor MCP. Chaves de API do Vektor NÃO vazam para o processo filho. */
const SAFE_ENV_KEYS: readonly string[] = [
  'PATH', 'PATHEXT', 'HOME', 'USER', 'USERNAME', 'LOGNAME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'SystemRoot',
  'SystemDrive', 'ComSpec', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
  'XDG_DATA_HOME', 'npm_config_registry', 'NPM_CONFIG_REGISTRY',
];

export function buildSafeEnv(extra?: Record<string, string>, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const k of SAFE_ENV_KEYS) {
    const v = base[k];
    if (v === undefined) continue;
    const id = process.platform === 'win32' ? k.toUpperCase() : k; // env do Windows ignora maiúsculas
    if (seen.has(id)) continue;
    seen.add(id);
    out[k] = v;
  }
  return { ...out, ...(extra ?? {}) };
}

/**
 * Resolve o executável. No Windows, npx/npm/pnpm/yarn são shims .cmd e o Node (>= 18.20.2)
 * recusa `spawn` de .cmd sem shell; usamos `cmd.exe /d /s /c` com argumentos validados.
 */
export function resolveSpawn(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  if (!command || /[\0\r\n]/.test(command)) throw new McpError(RPC_ERR.SECURITY, 'comando MCP inválido');
  for (const a of args) {
    if (a.includes('\0')) throw new McpError(RPC_ERR.SECURITY, 'argumento MCP inválido (byte nulo)');
  }
  if (platform === 'win32' && /^(npx|npm|pnpm|yarn)(\.cmd)?$/i.test(command)) {
    const bad = args.find((a) => /[&|<>^%!"\r\n]/.test(a));
    if (bad !== undefined) {
      throw new McpError(RPC_ERR.SECURITY, `argumento inseguro para cmd.exe: ${JSON.stringify(bad)}`);
    }
    return { file: process.env['ComSpec'] ?? 'cmd.exe', args: ['/d', '/s', '/c', command.replace(/\.cmd$/i, ''), ...args] };
  }
  return { file: command, args: [...args] };
}

type StdioChild = ChildProcessByStdio<Writable, Readable, Readable>;

export class StdioTransport extends BaseTransport {
  readonly name: string;
  private child?: StdioChild | undefined;
  private buf = '';
  private stderrTail = '';
  private readonly opts: StdioTransportOptions;
  private readonly maxLineBytes: number;

  constructor(opts: StdioTransportOptions) {
    super(opts.timeoutMs);
    this.opts = opts;
    this.name = `stdio:${opts.command}`;
    this.maxLineBytes = opts.maxLineBytes ?? 8 * 1024 * 1024;
  }

  /** Últimos bytes do stderr do servidor (diagnóstico). */
  getStderrTail(): string {
    return this.stderrTail;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    let child: StdioChild;
    try {
      const { file, args } = resolveSpawn(this.opts.command, this.opts.args ?? []);
      child = spawn(file, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.opts.cwd,
        env: buildSafeEnv(this.opts.env),
        windowsHide: true,
      });
    } catch (e) {
      throw e instanceof McpError ? e : new McpError(RPC_ERR.CONNECTION, `falha ao iniciar "${this.opts.command}": ${toMcpError(e).message}`);
    }
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => this.onStdout(c));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => {
      this.stderrTail = (this.stderrTail + c).slice(-4096);
    });
    child.stdin.on('error', () => {});
    child.once('close', (code, signal) => {
      const tail = this.stderrTail.trim().slice(-300);
      this.markClosed(
        new McpError(RPC_ERR.CONNECTION, `servidor MCP encerrou (${code !== null ? `código ${code}` : signal ?? 'sinal'})${tail ? `: ${tail}` : ''}`),
      );
    });

    await new Promise<void>((resolve, reject) => {
      let started = false;
      child.once('spawn', () => {
        started = true;
        this.connected = true;
        resolve();
      });
      child.on('error', (err) => {
        if (!started) {
          reject(new McpError(RPC_ERR.CONNECTION, `falha ao iniciar "${this.opts.command}": ${err.message}`));
          return;
        }
        this.markClosed(new McpError(RPC_ERR.CONNECTION, `erro no processo MCP: ${err.message}`));
      });
    });
  }

  protected send(msg: JsonRpcMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      return Promise.reject(new McpError(RPC_ERR.CONNECTION, 'stdin do servidor MCP indisponível'));
    }
    return new Promise<void>((resolve, reject) => {
      stdin.write(JSON.stringify(msg) + '\n', (err) => (err ? reject(toMcpError(err)) : resolve()));
    });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      if (line.length > this.maxLineBytes) return this.abortOversize();
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // ruído no stdout (logs soltos): ignora
      }
      this.handleMessage(parsed);
    }
    if (this.buf.length > this.maxLineBytes) this.abortOversize();
  }

  private abortOversize(): void {
    this.buf = '';
    this.markClosed(new McpError(RPC_ERR.SECURITY, 'mensagem do servidor MCP excede o limite de tamanho'));
    void this.doClose();
  }

  protected async doClose(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    try {
      child.stdin.end();
    } catch {
      /* já fechado */
    }
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const t1 = setTimeout(() => child.kill('SIGTERM'), 1000);
      const t2 = setTimeout(() => {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
        }
        child.kill('SIGKILL');
      }, 3000);
      const t3 = setTimeout(resolve, 4000);
      for (const t of [t1, t2, t3]) t.unref();
      child.once('close', () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        resolve();
      });
    });
  }
}
