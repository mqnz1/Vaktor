// =============================================================
// Provedores customizados cadastrados pela TUI (/provider).
//
// As credenciais ficam fora do repositório, em ~/.vaktor/providers.json
// (ou VAKTOR_PROVIDERS_FILE), com permissão restrita. O arquivo nunca é
// logado e a chave não entra em mensagens enviadas ao modelo.
// =============================================================
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ChatMessage, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import type { ProviderId } from '../thinking/types.js';
import {
  PROVIDER_ORDER,
  isCustomProviderId,
  registerCustomProviderCatalog,
  unregisterCustomProviderCatalog,
  type CatalogModel,
} from './registry.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

export type CustomProviderType = 'openai' | 'anthropic';

export interface CustomProviderConfig {
  id: `custom:${string}`;
  name: string;
  baseUrl: string;
  type: CustomProviderType;
  apiKey: string;
  models: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CustomProviderDraft {
  name: string;
  baseUrl: string;
  type: CustomProviderType;
  apiKey: string;
}

export interface CustomProviderValidation {
  ok: boolean;
  baseUrl: string;
  models: string[];
  error?: string;
}

interface StoredProviders {
  version: 1;
  providers: CustomProviderConfig[];
}

const DEFAULT_INPUT_COST = 0.002;
const DEFAULT_OUTPUT_COST = 0.008;
const VALIDATION_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 120_000;

export function customProviderTypeLabel(type: CustomProviderType): string {
  return type === 'anthropic' ? 'Anthropic Messages' : 'OpenAI-compatible';
}

export function customProvidersFile(): string {
  const override = process.env['VAKTOR_PROVIDERS_FILE']?.trim();
  if (override) return override;
  return join(homedir(), '.vaktor', 'providers.json');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function normalizeType(raw: unknown): CustomProviderType {
  return raw === 'anthropic' ? 'anthropic' : 'openai';
}

function normalizeModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of raw) {
    const id = typeof item === 'string'
      ? item
      : typeof asRecord(item)['id'] === 'string'
        ? String(asRecord(item)['id'])
        : '';
    const clean = id.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    models.push(clean);
  }
  return models;
}

function parseConfig(raw: unknown): CustomProviderConfig | null {
  const value = asRecord(raw);
  const id = typeof value['id'] === 'string' ? value['id'] : '';
  const name = typeof value['name'] === 'string' ? value['name'].trim() : '';
  const baseUrl = typeof value['baseUrl'] === 'string' ? normalizeBaseUrl(value['baseUrl']) : '';
  const apiKey = typeof value['apiKey'] === 'string' ? value['apiKey'].trim() : '';
  if (!isCustomProviderId(id) || !name || !baseUrl || !apiKey) return null;
  const createdAt = Number(value['createdAt']) || Date.now();
  return {
    id,
    name,
    baseUrl,
    type: normalizeType(value['type']),
    apiKey,
    models: normalizeModels(value['models']),
    createdAt,
    updatedAt: Number(value['updatedAt']) || createdAt,
  };
}

export function loadCustomProviders(): CustomProviderConfig[] {
  try {
    const raw = readFileSync(customProvidersFile(), 'utf8');
    const parsed = asRecord(JSON.parse(raw));
    const list = Array.isArray(parsed['providers']) ? parsed['providers'] : [];
    return list
      .map(parseConfig)
      .filter((provider): provider is CustomProviderConfig => provider !== null);
  } catch {
    return [];
  }
}

function ensurePrivateDir(file: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows não aplica permissões POSIX; o arquivo continua fora do repo.
  }
}

function saveCustomProviders(providers: CustomProviderConfig[]): void {
  const file = customProvidersFile();
  ensurePrivateDir(file);
  const payload: StoredProviders = { version: 1, providers };
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Melhor esforço em sistemas sem chmod POSIX.
  }
}

function customCatalog(provider: CustomProviderConfig): CatalogModel[] {
  return provider.models.map(id => ({
    id,
    name: id,
    costPer1kTokensInput: DEFAULT_INPUT_COST,
    costPer1kTokensOutput: DEFAULT_OUTPUT_COST,
    tier: 'standard',
    description: `Modelo de ${provider.name}`,
  }));
}

/** Mantém o catálogo em memória em sincronia com o arquivo local. */
export function syncCustomProviderRegistry(): CustomProviderConfig[] {
  for (const id of [...PROVIDER_ORDER]) {
    if (isCustomProviderId(id)) unregisterCustomProviderCatalog(id);
  }
  const providers = loadCustomProviders();
  for (const provider of providers) {
    registerCustomProviderCatalog(provider.id, provider.name, customCatalog(provider));
  }
  return providers;
}

