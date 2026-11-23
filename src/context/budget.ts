// =============================================================
// Orçamento de janela de contexto do chat.
//
// 40% do espaço disponível fica reservado para o resumo/base da sessão
// e 60% para a execução ativa (mensagens recentes). O split é puro para
// poder ser testado sem chamar modelo.
// =============================================================
import type { ChatMessage } from '../types/index.js';

export const SESSION_BUDGET_SHARE = 0.4;
export const ACTIVE_BUDGET_SHARE = 0.6;

export function estimateContextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateContextTokens(message.content), 0);
}

export interface ContextWindowSplit {
  system: ChatMessage[];
  session: ChatMessage[];
  active: ChatMessage[];
  systemTokens: number;
  sessionTokens: number;
  activeTokens: number;
  totalTokens: number;
  availableTokens: number;
  sessionBudgetTokens: number;
  activeBudgetTokens: number;
}

/**
 * Separa o histórico em sistema, sessão antiga e execução ativa.
 * A execução ativa cresce do fim para o começo até consumir 60% do
 * orçamento disponível; o restante vira sessão (candidata a compactação).
 */
export function splitContextWindow(
  messages: readonly ChatMessage[],
  budgetTokens: number,
): ContextWindowSplit {
  const budget = Math.max(1000, Math.floor(budgetTokens));
  const system = messages.filter(message => message.role === 'system');
  const conversation = messages.filter(message => message.role !== 'system');
  const systemTokens = estimateMessagesTokens(system);
  const availableTokens = Math.max(1000, budget - systemTokens);
  const sessionBudgetTokens = Math.max(0, Math.floor(availableTokens * SESSION_BUDGET_SHARE));
  const activeBudgetTokens = Math.max(0, availableTokens - sessionBudgetTokens);

  let activeStart = conversation.length;
  let activeTokens = 0;
  for (let index = conversation.length - 1; index >= 0; index--) {
    const message = conversation[index];
    if (!message) continue;
    const tokens = estimateContextTokens(message.content);
    if (activeTokens + tokens > activeBudgetTokens && activeStart < conversation.length) break;
    activeTokens += tokens;
    activeStart = index;
  }

  const active = conversation.slice(activeStart);
  const session = conversation.slice(0, activeStart);
  return {
    system,
    session,
    active,
    systemTokens,
    sessionTokens: estimateMessagesTokens(session),
    activeTokens,
    totalTokens: systemTokens + estimateMessagesTokens(conversation),
    availableTokens,
    sessionBudgetTokens,
    activeBudgetTokens,
  };
}

/** Mantém as mensagens mais recentes que cabem no orçamento. */
export function trimMessagesToBudget(
  messages: readonly ChatMessage[],
  maxTokens: number,
): ChatMessage[] {
  if (messages.length === 0) return [];
  const limit = Math.max(0, Math.floor(maxTokens));
  const kept: ChatMessage[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message) continue;
    const tokens = estimateContextTokens(message.content);
    if (used + tokens > limit) {
      if (kept.length === 0) {
        const maxChars = Math.max(200, limit * 4);
        const content = message.content.length > maxChars
          ? `${message.content.slice(0, maxChars)}\n[...] (truncado)`
          : message.content;
        kept.unshift({ ...message, content });
      }
      break;
    }
    kept.unshift(message);
    used += tokens;
  }

  return kept;
}
