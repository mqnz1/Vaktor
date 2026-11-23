import type { ChatMessage, RouterResponse, ModelInfo } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

// Modelos disponíveis via Puter.com (IDs verificados no catálogo real do Puter)
export const PUTER_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8 (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.005,
    costPer1kTokensOutput: 0.025,
    contextWindow: 1000000,
    status: 'available',
    tier: 'premium',
    description: 'Claude mais capaz, para tarefas complexas',
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5 (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.002,
    costPer1kTokensOutput: 0.01,
    contextWindow: 1000000,
    status: 'available',
    tier: 'premium',
    description: 'Melhor equilíbrio entre qualidade e custo',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.003,
    costPer1kTokensOutput: 0.015,
    contextWindow: 1000000,
    status: 'available',
    tier: 'premium',
    description: 'Claude Sonnet 4.6, ótimo em código',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5 (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.001,
    costPer1kTokensOutput: 0.005,
    contextWindow: 200000,
    status: 'available',
    tier: 'standard',
    description: 'Claude rápido e econômico',
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4 (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.0025,
    costPer1kTokensOutput: 0.015,
    contextWindow: 1050000,
    status: 'available',
    tier: 'premium',
    description: 'GPT-5.4, contexto gigante',
  },
  {
    id: 'gpt-5',
    name: 'GPT-5 (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.00125,
    costPer1kTokensOutput: 0.01,
    contextWindow: 128000,
    status: 'available',
    tier: 'standard',
    description: 'GPT-5 com raciocínio nativo',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.00015,
    costPer1kTokensOutput: 0.0006,
    contextWindow: 128000,
    status: 'available',
    tier: 'economy',
    description: 'Versão econômica do GPT-4o',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.00125,
    costPer1kTokensOutput: 0.01,
    contextWindow: 1048576,
    status: 'available',
    tier: 'premium',
    description: 'Melhor modelo Gemini com raciocínio',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.0003,
    costPer1kTokensOutput: 0.0025,
    contextWindow: 1048576,
    status: 'available',
    tier: 'economy',
    description: 'Contexto gigante, muito econômico',
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.0003,
    costPer1kTokensOutput: 0.0012,
    contextWindow: 1000000,
    status: 'available',
    tier: 'economy',
    description: 'DeepSeek rápido e de baixo custo',
  },
  {
    id: 'mistral-small-2603',
    name: 'Mistral Small 4 (Puter)',
    provider: 'puter',
    costPer1kTokensInput: 0.00015,
    costPer1kTokensOutput: 0.0006,
    contextWindow: 256000,
    status: 'available',
    tier: 'economy',
    description: 'Mistral Small 4, leve e econômico',
  },
];

export function getModelById(id: string): ModelInfo | undefined {
  return PUTER_MODELS.find(m => m.id === id);
}

// =============================================================
// Catálogo remoto do Puter
//
// O endpoint /puterai/chat/models/details expõe o catálogo completo
// (atualmente ~1000 entradas). A lista estática acima é apenas o
// fallback offline/erro. `loadPuterCatalog()` substitui o conteúdo de
// PUTER_MODELS no lugar, para que registry, menus e cálculo de custo
// enxerguem a mesma lista sem mudar as importações.
// =============================================================

export interface PuterModelDetails {
  id?: unknown;
  name?: unknown;
  provider?: unknown;
  modalities?: { output?: unknown } | undefined;
  costs?: Record<string, unknown> | undefined;
  costs_currency?: unknown;
  context?: unknown;
  max_tokens?: unknown;
}

const NON_CHAT_MODEL_PATTERN =
  /(asr|tts|embedding|rerank|image|video|ocr|livetranslate|voice-enrollment|speech)/i;

function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function costPer1k(
  costs: Record<string, unknown> | undefined,
  keys: readonly string[],
): number {
  if (!costs) return 0;
  const tokens = toNumber(costs['tokens']);
  if (tokens === undefined || tokens <= 0) return 0;
  for (const key of keys) {
    const cents = toNumber(costs[key]);
    if (cents !== undefined) {
      // costs_currency = usd-cents por `tokens`; converte para USD/1k.
      return (cents / tokens) * 1000 / 100;
    }
  }
  return 0;
}

function isChatModel(details: PuterModelDetails, id: string): boolean {
  if (NON_CHAT_MODEL_PATTERN.test(id)) return false;
  const output = details.modalities?.output;
  if (Array.isArray(output) && output.length > 0 && !output.includes('text')) return false;
  return true;
}

/** Converte o payload do Puter em ModelInfo (sem tocar no catálogo global). */
export function mapPuterCatalog(details: readonly PuterModelDetails[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];

  for (const item of details) {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || id === 'auto' || seen.has(id) || !isChatModel(item, id)) continue;
    seen.add(id);

    const input = costPer1k(item.costs, ['input_tokens', 'prompt_tokens', 'prompt']);
    const output = costPer1k(item.costs, ['output_tokens', 'completion_tokens', 'completion']);
    const contextWindow = toNumber(item.context) ?? toNumber(item.max_tokens) ?? 0;
    const upstream = typeof item.provider === 'string' && item.provider.trim().length > 0
      ? item.provider.trim()
      : 'puter';
    const label = typeof item.name === 'string' && item.name.trim().length > 0
      ? item.name.trim()
      : id;
    const tier: ModelInfo['tier'] =
      output >= 0.01 ? 'premium' : output >= 0.002 ? 'standard' : 'economy';

    out.push({
      id,
      name: `${label} (Puter)`,
      provider: 'puter',
      costPer1kTokensInput: input,
      costPer1kTokensOutput: output,
      contextWindow,
      status: 'available',
      tier,
      description: `Puter · ${upstream}`,
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

let puterCatalogMode: 'static' | 'dynamic' = 'static';

/** Indica se o catálogo ativo veio da API ou é o fallback estático. */
export function getPuterCatalogMode(): 'static' | 'dynamic' {
  return puterCatalogMode;
}

/** Substitui o catálogo global pelo payload remoto. Retorna quantos entraram. */
export function applyPuterCatalog(details: readonly PuterModelDetails[]): number {
  const mapped = mapPuterCatalog(details);
  if (mapped.length === 0) return 0;
  PUTER_MODELS.splice(0, PUTER_MODELS.length, ...mapped);
  puterCatalogMode = 'dynamic';
  return mapped.length;
}

/** PUTER_DYNAMIC_MODELS=false mantém a lista curada de 11 modelos. */
export function puterDynamicEnabled(): boolean {
  return (process.env['PUTER_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

const CATALOG_TIMEOUT_MS = 5000;

/**
 * Carrega o catálogo completo via SDK (auth já configurada em initPuter).
 * Em caso de timeout/erro, mantém a lista estática. Nunca lança.
 */
export async function loadPuterCatalog(timeoutMs = CATALOG_TIMEOUT_MS): Promise<number> {
  if (!puterInstance || !puterDynamicEnabled()) return 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const models = await Promise.race([puterInstance.ai.listModels(), timeout]);
    if (!Array.isArray(models)) return 0;
    return applyPuterCatalog(models as PuterModelDetails[]);
  } catch {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Extrai os blocos de conteúdo do formato Anthropic/OpenAI do Puter
function getContentBlocks(response: unknown): Record<string, unknown>[] {
  if (!response || typeof response !== 'object') return [];
  const r = response as Record<string, unknown>;
  const result = r['result'] as Record<string, unknown> | undefined;
  const msg = (r['message'] ?? result?.['message']) as Record<string, unknown> | undefined;
  const content = msg?.['content'] ?? r['content'];
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object');
}

// Extrai texto de qualquer formato de resposta do Puter
function extractText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    return String(response ?? '');
  }

  const r = response as Record<string, unknown>;

  // Formato Anthropic: content: [{ type: 'thinking' }, { type: 'text', text }]
  const blocks = getContentBlocks(response);
  const textParts = blocks
    .filter(b => b['type'] === 'text' || (typeof b['text'] === 'string' && b['type'] !== 'thinking'))
    .map(b => String(b['text'] ?? ''))
    .filter(t => t.length > 0);
  if (textParts.length > 0) return textParts.join('\n');

  // Formatos antigos/alternativos
  const result = r['result'] as Record<string, unknown> | undefined;
  const msg = (r['message'] ?? result?.['message']) as Record<string, unknown> | undefined;
  const content = msg?.['content'] ?? r['content'];
  if (typeof content === 'string') return content;
  if (typeof r['text'] === 'string') return r['text'];
  if (typeof r['content'] === 'string') return r['content'];

  return JSON.stringify(response);
}

// Extrai raciocínio nativo de qualquer formato de resposta do Puter
function extractReasoning(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;

  const blocks = getContentBlocks(response);
  const parts = blocks
    .filter(b => b['type'] === 'thinking' || b['type'] === 'reasoning')
    .map(b => String(b['thinking'] ?? b['text'] ?? b['content'] ?? ''))
    .filter(t => t.trim().length > 0);
  if (parts.length > 0) return parts.join('\n\n');

  const r = response as Record<string, unknown>;
  const result = r['result'] as Record<string, unknown> | undefined;
  const msg = (r['message'] ?? result?.['message']) as Record<string, unknown> | undefined;
  const candidates = [
    msg?.['reasoning'],
    msg?.['reasoning_content'],
    r['reasoning'],
    r['reasoning_content'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return undefined;
}

// Extrai usage real (Claude usa input_tokens/output_tokens; GPT usa prompt_tokens/completion_tokens)
function extractUsage(response: unknown): Record<string, unknown> | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const r = response as Record<string, unknown>;
  const result = r['result'] as Record<string, unknown> | undefined;
  const msg = (r['message'] ?? result?.['message']) as Record<string, unknown> | undefined;
  return (r['usage'] ?? msg?.['usage']) as Record<string, unknown> | undefined;
}

function asTokenCount(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Estimativa simples de tokens (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface PuterAI {
  chat: (messages: Array<{role: string; content: string}>, options: Record<string, unknown>) => Promise<unknown>;
  listModels: () => Promise<Record<string, unknown>[]>;
}

interface PuterInstance {
  ai: PuterAI;
}

let puterInstance: PuterInstance | null = null;

export async function initPuter(apiKey: string): Promise<void> {
  const { init } = await import('@heyputer/puter.js/src/init.cjs');
  puterInstance = init(apiKey) as PuterInstance;
}

export async function sendToPuter(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  thinking: ThinkingArg = false,
  temperature?: number,
  // O SDK puter.js não expõe AbortSignal; aceitamos e ignoramos para a
  // assinatura unificada (o cache/troca de modelo compensa no pior caso).
  _callOpts?: import('./http.js').ProviderCallOpts,
): Promise<RouterResponse> {
  if (!puterInstance) {
    throw new Error('Puter não inicializado. Chame initPuter() primeiro.');
  }

  const opts = typeof thinking === 'object' ? thinking : undefined;
  const formatted = messages.map(m => ({ role: m.role, content: m.content }));

  const options: Record<string, unknown> = {
    model: modelId,
    max_tokens: maxTokens,
  };

  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    options.temperature = temperature;
  }

  // budget_tokens: só para Claude nativo e com max_tokens > budget (mínimo 1024)
  if (opts?.strategy === 'native' && /claude|anthropic/i.test(modelId)) {
    const budget = Math.min(opts.budgetTokens, Math.floor(maxTokens / 2));
    if (budget >= 1024) options.budget_tokens = budget;
  }

  // GPT-5 e família o* usam reasoning_effort no Puter
  if (opts?.strategy === 'native' && /^(gpt-5|o[1-9])/i.test(modelId)) {
    options.reasoning_effort = opts.effort;
  }

  const response = await puterInstance.ai.chat(formatted, options);

  const text = extractText(response);
  const reasoning = extractReasoning(response);
  const usage = extractUsage(response);

  const inputText = messages.map(m => m.content).join(' ');
  const inputTokens = asTokenCount(
    usage?.['input_tokens'] ?? usage?.['prompt_tokens'],
    estimateTokens(inputText),
  );
  const outputTokens = asTokenCount(
    usage?.['output_tokens'] ?? usage?.['completion_tokens'],
    estimateTokens(text),
  );

  const model = getModelById(modelId);
  const costInput = model ? (inputTokens / 1000) * model.costPer1kTokensInput : 0;
  const costOutput = model ? (outputTokens / 1000) * model.costPer1kTokensOutput : 0;

  return {
    text,
    model: modelId,
    inputTokens,
    outputTokens,
    fromCache: false,
    estimatedCostUsd: costInput + costOutput,
    ...(reasoning ? { reasoning } : {}),
  };
}
