import { setTimeout as sleep } from 'node:timers/promises';
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

export const NOTION_BASE_URL = 'https://api.notion.com';
export const NOTION_VERSION = '2026-03-11';
export const NOTION_TIMEOUT_MS = 180_000;
export const NOTION_CATALOG_TIMEOUT_MS = 10_000;
export const NOTION_FALLBACK_AGENT_ID = 'notion_ai';

const NOTION_REQUEST_TIMEOUT_MS = 30_000;
const NOTION_POLL_MS = 1_000;
const NOTION_EVENT_PAGE_SIZE = 100;
const NOTION_PROMPT_LIMIT = 10_000;
const NOTION_CONTEXT_WINDOW = 200_000;
const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'canceled',
  'terminated',
  'requires_action',
]);

export interface NotionAgentModel {
  mode?: unknown;
  id?: unknown;
}

export interface NotionAgentDetails {
  id?: unknown;
  agent_type?: unknown;
  name?: unknown;
  description?: unknown;
  model?: unknown;
  status?: unknown;
}

export interface NotionSession {
  id?: unknown;
  status?: unknown;
  error?: unknown;
  required_actions?: unknown;
}

export interface NotionEvent {
  type?: unknown;
  sequence?: unknown;
  content?: unknown;
  metadata?: unknown;
}

export interface NotionEventAnswer {
  text: string;
  model?: string;
}