export function getCustomProvider(provider: ProviderId): CustomProviderConfig | undefined {
  if (!isCustomProviderId(provider)) return undefined;
  return loadCustomProviders().find(item => item.id === provider);
}

export function hasCustomProviderCredential(provider: ProviderId): boolean {
  return Boolean(getCustomProvider(provider)?.apiKey);
}

function makeProviderId(name: string, existing: readonly CustomProviderConfig[]): `custom:${string}` {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'provider';
  let id = `custom:${slug}` as const;
  let suffix = 2;
  while (existing.some(item => item.id === id)) {
    id = `custom:${slug}-${suffix}` as const;
    suffix += 1;
  }
  return id;
}

export function saveCustomProvider(
  draft: CustomProviderDraft,
  validation: Pick<CustomProviderValidation, 'baseUrl' | 'models'>,
  existingId?: `custom:${string}`,
): CustomProviderConfig {
  const name = draft.name.trim();
  const baseUrl = normalizeBaseUrl(validation.baseUrl);
  const apiKey = draft.apiKey.trim();
  const models = normalizeModels(validation.models);
  if (!name) throw new Error('Informe o nome do provider');
  if (!baseUrl) throw new Error('Informe a API Base URL');
  if (!apiKey) throw new Error('Informe a API Key');
  if (models.length === 0) throw new Error('Nenhum modelo encontrado no provider');

  const providers = loadCustomProviders();
  const now = Date.now();
  const existing = existingId ? providers.find(item => item.id === existingId) : undefined;
  const id = existing?.id ?? makeProviderId(name, providers);
  const config: CustomProviderConfig = {
    id,
    name,
    baseUrl,
    type: draft.type,
    apiKey,
    models,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing
    ? providers.map(item => (item.id === id ? config : item))
    : [...providers, config];
  saveCustomProviders(next);
  syncCustomProviderRegistry();
  return config;
}

export function deleteCustomProvider(id: `custom:${string}`): void {
  const providers = loadCustomProviders().filter(item => item.id !== id);
  saveCustomProviders(providers);
  syncCustomProviderRegistry();
}

async function fetchModelIds(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; models: string[] }> {
  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
  });
  if (!response.ok) {
    return { ok: false, status: response.status, models: [] };
  }
  const data = await response.json().catch(() => ({}));
  const record = asRecord(data);
  const list = Array.isArray(record['data'])
    ? record['data']
    : Array.isArray(data)
      ? data
      : [];
  return { ok: true, status: response.status, models: normalizeModels(list) };
}

/**
 * Descobre a base correta e os modelos usando a própria credencial.
 * A chave só aparece no header; nunca é incluída na mensagem de erro.
 */
