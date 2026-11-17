// =============================================================
// Contratos do Orquestrador Dinâmico do Vaktor.
//
// O líder (planner) gera um Task Graph; o motor agenda tarefas
// independentes em paralelo e dependentes em sequência. Cada tarefa
// é executada por um agente isolado, com o modelo do papel escolhido.
// =============================================================
import type { AgentRunSummary, ChatMessage, CompleteOptions } from '../types/index.js';
import type { ProviderId } from '../thinking/types.js';
import { qualifyModelId } from '../providers/registry.js';

export type OrchestratorRole =
  | 'planner'
  | 'scout'
  | 'builder_backend'
  | 'builder_frontend'
  | 'fixer';

export type WorkerRole = Exclude<OrchestratorRole, 'planner'>;

export interface OrchestratorRoleDefinition {
  id: OrchestratorRole;
  icon: string;
  label: string;
  description: string;
  kind: 'leader' | 'worker';
}

export const ORCHESTRATOR_ROLES: readonly OrchestratorRoleDefinition[] = [
  {
    id: 'planner',
    icon: '🧠',
    label: 'Planner (Leader)',
    description: 'Planeja o Task Graph, revisa e valida o resultado final',
    kind: 'leader',
  },
  {
    id: 'scout',
    icon: '🔎',
    label: 'Scout Worker',
    description: 'Leitura, mapeamento e pesquisa (sem escrita)',
    kind: 'worker',
  },
  {
    id: 'builder_backend',
    icon: '⚙️',
    label: 'Builder 1 (Back-end)',
    description: 'Back-end, APIs, dados e integrações',
    kind: 'worker',
  },
  {
    id: 'builder_frontend',
    icon: '🎨',
    label: 'Builder 2 (Front-end)',
    description: 'Front-end, interfaces e experiência',
    kind: 'worker',
  },
  {
    id: 'fixer',
    icon: '🛠️',
    label: 'Fixer (Reviewer)',
    description: 'Validação, revisão e correções',
    kind: 'worker',
  },
];

export const ORCHESTRATOR_ROLE_IDS: readonly OrchestratorRole[] =
  ORCHESTRATOR_ROLES.map(role => role.id);

export const WORKER_ROLES: readonly WorkerRole[] = [
  'scout',
  'builder_backend',
  'builder_frontend',
  'fixer',
];

export function isOrchestratorRole(value: string): value is OrchestratorRole {
  return (ORCHESTRATOR_ROLE_IDS as readonly string[]).includes(value);
}

export function roleDefinition(role: OrchestratorRole): OrchestratorRoleDefinition {
  return ORCHESTRATOR_ROLES.find(item => item.id === role) ?? ORCHESTRATOR_ROLES[0]!;
}

export function roleLabel(role: OrchestratorRole): string {
  return roleDefinition(role).label;
}

export function roleIcon(role: OrchestratorRole): string {
  return roleDefinition(role).icon;
}

export type OrchestratorAssignments = Record<OrchestratorRole, string>;

// Padrões: somente provedores ativos/validados. Echo, Requesty e
// AgentRouter ficam fora dos defaults (402/403/401).
export const DEFAULT_ASSIGNMENTS: OrchestratorAssignments = {
  planner: qualifyModelId('nvidia', 'nvidia/nemotron-3-ultra-550b-a55b'),
  scout: qualifyModelId('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
  builder_backend: qualifyModelId('opencode', 'deepseek-v4.1-flash'),
  builder_frontend: qualifyModelId('gemini', 'gemini-2.5-flash'),
  fixer: qualifyModelId('opencode', 'claude-haiku-4-5'),
};

export const ROLE_FALLBACK_CHAINS: Record<OrchestratorRole, readonly string[]> = {
  planner: [
    qualifyModelId('opencode', 'deepseek-v4.1-flash'),
    qualifyModelId('gemini', 'gemini-2.5-flash'),
    qualifyModelId('nvidia', 'z-ai/glm-5.3'),
  ],
  scout: [
    qualifyModelId('opencode', 'deepseek-v4.1-flash'),
    qualifyModelId('gemini', 'gemini-2.5-flash'),
    qualifyModelId('opencode', 'gemini-3.5-flash-lite'),
  ],
  builder_backend: [
    qualifyModelId('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
    qualifyModelId('opencode', 'glm-5.3-flash'),
    qualifyModelId('gemini', 'gemini-2.5-flash'),
  ],
  builder_frontend: [
    qualifyModelId('opencode', 'deepseek-v4.1-flash'),
    qualifyModelId('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
    qualifyModelId('gemini', 'gemini-2.5-pro'),
  ],
  fixer: [
    qualifyModelId('opencode', 'deepseek-v4.1-flash'),
    qualifyModelId('nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
    qualifyModelId('gemini', 'gemini-2.5-flash'),
  ],
};

export interface OrchestrationLeaderPayload {
  role: 'planner';
  model: string;
  provider: string;
}

export interface OrchestrationWorkerPayload {
  role: WorkerRole;
  model: string;
  provider: string;
}

export interface OrchestrationConfigPayload {
  leader: OrchestrationLeaderPayload;
  workers: OrchestrationWorkerPayload[];
}

export interface OrchestrationPayload {
  command: 'orchestrate';
  orchestration: OrchestrationConfigPayload;
  taskPrompt: string;
}

export interface OrchestrationTask {
  id: string;
  role: WorkerRole;
  title: string;
  instructions: string;
  files: string[];
  dependsOn: string[];
}

export interface OrchestrationPlan {
  summary: string;
  tasks: OrchestrationTask[];
  verification: string[];
}

export type OrchestrationTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked';

export interface OrchestrationTaskResult {
  id: string;
  role: WorkerRole;
  title: string;
  status: OrchestrationTaskStatus;
  ok: boolean;
  model: string;
  provider?: ProviderId;
  text: string;
  modifiedFiles: string[];
  commands: string[];
  diff?: string;
  error?: string;
  durationMs: number;
}

export interface OrchestratorCompletion {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  agent?: AgentRunSummary;
}

export type OrchestratorCompleteFn = (
  messages: ChatMessage[],
  options?: CompleteOptions,
) => Promise<OrchestratorCompletion>;

export type OrchestrationEventType =
  | 'status'
  | 'plan'
  | 'task_start'
  | 'task_token'
  | 'task_done'
  | 'worker_start'
  | 'worker_token'
  | 'worker_done'
  | 'result'
  | 'error'
  | 'done';

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  message: string;
  timestamp: number;
  role?: OrchestratorRole;
  model?: string;
  fallback?: boolean;
  finalText?: string;
  taskId?: string;
  taskTitle?: string;
  /** Plano completo (evento `plan` e eventos finais). */
  plan?: OrchestrationPlan;
  /** Resultado de uma subtarefa (evento `task_done`). */
  task?: OrchestrationTaskResult;
  /** Subtarefas executadas (eventos `result`/`done`). */
  tasks?: OrchestrationTaskResult[];
  runId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

export interface OrchestrationResult {
  ok: boolean;
  finalText: string;
  model: string;
  events: OrchestrationEvent[];
  error?: string;
  runId?: string;
  plan?: OrchestrationPlan;
  tasks?: OrchestrationTaskResult[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

const WIRE_PROVIDER: Partial<Record<ProviderId, string>> = {
  echo: 'echo-free',
};

/** Nome do provedor no payload público (`echo` vira `echo-free`). */
export function wireProvider(provider: ProviderId): string {
  return WIRE_PROVIDER[provider] ?? provider;
}
