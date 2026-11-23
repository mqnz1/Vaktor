// =============================================================
// Smoke headless da TUI Solid/OpenTUI: render nativo, chat com
// controlador fake, autocomplete, menu de modelos, atalhos.
// =============================================================
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createSignal } from 'solid-js';
import { testRender } from '@opentui/solid';
import { MouseButtons, type TestRendererSetup } from '@opentui/core/testing';
import type { AppMode, ChatMessage, RouterState } from '../types/index.js';
import type { AgentEvent } from '../agent/types.js';
import { listAllModels, type TuiController, type TuiModelEntry, type TuiSendResult } from './controller.js';
import { PUTER_MODELS } from '../providers/puter.js';
import { ownerOf, parseModelRef } from '../providers/registry.js';
import { App } from './app.js';

const smokeDir = mkdtempSync(join(tmpdir(), 'vaktor-tui-'));
process.env.VAKTOR_SESSIONS_FILE = join(smokeDir, 'sessions.json');
process.env.VAKTOR_PROVIDERS_FILE = join(smokeDir, 'providers.json');
process.env.VAKTOR_SOUND = 'off';
process.env.VAKTOR_UPDATE_CHECK = 'off';

function fakeState(overrides?: Partial<RouterState>): RouterState {
  return {
    activeModel: 'fake-1',
    isAutoMode: false,
    isFallbackActive: false,
    appMode: 'chat',
    credits: {
      totalCostUsd: 0,
      budgetUsd: 5,
      remainingUsd: 5,
      percentUsed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheHits: 0,
      savedByCache: 0,
      usageHistory: [],
    },
    thinkingEnabled: false,
    thinkingMode: 'off',
    thinkingShow: false,
    workdir: process.cwd(),
    activeSkills: [],
    skillsEnabled: false,
    forcedSkillIds: [],
    agentEnabled: false,
    securityEnabled: false,
    ...overrides,
  };
}

class FakeController implements TuiController {
  state = fakeState({ thinkingShow: true });
  sentHistory: ChatMessage[] = [];
  receivedSignal: AbortSignal | null = null;
  responseDelayMs = 120;
  workdirCalls: string[] = [];
  private onModelSwitch: ((from: string, to: string, reason: string) => void) | null = null;

  getState(): RouterState {
    return this.state;
  }

  listModels(): TuiModelEntry[] {
    return [
      { id: 'fake-1', name: 'Fake Um', provider: 'echo', providerLabel: 'Echo', costPer1kTokensInput: 0 },
      { id: 'fake-2', name: 'Fake Dois', provider: 'nvidia', providerLabel: 'NVIDIA', costPer1kTokensInput: 0 },
    ];
  }

  setModel(id: string): void {
    const from = this.state.activeModel;
    this.state = { ...this.state, activeModel: id, isAutoMode: id === 'auto' };
    this.onModelSwitch?.(from, id, 'manual');
  }

  setMode(mode: AppMode): void {
    this.state = { ...this.state, appMode: mode };
  }

  setWorkdir(path: string): void {
    this.workdirCalls.push(path);
    this.state = { ...this.state, workdir: path };
  }

