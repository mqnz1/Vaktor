import { randomUUID } from 'node:crypto';
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { browserNotionCookieAutoEnabled, readBrowserNotionCookie } from './notionCookie.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

export const NOTION_WEB_BASE_URL = 'https://www.notion.so';
export const NOTION_WEB_TIMEOUT_MS = 180_000;
export const NOTION_WEB_CATALOG_TIMEOUT_MS = 15_000;
const NOTION_WEB_TRANSIENT_RETRIES = 2;
export const NOTION_WEB_DEFAULT_CLIENT_VERSION = '23.13.20260313.1423';
export const NOTION_WEB_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const NOTION_WEB_CONTEXT_WINDOW = 200_000;

interface NotionWebModelDefinition {
  id: string;
  name: string;
  family: string;
}

const NOTION_WEB_MODEL_DEFINITIONS: readonly NotionWebModelDefinition[] = [
  { id: 'ambrosia-tart-high', name: 'Opus 4.8', family: 'Anthropic' },
  { id: 'apricot-sorbet-high', name: 'Opus 4.7', family: 'Anthropic' },
  { id: 'avocado-froyo-medium', name: 'Opus 4.6', family: 'Anthropic' },
  { id: 'almond-croissant-low', name: 'Sonnet 4.6', family: 'Anthropic' },
  { id: 'anthropic-haiku-4.5', name: 'Haiku 4.5', family: 'Anthropic' },
  { id: 'opal-quince-medium', name: 'GPT-5.5', family: 'OpenAI' },
  { id: 'oval-kumquat-medium', name: 'GPT-5.4', family: 'OpenAI' },
  { id: 'oregon-grape-medium', name: 'GPT-5.4 Mini', family: 'OpenAI' },
  { id: 'otaheite-apple-medium', name: 'GPT-5.4 Nano', family: 'OpenAI' },
  { id: 'oatmeal-cookie', name: 'GPT-5.2', family: 'OpenAI' },
  { id: 'galette-medium-thinking', name: 'Gemini 3.1 Pro', family: 'Google' },
  { id: 'xigua-mochi-medium', name: 'Grok 4.3', family: 'xAI' },
  { id: 'xinomavro-cake', name: 'Grok Build 0.1', family: 'xAI' },
  { id: 'baseten-deepseek-v4-pro', name: 'DeepSeek V4 Pro', family: 'DeepSeek' },
  { id: 'fireworks-kimi-k2.6', name: 'Kimi K2.6', family: 'Moonshot' },
  { id: 'fireworks-minimax-m2.5', name: 'MiniMax M2.5', family: 'MiniMax' },
];

function webModelInfo(definition: NotionWebModelDefinition): ModelInfo {
  return {
    id: definition.id,
    name: `${definition.name} (${definition.family})`,
    provider: 'notion_web',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: NOTION_WEB_CONTEXT_WINDOW,
    status: 'available',
    tier: 'standard',
    description: `Notion AI via sessão web — ${definition.family}`,
  };
}

export const NOTION_WEB_MODELS: ModelInfo[] = NOTION_WEB_MODEL_DEFINITIONS.map(webModelInfo);

export interface NotionWebCredentials {
  cookie: string;
  spaceId: string;
  userId: string;
  baseUrl: string;
  clientVersion: string;
}

export interface NotionWebTranscriptItem {
  id?: string;
  type: 'config' | 'context' | 'user' | 'markdown-chat' | 'agent-inference';
  value: unknown;
  userId?: string;
  createdAt?: string;
}

export interface NotionWebStreamEvent {
  type?: unknown;
  value?: unknown;
  data?: unknown;
  message?: unknown;
  threadId?: unknown;
  recordMap?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asRawString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function cookieValue(cookie: string, name: string): string {
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}

function normalizeCookie(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/(?:^|;\s*)token_v2=/.test(trimmed)) return trimmed;
  return `token_v2=${trimmed}`;
}

