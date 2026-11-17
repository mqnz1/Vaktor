import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');
const file = process.argv[2] ?? join(ROOT, 'notion-curl.txt');
const raw = readFileSync(file, 'utf8');

function header(name) {
  const pattern = new RegExp(
    `(?:-H|--header)\\s+(['"])${name}\\s*:\\s*([\\s\\S]*?)\\1`,
    'i',
  );
  return pattern.exec(raw)?.[2]?.trim() ?? '';
}

function dataBody() {
  const pattern = /(?:--data-raw|--data|--data-binary|-d)\s+(['"])([\s\S]*?)\1/;
  const match = pattern.exec(raw);
  return match?.[2] ?? raw;
}

const cookie = header('cookie') || header('Cookie');
if (!cookie || !cookie.includes('token_v2=')) {
  throw new Error(
    'não achei o header Cookie com token_v2 no arquivo; use "Copy as cURL (bash)" da requisição runInferenceTranscript.',
  );
}

const body = dataBody();
const spaceId =
  /"spaceId"\s*:\s*"([^"]+)"/.exec(body)?.[1] ??
  /"space_id"\s*:\s*"([^"]+)"/.exec(body)?.[1] ??
  (process.env['NOTION_SPACE_ID'] ?? '').trim();
const userId =
  /"userId"\s*:\s*"([^"]+)"/.exec(body)?.[1] ??
  /notion_user_id=([^;]+)/.exec(cookie)?.[1]?.trim() ??
  (process.env['NOTION_USER_ID'] ?? '').trim();
const model = /"model"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? 'strawberry-whoopiepie';
const clientVersion = header('notion-client-version') || header('x-notion-client-version');
const userAgent = header('user-agent');
const origin = header('origin');
const referer = header('referer');
const baseUrl = /https:\/\/[^/]+/.exec(origin || referer || 'https://app.notion.com')?.[0] ?? 'https://app.notion.com';

console.log('arquivo:', file);
console.log('cookie:', cookie.split('; ').map(part => part.split('=')[0]).join(', '));
console.log('spaceId:', spaceId || '(ausente)');
console.log('userId:', userId || '(ausente)');
console.log('model:', model);
console.log('baseUrl:', baseUrl);

if (!spaceId || !userId) {
  throw new Error('spaceId/userId ausentes; copie a cURL de uma requisição runInferenceTranscript com o corpo JSON.');
}

const { sendToNotionWeb } = await import(
  pathToFileURL(join(ROOT, 'dist', 'providers', 'notionWeb.js')).href
);
const credentials = {
  cookie,
  spaceId,
  userId,
  baseUrl,
  clientVersion: clientVersion || '23.13.20260313.1423',
};
if (userAgent) process.env['NOTION_USER_AGENT'] = userAgent;

try {
  const res = await sendToNotionWeb(
    [{ role: 'user', content: 'Diga apenas: ok' }],
    model,
    128,
    false,
    undefined,
    {},
    credentials,
  );
  console.log('OK:', JSON.stringify(res.text.slice(0, 300)));

  const envPath = join(ROOT, '.env');
  const content = readFileSync(envPath, 'utf8');
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const setLine = (name, value) => {
    const index = lines.findIndex(line => new RegExp(`^\\s*${name}\\s*=`).test(line));
    if (index >= 0) lines[index] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  };
  setLine('NOTION_COOKIE', cookie);
  setLine('NOTION_USER_ID', userId);
  setLine('NOTION_SPACE_ID', spaceId);
  setLine('NOTION_WEB_BASE_URL', baseUrl);
  if (clientVersion) setLine('NOTION_CLIENT_VERSION', clientVersion);
  if (userAgent) setLine('NOTION_USER_AGENT', userAgent);
  writeFileSync(envPath, lines.join(newline), 'utf8');
  console.log('OK: .env atualizado com a sessão que funciona no navegador.');
} catch (error) {
  console.log('FALHOU:', error instanceof Error ? error.message : String(error));
  console.log('O .env não foi alterado.');
}
