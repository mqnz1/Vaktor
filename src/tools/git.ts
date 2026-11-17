// =============================================================
// Ferramentas de git com escrita: git_commit e create_pr.
//
// Ações irreversíveis (reescrevem histórico / publicam código na
// rede), então:
//  - só rodam com TOOLS_ALLOW_GIT_WRITE=true;
//  - SEMPRE exigem confirmação na UI, mesmo com autoApprove;
//  - nunca usam shell; git/gh são chamados direto (sem a allowlist
//    de run_command, que bloqueia `git push` e `npm install`);
//  - arquivos sensíveis (.env, chaves) não podem entrar no commit;
//  - create_pr recusa branches main/master e nunca faz force-push.
// =============================================================
import type { ToolContext, ToolResult, ToolSpec } from './types.js';
import { getBoolean, getString } from './args.js';
import { resolveExecutable } from './allowlist.js';
import { isBlockedRead, requireConfirm } from './fs.js';
import { formatOutcome, runSpawn } from './shell.js';

const PROTECTED_BRANCHES = new Set(['main', 'master']);

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

async function gitOutput(
  args: readonly string[],
  ctx: ToolContext,
): Promise<{ code: number | null; text: string }> {
  const executable = resolveExecutable('git', args);
  const outcome = await runSpawn(executable.bin, executable.args, ctx);
  const text = [outcome.stdout, outcome.stderr]
    .filter(part => part.trim().length > 0)
    .join('\n')
    .trim();
  const prefix = outcome.error ? `erro: ${outcome.error}\n` : '';
  return { code: outcome.code, text: prefix + text };
}

// Verifica se algum arquivo sujo/preparado é bloqueado (ex.: .env).
export function findBlockedPath(status: string): string | null {
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let path = line.slice(3).trim();
    if (path.includes(' -> ')) {
      path = path.split(' -> ').pop()?.trim() ?? path;
    }
    path = path.replace(/^"|"$/g, '');
    if (isBlockedRead(path)) return path;
  }
  return null;
}

export const gitCommitTool: ToolSpec = {
  name: 'git_commit',
  description: 'Faz git add e git commit no repositório atual (irreversível; sempre confirmado).',
  parameters: {
    message: 'mensagem do commit',
    add_all: 'true (padrão) para preparar tudo com git add -A',
  },
  destructive: true,
  run: async (args, ctx) => {
    try {
      if (!ctx.allowGitWrite) {
        return fail('escrita em git desabilitada (TOOLS_ALLOW_GIT_WRITE=false)');
      }
      const message = getString(args, 'message');
      if (!message) return fail('message obrigatória');
      if (message.length > 2000) return fail('mensagem de commit longa demais (máx. 2000)');
      const addAll = getBoolean(args, 'add_all', true);

      const status = await gitOutput(['status', '--short'], ctx);
      if (status.code !== 0) return fail(`git status falhou: ${status.text}`);
      if (status.text.length === 0) return fail('nada para commitar (working tree limpo)');

      const blocked = findBlockedPath(status.text);
      if (blocked) return fail(`commit bloqueado: "${blocked}" é um arquivo sensível`);

      const commands = [
        addAll ? '$ git add -A' : '# usando apenas o que já está preparado (git add manual)',
        `$ git commit -m ${JSON.stringify(message)}`,
        '',
        '--- git status --short ---',
        status.text,
      ];

      const approved = await requireConfirm(ctx, {
        kind: 'commit',
        title: 'Criar commit',
        detail: commands.join('\n'),
      });
      if (!approved) return fail('commit recusado pelo usuário');

      if (addAll) {
        const executable = resolveExecutable('git', ['add', '-A']);
        const add = await runSpawn(executable.bin, executable.args, ctx);
        if (add.code !== 0) {
          return fail(`git add falhou: ${add.stderr || add.stdout || 'erro desconhecido'}`);
        }
      }

      const commitExe = resolveExecutable('git', ['commit', '-m', message]);
      const outcome = await runSpawn(commitExe.bin, commitExe.args, ctx);
      const result = formatOutcome(`git commit -m ${JSON.stringify(message)}`, outcome, ctx);
      if (!result.ok) return result;

      const log = await gitOutput(['log', '-1', '--oneline'], ctx);
      return { ...result, output: `${result.output}\n${log.text}`.trim() };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};

export const createPrTool: ToolSpec = {
  name: 'create_pr',
  description: 'Faz push do branch atual e abre um Pull Request com gh (irreversível; confirmado).',
  parameters: {
    title: 'título do Pull Request',
    body: 'corpo/descrição do Pull Request (opcional)',
    base: 'branch de destino (opcional; ex.: main)',
    head: 'branch de origem (opcional; padrão: branch atual)',
  },
  destructive: true,
  run: async (args, ctx) => {
    try {
      if (!ctx.allowGitWrite) {
        return fail('escrita em git desabilitada (TOOLS_ALLOW_GIT_WRITE=false)');
      }
      const title = getString(args, 'title');
      if (!title) return fail('title obrigatório');
      if (title.length > 300) return fail('título longo demais (máx. 300)');
      const body = getString(args, 'body', false) ?? '';
      const base = getString(args, 'base', false) ?? '';
      const headArg = getString(args, 'head', false) ?? '';

      const branchResult = await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], ctx);
      const branch = branchResult.text.trim();
      if (!branch || branch === 'HEAD') {
        return fail('não foi possível detectar o branch atual (repositório git inicializado?)');
      }
      if (PROTECTED_BRANCHES.has(branch)) {
        return fail(`recusando abrir PR a partir de "${branch}"; crie e use um branch de trabalho`);
      }
      const head = headArg || branch;

      const commands = [
        `$ git push -u origin ${head}`,
        `$ gh pr create --title ${JSON.stringify(title)}${base ? ` --base ${base}` : ''} --head ${head}`,
        '',
        body ? `--- corpo ---\n${body.slice(0, 1500)}` : '(sem corpo)',
      ];

      const approved = await requireConfirm(ctx, {
        kind: 'pr',
        title: `Abrir Pull Request de "${head}"${base ? ` para "${base}"` : ''}`,
        detail: commands.join('\n'),
      });
      if (!approved) return fail('abertura de PR recusada pelo usuário');

      const pushExe = resolveExecutable('git', ['push', '-u', 'origin', head]);
      const push = await runSpawn(pushExe.bin, pushExe.args, ctx, Math.max(ctx.commandTimeoutMs, 120_000));
      if (push.code !== 0) {
        return fail(`git push falhou: ${push.stderr || push.stdout || 'erro desconhecido'}`);
      }

      const ghArgs = ['pr', 'create', '--title', title];
      if (body) ghArgs.push('--body', body);
      if (base) ghArgs.push('--base', base);
      ghArgs.push('--head', head);
      const ghExe = resolveExecutable('gh', ghArgs);
      const outcome = await runSpawn(ghExe.bin, ghExe.args, ctx, Math.max(ctx.commandTimeoutMs, 120_000));
      return formatOutcome('gh pr create', outcome, ctx);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};
