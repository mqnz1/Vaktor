import React from 'react';
import { Box, Text } from 'ink';
import type { RouterState } from '../../types/index.js';
import { footerLabel } from '../../thinking/index.js';

interface FooterProps {
  state: RouterState;
  agentTools?: number;
  verifyStatus?: 'ok' | 'fail' | null;
  cols?: number;
}

export function Footer({ state, agentTools = 0, verifyStatus = null, cols }: FooterProps): React.ReactElement {
  const width = cols || process.stdout.columns || 120;
  const wide = width >= 60;
  const agentOn = state.appMode === 'code' && state.agentEnabled;

  const parts: string[] = [agentOn ? 'agent on' : 'agent off'];
  if (agentOn) parts.push(`tools ${agentTools}`);
  if (verifyStatus) parts.push(`verify ${verifyStatus}`);
  if (state.skillsEnabled && wide) parts.push(`skills ${state.activeSkills.length}`);
  parts.push(footerLabel(state.thinkingEnabled, state.thinkingMode));
  if (wide) parts.push('tab toggle', '/ commands');

  return (
    <Box justifyContent="flex-end" paddingX={1} flexShrink={0}>
      <Text dimColor wrap="truncate-end">{parts.join(' · ')}</Text>
    </Box>
  );
}
