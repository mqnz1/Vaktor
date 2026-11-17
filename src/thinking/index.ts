// API pública do motor de thinking. A UI e o router só consomem este arquivo.
import { estimateComplexity } from './classify.js';
import { supportsNativeReasoning } from './detect.js';
import { extractThinking, stripThinkingTags } from './parse.js';
import { buildThinkingDirective } from './prompt.js';
import { chooseStrategy } from './strategy.js';
import type { ReasoningPart } from '../types/index.js';
import type {
  Complexity,
  ProviderId,
  ThinkingCommand,
  ThinkingConfig,
  ThinkingEffort,
  ThinkingMode,
  ThinkingOptions,
  ThinkingPlan,
  ThinkingResult,
} from './types.js';

export type {
  Complexity, ProviderId, ThinkingCommand, ThinkingConfig, ThinkingEffort, ThinkingMode,
  ThinkingOptions, ThinkingPlan, ThinkingResult, ThinkingStrategy,
} from './types.js';
export { estimateComplexity } from './classify.js';
export { listThinkingVariants, supportsNativeReasoning } from './detect.js';
export { extractThinking, stripThinkingTags } from './parse.js';
export {
  PLAN_MARKER, THINKING_MARKER, THINKING_REMINDER_MARKER, buildPlanBlock, buildThinkingDirective,
  removeBlock, thinkingReminder, upsertBlock, upsertBlockAtStart,
} from './prompt.js';
export { chooseStrategy } from './strategy.js';

export const MIN_BUDGET_TOKENS = 1000;
export const MAX_BUDGET_TOKENS = 32000;
export const DEFAULT_BUDGET_TOKENS = 8000;

const EFFORTS: readonly ThinkingEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
];

export function clampBudget(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BUDGET_TOKENS;
  return Math.min(MAX_BUDGET_TOKENS, Math.max(MIN_BUDGET_TOKENS, Math.round(n)));
}

export function parseThinkingEffort(value: string | undefined): ThinkingEffort | undefined {
  if (!value) return undefined;
  const effort = value.trim().toLowerCase();
  return EFFORTS.includes(effort as ThinkingEffort) ? (effort as ThinkingEffort) : undefined;
}

// Valida valores crus do .env (inválido cai no padrão)
export function normalizeThinkingConfig(raw: {
  enabled: boolean;
  mode: string;
  minComplexity: string;
  budgetTokens: number;
  maxPasses: number;
  show: boolean;
  variant?: string;
}): ThinkingConfig {
  const mode = raw.mode.trim().toLowerCase();
  const min = raw.minComplexity.trim().toLowerCase();
  const variant = parseThinkingEffort(raw.variant);
  return {
    enabled: raw.enabled,
    mode: mode === 'off' || mode === 'always' ? mode : 'auto',
    minComplexity: min === 'trivial' || min === 'hard' ? min : 'normal',
    budgetTokens: clampBudget(raw.budgetTokens),
    maxPasses: raw.maxPasses === 2 ? 2 : 1,
    show: raw.show,
    ...(variant ? { variant } : {}),
  };
}

// Só monta o plano (não chama IA)
export function prepareThinking(
  input: string,
  modelId: string,
  provider: ProviderId,
  config: ThinkingConfig,
  enabled: boolean,
  isTrivial?: (text: string) => boolean, // opcional: isTrivialPrompt do cache
): ThinkingPlan {
  const complexity = estimateComplexity(input, isTrivial);
  const native = supportsNativeReasoning(modelId, provider);
  const strategy = chooseStrategy({ enabled, config, complexity, native });

  if (strategy === 'none') {
    return { strategy, complexity, directive: '', budgetTokens: 0, passes: 1 };
  }
  return {
    strategy,
    complexity,
    directive: buildThinkingDirective(strategy, complexity, config.mode),
    budgetTokens: clampBudget(config.budgetTokens),
    passes: strategy === 'two-pass' ? 2 : 1,
    ...(config.variant ? { variant: config.variant } : {}),
  };
}

// Esforço efetivo: variante explícita vence; senão deriva da complexidade.
export function effortFor(complexity: Complexity, variant?: ThinkingEffort): ThinkingEffort {
  if (variant) return variant;
  return complexity === 'hard' ? 'high' : complexity === 'normal' ? 'medium' : 'low';
}

