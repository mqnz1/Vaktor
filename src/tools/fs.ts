// =============================================================
// Ferramentas de arquivo: list_dir, read_file, write_file, apply_patch
//
// Segurança:
//  - todo path é resolvido com realpath e confinado ao workdir;
//  - .env/chaves/.git/config nunca são lidos;
//  - escrita exige leitura prévia (arquivo existente) e confirmação;
//  - conteúdo binário e arquivos grandes são recusados.
// =============================================================
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import type { ToolContext, ToolResult, ToolSpec } from './types.js';
import type { PendingConfirm } from '../agent/types.js';
import { clamp, getNumber, getString } from './args.js';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.cache', '.turbo', '.vaktor', '.idea', '.vscode',
]);

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

function ok(output: string, meta?: ToolResult['meta']): ToolResult {
  return meta ? { ok: true, output, meta } : { ok: true, output };
}

export function truncateOutput(text: string, max: number, mode: 'start' | 'end' = 'end'): string {
  if (text.length <= max) return text;
  const removed = text.length - max;
  const marker = `\n[... truncado: ${removed} caracteres ...]\n`;
  const budget = Math.max(0, max - marker.length);
  return mode === 'start'
    ? text.slice(0, budget) + marker
    : marker + text.slice(-budget);
}

export function preview(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/');
}

function within(base: string, target: string): boolean {
  const b = process.platform === 'win32' ? base.toLowerCase() : base;
  const t = process.platform === 'win32' ? target.toLowerCase() : target;
  return t === b || t.startsWith(b + sep);
}

/**
 * Resolve um path relativo ao workdir e garante que o alvo real (seguindo
 * symlinks) continua dentro dele. Também funciona para arquivos que ainda
 * não existem, resolvendo o ancestral existente mais próximo.
 */
export function resolveInside(workdir: string, input: string): string {
  if (input.length === 0) throw new Error('path vazio');
  if (input.includes('\0')) throw new Error('path contém byte nulo');

  const base = realpathSync(workdir);
  const target = resolve(base, input);

  let realTarget: string;
  if (existsSync(target)) {
    realTarget = realpathSync(target);
  } else {
    let parent = dirname(target);
    while (!existsSync(parent) && parent !== dirname(parent)) {
      parent = dirname(parent);
    }
    const realParent = realpathSync(parent);
    realTarget = resolve(realParent, relative(parent, target));
  }

  if (!within(base, realTarget)) {
    throw new Error(`path fora do diretório de trabalho: ${input}`);
  }
  return realTarget;
}

export function relativeToWorkdir(workdir: string, absolute: string): string {
  return normalizeRel(relative(realpathSync(workdir), absolute));
}

export function isBlockedRead(relPath: string): boolean {
  const rel = normalizeRel(relPath).toLowerCase();
  const name = basename(rel);
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (name === '.key' || name.endsWith('.pem') || name.endsWith('.key')) return true;
  if (name.startsWith('id_rsa') || name.startsWith('id_ed25519')) return true;
  if (name === '.npmrc' || name === '.git-credentials') return true;
  if (rel === '.git/config' || rel.endsWith('/.git/config')) return true;
  return false;
}

export function isBlockedWrite(relPath: string): boolean {
  const rel = normalizeRel(relPath).toLowerCase();
  if (isBlockedRead(rel)) return true;
  if (rel === '.git' || rel.startsWith('.git/')) return true;
  if (rel === 'node_modules' || rel.startsWith('node_modules/')) return true;
  if (rel === '.vaktor' || rel.startsWith('.vaktor/')) return true;
  return false;
}

function readTextFile(absolute: string, maxBytes: number): string {
  const stat = statSync(absolute);
  if (!stat.isFile()) throw new Error('não é um arquivo regular');
  if (stat.size > maxBytes) {
    throw new Error(`arquivo grande demais (${stat.size} > ${maxBytes} bytes)`);
  }
  const buffer = readFileSync(absolute);
  const probe = buffer.subarray(0, Math.min(8192, buffer.length));
  if (probe.includes(0)) throw new Error('arquivo binário; leitura recusada');
  return buffer.toString('utf8');
}

function countLines(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    map.set(line, (map.get(line) ?? 0) + 1);
  }
  return map;
}

function diffStats(oldText: string, newText: string): { added: number; removed: number } {
  const oldCounts = countLines(oldText);
  const newCounts = countLines(newText);
  let added = 0;
  let removed = 0;

  for (const [line, count] of oldCounts) {
    const inNew = newCounts.get(line) ?? 0;
    if (inNew < count) removed += count - inNew;
  }
  for (const [line, count] of newCounts) {
    const inOld = oldCounts.get(line) ?? 0;
    if (inOld < count) added += count - inOld;
  }
  return { added, removed };
}

