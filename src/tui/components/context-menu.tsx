import { For } from 'solid-js';
import { MouseButton, type MouseEvent } from '@opentui/core';

export const CONTEXT_MENU_WIDTH = 20;

export interface ContextMenuAction {
  label: string;
  hint?: string;
  danger?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

export function ContextMenu(props: ContextMenuProps) {
  return (
    <box
      position="absolute"
      left={props.x}
      top={props.y}
      width={CONTEXT_MENU_WIDTH}
      height={props.actions.length + 2}
      zIndex={50}
      border
      borderColor="#30363d"
      backgroundColor="#161b22"
      flexDirection="column"
    >
      <For each={props.actions}>
        {action => (
          <box
            flexDirection="row"
            width="100%"
            height={1}
            paddingLeft={1}
            paddingRight={1}
            onMouseDown={(event: MouseEvent) => {
              if (event.button !== MouseButton.LEFT) return;
              event.preventDefault();
              event.stopPropagation();
              action.onSelect();
            }}
          >
            <text fg={action.danger ? '#ff7b72' : '#e6edf3'} wrapMode="none" truncate>
              {action.label}
            </text>
            <box flexGrow={1} />
            <text fg="#8b949e" wrapMode="none">
              {action.hint ?? ''}
            </text>
          </box>
        )}
      </For>
    </box>
  );
}
