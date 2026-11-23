// =============================================================
// Vyce AI — OpenAI-compatible com pool de API keys e key rotation.
//
// Base URL: https://vyceai.com/v1/chat/completions
// Auth: Bearer token
// Suporte a failover automático em 429/401
//
// Pool de keys: VYCEAI_API_KEY (principal) + VYCEAI_API_KEYS
// (lista separada por vírgula, ponto e vírgula ou espaço).
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const VYCEAI_BASE_URL = 'https://vyceai.com/v1';
const VYCEAI_TIMEOUT_MS = 120_000;

// Monta o pool a partir da chave principal e da lista opcional do ambiente.
function configuredKeyPool(primary: string): string[] {
  const raw =
    process.env['VYCEAI_API_KEYS'] ?? process.env['VYCEAI_API_KEY_POOL'] ?? '';
  const keys = [primary, ...raw.split(/[,;\s]+/)]
    .map(key => key.trim())
    .filter(key => key.length > 0);
  return [...new Set(keys)];
}

// Estado do pool de keys (índice atual e status de cada chave)
interface KeyPoolState {
  currentIndex: number;
  keyStatus: Map<string, { rateLimited: boolean; failedAt: number }>;
}

let keyPoolState: KeyPoolState = {
  currentIndex: 0,
  keyStatus: new Map(),
};

// Função auxiliar para converter valor desconhecido em registro
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Estimativa de tokens (aprox. 1 token = 4 caracteres)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Extrai reasoning content se disponível
function extractReasoning(data: Record<string, unknown>): string | undefined {
  const choices = data['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = asRecord(asRecord(choices[0])['message']);

  for (const key of ['reasoning_content', 'reasoning']) {
    const direct = message[key];
    if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  }

  return undefined;
}

// Obtém a próxima chave disponível (round-robin com fallback)
function getNextKey(pool: readonly string[]): string {
  const now = Date.now();
  const cooldownMs = 60000; // 1 minuto de cooldown para chaves rate-limited

  // Primeiro tenta usar a chave atual se não estiver em rate-limit
  let attempt = 0;
  for (; attempt < pool.length; attempt++) {
    const keyIndex = (keyPoolState.currentIndex + attempt) % pool.length;
    const key = pool[keyIndex] as string;
    const status = keyPoolState.keyStatus.get(key);

    // Se não há status ou cooldown expirou, usa esta chave
    if (!status || (now - status.failedAt) > cooldownMs) {
      keyPoolState.currentIndex = (keyIndex + 1) % pool.length;
      return key;
    }
  }

  // Se todas estão em rate-limit, reseta e usa a primeira
  keyPoolState.keyStatus.clear();
  keyPoolState.currentIndex = 0;
  return pool[0] as string;
}

// Marca uma chave como rate-limited
function markKeyRateLimited(key: string): void {
  keyPoolState.keyStatus.set(key, {
    rateLimited: true,
    failedAt: Date.now(),
  });
}

// Reinicia o pool (útil após sucesso ou reset)
function resetKeyPool(): void {
  keyPoolState.currentIndex = 0;
  keyPoolState.keyStatus.clear();
}

// Catálogo de modelos disponíveis no Vyce AI
export const VYCEAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.00015,
    costPer1kTokensOutput: 0.0006,
    contextWindow: 128000,
    status: 'available',
    tier: 'economy',
    description: 'Fast and affordable, supports vision',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.005,
    costPer1kTokensOutput: 0.015,
    contextWindow: 128000,
    status: 'available',
    tier: 'standard',
    description: 'Powerful multimodal model',
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.01,
    costPer1kTokensOutput: 0.03,
    contextWindow: 128000,
    status: 'available',
    tier: 'standard',
    description: 'Enhanced reasoning capabilities',
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.00025,
    costPer1kTokensOutput: 0.00125,
    contextWindow: 200000,
    status: 'available',
    tier: 'economy',
    description: 'Fastest Claude model',
  },
  {
    id: 'claude-3-sonnet',
    name: 'Claude 3 Sonnet (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.003,
    costPer1kTokensOutput: 0.015,
    contextWindow: 200000,
    status: 'available',
    tier: 'standard',
    description: 'Balanced performance and cost',
  },
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.015,
    costPer1kTokensOutput: 0.075,
    contextWindow: 200000,
    status: 'available',
    tier: 'premium',
    description: 'Most capable Claude model',
  },
  {
    id: 'llama-2-7b',
    name: 'Llama 2 7B (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.00008,
    costPer1kTokensOutput: 0.0001,
    contextWindow: 4096,
    status: 'available',
    tier: 'economy',
    description: 'Open source, lightweight',
  },
  {
    id: 'llama-2-70b',
    name: 'Llama 2 70B (Vyce)',
    provider: 'vyceai',
    costPer1kTokensInput: 0.0009,
    costPer1kTokensOutput: 0.0009,
    contextWindow: 4096,
    status: 'available',
    tier: 'standard',
    description: 'Larger open source model',
  },
];

