// =============================================================
// Controlador da TUI: abstração sobre o AIRouter para que a UI
// possa ser testada headless com um fake (ver smoke.tsx).
// =============================================================
import type { AIRouter } from '../router/index.js';
import type { AppMode, ChatMessage, CompleteOptions, ReasoningPart, RouterState } from '../types/index.js';
import { ownerOf, providerLabel } from '../providers/registry.js';
import {
  listRankedModels,
  type ModelCategory,
  type ModelTier,
} from '../providers/catalog.js';
import type { ProviderId, ThinkingConfig, ThinkingEffort, ThinkingMode } from '../thinking/types.js';
import type { ComboConfig, ComboMember } from '../router/combo.js';

export interface TuiModelEntry {
  id: string;
  name: string;
  provider: ProviderId;
  providerLabel: string;
  costPer1kTokensInput: number;
  costPer1kTokensOutput?: number;
  tier?: ModelTier;
  free?: boolean;
  category?: ModelCategory;
  contextWindow?: number;
  priority?: number;
}

export interface TuiSendResult {
  text: string;
  model: string;
  reasoning?: string;
  reasoningParts?: ReasoningPart[];
  reasoningTokens?: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  fromCache: boolean;
}

export interface TuiSendOpts {
  bypassCache?: boolean;
  /** Cancelamento (Ctrl+C) propagado ao provedor. */
  signal?: AbortSignal;
  /** Streaming parcial de tokens (quando o provedor suporta). */
  onToken?: (chunk: string) => void;
  /** Streaming parcial de raciocínio (quando o provedor suporta). */
  onReasoningToken?: (chunk: string) => void;
}

export interface TuiController {
  getState(): RouterState;
  setOnStateChange?(cb: (state: RouterState) => void): void;
  listModels(): TuiModelEntry[];
  setModel(id: string): void;
  setMode(mode: AppMode): void;
  setWorkdir(path: string): void;
  send(history: ChatMessage[], opts?: TuiSendOpts): Promise<TuiSendResult>;
  /** Chamada crua com override de modelo (usada pelo orquestrador). */
  complete?(messages: ChatMessage[], opts?: CompleteOptions): Promise<TuiSendResult>;
  setOnNotification(cb: (message: string, type: 'info' | 'warning') => void): void;
  setOnModelSwitch(cb: (fromModel: string, toModel: string, reason: string) => void): void;
  setAgentEnabled?(on: boolean): void;
  setSkillsEnabled?(on: boolean): void;
  setThinkingMode?(mode: ThinkingMode): void;
  toggleThinking?(): void;
  setThinkingShow?(on: boolean): void;
  setThinkingBudget?(n: number): void;
  setThinkingVariant?(variant: ThinkingEffort | undefined): void;
  getThinkingConfig?(): ThinkingConfig;
  isComboActive?(): boolean;
  getComboConfig?(): ComboConfig;
  getComboDescription?(): string;
  getComboLabel?(): string;
  setComboEnabled?(on: boolean): void;
  setComboMembers?(members: ComboMember[]): void;
}

export const HIDDEN_PROVIDERS: readonly ProviderId[] = [];

export function listAllModels(): TuiModelEntry[] {
  return listRankedModels()
    .filter(model => !HIDDEN_PROVIDERS.includes(model.provider))
    .map(model => ({
      id: model.qualifiedId,
      name: model.name,
      provider: model.provider,
      providerLabel: providerLabel(model.provider),
      costPer1kTokensInput: model.inputCostPer1k,
      costPer1kTokensOutput: model.outputCostPer1k,
      tier: model.tier,
      free: model.free,
      category: model.category,
      contextWindow: model.contextWindow,
      priority: model.priority,
    }));
}

export class RouterController implements TuiController {
  constructor(private router: AIRouter) {}

  getState(): RouterState {
    return this.router.getState();
  }

  setOnStateChange(cb: (state: RouterState) => void): void {
    this.router.setOnStateChange(cb);
  }

  listModels(): TuiModelEntry[] {
    return listAllModels();
  }

  setModel(id: string): void {
    this.router.setModel(id);
  }

  setMode(mode: AppMode): void {
    this.router.setMode(mode);
  }

  setWorkdir(path: string): void {
    this.router.setWorkdir(path);
  }

  async send(
    history: ChatMessage[],
    opts?: TuiSendOpts,
  ): Promise<TuiSendResult> {
    const res = await this.router.send(history, opts?.bypassCache === true, {
      ...(opts?.signal ? { signal: opts.signal } : {}),
      ...(opts?.onToken ? { onToken: opts.onToken } : {}),
      ...(opts?.onReasoningToken ? { onReasoningToken: opts.onReasoningToken } : {}),
    });
    return {
      text: res.text,
      model: res.model,
      ...(res.reasoning ? { reasoning: res.reasoning } : {}),
      ...(res.reasoningParts ? { reasoningParts: res.reasoningParts } : {}),
      ...(res.reasoningTokens !== undefined ? { reasoningTokens: res.reasoningTokens } : {}),
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      estimatedCostUsd: res.estimatedCostUsd,
      fromCache: res.fromCache,
    };
  }

  async complete(
    messages: ChatMessage[],
    opts?: CompleteOptions,
  ): Promise<TuiSendResult> {
    const res = await this.router.complete(messages, opts);
    return {
      text: res.text,
      model: res.model,
      ...(res.reasoning ? { reasoning: res.reasoning } : {}),
      ...(res.reasoningParts ? { reasoningParts: res.reasoningParts } : {}),
      ...(res.reasoningTokens !== undefined ? { reasoningTokens: res.reasoningTokens } : {}),
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      estimatedCostUsd: res.estimatedCostUsd,
      fromCache: res.fromCache,
    };
  }

  setOnNotification(cb: (message: string, type: 'info' | 'warning') => void): void {
    this.router.setOnNotification(cb);
  }

  setOnModelSwitch(cb: (fromModel: string, toModel: string, reason: string) => void): void {
    this.router.setOnModelSwitch(cb);
  }

  setAgentEnabled(on: boolean): void {
    this.router.setAgentEnabled(on);
  }

  setSkillsEnabled(on: boolean): void {
    this.router.setSkillsEnabled(on);
  }

  setThinkingMode(mode: ThinkingMode): void {
    this.router.setThinkingMode(mode);
  }

  toggleThinking(): void {
    this.router.toggleThinking();
  }

  setThinkingShow(on: boolean): void {
    this.router.setThinkingShow(on);
  }

  setThinkingBudget(n: number): void {
    this.router.setThinkingBudget(n);
  }

  setThinkingVariant(variant: ThinkingEffort | undefined): void {
    this.router.setThinkingVariant(variant);
  }

  getThinkingConfig(): ThinkingConfig {
    return this.router.getThinkingConfig();
  }

  isComboActive(): boolean {
    return this.router.isComboActive();
  }

  getComboConfig(): ComboConfig {
    return this.router.getComboConfig();
  }

  getComboDescription(): string {
    return this.router.getComboDescription();
  }

  getComboLabel(): string {
    return this.router.getComboLabel();
  }

  setComboEnabled(on: boolean): void {
    this.router.setComboEnabled(on);
  }

  setComboMembers(members: ComboMember[]): void {
    this.router.setComboMembers(members);
  }
}

export { ownerOf };
