import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentConfig,
  ChatMessage,
  CompleteOptions,
  RouterResponse,
  RouterConfig,
  RouterState,
  AppMode,
  ModelSelection,
} from '../types/index.js';
import { sanitizeMemoryText } from '../memory/index.js';
import { splitContextWindow, trimMessagesToBudget } from '../context/budget.js';
import { vaktorWorkspaceExists, vaktorWorkspacePaths } from '../orchestrator/workspace.js';
import { CreditManager } from './creditManager.js';
import { getCached, setCache, isTrivialPrompt } from './cache.js';
import { initPuter, loadPuterCatalog, puterDynamicEnabled } from '../providers/puter.js';
import { loadNumesCatalog, numesDynamicEnabled } from '../providers/numes.js';
import { loadQronosCatalog, qronosDynamicEnabled } from '../providers/qronos.js';
import { loadZroCatalog, zroDynamicEnabled } from '../providers/zro.js';
import { loadUnoRouterCatalog, unorouterDynamicEnabled } from '../providers/unorouter.js';
import {
  loadNightRouterCatalog,
  nightRouterDynamicEnabled,
} from '../providers/nightrouter.js';
import { geminiDynamicEnabled, loadGeminiCatalog } from '../providers/gemini.js';
import { loadNotionCatalog, notionDynamicEnabled } from '../providers/notion.js';
import { loadNotionWebCatalog, notionWebEnabled } from '../providers/notionWeb.js';
import { dispatchToProvider } from '../providers/adapter.js';
import {
  PROVIDER_ENV_KEYS,
  PROVIDER_LABELS,
  findModelOwner,
  ownerOf,
} from '../providers/registry.js';
import { freeModelChain, listFreeModels } from '../providers/catalog.js';
import {
  buildComboCandidates,
  comboLabel,
  describeCombo,
  isWakeableError,
  normalizeComboConfig,
  type ComboConfig,
  type ComboMember,
} from './combo.js';
import {
  RESOURCES_MARKER,
  buildResourcesBlock,
  loadResources,
} from '../resources/index.js';
import type { ProviderCallOpts } from '../providers/http.js';
import { runAgent, type AgentEvent } from '../agent/index.js';
import { refreshDynamicSkills, selectSkills, buildSkillsPrompt, stripSkillsBlock } from '../skills/index.js';
import { SECURITY_MARKER, buildSecurityBlock, loadSecurityProfile } from '../security/index.js';
import { withRuntimeContext } from '../context/runtime.js';
import {
  PLAN_MARKER,
  THINKING_MARKER,
  THINKING_REMINDER_MARKER,
  buildPlanBlock,
  buildReasoningParts,
  buildThinkingDirective,
  cacheVariant,
  clampBudget,
  extractThinking,
  finalizeThinking,
  prepareThinking,
  thinkingReminder,
  toThinkingOptions,
  upsertBlock,
  upsertBlockAtStart,
} from '../thinking/index.js';
import type {
  ProviderId,
  ThinkingConfig,
  ThinkingEffort,
  ThinkingMode,
  ThinkingOptions,
  ThinkingPlan,
} from '../thinking/index.js';

// Cadeia fixa de reserva. Os modelos grátis do catálogo entram na frente
// (ver getFallbackChain); esta lista só usa provedores confirmados na auditoria.
const FALLBACK_CHAIN = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'zro::deepseek-v4.1-flash',
  'glm-5.3-flash',
  'kilo-auto/free',
  'k-exaone-2.5:free',
];

// Provedores grátis confirmados na auditoria. Notion/Notion Web ficam
// de fora por dependerem de cookie; OpenCode/APInex/Requesty/FTA/Harbor/
// Qoder/DeepAI ficaram sem cota ou com erro de acesso.
const PREFERRED_FREE_PROVIDERS = new Set<ProviderId>([
  'qronos',
  'unorouter',
  'kilo',
]);

function providerHasCredential(provider: ProviderId): boolean {
  if (provider === 'notion_web') {
    return Boolean(process.env['NOTION_COOKIE'] || process.env['NOTION_TOKEN_V2']);
  }
  const prefix = PROVIDER_ENV_KEYS[provider];
  if (!prefix) return false;
  if (prefix === 'GROQ') {
    return Boolean(process.env['GROQ_API_KEY'] || process.env['PROXYGATELLM_API_KEY']);
  }
  if (prefix === 'NOTION') return Boolean(process.env['NOTION_API_KEY']);
  return Boolean(process.env[`${prefix}_API_KEY`] || process.env[prefix]);
}

// Modelos baratos para prompts triviais. `gpt-4o-mini` pertence ao Echo e
// hoje o upstream OpenAI do Echo está com credencial inválida; Haiku 4.5 é
// o modelo econômico que responde pela rota nativa da Anthropic.
const TRIVIAL_MODEL = 'kilo::kilo-auto/free';

// Modelos econômicos para compactar o histórico do chat. O primeiro com
// credencial disponível é usado; se todos falharem, cai no resumo local.
const CHAT_COMPACTION_MODELS = [
  'opencode::deepseek-v4.1-flash',
  'gemini::gemini-2.5-flash',
];
const CHAT_COMPACTION_MAX_TOKENS = 1200;
const CHAT_COMPACTION_SOURCE_CHARS = 16_000;

interface ExecutedPlan {
  response: RouterResponse;
  passes: number;
  planText?: string;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

interface ComboAttemptArgs {
  messages: ChatMessage[];
  bypassCache: boolean;
  useThinking: boolean;
  maxTokens: number;
  temperature: number | undefined;
  callOpts: ProviderCallOpts | undefined;
  lastUserMsg: string;
}

export class AIRouter {
  private config: RouterConfig;
  private creditManager: CreditManager;
  private state: RouterState;
  private thinkingCfg: ThinkingConfig;
  private onStateChange?: (state: RouterState) => void;
  private onNotification?: (message: string, type: 'info' | 'warning') => void;
  private onModelSwitch?: (fromModel: string, toModel: string, reason: string) => void;
  private warnings: string[];
  private comboSpentUsd = 0;

  constructor(config: RouterConfig) {
    this.config = config;
    this.creditManager = new CreditManager(config);
    this.thinkingCfg = { ...config.thinking };
    this.warnings = [...(config.warnings ?? [])];

    const initialModel =
      config.defaultModel === 'auto'
        ? this.pickAutoModel()
        : config.defaultModel;

    this.state = {
      activeModel: initialModel,
      isAutoMode: config.defaultModel === 'auto',
      isFallbackActive: false,
      appMode: 'chat',
      credits: this.creditManager.getStats(),
      thinkingEnabled: this.thinkingCfg.enabled,
      thinkingMode: this.thinkingCfg.mode,
      thinkingShow: this.thinkingCfg.show,
      ...(this.thinkingCfg.variant ? { thinkingVariant: this.thinkingCfg.variant } : {}),
      workdir: process.cwd(),
      activeSkills: [],
      skillsEnabled: config.enableSkills,
      forcedSkillIds: [],
      agentEnabled: config.agent.enabled,
      securityEnabled: config.agent.securityEnabled,
      comboActive: config.combo?.enabled === true,
    };
  }

