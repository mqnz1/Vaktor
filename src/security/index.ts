// =============================================================
// Perfil de segurança (SECURITY.md).
//
// Um arquivo de texto opcional que ajusta tom e escopo das respostas
// em segurança ofensiva/defensiva e redes. NÃO é um "jailbreak":
// o próprio conteúdo define os limites (autorizado/educacional) e
// este módulo apenas injeta o texto no system prompt. O texto passa
// pela mesma redação de segredos da memória.
//
// Procura o arquivo primeiro no workdir do usuário e, se não existir,
// no diretório de instalação do Vaktor (default embarcado).
// =============================================================
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryFileName, sanitizeMemoryText } from '../memory/index.js';

export const DEFAULT_SECURITY_FILE = 'SECURITY.md';
export const SECURITY_MARKER = '## PERFIL DE SEGURANÇA';

const MAX_SECURITY_TEXT = 4000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function securityFileName(fileName: string = DEFAULT_SECURITY_FILE): string {
  const trimmed = fileName.trim();
  if (!trimmed) return DEFAULT_SECURITY_FILE;
  return memoryFileName(trimmed);
}

export function securityPath(workdir: string, fileName: string = DEFAULT_SECURITY_FILE): string {
  return join(workdir, securityFileName(fileName));
}

// Caminho efetivamente usado (workdir tem prioridade sobre a instalação).
export function resolveSecurityFile(
  workdir: string,
  fileName: string = DEFAULT_SECURITY_FILE,
): string | null {
  const name = securityFileName(fileName);
  for (const candidate of [join(workdir, name), join(ROOT, name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readProfile(path: string, maxChars: number): string {
  try {
    const text = sanitizeMemoryText(readFileSync(path, 'utf8'), Math.max(maxChars, 2000));
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 30))}\n… (perfil de segurança truncado)`;
  } catch {
    return '';
  }
}

export function loadSecurityProfile(
  workdir: string,
  maxChars = MAX_SECURITY_TEXT,
  fileName: string = DEFAULT_SECURITY_FILE,
): string {
  const path = resolveSecurityFile(workdir, fileName);
  if (!path) return '';
  return readProfile(path, maxChars);
}

// Bloco pronto para o system prompt. O marcador permite reinserir sem duplicar.
export function buildSecurityBlock(profile: string): string {
  const body = profile.trim();
  if (!body) return '';
  return [
    SECURITY_MARKER,
    'Perfil configurado pelo usuário para temas de segurança e redes. Aplique no tom e no nível de detalhe técnico.',
    'Os limites definidos neste perfil e as regras de segurança do sistema continuam valendo integralmente.',
    '',
    body,
  ].join('\n');
}
