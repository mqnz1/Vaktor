// =============================================================
// App da TUI Solid/OpenTUI: layout, teclado global, chat e
// sobreposições (menu de modelos).
// =============================================================
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import type { KeyEvent } from '@opentui/core';
import type { AppMode, ChatMessage, CompleteOptions } from '../types/index.js';
import { parseModelRef } from '../providers/registry.js';
import { COMMANDS, filterCommands } from '../ui/commands.js';
import { buildRepoMap, invalidateRepoMap, renderRepoMap } from '../context/index.js';
import { appendMemory, loadProjectMemory, memoryPath } from '../memory/index.js';
import {
  appendResource,
  ensureResourcesFile,
  loadResources,
  resourcesPath,
} from '../resources/index.js';
import { parseComboMembersInput } from '../router/combo.js';
import { SKILLS } from '../skills/index.js';
import { listFreeModels } from '../providers/catalog.js';
import { formatThinkingStatus, parseThinkingCommand } from '../thinking/index.js';
import {
  checkForUpdate,
  dismissUpdate,
  installVaktorUpdate,
  isUpdateDismissed,
  updateCheckEnabled,
  updateCheckIntervalMs,
  type UpdateInfo,
} from '../update/index.js';
import {
  buildOrchestrationPayload,
  createVaktorApi,
  ensureVaktorWorkspace,
  orchestratorStore,
  roleIcon,
  type OrchestrationEvent,
  type OrchestrationResult,
  type OrchestratorAssignments,
  type OrchestratorRole,
} from '../orchestrator/index.js';
import type { TuiController } from './controller.js';
import { Header } from './components/header.js';
import { MessageList, type ChatEntry } from './components/message-list.js';
import { InputBar } from './components/input-bar.js';
import { StatusBar } from './components/status-bar.js';
import { UpdateNotice } from './components/update-notice.js';
import { ModelMenu } from './components/model-menu.js';
import { OrchestratorMenu } from './components/orchestrator-menu.js';
import { CommandList } from './components/command-list.js';
import { FreeProvidersMenu } from './components/free-providers.js';
import { CONTEXT_MENU_WIDTH, ContextMenu, type ContextMenuAction } from './components/context-menu.js';
import { Suggestions } from './components/suggestions.js';
import { DirectoryPrompt } from './components/directory-prompt.js';
import { SessionsMenu } from './components/sessions-menu.js';
import { playSound } from './sound.js';
import { writeHostClipboard } from './clipboard.js';
import type { AgentEvent, PendingConfirm } from '../agent/types.js';
import {
  deleteStoredSession,
  loadSessions,
  sessionTopic,
  upsertSession,
  type StoredSession,
  type StoredSessionMessage,
} from './sessions.js';

export interface AppProps {
  controller: TuiController;
  onExit?: () => void;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CTRL_C_EXIT_WINDOW_MS = 1500;
const ESC_CANCEL_WINDOW_MS = 1500;
const CONTEXT_MENU_HEIGHT = 4;

let nextEntryId = 1;

interface ContextMenuState {
  messageId: number;
  content: string;
  x: number;
  y: number;
}

function formatOrchestrationSummary(result: OrchestrationResult): string {
  const lines: string[] = ['## Execução estruturada'];
  if (result.runId) lines.push(`- Run: \`${result.runId}\``);
  lines.push(`- Status: ${result.ok ? 'ok' : 'falhou'}`);
  if (result.model) lines.push(`- Modelo final: ${result.model}`);
  if (result.usage) {
    lines.push(
      `- Custo total: US$ ${result.usage.estimatedCostUsd.toFixed(4)} ` +
      `(${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens)`,
    );
  }

  const tasks = result.tasks ?? [];
  const models = [...new Set([
    ...(result.model ? [result.model] : []),
    ...tasks.map(task => task.model).filter(Boolean),
  ])];
  const files = [...new Set(tasks.flatMap(task => task.modifiedFiles))];
  lines.push(`- Modelos efetivos: ${models.join(', ') || '—'}`);
  lines.push(`- Arquivos modificados: ${files.join(', ') || '(nenhum)'}`);

  if (result.plan) {
    lines.push('', '### Plano', result.plan.summary || '(sem resumo)');
    if (result.plan.verification.length > 0) {
      lines.push('', `Verificação: ${result.plan.verification.join('; ')}`);
    }
  }

  if (tasks.length > 0) {
    lines.push('', '### Subtarefas executadas');
    for (const task of tasks) {
      const status = task.ok ? 'ok' : 'falhou';
      const duration = `${(task.durationMs / 1000).toFixed(1)}s`;
      const taskFiles = task.modifiedFiles.length > 0
        ? ` · ${task.modifiedFiles.join(', ')}`
        : '';
      lines.push(
        `- [${status}] ${task.id} (${task.role}) ${task.title} — ${task.model} — ${duration}${taskFiles}`,
      );
      if (task.error) lines.push(`  erro: ${task.error}`);
    }
  }

  return lines.join('\n').trimEnd();
}

export function App(props: AppProps) {
  const [messages, setMessages] = createSignal<ChatEntry[]>([]);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [commandsOpen, setCommandsOpen] = createSignal(false);
  const [freeOpen, setFreeOpen] = createSignal(false);
  const [directoryOpen, setDirectoryOpen] = createSignal(false);
  const [orchestratorOpen, setOrchestratorOpen] = createSignal(false);
  const [orchTask, setOrchTask] = createSignal('');
  const [orchAssignments, setOrchAssignments] = createSignal<OrchestratorAssignments>(
    orchestratorStore.snapshot(),
  );
  const [sessionsOpen, setSessionsOpen] = createSignal(false);
  const [sessionsList, setSessionsList] = createSignal<StoredSession[]>([]);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null);
  const [updateInstalling, setUpdateInstalling] = createSignal(false);
  const [suggestionIndex, setSuggestionIndex] = createSignal(0);
  const [spin, setSpin] = createSignal(0);
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  const [pendingConfirm, setPendingConfirm] = createSignal<PendingConfirm | null>(null);
  const dims = useTerminalDimensions();
  const renderer = useRenderer();
  const [routerState, setRouterState] = createSignal(props.controller.getState());
  props.controller.setOnStateChange?.(setRouterState);

