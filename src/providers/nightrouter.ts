import type { ChatMessage, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const NIGHTROUTER_BASE_URL = 'https://api.nightrouter.ai/v1';
const NIGHTROUTER_TIMEOUT_MS = 120_000;
const NIGHTROUTER_CATALOG_TIMEOUT_MS = 15_000;

const KEY_COOLDOWN_MS = 60_000;

function configuredKeyPool(primary: string): string[] {
  const raw =
    (process.env['NIGHTROUTER_API_KEYS'] || process.env['NIGHTROUTER_API_KEY_POOL'] || '').trim();
  const keys = [primary, ...raw.split(/[,;\s]+/)]
    .map(key => key.trim())
    .filter(key => key.length > 0);
  return [...new Set(keys)];
}

interface KeyPoolState {
  currentIndex: number;
  keyStatus: Map<string, number>;
}

let keyPoolState: KeyPoolState = {
  currentIndex: 0,
  keyStatus: new Map(),
};

function getNextKey(pool: readonly string[]): string {
  const now = Date.now();
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const index = (keyPoolState.currentIndex + attempt) % pool.length;
    const key = pool[index] as string;
    const failedAt = keyPoolState.keyStatus.get(key);
    if (failedAt === undefined || now - failedAt > KEY_COOLDOWN_MS) {
      keyPoolState.currentIndex = (index + 1) % pool.length;
      return key;
    }
  }
  keyPoolState.keyStatus.clear();
  keyPoolState.currentIndex = 0;
  return pool[0] as string;
}

function markKeyFailed(key: string): void {
  keyPoolState.keyStatus.set(key, Date.now());
}

function markKeyOk(key: string): void {
  keyPoolState.keyStatus.delete(key);
}

function resetKeyPool(): void {
  keyPoolState = { currentIndex: 0, keyStatus: new Map() };
}

/** Primeira chave configurada (usada pelo catálogo e por testes). */
export function nightRouterPrimaryKey(): string {
  return configuredKeyPool(process.env['NIGHTROUTER_API_KEY'] ?? '')[0] ?? '';
}

/** Reset do round-robin; útil em testes e após trocar o pool no .env. */
export function resetNightRouterKeyPool(): void {
  resetKeyPool();
}

function errorStatus(error: Error): number | null {
  const match = error.message.match(/\b(401|402|403|429)\b/);
  return match ? Number(match[1]) : null;
}

export interface NightRouterModel {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  costPer1kTokensInput: number;
  costPer1kTokensOutput: number;
}

export interface NightRouterModelDetails {
  id?: unknown;
  supported_endpoint_types?: unknown;
}

function pricePer1M(id: string): { input: number; output: number } {
  const lower = id.toLowerCase();
  if (/claude-opus-4-6/.test(lower)) return { input: 2, output: 10 };
  if (/claude-opus/.test(lower)) return { input: 4.8, output: 24 };
  if (/claude-sonnet/.test(lower)) return { input: 2.4, output: 12 };
  if (/claude-haiku/.test(lower)) return { input: 0.02, output: 0.1 };
  if (/claude-fable/.test(lower)) return { input: 1.07, output: 5.35 };
  if (/gpt-6-astra/.test(lower)) return { input: 0.46, output: 1.54 };
  if (/gpt-6-luna/.test(lower)) return { input: 0.07, output: 0.38 };
  if (/gpt-6\.1-sol/.test(lower)) return { input: 0.1, output: 0.46 };
  if (/gpt-5\.6-sol/.test(lower)) return { input: 0.19, output: 0.96 };
  if (/gpt-5\.6-terra/.test(lower)) return { input: 0.12, output: 0.58 };
  if (/gemini-4-argon/.test(lower)) return { input: 0.08, output: 0.38 };
  if (/gemini-3\.[678]-flash/.test(lower)) return { input: 0.03, output: 0.13 };
  if (/gemini-3\.1-pro/.test(lower)) return { input: 0.1, output: 0.4 };
  if (/kimi-k3\.1-pro/.test(lower)) return { input: 0.07, output: 0.35 };
  if (/kimi-k3/.test(lower)) return { input: 0.03, output: 0.15 };
  if (/kimi/.test(lower)) return { input: 0.02, output: 0.1 };
  if (/glm-5\.3-flash/.test(lower)) return { input: 0.02, output: 0.02 };
  if (/glm-5\.3/.test(lower)) return { input: 0.15, output: 0.8 };
  if (/glm-5\.2/.test(lower)) return { input: 0.03, output: 0.03 };
  if (/glm-5\.1/.test(lower)) return { input: 0.02, output: 0.02 };
  if (/qwen3\.8-flash|qwen3\.8-omni/.test(lower)) return { input: 0.04, output: 0.04 };
  if (/qwen3\.8-max-0902/.test(lower)) return { input: 0.08, output: 0.08 };
  if (/qwen3\.[78]-max/.test(lower)) return { input: 0.0038, output: 0.0038 };
  if (/grok-4\.[567]/.test(lower)) return { input: 0.1, output: 0.4 };
  if (/minimax-m3/.test(lower)) return { input: 0.05, output: 0.2 };
  if (/deepseek-v4/.test(lower)) return { input: 0.0038, output: 0.0038 };
  return { input: 0.05, output: 0.2 };
}

