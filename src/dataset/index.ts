// =============================================================
// Coleta local de dados para fine-tuning.
//
// IMPORTANTE: o Vaktor NÃO treina modelo. Ele apenas grava JSONL local
// em .vaktor/logs/sessions/. O treino é externo e opcional.
// =============================================================
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { VerifySummary } from '../agent/types.js';

export interface DatasetToolCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface DatasetEntry {
  id: string;
  ts: string;
  workdir: string;
  model: string;
  input: string;
  output: string;
  tools: DatasetToolCall[];
  verify: VerifySummary;
  rating: number | null;
}

export interface DatasetLogInput {
  model: string;
  input: string;
  output: string;
  tools: DatasetToolCall[];
  verify: VerifySummary;
}

const MAX_LINE_BYTES = 200 * 1024;

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[REDACTED]')
    .replace(/ghp_[A-Za-z0-9]{6,}/g, '[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]{6,}/g, '[REDACTED]')
    .replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED]')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"',}]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /key|token|secret|password|authorization/i.test(key)
        ? '[REDACTED]'
        : redactValue(item);
    }
    return out;
  }
  return value;
}

function redactTools(tools: DatasetToolCall[]): DatasetToolCall[] {
  return tools.map(tool => ({
    name: tool.name,
    args: redactValue(tool.args) as Record<string, unknown>,
    ok: tool.ok,
  }));
}

function fitLine(entry: DatasetEntry): string {
  let input = entry.input;
  let output = entry.output;
  let tools = JSON.stringify(entry.tools);

  const build = (): string => JSON.stringify({
    ...entry,
    input: redactSecrets(input),
    output: redactSecrets(output),
    tools: JSON.parse(tools) as DatasetToolCall[],
  });

  let line = build();
  while (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    if (input.length > 20_000) input = input.slice(0, Math.floor(input.length / 2)) + '\n… [truncado]';
    else if (output.length > 20_000) output = output.slice(0, Math.floor(output.length / 2)) + '\n… [truncado]';
    else if (tools.length > 10_000) tools = JSON.stringify([{ name: 'truncated', args: {}, ok: false }]);
    else break;
    line = build();
  }

  // Último recurso: mantém JSONL válido.
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    line = JSON.stringify({
      ...entry,
      input: '[truncado]',
      output: '[truncado]',
      tools: [],
    });
  }
  return line;
}

export function datasetDirs(workdir: string): { root: string; logs: string } {
  const root = join(workdir, '.vaktor');
  return { root, logs: join(root, 'logs', 'sessions') };
}

/**
 * Grava uma sessão. Retorna o caminho do arquivo ou null quando desligado.
 * O chamador decide se a coleta está habilitada.
 */
export function logSession(input: DatasetLogInput, workdir: string, enabled: boolean): string | null {
  if (!enabled) return null;

  try {
    const { root, logs } = datasetDirs(workdir);
    mkdirSync(logs, { recursive: true });

    const gitignore = join(root, '.gitignore');
    if (!existsSync(gitignore)) {
      writeFileSync(gitignore, '*\n', 'utf8');
    }

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const file = join(logs, `${day}.jsonl`);

    const entry: DatasetEntry = {
      id: randomUUID(),
      ts: now.toISOString(),
      workdir: basename(workdir),
      model: input.model,
      input: input.input,
      output: input.output,
      tools: redactTools(input.tools),
      verify: input.verify,
      rating: null,
    };

    appendFileSync(file, `${fitLine(entry)}\n`, 'utf8');
    return file;
  } catch {
    // Coleta de dados nunca deve derrubar a sessão.
    return null;
  }
}
