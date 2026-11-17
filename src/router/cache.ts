import type { ChatMessage, RouterResponse } from '../types/index.js';
import { createHash } from 'node:crypto';

interface CacheEntry {
  response: RouterResponse;
  timestamp: number;
  hits: number;
  savedCost: number; // Quanto economizou em tokens/dinheiro
  model: string;
}

// TTL: 24 horas (mais agressivo, como Obsidian)
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
// Máximo de entradas: 500 (expandido)
const MAX_CACHE_SIZE = 500;

const cache = new Map<string, CacheEntry>();

export function buildCacheKey(messages: ChatMessage[], model: string, variant = 'plain'): string {
  const content = messages.map(m => `${m.role}:${m.content}`).join('|');
  const hash = createHash('sha256').update(`${model}::${variant}::${content}`).digest('hex').slice(0, 16);
  return hash;
}

function evictOldEntries(): void {
  if (cache.size <= MAX_CACHE_SIZE) return;

  // Remove as menos usadas E mais antigas
  const entries = [...cache.entries()]
    .sort((a, b) => {
      // Menos hits = prioridade para deletar
      const hitsDiff = a[1].hits - b[1].hits;
      if (hitsDiff !== 0) return hitsDiff;
      // Se mesmo número de hits, deleta a mais antiga
      return a[1].timestamp - b[1].timestamp;
    });

  const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE + 50);
  for (const [key] of toDelete) {
    cache.delete(key);
  }
}

export function getCached(messages: ChatMessage[], model: string, variant?: string): RouterResponse | null {
  const key = buildCacheKey(messages, model, variant);
  const entry = cache.get(key);

  if (!entry) return null;

  // Verifica TTL
  if (Date.now() - entry.timestamp > DEFAULT_TTL_MS) {
    cache.delete(key);
    return null;
  }

  entry.hits++;
  return { ...entry.response, fromCache: true };
}

export function setCache(messages: ChatMessage[], model: string, response: RouterResponse, variant?: string): void {
  const key = buildCacheKey(messages, model, variant);
  evictOldEntries();

  // Calcula quanto economizou (custo que teria se não estivesse em cache)
  const savedCost = response.estimatedCostUsd;

  cache.set(key, {
    response,
    timestamp: Date.now(),
    hits: 0,
    savedCost,
    model,
  });
}

export function getCacheStats(): {
  size: number;
  totalHits: number;
  totalSavedCost: number;
  savedTokens: number;
  percentageHits: number;
} {
  let totalHits = 0;
  let totalSavedCost = 0;
  let totalSavedTokens = 0;

  for (const entry of cache.values()) {
    totalHits += entry.hits;
    // Cada hit economiza o custo de output + input
    totalSavedCost += entry.hits * entry.savedCost;
    totalSavedTokens += entry.hits * (entry.response.outputTokens + entry.response.inputTokens);
  }

  const percentageHits = cache.size > 0 ? (totalHits / (cache.size + totalHits)) * 100 : 0;

  return {
    size: cache.size,
    totalHits,
    totalSavedCost,
    savedTokens: totalSavedTokens,
    percentageHits: Math.round(percentageHits),
  };
}

export function clearCache(): void {
  cache.clear();
}

// Detecta prompts triviais que podem usar modelo barato
const TRIVIAL_PATTERNS = [
  /^(oi|olá|ola|hi|hey|hello|ok|okay|sim|não|nao|obrigado|valeu|thanks|tudo bem)[\s!?.]*$/i,
  /^(continua|continue|prossiga|ok continue|vai|go on)[\s!?.]*$/i,
];

export function isTrivialPrompt(text: string): boolean {
  return TRIVIAL_PATTERNS.some(p => p.test(text.trim()));
}
