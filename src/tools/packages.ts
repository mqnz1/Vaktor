// =============================================================
// Instalação de pacotes npm.
//
// Ação irreversível (pode rodar postinstall), então SEMPRE exige
// confirmação na UI, mesmo com TOOLS_AUTO_APPROVE=true. Só roda se
// TOOLS_ALLOW_INSTALL=true. Nomes de pacote são validados: nada de
// file:, git+https:, paths ou flags vindos do modelo.
// =============================================================
import type { ToolResult, ToolSpec } from './types.js';
import { getBoolean } from './args.js';
import { resolveExecutable } from './allowlist.js';
import { requireConfirm } from './fs.js';
import { formatOutcome, runSpawn } from './shell.js';

const PKG_RE = /^(?:@[a-z0-9-._~]+\/)?[a-z0-9-._~]+(?:@[0-9a-zA-Z.*^~<>=|+-]+)?$/;
const MAX_PACKAGES = 10;

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

export function normalizePackages(value: unknown): string[] {
  const raw: string[] = [];
  if (typeof value === 'string') raw.push(...value.split(/[\s,]+/));
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') raw.push(...item.split(/[\s,]+/));
    }
  }
  return raw.map(item => item.trim()).filter(item => item.length > 0);
}

export const npmInstallTool: ToolSpec = {
  name: 'npm_install',
  description: 'Instala pacotes npm (irreversível; sempre confirmado pelo usuário).',
  parameters: {
    packages: 'pacote(s): "zod" ou "@scope/pkg@1.2.3" (máx. 10)',
    dev: 'true para salvar em devDependencies (--save-dev)',
  },
  destructive: true,
  run: async (args, ctx) => {
    try {
      if (!ctx.allowInstall) {
        return fail('instalação desabilitada (TOOLS_ALLOW_INSTALL=false)');
      }
      const specs = normalizePackages(args['packages']);
      if (specs.length === 0) return fail('packages obrigatório');
      if (specs.length > MAX_PACKAGES) return fail(`no máximo ${MAX_PACKAGES} pacotes por chamada`);

      const invalid = specs.find(spec => !PKG_RE.test(spec));
      if (invalid) return fail(`pacote inválido (use apenas nome[/versão]): ${invalid}`);

      const dev = getBoolean(args, 'dev', false);
      const npmArgs = ['install', ...(dev ? ['--save-dev'] : []), ...specs];
      const command = `npm ${npmArgs.join(' ')}`;

      const approved = await requireConfirm(ctx, {
        kind: 'install',
        title: `Instalar ${specs.length} pacote(s) npm`,
        detail: [
          `$ ${command}`,
          '',
          'Isso baixa código de terceiros e pode executar scripts postinstall.',
        ].join('\n'),
      });
      if (!approved) return fail('instalação recusada pelo usuário');

      const executable = resolveExecutable('npm', npmArgs);
      const outcome = await runSpawn(
        executable.bin,
        executable.args,
        ctx,
        Math.max(ctx.commandTimeoutMs, 300_000),
      );
      return formatOutcome(command, outcome, ctx);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};
