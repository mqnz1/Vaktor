// =============================================================
// UnoRouter - gateway OpenAI-compatible com modelos `:free`.
//
// Base: https://api.unorouter.com/v1
// Auth: Authorization: Bearer sk-...
// Catálogo: GET /v1/models. Entram todos os LLMs `:free` de texto;
// imagem, áudio, embedding, aihorde e typesafe-decisions ficam fora.
// Modelos com consentimento pendente (403) são marcados como limited.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const UNOROUTER_BASE_URL = 'https://api.unorouter.com/v1';
const UNOROUTER_TIMEOUT_MS = 180_000;
const UNOROUTER_CATALOG_TIMEOUT_MS = 15_000;
const UNOROUTER_MAX_OUTPUT_TOKENS = 131_072;
const UNOROUTER_DEFAULT_CONTEXT = 131_072;

/** Endpoints que não geram texto de chat. */
const UNOROUTER_NON_TEXT_ENDPOINTS = new Set([
  'aihorde',
  'embedding',
  'image-generation',
  'typesafe-decisions',
]);

/** Endpoints de texto aceitos pelo gateway. */
const UNOROUTER_TEXT_ENDPOINTS = new Set([
  'openai',
  'anthropic',
  'gemini',
  'openai-response',
]);

/**
 * Modelos que retornaram 403 consent_required na auditoria. Continuam
 * no catálogo (o usuário pode autorizar), mas ficam como `limited`.
 */
export const UNOROUTER_CONSENT_REQUIRED = new Set([
  'deepseek-v4-flash:free',
  'deepseek-v4.1-flash-1017:free',
  'deepseek-v4.1-flash:free',
  'glm-5.3-flash:free',
  'mistral-small:free',
  'nemotron-3.5-lightning-30b-a3b:free',
  'mindshub-air:free',
  'glyph-cluster:free',
]);

/** Modelos free de texto que responderam 200 e são seguros para fallback. */
export const UNOROUTER_VERIFIED_FALLBACK = [
  'gemini-3.5-flash-lite:free',
  'k-exaone-2.5:free',
] as const;

interface UnoRouterModelSpec {
  id: string;
  name: string;
  contextWindow: number;
  description: string;
  status: ModelInfo['status'];
}

function unorouterModel(spec: UnoRouterModelSpec): ModelInfo {
  return {
    id: spec.id,
    name: `${spec.name} (UnoRouter)`,
    provider: 'unorouter',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: spec.contextWindow,
    status: spec.status,
    tier: 'economy',
    description: spec.description,
  };
}

/** Catálogo estático mínimo; o loader dinâmico adiciona todos os LLMs :free. */
export const UNOROUTER_MODELS: ModelInfo[] = [
  unorouterModel({
    id: 'gemini-3.5-flash-lite:free',
    name: 'Gemini 3.5 Flash Lite',
    contextWindow: 1_000_000,
    status: 'available',
    description: 'Grátis · rápido · 1M de contexto',
  }),
  unorouterModel({
    id: 'k-exaone-2.5:free',
    name: 'K ExaOne 2.5',
    contextWindow: 131_072,
    status: 'available',
    description: 'Grátis · texto · resposta verificada',
  }),
  unorouterModel({
    id: 'minimax-m3.1-flash:free',
    name: 'MiniMax M3.1 Flash',
    contextWindow: 1_000_000,
    status: 'available',
    description: 'Grátis · reasoning · pode exigir max_tokens maior',
  }),
  unorouterModel({
    id: 'deepseek-v4.1-flash:free',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1_000_000,
    status: 'limited',
    description: 'Grátis · consentimento pendente em unorouter.com/consents',
  }),
  unorouterModel({
    id: 'glm-5.3-flash:free',
    name: 'GLM 5.3 Flash',
    contextWindow: 1_000_000,
    status: 'limited',
    description: 'Grátis · consentimento pendente em unorouter.com/consents',
  }),
  unorouterModel({
    id: 'nemotron-3.5-lightning-30b-a3b:free',
    name: 'Nemotron 3.5 Lightning',
    contextWindow: 262_144,
    status: 'limited',
    description: 'Grátis · consentimento pendente em unorouter.com/consents',
  }),
  unorouterModel({
    id: 'mindshub-air:free',
    name: 'Mindshub Air',
    contextWindow: 1_050_000,
    status: 'limited',
    description: 'Grátis · consentimento pendente em unorouter.com/consents',
  }),
  unorouterModel({
    id: 'glyph-cluster:free',
    name: 'Glyph Cluster',
    contextWindow: 131_072,
    status: 'limited',
    description: 'Grátis · consentimento pendente em unorouter.com/consents',
  }),
];

