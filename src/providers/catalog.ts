// =============================================================
// Catálogo unificado de modelos: classificação, priorização e
// descoberta de modelos gratuitos.
//
// Fonte única para o menu da TUI, para o roteamento e para comandos
// como `/models`, `/free` e `/context`. A classificação é derivada de
// id/nome/descrição para não exigir editar os 330 modelos à mão.
// =============================================================
import type { ModelStatus } from '../types/index.js';
import type { ProviderId } from '../thinking/types.js';
import {
  PROVIDER_CATALOGS,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  qualifyModelId,
  type CatalogModel,
} from './registry.js';

export type ModelTier = 'premium' | 'standard' | 'economy';

/** Capacidade principal do modelo. `free` é um atributo separado. */
export type ModelCategory = 'code' | 'reasoning' | 'vision' | 'fast' | 'general';

export interface RankedModel {
  provider: ProviderId;
  providerLabel: string;
  /** ID bruto, como aparece no catálogo do provedor. */
  id: string;
  /** ID com provedor fixado (`provider::id`). */
  qualifiedId: string;
  name: string;
  description: string;
  tier: ModelTier;
  status: ModelStatus;
  contextWindow: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
  free: boolean;
  category: ModelCategory;
  /** Menor = melhor. Grátis primeiro, depois tier e custo. */
  priority: number;
}

export const MODEL_CATEGORY_LABELS: Record<ModelCategory, string> = {
  code: 'código',
  reasoning: 'raciocínio',
  vision: 'visão',
  fast: 'rápido',
  general: 'geral',
};

const VISION_PATTERN = /(vision|multimodal|(^|[-/])vl($|[-/])|image|omni|pixtral|llava|llama-?4|gemma-?3)/;
const REASONING_PATTERN = /(reason|thinking|(^|[-/])think($|[-/])|(^|[-/])o[1-4]($|[-/])|deepseek-r|qwq|opus|gpt-5-pro|(^|[-/])pro($|[-/]))/;
const CODE_PATTERN = /(code|coder|codestral|codex|devstral|starcoder|swe|sonnet|kimi|qwen.*coder|deepseek-v[34])/;
const FAST_PATTERN = /(flash|mini|nano|haiku|lite|instant|turbo|lightning|small|tiny|(^|[-/])[1-9]b($|[-/])|(^|[-/])[1-9][0-9]b($|[-/])|fast|efficient)/;

const CATEGORY_SCORE: Record<ModelCategory, number> = {
  reasoning: 5,
  code: 4,
  general: 3,
  vision: 2,
  fast: 1,
};

const TIER_SCORE: Record<ModelTier, number> = {
  economy: 1,
  standard: 2,
  premium: 3,
};

export function isFreeModel(model: Pick<CatalogModel, 'costPer1kTokensInput' | 'costPer1kTokensOutput'>): boolean {
  return model.costPer1kTokensInput === 0 && model.costPer1kTokensOutput === 0;
}

export function classifyModel(model: Pick<CatalogModel, 'id' | 'name' | 'description'>): ModelCategory {
  const haystack = `${model.id} ${model.name} ${model.description ?? ''}`.toLowerCase();
  if (VISION_PATTERN.test(haystack)) return 'vision';
  if (REASONING_PATTERN.test(haystack)) return 'reasoning';
  if (CODE_PATTERN.test(haystack)) return 'code';
  if (FAST_PATTERN.test(haystack)) return 'fast';
  return 'general';
}

function normalizeTier(raw: unknown, prices: number): ModelTier {
  if (raw === 'premium' || raw === 'standard' || raw === 'economy') return raw;
  if (prices >= 10) return 'premium';
  if (prices >= 0.8) return 'standard';
  return 'economy';
}

function normalizeStatus(raw: unknown): ModelStatus {
  return raw === 'limited' || raw === 'unavailable' ? raw : 'available';
}

