// =============================================================
// Requesty — gateway OpenAI-compatible.
// Base: https://router.requesty.ai/v1
//
// Apenas os 13 modelos gratuitos documentados em
// https://docs.requesty.ai/features/free-models. Modelos pagos ficam
// fora do catálogo de propósito.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const REQUESTY_BASE_URL = 'https://router.requesty.ai/v1';
const REQUESTY_TIMEOUT_MS = 120_000;

function model(
  id: string,
  name: string,
  contextWindow: number,
  description: string,
): ModelInfo {
  return {
    id,
    name: `${name} (Requesty)`,
    provider: 'requesty',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow,
    status: 'available',
    tier: 'economy',
    description,
  };
}

export const REQUESTY_MODELS: ModelInfo[] = [
  model('nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B', 1000000, 'Free: Nemotron 3 Ultra'),
  model('nvidia/nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B', 1000000, 'Free: Nemotron 3 Super'),
  model('nvidia/nemotron-3-nano-30b-a3b', 'Nemotron 3 Nano 30B', 1000000, 'Free: Nemotron 3 Nano'),
  model('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'Nemotron 3 Nano Omni', 256000, 'Free: raciocínio multimodal'),
  model('poolside/laguna-xs.2', 'Laguna XS 2', 262144, 'Free: Poolside para código'),
  model('poolside/laguna-m.1', 'Laguna M 1', 262144, 'Free: Poolside médio'),
  model('google/gemma-4-31b-it', 'Gemma 4 31B', 262144, 'Free: Google Gemma 4'),
  model('mistral/leanstral-1-5', 'Leanstral 1.5', 128000, 'Free: Mistral Leanstral'),
  model('nvidia/nemotron-3.5-content-safety', 'Nemotron 3.5 Content Safety', 128000, 'Free: segurança de conteúdo'),
  model('nvidia/nemotron-3.5-lightning-30b-a3b', 'Nemotron 3.5 Lightning 30B', 1000000, 'Free: Nemotron Lightning'),
  model('nvidia/muse-glimmer-30b', 'Muse Glimmer 30B', 128000, 'Free: NVIDIA Muse Glimmer'),
  model('novita/ling-3.1-flash', 'Ling 3.1 Flash', 1000000, 'Free: Ling 3.1 Flash'),
  model('novita/inclusionai/ling-3.0-tiny', 'Ling 3.0 Tiny', 128000, 'Free: Ling 3.0 Tiny'),
];

export function getRequestyModelById(id: string): ModelInfo | undefined {
  return REQUESTY_MODELS.find(item => item.id === id);
}

export async function sendToRequesty(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getRequestyModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in Requesty free catalog`);
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
      baseUrl: REQUESTY_BASE_URL,
      timeoutMs: REQUESTY_TIMEOUT_MS,
      providerName: 'Requesty',
      auth: 'bearer',
      extraHeaders: {
        'HTTP-Referer': 'https://vaktor.local',
        'X-Title': 'Vaktor',
      },
    },
  );
}
