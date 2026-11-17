import { spawnSync } from 'node:child_process';
import { createDecipheriv, createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface BrowserNotionCookie {
  cookie: string;
  source: string;
  hostKey: string;
}

interface CookieRow {
  hostKey: string;
  name: string;
  value: string;
  encrypted: Buffer;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

interface BrowserStore {
  label: string;
  root: string;
  profile: string;
  cookies: string;
  localState: string;
}

const NOTION_COOKIE_NAMES = [
  'token_v2',
  'notion_user_id',
  'notion_browser_id',
  'device_id',
  'notion_users',
  'notion_sync_user_id',
  '__Host-session_binding',
] as const;

const NOTION_EXTRA_COOKIE_ORDER = [
  'notion_user_id',
  'notion_browser_id',
  'device_id',
  'notion_users',
  'notion_sync_user_id',
  '__Host-session_binding',
] as const;

const require = createRequire(import.meta.url);

function loadSqlite(): SqliteModule | null {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (text.includes('SQLite is an experimental feature')) return;
    (original as (...rest: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return require('node:sqlite') as SqliteModule;
  } catch {
    return null;
  } finally {
    process.emitWarning = original;
  }
}

function browserRoots(): Array<{ label: string; root: string }> {
  if (process.platform !== 'win32') return [];
  const local = process.env['LOCALAPPDATA'] ?? '';
  const roaming = process.env['APPDATA'] ?? '';
  const roots: Array<{ label: string; root: string }> = [];
  const custom = (process.env['NOTION_COOKIE_DIR'] ?? '').trim();
  if (custom) roots.push({ label: 'Edge (custom)', root: custom });
  if (local) {
    roots.push(
      { label: 'Edge', root: join(local, 'Microsoft', 'Edge', 'User Data') },
      { label: 'Chrome', root: join(local, 'Google', 'Chrome', 'User Data') },
      { label: 'Brave', root: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { label: 'Chromium', root: join(local, 'Chromium', 'User Data') },
    );
  }
  if (roaming) {
    roots.push({ label: 'Notion', root: join(roaming, 'Notion') });
  }
  return roots;
}

function profiles(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name === 'Default' || /^Profile \d+$/.test(name));
  } catch {
    return [];
  }
}

function cookieFiles(base: string): string[] {
  return [join(base, 'Network', 'Cookies'), join(base, 'Cookies')].filter(existsSync);
}

function listStores(): BrowserStore[] {
  const stores: BrowserStore[] = [];
  for (const { label, root } of browserRoots()) {
    const localState = join(root, 'Local State');
    if (!existsSync(localState)) continue;
    for (const profile of profiles(root)) {
      const base = join(root, profile);
      for (const cookies of cookieFiles(base)) {
        stores.push({
          label: `${label} (${profile})`,
          root,
          profile,
          cookies,
          localState,
        });
      }
    }
  }

  const roaming = process.env['APPDATA'] ?? '';
  if (roaming) {
    const notionRoot = join(roaming, 'Notion');
    const localState = join(notionRoot, 'Local State');
    if (existsSync(localState)) {
      const candidates = [
        join(notionRoot, 'Network', 'Cookies'),
        join(notionRoot, 'Cookies'),
        join(notionRoot, 'Partitions', 'notion', 'Network', 'Cookies'),
        join(notionRoot, 'Partitions', 'notion', 'Cookies'),
      ];
      for (const cookies of candidates.filter(existsSync)) {
        stores.push({
          label: 'Notion (app)',
          root: notionRoot,
          profile: '',
          cookies,
          localState,
        });
      }
    }
  }

  return stores;
}

function dpapiUnprotect(blob: Buffer): Buffer | null {
  const script = [
    'Add-Type -AssemblyName System.Security;',
    '$b=[Convert]::FromBase64String($env:VAKTOR_DPAPI_BLOB);',
    '$d=[System.Security.Cryptography.ProtectedData]::Unprotect(',
    '$b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Convert]::ToBase64String($d)',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, VAKTOR_DPAPI_BLOB: blob.toString('base64') },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0 || !result.stdout) return null;
  try {
    return Buffer.from(result.stdout.trim(), 'base64');
  } catch {
    return null;
  }
}

function localStateKey(localState: string): Buffer | null {
  try {
    const parsed = JSON.parse(readFileSync(localState, 'utf8')) as {
      os_crypt?: { encrypted_key?: unknown };
    };
    const encoded = parsed.os_crypt?.encrypted_key;
    if (typeof encoded !== 'string' || encoded.length === 0) return null;
    const blob = Buffer.from(encoded, 'base64');
    const keyBlob = blob.subarray(0, 5).toString('latin1') === 'DPAPI' ? blob.subarray(5) : blob;
    const key = dpapiUnprotect(keyBlob);
    return key && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function readRows(cookiesPath: string): CookieRow[] {
  const sqlite = loadSqlite();
  if (!sqlite) return [];
  const temp = mkdtempSync(join(tmpdir(), 'vaktor-notion-'));
  const copy = join(temp, 'Cookies');
  try {
    copyFileSync(cookiesPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      const extra = `${cookiesPath}${suffix}`;
      if (existsSync(extra)) copyFileSync(extra, `${copy}${suffix}`);
    }
    const db = new sqlite.DatabaseSync(copy);
    try {
      const placeholders = NOTION_COOKIE_NAMES.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT host_key, name, value, encrypted_value FROM cookies WHERE name IN (${placeholders})`,
        )
        .all(...NOTION_COOKIE_NAMES);
      return rows.flatMap((raw) => {
        const record = raw as Record<string, unknown>;
        const hostKey = typeof record['host_key'] === 'string' ? record['host_key'] : '';
        const name = typeof record['name'] === 'string' ? record['name'] : '';
        const value = typeof record['value'] === 'string' ? record['value'] : '';
        const encryptedValue = record['encrypted_value'];
        const encrypted =
          encryptedValue instanceof Uint8Array
            ? Buffer.from(encryptedValue)
            : typeof encryptedValue === 'string'
              ? Buffer.from(encryptedValue, 'latin1')
              : Buffer.alloc(0);
        if (!hostKey.toLowerCase().includes('notion')) return [];
        return [{ hostKey, name, value, encrypted }];
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function decryptValue(encrypted: Buffer, key: Buffer | null, hostKey: string): string {
  if (encrypted.length === 0) return '';
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix === 'v10' || prefix === 'v11' || prefix === 'v20') {
    if (!key) return '';
    const payload = encrypted.subarray(3);
    if (payload.length < 28) return '';
    const nonce = payload.subarray(0, 12);
    const tag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(12, payload.length - 16);
    const aads: Array<Uint8Array | undefined> = [
      new Uint8Array(Buffer.from(hostKey)),
      undefined,
    ];
    const digest = createHash('sha256').update(hostKey).digest();
    for (const aad of aads) {
      try {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          new Uint8Array(key),
          new Uint8Array(nonce),
        );
        if (aad) decipher.setAAD(aad);
        decipher.setAuthTag(new Uint8Array(tag));
        const first = new Uint8Array(decipher.update(new Uint8Array(ciphertext)));
        const last = new Uint8Array(decipher.final());
        const plain = new Uint8Array(first.length + last.length);
        plain.set(first);
        plain.set(last, first.length);
        let hasDigest = plain.length >= 32;
        for (let index = 0; hasDigest && index < 32; index++) {
          if (plain[index] !== digest[index]) hasDigest = false;
        }
        const value = hasDigest ? plain.subarray(32) : plain;
        const text = Buffer.from(value).toString('utf8');
        if (text.length > 0 && !text.includes('\uFFFD')) return text;
      } catch {
        continue;
      }
    }
    return '';
  }
  const plain = dpapiUnprotect(encrypted);
  return plain ? plain.toString('utf8') : '';
}

function hostScore(hostKey: string): number {
  const host = hostKey.toLowerCase().replace(/^\./, '');
  if (host === 'notion.so' || host === 'www.notion.so') return 5;
  if (host.endsWith('notion.so')) return 4;
  if (host === 'notion.com' || host === 'app.notion.com') return 3;
  if (host.endsWith('notion.com')) return 2;
  if (host.endsWith('notion.site')) return 1;
  return 0;
}

function composeCookie(rows: CookieRow[], key: Buffer | null): BrowserNotionCookie | null {
  const safe = (value: string): boolean => value.length > 0 && !/[;\r\n]/.test(value);
  const chosen = new Map<string, { score: number; value: string; hostKey: string }>();

  for (const row of rows) {
    const score = hostScore(row.hostKey);
    if (score === 0) continue;
    const value = row.value || decryptValue(row.encrypted, key, row.hostKey);
    if (!safe(value)) continue;
    const previous = chosen.get(row.name);
    if (previous && previous.score >= score) continue;
    chosen.set(row.name, { score, value, hostKey: row.hostKey });
  }

  const token = chosen.get('token_v2');
  if (!token) return null;

  const parts = [`token_v2=${token.value}`];
  for (const name of NOTION_EXTRA_COOKIE_ORDER) {
    const extra = chosen.get(name);
    if (extra) parts.push(`${name}=${extra.value}`);
  }

  return {
    cookie: parts.join('; '),
    source: '',
    hostKey: token.hostKey,
  };
}

export function browserNotionCookieAutoEnabled(): boolean {
  const raw = (process.env['NOTION_COOKIE_AUTO'] ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function readFirefoxRows(cookiesPath: string): CookieRow[] {
  const sqlite = loadSqlite();
  if (!sqlite) return [];
  const temp = mkdtempSync(join(tmpdir(), 'vaktor-notion-ff-'));
  const copy = join(temp, 'cookies.sqlite');
  try {
    copyFileSync(cookiesPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      const extra = `${cookiesPath}${suffix}`;
      if (existsSync(extra)) copyFileSync(extra, `${copy}${suffix}`);
    }
    const db = new sqlite.DatabaseSync(copy);
    try {
      const placeholders = NOTION_COOKIE_NAMES.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT host,name,value FROM moz_cookies WHERE name IN (${placeholders}) AND host LIKE '%notion%'`,
        )
        .all(...NOTION_COOKIE_NAMES);
      return rows.flatMap((raw) => {
        const record = raw as Record<string, unknown>;
        const hostKey = typeof record['host'] === 'string' ? record['host'] : '';
        const name = typeof record['name'] === 'string' ? record['name'] : '';
        const value = typeof record['value'] === 'string' ? record['value'] : '';
        if (!hostKey.toLowerCase().includes('notion')) return [];
        return [{ hostKey, name, value, encrypted: Buffer.alloc(0) }];
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function readFirefoxNotionCookie(): BrowserNotionCookie | null {
  const root = process.env['APPDATA']
    ? join(process.env['APPDATA'], 'Mozilla', 'Firefox', 'Profiles')
    : '';
  if (!root || !existsSync(root)) return null;
  let names: string[] = [];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  for (const name of names) {
    const cookies = join(root, name, 'cookies.sqlite');
    if (!existsSync(cookies)) continue;
    const rows = readFirefoxRows(cookies);
    if (rows.length === 0) continue;
    const found = composeCookie(rows, null);
    if (found) return { ...found, source: `Firefox (${name})` };
  }
  return null;
}

function readBrowserNotionCookieUncached(): BrowserNotionCookie | null {
  if (!browserNotionCookieAutoEnabled()) return null;
  const filter = (process.env['NOTION_COOKIE_BROWSER'] ?? '').trim().toLowerCase();
  if (!filter || 'firefox'.includes(filter)) {
    const firefox = readFirefoxNotionCookie();
    if (firefox) return firefox;
  }
  if (process.platform !== 'win32') return null;
  const stores = listStores().filter(
    (store) => !filter || store.label.toLowerCase().includes(filter),
  );
  for (const store of stores) {
    try {
      const rows = readRows(store.cookies);
      if (rows.length === 0) continue;
      const key = localStateKey(store.localState);
      const found = composeCookie(rows, key);
      if (found) return { ...found, source: store.label };
    } catch {
      continue;
    }
  }
  return null;
}

let cookieLookupCache: {
  at: number;
  cookie: BrowserNotionCookie | null;
} | null = null;

export function readBrowserNotionCookie(): BrowserNotionCookie | null {
  const ttl = cookieLookupCache?.cookie ? 300_000 : 5_000;
  if (cookieLookupCache && Date.now() - cookieLookupCache.at < ttl) {
    return cookieLookupCache.cookie;
  }
  const cookie = readBrowserNotionCookieUncached();
  cookieLookupCache = { at: Date.now(), cookie };
  return cookie;
}
