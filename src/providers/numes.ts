import type { ChatMessage, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const NUMES_BASE_URL = 'https://api.numes.ai/api/v1';
const NUMES_TIMEOUT_MS = 120_000;
const NUMES_CATALOG_TIMEOUT_MS = 15_000;

export interface NumesModel {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  costPer1kTokensInput: number;
  costPer1kTokensOutput: number;
}

interface NumesPricing {
  prompt?: unknown;
  completion?: unknown;
  request?: unknown;
  usd_rates?: { prompt?: unknown; completion?: unknown; request?: unknown } | undefined;
  reference?: { usd_per_btc?: unknown } | undefined;
}

export interface NumesModelDetails {
  id?: unknown;
  canonical_slug?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  architecture?: { output_modalities?: unknown } | undefined;
  pricing?: NumesPricing | undefined;
  billing_currency?: unknown;
}

function model(
  id: string,
  name: string,
  costPer1MInput: number,
  costPer1MOutput: number,
  contextWindow: number,
  description: string,
): NumesModel {
  return {
    id,
    name: `${name} (Numes)`,
    description,
    contextWindow,
    costPer1kTokensInput: costPer1MInput / 1000,
    costPer1kTokensOutput: costPer1MOutput / 1000,
  };
}

export const NUMES_MODELS: NumesModel[] = [
  model('openai/gpt-6-luna', 'GPT-6 Luna', 0.07, 0.38, 131072, 'Numes · generalista econômico'),
  model('openai/gpt-6-astra', 'GPT-6 Astra', 0.46, 1.54, 131072, 'Numes · OpenAI de alta capacidade'),
  model('anthropic/claude-sonnet-5', 'Claude Sonnet 5', 2.4, 12, 200000, 'Numes · código e agentes'),
  model('anthropic/claude-opus-5', 'Claude Opus 5', 6, 30, 200000, 'Numes · raciocínio mais profundo'),
  model('google/gemini-3.8-flash', 'Gemini 3.8 Flash', 0.03, 0.13, 1000000, 'Numes · rápido e barato'),
  model('moonshotai/kimi-k3', 'Kimi K3', 0.03, 0.15, 256000, 'Numes · raciocínio e código'),
  model('z-ai/glm-5.3', 'GLM 5.3', 0.15, 0.8, 128000, 'Numes · MoE para agentes'),
  model('alibaba/qwen3.8-max', 'Qwen 3.8 Max', 0.08, 0.08, 128000, 'Numes · multilíngue'),
  model('deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 0.0038, 0.0038, 128000, 'Numes · econômico'),
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function round9(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function per1k(perToken: unknown): number {
  const value = toNumber(perToken);
  return value > 0 ? round9(value * 1000) : 0;
}

function usdScale(details: NumesModelDetails): number {
  if (details.billing_currency !== 'BTC') return 1;
  const reference = details.pricing?.reference;
  const usdPerBtc = toNumber(reference?.usd_per_btc);
  return usdPerBtc > 0 ? usdPerBtc / 100_000_000 : 0;
}

export function mapNumesCatalog(details: readonly NumesModelDetails[]): NumesModel[] {
  const seen = new Set<string>();
  const out: NumesModel[] = [];

  for (const item of details) {
    const id =
      typeof item.id === 'string' && item.id.trim().length > 0
        ? item.id.trim()
        : typeof item.canonical_slug === 'string'
          ? item.canonical_slug.trim()
          : '';
    if (!id || seen.has(id)) continue;

    const outputs = item.architecture?.output_modalities;
    if (Array.isArray(outputs) && outputs.length > 0 && !outputs.includes('text')) continue;

    const pricing = item.pricing ?? {};
    const usd = asRecord(pricing.usd_rates);
    const scale = usdScale(item);
    let input = usd['prompt'] !== undefined ? per1k(usd['prompt']) : round9(per1k(pricing.prompt) * scale);
    let output =
      usd['completion'] !== undefined ? per1k(usd['completion']) : round9(per1k(pricing.completion) * scale);
    const request = round9(
      (usd['request'] !== undefined ? toNumber(usd['request']) : toNumber(pricing.request) * scale),
    );
    if (input === 0 && output === 0 && request > 0) {
      input = request;
      output = request;
    }

    seen.add(id);
    const label =
      typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : id;
    const description =
      typeof item.description === 'string' && item.description.trim().length > 0
        ? item.description.trim().slice(0, 160)
        : 'Numes';

    out.push({
      id,
      name: `${label} (Numes)`,
      description,
      contextWindow: toNumber(item.context_length) || 128_000,
      costPer1kTokensInput: input,
      costPer1kTokensOutput: output,
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function applyNumesCatalog(details: readonly NumesModelDetails[]): number {
  const mapped = mapNumesCatalog(details);
  if (mapped.length === 0) return 0;
  NUMES_MODELS.splice(0, NUMES_MODELS.length, ...mapped);
  return mapped.length;
}

export function getNumesModelById(id: string): NumesModel | undefined {
  return NUMES_MODELS.find(item => item.id === id);
}

export function numesDynamicEnabled(): boolean {
  return (process.env['NUMES_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

export async function loadNumesCatalog(
  apiKey: string,
  timeoutMs = NUMES_CATALOG_TIMEOUT_MS,
): Promise<number> {
  if (!apiKey || !numesDynamicEnabled()) return 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(`${NUMES_BASE_URL}/models?output_modalities=text`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      timeout,
    ]);
    if (!response || !response.ok) return 0;
    const data = asRecord(await response.json());
    const list = Array.isArray(data['data']) ? data['data'] : [];
    return applyNumesCatalog(list as NumesModelDetails[]);
  } catch {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendToNumes(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getNumesModelById(modelId) ?? {
    id: modelId,
    name: `${modelId} (Numes)`,
    description: 'Numes',
    contextWindow: 0,
    costPer1kTokensInput: 0.0001,
    costPer1kTokensOutput: 0.0004,
  };

  return sendOpenAiCompatible(
    messages,
    modelInfo,
    maxTokens,
    apiKey,
    thinking,
    temperature,
    callOpts,
    {
      baseUrl: NUMES_BASE_URL,
      timeoutMs: NUMES_TIMEOUT_MS,
      providerName: 'Numes',
      auth: 'bearer',
      reasoningParam: 'reasoning',
    },
  );
}