function buildWriteDiff(path: string, oldText: string, newText: string): string {
  const { added, removed } = diffStats(oldText, newText);
  const previewLines = newText.split(/\r?\n/).slice(0, 12).map(line => `+${line}`);
  return [`--- a/${path}`, `+++ b/${path}`, `+${added} -${removed}`, ...previewLines].join('\n');
}

function buildPatchDiff(path: string, search: string, replacement: string): string {
  const minus = search.split(/\r?\n/).slice(0, 12).map(line => `-${line}`);
  const plus = replacement.split(/\r?\n/).slice(0, 12).map(line => `+${line}`);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `+${plus.length} -${minus.length}`,
    ...minus,
    ...plus,
  ].join('\n');
}

// Confirmação obrigatória: usada por TODA ação irreversível (install, commit,
// push, pr). Diferente de escrita de arquivo, aqui `autoApprove` NÃO pula.
export async function requireConfirm(
  ctx: ToolContext,
  pending: PendingConfirm,
): Promise<boolean> {
  if (!ctx.confirmAction) {
    throw new Error('confirmação indisponível nesta sessão; rode pela TUI');
  }
  return ctx.confirmAction(pending);
}

export async function confirmWrite(
  ctx: ToolContext,
  path: string,
  kind: 'create' | 'overwrite' | 'patch',
  diff: string,
): Promise<boolean> {
  if (ctx.autoApprove) return true;
  return requireConfirm(ctx, {
    kind,
    title: `Confirmar ${kind} em ${path}`,
    detail: diff,
    path,
  });
}