export const NOTION_MODELS: ModelInfo[] = [
  {
    id: NOTION_FALLBACK_AGENT_ID,
    name: 'Notion AI (auto)',
    provider: 'notion',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: NOTION_CONTEXT_WINDOW,
    status: 'available',
    tier: 'standard',
    description: 'Agente pessoal do Notion AI; requer plano Business/Enterprise',
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function agentModelLabel(value: unknown): string {
  const model = asRecord(value);
  return asString(model['id']) ?? asString(model['mode']) ?? 'auto';
}

function agentType(value: unknown): string {
  return asString(value) ?? 'custom_agent';
}

function agentStatus(value: unknown): string {
  return asString(value) ?? 'active';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimPromptContext(text: string): string {
  return text.length > NOTION_PROMPT_LIMIT ? text.slice(text.length - NOTION_PROMPT_LIMIT) : text;
}

export function mapNotionAgents(agents: readonly NotionAgentDetails[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];

  for (const agent of agents) {
    const id = asString(agent.id);
    if (!id || seen.has(id)) continue;
    const type = agentType(agent.agent_type);
    if (type !== 'custom_agent' && type !== 'notion_ai') continue;
    const status = agentStatus(agent.status);
    if (status === 'disabled' || status === 'deleted') continue;

    const name = asString(agent.name) ?? (id === NOTION_FALLBACK_AGENT_ID ? 'Notion AI' : id);
    const model = agentModelLabel(agent.model);
    const description = asString(agent.description) ?? `Agente ${type} do Notion AI`;

    seen.add(id);
    out.push({
      id,
      name: `${name} (${model})`,
      provider: 'notion',
      costPer1kTokensInput: 0,
      costPer1kTokensOutput: 0,
      contextWindow: NOTION_CONTEXT_WINDOW,
      status: 'available',
      tier: 'standard',
      description,
    });
  }

  return out.sort((a, b) => {
    if (a.id === NOTION_FALLBACK_AGENT_ID) return -1;
    if (b.id === NOTION_FALLBACK_AGENT_ID) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function notionDynamicEnabled(): boolean {
  return (process.env['NOTION_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

function notionHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function notionError(label: string, response: Response): Promise<Error> {
  const raw = await response.text().catch(() => '');
  let detail = raw;
  try {
    const parsed = asRecord(JSON.parse(raw) as unknown);
    detail = asString(parsed['message']) ?? asString(parsed['code']) ?? raw;
  } catch {
    detail = raw;
  }
  const redacted = redactSecrets(detail).replace(/\s+/g, ' ').trim().slice(0, 400);
  const detailSuffix = redacted.length > 0 && !/[.!?]$/.test(redacted) ? '.' : '';
  const hint =
    response.status === 400 && /business plan/i.test(detail)
      ? ' A API de agentes do Notion exige um workspace Business/Enterprise.'
      : response.status === 403 && /insufficient permissions/i.test(detail)
        ? ' Ative "View sessions and interact with agents" na conexão e compartilhe um Custom Agent.'
        : '';
  return new Error(
    `Notion AI (${label}): ${response.status}${redacted ? ` - ${redacted}${detailSuffix}` : ''}${hint}`,
  );
}

async function notionJson(
  path: string,
  apiKey: string,
  init: { method: string; body?: unknown },
  signal?: AbortSignal,
  timeoutMs = NOTION_REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${NOTION_BASE_URL}${path}`, {
    method: init.method,
    headers: notionHeaders(apiKey),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: withTimeout(timeoutMs, signal),
  });

  if (!response.ok) throw await notionError(path, response);
  return asRecord(await response.json());
}

export async function loadNotionCatalog(
  apiKey: string,
  timeoutMs = NOTION_CATALOG_TIMEOUT_MS,
): Promise<number> {
  if (!apiKey || !notionDynamicEnabled()) return 0;

  try {
    const data = await notionJson(
      '/v1/agents/query',
      apiKey,
      { method: 'POST', body: { page_size: 100 } },
      undefined,
      timeoutMs,
    );
    const results = Array.isArray(data['results']) ? data['results'] : [];
    const mapped = mapNotionAgents(
      results.map(item => asRecord(item) as NotionAgentDetails),
    );
    if (mapped.length === 0) return 0;
    NOTION_MODELS.splice(0, NOTION_MODELS.length, ...mapped);
    return mapped.length;
  } catch {
    return 0;
  }
}

export function buildNotionPromptContext(messages: readonly ChatMessage[]): string {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUser = index;
      break;
    }
  }

  const lines: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (index === lastUser) continue;
    const message = messages[index];
    if (!message) continue;
    const content = message.content.trim();
    if (!content) continue;
    const role =
      message.role === 'system'
        ? 'Sistema'
        : message.role === 'assistant'
          ? 'Assistente'
          : message.role === 'tool'
            ? 'Ferramenta'
            : 'Usuário';
    lines.push(`${role}:\n${content}`);
  }

  return trimPromptContext(lines.join('\n\n').trim());
}

export function lastNotionMessage(messages: readonly ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.content.trim().length > 0) {
      return message.content.trim().slice(0, NOTION_PROMPT_LIMIT);
    }
  }
  return '';
}

export function parseNotionAgentEvents(events: readonly NotionEvent[]): NotionEventAnswer {
  const answers: NotionEventAnswer[] = [];

  for (const event of events) {
    if (asString(event.type) !== 'agent.message') continue;
    const parts: string[] = [];
    if (Array.isArray(event.content)) {
      for (const item of event.content) {
        const part = asRecord(item);
        const text = asString(part['text']);
        if (text) parts.push(text);
      }
    }
    const text = parts.join('').trim();
    if (!text) continue;
    const metadata = asRecord(event.metadata);
    const model = asString(metadata['model']);
    answers.push(model ? { text, model } : { text });
  }

  return answers.length > 0 ? (answers[answers.length - 1] as NotionEventAnswer) : { text: '' };
}

function isNotionAgentId(id: string): boolean {
  return (
    id === NOTION_FALLBACK_AGENT_ID ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

function sessionError(session: Record<string, unknown>): string | undefined {
  const error = asRecord(session['error']);
  return asString(error['message']) ?? asString(error['code']);
}

function requiredActions(session: Record<string, unknown>): string {
  if (!Array.isArray(session['required_actions'])) return '';
  return session['required_actions']
    .map(item => asString(asRecord(item)['title']))
    .filter((title): title is string => Boolean(title))
    .join('; ');
}

export async function sendToNotion(
  messages: ChatMessage[],
  modelId: string,
  _maxTokens: number,
  apiKey: string,
  _thinking: ThinkingArg = false,
  _temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  if (!apiKey) {
    throw new Error('NOTION_API_KEY não configurada no .env — o Notion AI exige uma chave de integração.');
  }
  const agentId = modelId.trim();
  if (!isNotionAgentId(agentId)) {
    throw new Error(`Notion AI: ID de agente inválido (${agentId}).`);
  }

  const message = lastNotionMessage(messages);
  if (!message) throw new Error('Notion AI: nenhuma mensagem do usuário para enviar.');

  const context = buildNotionPromptContext(messages);
  const started = Date.now();
  let session = await notionJson(
    '/v1/sessions',
    apiKey,
    {
      method: 'POST',
      body: {
        agent_id: agentId,
        message,
        ...(context ? { prompt_context: context } : {}),
      },
    },
    callOpts?.signal,
  );

  const sessionId = asString(session['id']);
  if (!sessionId) throw new Error('Notion AI: a API não retornou o ID da sessão.');

  let status = asString(session['status']) ?? 'queued';
  while (!TERMINAL_STATUSES.has(status)) {
    if (Date.now() - started > NOTION_TIMEOUT_MS) {
      throw new Error('Notion AI: tempo esgotado aguardando a resposta do agente.');
    }
    await sleep(
      NOTION_POLL_MS,
      undefined,
      callOpts?.signal ? { signal: callOpts.signal } : {},
    );
    session = await notionJson(
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      apiKey,
      { method: 'GET' },
      callOpts?.signal,
    );
    status = asString(session['status']) ?? 'failed';
  }

  if (status === 'requires_action') {
    const actions = requiredActions(session);
    throw new Error(
      `Notion AI: o agente precisa de aprovação${actions ? ` (${actions})` : ''}. Aprove a ação no Notion e tente novamente.`,
    );
  }
  if (status !== 'completed') {
    const detail = sessionError(session);
    throw new Error(`Notion AI: sessão ${status}${detail ? ` - ${redactSecrets(detail)}` : ''}.`);
  }

  const events = await notionJson(
    `/v1/sessions/${encodeURIComponent(sessionId)}/events/query`,
    apiKey,
    {
      method: 'POST',
      body: {
        filter: { property: 'type', event_type: { equals: 'agent.message' } },
        page_size: NOTION_EVENT_PAGE_SIZE,
      },
    },
    callOpts?.signal,
  );
  const results = Array.isArray(events['results']) ? events['results'] : [];
  const answer = parseNotionAgentEvents(
    results.map(item => asRecord(item) as NotionEvent),
  );
  if (!answer.text) throw new Error('Notion AI: o agente concluiu sem retornar texto.');

  callOpts?.onToken?.(answer.text);

  const inputTokens = estimateTokens(`${context}\n\n${message}`);
  const outputTokens = estimateTokens(answer.text);
  return {
    text: answer.text,
    model: modelId,
    inputTokens,
    outputTokens,
    estimatedCostUsd: 0,
    fromCache: false,
  };
}
