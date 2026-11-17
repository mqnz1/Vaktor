// =============================================================
// Tipos públicos do agente de código
// =============================================================
import type {
  AllowedCommand,
  ChatMessage,
  CompleteOptions,
  RouterResponse,
} from '../types/index.js';
import type { ProviderId } from '../thinking/index.js';
import type { McpClient } from '../mcp/client.js';

// Ação que exige confirmação do usuário antes de acontecer. Vale tanto para
// escrita de arquivo (kind create/overwrite/patch) quanto para ações
// irreversíveis (install/commit/push/pr), que NUNCA são auto-aprovadas.
export type ConfirmKind =
  | 'create'
  | 'overwrite'
  | 'patch'
  | 'install'
  | 'commit'
  | 'push'
  | 'pr'
  | 'mcp';

export interface PendingConfirm {
  kind: ConfirmKind;
  title: string;
  detail: string;
  path?: string;
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface VerifySummary {
  ran: boolean;
  ok: boolean;
  attempts: number;
  command?: string;
}

export interface VerifyResult extends VerifySummary {
  output?: string;
}

export type AgentEvent =
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; name: string; args: Record<string, unknown>; ok: boolean; preview: string }
  | { type: 'verify_start'; command: string }
  | { type: 'verify_end'; ok: boolean; output: string }
  | { type: 'repair'; attempt: number; maxAttempts: number; errors: string[] }
  | { type: 'assistant_text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; text: string; iterations: number; toolCalls: number };

export interface AgentResult {
  text: string;
  ok: boolean;
  error?: string;
  iterations: number;
  toolCalls: number;
  verify: VerifySummary;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  tools: ToolTrace[];
  model: string;
  provider?: ProviderId;
  modifiedFiles: string[];
  commands: string[];
  diff?: string;
}

export interface ContextOptions {
  inject: boolean;
  maxChars: number;
}

export interface BestOfNOptions {
  n: number;
  criticModel?: string;
  maxCostUsd: number;
  verifyCandidate?: (text: string) => Promise<boolean>;
}

export interface DatasetOptions {
  enabled: boolean;
}

export type CompleteFn = (
  messages: ChatMessage[],
  options?: CompleteOptions,
) => Promise<RouterResponse>;

export interface AgentOptions {
  workdir: string;
  maxIterations: number;
  maxToolCalls: number;
  allowWrite: boolean;
  autoApprove: boolean;
  verify: boolean;
  verifyMaxAttempts: number;
  onEvent: (event: AgentEvent) => void;
  onConfirm?: (pending: PendingConfirm) => Promise<boolean>;
  model?: string;
  provider?: ProviderId;
  systemPrompt?: string;
  allowedTools?: string[];
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
  captureDiff?: boolean;
  maxFileBytes?: number;
  maxOutputChars?: number;
  commandTimeoutMs?: number;
  allowedCommands?: AllowedCommand[];
  // Capacidades extras. Padrão: desligadas.
  allowNetwork?: boolean;
  allowInstall?: boolean;
  allowGitWrite?: boolean;
  allowedDomains?: string[];
  // Cliente MCP injetado pela sessão (o loop nunca cria o próprio).
  mcpEnabled?: boolean;
  mcpClient?: McpClient | undefined;
  context?: ContextOptions;
  memoryFile?: string;
  // Perfil de segurança (SECURITY.md) injetado no system prompt do agente.
  securityEnabled?: boolean;
  securityFile?: string;
  // Contexto persistente do usuário (RESOURCES.md).
  resourcesEnabled?: boolean;
  resourcesFile?: string;
  bestOfN?: BestOfNOptions;
  dataset?: DatasetOptions;
  isOverBudget?: () => boolean;
  verifyRunner?: (attempt: number) => Promise<VerifyResult>;
  estimateCost?: (messages: ChatMessage[]) => number;
}
