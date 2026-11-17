// =============================================================
// Busca textual no projeto — implementação recursiva em TypeScript puro,
// sem ripgrep e sem dependências externas.
// =============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { ToolResult, ToolSpec } from './types.js';
import { clamp, getBoolean, getNumber, getString } from './args.js';
import { isBlockedRead, relativeToWorkdir, resolveInside, truncateOutput } from './fs.js';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.cache', '.turbo', '.vaktor', '.idea', '.vscode',
]);

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

function globToRegExp(glob: string): RegExp {
  let source = '^';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 3;
        continue;
      }
      source += '.*';
      i += 2;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      i++;
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      i++;
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i++;
  }
  source += '$';
  return new RegExp(source, 'i');
}

interface SearchHit {
  file: string;
  line: number;
  text: string;
}

export const searchTool: ToolSpec = {
  name: 'search',
  description: 'Busca texto ou regex nos arquivos do projeto.',
  parameters: {
    query: 'texto procurado (máx. 200 chars)',
    path: 'diretório/arquivo inicial (padrão: ".")',
    glob: 'filtro de arquivos, ex.: "**/*.ts" (padrão)',
    regex: 'true para tratar query como regex',
    maxResults: 'máximo de resultados (1-100, padrão: 100)',
  },
  destructive: false,
  run: (args, ctx) => {
    try {
      const query = getString(args, 'query');
      if (!query) return fail('query obrigatória');
      if (query.length > 200) return fail('query longa demais (máx. 200 chars)');

      const input = getString(args, 'path', false) ?? '.';
      const glob = getString(args, 'glob', false) ?? '**/*';
      const useRegex = getBoolean(args, 'regex', false);
      const maxResults = clamp(Math.floor(getNumber(args, 'maxResults', 100)), 1, 100);

      let matcher: RegExp;
      if (useRegex) {
        try {
          matcher = new RegExp(query, 'i');
        } catch (error) {
          return fail(`regex inválida: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }

      const globMatcher = globToRegExp(glob);
      const globHasSlash = glob.includes('/');
      const root = resolveInside(ctx.workdir, input);
      const rootStat = statSync(root);

      const hits: SearchHit[] = [];
      let filesScanned = 0;
      const maxFiles = 5000;

      const inspectFile = (absolute: string): void => {
        if (hits.length >= maxResults) return;
        if (filesScanned >= maxFiles) return;

        const rel = relativeToWorkdir(ctx.workdir, absolute);
        if (isBlockedRead(rel)) return;
        const candidate = globHasSlash ? rel : basename(rel);
        if (!globMatcher.test(candidate)) return;

        let stat;
        try {
          stat = statSync(absolute);
        } catch {
          return;
        }
        if (!stat.isFile() || stat.size > Math.min(ctx.maxFileBytes, 1024 * 1024)) return;

        filesScanned++;
        const buffer = readFileSync(absolute);
        if (buffer.subarray(0, Math.min(4096, buffer.length)).includes(0)) return;

        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index] ?? '';
          matcher.lastIndex = 0;
          if (matcher.test(line)) {
            hits.push({ file: rel, line: index + 1, text: line.trim().slice(0, 240) });
            if (hits.length >= maxResults) return;
          }
        }
      };

      const walk = (absolute: string): void => {
        if (hits.length >= maxResults || filesScanned >= maxFiles) return;
        const entries = readdirSync(absolute, { withFileTypes: true })
          .filter(entry => !entry.isSymbolicLink())
          .sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
          if (hits.length >= maxResults || filesScanned >= maxFiles) return;
          const full = resolve(absolute, entry.name);
          if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            walk(full);
          } else if (entry.isFile()) {
            inspectFile(full);
          }
        }
      };

      if (rootStat.isDirectory()) walk(root);
      else inspectFile(root);

      const output = hits.map(hit => `${hit.file}:${hit.line}: ${hit.text}`).join('\n');
      return {
        ok: true,
        output: truncateOutput(output || '(nenhum resultado)', ctx.maxOutputChars, 'start'),
        meta: { matches: hits.length },
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};
