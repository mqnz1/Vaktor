import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import {
  MouseButton,
  decodePasteBytes,
  stripAnsiSequences,
  type MouseEvent,
  type PasteEvent,
} from '@opentui/core';
import { useKeyboard, usePaste, useTerminalDimensions } from '@opentui/solid';
import {
  customProviderTypeLabel,
  deleteCustomProvider,
  loadCustomProviders,
  saveCustomProvider,
  validateCustomProvider,
  type CustomProviderConfig,
  type CustomProviderDraft,
  type CustomProviderType,
} from '../../providers/custom.js';

export interface ProviderMenuProps {
  onClose: () => void;
  onSaved?: (provider: CustomProviderConfig) => void;
  onDeleted?: (id: string) => void;
  onNotify?: (message: string) => void;
}

interface ProviderRow {
  kind: 'provider' | 'new';
  provider?: CustomProviderConfig;
  index: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function maskKey(value: string): string {
  if (!value) return '';
  return '•'.repeat(Math.min(48, Math.max(8, value.length)));
}

function providerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function FieldRow(props: {
  label: string;
  value: string;
  focused: boolean;
  placeholder?: string;
  onFocus: () => void;
}) {
  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      columnGap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.focused ? '#1f2b3a' : '#121212'}
      onMouseDown={(event: MouseEvent) => {
        if (event.button !== MouseButton.LEFT) return;
        event.preventDefault();
        event.stopPropagation();
        props.onFocus();
      }}
    >
      <text fg={props.focused ? '#ffffff' : '#8b949e'} wrapMode="none" width={18}>
        {props.label}
      </text>
      <text
        fg={props.value ? '#e6edf3' : '#6e7681'}
        wrapMode="none"
        truncate
        flexGrow={1}
      >
        {props.value || props.placeholder || ''}
      </text>
      <Show when={props.focused}>
        <text fg="#58a6ff" wrapMode="none">
          ▌
        </text>
      </Show>
    </box>
  );
}

