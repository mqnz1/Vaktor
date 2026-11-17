import { createSignal, For } from 'solid-js';
import { MouseButton, type MouseEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { COMMANDS } from '../../ui/commands.js';

export interface CommandListProps {
  onSelect: (cmd: string) => void;
}

export function CommandList(props: CommandListProps) {
  const [active, setActive] = createSignal(0);

  function move(delta: number): void {
    const length = COMMANDS.length;
    if (length === 0) return;
    setActive(current => (current + delta + length) % length);
  }

  useKeyboard(key => {
    if (key.name === 'up') {
      key.preventDefault();
      move(-1);
      return;
    }
    if (key.name === 'down') {
      key.preventDefault();
      move(1);
      return;
    }
    if (key.name === 'return' || key.name === 'kpenter') {
      key.preventDefault();
      const command = COMMANDS[active()];
      if (command) props.onSelect(command.cmd);
    }
  });

  return (
    <box
      width={42}
      backgroundColor="#121212"
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={(event: MouseEvent) => {
        event.stopPropagation();
      }}
    >
      <text fg="#ffffff" wrapMode="none" truncate>
        {'Comandos (Ctrl+U fecha)'}
      </text>
      <For each={COMMANDS}>
        {(command, index) => {
          const selected = () => index() === active();
          return (
            <box
              flexDirection="row"
              width="100%"
              columnGap={1}
              backgroundColor={selected() ? '#1f6beb' : '#121212'}
              onMouseOver={() => setActive(index())}
              onMouseDown={(event: MouseEvent) => {
                if (event.button !== MouseButton.LEFT) return;
                event.preventDefault();
                event.stopPropagation();
                props.onSelect(command.cmd);
              }}
            >
              <text
                fg={selected() ? '#ffffff' : '#e6edf3'}
                wrapMode="none"
                width={13}
                onMouseOver={() => setActive(index())}
              >
                {command.cmd}
              </text>
              <text
                fg={selected() ? '#dbe9ff' : '#8b949e'}
                wrapMode="none"
                truncate
                flexGrow={1}
                onMouseOver={() => setActive(index())}
              >
                {command.desc}
              </text>
            </box>
          );
        }}
      </For>
      <text fg="#484f58" wrapMode="none" truncate>
        {'↑↓ navega · Enter executa'}
      </text>
    </box>
  );
}