  async init(puterApiKey: string | null): Promise<void> {
    if (puterApiKey) {
      await initPuter(puterApiKey);
      if (puterDynamicEnabled()) {
        const count = await loadPuterCatalog();
        if (count === 0) {
          this.warnings.push(
            'Puter: catálogo remoto indisponível; usando a lista curada de modelos.',
          );
        }
      }
    }

    const numesApiKey = process.env['NUMES_API_KEY']?.trim() ?? '';
    if (numesApiKey) {
      const count = await loadNumesCatalog(numesApiKey);
      if (count === 0 && numesDynamicEnabled()) {
        this.warnings.push(
          'Numes: catálogo remoto indisponível; usando a lista estática de modelos.',
        );
      }
    }

    const nightRouterApiKey = process.env['NIGHTROUTER_API_KEY']?.trim() ?? '';
    if (nightRouterApiKey) {
      const count = await loadNightRouterCatalog(nightRouterApiKey);
      if (count === 0 && nightRouterDynamicEnabled()) {
        this.warnings.push(
          'NightRouter: catálogo remoto indisponível; usando a lista estática de modelos.',
        );
      }
    }

    const qronosApiKey = process.env['QRONOS_API_KEY']?.trim() ?? '';
    if (qronosApiKey) {
      const count = await loadQronosCatalog(qronosApiKey);
      if (count === 0 && qronosDynamicEnabled()) {
        this.warnings.push(
          'Qronos AI: catálogo remoto indisponível; usando os modelos free conhecidos.',
        );
      }
    }

    const zroApiKey = process.env['ZRO_API_KEY']?.trim() ?? '';
    if (zroApiKey) {
      const count = await loadZroCatalog(zroApiKey);
      if (count === 0 && zroDynamicEnabled()) {
        this.warnings.push(
          'Zro: catálogo remoto indisponível; usando os 4 modelos oficiais.',
        );
      }
    }

    const unorouterApiKey = process.env['UNOROUTER_API_KEY']?.trim() ?? '';
    if (unorouterApiKey) {
      const count = await loadUnoRouterCatalog(unorouterApiKey);
      if (count === 0 && unorouterDynamicEnabled()) {
        this.warnings.push(
          'UnoRouter: catálogo remoto indisponível; usando os modelos free estáticos.',
        );
      }
    }

    const geminiApiKey = process.env['GEMINI_API_KEY']?.trim() ?? '';
    if (geminiApiKey) {
      const count = await loadGeminiCatalog(geminiApiKey);
      if (count === 0 && geminiDynamicEnabled()) {
        this.warnings.push(
          'Gemini: catálogo remoto indisponível; usando a lista estática de modelos.',
        );
      }
    }

    const notionApiKey = process.env['NOTION_API_KEY']?.trim() ?? '';
    if (notionApiKey) {
      const count = await loadNotionCatalog(notionApiKey);
      if (count === 0 && notionDynamicEnabled()) {
        this.warnings.push(
          'Notion AI: nenhum agente acessível; a API de agentes exige plano Business/Enterprise com "View sessions and interact with agents" e um Custom Agent compartilhado.',
        );
      }
    }

    if (notionWebEnabled()) {
      const count = await loadNotionWebCatalog();
      if (count === 0) {
        this.warnings.push(
          'Notion AI Web: não foi possível carregar o catálogo de modelos; verifique se o cookie está válido (Firefox logado ou NOTION_COOKIE/NOTION_TOKEN_V2) ou use NOTION_COOKIE_AUTO=false para silenciar.',
        );
      }
    }
  }

  setOnStateChange(cb: (state: RouterState) => void): void {
    this.onStateChange = cb;
  }

  setOnNotification(cb: (message: string, type: 'info' | 'warning') => void): void {
    this.onNotification = cb;
    for (const warning of this.warnings) {
      cb(warning, 'warning');
    }
    this.warnings = [];
  }

  setOnModelSwitch(cb: (fromModel: string, toModel: string, reason: string) => void): void {
    this.onModelSwitch = cb;
  }

  getState(): RouterState {
    return { ...this.state };
  }

  getThinkingConfig(): ThinkingConfig {
    return { ...this.thinkingCfg };
  }

  // === COMBO ===
  isComboActive(): boolean {
    return this.state.comboActive === true;
  }

  /**
   * Config efetiva do Combo. Sem membros definidos no .env, deriva dos
   * modelos grátis que o usuário realmente tem credencial (mesma preferência
   * do modo auto). A cadeia de fallback usa a lista global se não configurada.
   */
  getComboConfig(): ComboConfig {
    const normalized = normalizeComboConfig(this.config.combo);
    const chunks = normalized.members.length > 0
      ? normalized.members
      : this.defaultComboMembers();
    const fallback = normalized.fallback.length > 0
      ? normalized.fallback
      : this.getFallbackChain();
    return { ...normalized, members: chunks, fallback };
  }

  getComboDescription(): string {
    return describeCombo(this.getComboConfig());
  }

  getComboLabel(): string {
    return comboLabel(this.getComboConfig());
  }

  setComboEnabled(on: boolean): void {
    const current = this.getComboConfig();
    this.config = { ...this.config, combo: { ...current, enabled: on } };
    this.state = { ...this.state, comboActive: on };
    this.onStateChange?.(this.getState());
  }

  setComboMembers(members: ComboMember[]): void {
    const current = this.getComboConfig();
    const next = normalizeComboConfig({ ...current, enabled: true, members });
    this.config = { ...this.config, combo: next };
    this.state = { ...this.state, comboActive: true };
    this.onStateChange?.(this.getState());
  }

  private defaultComboMembers(): ComboMember[] {
    const usable = listFreeModels().filter(model => providerHasCredential(model.provider));
    const preferred = usable.filter(model => PREFERRED_FREE_PROVIDERS.has(model.provider));
    const pool = (preferred.length > 0 ? preferred : usable).slice(0, 4);
    const members: ComboMember[] = pool.map(model => ({ model: model.qualifiedId, weight: 1 }));
    if (members.length === 0) {
      members.push(
        { model: 'nvidia::nvidia/nemotron-3.5-lightning-30b-a3b', weight: 2 },
        { model: 'zro::deepseek-v4.1-flash', weight: 1 },
      );
    }
    return members;
  }

