// =============================================================
// API client do Vaktor para orquestração.
//
// Se VAKTOR_API_URL (ou VAKTOR_ORCHESTRATOR_URL) estiver definido, envia
// o payload para o endpoint HTTP e consome o stream NDJSON/SSE. Qualquer
// falha de rede cai automaticamente para o motor local (`runOrchestration`).
// =============================================================
import { runOrchestration } from './engine.js';
import { normalizeOrchestrationPayload } from './payload.js';
import { orchestratorStore } from './store.js';
import { ensureVaktorWorkspace } from './workspace.js';
import {
  DEFAULT_ASSIGNMENTS,
  WORKER_ROLES,
  isOrchestratorRole,
  type OrchestrationEvent,
  type OrchestrationPayload,
  type OrchestrationPlan,
  type OrchestrationResult,
  type OrchestrationTask,
  type OrchestrationTaskResult,
  type OrchestratorAssignments,
  type OrchestratorCompleteFn,
  type WorkerRole,
} from './types.js';
import { PROVIDER_ORDER } from '../providers/registry.js';
import type { ProviderId } from '../thinking/types.js';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

export interface OrchestrationHandlers {
  onEvent?: (event: OrchestrationEvent) => void;
  signal?: AbortSignal;
  maxTokensPerCall?: number;
}

export interface VaktorApiOptions {
  complete: OrchestratorCompleteFn;
  workdir: string;
  /** Endpoint explícito; por padrão lê VAKTOR_API_URL/VAKTOR_ORCHESTRATOR_URL. */
  endpoint?: string | null;
  fetchImpl?: typeof fetch;
  maxTokensPerCall?: number;
}

function endpointFromEnv(): string | null {
  const raw =
    process.env.VAKTOR_ORCHESTRATOR_URL?.trim() ||
    process.env.VAKTOR_API_URL?.trim() ||
    '';
  if (!raw) return null;
  const base = raw.replace(/\/+$/, '');
  return base.endsWith('/orchestrate') ? base : `${base}/orchestrate`;
}

const TASK_STATUSES: readonly OrchestrationTaskResult['status'][] = [
  'pending',
  'running',
  'done',
  'failed',
  'blocked',
];

function boundedText(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? value.slice(0, maxChars) : '';
}

function boundedStringList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    result.push(item.slice(0, maxChars));
    if (result.length >= maxItems) break;
  }
  return result;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeUsage(value: unknown): OrchestrationEvent['usage'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const inputTokens = finiteNumber(raw.inputTokens);
  const outputTokens = finiteNumber(raw.outputTokens);
  const estimatedCostUsd = finiteNumber(raw.estimatedCostUsd);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    estimatedCostUsd === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    estimatedCostUsd: estimatedCostUsd ?? 0,
  };
}

function normalizeTask(value: unknown): OrchestrationTask | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = boundedText(raw.id, 200).trim();
  const role =
    typeof raw.role === 'string' && (WORKER_ROLES as readonly string[]).includes(raw.role)
      ? (raw.role as WorkerRole)
      : undefined;
  if (!id || !role) return null;
  const title = boundedText(raw.title, 500).trim() || id;
  return {
    id,
    role,
    title,
    instructions: boundedText(raw.instructions, 8000),
    files: boundedStringList(raw.files, 100, 500),
    dependsOn: boundedStringList(raw.dependsOn, 100, 200),
  };
}

function normalizePlan(value: unknown): OrchestrationPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const summary = boundedText(raw.summary, 8000);
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks
        .map(normalizeTask)
        .filter((task): task is OrchestrationTask => task !== null)
        .slice(0, 50)
    : [];
  const verification = boundedStringList(raw.verification, 50, 1000);
  if (!summary && tasks.length === 0 && verification.length === 0) return undefined;
  return { summary, tasks, verification };
}

function normalizeTaskResult(value: unknown): OrchestrationTaskResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const id = boundedText(raw.id, 200).trim();
  if (!id) return undefined;
  const role =
    typeof raw.role === 'string' && (WORKER_ROLES as readonly string[]).includes(raw.role)
      ? (raw.role as WorkerRole)
      : 'fixer';
  const ok = raw.ok === true;
  const status =
    typeof raw.status === 'string' &&
    (TASK_STATUSES as readonly string[]).includes(raw.status)
      ? (raw.status as OrchestrationTaskResult['status'])
      : ok
        ? 'done'
        : 'failed';
  const provider =
    typeof raw.provider === 'string' &&
    (PROVIDER_ORDER as readonly string[]).includes(raw.provider)
      ? (raw.provider as ProviderId)
      : undefined;
  const diff = boundedText(raw.diff, 50000);
  const error = boundedText(raw.error, 4000);
  return {
    id,
    role,
    title: boundedText(raw.title, 500).trim() || id,
    status,
    ok,
    model: boundedText(raw.model, 300),
    ...(provider ? { provider } : {}),
    text: boundedText(raw.text, 50000),
    modifiedFiles: boundedStringList(raw.modifiedFiles, 100, 500),
    commands: boundedStringList(raw.commands, 100, 500),
    ...(diff ? { diff } : {}),
    ...(error ? { error } : {}),
    durationMs: finiteNumber(raw.durationMs) ?? 0,
  };
}

