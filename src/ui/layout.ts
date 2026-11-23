// =============================================================
// Orçamento de linhas da TUI.
//
// O Ink redesenha o quadro inteiro a cada frame e apaga N linhas do quadro
// anterior. Se o conteúdo renderizado passar da altura do terminal, a tela
// rola e a conta do Ink deixa de bater: sobram linhas antigas no topo e
// textos de frames diferentes se sobrepõem (a "UI bugada").
//
// Aqui ficam as contas puras: quantas linhas uma mensagem ocupa e quais
// mensagens cabem no espaço disponível. A UI só renderiza o resultado —
// o histórico completo continua no estado e vai inteiro para o modelo.
// =============================================================
import type { ChatMessage } from '../types/index.js';

/** Header fixo: logo (3 linhas) + 1 divisor, com altura total de 5. */
export const HEADER_LINES = 5;
/** Prompt: borda + conteúdo + borda. */
export const INPUT_LINES = 3;
/** Rodapé de status. */
export const FOOTER_LINES = 1;
/** Uma linha extra reservada para notificação/aviso. */
export const NOTIFICATION_LINES = 1;

/**
 * Duas linhas de folga: o Ink apaga o quadro anterior contando linhas, e
 * qualquer frame com `altura >= rows` dispara o caminho de `clearTerminal`
 * dele, que deixa o apagador interno dessincronizado (UI sobreposta).
 * Com 2 linhas de folga, arredondamentos/efeitos de um frame não chegam lá.
 */
export const SAFETY_LINES = 2;

/** Flags que decidem o que está na tela — as MESMAS usadas no JSX da App. */
export interface ChromeFlags {
  hasNotification?: boolean;
  showFooter?: boolean;
  showInput?: boolean;
  /** Linhas extras do autocomplete (menu de comandos). */
  inputExtraLines?: number;
}

/**
 * Altura do chrome (header + notificação + footer + prompt). Calculado com
 * as mesmas condições do render, para a área de mensagens nunca estourar a
 * tela junto com o resto do layout.
 */
export function chromeLines(flags: ChromeFlags = {}): number {
  const {
    hasNotification = false,
    showFooter = true,
    showInput = true,
    inputExtraLines = 0,
  } = flags;
  return HEADER_LINES
    + (hasNotification ? NOTIFICATION_LINES : 0)
    + (showFooter ? FOOTER_LINES : 0)
    + (showInput ? INPUT_LINES + Math.max(0, inputExtraLines) : 0);
}

/**
 * Linhas disponíveis para a lista de mensagens. Pode chegar a 0 em terminal
 * baixo com o menu de comandos aberto — nesse caso a App não renderiza a
 * lista, em vez de forçar 1 linha e estourar a altura da raiz (o Ink corta
 * o quadro e o prompt/menu ficam pela metade).
 */
export function messageAreaLines(rows: number, flags: ChromeFlags = {}): number {
  return Math.max(0, rows - SAFETY_LINES - chromeLines(flags));
}

// Sem `strip-ansi` no caminho quente: o conteúdo das mensagens é texto puro,
// mas removemos controles por segurança (colagem de sequência ANSI).
function plainLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

/** Linhas que um texto ocupa ao ser quebrado em `width` colunas. */
export function wrapLineCount(text: string, width: number): number {
  const usable = Math.max(1, Math.floor(width));
  let lines = 0;
  for (const raw of text.split('\n')) {
    lines += Math.max(1, Math.ceil(plainLength(raw) / usable));
  }
  return lines;
}

function contentLines(content: string, width: number): number {
  const parts = content.split(/(```[\s\S]*?```)/g);
  let lines = 0;
  for (const part of parts) {
    if (part.startsWith('```')) {
      const inner = part.split('\n');
      const lang = (inner[0] ?? '').slice(3).trim();
      const code = inner.slice(1, -1).join('\n');
      // borda superior + borda inferior + padding lateral de 1
      lines += (lang ? 1 : 0) + 2 + wrapLineCount(code, width - 2);
    } else {
      lines += wrapLineCount(part, width);
    }
  }
  return lines;
}