  setMode(mode: AppMode): void {
    this.state = { ...this.state, appMode: mode };
    this.onStateChange?.(this.getState());
  }

  setWorkdir(path: string): void {
    this.state = { ...this.state, workdir: path };
    this.onStateChange?.(this.getState());
  }

  setThinkingMode(mode: ThinkingMode): void {
    this.thinkingCfg = { ...this.thinkingCfg, mode };
    this.state = {
      ...this.state,
      thinkingMode: mode,
      thinkingEnabled: mode !== 'off',
    };
    this.onStateChange?.(this.getState());
  }

  setThinkingBudget(n: number): void {
    this.thinkingCfg = { ...this.thinkingCfg, budgetTokens: clampBudget(n) };
    this.onStateChange?.(this.getState());
  }

  setThinkingShow(on: boolean): void {
    this.thinkingCfg = { ...this.thinkingCfg, show: on };
    this.state = { ...this.state, thinkingShow: on };
    this.onStateChange?.(this.getState());
  }

  setThinkingVariant(variant: ThinkingEffort | undefined): void {
    const nextCfg: ThinkingConfig = { ...this.thinkingCfg };
    if (variant) nextCfg.variant = variant;
    else delete nextCfg.variant;
    this.thinkingCfg = nextCfg;

    const nextState = { ...this.state };
    if (variant) nextState.thinkingVariant = variant;
    else delete nextState.thinkingVariant;
    this.state = nextState;
    this.onStateChange?.(this.getState());
  }

  toggleThinking(): void {
    const on = this.state.thinkingEnabled && this.state.thinkingMode !== 'off';
    this.setThinkingMode(on ? 'off' : 'auto');
  }

  setSkillsEnabled(on: boolean): void {
    this.state = { ...this.state, skillsEnabled: on };
    this.onStateChange?.(this.getState());
  }

  forceSkill(id: string | null): void {
    this.state = { ...this.state, forcedSkillIds: id ? [id] : [] };
    this.onStateChange?.(this.getState());
  }

  getAgentConfig(): AgentConfig {
    return {
      ...this.config.agent,
      allowedCommands: this.config.agent.allowedCommands.map(command => ({
        label: command.label,
        bin: command.bin,
        args: [...command.args],
      })),
    };
  }

  setAgentEnabled(on: boolean): void {
    this.config = { ...this.config, agent: { ...this.config.agent, enabled: on } };
    this.state = { ...this.state, agentEnabled: on };
    this.onStateChange?.(this.getState());
  }

  setAgentMaxIterations(value: number): void {
    const maxIterations = Math.max(1, Math.min(20, Math.floor(value)));
    this.config = { ...this.config, agent: { ...this.config.agent, maxIterations } };
    this.onStateChange?.(this.getState());
  }

  setSecurityEnabled(on: boolean): void {
    this.config = { ...this.config, agent: { ...this.config.agent, securityEnabled: on } };
    this.state = { ...this.state, securityEnabled: on };
    this.onStateChange?.(this.getState());
  }

  isOverBudget(): boolean {
    return this.creditManager.isOverBudget();
  }

  // Estimativa conservadora usada antes do Best-of-N e pelo Combo.
  estimateCost(messages: ChatMessage[]): number {
    return this.estimateCostFor(this.state.activeModel, messages);
  }

