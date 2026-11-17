import type { Complexity, ThinkingConfig, ThinkingStrategy } from './types.js';

const ORDER: Record<Complexity, number> = { trivial: 0, normal: 1, hard: 2 };

export interface StrategyInput {
  enabled: boolean;
  config: Pick<ThinkingConfig, 'mode' | 'minComplexity' | 'maxPasses'>;
  complexity: Complexity;
  native: boolean;
}

// Matriz de estratégia (ver prompt, seção 9)
export function chooseStrategy(input: StrategyInput): ThinkingStrategy {
  const { enabled, config, complexity, native } = input;

  if (!enabled || config.mode === 'off') return 'none';

  if (config.mode === 'auto') {
    if (complexity === 'trivial') return 'none';
    if (ORDER[complexity] < ORDER[config.minComplexity]) return 'none';
  }

  if (native) return 'native'; // nativo nunca recebe diretiva nem two-pass
  if (config.maxPasses === 2 && complexity === 'hard') return 'two-pass';
  return 'scratchpad';
}
