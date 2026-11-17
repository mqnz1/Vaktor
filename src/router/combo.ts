// =============================================================
// Combo: roteamento ponderado com fallback e teto de créditos.
//
// Inspirado no OmniRoute: vários modelos dividem as requisições por peso,
// mas a fila é ordenada de forma ponderada (sorteio sem reposição). Antes de
// cada tentativa o custo é estimado; quem não cabe no orçamento é cortado,
// então o combo nunca ultrapassa o limite configurado. Se o provedor "dormir"
// (timeout, conexão, 429/5xx), tentamos acordá-lo algumas vezes e só então
// seguimos para o próximo — o mesmo espírito de resiliência do Nemotron.
// =============================================================

export interface ComboMember {
  model: string;
  weight: number;
}

export interface ComboConfig {
  enabled: boolean;
  /** Modelos que dividem as requisições por peso. */
  members: ComboMember[];
  /** Fila de reserva, na ordem, quando os membros falham ou não cabem. */
  fallback: string[];
  /** Teto próprio do combo em USD (0 = só o teto global de créditos). */
  budgetUsd: number;
  /** Custo máximo estimado por requisição em USD (0 = sem teto). */
  maxCostPerRequestUsd: number;
  /** Tentativas extras para acordar um provedor frio. */
  wakeRetries: number;
  /** Espera entre tentativas de acordar (ms). */
  wakeDelayMs: number;
}

export interface ComboCandidate {
  model: string;
  weight: number;
  source: 'member' | 'fallback';
  estimatedCostUsd: number;
}

export interface ComboPickOptions {
  estimateCost: (model: string) => number;
  remainingUsd: number;
  random?: () => number;
}