  private estimateCostFor(model: string, messages: ChatMessage[]): number {
    const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
    const inputTokens = Math.ceil(chars / 4);
    const outputTokens = this.config.maxTokensPerRequest;
    const costs = this.getModelCosts(model);
    return (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
  }

  setModel(modelId: ModelSelection): void {
    if (modelId === 'auto') {
      this.state = {
        ...this.state,
        isAutoMode: true,
        activeModel: this.pickAutoModel(),
        isFallbackActive: false,
      };
    } else {
      // Escolher um modelo fixo desliga o Combo: rotação só quando o usuário
      // pede por ela (evita troca silenciosa de modelo).
      if (this.state.comboActive) {
        this.config = { ...this.config, combo: { ...this.getComboConfig(), enabled: false } };
      }
      this.state = {
        ...this.state,
        isAutoMode: false,
        activeModel: modelId,
        isFallbackActive: false,
        comboActive: false,
      };
    }
    this.onStateChange?.(this.getState());
  }

  // Trunca o contexto se estiver muito longo, preservando TODOS os blocos
  // de sistema (regras, segurança, resumo de sessão).
  private truncateContext(messages: ChatMessage[]): ChatMessage[] {
    const max = Math.max(1, Math.floor(this.config.maxContextMessages));
    const systems = messages.filter(message => message.role === 'system');
    const conversation = messages.filter(message => message.role !== 'system');
    const keep = Math.max(1, max - systems.length);
    if (conversation.length <= keep) return [...systems, ...conversation];
    return [...systems, ...conversation.slice(-keep)];
  }

  /**
   * Controlador de janela do chat: 40% para resumo/base da sessão e 60%
   * para a execução ativa. Quando o histórico antigo passa do limite de
   * sessão, compacta via modelo econômico e grava snapshot em .vaktor/memoria/.
   */
  private async prepareChatContext(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const split = splitContextWindow(messages, this.config.contextBudgetTokens);
    const active = trimMessagesToBudget(split.active, split.activeBudgetTokens);
    const shouldCompact =
      split.session.length > 0 && split.sessionTokens > split.sessionBudgetTokens;

    if (!shouldCompact) {
      return [...split.system, ...split.session, ...active];
    }

    const summary = await this.summarizeChatSession(split.session);
    const summaryChars = Math.max(1000, split.sessionBudgetTokens * 4);
    const safeSummary = sanitizeMemoryText(summary, summaryChars).trim();
    const snapshotSaved = this.writeChatSnapshot(split.session, safeSummary, split);
    this.onNotification?.(
      snapshotSaved
        ? 'Contexto antigo compactado em .vaktor/memoria/sessions.'
        : 'Contexto antigo compactado.',
      'info',
    );

    const summaryMessage: ChatMessage = {
      role: 'system',
      content: `## Resumo da sessão (contexto base)\n${safeSummary || '(sem resumo)'}`,
      timestamp: Date.now(),
    };
    return [...split.system, summaryMessage, ...active];
  }

  private chatTranscript(session: readonly ChatMessage[], maxChars: number): string {
    const parts: string[] = [];
    let used = 0;
    for (let index = session.length - 1; index >= 0; index -= 1) {
      const message = session[index]!;
      const remaining = maxChars - used;
      if (remaining <= 0) break;
      const prefix = `${message.role.toUpperCase()}: `;
      const contentBudget = Math.max(0, remaining - prefix.length);
      const content =
        message.content.length > contentBudget
          ? message.content.slice(message.content.length - contentBudget)
          : message.content;
      const part = `${prefix}${content}`;
      parts.push(part);
      used += part.length + 2;
    }
    return parts.reverse().join('\n\n');
  }

  private async summarizeChatSession(session: readonly ChatMessage[]): Promise<string> {
    const transcript = this.chatTranscript(session, CHAT_COMPACTION_SOURCE_CHARS);

    for (const model of CHAT_COMPACTION_MODELS) {
      const provider = ownerOf(model);
      if (!providerHasCredential(provider)) continue;
      try {
        const completion = await this.complete(
          [
            {
              role: 'system',
              content:
                'Você compacta histórico técnico. Preserve decisões, arquivos, erros e pendências. ' +
                'Seja objetivo e não invente informação.',
              timestamp: Date.now(),
            },
            {
              role: 'user',
              content:
                'Resuma o histórico abaixo em no máximo 1200 tokens, mantendo o que ainda importa ' +
                `para continuar a conversa.\n\n${transcript}`,
              timestamp: Date.now(),
            },
          ],
          {
            model,
            provider,
            agentMode: false,
            bypassCache: true,
            thinking: false,
            maxTokens: CHAT_COMPACTION_MAX_TOKENS,
          },
        );
        const text = completion.text.trim();
        if (text) return text;
      } catch {
        // Tenta o próximo modelo econômico; o resumo local é a última linha.
      }
    }

    return this.localChatSummary(session);
  }

  private localChatSummary(session: readonly ChatMessage[]): string {
    const maxChars = Math.max(1000, Math.floor(this.config.contextBudgetTokens * 0.4 * 4));
    return session
      .map(message => `${message.role}: ${message.content.replace(/\s+/g, ' ').trim().slice(0, 240)}`)
      .slice(-24)
      .join('\n')
      .slice(0, maxChars);
  }

  private writeChatSnapshot(
    session: readonly ChatMessage[],
    summary: string,
    split: ReturnType<typeof splitContextWindow>,
  ): boolean {
    if (!vaktorWorkspaceExists(this.state.workdir)) return false;
    try {
      const dir = vaktorWorkspacePaths(this.state.workdir).sessionsDir;
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const body = [
        `# Compactação de contexto ${stamp}`,
        '',
        `- Workdir: ${this.state.workdir}`,
        `- Modelo ativo: ${this.state.activeModel}`,
        `- Orçamento: ${this.config.contextBudgetTokens} tokens (40% sessão / 60% ativa)`,
        `- Sessão antiga: ${split.sessionTokens} tokens (limite ${split.sessionBudgetTokens})`,
        '',
        '## Resumo',
        summary || '(sem resumo)',
        '',
        '## Histórico compactado',
        ...session.map(message => [
          `### ${message.role}`,
          sanitizeMemoryText(message.content, 4000),
        ].join('\n')),
        '',
      ].join('\n');
      writeFileSync(join(dir, `chat-${stamp}.md`), body, 'utf8');
      return true;
    } catch {
      // Snapshot é best-effort; a conversa continua mesmo se o disco falhar.
      return false;
    }
  }

  // Injeta as skills selecionadas como mensagem de sistema
  private applySkills(messages: ChatMessage[], input: string): ChatMessage[] {
    if (!this.config.enableSkills || !this.state.skillsEnabled) return messages;
    refreshDynamicSkills(this.state.workdir);

    const ctx = {
      mode: this.state.appMode,
      workdir: this.state.workdir,
      forcedSkillIds: this.state.forcedSkillIds,
    };

    const matches = selectSkills(input, ctx, { maxSkills: this.config.skillsMaxPerRequest });
    const block = buildSkillsPrompt(matches, ctx, { maxChars: this.config.skillsMaxPromptChars });
    if (!block) return messages;

    // Registra as skills usadas e consome as forçadas
    this.state = {
      ...this.state,
      activeSkills: matches.map(m => m.skill.id),
      forcedSkillIds: [],
    };
    this.onStateChange?.(this.getState());

    const sysIdx = messages.findIndex(m => m.role === 'system');
    if (sysIdx === -1) {
      return [{ role: 'system', content: block, timestamp: Date.now() }, ...messages];
    }

    // Já existe system: concatena sem duplicar um bloco anterior
    return messages.map((m, i) =>
      i === sysIdx
        ? { ...m, content: `${stripSkillsBlock(m.content)}\n\n${block}`.trim() }
        : m
    );
  }

  // Insere/atualiza o perfil de segurança (SECURITY.md) no system prompt do chat.
  private applySecurityProfile(messages: ChatMessage[]): ChatMessage[] {
    const cfg = this.config.agent;
    if (!cfg.securityEnabled) return messages;
    const profile = loadSecurityProfile(this.state.workdir, undefined, cfg.securityFile);
    const block = buildSecurityBlock(profile);
    if (!block) return messages;
    return this.appendSystemBlock(messages, block, SECURITY_MARKER);
  }

  // Insere/atualiza o contexto do usuário (RESOURCES.md) no system prompt.
  // Vale para qualquer modelo que o roteador escolher.
  private applyResourcesProfile(messages: ChatMessage[]): ChatMessage[] {
    if (this.config.resourcesEnabled === false) return messages;
    const content = loadResources(
      this.state.workdir,
      2500,
      this.config.resourcesFile ?? 'RESOURCES.md',
    );
    const block = buildResourcesBlock(content);
    if (!block) return messages;
    return this.appendSystemBlock(messages, block, RESOURCES_MARKER);
  }

  // Insere/atualiza um bloco no system prompt sem tocar nos outros blocos
  private appendSystemBlock(messages: ChatMessage[], block: string, marker: string): ChatMessage[] {
    const idx = messages.findIndex(m => m.role === 'system');
    if (idx === -1) {
      return [{ role: 'system', content: block, timestamp: Date.now() }, ...messages];
    }
    return messages.map((m, i) =>
      i === idx ? { ...m, content: upsertBlock(m.content, block, marker) } : m
    );
  }

  // Insere/atualiza um bloco no início do system prompt
  private prependSystemBlock(messages: ChatMessage[], block: string, marker: string): ChatMessage[] {
    const idx = messages.findIndex(m => m.role === 'system');
    if (idx === -1) {
      return [{ role: 'system', content: block, timestamp: Date.now() }, ...messages];
    }
    return messages.map((m, i) =>
      i === idx ? { ...m, content: upsertBlockAtStart(m.content, block, marker) } : m
    );
  }

  // Diretiva no início + lembrete no fim: necessários para modelos menores obedecerem
  private withThinkingBlock(messages: ChatMessage[], directive: string): ChatMessage[] {
    const withDirective = this.prependSystemBlock(messages, directive, THINKING_MARKER);
    return this.appendSystemBlock(withDirective, thinkingReminder(), THINKING_REMINDER_MARKER);
  }

  // Escolha determinística do modo auto: prioriza modelos grátis que o
  // usuário realmente tem credencial, depois cai no NVIDIA confirmado.
  private pickAutoModel(): string {
    if (this.config.preferFreeModels !== false) {
      const usable = listFreeModels().filter(model => providerHasCredential(model.provider));
      const preferred = usable.filter(model => PREFERRED_FREE_PROVIDERS.has(model.provider));
      const pool = preferred.length > 0 ? preferred : usable;
      if (pool.length > 0) return pool[0]!.qualifiedId;
    }
    return 'nvidia::nvidia/nemotron-3.5-lightning-30b-a3b';
  }

  // Seleciona o modelo ideal baseado no estado atual
  private selectModel(inputText: string): string {
    // Prompt trivial → modelo barato (apenas no modo auto)
    if (this.state.isAutoMode && isTrivialPrompt(inputText)) {
      return TRIVIAL_MODEL;
    }

    // Fallback ativo → usa o fallback
    if (this.state.isFallbackActive) {
      return this.config.fallbackModel;
    }

    return this.state.activeModel;
  }

  // Cadeia de fallback: grátis primeiro, depois a lista fixa.
  private getFallbackChain(): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    for (const id of [...freeModelChain(8), ...FALLBACK_CHAIN]) {
      if (seen.has(id)) continue;
      seen.add(id);
      chain.push(id);
    }
    return chain;
  }

