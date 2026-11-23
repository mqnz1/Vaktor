// =============================================================
// Qoder - API nativa (PAT -> job token) OpenAI-compatible.
//
// A PAT (`pt-...`) não autentica o gateway de chat. Primeiro ela é
// trocada por um job token (`jt-...`, ~24h) em openapi.qoder.sh; o
// chat usa esse token em api2-v2.qoder.sh/model/v1. O catálogo de 15
// modelos vem de /api/v1/cloud/models e os IDs são opacos, então o
// thinking é feito por scratchpad em vez de parâmetro nativo.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const QODER_OPENAPI_URL = 'https://openapi.qoder.sh';
const QODER_CHAT_BASE_URL = 'https://api2-v2.qoder.sh/model/v1';
const QODER_CATALOG_URL = 'https://api.qoder.com/api/v1/cloud/models';
const QODER_TIMEOUT_MS = 180_000;
const QODER_EXCHANGE_TIMEOUT_MS = 20_000;
const QODER_MAX_OUTPUT_TOKENS = 32_768;
const QODER_JOB_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const QODER_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const QODER_USER_AGENT = 'qodercli/1.0.0';
const QODER_COSY_CLIENT_TYPE = '5';
const QODER_MACHINE_OS =
  process.platform === 'win32'
    ? 'x86_64_windows'
    : process.platform === 'darwin'
      ? 'x86_64_macos'
      : 'x86_64_linux';

export interface QoderJobToken {
  token: string;
  expiresAt: number;
}

const qoderTokenCache = new Map<string, QoderJobToken>();
const qoderTokenInflight = new Map<string, Promise<QoderJobToken>>();

/** Limpa o cache de job tokens (usado pelos smoke tests). */
export function resetQoderTokenCache(): void {
  qoderTokenCache.clear();
  qoderTokenInflight.clear();
}

function qoderModel(
  id: string,
  name: string,
  contextWindow: number,
  tier: ModelInfo['tier'],
  description: string,
): ModelInfo {
  return {
    id,
    name,
    provider: 'qoder',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow,
    status: 'available',
    tier,
    description,
  };
}

/**
 * Catálogo real retornado por GET /api/v1/cloud/models.
 * `price_factor` é o multiplicador de créditos Qoder (não USD), então
 * o custo em USD fica zero e o fator aparece na descrição.
 */
export const QODER_MODELS: ModelInfo[] = [
  qoderModel('auto', 'Auto', 1_000_000, 'standard', 'Roteamento automático Qoder · 0.5x créditos'),
  qoderModel('ultimate', 'Ultimate', 1_000_000, 'premium', 'Modelo topo de linha Qoder · 0.4x créditos'),
  qoderModel('fast', 'Fast', 1_000_000, 'standard', 'Resposta rápida Qoder · 0.8x créditos'),
  qoderModel('efficient', 'Efficient', 200_000, 'economy', 'Baixo custo Qoder · 0.3x créditos'),
  qoderModel('smodel', 'Sonus', 1_000_000, 'premium', 'Raciocínio nativo Qoder · 8x créditos'),
  qoderModel('cmodel', 'Cantus', 1_000_000, 'premium', 'Raciocínio nativo Qoder · 4x créditos'),
  qoderModel('qmodel_38max', 'Qwen3.8-Max', 1_000_000, 'standard', 'Qwen3.8-Max via Qoder · 0.2x créditos'),
  qoderModel('qfmodel', 'Qwen3.8-Flash', 1_000_000, 'economy', 'Qwen3.8-Flash via Qoder · 0.04x créditos'),
  qoderModel('kmodel_latest', 'Kimi-K3.1-Pro', 1_000_000, 'standard', 'Kimi-K3.1-Pro via Qoder · 1x créditos'),
  qoderModel('kmodel', 'Kimi-K2.8-Preview', 1_000_000, 'standard', 'Kimi-K2.8-Preview via Qoder · 0.8x créditos'),
  qoderModel('gmodel', 'GLM-5.3', 1_000_000, 'standard', 'GLM-5.3 via Qoder · 0.8x créditos'),
  qoderModel('gfmodel', 'GLM-5.3-Flash', 1_000_000, 'economy', 'GLM-5.3-Flash via Qoder · 0.1x créditos'),
  qoderModel('dmodel', 'DeepSeek-V4-Pro', 1_000_000, 'standard', 'DeepSeek-V4-Pro via Qoder · 0.5x créditos'),
  qoderModel('dfmodel', 'DeepSeek-Flash', 1_000_000, 'economy', 'DeepSeek-Flash via Qoder · 0.1x créditos'),
  qoderModel('mmodel', 'MiniMax-M3.1-Flash', 1_000_000, 'economy', 'MiniMax-M3.1-Flash via Qoder · 0.1x créditos'),
];

export function getQoderModelById(id: string): ModelInfo | undefined {
  return QODER_MODELS.find(model => model.id === id);
}

