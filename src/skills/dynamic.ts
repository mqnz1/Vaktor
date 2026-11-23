// =============================================================
// Skills auto-evolutivas em `.vaktor/skills/*.md`.
//
// Formato (frontmatter simples, sem dependências):
// ---
// id: nome-kebab
// name: Nome
// description: uma linha
// category: code
// appliesTo: code, chat
// triggers: palavra, frase
// priority: 60
// ---
// Prompt da skill...
// =============================================================
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vaktorWorkspacePaths } from '../orchestrator/workspace.js';
import type { AppMode } from '../types/index.js';
import type { Skill, SkillCategory } from './types.js';

const VALID_CATEGORIES: readonly SkillCategory[] = [
  'core', 'code', 'debug', 'review', 'refactor', 'test', 'architecture', 'git', 'daily', 'writing',
];

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { meta: {}, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: normalized };
  const header = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  const meta: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key && value) meta[key] = value;
  }
  return { meta, body };
}

function parseSkill(file: string, text: string): Skill | null {
  const { meta, body } = parseFrontmatter(text);
  const id = (meta.id ?? file.replace(/\.md$/i, '')).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!id || !body.trim()) return null;
  const category = VALID_CATEGORIES.includes((meta.category ?? '') as SkillCategory)
    ? (meta.category as SkillCategory)
    : 'code';
  const appliesTo = parseList(meta.appliesto ?? meta['applies-to'] ?? 'code, chat')
    .filter((mode): mode is AppMode => mode === 'chat' || mode === 'code');
  const priority = Number.parseInt(meta.priority ?? '50', 10);
  return {
    id,
    name: (meta.name ?? id).trim(),
    description: (meta.description ?? 'Skill aprendida do projeto.').trim(),
    category,
    appliesTo: appliesTo.length > 0 ? appliesTo : ['chat', 'code'],
    triggers: parseList(meta.triggers),
    priority: Number.isFinite(priority) ? Math.max(0, Math.min(100, priority)) : 50,
    prompt: body.trim().slice(0, 4000),
    constraints: parseList(meta.constraints),
  };
}

export function dynamicSkillsDir(workdir: string): string {
  return vaktorWorkspacePaths(workdir).skillsDir;
}

export function loadDynamicSkills(workdir: string): Skill[] {
  const dir = dynamicSkillsDir(workdir);
  if (!existsSync(dir)) return [];
  const skills: Skill[] = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!file.toLowerCase().endsWith('.md')) continue;
      try {
        const skill = parseSkill(file, readFileSync(join(dir, file), 'utf8'));
        if (skill) skills.push(skill);
      } catch {
        // skill inválida não derruba o carregamento
      }
    }
  } catch {
    return [];
  }
  return skills;
}

export interface DynamicSkillInput {
  id: string;
  name: string;
  description: string;
  category?: SkillCategory;
  appliesTo?: AppMode[];
  triggers?: string[];
  priority?: number;
  prompt: string;
  constraints?: string[];
}

export function writeDynamicSkill(workdir: string, input: DynamicSkillInput): string {
  const id = input.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60) || 'skill';
  const dir = dynamicSkillsDir(workdir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.md`);
  const body = [
    '---',
    `id: ${id}`,
    `name: ${input.name.replace(/\n/g, ' ').trim()}`,
    `description: ${input.description.replace(/\n/g, ' ').trim()}`,
    `category: ${input.category ?? 'code'}`,
    `appliesTo: ${(input.appliesTo ?? ['chat', 'code']).join(', ')}`,
    `triggers: ${(input.triggers ?? []).join(', ')}`,
    `priority: ${input.priority ?? 60}`,
    ...(input.constraints && input.constraints.length > 0
      ? [`constraints: ${input.constraints.join(', ')}`]
      : []),
    '---',
    '',
    input.prompt.trim(),
    '',
  ].join('\n');
  writeFileSync(path, body, 'utf8');
  return path;
}
