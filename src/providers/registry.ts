// =============================================================
// Registro de provedores: dono de cada ID de modelo e a chave de
// ambiente correspondente.
//
// Fonte única de verdade para `dispatch` (router), rótulos (UI) e
// custos. Sem isso, IDs presentes em mais de um catálogo (ex.: `gpt-5`
// em Puter, Echo e OpenCode) podiam ser enviados a um provedor com a
// chave de outro.
// =============================================================
import type { BuiltinProviderId, ProviderId } from '../thinking/types.js';
import { PUTER_MODELS } from './puter.js';
import { AGENTROUTER_MODELS } from './agentrouter.js';
import { OPENROUTER_MODELS } from './openrouter.js';
import { NUMES_MODELS } from './numes.js';
import { NIGHTROUTER_MODELS } from './nightrouter.js';
import { REQUESTY_MODELS } from './requesty.js';
import { KILO_MODELS } from './kilo.js';
import { FTA_MODELS } from './fta.js';
import { PROXYGATELLM_MODELS } from './proxygatellm.js';
import { ECHO_MODELS } from './echo.js';
import { NVIDIA_MODELS } from './nvidia.js';
import { OPENCODE_MODELS } from './opencode.js';
import { HARBOR_MODELS } from './harbor.js';
import { GEMINI_MODELS } from './gemini.js';
import { NOTION_MODELS } from './notion.js';
import { NOTION_WEB_MODELS } from './notionWeb.js';
import { ITERACOMPUTE_MODELS } from './iteracompute.js';
import { QODER_MODELS } from './qoder.js';
import { APINEX_MODELS } from './apinex.js';
import { DEEPAI_MODELS } from './deepai.js';
import { VYCEAI_MODELS } from './vyceai.js';
import { QRONOS_MODELS } from './qronos.js';
import { ZRO_MODELS } from './zro.js';
import { UNOROUTER_MODELS } from './unorouter.js';

/** Campos usados pelo roteamento, pelo menu e pelo cálculo de custo. */
export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly costPer1kTokensInput: number;
  readonly costPer1kTokensOutput: number;
  readonly contextWindow?: number;
  readonly status?: 'available' | 'limited' | 'unavailable';
  readonly tier?: 'premium' | 'standard' | 'economy';
  readonly description?: string;
}

export const PROVIDER_CATALOGS: Record<string, readonly CatalogModel[]> = {
  puter: PUTER_MODELS,
  agentrouter: AGENTROUTER_MODELS,
  openrouter: OPENROUTER_MODELS,
  numes: NUMES_MODELS,
  nightrouter: NIGHTROUTER_MODELS,
  requesty: REQUESTY_MODELS,
  kilo: KILO_MODELS,
  fta: FTA_MODELS,
  proxygatellm: PROXYGATELLM_MODELS,
  echo: ECHO_MODELS,
  nvidia: NVIDIA_MODELS,
  opencode: OPENCODE_MODELS,
  harbor: HARBOR_MODELS,
  gemini: GEMINI_MODELS,
  notion: NOTION_MODELS,
  notion_web: NOTION_WEB_MODELS,
  iteracompute: ITERACOMPUTE_MODELS,
  qoder: QODER_MODELS,
  apinex: APINEX_MODELS,
  deepai: DEEPAI_MODELS,
  vyceai: VYCEAI_MODELS,
  qronos: QRONOS_MODELS,
  zro: ZRO_MODELS,
  unorouter: UNOROUTER_MODELS,
};

/**
 * Prioridade de posse. Define, ao mesmo tempo, para onde `dispatch` envia
 * e qual `*_API_KEY` é usada — os dois nunca podem divergir.
 */
export const PROVIDER_ORDER: ProviderId[] = [
  'proxygatellm',
  'agentrouter',
  'openrouter',
  'numes',
  'gemini',
  'notion',
  'notion_web',
  'echo',
  'nvidia',
  'opencode',
  'zro',
  'harbor',
  'iteracompute',
  'qoder',
  'qronos',
  'unorouter',
  'apinex',
  'requesty',
  'kilo',
  'fta',
  'puter',
  'deepai',
  'vyceai',
  'nightrouter',
];

/** Nome da variável de ambiente (sem o sufixo `_API_KEY`). */
export const PROVIDER_ENV_KEYS: Record<string, string> = {
  puter: 'PUTER',
  agentrouter: 'AGENTROUTER',
  openrouter: 'OPENROUTER',
  numes: 'NUMES',
  nightrouter: 'NIGHTROUTER',
  requesty: 'REQUESTY',
  kilo: 'KILO',
  fta: 'FTAI',
  proxygatellm: 'GROQ',
  echo: 'ECHO',
  nvidia: 'NVIDIA',
  opencode: 'OPENCODE',
  harbor: 'HARBOR',
  gemini: 'GEMINI',
  notion: 'NOTION',
  notion_web: 'NOTION_WEB',
  iteracompute: 'ITERACOMPUTE',
  qoder: 'QODER',
  qronos: 'QRONOS',
  zro: 'ZRO',
  unorouter: 'UNOROUTER',
  apinex: 'APINEX',
  deepai: 'DEEPAI',
  vyceai: 'VYCEAI',
};

