import { createSignal } from 'solid-js';
import { useKeyboard, usePaste } from '@opentui/solid';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { decodePasteBytes, stripAnsiSequences, type MouseEvent, type PasteEvent } from '@opentui/core';
import { readHostClipboard, writeHostClipboard } from '../clipboard.js';

export interface DirectoryPromptProps {
  initial: string;
  onConfirm: (path: string) => void;
  onClose: () => void;
  onCopy?: (text: string) => void;
}

function expandHome(raw: string): string {
  if (raw === '~') return homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return resolve(homedir(), raw.slice(2));
  return raw;
}

export function DirectoryPrompt(props: DirectoryPromptProps) {
  const [value, setValue] = createSignal(props.initial);
  const [error, setError] = createSignal<string | null>(null);

  const shown = () => {
    const text = value();
    return text.length > 56 ? `…${text.slice(-55)}` : text;
  };

  usePaste((event: PasteEvent) => {
    const text = stripAnsiSequences(decodePasteBytes(event.bytes));
    const pasted = text.replace(/[\r\n]+/g, '').trim();
    if (!pasted) return;
    event.preventDefault();
    event.stopPropagation();
    setError(null);
    setValue(current => current + pasted);
  });

  useKeyboard(key => {
    if (key.name === 'escape') {
      key.preventDefault();
      props.onClose();
      return;
    }
    if (key.ctrl && key.name === 'v') {
      key.preventDefault();
      key.stopPropagation();
      void readHostClipboard().then(text => {
        const pasted = text.replace(/[\r\n]+/g, '').trim();
        if (!pasted) return;
        setError(null);
        setValue(current => current + pasted);
      });
      return;
    }
    if (key.ctrl && key.name === 'c') {
      key.preventDefault();
      key.stopPropagation();
      const text = value().trim();
      if (!text) return;
      if (props.onCopy) props.onCopy(text);
      else writeHostClipboard(text);
      return;
    }
    if (key.name === 'return' || key.name === 'kpenter' || key.name === 'linefeed') {
      key.preventDefault();
      const raw = value().trim();
      if (raw.length === 0) {
        setError('Digite um caminho');
        return;
      }
      const target = expandHome(raw).startsWith('/') || expandHome(raw).match(/^[a-z]:/i)
        ? expandHome(raw)
        : resolve(props.initial, expandHome(raw));
      try {
        if (!statSync(target).isDirectory()) {
          setError('Esse caminho não é um diretório');
          return;
        }
      } catch {
        setError('Diretório não encontrado');
        return;
      }
      props.onConfirm(target);
      return;
    }
    if (key.name === 'backspace') {
      key.preventDefault();
      setError(null);
      setValue(current => current.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.option) return;
    const sequence = key.sequence;
    if (sequence.length === 1 && sequence >= ' ') {
      key.preventDefault();
      setError(null);
      setValue(current => current + sequence);
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
      zIndex={30}
      onMouseDown={() => props.onClose()}
    >
      <box
        width={68}
        backgroundColor="#121212"
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation();
        }}
      >
        <text fg="#ffffff" wrapMode="none" truncate>
          Diretório de trabalho
        </text>
        <text fg="#8b949e" wrapMode="none" truncate>
          {`Atual: ${props.initial}`}
        </text>
        <box flexDirection="row" columnGap={1} height={1}>
          <text fg="#ffffff" wrapMode="none">
            ›
          </text>
          <text fg="#e6edf3" wrapMode="none" truncate>
            {`${shown()}█`}
          </text>
        </box>
        <text fg={error() ? '#ff7b72' : '#8b949e'} wrapMode="none" truncate>
          {error() ?? 'Enter confirma · Ctrl+V cola · Ctrl+C copia · Esc fecha'}
        </text>
      </box>
    </box>
  );
}
