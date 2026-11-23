// =============================================================
// Protocolo textual de tool calls.
//
// Formato:
//   <tool_call>{"name":"read_file","args":{"path":"src/a.ts"}}</tool_call>
//
// JSON em uma linha. O parser também tolera bloco cercado por ```.
// Nada do conteúdo é executado antes de ser validado.
// =============================================================
import type { ToolResult } from '../tools/types.js';
import { getTool } from '../tools/index.js';

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

export interface ParsedResponse {
  calls: ParsedToolCall[];
  rest: string;
  errors: string[];
}

const MAX_CALLS = 4;
const BLOCK_RE = /```(?:[a-zA-Z0-9_-]+)?\s*<tool_call>([\s\S]*?)<\/tool_call>\s*```|<tool_call>([\s\S]*?)<\/tool_call>/gi;
const LOOSE_TOOL_TAG_RE = /<tool_call>/gi;

// Alguns modelos (DeepSeek) emitem tool calls no dialeto DSML em vez do
// bloco <tool_call> combinado no prompt. Normalizamos o token e os nomes
// de bloco antes de extrair as invocações.
const DSML_BLOCK_RE = /<\|DSML\|tool_calls>([\s\S]*?)<\/\|DSML\|tool_calls>/gi;
const DSML_INVOKE_RE = /<\|DSML\|invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\|DSML\|invoke>/gi;
const DSML_PARAM_RE = /<\|DSML\|parameter\s+name="([^"]+)"(?:\s+string="([^"]*)")?\s*>([\s\S]*?)<\/\|DSML\|parameter>/gi;
const DSML_LEFTOVER_RE = /<\/?\|DSML\|[^>\r\n]*>/gi;

interface Span {
  start: number;
  end: number;
}

function spanOf(match: { index?: number; 0?: string }): Span {
  const start = match.index ?? 0;
  return { start, end: start + (match[0]?.length ?? 0) };
}

function overlaps(spans: readonly Span[], start: number, end: number): boolean {
  return spans.some(span => start < span.end && end > span.start);
}

function removeSpans(text: string, spans: readonly Span[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let output = '';
  for (const span of sorted) {
    if (span.start < cursor) continue;
    output += text.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  return output + text.slice(cursor);
}

function normalizeDsml(text: string): string {
  return text
    // Aceita <|DSML|, < | DSM | e as variantes com pipes duplicados que
    // aparecem quando o modelo mistura dialetos.
    .replace(/<\s*(\/?)\s*\|\s*(?:\|\s*)?DSM(?:L)?\s*\|\s*(?:\|\s*)?/gi, (_match, slash: string) =>
      slash ? '</|DSML|' : '<|DSML|',
    )
    .replace(
      /<\|DSML\|\s*(?:tool[\s_-]?calls?|calls?|tools?|function[\s_-]?calls?)\s*>/gi,
      '<|DSML|tool_calls>',
    )
    .replace(
      /<\/\|DSML\|\s*(?:tool[\s_-]?calls?|calls?|tools?|function[\s_-]?calls?)\s*>/gi,
      '</|DSML|tool_calls>',
    );
}

// Alguns modelos aninham os argumentos em {"args": {...}} mesmo no DSML.
function unwrapArgs(value: unknown): Record<string, unknown> | null {
  let current = value;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) return null;

  const record = current as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1) {
    const key = keys[0];
    if (key === 'args' || key === 'arguments' || key === 'input') {
      const inner = unwrapArgs(record[key!]);
      if (inner) return inner;
    }
  }
  return record;
}

// Extrai um objeto JSON balanceado a partir de `start`, tolerando strings
// com chaves e escapes. Usado quando o modelo abre <tool_call> mas esquece
// (ou troca) o fechamento.
function extractJsonObject(text: string, start: number): { json: string; end: number } | null {
  let i = start;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let j = i; j < text.length; j++) {
    const char = text[j]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return { json: text.slice(i, j + 1), end: j + 1 };
    }
  }
  return null;
}

// Alguns modelos ignoram o bloco combinado e emitem apenas o JSON da tool
// call, tanto em uma linha quanto em JSON formatado. Aceitamos esse formato
// somente quando o objeto tem nome de ferramenta conhecido e `args` objeto,
// para não transformar JSON comum da resposta em execução.
function fencedSpan(text: string, start: number, end: number): Span {
  const before = text.slice(0, start);
  const open = /```(?:json|jsonc)?[ \t]*(?:\r?\n[ \t]*)?$/i.exec(before);
  if (!open) return { start, end };
  const after = text.slice(end);
  const close = /^[ \t]*(?:\r?\n[ \t]*)?```/i.exec(after);
  if (!close) return { start, end };
  return { start: start - open[0].length, end: end + close[0].length };
}

