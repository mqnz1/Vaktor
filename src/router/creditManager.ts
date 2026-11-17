import type {
  CreditStats,
  CreditUsage,
  RouterConfig,
} from '../types/index.js';

export class CreditManager {
  private stats: CreditStats;
  private config: RouterConfig;

  constructor(config: RouterConfig) {
    this.config = config;
    this.stats = {
      totalCostUsd: 0,
      budgetUsd: config.budgetUsd,
      remainingUsd: config.budgetUsd,
      percentUsed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheHits: 0,
      savedByCache: 0,
      usageHistory: [],
    };
  }

  record(usage: Omit<CreditUsage, 'timestamp'>): void {
    const entry: CreditUsage = { ...usage, timestamp: Date.now() };
    this.stats.usageHistory.push(entry);

    if (usage.fromCache) {
      this.stats.cacheHits++;
      this.stats.savedByCache += usage.estimatedCostUsd;
      return; // Não debita do orçamento se veio do cache
    }

    this.stats.totalCostUsd += usage.estimatedCostUsd;
    this.stats.totalInputTokens += usage.inputTokens;
    this.stats.totalOutputTokens += usage.outputTokens;
    this.stats.remainingUsd = Math.max(0, this.stats.budgetUsd - this.stats.totalCostUsd);
    this.stats.percentUsed = (this.stats.totalCostUsd / this.stats.budgetUsd) * 100;
  }

  getStats(): Readonly<CreditStats> {
    return { ...this.stats, usageHistory: [...this.stats.usageHistory] };
  }

  isOverBudget(): boolean {
    return this.stats.totalCostUsd >= this.stats.budgetUsd;
  }

  // Verifica se adicionar X tokens vai ultrapassar o orçamento
  wouldExceedBudget(estimatedCostUsd: number): boolean {
    return (this.stats.totalCostUsd + estimatedCostUsd) >= this.stats.budgetUsd;
  }

  getRemainingBudgetPercent(): number {
    return Math.max(0, 100 - this.stats.percentUsed);
  }

  getFormattedStats(): string {
    const s = this.stats;
    return [
      `Gasto: $${s.totalCostUsd.toFixed(4)} / $${s.budgetUsd.toFixed(2)}`,
      `Restante: $${s.remainingUsd.toFixed(4)} (${(100 - s.percentUsed).toFixed(1)}%)`,
      `Tokens: ${s.totalInputTokens.toLocaleString()} in / ${s.totalOutputTokens.toLocaleString()} out`,
      `Cache: ${s.cacheHits} hits — economizou $${s.savedByCache.toFixed(4)}`,
    ].join('\n');
  }

  updateBudget(newBudgetUsd: number): void {
    this.config.budgetUsd = newBudgetUsd;
    this.stats.budgetUsd = newBudgetUsd;
    this.stats.remainingUsd = Math.max(0, newBudgetUsd - this.stats.totalCostUsd);
    this.stats.percentUsed = (this.stats.totalCostUsd / newBudgetUsd) * 100;
  }
}