  // Tenta o próximo modelo da chain de fallback
  private getFallbackModel(currentModel: string): string | null {
    const chain = this.getFallbackChain();
    const idx = chain.indexOf(currentModel);
    if (idx === -1) return chain.find(id => id !== currentModel) ?? null;
    return chain[idx + 1] ?? null;
  }

  private getProviderId(model: string): ProviderId {
    return ownerOf(model);
  }

  private isThinkingParamError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /\b(400|422)\b/.test(msg) &&
      /budget_tokens|reasoning_effort|reasoning|thinking/i.test(msg);
  }

  // Ponto único de chamada aos provedores (delegado ao adapter unificado)
  private async dispatch(
    model: string,
    messages: ChatMessage[],
    thinking: ThinkingOptions | undefined,
    maxTokens?: number,
    temperature?: number,
    callOpts?: ProviderCallOpts,
    providerOverride?: ProviderId,
  ): Promise<RouterResponse> {
    return dispatchToProvider({
      model,
      messages,
      thinking,
      maxTokens: maxTokens ?? this.config.maxTokensPerRequest,
      temperature,
      ...(providerOverride ? { providerOverride } : {}),
      opts: callOpts,
      onNotice: notice => this.onNotification?.(notice, 'info'),
    });
  }

  // Executa o plano de thinking (um ou dois passes), com retry de parâmetro
  private async executePlan(
    model: string,
    withSkills: ChatMessage[],
    planMessages: ChatMessage[],
    plan: ThinkingPlan,
    maxTokens: number,
    temperature?: number,
    callOpts?: ProviderCallOpts,
    providerOverride?: ProviderId,
  ): Promise<ExecutedPlan> {
    const opts = toThinkingOptions(plan);

    if (plan.strategy === 'two-pass') {
      try {
        // O passe 1 é só o plano: não precisa do orçamento inteiro de raciocínio
        const pass1Max = Math.max(
          512,
          Math.min(plan.budgetTokens, Math.floor(this.config.maxTokensPerRequest / 2)),
        );
        // Pass 1 só propaga o cancelamento (sem streaming: senão a UI veria
        // o plano sendo gerado como se fosse a resposta final).
        const pass1 = await this.dispatch(
          model, planMessages, undefined, pass1Max, temperature,
          callOpts ? { signal: callOpts.signal } : undefined,
          providerOverride,
        );
        const planBody = extractThinking(pass1.text).answer;
        const pass2Messages = this.appendSystemBlock(withSkills, buildPlanBlock(planBody), PLAN_MARKER);
        const pass2 = await this.dispatch(
          model, pass2Messages, undefined, maxTokens, temperature, callOpts, providerOverride,
        );

        return {
          response: {
            ...pass2,
            inputTokens: pass1.inputTokens + pass2.inputTokens,
            outputTokens: pass1.outputTokens + pass2.outputTokens,
            estimatedCostUsd: pass1.estimatedCostUsd + pass2.estimatedCostUsd,
          },
          passes: 2,
          planText: planBody,
        };
      } catch {
        // Passe 1 falhou: cai para scratchpad (uma chamada)
        this.onNotification?.('Two-pass indisponível; usando scratchpad', 'warning');
        const directive = buildThinkingDirective('scratchpad', plan.complexity, this.thinkingCfg.mode);
        const retryMessages = this.withThinkingBlock(withSkills, directive);
        const response = await this.dispatch(
          model, retryMessages, undefined, maxTokens, temperature, callOpts, providerOverride,
        );
        return { response, passes: 1 };
      }
    }

    try {
      const response = await this.dispatch(
        model, planMessages, opts, maxTokens, temperature, callOpts, providerOverride,
      );
      return { response, passes: 1 };
    } catch (err) {
      if (!opts || !this.isThinkingParamError(err)) throw err;

      // Parâmetro de thinking recusado: repete UMA vez sem ele
      this.onNotification?.('Thinking nativo indisponível neste modelo; usando scratchpad', 'warning');
      const directive = buildThinkingDirective('scratchpad', plan.complexity, this.thinkingCfg.mode);
      const retryMessages = this.withThinkingBlock(withSkills, directive);
      const response = await this.dispatch(
        model, retryMessages, undefined, maxTokens, temperature, callOpts, providerOverride,
      );
      return { response, passes: 1 };
    }
  }