function parseBareJsonCalls(
  text: string,
  occupied: readonly Span[],
): { calls: ParsedToolCall[]; errors: string[]; spans: Span[] } {
  const calls: ParsedToolCall[] = [];
  const errors: string[] = [];
  const spans: Span[] = [];
  const starts = new Set<number>();

  // JSON cercado por ```json {...} ``` na mesma linha.
  for (const match of text.matchAll(/```(?:json|jsonc)?[ \t]*\{/gi)) {
    const brace = (match.index ?? 0) + (match[0]?.lastIndexOf('{') ?? 0);
    if (!overlaps(occupied, brace, brace + 1)) starts.add(brace);
  }

  // JSON no começo de uma linha, inclusive formatado em várias linhas.
  let lineStart = 0;
  while (lineStart <= text.length) {
    const lineEnd = text.indexOf('\n', lineStart);
    const end = lineEnd === -1 ? text.length : lineEnd;
    const line = text.slice(lineStart, end);
    const trimmed = line.trimStart();
    if (trimmed.startsWith('{')) {
      const brace = lineStart + (line.length - trimmed.length);
      if (!overlaps(occupied, brace, brace + 1)) starts.add(brace);
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  for (const start of [...starts].sort((a, b) => a - b)) {
    if (overlaps(occupied, start, start + 1) || overlaps(spans, start, start + 1)) continue;

    const extracted = extractJsonObject(text, start);
    if (!extracted) {
      const prefix = text.slice(start, Math.min(text.length, start + 200));
      const nameMatch = /^\{\s*"name"\s*:\s*"([^"]+)"/.exec(prefix);
      const name = nameMatch?.[1]?.trim();
      if (name && getTool(name)) {
        errors.push(`JSON de tool call truncado ou inválido: ${name}`);
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.json);
    } catch (error) {
      const prefix = text.slice(start, Math.min(text.length, start + 200));
      const nameMatch = /^\{\s*"name"\s*:\s*"([^"]+)"/.exec(prefix);
      const name = nameMatch?.[1]?.trim();
      if (name && getTool(name)) {
        errors.push(
          `JSON inválido em tool call solta: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const name = record['name'];
    if (typeof name !== 'string' || name.trim().length === 0) continue;

    const trimmedName = name.trim();
    if (!getTool(trimmedName)) continue;

    const args = unwrapArgs(record['args'] ?? record['arguments'] ?? record['input']);
    if (!args) {
      errors.push(`tool_call "${trimmedName}" sem "args" objeto`);
      spans.push(fencedSpan(text, start, extracted.end));
      continue;
    }

    calls.push({
      name: trimmedName,
      args,
      raw: text.slice(start, extracted.end),
    });
    spans.push(fencedSpan(text, start, extracted.end));
  }

  return { calls, errors, spans };
}

function parseDsmlCalls(text: string): { calls: ParsedToolCall[]; errors: string[]; spans: Span[] } {
  const calls: ParsedToolCall[] = [];
  const errors: string[] = [];
  const spans: Span[] = [];

  for (const match of text.matchAll(DSML_BLOCK_RE)) {
    spans.push(spanOf(match));
  }

  for (const match of text.matchAll(DSML_INVOKE_RE)) {
    spans.push(spanOf(match));
    const name = (match[1] ?? '').trim();
    const raw = match[0] ?? '';
    if (name.length === 0) {
      errors.push('DSML invoke sem "name"');
      continue;
    }

    const params: Record<string, unknown> = {};
    for (const param of (match[2] ?? '').matchAll(DSML_PARAM_RE)) {
      const paramName = (param[1] ?? '').trim();
      if (paramName.length === 0) continue;
      const isString = (param[2] ?? 'false').toLowerCase() === 'true';
      const value = param[3] ?? '';
      if (isString) {
        params[paramName] = value;
        continue;
      }
      try {
        params[paramName] = JSON.parse(value.trim());
      } catch {
        params[paramName] = value;
      }
    }

    const args = unwrapArgs(params) ?? params;
    calls.push({ name, args, raw });
  }

  if (calls.length === 0 && /<\|DSML\|tool_calls>/i.test(text)) {
    errors.push('bloco DSML tool_calls sem invoke válido');
  }

  return { calls, errors, spans };
}

export function parseToolCalls(text: string): ParsedResponse {
  const calls: ParsedToolCall[] = [];
  const errors: string[] = [];
  const spans: Span[] = [];
  const normalized = normalizeDsml(text);

  for (const match of normalized.matchAll(BLOCK_RE)) {
    spans.push(spanOf(match));
    const raw = match[0] ?? '';
    let inner = (match[1] ?? match[2] ?? '').trim();
    if (inner.startsWith('```')) {
      inner = inner.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```$/, '').trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(inner);
    } catch (error) {
      errors.push(`JSON inválido em tool_call: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('tool_call deve ser um objeto JSON');
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const name = record['name'];
    const args = unwrapArgs(record['args'] ?? record['arguments'] ?? record['input']);
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push('tool_call sem "name" string');
      continue;
    }
    if (!args) {
      errors.push(`tool_call "${name}" sem "args" objeto`);
      continue;
    }

    calls.push({
      name: name.trim(),
      args,
      raw,
    });
  }

  const dsml = parseDsmlCalls(normalized);
  calls.push(...dsml.calls);
  errors.push(...dsml.errors);
  spans.push(...dsml.spans);

  // Formato misto: <tool_call>{...}</|DSML|parameter> ou <tool_call>{...}
  // sem fechamento. Recupera o JSON balanceado mesmo assim.
  for (const match of normalized.matchAll(LOOSE_TOOL_TAG_RE)) {
    const tagEnd = (match.index ?? 0) + match[0].length;
    if (overlaps(spans, match.index ?? 0, tagEnd)) continue;
    const extracted = extractJsonObject(normalized, tagEnd);
    if (!extracted) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.json);
    } catch (error) {
      errors.push(`JSON inválido em tool_call sem fechamento: ${error instanceof Error ? error.message : String(error)}`);
      spans.push({ start: match.index ?? 0, end: extracted.end });
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('tool_call sem fechamento deve ser um objeto JSON');
      spans.push({ start: match.index ?? 0, end: extracted.end });
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const name = record['name'];
    const args = unwrapArgs(record['args'] ?? record['arguments'] ?? record['input']);
    if (typeof name !== 'string' || name.trim().length === 0 || !args) {
      errors.push(`tool_call sem fechamento inválido: ${extracted.json.slice(0, 120)}`);
      spans.push({ start: match.index ?? 0, end: extracted.end });
      continue;
    }

    calls.push({
      name: name.trim(),
      args,
      raw: normalized.slice(match.index ?? 0, extracted.end),
    });
    spans.push({ start: match.index ?? 0, end: extracted.end });
  }

  // Último recurso: modelo emitiu só o objeto JSON, sem <tool_call>.
  const bare = parseBareJsonCalls(normalized, spans);
  calls.push(...bare.calls);
  errors.push(...bare.errors);
  spans.push(...bare.spans);

  // Preserva a ordem em que as chamadas aparecem no texto, mesmo quando
  // vieram de dialetos diferentes.
  const positions = new Map<string, number>();
  for (const call of calls) {
    const at = normalized.indexOf(call.raw);
    positions.set(call.raw, at >= 0 ? at : Number.MAX_SAFE_INTEGER);
  }
  calls.sort((a, b) => (positions.get(a.raw) ?? 0) - (positions.get(b.raw) ?? 0));

  let rest = removeSpans(normalized, spans);
  rest = rest.replace(DSML_LEFTOVER_RE, '').replace(/<\/?tool_call>/gi, '').trim();

  if (calls.length > MAX_CALLS) {
    return {
      calls: [],
      rest,
      errors: [`mais de ${MAX_CALLS} tool calls na mesma resposta (${calls.length}); nenhuma foi executada`],
    };
  }

  return { calls, rest, errors };
}

export function formatToolResult(name: string, result: ToolResult): string {
  const lines: string[] = [
    `## TOOL RESULT (${name})`,
    `ok: ${result.ok ? 'true' : 'false'}`,
  ];
  if (result.meta) {
    if (typeof result.meta.exitCode === 'number') lines.push(`exitCode: ${result.meta.exitCode}`);
    if (typeof result.meta.matches === 'number') lines.push(`matches: ${result.meta.matches}`);
    if (typeof result.meta.bytes === 'number') lines.push(`bytes: ${result.meta.bytes}`);
  }
  lines.push('output:');
  lines.push(result.output);
  return lines.join('\n');
}

export function formatProtocolError(message: string): string {
  return [
    '## PROTOCOL ERROR',
    message,
    'Corrija o formato e tente novamente. Formato exato:',
    '<tool_call>{"name":"nome_da_tool","args":{}}</tool_call>',
  ].join('\n');
}

export function formatDuplicateWarning(name: string): string {
  return [
    '## TOOL CALL WARNING',
    `A chamada "${name}" com os mesmos argumentos já foi executada nesta sessão.`,
    'Não execute de novo. Use o resultado anterior ou tome outra ação.',
  ].join('\n');
}
