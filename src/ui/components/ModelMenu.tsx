import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProviderId } from '../../thinking/types.js';
import { PUTER_MODELS } from '../../providers/puter.js';
import { AGENTROUTER_MODELS } from '../../providers/agentrouter.js';
import { OPENROUTER_MODELS } from '../../providers/openrouter.js';
import { REQUESTY_MODELS } from '../../providers/requesty.js';
import { KILO_MODELS } from '../../providers/kilo.js';
import { FTA_MODELS } from '../../providers/fta.js';
import { PROXYGATELLM_MODELS } from '../../providers/proxygatellm.js';
import { ECHO_MODELS, echoFamily } from '../../providers/echo.js';
import { NVIDIA_MODELS } from '../../providers/nvidia.js';
import { OPENCODE_MODELS, opencodeFamily } from '../../providers/opencode.js';
import { HARBOR_MODELS } from '../../providers/harbor.js';
import { GEMINI_MODELS } from '../../providers/gemini.js';
import { NOTION_MODELS } from '../../providers/notion.js';
import { NOTION_WEB_MODELS, notionWebEnabled } from '../../providers/notionWeb.js';
import { ITERACOMPUTE_MODELS } from '../../providers/iteracompute.js';
import { QODER_MODELS } from '../../providers/qoder.js';
import { APINEX_MODELS } from '../../providers/apinex.js';
import { QRONOS_MODELS } from '../../providers/qronos.js';
import { DEEPAI_MODELS } from '../../providers/deepai.js';
import { PROVIDER_CATALOGS, PROVIDER_LABELS, qualifyModelId } from '../../providers/registry.js';

type View = 'models' | 'providers';
type Filter = 'all' | 'puter' | 'agentrouter' | 'openrouter' | 'requesty' | 'kilo' | 'fta' | 'gemini' | 'notion' | 'notion_web' | 'iteracompute' | 'qoder' | 'qronos' | 'apinex' | 'deepai' | 'proxygatellm' | 'echo' | 'nvidia' | 'opencode' | 'harbor';
type ProviderFilter = Exclude<Filter, 'all'>;
const VISIBLE = 18;

interface ModelMenuProps {
  currentModelId: string;
  isAutoMode: boolean;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  rows?: number;
}

interface MenuEntry {
  id: string;
  label: string;
  description: string;
  separator?: boolean;
  important?: boolean;
}

// Campos que o menu realmente usa (ModelInfo e OpenRouterModel satisfazem)
interface MenuModel {
  id: string;
  name: string;
  costPer1kTokensInput: number;
  contextWindow: number;
}

