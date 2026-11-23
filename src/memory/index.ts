// =============================================================
// Memória de projeto (VAKTOR.md).
//
// O arquivo é criado por `/memory add` ou por `ensureVaktorWorkspace`
// quando o orquestrador é ativado. O conteúdo é sanitizado antes de ser
// gravado/lido.
// =============================================================
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const DEFAULT_FILE = 'VAKTOR.md';
const MAX_MEMORY_TEXT = 2000;

export function memoryFileName(fileName = DEFAULT_FILE): string {
  const clean = basename(fileName.trim());
  if (!clean || clean === '.' || clean === '..') return DEFAULT_FILE;
  return clean;
}

export function memoryPath(workdir: string, fileName = DEFAULT_FILE): string {
  return join(workdir, memoryFileName(fileName));
}

export function hasMemory(workdir: string, fileName = DEFAULT_FILE): boolean {
  return existsSync(memoryPath(workdir, fileName));
}

export function sanitizeMemoryText(text: string, maxChars = MAX_MEMORY_TEXT): string {
  const clean = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/ghp_[A-Za-z0-9]{8,}/g, '[REDACTED]')
    .replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\/(?:home|Users)\/[^\s]+/g, '[path]')
    .trim();
  return clean.slice(0, maxChars);
}

export function loadProjectMemory(
  workdir: string,
  maxChars = 4000,
  fileName = DEFAULT_FILE,
): string {
  const path = memoryPath(workdir, fileName);
  if (!existsSync(path)) return '';
  try {
    const text = sanitizeMemoryText(readFileSync(path, 'utf8'), Math.max(maxChars, 2000));
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 28))}\n… (memória truncada)`;
  } catch {
    return '';
  }
}

/**
 * Instruções do projeto para o agente: VAKTOR.md (regras globais e
 * decisões acumuladas). Mantém `loadProjectMemory` separado para
 * RESOURCES.md não herdar as regras do projeto.
 */
export function loadProjectInstructions(
  workdir: string,
  maxChars = 4000,
  fileName = DEFAULT_FILE,
): string {
  const vaktor = loadProjectMemory(workdir, maxChars, fileName);
  if (!vaktor) return '';
  const combined = `### ${memoryFileName(fileName)}\n${vaktor}`;
  return combined.length > maxChars
    ? `${combined.slice(0, Math.max(0, maxChars - 24))}\n[...] (truncado)`
    : combined;
}

function normalizeSection(section: string): string {
  const clean = section.replace(/[^\p{L}\p{N} _-]/gu, '').trim();
  return clean.length > 0 ? clean.slice(0, 80) : 'Decisões';
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Acrescenta uma entrada em uma seção. Retorna true se gravou algo novo.
 * Chamado apenas por comando explícito do usuário.
 */
export function appendMemory(
  workdir: string,
  section: string,
  text: string,
  fileName = DEFAULT_FILE,
): boolean {
  const cleanText = sanitizeMemoryText(text);
  if (!cleanText) return false;

  const path = memoryPath(workdir, fileName);
  const bullet = `- ${dateStamp()} — ${cleanText}`;
  const title = normalizeSection(section);

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# VAKTOR\n\n## ${title}\n${bullet}\n`, 'utf8');
    return true;
  }

  const existing = readFileSync(path, 'utf8');
  if (existing.includes(cleanText)) return false;

  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const heading = `## ${title}`;
  const normalized = existing.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const index = lines.findIndex(line => line.trim().toLowerCase() === heading.toLowerCase());

  if (index === -1) {
    const suffix = normalized.endsWith('\n') ? '' : '\n';
    appendFileSync(path, `${suffix}\n${heading}\n${bullet}\n`, 'utf8');
    return true;
  }

  let insertAt = index + 1;
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('## ')) break;
    if (line.trim().length > 0) insertAt = i + 1;
  }
  lines.splice(insertAt, 0, bullet);
  const next = lines.join('\n').replace(/\n/g, eol);
  writeFileSync(path, next, 'utf8');
  return true;
}
