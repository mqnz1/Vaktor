// src/mcp/types.ts
// Tipos JSON-RPC 2.0 + MCP. Zero dependências externas.

/* ───────────── Constantes ───────────── */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const RPC_ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  CONNECTION: -32000,
  TIMEOUT: -32001,
  SECURITY: -32002,
} as const;

/* ───────────── JSON-RPC 2.0 ───────────── */

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isJsonRpcRequest(m: JsonRpcMessage): m is JsonRpcRequest {
  return 'method' in m && 'id' in m && m.id !== undefined && m.id !== null;
}
export function isJsonRpcNotification(m: JsonRpcMessage): m is JsonRpcNotification {
  return 'method' in m && !('id' in m && m.id !== undefined);
}
export function isJsonRpcResponse(m: JsonRpcMessage): m is JsonRpcResponse {
  return !('method' in m) && ('result' in m || 'error' in m);
}

/** Erro tipado do cliente MCP (rede, protocolo, segurança ou erro devolvido pelo servidor). */
export class McpError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

/* ───────────── Primitivas MCP ───────────── */

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations | undefined;
}

export interface McpResource {
  uri: string;
  name?: string | undefined;
  description?: string | undefined;
  mimeType?: string | undefined;
}

export interface McpPrompt {
  name: string;
  description?: string | undefined;
  arguments?: Array<{ name: string; description?: string | undefined; required?: boolean }> | undefined;
}

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: McpResourceContents }
  | { type: 'resource_link'; uri: string; name?: string; mimeType?: string };

export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpToolCallResult {
  content?: McpContentBlock[] | undefined;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpReadResourceResult {
  contents: McpResourceContents[];
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content: McpContentBlock;
}

export interface McpGetPromptResult {
  description?: string | undefined;
  messages: McpPromptMessage[];
}

/* ───────────── Configuração / handshake ───────────── */

export interface McpServerConfig {
  name: string;
  type: 'stdio' | 'http';
  command?: string | undefined; // stdio
  args?: readonly string[] | undefined; // stdio
  url?: string | undefined; // http (deve ser https://)
  headers?: Record<string, string> | undefined;
  enabled: boolean;
  /** stdio: diretório de trabalho do processo. */
  cwd?: string | undefined;
  /** stdio: variáveis extras (o ambiente do Vektor NÃO é herdado por inteiro). */
  env?: Record<string, string> | undefined;
  /** Timeout por requisição (ms). */
  timeoutMs?: number | undefined;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: { tools?: unknown; resources?: unknown; prompts?: unknown; logging?: unknown };
  serverInfo: { name: string; version?: string | undefined };
  instructions?: string | undefined;
}

/* ───────────── Roots / Sampling / Eventos ───────────── */

export interface McpRoot {
  uri: string;
  name?: string;
}

export interface McpSamplingRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: McpContentBlock }>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  includeContext?: 'none' | 'thisServer' | 'allServers';
  modelPreferences?: unknown;
}

export interface McpSamplingResult {
  role: 'assistant';
  content: { type: 'text'; text: string };
  model: string;
  stopReason?: string;
}

export interface McpProgressEvent {
  server: string;
  token: string | number;
  progress: number;
  total?: number | undefined;
  message?: string | undefined;
}

export interface McpLogEvent {
  server: string;
  level: string;
  logger?: string | undefined;
  data: unknown;
}

export interface McpServerStatus {
  name: string;
  type: 'stdio' | 'http';
  enabled: boolean;
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  serverName?: string | undefined;
  serverVersion?: string | undefined;
  toolCount?: number | undefined;
  error?: string | undefined;
}

/* ───────────── Contratos com o host (Vektor) ─────────────
 * ToolResult, ToolSpec e ToolContext vêm dos módulos reais
 * (src/tools/types.ts), importados por security.ts/bridge.ts.
 * Aqui ficam apenas os tipos próprios do protocolo MCP. */
