// Smoke do agente com modelo falso (sem rede).
// Executar: npx tsx src/agent/smoke.ts
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, CompleteOptions, RouterResponse } from '../types/index.js';
import type { AgentEvent, AgentOptions, VerifyResult } from './types.js';
import { runAgent } from './loop.js';
import { parseToolCalls } from './protocol.js';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FALHOU ${label}`);
  }
}

function response(text: string): RouterResponse {
  return {
    text,
    model: 'fake-model',
    inputTokens: 10,
    outputTokens: 5,
    fromCache: false,
    estimatedCostUsd: 0.0001,
  };
}

function toolCall(name: string, args: Record<string, unknown>): string {
  return `<tool_call>${JSON.stringify({ name, args })}</tool_call>`;
}

function dsmlToolCall(name: string, args: Record<string, unknown>): string {
  const params = Object.entries(args)
    .map(([key, value]) => {
      const isString = typeof value === 'string';
      return `<|DSML|parameter name="${key}" string="${isString}">${
        isString ? value : JSON.stringify(value)
      }</|DSML|parameter>`;
    })
    .join('\n');
  return `<|DSML|tool_calls>\n<|DSML|invoke name="${name}">\n${params}\n</|DSML|invoke>\n</|DSML|tool_calls>`;
}

function baseOptions(
  workdir: string,
  onEvent: (event: AgentEvent) => void,
  overrides: Partial<AgentOptions> = {},
): AgentOptions {
  return {
    workdir,
    maxIterations: 5,
    maxToolCalls: 10,
    allowWrite: true,
    autoApprove: true,
    verify: false,
    verifyMaxAttempts: 3,
    onEvent,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'vaktor-agent-'));
  try {
    writeFileSync(join(root, 'a.txt'), 'linha do arquivo\n', 'utf8');

    // 1. resposta final sem tools
    {
      const calls: ChatMessage[][] = [];
      const events: AgentEvent[] = [];
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        calls.push(messages);
        return response('resposta final');
      };
      const result = await runAgent('oi', [], complete, baseOptions(root, event => events.push(event)));
      check('1.1 resposta final', result.text === 'resposta final');
      check('1.2 uma iteração', result.iterations === 1 && result.toolCalls === 0);
      check('1.3 evento done', events.some(event => event.type === 'done'));
    }

    // 2. tool call válida executa e continua
    {
      const calls: ChatMessage[][] = [];
      const events: AgentEvent[] = [];
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        calls.push(messages);
        return calls.length === 1 ? response(toolCall('read_file', { path: 'a.txt' })) : response('feito');
      };
      const result = await runAgent('leia a.txt', [], complete, baseOptions(root, event => events.push(event)));
      check('2.1 executa read_file', result.tools.length === 1 && result.tools[0]?.name === 'read_file');
      check('2.2 toolCalls=1', result.toolCalls === 1);
      check('2.3 resultado chega ao modelo', (calls[1] ?? []).some(message => message.content.includes('## TOOL RESULT')));
      check('2.4 eventos de tool', events.some(event => event.type === 'tool_start') && events.some(event => event.type === 'tool_end'));
    }

    // 3. ferramenta desconhecida → erro de protocolo, sem executar
    {
      const calls: ChatMessage[][] = [];
      const events: AgentEvent[] = [];
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        calls.push(messages);
        return calls.length === 1 ? response(toolCall('nope', {})) : response('corrigido');
      };
      const result = await runAgent('x', [], complete, baseOptions(root, event => events.push(event)));
      check('3.1 não executa desconhecida', result.toolCalls === 0 && result.tools.length === 0);
      check('3.2 devolve erro ao modelo', (calls[1] ?? []).some(message => message.content.includes('PROTOCOL ERROR')));
      check('3.3 evento de erro', events.some(event => event.type === 'error'));
    }

    // 4. maxIterations → erro claro
    {
      const events: AgentEvent[] = [];
      const complete = async (): Promise<RouterResponse> => response(toolCall('list_dir', {}));
      const result = await runAgent('loop', [], complete, baseOptions(root, event => events.push(event), { maxIterations: 2 }));
      const errorEvent = events.some(event => event.type === 'error' && event.message.includes('maxIterations'));
      check('4.1 para no limite', result.iterations === 2);
      check('4.2 erro de maxIterations', errorEvent);
    }

    // 5. chamada duplicada não executa de novo
    {
      const calls: ChatMessage[][] = [];
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        calls.push(messages);
        if (calls.length <= 2) return response(toolCall('read_file', { path: 'a.txt' }));
        return response('fim');
      };
      const result = await runAgent('duplicado', [], complete, baseOptions(root, () => undefined));
      check('5.1 executa só uma vez', result.toolCalls === 1 && result.tools.length === 1);
      check('5.2 continua após aviso', result.text === 'fim' && calls.length === 3);
    }

    // 6/7. verificação
    {
      const events: AgentEvent[] = [];
      let calls = 0;
      const complete = async (): Promise<RouterResponse> => {
        calls++;
        return response(`final${calls}`);
      };
      let attempts = 0;
      const verifyRunner = async (attempt: number): Promise<VerifyResult> => {
        attempts = attempt;
        return attempt === 1
          ? { ran: true, ok: false, attempts: attempt, command: 'typecheck', output: 'TS1000: erro no tipo' }
          : { ran: true, ok: true, attempts: attempt, command: 'typecheck', output: 'sem erros' };
      };
      const result = await runAgent('verifique', [], complete, baseOptions(root, event => events.push(event), {
        verify: true,
        verifyRunner,
      }));
      check('6.1 verificação passou na 2ª', result.verify.ok && result.verify.attempts === 2);
      check('6.2 houve reparo', events.some(event => event.type === 'repair'));
      check('6.3 modelo foi chamado 2x', calls === 2 && attempts === 2);
    }

    {
      const events: AgentEvent[] = [];
      const complete = async (): Promise<RouterResponse> => response('final');
      const verifyRunner = async (attempt: number): Promise<VerifyResult> => ({
        ran: true,
        ok: false,
        attempts: attempt,
        command: 'test',
        output: `erro diferente ${attempt}`,
      });
      const result = await runAgent('falhe', [], complete, baseOptions(root, event => events.push(event), {
        verify: true,
        verifyMaxAttempts: 3,
        verifyRunner,
      }));
      check('7.1 tenta o máximo', result.verify.attempts === 3 && !result.verify.ok);
      check('7.2 erro final claro', events.some(event => event.type === 'error' && event.message.includes('Verificação falhou')));
    }

    // 8. Best-of-N escolhe maior score
    {
      const hard = 'refatore a arquitetura e a segurança do módulo de pagamentos com foco em performance';
      let counter = 0;
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        counter++;
        if (counter === 1) return response('BASE');
        const last = [...messages].reverse().find(message => message.role === 'user')?.content ?? '';
        if (last.includes('Candidata')) {
          const candidate = last.match(/Candidata:\n([A-Z])/)?.[1] ?? '?';
          const score = candidate === 'B' ? 9 : candidate === 'C' ? 7 : 5;
          return response(JSON.stringify({ score, reason: 'fake', issues: [] }));
        }
        return response(['A', 'B', 'C'][counter - 2] ?? 'X');
      };
      const result = await runAgent(hard, [], complete, baseOptions(root, () => undefined, {
        bestOfN: { n: 3, maxCostUsd: 1 },
        estimateCost: () => 0.001,
      }));
      check('8.1 escolhe maior score', result.text === 'B');
      check('8.2 1 loop + 3 candidatas + 3 críticos', counter === 7);
      check('8.3 soma uso do Best-of-N', result.usage.costUsd >= 0.0007);
    }

    // 9. candidata que passa na verificação vence o score
    {
      const hard = 'otimize a arquitetura e a performance com segurança';
      let counter = 0;
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        counter++;
        if (counter === 1) return response('BASE');
        const last = [...messages].reverse().find(message => message.role === 'user')?.content ?? '';
        if (last.includes('Candidata')) {
          const candidate = last.match(/Candidata:\n([A-Z])/)?.[1] ?? '?';
          return response(JSON.stringify({ score: candidate === 'B' ? 9 : 5, reason: 'fake', issues: [] }));
        }
        return response(['A', 'B', 'C'][counter - 2] ?? 'X');
      };
      const result = await runAgent(hard, [], complete, baseOptions(root, () => undefined, {
        bestOfN: {
          n: 3,
          maxCostUsd: 1,
          verifyCandidate: async text => text === 'A',
        },
        estimateCost: () => 0.001,
      }));
      check('9.1 verificação vence o crítico', result.text === 'A');
    }

    // 10. dataset local com redação de segredo
    {
      const dataRoot = mkdtempSync(join(tmpdir(), 'vaktor-dataset-'));
      try {
        const complete = async (): Promise<RouterResponse> => response('resposta com segredo');
        const result = await runAgent('minha chave sk-abcdef123456', [], complete, baseOptions(dataRoot, () => undefined, {
          dataset: { enabled: true },
        }));
        const logs = join(dataRoot, '.vaktor', 'logs', 'sessions');
        const files = readdirSync(logs);
        const line = readFileSync(join(logs, files[0] ?? ''), 'utf8').trim();
        const entry = JSON.parse(line) as Record<string, unknown>;
        check('10.1 grava sessão', files.length === 1 && entry['output'] === result.text);
        check('10.2 redige segredo', !line.includes('sk-abcdef123456') && line.includes('[REDACTED]'));
        check('10.3 rating nulo', entry['rating'] === null);
      } finally {
        rmSync(dataRoot, { recursive: true, force: true });
      }
    }

    // 11. orçamento estourado aborta
    {
      const events: AgentEvent[] = [];
      const complete = async (): Promise<RouterResponse> => response('não deveria rodar');
      const result = await runAgent('x', [], complete, baseOptions(root, event => events.push(event), {
        isOverBudget: () => true,
      }));
      check('11.1 não chama modelo', result.text === '');
      check('11.2 erro de orçamento', events.some(event => event.type === 'error' && event.message.includes('Orçamento')));
    }

    // 12. path proibido vira resultado de erro, não crash
    {
      const calls: ChatMessage[][] = [];
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        calls.push(messages);
        return calls.length === 1
          ? response(toolCall('read_file', { path: '.env' }))
          : response('ok');
      };
      const result = await runAgent('leia env', [], complete, baseOptions(root, () => undefined));
      check('12.1 tool falha sem derrubar', result.toolCalls === 1 && result.tools[0]?.ok === false);
      check('12.2 erro chega ao modelo', (calls[1] ?? []).some(message => message.content.includes('bloqueada')));
    }

    // 13. tool call no dialeto DSML (DeepSeek) executa normalmente
    {
      const calls: ChatMessage[][] = [];
      const complete = async (messages: ChatMessage[], _options?: CompleteOptions): Promise<RouterResponse> => {
        calls.push(messages);
        return calls.length === 1 ? response(dsmlToolCall('read_file', { path: 'a.txt' })) : response('feito via dialeto');
      };
      const result = await runAgent('leia a.txt', [], complete, baseOptions(root, () => undefined));
      check('13.1 DSML executa read_file', result.toolCalls === 1 && result.tools[0]?.name === 'read_file');
      check('13.2 DSML chega ao resultado', result.text === 'feito via dialeto');
      check('13.3 DSML não vaza no texto final', !/<\|?\s*DSML/i.test(result.text));
    }

    // 14. parser tolera variações de espaçamento e string="false"
    {
      const raw = [
        'Antes.',
        '< | DSM | calls>',
        '< | DSM | invoke name="bash">',
        '< | DSM | parameter name="command" string="true">echo oi</| DSM | parameter>',
        '< | DSM | parameter name="timeout" string="false">30</| DSM | parameter>',
        '</| DSM | invoke>',
        '</| DSM | calls>',
        'Depois.',
      ].join('\n');
      const parsed = parseToolCalls(raw);
      check('14.1 DSML variante detectada', parsed.calls.length === 1 && parsed.calls[0]?.name === 'bash');
      check('14.2 argumentos string/número', parsed.calls[0]?.args['command'] === 'echo oi' && parsed.calls[0]?.args['timeout'] === 30);
      check('14.3 sem erros', parsed.errors.length === 0);
      check('14.4 rest não contém DSML', parsed.rest === 'Antes.\n\nDepois.');
    }

    // 15. formato misto: <tool_call> com fechamento DSML e invoke DSML
    {
      const raw = [
        'Antes de implementar, preciso conferir o estado real do repositório.',
        '<tool_call>{"name":"list_dir","args":{"path":".","depth":2}}</|DSML|parameter>',
        '</|DSML|invoke>',
        '<|DSML|invoke name="read_file">',
        '<|DSML|parameter name="args" string="false">{"path": "README.md", "start": 1, "end": 60}</|DSML|parameter>',
        '</|DSML|invoke>',
        '</|DSML|tool_calls>',
      ].join('\n');
      const parsed = parseToolCalls(raw);
      check('15.1 recupera as duas chamadas', parsed.calls.length === 2);
      check('15.2 primeira é list_dir', parsed.calls[0]?.name === 'list_dir' && parsed.calls[0]?.args['depth'] === 2);
      check(
        '15.3 desembrulha args do read_file',
        parsed.calls[1]?.name === 'read_file' &&
          parsed.calls[1]?.args['path'] === 'README.md' &&
          parsed.calls[1]?.args['start'] === 1,
      );
      check('15.4 sem erros', parsed.errors.length === 0);
      check(
        '15.5 rest mantém só a prosa',
        parsed.rest.startsWith('Antes de implementar') && !/DSML|tool_call/i.test(parsed.rest),
      );
    }

    // 16. variante visual com pipes duplicados/espaçados
    {
      const raw = [
        '< | | DSM | | calls>',
        '< | | DSM | | invoke name="list_dir">',
        '< | | DSM | | parameter name="path" string="true">.</| | DSM | | parameter>',
        '</| | DSM | | invoke>',
        '</| | DSM | | calls>',
      ].join('\n');
      const parsed = parseToolCalls(raw);
      check('16.1 variante DSML espaçada', parsed.calls.length === 1 && parsed.calls[0]?.name === 'list_dir');
      check('16.2 argumento preservado', parsed.calls[0]?.args['path'] === '.');
      check('16.3 rest vazio', parsed.rest === '');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} verificação(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nAgent smoke OK.');
  }
}

void main();
