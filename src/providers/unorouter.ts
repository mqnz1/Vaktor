// =============================================================
// UnoRouter - gateway OpenAI-compatible com modelos `:free`.
//
// Base: https://api.unorouter.com/v1
// Auth: Authorization: Bearer sk-...
// Catálogo: GET /v1/models. Só entram modelos `:free` de texto que
// responderam 200 na conta; modelos com consentimento pendente (403)
// ou sem provedor no momento (429) ficam fora.
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

/** Modelos free de texto verificados com chamada real na conta. */
const UNOROUTER_VERIFIED_FREE = new Set([
  'gemini-3-flash:free',
  'gemini-3.5-flash-lite:free',
  'mimo-v2.6-flash:free',
  'minimax-m3.1-flash:free',
]);

function unorouterModel(
  id: string,
  name: string,
  contextWindow: number,
  description: string,
): ModelInfo {
  return {
    id,
    name: `${name} (UnoRouter)`,
    provider: 'unorouter',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow,
    status: 'available',
    tier: 'economy',
    description: `Grátis · ${description}`,
  };
}

export const UNOROUTER_MODELS: ModelInfo[] = [
  unorouterModel(
    'gemini-3-flash:free',
    'Gemini 3 Flash',
    1_000_000,
    'visão · reasoning · 8K de saída',
  ),
  unorouterModel(
    'gemini-3.5-flash-lite:free',
    'Gemini 3.5 Flash Lite',
    1_000_000,
    'rápido · 64K de saída',
  ),
  unorouterModel(
    'mimo-v2.6-flash:free',
    'MiMo V2.6 Flash',
    1_000_000,
    'reasoning · código · 128K de saída',
  ),
  unorouterModel(
    'minimax-m3.1-flash:free',
    'MiniMax M3.1 Flash',
    1_000_000,
    'reasoning · 512K de saída',
  ),
];

export interface UnoRouterModelDetails {
  id?: unknown;
  context_length?: unknown;
  max_output_tokens?: unknown;
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

/** Mantém apenas os modelos free de texto verificados. */
export function mapUnoRouterCatalog(details: readonly UnoRouterModelDetails[]): ModelInfo[] {
  const out: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const item of details) {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || !id.endsWith(':free') || !UNOROUTER_VERIFIED_FREE.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const known = UNOROUTER_MODELS.find(model => model.id === id);
    if (!known) continue;
    const contextWindow = toNumber(item.context_length) || known.contextWindow;
    out.push({ ...known, contextWindow });
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
      `Model ${modelId} não está no free tier verificado da UnoRouter. Use unorouter::ID.`,
    );
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
        'UnoRouter: consentimento pendente para os provedores deste modelo. Autorize em unorouter.com/consents ou use outro modelo free.',
      );
    }
    if (/\b402\b|quota|balance/i.test(message)) {
      throw new Error('UnoRouter: cota/saldo insuficiente para este modelo. Use um modelo :free.');
    }
    if (/\b429\b|busy|rate limit/i.test(message)) {
      throw new Error('UnoRouter: todos os provedores deste modelo estão ocupados. Tente outro modelo free.');
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