const PROVIDERS: Array<{
  id: ProviderFilter;
  name: string;
  envKey: string;
  note: string;
}> = [
  { id: 'puter', name: 'Puter', envKey: 'PUTER_API_KEY', note: 'Puter.com' },
  { id: 'agentrouter', name: 'AgentRouter', envKey: 'AGENTROUTER_API_KEY', note: 'OpenAI-compatible' },
  { id: 'openrouter', name: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', note: 'Modelos curados' },
  { id: 'requesty', name: 'Requesty', envKey: 'REQUESTY_API_KEY', note: '13 modelos free' },
  { id: 'kilo', name: 'Kilo Code', envKey: 'KILO_API_KEY', note: '17 modelos free' },
  { id: 'fta', name: 'FreeTheAI', envKey: 'FTAI_API_KEY', note: 'Modelos free' },
  { id: 'gemini', name: 'Google Gemini', envKey: 'GEMINI_API_KEY', note: 'Catálogo da sua chave' },
  { id: 'notion', name: 'Notion AI', envKey: 'NOTION_API_KEY', note: 'Agentes da sua conta' },
  { id: 'notion_web', name: 'Notion AI (Web)', envKey: 'NOTION_COOKIE', note: 'Auto (Firefox) ou token_v2' },
  { id: 'proxygatellm', name: 'Groq', envKey: 'GROQ_API_KEY', note: 'Alto desempenho' },
  { id: 'echo', name: PROVIDER_LABELS.echo, envKey: 'ECHO_API_KEY', note: 'Anthropic · OpenAI · Gemini' },
  { id: 'nvidia', name: 'NVIDIA', envKey: 'NVIDIA_API_KEY', note: 'NIM' },
  { id: 'opencode', name: 'OpenCode', envKey: 'OPENCODE_API_KEY', note: 'Zen' },
  { id: 'harbor', name: 'Token Harbor', envKey: 'HARBOR_API_KEY', note: '2 modelos free' },
  { id: 'iteracompute', name: 'Itera Compute', envKey: 'ITERACOMPUTE_API_KEY', note: 'Qwen3.8 free (30M/mês)' },
  { id: 'qoder', name: 'Qoder', envKey: 'QODER_API_KEY', note: '15 modelos (PAT)' },
  { id: 'qronos', name: 'Qronos AI', envKey: 'QRONOS_API_KEY', note: 'free tier · custo zero' },
  { id: 'apinex', name: 'APInex', envKey: 'APINEX_API_KEY', note: '42 modelos · carteira USD' },
  { id: 'deepai', name: 'DeepAI', envKey: 'DEEPAI_CODE_API_KEY', note: '18 modelos Code + texto/resumo' },
];

// Cada catálogo é exibido por inteiro. IDs repetidos entre provedores são
// qualificados (`puter::gpt-5`) para que a seleção fixe o provedor certo.
function buildModelsList(filter: Filter): MenuEntry[] {
  const entries: MenuEntry[] = [
    { id: 'auto', label: 'Auto', description: 'Router picks the best model' },
  ];

  const sections: Array<{
    label: string;
    provider: ProviderFilter;
    models: readonly MenuModel[];
  }> = [];
  if (filter === 'all' || filter === 'puter') {
    sections.push({ label: '─ Puter ─', provider: 'puter', models: PUTER_MODELS });
  }
  if (filter === 'all' || filter === 'agentrouter') {
    sections.push({ label: '─ AgentRouter ─', provider: 'agentrouter', models: AGENTROUTER_MODELS });
  }
  if (filter === 'all' || filter === 'openrouter') {
    sections.push({ label: '─ OpenRouter ─', provider: 'openrouter', models: OPENROUTER_MODELS });
  }
  if (filter === 'all' || filter === 'requesty') {
    sections.push({ label: '─ Requesty · free ─', provider: 'requesty', models: REQUESTY_MODELS });
  }
  if (filter === 'all' || filter === 'kilo') {
    sections.push({ label: '─ Kilo Code · free ─', provider: 'kilo', models: KILO_MODELS });
  }
  if (filter === 'all' || filter === 'fta') {
    sections.push({ label: '─ FreeTheAI · free ─', provider: 'fta', models: FTA_MODELS });
  }
  if (filter === 'all' || filter === 'proxygatellm') {
    sections.push({ label: '─ Groq ─', provider: 'proxygatellm', models: PROXYGATELLM_MODELS });
  }
  if (filter === 'all' || filter === 'gemini') {
    sections.push({ label: '✦ Google Gemini ✦', provider: 'gemini', models: GEMINI_MODELS });
  }
  if (filter === 'all' || filter === 'notion') {
    sections.push({ label: '✦ Notion AI ✦', provider: 'notion', models: NOTION_MODELS });
  }
  if (filter === 'all' || filter === 'notion_web') {
    sections.push({
      label: '✦ Notion AI (Web) ✦',
      provider: 'notion_web',
      models: NOTION_WEB_MODELS,
    });
  }
  if (filter === 'all' || filter === 'echo') {
    const families = ['Anthropic', 'OpenAI', 'Gemini'] as const;
    for (const family of families) {
      const models = ECHO_MODELS.filter(m => echoFamily(m.id) === family);
      if (models.length > 0) {
        sections.push({
          label: `─ ${PROVIDER_LABELS.echo} · ${family} ─`,
          provider: 'echo',
          models,
        });
      }
    }
  }
  if (filter === 'all' || filter === 'nvidia') {
    sections.push({ label: '─ NVIDIA NIM ─', provider: 'nvidia', models: NVIDIA_MODELS });
  }
  if (filter === 'all' || filter === 'opencode') {
    const families = ['Claude', 'GPT', 'Gemini', 'Grok', 'Qwen', 'GLM', 'Kimi', 'MiniMax', 'DeepSeek', 'Muse', 'Mistral', 'Outros'];
    for (const family of families) {
      const models = OPENCODE_MODELS.filter(m => opencodeFamily(m.id) === family);
      if (models.length > 0) {
        sections.push({
          label: `─ OpenCode Zen · ${family} ─`,
          provider: 'opencode',
          models,
        });
      }
    }
  }
  if (filter === 'all' || filter === 'harbor') {
    sections.push({ label: '─ Token Harbor ─', provider: 'harbor', models: HARBOR_MODELS });
  }
  if (filter === 'all' || filter === 'iteracompute') {
    sections.push({ label: '─ Itera Compute · free ─', provider: 'iteracompute', models: ITERACOMPUTE_MODELS });
  }
  if (filter === 'all' || filter === 'qoder') {
    sections.push({ label: '─ Qoder ─', provider: 'qoder', models: QODER_MODELS });
  }
  if (filter === 'all' || filter === 'qronos') {
    sections.push({ label: '─ Qronos AI · free ─', provider: 'qronos', models: QRONOS_MODELS });
  }
  if (filter === 'all' || filter === 'apinex') {
    sections.push({ label: '─ APInex ─', provider: 'apinex', models: APINEX_MODELS });
  }
  if (filter === 'all' || filter === 'deepai') {
    sections.push({ label: '─ DeepAI ─', provider: 'deepai', models: DEEPAI_MODELS });
  }

  for (const section of sections) {
    if (section.models.length === 0) continue;
    entries.push({ id: `sep:${section.label}`, label: section.label, description: '', separator: true });
    for (const m of section.models) {
      entries.push({
        id: qualifyModelId(section.provider, m.id),
        label: m.name,
        description: `$${m.costPer1kTokensInput.toFixed(5)}/1k · ctx ${(m.contextWindow / 1000).toFixed(0)}k`,
      });
    }
  }
  return entries;
}

function buildProvidersList(): MenuEntry[] {
  return PROVIDERS.map(p => {
    const hasKey =
      p.id === 'notion_web'
        ? notionWebEnabled()
        : p.id === 'deepai'
          ? Boolean(process.env['DEEPAI_CODE_API_KEY'] || process.env['DEEPAI_API_KEY'])
          : Boolean(process.env[p.envKey]);
    const count = PROVIDER_CATALOGS[p.id as ProviderId].length;
    return {
      id: p.id,
      label: p.name,
      description: hasKey
        ? `${count} modelos · chave ✓ · ${p.note}`
        : `${count} modelos · chave ✗ · configure ${p.envKey} para usar este provedor`,
      important: !hasKey,
    };
  });
}

export function ModelMenu({ currentModelId, isAutoMode, onSelect, onClose, rows: rowsProp }: ModelMenuProps): React.ReactElement {
  const [view, setView] = React.useState<View>('models');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [cursor, setCursor] = React.useState(0);

  const models = React.useMemo(() => buildModelsList(filter), [filter]);
  const providers = React.useMemo(() => buildProvidersList(), []);
  const items = view === 'models' ? models : providers;
  const activeId = isAutoMode ? 'auto' : currentModelId;

  // Quantas linhas cabem sem empurrar o prompt para fora da tela.
  const rows = rowsProp || process.stdout.rows || 40;
  const visibleRows = Math.max(6, Math.min(VISIBLE, rows - 16));

  React.useEffect(() => {
    setCursor(0);
  }, [view, filter]);

  // Setas pulam os separadores de seção (não são selecionáveis).
  const moveCursor = (delta: number): void => {
    let next = cursor;
    for (;;) {
      next += delta;
      if (next < 0 || next >= items.length) return;
      const entry = items[next];
      if (entry && !entry.separator && !entry.id.startsWith('sep')) {
        setCursor(next);
        return;
      }
    }
  };

  useInput((_, key) => {
    if (key.upArrow)    moveCursor(-1);
    if (key.downArrow)  moveCursor(1);
    // SHIFT (TAB como alternativa de terminal) alterna modelos ↔ provedores
    if (key.shift || key.tab) {
      setCursor(0);
      setView(v => (v === 'models' ? 'providers' : 'models'));
      return;
    }
    if (key.return) {
      const entry = items[cursor];
      if (!entry) return;
      if (view === 'providers' && entry.id !== 'auto') {
        setFilter(entry.id as Filter);
        setView('models');
        return;
      }
      if (!entry.separator && !entry.id.startsWith('sep')) {
        onSelect(entry.id);
      }
    }
    if (key.escape) onClose();
  });

  // Janela de scroll ao redor do cursor
  const start = Math.max(0, Math.min(cursor - Math.floor(visibleRows / 2), items.length - visibleRows));
  const visibleItems = items.slice(Math.max(0, start), Math.max(0, start) + visibleRows);
  const cursorOffset = cursor - start;

  return (
    <Box paddingX={1} flexShrink={0}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        width="100%"
        overflow="hidden"
      >
        <Box gap={1}>
          <Text bold color="cyan" wrap="truncate-end">{view === 'models' ? 'Models' : 'Providers'}</Text>
          {view === 'models' && filter !== 'all' && (
            <Text dimColor wrap="truncate-end">[{PROVIDERS.find(p => p.id === filter)?.name ?? ''}]</Text>
          )}
          <Text dimColor wrap="truncate-end">
            {view === 'models'
              ? '↑↓ move · enter select · tab providers · esc close'
              : '↑↓ move · enter filter · tab models · esc close'}
          </Text>
        </Box>

        {visibleItems.map((entry, i) => {
          const isCursor = i === cursorOffset;
          const isActive = view === 'models' && entry.id === activeId;

          if (entry.separator) {
            return (
              <Box key={entry.id}>
                <Text dimColor wrap="truncate-end">{entry.label}</Text>
              </Box>
            );
          }

          return (
            <Box key={entry.id} gap={1}>
              <Text {...(isCursor ? { color: 'cyan' } : {})} dimColor={!isCursor}>
                {isCursor ? '›' : ' '}
              </Text>
              <Text
                bold={isActive || isCursor}
                {...(isActive ? { color: 'cyan' } : {})}
                dimColor={!isCursor && !isActive}
                wrap="truncate-end"
              >
                {entry.label}{isActive ? ' ←' : ''}
              </Text>
              {entry.important && (
                <Text dimColor bold>IMPORTANTE</Text>
              )}
              <Text dimColor wrap="truncate-end">{entry.description}</Text>
            </Box>
          );
        })}
        {items.length > visibleRows && (
          <Box>
            <Text dimColor wrap="truncate-end">
              {`${start > 0 ? '↑ mais · ' : ''}${start + visibleRows < items.length ? '↓ mais · ' : ''}${cursor + 1}/${items.length}`}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
