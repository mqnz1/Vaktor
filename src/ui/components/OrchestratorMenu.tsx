import React from 'react';
import { Box, Text, useInput } from 'ink';
import { ownerOf, parseModelRef, providerLabel } from '../../providers/registry.js';
import {
  ORCHESTRATOR_ROLES,
  roleLabel,
  type OrchestratorAssignments,
  type OrchestratorRole,
} from '../../orchestrator/types.js';

interface OrchestratorMenuProps {
  assignments: OrchestratorAssignments;
  taskPrompt: string;
  onSelectRole: (role: OrchestratorRole) => void;
  onStart: () => void;
  onClose: () => void;
  rows?: number;
}

interface MenuRow {
  kind: 'role' | 'start';
  role?: OrchestratorRole;
}

function modelSummary(modelId: string): string {
  if (!modelId) return '(não definido)';
  const provider = ownerOf(modelId);
  return `${parseModelRef(modelId).id} · ${providerLabel(provider)}`;
}

export function OrchestratorMenu({
  assignments,
  taskPrompt,
  onSelectRole,
  onStart,
  onClose,
  rows: rowsProp,
}: OrchestratorMenuProps): React.ReactElement {
  const entries: MenuRow[] = [
    ...ORCHESTRATOR_ROLES.map(role => ({ kind: 'role' as const, role: role.id })),
    { kind: 'start' as const },
  ];
  const [cursor, setCursor] = React.useState(0);

  // Em terminais baixos a lista inteira não cabe: limita e deixa o cursor
  // navegar com scroll simples.
  const rows = rowsProp || process.stdout.rows || 40;
  const capacity = Math.max(4, Math.min(entries.length, rows - 14));
  const start = Math.max(0, Math.min(cursor - Math.floor(capacity / 2), entries.length - capacity));
  const visible = entries.slice(start, start + capacity);

  useInput((_, key) => {
    if (key.upArrow) {
      setCursor(current => (current - 1 + entries.length) % entries.length);
    }
    if (key.downArrow) {
      setCursor(current => (current + 1) % entries.length);
    }
    if (key.return) {
      const entry = entries[cursor];
      if (!entry) return;
      if (entry.kind === 'start') onStart();
      else if (entry.role) onSelectRole(entry.role);
    }
    if (key.escape) onClose();
  });

  return (
    <Box paddingX={1} flexShrink={0}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        width="100%"
        overflow="hidden"
      >
        <Box gap={1}>
          <Text bold color="cyan" wrap="truncate-end">
            ⚙️ Orquestrador Vaktor
          </Text>
          <Text dimColor wrap="truncate-end">
            ↑↓ move · enter seleciona · esc fecha
          </Text>
        </Box>

        <Box>
          <Text dimColor wrap="truncate-end">
            {taskPrompt.trim()
              ? `Tarefa: ${taskPrompt.trim().slice(0, 120)}`
              : 'Tarefa: use /orquestrator <tarefa> para definir o prompt'}
          </Text>
        </Box>

        {visible.map((entry, index) => {
          const absolute = start + index;
          const isCursor = absolute === cursor;
          if (entry.kind === 'start') {
            return (
              <Box key="start" gap={1}>
                <Text {...(isCursor ? { color: 'cyan' } : {})} dimColor={!isCursor}>
                  {isCursor ? '›' : ' '}
                </Text>
                <Text bold={isCursor} {...(isCursor ? { color: 'cyan' } : {})} dimColor={!isCursor}>
                  🚀 Iniciar Orquestração da Tarefa
                </Text>
              </Box>
            );
          }

          const role = entry.role;
          if (!role) return null;
          const definition = ORCHESTRATOR_ROLES.find(item => item.id === role);
          return (
            <Box key={role} gap={1}>
              <Text {...(isCursor ? { color: 'cyan' } : {})} dimColor={!isCursor}>
                {isCursor ? '›' : ' '}
              </Text>
              <Text bold={isCursor} {...(isCursor ? { color: 'cyan' } : {})} dimColor={!isCursor}>
                {definition?.icon ?? '•'} {roleLabel(role)}
              </Text>
              <Text dimColor wrap="truncate-end">
                {modelSummary(assignments[role])}
              </Text>
            </Box>
          );
        })}

        {entries.length > capacity && (
          <Text dimColor wrap="truncate-end">
            {`${start > 0 ? '↑ mais · ' : ''}${start + capacity < entries.length ? '↓ mais · ' : ''}${cursor + 1}/${entries.length}`}
          </Text>
        )}
      </Box>
    </Box>
  );
}
