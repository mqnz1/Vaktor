// =============================================================
// Formatação dos eventos do agente para exibição estilo
// Claude Code: Verb(alvo) + resumo curto do resultado.
//
// Funções puras (sem JSX) para facilitar teste e reuso.
// =============================================================
import type { AgentEvent } from '../agent/types.js';

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const TOOL_VERBS: Record<string, string> = {
  read_file: 'Read',
  write_file: 'Edit',
  apply_patch: 'Patch',
  list_dir: 'List',
  search: 'Search',
  run_command: 'Bash',
  git_status: 'GitStatus',
  git_diff: 'GitDiff',
  web_fetch: 'Fetch',
  web_search: 'WebSearch',
  npm_install: 'Install',
  git_commit: 'Commit',
  create_pr: 'CreatePR',
  mcp_call: 'MCP',
};

export function toolVerb(name: string): string {
  return TOOL_VERBS[name] ?? name;
}

function argString(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string) : '';
}

export function toolTarget(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'apply_patch':
    case 'list_dir':
      return argString(args, 'path');
    case 'search':
      return argString(args, 'query') || argString(args, 'pattern');
    case 'run_command':
      return argString(args, 'label');
    case 'web_fetch':
      return argString(args, 'url');
    case 'web_search':
      return argString(args, 'query');
    case 'npm_install':
      return argString(args, 'packages');
    case 'git_commit':
      return argString(args, 'message');
    case 'create_pr':
      return argString(args, 'title');
    case 'mcp_call': {
      const server = argString(args, 'server');
      const tool = argString(args, 'tool');
      return server && tool ? `${server}.${tool}` : server;
    }
    default:
      return '';
  }
}

// Rótulo completo: "Read(arquivo.js)". Sem alvo: só o verbo.
export function toolLabel(name: string, args: Record<string, unknown>): string {
  const target = toolTarget(name, args);
  const verb = toolVerb(name);
  return target ? `${verb}(${truncate(target, 70)})` : verb;
}

// Resumo curto do resultado: +N -M de diff, exit code, nº de linhas/bytes.
export function summarizeOutcome(preview: string): string {
  const clean = preview.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const diff = clean.match(/\+(\d+)\s*-\s*(\d+)/);
  if (diff) return `+${diff[1]} -${diff[2]}`;
  const exitCode = clean.match(/exit:\s*(-?\d+)/);
  if (exitCode) return `exit ${exitCode[1]}`;
  const lines = clean.match(/(\d+)\s+linhas?/);
  if (lines) return `${lines[1]} linhas`;
  const matches = clean.match(/(\d+)\s+resultado/i);
  if (matches) return `${matches[1]} resultados`;
  const bytes = clean.match(/(\d+)\s*bytes/i);
  if (bytes) return `${bytes[1]} bytes`;
  return truncate(clean, 60);
}

// Remove o tool_start que já terminou — o tool_end correspondente resume tudo.
// O start sem end correspondente fica (é a tool ainda em execução).
export function condenseEvents(events: readonly AgentEvent[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type === 'tool_start') {
      const finished = events
        .slice(i + 1)
        .some(candidate => candidate.type === 'tool_end' && candidate.name === event.name);
      if (finished) continue;
    }
    out.push(event);
  }
  return out;
}
