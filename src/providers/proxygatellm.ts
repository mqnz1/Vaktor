import type { ChatMessage, RouterResponse, ModelInfo } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';
type ThinkingArg = boolean | ThinkingOptions | undefined;

const PROXYGATELLM_TIMEOUT_MS = 60_000;

// Groq - Modelos de IA de alta performance
// https://console.groq.com
export const PROXYGATELLM_MODELS: ModelInfo[] = [
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B (Groq)',
    provider: 'proxygatellm',
    costPer1kTokensInput: 0.00004,
    costPer1kTokensOutput: 0.0002,
    contextWindow: 8192,
    status: 'available',
    tier: 'premium',
    description: 'GPT-OSS 120B - Alto desempenho via Groq',
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B (Groq)',
    provider: 'proxygatellm',
    costPer1kTokensInput: 0.00002,
    costPer1kTokensOutput: 0.00006,
    contextWindow: 32768,
    status: 'available',
    tier: 'standard',
    description: 'Mixtral 8x7B - Modelo rápido e eficiente',
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    provider: 'proxygatellm',
    costPer1kTokensInput: 0.00006,
    costPer1kTokensOutput: 0.0002,
    contextWindow: 8192,
    status: 'available',
    tier: 'standard',
    description: 'Llama 3.3 70B - Versatilidade e velocidade',
  },
  {
    id: 'llama-3.1-405b-reasoning',
    name: 'Llama 3.1 405B (Groq)',
    provider: 'proxygatellm',
    costPer1kTokensInput: 0.00045,
    costPer1kTokensOutput: 0.00135,
    contextWindow: 131072,
    status: 'available',
    tier: 'premium',
    description: 'Llama 3.1 405B - Raciocínio avançado',
  },
];

export function getModelById(id: string): ModelInfo | undefined {
  return PROXYGATELLM_MODELS.find(m => m.id === id);
}

// Estimativa simples de tokens (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Envia para Groq via OpenAI-compatible API
 * https://api.groq.com/openai/v1
 */
export async function sendToProxyGateLLM(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('GROQ_API_KEY não configurada no .env');
  }

  const opts = typeof thinking === 'object' ? thinking : undefined;
  const lastMessage = messages[messages.length - 1];
  const userContent = lastMessage?.content || '';

  try {
    // reasoning_effort só para modelos nativos que aceitam esse parâmetro no Groq
    const wantsReasoning =
      opts?.strategy === 'native' && /deepseek-r1|qwq/i.test(modelId);

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: Math.min(maxTokens, 8192),
          temperature: typeof temperature === 'number' ? temperature : 0.7,
          ...(wantsReasoning ? { reasoning_effort: opts.effort } : {}),
        }),
        signal: withTimeout(PROXYGATELLM_TIMEOUT_MS, callOpts?.signal),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(
        `Groq error: ${response.status} ${response.statusText} - ` +
        redactSecrets(JSON.stringify(error))
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Parse resposta no formato OpenAI
    let text = '';
    let reasoning: string | undefined;
    if (Array.isArray(data['choices']) && data['choices'].length > 0) {
      const choice = data['choices'][0] as Record<string, unknown>;
      if (choice['message'] && typeof choice['message'] === 'object') {
        const msg = choice['message'] as Record<string, unknown>;
        if (typeof msg['content'] === 'string') {
          text = msg['content'];
        }
        const rawReasoning = msg['reasoning'] ?? msg['reasoning_content'];
        if (typeof rawReasoning === 'string' && rawReasoning.trim().length > 0) {
          reasoning = rawReasoning;
        }
      }
    }

    const inputTokens = data['usage'] && typeof data['usage'] === 'object'
      ? (data['usage'] as Record<string, unknown>)['prompt_tokens'] as number || 0
      : estimateTokens(userContent);

    const outputTokens = data['usage'] && typeof data['usage'] === 'object'
      ? (data['usage'] as Record<string, unknown>)['completion_tokens'] as number || 0
      : estimateTokens(text);

    // Calcula custo baseado no modelo
    const modelInfo = getModelById(modelId);
    const costInput = (inputTokens / 1000) * (modelInfo?.costPer1kTokensInput || 0);
    const costOutput = (outputTokens / 1000) * (modelInfo?.costPer1kTokensOutput || 0);
    const estimatedCostUsd = costInput + costOutput;

    return {
      text,
      model: modelId,
      inputTokens,
      outputTokens,
      fromCache: false,
      estimatedCostUsd,
      ...(reasoning ? { reasoning } : {}),
    };
  } catch (error) {
    const msg = redactSecrets(error instanceof Error ? error.message : String(error));
    throw new Error(`Groq request failed: ${msg}`);
  }
}