function priorityOf(free: boolean, tier: ModelTier, category: ModelCategory, prices: number): number {
  // Faixa 0 = grátis, 1e9 = pago. Dentro da faixa: capacidade, tier e custo.
  const base = free ? 0 : 1_000_000_000;
  const capability = (5 - CATEGORY_SCORE[category]) * 1_000_000;
  const tierCost = (3 - TIER_SCORE[tier]) * 100_000;
  const priceCost = Math.round(prices * 1000);
  return base + capability + tierCost + priceCost;
}

function rank(provider: ProviderId, model: CatalogModel): RankedModel {
  const input = model.costPer1kTokensInput ?? 0;
  const output = model.costPer1kTokensOutput ?? 0;
  const free = isFreeModel(model);
  const tier = normalizeTier(model.tier, input * 1000 + output * 100);
  const category = classifyModel(model);
  return {
    provider,
    providerLabel: PROVIDER_LABELS[provider],
    id: model.id,
    qualifiedId: qualifyModelId(provider, model.id),
    name: model.name,
    description: model.description ?? '',
    tier,
    status: normalizeStatus(model.status),
    contextWindow: model.contextWindow ?? 0,
    inputCostPer1k: input,
    outputCostPer1k: output,
    free,
    category,
    priority: priorityOf(free, tier, category, input + output),
  };
}

/** Todos os modelos, já ordenados por prioridade (grátis primeiro). */
export function listRankedModels(): RankedModel[] {
  const out: RankedModel[] = [];
  for (const provider of PROVIDER_ORDER) {
    for (const model of PROVIDER_CATALOGS[provider]) {
      out.push(rank(provider, model));
    }
  }
  return out.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export function listFreeModels(): RankedModel[] {
  return listRankedModels().filter(model => model.free);
}

/** IDs qualificados de modelos grátis, para a cadeia de fallback. */
export function freeModelChain(limit = 12): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const model of listFreeModels()) {
    if (seen.has(model.qualifiedId)) continue;
    seen.add(model.qualifiedId);
    chain.push(model.qualifiedId);
    if (chain.length >= limit) break;
  }
  return chain;
}

export interface CatalogSummary {
  total: number;
  free: number;
  byCategory: Record<ModelCategory, number>;
  byProvider: Array<{ provider: ProviderId; label: string; total: number; free: number }>;
}

export function summarizeCatalogs(): CatalogSummary {
  const byCategory: Record<ModelCategory, number> = {
    code: 0,
    reasoning: 0,
    vision: 0,
    fast: 0,
    general: 0,
  };
  const providerMap = new Map<ProviderId, { total: number; free: number }>();
  const models = listRankedModels();

  for (const model of models) {
    byCategory[model.category] += 1;
    const current = providerMap.get(model.provider) ?? { total: 0, free: 0 };
    current.total += 1;
    if (model.free) current.free += 1;
    providerMap.set(model.provider, current);
  }

  return {
    total: models.length,
    free: models.filter(model => model.free).length,
    byCategory,
    byProvider: PROVIDER_ORDER.map(provider => ({
      provider,
      label: PROVIDER_LABELS[provider],
      total: providerMap.get(provider)?.total ?? 0,
      free: providerMap.get(provider)?.free ?? 0,
    })),
  };
}

/** Resumo de texto pronto para a TUI. */
export function formatCatalogSummary(): string {
  const summary = summarizeCatalogs();
  const categories = (Object.keys(summary.byCategory) as ModelCategory[])
    .map(category => `${MODEL_CATEGORY_LABELS[category]}: ${summary.byCategory[category]}`)
    .join(' · ');
  const providers = summary.byProvider
    .filter(item => item.total > 0)
    .map(item => `${item.label}: ${item.total} (${item.free} grátis)`)
    .join('\n');
  return [
    `Modelos: ${summary.total} · grátis: ${summary.free}`,
    categories,
    '',
    providers,
  ].join('\n');
}