export async function validateCustomProvider(
  draft: CustomProviderDraft,
): Promise<CustomProviderValidation> {
  const base = normalizeBaseUrl(draft.baseUrl);
  const apiKey = draft.apiKey.trim();
  if (!base) return { ok: false, baseUrl: base, models: [], error: 'Informe a API Base URL' };
  if (!apiKey) return { ok: false, baseUrl: base, models: [], error: 'Informe a API Key' };

  if (draft.type === 'anthropic') {
    const normalized = /\/v1$/i.test(base) ? base : `${base}/v1`;
    try {
      const result = await fetchModelIds(`${normalized}/models`, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      });
      if (!result.ok) {
        return {
          ok: false,
          baseUrl: normalized,
          models: [],
          error: result.status === 401 || result.status === 403
            ? 'API Key recusada pelo provider'
            : `Provider respondeu HTTP ${result.status} ao listar modelos`,
        };
      }
      if (result.models.length === 0) {
        return { ok: false, baseUrl: normalized, models: [], error: 'Provider não retornou modelos' };
      }
      return { ok: true, baseUrl: normalized, models: result.models };
    } catch (error) {
      return {
        ok: false,
        baseUrl: normalized,
        models: [],
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  const candidates = /\/v\d+$/i.test(base) ? [base] : [base, `${base}/v1`];
  let lastStatus = 0;
  for (const candidate of candidates) {
    try {
      const result = await fetchModelIds(`${candidate}/models`, {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      });
      if (result.ok && result.models.length > 0) {
        return { ok: true, baseUrl: candidate, models: result.models };
      }
      lastStatus = result.status || lastStatus;
      if (result.status === 401 || result.status === 403) {
        return {
          ok: false,
          baseUrl: candidate,
          models: [],
          error: 'API Key recusada pelo provider',
        };
      }
    } catch (error) {
      return {
        ok: false,
        baseUrl: candidate,
        models: [],
        error: redactSecrets(error instanceof Error ? error.message : String(error)),
      };
    }
  }
  return {
    ok: false,
    baseUrl: base,
    models: [],
    error: lastStatus > 0
      ? `Provider respondeu HTTP ${lastStatus} ao listar modelos`
      : 'Provider não retornou modelos',
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function readAnthropicStream(
  response: Response,
  onToken: ((chunk: string) => void) | undefined,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Streaming sem corpo (body ausente)');
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineAt = buffer.indexOf('\n');
    while (newlineAt >= 0) {
      const line = buffer.slice(0, newlineAt).trim();
      buffer = buffer.slice(newlineAt + 1);
      newlineAt = buffer.indexOf('\n');
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const event = asRecord(JSON.parse(payload));
        if (event['type'] === 'content_block_delta') {
          const delta = asRecord(event['delta']);
          if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            text += delta['text'];
            onToken?.(delta['text']);
          }
        }
        const usage = asRecord(event['usage']);
        if (event['type'] === 'message_start') {
          const message = asRecord(event['message']);
          const startUsage = asRecord(message['usage']);
          inputTokens = Number(startUsage['input_tokens']) || inputTokens;
        }
        if (event['type'] === 'message_delta') {
          outputTokens = Number(usage['output_tokens']) || outputTokens;
        }
      } catch {
        // Fragmento incompleto: continua no próximo read.
      }
    }
  }
  return { text, inputTokens, outputTokens };
}

async function sendToAnthropic(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  provider: CustomProviderConfig,
  temperature: number | undefined,
  opts: ProviderCallOpts | undefined,
): Promise<RouterResponse> {
  const systemPrompt = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n');
  const conversation = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({ role: message.role, content: message.content }));
  const wantsStream = typeof opts?.onToken === 'function';
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: maxTokens,
    messages: conversation,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(wantsStream ? { stream: true } : {}),
  };

  try {
    const response = await fetch(`${provider.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: withTimeout(REQUEST_TIMEOUT_MS, opts?.signal),
    });
    if (!response.ok) {
      const error = await response.text().catch(() => '');
      throw new Error(
        `${provider.name} API error: ${response.status} - ${redactSecrets(error).slice(0, 400)}`,
      );
    }

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    if (wantsStream) {
      const streamed = await readAnthropicStream(response, opts?.onToken);
      text = streamed.text;
      inputTokens = streamed.inputTokens;
      outputTokens = streamed.outputTokens;
    } else {
      const data = asRecord(await response.json());
      const content = Array.isArray(data['content']) ? data['content'] : [];
      text = content
        .map(block => {
          const item = asRecord(block);
          return item['type'] === 'text' && typeof item['text'] === 'string' ? item['text'] : '';
        })
        .join('');
      const usage = asRecord(data['usage']);
      inputTokens = Number(usage['input_tokens']) || 0;
      outputTokens = Number(usage['output_tokens']) || 0;
    }

    const finalInput = inputTokens || estimateTokens(systemPrompt + JSON.stringify(conversation));
    const finalOutput = outputTokens || estimateTokens(text);
    return {
      text,
      model: modelId,
      inputTokens: finalInput,
      outputTokens: finalOutput,
      estimatedCostUsd:
        (finalInput / 1000) * DEFAULT_INPUT_COST +
        (finalOutput / 1000) * DEFAULT_OUTPUT_COST,
      fromCache: false,
    };
  } catch (error) {
    throw new Error(
      `Failed to send to ${provider.name}: ${redactSecrets(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  }
}

export async function sendToCustomProvider(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  thinking: ThinkingOptions | undefined,
  temperature: number | undefined,
  opts: ProviderCallOpts | undefined,
  provider: CustomProviderConfig,
): Promise<RouterResponse> {
  if (provider.type === 'anthropic') {
    return sendToAnthropic(messages, modelId, maxTokens, provider, temperature, opts);
  }
  return sendOpenAiCompatible(
    messages,
    {
      id: modelId,
      name: modelId,
      costPer1kTokensInput: DEFAULT_INPUT_COST,
      costPer1kTokensOutput: DEFAULT_OUTPUT_COST,
    },
    maxTokens,
    provider.apiKey,
    thinking,
    temperature,
    opts,
    {
      baseUrl: provider.baseUrl,
      timeoutMs: REQUEST_TIMEOUT_MS,
      providerName: provider.name,
      auth: 'bearer',
    },
  );
}
