// src/mcp/bridge.ts
// Ponte entre o cliente MCP e o Vektor:
//  - mcpCallTool: a 14ª ferramenta do catálogo (`mcp_call { server, tool, args }`)
//  - buildMcpContext / renderMcpPrompt: recursos, prompts e catálogo de tools como contexto
//  - runMcpCommand: lógica do comando /mcp da UI

import type { McpClient } from './client.js';
import {
  SERVER_NAME_RE,
  confirmMcpCall,
  formatMcpBlock,
  formatMcpContent,
  isAllowedServer,
  isDestructiveMcpTool,
  sanitizeMcpContent,
  truncateText,
  wrapUntrusted,
} from './security.js';
import type { McpResource } from './types.js';
import type { ToolContext, ToolResult, ToolSpec } from '../tools/types.js';

const DEFAULT_MAX_OUTPUT = 20_000;
const MAX_ARGS_CHARS = 256 * 1024;

function fail(msg: string): ToolResult {
  return { ok: false, output: `mcp_call: ${msg}` };
}

function errText(e: unknown): string {
  return sanitizeMcpContent(e instanceof Error ? e.message : String(e)).slice(0, 500);
}

/** Modelos às vezes mandam `args` como string JSON; aceitamos as duas formas. */
function parseToolArgs(raw: unknown): Record<string, unknown> | string {
  if (raw === undefined || raw === null || raw === '') return {};
  let v: unknown = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return 'args não é um JSON válido';
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'args deve ser um objeto JSON';
  let size: number;
  try {
    size = JSON.stringify(v).length;
  } catch {
    return 'args não pode ser serializado';
  }
  return size > MAX_ARGS_CHARS ? 'args grande demais' : (v as Record<string, unknown>);
}

/* ───────────── mcp_call ───────────── */

export async function runMcpCall(rawArgs: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const client = ctx.mcpClient;
  if (!client) return fail('MCP desativado (MCP_ENABLED=false) ou nenhum servidor configurado.');

  const server = rawArgs['server'];
  const tool = rawArgs['tool'];
  if (typeof server !== 'string' || !SERVER_NAME_RE.test(server)) return fail('parâmetro "server" ausente ou inválido.');
  if (typeof tool !== 'string' || !tool.trim() || tool.length > 128 || /[\u0000-\u001f]/.test(tool)) {
    return fail('parâmetro "tool" ausente ou inválido.');
  }
  const args = parseToolArgs(rawArgs['args']);
  if (typeof args === 'string') return fail(args);

  if (!client.hasServer(server)) {
    return fail(`servidor "${server}" não existe. Disponíveis: ${client.getEnabledServerNames().join(', ') || '(nenhum)'}.`);
  }
  const allowed = ctx.mcpAllowedServers ?? client.getEnabledServerNames();
  if (!client.isEnabled(server) || !isAllowedServer(server, allowed)) {
    return fail(`servidor "${server}" está desabilitado ou não é permitido.`);
  }

  try {
    const tools = await client.listTools(server); // conecta de forma preguiçosa
    const spec = tools.find((t) => t.name === tool);
    if (!spec) {
      const names = tools.slice(0, 30).map((t) => sanitizeMcpContent(t.name, { redactPaths: false }));
      return fail(`o servidor "${server}" não tem a tool "${tool}". Tools: ${names.join(', ') || '(nenhuma)'}.`);
    }

    // Destrutiva → SEMPRE confirma na UI (autoApprove não vale aqui).
    if (isDestructiveMcpTool(tool, spec.annotations)) {
      const approved = await confirmMcpCall(ctx, server, tool, args);
      if (!approved) return { ok: false, output: `mcp_call: ${server}.${tool} cancelado (confirmação negada).` };
    }

    const result = await client.callTool(server, tool, args, {
      timeoutMs: ctx.commandTimeoutMs,
      onProgress: ctx.onMcpProgress,
    });
    const text = sanitizeMcpContent(formatMcpContent(result), { workdir: ctx.workdir });
    const body = truncateText(text || '(sem conteúdo)', ctx.maxOutputChars ?? DEFAULT_MAX_OUTPUT);
    return { ok: result.isError !== true, output: wrapUntrusted('TOOL RESULT', `${server}.${tool}`, body) };
  } catch (e) {
    return fail(`${server}.${tool} falhou: ${errText(e)}`);
  }
}