// Só parseia. Raciocínio nativo (ou o plano do passe 1) tem prioridade.
export function finalizeThinking(
  text: string,
  nativeReasoning: string | undefined,
  plan: ThinkingPlan,
  show: boolean,
): ThinkingResult {
  // Thinking desligado: devolve o texto intocado (comportamento idêntico ao anterior)
  if (plan.strategy === 'none') return { reasoning: '', answer: text, reasoningChars: 0 };

  const parsed = extractThinking(text);
  const native = nativeReasoning?.trim() ?? '';
  const reasoning = native.length > 0 ? native : parsed.reasoning; // sempre calculado (telemetria)
  return {
    reasoning: show ? reasoning : '',
    answer: parsed.answer,
    reasoningChars: reasoning.length,
  };
}

// Opções que os provedores recebem; undefined quando não há thinking
export function toThinkingOptions(plan: ThinkingPlan): ThinkingOptions | undefined {
  if (plan.strategy === 'none') return undefined;
  const effort = effortFor(plan.complexity, plan.variant);
  return {
    strategy: plan.strategy,
    budgetTokens: plan.budgetTokens,
    effort,
    ...(plan.variant ? { variant: plan.variant } : {}),
  };
}

// Chave de cache: thinking nunca compartilha chave com resposta sem thinking
export function cacheVariant(plan: ThinkingPlan): string {
  if (plan.strategy === 'none') return 'plain';
  const base = `thinking:${plan.strategy}:${plan.complexity}:${plan.budgetTokens}`;
  return plan.variant ? `${base}:${plan.variant}` : base;
}

// Texto do rodapé: "think off" | "think auto" | "think on"
export function footerLabel(enabled: boolean, mode: ThinkingMode): string {
  if (!enabled || mode === 'off') return 'think off';
  return mode === 'always' ? 'think on' : 'think auto';
}

export function formatThinkingStatus(enabled: boolean, config: ThinkingConfig): string {
  return [
    `thinking: ${footerLabel(enabled, config.mode).replace('think ', '')}`,
    `mínimo: ${config.minComplexity}`,
    `orçamento: ${config.budgetTokens}`,
    `passes: ${config.maxPasses}`,
    `variante: ${config.variant ?? 'auto'}`,
    `mostrar: ${config.show ? 'sim' : 'não'}`,
  ].join(' | ');
}

// Interpreta os argumentos de "/thinking ..."
export function parseThinkingCommand(args: string): ThinkingCommand {
  const [first = '', second = ''] = args.trim().toLowerCase().split(/\s+/);
  switch (first) {
    case '':
      return { kind: 'status' };
    case 'on':
    case 'off':
    case 'auto':
    case 'show':
    case 'hide':
      return { kind: first };
    case 'budget': {
      const n = Number(second);
      if (second === '' || !Number.isFinite(n)) {
        return { kind: 'invalid', message: 'Uso: /thinking budget <1000-32000>' };
      }
      return { kind: 'budget', value: clampBudget(n) };
    }
    case 'variant': {
      if (second === '' || second === 'auto') return { kind: 'variant', value: 'auto' };
      const effort = parseThinkingEffort(second);
      if (!effort) {
        return {
          kind: 'invalid',
          message: `Variante inválida. Use: ${EFFORTS.join('|')}|auto`,
        };
      }
      return { kind: 'variant', value: effort };
    }
    default:
      return {
        kind: 'invalid',
        message: 'Uso: /thinking [on|off|auto|show|hide|budget N|variant <esforço|auto>]',
      };
  }
}

// Raciocínio pronto para a UI: sem tags e com no máximo maxLines linhas (trunca com "…")
// Remove marcadores de conteúdo criptografado do OpenRouter antes de exibir.
export function cleanReasoning(text: string): string {
  return text.replace(/\[REDACTED\]/g, '').trim();
}

let reasoningSeq = 0;

// Converte texto de raciocínio em partes estruturadas (OpenCode-style).
export function buildReasoningParts(
  text: string,
  options: { startedAt?: number; endedAt?: number; metadata?: Record<string, unknown> } = {},
): ReasoningPart[] {
  const clean = cleanReasoning(text);
  if (clean.length === 0) return [];
  const endedAt = options.endedAt ?? Date.now();
  return [
    {
      id: `reasoning-${++reasoningSeq}`,
      text: clean,
      startedAt: options.startedAt ?? endedAt,
      endedAt,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    },
  ];
}

export function reasoningTextOf(parts: readonly ReasoningPart[] | undefined): string {
  if (!parts || parts.length === 0) return '';
  return parts.map(part => part.text).join('\n\n');
}

export function formatReasoningForDisplay(reasoning: string, maxLines = 12): string {
  const lines = stripThinkingTags(reasoning).split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines).join('\n')}\n…`;
}
