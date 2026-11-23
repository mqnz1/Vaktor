import { createMemo, createSignal, For, Show } from 'solid-js';
import { MouseButton, type MouseEvent } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { ownerOf, parseModelRef, providerLabel } from '../../providers/registry.js';
import {
  ORCHESTRATOR_ROLES,
  roleLabel,
  type OrchestratorAssignments,
  type OrchestratorRole,
} from '../../orchestrator/types.js';

export interface OrchestratorMenuProps {
  assignments: OrchestratorAssignments;
  taskPrompt: string;
  onSelectRole: (role: OrchestratorRole) => void;
  onStart: () => void;
  onClose: () => void;
}

interface MenuRow {
  kind: 'role' | 'start';
  role?: OrchestratorRole;
}

function modelSummary(modelId: string): string {
  if (!modelId) return '(não definido)';
  return `${parseModelRef(modelId).id} · ${providerLabel(ownerOf(modelId))}`;
}

export function OrchestratorMenu(props: OrchestratorMenuProps) {
  const dims = useTerminalDimensions();
  const [active, setActive] = createSignal(0);

  const rows = createMemo<MenuRow[]>(() => [
    ...ORCHESTRATOR_ROLES.map(role => ({ kind: 'role' as const, role: role.id })),
    { kind: 'start' as const },
  ]);

  const panelWidth = createMemo(() =>
    Math.max(52, Math.min(96, Math.floor(dims().width * 0.7))),
  );
  const panelHeight = createMemo(() => Math.min(rows().length + 4, dims().height - 4));

  function move(delta: number): void {
    setActive(current => (current + delta + rows().length) % rows().length);
  }

  function choose(): void {
    const entry = rows()[active()];
    if (!entry) return;
    if (entry.kind === 'start') props.onStart();
    else if (entry.role) props.onSelectRole(entry.role);
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
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
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
        height={panelHeight()}
        backgroundColor="#121212"
        flexDirection="column"
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation();
        }}
      >
        <text fg="#ffffff" wrapMode="none" truncate>
          {' ⚙️  Orquestrador Vaktor — ↑↓ move · Enter seleciona · Esc fecha'}
        </text>
        <text fg="#8b949e" wrapMode="none" truncate>
          {props.taskPrompt.trim()
            ? ` tarefa: ${props.taskPrompt.trim().slice(0, 110)}`
            : ' tarefa: use /orquestrator <tarefa> para definir o prompt'}
        </text>
        <For each={rows()}>
          {(entry, index) => {
            const selected = () => index() === active();
            if (entry.kind === 'start') {
              return (
                <box
                  flexDirection="row"
                  width="100%"
                  height={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selected() ? '#1f6feb' : '#121212'}
                  onMouseDown={(event: MouseEvent) => {
                    if (event.button !== MouseButton.LEFT) return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onStart();
                  }}
                >
                  <text fg={selected() ? '#ffffff' : '#e6edf3'} wrapMode="none" truncate>
                    {`🚀 Iniciar Orquestração da Tarefa`}
                  </text>
                </box>
              );
            }
            const role = entry.role;
            if (!role) return null;
            const definition = ORCHESTRATOR_ROLES.find(item => item.id === role);
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
                  props.onSelectRole(role);
                }}
              >
                <text fg={selected() ? '#ffffff' : '#e6edf3'} wrapMode="none" truncate width={26}>
                  {`${definition?.icon ?? '•'} ${roleLabel(role)}`}
                </text>
                <text
                  fg={selected() ? '#dbe9ff' : '#8b949e'}
                  wrapMode="none"
                  truncate
                  flexGrow={1}
                >
                  {modelSummary(props.assignments[role])}
                </text>
              </box>
            );
          }}
        </For>
        <Show when={!props.taskPrompt.trim()}>
          <text fg="#d29922" wrapMode="none" truncate>
            {' informe a tarefa junto do comando para iniciar'}
          </text>
        </Show>
      </box>
    </box>
  );
}
