import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VAKTOR_VERSION } from '../version.js';

const DEFAULT_REPO = 'mqnz1/Vaktor';
const DEFAULT_BRANCH = 'main';
const CHECK_TIMEOUT_MS = 6_000;
const DEFAULT_INTERVAL_MS = 21_600_000;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  source: 'release' | 'tag' | 'package';
  url?: string;
}

export interface UpdateInstallResult {
  ok: boolean;
  error?: string;
}

interface UpdateState {
  dismissedVersion?: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function updateRepo(): string {
  return env('VAKTOR_UPDATE_REPO') ?? DEFAULT_REPO;
}

export function updateBranch(): string {
  return env('VAKTOR_UPDATE_BRANCH') ?? DEFAULT_BRANCH;
}

export function updateCheckEnabled(): boolean {
  const flag = (env('VAKTOR_UPDATE_CHECK') ?? 'on').toLowerCase();
  if (flag === 'off' || flag === 'false' || flag === '0' || flag === 'no') return false;
  return Boolean(process.stdout.isTTY);
}

export function updateCheckIntervalMs(): number {
  const value = Number(env('VAKTOR_UPDATE_INTERVAL_MS') ?? DEFAULT_INTERVAL_MS);
  return Number.isFinite(value) && value >= 60_000 ? value : DEFAULT_INTERVAL_MS;
}

function parseVersion(value: string): ParsedVersion | null {
  const normalized = value.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    normalized,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    if (leftNumber) return -1;
    if (rightNumber) return 1;
    const diff = left.localeCompare(right);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return comparePre(a.pre, b.pre);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Vaktor',
      'Accept': 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function checkForUpdate(
  currentVersion = VAKTOR_VERSION,
): Promise<UpdateInfo | null> {
  try {
    const repo = updateRepo();
    const release = asRecord(
      await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`),
    );
    const releaseTag = typeof release['tag_name'] === 'string' ? release['tag_name'] : '';
    if (releaseTag) {
      const latestVersion = normalizeVersion(releaseTag);
      if (parseVersion(latestVersion)) {
        if (compareVersions(latestVersion, currentVersion) > 0) {
          return {
            currentVersion,
            latestVersion,
            source: 'release',
            url:
              typeof release['html_url'] === 'string'
                ? release['html_url']
                : `https://github.com/${repo}/releases`,
          };
        }
        return null;
      }
    }

    const tags = await fetchJson(`https://api.github.com/repos/${repo}/tags?per_page=50`);
    if (Array.isArray(tags)) {
      let bestVersion = '';
      for (const item of tags) {
        const name = asRecord(item)['name'];
        if (typeof name !== 'string') continue;
        const version = normalizeVersion(name);
        if (!parseVersion(version)) continue;
        if (!bestVersion || compareVersions(version, bestVersion) > 0) {
          bestVersion = version;
        }
      }
      if (bestVersion) {
        if (compareVersions(bestVersion, currentVersion) > 0) {
          return {
            currentVersion,
            latestVersion: bestVersion,
            source: 'tag',
            url: `https://github.com/${repo}/tags`,
          };
        }
        return null;
      }
    }

    const pkg = asRecord(
      await fetchJson(
        `https://raw.githubusercontent.com/${repo}/${updateBranch()}/package.json`,
      ),
    );
    const packageVersion =
      typeof pkg['version'] === 'string' ? normalizeVersion(pkg['version']) : '';
    if (packageVersion && compareVersions(packageVersion, currentVersion) > 0) {
      return {
        currentVersion,
        latestVersion: packageVersion,
        source: 'package',
        url: `https://github.com/${repo}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function updateStatePath(): string {
  return env('VAKTOR_UPDATE_STATE_FILE') ?? join(homedir(), '.vaktor', 'update.json');
}

export function loadUpdateState(): UpdateState {
  try {
    const parsed = JSON.parse(readFileSync(updateStatePath(), 'utf8')) as unknown;
    const record = asRecord(parsed);
    return typeof record['dismissedVersion'] === 'string'
      ? { dismissedVersion: record['dismissedVersion'] }
      : {};
  } catch {
    return {};
  }
}

export function dismissUpdate(version: string): void {
  try {
    const path = updateStatePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ dismissedVersion: version }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    return;
  }
}

export function isUpdateDismissed(version: string): boolean {
  return loadUpdateState().dismissedVersion === version;
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function run(
  command: string,
  args: string[],
  cwd: string,
  shell = false,
): Promise<number> {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'ignore',
      shell,
      windowsHide: true,
    });
    child.on('error', () => resolvePromise(-1));
    child.on('close', code => resolvePromise(code ?? -1));
  });
}

function runNpm(args: string[], cwd: string): Promise<number> {
  return run('npm', args, cwd, process.platform === 'win32');
}

export async function installVaktorUpdate(): Promise<UpdateInstallResult> {
  const root = packageRoot();
  const hasGit = existsSync(join(root, '.git'));

  if (!hasGit) {
    const code = await runNpm(['install', '-g', 'vaktor@latest'], root);
    return code === 0
      ? { ok: true }
      : { ok: false, error: 'npm install -g vaktor@latest failed' };
  }

  const pull = await run('git', ['-C', root, 'pull', '--ff-only'], root);
  if (pull !== 0) {
    return { ok: false, error: 'git pull failed; verifique alterações locais' };
  }

  const install = await runNpm(['install'], root);
  if (install !== 0) {
    return { ok: false, error: 'npm install failed' };
  }

  const build = await runNpm(['run', 'build'], root);
  if (build !== 0) {
    return { ok: false, error: 'npm run build failed' };
  }

  return { ok: true };
}
