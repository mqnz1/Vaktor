// =============================================================
// JAILBREAK.md: instruções persistentes aplicadas a todas as conversas.
//
// O arquivo é procurado primeiro no workdir e, se não existir, na raiz
// da instalação. O conteúdo passa pela mesma redação de segredos usada
// pela memória. As instruções ajustam tom, formato e fluxo de trabalho,
// mas não substituem segurança, confirmação de ações irreversíveis ou
// limites de orçamento.
// =============================================================
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryFileName, sanitizeMemoryText } from '../memory/index.js';

export const DEFAULT_JAILBREAK_FILE = 'JAILBREAK.md';
export const JAILBREAK_MARKER = '## MODO DIRETO (JAILBREAK.md)';

const MAX_JAILBREAK_TEXT = 4000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function jailbreakFileName(fileName: string = DEFAULT_JAILBREAK_FILE): string {
  const trimmed = fileName.trim();
  if (!trimmed) return DEFAULT_JAILBREAK_FILE;
  return memoryFileName(trimmed);
}

export function jailbreakPath(
  workdir: string,
  fileName: string = DEFAULT_JAILBREAK_FILE,
): string {
  return join(workdir, jailbreakFileName(fileName));
}

// Caminho efetivamente usado (workdir tem prioridade sobre a instalação).
export function resolveJailbreakFile(
  workdir: string,
  fileName: string = DEFAULT_JAILBREAK_FILE,
): string | null {
  const name = jailbreakFileName(fileName);
  for (const candidate of [join(workdir, name), join(ROOT, name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readProfile(path: string, maxChars: number): string {
  try {
    const text = sanitizeMemoryText(readFileSync(path, 'utf8'), Math.max(maxChars, 2000));
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 26))}\n[...] (JAILBREAK.md truncado)`;
  } catch {
    return '';
  }
}

export function loadJailbreakProfile(
  workdir: string,
  maxChars = MAX_JAILBREAK_TEXT,
  fileName: string = DEFAULT_JAILBREAK_FILE,
): string {
  const path = resolveJailbreakFile(workdir, fileName);
  if (!path) return '';
  return readProfile(path, maxChars);
}

export function buildJailbreakBlock(profile: string): string {
  const body = profile.trim();
  if (!body) return '';
  return [
    JAILBREAK_MARKER,
    'Instruções persistentes do usuário. Aplique no tom, no formato e no fluxo de trabalho.',
    'Elas não substituem as regras de segurança, a confirmação de ações irreversíveis nem os limites de orçamento.',
    '',
    body,
  ].join('\n');
}