function buildNotionWebCredentials(
  cookie: string,
  suggestedBaseUrl?: string,
): NotionWebCredentials {
  const configuredBase = (process.env['NOTION_WEB_BASE_URL'] ?? '').trim();
  const baseUrl = (configuredBase || suggestedBaseUrl || NOTION_WEB_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const cookieUserId = cookieValue(cookie, 'notion_user_id');
  return {
    cookie,
    spaceId: (process.env['NOTION_SPACE_ID'] ?? '').trim(),
    userId: (process.env['NOTION_USER_ID'] ?? cookieUserId).trim(),
    baseUrl: baseUrl || NOTION_WEB_BASE_URL,
    clientVersion:
      (process.env['NOTION_CLIENT_VERSION'] ?? '').trim() || NOTION_WEB_DEFAULT_CLIENT_VERSION,
  };
}

export function notionWebCredentials(): NotionWebCredentials | null {
  const rawCookie = (process.env['NOTION_COOKIE'] ?? '').trim();
  const rawToken = (process.env['NOTION_TOKEN_V2'] ?? '').trim();
  const cookie = normalizeCookie(rawCookie || rawToken);
  if (!cookie) return null;
  return buildNotionWebCredentials(cookie);
}

function notionWebCredentialsFromBrowser(): NotionWebCredentials | null {
  const found = readBrowserNotionCookie();
  if (!found) return null;
  const suggestedBaseUrl = found.hostKey.toLowerCase().includes('notion.com')
    ? 'https://app.notion.com'
    : undefined;
  return buildNotionWebCredentials(found.cookie, suggestedBaseUrl);
}

export function notionWebEnabled(): boolean {
  return (
    notionWebCredentials() !== null ||
    (process.platform === 'win32' && browserNotionCookieAutoEnabled())
  );
}

function notionWebHeaders(
  credentials: NotionWebCredentials,
  accept: string,
): Record<string, string> {
  const origin = new URL(credentials.baseUrl).origin;
  const userAgent = process.env['NOTION_USER_AGENT']?.trim() || NOTION_WEB_DEFAULT_USER_AGENT;
  const chromeMajor = /Chrome\/(\d+)/i.exec(userAgent)?.[1] ?? '146';
  const headers: Record<string, string> = {
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    Cookie: credentials.cookie,
    'notion-client-version': credentials.clientVersion,
    'x-notion-client-version': credentials.clientVersion,
    'notion-audit-log-platform': 'web',
    Origin: origin,
    Referer: `${origin}/chat`,
    'User-Agent': userAgent,
    'sec-ch-ua': `"Not;A=Brand";v="8", "Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    priority: 'u=1, i',
  };
  if (credentials.spaceId) headers['x-notion-space-id'] = credentials.spaceId;
  if (credentials.userId) headers['x-notion-active-user-header'] = credentials.userId;
  return headers;
}

function redactNotionWebSecrets(text: string, credentials: NotionWebCredentials): string {
  let redacted = redactSecrets(text);
  if (credentials.cookie) redacted = redacted.split(credentials.cookie).join('***');
  const token = cookieValue(credentials.cookie, 'token_v2');
  if (token) redacted = redacted.split(token).join('***');
  redacted = redacted.replace(/(token_v2=)[^;\s]+/gi, '$1***');
  return redacted;
}

function notionWebError(
  status: number,
  raw: string,
  credentials: NotionWebCredentials,
  modelId?: string,
): Error {
  let detail = raw;
  try {
    const parsed = asRecord(JSON.parse(raw) as unknown);
    const message = asString(parsed['message']);
    const debug = asString(parsed['debugMessage']);
    const combined =
      message && debug && message !== debug ? `${message} (${debug})` : (message ?? debug);
    detail =
      combined ??
      asString(parsed['error']) ??
      asString(parsed['name']) ??
      raw;
  } catch {
    detail = raw;
  }
  const clean = redactNotionWebSecrets(detail, credentials)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  const hint =
    status === 401 || status === 403
      ? ' Atualize NOTION_COOKIE com o cookie completo do Edge (token_v2, notion_user_id, notion_browser_id, device_id, __Host-session_binding); NOTION_SPACE_ID é opcional.'
      : status === 429
        ? ' Limite de uso do Notion AI atingido.'
        : status === 400
          ? ` Requisição recusada${modelId ? ` para o modelo "${modelId}"` : ''}; verifique se ele está disponível no seu workspace/plano.`
          : /cloudflare|just a moment|challenge/i.test(raw)
            ? ' O Notion bloqueou a requisição; tente atualizar o cookie ou usar NOTION_WEB_BASE_URL=https://app.notion.com.'
            : '';
  const detailSuffix = clean.length > 0 && !/[.!?]$/.test(clean) ? '.' : '';
  const detailText = clean ? ` - ${clean}${detailSuffix}` : '.';
  return new Error(`Notion AI Web (${status})${detailText}${hint}`);
}

async function notionWebJson(
  path: string,
  credentials: NotionWebCredentials,
  init: { method: string; body?: unknown },
  signal?: AbortSignal,
  timeoutMs = NOTION_WEB_CATALOG_TIMEOUT_MS,
): Promise<unknown> {
  const response = await fetch(`${credentials.baseUrl}${path}`, {
    method: init.method,
    headers: notionWebHeaders(credentials, 'application/json'),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: withTimeout(timeoutMs, signal),
  });
  const raw = await response.text();
  if (!response.ok) throw notionWebError(response.status, raw, credentials);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Notion AI Web: a API não retornou JSON válido.');
  }
}

function resolveNotionWebIdentity(
  payload: unknown,
  preferredSpaceId: string,
): { spaceId: string; userId: string } {
  const root = asRecord(payload);
  const groups = asRecord(root['recordMap'] ?? root);
  let userId = '';
  let spaceId = '';

  for (const [key, rawGroup] of Object.entries(groups)) {
    const group = asRecord(rawGroup);
    const users = asRecord(group['notion_user']);
    const spaces = asRecord(group['space']);
    if (!userId && (users[key] !== undefined || Object.keys(users).length === 1)) {
      userId = key;
    }
    const spaceIds = Object.keys(spaces);
    if (!spaceId && preferredSpaceId && spaces[preferredSpaceId] !== undefined) {
      spaceId = preferredSpaceId;
    }
    if (!spaceId && spaceIds.length > 0) spaceId = spaceIds[0] as string;
  }

  return { spaceId, userId };
}

export async function resolveNotionWebCredentials(
  credentials = notionWebCredentials(),
  signal?: AbortSignal,
): Promise<NotionWebCredentials | null> {
  const initial = credentials ?? notionWebCredentials() ?? notionWebCredentialsFromBrowser();
  if (!initial) return null;
  if (initial.spaceId && initial.userId) return initial;

  try {
    const payload = await notionWebJson(
      '/api/v3/getSpaces',
      initial,
      { method: 'POST', body: {} },
      signal,
      10_000,
    );
    const resolved = resolveNotionWebIdentity(payload, initial.spaceId);
    return {
      ...initial,
      spaceId: initial.spaceId || resolved.spaceId,
      userId: initial.userId || resolved.userId,
    };
  } catch {
    return initial;
  }
}

function looksLikeModel(item: unknown): boolean {
  const record = asRecord(item);
  return (
    asString(record['id']) !== undefined ||
    asString(record['model']) !== undefined ||
    asString(record['value']) !== undefined
  );
}

export function mapNotionWebModels(payload: unknown): ModelInfo[] {
  const root = asRecord(payload);
  let candidates: unknown[] = Array.isArray(payload)
    ? payload
    : [root['models'], root['results'], root['availableModels'], root['data']].find(Array.isArray) ?? [];

  if (candidates.length === 0) {
    const maps = [root['models'], root['results'], root['availableModels'], root['data'], root];
    const map = maps.find(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        Object.values(asRecord(item)).some(
          (value) =>
            looksLikeModel(value) ||
            (value !== null && typeof value === 'object' && !Array.isArray(value)),
        ),
    );
    if (map !== undefined) {
      candidates = Object.entries(asRecord(map)).map(([id, item]) => ({
        id,
        ...asRecord(item),
      }));
    }
  }

  const seen = new Set<string>();
  const out: ModelInfo[] = [];

  for (const item of candidates) {
    if (!looksLikeModel(item)) continue;
    const record = asRecord(item);
    if (record['available'] === false || record['disabled'] === true) continue;
    const id = asString(record['id']) ?? asString(record['model']) ?? asString(record['value']);
    if (!id || seen.has(id)) continue;
    const name =
      asString(record['name']) ??
      asString(record['displayName']) ??
      asString(record['label']) ??
      asString(record['title']) ??
      asString(record['modelMessage']) ??
      id;
    const family =
      asString(record['family']) ??
      asString(record['provider']) ??
      asString(record['vendor']) ??
      asString(record['modelFamily']) ??
      'Notion AI';
    seen.add(id);
    out.push(webModelInfo({ id, name, family }));
  }

  return out;
}

export async function loadNotionWebCatalog(
  credentials = notionWebCredentials(),
  timeoutMs = NOTION_WEB_CATALOG_TIMEOUT_MS,
): Promise<number> {
  const resolved = await resolveNotionWebCredentials(credentials);
  if (!resolved?.spaceId) return 0;
  try {
    const payload = await notionWebJson(
      '/api/v3/getAvailableModels',
      resolved,
      { method: 'POST', body: { spaceId: resolved.spaceId } },
      undefined,
      timeoutMs,
    );
    const models = mapNotionWebModels(payload);
    if (models.length === 0) return 0;
    NOTION_WEB_MODELS.splice(0, NOTION_WEB_MODELS.length, ...models);
    return models.length;
  } catch {
    return 0;
  }
}

export function buildNotionWebTranscript(
  messages: readonly ChatMessage[],
  modelId: string,
  credentials?: NotionWebCredentials,
): NotionWebTranscriptItem[] {
  const now = new Date().toISOString();
  const transcript: NotionWebTranscriptItem[] = [
    {
      id: randomUUID(),
      type: 'config',
      value: {
        type: 'markdown-chat',
        model: modelId,
        modelFromUser: true,
        useWebSearch: true,
        searchScopes: [{ type: 'everything' }],
        isCustomAgent: false,
      },
    },
  ];
  if (credentials?.spaceId) {
    transcript.push({
      id: randomUUID(),
      type: 'context',
      value: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        userId: credentials.userId,
        spaceId: credentials.spaceId,
        currentDatetime: now,
        surface: 'ai_module',
      },
    });
  }
  let hasUser = false;

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    if (message.role === 'assistant') {
      transcript.push({
        id: randomUUID(),
        type: 'agent-inference',
        value: [{ type: 'text', content }],
      });
      continue;
    }
    if (message.role === 'user') hasUser = true;
    transcript.push({
      id: randomUUID(),
      type: 'user',
      value: [[message.role === 'system' ? `Instruções do sistema:\n${content}` : content]],
      ...(credentials?.userId ? { userId: credentials.userId } : {}),
      createdAt: now,
    });
  }

  if (!hasUser) throw new Error('Notion AI Web: nenhuma mensagem do usuário para enviar.');
  return transcript;
}

export function buildNotionWebBody(
  messages: readonly ChatMessage[],
  modelId: string,
  credentials: NotionWebCredentials,
): Record<string, unknown> {
  const threadId = randomUUID();
  const body: Record<string, unknown> = {
    traceId: randomUUID(),
    spaceId: credentials.spaceId,
    transcript: buildNotionWebTranscript(messages, modelId, credentials),
    threadId,
    createThread: true,
    isPartialTranscript: false,
    generateTitle: false,
    saveAllThreadOperations: false,
    setUnreadState: false,
    threadType: 'markdown-chat',
    hasHeartbeat: false,
    createdSource: 'ai_module',
    isUserInAnySalesAssistedSpace: false,
    isSpaceSalesAssisted: false,
    threadParentPointer: {
      table: 'space',
      id: credentials.spaceId,
      spaceId: credentials.spaceId,
    },
    debugOverrides: {
      emitAgentSearchExtractedResults: true,
      cachedInferences: {},
      annotationInferences: {},
      emitInferences: false,
    },
  };

  const workflowId = (process.env['NOTION_WEB_WORKFLOW_ID'] ?? '').trim();
  if (workflowId) {
    body['workflowId'] = workflowId;
    body['useDraft'] = (process.env['NOTION_WEB_USE_DRAFT'] ?? 'false').toLowerCase() === 'true';
  }
  const contextPageId = (process.env['NOTION_WEB_CONTEXT_PAGE_ID'] ?? '').trim();
  if (contextPageId) body['context_page_id'] = contextPageId;
  return body;
}

function eventText(value: unknown): string {
  const direct = asRawString(value);
  if (direct !== undefined) return direct;
  if (!Array.isArray(value)) return '';
  const parts: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const text = asRawString(record['text']) ?? asRawString(record['content']);
    if (text) parts.push(text);
  }
  return parts.join('');
}

export function parseNotionWebEvent(event: NotionWebStreamEvent): {
  text: string;
  error?: string;
} {
  const type = asString(event.type);
  if (type === 'error') {
    const value = asRecord(event.value);
    return {
      text: '',
      error:
        asString(event.message) ??
        asString(value['message']) ??
        asString(value['error']) ??
        asString(event.value) ??
        'erro desconhecido',
    };
  }
  if (type === 'markdown-chat' || type === 'agent.message' || type === 'text') {
    return { text: eventText(event.value) };
  }
  if (type === 'patch-start' || type === 'patch') {
    const data = asRecord(event.data ?? event.value);
    const operations = Array.isArray(data['s']) ? data['s'] : [];
    for (const operation of operations) {
      const record = asRecord(operation);
      if (record['type'] !== 'error') continue;
      return {
        text: '',
        error:
          asString(record['message']) ??
          asString(record['error']) ??
          asString(record['subType']) ??
          'erro desconhecido',
      };
    }
  }
  return { text: '' };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function readNotionWebResponse(
  response: Response,
  credentials: NotionWebCredentials,
  onToken?: (chunk: string) => void,
): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json') && !contentType.includes('ndjson')) {
    const raw = await response.text();
    if (!raw.trim()) return '';
    const parsed = asRecord(JSON.parse(raw) as unknown);
    const direct = eventText(parsed['value']);
    if (direct) {
      onToken?.(direct);
      return direct;
    }
    return '';
  }

  let text = '';
  let error = '';
  let buffer = '';
  const consume = (line: string) => {
    const trimmed = line.replace(/^data:\s*/, '').trim();
    if (!trimmed || trimmed === '[DONE]' || !trimmed.startsWith('{')) return;
    let parsed: NotionWebStreamEvent;
    try {
      parsed = JSON.parse(trimmed) as NotionWebStreamEvent;
    } catch {
      return;
    }
    const result = parseNotionWebEvent(parsed);
    if (result.error) error = result.error;
    if (result.text) {
      text += result.text;
      onToken?.(result.text);
    }
  };
  const consumeBuffer = (flush = false) => {
    const lines = buffer.split(/\r?\n/);
    if (flush) {
      buffer = '';
      for (const line of lines) consume(line);
      return;
    }
    buffer = lines.pop() ?? '';
    for (const line of lines) consume(line);
  };

  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeBuffer();
    }
    buffer += decoder.decode();
    consumeBuffer(true);
  } else {
    buffer = await response.text();
    consumeBuffer(true);
  }

  if (error) throw new Error(`Notion AI Web: ${redactNotionWebSecrets(error, credentials)}`);
  return text;
}

export async function sendToNotionWeb(
  messages: ChatMessage[],
  modelId: string,
  _maxTokens: number,
  _thinking: ThinkingArg = false,
  _temperature?: number,
  callOpts?: ProviderCallOpts,
  credentialsOverride?: NotionWebCredentials,
): Promise<RouterResponse> {
  const credentials = await resolveNotionWebCredentials(
    credentialsOverride ?? notionWebCredentials(),
    callOpts?.signal,
  );
  if (!credentials) {
    throw new Error(
      'Notion AI Web: não encontrei cookie. Edge/Chrome recentes usam v20 (bloqueado por app-bound encryption); entre no Notion pelo Firefox ou configure NOTION_COOKIE/NOTION_TOKEN_V2.',
    );
  }
  if (!credentials.spaceId) {
    throw new Error(
      'Notion AI Web: NOTION_SPACE_ID não configurado e não foi possível descobrir o workspace pelo getSpaces.',
    );
  }

  let body: Record<string, unknown> = {};
  let response: Response | null = null;
  for (let attempt = 0; attempt <= NOTION_WEB_TRANSIENT_RETRIES; attempt++) {
    body = buildNotionWebBody(messages, modelId.trim(), credentials);
    response = await fetch(`${credentials.baseUrl}/api/v3/runInferenceTranscript`, {
      method: 'POST',
      headers: notionWebHeaders(credentials, 'application/x-ndjson'),
      body: JSON.stringify(body),
      signal: withTimeout(NOTION_WEB_TIMEOUT_MS, callOpts?.signal),
    });
    if (response.ok) break;

    const raw = await response.text().catch(() => '');
    const transient =
      response.status >= 500 ||
      (response.status === 400 && /ValidationError/i.test(raw) && /Invalid input/i.test(raw));
    if (!transient || attempt === NOTION_WEB_TRANSIENT_RETRIES) {
      throw notionWebError(response.status, raw, credentials, modelId);
    }
    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  if (!response) throw new Error('Notion AI Web: a requisição não foi enviada.');

  const text = await readNotionWebResponse(response, credentials, callOpts?.onToken);
  if (!text.trim()) {
    throw new Error(
      `Notion AI Web: o Notion aceitou a requisição mas não transmitiu texto (modelo "${modelId}"). Use o cookie completo do Edge (token_v2, notion_user_id, notion_browser_id, device_id, __Host-session_binding), não só o token_v2.`,
    );
  }

  const transcriptText = JSON.stringify(body['transcript']);
  return {
    text,
    model: modelId,
    inputTokens: estimateTokens(transcriptText),
    outputTokens: estimateTokens(text),
    estimatedCostUsd: 0,
    fromCache: false,
  };
}