export const listDirTool: ToolSpec = {
  name: 'list_dir',
  description: 'Lista arquivos e diretórios dentro do projeto.',
  parameters: {
    path: 'diretório relativo ao projeto (padrão: ".")',
    depth: 'profundidade 1-3 (padrão: 1)',
  },
  destructive: false,
  run: (args, ctx) => {
    try {
      const input = getString(args, 'path', false) ?? '.';
      const maxDepth = clamp(Math.floor(getNumber(args, 'depth', 1)), 1, 3);
      const absolute = resolveInside(ctx.workdir, input);
      const stat = statSync(absolute);
      if (!stat.isDirectory()) return fail(`${input} não é um diretório`);

      const lines: string[] = [];
      let count = 0;
      const maxEntries = 200;

      const walk = (dir: string, depth: number, prefix: string): void => {
        if (count >= maxEntries) return;
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter(entry => !entry.isSymbolicLink())
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        for (const entry of entries) {
          if (count >= maxEntries) {
            lines.push('... (truncado em 200 entradas)');
            return;
          }
          if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

          const full = resolve(dir, entry.name);
          const rel = relativeToWorkdir(ctx.workdir, full);
          if (isBlockedRead(rel)) continue;

          const suffix = entry.isDirectory() ? '/' : '';
          lines.push(`${prefix}${entry.name}${suffix}`);
          count++;
          if (entry.isDirectory() && depth < maxDepth) {
            walk(full, depth + 1, `${prefix}  `);
          }
        }
      };

      walk(absolute, 1, '');
      const output = truncateOutput(lines.join('\n') || '(vazio)', ctx.maxOutputChars, 'start');
      return ok(output, { matches: count });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};

export const readFileTool: ToolSpec = {
  name: 'read_file',
  description: 'Lê um arquivo de texto com numeração de linhas.',
  parameters: {
    path: 'arquivo relativo ao projeto',
    start: 'linha inicial 1-based (opcional)',
    end: 'linha final 1-based (opcional)',
  },
  destructive: false,
  run: (args, ctx) => {
    try {
      const input = getString(args, 'path');
      if (!input) return fail('path obrigatório');
      const absolute = resolveInside(ctx.workdir, input);
      const rel = relativeToWorkdir(ctx.workdir, absolute);
      if (isBlockedRead(rel)) return fail(`leitura bloqueada por segurança: ${rel}`);

      const text = readTextFile(absolute, ctx.maxFileBytes);
      const lines = text.split(/\r?\n/);
      const start = clamp(Math.floor(getNumber(args, 'start', 1)), 1, Math.max(1, lines.length));
      const end = clamp(
        Math.floor(getNumber(args, 'end', Math.min(lines.length, start + 1999))),
        start,
        Math.min(lines.length, start + 1999),
      );

      const selected = lines.slice(start - 1, end).map((line, index) => {
        const number = String(start + index).padStart(6, ' ');
        return `${number}: ${line}`;
      });
      const output = truncateOutput(selected.join('\n'), ctx.maxOutputChars, 'start');
      ctx.readPaths.add(absolute);
      return ok(output, { bytes: statSync(absolute).size });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};

export const writeFileTool: ToolSpec = {
  name: 'write_file',
  description: 'Cria ou sobrescreve um arquivo de texto (requer confirmação).',
  parameters: {
    path: 'arquivo relativo ao projeto',
    content: 'conteúdo completo do arquivo',
  },
  destructive: true,
  run: async (args, ctx) => {
    try {
      const input = getString(args, 'path');
      const content = getString(args, 'content', false);
      if (!input || content === undefined) return fail('path e content são obrigatórios');
      if (!ctx.allowWrite) return fail('escrita desabilitada (TOOLS_ALLOW_WRITE=false)');
      if (Buffer.byteLength(content, 'utf8') > ctx.maxFileBytes) {
        return fail(`conteúdo grande demais (limite ${ctx.maxFileBytes} bytes)`);
      }

      const absolute = resolveInside(ctx.workdir, input);
      const rel = relativeToWorkdir(ctx.workdir, absolute);
      if (isBlockedWrite(rel)) return fail(`escrita bloqueada por segurança: ${rel}`);

      const exists = existsSync(absolute);
      if (exists && !ctx.readPaths.has(absolute)) {
        return fail(`leia o arquivo antes de sobrescrever: ${rel}`);
      }
      const oldText = exists ? readTextFile(absolute, ctx.maxFileBytes) : '';
      const kind = exists ? 'overwrite' : 'create';
      const diff = buildWriteDiff(rel, oldText, content);

      const approved = await confirmWrite(ctx, rel, kind, diff);
      if (!approved) return fail(`escrita recusada pelo usuário: ${rel}`);

      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content, 'utf8');
      ctx.readPaths.add(absolute);

      return ok(`${kind === 'create' ? 'criado' : 'sobrescrito'}: ${rel}`, {
        bytes: Buffer.byteLength(content, 'utf8'),
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};

export const applyPatchTool: ToolSpec = {
  name: 'apply_patch',
  description: 'Substitui um trecho único de um arquivo existente (requer confirmação).',
  parameters: {
    path: 'arquivo relativo ao projeto',
    search: 'trecho exato a substituir (deve ocorrer 1 vez)',
    replace: 'novo trecho',
  },
  destructive: true,
  run: async (args, ctx) => {
    try {
      const input = getString(args, 'path');
      const search = getString(args, 'search', false);
      const replacement = getString(args, 'replace', false);
      if (!input || search === undefined || replacement === undefined) {
        return fail('path, search e replace são obrigatórios');
      }
      if (search.length === 0) return fail('search não pode ser vazio');
      if (!ctx.allowWrite) return fail('escrita desabilitada (TOOLS_ALLOW_WRITE=false)');

      const absolute = resolveInside(ctx.workdir, input);
      const rel = relativeToWorkdir(ctx.workdir, absolute);
      if (isBlockedWrite(rel)) return fail(`escrita bloqueada por segurança: ${rel}`);
      if (!existsSync(absolute)) return fail(`arquivo não existe: ${rel}`);
      if (!ctx.readPaths.has(absolute)) {
        return fail(`leia o arquivo antes de editar: ${rel}`);
      }

      const oldText = readTextFile(absolute, ctx.maxFileBytes);
      const eol = oldText.includes('\r\n') ? '\r\n' : '\n';
      const normalizedSearch = search.replace(/\r\n/g, '\n').replace(/\n/g, eol);
      const normalizedReplace = replacement.replace(/\r\n/g, '\n').replace(/\n/g, eol);

      const occurrences = oldText.split(normalizedSearch).length - 1;
      if (occurrences === 0) return fail('search não encontrado no arquivo');
      if (occurrences > 1) return fail(`search ocorre ${occurrences} vezes; precisa ser único`);

      const newText = oldText.replace(normalizedSearch, normalizedReplace);
      if (newText === oldText) return fail('patches sem efeito: replace é igual a search');
      if (Buffer.byteLength(newText, 'utf8') > ctx.maxFileBytes) {
        return fail(`resultado grande demais (limite ${ctx.maxFileBytes} bytes)`);
      }

      const diff = buildPatchDiff(rel, normalizedSearch, normalizedReplace);
      const approved = await confirmWrite(ctx, rel, 'patch', diff);
      if (!approved) return fail(`edição recusada pelo usuário: ${rel}`);

      writeFileSync(absolute, newText, 'utf8');
      return ok(`editado: ${rel}`, { bytes: Buffer.byteLength(newText, 'utf8') });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};
