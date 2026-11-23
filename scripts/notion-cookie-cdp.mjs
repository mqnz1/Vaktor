import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';

const EDGE_PATHS = [
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env['ProgramFiles'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(path => path && existsSync(path));

const ENV_PATH = join(import.meta.dirname, '..', '.env');
const PROFILE_DIR =
  process.env.VAKTOR_EDGE_NOTION_DIR?.trim() ||
  join(process.env['LOCALAPPDATA'] ?? '', 'Vaktor', 'EdgeNotion');
const LOGIN_TIMEOUT_MS = Number(process.env.VAKTOR_EDGE_LOGIN_TIMEOUT_MS ?? 5 * 60_000);
const KEEP_EDGE = process.env.VAKTOR_KEEP_EDGE === '1';
const WANTED = [
  'token_v2',
  'notion_user_id',
  'notion_browser_id',
  'device_id',
  'notion_users',
  'notion_sync_user_id',
  '__Host-session_binding',
];

function log(message) {
  console.log(message);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`resposta inválida de ${url}: ${raw.slice(0, 120)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, readStderr, timeoutMs = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const info = await new Promise((resolve, reject) => {
        const req = request(`http://127.0.0.1:${port}/json/version`, res => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', chunk => {
            raw += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch {
              reject(new Error('JSON inválido'));
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
      if (info) return;
    } catch {}
    await delay(200);
  }
  const detail = readStderr().trim();
  throw new Error(
    `Edge não abriu a porta do DevTools a tempo.${detail ? ` ${detail.slice(0, 300)}` : ''}`,
  );
}

function cdp(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const id = 1;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`timeout em ${method}`)), 15_000);
    socket.addEventListener(
      'open',
      () => {
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          finish(reject, error);
        }
      },
      { once: true },
    );
    socket.addEventListener('message', event => {
      const text = typeof event.data === 'string' ? event.data : String(event.data);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (parsed.id !== id) return;
      if (parsed.error) finish(reject, new Error(`${method}: ${parsed.error.message}`));
      else finish(resolve, parsed.result);
    });
    socket.addEventListener(
      'error',
      () => finish(reject, new Error(`falha de CDP em ${method}`)),
      { once: true },
    );
    socket.addEventListener(
      'close',
      () => finish(reject, new Error(`CDP fechou durante ${method}`)),
      { once: true },
    );
  });
}

async function readCookies(wsUrl) {
  const result = await cdp(wsUrl, 'Storage.getCookies', {});
  return Array.isArray(result?.cookies) ? result.cookies : [];
}

async function browserWs(port) {
  const version = await httpJson(`http://127.0.0.1:${port}/json/version`);
  if (!version?.webSocketDebuggerUrl) throw new Error('Edge sem WebSocket do DevTools.');
  return version.webSocketDebuggerUrl;
}

function appliesToAppNotion(domain) {
  const host = domain.replace(/^\./, '').toLowerCase();
  return (
    host.includes('notion') &&
    ('app.notion.com' === host || 'app.notion.com'.endsWith(`.${host}`))
  );
}

function hasLoginCookie(cookies) {
  const now = Math.floor(Date.now() / 1000);
  return cookies.some(cookie => {
    if (cookie.name !== 'token_v2') return false;
    if (!appliesToAppNotion(String(cookie.domain ?? ''))) return false;
    if (typeof cookie.expires === 'number' && cookie.expires > 0 && cookie.expires < now) {
      return false;
    }
    return String(cookie.value ?? '').length > 0;
  });
}