/** URL do catálogo, exposta para eventual recarga dinâmica. */
export function qoderCatalogUrl(): string {
  return QODER_CATALOG_URL;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function expiryFromResponse(data: Record<string, unknown>): number {
  const expiresAt = data['expires_at'];
  if (typeof expiresAt === 'string') {
    const parsed = Date.parse(expiresAt);
    if (Number.isFinite(parsed) && parsed > Date.now()) return parsed;
  }
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt < 10_000_000_000 ? expiresAt * 1000 : expiresAt;
  }

  const expiresIn = Number(data['expires_in']);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    // O endpoint devolve expires_in em milissegundos (86400000).
    // Se um dia vier em segundos (< 10 dias), convertemos.
    return Date.now() + (expiresIn < 1_000_000 ? expiresIn * 1000 : expiresIn);
  }
  return Date.now() + QODER_JOB_TOKEN_TTL_MS;
}

async function exchangeQoderJobToken(
  personalToken: string,
  signal?: AbortSignal,
): Promise<QoderJobToken> {
  const response = await fetch(`${QODER_OPENAPI_URL}/api/v1/jobToken/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': QODER_USER_AGENT,
      'Cosy-Version': '1.0.1',
      'Cosy-ClientType': QODER_COSY_CLIENT_TYPE,
    },
    body: JSON.stringify({ personal_token: personalToken }),
    signal: withTimeout(QODER_EXCHANGE_TIMEOUT_MS, signal),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    throw new Error(
      `Qoder: falha ao trocar a PAT por job token (HTTP ${response.status}) - ${redactSecrets(raw).slice(0, 300)}`,
    );
  }

  const data = asRecord(await response.json());
  const token = typeof data['token'] === 'string' ? data['token'] : '';
  if (token.trim().length === 0) {
    throw new Error('Qoder: a troca da PAT não retornou um job token.');
  }
  return { token, expiresAt: expiryFromResponse(data) };
}

/** Aceita PAT (`pt-`), job token (`jt-`) ou device token (`dt-`) direto. */
export async function resolveQoderJobToken(
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = apiKey.trim();
  if (key.length === 0) throw new Error('QODER_API_KEY não configurada no .env');
  if (!key.startsWith('pt-')) return key;

  const cached = qoderTokenCache.get(key);
  if (cached && cached.expiresAt - Date.now() > QODER_REFRESH_BUFFER_MS) {
    return cached.token;
  }

  const pending = qoderTokenInflight.get(key);
  if (pending) return (await pending).token;

  const promise = exchangeQoderJobToken(key, signal);
  qoderTokenInflight.set(key, promise);
  try {
    const jobToken = await promise;
    qoderTokenCache.set(key, jobToken);
    return jobToken.token;
  } finally {
    qoderTokenInflight.delete(key);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isQoderAuthError(message: string): boolean {
  return /\b(401|403)\b|TOKEN_INVALID|invalid apikey|invalid token|unauthorized/i.test(message);
}

async function callQoderChat(
  messages: ChatMessage[],
  model: ModelInfo,
  maxTokens: number,
  jobToken: string,
  thinking: ThinkingArg,
  temperature: number | undefined,
  callOpts: ProviderCallOpts | undefined,
): Promise<RouterResponse> {
  return sendOpenAiCompatible(
    messages,
    model,
    maxTokens,
    jobToken,
    thinking,
    temperature,
    callOpts,
    {
      baseUrl: QODER_CHAT_BASE_URL,
      timeoutMs: QODER_TIMEOUT_MS,
      providerName: 'Qoder',
      auth: 'bearer',
      maxTokensCap: QODER_MAX_OUTPUT_TOKENS,
      extraHeaders: {
        'User-Agent': QODER_USER_AGENT,
        'Cosy-ClientType': QODER_COSY_CLIENT_TYPE,
        'Cosy-Version': '1.0.0',
        'Cosy-MachineOS': QODER_MACHINE_OS,
        'Cosy-Data-Policy': 'agree',
      },
    },
  );
}

export async function sendToQoder(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const model = getQoderModelById(modelId);
  if (!model) {
    throw new Error(`Model ${modelId} not found in Qoder catalog`);
  }
  if (apiKey.trim().length === 0) {
    throw new Error('QODER_API_KEY não configurada no .env');
  }

  let jobToken = await resolveQoderJobToken(apiKey, callOpts?.signal);

  let response: RouterResponse;
  try {
    response = await callQoderChat(
      messages, model, maxTokens, jobToken, thinking, temperature, callOpts,
    );
  } catch (error) {
    const firstMessage = errorMessage(error);
    if (isQoderAuthError(firstMessage) && apiKey.trim().startsWith('pt-')) {
      // Job token expirado/revogado: troca a PAT novamente e repete uma vez.
      qoderTokenCache.delete(apiKey.trim());
      jobToken = await resolveQoderJobToken(apiKey, callOpts?.signal);
      try {
        response = await callQoderChat(
          messages, model, maxTokens, jobToken, thinking, temperature, callOpts,
        );
      } catch (retryError) {
        throw new Error(`Qoder: o job token foi recusado. Confira a PAT em QODER_API_KEY. ${redactSecrets(errorMessage(retryError))}`);
      }
    } else if (/quota exceeded|\b402\b/i.test(firstMessage)) {
      throw new Error(
        'Qoder: a conta está sem créditos/quota (402 quota exceeded). Adicione créditos em qoder.com e tente de novo.',
      );
    } else {
      throw error;
    }
  }

  if (response.text.trim().length === 0) {
    throw new Error(
      'Qoder: resposta vazia. Confira se o modelo está habilitado e se a conta tem créditos.',
    );
  }
  return response;
}