  async send(
    history: ChatMessage[],
    opts?: {
      bypassCache?: boolean;
      signal?: AbortSignal;
      onToken?: (chunk: string) => void;
      onReasoningToken?: (chunk: string) => void;
      onAgentEvent?: (event: AgentEvent) => void;
    },
  ): Promise<TuiSendResult> {
    this.sentHistory = history;
    this.receivedSignal = opts?.signal ?? null;
    const last = [...history].reverse().find(m => m.role === 'user')?.content ?? '';
    const withReasoning = last.includes('reason');
    if (withReasoning) opts?.onReasoningToken?.('penso ');
    // Token parcial imediato: a UI deve mostrá-lo antes da resposta final
    opts?.onToken?.(`parcial ${last}`);
    for (let elapsed = 0; elapsed < this.responseDelayMs; elapsed += 10) {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (opts?.signal?.aborted) {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
    }
    const text = last.includes('markdown')
      ? [
          '## Título',
          '**negrito** e *itálico*',
          '- item',
          '1. passo',
          '```ts',
          'const x = 1;',
          '```',
          '> citação',
          '| A | B |',
          '|---|---|',
          '| 1 | 2 |',
          '---',
        ].join('\n')
      : `echo:${last}`;
    return {
      text,
      model: this.state.activeModel,
      ...(withReasoning ? { reasoning: 'penso nativo', reasoningTokens: 5 } : {}),
      inputTokens: 1,
      outputTokens: 2,
      estimatedCostUsd: 0,
      fromCache: false,
    };
  }

  async complete(
    history: ChatMessage[],
    opts?: {
      signal?: AbortSignal;
      onToken?: (chunk: string) => void;
      onAgentEvent?: (event: AgentEvent) => void;
    },
  ): Promise<TuiSendResult> {
    this.sentHistory = history;
    this.receivedSignal = opts?.signal ?? null;
    const last = [...history].reverse().find(m => m.role === 'user')?.content ?? '';
    opts?.onAgentEvent?.({ type: 'tool_start', name: 'read_file', args: { path: 'src/app.ts' } });
    opts?.onAgentEvent?.({
      type: 'tool_end',
      name: 'read_file',
      args: { path: 'src/app.ts' },
      ok: true,
      preview: '12 linhas',
    });
    opts?.onAgentEvent?.({ type: 'tool_start', name: 'apply_patch', args: { path: 'src/app.ts' } });
    opts?.onAgentEvent?.({
      type: 'tool_end',
      name: 'apply_patch',
      args: { path: 'src/app.ts' },
      ok: true,
      preview: '--- a/src/app.ts +++ b/src/app.ts +2 -1',
    });
    opts?.onAgentEvent?.({
      type: 'verify_start',
      command: 'npm run typecheck',
    });
    opts?.onAgentEvent?.({ type: 'verify_end', ok: true, output: 'ok' });
    opts?.onToken?.(`agent:${last}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      text: `agent:${last}`,
      model: this.state.activeModel,
      inputTokens: 3,
      outputTokens: 4,
      estimatedCostUsd: 0,
      fromCache: false,
      agent: {
        ok: true,
        iterations: 1,
        toolCalls: 2,
        modifiedFiles: ['src/app.ts'],
        commands: [],
        tools: [
          { name: 'read_file', args: { path: 'src/app.ts' }, ok: true },
          { name: 'apply_patch', args: { path: 'src/app.ts' }, ok: true },
        ],
        verify: { ran: true, ok: true, attempts: 1, command: 'npm run typecheck' },
        diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-velho\n+novo',
      },
    };
  }

  setOnNotification(): void {}

  setOnModelSwitch(cb: (from: string, to: string, reason: string) => void): void {
    this.onModelSwitch = cb;
  }
}

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`OK     ${label}`);
  } else {
    throw new Error(`FAIL   ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function settle(setup: TestRendererSetup, ms = 40): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
  await setup.flush();
}

function countOccurrences(frame: string, needle: string): number {
  return frame.split(needle).length - 1;
}

function findCell(frame: string, needle: string): { x: number; y: number } | null {
  const lines = frame.split('\n');
  for (let y = 0; y < lines.length; y++) {
    const x = (lines[y] as string).indexOf(needle);
    if (x >= 0) return { x, y };
  }
  return null;
}

async function expectFrame(
  setup: TestRendererSetup,
  label: string,
  text: string,
  tries = 30,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await settle(setup, 20);
    if (setup.captureCharFrame().includes(text)) {
      check(label, true);
      return;
    }
  }
  check(label, false, `frame sem "${text}":\n${setup.captureCharFrame()}`);
}

const providerServer = createServer((request, response) => {
  if (request.url?.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'custom-model' }] }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});
await new Promise<void>(resolve => providerServer.listen(0, '127.0.0.1', resolve));
const providerPort = (providerServer.address() as AddressInfo).port;
const providerBase = `http://127.0.0.1:${providerPort}/v1`;

let exitCalls = 0;
const controller = new FakeController();
const [exited, setExited] = createSignal(0);

const setup = await testRender(
  () => <App controller={controller} onExit={() => { exitCalls++; setExited(exitCalls); }} />,
  { width: 100, height: 30, exitOnCtrlC: false },
);