export interface UnoRouterModelDetails {
  id?: unknown;
  context_length?: unknown;
  max_output_tokens?: unknown;
  supported_endpoint_types?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function endpointTypesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

/** Retorna true apenas para modelos de texto de chat. */
export function isUnoRouterTextModel(id: string, endpointTypes: readonly string[]): boolean {
  if (/^whisper/i.test(id)) return false;
  if (endpointTypes.length === 0) return true;
  if (endpointTypes.some(type => UNOROUTER_NON_TEXT_ENDPOINTS.has(type))) return false;
  return endpointTypes.some(type => UNOROUTER_TEXT_ENDPOINTS.has(type));
}

/** Mapeia todos os LLMs `:free` de texto, ignorando modalidades não-texto. */
export function mapUnoRouterCatalog(details: readonly UnoRouterModelDetails[]): ModelInfo[] {
  const out: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const item of details) {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || !id.endsWith(':free')) continue;
    const endpointTypes = endpointTypesOf(item.supported_endpoint_types);
    if (!isUnoRouterTextModel(id, endpointTypes)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const known = UNOROUTER_MODELS.find(model => model.id === id);
    const contextWindow =
      toNumber(item.context_length) || known?.contextWindow || UNOROUTER_DEFAULT_CONTEXT;
    const status = UNOROUTER_CONSENT_REQUIRED.has(id)
      ? 'limited'
      : known?.status === 'limited'
        ? 'limited'
        : 'available';

    out.push({
      id,
      name: known?.name ?? `${id.replace(/:free$/i, '')} (UnoRouter)`,
      provider: 'unorouter',
      costPer1kTokensInput: 0,
      costPer1kTokensOutput: 0,
      contextWindow,
      status,
      tier: 'economy',
      description: known?.description ?? 'Grátis · texto · catálogo dinâmico',
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function applyUnoRouterCatalog(details: readonly UnoRouterModelDetails[]): number {
  const mapped = mapUnoRouterCatalog(details);
  if (mapped.length === 0) return 0;
  UNOROUTER_MODELS.splice(0, UNOROUTER_MODELS.length, ...mapped);
  return mapped.length;
}

export function getUnoRouterModelById(id: string): ModelInfo | undefined {
  return UNOROUTER_MODELS.find(model => model.id === id);
}

export function unorouterDynamicEnabled(): boolean {
  return (process.env['UNOROUTER_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

export async function loadUnoRouterCatalog(
  apiKey: string,
  timeoutMs = UNOROUTER_CATALOG_TIMEOUT_MS,
): Promise<number> {
  if (!apiKey || !unorouterDynamicEnabled()) return 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(`${UNOROUTER_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      timeout,
    ]);
    if (!response || !response.ok) return 0;
    const data = asRecord(await response.json());
    const list = Array.isArray(data['data']) ? data['data'] : [];
    return applyUnoRouterCatalog(list as UnoRouterModelDetails[]);
  } catch {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendToUnoRouter(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getUnoRouterModelById(modelId);
  if (!modelInfo) {
    throw new Error(
      `Model ${modelId} não está no catálogo de texto da UnoRouter. Use unorouter::ID.`,
    );
  }
  if (modelInfo.status === 'unavailable') {
    throw new Error(`UnoRouter: ${modelId} está indisponível no momento.`);
  }
  if (apiKey.trim().length === 0) {
    throw new Error('UNOROUTER_API_KEY não configurada no .env');
  }

  let response: RouterResponse;
  try {
    response = await sendOpenAiCompatible(
      messages,
      modelInfo,
      maxTokens,
      apiKey,
      thinking,
      temperature,
      callOpts,
      {
        baseUrl: UNOROUTER_BASE_URL,
        timeoutMs: UNOROUTER_TIMEOUT_MS,
        providerName: 'UnoRouter',
        auth: 'bearer',
        maxTokensCap: UNOROUTER_MAX_OUTPUT_TOKENS,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\b403\b|consent/i.test(message)) {
      throw new Error(
        'UnoRouter: consentimento pendente para os provedores deste modelo. ' +
          'Autorize em unorouter.com/consents ou use outro modelo free.',
      );
    }
    if (/\b402\b|quota|balance/i.test(message)) {
      throw new Error('UnoRouter: cota/saldo insuficiente para este modelo. Use um modelo :free.');
    }
    if (/\b429\b|busy|rate limit/i.test(message)) {
      throw new Error(
        'UnoRouter: todos os provedores deste modelo estão ocupados. Tente outro modelo free.',
      );
    }
    throw error;
  }

  if (response.text.trim().length === 0) {
    throw new Error(
      'UnoRouter: resposta vazia. Aumente max_tokens ou escolha outro modelo free.',
    );
  }
  return response;
}
