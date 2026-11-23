import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { MouseButton, type MouseEvent } from '@opentui/core';
import { parseModelRef } from '../../providers/registry.js';
import { formatImagePathsForDisplay } from '../../vision/formatter.js';
import type { AgentRunSummary, ReasoningPart } from '../../types/index.js';
import type { AgentEvent } from '../../agent/types.js';
import { AgentActivity, DiffView } from './agent-activity.js';
import { MarkdownBlock } from './markdown.js';

const USER_BG = '#111111';
const USER_BORDER = '#1e1e1e';
const USER_TITLE = '#e6edf3';
const USER_TEXT = '#d7e2ee';
const AI_BG = '#111111';
const AI_BORDER = '#1e1e1e';
const AI_TITLE = '#8b949e';

export interface ChatEntry {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  reasoning?: string;
  reasoningParts?: ReasoningPart[];
  reasoningTokens?: number;
  tokens?: number;
  error?: boolean;
  streaming?: boolean;
  agentEvents?: AgentEvent[];
  agent?: AgentRunSummary;
}

export interface MessageListProps {
  messages: ChatEntry[];
  spinner: string;
  flexGrow?: number;
  showThinking?: boolean;
  onUserContextMenu?: (entry: ChatEntry, x: number, y: number) => void;
  pendingConfirm?: any | null;
  onApproveConfirm?: () => void;
  onRejectConfirm?: () => void;
}

// Bloco de raciocínio (estilo OpenCode): borda à esquerda, texto muted,
// clicável para recolher/expandir e sem os marcadores [REDACTED].
function ReasoningBlock(props: {
  text: string;
  tokens?: number;
  streaming?: boolean;
}) {
  const [open, setOpen] = createSignal(true);
  const clean = createMemo(() => props.text.replace(/\[REDACTED\]/g, '').trim());
  const preview = createMemo(() => {
    const text = clean();
    if (text.length <= 160) return text;
    return `${text.slice(0, 160).trimEnd()}…`;
  });

  return (
    <Show when={clean().length > 0}>
      <box
        flexDirection="column"
        width="100%"
        border={['left']}
        borderColor="#30363d"
        paddingLeft={1}
        marginTop={1}
        onMouseDown={(event: MouseEvent) => {
          if (event.button !== MouseButton.LEFT) return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(value => !value);
        }}
      >
        <text fg="#8b949e" wrapMode="word">
          {open()
            ? `_Thinking${props.tokens ? ` (${props.tokens} tokens)` : ''}:_ ${clean()}`
            : `_Thinking${props.tokens ? ` (${props.tokens} tokens)` : ''}:_ ${preview()} (clique para expandir)`}
          {props.streaming ? ' …' : ''}
        </text>
      </box>
    </Show>
  );
}