function contextOf(id: string): number {
  const lower = id.toLowerCase();
  if (/gemini/.test(lower)) return 1_000_000;
  if (/claude/.test(lower)) return 200_000;
  return 128_000;
}

function displayName(id: string): string {
  return id
    .split('-')
    .map(part => (part.length <= 3 ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1)))
    .join(' ');
}

function model(id: string, description = 'NightRouter'): NightRouterModel {
  const price = pricePer1M(id);
  return {
    id,
    name: `${displayName(id)} (NightRouter)`,
    description,
    contextWindow: contextOf(id),
    costPer1kTokensInput: price.input / 1000,
    costPer1kTokensOutput: price.output / 1000,
  };
}

export const NIGHTROUTER_MODELS: NightRouterModel[] = [
  model('claude-opus-5.5', 'NightRouter · Claude Opus 5.5'),
  model('claude-sonnet-5.5', 'NightRouter · Claude Sonnet 5.5'),
  model('claude-haiku-5-5', 'NightRouter · Claude Haiku 5.5'),
  model('claude-fable-5', 'NightRouter · Claude Fable 5'),
  model('gpt-6-astra', 'NightRouter · GPT-6 Astra'),
  model('gpt-6-luna', 'NightRouter · GPT-6 Luna'),
  model('gpt-5.6-terra', 'NightRouter · GPT-5.6 Terra'),
  model('gemini-3.8-flash', 'NightRouter · Gemini 3.8 Flash'),
  model('kimi-k3', 'NightRouter · Kimi K3'),
  model('glm-5.3', 'NightRouter · GLM 5.3'),
  model('qwen3.8-max', 'NightRouter · Qwen 3.8 Max'),
  model('deepseek-v4.1-flash', 'NightRouter · DeepSeek V4.1 Flash'),
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function supportsOpenAi(details: NightRouterModelDetails): boolean {
  const types = details.supported_endpoint_types;
  if (!Array.isArray(types) || types.length === 0) return true;
  return types.includes('openai');
}

export function mapNightRouterCatalog(
  details: readonly NightRouterModelDetails[],
): NightRouterModel[] {
  const seen = new Set<string>();
  const out: NightRouterModel[] = [];

  for (const item of details) {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || id.length > 120 || /[\u0000-\u001F]/.test(id) || seen.has(id) || !supportsOpenAi(item)) continue;
    seen.add(id);
    out.push(model(id));
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function applyNightRouterCatalog(
  details: readonly NightRouterModelDetails[],
): number {
  const mapped = mapNightRouterCatalog(details);
  if (mapped.length === 0) return 0;
  NIGHTROUTER_MODELS.splice(0, NIGHTROUTER_MODELS.length, ...mapped);
  return mapped.length;
}

export function getNightRouterModelById(id: string): NightRouterModel | undefined {
  return NIGHTROUTER_MODELS.find(item => item.id === id);
}

export function nightRouterDynamicEnabled(): boolean {
  return (process.env['NIGHTROUTER_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

export async function loadNightRouterCatalog(
  apiKey: string,
  timeoutMs = NIGHTROUTER_CATALOG_TIMEOUT_MS,
): Promise<number> {
  if (!apiKey || !nightRouterDynamicEnabled()) return 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(`${NIGHTROUTER_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      timeout,
    ]);
    if (!response || !response.ok) return 0;
    const data = asRecord(await response.json());
    const list = Array.isArray(data['data']) ? data['data'] : [];
    return applyNightRouterCatalog(list as NightRouterModelDetails[]);
  } catch {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendToNightRouter(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const keyPool = configuredKeyPool(apiKey);
  if (keyPool.length === 0) {
    throw new Error('NIGHTROUTER_API_KEY não configurada no .env');
  }

  const modelInfo = getNightRouterModelById(modelId) ?? {
    id: modelId,
    name: `${modelId} (NightRouter)`,
    description: 'NightRouter',
    contextWindow: 0,
    costPer1kTokensInput: 0.0001,
    costPer1kTokensOutput: 0.0004,
  };

  let lastError: Error | null = null;
  let emittedToken = false;
  const opts: ProviderCallOpts | undefined = callOpts
    ? {
        ...callOpts,
        ...(callOpts.onToken
          ? { onToken: (chunk: string) => { emittedToken = true; callOpts.onToken?.(chunk); } }
          : {}),
        ...(callOpts.onReasoningToken
          ? {
              onReasoningToken: (chunk: string) => {
                emittedToken = true;
                callOpts.onReasoningToken?.(chunk);
              },
            }
          : {}),
      }
    : undefined;

  for (let attempt = 0; attempt < keyPool.length; attempt++) {
    const key = getNextKey(keyPool);
    try {
      const response = await sendOpenAiCompatible(
        messages,
        modelInfo,
        maxTokens,
        key,
        thinking,
        temperature,
        opts,
        {
          baseUrl: NIGHTROUTER_BASE_URL,
          timeoutMs: NIGHTROUTER_TIMEOUT_MS,
          providerName: 'NightRouter',
          auth: 'bearer',
        },
      );
      markKeyOk(key);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (emittedToken) break;
      const status = errorStatus(lastError);
      if (status === 401 || status === 402 || status === 403 || status === 429) {
        markKeyFailed(key);
        continue;
      }
      throw lastError;
    }
  }

  throw new Error(
    `NightRouter: todas as chaves do pool falharam. ${redactSecrets(lastError?.message ?? '')}`,
  );
}
