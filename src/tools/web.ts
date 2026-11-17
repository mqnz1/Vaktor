// =============================================================
// Ferramentas de rede: web_fetch e web_search.
//
// Política de egresso:
//  - somente https;
//  - sem credenciais na URL;
//  - localhost, IPs privados e nomes de intranet bloqueados;
//  - até 3 redirects, cada um revalidado;
//  - timeout e limite de bytes.
//
// O conteúdo baixado é DADOS NÃO CONFIÁVEIS: pode conter prompt
// injection e nunca deve ser tratado como instrução.
// =============================================================
import type { ToolContext, ToolResult, ToolSpec } from './types.js';
import { clamp, getNumber, getString } from './args.js';
import { truncateOutput } from './fs.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

function fail(message: string): ToolResult {
  return { ok: false, output: message };
}

export function isPrivateHost(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (host.includes(':')) {
    // IPv6: ULA (fc00::/7) e link-local (fe80::/10)
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
    return false;
  }

  // hostname de rótulo único (intranet local)
  if (!host.includes('.')) return true;
  return false;
}

function validateUrl(raw: string, ctx: ToolContext): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL inválida: ${raw}`);
  }
  if (url.protocol !== 'https:') throw new Error('apenas https é permitido');
  if (url.username || url.password) throw new Error('URL com credenciais é proibida');
  if (isPrivateHost(url.hostname)) throw new Error(`host bloqueado: ${url.hostname}`);
  if (ctx.allowedDomains.length > 0) {
    const host = url.hostname.toLowerCase();
    const allowed = ctx.allowedDomains.some(
      domain => host === domain || host.endsWith(`.${domain}`),
    );
    if (!allowed) throw new Error(`domínio fora da allowlist: ${url.hostname}`);
  }
  return url;
}

async function readCapped(res: FetchResponse, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) break;
    }
  }
  const buffer = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer.toString('utf8');
}

interface HttpResult {
  status: number;
  contentType: string;
  finalUrl: string;
  body: string;
}

async function httpGet(raw: string, ctx: ToolContext): Promise<HttpResult> {
  let current = validateUrl(raw, ctx);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'Vaktor-Agent/2.0',
          accept: 'text/html,application/json,text/plain,*/*',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { status: res.status, contentType: '', finalUrl: current.toString(), body: '' };
        }
        current = validateUrl(new URL(location, current).toString(), ctx);
        continue;
      }

      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        finalUrl: current.toString(),
        body: await readCapped(res, MAX_FETCH_BYTES),
      };
    }
    throw new Error('redirects demais');
  } finally {
    clearTimeout(timer);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseDdg(body: string): string[] {
  const out: string[] = [];
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const abstract = typeof data['AbstractText'] === 'string' ? data['AbstractText'] : '';
    const abstractUrl = typeof data['AbstractURL'] === 'string' ? data['AbstractURL'] : '';
    if (abstract) out.push(`${abstract}${abstractUrl ? ` — ${abstractUrl}` : ''}`);

    const collect = (list: unknown): void => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (Array.isArray(record['Topics'])) {
          collect(record['Topics']);
          continue;
        }
        const text = typeof record['Text'] === 'string' ? record['Text'] : '';
        const url = typeof record['FirstURL'] === 'string' ? record['FirstURL'] : '';
        if (text) out.push(`${text}${url ? ` — ${url}` : ''}`);
      }
    };
    collect(data['Results']);
    collect(data['RelatedTopics']);
  } catch {
    return [];
  }
  return out;
}

function decodeHref(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1] ?? '');
    } catch {
      // cai no fallback abaixo
    }
  }
  return href.startsWith('//') ? `https:${href}` : href;
}

// Fallback: a API Instant Answer não cobre toda query, então lemos a página
// HTML "lite" do DuckDuckGo (sem JS) e extraímos título/link/resumo.
function parseDdgLite(html: string): string[] {
  const clean = (value: string): string => htmlToText(value).replace(/\s+/g, ' ').trim();
  const links: Array<{ url: string; title: string }> = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const attrs = match[1] ?? '';
    if (!/class=['"]result-link['"]/i.test(attrs)) continue;
    const hrefMatch = attrs.match(/href=['"]([^'"]*)['"]/i);
    if (!hrefMatch) continue;
    links.push({ url: decodeHref(hrefMatch[1] ?? ''), title: clean(match[2] ?? '') });
  }
  const snippets: string[] = [];
  const snippetRe = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  while ((match = snippetRe.exec(html)) !== null) {
    snippets.push(clean(match[1] ?? ''));
  }
  return links.map((link, index) => {
    const snippet = snippets[index] ? ` — ${snippets[index]}` : '';
    return `${link.title} (${link.url})${snippet}`;
  });
}

export const webFetchTool: ToolSpec = {
  name: 'web_fetch',
  description: 'Baixa uma URL https e devolve o texto (conteúdo não confiável).',
  parameters: {
    url: 'URL https pública (sem credenciais)',
    maxChars: 'limite de caracteres da resposta (opcional)',
  },
  destructive: false,
  run: async (args, ctx) => {
    try {
      if (!ctx.allowNetwork) {
        return fail('acesso à rede desabilitado (TOOLS_ALLOW_NETWORK=false)');
      }
      const raw = getString(args, 'url');
      if (!raw) return fail('url obrigatória');

      const result = await httpGet(raw, ctx);
      if (result.status >= 400) {
        return fail(`HTTP ${result.status} em ${result.finalUrl}`);
      }

      const looksHtml = /text\/html/i.test(result.contentType) || /^\s*</.test(result.body);
      const text = looksHtml ? htmlToText(result.body) : result.body;
      const limit = clamp(
        Math.floor(getNumber(args, 'maxChars', ctx.maxOutputChars)),
        500,
        ctx.maxOutputChars,
      );

      const header = `[CONTEÚDO WEB NÃO CONFIÁVEL] ${result.finalUrl} (HTTP ${result.status})\n`;
      return {
        ok: true,
        output: truncateOutput(header + text, limit, 'start'),
        meta: { bytes: Buffer.byteLength(result.body, 'utf8') },
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};

export const webSearchTool: ToolSpec = {
  name: 'web_search',
  description: 'Busca na web (DuckDuckGo) e devolve resultados e links.',
  parameters: {
    query: 'termo de busca (máx. 300 chars)',
    maxResults: 'máximo de resultados (1-10, padrão: 5)',
  },
  destructive: false,
  run: async (args, ctx) => {
    try {
      if (!ctx.allowNetwork) {
        return fail('acesso à rede desabilitado (TOOLS_ALLOW_NETWORK=false)');
      }
      const query = getString(args, 'query');
      if (!query) return fail('query obrigatória');
      if (query.length > 300) return fail('query longa demais (máx. 300 chars)');

      const maxResults = clamp(Math.floor(getNumber(args, 'maxResults', 5)), 1, 10);
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const result = await httpGet(url, ctx);
      if (result.status >= 400) return fail(`HTTP ${result.status} na busca`);

      let lines = parseDdg(result.body).slice(0, maxResults);
      if (lines.length === 0) {
        const lite = await httpGet(
          `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
          ctx,
        );
        if (lite.status < 400) {
          lines = parseDdgLite(lite.body).slice(0, maxResults);
        }
      }
      const output = lines.length > 0 ? lines.join('\n') : '(sem resultados)';
      return {
        ok: true,
        output: truncateOutput(
          `[BUSCA WEB NÃO CONFIÁVEL] ${query}\n${output}`,
          ctx.maxOutputChars,
          'start',
        ),
        meta: { matches: lines.length },
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  },
};
