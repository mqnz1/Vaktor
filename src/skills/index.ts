// API pública do sistema de Skills do Vaktor.
// A UI e o router só consomem este arquivo.
import type { BuildOptions, SelectOptions, Skill, SkillContext, SkillMatch } from './types.js';
import { core } from './builtin/core.js';
import { codegen } from './builtin/codegen.js';
import { debug } from './builtin/debug.js';
import { review } from './builtin/review.js';
import { refactor } from './builtin/refactor.js';
import { tests } from './builtin/tests.js';
import { architecture } from './builtin/architecture.js';
import { git } from './builtin/git.js';
import { daily } from './builtin/daily.js';
import { writing } from './builtin/writing.js';
import { loadDynamicSkills } from './dynamic.js';

export type { BuildOptions, SelectOptions, Skill, SkillCategory, SkillContext, SkillExample, SkillMatch } from './types.js';

export const CORE_SKILL_ID = 'core';
export const SKILLS_MARKER = '## VAKTOR SKILLS';
export const MAX_SKILL_PROMPT_CHARS = 3200;
export const MAX_SKILLS_PER_REQUEST = 3; // core + 2

const CORE_SCORE = 10_000; // peso fixo: core nunca perde posição nem é cortada
const FORCED_SCORE = Number.MAX_SAFE_INTEGER;

const GLOBAL_RULES = [
  '## REGRAS GLOBAIS',
  '- Responda no idioma do usuário.',
  '- Código completo, sem "..." nem placeholders.',
  '- Explique decisões em 1-2 linhas.',
  '- Nunca invente APIs, funções ou flags; se não souber, diga.',
].join('\n');

const BASE_SKILLS: readonly Skill[] = [
  core, codegen, debug, review, refactor, tests, architecture, git, daily, writing,
];

let DYNAMIC_SKILLS: Skill[] = [];
export let SKILLS: readonly Skill[] = [...BASE_SKILLS];

export function refreshDynamicSkills(workdir: string): void {
  try {
    const dynamic = loadDynamicSkills(workdir);
    DYNAMIC_SKILLS = dynamic;
    SKILLS = [...BASE_SKILLS, ...dynamic];
  } catch {
    // skills dinâmicas são opcionais
  }
}

export function dynamicSkills(): readonly Skill[] {
  return DYNAMIC_SKILLS;
}

export function getSkillById(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

// Minúsculas e sem acento (feito uma única vez por entrada)
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cache das regexes de trigger (palavra/frase inteira, sem falso positivo de substring)
const triggerCache = new Map<string, RegExp>();

function hasTerm(text: string, term: string): boolean {
  let re = triggerCache.get(term);
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'u');
    triggerCache.set(term, re);
  }
  return re.test(text);
}

export function selectSkills(input: string, ctx: SkillContext, opts: SelectOptions = {}): SkillMatch[] {
  const maxSkills = Math.max(1, Math.floor(opts.maxSkills ?? MAX_SKILLS_PER_REQUEST));
  const text = normalizeText(input);
  const forced = new Set(ctx.forcedSkillIds ?? []);
  const disabled = new Set(ctx.disabledSkillIds ?? []);

  const coreSkill = getSkillById(CORE_SKILL_ID);
  const result: SkillMatch[] = [];
  if (coreSkill) {
    result.push({ skill: coreSkill, score: CORE_SCORE, reasons: ['sempre ativa'] });
  }

  const candidates: SkillMatch[] = [];
  for (const skill of SKILLS) {
    if (skill.id === CORE_SKILL_ID) continue;

    // Forçada vence tudo (inclusive "desabilitada")
    if (forced.has(skill.id)) {
      candidates.push({ skill, score: FORCED_SCORE, reasons: ['forçada pelo usuário'] });
      continue;
    }
    if (disabled.has(skill.id)) continue; // equivale ao -1000: nunca passa do corte

    const reasons: string[] = [];
    let score = 0;

    for (const trigger of skill.triggers) {
      if (hasTerm(text, trigger)) {
        score += 3;
        reasons.push(`trigger: ${trigger}`);
      }
    }
    for (const pattern of skill.patterns ?? []) {
      if (pattern.test(text)) {
        score += 4;
        reasons.push(`pattern: ${pattern.source.slice(0, 40)}`);
      }
    }

    // Sem nenhum sinal real no texto, não entra (evita que o bônus de modo selecione tudo)
    if (score <= 0) continue;

    if (skill.appliesTo.includes(ctx.mode)) score += 2;
    score += skill.priority / 100; // desempate

    candidates.push({ skill, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score || b.skill.priority - a.skill.priority || a.skill.id.localeCompare(b.skill.id));
  result.push(...candidates.slice(0, maxSkills - 1));
  return result;
}

function renderSkill(skill: Skill, withExample: boolean): string {
  const lines: string[] = [`### SKILL: ${skill.name} (${skill.id})`, skill.prompt.trim()];
  if (skill.constraints && skill.constraints.length > 0) {
    lines.push('Restrições:', ...skill.constraints.map((c) => `- ${c}`));
  }
  const example = skill.examples?.[0];
  if (withExample && example) {
    lines.push(`Exemplo: "${example.input}" → ${example.behavior}`);
  }
  return lines.join('\n');
}

function assemble(matches: SkillMatch[], ctx: SkillContext, withExample: boolean): string {
  const ids = matches.map((m) => m.skill.id).join(', ');
  const parts = [
    `${SKILLS_MARKER}\nAtivas: ${ids} | modo: ${ctx.mode}`,
    ...matches.map((m) => renderSkill(m.skill, withExample)),
    GLOBAL_RULES,
  ];
  return parts.join('\n\n');
}

export function buildSkillsPrompt(matches: SkillMatch[], ctx: SkillContext, opts: BuildOptions = {}): string {
  if (matches.length === 0) return '';
  const maxChars = Math.max(200, Math.floor(opts.maxChars ?? MAX_SKILL_PROMPT_CHARS));

  // Remove duplicatas por id, mantendo a primeira ocorrência
  const seen = new Set<string>();
  let kept = matches.filter((m) => (seen.has(m.skill.id) ? false : (seen.add(m.skill.id), true)));

  let out = assemble(kept, ctx, true);
  if (out.length <= maxChars) return out;

  // 1) tira os exemplos
  out = assemble(kept, ctx, false);

  // 2) remove as skills de menor score (nunca a core)
  while (out.length > maxChars) {
    const droppable = kept.filter((m) => m.skill.id !== CORE_SKILL_ID);
    if (droppable.length === 0) break;
    const lowest = droppable.reduce((a, b) => (b.score < a.score ? b : a));
    kept = kept.filter((m) => m !== lowest);
    out = assemble(kept, ctx, false);
  }

  // 3) último recurso: só a core, sem restrições, e corte duro
  if (out.length > maxChars) {
    const only = kept.map((m) => ({ ...m, skill: { ...m.skill, constraints: [] } }));
    out = assemble(only, ctx, false);
  }
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

// Remove um bloco de skills já injetado (o bloco sempre fica no fim do system prompt)
export function stripSkillsBlock(text: string): string {
  const i = text.indexOf(SKILLS_MARKER);
  return i === -1 ? text : text.slice(0, i).trimEnd();
}
