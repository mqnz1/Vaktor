// Tipos e contratos do motor de thinking
export type ThinkingMode = 'off' | 'auto' | 'always';
export type ThinkingStrategy = 'none' | 'native' | 'scratchpad' | 'two-pass';
export type Complexity = 'trivial' | 'normal' | 'hard';
// Esforço aceito pelos provedores. 'auto' = derivado da complexidade.
export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ProviderId = 'puter' | 'agentrouter' | 'openrouter' | 'numes' | 'nightrouter' | 'requesty' | 'kilo' | 'fta' | 'proxygatellm' | 'echo' | 'nvidia' | 'opencode' | 'harbor' | 'gemini' | 'notion' | 'notion_web' | 'iteracompute' | 'qoder' | 'apinex' | 'deepai' | 'vyceai' | 'qronos';

export interface ThinkingConfig {
  enabled: boolean;
  mode: ThinkingMode;
  minComplexity: Complexity;
  budgetTokens: number;
  maxPasses: 1 | 2;
  show: boolean;
  /** Variante explícita (low/medium/high/xhigh/max); ausente = auto. */
  variant?: ThinkingEffort;
}

export interface ThinkingPlan {
  strategy: ThinkingStrategy;
  complexity: Complexity;
  directive: string;      // '' quando não há nada a injetar (none/native)
  budgetTokens: number;   // 0 quando strategy === 'none'
  passes: number;         // 1 ou 2
  variant?: ThinkingEffort;
}

// O que os provedores recebem (nunca existe para strategy 'none')
export interface ThinkingOptions {
  strategy: Exclude<ThinkingStrategy, 'none'>;
  budgetTokens: number;
  effort: ThinkingEffort;
  variant?: ThinkingEffort;
}

// Retorno de finalizeThinking (reasoningChars serve de telemetria mesmo com show=false)
export interface ThinkingResult {
  reasoning: string;
  answer: string;
  reasoningChars: number;
}

// Resultado do parser de /thinking <args>
export type ThinkingCommand =
  | { kind: 'status' }
  | { kind: 'on' | 'off' | 'auto' | 'show' | 'hide' }
  | { kind: 'budget'; value: number }
  | { kind: 'variant'; value: ThinkingEffort | 'auto' }
  | { kind: 'invalid'; message: string };
