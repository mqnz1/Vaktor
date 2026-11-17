import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const EDGE = [
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(process.env['ProgramFiles'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find(path => path && existsSync(path));
const PROFILE = join(process.env['LOCALAPPDATA'] ?? '', 'Vaktor', 'EdgeNotionThird');
const VERSION = '23.13.20260313.1423';
const LOGIN_TIMEOUT_MS =
  Number(process.env['VAKTOR_EDGE_LOGIN_TIMEOUT_MS'] ?? '') || 8 * 60_000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
function httpJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(url, { method }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { reject(new Error(raw.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
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
      try { socket.close(); } catch {}
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`timeout em ${method}`)), 30_000);
    socket.addEventListener('open', () => {
      try { socket.send(JSON.stringify({ id, method, params })); } catch (error) { finish(reject, error); }
    }, { once: true });
    socket.addEventListener('message', event => {
      let parsed;
      try { parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch { return; }
      if (parsed.id !== id) return;
      if (parsed.error) finish(reject, new Error(`${method}: ${parsed.error.message}`));
      else finish(resolve, parsed.result);
    });
    socket.addEventListener('error', () => finish(reject, new Error(`falha de CDP em ${method}`)), { once: true });
    socket.addEventListener('close', () => finish(reject, new Error(`CDP fechou durante ${method}`)), { once: true });
  });
}
async function evaluate(wsUrl, expression) {
  const result = await cdp(wsUrl, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'erro no navegador');
  return result?.result?.value;
}
async function getPage(port) {
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
  if (!Array.isArray(targets)) return null;
  const pages = targets.filter(target => target.type === 'page');
  return pages.find(target => /app\.notion\.com/.test(target.url ?? '')) ?? pages[0] ?? null;
}
async function browserWs(port) {
  const version = await httpJson(`http://127.0.0.1:${port}/json/version`);
  return version?.webSocketDebuggerUrl;
}

const authScript = `(async () => {
  const res = await fetch('/api/v3/getSpaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) return JSON.stringify({ status: res.status });
  const payload = await res.json();
  const groups = payload.recordMap ?? payload;
  let user = null;
  let space = null;
  let view = null;
  for (const group of Object.values(groups)) {
    const users = group?.notion_user ?? {};
    const spaces = group?.space ?? {};
    const views = group?.space_view ?? {};
    const userId = Object.keys(users)[0];
    const spaceId = Object.keys(spaces)[0];
    const viewId = Object.keys(views)[0];
    if (userId) {
      const value = users[userId]?.value?.value ?? {};
      user = { id: userId, email: value.email, name: value.name };
    }
    if (spaceId) {
      const value = spaces[spaceId]?.value?.value ?? {};
      space = { id: spaceId, name: value.name, plan: value.plan_type, tier: value.subscription_tier };
    }
    if (viewId) view = viewId;
  }
  return JSON.stringify({ status: res.status, user, space, view });
})()`;

function inferenceScript(type, auth, model = 'strawberry-whoopiepie') {
  return `(async () => {
    const uuid = () => crypto.randomUUID();
    const now = new Date().toISOString();
    const spaceId = ${JSON.stringify(auth.space.id)};
    const userId = ${JSON.stringify(auth.user.id)};
    const body = {
      traceId: uuid(), spaceId,
      transcript: [
        { id: uuid(), type: 'config', value: { type: ${JSON.stringify(type)}, model: ${JSON.stringify(model)}, modelFromUser: true, useWebSearch: true, searchScopes: [{ type: 'everything' }], isCustomAgent: false } },
        { id: uuid(), type: 'context', value: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', userId, spaceId, currentDatetime: now, surface: 'ai_module' } },
        { id: uuid(), type: 'user', value: [['Diga apenas: ok']], userId, createdAt: now }
      ],
      threadId: uuid(), createThread: true, isPartialTranscript: false, generateTitle: false,
      saveAllThreadOperations: false, setUnreadState: false, threadType: ${JSON.stringify(type)},
      hasHeartbeat: false, createdSource: 'ai_module', isUserInAnySalesAssistedSpace: false,
      isSpaceSalesAssisted: false, threadParentPointer: { table: 'space', id: spaceId, spaceId },
      debugOverrides: { emitAgentSearchExtractedResults: true, cachedInferences: {}, annotationInferences: {}, emitInferences: false }
    };
    const res = await fetch('/api/v3/runInferenceTranscript', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', 'notion-client-version': '${VERSION}', 'notion-audit-log-platform': 'web', 'x-notion-space-id': spaceId, 'x-notion-active-user-header': userId },
      body: JSON.stringify(body)
    });
    if (!res.ok) return JSON.stringify({ status: res.status, out: await res.text() });
    let out = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const started = Date.now();
    while (Date.now() - started < 25000) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
      if (out.length > 3000) { try { await reader.cancel(); } catch {} break; }
    }
    return JSON.stringify({ status: res.status, out: out.slice(0, 2500) });
  })()`;
}

const bannerScript = `(() => {
  document.title = 'Vaktor: troque para a conta com Notion AI';
  if (document.getElementById('vaktor-account-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'vaktor-account-banner';
  bar.textContent = 'Vaktor: esta é a conta temp-mail. Troque para a conta que tem Notion AI no menu do canto superior esquerdo.';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#111;color:#fff;font:14px/1.4 sans-serif;padding:10px 14px;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.4)';
  document.body.appendChild(bar);
})()`;

if (!EDGE) throw new Error('msedge.exe não encontrado.');
if ((process.env['VAKTOR_RESET_PROFILE'] ?? '') === '1') {
  rmSync(PROFILE, { recursive: true, force: true });
}
const port = await freePort();
const child = spawn(EDGE, [
  '--disable-background-mode', '--no-first-run', '--no-default-browser-check',
  '--disable-features=msEdgeFirstRunExperience', '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE}`, '--profile-directory=Default',
  `--remote-debugging-port=${port}`, 'https://app.notion.com/login',
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await httpJson(`http://127.0.0.1:${port}/json/version`);
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  if (!ready) throw new Error(`CDP não abriu: ${stderr.slice(0, 300)}`);

  console.log('Entre no Edge com a conta que tem Notion AI (não a temp-mail). Aguardando...');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let auth = null;
  let lastLabel = '';
  while (Date.now() < deadline) {
    try {
      const page = await getPage(port);
      if (page?.webSocketDebuggerUrl) {
        const raw = await evaluate(page.webSocketDebuggerUrl, authScript);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.status === 200 && parsed.user?.email) {
          const label = `${parsed.user.email} | ${parsed.space?.tier ?? '?'} | ${parsed.space?.id ?? '?'}`;
          if (label !== lastLabel) {
            console.log('conta detectada:', label);
            lastLabel = label;
          }
          if (/temp-mail\.store/i.test(parsed.user.email)) {
            await evaluate(page.webSocketDebuggerUrl, bannerScript).catch(() => {});
          } else {
            auth = parsed;
            break;
          }
        }
      }
    } catch {}
    await delay(3000);
  }
  if (!auth) throw new Error('tempo esgotado: nenhuma conta não-temp-mail autenticou no Edge.');

  const page = await getPage(port);
  if (!page?.webSocketDebuggerUrl) throw new Error('sem página do Notion no Edge.');

  console.log('\n=== teste no navegador: markdown-chat ===');
  const md = JSON.parse(await evaluate(page.webSocketDebuggerUrl, inferenceScript('markdown-chat', auth)));
  console.log('status', md.status, 'saída', (md.out || '').slice(0, 600) || '(vazia)');

  console.log('\n=== teste no navegador: workflow ===');
  const wf = JSON.parse(await evaluate(page.webSocketDebuggerUrl, inferenceScript('workflow', auth)));
  console.log('status', wf.status, 'saída', (wf.out || '').slice(0, 900) || '(vazia)');

  const looksOk = result =>
    result.status === 200 &&
    typeof result.out === 'string' &&
    result.out.length > 0 &&
    !/temporarily-unavailable|"type":"error"|UnauthorizedError|Must be authenticated/.test(result.out);
  const browserWorked = looksOk(md) || looksOk(wf);

  const browser = await browserWs(port);
  const cookieResult = await cdp(browser, 'Storage.getCookies', {});
  const wanted = ['token_v2', 'notion_user_id', 'notion_browser_id', 'device_id', 'notion_users', 'notion_sync_user_id', '__Host-session_binding'];
  const chosen = new Map();
  for (const cookie of cookieResult?.cookies ?? []) {
    if (!wanted.includes(cookie.name)) continue;
    const host = String(cookie.domain ?? '').replace(/^\./, '');
    if (!(host === 'app.notion.com' || 'app.notion.com'.endsWith(`.${host}`))) continue;
    if (!cookie.value || /[;\r\n]/.test(cookie.value)) continue;
    const previous = chosen.get(cookie.name);
    if (!previous || cookie.domain.length > previous.domain.length) chosen.set(cookie.name, cookie);
  }
  const parts = [];
  for (const name of wanted) {
    const cookie = chosen.get(name);
    if (cookie) parts.push(`${name}=${cookie.value}`);
  }
  const cookieHeader = parts.join('; ');
  console.log(`\ncookies capturados: ${parts.map(part => part.split('=')[0]).join(', ')}`);

  const mod = await import(pathToFileURL(join(ROOT, 'dist', 'providers', 'notionWeb.js')).href);
  const credentials = {
    cookie: cookieHeader,
    spaceId: auth.space.id,
    userId: auth.user.id,
    baseUrl: 'https://app.notion.com',
    clientVersion: VERSION,
  };
  console.log('\n=== teste via Node (sendToNotionWeb) ===');
  let nodeWorked = false;
  try {
    const res = await mod.sendToNotionWeb(
      [{ role: 'user', content: 'Diga apenas: ok' }],
      'strawberry-whoopiepie',
      256,
      false,
      undefined,
      {},
      credentials,
    );
    nodeWorked = true;
    console.log('OK:', JSON.stringify(res.text.slice(0, 300)));
  } catch (error) {
    console.log('FALHOU:', error instanceof Error ? error.message : String(error));
  }

  if (browserWorked || nodeWorked) {
    const envPath = join(ROOT, '.env');
    const fs = await import('node:fs');
    const content = fs.readFileSync(envPath, 'utf8');
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const setLine = (name, value) => {
      const index = lines.findIndex(line => new RegExp(`^\\s*${name}\\s*=`).test(line));
      if (index >= 0) lines[index] = `${name}=${value}`;
      else lines.push(`${name}=${value}`);
    };
    setLine('NOTION_COOKIE', cookieHeader);
    setLine('NOTION_USER_ID', auth.user.id);
    setLine('NOTION_SPACE_ID', auth.space.id);
    setLine('NOTION_WEB_BASE_URL', 'https://app.notion.com');
    setLine('NOTION_COOKIE_DIR', PROFILE);
    fs.writeFileSync(envPath, lines.join(newline), 'utf8');
    console.log('OK: .env atualizado (cookie, user, space e perfil da conta nova).');
    if (browserWorked && !nodeWorked) {
      console.log('Navegador funciona, mas o Node ainda não: falta trocar o provider para o formato workflow.');
    }
  } else {
    console.log('Nenhum teste funcionou; .env não foi alterado.');
  }
} finally {
  if (child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
}
