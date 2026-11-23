// =============================================================
// Montagem/normalização do payload público de orquestração.
//
// O payload sempre carrega `{ provider, model }` por papel. Sem isso,
// IDs compartilhados entre provedores eram roteados pelo primeiro dono
// do catálogo (ex.: claude-opus-4-8 caía no AgentRouter).
// =============================================================
import { PROVIDER_CATALOGS, parseModelRef, qualifyModelId } from '../providers/registry.js';
import type { ProviderId } from '../thinking/types.js';
import {
  ORCHESTRATOR_ROLE_IDS,
  WORKER_ROLES,
  isOrchestratorRole,
  wireProvider,
  type OrchestrationConfigPayload,
  type OrchestrationPayload,
  type OrchestrationWorkerPayload,
  type OrchestratorAssignments,
} from './types.js';

function rawModelId(modelId: string): string {
  return parseModelRef(modelId).id;
}

function providerOf(modelId: string): ProviderId {
  const ref = parseModelRef(modelId);
  if (ref.provider) return ref.provider;
  for (const [provider, catalog] of Object.entries(PROVIDER_CATALOGS)) {
    if (catalog.some(model => model.id === ref.id)) return provider as ProviderId;
  }
  return 'opencode';
}

function providerFromWire(value: unknown): ProviderId | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const clean = value.trim();
  if (clean === 'echo-free') return 'echo';
  return clean in PROVIDER_CATALOGS ? (clean as ProviderId) : undefined;
}

function qualifyIfNeeded(model: string, provider: unknown): string {
  const parsed = parseModelRef(model);
  if (parsed.provider) return model;
  const resolved = providerFromWire(provider);
  return resolved ? qualifyModelId(resolved, model) : model;
}

export function buildOrchestrationPayload(
  assignments: OrchestratorAssignments,
  taskPrompt: string,
): OrchestrationPayload {
  const leaderModel = assignments.planner;
  const workers: OrchestrationWorkerPayload[] = WORKER_ROLES.map(role => {
    const model = assignments[role];
    return {
      role,
      model: rawModelId(model),
      provider: wireProvider(providerOf(model)),
    };
  });
  return {
    command: 'orchestrate',
    orchestration: {
      leader: {
        role: 'planner',
        model: rawModelId(leaderModel),
        provider: wireProvider(providerOf(leaderModel)),
      },
      workers,
    },
    taskPrompt: taskPrompt.trim(),
  };
}

export function isOrchestrationPayload(value: unknown): value is OrchestrationPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<OrchestrationPayload>;
  if (payload.command !== 'orchestrate') return false;
  if (typeof payload.taskPrompt !== 'string' || payload.taskPrompt.trim() === '') return false;
  const config = payload.orchestration;
  if (!config || typeof config !== 'object') return false;
  const leader = config.leader;
  if (!leader || typeof leader !== 'object') return false;
  if (leader.role !== 'planner' || typeof leader.model !== 'string' || !leader.model.trim()) {
    return false;
  }
  if (typeof leader.provider !== 'string' || !providerFromWire(leader.provider)) return false;
  if (!Array.isArray(config.workers)) return false;
  if (config.workers.length !== WORKER_ROLES.length) return false;
  const seen = new Set<string>();
  for (const worker of config.workers) {
    if (!worker || typeof worker !== 'object') return false;
    const role = (worker as Partial<OrchestrationWorkerPayload>).role;
    const model = (worker as Partial<OrchestrationWorkerPayload>).model;
    const provider = (worker as Partial<OrchestrationWorkerPayload>).provider;
    if (typeof role !== 'string' || !(WORKER_ROLES as readonly string[]).includes(role)) return false;
    if (typeof model !== 'string' || !model.trim()) return false;
    if (typeof provider !== 'string' || !providerFromWire(provider)) return false;
    if (seen.has(role)) return false;
    seen.add(role);
  }
  return true;
}

/**
 * Normaliza um payload de entrada (HTTP/IPC) e garante que todos os papéis
 * tenham modelo + provedor, preenchendo com os defaults quando faltar.
 */
export function normalizeOrchestrationPayload(
  value: unknown,
  defaults: OrchestratorAssignments,
): OrchestrationPayload {
  if (isOrchestrationPayload(value)) return value;
  if (!value || typeof value !== 'object') {
    throw new Error('Payload de orquestração inválido.');
  }
  const input = value as {
    taskPrompt?: unknown;
    orchestration?: {
      leader?: { model?: unknown; provider?: unknown };
      workers?: Array<{ role?: unknown; model?: unknown; provider?: unknown }>;
    };
  };
  const taskPrompt = typeof input.taskPrompt === 'string' ? input.taskPrompt.trim() : '';
  if (!taskPrompt) throw new Error('taskPrompt é obrigatório.');

  const assignments: OrchestratorAssignments = { ...defaults };
  const leaderModel = input.orchestration?.leader?.model;
  if (typeof leaderModel === 'string' && leaderModel.trim()) {
    assignments.planner = qualifyIfNeeded(
      leaderModel.trim(),
      input.orchestration?.leader?.provider,
    );
  }
  for (const worker of input.orchestration?.workers ?? []) {
    const role = worker.role;
    const model = worker.model;
    if (typeof role === 'string' && isOrchestratorRole(role) && role !== 'planner') {
      if (typeof model === 'string' && model.trim()) {
        assignments[role] = qualifyIfNeeded(model.trim(), worker.provider);
      }
    }
  }
  return buildOrchestrationPayload(assignments, taskPrompt);
}

export function payloadAssignments(payload: OrchestrationPayload): OrchestratorAssignments {
  const assignments: OrchestratorAssignments = {
    planner: qualifyIfNeeded(
      payload.orchestration.leader.model,
      payload.orchestration.leader.provider,
    ),
    scout: '',
    builder_backend: '',
    builder_frontend: '',
    fixer: '',
  };
  for (const worker of payload.orchestration.workers) {
    assignments[worker.role] = qualifyIfNeeded(worker.model, worker.provider);
  }
  for (const role of ORCHESTRATOR_ROLE_IDS) {
    if (!assignments[role]) throw new Error(`Modelo ausente para o papel ${role}.`);
  }
  return assignments;
}

export type { OrchestrationConfigPayload };
