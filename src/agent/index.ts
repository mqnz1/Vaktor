// API pública do agente de código.
export type {
  AgentEvent,
  AgentOptions,
  AgentResult,
  BestOfNOptions,
  CompleteFn,
  ContextOptions,
  DatasetOptions,
  ConfirmKind,
  PendingConfirm,
  ToolTrace,
  VerifyResult,
  VerifySummary,
} from './types.js';
export { runAgent } from './loop.js';
export { parseToolCalls } from './protocol.js';
export { buildAgentSystemPrompt } from './prompt.js';
export { AgentApiError, classifyAgentError } from './errors.js';
export type { AgentErrorCode } from './errors.js';
