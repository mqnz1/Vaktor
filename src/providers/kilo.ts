// =============================================================
// Kilo Code AI Gateway — API OpenAI-compatible.
// Base: https://ai-gateway.kilo.ai/api/v1
// Autenticação: x-api-key (o gateway não aceita Bearer).
//
// Catálogo: modelos com isFree=true no endpoint público
// GET https://ai-gateway.kilo.ai/api/v1/models (17 entradas).
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const KILO_BASE_URL = 'https://ai-gateway.kilo.ai/api/v1';
const KILO_TIMEOUT_MS = 120_000;

function model(
  id: string,
  name: string,
  contextWindow: number,
  description: string,
): ModelInfo {
  return {
    id,
    name: `${name} (Kilo Code)`,
    provider: 'kilo',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow,
    status: 'available',
    tier: 'economy',
    description,
  };
}

export const KILO_MODELS: ModelInfo[] = [
  model('kilo-auto/free', 'Auto Free', 256000, 'Roteador gratuito do Kilo'),
  model('nvidia/nemotron-3.5-super-vl:free', 'Nemotron 3.5 Super VL', 1000000, 'Free: Nemotron multimodal'),
  model('reflection/beam-free', 'Reflection Beam 1.0', 1048576, 'Free: Reflection Beam'),
  model('stealth/glyph-cluster', 'Stealth Glyph Cluster', 256000, 'Free: Stealth Glyph'),
  model('recursive/flint-v1.0:free', 'Recursive Flint 1.0', 262144, 'Free: Recursive Flint'),
  model('xingchen-agi/xing4.0-29b-a4b:free', 'XingChen Xing4.0 29B', 262144, 'Free: XingChen MoE'),
  model('dots-studio/dots-3-note-preview:free', 'Dots3 Note Preview', 512000, 'Free: Dots Studio'),
  model('liquid/lfm-2.5-2.6b:free', 'Liquid LFM 2.5 2.6B', 65536, 'Free: Liquid pequeno'),
  model('nvidia/nemotron-3.5-lightning:free', 'Nemotron 3.5 Lightning', 1000000, 'Free: Nemotron Lightning'),
  model('poolside/laguna-s-2.1:free', 'Laguna S 2.1', 262144, 'Free: Poolside Laguna S'),
  model('poolside/laguna-xs-2.1:free', 'Laguna XS 2.1', 262144, 'Free: Poolside Laguna XS'),
  model('cohere/north-mini-code:free', 'Cohere North Mini Code', 256000, 'Free: Cohere para código'),
  model('nvidia/nemotron-3.5-content-safety:free', 'Nemotron 3.5 Content Safety', 128000, 'Free: segurança de conteúdo'),
  model('nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B', 1000000, 'Free: Nemotron Ultra'),
  model('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'Nemotron 3 Nano Omni', 256000, 'Free: raciocínio multimodal'),
  model('openrouter/free', 'OpenRouter Free Router', 200000, 'Free: roteador de modelos gratuitos'),
  model('inclusionai/ling-3.1-flash-1019-free', 'Ling 3.1 Flash 1019', 1000000, 'Free: Ling 3.1 Flash'),
];

export function getKiloModelById(id: string): ModelInfo | undefined {
  return KILO_MODELS.find(item => item.id === id);
}

export async function sendToKilo(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getKiloModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in Kilo Code free catalog`);
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
      baseUrl: KILO_BASE_URL,
      timeoutMs: KILO_TIMEOUT_MS,
      providerName: 'Kilo Code',
      auth: 'x-api-key',
    },
  );
}