  private finalizeResult(
    result: ExecutedPlan,
    plan: ThinkingPlan,
    streamed?: { text?: string; startedAt?: number },
  ): RouterResponse {
    const streamedText = streamed?.text?.trim() ?? '';
    const nativeReasoning = result.planText ?? (streamedText || result.response.reasoning);
    const out = finalizeThinking(
      result.response.text,
      nativeReasoning,
      plan,
      this.thinkingCfg.show,
    );

    const parts = out.reasoning
      ? buildReasoningParts(out.reasoning, {
          ...(streamed?.startedAt ? { startedAt: streamed.startedAt } : {}),
        })
      : [];

    // Monta explicitamente para não vazar `reasoning` do provedor quando show=false
    return {
      text: out.answer,
      model: result.response.model,
      inputTokens: result.response.inputTokens,
      outputTokens: result.response.outputTokens,
      fromCache: result.response.fromCache,
      estimatedCostUsd: result.response.estimatedCostUsd,
      ...(out.reasoning ? { reasoning: out.reasoning } : {}),
      ...(parts.length > 0 ? { reasoningParts: parts } : {}),
      ...(result.response.reasoningTokens !== undefined
        ? { reasoningTokens: result.response.reasoningTokens }
        : {}),
      ...(result.passes === 2 ? { passes: 2 } : {}),
    };
  }

  async send(
    messages: ChatMessage[],
    skipCache = false,
    streaming: Pick<CompleteOptions, 'signal' | 'onToken' | 'onReasoningToken'> = {},
  ): Promise<RouterResponse> {
    const agentMode = this.state.appMode === 'code' && this.config.agent.enabled;
    const budgeted = agentMode ? messages : await this.prepareChatContext(messages);
    const truncated = this.truncateContext(budgeted);
    const lastUserMsg = [...truncated].reverse().find(m => m.role === 'user')?.content ?? '';
    const withSkills = this.applySkills(truncated, lastUserMsg);
    const withResources = this.applyResourcesProfile(withSkills);
    const withSecurity = this.applySecurityProfile(withResources);
    return this.complete(withSecurity, { bypassCache: skipCache, ...streaming });
  }

  /**
   * Ponto único de chamada aos provedores. NÃO aplica skills nem truncamento:
   * `send()` faz isso antes de chamar. O agente monta o próprio system prompt
   * e chama `complete()` com bypassCache e thinking desligado.
   */
  async complete(
    incoming: ChatMessage[],
    options: CompleteOptions = {},
  ): Promise<RouterResponse> {
    // === MODO AGENTE ===
    // `agentMode` explícito vence o estado global (o orquestrador usa isso
    // para rodar líder/workers mesmo quando a UI está em modo chat).
    const agentMode = options.agentMode
      ?? (this.state.appMode === 'code' && this.config.agent.enabled);
    if (agentMode) {
      const lastUserMsg = [...incoming].reverse().find(m => m.role === 'user')?.content ?? '';
      if (!lastUserMsg.trim()) {
        return {
          text: '(sem mensagem do usuário para o agente)',
          model: this.state.activeModel,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          fromCache: false,
        };
      }

      const requestedModel = options.modelOverride ?? options.model ?? this.state.activeModel;
      const requestedProvider = options.providerOverride ?? options.provider
        ?? this.getProviderId(requestedModel);
      const systemPrompt = options.systemPromptOverride ?? options.systemPrompt;

      try {
        const agentResult = await runAgent(
          lastUserMsg,
          incoming.filter(m => m.role !== 'user'),
          (messages, opts) => {
            // Chat-only: evita recursão no agente sem mutar o estado global,
            // que é compartilhado por workers paralelos.
            return this.complete(messages, { ...opts, agentMode: false });
          },
          {
            workdir: this.state.workdir,
            maxIterations: options.maxIterations ?? this.config.agent.maxIterations,
            maxToolCalls: options.maxToolCalls ?? this.config.agent.maxToolCalls,
            maxFileBytes: this.config.agent.maxFileBytes,
            maxOutputChars: this.config.agent.maxOutputChars,
            commandTimeoutMs: this.config.agent.commandTimeoutMs,
            allowedCommands: this.config.agent.allowedCommands,
            allowWrite: options.allowWrite ?? this.config.agent.allowWrite,
            autoApprove: this.config.agent.autoApprove,
            allowNetwork: this.config.agent.allowNetwork,
            allowInstall: this.config.agent.allowInstall,
            allowGitWrite: this.config.agent.allowGitWrite,
            allowedDomains: this.config.agent.allowedDomains,
            verify: options.verify ?? this.config.agent.verifyEnabled,
            verifyMaxAttempts: this.config.agent.verifyMaxAttempts,
            context: {
              inject: this.config.agent.contextInject,
              maxChars: this.config.agent.contextMaxChars,
            },
            memoryFile: this.config.agent.memoryFile,
            securityEnabled: this.config.agent.securityEnabled,
            securityFile: this.config.agent.securityFile,
            resourcesEnabled: this.config.resourcesEnabled !== false,
            resourcesFile: this.config.resourcesFile ?? 'RESOURCES.md',
            mcpEnabled: this.config.agent.mcpEnabled,
            mcpClient: undefined, // MCP seria passado pela TUI se necessário
            model: requestedModel,
            provider: requestedProvider,
            ...(systemPrompt ? { systemPrompt } : {}),
            ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
            ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.onToken ? { onToken: options.onToken } : {}),
            onEvent: (event: AgentEvent) => {
              if (event.type === 'tool_end') {
                this.onNotification?.(
                  `✓ ${event.name}: ${event.preview?.slice(0, 100) || 'ok'}`,
                  'info'
                );
              } else if (event.type === 'error') {
                this.onNotification?.(event.message, 'warning');
              }
            },
            ...(options.confirmFn ? { onConfirm: options.confirmFn } : {}),
          },
        );

        this.creditManager.record({
          model: agentResult.model || requestedModel,
          inputTokens: agentResult.usage.inputTokens,
          outputTokens: agentResult.usage.outputTokens,
          estimatedCostUsd: agentResult.usage.costUsd,
          fromCache: false,
        });
        this.updateCreditsInState();

        return {
          text: agentResult.text,
          model: agentResult.model || requestedModel,
          inputTokens: agentResult.usage.inputTokens,
          outputTokens: agentResult.usage.outputTokens,
          estimatedCostUsd: agentResult.usage.costUsd,
          fromCache: false,
          agent: {
            ok: agentResult.ok,
            iterations: agentResult.iterations,
            toolCalls: agentResult.toolCalls,
            modifiedFiles: agentResult.modifiedFiles,
            commands: agentResult.commands,
            tools: agentResult.tools.map(trace => ({
              name: trace.name,
              args: trace.args,
              ok: trace.ok,
            })),
            verify: {
              ran: agentResult.verify.ran,
              ok: agentResult.verify.ok,
              attempts: agentResult.verify.attempts,
              ...(agentResult.verify.command ? { command: agentResult.verify.command } : {}),
            },
            ...(agentResult.diff ? { diff: agentResult.diff } : {}),
            ...(agentResult.error ? { error: agentResult.error } : {}),
          },
        };
      } catch (err) {
        // Erros de API sobem para o chamador (orquestrador) decidir fallback.
        throw err;
      }
    }