/** Linhas estimadas de uma mensagem já renderizada (marcador + conteúdo). */
export function messageLineCount(message: ChatMessage, cols: number): number {
  const usable = Math.max(8, cols - 2);
  if (message.role === 'system') return wrapLineCount(message.content, usable - 2);
  if (message.role === 'user') return wrapLineCount(message.content, usable - 2);
  // Assistente: 1 linha de cabeçalho (● + hora) + conteúdo com paddingLeft 2.
  return 1 + contentLines(message.content, usable - 4);
}

export interface VisibleSlice {
  visible: ChatMessage[];
  hidden: number;
}

/**
 * Escolhe as mensagens mais recentes que cabem em `maxLines`, de baixo para
 * cima. Sempre devolve pelo menos a última mensagem — se ela sozinha estourar
 * o orçamento, `clipContent` corta o texto na renderização.
 */
export function selectVisibleMessages(
  messages: ChatMessage[],
  cols: number,
  maxLines: number,
): VisibleSlice {
  let budget = Math.max(1, maxLines);
  // Reserva 1 linha para o aviso "… N mensagens acima".
  budget -= 1;

  const visible: ChatMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const lines = messageLineCount(message, cols);
    if (visible.length > 0 && used + lines > budget) break;
    visible.unshift(message);
    used += lines;
    if (used >= budget) break;
  }

  return { visible, hidden: messages.length - visible.length };
}

/**
 * Corta o conteúdo de uma mensagem para caber em `maxLines`. Usado quando a
 * última mensagem sozinha é maior que a área visível (resposta longa).
 */
export function clipContent(content: string, cols: number, maxLines: number): string {
  const width = Math.max(8, cols - 6);
  const rawLines = content.split('\n');
  const kept: string[] = [];
  let used = 0;
  let cut = false;

  for (const line of rawLines) {
    const cost = Math.max(1, Math.ceil(plainLength(line) / width));
    if (used + cost > maxLines) {
      cut = true;
      break;
    }
    kept.push(line);
    used += cost;
  }

  if (!cut) return content;
  const remaining = rawLines.length - kept.length;
  return `${kept.join('\n')}\n… (${remaining} linha${remaining === 1 ? '' : 's'} oculta${remaining === 1 ? '' : 's'})`;
}

/** Mantém o prompt em uma única linha: mostra o fim do texto, como as CLIs. */
export function clipInput(value: string, cols: number): string {
  const room = Math.max(4, cols - 10);
  if (value.length <= room) return value;
  return `…${value.slice(value.length - room + 1)}`;
}

/**
 * Quantos itens do autocomplete cabem sem estourar a tela. O menu consome
 * `itens + 3` linhas (2 bordas + 1 de margem) além do prompt de 3 linhas;
 * sobram header (5), footer (1), 1 de notificação e 2 de folga — daí 15.
 * Em terminal baixo (≤15 linhas) o menu não cabe: devolve 0 e ele não aparece.
 */
export function autocompleteCapacity(rows: number): number {
  return Math.max(0, Math.min(6, Math.floor(rows) - 15));
}

/** Linhas extras que o menu de comandos ocupa no layout. */
export function autocompleteExtraLines(visibleItems: number): number {
  return visibleItems > 0 ? visibleItems + 3 : 0;
}

/**
 * Caixa de confirmação (y/n): 2 bordas + título + detalhe + rodapé.
 * O detalhe é limitado pelo que sobra da tela — numa tela baixa a caixa
 * encolhe (e a App a renderiza com flexGrow + overflow hidden, cortando o
 * excesso) em vez de empurrar o resto do quadro para fora.
 */
export function confirmDetailLines(rows: number): number {
  return Math.max(1, Math.min(18, Math.floor(rows) - 14));
}

export function confirmBoxLines(rows: number): number {
  return confirmDetailLines(rows) + 4;
}