// Encontra um modelo pelo ID
export function getVyceAIModelById(id: string): ModelInfo | undefined {
  return VYCEAI_MODELS.find(model => model.id === id);
}

// Normaliza ID do modelo (aceita vyceai/gpt-4o e gpt-4o)
export function normalizeVyceAIModelId(id: string): string {
  return id.trim().replace(/^vyceai\//i, '');
}

// Enviar request com key rotation e failover
export async function sendToVyceAI(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  _thinking: ThinkingArg = false,
  temperature = 0.7,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const keyPool = configuredKeyPool(apiKey);
  if (keyPool.length === 0) {
    throw new Error('VYCEAI_API_KEY não configurada no .env');
  }

  const cleanId = normalizeVyceAIModelId(modelId);
  const modelInfo = getVyceAIModelById(cleanId);
  if (!modelInfo) {
    throw new Error(
      `Unknown Vyce AI model: ${modelId}. Check /models for available options.`,
    );
  }

  const systemPrompt = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n');
  const conversation = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));

  // Tenta fazer a requisição com key rotation
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < keyPool.length; attempt++) {
    const currentKey = getNextKey(keyPool);

    try {
      const response = await fetch(`${VYCEAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cleanId,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            ...conversation,
          ],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: withTimeout(VYCEAI_TIMEOUT_MS, callOpts?.signal),
      });

      // Rate limit (429) ou autenticação falha (401): tenta próxima chave
      if (response.status === 429 || response.status === 401) {
        markKeyRateLimited(currentKey);
        const error = await response.text().catch(() => '');
        lastError = new Error(
          `Vyce AI ${response.status}: ${redactSecrets(error).slice(0, 200)}`,
        );
        continue; // Tenta próxima chave
      }

      // Outro erro: falha
      if (!response.ok) {
        const error = await response.text().catch(() => '');
        throw new Error(
          `Vyce AI API error: ${response.status} - ${redactSecrets(error).slice(0, 400)}`,
        );
      }

      // Sucesso!
      resetKeyPool();
      const data = asRecord(await response.json());
      const choices = Array.isArray(data['choices']) ? data['choices'] : [];
      const message = asRecord(asRecord(choices[0])['message']);
      const content = typeof message['content'] === 'string' ? message['content'] : '';
      if (!content) {
        throw new Error('Vyce AI returned empty response.');
      }

      const usage = asRecord(data['usage']);
      const inputTokens =
        Number(usage['prompt_tokens']) ||
        estimateTokens(systemPrompt + JSON.stringify(conversation));
      const outputTokens = Number(usage['completion_tokens']) || estimateTokens(content);
      const reasoning = extractReasoning(data);

      if (callOpts?.onToken) callOpts.onToken(content);

      return {
        text: content,
        model: `vyceai/${cleanId}`,
        inputTokens,
        outputTokens,
        estimatedCostUsd:
          (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
          (outputTokens / 1000) * modelInfo.costPer1kTokensOutput,
        fromCache: false,
        ...(reasoning ? { reasoning } : {}),
      };
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  // Esgotamos todas as chaves
  throw lastError || new Error('All Vyce AI keys failed.');
}
