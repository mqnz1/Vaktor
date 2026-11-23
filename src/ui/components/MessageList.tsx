import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage } from '../../types/index.js';
import type { AgentEvent } from '../../agent/types.js';
import { theme } from '../theme.js';
import { formatReasoningForDisplay } from '../../thinking/index.js';
import {
  condenseEvents,
  summarizeOutcome,
  toolLabel,
  truncate,
} from '../agentEvents.js';
import { clipContent, messageLineCount, selectVisibleMessages } from '../layout.js';

interface MessageListProps {
  messages: ChatMessage[];
  isThinking: boolean;
  lastWasCached: boolean;
  thinkingShow: boolean;
  agentEvents?: AgentEvent[];
  agentBusy?: boolean;
  /** Linhas disponíveis para a lista (já descontado o chrome da tela). */
  maxLines: number;
  cols: number;
}

function AgentEventLine({ event }: { event: AgentEvent }): React.ReactElement | null {
  switch (event.type) {
    case 'tool_start':
      return (
        <Box gap={1}>
          <Text color="yellow">●</Text>
          <Text bold>{toolLabel(event.name, event.args)}</Text>
        </Box>
      );
    case 'tool_end': {
      const summary = event.ok ? summarizeOutcome(event.preview) : truncate(event.preview, 90);
      return (
        <Box gap={1}>
          <Text color={event.ok ? 'green' : 'red'}>{event.ok ? '✓' : '✗'}</Text>
          <Text bold>{toolLabel(event.name, event.args)}</Text>
          {summary ? <Text dimColor>{summary}</Text> : null}
        </Box>
      );
    }
    case 'verify_start':
      return (
        <Box gap={1}>
          <Text color="yellow">●</Text>
          <Text bold>{`Verify(${event.command})`}</Text>
        </Box>
      );
    case 'verify_end':
      return (
        <Box gap={1}>
          <Text color={event.ok ? 'green' : 'red'}>{event.ok ? '✓' : '✗'}</Text>
          <Text bold>Verify</Text>
          <Text dimColor>{event.ok ? 'ok' : 'falhou'}</Text>
        </Box>
      );
    case 'repair':
      return (
        <Box gap={1}>
          <Text color="yellow">↻</Text>
          <Text dimColor>{`corrigindo (${event.attempt}/${event.maxAttempts})${event.errors.length > 0 ? ` · ${truncate(event.errors[0] ?? '', 90)}` : ''}`}</Text>
        </Box>
      );
    case 'error':
      return (
        <Box gap={1}>
          <Text color="red">✗</Text>
          <Text bold color="red">{truncate(event.message, 160)}</Text>
        </Box>
      );
    case 'assistant_text':
      return <Text dimColor>{truncate(event.text, 160)}</Text>;
    case 'done':
      return null;
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function MessageContent({ content }: { content: string }): React.ReactElement {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <Box flexDirection="column" gap={0}>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.split('\n');
          const lang = lines[0]?.slice(3).trim() || '';
          const code = lines.slice(1, -1).join('\n');
          return (
            <Box key={i} flexDirection="column" gap={0}>
              {lang ? <Text dimColor>{lang}</Text> : null}
              <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={0}>
                <Text>{code}</Text>
              </Box>
            </Box>
          );
        }
        return <Text key={i} wrap="wrap">{part}</Text>;
      })}
    </Box>
  );
}

export function MessageList({
  messages,
  isThinking,
  lastWasCached,
  thinkingShow,
  agentEvents = [],
  agentBusy = false,
  maxLines,
  cols,
}: MessageListProps): React.ReactElement {
  const [spinner, setSpinner] = React.useState(0);

  React.useEffect(() => {
    if (!isThinking) return;
    const interval = setInterval(() => {
      setSpinner(s => (s + 1) % 10);
    }, 120);
    return () => clearInterval(interval);
  }, [isThinking]);

  const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  // Nunca renderizar mais linhas do que a tela comporta: se o quadro passar da
  // altura do terminal, a tela rola e o Ink passa a apagar linhas erradas
  // (texto de frames antigos fica sobreposto).
  const spinnerLine = isThinking ? 2 : 0;
  const { visible, hidden } = selectVisibleMessages(messages, cols, Math.max(1, maxLines - spinnerLine));
  const hiddenLine = hidden > 0 ? 1 : 0;
  const usedByMessages = visible.reduce((sum, message) => sum + messageLineCount(message, cols), 0);
  const eventsRoom = Math.max(0, Math.min(6, maxLines - hiddenLine - spinnerLine - usedByMessages));

  return (
    <Box flexDirection="column" height={maxLines} flexShrink={0} minHeight={0} paddingX={1} paddingY={0} overflow="hidden">
      {hidden > 0 && (
        <Text dimColor>{`… ${hidden} ${hidden === 1 ? 'mensagem' : 'mensagens'} acima`}</Text>
      )}
      {visible.map((msg, i) => {
        const isUser = msg.role === 'user';
        const isSystem = msg.role === 'system';
        const isLast = i === visible.length - 1;

        if (isSystem) {
          return (
            <Box key={i} paddingX={1} marginY={0}>
              <Text dimColor>{msg.content}</Text>
            </Box>
          );
        }

        // Última mensagem maior que a área: corta o texto para não estourar.
        const content = i === 0 && hiddenLine + usedByMessages > maxLines
          ? clipContent(msg.content, cols, Math.max(2, maxLines - 2))
          : msg.content;

        return (
          <Box key={i} flexDirection="column" gap={0} marginY={0}>
            {isUser ? (
              <Box gap={1}>
                <Text bold>{theme.symbols.user}</Text>
                <Text wrap="wrap">{content}</Text>
              </Box>
            ) : (
              <Box flexDirection="column" gap={0}>
                <Box gap={1}>
                  <Text>{theme.symbols.assistant}</Text>
                  <Text dimColor>{formatTime(msg.timestamp)}</Text>
                  {isLast && lastWasCached && (
                    <Text dimColor>{theme.symbols.cached}</Text>
                  )}
                </Box>
                <Box paddingLeft={2} flexDirection="column">
                  {thinkingShow && msg.reasoning ? (
                    <Box flexDirection="column" marginBottom={0}>
                      <Text dimColor>thinking</Text>
                      <Text dimColor>{formatReasoningForDisplay(msg.reasoning, 12)}</Text>
                    </Box>
                  ) : null}
                  <MessageContent content={content} />
                </Box>
              </Box>
            )}
          </Box>
        );
      })}

      {agentEvents.length > 0 && eventsRoom > 0 && condenseEvents(agentEvents).slice(-eventsRoom).map((event, i) => (
        <Box key={`event-${i}`} paddingX={1}>
          <AgentEventLine event={event} />
        </Box>
      ))}

      {isThinking && (
        <Box flexDirection="column" marginTop={0}>
          <Box gap={1}>
            <Text>{spinnerChars[spinner]}</Text>
            <Text dimColor>{agentBusy ? 'Agent working...' : 'Thinking...'}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