export function MessageList(props: MessageListProps) {
  const [spin, setSpin] = createSignal(0);
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const spinnerFrame = () => SPINNER_FRAMES[spin() % SPINNER_FRAMES.length];

  // Animar spinner enquanto houver mensagens em streaming
  const hasStreaming = () => props.messages.some(m => m.streaming);

  const spinTimer = setInterval(() => {
    if (hasStreaming()) setSpin(s => s + 1);
  }, 80); // Velocidade super fluida (12.5 fps)

  onCleanup(() => clearInterval(spinTimer));

  const kindEmoji = (kind?: string) => {
    switch (kind) {
      case 'create': return '✨';
      case 'overwrite': return '♻️';
      case 'patch': return '📝';
      case 'install': return '📦';
      case 'commit': return '💾';
      case 'push': return '🚀';
      case 'pr': return '🔀';
      default: return '⚙️';
    }
  };

  return (
    <scrollbox
      flexGrow={props.flexGrow ?? 1}
      stickyScroll
      stickyStart="bottom"
      scrollY
      width="100%"
    >
      <For each={props.messages}>
        {entry => (
          <box flexDirection="column" marginY={0} width="100%">
            {entry.role === 'user' ? (
              <box
                flexDirection="column"
                width="100%"
                backgroundColor={USER_BG}
                border
                borderStyle="rounded"
                borderColor={USER_BORDER}
                title=" Você "
                titleColor={USER_TITLE}
                titleAlignment="left"
                paddingLeft={1}
                paddingRight={1}
                marginBottom={1}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button !== MouseButton.RIGHT) return;
                  event.preventDefault();
                  event.stopPropagation();
                  props.onUserContextMenu?.(entry, event.x, event.y);
                }}
              >
                <text fg={USER_TEXT} wrapMode="word">
                  {formatImagePathsForDisplay(entry.content)}
                </text>
              </box>
            ) : entry.role === 'system' ? (
              <box paddingLeft={1} marginBottom={1}>
                <MarkdownBlock content={entry.content} streaming={entry.streaming === true} />
              </box>
            ) : (
              <box
                flexDirection="column"
                width="100%"
                backgroundColor={AI_BG}
                border
                borderStyle="rounded"
                borderColor={entry.error ? '#5c2b2b' : AI_BORDER}
                title={entry.model ? ` ◆ ${parseModelRef(entry.model).id} ` : ' ◆ Vaktor '}
                titleColor={entry.error ? '#ff7b72' : AI_TITLE}
                titleAlignment="left"
                paddingLeft={1}
                paddingRight={1}
                marginBottom={1}
              >
                <Show when={(entry.agentEvents?.length ?? 0) > 0 || entry.agent}>
                  <AgentActivity
                    events={entry.agentEvents ?? []}
                    {...(entry.agent ? { agent: entry.agent } : {})}
                    streaming={entry.streaming === true}
                    spinner={spinnerFrame()}
                  />
                </Show>
                {entry.error ? (
                  <text fg="#ff7b72" wrapMode="word">
                    {entry.content}
                  </text>
                ) : (
                  <MarkdownBlock content={entry.content} streaming={entry.streaming === true} />
                )}
                {entry.reasoning && (props.showThinking ?? true) ? (
                  <ReasoningBlock
                    text={entry.reasoning}
                    {...(entry.reasoningTokens !== undefined
                      ? { tokens: entry.reasoningTokens }
                      : {})}
                    streaming={entry.streaming === true}
                  />
                ) : null}
                {entry.streaming ? (
                  <text fg="#d29922" wrapMode="none" marginTop={1}>
                    {spinnerFrame()} gerando…
                  </text>
                ) : null}
              </box>
            )}
          </box>
        )}
      </For>
      {/* Botão de confirmação no final da lista */}
      <Show when={props.pendingConfirm}>
        {() => {
          const confirm = props.pendingConfirm;
          return (
            <box
              flexDirection="column"
              marginTop={1}
              marginBottom={1}
              paddingLeft={2}
              paddingRight={2}
              backgroundColor="#161b22"
              border
              borderColor="#30363d"
            >
              <text fg="#58a6ff" marginTop={1} wrapMode="word">
                {kindEmoji(confirm?.kind)} {confirm?.title}
              </text>
              <Show
                when={
                  confirm?.kind === 'create'
                  || confirm?.kind === 'overwrite'
                  || confirm?.kind === 'patch'
                }
                fallback={
                  <text fg="#8b949e" marginTop={1} wrapMode="word">
                    {confirm?.detail}
                  </text>
                }
              >
                <DiffView
                  diff={confirm?.detail ?? ''}
                  maxLines={40}
                  title="Alterações"
                />
              </Show>
              <Show when={confirm?.path}>
                {() => (
                  <text fg="#79c0ff" marginTop={1} wrapMode="word">
                    📁 {confirm?.path}
                  </text>
                )}
              </Show>
              <box flexDirection="row" columnGap={2} marginTop={1} marginBottom={1}>
                <box
                  flexDirection="row"
                  columnGap={1}
                  paddingLeft={2}
                  paddingRight={2}
                  border
                  borderColor="#f85149"
                  onMouseDown={() => props.onRejectConfirm?.()}
                >
                  <text fg="#f85149">
                    ✕ Rejeitar [ESC]
                  </text>
                </box>
                <box
                  flexDirection="row"
                  columnGap={1}
                  paddingLeft={2}
                  paddingRight={2}
                  border
                  borderColor="#3fb950"
                  backgroundColor="#0d6e1f"
                  onMouseDown={() => props.onApproveConfirm?.()}
                >
                  <text fg="#3fb950">
                    ✓ Aprovar [ENTER]
                  </text>
                </box>
              </box>
            </box>
          );
        }}
      </Show>
    </scrollbox>
  );
}