function normalizeTaskResults(value: unknown): OrchestrationTaskResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tasks = value
    .map(normalizeTaskResult)
    .filter((task): task is OrchestrationTaskResult => task !== undefined)
    .slice(0, 50);
  return tasks.length > 0 ? tasks : undefined;
}

function eventFromUnknown(value: unknown): OrchestrationEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== 'string' || typeof raw.message !== 'string') return null;
  const message = boundedText(raw.message, 8000);
  const allowed = [
    'status',
    'plan',
    'task_start',
    'task_token',
    'task_done',
    'worker_start',
    'worker_token',
    'worker_done',
    'result',
    'error',
    'done',
  ];
  if (!allowed.includes(type)) return null;
  const role =
    typeof raw.role === 'string' && isOrchestratorRole(raw.role) ? raw.role : undefined;
  const model = boundedText(raw.model, 300).trim() || undefined;
  const fallback = raw.fallback === true ? true : undefined;
  const finalText = boundedText(raw.finalText, 50000);
  const taskId = boundedText(raw.taskId, 200).trim() || undefined;
  const taskTitle = boundedText(raw.taskTitle, 500).trim() || undefined;
  const plan = normalizePlan(raw.plan);
  const task = normalizeTaskResult(raw.task);
  const tasks = normalizeTaskResults(raw.tasks);
  const runId = boundedText(raw.runId, 200).trim() || undefined;
  const usage = normalizeUsage(raw.usage);
  return {
    type: type as OrchestrationEvent['type'],
    message,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    ...(role ? { role } : {}),
    ...(model ? { model } : {}),
    ...(fallback ? { fallback } : {}),
    ...(finalText ? { finalText } : {}),
    ...(taskId ? { taskId } : {}),
    ...(taskTitle ? { taskTitle } : {}),
    ...(plan ? { plan } : {}),
    ...(task ? { task } : {}),
    ...(tasks ? { tasks } : {}),
    ...(runId ? { runId } : {}),
    ...(usage ? { usage } : {}),
  };
}

function parseLine(line: string): OrchestrationEvent | 'done' | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed === '[DONE]' || trimmed === 'data: [DONE]') return 'done';
  const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (!data) return null;
  try {
    return eventFromUnknown(JSON.parse(data));
  } catch {
    return null;
  }
}

async function consumeStream(
  res: FetchResponse,
  handlers: OrchestrationHandlers,
): Promise<OrchestrationResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Resposta do endpoint sem corpo.');
  const decoder = new TextDecoder();
  const events: OrchestrationEvent[] = [];
  const taskResults = new Map<string, OrchestrationTaskResult>();
  let buffer = '';
  let finalText = '';
  let model = '';
  let plan: OrchestrationPlan | undefined;
  let runId: string | undefined;
  let usage: NonNullable<OrchestrationResult['usage']> | undefined;
  let error: string | undefined;

  const handle = (line: string): void => {
    const parsed = parseLine(line);
    if (!parsed) return;
    if (parsed === 'done') return;
    events.push(parsed);
    handlers.onEvent?.(parsed);
    if (parsed.plan) plan = parsed.plan;
    if (parsed.task) taskResults.set(parsed.task.id, parsed.task);
    if (parsed.tasks) {
      for (const task of parsed.tasks) taskResults.set(task.id, task);
    }
    if (parsed.runId) runId = parsed.runId;
    if (parsed.usage) usage = parsed.usage;
    if (parsed.type === 'result' || parsed.type === 'done') {
      if (parsed.finalText) finalText = parsed.finalText;
      if (parsed.model) model = parsed.model;
    }
    if (parsed.type === 'error') error = parsed.message;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? '';
    for (const part of parts) handle(part);
  }
  if (buffer.trim()) handle(buffer);

  return {
    ok: error === undefined,
    finalText,
    model,
    events,
    ...(error !== undefined ? { error } : {}),
    ...(runId ? { runId } : {}),
    ...(plan ? { plan } : {}),
    ...(taskResults.size > 0 ? { tasks: [...taskResults.values()] } : {}),
    ...(usage ? { usage } : {}),
  };
}

function collectEventResult(events: readonly OrchestrationEvent[]): {
  plan?: OrchestrationPlan;
  tasks?: OrchestrationTaskResult[];
  runId?: string;
  usage?: NonNullable<OrchestrationResult['usage']>;
} {
  let plan: OrchestrationPlan | undefined;
  let runId: string | undefined;
  let usage: NonNullable<OrchestrationResult['usage']> | undefined;
  const tasks = new Map<string, OrchestrationTaskResult>();
  for (const event of events) {
    if (event.plan) plan = event.plan;
    if (event.task) tasks.set(event.task.id, event.task);
    if (event.tasks) {
      for (const task of event.tasks) tasks.set(task.id, task);
    }
    if (event.runId) runId = event.runId;
    if (event.usage) usage = event.usage;
  }
  return {
    ...(plan ? { plan } : {}),
    ...(tasks.size > 0 ? { tasks: [...tasks.values()] } : {}),
    ...(runId ? { runId } : {}),
    ...(usage ? { usage } : {}),
  };
}

