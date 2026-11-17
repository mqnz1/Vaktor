// src/mcp/config.ts
// Parsing de MCP_ENABLED / MCP_SERVERS (chamado por src/config/env.ts).
//
// Formato:  nome=tipo comando args ; nome2=http https://url
//   fs=stdio npx -y @modelcontextprotocol/server-filesystem /tmp
//   github=http https://api.github.com/mcp
// Aspas simples/duplas agrupam argumentos com espaço ou ';'.
// Token para servidores http (sem expor em MCP_SERVERS): variável MCP_<NOME>_TOKEN
//   → header "Authorization: Bearer <token>".

import { assertSafeMcpUrl } from './http.js';
import { SERVER_NAME_RE } from './security.js';
import type { McpServerConfig } from './types.js';

export interface ParsedMcpServers {
  servers: McpServerConfig[];
  /** Mensagens para o usuário (nunca contêm URLs/tokens). */
  errors: string[];
}

export function parseMcpEnabled(raw: string | null | undefined): boolean {
  return /^(1|true|yes|on|sim)$/i.test((raw ?? '').trim());
}

function splitOutsideQuotes(raw: string, isSep: (ch: string) => boolean, keepQuotes: boolean): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) {
        quote = null;
        if (keepQuotes) cur += ch;
      } else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      if (keepQuotes) cur += ch;
      continue;
    }
    if (isSep(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

export function parseMcpServers(raw: string | null | undefined, env: Record<string, string | undefined> = process.env): ParsedMcpServers {
  const servers: McpServerConfig[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const piece of splitOutsideQuotes(raw ?? '', (c) => c === ';', true)) {
    const entry = piece.trim();
    if (!entry) continue;

    const eq = entry.indexOf('=');
    if (eq <= 0) {
      errors.push('entrada MCP ignorada: formato esperado "nome=tipo ..."');
      continue;
    }
    const name = entry.slice(0, eq).trim();
    if (!SERVER_NAME_RE.test(name)) {
      errors.push(`nome de servidor MCP inválido: "${name.slice(0, 40)}"`);
      continue;
    }
    if (seen.has(name)) {
      errors.push(`servidor MCP duplicado: "${name}"`);
      continue;
    }

    const tokens = splitOutsideQuotes(entry.slice(eq + 1).trim(), (c) => /\s/.test(c), false);
    const type = tokens[0]?.toLowerCase();

    if (type === 'stdio') {
      const command = tokens[1];
      if (!command) {
        errors.push(`${name}: tipo stdio exige um comando`);
        continue;
      }
      servers.push({ name, type: 'stdio', command, args: tokens.slice(2), enabled: true });
    } else if (type === 'http') {
      const url = tokens[1] ?? '';
      try {
        assertSafeMcpUrl(url);
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : 'URL inválida'}`);
        continue;
      }
      const tokenVar = `MCP_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`;
      const token = env[tokenVar];
      const headers = token && /^[\x21-\x7e]+$/.test(token) ? { Authorization: `Bearer ${token}` } : undefined;
      servers.push({ name, type: 'http', url, headers, enabled: true });
    } else {
      errors.push(`${name}: tipo "${(tokens[0] ?? '').slice(0, 20)}" inválido (use stdio ou http)`);
      continue;
    }
    seen.add(name);
  }
  return { servers, errors };
}
