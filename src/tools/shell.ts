// =============================================================
// Execução de comandos permitidos e ferramentas git.
// Nunca usa shell: true. No Windows, npm/npx são resolvidos para
// `node <npm-cli.js>` para não cair no EINVAL de .cmd.
// =============================================================
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolContext, ToolResult, ToolSpec } from './types.js';
import { getString } from './args.js';
import { isForbiddenCommand, resolveExecutable } from './allowlist.js';
import { relativeToWorkdir, resolveInside, truncateOutput } from './fs.js';

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

function killTree(pid: number, child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => undefined);
    } catch {
      // fallback abaixo
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // processo já morreu
  }
}

export interface SpawnOutcome {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export function runSpawn(
  bin: string,
  args: readonly string[],
  ctx: ToolContext,
  timeoutMs?: number,
): Promise<SpawnOutcome> {
  return new Promise(resolvePromise => {
    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const cap = Math.max(2000, ctx.maxOutputChars * 2);

    const finish = (outcome: SpawnOutcome): void => {
      if (settled) return;
      settled = true;
      resolvePromise(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], {
        cwd: ctx.workdir,
        shell: false,
        windowsHide: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > cap) stdout = stdout.slice(-cap);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > cap) stderr = stderr.slice(-cap);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      if (typeof child.pid === 'number') killTree(child.pid, child);
      else {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }, timeoutMs ?? ctx.commandTimeoutMs);

    child.on('error', (error: Error) => {
      clearTimeout(timer);
      finish({
        code: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        error: error.message,
      });
    });

    child.on('close', (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      finish({ code, signal, stdout, stderr, timedOut });
    });
  });
}

export function formatOutcome(label: string, outcome: SpawnOutcome, ctx: ToolContext): ToolResult {
  const parts: string[] = [];
  parts.push(`$ ${label}`);
  if (outcome.error) parts.push(`erro: ${outcome.error}`);
  parts.push(`exit: ${outcome.code ?? 'null'}${outcome.signal ? ` sinal: ${outcome.signal}` : ''}`);
  if (outcome.timedOut) parts.push(`timeout: ${ctx.commandTimeoutMs}ms`);
  if (outcome.stdout.trim()) parts.push('--- stdout ---\n' + outcome.stdout.trimEnd());
  if (outcome.stderr.trim()) parts.push('--- stderr ---\n' + outcome.stderr.trimEnd());

  const success = !outcome.error && !outcome.timedOut && outcome.code === 0;
  return {
    ok: success,
    output: truncateOutput(parts.join('\n'), ctx.maxOutputChars, 'end'),
    meta: { exitCode: outcome.code ?? -1 },
  };
}

export const runCommandTool: ToolSpec = {
  name: 'run_command',
  description: 'Executa um comando da allowlist (typecheck, test, build, git status etc.).',
  parameters: {
    label: 'label da allowlist; o modelo não escolhe o binário',
  },
  destructive: false,
  run: async (args, ctx) => {
    try {
      const label = getString(args, 'label');
      if (!label) return fail('label obrigatório');
      const allowed = ctx.allowedCommands.find(command => command.label === label);
      if (!allowed) {
        const labels = ctx.allowedCommands.map(command => command.label).join(', ');
        return fail(`comando não permitido: ${label}. Disponíveis: ${labels}`);
      }

      const forbidden = isForbiddenCommand(allowed.bin, allowed.args);
      if (forbidden) return fail(`comando bloqueado: ${forbidden}`);

      const executable = resolveExecutable(allowed.bin, allowed.args);
      const outcome = await runSpawn(executable.bin, executable.args, ctx);
      return formatOutcome(label, outcome, ctx);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};

export const gitStatusTool: ToolSpec = {
  name: 'git_status',
  description: 'Mostra o estado do git (allowlist: git-status).',
  parameters: {},
  destructive: false,
  run: async (_args, ctx) => {
    const allowed = ctx.allowedCommands.find(command => command.label === 'git-status');
    if (!allowed) return fail('git-status não está na allowlist');
    const outcome = await runSpawn('git', ['status'], ctx);
    return formatOutcome('git-status', outcome, ctx);
  },
};

export const gitDiffTool: ToolSpec = {
  name: 'git_diff',
  description: 'Mostra o diff do projeto (opcionalmente de um path).',
  parameters: {
    path: 'arquivo/diretório relativo (opcional)',
  },
  destructive: false,
  run: async (args, ctx) => {
    try {
      if (!ctx.allowedCommands.some(command => command.label === 'git-diff')) {
        return fail('git-diff não está na allowlist');
      }
      const input = getString(args, 'path', false);
      const commandArgs = ['diff'];
      if (input) {
        const absolute = resolveInside(ctx.workdir, input);
        const rel = relativeToWorkdir(ctx.workdir, absolute);
        commandArgs.push('--', rel);
      }

      const outcome = await runSpawn('git', commandArgs, ctx);
      const result = formatOutcome('git-diff', outcome, ctx);
      return {
        ...result,
        output: truncateOutput(result.output, ctx.maxOutputChars, 'start'),
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};

// Exportado para testes e para o verificador.
export async function runDirectCommand(
  bin: string,
  args: readonly string[],
  ctx: ToolContext,
): Promise<ToolResult> {
  const forbidden = isForbiddenCommand(bin, args);
  if (forbidden) return fail(`comando bloqueado: ${forbidden}`);
  const executable = resolveExecutable(bin, args);
  const outcome = await runSpawn(executable.bin, executable.args, {
    ...ctx,
    workdir: resolve(ctx.workdir),
  });
  return formatOutcome(`${bin} ${args.join(' ')}`.trim(), outcome, ctx);
}
