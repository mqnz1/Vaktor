import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { PendingConfirm } from '../../agent/types.js';
import { confirmDetailLines } from '../layout.js';

interface ConfirmWriteProps {
  pending: PendingConfirm;
  onResolve: (ok: boolean) => void;
  /** Altura do terminal — a caixa encolhe em vez de estourar o quadro. */
  rows: number;
}

export function ConfirmWrite({ pending, onResolve, rows }: ConfirmWriteProps): React.ReactElement {
  useInput((input, key) => {
    if (key.escape) {
      onResolve(false);
      return;
    }
    const lower = input.toLowerCase();
    if (lower === 'y') {
      onResolve(true);
      return;
    }
    if (lower === 'n' || key.return) {
      onResolve(false);
    }
  });

  const detailLines = pending.detail.split('\n').slice(0, confirmDetailLines(rows));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={pending.path ? 'gray' : 'yellow'}
      paddingX={1}
      marginX={1}
      marginBottom={1}
      flexShrink={0}
      flexGrow={1}
      overflow="hidden"
    >
      <Text bold wrap="truncate-end">{pending.title}</Text>
      {detailLines.map((line, index) => (
        <Text key={index} dimColor wrap="truncate-end">{line.slice(0, 200)}</Text>
      ))}
      <Text dimColor wrap="truncate-end">y confirma · n/Esc cancela</Text>
    </Box>
  );
}
