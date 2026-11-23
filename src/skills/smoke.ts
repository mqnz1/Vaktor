// Teste de fumaça: npx tsx src/skills/smoke.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppMode } from '../types/index.js';
import { dynamicSkillsDir, loadDynamicSkills } from './dynamic.js';
import { SKILLS, buildSkillsPrompt, selectSkills } from './index.js';

interface Case {
  input: string;
  mode: AppMode;
  expect: string[]; // ids esperados, na ordem
}

const cases: Case[] = [
  { input: 'não funciona meu código, dá erro X', mode: 'code', expect: ['core', 'debug'] },
  { input: 'cria uma função que valida CPF', mode: 'code', expect: ['core', 'codegen'] },
  { input: 'refatora esse arquivo, tem muito código duplicado', mode: 'code', expect: ['core', 'refactor'] },
  { input: 'me ajuda a organizar minha semana', mode: 'chat', expect: ['core', 'daily'] },
  { input: 'escreve um e-mail pedindo reembolso', mode: 'chat', expect: ['core', 'writing'] },
  { input: 'quero um plano de estudos para a prova', mode: 'chat', expect: ['core', 'daily'] },
];

let failed = 0;
for (const c of cases) {
  const ctx = { mode: c.mode, workdir: process.cwd() };
  const matches = selectSkills(c.input, ctx);
  const ids = matches.map((m) => m.skill.id);
  const prompt = buildSkillsPrompt(matches, ctx);
  const ok = ids.join('+') === c.expect.join('+') && prompt.length <= 3200;
  if (!ok) failed++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} [${c.mode}] "${c.input}" → ${ids.join(', ')} → ${prompt.length} chars`);
}

// Skill forçada, skill desabilitada, orçamento e duplicação
const base = { mode: 'code' as AppMode, workdir: process.cwd() };
const forced = selectSkills('oi', { ...base, forcedSkillIds: ['debug'] });
const disabled = selectSkills('dá erro no código', { ...base, disabledSkillIds: ['debug'] });
const tiny = buildSkillsPrompt(selectSkills('dá erro, cria uma função', base), base, { maxChars: 900 });
const prompt = buildSkillsPrompt(selectSkills('dá erro, cria uma função', base), base);
const checks: [string, boolean][] = [
  ['/skill debug força a skill', forced.some((m) => m.skill.id === 'debug')],
  ['skill desabilitada não aparece', !disabled.some((m) => m.skill.id === 'debug')],
  ['orçamento pequeno respeitado e core mantida', tiny.length <= 900 && tiny.includes('(core)')],
  ['sem skill duplicada no prompt', (prompt.match(/### SKILL: /g) ?? []).length === new Set(prompt.match(/### SKILL: .*/g) ?? []).size],
  ['catálogo tem 10 skills', SKILLS.length === 10],
];
const emptyProject = mkdtempSync(join(tmpdir(), 'vaktor-skills-'));
try {
  checks.push([
    'skills dinâmicas usam .vaktor/skills',
    dynamicSkillsDir(emptyProject) === join(emptyProject, '.vaktor', 'skills'),
  ]);
  checks.push([
    'carregar skills não cria .vaktor',
    loadDynamicSkills(emptyProject).length === 0
      && !existsSync(join(emptyProject, '.vaktor')),
  ]);
} finally {
  rmSync(emptyProject, { recursive: true, force: true });
}
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}`);
}

process.exitCode = failed === 0 ? 0 : 1;