async function consumeJson(
  res: FetchResponse,
  handlers: OrchestrationHandlers,
): Promise<OrchestrationResult> {
  const data: unknown = await res.json();
  if (Array.isArray(data)) {
    const events = data
      .map(eventFromUnknown)
      .filter((event): event is OrchestrationEvent => event !== null);
    for (const event of events) handlers.onEvent?.(event);
    const result = [...events].reverse().find(event => event.type === 'result' || event.type === 'done');
    const errorEvent = [...events].reverse().find(event => event.type === 'error');
    return {
      ok: errorEvent === undefined,
      finalText: result?.finalText ?? '',
      model: result?.model ?? '',
      events,
      ...(errorEvent ? { error: errorEvent.message } : {}),
      ...collectEventResult(events),
    };
  }
  if (data && typeof data === 'object') {
    const raw = data as Partial<OrchestrationResult>;
    const events = Array.isArray(raw.events)
      ? raw.events
          .map(eventFromUnknown)
          .filter((event): event is OrchestrationEvent => event !== null)
      : [];
    for (const event of events) handlers.onEvent?.(event);
    const eventState = collectEventResult(events);
    const rawRunId = boundedText(raw.runId, 200).trim() || undefined;
    const rawPlan = normalizePlan(raw.plan);
    const rawTasks = normalizeTaskResults(raw.tasks);
    const rawUsage = normalizeUsage(raw.usage);
    const rawError = boundedText(raw.error, 4000);
    const result: OrchestrationResult = {
      ok: raw.ok === true,
      finalText: boundedText(raw.finalText, 50000),
      model: boundedText(raw.model, 300),
      events,
      ...(rawError ? { error: rawError } : {}),
      ...(rawRunId
        ? { runId: rawRunId }
        : eventState.runId
          ? { runId: eventState.runId }
          : {}),
      ...(rawPlan
        ? { plan: rawPlan }
        : eventState.plan
          ? { plan: eventState.plan }
          : {}),
      ...(rawTasks
        ? { tasks: rawTasks }
        : eventState.tasks
          ? { tasks: eventState.tasks }
          : {}),
      ...(rawUsage
        ? { usage: rawUsage }
        : eventState.usage
          ? { usage: eventState.usage }
          : {}),
    };
    return result;
  }
  throw new Error('Resposta do endpoint em formato desconhecido.');
}

export class VaktorApi {
  constructor(private readonly options: VaktorApiOptions) {}

  async startOrchestration(
    payload: OrchestrationPayload,
    handlers: OrchestrationHandlers = {},
  ): Promise<OrchestrationResult> {
    ensureVaktorWorkspace(this.options.workdir);
    const endpoint =
      this.options.endpoint === undefined ? endpointFromEnv() : this.options.endpoint;
    const fetchImpl = this.options.fetchImpl ?? fetch;

    if (endpoint) {
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/x-ndjson, text/event-stream, application/json' },
          body: JSON.stringify(payload),
          ...(handlers.signal ? { signal: handlers.signal } : {}),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
        const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
        if (contentType.includes('ndjson') || contentType.includes('event-stream')) {
          return await consumeStream(res, handlers);
        }
        return await consumeJson(res, handlers);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (handlers.signal?.aborted) throw new Error('Orquestração cancelada.');
        handlers.onEvent?.({
          type: 'status',
          message: `API remota indisponível (${message}); executando localmente.`,
          timestamp: Date.now(),
        });
      }
    }

    return runOrchestration(payload, {
      complete: this.options.complete,
      workdir: this.options.workdir,
      ...(handlers.onEvent ? { onEvent: handlers.onEvent } : {}),
      ...(handlers.signal ? { signal: handlers.signal } : {}),
      ...(handlers.maxTokensPerCall !== undefined
        ? { maxTokensPerCall: handlers.maxTokensPerCall }
        : this.options.maxTokensPerCall !== undefined
          ? { maxTokensPerCall: this.options.maxTokensPerCall }
          : {}),
    });
  }
}

export function createVaktorApi(options: VaktorApiOptions): VaktorApi {
  return new VaktorApi(options);
}

export interface HandleOrchestrationOptions {
  complete: OrchestratorCompleteFn;
  workdir: string;
  defaults?: OrchestratorAssignments;
  onEvent?: (event: OrchestrationEvent) => void;
  signal?: AbortSignal;
}

/**
 * Handler de entrada para um servidor HTTP/IPC local do Vaktor.
 * Normaliza o corpo recebido e executa a orquestração localmente.
 */
export async function handleOrchestrationRequest(
  body: unknown,
  options: HandleOrchestrationOptions,
): Promise<OrchestrationResult> {
  const payload = normalizeOrchestrationPayload(
    body,
    options.defaults ?? orchestratorStore.snapshot() ?? DEFAULT_ASSIGNMENTS,
  );
  return runOrchestration(payload, {
    complete: options.complete,
    workdir: options.workdir,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
