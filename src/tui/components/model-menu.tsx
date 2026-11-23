import { createMemo, createSignal, For, Show } from 'solid-js';
import { MouseButton, type MouseEvent } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { parseModelRef } from '../../providers/registry.js';
import { MODEL_CATEGORY_LABELS } from '../../providers/catalog.js';
import type { TuiController } from '../controller.js';

export interface ModelMenuProps {
  controller: TuiController;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}

interface ModelEntry {
  id: string;
  description: string;
}

const VISIBLE_ROWS = 12;

function rawModelId(id: string): string {
  return parseModelRef(id).id;
}

export function ModelMenu(props: ModelMenuProps) {
  const [filter, setFilter] = createSignal('');
  const [active, setActive] = createSignal(0);
  const dims = useTerminalDimensions();

  const isAuto = () => props.controller.getState().isAutoMode;

  const rows = createMemo(() => Math.max(3, Math.min(VISIBLE_ROWS, dims().height - 7)));
  const panelWidth = createMemo(() =>
    Math.max(44, Math.min(76, Math.floor(dims().width * 0.62))),
  );
  const panelHeight = createMemo(() => rows() + 3);

  const entries = createMemo<ModelEntry[]>(() => [
    {
      id: 'auto',
      description: isAuto()
        ? '(ativo) roteia com fallback automático'
        : 'roteia com fallback automático',
    },
    ...props.controller.listModels().map(model => {
      const badges = [
        model.free ? 'grátis' : model.tier,
        model.category ? MODEL_CATEGORY_LABELS[model.category] : undefined,
      ].filter((badge): badge is string => Boolean(badge));
      return {
        id: model.id,
        description: `${model.name} · ${model.providerLabel}${badges.length ? ` · ${badges.join(' · ')}` : ''}`,
      };
    }),
  ]);

  const filtered = createMemo(() => {
    const query = filter().trim().toLowerCase();
    if (!query) return entries();
    return entries().filter(entry =>
      `${entry.id} ${entry.description}`.toLowerCase().includes(query),
    );
  });

  const start = createMemo(() =>
    Math.max(
      0,
      Math.min(active() - Math.floor(rows() / 2), filtered().length - rows()),
    ),
  );
  const windowItems = createMemo(() =>
    filtered().slice(start(), start() + rows()),
  );

  function move(delta: number): void {
    const length = filtered().length;
    if (length === 0) return;
    setActive(current => (current + delta + length) % length);
  }

  function selectActive(): void {
    const entry = filtered()[active()];
    if (entry) props.onSelect(entry.id);
  }

  useKeyboard(key => {
    if (key.name === 'escape') {
      key.preventDefault();
      props.onClose();
      return;
    }
    if (key.name === 'up') {
      key.preventDefault();
      move(-1);
      return;
    }
    if (key.name === 'down') {
      key.preventDefault();
      move(1);
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
      zIndex={10}
      onMouseDown={() => props.onClose()}
    >
      <box
        width={panelWidth()}
        height={panelHeight()}
        backgroundColor="#121212"
        flexDirection="column"
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation();
        }}
      >
      <text fg="#ffffff" wrapMode="none" truncate>
        {' Modelos — digite para pesquisar (Enter seleciona, Esc fecha)'}
      </text>
      <box
        flexDirection="row"
        width="100%"
        height={1}
        columnGap={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg="#8b949e" wrapMode="none">
          buscar
        </text>
        <input
          flexGrow={1}
          focused
          value={filter()}
          placeholder="modelo ou provedor…"
          placeholderColor="#6e7681"
          backgroundColor="#121212"
          focusedBackgroundColor="#121212"
          textColor="#e6edf3"
          focusedTextColor="#e6edf3"
          onInput={(value: string) => {
            setFilter(value);
            setActive(0);
          }}
          onSubmit={() => selectActive()}
        />
      </box>
      <For each={windowItems()}>
        {(entry, index) => {
          const row = () => start() + index();
          const selected = () => row() === active();
          return (
            <box
              flexDirection="row"
              width="100%"
              height={1}
              columnGap={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={selected() ? '#1f6feb' : '#121212'}
              onMouseDown={(event: MouseEvent) => {
                if (event.button !== MouseButton.LEFT) return;
                event.preventDefault();
                event.stopPropagation();
                props.onSelect(entry.id);
              }}
            >
              <text
                fg={selected() ? '#ffffff' : '#e6edf3'}
                wrapMode="none"
                truncate
                width={34}
              >
                {rawModelId(entry.id)}
              </text>
              <text
                fg={selected() ? '#dbe9ff' : '#8b949e'}
                wrapMode="none"
                truncate
                flexGrow={1}
              >
                {entry.description}
              </text>
            </box>
          );
        }}
      </For>
      <Show when={filtered().length === 0}>
        <text fg="#8b949e" wrapMode="none">
          {' Nenhum modelo encontrado'}
        </text>
      </Show>
        <text fg="#484f58" wrapMode="none" truncate>
          {` ${filtered().length} modelos · ↑↓ navega`}
        </text>
      </box>
    </box>
  );
}