export const mcpCallTool: ToolSpec = {
  name: 'mcp_call',
  description: 'Chama uma ferramenta de um servidor MCP conectado.',
  parameters: {
    server: 'nome do servidor MCP configurado',
    tool: 'nome da ferramenta MCP',
    args: 'objeto JSON com os argumentos da ferramenta',
  },
  destructive: false, // avaliado dinamicamente por nome/annotations dentro de run()
  run: runMcpCall,
};

/* ───────────── Contexto para o system prompt ───────────── */

export function summarizeSchema(schema: Record<string, unknown>, maxProps = 8): string {
  const props = schema['properties'];
  if (!props || typeof props !== 'object') return '';
  const req = schema['required'];
  const required = new Set(Array.isArray(req) ? req.filter((x): x is string => typeof x === 'string') : []);
  const entries = Object.entries(props as Record<string, unknown>);
  const parts = entries.slice(0, maxProps).map(([k, v]) => {
    const t = v && typeof v === 'object' ? (v as { type?: unknown }).type : undefined;
    const type = typeof t === 'string' ? t : Array.isArray(t) ? t.join('|') : 'any';
    return `${k}${required.has(k) ? '*' : ''}: ${type}`;
  });
  return parts.join(', ') + (entries.length > parts.length ? `, +${entries.length - parts.length}` : '');
}

export interface McpContextOptions {
  servers?: string[] | undefined;
  includeTools?: boolean | undefined; // padrão: true
  includeResources?: boolean | undefined; // padrão: false (só lê o que `resourceFilter` aprovar)
  resourceFilter?: ((server: string, r: McpResource) => boolean) | undefined;
  maxResources?: number | undefined;
  maxCharsPerResource?: number | undefined;
  maxToolsPerServer?: number | undefined;
  workdir?: string | undefined;
}

/**
 * Monta o bloco de contexto: catálogo dinâmico de tools (descoberta automática) e,
 * opcionalmente, recursos relevantes. Tudo que vem do servidor é dado não confiável.
 */
export async function buildMcpContext(client: McpClient, opts: McpContextOptions = {}): Promise<string> {
  const names = (opts.servers ?? client.getEnabledServerNames()).filter((n) => client.hasServer(n) && client.isEnabled(n));
  if (names.length === 0) return '';
  const maxTools = opts.maxToolsPerServer ?? 40;
  const sections: string[] = [];

  if (opts.includeTools !== false) {
    const settled = await Promise.allSettled(names.map((n) => client.listTools(n)));
    const lines: string[] = [];
    settled.forEach((r, i) => {
      const name = names[i] as string;
      if (r.status === 'rejected') {
        lines.push(`### ${name} — indisponível (${errText(r.reason).slice(0, 120)})`);
        return;
      }
      const status = client.listServers().find((s) => s.name === name);
      lines.push(`### ${name}${status?.serverName ? ` — ${status.serverName}${status.serverVersion ? ` ${status.serverVersion}` : ''}` : ''}`);
      for (const t of r.value.slice(0, maxTools)) {
        const desc = (t.description ?? '').split('\n')[0]?.slice(0, 160) ?? '';
        const schema = summarizeSchema(t.inputSchema);
        const warn = isDestructiveMcpTool(t.name, t.annotations) ? ' ⚠ pede confirmação' : '';
        lines.push(`- ${t.name}(${schema})${desc ? ` — ${desc}` : ''}${warn}`);
      }
      if (r.value.length > maxTools) lines.push(`- … +${r.value.length - maxTools} tools`);
    });
    const catalog = sanitizeMcpContent(lines.join('\n'), { redactPaths: false });
    sections.push(
      `${wrapUntrusted('SERVERS', 'servidores MCP configurados', catalog)}\n` +
        'Para usar uma ferramenta MCP, chame mcp_call com {"server": "...", "tool": "...", "args": {...}}.',
    );
  }

  if (opts.includeResources && opts.resourceFilter) {
    let budget = opts.maxResources ?? 5;
    for (const n of names) {
      if (budget <= 0) break;
      try {
        const resources = (await client.listResources(n)).filter((r) => opts.resourceFilter?.(n, r));
        for (const r of resources) {
          if (budget <= 0) break;
          const read = await client.readResource(n, r.uri);
          const text = read.contents.map((c) => (typeof c.text === 'string' ? c.text : '')).filter(Boolean).join('\n');
          if (!text) continue;
          const clean = sanitizeMcpContent(text, { workdir: opts.workdir });
          sections.push(wrapUntrusted('RESOURCE', `${n} ${r.uri}`, truncateText(clean, opts.maxCharsPerResource ?? 4000)));
          budget--;
        }
      } catch {
        /* recurso indisponível não deve derrubar o chat */
      }
    }
  }
  return sections.join('\n\n');
}

