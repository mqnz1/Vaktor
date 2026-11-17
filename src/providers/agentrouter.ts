// =============================================================
// AgentRouter (chinês) — API OpenAI-compatible.
// Base: https://co.agentrouter.org/v1
//
// Catálogo do portal (/portal/models): Claude Opus 4.6/4.7/4.8,
// GPT-5.5 e GLM 5.2. A API Anthropic usa a mesma base sem /v1.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const AGENTROUTER_BASE_URL = 'https://co.agentrouter.org/v1';
const AGENTROUTER_TIMEOUT_MS = 120_000;

function model(
  id: string,
  name: string,
  costPer1MInput: number,
  costPer1MOutput: number,
  contextWindow: number,
  description: string,
): ModelInfo {
  return {
    id,
    name: `${name} (AgentRouter)`,
    provider: 'agentrouter',
    costPer1kTokensInput: costPer1MInput / 1000,
    costPer1kTokensOutput: costPer1MOutput / 1000,
    contextWindow,
    status: 'available',
    tier: costPer1MInput >= 0.5 ? 'premium' : costPer1MInput >= 0.15 ? 'standard' : 'economy',
    description,
  };
}

export const AGENTROUTER_MODELS: ModelInfo[] = [
  model('claude-opus-4-8', 'Claude Opus 4.8', 8, 40, 1000000, 'Opus mais capaz, contexto de 1M'),
  model('claude-opus-4-7', 'Claude Opus 4.7', 8, 40, 1000000, 'Opus para agentes assíncronos'),
  model('claude-opus-4-6', 'Claude Opus 4.6', 2, 10, 1000000, 'Opus 4.6 com contexto de 1M'),
  model('gpt-5.5', 'GPT-5.5', 4, 8, 1000000, 'GPT-5.5 com contexto de 1M'),
  model('glm-5.2', 'GLM 5.2', 3, 4.5, 1000000, 'GLM 5.2 MoE, código e agentes'),
];

export function getAgentRouterModelById(id: string): ModelInfo | undefined {
  return AGENTROUTER_MODELS.find(item => item.id === id);
}

export async function sendToAgentRouter(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getAgentRouterModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in AgentRouter catalog`);
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
      baseUrl: AGENTROUTER_BASE_URL,
      timeoutMs: AGENTROUTER_TIMEOUT_MS,
      providerName: 'AgentRouter',
      auth: 'bearer',
    },
  );
}
