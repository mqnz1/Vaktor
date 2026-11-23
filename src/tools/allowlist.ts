// =============================================================
// Allowlist de comandos do agente.
//
// Regra de ouro: o modelo NUNCA escolhe o binário. Ele escolhe apenas
// um `label` desta lista. O comando real vem daqui, do .env ou do código.
// =============================================================
import { basename, extname } from 'node:path';
import type { AllowedCommand } from '../types/index.js';

export const DEFAULT_ALLOWED_COMMANDS: readonly AllowedCommand[] = [
  { label: 'typecheck', bin: 'npm', args: ['run', 'typecheck'] },
  { label: 'test', bin: 'npm', args: ['test'] },
  { label: 'build', bin: 'npm', args: ['run', 'build'] },
  { label: 'tsc', bin: 'npx', args: ['tsc', '--noEmit'] },
  { label: 'lint', bin: 'npm', args: ['run', 'lint'] },
  { label: 'git-status', bin: 'git', args: ['status'] },
  { label: 'git-diff', bin: 'git', args: ['diff'] },
  { label: 'git-log', bin: 'git', args: ['log', '--oneline', '-10'] },
];

const FORBIDDEN_BINS = new Set([
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'fish', 'rm', 'del', 'erase', 'rmdir', 'rd',
  'format', 'diskpart', 'reg', 'regedit', 'sc', 'net', 'shutdown',
  'curl', 'wget', 'certutil', 'bitsadmin', 'mshta', 'rundll32',
  'regsvr32', 'wmic', 'takeown', 'icacls', 'attrib',
]);

function normalizeBin(bin: string): string {
  return basename(bin).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/i, '');
}

function hasShellMetacharacter(arg: string): boolean {
  return /[&|<>^`\n\r]/.test(arg);
}

export function isForbiddenCommand(bin: string, args: readonly string[]): string | null {
  const clean = normalizeBin(bin);
  if (FORBIDDEN_BINS.has(clean)) {
    return `binário proibido: ${bin}`;
  }

  for (const arg of args) {
    if (hasShellMetacharacter(arg)) {
      return `argumento com metacaractere de shell: ${arg}`;
    }
  }

  if (clean === 'npm') {
    const quiet = args.map(a => a.toLowerCase());
    if (quiet.some(a => ['publish', 'install', 'i', 'add', 'update', 'up', 'uninstall', 'remove', 'rm', 'link', 'exec'].includes(a))) {
      return 'operação npm proibida (instalação/publicação)';
    }
    if (quiet.includes('--global') || quiet.includes('-g')) {
      return 'operação npm global proibida';
    }
  }

  if (clean === 'git') {
    const sub = (args[0] ?? '').toLowerCase();
    if (['push', 'clean', 'config', 'remote', 'submodule', 'filter-branch'].includes(sub)) {
      return `operação git proibida: ${sub}`;
    }
    if (sub === 'reset' && args.some(a => a.toLowerCase() === '--hard')) {
      return 'git reset --hard proibido';
    }
    if (sub === 'checkout' && args.some(a => a === '--')) {
      return 'git checkout -- proibido';
    }
  }

  if (clean === 'node') {
    const quiet = args.map(a => a.toLowerCase());
    if (quiet.some(a => ['-e', '--eval', '-p', '--print'].includes(a))) {
      return 'node -e/--eval proibido';
    }
  }

  return null;
}

function cloneDefaults(): AllowedCommand[] {
  return DEFAULT_ALLOWED_COMMANDS.map(c => ({ label: c.label, bin: c.bin, args: [...c.args] }));
}

export interface ParsedAllowedCommands {
  commands: AllowedCommand[];
  warnings: string[];
}

/**
 * Formato: `label=bin arg1 arg2;label2=bin arg3`.
 * Lista vazia usa o padrão. Entradas inválidas são ignoradas com aviso.
 */
export function parseAllowedCommands(raw: string | null): ParsedAllowedCommands {
  if (!raw || raw.trim().length === 0) {
    return { commands: cloneDefaults(), warnings: [] };
  }

  const commands: AllowedCommand[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const chunk of raw.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      warnings.push(`TOOLS_ALLOWED_COMMANDS: entrada ignorada (sem label=): ${trimmed}`);
      continue;
    }

    const label = trimmed.slice(0, eq).trim();
    const command = trimmed.slice(eq + 1).trim();
    if (!label || !command) {
      warnings.push(`TOOLS_ALLOWED_COMMANDS: entrada ignorada (label/comando vazio): ${trimmed}`);
      continue;
    }
    if (!/^[a-z0-9_-]+$/i.test(label)) {
      warnings.push(`TOOLS_ALLOWED_COMMANDS: label inválido ignorado: ${label}`);
      continue;
    }
    if (seen.has(label.toLowerCase())) {
      warnings.push(`TOOLS_ALLOWED_COMMANDS: label duplicado ignorado: ${label}`);
      continue;
    }

    const parts = command.split(/\s+/);
    const bin = parts[0] ?? '';
    const args = parts.slice(1);
    if (!bin) {
      warnings.push(`TOOLS_ALLOWED_COMMANDS: comando vazio ignorado: ${label}`);
      continue;
    }

    const forbidden = isForbiddenCommand(bin, args);
    if (forbidden) {
      warnings.push(`TOOLS_ALLOWED_COMMANDS: ${label} ignorado (${forbidden})`);
      continue;
    }

    seen.add(label.toLowerCase());
    commands.push({ label, bin, args });
  }

  if (commands.length === 0) {
    warnings.push('TOOLS_ALLOWED_COMMANDS: nenhum comando válido; usando allowlist padrão.');
    return { commands: cloneDefaults(), warnings };
  }

  return { commands, warnings };
}

/**
 * No Windows `spawn('npm.cmd', ..., { shell: false })` falha com EINVAL.
 * Por isso npm/npx são executados como `node <npm-cli.js>` — sem shell.
 */
export interface ResolvedExecutable {
  bin: string;
  args: string[];
}

export function resolveExecutable(bin: string, args: readonly string[]): ResolvedExecutable {
  if (process.platform !== 'win32') {
    return { bin, args: [...args] };
  }

  const clean = normalizeBin(bin);
  if (clean === 'npm' || clean === 'npx') {
    const nodeDir = basename(process.execPath).toLowerCase() === 'node.exe'
      ? process.execPath.slice(0, process.execPath.length - 'node.exe'.length)
      : '';
    const cliName = clean === 'npm' ? 'npm-cli.js' : 'npx-cli.js';
    const cli = `${nodeDir}node_modules\\npm\\bin\\${cliName}`;
    return { bin: process.execPath, args: [cli, ...args] };
  }

  return { bin, args: [...args] };
}

export function commandExtension(bin: string): string {
  return extname(bin);
}
