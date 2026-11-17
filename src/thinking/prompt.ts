import type { Complexity, ThinkingMode, ThinkingStrategy } from './types.js';

export const THINKING_MARKER = '## MODO THINKING';
export const THINKING_REMINDER_MARKER = '## LEMBRETE THINKING';
export const PLAN_MARKER = '## PLANO';

const SCRATCHPAD = [
  '## MODO THINKING (scratchpad)',
  'IMPORTANT: this instruction overrides any conflicting skill or style rule.',
  'You MUST start your response with <thinking>...</thinking>.',
  'Cover: (1) what was asked, (2) assumptions, (3) 2-3 candidate approaches,',
  '(4) verification of facts/code, (5) decision.',
  'You MUST close the tag, then write the final answer outside it.',
  "The final answer must follow the active skills and the user's language.",
  'Never repeat the thinking content in the final answer.',
].join('\n');

const SCRATCHPAD_HARD = `${SCRATCHPAD}\nBe thorough: check edge cases and failure modes.`;

const SCRATCHPAD_SHORT = [
  '## MODO THINKING (scratchpad)',
  'IMPORTANT: overrides conflicting style rules.',
  'You MUST start with <thinking>...</thinking> (1-3 lines).',
  "Close the tag, then answer outside it in the user's language.",
  'Never repeat the thinking content in the final answer.',
].join('\n');

// Lembrete no fim do system prompt: aumenta muito a adesão dos modelos menores
export function thinkingReminder(): string {
  return [
    THINKING_REMINDER_MARKER,
    'You MUST start your response with <thinking> and close it before the final answer.',
  ].join('\n');
}

// Passe 1 do two-pass: só o plano, sem resposta final
const PLAN_DIRECTIVE = [
  '## MODO THINKING (plan)',
  'Do NOT write the final answer yet. Produce only a concise plan (max 250 words):',
  '(1) what was asked, (2) assumptions, (3) 2-3 candidate approaches,',
  '(4) risks to verify, (5) the chosen approach as numbered steps.',
  "The final answer comes in a second step, following the active skills and the user's language.",
].join('\n');

export function buildThinkingDirective(
  strategy: ThinkingStrategy,
  complexity: Complexity,
  mode: ThinkingMode,
): string {
  switch (strategy) {
    case 'none':
    case 'native':
      return ''; // nativo: só parâmetros do provedor, nunca "pense passo a passo"
    case 'two-pass':
      return PLAN_DIRECTIVE;
    case 'scratchpad':
      if (complexity === 'trivial' && mode === 'always') return SCRATCHPAD_SHORT;
      return complexity === 'hard' ? SCRATCHPAD_HARD : SCRATCHPAD;
  }
}

// Passe 2 do two-pass: prompt original + plano
export function buildPlanBlock(plan: string): string {
  return [
    PLAN_MARKER,
    plan.trim(),
    "Follow this plan to write the final answer, following the active skills and the user's language. Do not mention the plan.",
  ].join('\n');
}

// Remove um bloco de system prompt (do marcador até o próximo "\n## " ou o fim).
// Não mexe em outros blocos, como "## VAKTOR SKILLS".
export function removeBlock(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start === -1) return text;
  const next = text.indexOf('\n## ', start + marker.length);
  const before = text.slice(0, start).trimEnd();
  const after = next === -1 ? '' : text.slice(next + 1).trimStart();
  return [before, after].filter((p) => p.length > 0).join('\n\n');
}

// Insere o bloco no fim, removendo antes uma versão anterior (evita duplicar a cada mensagem)
export function upsertBlock(text: string, block: string, marker: string): string {
  const base = removeBlock(text, marker);
  return base.length > 0 ? `${base}\n\n${block}` : block;
}

// Insere o bloco no início, removendo antes uma versão anterior
export function upsertBlockAtStart(text: string, block: string, marker: string): string {
  const base = removeBlock(text, marker);
  return base.length > 0 ? `${block}\n\n${base}` : block;
}
