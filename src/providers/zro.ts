// =============================================================
// Zro - inferência privada para agentes de código.
//
// Base: https://zro.moonmath.ai/v1
// Auth: Authorization: Bearer sk-...
// Catálogo: GET /v1/models. O catálogo estático contém os quatro
// modelos oficiais; o loader dinâmico faz união com a resposta da
// conta para não remover modelos que a chave ainda não acessa.
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

interface ZroModelSpec {
  id: string;
  name: string;
  contextWindow: number;
  description: string;
  costPer1kTokensInput: number;
  costPer1kTokensOutput: number;
  status: ModelInfo['status'];
  tier: ModelInfo['tier'];
}

function zroModel(spec: ZroModelSpec): ModelInfo {
  return {
    id: spec.id,
    name: `${spec.name} (Zro)`,
    provider: 'zro',
    costPer1kTokensInput: spec.costPer1kTokensInput,
    costPer1kTokensOutput: spec.costPer1kTokensOutput,
    contextWindow: spec.contextWindow,
    status: spec.status,
    tier: spec.tier,
    description: spec.description,
  };
}

/**
 * Modelos oficiais da Zro. Apenas DeepSeek V4.1 Flash respondeu 200
 * na chave atual; GLM, Dolly e Abyss retornaram 403 (plano sem acesso)
 * e por isso ficam como `unavailable` até a conta liberar.
 */
export const ZRO_MODELS: ModelInfo[] = [
  zroModel({
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1_000_000,
    costPer1kTokensInput: 0.0003,
    costPer1kTokensOutput: 0.0011,
    status: 'available',
    tier: 'economy',
    description: 'reasoning + código; US$ 0.30/US$ 1.10 por 1M tokens',
  }),
  zroModel({
    id: 'glm-5.3',
    name: 'GLM 5.3',
    contextWindow: 1_000_000,
    costPer1kTokensInput: 0.0014,
    costPer1kTokensOutput: 0.0042,
    status: 'unavailable',
    tier: 'standard',
    description: 'requer plano com acesso; 403 na chave atual',
  }),
  zroModel({
    id: 'dolly2-security',
    name: 'Dolly 2 Security',
    contextWindow: 1_000_000,
    costPer1kTokensInput: 0.0021,
    costPer1kTokensOutput: 0.0063,
    status: 'unavailable',
    tier: 'premium',
    description: 'segurança/revisão; requer plano com acesso',
  }),
  zroModel({
    id: 'abyss1',
    name: 'Abyss 1',
    contextWindow: 1_000_000,
    costPer1kTokensInput: 0.0003,
    costPer1kTokensOutput: 0.0011,
    status: 'unavailable',
    tier: 'economy',
    description: 'requer plano com acesso; 403 na chave atual',
  }),
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

/** Normaliza aliases `zro/ID`, remove duplicatas e marca modelos listados como disponíveis. */
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
    if (!known) continue;
    out.push({ ...known, status: 'available' });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Faz união do catálogo estático com o dinâmico. Modelos oficiais que
 * não aparecem em `/v1/models` continuam listados como indisponíveis.
 */
export function applyZroCatalog(details: readonly ZroModelDetails[]): number {
  const mapped = mapZroCatalog(details);
  if (mapped.length === 0) return 0;

  const merged = new Map<string, ModelInfo>();
  for (const model of ZRO_MODELS) merged.set(model.id, model);
  for (const model of mapped) merged.set(model.id, model);

  const values = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  ZRO_MODELS.splice(0, ZRO_MODELS.length, ...values);
  return values.length;
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
  if (modelInfo.status === 'unavailable') {
    throw new Error(
      `Zro: ${modelId} não está disponível para esta chave (403). ` +
        'Confira o plano em zro.moonmath.ai ou use deepseek-v4.1-flash.',
    );
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
    if (/\b403\b|forbidden|permission|access denied/i.test(message)) {
      throw new Error(
        `Zro: a chave não tem permissão para ${modelId}. ` +
          'Esse modelo exige plano com acesso; use deepseek-v4.1-flash.',
      );
    }
    if (/\b404\b|not found/i.test(message)) {
      throw new Error(`Zro: modelo ${modelId} não encontrado na conta.`);
    }
    throw error;
  }

  if (response.text.trim().length === 0) {
    throw new Error('Zro: resposta vazia. Confira se o modelo está ativo na conta.');
  }
  return response;
}
