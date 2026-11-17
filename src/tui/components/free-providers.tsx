import { createMemo, For } from 'solid-js';
import { type MouseEvent } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { summarizeCatalogs } from '../../providers/catalog.js';

export interface FreeProvidersMenuProps {
  onClose: () => void;
}

// Lista só os provedores que têm modelos grátis (sem despejar a lista de
// modelos no chat). Esc ou clique fora fecha.
export function FreeProvidersMenu(props: FreeProvidersMenuProps) {
  const dims = useTerminalDimensions();

  const providers = createMemo(() =>
    summarizeCatalogs().byProvider.filter(item => item.free > 0),
  );
  const maxRows = createMemo(() => Math.max(4, Math.min(providers().length, dims().height - 8)));
  const visible = createMemo(() => providers().slice(0, maxRows()));
  const hidden = createMemo(() => Math.max(0, providers().length - visible().length));

  useKeyboard(key => {
    if (key.name === 'escape') {
      key.preventDefault();
      props.onClose();
    }
  });

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      zIndex={20}
      onMouseDown={() => props.onClose()}
    >
      <box
        width={56}
        backgroundColor="#121212"
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor="#30363d"
        paddingLeft={1}
        paddingRight={1}
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation();
        }}
      >
        <text fg="#ffffff" wrapMode="none" truncate>
          {' Provedores grátis — Esc fecha'}
        </text>
        <text fg="#484f58" wrapMode="none" truncate>
          {' Só os provedores; use /models free para ver os modelos'}
        </text>
        <For each={visible()}>
          {item => (
            <box flexDirection="row" width="100%" height={1} columnGap={1}>
              <text fg="#3fb950" wrapMode="none">
                {'●'}
              </text>
              <text fg="#e6edf3" wrapMode="none" truncate width={22}>
                {item.label}
              </text>
              <text fg="#8b949e" wrapMode="none" truncate flexGrow={1}>
                {`${item.free} grátis`}
              </text>
            </box>
          )}
        </For>
        <text fg="#484f58" wrapMode="none" truncate>
          {hidden() > 0
            ? ` ${providers().length} provedores · +${hidden()} ocultos`
            : ` ${providers().length} provedores`}
        </text>
      </box>
    </box>
  );
}
