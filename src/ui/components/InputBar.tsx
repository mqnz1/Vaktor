import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { exec } from 'child_process';
import { clipInput } from '../layout.js';
import type { PromptCommand } from '../commands.js';

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (v: string) => void;
  onEscape: () => void;
  onToggleThinking: () => void;
  isThinking: boolean;
  overlayOpen: boolean;
  /** Comandos do menu (já filtrados e cortados pelo App). */
  menuCommands: readonly PromptCommand[];
  /** true quando o App já reservou espaço para o menu. */
  menuOpen: boolean;
  cols?: number;
}

const PLACEHOLDER = 'Type your message or @path/to/file';

export function InputBar({
  value,
  onChange,
  onSubmit,
  onEscape,
  onToggleThinking,
  isThinking,
  overlayOpen,
  menuCommands,
  menuOpen,
  cols,
}: InputBarProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [blink, setBlink] = useState(true);
  const width = cols || process.stdout.columns || 120;

  // Blinking cursor — only when idle (no text, not thinking)
  useEffect(() => {
    if (value || isThinking) return;
    const interval = setInterval(() => {
      setBlink(b => !b);
    }, 900);
    return () => clearInterval(interval);
  }, [value, isThinking]);

  const showAutocomplete = menuOpen && menuCommands.length > 0;

  // Se o menu encolheu, o cursor não pode apontar para fora dele.
  useEffect(() => {
    setCursor(c => Math.min(c, Math.max(0, menuCommands.length - 1)));
  }, [menuCommands.length]);

  const submit = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange('');
    setCursor(0);
    onSubmit(trimmed);
  }, [onChange, onSubmit]);

  useInput(useCallback((input: string, key: any) => {
    // Ctrl+C — clear input if there's text (terminal handles copy when text is selected)
    if (key.ctrl && (input === '\x03' || input === 'c' || input === 'C')) {
      if (value) {
        onChange('');
        setCursor(0);
      }
      return;
    }

    // Ctrl+V — paste from clipboard
    if (key.ctrl && (input === '\x16' || input === 'v' || input === 'V')) {
      exec('powershell -noProfile -command Get-Clipboard', { encoding: 'utf8' }, (err, stdout) => {
        if (!err && stdout) {
          const text = stdout.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '').trim();
          if (text) {
            onChange(value + text);
          }
        }
      });
      return;
    }

    if (key.escape) {
      if (overlayOpen) onEscape();
      return;
    }

    // Enquanto um overlay está aberto, o teclado pertence a ele.
    // Sem isso, Enter/TAB executariam a ação do menu E a do prompt.
    if (overlayOpen) return;

    // TAB alterna o thinking somente quando o prompt está ativo.
    if (key.tab && !showAutocomplete) {
      onToggleThinking();
      return;
    }

    if (isThinking) return;

    if (showAutocomplete) {
      if (key.upArrow) {
        setCursor(c => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor(c => Math.min(menuCommands.length - 1, c + 1));
        return;
      }
      if (key.tab) {
        onChange(menuCommands[cursor]?.cmd ?? value);
        setCursor(0);
        return;
      }
    }

    if (key.return) {
      submit(value);
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      setCursor(0);
      return;
    }

    if (key.ctrl || key.meta) return;
    if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) return;
    if (key.pageUp || key.pageDown) return;

    if (input && input.length > 0 && input.charCodeAt(0) >= 32) {
      onChange(value + input);
    }
  }, [value, isThinking, showAutocomplete, menuCommands, cursor, overlayOpen, onChange, onSubmit, onEscape, onToggleThinking, submit]));

  // Cursor is solid while typing, blinks when idle
  const showCursor = value.length > 0 || blink;
  const shownValue = clipInput(value, width);

  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      {/* Autocomplete — altura já reservada pelo App antes de renderizar */}
      {showAutocomplete && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
          {menuCommands.map((cmd, i) => (
            <Box key={cmd.cmd} gap={1}>
              <Text bold={i === cursor} dimColor={i !== cursor}>
                {i === cursor ? '›' : ' '}
              </Text>
              <Text bold={i === cursor} dimColor={i !== cursor} wrap="truncate-end">
                {cmd.cmd}
              </Text>
              <Text dimColor wrap="truncate-end">{cmd.desc}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Prompt — caixa arredondada minimalista, no estilo das CLIs modernas */}
      <Box borderStyle="round" borderColor="gray" paddingX={1} width="100%">
        <Box gap={1}>
          <Text bold color="cyan">{'>'}</Text>
          {isThinking ? (
            <Text dimColor>waiting...</Text>
          ) : value ? (
            <Text wrap="truncate-end">
              {shownValue}
              {showCursor && <Text bold>█</Text>}
            </Text>
          ) : (
            <Box gap={1}>
              <Text>{showCursor ? '█' : ' '}</Text>
              <Text dimColor wrap="truncate-end">{PLACEHOLDER}</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
