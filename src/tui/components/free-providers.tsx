import { createMemo, createSignal, For, Show } from 'solid-js';
import { MouseButton, type MouseEvent } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { listFreeModels, MODEL_CATEGORY_LABELS, type RankedModel } from '../../providers/catalog.js';
import { parseModelRef } from '../../providers/registry.js';
import type { ProviderId } from '../../thinking/types.js';

export interface FreeProvidersMenuProps {
  activeModel?: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}

interface FreeGroup {
  provider: ProviderId;
  label: string;
  models: RankedModel[];
}

type Stage = 'providers' | 'models';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function groupFreeModels(): FreeGroup[] {
  const groups: FreeGroup[] = [];
  const index = new Map<ProviderId, number>();
  for (const model of listFreeModels()) {
    const existing = index.get(model.provider);
    if (existing !== undefined) {
      groups[existing]!.models.push(model);
      continue;
    }
    index.set(model.provider, groups.length);
    groups.push({
      provider: model.provider,
      label: model.providerLabel,
      models: [model],
    });
  }
  return groups;
}

// Fluxo em dois níveis: provedor → modelos. Só entram modelos realmente
// gratuitos; provedores pagos/customizados ficam fora deste menu.
export function FreeProvidersMenu(props: FreeProvidersMenuProps) {
  const dims = useTerminalDimensions();
  const [stage, setStage] = createSignal<Stage>('providers');
  const [providerIndex, setProviderIndex] = createSignal(0);
  const [modelIndex, setModelIndex] = createSignal(0);

  const groups = createMemo(groupFreeModels);
  const group = createMemo(() => groups()[providerIndex()]);
  const models = createMemo(() => group()?.models ?? []);

  const providerRows = createMemo(() =>
    Math.max(3, Math.min(12, dims().height - 9)),
  );
  const providerStart = createMemo(() =>
    clamp(
      providerIndex() - Math.floor(providerRows() / 2),
      0,
      Math.max(0, groups().length - providerRows()),
    ),
  );
  const visibleProviders = createMemo(() =>
    groups().slice(providerStart(), providerStart() + providerRows()),
  );

  const modelRows = createMemo(() =>
    Math.max(3, Math.min(12, dims().height - 11)),
  );
  const modelStart = createMemo(() =>
    clamp(
      modelIndex() - Math.floor(modelRows() / 2),
      0,
      Math.max(0, models().length - modelRows()),
    ),
  );
  const visibleModels = createMemo(() =>
    models().slice(modelStart(), modelStart() + modelRows()),
  );

  const panelWidth = createMemo(() =>
    Math.max(58, Math.min(94, Math.floor(dims().width * 0.72))),
  );

  function move(delta: number): void {
    if (stage() === 'providers') {
      const length = groups().length;
      if (length === 0) return;
      setProviderIndex(current => (current + delta + length) % length);
      setModelIndex(0);
      return;
    }
    const length = models().length;
    if (length === 0) return;
    setModelIndex(current => (current + delta + length) % length);
  }

  function openModels(): void {
    if (!group()) return;
    setStage('models');
    setModelIndex(0);
  }

  function back(): void {
    if (stage() === 'models') {
      setStage('providers');
      setModelIndex(0);
      return;
    }
    props.onClose();
  }

  function choose(): void {
    if (stage() === 'providers') {
      openModels();
      return;
    }
    const model = models()[modelIndex()];
    if (model) props.onSelect(model.qualifiedId);
  }

  useKeyboard(key => {
    if (key.name === 'escape') {
      key.preventDefault();
      back();
      return;
    }
    if (key.name === 'left' || key.name === 'backspace') {
      if (stage() === 'models') {
        key.preventDefault();
        back();
      }
      return;
    }
    if (key.name === 'right') {
      if (stage() === 'providers') {
        key.preventDefault();
        openModels();
      }
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
      return;
    }
    if (key.name === 'home') {
      key.preventDefault();
      if (stage() === 'providers') setProviderIndex(0);
      else setModelIndex(0);
      return;
    }
    if (key.name === 'end') {
      key.preventDefault();
      if (stage() === 'providers') setProviderIndex(Math.max(0, groups().length - 1));
      else setModelIndex(Math.max(0, models().length - 1));
      return;
    }
    if (key.name === 'return' || key.name === 'kpenter' || key.name === 'linefeed') {
      key.preventDefault();
      choose();
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
        width={panelWidth()}
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
        <Show
          when={stage() === 'providers'}
          fallback={
            <text fg="#ffffff" wrapMode="none" truncate>
              {` Modelos grátis · ${group()?.label ?? '—'}`}
            </text>
          }
        >
          <text fg="#ffffff" wrapMode="none" truncate>
            {' Provedores grátis'}
          </text>
        </Show>
        <text fg="#484f58" wrapMode="none" truncate>
          {stage() === 'providers'
            ? ' ↑↓ escolhe · Enter abre modelos · Esc fecha'
            : ' ↑↓ escolhe · Enter usa o modelo · ←/Esc volta'}
        </text>

        <Show when={stage() === 'providers'}>
          <Show
            when={visibleProviders().length > 0}
            fallback={
              <text fg="#8b949e" wrapMode="none" truncate>
                {' Nenhum provedor com modelos grátis'}
              </text>
            }
          >
            <For each={visibleProviders()}>
              {(item, index) => {
                const row = () => providerStart() + index();
                const selected = () => row() === providerIndex();
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
                      setProviderIndex(row());
                      openModels();
                    }}
                  >
                    <text fg={selected() ? '#ffffff' : '#3fb950'} wrapMode="none">
                      {selected() ? '›' : '●'}
                    </text>
                    <text
                      fg={selected() ? '#ffffff' : '#e6edf3'}
                      wrapMode="none"
                      truncate
                      width={26}
                    >
                      {item.label}
                    </text>
                    <text
                      fg={selected() ? '#dbe9ff' : '#8b949e'}
                      wrapMode="none"
                      truncate
                      flexGrow={1}
                    >
                      {`${item.models.length} modelo${item.models.length === 1 ? '' : 's'} grátis`}
                    </text>
                  </box>
                );
              }}
            </For>
          </Show>
        </Show>

        <Show when={stage() === 'models'}>
          <Show
            when={visibleModels().length > 0}
            fallback={
              <text fg="#8b949e" wrapMode="none" truncate>
                {' Nenhum modelo grátis neste provedor'}
              </text>
            }
          >
            <For each={visibleModels()}>
              {(model, index) => {
                const row = () => modelStart() + index();
                const selected = () => row() === modelIndex();
                const active = () => props.activeModel === model.qualifiedId;
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
                      setModelIndex(row());
                      props.onSelect(model.qualifiedId);
                    }}
                  >
                    <text fg={selected() ? '#ffffff' : active() ? '#3fb950' : '#484f58'} wrapMode="none">
                      {selected() ? '›' : active() ? '✓' : ' '}
                    </text>
                    <text
                      fg={selected() ? '#ffffff' : '#e6edf3'}
                      wrapMode="none"
                      truncate
                      width={38}
                    >
                      {parseModelRef(model.qualifiedId).id}
                    </text>
                    <text
                      fg={selected() ? '#dbe9ff' : '#8b949e'}
                      wrapMode="none"
                      truncate
                      flexGrow={1}
                    >
                      {`${model.name} · ${MODEL_CATEGORY_LABELS[model.category]}`}
                    </text>
                  </box>
                );
              }}
            </For>
          </Show>
        </Show>

        <text fg="#484f58" wrapMode="none" truncate>
          {stage() === 'providers'
            ? ` ${groups().length} provedores · ${models().length} modelos no selecionado`
            : ` ${models().length} modelos grátis · ${group()?.label ?? '—'}`}
        </text>
      </box>
    </box>
  );
}