try {
  await setup.renderOnce();
  check('render inicial sem crash', setup.captureCharFrame().includes('▀██▀')); // Logo V
  check('banner inicial removido', !setup.captureCharFrame().includes('digite sua mensagem'));
  check(
    'rodapé mostra Ctrl+U commands',
    setup.captureCharFrame().includes('Ctrl+U commands') &&
      !setup.captureCharFrame().includes('/free grátis'),
  );
  check(
    'rodapé mostra créditos, % e modelo',
    setup.captureCharFrame().includes('$0.0000 (0.0%) fake-1'),
  );
  const frame0 = setup.captureCharFrame();
  check('logo V visível', frame0.includes('██      ██') && frame0.includes('▀██▀'));
  check('wordmark aktor visível', frame0.includes('aktor'));
  check('versão pequena no header', frame0.includes('v2.0.28'));
  check('sombra quadrada removida do V', !frame0.includes('▄▄▄▄'));
  const puterModels = listAllModels().filter(model => model.provider === 'puter');
  check('catálogo Puter completo no menu', puterModels.length === PUTER_MODELS.length);
  check(
    'ID qualificado fixa o provedor',
    ownerOf('puter::gpt-5') === 'puter' && parseModelRef('puter::gpt-5').id === 'gpt-5',
  );

  // Chat: digitar e enviar
  await setup.mockInput.typeText('ola mundo');
  await settle(setup);
  check('input reflete o digitado', setup.captureCharFrame().includes('ola mundo'));
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'mensagem do usuário no chat', 'ola mundo');
  await expectFrame(setup, 'resposta do assistente', 'echo:ola mundo');
  await settle(setup);
  const chatFrame = setup.captureCharFrame();
  check('bloco da pergunta do usuário', chatFrame.includes('Você'));
  check('bloco da resposta com modelo', chatFrame.includes('◆ fake-1'));
  check('cards com borda arredondada', chatFrame.includes('╭') && chatFrame.includes('╰'));

  // Sessão salva automaticamente e listada em /sessions
  setup.mockInput.typeText('/sessions');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, '/sessions abre a lista', 'Sessões');
  check('sessão salva automaticamente aparece', setup.captureCharFrame().includes('ola mundo'));
  setup.mockInput.pressEscape();
  await settle(setup);
  check('Esc fecha as sessões', !setup.captureCharFrame().includes('Sessões'));

  // /directory abre o campo de caminho e confirma com Enter
  setup.mockInput.typeText('/directory');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, '/directory abre o campo de caminho', 'Diretório de trabalho');
  setup.mockInput.pressEnter();
  await settle(setup);
  check('Enter confirma o diretório', controller.workdirCalls.length === 1);
  check('modal de diretório fecha', !setup.captureCharFrame().includes('Diretório de trabalho'));

  // Ctrl+V (paste) no campo de diretório
  setup.mockInput.typeText('/directory');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'diretório reabre para teste de paste', 'Diretório de trabalho');
  await setup.mockInput.pasteBracketedText('/pasta-colada');
  await settle(setup);
  check('Ctrl+V cola no diretório', setup.captureCharFrame().includes('/pasta-colada'));
  setup.mockInput.pressEscape();
  await settle(setup);
  check('Esc fecha o diretório após colar', !setup.captureCharFrame().includes('Diretório de trabalho'));

  // Botão direito na mensagem do usuário: menu Copiar/Reverter
  const userCell = findCell(setup.captureCharFrame(), 'ola mundo');
  check('mensagem do usuário localizada para o clique direito', userCell !== null);
  if (userCell) {
    await setup.mockMouse.click(userCell.x, userCell.y, MouseButtons.RIGHT);
    await expectFrame(setup, 'clique direito abre menu com Reverter', 'Reverter');
    check('menu de contexto mostra Copiar', setup.captureCharFrame().includes('Copiar'));
    setup.mockInput.pressKey('r');
    await expectFrame(setup, 'Reverter devolve a mensagem ao prompt', 'ola mundo');
    check(
      'Reverter remove a mensagem do histórico',
      countOccurrences(setup.captureCharFrame(), 'ola mundo') === 1,
    );
    setup.mockInput.pressEscape();
    await settle(setup);
  }

  await setup.mockInput.typeText('markdown teste');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'Markdown renderiza código', 'const x = 1;');
  await expectFrame(setup, 'Markdown renderiza citação', 'citação');
  const markdownFrame = setup.captureCharFrame();
  check('Markdown remove delimitadores de negrito', !markdownFrame.includes('**negrito**'));
  check('Markdown mantém o texto em negrito', markdownFrame.includes('negrito'));
  check('Markdown remove fence de código', !markdownFrame.includes('```ts'));

  // Autocomplete: Tab estende até o prefixo comum (/mode + /models → /mod)
  await setup.mockInput.typeText('/mod');
  await settle(setup);
  check(
    'sugestões aparecem ao digitar /',
    setup.captureCharFrame().includes('/models') && setup.captureCharFrame().includes('/mode'),
  );
  check(
    'bloco de comandos organizado',
    setup.captureCharFrame().includes('Comandos') &&
      setup.captureCharFrame().includes('↑↓ escolhe · Enter executa') &&
      setup.captureCharFrame().includes('Selecionar modelo'),
  );

  check('input mostra /mod', setup.captureCharFrame().includes('/mod'));
  setup.mockInput.pressTab();
  await settle(setup);
  check(
    'Tab mantém o prefixo comum /mod',
    controller.sentHistory.length === 1 && setup.captureCharFrame().includes('/mode'),
  );
  await setup.mockInput.pressEscape();
  await settle(setup);
  check('Esc limpa o input', !setup.captureCharFrame().includes('/mode'));
  await setup.mockInput.typeText('/models');
  await settle(setup);
  check('digitar comando completo', setup.captureCharFrame().includes('/models'));
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'menu de modelos abre', 'Enter seleciona');
  await setup.mockInput.typeText('nvidia');
  await settle(setup);
  check(
    'pesquisa do menu filtra por provedor',
    setup.captureCharFrame().includes('Fake Dois · NVIDIA') &&
      !setup.captureCharFrame().includes('Fake Um'),
  );
  setup.mockInput.pressEscape();
  await settle(setup);
  check('Esc fecha o menu', !setup.captureCharFrame().includes('Enter seleciona'));

  // /free: provedor -> modelos, voltar e seleção
  await setup.mockInput.typeText('/free');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, '/free abre os provedores grátis', 'Provedores grátis');
  check('lista mostra provedor', setup.captureCharFrame().includes('OpenCode'));
  check('lista não despeja modelos', !setup.captureCharFrame().includes('gpt-'));
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'Enter abre os modelos grátis do provedor', 'Modelos grátis ·');
  setup.mockInput.pressEscape();
  await settle(setup);
  check('/free volta para a lista de provedores', setup.captureCharFrame().includes('Provedores grátis'));
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'modelos reabrem após voltar', 'Modelos grátis ·');
  setup.mockInput.pressEnter();
  await settle(setup);
  check('/free seleciona modelo qualificado', controller.state.activeModel.includes('::'));
  check('/free fecha após selecionar', !setup.captureCharFrame().includes('Provedores grátis'));

  // /provider: cadastro com validação local, chave mascarada e catálogo atualizado
  await setup.mockInput.typeText('/provider');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, '/provider abre o gerenciador', 'Providers customizados');
  check('estado vazio oferece novo provider', setup.captureCharFrame().includes('+ Novo provider'));
  setup.mockInput.typeText('n');
  await settle(setup);
  await expectFrame(setup, 'formulário de provider abre', 'Novo provider customizado');
  await setup.mockInput.typeText('Local Test');
  setup.mockInput.pressTab();
  await setup.mockInput.typeText(providerBase);
  setup.mockInput.pressTab();
  setup.mockInput.pressTab();
  await setup.mockInput.pasteBracketedText('sk-local-secret');
  await settle(setup);
  check('chave não aparece no formulário', !setup.captureCharFrame().includes('sk-local-secret'));
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'provider é validado e salvo', 'Provider salvo: Local Test');
  check('arquivo seguro de providers criado', existsSync(process.env.VAKTOR_PROVIDERS_FILE!));
  check(
    'modelo customizado entra no catálogo',
    listAllModels().some(model => model.id.endsWith('::custom-model')),
  );
  check('provider salvo aparece na lista', setup.captureCharFrame().includes('Local Test'));
  setup.mockInput.pressEscape();
  await settle(setup);
  check('/provider fecha no Esc', !setup.captureCharFrame().includes('Providers customizados'));

  // Enter executa o primeiro comando da lista
  await setup.mockInput.typeText('/mod');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'Enter executa o comando selecionado', 'Modo: código');
  check('modo alterna para código', controller.state.appMode === 'code');
  check('lista fecha após executar', !setup.captureCharFrame().includes('↑↓ escolhe · Enter executa'));

  await setup.mockInput.typeText('/mode');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, '/mode alterna de volta para chat', 'Modo: chat');
  check('modo volta para chat', controller.state.appMode === 'chat');

  // Seta para baixo muda a seleção e Enter executa o segundo comando
  await setup.mockInput.typeText('/mod');
  await settle(setup);
  setup.mockInput.pressArrow('down');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'seta para baixo seleciona o próximo', 'Enter seleciona');
  setup.mockInput.pressEscape();
  await settle(setup);

  // Ctrl+U: lista de comandos
  setup.mockInput.pressKey('u', { ctrl: true });
  await expectFrame(setup, 'Ctrl+U abre a lista de comandos', 'Comandos (Ctrl+U fecha)');
  check('lista de comandos mostra /models', setup.captureCharFrame().includes('/models'));
  check('lista de comandos mostra /new', setup.captureCharFrame().includes('/new'));

  // Setas navegam pela lista; Enter executa o item selecionado (/models)
  setup.mockInput.pressArrow('down');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'setas + Enter executam o comando selecionado', 'Enter seleciona');
  setup.mockInput.pressEscape();
  await settle(setup);
  setup.mockInput.pressKey('u', { ctrl: true });
  await expectFrame(setup, 'Ctrl+U reabre para o teste de clique', 'Comandos (Ctrl+U fecha)');

  const creditsCell = findCell(setup.captureCharFrame(), '/credits');
  check('comando localizado para clique', creditsCell !== null);
  if (creditsCell) {
    await setup.mockMouse.click(creditsCell.x + 1, creditsCell.y, MouseButtons.LEFT);
    await settle(setup);
    check('clique executa o comando', setup.captureCharFrame().includes('Créditos:'));
    check('clique fecha a lista', !setup.captureCharFrame().includes('Comandos (Ctrl+U fecha)'));
  }

  setup.mockInput.pressKey('u', { ctrl: true });
  await expectFrame(setup, 'Ctrl+U reabre a lista', 'Comandos (Ctrl+U fecha)');
  await setup.mockMouse.click(2, 2, MouseButtons.LEFT);
  await settle(setup);
  check('clique fora fecha a lista', !setup.captureCharFrame().includes('Comandos (Ctrl+U fecha)'));

  // Seleção de modelo via menu
  setup.mockInput.pressKey('p', { ctrl: true });
  await expectFrame(setup, 'Ctrl+P abre o menu', 'fake-2');
  setup.mockInput.pressEnter();
  await settle(setup);
  check('seleção troca o modelo', controller.state.activeModel === 'auto');

  // Histórico
  setup.mockInput.pressArrow('up');
  await settle(setup);
  check('seta para cima recupera histórico', setup.captureCharFrame().includes('markdown teste'));
  setup.mockInput.pressArrow('down');
  await settle(setup);

  // Ctrl+L limpa
  setup.mockInput.pressKey('l', { ctrl: true });
  await settle(setup);
  check('Ctrl+L limpa o chat', setup.captureCharFrame().includes('Histórico limpo'));

  // Ctrl+V (paste) no prompt de chat
  await setup.mockInput.typeText('prefixo ');
  await setup.mockInput.pasteBracketedText('colado');
  await settle(setup);
  check('Ctrl+V cola no prompt de chat', setup.captureCharFrame().includes('prefixo colado'));
  setup.mockInput.pressEscape();
  await settle(setup);

  // /new começa uma sessão limpa
  setup.mockInput.typeText('/new');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, '/new cria uma nova sessão', 'Nova sessão');
  check('/new limpa o histórico da conversa', !setup.captureCharFrame().includes('Histórico limpo'));

  // Streaming: token parcial antes da resposta final
  await setup.mockInput.typeText('stream teste');
  await settle(setup, 10);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'token parcial aparece antes da resposta final', 'parcial stream teste');
  await expectFrame(setup, 'resposta final substitui o parcial', 'echo:stream teste');
  check(
    'controlador recebeu sinal de cancelamento',
    controller.receivedSignal !== null && !controller.receivedSignal.aborted,
  );

  // Reasoning: bloco _Thinking:_ aparece com o texto nativo
  await setup.mockInput.typeText('reason teste');
  await settle(setup, 10);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'reasoning em streaming aparece', '_Thinking');
  await expectFrame(setup, 'reasoning final aparece', 'penso nativo');

  // Modo code: atividade do agente, ferramentas e diff
  await setup.mockInput.typeText('/mode code');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'modo code para o teste do agente', 'Modo:');
  await setup.mockInput.typeText('agent activity');
  await settle(setup, 10);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'atividade mostra Read', 'Read(src/app.ts)');
  await expectFrame(setup, 'atividade mostra Patch', 'Patch(src/app.ts)');
  await expectFrame(setup, 'atividade mostra Verify', 'Verify(npm run typecheck)');
  await expectFrame(setup, 'atividade mostra diff', 'Diff');
  await expectFrame(setup, 'resposta final do agente aparece', 'agent:agent activity');
  check(
    'resumo do agente aparece',
    setup.captureCharFrame().includes('2 ferramentas') &&
      setup.captureCharFrame().includes('verify ok'),
  );
  await setup.mockInput.typeText('/mode chat');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, 'modo chat restaurado', 'Modo: chat');

  // Cancelamento via ESC duas vezes durante a resposta
  controller.responseDelayMs = 500;
  await setup.mockInput.typeText('cancela com esc');
  await settle(setup, 10);
  setup.mockInput.pressEnter();
  await settle(setup, 5);
  setup.mockInput.pressEscape();
  await settle(setup, 5);
  check('primeiro ESC não cancela', !setup.captureCharFrame().includes('cancelado'));
  await expectFrame(setup, 'primeiro ESC mostra aviso', 'ESC novamente');
  check('sinal ainda ativo após 1 ESC', controller.receivedSignal?.aborted === false);
  setup.mockInput.pressEscape();
  await expectFrame(setup, 'ESC duas vezes cancela', 'cancelado');
  await expectFrame(setup, 'toast de cancelamento via ESC', 'Resposta cancelada');
  check('ESC abortou de verdade', controller.receivedSignal?.aborted === true);
  controller.responseDelayMs = 120;

  // Cancelamento via Ctrl+C durante a resposta
  await setup.mockInput.typeText('cancela isto');
  await settle(setup, 10);
  setup.mockInput.pressEnter();
  await settle(setup, 5);
  setup.mockInput.pressCtrlC();
  await expectFrame(setup, 'Ctrl+C durante resposta cancela', 'cancelado');
  await expectFrame(setup, 'toast de cancelamento', 'Resposta cancelada');
  check('sinal abortou de verdade', controller.receivedSignal?.aborted === true);

  // /sessions: hover + Ctrl+Del apaga, seleção passa para a próxima
  setup.mockInput.typeText('/sessions');
  await settle(setup);
  setup.mockInput.pressEnter();
  await expectFrame(setup, '/sessions lista as sessões', 'stream teste');
  check('sessão antiga listada', setup.captureCharFrame().includes('markdown teste'));
  const oldSessionCell = findCell(setup.captureCharFrame(), 'markdown teste');
  check('sessão antiga localizada para hover', oldSessionCell !== null);
  if (oldSessionCell) {
    await setup.mockMouse.moveTo(oldSessionCell.x, oldSessionCell.y);
    await settle(setup);
    setup.mockInput.pressKey('DELETE', { ctrl: true });
    await settle(setup);
    check('Ctrl+Del apaga a sessão em hover', !setup.captureCharFrame().includes('markdown teste'));
    check('outra sessão permanece', setup.captureCharFrame().includes('stream teste'));
    setup.mockInput.pressKey('DELETE', { ctrl: true });
    await settle(setup);
    check(
      'Ctrl+Del apaga a próxima sessão',
      setup.captureCharFrame().includes('Nenhuma sessão ainda'),
    );
  }
  setup.mockInput.pressEscape();
  await settle(setup);

  // Ctrl+C duplo sai
  setup.mockInput.pressCtrlC();
  await settle(setup);
  check('primeiro Ctrl+C mostra aviso', setup.captureCharFrame().includes('Ctrl+C novamente'));
  setup.mockInput.pressCtrlC();
  await settle(setup);
  check('segundo Ctrl+C sai', exited() === 1);

  console.log('TUI smoke OK: chat, Markdown, /free, /provider, autocomplete e atalhos');
} finally {
  await setup.dispose();
  await new Promise<void>(resolve => providerServer.close(() => resolve()));
}
