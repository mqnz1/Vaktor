// =============================================================
// NVIDIA NIM — API OpenAI-compatible (build.nvidia.com).
// https://integrate.api.nvidia.com/v1
//
// Catálogo: 13 modelos verificados com chamada real de chat contra
// a conta. A API lista ~85 entradas em /v1/models, mas a maioria é
// embedding/guardrail/tradução/vision puro ou "Function not found"
// para a conta — só entram os que respondem de verdade.
//
// ATENÇÃO: cold start real — a primeira chamada a um modelo pode
// levar 60-100s para provisionar o container (medido). O fetch usa
// timeout generoso de 180s por causa disso.
//
// Custos: a NVIDIA NIM cobra por créditos e não publica preço por
// 1M token no endpoint. Os custos abaixo são ESTIMATIVAS por classe
// de tamanho (documentadas no README); ajuste quando tiver a tabela.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_TIMEOUT_MS = 180_000;

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
    name: `${name} (NVIDIA)`,
    provider: 'nvidia',
    costPer1kTokensInput: costPer1MInput / 1000,
    costPer1kTokensOutput: costPer1MOutput / 1000,
    contextWindow,
    status: 'available',
    tier: costPer1MInput >= 0.5 ? 'premium' : costPer1MInput >= 0.15 ? 'standard' : 'economy',
    description,
  };
}

export const NVIDIA_MODELS: ModelInfo[] = [
  model('meta/llama-3.2-11b-vision-instruct', 'Llama 3.2 11B Vision', 0.10, 0.40, 128000, 'Multimodal compacto da Meta'),
  model('meta/llama-3.2-90b-vision-instruct', 'Llama 3.2 90B Vision', 0.35, 1.20, 128000, 'Multimodal grande da Meta'),
  model('minimaxai/minimax-m3.1-flash', 'MiniMax M3.1 Flash', 0.10, 0.40, 1000000, 'Rápido, contexto de 1M'),
  model('nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B', 0.80, 2.40, 131072, 'O maior Nemotron, MoE 550B'),
  model('nvidia/nemotron-3.5-bolt-e4b', 'Nemotron 3.5 Bolt E4B', 0.06, 0.24, 131072, 'MoE pequeno e veloz'),
  model('nvidia/nemotron-3.5-lightning-30b-a3b', 'Nemotron 3.5 Lightning 30B', 0.10, 0.40, 131072, 'Equilíbrio custo/desempenho'),
  model('nvidia/nemotron-3.5-super-vl-120b-a12b', 'Nemotron 3.5 Super VL 120B', 0.30, 0.90, 131072, 'Vision-language MoE 120B'),
  model('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'Nemotron 3 Nano Omni 30B', 0.10, 0.40, 131072, 'Texto/áudio/visão com raciocínio'),
  model('openai/gpt-oss-20b', 'GPT-OSS 20B', 0.10, 0.50, 131072, 'Open weights da OpenAI'),
  model('poolside/laguna-xs-2.1', 'Laguna XS 2.1', 0.06, 0.24, 32768, 'Poolside, especialista em código'),
  model('stepfun-ai/step-5-preview', 'Step 5 Preview', 0.60, 1.80, 131072, 'StepFun, preview do topo de linha'),
  model('z-ai/glm-5.3', 'GLM 5.3', 0.60, 2.20, 131072, 'Zhipu GLM, geralista forte'),
  model('z-ai/glm-5.3-flash', 'GLM 5.3 Flash', 0.06, 0.24, 131072, 'Zhipu GLM, versão rápida'),
];

export function getNvidiaModelById(id: string): ModelInfo | undefined {
  return NVIDIA_MODELS.find(m => m.id === id);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Nemotron/GLM e afins expõem raciocínio nativo como reasoning_content
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

export async function sendToNvidia(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature = 0.7,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getNvidiaModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in NVIDIA catalog`);
  }

  const opts = typeof thinking === 'object' ? thinking : undefined;
  const systemPrompt = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  const conversation = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...conversation,
    ],
    max_tokens: maxTokens,
    temperature,
    ...(opts?.strategy === 'native' ? { reasoning_effort: opts.effort } : {}),
  };

  const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: withTimeout(NVIDIA_TIMEOUT_MS, callOpts?.signal),
  });

  if (!res.ok) {
    const error = await res.text().catch(() => '');
    throw new Error(`NVIDIA API error: ${res.status} - ${redactSecrets(error).slice(0, 400)}`);
  }

  const data = asRecord(await res.json());
  const choices = Array.isArray(data['choices']) ? data['choices'] : [];
  const message = asRecord(asRecord(choices[0])['message']);
  const content = typeof message['content'] === 'string' ? message['content'] : '';
  const usage = asRecord(data['usage']);
  const inputTokens = Number(usage['prompt_tokens']) || estimateTokens(systemPrompt + JSON.stringify(conversation));
  const outputTokens = Number(usage['completion_tokens']) || estimateTokens(content);
  const reasoning = extractReasoning(data);

  return {
    text: content,
    model: modelId,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
      (outputTokens / 1000) * modelInfo.costPer1kTokensOutput,
    fromCache: false,
    ...(reasoning ? { reasoning } : {}),
  };
}
