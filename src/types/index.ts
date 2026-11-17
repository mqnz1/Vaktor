// =============================================================
// Tipos compartilhados do Vaktor
// =============================================================
import type { ProviderId, ThinkingConfig, ThinkingMode } from '../thinking/index.js';
import type { McpServerConfig } from '../mcp/types.js';
import type { ComboConfig } from '../router/combo.js';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

// Bloco de raciocínio de um turno. Um turno pode ter vários (ex.: plano do
// two-pass + raciocínio nativo do passe final). `text` já vem sem tags.
export interface ReasoningPart {
  id: string;
  text: string;
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: number;
  tokenCount?: number;
  reasoning?: string;
  reasoningParts?: ReasoningPart[];
  image?: Record<string, unknown>; // Bloco de imagem (para visão)
}

// Comando que o agente pode executar. A allowlist nunca é montada a partir
// de texto produzido pelo modelo: ela vem do .env ou do padrão do código.
export interface AllowedCommand {
  label: string;
  bin: string;
  args: string[];
}

export interface AgentConfig {
  enabled: boolean;
  maxIterations: number;
  maxToolCalls: number;
  allowWrite: boolean;
  autoApprove: boolean;
  maxFileBytes: number;
  maxOutputChars: number;
  commandTimeoutMs: number;
  allowedCommands: AllowedCommand[];
  // Capacidades extras (desligadas por padrão no .env). Todas as ações
  // irreversíveis continuam exigindo confirmação explícita na UI.
  allowNetwork: boolean;
  allowInstall: boolean;
  allowGitWrite: boolean;
  allowedDomains: string[];
  verifyEnabled: boolean;
  verifyMaxAttempts: number;
  contextInject: boolean;
  contextMaxChars: number;
  memoryFile: string;
  // Perfil de segurança (SECURITY.md) injetado no system prompt.
  securityEnabled: boolean;
  securityFile: string;
  // Cliente MCP (desligado por padrão).
  mcpEnabled: boolean;
  mcpServers: McpServerConfig[];
  bestOfN: number;
  criticModel: string | null;
  bestOfNMaxCostUsd: number;
  enableDatasetLog: boolean;
}

export type AppMode = 'chat' | 'code';

export type ModelStatus = 'available' | 'limited' | 'unavailable';
export type ModelSelection = 'auto' | string; // 'auto' ou ID do modelo

export interface ModelInfo {
  id: string;
  name: string;
  provider: 'puter' | 'agentrouter' | 'anthropic' | 'openai' | 'google' | 'requesty' | 'kilo' | 'fta' | 'proxygatellm'
| 'echo' | 'nvidia' | 'opencode' | 'harbor' | 'notion' | 'notion_web' | 'iteracompute' | 'qoder' | 'apinex' | 'deepai' | 'vyceai' | 'qronos';
  costPer1kTokensInput: number;   // USD
  costPer1kTokensOutput: number;  // USD
  contextWindow: number;
  status: ModelStatus;
  tier: 'premium' | 'standard' | 'economy';
  description: string;
}

export interface CreditUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: number;
  fromCache: boolean;
}

export interface CreditStats {
  totalCostUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  percentUsed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheHits: number;
  savedByCache: number;   // USD economizado via cache
  usageHistory: CreditUsage[];
}

export interface RouterConfig {
  defaultModel: ModelSelection;
  fallbackModel: string;
  budgetUsd: number;
  maxTokensPerRequest: number;
  enableCache: boolean;
  maxContextMessages: number;
  /** Orçamento total da janela de contexto do chat, em tokens estimados. */
  contextBudgetTokens: number;
  thinking: ThinkingConfig;
  enableSkills: boolean;
  skillsMaxPromptChars: number;
  skillsMaxPerRequest: number;
  runtimeContext: boolean;
  /** Prioriza modelos gratuitos na seleção automática (padrão: ligado). */
  preferFreeModels?: boolean;
  /** Permite trocar de modelo automaticamente em caso de erro (padrão: desligado). */
  autoFallback?: boolean;
  /** Roteamento ponderado com fallback e teto de créditos (Combo). */
  combo?: ComboConfig;
  /** Injeta RESOURCES.md no system prompt (padrão: ligado). */
  resourcesEnabled?: boolean;
  /** Nome do arquivo de contexto do usuário (padrão: RESOURCES.md). */
  resourcesFile?: string;
  agent: AgentConfig;
  warnings: string[];
}

export interface RouterState {
  activeModel: string;
  isAutoMode: boolean;
  isFallbackActive: boolean;
  appMode: AppMode;
  credits: CreditStats;
  thinkingEnabled: boolean;
  thinkingMode: ThinkingMode;
  thinkingShow: boolean;
  thinkingVariant?: string;
  workdir: string;
  activeSkills: string[];
  skillsEnabled: boolean;
  forcedSkillIds: string[];
  agentEnabled: boolean;
  securityEnabled: boolean;
  /** Combo ativo (roteamento ponderado + fallback). */
  comboActive?: boolean;
}

export interface SendMessageOptions {
  model?: string;
  maxTokens?: number;
  skipCache?: boolean;
}

export interface AgentRunSummary {
  ok: boolean;
  iterations: number;
  toolCalls: number;
  modifiedFiles: string[];
  commands: string[];
  tools: Array<{ name: string; args: Record<string, unknown>; ok: boolean }>;
  verify: { ran: boolean; ok: boolean; attempts: number; command?: string };
  diff?: string;
  error?: string;
}

// Opções de uma chamada crua ao provedor. `send()` aplica skills/truncamento
// antes de chamar `complete()`; o agente monta o próprio system prompt e usa
// `complete()` diretamente.
export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  bypassCache?: boolean;
  thinking?: boolean;
  model?: string;
  modelOverride?: string;
  provider?: ProviderId;
  providerOverride?: ProviderId;
  /** Prompt de papel que substitui a base genérica do agente. */
  systemPrompt?: string;
  systemPromptOverride?: string;
  /** Restringe as ferramentas disponíveis nesta execução. */
  allowedTools?: string[];
  /** Força execução via agente mesmo fora do modo code. */
  agentMode?: boolean;
  maxIterations?: number;
  maxToolCalls?: number;
  verify?: boolean;
  allowWrite?: boolean;
  /** Cancelamento externo (ex.: Ctrl+C na TUI) propagado ao provedor. */
  signal?: AbortSignal;
  /** Streaming parcial de tokens (quando o provedor suporta). */
  onToken?: (chunk: string) => void;
  /** Streaming parcial de raciocínio (reasoning-delta do provedor). */
  onReasoningToken?: (chunk: string) => void;
  /** Função de confirmação para ações irreversíveis do agente. */
  confirmFn?: (pending: any) => Promise<boolean>;
}

export interface RouterResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  fromCache: boolean;
  estimatedCostUsd: number;
  reasoning?: string;
  reasoningParts?: ReasoningPart[];
  /** Tokens de raciocínio cobrados pelo provedor (quando informado). */
  reasoningTokens?: number;
  passes?: number;
  agent?: AgentRunSummary;
}

export interface AppConfig {
  puterApiKey: string | null;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  router: RouterConfig;
}

// Mensagens internas da UI
export type UINotificationType = 'info' | 'warning' | 'success' | 'error';

export interface UINotification {
  id: string;
  type: UINotificationType;
  message: string;
  timestamp: number;
  autoDismissMs?: number;
}

// Contexto da conversa
export interface ConversationContext {
  messages: ChatMessage[];
  totalTokensEstimate: number;
}