/** Executa um prompt MCP escolhido pelo usuário e devolve o texto pronto para entrar no contexto. */
export async function renderMcpPrompt(
  client: McpClient,
  server: string,
  prompt: string,
  args?: Record<string, string>,
  opts: { workdir?: string | undefined; maxChars?: number | undefined } = {},
): Promise<string> {
  const res = await client.getPrompt(server, prompt, args);
  const lines = res.messages.map((m) => `[${m.role === 'assistant' ? 'assistant' : 'user'}] ${formatMcpBlock(m.content)}`);
  const clean = sanitizeMcpContent(lines.join('\n'), { workdir: opts.workdir });
  return wrapUntrusted('PROMPT', `${server}/${prompt}`, truncateText(clean, opts.maxChars ?? 8000));
}

/* ───────────── Comando /mcp ───────────── */

export function formatMcpStatus(client: McpClient): string {
  const rows = client.listServers();
  if (rows.length === 0) return 'Nenhum servidor MCP configurado (MCP_SERVERS vazio).';
  const text = rows
    .map((r) => {
      const icon = r.state === 'connected' ? '●' : r.state === 'error' ? '✗' : '○';
      const who = r.serverName ? ` — ${r.serverName}${r.serverVersion ? ` ${r.serverVersion}` : ''}` : '';
      const tools = r.toolCount !== undefined ? ` · ${r.toolCount} tools` : '';
      const err = r.error ? ` · erro: ${r.error.slice(0, 120)}` : '';
      return `${icon} ${r.name} [${r.type}] ${r.state}${r.enabled ? '' : ' (desabilitado)'}${who}${tools}${err}`;
    })
    .join('\n');
  return sanitizeMcpContent(text, { redactPaths: false });
}

/** /mcp · /mcp connect <nome> · /mcp disconnect <nome> · /mcp tools [nome]. Devolve o texto a exibir. */
export async function runMcpCommand(client: McpClient | undefined, argv: readonly string[]): Promise<string> {
  if (!client) return 'MCP está desligado. Defina MCP_ENABLED=true e MCP_SERVERS no .env.';
  const [sub, name] = argv;
  try {
    if (!sub) return formatMcpStatus(client);
    if (sub === 'connect' || sub === 'disconnect') {
      if (!name || !client.hasServer(name)) return `Uso: /mcp ${sub} <nome>. Servidores: ${client.getServerNames().join(', ') || '(nenhum)'}`;
      if (sub === 'disconnect') {
        await client.closeAsync(name);
        return `Desconectado de "${name}".`;
      }
      await client.connect(name);
      const tools = await client.listTools(name);
      return `Conectado a "${name}" · ${tools.length} tools.`;
    }
    if (sub === 'tools') {
      const targets = name ? [name] : client.getEnabledServerNames();
      const unknown = targets.find((n) => !client.hasServer(n));
      if (unknown) return `Servidor MCP desconhecido: "${unknown.slice(0, 40)}"`;
      const out: string[] = [];
      for (const n of targets) {
        const tools = await client.listTools(n);
        out.push(`${n}:`, ...tools.map((t) => `  - ${t.name}(${summarizeSchema(t.inputSchema)})${isDestructiveMcpTool(t.name, t.annotations) ? ' ⚠' : ''}`));
      }
      return sanitizeMcpContent(out.join('\n'), { redactPaths: false });
    }
    return 'Uso: /mcp · /mcp connect <nome> · /mcp disconnect <nome> · /mcp tools [nome]';
  } catch (e) {
    return `Erro MCP: ${errText(e)}`;
  }
}
