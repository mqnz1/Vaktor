import React, { useState, useCallback, useEffect, memo, useRef } from 'react';
import { Box } from 'ink';
import type { ChatMessage, RouterState, UINotification } from '../types/index.js';
import type { AIRouter } from '../router/index.js';
import type { AgentEvent, PendingConfirm } from '../agent/types.js';
import { runAgent } from '../agent/index.js';
import { detectVerification, runVerification } from '../agent/verify.js';
import { buildRepoMap, renderRepoMap } from '../context/index.js';
import { appendMemory, hasMemory, loadProjectMemory } from '../memory/index.js';
import { loadSecurityProfile, resolveSecurityFile } from '../security/index.js';
import { McpClient } from '../mcp/client.js';
import { runMcpCommand } from '../mcp/bridge.js';
import { describeTools, TOOLS, toolsSummary } from '../tools/index.js';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { InputBar } from './components/InputBar.js';
import { Footer } from './components/Footer.js';
import { NotificationBar } from './components/Notification.js';
import { ModelMenu } from './components/ModelMenu.js';
import { OrchestratorMenu } from './components/OrchestratorMenu.js';
import { CreditsPanel } from './components/CreditsPanel.js';
import { DirectoryMenu } from './components/DirectoryMenu.js';
import { SkillsPanel } from './components/SkillsPanel.js';
import { ConfirmWrite } from './components/ConfirmWrite.js';
import { SKILLS, getSkillById } from '../skills/index.js';
import { formatThinkingStatus, parseThinkingCommand } from '../thinking/index.js';
import {
  SAFETY_LINES,
  messageAreaLines,
  autocompleteCapacity,
  autocompleteExtraLines,
  confirmBoxLines,
} from './layout.js';
import { filterCommands } from './commands.js';
import {
  buildOrchestrationPayload,
  createVaktorApi,
  orchestratorStore,
  roleDefinition,
  roleIcon,
  type OrchestrationEvent,
  type OrchestratorAssignments,
  type OrchestratorRole,
} from '../orchestrator/index.js';

interface AppProps {
  router: AIRouter;
  initialState: RouterState;
}

type Overlay = 'none' | 'models' | 'credits' | 'directory' | 'skills' | 'orchestrator';

// Memoize all children so InputBar typing never re-renders the rest of the tree
const MemoHeader = memo(Header);
const MemoMessageList = memo(MessageList);
const MemoFooter = memo(Footer);
const MemoInputBar = memo(InputBar);
const MemoNotificationBar = memo(NotificationBar);
const MemoModelMenu = memo(ModelMenu);
const MemoOrchestratorMenu = memo(OrchestratorMenu);
const MemoCreditsPanel = memo(CreditsPanel);
const MemoDirectoryMenu = memo(DirectoryMenu);
const MemoSkillsPanel = memo(SkillsPanel);
const MemoConfirmWrite = memo(ConfirmWrite);

