// Smoke das ferramentas do agente.
// Executar: npx tsx src/tools/smoke.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeTool, TOOLS } from './index.js';
import { DEFAULT_ALLOWED_COMMANDS } from './allowlist.js';
import { isPrivateHost } from './web.js';
import type { ToolContext } from './types.js';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FALHOU ${label}`);
  }
}

const root = mkdtempSync(join(tmpdir(), 'vaktor-tools-'));

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workdir: root,
    allowWrite: true,
    autoApprove: true,
    maxFileBytes: 200000,
    maxOutputChars: 4000,
    commandTimeoutMs: 10000,
    allowedCommands: DEFAULT_ALLOWED_COMMANDS.map(command => ({
      label: command.label,
      bin: command.bin,
      args: [...command.args],
    })),
    allowNetwork: false,
    allowInstall: false,
    allowGitWrite: false,
    allowedDomains: [],
    readPaths: new Set<string>(),
    ...overrides,
  };
}

async function main(): Promise<void> {
  try {
    const ctx = makeContext();

    // 1. write_file cria arquivo
    const created = await executeTool('write_file', { path: 'a.txt', content: 'hello\nworld' }, ctx);
    check('escreve arquivo novo', created.ok && readFileSync(join(root, 'a.txt'), 'utf8').startsWith('hello'));

    // 2. read_file numera linhas
    const read = await executeTool('read_file', { path: 'a.txt' }, ctx);
    check('lê com numeração', read.ok && read.output.includes('1: hello') && read.output.includes('2: world'));

    // 3. list_dir ignora node_modules
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x.js'), 'x', 'utf8');
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
    const listing = await executeTool('list_dir', { path: '.' }, ctx);
    check('lista ignora node_modules', listing.ok && listing.output.includes('src/') && !listing.output.includes('node_modules'));

    // 4. search literal
    writeFileSync(join(root, 'src', 'needle.ts'), 'const needle = 1;\nconst other = 2;\n', 'utf8');
    const search = await executeTool('search', { query: 'needle' }, ctx);
    check('busca literal', search.ok && search.output.includes('src/needle.ts:1'));
    check('respeita maxResults', (await executeTool('search', { query: 'const', maxResults: 1 }, ctx)).meta?.matches === 1);

    // 5. apply_patch único
    const patched = await executeTool(
      'apply_patch',
      { path: 'a.txt', search: 'world', replace: 'mundo' },
      makeContext({ readPaths: new Set([join(root, 'a.txt')]) }),
    );
    check('apply_patch único', patched.ok && readFileSync(join(root, 'a.txt'), 'utf8').includes('mundo'));

    // 6. apply_patch com 0 e 2 ocorrências
    writeFileSync(join(root, 'b.txt'), 'foo foo\n', 'utf8');
    const twice = await executeTool(
      'apply_patch',
      { path: 'b.txt', search: 'foo', replace: 'bar' },
      makeContext({ readPaths: new Set([join(root, 'b.txt')]) }),
    );
    check('apply_patch recusa múltiplas', !twice.ok);
    const none = await executeTool(
      'apply_patch',
      { path: 'b.txt', search: 'inexistente', replace: 'x' },
      makeContext({ readPaths: new Set([join(root, 'b.txt')]) }),
    );
    check('apply_patch recusa ausente', !none.ok);

    // 7. path fora do workdir
    const escape = await executeTool('read_file', { path: '../fora.txt' }, ctx);
    check('bloqueia path fora do workdir', !escape.ok);

    // 8. .env bloqueado
    writeFileSync(join(root, '.env'), 'SECRET=1\n', 'utf8');
    const env = await executeTool('read_file', { path: '.env' }, ctx);
    check('bloqueia leitura de .env', !env.ok);

    // 9. escrita desabilitada
    const noWrite = await executeTool(
      'write_file',
      { path: 'c.txt', content: 'x' },
      makeContext({ allowWrite: false }),
    );
    check('bloqueia escrita quando allowWrite=false', !noWrite.ok);

    // 10. binário recusado
    writeFileSync(join(root, 'bin.dat'), 'abc\u0000def', 'utf8');
    const binary = await executeTool('read_file', { path: 'bin.dat' }, ctx);
    check('recusa binário', !binary.ok);

    // 11. truncamento de saída
    writeFileSync(join(root, 'long.txt'), 'linha\n'.repeat(2000), 'utf8');
    const longRead = await executeTool(
      'read_file',
      { path: 'long.txt' },
      makeContext({ maxOutputChars: 200 }),
    );
    check('trunca saída', longRead.output.length <= 260 && longRead.output.includes('truncado'));

    // 12. run_command fora da allowlist
    const badCommand = await executeTool('run_command', { label: 'rm-rf' }, ctx);
    check('recusa comando fora da allowlist', !badCommand.ok);

    check('catálogo tem 14 ferramentas', TOOLS.length === 14);
    check('write_file exige leitura prévia', !(await executeTool(
      'write_file',
      { path: 'a.txt', content: 'sem leitura' },
      makeContext({ readPaths: new Set() }),
    )).ok);

    // 13. ferramentas de rede/instalação/git desligadas por padrão
    const webOff = await executeTool('web_fetch', { url: 'https://example.com' }, ctx);
    check('web_fetch bloqueado com rede desligada', !webOff.ok && webOff.output.includes('desabilitado'));
    const instOff = await executeTool('npm_install', { packages: 'zod' }, ctx);
    check('npm_install bloqueado por padrão', !instOff.ok && instOff.output.includes('desabilitada'));
    const commitOff = await executeTool('git_commit', { message: 'x' }, ctx);
    check('git_commit bloqueado por padrão', !commitOff.ok);
    const prOff = await executeTool('create_pr', { title: 'x' }, ctx);
    check('create_pr bloqueado por padrão', !prOff.ok);

    // 14. política de rede: só https, sem hosts privados (não toca a rede)
    const netCtx = makeContext({ allowNetwork: true });
    const httpRes = await executeTool('web_fetch', { url: 'http://example.com' }, netCtx);
    check('web_fetch recusa http', !httpRes.ok && httpRes.output.includes('https'));
    const localhostRes = await executeTool('web_fetch', { url: 'https://localhost/x' }, netCtx);
    check('web_fetch recusa localhost', !localhostRes.ok);
    const privRes = await executeTool('web_fetch', { url: 'https://192.168.0.1/x' }, netCtx);
    check('web_fetch recusa IP privado', !privRes.ok);
    const restrictedCtx = makeContext({ allowNetwork: true, allowedDomains: ['example.com'] });
    const offDomain = await executeTool('web_fetch', { url: 'https://example.org/x' }, restrictedCtx);
    check('web_fetch respeita allowlist de domínio', !offDomain.ok && offDomain.output.includes('allowlist'));
    check(
      'isPrivateHost reconhece faixas internas',
      isPrivateHost('10.0.0.1')
        && isPrivateHost('127.0.0.1')
        && isPrivateHost('169.254.169.254')
        && isPrivateHost('intranet')
        && !isPrivateHost('example.com'),
    );

    // 15. install valida spec e exige confirmação (mesmo com autoApprove)
    const instCtx = makeContext({ allowInstall: true });
    const badPkg = await executeTool('npm_install', { packages: 'file:/etc/passwd' }, instCtx);
    check('npm_install recusa spec perigosa', !badPkg.ok);
    const noConfirm = await executeTool('npm_install', { packages: 'zod' }, instCtx);
    check('npm_install exige confirmação', !noConfirm.ok && noConfirm.output.includes('confirmação'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} verificação(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nTools smoke OK.');
  }
}

void main();
