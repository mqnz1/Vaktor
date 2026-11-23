import { createEffect, createSignal, For, Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { MouseButton, type MouseEvent } from '@opentui/core';
import { basename } from 'node:path';
import { formatSessionTime, type StoredSession } from '../sessions.js';

export interface SessionsMenuProps {
  sessions: StoredSession[];
  onRestore: (session: StoredSession) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const MAX_VISIBLE = 10;

export function SessionsMenu(props: SessionsMenuProps) {
  const [cursor, setCursor] = createSignal(0);

  const visible = () => props.sessions.slice(0, MAX_VISIBLE);

  createEffect(() => {
    const last = visible().length - 1;
    setCursor(current => (current > last ? Math.max(0, last) : current));
  });

  useKeyboard(key => {
    if (key.name === 'escape') {
      key.preventDefault();
      props.onClose();
      return;
    }
    if (key.name === 'up') {
      key.preventDefault();
      setCursor(current => Math.max(0, current - 1));
      return;
    }
    if (key.name === 'down') {
      key.preventDefault();
      setCursor(current => Math.min(visible().length - 1, current + 1));
      return;
    }
    if (key.ctrl && (key.name === 'delete' || key.name === 'del')) {
      key.preventDefault();
      const session = visible()[cursor()];
      if (session) props.onDelete(session.id);
      return;
    }
    if (key.name === 'return' || key.name === 'kpenter' || key.name === 'linefeed') {
      key.preventDefault();
      const session = visible()[cursor()];
      if (session) props.onRestore(session);
    }
  });

  const hoverOn = (index: number) => () => setCursor(index);

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      zIndex={30}
      onMouseDown={() => props.onClose()}
    >
      <box
        width={68}
        backgroundColor="#121212"
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation();
        }}
      >
        <text fg="#ffffff" wrapMode="none" truncate>
          Sessões
        </text>
        <Show
          when={visible().length > 0}
          fallback={
            <text fg="#8b949e" wrapMode="none" truncate>
              Nenhuma sessão ainda
            </text>
          }
        >
          <For each={visible()}>
            {(session, index) => (
              <box
                flexDirection="row"
                width="100%"
                columnGap={1}
                backgroundColor={cursor() === index() ? '#1f2b3a' : '#121212'}
                onMouseOver={hoverOn(index())}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button !== MouseButton.LEFT) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setCursor(index());
                  props.onRestore(session);
                }}
              >
                <text
                  fg={cursor() === index() ? '#ffffff' : '#8b949e'}
                  width={2}
                  wrapMode="none"
                  onMouseOver={hoverOn(index())}
                >
                  {cursor() === index() ? '›' : ' '}
                </text>
                <text
                  fg="#ffffff"
                  width={32}
                  wrapMode="none"
                  truncate
                  onMouseOver={hoverOn(index())}
                >
                  {session.topic}
                </text>
                <text
                  fg="#8b949e"
                  wrapMode="none"
                  truncate
                  flexGrow={1}
                  onMouseOver={hoverOn(index())}
                >
                  {`${formatSessionTime(session.updatedAt)} · ${basename(session.workdir)} · ${session.messages.filter(m => m.role === 'user').length} msgs`}
                </text>
              </box>
            )}
          </For>
        </Show>
        <text fg="#8b949e" wrapMode="none" truncate>
          Enter abre · Ctrl+Del apaga · Esc fecha
        </text>
      </box>
    </box>
  );
}
