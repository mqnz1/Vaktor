import React from 'react';
import { Box, Text } from 'ink';
import type { UINotification } from '../../types/index.js';

interface NotificationProps {
  notifications: UINotification[];
}

export function NotificationBar({ notifications }: NotificationProps): React.ReactElement | null {
  if (notifications.length === 0) return null;
  const latest = notifications[notifications.length - 1];
  if (!latest) return null;

  const iconMap = {
    info: '·',
    warning: '!',
    success: '✓',
    error: '✗',
  } as const;

  return (
    <Box paddingX={1}>
      <Text dimColor wrap="truncate-end">
        {iconMap[latest.type]} {latest.message}
      </Text>
    </Box>
  );
}