export function emptyComboConfig(): ComboConfig {
  return {
    enabled: false,
    members: [],
    fallback: [],
    budgetUsd: 0,
    maxCostPerRequestUsd: 0,
    wakeRetries: 1,
    wakeDelayMs: 700,
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampMoney(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function normalizeMembers(raw: readonly ComboMember[] | undefined): ComboMember[] {
  const out: ComboMember[] = [];
  const seen = new Set<string>();
  for (const member of raw ?? []) {
    const model = member.model.trim();
    if (!model || seen.has(model)) continue;
    const weight = Number.isFinite(member.weight) && member.weight > 0 ? member.weight : 1;
    seen.add(model);
    out.push({ model, weight });
  }
  return out;
}

export function normalizeComboConfig(partial?: Partial<ComboConfig>): ComboConfig {
  const base = emptyComboConfig();
  if (!partial) return base;
  return {
    enabled: partial.enabled ?? base.enabled,
    members: normalizeMembers(partial.members ?? base.members),
    fallback: [...new Set((partial.fallback ?? base.fallback).map(model => model.trim()).filter(Boolean))],
    budgetUsd: clampMoney(partial.budgetUsd, base.budgetUsd),
    maxCostPerRequestUsd: clampMoney(partial.maxCostPerRequestUsd, base.maxCostPerRequestUsd),
    wakeRetries: clampInt(partial.wakeRetries, base.wakeRetries, 0, 5),
    wakeDelayMs: clampInt(partial.wakeDelayMs, base.wakeDelayMs, 0, 10_000),
  };
}

/**
 * Sorteio ponderado sem reposição: cada posição da fila é escolhida
 * proporcionalmente ao peso restante. A ordem muda entre requisições (bom
 * para dividir carga e evitar depender sempre do mesmo modelo), mas membros
 * com peso maior aparecem antes na média.
 */
export function weightedOrder(
  members: readonly ComboMember[],
  random: () => number = Math.random,
): ComboMember[] {
  const pool = members
    .filter(member => Number.isFinite(member.weight) && member.weight > 0)
    .map(member => ({ ...member }));
  const out: ComboMember[] = [];

  while (pool.length > 0) {
    const total = pool.reduce((sum, member) => sum + member.weight, 0);
    let ticket = random() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      ticket -= pool[i]!.weight;
      if (ticket < 0) {
        index = i;
        break;
      }
    }
    out.push(pool[index]!);
    pool.splice(index, 1);
  }

  return out;
}

// Custo 0 (modelo grátis) sempre cabe. Para os pagos a comparação é estrita:
// encostar no limite já conta como ultrapassar, então nunca "estoura por 1¢".
function fitsBudget(costUsd: number, remainingUsd: number, maxCostPerRequestUsd: number): boolean {
  if (costUsd <= 0) return true;
  if (maxCostPerRequestUsd > 0 && costUsd > maxCostPerRequestUsd) return false;
  if (!Number.isFinite(remainingUsd)) return true;
  return costUsd < remainingUsd;
}

export function buildComboCandidates(
  config: ComboConfig,
  options: ComboPickOptions,
): ComboCandidate[] {
  const random = options.random ?? Math.random;
  const out: ComboCandidate[] = [];
  const seen = new Set<string>();

  const push = (model: string, weight: number, source: ComboCandidate['source']): void => {
    const clean = model.trim();
    if (!clean || seen.has(clean)) return;
    const estimate = Math.max(0, options.estimateCost(clean));
    if (!fitsBudget(estimate, options.remainingUsd, config.maxCostPerRequestUsd)) return;
    seen.add(clean);
    out.push({ model: clean, weight, source, estimatedCostUsd: estimate });
  };

  for (const member of weightedOrder(config.members, random)) {
    push(member.model, member.weight, 'member');
  }
  for (const model of config.fallback) {
    push(model, 1, 'fallback');
  }

  return out;
}

/** Erros em que vale a pena "acordar" o provedor antes de trocar de modelo. */
export function isWakeableError(message: string): boolean {
  return /(timed?\s*out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|overloaded|capacity|cold start|starting|no available|rate.?limit|\b429\b|\b502\b|\b503\b|\b504\b)/i.test(
    message,
  );
}

export function comboLabel(config: ComboConfig): string {
  if (!config.enabled) return 'combo off';
  const names = config.members.map(member => member.model).join(' + ') || 'auto';
  return `combo: ${names}`;
}

export function describeCombo(config: ComboConfig): string {
  const lines = [
    `Combo: ${config.enabled ? 'ligado' : 'desligado'}`,
    `Pesos: ${config.members.length > 0
      ? config.members.map(member => `${member.model}=${member.weight}`).join(', ')
      : '(automático: modelos grátis com credencial)'}`,
    `Fallback: ${config.fallback.length > 0 ? config.fallback.join(' → ') : '(cadeia automática)'}`,
    `Teto do combo: ${config.budgetUsd > 0 ? `US$ ${config.budgetUsd.toFixed(2)}` : 'o mesmo dos créditos'}`,
    `Máx. por requisição: ${config.maxCostPerRequestUsd > 0 ? `US$ ${config.maxCostPerRequestUsd.toFixed(4)}` : 'sem teto próprio'}`,
    `Acordar provedor: ${config.wakeRetries} tentativa(s) · ${config.wakeDelayMs} ms`,
  ];
  return lines.join('\n');
}

/** Lê "modelo=peso modelo2=1" digitado na TUI. */
export function parseComboMembersInput(raw: string): ComboMember[] {
  const out: ComboMember[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split(/[\s,;]+/)) {
    const token = chunk.trim();
    if (!token) continue;
    let model = token;
    let weight = 1;
    const eq = token.lastIndexOf('=');
    if (eq > 0) {
      model = token.slice(0, eq).trim();
      const parsed = Number(token.slice(eq + 1).trim());
      if (Number.isFinite(parsed)) {
        if (parsed <= 0) continue; // peso 0 desativa o membro
        weight = parsed;
      }
    }
    if (!model || seen.has(model)) continue;
    seen.add(model);
    out.push({ model, weight });
  }
  return out;
}
