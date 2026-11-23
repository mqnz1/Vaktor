// Smoke da formatação de eventos do agente (exibição estilo Claude Code).
// Executar: npx tsx src/ui/smoke.ts
import type { AgentEvent } from '../agent/types.js';
import type { ChatMessage } from '../types/index.js';
import { condenseEvents, summarizeOutcome, toolLabel, toolVerb } from './agentEvents.js';
import {
  autocompleteCapacity,
  autocompleteExtraLines,
  chromeLines,
  clipContent,
  clipInput,
  confirmBoxLines,
  confirmDetailLines,
  messageAreaLines,
  selectVisibleMessages,
  wrapLineCount,
  SAFETY_LINES,
  type ChromeFlags,
} from './layout.js';
import { COMMANDS, filterCommands } from './commands.js';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FALHOU ${label}`);
  }
}

function start(name: string, args: Record<string, unknown>): AgentEvent {
  return { type: 'tool_start', name, args };
}

function end(name: string, args: Record<string, unknown>, ok: boolean, preview: string): AgentEvent {
  return { type: 'tool_end', name, args, ok, preview };
}

function main(): void {
  // 1. verbos legíveis por ferramenta
  check('read_file vira Read', toolVerb('read_file') === 'Read');
  check('write_file vira Edit', toolVerb('write_file') === 'Edit');
  check('run_command vira Bash', toolVerb('run_command') === 'Bash');
  check('ferramenta desconhecida mantém o nome', toolVerb('coisa_nova') === 'coisa_nova');

  // 2. rótulo com alvo extraído dos args
  check(
    'Read(arquivo.js)',
    toolLabel('read_file', { path: 'arquivo.js' }) === 'Read(arquivo.js)',
  );
  check(
    'Patch(src/index.ts)',
    toolLabel('apply_patch', { path: 'src/index.ts' }) === 'Patch(src/index.ts)',
  );
  check(
    'Bash(typecheck)',
    toolLabel('run_command', { label: 'typecheck' }) === 'Bash(typecheck)',
  );
  check(
    'Fetch(https://example.com)',
    toolLabel('web_fetch', { url: 'https://example.com' }) === 'Fetch(https://example.com)',
  );
  check(
    'MCP(github.create_issue)',
    toolLabel('mcp_call', { server: 'github', tool: 'create_issue' }) === 'MCP(github.create_issue)',
  );
  check('sem alvo cai no verbo puro', toolLabel('git_status', {}) === 'GitStatus');

  // 3. resumo do resultado
  check(
    'resumo de diff +2 -1',
    summarizeOutcome('--- a/arquivo.js +++ b/arquivo.js +2 -1 +oi') === '+2 -1',
  );
  check('resumo de exit code', summarizeOutcome('$ npm run test exit: 0 tudo ok') === 'exit 0');
  check('resumo de linhas', summarizeOutcome('conteúdo 12 linhas do arquivo') === '12 linhas');
  check('resumo vazio para preview vazio', summarizeOutcome('   ') === '');
  check(
    'fallback trunca preview longo',
    summarizeOutcome('a'.repeat(200)).length <= 61,
  );

  // 4. condensação: start concluído sai, start em andamento fica
  const events: AgentEvent[] = [
    start('read_file', { path: 'arquivo.js' }),
    end('read_file', { path: 'arquivo.js' }, true, '3 linhas'),
    start('apply_patch', { path: 'arquivo.js' }),
  ];
  const condensed = condenseEvents(events);
  check(
    'start concluído é removido, end fica',
    condensed.length === 2
      && condensed[0]?.type === 'tool_end'
      && condensed[1]?.type === 'tool_start',
  );
  check(
    'start em andamento permanece',
    condenseEvents([start('read_file', { path: 'x.ts' })]).length === 1,
  );
  check(
    'eventos que não são tool passam direto',
    condenseEvents([{ type: 'error', message: 'x' }]).length === 1,
  );

  // 5. fluxo completo "Read depois Edit" vira duas linhas condensadas
  const flow: AgentEvent[] = [
    start('read_file', { path: 'arquivo.js' }),
    end('read_file', { path: 'arquivo.js' }, true, 'arquivo.js 1 linhas'),
    start('write_file', { path: 'arquivo.js' }),
    end('write_file', { path: 'arquivo.js' }, true, '--- a/arquivo.js +1 -1 +oi'),
  ];
  const rendered = condenseEvents(flow)
    .map(event => {
      if (event.type === 'tool_end') {
        return `${event.ok ? '✓' : '✗'} ${toolLabel(event.name, event.args)} ${summarizeOutcome(event.preview)}`;
      }
      if (event.type === 'tool_start') {
        return `● ${toolLabel(event.name, event.args)}`;
      }
      return '';
    })
    .filter(line => line.length > 0)
    .join('\n');
  check(
    'fluxo Read → Edit renderiza como esperado',
    rendered === '✓ Read(arquivo.js) 1 linhas\n✓ Edit(arquivo.js) +1 -1',
  );

  // ── Orçamento de linhas (anti-scroll / anti-sobreposição) ───────────────
  check('chrome padrão é header + footer + prompt', chromeLines() === 9);
  check('notificação soma uma linha no chrome', chromeLines({ hasNotification: true }) === 10);
  check('footer oculto subtrai uma linha', chromeLines({ showFooter: false }) === 8);
  check('prompt oculto subtrai 3 linhas', chromeLines({ showInput: false }) === 6);
  check('menu de comandos soma itens + 3', chromeLines({ inputExtraLines: 9 }) === 18);

  check('área de mensagens cabe em 24 linhas', messageAreaLines(24) === 13);
  check('notificação desconta uma linha', messageAreaLines(24, { hasNotification: true }) === 12);
  check('menu de comandos desconta as linhas extras', messageAreaLines(24, { inputExtraLines: 9 }) === 4);
  check('sem prompt a área cresce 3 linhas', messageAreaLines(24, { showInput: false }) === 16);
  check('terminal baixo pode zerar a área (lista não renderiza)', messageAreaLines(10) === 0);
  check('menu em terminal baixo zera a área em vez de estourar',
    messageAreaLines(16, { inputExtraLines: 9 }) === 0);

  // Invariante: chrome + área nunca ultrapassa a altura da raiz. Se ultrapassar,
  // o Ink corta o quadro pela metade (prompt/menu somem) e a UI "desconfigura".
  // Usa as mesmas regras da App: extras do menu vindos da capacidade real,
  // notificação e footer só com folga (rows >= 12).
  let frameFits = true;
  for (let rows = 10; rows <= 60; rows++) {
    const extras = [0, autocompleteExtraLines(autocompleteCapacity(rows))];
    for (const inputExtraLines of extras) {
      for (const hasNotification of [false, rows >= 12]) {
        for (const showFooter of [false, rows >= 12]) {
          for (const showInput of [false, true]) {
            const flags: ChromeFlags = { hasNotification, showFooter, showInput, inputExtraLines };
            const frame = chromeLines(flags) + messageAreaLines(rows, flags);
            if (frame > rows - SAFETY_LINES) frameFits = false;
          }
        }
      }
    }
  }
  check('quadro sempre cabe na altura da raiz (rows - folga)', frameFits);

  // Autocomplete: o App reserva exatamente o que o menu ocupa.
  check('menu vazio não ocupa linhas', autocompleteExtraLines(0) === 0);
  check('menu de 6 itens ocupa 9 linhas', autocompleteExtraLines(6) === 9);
  check('capacidade do menu nunca é negativa', autocompleteCapacity(10) === 0);
  check('capacidade do menu é limitada a 6', autocompleteCapacity(60) === 6);
  check('capacidade reserva folga para notificação e menu', autocompleteCapacity(16) === 1);
  check('filtrar por /mo acha /mode e /models',
    filterCommands('/mo').map(c => c.cmd).join(',') === '/mode,/models');
  check('filtro sem barra é vazio', filterCommands('oi').length === 0);
  check('lista de comandos contém /exit', COMMANDS.some(c => c.cmd === '/exit'));
  check('lista de comandos contém /new', COMMANDS.some(c => c.cmd === '/new'));

  // Confirmação de escrita: encolhe em tela baixa.
  check('confirmação usa 18 linhas de detalhe em tela alta', confirmDetailLines(60) === 18);
  check('confirmação encolhe o detalhe em tela baixa', confirmDetailLines(20) === 6);
  check('confirmação sempre mostra pelo menos 1 linha de detalhe', confirmDetailLines(10) === 1);
  check('caixa de confirmação = detalhe + 4', confirmBoxLines(24) === confirmDetailLines(24) + 4);
  check('texto curto ocupa 1 linha', wrapLineCount('oi', 40) === 1);
  check('texto de 90 colunas em 40 ocupa 3 linhas', wrapLineCount('x'.repeat(90), 40) === 3);
  check('linha em branco conta como linha', wrapLineCount('a\n\nb', 40) === 3);

  const long: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
    role: 'assistant' as const,
    content: `resposta ${i} `.repeat(10),
    timestamp: Date.now(),
  }));
  const slice = selectVisibleMessages(long, 80, 12);
  check('janela nunca passa do orçamento', slice.visible.length < long.length);
  check('janela mantém as mensagens recentes', slice.visible.at(-1) === long.at(-1));
  check('janela reporta quantas ficaram acima', slice.hidden === long.length - slice.visible.length);

  const single: ChatMessage[] = [{
    role: 'assistant' as const,
    content: Array.from({ length: 60 }, (_, i) => `linha ${i}`).join('\n'),
    timestamp: Date.now(),
  }];
  const one = selectVisibleMessages(single, 80, 10);
  check('última mensagem enorme ainda é exibida', one.visible.length === 1);
  const clipped = clipContent(one.visible[0]?.content ?? '', 80, 8);
  check('conteúdo grande é cortado', clipped.split('\n').length < 60);
  check('corte avisa quantas linhas ficaram ocultas', clipped.includes('linhas ocultas'));

  check('prompt curto não é mexido', clipInput('oi', 80) === 'oi');
  const longInput = clipInput('x'.repeat(200), 40);
  check('prompt longo fica em uma linha', !longInput.includes('\n') && longInput.length <= 31);
  check('prompt longo mostra o fim do texto', longInput.startsWith('…'));

  if (failures > 0) {
    console.error(`\n${failures} verificação(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nUI smoke OK.');
  }
}

main();
