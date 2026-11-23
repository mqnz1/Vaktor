// =============================================================
// Qronos AI - gateway OpenAI-compatible.
//
// Base: https://api.qronos.me/v1
// Auth: Authorization: Bearer qr_...
// Catálogo: GET /v1/models. Só entram modelos disponíveis no plano
// Free (`min_tier: "free"` e `available: true`), com custo zero.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const QRONOS_BASE_URL = 'https://api.qronos.me/v1';
const QRONOS_TIMEOUT_MS = 180_000;
const QRONOS_CATALOG_TIMEOUT_MS = 15_000;
const QRONOS_MAX_OUTPUT_TOKENS = 64_000;

function qronosModel(
  id: string,
  name: string,
  contextWindow: number,
  description: string,
): ModelInfo {
  return {
    id,
    name: `${name} (Qronos)`,
    provider: 'qronos',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow,
    status: 'available',
    tier: 'economy',
    description: `Grátis · ${description}`,
  };
}

/** Modelos disponíveis no plano Free em GET /v1/models. */
export const QRONOS_MODELS: ModelInfo[] = [
  qronosModel('claude-haiku-5.5', 'Claude Haiku 5.5', 1_000_000, 'rápido · reasoning · código'),
  qronosModel('glm-5.3-flash', 'GLM 5.3 Flash', 1_000_000, 'rápido · reasoning · código'),
  qronosModel('mercury-3', 'Mercury 3', 1_000_000, 'reasoning · código · contexto longo'),
];

export interface QronosModelDetails {
  id?: unknown;
  display_name?: unknown;
  description?: unknown;
  context_window?: unknown;
  min_tier?: unknown;
  available?: unknown;
  pricing?: {
    input_usd_per_million?: unknown;
    output_usd_per_million?: unknown;
  } | undefined;
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

function freeModel(details: QronosModelDetails): ModelInfo | null {
  const id = typeof details.id === 'string' ? details.id.trim() : '';
  if (!id) return null;
  if (details.available !== true) return null;
  if (details.min_tier !== 'free') return null;

  const label =
    typeof details.display_name === 'string' && details.display_name.trim().length > 0
      ? details.display_name.trim()
      : id;
  const description =
    typeof details.description === 'string' && details.description.trim().length > 0
      ? details.description.trim().slice(0, 160)
      : 'modelo free';
  const contextWindow = toNumber(details.context_window) || 1_000_000;

  return qronosModel(id, label, contextWindow, description);
}

/** Mantém apenas modelos do free tier, disponíveis e com custo zero. */
export function mapQronosCatalog(details: readonly QronosModelDetails[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const item of details) {
    const model = freeModel(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function applyQronosCatalog(details: readonly QronosModelDetails[]): number {
  const mapped = mapQronosCatalog(details);
  if (mapped.length === 0) return 0;
  QRONOS_MODELS.splice(0, QRONOS_MODELS.length, ...mapped);
  return mapped.length;
}

export function getQronosModelById(id: string): ModelInfo | undefined {
  return QRONOS_MODELS.find(model => model.id === id);
}

export function qronosDynamicEnabled(): boolean {
  return (process.env['QRONOS_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

export async function loadQronosCatalog(
  apiKey: string,
  timeoutMs = QRONOS_CATALOG_TIMEOUT_MS,
): Promise<number> {
  if (!apiKey || !qronosDynamicEnabled()) return 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(`${QRONOS_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      timeout,
    ]);
    if (!response || !response.ok) return 0;
    const data = asRecord(await response.json());
    const list = Array.isArray(data['data']) ? data['data'] : [];
    return applyQronosCatalog(list as QronosModelDetails[]);
  } catch {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendToQronos(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getQronosModelById(modelId);
  if (!modelInfo) {
    throw new Error(
      `Model ${modelId} não está no free tier da Qronos AI. Use /free ou /models.`,
    );
  }
  if (apiKey.trim().length === 0) {
    throw new Error('QRONOS_API_KEY não configurada no .env');
  }

  return sendOpenAiCompatible(
    messages,
    modelInfo,
    maxTokens,
    apiKey,
    thinking,
    temperature,
    callOpts,
    {
      baseUrl: QRONOS_BASE_URL,
      timeoutMs: QRONOS_TIMEOUT_MS,
      providerName: 'Qronos AI',
      auth: 'bearer',
      maxTokensCap: QRONOS_MAX_OUTPUT_TOKENS,
    },
  );
}