    // === MODE CHAT: NORMAL LLM ===
    const messages = this.config.runtimeContext
      ? withRuntimeContext(incoming, new Date(), this.state.workdir)
      : incoming;
    const bypassCache = options.bypassCache === true;
    const useThinking = options.thinking ?? this.state.thinkingEnabled;
    const maxTokens = options.maxTokens ?? this.config.maxTokensPerRequest;
    const temperature = options.temperature;
    const modelOverride = options.modelOverride ?? options.model;
    const providerOverride = options.providerOverride ?? options.provider;

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const modelToUse = modelOverride ?? this.selectModel(lastUserMsg);
    const initialModel = modelOverride ?? this.state.activeModel;

    // Acumula o raciocínio que chega em streaming para montar as partes.
    let streamedReasoning = '';
    let streamedReasoningStart: number | undefined;
    const forwardReasoning = options.onReasoningToken;
    const onReasoningToken = (chunk: string): void => {
      if (streamedReasoning.length === 0) streamedReasoningStart = Date.now();
      streamedReasoning += chunk;
      if (this.thinkingCfg.show) forwardReasoning?.(chunk);
    };

    // Cancelamento/streaming vindos da UI, repassados ao adapter de provedor
    const callOpts: ProviderCallOpts | undefined =
      options.signal || options.onToken || options.onReasoningToken
        ? {
            signal: options.signal,
            onToken: options.onToken,
            onReasoningToken,
          }
        : undefined;

    // Combo: roteamento ponderado com fallback e teto duro de créditos.
    // Um modelo escolhido explicitamente (override) sempre tem prioridade.
    if (this.state.comboActive === true && !modelOverride && !providerOverride) {
      return this.completeCombo({
        messages,
        bypassCache,
        useThinking,
        maxTokens,
        temperature,
        callOpts,
        lastUserMsg,
      });
    }

    // Plano inicial (antes de eventual troca por orçamento) para consultar o cache
    const initialPlan = prepareThinking(
      lastUserMsg,
      initialModel,
      providerOverride ?? this.getProviderId(initialModel),
      this.thinkingCfg,
      useThinking,
      isTrivialPrompt,
    );
    const initialMessages = initialPlan.directive
      ? this.withThinkingBlock(messages, initialPlan.directive)
      : messages;
    const initialVariant = cacheVariant(initialPlan);

    // Verifica cache antes de enviar
    if (!bypassCache && this.config.enableCache) {
      const cached = getCached(initialMessages, modelToUse, initialVariant);
      if (cached) {
        this.creditManager.record({
          model: modelToUse,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          fromCache: true,
        });
        this.updateCreditsInState();
        return cached;
      }
    }

    // Verifica orçamento antes de enviar. Por padrão NÃO troca de modelo
    // sozinho: avisa e para, para o usuário decidir (evita rotação silenciosa).
    if (this.creditManager.isOverBudget()) {
      if (modelOverride) {
        throw new Error('Credit budget exhausted (model override).');
      }
      if (this.config.autoFallback === true && this.state.isAutoMode) {
        const fallback = this.getFallbackModel(this.state.activeModel);
        if (fallback) {
          const oldModel = this.state.activeModel;
          this.onNotification?.(
            `Credit limit reached. Switching to ${this.getModelName(fallback)}`,
            'warning'
          );
          this.onModelSwitch?.(oldModel, fallback, 'Credit budget reached');
          this.state = {
            ...this.state,
            activeModel: fallback,
            isFallbackActive: true,
          };
          this.onStateChange?.(this.getState());
        } else {
          throw new Error(
            'Credit budget exhausted and no fallback models available.\n' +
            'Increase the limit in CREDIT_BUDGET_USD in your .env or use /credits to see consumption.'
          );
        }
      } else {
        throw new Error(
          'Credit budget exhausted.\n' +
          'Aumente CREDIT_BUDGET_USD no .env (ou use um modelo grátis com /models) e tente de novo. ' +
          'Use /credits para ver o consumo.'
        );
      }
    }

    const finalModel = modelOverride ?? this.state.activeModel;
    const plan = prepareThinking(
      lastUserMsg,
      finalModel,
      providerOverride ?? this.getProviderId(finalModel),
      this.thinkingCfg,
      useThinking,
      isTrivialPrompt,
    );
    const planMessages = plan.directive
      ? this.withThinkingBlock(messages, plan.directive)
      : messages;
    const variant = cacheVariant(plan);

    try {
      const result = await this.executePlan(
        finalModel, messages, planMessages, plan, maxTokens, temperature, callOpts, providerOverride,
      );
      const final = this.finalizeResult(result, plan, {
        text: streamedReasoning,
        ...(streamedReasoningStart ? { startedAt: streamedReasoningStart } : {}),
      });

      // Registra uso
      this.creditManager.record({
        model: finalModel,
        inputTokens: final.inputTokens,
        outputTokens: final.outputTokens,
        estimatedCostUsd: final.estimatedCostUsd,
        fromCache: false,
      });

      // Armazena no cache
      if (!bypassCache && this.config.enableCache) {
        setCache(planMessages, finalModel, final, variant);
      }

      this.updateCreditsInState();

      // Verifica se após a resposta o orçamento foi atingido e notifica.
      // Só troca de modelo quando o fallback automático está habilitado.
      if (
        this.config.autoFallback === true &&
        !modelOverride &&
        this.creditManager.isOverBudget() &&
        !this.state.isFallbackActive
      ) {
        const fallback = this.getFallbackModel(finalModel);
        if (fallback) {
          this.onNotification?.(
            `Next messages will use ${this.getModelName(fallback)} (limit reached)`,
            'info'
          );
          this.onModelSwitch?.(finalModel, fallback, 'Credit budget reached during response');
          this.state = {
            ...this.state,
            activeModel: fallback,
            isFallbackActive: true,
          };
          this.onStateChange?.(this.getState());
        }
      }

      return final;
    } catch (error) {
      if (modelOverride) throw error;

      // Se falhou com o modelo atual, tenta o próximo da chain — somente
      // quando o fallback automático estiver explicitamente habilitado.
      const fallback = this.getFallbackModel(finalModel);
      if (fallback && this.config.autoFallback === true && this.state.isAutoMode) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.onNotification?.(
          `Error with ${this.getModelName(finalModel)}. Trying ${this.getModelName(fallback)}...`,
          'warning'
        );
        this.onModelSwitch?.(finalModel, fallback, `API error: ${errorMsg}`);
        this.state = { ...this.state, activeModel: fallback, isFallbackActive: true };
        this.onStateChange?.(this.getState());

        // Descarta reasoning parcial do modelo que falhou.
        streamedReasoning = '';
        streamedReasoningStart = undefined;

        // Refaz o plano para o modelo de fallback
        const fbPlan = prepareThinking(
          lastUserMsg,
          fallback,
          this.getProviderId(fallback),
          this.thinkingCfg,
          useThinking,
          isTrivialPrompt,
        );
        const fbMessages = fbPlan.directive
          ? this.withThinkingBlock(messages, fbPlan.directive)
          : messages;

        const fbResult = await this.executePlan(
          fallback, messages, fbMessages, fbPlan, maxTokens, temperature, callOpts,
        );
        const fbFinal = this.finalizeResult(fbResult, fbPlan, {
          text: streamedReasoning,
          ...(streamedReasoningStart ? { startedAt: streamedReasoningStart } : {}),
        });

        this.creditManager.record({
          model: fallback,
          inputTokens: fbFinal.inputTokens,
          outputTokens: fbFinal.outputTokens,
          estimatedCostUsd: fbFinal.estimatedCostUsd,
          fromCache: false,
        });

        if (!bypassCache && this.config.enableCache) {
          setCache(fbMessages, fallback, fbFinal, cacheVariant(fbPlan));
        }

        this.updateCreditsInState();
        return fbFinal;
      }

