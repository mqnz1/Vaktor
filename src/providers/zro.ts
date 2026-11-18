// =============================================================
// Zro - inferência privada para agentes de código.
//
// Base: https://zro.moonmath.ai/v1
// Auth: Authorization: Bearer sk-...
// Catálogo: GET /v1/models. A conta free cobre os modelos Flash
// (DeepSeek V4 Flash e V4.1 Flash) com uso diário gratuito.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const ZRO_BASE_URL = 'https://zro.moonmath.ai/v1';
const ZRO_TIMEOUT_MS = 180_000;
const ZRO_CATALOG_TIMEOUT_MS = 15_000;
const ZRO_MAX_OUTPUT_TOKENS = 64_000;

function zroModel(
  id: string,
  name: string,
  contextWindow: number,
  description: string,
): ModelInfo {
  return {
    id,
    name: `${name} (Zro)`,
    provider: 'zro',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow,
    status: 'available',
    tier: 'economy',
    description: `Free diário · ${description}`,
  };
}

/** Modelos Flash verificados com chamada real na conta. */
export const ZRO_MODELS: ModelInfo[] = [
  zroModel(
    'deepseek-v4.1-flash',
    'DeepSeek V4.1 Flash',
    1_000_000,
    'reasoning · código · 64K de saída',
  ),
  zroModel(
    'deepseek-v4-flash-0731',
    'DeepSeek V4 Flash 0731',
    1_048_576,
    'código · 64K de saída',
  ),
];

export interface ZroModelDetails {
  id?: unknown;
  mode?: unknown;
  max_input_tokens?: unknown;
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

/** Normaliza aliases `zro/ID` e remove duplicatas do catálogo. */
export function mapZroCatalog(details: readonly ZroModelDetails[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];

  for (const item of details) {
    const rawId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!rawId) continue;
    if (typeof item.mode === 'string' && item.mode !== 'chat') continue;

    const id = rawId.replace(/^zro\//i, '');
    if (seen.has(id)) continue;
    seen.add(id);

    const known = ZRO_MODELS.find(model => model.id === id);
    if (known) {
      out.push(known);
      continue;
    }

    out.push(
      zroModel(
        id,
        id,
        toNumber(item.max_input_tokens) || 1_000_000,
        'modelo disponível na sua conta',
      ),
    );
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function applyZroCatalog(details: readonly ZroModelDetails[]): number {
  const mapped = mapZroCatalog(details);
  if (mapped.length === 0) return 0;
  ZRO_MODELS.splice(0, ZRO_MODELS.length, ...mapped);
  return mapped.length;
}

export function getZroModelById(id: string): ModelInfo | undefined {
  return ZRO_MODELS.find(model => model.id === id);
}

export function zroDynamicEnabled(): boolean {
  return (process.env['ZRO_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

export async function loadZroCatalog(
  apiKey: string,
  timeoutMs = ZRO_CATALOG_TIMEOUT_MS,
): Promise<number> {
  if (!apiKey || !zroDynamicEnabled()) return 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(`${ZRO_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      timeout,
    ]);
    if (!response || !response.ok) return 0;
    const data = asRecord(await response.json());
    const list = Array.isArray(data['data']) ? data['data'] : [];
    return applyZroCatalog(list as ZroModelDetails[]);
  } catch {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendToZro(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getZroModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} não está no catálogo da Zro. Use zro::ID.`);
  }
  if (apiKey.trim().length === 0) {
    throw new Error('ZRO_API_KEY não configurada no .env');
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
        baseUrl: ZRO_BASE_URL,
        timeoutMs: ZRO_TIMEOUT_MS,
        providerName: 'Zro',
        auth: 'bearer',
        maxTokensCap: ZRO_MAX_OUTPUT_TOKENS,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\b402\b|quota|spend|budget/i.test(message)) {
      throw new Error('Zro: cota diária free esgotada. Tente novamente mais tarde.');
    }
    if (/\b403\b|forbidden|permission/i.test(message)) {
      throw new Error('Zro: a chave não tem permissão para este modelo.');
    }
    throw error;
  }

  if (response.text.trim().length === 0) {
    throw new Error('Zro: resposta vazia. Confira se o modelo está ativo na conta.');
  }
  return response;
}
