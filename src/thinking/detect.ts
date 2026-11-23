import type { ProviderId, ThinkingEffort } from './types.js';

// Modelos que raciocinam sozinhos, sem nenhum parâmetro
const ALWAYS_ON: RegExp[] = [
  /^o[1-9]/, /\bo3\b/, /\bo4-mini\b/,
  /deepseek-r1/, /deepseek-reasoner/,       // inclui deepseek-r1-distill (Groq)
  /qwq/, /qwen3.*thinking/,
  /gemini-2\.0-flash-thinking/,
];

// Modelos híbridos: só raciocinam quando o provedor envia o parâmetro
const PARAM_CONTROLLED: RegExp[] = [
  /gemini-2\.5/, /gemini-[3-9]/,
  /claude-3-7/, /claude-[4-9]/, /claude-(sonnet|opus|haiku|fable|mythos)-[4-9]/,
  /gpt-5/,
];

// O provedor consegue repassar o parâmetro de raciocínio para esse modelo?
function providerCarriesParams(id: string, provider: ProviderId): boolean {
  switch (provider) {
    case 'openrouter':
    case 'numes':
    case 'nightrouter':
    case 'agentrouter':
    case 'requesty':
    case 'kilo':
    case 'fta':
      return true;
    case 'puter':
      // Puter: GPT-5/o* aceitam reasoning_effort. Claude via Puter não expõe
      // o conteúdo do thinking, então usamos scratchpad para o raciocínio ficar visível.
      return /^(gpt-5|o[1-9])/.test(id);
    case 'proxygatellm':
      return false; // Groq: só os modelos ALWAYS_ON, que não precisam de parâmetro
    case 'echo':
      // Echo: parâmetros de raciocínio ainda não validados no roteador;
      // scratchpad funciona em qualquer modelo, então seguimos por aí.
      return false;
    case 'nvidia':
      // NIM: nenhum modelo atual casa com PARAM_CONTROLLED; scratchpad cobre o resto.
      return false;
    case 'opencode':
      // Zen: parâmetros de raciocínio não validados (conta sem créditos no
      // momento); scratchpad funciona em qualquer dos 4 formatos.
      return false;
    case 'harbor':
      // Harbor: catálogo free apenas; scratchpad cobre.
      return false;
    case 'gemini':
      // API nativa do Gemini: thinkingConfig.thinkingBudget é repassado
      // em src/providers/gemini.ts (estratégia 'native').
      return true;
    case 'notion':
      return false;
    case 'notion_web':
      return false;
    case 'iteracompute':
      // O modelo free exige thinking desligado; scratchpad cobre o resto.
      return false;
    case 'qoder':
      // IDs opacos (qmodel_38max, smodel, ...): scratchpad cobre.
      return false;
    case 'qronos':
    case 'zro':
    case 'unorouter':
      // Gateways OpenAI-compatible; scratchpad cobre todos os modelos sem
      // depender de reasoning_effort por família.
      return false;
    case 'apinex':
      // O gateway aceita reasoning_effort em parte dos modelos; scratchpad
      // é uniforme e evita mandar parâmetro para famílias que o ignoram.
      return false;
    case 'deepai':
      // API de texto sem parâmetros de raciocínio; scratchpad cobre.
      return false;
    case 'vyceai':
      // OpenAI-compatible: suporta reasoning_effort em modelos o1/o3/gpt-4-turbo.
      // Por enquanto, scratchpad Ǹ uniforme para cobertura geral.
      return false;
    default:
      // Provedores customizados: scratchpad cobre sem assumir parâmetros.
      return false;
  }
}

export function supportsNativeReasoning(modelId: string, provider: ProviderId): boolean {
  const id = modelId.trim().toLowerCase();
  const base = id.slice(id.lastIndexOf('/') + 1); // tira o prefixo "openai/", "deepseek/"...
  const hit = (list: RegExp[]): boolean => list.some((re) => re.test(id) || re.test(base));

  if (hit(ALWAYS_ON)) return true;
  // Híbrido sem parâmetro não raciocina: cai em scratchpad silencioso
  return hit(PARAM_CONTROLLED) && providerCarriesParams(id, provider);
}

const OPENAI_EFFORTS: ThinkingEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const WIDELY_SUPPORTED: ThinkingEffort[] = ['low', 'medium', 'high'];
const ANTHROPIC_ADAPTIVE: ThinkingEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Variantes de esforço que o modelo/provedor aceita. Vazio = sem seletor.
export function listThinkingVariants(modelId: string, provider: ProviderId): ThinkingEffort[] {
  if (!supportsNativeReasoning(modelId, provider)) return [];

  const id = modelId.trim().toLowerCase();
  const base = id.slice(id.lastIndexOf('/') + 1);
  const has = (re: RegExp): boolean => re.test(id) || re.test(base);

  const gpt = has(/gpt-5/) || has(/^o[1-9]/);
  const claude = has(/claude/);
  const gemini3 = has(/gemini-[3-9]/);
  const gemini25 = has(/gemini-2\.5/);
  const grokMini = has(/grok-3-mini/);

  switch (provider) {
    case 'openrouter':
    case 'numes':
    case 'nightrouter':
    case 'agentrouter':
    case 'requesty':
    case 'kilo':
    case 'fta':
      if (grokMini) return ['low', 'high'];
      if (gpt || gemini3 || claude) return [...OPENAI_EFFORTS];
      return [];

    case 'gemini':
      if (gemini3) return ['low', 'medium', 'high'];
      if (gemini25) return ['high', 'max'];
      return [];

    case 'echo':
      if (gpt) return [...OPENAI_EFFORTS];
      if (claude) return has(/opus-4\.[67]/) ? [...ANTHROPIC_ADAPTIVE] : [...WIDELY_SUPPORTED];
      if (gemini3) return ['low', 'medium', 'high'];
      if (gemini25) return ['high', 'max'];
      return [];

    case 'puter':
      return gpt ? [...WIDELY_SUPPORTED] : [];

    case 'nvidia':
    case 'opencode':
    case 'harbor':
    case 'notion':
    case 'notion_web':
    case 'iteracompute':
    case 'qoder':
    case 'qronos':
    case 'zro':
    case 'unorouter':
    case 'apinex':
    case 'deepai':
    case 'vyceai':
    case 'proxygatellm':
      return [];
    default:
      return [];
  }
}
