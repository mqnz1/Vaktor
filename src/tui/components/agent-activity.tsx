import { createMemo, For, Show } from 'solid-js';
import type { AgentEvent } from '../../agent/types.js';
import type { AgentRunSummary } from '../../types/index.js';
import {
  condenseEvents,
  summarizeOutcome,
  toolLabel,
  truncate,
} from '../../ui/agentEvents.js';

const MAX_EVENTS = 8;

function diffColor(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return '#58a6ff';
  if (line.startsWith('@@')) return '#79c0ff';
  if (line.startsWith('+')) return '#3fb950';
  if (line.startsWith('-')) return '#f85149';
  return '#8b949e';
}

export function DiffView(props: {
  diff: string;
  maxLines?: number;
  title?: string;
}) {
  const parsed = createMemo(() => {
    const lines = props.diff.split(/\r?\n/);
    const limit = props.maxLines ?? 80;
    return {
      lines: lines.slice(0, limit),
      hidden: Math.max(0, lines.length - limit),
    };
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      marginTop={1}
      border={['left']}
      borderColor="#30363d"
      paddingLeft={1}
    >
      <text fg="#58a6ff" wrapMode="none">
        {props.title ?? 'Diff'}
      </text>
      <For each={parsed().lines}>
        {line => (
          <text fg={diffColor(line)} wrapMode="none" truncate>
            {line.length > 0 ? line : ' '}
          </text>
        )}
      </For>
      <Show when={parsed().hidden > 0}>
        <text fg="#484f58">… {parsed().hidden} linhas ocultas</text>
      </Show>
    </box>
  );
}

function OutputBlock(props: { output: string; maxLines?: number }) {
  const lines = createMemo(() => {
    const all = props.output.split(/\r?\n/).filter(line => line.trim().length > 0);
    return all.slice(-(props.maxLines ?? 6));
  });

  return (
    <box flexDirection="column" paddingLeft={2}>
      <For each={lines()}>
        {line => (
          <text fg="#8b949e" wrapMode="none" truncate>
            {truncate(line, 160)}
          </text>
        )}
      </For>
    </box>
  );
}

function AgentEventLine(props: { event: AgentEvent }) {
  const event = props.event;
  switch (event.type) {
    case 'tool_start':
      return (
        <box flexDirection="row" columnGap={1}>
          <text fg="#d29922">●</text>
          <text fg="#e6edf3">{toolLabel(event.name, event.args)}</text>
        </box>
      );
    case 'tool_end': {
      const summary = event.ok
        ? summarizeOutcome(event.preview)
        : truncate(event.preview, 90);
      return (
        <box flexDirection="column">
          <box flexDirection="row" columnGap={1}>
            <text fg={event.ok ? '#3fb950' : '#f85149'}>{event.ok ? '✓' : '✗'}</text>
            <text fg="#e6edf3">{toolLabel(event.name, event.args)}</text>
            <Show when={summary.length > 0}>
              <text fg="#8b949e">{summary}</text>
            </Show>
          </box>
          <Show when={event.name === 'run_command' && !event.ok}>
            <OutputBlock output={event.preview} maxLines={3} />
          </Show>
        </box>
      );
    }
    case 'verify_start':
      return (
        <box flexDirection="row" columnGap={1}>
          <text fg="#d29922">●</text>
          <text fg="#e6edf3">Verify({truncate(event.command, 70)})</text>
        </box>
      );
    case 'verify_end':
      return (
        <box flexDirection="column">
          <box flexDirection="row" columnGap={1}>
            <text fg={event.ok ? '#3fb950' : '#f85149'}>{event.ok ? '✓' : '✗'}</text>
            <text fg="#e6edf3">Verify</text>
            <text fg="#8b949e">{event.ok ? 'ok' : 'falhou'}</text>
          </box>
          <Show when={!event.ok && event.output.trim().length > 0}>
            <OutputBlock output={event.output} maxLines={8} />
          </Show>
        </box>
      );
    case 'repair':
      return (
        <box flexDirection="row" columnGap={1}>
          <text fg="#d29922">↻</text>
          <text fg="#8b949e">
            {`corrigindo (${event.attempt}/${event.maxAttempts})`}
            {event.errors[0] ? ` · ${truncate(event.errors[0], 100)}` : ''}
          </text>
        </box>
      );
    case 'assistant_text':
      return (
        <box flexDirection="row" columnGap={1}>
          <text fg="#58a6ff">◆</text>
          <text fg="#8b949e">{truncate(event.text, 160)}</text>
        </box>
      );
    case 'error':
      return (
        <box flexDirection="row" columnGap={1}>
          <text fg="#f85149">✗</text>
          <text fg="#f85149">{truncate(event.message, 160)}</text>
        </box>
      );
    case 'done':
      return (
        <box flexDirection="row" columnGap={1}>
          <text fg="#3fb950">■</text>
          <text fg="#8b949e">
            {`concluído · ${event.toolCalls} ferramentas · ${event.iterations} iterações`}
          </text>
        </box>
      );
  }
}

function activityLabel(events: readonly AgentEvent[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!event) continue;
    switch (event.type) {
      case 'tool_start':
        return `executando ${toolLabel(event.name, event.args)}`;
      case 'tool_end':
        return event.ok
          ? `concluído ${toolLabel(event.name, event.args)}`
          : `falhou ${toolLabel(event.name, event.args)}`;
      case 'verify_start':
        return `verificando ${truncate(event.command, 50)}`;
      case 'verify_end':
        return event.ok ? 'verificação concluída' : 'verificação falhou';
      case 'repair':
        return `corrigindo (${event.attempt}/${event.maxAttempts})`;
      case 'assistant_text':
        return 'concluindo resposta';
      case 'error':
        return 'erro na execução';
      case 'done':
        return 'concluído';
    }
  }
  return 'pensando';
}

function summary(agent: AgentRunSummary | undefined): string {
  if (!agent) return 'agente';
  const parts = [agent.ok ? 'ok' : 'falhou'];
  parts.push(`${agent.toolCalls} ferramentas`);
  if (agent.modifiedFiles.length > 0) {
    parts.push(`${agent.modifiedFiles.length} arquivos`);
  }
  if (agent.verify.ran) parts.push(agent.verify.ok ? 'verify ok' : 'verify falhou');
  return parts.join(' · ');
}

export interface AgentActivityProps {
  events: readonly AgentEvent[];
  agent?: AgentRunSummary;
  streaming?: boolean;
  spinner?: string;
}

export function AgentActivity(props: AgentActivityProps) {
  const visible = createMemo(() => condenseEvents(props.events).slice(-MAX_EVENTS));
  const status = createMemo(() => activityLabel(props.events));

  return (
    <box
      flexDirection="column"
      width="100%"
      marginTop={1}
      border={['left']}
      borderColor="#30363d"
      paddingLeft={1}
    >
      <text fg="#8b949e" wrapMode="word">
        {props.streaming
          ? `${props.spinner ?? '⠋'} ${status()}`
          : `◆ ${summary(props.agent)}`}
      </text>
      <For each={visible()}>
        {event => <AgentEventLine event={event} />}
      </For>
      <Show when={props.agent?.diff}>
        <DiffView diff={props.agent?.diff ?? ''} maxLines={60} />
      </Show>
    </box>
  );
}