/** Rótulo visível de cada provedor (fonte única para a UI). */
const BUILTIN_PROVIDER_LABELS = {
  puter: 'Puter',
  agentrouter: 'AgentRouter',
  openrouter: 'OpenRouter',
  numes: 'Numes',
  nightrouter: 'NightRouter',
  requesty: 'Requesty',
  kilo: 'Kilo Code',
  fta: 'FreeTheAI',
  proxygatellm: 'Groq',
  echo: 'Echo Free',
  nvidia: 'NVIDIA',
  opencode: 'OpenCode',
  harbor: 'Token Harbor',
  gemini: 'Google Gemini',
  notion: 'Notion AI',
  notion_web: 'Notion AI (Web)',
  iteracompute: 'Itera Compute',
  qoder: 'Qoder',
  qronos: 'Qronos AI',
  zro: 'Zro',
  unorouter: 'UnoRouter',
  apinex: 'APInex',
  deepai: 'DeepAI',
  vyceai: 'Vyce AI',
} as const satisfies Record<BuiltinProviderId, string>;

/** Rótulos mutáveis: provedores customizados entram em runtime. */
export const PROVIDER_LABELS: Record<string, string> = { ...BUILTIN_PROVIDER_LABELS };

export function providerLabel(id: ProviderId): string {
  return PROVIDER_LABELS[id] ?? id;
}

export function isCustomProviderId(id: ProviderId | string): id is `custom:${string}` {
  return id.startsWith('custom:');
}

/** Registra/atualiza um provedor local sem reiniciar o processo. */
export function registerCustomProviderCatalog(
  provider: `custom:${string}`,
  label: string,
  models: readonly CatalogModel[],
): void {
  if (!(provider in PROVIDER_CATALOGS)) PROVIDER_ORDER.push(provider);
  PROVIDER_CATALOGS[provider] = models;
  PROVIDER_LABELS[provider] = label;
}

/** Remove um provedor local do catálogo em memória. */
export function unregisterCustomProviderCatalog(provider: `custom:${string}`): void {
  delete PROVIDER_CATALOGS[provider];
  delete PROVIDER_LABELS[provider];
  const index = PROVIDER_ORDER.indexOf(provider);
  if (index >= 0) PROVIDER_ORDER.splice(index, 1);
}

const MODEL_REF_SEPARATOR = '::';

/** ID interno que fixa o provedor: `puter::gpt-5`, `echo::gpt-5`, etc. */
export function qualifyModelId(provider: ProviderId, modelId: string): string {
  return `${provider}${MODEL_REF_SEPARATOR}${modelId}`;
}

export interface ModelRef {
  provider?: ProviderId;
  id: string;
}

/** Separa o provedor explícito do ID bruto, quando presente. */
export function parseModelRef(modelId: string): ModelRef {
  const index = modelId.indexOf(MODEL_REF_SEPARATOR);
  if (index === -1) return { id: modelId };
  const provider = modelId.slice(0, index);
  if (!(provider in PROVIDER_CATALOGS)) return { id: modelId };
  return {
    provider: provider as ProviderId,
    id: modelId.slice(index + MODEL_REF_SEPARATOR.length),
  };
}

/** Provedor que atende um ID de modelo (o primeiro da ordem que o possui). */
export function ownerOf(modelId: string): ProviderId {
  const ref = parseModelRef(modelId);
  if (ref.provider) return ref.provider;
  for (const provider of PROVIDER_ORDER) {
    if (PROVIDER_CATALOGS[provider].some(model => model.id === ref.id)) {
      return provider;
    }
  }
  return 'puter';
}

export interface ModelOwner {
  provider: ProviderId;
  model: CatalogModel;
}

export function findModelOwner(modelId: string): ModelOwner | null {
  const ref = parseModelRef(modelId);
  if (ref.provider) {
    const model = PROVIDER_CATALOGS[ref.provider].find(item => item.id === ref.id);
    return model ? { provider: ref.provider, model } : null;
  }
  for (const provider of PROVIDER_ORDER) {
    const model = PROVIDER_CATALOGS[provider].find(item => item.id === ref.id);
    if (model) return { provider, model };
  }
  return null;
}

/** Modelos realmente servidos por um provedor (sem os "emprestados"). */
export function modelsOwnedBy(provider: ProviderId): readonly CatalogModel[] {
  return PROVIDER_CATALOGS[provider].filter(model => ownerOf(model.id) === provider);
}