  const history: string[] = [];
  let historyIdx = -1;
  let lastCtrlC = 0;
  let lastEscape = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let updateCheckInFlight = false;
  let currentAbort: AbortController | null = null;
  let currentSessionId: string | null = null;
  let overlayWasOpen = false;
  let pendingOrchRole: OrchestratorRole | null = null;
  let confirmResolver: ((approved: boolean) => void) | null = null;

  const spinnerFrame = createMemo(() => SPINNER_FRAMES[spin() % SPINNER_FRAMES.length]);

  const unsubscribeOrchestrator = orchestratorStore.subscribe(setOrchAssignments);
  onCleanup(unsubscribeOrchestrator);

  const suggestions = createMemo(() => {
    if (!input().startsWith('/')) return [];
    if (menuOpen() || commandsOpen() || freeOpen() || directoryOpen() || sessionsOpen() || orchestratorOpen() || contextMenu()) {
      return [];
    }
    return filterCommands(input());
  });

  const suggestionLimit = createMemo(() => {
    const room = dims().height - 18;
    return Math.max(2, Math.min(COMMANDS.length, room));
  });

  createEffect(() => {
    input();
    setSuggestionIndex(0);
  });

  createEffect(() => {
    const max = Math.max(0, Math.min(suggestions().length, suggestionLimit()) - 1);
    setSuggestionIndex(current => Math.min(current, max));
  });

  const spinTimer = setInterval(() => setSpin(s => s + 1), 120);
  onCleanup(() => clearInterval(spinTimer));
  onCleanup(() => persistCurrentSession(messages()));

  createEffect(() => {
    const open = menuOpen() || commandsOpen() || freeOpen() || directoryOpen() || sessionsOpen() || orchestratorOpen() || Boolean(contextMenu());
    if (open === overlayWasOpen) return;
    overlayWasOpen = open;
    playSound(open ? 'open' : 'close');
  });

