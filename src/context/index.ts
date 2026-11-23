// =============================================================
// Contexto de projeto: repo map barato, cacheado por 60s.
// O agente recebe caminhos + exports, não o conteúdo inteiro.
// =============================================================
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface RepoFile {
  path: string;
  bytes: number;
  kind: 'ts' | 'tsx' | 'js' | 'jsx' | 'json' | 'md' | 'other';
  exports: string[];
}

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.cache', '.turbo', '.vaktor', '.idea', '.vscode',
]);

const KIND_BY_EXT: Record<string, RepoFile['kind']> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
  '.json': 'json',
  '.md': 'md',
};

const CACHE_TTL_MS = 60_000;
const MAX_SOURCE_BYTES = 256 * 1024;
const cache = new Map<string, { timestamp: number; files: RepoFile[] }>();

function extractExports(text: string): string[] {
  const names = new Set<string>();

  const declarations = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(declarations)) {
    if (match[1]) names.add(match[1]);
  }

  const defaultDecl = /export\s+default\s+(?:async\s+)?(?:function|class)\s*([A-Za-z_$][\w$]*)?/g;
  for (const match of text.matchAll(defaultDecl)) {
    names.add(match[1] ?? 'default');
  }

  const named = /export\s*\{([^}]+)\}/g;
  for (const match of text.matchAll(named)) {
    const body = match[1] ?? '';
    for (const part of body.split(',')) {
      const alias = part.trim().split(/\s+as\s+/i).pop()?.trim();
      if (alias && /^[A-Za-z_$][\w$]*$/.test(alias)) names.add(alias);
    }
  }

  if (/export\s+\*\s+from/.test(text)) names.add('*');

  return [...names].slice(0, 20);
}

function walk(
  workdir: string,
  dir: string,
  files: RepoFile[],
  maxFiles: number,
): void {
  if (files.length >= maxFiles) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    if (entry.isSymbolicLink()) continue;

    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(workdir, full, files, maxFiles);
      continue;
    }
    if (!entry.isFile()) continue;

    const rel = full.slice(workdir.length + 1).replace(/\\/g, '/');
    if (rel === '.env' || rel.startsWith('.env.')) continue;

    const dot = rel.lastIndexOf('.');
    const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
    const kind = KIND_BY_EXT[ext];
    if (!kind) continue;

    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    if (size > MAX_SOURCE_BYTES) continue;

    let exports: string[] = [];
    if (kind === 'ts' || kind === 'tsx' || kind === 'js' || kind === 'jsx') {
      try {
        exports = extractExports(readFileSync(full, 'utf8'));
      } catch {
        exports = [];
      }
    }

    files.push({ path: rel, bytes: size, kind, exports });
  }
}

export function buildRepoMap(workdir: string, maxFiles = 150): RepoFile[] {
  let root: string;
  try {
    root = realpathSync(workdir);
  } catch {
    root = resolve(workdir);
  }
  if (!existsSync(root)) return [];

  const key = `${root}::${maxFiles}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.files.map(file => ({ ...file, exports: [...file.exports] }));
  }

  const files: RepoFile[] = [];
  walk(root, root, files, maxFiles);
  files.sort((a, b) => a.path.localeCompare(b.path));
  cache.set(key, { timestamp: Date.now(), files });
  return files.map(file => ({ ...file, exports: [...file.exports] }));
}

export function invalidateRepoMap(): void {
  cache.clear();
}

export function renderRepoMap(files: readonly RepoFile[], maxChars = 4000): string {
  if (files.length === 0) return '';
  const lines: string[] = [];
  let used = 0;

  for (const file of files) {
    const exports = file.exports.length > 0 ? ` — ${file.exports.join(', ')}` : '';
    const line = `${file.path}${exports}`;
    if (used + line.length + 1 > maxChars) {
      lines.push('… (repo map truncado)');
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join('\n');
}

function tokenize(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter(token => token.length >= 3),
  )].slice(0, 12);
}

/**
 * Seleciona os arquivos mais relevantes para a tarefa. Usado quando o
 * contexto é injetado no system prompt (CONTEXT_INJECT=true).
 */
export function selectContext(
  query: string,
  files: readonly RepoFile[],
  maxChars = 4000,
): string {
  const tokens = tokenize(query);
  if (tokens.length === 0) return '';

  const scored = files
    .map(file => {
      const haystack = `${file.path} ${file.exports.join(' ')}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
      }
      return { file, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  const lines: string[] = [];
  let used = 0;
  for (const item of scored) {
    const exports = item.file.exports.length > 0 ? ` — ${item.file.exports.join(', ')}` : '';
    const line = `${item.file.path}${exports}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join('\n');
}
