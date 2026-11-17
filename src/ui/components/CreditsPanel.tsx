import React from 'react';
import { Box, Text } from 'ink';
import type { CreditStats } from '../../types/index.js';
import { parseModelRef } from '../../providers/registry.js';

interface CreditsPanelProps {
  stats: CreditStats;
}

export function CreditsPanel({ stats }: CreditsPanelProps): React.ReactElement {
  const barTotal = 30;
  const filled = Math.round((stats.percentUsed / 100) * barTotal);
  const empty = barTotal - filled;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1} overflow="hidden">
      <Text bold>Session Credits</Text>
      <Text dimColor> Esc to close</Text>

      <Box marginY={1} flexDirection="column">
        <Box gap={1}>
          <Text>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(empty)}</Text>
          <Text> {stats.percentUsed.toFixed(1)}% used</Text>
        </Box>
        <Text dimColor>
          ${stats.totalCostUsd.toFixed(5)} of ${stats.budgetUsd.toFixed(2)} · remaining: ${stats.remainingUsd.toFixed(5)}
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Tokens</Text>
        <Text>Input: {stats.totalInputTokens.toLocaleString('en-US')}</Text>
        <Text>Output: {stats.totalOutputTokens.toLocaleString('en-US')}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Cache</Text>
        <Text dimColor>
          {stats.cacheHits} hits · saved ${stats.savedByCache.toFixed(5)}
        </Text>
      </Box>

      {stats.usageHistory.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Recent calls</Text>
          {stats.usageHistory.slice(-5).reverse().map((u, i) => (
            <Box key={i} gap={1}>
              <Text dimColor>
                {new Date(u.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Text>
              <Text dimColor={u.fromCache}>{parseModelRef(u.model).id}</Text>
              <Text dimColor>${u.estimatedCostUsd.toFixed(5)}{u.fromCache ? ' [cache]' : ''}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
