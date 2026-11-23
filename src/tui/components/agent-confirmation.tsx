// =============================================================
// Modal de confirmação visual para ações do agente
// Estilo: Claude Code / OpenCode - mostra diff, permite edição
// =============================================================
import { Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import type { MouseEvent } from '@opentui/core';
import type { PendingConfirm } from '../../agent/types.js';

export interface AgentConfirmationProps {
  pending: PendingConfirm | null;
  onApprove: () => void;
  onReject: () => void;
}

export function AgentConfirmation(props: AgentConfirmationProps) {
  useKeyboard(key => {
    if (!props.pending) return;

    if (key.name === 'escape') {
      key.preventDefault();
      props.onReject();
      return;
    }

    // Ctrl+Enter = Approve
    if ((key.name === 'return' || key.name === 'kpenter') && (key.ctrl || key.meta)) {
      key.preventDefault();
      props.onApprove();
      return;
    }
  });

  const kindEmoji = () => {
    const kind = props.pending?.kind;
    switch (kind) {
      case 'create':
        return '✨';
      case 'overwrite':
        return '♻️';
      case 'patch':
        return '📝';
      case 'install':
        return '📦';
      case 'commit':
        return '💾';
      case 'push':
        return '🚀';
      case 'pr':
        return '🔀';
      default:
        return '⚙️';
    }
  };

  return (
    <Show when={props.pending}>
      {(pending: () => PendingConfirm) => (
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          backgroundColor="rgba(0, 0, 0, 0.8)"
          justifyContent="center"
          alignItems="center"
          zIndex={100}
          onMouseDown={() => props.onReject()}
        >
          <box
            width="80%"
            height="80%"
            backgroundColor="#0d1117"
            border
            borderColor="#30363d"
            flexDirection="column"
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            onMouseDown={(event: MouseEvent) => {
              event.stopPropagation();
            }}
          >
            {/* Header */}
            <box flexDirection="row" columnGap={1} marginBottom={1}>
              <text fg="#58a6ff">
                {kindEmoji()} {pending().title}
              </text>
              <box flexGrow={1} />
              <text fg="#8b949e">
                [ESC rejeita] [Ctrl+Enter aprova]
              </text>
            </box>

            {/* Content */}
            <box
              flexDirection="column"
              flexGrow={1}
              border
              borderColor="#30363d"
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg="#8b949e" wrapMode="word" truncate>
                {pending().detail}
              </text>
              <Show when={pending().path}>
                {(path: () => string | undefined) => (
                  <text fg="#79c0ff" marginTop={1} wrapMode="word" truncate>
                    📁 {path()}
                  </text>
                )}
              </Show>
            </box>

            {/* Actions */}
            <box
              flexDirection="row"
              columnGap={2}
              marginTop={1}
              justifyContent="flex-end"
            >
              <box
                flexDirection="row"
                columnGap={1}
                paddingLeft={1}
                paddingRight={1}
                border
                borderColor="#30363d"
                onMouseDown={() => props.onReject()}
              >
                <text fg="#f85149">
                  ✕ Rejeitar
                </text>
              </box>
              <box
                flexDirection="row"
                columnGap={1}
                paddingLeft={1}
                paddingRight={1}
                border
                borderColor="#238636"
                backgroundColor="#0d6e1f"
                onMouseDown={() => props.onApprove()}
              >
                <text fg="#3fb950">
                  ✓ Aprovar
                </text>
              </box>
            </box>
          </box>
        </box>
      )}
    </Show>
  );
}