// Cadastro local de providers. O bloco de credenciais fica separado do
// bloco de configuração e a chave é mascarada por padrão.
export function ProviderMenu(props: ProviderMenuProps) {
  const dims = useTerminalDimensions();
  const [providers, setProviders] = createSignal(loadCustomProviders());
  const [mode, setMode] = createSignal<'list' | 'form'>('list');
  const [selected, setSelected] = createSignal(0);
  const [editingId, setEditingId] = createSignal<`custom:${string}` | null>(null);
  const [focus, setFocus] = createSignal(0);
  const [name, setName] = createSignal('');
  const [baseUrl, setBaseUrl] = createSignal('');
  const [type, setType] = createSignal<CustomProviderType>('openai');
  const [apiKey, setApiKey] = createSignal('');
  const [showKey, setShowKey] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);
  const [deleteArmed, setDeleteArmed] = createSignal<string | null>(null);

  const panelWidth = createMemo(() =>
    Math.max(64, Math.min(92, Math.floor(dims().width * 0.76))),
  );
  const listRows = createMemo(() => Math.max(4, Math.min(10, dims().height - 12)));

  const rows = createMemo<ProviderRow[]>(() => [
    ...providers().map((provider, index) => ({
      kind: 'provider' as const,
      provider,
      index,
    })),
    { kind: 'new' as const, index: providers().length },
  ]);

  const start = createMemo(() =>
    clamp(
      selected() - Math.floor(listRows() / 2),
      0,
      Math.max(0, rows().length - listRows()),
    ),
  );
  const visibleRows = createMemo(() =>
    rows().slice(start(), start() + listRows()),
  );

  createEffect(() => {
    const last = Math.max(0, rows().length - 1);
    setSelected(current => (current > last ? last : current));
  });

  function refresh(): void {
    setProviders(loadCustomProviders());
  }

  function startNew(): void {
    setEditingId(null);
    setName('');
    setBaseUrl('');
    setType('openai');
    setApiKey('');
    setShowKey(false);
    setFocus(0);
    setError(null);
    setStatus(null);
    setDeleteArmed(null);
    setMode('form');
  }

  function edit(provider: CustomProviderConfig): void {
    setEditingId(provider.id);
    setName(provider.name);
    setBaseUrl(provider.baseUrl);
    setType(provider.type);
    setApiKey(provider.apiKey);
    setShowKey(false);
    setFocus(0);
    setError(null);
    setStatus(null);
    setDeleteArmed(null);
    setMode('form');
  }

  function back(): void {
    if (mode() === 'form') {
      setMode('list');
      setError(null);
      setStatus(null);
      return;
    }
    props.onClose();
  }

  function move(delta: number): void {
    const length = rows().length;
    if (length === 0) return;
    setSelected(current => (current + delta + length) % length);
    setDeleteArmed(null);
    setStatus(null);
  }

  function choose(): void {
    const row = rows()[selected()];
    if (!row) return;
    if (row.kind === 'new') {
      startNew();
      return;
    }
    if (row.provider) edit(row.provider);
  }

  function deleteSelected(): void {
    const provider = providers()[selected()];
    if (!provider) return;
    if (deleteArmed() !== provider.id) {
      setDeleteArmed(provider.id);
      setStatus(`Pressione d novamente para apagar ${provider.name}`);
      return;
    }
    deleteCustomProvider(provider.id);
    refresh();
    setDeleteArmed(null);
    setStatus(`Provider removido: ${provider.name}`);
    props.onDeleted?.(provider.id);
    props.onNotify?.(`Provider removido: ${provider.name}`);
  }

  function cycleType(delta: number): void {
    const types: CustomProviderType[] = ['openai', 'anthropic'];
    const current = types.indexOf(type());
    setType(types[(current + delta + types.length) % types.length]!);
    setError(null);
  }

  async function save(): Promise<void> {
    if (busy()) return;
    const draft: CustomProviderDraft = {
      name: name().trim(),
      baseUrl: baseUrl().trim(),
      type: type(),
      apiKey: apiKey().trim(),
    };
    if (!draft.name) {
      setError('Informe o nome do provider');
      setFocus(0);
      return;
    }
    if (!draft.baseUrl) {
      setError('Informe a API Base URL');
      setFocus(1);
      return;
    }
    if (!draft.apiKey) {
      setError('Informe a API Key');
      setFocus(3);
      return;
    }

    setBusy(true);
    setError(null);
    setStatus('Validando credencial e buscando modelos…');
    try {
      const validation = await validateCustomProvider(draft);
      if (!validation.ok) {
        setError(validation.error ?? 'Não foi possível validar o provider');
        setStatus(null);
        return;
      }
      const saved = saveCustomProvider(draft, validation, editingId() ?? undefined);
      refresh();
      setMode('list');
      const index = loadCustomProviders().findIndex(item => item.id === saved.id);
      setSelected(index >= 0 ? index : 0);
      setStatus(`Provider salvo: ${saved.name} (${saved.models.length} modelos)`);
      props.onSaved?.(saved);
      props.onNotify?.(`Provider salvo: ${saved.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  function appendText(value: string): void {
    if (!value) return;
    setError(null);
    setStatus(null);
    if (focus() === 0) setName(current => current + value);
    else if (focus() === 1) setBaseUrl(current => current + value);
    else if (focus() === 3) setApiKey(current => current + value);
  }

  function backspace(): void {
    setError(null);
    if (focus() === 0) setName(current => current.slice(0, -1));
    else if (focus() === 1) setBaseUrl(current => current.slice(0, -1));
    else if (focus() === 3) setApiKey(current => current.slice(0, -1));
  }

  function moveFocus(delta: number): void {
    setFocus(current => (current + delta + 4) % 4);
    setError(null);
  }

  usePaste((event: PasteEvent) => {
    if (mode() !== 'form' || focus() === 2) return;
    const text = stripAnsiSequences(decodePasteBytes(event.bytes)).replace(/[\r\n]+/g, '');
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    appendText(text);
  });

  useKeyboard(key => {
    if (mode() === 'list') {
      if (key.name === 'escape') {
        key.preventDefault();
        props.onClose();
        return;
      }
      if (key.name === 'up') {
        key.preventDefault();
        move(-1);
        return;
      }
      if (key.name === 'down') {
        key.preventDefault();
        move(1);
        return;
      }
      if (key.name === 'return' || key.name === 'kpenter' || key.name === 'linefeed') {
        key.preventDefault();
        choose();
        return;
      }
      if (!key.ctrl && key.name === 'n') {
        key.preventDefault();
        startNew();
        return;
      }
      if (!key.ctrl && key.name === 'd') {
        key.preventDefault();
        deleteSelected();
        return;
      }
      return;
    }

    if (key.name === 'escape') {
      key.preventDefault();
      back();
      return;
    }
    if (key.name === 'tab') {
      key.preventDefault();
      moveFocus(key.shift ? -1 : 1);
      return;
    }
    if (key.name === 'up') {
      key.preventDefault();
      moveFocus(-1);
      return;
    }
    if (key.name === 'down') {
      key.preventDefault();
      moveFocus(1);
      return;
    }
    if (focus() === 2 && (key.name === 'left' || key.name === 'right')) {
      key.preventDefault();
      cycleType(key.name === 'right' ? 1 : -1);
      return;
    }
    if (key.ctrl && key.name === 'h') {
      key.preventDefault();
      setShowKey(current => !current);
      return;
    }
    if (key.ctrl && key.name === 's') {
      key.preventDefault();
      void save();
      return;
    }
    if (key.name === 'return' || key.name === 'kpenter' || key.name === 'linefeed') {
      key.preventDefault();
      if (focus() === 2) cycleType(1);
      else void save();
      return;
    }
    if (key.name === 'backspace') {
      key.preventDefault();
      backspace();
      return;
    }
    if (key.ctrl || key.meta || key.option) return;
    const sequence = key.sequence;
    if (sequence.length === 1 && sequence >= ' ' && focus() !== 2) {
      key.preventDefault();
      appendText(sequence);
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
        width={panelWidth()}
        backgroundColor="#121212"
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor="#30363d"
        paddingLeft={1}
        paddingRight={1}
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation();
        }}
      >
        <Show
          when={mode() === 'list'}
          fallback={
            <>
              <text fg="#ffffff" wrapMode="none" truncate>
                {editingId() ? ' Editar provider customizado' : ' Novo provider customizado'}
              </text>
              <text fg="#484f58" wrapMode="none" truncate>
                {' Tab/↑↓ campos · ←→ tipo · Ctrl+V cola · Ctrl+H mostra a chave'}
              </text>

              <box
                flexDirection="column"
                width="100%"
                marginTop={1}
                border
                borderStyle="rounded"
                borderColor="#30363d"
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg="#79c0ff" wrapMode="none">
                  {'1. Provider'}
                </text>
                <FieldRow
                  label="Nome"
                  value={name()}
                  focused={focus() === 0}
                  placeholder="ex.: Meu Gateway"
                  onFocus={() => setFocus(0)}
                />
                <FieldRow
                  label="API Base URL"
                  value={baseUrl()}
                  focused={focus() === 1}
                  placeholder="https://api.exemplo.com/v1"
                  onFocus={() => setFocus(1)}
                />
                <box
                  flexDirection="row"
                  width="100%"
                  height={1}
                  columnGap={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={focus() === 2 ? '#1f2b3a' : '#121212'}
                  onMouseDown={(event: MouseEvent) => {
                    if (event.button !== MouseButton.LEFT) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setFocus(2);
                  }}
                >
                  <text fg={focus() === 2 ? '#ffffff' : '#8b949e'} wrapMode="none" width={18}>
                    Tipo
                  </text>
                  <text fg="#e6edf3" wrapMode="none" truncate flexGrow={1}>
                    {`‹ ${customProviderTypeLabel(type())} ›`}
                  </text>
                </box>
              </box>

              <box
                flexDirection="column"
                width="100%"
                marginTop={1}
                border
                borderStyle="rounded"
                borderColor="#30363d"
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg="#79c0ff" wrapMode="none">
                  {'2. Credenciais'}
                </text>
                <FieldRow
                  label="API Key"
                  value={showKey() ? apiKey() : maskKey(apiKey())}
                  focused={focus() === 3}
                  placeholder="cole a chave (Ctrl+V)"
                  onFocus={() => setFocus(3)}
                />
                <text fg="#8b949e" wrapMode="none" truncate>
                  {` ${showKey() ? 'visível' : 'oculta'} · Ctrl+H ${showKey() ? 'oculta' : 'mostra'} · nunca vai para logs`}
                </text>
              </box>

              <Show when={status()}>
                <text fg={error() ? '#f85149' : '#3fb950'} wrapMode="word">
                  {` ${error() ?? status()}`}
                </text>
              </Show>
              <Show when={!status() && error()}>
                <text fg="#f85149" wrapMode="word">
                  {` ${error()}`}
                </text>
              </Show>
              <text fg="#484f58" wrapMode="none" truncate>
                {busy()
                  ? ' validando…'
                  : ' Enter salva (no Tipo alterna) · Ctrl+S salva · Esc volta'}
              </text>
            </>
          }
        >
          <>
            <text fg="#ffffff" wrapMode="none" truncate>
              {' Providers customizados'}
            </text>
            <text fg="#484f58" wrapMode="none" truncate>
              {' Enter edita · n novo · d apaga (2x) · Esc fecha'}
            </text>
            <Show when={providers().length === 0}>
              <text fg="#8b949e" wrapMode="none" truncate>
                {' Nenhum provider cadastrado · pressione n'}
              </text>
            </Show>
            <For each={visibleRows()}>
                {(row, index) => {
                  const absolute = () => start() + index();
                  const selectedRow = () => absolute() === selected();
                  if (row.kind === 'new') {
                    return (
                      <box
                        flexDirection="row"
                        width="100%"
                        height={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={selectedRow() ? '#1f6feb' : '#121212'}
                        onMouseDown={(event: MouseEvent) => {
                          if (event.button !== MouseButton.LEFT) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setSelected(absolute());
                          startNew();
                        }}
                      >
                        <text fg={selectedRow() ? '#ffffff' : '#58a6ff'} wrapMode="none" truncate>
                          {selectedRow() ? '› + Novo provider' : '  + Novo provider'}
                        </text>
                      </box>
                    );
                  }
                  const provider = row.provider;
                  if (!provider) return null;
                  return (
                    <box
                      flexDirection="row"
                      width="100%"
                      height={1}
                      columnGap={1}
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={selectedRow() ? '#1f6feb' : '#121212'}
                      onMouseDown={(event: MouseEvent) => {
                        if (event.button !== MouseButton.LEFT) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setSelected(absolute());
                        edit(provider);
                      }}
                    >
                      <text fg={selectedRow() ? '#ffffff' : '#3fb950'} wrapMode="none">
                        {selectedRow() ? '›' : '●'}
                      </text>
                      <text
                        fg={selectedRow() ? '#ffffff' : '#e6edf3'}
                        wrapMode="none"
                        truncate
                        width={24}
                      >
                        {provider.name}
                      </text>
                      <text
                        fg={selectedRow() ? '#dbe9ff' : '#8b949e'}
                        wrapMode="none"
                        truncate
                        width={20}
                      >
                        {customProviderTypeLabel(provider.type)}
                      </text>
                      <text
                        fg={selectedRow() ? '#dbe9ff' : '#8b949e'}
                        wrapMode="none"
                        truncate
                        flexGrow={1}
                      >
                        {`${provider.models.length} modelos · ${providerHost(provider.baseUrl)}`}
                      </text>
                    </box>
                  );
                }}
            </For>
            <Show when={status()}>
              <text fg={error() ? '#f85149' : '#3fb950'} wrapMode="word">
                {` ${error() ?? status()}`}
              </text>
            </Show>
            <text fg="#484f58" wrapMode="none" truncate>
              {` ${providers().length} provider${providers().length === 1 ? '' : 's'} local${providers().length === 1 ? '' : 'is'}`}
            </text>
          </>
        </Show>
      </box>
    </box>
  );
}
