import { createEffect } from 'solid-js';
import { useKeyboard, usePaste } from '@opentui/solid';
import {
  decodePasteBytes,
  defaultTextareaKeyBindings,
  stripAnsiSequences,
  type MouseEvent,
  type PasteEvent,
  type TextareaRenderable,
} from '@opentui/core';
import { PROMPT_BG } from '../theme.js';
import { readHostClipboard } from '../clipboard.js';

export interface InputBarProps {
  value: string;
  workdir: string;
  focused: boolean;
  busy: boolean;
  onChooseDirectory: () => void;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
}

// Enter envia, Shift+Enter quebra linha. O Ctrl+U é reservado para o
// painel de comandos, então sai dos atalhos nativos do textarea.
const KEY_BINDINGS = [
  ...defaultTextareaKeyBindings.filter(
    binding =>
      binding.name !== 'return' &&
      binding.name !== 'kpenter' &&
      binding.name !== 'linefeed' &&
      !(binding.ctrl && binding.name === 'u'),
  ),
  { name: 'return', action: 'submit' as const },
  { name: 'kpenter', action: 'submit' as const },
  { name: 'linefeed', action: 'submit' as const },
  { name: 'return', shift: true, action: 'newline' as const },
  { name: 'kpenter', shift: true, action: 'newline' as const },
];

export function InputBar(props: InputBarProps) {
  let textarea: TextareaRenderable | undefined;

  createEffect(() => {
    const value = props.value;
    if (!textarea) return;
    if (textarea.plainText !== value) {
      textarea.setText(value);
      textarea.gotoBufferEnd();
    }
  });

  useKeyboard(key => {
    if (!(key.ctrl && key.name === 'v') || !props.focused) return;
    key.preventDefault();
    key.stopPropagation();
    void readHostClipboard().then(text => {
      if (!text || !textarea) return;
      textarea.insertText(text);
      props.onInput(textarea.plainText);
    });
  });

  usePaste((event: PasteEvent) => {
    if (!props.focused) return;
    const text = stripAnsiSequences(decodePasteBytes(event.bytes));
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    if (!textarea) return;
    textarea.insertText(text);
    props.onInput(textarea.plainText);
  });

  return (
    <box flexDirection="column" width="100%" height={7}>
      <box
        flexDirection="row"
        width="100%"
        height={4}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={PROMPT_BG}
      >
        <textarea
          ref={(el: TextareaRenderable) => {
            textarea = el;
          }}
          flexGrow={1}
          focused={props.focused}
          initialValue={props.value}
          placeholder={props.busy ? 'aguarde a resposta…' : 'mensagem  (/ para comandos)'}
          placeholderColor="#6e7681"
          backgroundColor={PROMPT_BG}
          focusedBackgroundColor={PROMPT_BG}
          textColor="#e6edf3"
          focusedTextColor="#e6edf3"
          wrapMode="word"
          keyBindings={KEY_BINDINGS}
          onContentChange={() => props.onInput(textarea?.plainText ?? '')}
          onSubmit={() => props.onSubmit(textarea?.plainText ?? props.value)}
        />
      </box>
      <box
        flexDirection="row"
        alignItems="center"
        width="100%"
        height={3}
        paddingLeft={1}
        paddingRight={1}
        columnGap={1}
        backgroundColor={PROMPT_BG}
        border
        borderStyle="rounded"
        borderColor="#252b33"
      >
        <text
          fg="#8b949e"
          wrapMode="none"
          truncate
          onMouseDown={(event: MouseEvent) => {
            event.stopPropagation();
            props.onChooseDirectory();
          }}
        >
          {props.workdir}
        </text>
      </box>
    </box>
  );
}