function compose(cookies) {
  const chosen = new Map();
  const now = Math.floor(Date.now() / 1000);
  for (const cookie of cookies) {
    if (!WANTED.includes(cookie.name)) continue;
    if (!appliesToAppNotion(cookie.domain)) continue;
    if (typeof cookie.expires === 'number' && cookie.expires > 0 && cookie.expires < now) continue;
    const value = String(cookie.value ?? '');
    if (!value || /[;\r\n]/.test(value)) continue;
    const previous = chosen.get(cookie.name);
    if (!previous || cookie.domain.length > previous.domain.length) {
      chosen.set(cookie.name, { domain: cookie.domain, value });
    }
  }
  const token = chosen.get('token_v2');
  if (!token) return null;
  const parts = [`token_v2=${token.value}`];
  for (const name of WANTED) {
    if (name === 'token_v2') continue;
    const cookie = chosen.get(name);
    if (cookie) parts.push(`${name}=${cookie.value}`);
  }
  return parts.join('; ');
}

function updateEnv(cookie) {
  const content = readFileSync(ENV_PATH, 'utf8');
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const out = lines.map(line => {
    if (!/^\s*NOTION_COOKIE\s*=/.test(line)) return line;
    replaced = true;
    return `NOTION_COOKIE=${cookie}`;
  });
  if (!replaced) out.push(`NOTION_COOKIE=${cookie}`);
  writeFileSync(ENV_PATH, out.join(newline), 'utf8');
}

function launch(edge, headless, port) {
  const args = [
    ...(headless ? ['--headless=new', '--disable-gpu'] : []),
    '--disable-background-mode',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeFirstRunExperience',
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE_DIR}`,
    '--profile-directory=Default',
    `--remote-debugging-port=${port}`,
    headless ? 'about:blank' : 'https://app.notion.com',
  ];
  const child = spawn(edge, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: headless,
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  return { child, stderr: () => stderr };
}

function kill(child) {
  if (!child?.pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {}
}

const edge = EDGE_PATHS[0];
if (!edge) throw new Error('msedge.exe não encontrado.');
mkdirSync(PROFILE_DIR, { recursive: true });

log(`Perfil dedicado do Edge: ${PROFILE_DIR}`);
let port = await freePort();
let { child, stderr } = launch(edge, true, port);
try {
  await waitForPort(port, stderr, 20_000);
} catch (error) {
  kill(child);
  if (!/non-default|DevTools/i.test(stderr())) throw error;
  log('Não consegui abrir em modo headless; abrindo uma janela visível...');
  port = await freePort();
  ({ child, stderr } = launch(edge, false, port));
  await waitForPort(port, stderr, 25_000);
}

let ws = await browserWs(port);
let cookies = await readCookies(ws);
if (!hasLoginCookie(cookies)) {
  if (process.env.VAKTOR_EDGE_NO_LOGIN === '1') {
    kill(child);
    throw new Error('perfil dedicado sem login no Notion (modo de teste).');
  }
  kill(child);
  log('Abrindo o Edge para você entrar no Notion. Faça login na janela que abrir...');
  port = await freePort();
  ({ child, stderr } = launch(edge, false, port));
  await waitForPort(port, stderr, 25_000);
  ws = await browserWs(port);
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let lastNotice = 0;
  while (Date.now() < deadline) {
    try {
      cookies = await readCookies(ws);
    } catch {
      cookies = [];
    }
    if (hasLoginCookie(cookies)) break;
    if (Date.now() - lastNotice > 15_000) {
      lastNotice = Date.now();
      log('Aguardando o login no Notion...');
    }
    await delay(2_000);
  }
  if (!hasLoginCookie(cookies)) {
    kill(child);
    throw new Error('tempo esgotado aguardando o login no Notion.');
  }
  await delay(2_000);
  cookies = await readCookies(ws);
}

const cookie = compose(cookies);
if (!cookie) {
  kill(child);
  throw new Error('o Edge não devolveu um cookie utilizável do Notion.');
}
updateEnv(cookie);
const names = cookie
  .split(';')
  .map(part => part.trim().split('=')[0])
  .filter(Boolean);
log(`OK: .env atualizado com ${names.length} cookie(s): ${names.join(', ')}.`);
log('O valor do cookie não foi exibido. Reinicie o Vaktor para carregar o novo .env.');
if (!KEEP_EDGE) kill(child);
