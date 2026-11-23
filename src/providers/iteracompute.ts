// =============================================================
// Itera Compute - API OpenAI-compatible.
// Base: https://api.iteracompute.com/v1
//
// Modelo free: qwen/qwen3.8-27b (30M tokens/mes, 128K de contexto).
// O Qwen free exige thinking desligado para devolver conteudo visivel.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const ITERACOMPUTE_BASE_URL = 'https://api.iteracompute.com/v1';
const ITERACOMPUTE_TIMEOUT_MS = 180_000;
const ITERACOMPUTE_MAX_OUTPUT_TOKENS = 8_192;

export const ITERACOMPUTE_MODELS: ModelInfo[] = [
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen3.8-27B (Itera Compute)',
    provider: 'iteracompute',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: 131_072,
    status: 'available',
    tier: 'economy',
    description: 'Grátis - 30M tokens/mês, 128K de contexto',
  },
];

export function getIteraComputeModelById(id: string): ModelInfo | undefined {
  return ITERACOMPUTE_MODELS.find(model => model.id === id);
}

export async function sendToIteraCompute(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getIteraComputeModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in Itera Compute catalog`);
  }
  if (apiKey.trim().length === 0) {
    throw new Error('ITERACOMPUTE_API_KEY não configurada no .env');
  }

  const response = await sendOpenAiCompatible(
    messages,
    modelInfo,
    maxTokens,
    apiKey,
    thinking,
    temperature,
    callOpts,
    {
      baseUrl: ITERACOMPUTE_BASE_URL,
      timeoutMs: ITERACOMPUTE_TIMEOUT_MS,
      providerName: 'Itera Compute',
      auth: 'bearer',
      maxTokensCap: ITERACOMPUTE_MAX_OUTPUT_TOKENS,
      extraBody: {
        reasoning: false,
        chat_template_kwargs: { enable_thinking: false },
      },
    },
  );

  if (response.text.trim().length === 0) {
    throw new Error(
      'Itera Compute: resposta vazia. Confira se a chave tem acesso a qwen/qwen3.8-27b e se o modelo está ativo.',
    );
  }

  return response;
}