  function showToast(message: string): void {
    setNotice(message);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => setNotice(null), 3000);
  }

  async function refreshUpdate(): Promise<void> {
    if (updateCheckInFlight || !updateCheckEnabled()) return;
    updateCheckInFlight = true;
    try {
      const info = await checkForUpdate();
      if (!info || isUpdateDismissed(info.latestVersion)) return;
      setUpdateInfo(info);
    } finally {
      updateCheckInFlight = false;
    }
  }

  function postponeUpdate(): void {
    const info = updateInfo();
    if (info) dismissUpdate(info.latestVersion);
    setUpdateInfo(null);
    showToast('Atualização adiada');
  }

  async function installUpdate(): Promise<void> {
    const info = updateInfo();
    if (!info || updateInstalling()) return;
    if (busy()) {
      showToast('Aguarde a operação atual');
      return;
    }
    setUpdateInstalling(true);
    showToast(`Instalando Vaktor ${info.latestVersion}...`);
    const result = await installVaktorUpdate();
    setUpdateInstalling(false);
    if (result.ok) {
      setUpdateInfo(null);
      showToast('Atualização instalada. Reinicie o Vaktor.');
      return;
    }
    showToast(`Falha ao atualizar: ${result.error ?? 'erro desconhecido'}`);
  }

  if (updateCheckEnabled()) {
    void refreshUpdate();
    const updateTimer = setInterval(() => {
      void refreshUpdate();
    }, updateCheckIntervalMs());
    updateTimer.unref();
    onCleanup(() => clearInterval(updateTimer));
  }

  function createConfirmFn() {
    return (pending: PendingConfirm): Promise<boolean> => {
      return new Promise(resolve => {
        setPendingConfirm(pending);
        confirmResolver = (approved: boolean) => {
          setPendingConfirm(null);
          confirmResolver = null;
          resolve(approved);
        };
      });
    };
  }

  function persistCurrentSession(entries: ChatEntry[]): void {
    const stored: StoredSessionMessage[] = entries
      .filter(entry => (entry.role === 'user' || entry.role === 'assistant') && !entry.streaming)
      .map(entry => ({
        role: entry.role as StoredSessionMessage['role'],
        content: entry.content,
        ...(entry.model ? { model: entry.model } : {}),
        ...(entry.reasoning ? { reasoning: entry.reasoning } : {}),
        ...(entry.tokens !== undefined ? { tokens: entry.tokens } : {}),
      }));
    if (!stored.some(message => message.role === 'user')) return;
    const id = currentSessionId ?? randomUUID();
    currentSessionId = id;
    const state = props.controller.getState();
    upsertSession({
      id,
      topic: sessionTopic(stored),
      workdir: state.workdir,
      model: state.activeModel,
      updatedAt: Date.now(),
      messages: stored,
    });
  }

  createEffect(() => {
    const entries = messages();
    if (busy()) return;
    persistCurrentSession(entries);
  });

  function openSessions(): void {
    setSessionsList(loadSessions());
    setSessionsOpen(true);
    setMenuOpen(false);
    setCommandsOpen(false);
    setFreeOpen(false);
  }

  function restoreSession(session: StoredSession): void {
    setMessages(
      session.messages.map(message => ({
        id: nextEntryId++,
        role: message.role,
        content: message.content,
        ...(message.model ? { model: message.model } : {}),
        ...(message.reasoning ? { reasoning: message.reasoning } : {}),
        ...(message.tokens !== undefined ? { tokens: message.tokens } : {}),
      })),
    );
    currentSessionId = session.id;
    setSessionsOpen(false);
    setInput('');
    showToast(`Sessão: ${session.topic}`);
  }

  function removeSession(id: string): void {
    deleteStoredSession(id);
    setSessionsList(loadSessions());
    if (currentSessionId === id) currentSessionId = null;
    showToast('Sessão apagada');
  }

  function startNewSession(): void {
    persistCurrentSession(messages());
    currentSessionId = null;
    setMessages([]);
    setInput('');
    setMenuOpen(false);
    setCommandsOpen(false);
    setFreeOpen(false);
    setDirectoryOpen(false);
    setOrchestratorOpen(false);
    setSessionsOpen(false);
    setContextMenu(null);
    playSound('new');
    showToast('Nova sessão');
  }

  function changeWorkdir(path: string): void {
    props.controller.setWorkdir(path);
    setDirectoryOpen(false);
    showToast(`Diretório: ${path}`);
  }

  function workdir(): string {
    return routerState().workdir;
  }

  function pushSystem(content: string): void {
    setMessages(current => [
      ...current,
      { id: nextEntryId++, role: 'system', content },
    ]);
  }

  function expandPath(raw: string): string {
    const text = raw.trim().replace(/^["']|["']$/g, '');
    if (text === '~') return homedir();
    if (text.startsWith('~/') || text.startsWith('~\\')) {
      return resolve(homedir(), text.slice(2));
    }
    return text;
  }

  function goToDirectory(raw: string): void {
    const target = expandPath(raw);
    try {
      if (!statSync(target).isDirectory()) {
        showToast('Esse caminho não é um diretório');
        return;
      }
    } catch {
      showToast('Diretório não encontrado');
      return;
    }
    changeWorkdir(target);
  }

  function copyMessage(content: string): void {
    let osc52 = false;
    try {
      osc52 = renderer.copyToClipboardOSC52(content);
    } catch {
      osc52 = false;
    }
    const host = writeHostClipboard(content);
    setContextMenu(null);
    showToast(osc52 || host ? 'Mensagem copiada' : 'Não foi possível copiar');
  }

  function selectedText(): string {
    try {
      return renderer.getSelection()?.getSelectedText() ?? '';
    } catch {
      return '';
    }
  }

  function openContextMenu(entry: ChatEntry, x: number, y: number): void {
    const left = Math.max(
      0,
      Math.min(x + 1, Math.max(0, dims().width - CONTEXT_MENU_WIDTH - 1)),
    );
    const top = Math.max(
      0,
      Math.min(y, Math.max(0, dims().height - CONTEXT_MENU_HEIGHT - 1)),
    );
    setContextMenu({ messageId: entry.id, content: entry.content, x: left, y: top });
  }

  function revertMessage(id: number, content: string): void {
    setContextMenu(null);
    if (busy()) {
      showToast('Aguarde a resposta para reverter');
      return;
    }
    setMessages(current => {
      const index = current.findIndex(entry => entry.id === id);
      return index < 0 ? current : current.slice(0, index);
    });
    setInput(content);
    showToast('Mensagem revertida — edite e envie');
  }

  function contextMenuActions(menu: ContextMenuState): ContextMenuAction[] {
    return [
      {
        label: 'Copiar',
        hint: 'C',
        onSelect: () => copyMessage(menu.content),
      },
      {
        label: 'Reverter',
        hint: 'R',
        danger: true,
        onSelect: () => revertMessage(menu.messageId, menu.content),
      },
    ];
  }

  function chatHistory(): ChatMessage[] {
    const now = Date.now();
    return messages()
      .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.streaming && !m.error))
      .map((m, i) => ({ role: m.role, content: m.content, timestamp: now + i }));
  }

  async function submit(raw: string): Promise<void> {
    const text = raw.trim();
    if (text.length === 0 || busy()) return;

    if (text.startsWith('/')) {
      setInput('');
      await runCommand(text);
      return;
    }

    history.push(text);
    historyIdx = -1;
    lastEscape = 0;
    setInput('');

    const userId = nextEntryId++;
    const pendingId = nextEntryId++;
    setMessages(m => [
      ...m,
      { id: userId, role: 'user', content: text },
      { id: pendingId, role: 'assistant', content: '', streaming: true },
    ]);
    setBusy(true);

    const abort = new AbortController();
    currentAbort = abort;

    try {
      const state = props.controller.getState();
      const isCodeMode = state.appMode === 'code';

      const res = isCodeMode && props.controller.complete
        ? await props.controller.complete(chatHistory(), {
            signal: abort.signal,
            onToken: chunk => {
              setMessages(m =>
                m.map(e =>
                  e.id === pendingId ? { ...e, content: e.content + chunk } : e,
                ),
              );
            },
            onReasoningToken: chunk => {
              setMessages(m =>
                m.map(e =>
                  e.id === pendingId ? { ...e, reasoning: (e.reasoning ?? '') + chunk } : e,
                ),
              );
            },
            onAgentEvent: (event: AgentEvent) => {
              setMessages(m =>
                m.map(e =>
                  e.id === pendingId
                    ? { ...e, agentEvents: [...(e.agentEvents ?? []), event] }
                    : e,
                ),
              );
            },
            confirmFn: createConfirmFn(),
          })
        : await props.controller.send(chatHistory(), {
            signal: abort.signal,
            onToken: chunk => {
              setMessages(m =>
                m.map(e =>
                  e.id === pendingId ? { ...e, content: e.content + chunk } : e,
                ),
              );
            },
            onReasoningToken: chunk => {
              setMessages(m =>
                m.map(e =>
                  e.id === pendingId ? { ...e, reasoning: (e.reasoning ?? '') + chunk } : e,
                ),
              );
            },
          });

      setMessages(m =>
        m.map(e =>
          e.id === pendingId
            ? {
                ...e,
                streaming: false,
                content: res.text,
                model: res.model,
                ...(res.reasoning ? { reasoning: res.reasoning } : {}),
                ...(res.reasoningParts ? { reasoningParts: res.reasoningParts } : {}),
                ...(res.reasoningTokens !== undefined
                  ? { reasoningTokens: res.reasoningTokens }
                  : {}),
                ...(res.agent ? { agent: res.agent } : {}),
                tokens: res.inputTokens + res.outputTokens,
              }
            : e,
        ),
      );
      if (res.text.trim().length > 0) playSound('reply');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (abort.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        setMessages(m =>
          m.map(e =>
            e.id === pendingId
              ? { ...e, streaming: false, content: `${e.content}\n[cancelado]`.trim() }
              : e,
          ),
        );
        showToast('Resposta cancelada');
      } else {
        setMessages(m =>
          m.map(e =>
            e.id === pendingId ? { ...e, streaming: false, error: true, content: msg } : e,
          ),
        );
      }
    } finally {
      if (currentAbort === abort) currentAbort = null;
      setBusy(false);
    }
  }

  async function runCommand(text: string): Promise<void> {
    const [cmd, ...rest] = text.split(/\s+/);
    switch (cmd) {
      case '/models': {
        const filter = (rest[0] ?? '').toLowerCase();
        if (filter === 'free' || filter === 'gratis' || filter === 'grátis') {
          setCommandsOpen(false);
          const free = listFreeModels();
          pushSystem(
            `Modelos grátis (${free.length}):\n${free
              .slice(0, 40)
              .map(model => `- ${model.qualifiedId} · ${model.name} · ${model.providerLabel}`)
              .join('\n')}${free.length > 40 ? '\n… use o menu de modelos para ver todos' : ''}`,
          );
          return;
        }
        setCommandsOpen(false);
        pendingOrchRole = null;
        setFreeOpen(false);
        setMenuOpen(true);
        return;
      }
      case '/orquestrator':
      case '/orchestrator':
      case '/orquestrador':
        try {
          ensureVaktorWorkspace(props.controller.getState().workdir);
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err));
          return;
        }
        setCommandsOpen(false);
        setFreeOpen(false);
        if (rest.length > 0) setOrchTask(rest.join(' '));
        setOrchAssignments(orchestratorStore.snapshot());
        setOrchestratorOpen(true);
        return;
      case '/sessions':
        openSessions();
        return;
      case '/new':
      case '/novo':
      case '/clear':
      case '/limpar':
        if (busy()) {
          showToast('Aguarde a resposta para criar uma nova sessão');
          return;
        }
        startNewSession();
        return;
      case '/directory':
        setCommandsOpen(false);
        setFreeOpen(false);
        if (rest.length > 0) {
          goToDirectory(rest.join(' '));
          return;
        }
        setDirectoryOpen(true);
        return;
      case '/credits': {
        const s = props.controller.getState();
        showToast(
          `Créditos: $${s.credits.remainingUsd.toFixed(4)} restantes de $${s.credits.budgetUsd.toFixed(2)} (${s.credits.percentUsed.toFixed(1)}% usado)`,
        );
        return;
      }
      case '/mode': {
        const arg = rest[0]?.toLowerCase();
        const current = props.controller.getState().appMode;
        let next: AppMode;
        if (!arg) {
          next = current === 'chat' ? 'code' : 'chat';
        } else if (arg === 'chat') {
          next = 'chat';
        } else if (arg === 'code' || arg === 'codigo' || arg === 'código') {
          next = 'code';
        } else {
          showToast('Uso: /mode [chat|code]');
          return;
        }
        props.controller.setMode(next);
        showToast(`Modo: ${next === 'chat' ? 'chat' : 'código'}`);
        return;
      }
      case '/thinking': {
        const status = (): string => {
          const s = props.controller.getState();
          const cfg = props.controller.getThinkingConfig?.();
          if (cfg) return formatThinkingStatus(s.thinkingEnabled, cfg);
          return `thinking: ${s.thinkingEnabled ? s.thinkingMode : 'off'}`;
        };
        if (rest.length === 0) {
          props.controller.toggleThinking?.();
          showToast(status());
          return;
        }
        const parsed = parseThinkingCommand(rest.join(' '));
        if (parsed.kind === 'status') {
          showToast(status());
          return;
        }
        if (parsed.kind === 'invalid') {
          showToast(parsed.message);
          return;
        }
        if (parsed.kind === 'on') props.controller.setThinkingMode?.('always');
        else if (parsed.kind === 'off') props.controller.setThinkingMode?.('off');
        else if (parsed.kind === 'auto') props.controller.setThinkingMode?.('auto');
        else if (parsed.kind === 'show') props.controller.setThinkingShow?.(true);
        else if (parsed.kind === 'hide') props.controller.setThinkingShow?.(false);
        else if (parsed.kind === 'budget') props.controller.setThinkingBudget?.(parsed.value);
        else if (parsed.kind === 'variant') {
          props.controller.setThinkingVariant?.(parsed.value === 'auto' ? undefined : parsed.value);
        }
        showToast(status());
        return;
      }
      case '/agent': {
        const arg = rest[0]?.toLowerCase();
        const current = props.controller.getState().agentEnabled;
        let next: boolean;
        if (arg === 'on') next = true;
        else if (arg === 'off') next = false;
        else if (arg === undefined) next = !current;
        else {
          showToast('Uso: /agent [on|off]');
          return;
        }
        props.controller.setAgentEnabled?.(next);
        showToast(`Agente: ${next ? 'ligado' : 'desligado'}`);
        return;
      }
      case '/combo': {
        const sub = rest[0]?.toLowerCase();
        if (!sub) {
          const on = !(props.controller.isComboActive?.() ?? false);
          props.controller.setComboEnabled?.(on);
          showToast(`Combo: ${on ? 'ligado' : 'desligado'}`);
          return;
        }
        if (sub === 'on' || sub === 'off') {
          const on = sub === 'on';
          props.controller.setComboEnabled?.(on);
          showToast(`Combo: ${on ? 'ligado' : 'desligado'}`);
          return;
        }
        if (sub === 'status' || sub === 'show') {
          pushSystem(props.controller.getComboDescription?.() ?? 'Combo indisponível');
          return;
        }
        if (sub === 'set' || sub === 'add') {
          const members = parseComboMembersInput(rest.slice(1).join(' '));
          if (members.length === 0) {
            showToast('Uso: /combo set modelo=peso modelo2=peso');
            return;
          }
          if (sub === 'add') {
            const current = props.controller.getComboConfig?.().members ?? [];
            const merged = [
              ...current.filter(member => !members.some(next => next.model === member.model)),
              ...members,
            ];
            props.controller.setComboMembers?.(merged);
          } else {
            props.controller.setComboMembers?.(members);
          }
          pushSystem(props.controller.getComboDescription?.() ?? 'Combo atualizado');
          return;
        }
        showToast('Uso: /combo [on|off|status|set <modelo=peso ...>]');
        return;
      }
      case '/resources': {
        const sub = rest[0]?.toLowerCase();
        const dir = workdir();
        if (!sub || sub === 'show') {
          const text = loadResources(dir, 4000);
          pushSystem(
            text
              ? `RESOURCES.md (${resourcesPath(dir)}):\n${text}`
              : `RESOURCES.md vazio (${resourcesPath(dir)}). ` +
                'Use /resources init ou /resources add <seção> <texto>.',
          );
          return;
        }
        if (sub === 'path') {
          pushSystem(resourcesPath(dir));
          return;
        }
        if (sub === 'init') {
          const created = ensureResourcesFile(dir);
          if (created) {
            pushSystem(
              `Criado ${resourcesPath(dir)}. Edite o arquivo ou use /resources add <seção> <texto>.`,
            );
          } else {
            showToast('RESOURCES.md já existe');
          }
          return;
        }
        if (sub === 'add') {
          const section = rest[1];
          const text = rest.slice(2).join(' ').trim();
          if (!section || !text) {
            showToast('Uso: /resources add <seção> <texto>');
            return;
          }
          const saved = appendResource(dir, section, text);
          showToast(saved ? 'RESOURCES.md atualizado' : 'Nada novo para adicionar');
          return;
        }
        showToast('Uso: /resources [show|path|init|add <seção> <texto>]');
        return;
      }
      case '/memory': {
        const sub = rest[0]?.toLowerCase();
        const dir = workdir();
        if (!sub || sub === 'show') {
          const text = loadProjectMemory(dir, 4000);
          const path = memoryPath(dir);
          pushSystem(
            text
              ? `Memória (${path}):\n${text}`
              : `Memória vazia (${path}). Use /memory add <texto> para registrar.`,
          );
          return;
        }
        if (sub === 'path') {
          pushSystem(memoryPath(dir));
          return;
        }
        if (sub === 'add') {
          const text = rest.slice(1).join(' ').trim();
          if (!text) {
            showToast('Uso: /memory add <texto>');
            return;
          }
          const saved = appendMemory(dir, 'Decisões', text);
          showToast(saved ? 'Memória atualizada' : 'Nada novo para adicionar');
          return;
        }
        showToast('Uso: /memory [show|path|add <texto>]');
        return;
      }
      case '/context': {
        const sub = rest[0]?.toLowerCase();
        if (sub === 'refresh' || sub === 'reload') invalidateRepoMap();
        const dir = workdir();
        const files = buildRepoMap(dir, 150);
        const map = renderRepoMap(files, 4000);
        pushSystem(`Contexto (${dir}) — ${files.length} arquivos:\n${map}`);
        return;
      }
      case '/skills': {
        const sub = rest[0]?.toLowerCase();
        const state = props.controller.getState();
        if (sub === 'on' || sub === 'off') {
          const on = sub === 'on';
          props.controller.setSkillsEnabled?.(on);
          showToast(`Skills: ${on ? 'ligadas' : 'desligadas'}`);
          return;
        }
        const active = state.activeSkills.length > 0 ? state.activeSkills.join(', ') : 'nenhuma';
        pushSystem(
          `Skills: ${state.skillsEnabled ? 'ligadas' : 'desligadas'} · ativas: ${active}\n` +
          SKILLS.map(skill => `- ${skill.id}: ${skill.name} — ${skill.description}`).join('\n'),
        );
        return;
      }
      case '/free': {
        setCommandsOpen(false);
        setFreeOpen(true);
        return;
      }
      case '/exit':
        props.onExit?.();
        return;
      default: {
        const known = COMMANDS.some(c => c.cmd === cmd);
        showToast(known ? `${cmd}: disponível, sem argumentos` : `Comando desconhecido: ${cmd}`);
        return;
      }
    }
  }

  function autocompleteMatches(): string[] {
    return filterCommands(input()).map(c => c.cmd);
  }

  function applyAutocomplete(): void {
    const value = input();
    if (!value.startsWith('/')) return;
    const matches = autocompleteMatches();
    if (matches.length === 0) return;
    if (matches.length === 1) {
      setInput(`${matches[0]} `);
      return;
    }
    let prefix = matches[0];
    for (const m of matches) {
      while (!m.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    if (prefix.length > value.length) setInput(prefix);
  }

  function selectModel(id: string): void {
    if (pendingOrchRole) {
      const role = pendingOrchRole;
      pendingOrchRole = null;
      if (id === 'auto') {
        showToast('Escolha um modelo específico para o papel');
        setOrchestratorOpen(true);
        return;
      }
      try {
        orchestratorStore.set(role, id);
        showToast(`${roleIcon(role)} ${parseModelRef(id).id}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
      setOrchestratorOpen(true);
      return;
    }
    props.controller.setModel(id);
    setMenuOpen(false);
    const s = props.controller.getState();
    setRouterState(s);
    showToast(`Modelo: ${parseModelRef(s.activeModel).id}${s.isAutoMode ? ' (auto)' : ''}`);
  }

  function selectOrchestratorRole(role: OrchestratorRole): void {
    pendingOrchRole = role;
    setOrchestratorOpen(false);
    setMenuOpen(true);
  }

  function closeModelMenu(): void {
    setMenuOpen(false);
    if (pendingOrchRole) {
      pendingOrchRole = null;
      setOrchestratorOpen(true);
    }
  }

  async function startOrchestration(): Promise<void> {
    const task = orchTask().trim();
    if (!task) {
      showToast('Informe a tarefa: /orquestrator <tarefa>');
      return;
    }
    if (busy()) {
      showToast('Aguarde a operação atual');
      return;
    }
    try {
      ensureVaktorWorkspace(props.controller.getState().workdir);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      return;
    }
    setOrchestratorOpen(false);
    setCommandsOpen(false);
    lastEscape = 0;
    setBusy(true);
    const abort = new AbortController();
    currentAbort = abort;

    const liveId = nextEntryId++;
    const lines: string[] = [];
    const record = (line: string, replaceLast = false): void => {
      if (replaceLast && lines.length > 0) lines[lines.length - 1] = line;
      else lines.push(line);
      if (lines.length > 12) lines.splice(0, lines.length - 12);
      const content = lines.join('\n');
      setMessages(current => {
        const index = current.findIndex(entry => entry.id === liveId);
        if (index === -1) {
          return [...current, { id: liveId, role: 'system', content }];
        }
        const next = [...current];
        next[index] = { ...next[index]!, content };
        return next;
      });
    };

    const controller = props.controller;
    const complete = controller.complete
      ? (messages: ChatMessage[], options?: CompleteOptions) =>
          controller.complete!(messages, {
            ...options,
            confirmFn: createConfirmFn(),
          })
      : (messages: ChatMessage[]) => controller.send(messages);
    const api = createVaktorApi({
      complete,
      workdir: controller.getState().workdir,
    });

    try {
      const payload = buildOrchestrationPayload(orchestratorStore.snapshot(), task);
      record(
        `🚀 Orquestração dinâmica iniciada · líder ${payload.orchestration.leader.model}`,
      );
      const result = await api.startOrchestration(payload, {
        signal: abort.signal,
        onEvent: (event: OrchestrationEvent) => {
          if (event.type === 'task_token' || event.type === 'worker_token') {
            const label = event.taskId
              ? `${event.taskId}${event.taskTitle ? ` ${event.taskTitle}` : ''}`
              : event.role
                ? roleIcon(event.role)
                : '•';
            record(`${label} ${event.message.slice(-400)}`, true);
            return;
          }
          if (event.type === 'task_start' || event.type === 'task_done') {
            record(event.message);
            return;
          }
          record(event.message);
        },
      });
      if (!result.ok && result.error) record(`[erro] ${result.error}`);
      const structured = formatOrchestrationSummary(result);
      const content = [result.finalText || '(orquestração sem resultado final)', structured]
        .filter(Boolean)
        .join('\n\n');
      setMessages(current => [
        ...current,
        {
          id: nextEntryId++,
          role: 'assistant',
          content,
          ...(result.model ? { model: result.model } : {}),
          ...(result.usage
            ? { tokens: result.usage.inputTokens + result.usage.outputTokens }
            : {}),
        },
      ]);
      playSound('reply');
      showToast(result.ok ? 'Orquestração concluída' : 'Orquestração falhou');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(`[orquestração] ${message}`);
      showToast(message);
    } finally {
      if (currentAbort === abort) currentAbort = null;
      setBusy(false);
    }
  }

  function handleKey(key: KeyEvent): void {
    const pending = pendingConfirm();
    if (pending) {
      if (key.name === 'escape') {
        key.preventDefault();
        if (confirmResolver) confirmResolver(false);
        return;
      }
      if (key.name === 'return' || key.name === 'kpenter') {
        key.preventDefault();
        if (confirmResolver) confirmResolver(true);
        return;
      }
    }

    const menu = contextMenu();
    if (menu) {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        key.preventDefault();
        setContextMenu(null);
        return;
      }
      if (!key.ctrl && key.name === 'c') {
        key.preventDefault();
        copyMessage(menu.content);
        return;
      }
      if (!key.ctrl && key.name === 'r') {
        key.preventDefault();
        revertMessage(menu.messageId, menu.content);
        return;
      }
    }

    if (directoryOpen() || sessionsOpen()) return;

    if (key.ctrl && key.name === 'c') {
      key.preventDefault();
      if (busy()) {
        // Cancela a chamada em andamento (propaga ao provedor via AbortSignal)
        if (currentAbort && !currentAbort.signal.aborted) {
          currentAbort.abort();
          showToast('Cancelando…');
        }
        return;
      }
      // Copia a seleção (resposta da IA, mensagens, etc.) ou o texto do prompt.
      const selection = selectedText();
      if (selection.trim().length > 0) {
        copyMessage(selection);
        return;
      }
      if (input().length > 0) {
        copyMessage(input());
        return;
      }
      const now = Date.now();
      if (now - lastCtrlC < CTRL_C_EXIT_WINDOW_MS) {
        props.onExit?.();
        return;
      }
      lastCtrlC = now;
      showToast('Ctrl+C novamente para sair');
      return;
    }

    if (key.ctrl && key.name === 'u') {
      key.preventDefault();
      setMenuOpen(false);
      setFreeOpen(false);
      setDirectoryOpen(false);
      setOrchestratorOpen(false);
      setSessionsOpen(false);
      setCommandsOpen(open => !open);
      return;
    }

    if (key.ctrl && key.name === 'l') {
      key.preventDefault();
      currentSessionId = null;
      setMessages([{ id: nextEntryId++, role: 'system', content: 'Histórico limpo.' }]);
      return;
    }

    if (key.ctrl && key.name === 'r') {
      key.preventDefault();
      if (busy()) return;
      const lastUser = [...messages()].reverse().find(m => m.role === 'user');
      if (lastUser) void submit(lastUser.content);
      return;
    }

    if (key.ctrl && key.name === 'p') {
      key.preventDefault();
      setCommandsOpen(false);
      setFreeOpen(false);
      setOrchestratorOpen(false);
      setMenuOpen(o => !o);
      return;
    }

    if (key.name === 'escape') {
      key.preventDefault();
      if (freeOpen()) setFreeOpen(false);
      else if (commandsOpen()) setCommandsOpen(false);
      else if (menuOpen()) setMenuOpen(false);
      else if (orchestratorOpen()) setOrchestratorOpen(false);
      else if (busy()) {
        const now = Date.now();
        if (now - lastEscape < ESC_CANCEL_WINDOW_MS) {
          lastEscape = 0;
          if (currentAbort && !currentAbort.signal.aborted) {
            currentAbort.abort();
            showToast('Cancelando…');
          }
          return;
        }
        lastEscape = now;
        showToast('ESC novamente para cancelar');
        return;
      } else if (input().length > 0) setInput('');
      return;
    }

    if (freeOpen()) return;
    if (commandsOpen()) return;

    if (key.name === 'tab' && !menuOpen() && !orchestratorOpen()) {
      key.preventDefault();
      applyAutocomplete();
      return;
    }

    if (key.name === 'enter' && menuOpen()) {
      // O select focado consome o Enter; handler global é fallback.
      return;
    }

    if ((key.name === 'up' || key.name === 'down') && suggestions().length > 0) {
      key.preventDefault();
      const max = Math.max(0, Math.min(suggestions().length, suggestionLimit()) - 1);
      setSuggestionIndex(current =>
        key.name === 'up' ? Math.max(0, current - 1) : Math.min(max, current + 1),
      );
      return;
    }

    if ((key.name === 'up' || key.name === 'down') && !menuOpen() && !orchestratorOpen()) {
      if (history.length === 0) return;
      key.preventDefault();
      if (key.name === 'up') {
        historyIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      } else {
        historyIdx = historyIdx === -1 ? -1 : historyIdx + 1;
        if (historyIdx >= history.length) {
          historyIdx = -1;
          setInput('');
          return;
        }
      }
      setInput(history[historyIdx]);
    }
  }

  useKeyboard(handleKey);

  props.controller.setOnNotification((message, type) => {
    showToast(type === 'warning' ? `⚠ ${message}` : message);
  });
  props.controller.setOnModelSwitch((from, to, reason) => {
    showToast(`Auto: ${from} → ${to} (${reason})`);
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      onMouseDown={() => {
        if (contextMenu()) setContextMenu(null);
      }}
    >
      <Header
        width={dims().width}
      />
      <Show when={updateInfo()}>
        {(info: () => UpdateInfo) => (
          <UpdateNotice
            version={info().latestVersion}
            installing={updateInstalling()}
            onInstall={() => {
              void installUpdate();
            }}
            onLater={postponeUpdate}
          />
        )}
      </Show>
      <MessageList
        messages={messages()}
        spinner={spinnerFrame()}
        flexGrow={1}
        showThinking={routerState().thinkingShow}
        onUserContextMenu={openContextMenu}
        pendingConfirm={pendingConfirm()}
        onApproveConfirm={() => {
          if (confirmResolver) confirmResolver(true);
        }}
        onRejectConfirm={() => {
          if (confirmResolver) confirmResolver(false);
        }}
      />
      <StatusBar
        notice={notice()}
        width={dims().width}
        creditsSpentUsd={routerState().credits.totalCostUsd}
        percentUsed={routerState().credits.percentUsed}
        model={parseModelRef(routerState().activeModel).id}
      />
      <Show when={suggestions().length > 0}>
        <Suggestions
          items={suggestions()}
          max={suggestionLimit()}
          selected={suggestionIndex()}
          onHover={setSuggestionIndex}
          onRun={command => {
            setInput('');
            void runCommand(command.cmd);
          }}
        />
      </Show>
      <InputBar
        value={input()}
        workdir={routerState().workdir}
        onChooseDirectory={() => {
          setCommandsOpen(false);
          setFreeOpen(false);
          setDirectoryOpen(true);
        }}
        focused={
          !menuOpen() && !contextMenu() && !commandsOpen() && !freeOpen() && !directoryOpen() && !orchestratorOpen() && !sessionsOpen() && !pendingConfirm()
        }
        busy={busy() && !pendingConfirm()}
        onInput={setInput}
        onSubmit={value => {
          const list = suggestions();
          if (list.length > 0) {
            const max = Math.max(0, Math.min(list.length, suggestionLimit()) - 1);
            const command = list[Math.min(suggestionIndex(), max)];
            setInput('');
            if (command) void runCommand(command.cmd);
            return;
          }
          void submit(value);
        }}
      />
      <Show when={menuOpen()}>
        <ModelMenu
          controller={props.controller}
          onSelect={selectModel}
          onClose={closeModelMenu}
        />
      </Show>
      <Show when={orchestratorOpen()}>
        <OrchestratorMenu
          assignments={orchAssignments()}
          taskPrompt={orchTask()}
          onSelectRole={selectOrchestratorRole}
          onStart={() => { void startOrchestration(); }}
          onClose={() => setOrchestratorOpen(false)}
        />
      </Show>
      <Show when={commandsOpen()}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          justifyContent="center"
          alignItems="center"
          zIndex={20}
          onMouseDown={() => setCommandsOpen(false)}
        >
          <CommandList
            onSelect={cmd => {
              setCommandsOpen(false);
              void runCommand(cmd);
            }}
          />
        </box>
      </Show>
      <Show when={freeOpen()}>
        <FreeProvidersMenu onClose={() => setFreeOpen(false)} />
      </Show>
      <Show when={directoryOpen()}>
        <DirectoryPrompt
          initial={routerState().workdir}
          onConfirm={changeWorkdir}
          onClose={() => setDirectoryOpen(false)}
          onCopy={copyMessage}
        />
      </Show>
      <Show when={sessionsOpen()}>
        <SessionsMenu
          sessions={sessionsList()}
          onRestore={restoreSession}
          onDelete={removeSession}
          onClose={() => setSessionsOpen(false)}
        />
      </Show>
      <Show when={contextMenu()} keyed>
        {(menu: ContextMenuState) => (
          <ContextMenu x={menu.x} y={menu.y} actions={contextMenuActions(menu)} />
        )}
      </Show>
    </box>
  );
}