export function App({ router, initialState }: AppProps): React.ReactElement {
  const [routerState, setRouterState] = useState<RouterState>(initialState);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [notifications, setNotifs] = useState<UINotification[]>([]);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [orchAssignments, setOrchAssignments] = useState<OrchestratorAssignments>(
    () => orchestratorStore.snapshot(),
  );
  const [orchTask, setOrchTask] = useState('');
  const [orchRole, setOrchRole] = useState<OrchestratorRole | null>(null);
  const [lastWasCached, setLastCached] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [lastVerifyStatus, setLastVerifyStatus] = useState<'ok' | 'fail' | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const pendingResolve = useRef<((ok: boolean) => void) | null>(null);
  // Cliente MCP compartilhado pela sessão: usado pelo agente e pelo /mcp.
  const mcpClientRef = useRef<McpClient | null>(null);
  const [termSize, setTermSize] = useState({
    rows: process.stdout.rows || 40,
    cols: process.stdout.columns || 120,
  });
  // Texto do prompt (controlado pelo App para o menu de comandos poder ser
  // medido no mesmo render em que é desenhado).
  const [prompt, setPrompt] = useState('');

  // --- Notifications ---
  const notify = useCallback((message: string, type: UINotification['type']): void => {
    const id = `${Date.now()}-${Math.random()}`;
    const n: UINotification = { id, type, message, timestamp: Date.now(), autoDismissMs: 4000 };
    setNotifs(prev => [...prev.slice(-4), n]);
    setTimeout(() => setNotifs(prev => prev.filter(x => x.id !== id)), 4000);
  }, []);

  // --- MCP: cliente compartilhado (criado sob demanda quando MCP_ENABLED=true) ---
  const getMcpClient = useCallback((): McpClient | undefined => {
    const config = router.getAgentConfig();
    if (!config.mcpEnabled) return undefined;
    if (!mcpClientRef.current) {
      const client = new McpClient({ roots: [routerState.workdir] });
      for (const server of config.mcpServers) client.addServer(server);
      mcpClientRef.current = client;
    }
    return mcpClientRef.current;
  }, [router, routerState.workdir]);

  // Fecha os processos/sessões MCP ao sair da TUI.
  useEffect(() => {
    return () => {
      mcpClientRef.current?.closeAll();
      mcpClientRef.current = null;
    };
  }, []);

  // --- Router wiring ---
  useEffect(() => {
    router.setOnStateChange(setRouterState);
    router.setOnNotification((msg, type) => notify(msg, type));
    router.setOnModelSwitch((fromModel, toModel, reason) => {
      const switchMsg: ChatMessage = {
        role: 'system',
        content: `[Model switch] ${fromModel} → ${toModel} (${reason})`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, switchMsg]);
    });
  }, [router, notify]);

  // --- Orquestrador: espelha o store global no estado da UI ---
  useEffect(() => orchestratorStore.subscribe(setOrchAssignments), []);

  // --- Terminal resize ---
  useEffect(() => {
    const handleResize = (): void => {
      // Limpa a tela antes de redimensionar: o Ink apaga N linhas do quadro
      // anterior, e com a largura antiga essa conta erra — sobram restos.
      process.stdout.write('\x1b[2J\x1b[H');
      setTermSize({
        rows: process.stdout.rows || 40,
        cols: process.stdout.columns || 120,
      });
    };
    process.stdout.on('resize', handleResize);
    return () => { process.stdout.off('resize', handleResize); };
  }, []);

  // --- Verificação sob demanda (/verify) ---
  const verifyNow = useCallback(async (): Promise<void> => {
    const config = router.getAgentConfig();
    const workdir = router.getState().workdir;
    const commands = detectVerification(workdir);
    if (commands.length === 0) {
      notify('Nada para verificar (sem package.json/tsconfig).', 'info');
      return;
    }

    setIsThinking(true);
    try {
      const result = await runVerification(commands, {
        workdir,
        allowWrite: false,
        autoApprove: true,
        maxFileBytes: config.maxFileBytes,
        maxOutputChars: config.maxOutputChars,
        commandTimeoutMs: config.commandTimeoutMs,
        allowedCommands: config.allowedCommands,
        allowNetwork: false,
        allowInstall: false,
        allowGitWrite: false,
        allowedDomains: [],
        readPaths: new Set<string>(),
      });
      setLastVerifyStatus(result.ok ? 'ok' : 'fail');
      setMessages(prev => [...prev, {
        role: 'system',
        content: `[verify ${result.ok ? 'OK' : 'falhou'}] ${result.command ?? ''}\n${(result.output ?? '').slice(-2000)}`,
        timestamp: Date.now(),
      }]);
      notify(result.ok ? 'Verify OK' : 'Verify falhou', result.ok ? 'success' : 'warning');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setIsThinking(false);
    }
  }, [router, notify]);

  const resolveWrite = useCallback((ok: boolean): void => {
    const resolver = pendingResolve.current;
    pendingResolve.current = null;
    setPendingConfirm(null);
    resolver?.(ok);
  }, []);

  // --- Slash commands ---
  const handleCommand = useCallback((cmd: string): boolean => {
    const lower = cmd.trim().toLowerCase();
    const parts = lower.split(/\s+/);
    const name = parts[0] ?? '';
    const arg = parts[1] ?? '';
    const rest = cmd.trim().slice(name.length).trim();

    if (lower === '/exit' || lower === '/sair') { process.exit(0); return true; }
    if (name === '/mode' || name === '/modo') {
      const requested = arg === 'chat' || arg === 'code' || arg === 'codigo' || arg === 'código'
        ? arg
        : '';
      if (arg && !requested) {
        notify('Uso: /mode [chat|code]', 'warning');
        return true;
      }
      const next = requested === 'chat'
        ? 'chat'
        : requested
          ? 'code'
          : routerState.appMode === 'chat' ? 'code' : 'chat';
      router.setMode(next);
      notify(`Modo: ${next === 'chat' ? 'Chat' : 'Code'}`, 'info');
      return true;
    }
    if (lower === '/models' || lower === '/modelos') { setOrchRole(null); setOverlay('models'); return true; }

    if (name === '/orquestrator' || name === '/orchestrator' || name === '/orquestrador') {
      if (rest) setOrchTask(rest);
      setOrchAssignments(orchestratorStore.snapshot());
      setOrchRole(null);
      setOverlay('orchestrator');
      return true;
    }
    if (lower === '/credits' || lower === '/creditos') { setOverlay('credits'); return true; }
    if (lower === '/new' || lower === '/novo') {
      setMessages([]);
      notify('Nova sessão', 'info');
      return true;
    }
    if (lower === '/clear' || lower === '/limpar') {
      setMessages([]);
      notify('History cleared', 'info');
      return true;
    }
    if (lower === '/directory' || lower === '/diretorio') { setOverlay('directory'); return true; }

    if (name === '/thinking' || name === '/pensamento') {
      const parsed = parseThinkingCommand(rest);
      switch (parsed.kind) {
        case 'status':
          notify(formatThinkingStatus(routerState.thinkingEnabled, router.getThinkingConfig()), 'info');
          break;
        case 'on':
          router.setThinkingMode('always');
          notify('Thinking: on', 'info');
          break;
        case 'off':
          router.setThinkingMode('off');
          notify('Thinking: off', 'info');
          break;
        case 'auto':
          router.setThinkingMode('auto');
          notify('Thinking: auto', 'info');
          break;
        case 'show':
          router.setThinkingShow(true);
          notify('Thinking: exibindo raciocínio', 'info');
          break;
        case 'hide':
          router.setThinkingShow(false);
          notify('Thinking: raciocínio oculto', 'info');
          break;
        case 'budget':
          router.setThinkingBudget(parsed.value);
          notify(`Thinking budget: ${parsed.value}`, 'info');
          break;
        case 'invalid':
          notify(parsed.message, 'warning');
          break;
      }
      return true;
    }

    if (name === '/skills' || name === '/habilidades') {
      if (arg === 'off') {
        router.setSkillsEnabled(false);
        notify('Skills desligadas', 'info');
        return true;
      }
      if (arg === 'on') {
        router.setSkillsEnabled(true);
        notify('Skills ligadas', 'info');
        return true;
      }
      setOverlay('skills');
      return true;
    }

    if (name === '/skill') {
      if (!arg || arg === 'off') {
        router.forceSkill(null);
        notify('Skills forcadas limpas', 'info');
        return true;
      }
      const skill = getSkillById(arg);
      if (!skill) {
        notify(`Skill desconhecida: ${arg}`, 'warning');
        return true;
      }
      router.forceSkill(skill.id);
      notify(`Skill forcada: ${skill.id}`, 'info');
      return true;
    }

    if (name === '/agent' || name === '/agente') {
      if (arg === 'on') { router.setAgentEnabled(true); notify('Agent: on (modo code)', 'info'); return true; }
      if (arg === 'off') { router.setAgentEnabled(false); notify('Agent: off', 'info'); return true; }
      if (arg === 'max') {
        const value = Number(parts[2]);
        if (!Number.isFinite(value)) { notify('Uso: /agent max N (1-20)', 'warning'); return true; }
        router.setAgentMaxIterations(value);
        notify(`Agent max iterations: ${router.getAgentConfig().maxIterations}`, 'info');
        return true;
      }
      const cfg = router.getAgentConfig();
      notify(
        `agent ${routerState.agentEnabled ? 'on' : 'off'} · max ${cfg.maxIterations} · tools ${TOOLS.length} · verify ${cfg.verifyEnabled ? 'on' : 'off'} · write ${cfg.allowWrite ? 'on' : 'off'}`,
        'info',
      );
      return true;
    }

    if (name === '/verify' || name === '/verificar') {
      void verifyNow();
      return true;
    }

    if (name === '/security' || name === '/seguranca') {
      const cfg = router.getAgentConfig();
      if (arg === 'on') {
        router.setSecurityEnabled(true);
        notify('Perfil de segurança: on', 'info');
        return true;
      }
      if (arg === 'off') {
        router.setSecurityEnabled(false);
        notify('Perfil de segurança: off', 'info');
        return true;
      }
      const path = resolveSecurityFile(routerState.workdir, cfg.securityFile);
      const status = routerState.securityEnabled ? 'on' : 'off';
      if (!path) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `[security] ${status} · ${cfg.securityFile} não encontrado em ${routerState.workdir}\nCrie o arquivo ou ajuste SECURITY_FILE no .env.`,
          timestamp: Date.now(),
        }]);
        return true;
      }
      const profile = loadSecurityProfile(routerState.workdir, undefined, cfg.securityFile);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `[security] ${status} · ${path}\n${profile}`,
        timestamp: Date.now(),
      }]);
      return true;
    }

    if (name === '/mcp') {
      const argv = rest ? rest.split(/\s+/).filter(Boolean) : [];
      const client = getMcpClient();
      void (async () => {
        const text = await runMcpCommand(client, argv);
        setMessages(prev => [...prev, { role: 'system', content: text, timestamp: Date.now() }]);
      })();
      return true;
    }

    if (name === '/context' || name === '/contexto') {
      const cfg = router.getAgentConfig();
      const files = buildRepoMap(routerState.workdir, 150);
      const map = renderRepoMap(files, cfg.contextMaxChars);
      setMessages(prev => [...prev, {
        role: 'system',
        content: map ? `[context] ${files.length} arquivos\n${map}` : '[context] repo map vazio',
        timestamp: Date.now(),
      }]);
      return true;
    }

    if (name === '/memory' || name === '/memoria') {
      const cfg = router.getAgentConfig();
      const memoryArg = rest.slice(arg.length).trim();
      if (arg === 'add') {
        if (!memoryArg) { notify('Uso: /memory add <texto>', 'warning'); return true; }
        const saved = appendMemory(routerState.workdir, 'Decisões', memoryArg, cfg.memoryFile);
        notify(saved ? 'Memória atualizada' : 'Entrada idêntica ignorada', saved ? 'success' : 'info');
        return true;
      }
      if (hasMemory(routerState.workdir, cfg.memoryFile)) {
        const content = loadProjectMemory(routerState.workdir, cfg.contextMaxChars, cfg.memoryFile);
        setMessages(prev => [...prev, {
          role: 'system',
          content: `[memory] ${cfg.memoryFile}\n${content}`,
          timestamp: Date.now(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `[memory] ${cfg.memoryFile} não existe. Use /memory add <texto>.`,
          timestamp: Date.now(),
        }]);
      }
      return true;
    }

    if (name === '/tools' || name === '/ferramentas') {
      const cfg = router.getAgentConfig();
      const flags = [
        `write: ${cfg.allowWrite ? 'on' : 'off'}`,
        `autoApprove: ${cfg.autoApprove ? 'on' : 'off'}`,
        `network: ${cfg.allowNetwork ? 'on' : 'off'}`,
        `install: ${cfg.allowInstall ? 'on' : 'off'}`,
        `git-write: ${cfg.allowGitWrite ? 'on' : 'off'}`,
        `domains: ${cfg.allowedDomains.length > 0 ? cfg.allowedDomains.join(',') : 'any-https'}`,
      ].join(' · ');
      setMessages(prev => [...prev, {
        role: 'system',
        content: `[tools] ${toolsSummary()}\n${flags}\n${describeTools().join('\n')}`,
        timestamp: Date.now(),
      }]);
      return true;
    }

    return false;
  }, [router, routerState.appMode, routerState.thinkingEnabled, routerState.workdir, routerState.agentEnabled, routerState.securityEnabled, getMcpClient, notify, verifyNow]);

  // --- Submit handler ---
  const handleSubmit = useCallback(async (value: string): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed || isThinking) return;

    if (trimmed.startsWith('/')) {
      if (trimmed === '/') return;
      if (!handleCommand(trimmed)) notify(`Unknown command: ${trimmed}`, 'warning');
      return;
    }

    const useAgent = routerState.appMode === 'code' && routerState.agentEnabled;
    const userMsg: ChatMessage = { role: 'user', content: trimmed, timestamp: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setIsThinking(true);
    setLastCached(false);
    setAgentEvents([]);
    setLastVerifyStatus(null);

    try {
      if (useAgent) {
        const config = router.getAgentConfig();
        const result = await runAgent(trimmed, messages, (msgs, opts) => router.complete(msgs, opts), {
          workdir: routerState.workdir,
          codeMode: true,
          maxIterations: config.maxIterations,
          maxToolCalls: config.maxToolCalls,
          allowWrite: config.allowWrite,
          autoApprove: config.autoApprove,
          verify: config.verifyEnabled,
          verifyMaxAttempts: config.verifyMaxAttempts,
          onEvent: event => {
            setAgentEvents(prev => [...prev.slice(-30), event]);
            if (event.type === 'verify_end') setLastVerifyStatus(event.ok ? 'ok' : 'fail');
            if (event.type === 'error') notify(event.message, 'warning');
          },
          // O callback de confirmação é SEMPRE fornecido: ações irreversíveis
          // (install/commit/push/pr) exigem confirmação mesmo com autoApprove.
          onConfirm: (pending: PendingConfirm) => new Promise<boolean>(resolve => {
            pendingResolve.current = resolve;
            setPendingConfirm(pending);
          }),
          maxFileBytes: config.maxFileBytes,
          maxOutputChars: config.maxOutputChars,
          commandTimeoutMs: config.commandTimeoutMs,
          allowedCommands: config.allowedCommands,
          allowNetwork: config.allowNetwork,
          allowInstall: config.allowInstall,
          allowGitWrite: config.allowGitWrite,
          allowedDomains: config.allowedDomains,
          context: { inject: config.contextInject, maxChars: config.contextMaxChars },
          memoryFile: config.memoryFile,
          securityEnabled: config.securityEnabled,
          securityFile: config.securityFile,
          mcpEnabled: config.mcpEnabled,
          ...(config.mcpEnabled ? { mcpClient: getMcpClient() } : {}),
          ...(config.bestOfN > 1 ? {
            bestOfN: {
              n: config.bestOfN,
              ...(config.criticModel ? { criticModel: config.criticModel } : {}),
              maxCostUsd: config.bestOfNMaxCostUsd,
            },
          } : {}),
          dataset: { enabled: config.enableDatasetLog },
          isOverBudget: () => router.isOverBudget(),
          estimateCost: msgs => router.estimateCost(msgs),
        });

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: result.text || '(sem resposta final)',
          timestamp: Date.now(),
          tokenCount: result.usage.outputTokens,
        }]);

        if (result.verify.ran) {
          notify(
            `Verify ${result.verify.ok ? 'OK' : 'falhou'} (${result.verify.attempts})`,
            result.verify.ok ? 'success' : 'warning',
          );
        }
      } else {
        const response = await router.send(next);
        const aiMsg: ChatMessage = {
          role: 'assistant',
          content: response.text,
          timestamp: Date.now(),
          tokenCount: response.outputTokens,
          ...(response.reasoning ? { reasoning: response.reasoning } : {}),
        };
        setMessages(prev => [...prev, aiMsg]);
        setLastCached(response.fromCache);
        if (response.fromCache) notify('Response from cache', 'info');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(message, 'error');
      if (useAgent) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `[agent error] ${message}`,
          timestamp: Date.now(),
        }]);
      } else {
        setMessages(prev => prev.slice(0, -1));
      }
    } finally {
      if (pendingResolve.current) {
        pendingResolve.current(false);
        pendingResolve.current = null;
        setPendingConfirm(null);
      }
      setIsThinking(false);
    }
  }, [messages, isThinking, router, routerState.appMode, routerState.agentEnabled, routerState.workdir, handleCommand, notify]);

  // --- Stable callbacks for memoized children ---
  const handleEscape = useCallback(() => {
    if (overlay === 'models' && orchRole) {
      setOrchRole(null);
      setOverlay('orchestrator');
      return;
    }
    setOrchRole(null);
    setOverlay('none');
  }, [overlay, orchRole]);
  const handleToggleThinking = useCallback(() => router.toggleThinking(), [router]);
  const handleModelSelect = useCallback((modelId: string) => {
    if (orchRole) {
      if (modelId === 'auto') {
        notify('Escolha um modelo específico para o papel.', 'warning');
        setOverlay('orchestrator');
        return;
      }
      try {
        orchestratorStore.set(orchRole, modelId);
        setOrchAssignments(orchestratorStore.snapshot());
        notify(`${roleDefinition(orchRole).label}: ${modelId}`, 'success');
        setOrchRole(null);
        setOverlay('orchestrator');
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
        setOverlay('orchestrator');
      }
      return;
    }
    router.setModel(modelId);
    setOverlay('none');
  }, [router, notify, orchRole]);
  const handleOrchRoleSelect = useCallback((role: OrchestratorRole) => {
    setOrchRole(role);
    setOverlay('models');
  }, []);
  const handleOrchStart = useCallback(async (): Promise<void> => {
    const task = orchTask.trim();
    if (!task) {
      notify('Informe a tarefa: /orquestrator <tarefa>', 'warning');
      return;
    }
    setOverlay('none');
    setIsThinking(true);
    setLastCached(false);
    setAgentEvents([]);

    const liveTs = Date.now();
    const lines: string[] = [];
    const record = (line: string, replaceLast = false): void => {
      if (replaceLast && lines.length > 0) lines[lines.length - 1] = line;
      else lines.push(line);
      if (lines.length > 12) lines.splice(0, lines.length - 12);
      const content = lines.join('\n');
      setMessages(prev => {
        const index = prev.findIndex(
          message => message.timestamp === liveTs && message.role === 'system',
        );
        if (index === -1) {
          return [...prev, { role: 'system', content, timestamp: liveTs }];
        }
        const next = [...prev];
        next[index] = { ...next[index]!, content };
        return next;
      });
    };

    const api = createVaktorApi({
      complete: (messages, options) => router.complete(messages, options),
      workdir: router.getState().workdir,
    });

    try {
      const payload = buildOrchestrationPayload(orchestratorStore.snapshot(), task);
      record(`🚀 Orquestração dinâmica iniciada · líder ${payload.orchestration.leader.model}`);
      const result = await api.startOrchestration(payload, {
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
          record(event.message);
        },
      });
      if (!result.ok && result.error) record(`[erro] ${result.error}`);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.finalText || '(orquestração sem resultado final)',
        timestamp: Date.now(),
      }]);
      notify(
        result.ok ? 'Orquestração concluída' : 'Orquestração falhou',
        result.ok ? 'success' : 'warning',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record(`[orquestração] ${message}`);
      notify(message, 'error');
    } finally {
      setIsThinking(false);
    }
  }, [router, orchTask, notify]);
  const handleDirSelect = useCallback((path: string) => {
    router.setWorkdir(path);
    setOverlay('none');
  }, [router]);
  const handleSkillForce = useCallback((id: string) => {
    router.forceSkill(id);
    notify(`Skill forcada: ${id}`, 'info');
  }, [router, notify]);

  const overlayOpen = overlay !== 'none';
  const showMessages = overlay === 'none' || overlay === 'models' || overlay === 'credits' || overlay === 'skills' || overlay === 'orchestrator';

  // Dimensões lidas na hora: o valor do estado pode estar defasado se o
  // terminal foi redimensionado antes do listener. Um `width` maior que a
  // tela faz cada linha quebrar, o quadro cresce e o Ink passa a apagar
  // linhas erradas — é a origem do texto sobreposto.
  const cols = process.stdout.columns || termSize.cols || 120;
  const rows = process.stdout.rows || termSize.rows || 40;

  // Notificação e footer só entram com folga: em terminal muito baixo eles
  // competiriam com o prompt e o quadro estouraria a altura da raiz.
  const hasNotification = overlay !== 'directory' && rows >= 12 && notifications.length > 0;

  // Menu de comandos: filtrado e medido NO MESMO render em que o InputBar o
  // desenha. Reportar a altura depois (via effect) deixa um frame com o menu
  // já desenhado e a área de mensagens ainda no tamanho antigo — o quadro
  // passa da altura da raiz e o Ink corta o prompt pela metade.
  const menuOpen = prompt.startsWith('/') && !overlayOpen;
  const menuCommands = menuOpen ? filterCommands(prompt).slice(0, autocompleteCapacity(rows)) : [];
  const inputExtraLines = autocompleteExtraLines(menuCommands.length);

  // Reserva para os overlays: corresponde à altura natural de cada painel.
  // Painéis com flexGrow + overflow hidden se cortam sozinhos se a reserva
  // não couber — a reserva evita apenas que a lista de mensagens disput espaço.
  const overlayReserve = (overlay === 'models'
    ? Math.max(6, Math.min(18, rows - 16)) + 4
    : overlay === 'credits'
      ? (routerState.credits.usageHistory.length > 0 ? 20 : 13)
      : overlay === 'skills'
        ? 15
        : overlay === 'orchestrator'
          ? 11
          : 0) + (pendingConfirm ? confirmBoxLines(rows) : 0);
  const showFooter = overlay !== 'directory' && rows >= 12;
  const showInput = overlay !== 'directory' && overlay !== 'skills' && overlay !== 'orchestrator' && !pendingConfirm;
  const listLines = Math.max(
    0,
    messageAreaLines(rows, { hasNotification, showFooter, showInput, inputExtraLines }) - overlayReserve,
  );

  return (
    <Box flexDirection="column" height={Math.max(10, rows - SAFETY_LINES)} width={cols}>
      <MemoHeader state={routerState} cols={cols} />

      {showMessages && listLines > 0 && (
        <MemoMessageList
          messages={messages}
          maxLines={listLines}
          cols={cols}
          isThinking={isThinking}
          lastWasCached={lastWasCached}
          thinkingShow={routerState.thinkingShow}
          agentEvents={agentEvents}
          agentBusy={isThinking && routerState.appMode === 'code' && routerState.agentEnabled}
        />
      )}

      {overlay === 'models' && (
        <MemoModelMenu
          key="models-overlay"
          currentModelId={orchRole ? orchAssignments[orchRole] : routerState.activeModel}
          isAutoMode={orchRole ? false : routerState.isAutoMode}
          onSelect={handleModelSelect}
          onClose={handleEscape}
          rows={rows}
        />
      )}

      {overlay === 'orchestrator' && (
        <MemoOrchestratorMenu
          key="orchestrator-overlay"
          assignments={orchAssignments}
          taskPrompt={orchTask}
          onSelectRole={handleOrchRoleSelect}
          onStart={() => { void handleOrchStart(); }}
          onClose={handleEscape}
          rows={rows}
        />
      )}

      {overlay === 'credits' && (
        <MemoCreditsPanel stats={routerState.credits} />
      )}

      {overlay === 'skills' && (
        <MemoSkillsPanel
          skills={SKILLS}
          activeIds={routerState.activeSkills}
          forcedIds={routerState.forcedSkillIds}
          enabled={routerState.skillsEnabled}
          onForce={handleSkillForce}
          onClose={handleEscape}
        />
      )}

      {overlay === 'directory' && (
        <MemoDirectoryMenu
          workdir={routerState.workdir}
          onSelect={handleDirSelect}
          onClose={handleEscape}
        />
      )}

      {overlay !== 'directory' && rows >= 12 && (
        <MemoNotificationBar notifications={notifications} />
      )}

      {overlay !== 'directory' && showFooter && (
        <MemoFooter state={routerState} agentTools={TOOLS.length} verifyStatus={lastVerifyStatus} cols={cols} />
      )}

      {pendingConfirm && (
        <MemoConfirmWrite pending={pendingConfirm} onResolve={resolveWrite} rows={rows} />
      )}

      {showInput && (
        <MemoInputBar
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          onEscape={handleEscape}
          onToggleThinking={handleToggleThinking}
          isThinking={isThinking}
          overlayOpen={overlayOpen}
          menuCommands={menuCommands}
          menuOpen={menuOpen}
          cols={cols}
        />
      )}
    </Box>
  );
}
