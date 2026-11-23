import { MouseButton, type MouseEvent } from '@opentui/core';

export interface UpdateNoticeProps {
  version: string;
  installing: boolean;
  onInstall: () => void;
  onLater: () => void;
}

export function UpdateNotice(props: UpdateNoticeProps) {
  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      backgroundColor="#161b22"
      paddingLeft={1}
      paddingRight={1}
      columnGap={1}
      alignItems="center"
    >
      <text fg="#d29922" wrapMode="none" truncate flexGrow={1}>
        {`Update available: v${props.version}`}
      </text>
      <box
        onMouseDown={(event: MouseEvent) => {
          if (event.button !== MouseButton.LEFT) return;
          event.preventDefault();
          event.stopPropagation();
          if (!props.installing) props.onInstall();
        }}
      >
        <text fg={props.installing ? '#8b949e' : '#3fb950'} wrapMode="none">
          {props.installing ? '[ Installing... ]' : '[ Install ]'}
        </text>
      </box>
      <box
        onMouseDown={(event: MouseEvent) => {
          if (event.button !== MouseButton.LEFT) return;
          event.preventDefault();
          event.stopPropagation();
          if (!props.installing) props.onLater();
        }}
      >
        <text fg="#8b949e" wrapMode="none">
          {'[ Install later ]'}
        </text>
      </box>
    </box>
  );
}
