// Tipos do sistema de Skills do Vaktor
import type { AppMode } from '../types/index.js';

export type SkillCategory =
  | 'core' | 'code' | 'debug' | 'review' | 'refactor'
  | 'test' | 'architecture' | 'git' | 'daily' | 'writing';

export interface SkillExample {
  input: string;
  behavior: string;
}

export interface Skill {
  id: string;                       // kebab-case, único
  name: string;
  description: string;              // 1 linha, usada no /skills
  category: SkillCategory;
  appliesTo: AppMode[];             // ['chat'], ['code'] ou ambos
  triggers: string[];               // palavras/frases, sem acento, minúsculas
  patterns?: RegExp[];              // detecção de intenção (texto já normalizado)
  priority: number;                 // 0-100, desempate
  prompt: string;                   // instruções injetadas no system prompt
  constraints?: string[];           // guardrails específicos
  examples?: SkillExample[];
}

export interface SkillContext {
  mode: AppMode;
  workdir: string;
  forcedSkillIds?: string[];
  disabledSkillIds?: string[];
}

export interface SkillMatch {
  skill: Skill;
  score: number;
  reasons: string[];
}

// Opções vindas da config (ENABLE_SKILLS e afins)
export interface SelectOptions {
  maxSkills?: number;
}

export interface BuildOptions {
  maxChars?: number;
}
