import { For, Show } from 'solid-js';
import { MouseButton, type MouseEvent } from '@opentui/core';
import type { PromptCommand } from '../../ui/commands.js';

export interface SuggestionsProps {
  items: PromptCommand[];
  max?: number;
  selected?: number;
  onHover?: (index: number) => void;
  onRun?: (command: PromptCommand) => void;
}

// Bloco de comandos exibido acima do prompt enquanto o usuário digita
// algo começando com "/": título, divisor, colunas alinhadas e barra de
// seleção (setas + Enter).
export function Suggestions(props: SuggestionsProps) {
  const limit = () => props.max ?? 11;
  const visible = () => props.items.slice(0, limit());
  const hidden = () => Math.max(0, props.items.length - visible().length);
  const blockHeight = () => 1 + visible().length + (hidden() > 0 ? 1 : 0);
  const selected = () => Math.min(props.selected ?? 0, Math.max(0, visible().length - 1));

  const hover = (index: number) => () => props.onHover?.(index);

  return (
    <box
      flexDirection="column"
      width="100%"
      height={blockHeight()}
      flexShrink={0}
      backgroundColor="#121212"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" width="100%" height={1} justifyContent="space-between">
        <text fg="#ffffff" wrapMode="none">
          Comandos
        </text>
        <text fg="#6e7681" wrapMode="none" truncate>
          ↑↓ escolhe · Enter executa
        </text>
      </box>
      <For each={visible()}>
        {(command, index) => (
          <box
            flexDirection="row"
            width="100%"
            height={1}
            columnGap={2}
            backgroundColor={selected() === index() ? '#1f2b3a' : '#121212'}
            onMouseOver={hover(index())}
            onMouseDown={(event: MouseEvent) => {
              if (event.button !== MouseButton.LEFT) return;
              event.preventDefault();
              event.stopPropagation();
              props.onRun?.(command);
            }}
          >
            <text
              fg="#ffffff"
              width={13}
              wrapMode="none"
              onMouseOver={hover(index())}
            >
              {command.cmd}
            </text>
            <text
              fg={selected() === index() ? '#c9d1d9' : '#8b949e'}
              wrapMode="none"
              truncate
              flexGrow={1}
              onMouseOver={hover(index())}
            >
              {command.desc}
            </text>
          </box>
        )}
      </For>
      <Show when={hidden() > 0}>
        <text fg="#6e7681" wrapMode="none">
          {`… ${hidden()} comando(s) oculto(s)`}
        </text>
      </Show>
    </box>
  );
}
