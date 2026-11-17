import type { Complexity } from './types.js';

// Saudação ou confirmação curta
const GREETING =
  /^(oi+|ola|opa|eae|e ai|bom dia|boa tarde|boa noite|hey|hi|hello|ok(ay)?|blz|beleza|valeu|obrigad[oa]|obg|thanks?|thx|sim|nao|certo|entendi|show|top|legal|perfeito|ta|uhum|pode ser|tudo bem)( (claude|vaktor))?[\s!.,?]*$/;

// Termos de tarefa difícil (texto já normalizado; prefixos com \w* evitam falso positivo como "provedor")
const HARD_TERMS =
  /\b(arquitetura|architecture|prove|provar|otimiz\w*|optimiz\w*|compar\w*|trade-?off|refator\w*|refactor\w*|concorr\w*|concurren\w*|seguranca|security|migra\w*|performance)\b/;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// isTrivial: predicado extra opcional (ex.: isTrivialPrompt de src/router/cache.ts)
export function estimateComplexity(input: string, isTrivial?: (text: string) => boolean): Complexity {
  const raw = input.trim();
  const text = normalize(raw);

  if (text.length === 0 || GREETING.test(text)) return 'trivial';

  // Sinais de tarefa difícil
  if (raw.length > 400) return 'hard';
  if (raw.includes('```') || /^( {4}|\t)\S/m.test(input)) return 'hard';
  if (/\bat\s+\S+\s*\(/.test(raw) || /Traceback/.test(raw) || /Error:/.test(raw)) return 'hard';
  const requirements = input.split('\n').filter((l) => /^\s*(?:[-*]|\d+[.)])\s+\S/.test(l)).length;
  if (requirements >= 3) return 'hard';
  if (HARD_TERMS.test(text)) return 'hard';

  if (raw.length < 60 && isTrivial?.(raw) === true) return 'trivial';
  return 'normal';
}
