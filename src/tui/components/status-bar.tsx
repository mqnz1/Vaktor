import { Show } from 'solid-js';

export interface StatusBarProps {
  notice: string | null;
  width: number;
  creditsSpentUsd: number;
  percentUsed: number;
  model: string;
}

// Rodapé minimalista: atalho da lista de comandos à esquerda e, à direita,
// créditos gastos, percentual usado e modelo atual. Avisos temporários
// aparecem em uma linha acima.
const HINT = 'Ctrl+U commands';

export function StatusBar(props: StatusBarProps) {
  const stats = () =>
    `$${props.creditsSpentUsd.toFixed(4)} (${props.percentUsed.toFixed(1)}%) ${props.model}`;

  return (
    <box flexDirection="column" width="100%" height={props.notice ? 2 : 1}>
      <Show when={props.notice}>
        <text fg="#d29922" wrapMode="none" truncate width={props.width || '100%'}>
          {props.notice}
        </text>
      </Show>
      <box flexDirection="row" width="100%" justifyContent="space-between">
        <text fg="#484f58" wrapMode="none">
          {HINT}
        </text>
        <text fg="#484f58" wrapMode="none" truncate>
          {stats()}
        </text>
      </box>
    </box>
  );
}
