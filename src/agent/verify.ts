// =============================================================
// Detecção e execução do loop de verificação.
// Prioridade: typecheck -> test -> build. Para no primeiro que falhar.
// =============================================================
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext } from '../tools/types.js';
import type { VerifyResult } from './types.js';
import { executeTool } from '../tools/index.js';

export interface VerifyCommand {
  label: string;
  display: string;
}

interface PackageJson {
  scripts?: Record<string, unknown>;
}

function readPackageJson(workdir: string): PackageJson | null {
  const path = join(workdir, 'package.json');
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as PackageJson;
  } catch {
    return null;
  }
}

export function detectVerification(workdir: string): VerifyCommand[] {
  const commands: VerifyCommand[] = [];
  const pkg = readPackageJson(workdir);
  const scripts = pkg?.scripts ?? {};
  const has = (name: string): boolean => typeof scripts[name] === 'string';

  if (has('typecheck')) {
    commands.push({ label: 'typecheck', display: 'npm run typecheck' });
  } else if (existsSync(join(workdir, 'tsconfig.json'))) {
    commands.push({ label: 'tsc', display: 'npx tsc --noEmit' });
  }

  if (has('test')) commands.push({ label: 'test', display: 'npm test' });
  if (has('build')) commands.push({ label: 'build', display: 'npm run build' });

  return commands;
}

export function parseVerificationErrors(output: string): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  const typescript = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;
  for (const match of output.matchAll(typescript)) {
    const line = `${match[1]}:${match[2]}:${match[3]} ${match[4]} ${match[5]}`;
    if (!seen.has(line)) {
      seen.add(line);
      errors.push(line.slice(0, 300));
    }
    if (errors.length >= 20) return errors;
  }

  const generic = /^.*(?:error|erro|failed|falhou).*$/gim;
  for (const match of output.matchAll(generic)) {
    const line = (match[0] ?? '').trim().slice(0, 300);
    if (line && !seen.has(line)) {
      seen.add(line);
      errors.push(line);
    }
    if (errors.length >= 20) break;
  }

  return errors;
}

export async function runVerification(
  commands: readonly VerifyCommand[],
  ctx: ToolContext,
): Promise<VerifyResult> {
  if (commands.length === 0) {
    return { ran: false, ok: true, attempts: 0 };
  }

  const outputs: string[] = [];
  let command = '';

  for (const item of commands) {
    command = item.display;
    const result = await executeTool('run_command', { label: item.label }, ctx);
    outputs.push(`$ ${item.display}\n${result.output}`);

    if (!result.ok) {
      const output = outputs.join('\n\n');
      return {
        ran: true,
        ok: false,
        attempts: 1,
        command,
        output: output.length > ctx.maxOutputChars
          ? output.slice(-ctx.maxOutputChars)
          : output,
      };
    }
  }

  const output = outputs.join('\n\n');
  return {
    ran: true,
    ok: true,
    attempts: 1,
    command,
    output: output.length > ctx.maxOutputChars
      ? output.slice(-ctx.maxOutputChars)
      : output,
  };
}

export function verificationSignature(result: VerifyResult): string {
  const errors = parseVerificationErrors(result.output ?? '');
  const tail = (result.output ?? '').slice(-800);
  return `${result.command ?? ''}|${errors.join(' | ')}|${tail}`;
}

export function formatVerifyFeedback(result: VerifyResult): string {
  const errors = parseVerificationErrors(result.output ?? '');
  const output = (result.output ?? '').slice(-8000);
  const lines = [
    `## VERIFY FAILED (comando: ${result.command ?? 'desconhecido'})`,
    errors.length > 0 ? `Erros:\n${errors.map(error => `- ${error}`).join('\n')}` : '',
    'Saída:',
    output,
    '',
    'Corrija os erros acima, use as ferramentas necessárias e responda de novo.',
  ];
  return lines.filter(line => line.length > 0).join('\n');
}

export function describeVerification(commands: readonly VerifyCommand[]): string {
  return commands.length === 0
    ? 'nenhum comando de verificação detectado'
    : commands.map(command => command.display).join(' -> ');
}
