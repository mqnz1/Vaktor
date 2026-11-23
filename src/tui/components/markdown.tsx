import { createMemo, onCleanup, Show, type Accessor } from 'solid-js';
import {
  getTreeSitterClient,
  SyntaxStyle,
  type MarkdownRenderable,
  type StyleDefinitionInput,
} from '@opentui/core';
import { useRenderer } from '@opentui/solid';

const MARKDOWN_STYLES: Record<string, StyleDefinitionInput> = {
  default: { fg: '#e6edf3' },
  'markup.heading': { fg: '#79c0ff', bold: true },
  'markup.strong': { fg: '#ffffff', bold: true },
  'markup.italic': { fg: '#d2a8ff', italic: true },
  'markup.strikethrough': { fg: '#8b949e', dim: true },
  'markup.raw': { fg: '#a5d6ff', bg: '#161b22' },
  'markup.quote': { fg: '#8b949e', italic: true },
  'markup.list': { fg: '#ffa657', bold: true },
  'markup.link': { fg: '#58a6ff', underline: true },
  'markup.link.label': { fg: '#58a6ff', underline: true },
  'markup.link.url': { fg: '#79c0ff', underline: true },
  'punctuation.special': { fg: '#ffa657' },
  keyword: { fg: '#ff7b72' },
  'keyword.control': { fg: '#ff7b72' },
  'keyword.operator': { fg: '#ff7b72' },
  'keyword.function': { fg: '#ff7b72' },
  'keyword.return': { fg: '#ff7b72' },
  'keyword.import': { fg: '#ff7b72' },
  string: { fg: '#a5d6ff' },
  'string.special': { fg: '#a5d6ff' },
  'string.escape': { fg: '#79c0ff' },
  'string.regexp': { fg: '#7ee787' },
  comment: { fg: '#8b949e', italic: true },
  'comment.documentation': { fg: '#8b949e', italic: true },
  number: { fg: '#79c0ff' },
  'number.float': { fg: '#79c0ff' },
  boolean: { fg: '#79c0ff' },
  constant: { fg: '#79c0ff' },
  'constant.builtin': { fg: '#79c0ff' },
  function: { fg: '#d2a8ff' },
  'function.call': { fg: '#d2a8ff' },
  'function.method': { fg: '#d2a8ff' },
  method: { fg: '#d2a8ff' },
  type: { fg: '#ffa657' },
  'type.builtin': { fg: '#ffa657' },
  constructor: { fg: '#ffa657' },
  variable: { fg: '#e6edf3' },
  'variable.parameter': { fg: '#ffa657' },
  'variable.builtin': { fg: '#ff7b72' },
  property: { fg: '#79c0ff' },
  operator: { fg: '#ff7b72' },
  punctuation: { fg: '#8b949e' },
  'punctuation.bracket': { fg: '#8b949e' },
  'punctuation.delimiter': { fg: '#8b949e' },
  tag: { fg: '#7ee787' },
  attribute: { fg: '#79c0ff' },
};

export interface MarkdownBlockProps {
  content: string;
  streaming?: boolean;
}

/**
 * Renderiza Markdown nativo do OpenTUI: headings, ênfases, listas,
 * citações, tabelas, regras horizontais e code fences com highlight.
 */
export function MarkdownBlock(props: MarkdownBlockProps) {
  const renderer = useRenderer();
  const style = createMemo(() => {
    try {
      return SyntaxStyle.fromStyles(MARKDOWN_STYLES, renderer.nativeScene);
    } catch {
      return undefined;
    }
  });

  onCleanup(() => {
    style()?.destroy();
  });

  return (
    <Show
      when={style()}
      fallback={
        <text fg="#e6edf3" wrapMode="word">
          {props.content}
        </text>
      }
    >
      {(syntax: Accessor<SyntaxStyle>) => (
        <markdown
          ref={(node: MarkdownRenderable) => {
            node.syntaxStyle = syntax();
          }}
          content={props.content}
          syntaxStyle={syntax()}
          treeSitterClient={getTreeSitterClient()}
          fg="#e6edf3"
          conceal
          concealCode
          streaming={props.streaming === true}
          internalBlockMode="top-level"
          tableOptions={{
            style: 'grid',
            widthMode: 'full',
            wrapMode: 'word',
            borders: true,
            outerBorder: true,
            borderStyle: 'rounded',
            borderColor: '#30363d',
            cellPaddingX: 1,
          }}
        />
      )}
    </Show>
  );
}
