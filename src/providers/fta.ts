// =============================================================
// FreeTheAI (FTA) — API OpenAI-compatible.
// Base: https://api.freetheai.org/v1
// Autenticação: Authorization: Bearer ftai_...
//
// Catálogo: modelos gratuitos recomendados na documentação oficial
// (/concepts/models). IDs sempre começam com fta/.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const FTA_BASE_URL = 'https://api.freetheai.org/v1';
const FTA_TIMEOUT_MS = 120_000;

function model(
  id: string,
  name: string,
  contextWindow: number,
  description: string,
): ModelInfo {
  return {
    id,
    name: `${name} (FreeTheAI)`,
    provider: 'fta',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow,
    status: 'available',
    tier: 'economy',
    description,
  };
}

export const FTA_MODELS: ModelInfo[] = [
  model('fta/zai/glm-5.3', 'GLM 5.3', 1000000, 'Free: chat, roleplay e código'),
  model('fta/zai/glm-5.3-flash', 'GLM 5.3 Flash', 1000000, 'Free: respostas rápidas e imagens'),
  model('fta/kimi/k3', 'Kimi K3', 1000000, 'Free: raciocínio e código difícil'),
  model('fta/mmx/minimax-m3', 'MiniMax M3', 1000000, 'Free: documentos e chats longos'),
  model('fta/olf/gpt-oss:120b', 'GPT-OSS 120B', 131072, 'Free: modelo aberto de raciocínio'),
];

export function getFtaModelById(id: string): ModelInfo | undefined {
  return FTA_MODELS.find(item => item.id === id);
}

export async function sendToFta(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getFtaModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in FreeTheAI catalog`);
  }

  return sendOpenAiCompatible(
    messages,
    modelInfo,
    maxTokens,
    apiKey,
    thinking,
    temperature,
    callOpts,
    {
      baseUrl: FTA_BASE_URL,
      timeoutMs: FTA_TIMEOUT_MS,
      providerName: 'FreeTheAI',
      auth: 'bearer',
    },
  );
}