      throw error;
    }
  }

  // === COMBO: execução ===

  private comboRemainingUsd(config: ComboConfig): number {
    const credits = this.creditManager.getStats().remainingUsd;
    if (config.budgetUsd > 0) {
      return Math.max(0, Math.min(credits, config.budgetUsd - this.comboSpentUsd));
    }
    return credits;
  }

  /**
   * Monta a fila ponderada, respeitando o orçamento, e tenta cada modelo.
   * Nada é debitado sem antes caber no limite: o combo nunca ultrapassa o
   * teto global nem o teto próprio configurado.
   */
  private async completeCombo(args: ComboAttemptArgs): Promise<RouterResponse> {
    const config = this.getComboConfig();
    const candidates = buildComboCandidates(config, {
      estimateCost: model => this.estimateCostFor(model, args.messages),
      remainingUsd: this.comboRemainingUsd(config),
    });

    if (candidates.length === 0) {
      throw new Error(
        'Combo: nenhum modelo cabe no orçamento restante. ' +
        'Aumente CREDIT_BUDGET_USD/COMBO_BUDGET_USD ou use modelos grátis com /free.'
      );
    }

    const failures: string[] = [];

    for (const candidate of candidates) {
      const estimate = this.estimateCostFor(candidate.model, args.messages);
      const remaining = this.comboRemainingUsd(config);
      if (estimate > 0 && !(estimate < remaining)) {
        failures.push(`${this.getModelName(candidate.model)}: orçamento insuficiente`);
        continue;
      }

      for (let attempt = 0; attempt <= config.wakeRetries; attempt++) {
        try {
          return await this.executeComboCandidate(candidate.model, args, config);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const canWake = attempt < config.wakeRetries && isWakeableError(message);

          if (canWake) {
            this.onNotification?.(
              `Combo: ${this.getModelName(candidate.model)} não respondeu; ` +
              `tentando acordar (${attempt + 1}/${config.wakeRetries})…`,
              'warning',
            );
            await delay(config.wakeDelayMs);
            continue;
          }

          failures.push(`${this.getModelName(candidate.model)}: ${message}`);
          this.onNotification?.(
            `Combo: ${this.getModelName(candidate.model)} falhou; seguindo para o próximo`,
            'warning',
          );
          break;
        }
      }
    }

    if (this.creditManager.isOverBudget()) {
      throw new Error(
        'Orçamento de créditos esgotado; o Combo não ultrapassa o limite. ' +
        'Aumente CREDIT_BUDGET_USD ou use modelos grátis com /free.'
      );
    }

    throw new Error(
      'Combo falhou em todos os modelos disponíveis.\n' +
      failures.slice(0, 6).join('\n')
    );
  }

  private async executeComboCandidate(
    model: string,
    args: ComboAttemptArgs,
    config: ComboConfig,
  ): Promise<RouterResponse> {
    const plan = prepareThinking(
      args.lastUserMsg,
      model,
      this.getProviderId(model),
      this.thinkingCfg,
      args.useThinking,
      isTrivialPrompt,
    );
    const planMessages = plan.directive
      ? this.withThinkingBlock(args.messages, plan.directive)
      : args.messages;
    const variant = cacheVariant(plan);

    if (!args.bypassCache && this.config.enableCache) {
      const cached = getCached(planMessages, model, variant);
      if (cached) {
        this.creditManager.record({
          model,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          fromCache: true,
        });
        this.updateCreditsInState();
        return cached;
      }
    }

    const result = await this.executePlan(
      model,
      args.messages,
      planMessages,
      plan,
      args.maxTokens,
      args.temperature,
      args.callOpts,
    );
    const final = this.finalizeResult(result, plan);

    this.creditManager.record({
      model,
      inputTokens: final.inputTokens,
      outputTokens: final.outputTokens,
      estimatedCostUsd: final.estimatedCostUsd,
      fromCache: false,
    });
    this.comboSpentUsd += Math.max(0, final.estimatedCostUsd);

    if (!args.bypassCache && this.config.enableCache) {
      setCache(planMessages, model, final, variant);
    }

    this.state = { ...this.state, activeModel: model, isFallbackActive: false };
    this.updateCreditsInState();

    if (config.budgetUsd > 0 && this.comboSpentUsd >= config.budgetUsd) {
      this.onNotification?.(
        'Combo: teto próprio atingido; as próximas chamadas usam só o que ainda cabe.',
        'info',
      );
    }

    return final;
  }

  private updateCreditsInState(): void {
    this.state = { ...this.state, credits: this.creditManager.getStats() };
    this.onStateChange?.(this.getState());
  }

  private getModelCosts(model: string): { input: number; output: number } {
    const found = findModelOwner(model);
    return found
      ? { input: found.model.costPer1kTokensInput, output: found.model.costPer1kTokensOutput }
      : { input: 0.003, output: 0.015 };
  }

  private getModelName(id: string): string {
    return findModelOwner(id)?.model.name ?? id;
  }

  // Obtém informações sobre qual provider o modelo pertence
  getModelProvider(id: string): string {
    const found = findModelOwner(id);
    if (!found) return 'Unknown';
    return PROVIDER_LABELS[found.provider];
  }

  getCreditStats() {
    return this.creditManager.getStats();
  }
}
