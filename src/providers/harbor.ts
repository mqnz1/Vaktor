// =============================================================
// Token Harbor — gateway OpenAI-compatible (tokenharbor.ai).
// https://tokenharbor.ai/v1
//
// Autenticação: Authorization: Bearer thk_live_...
// Catálogo oficial com preços/contexto em GET /v1/models.
//
// Modelos ":free" usam uma franquia rolando de 7 dias; quando esgota,
// a API devolve rate-limit (erro claro, nunca cobrado).
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const HARBOR_BASE_URL = 'https://tokenharbor.ai/v1';
const HARBOR_TIMEOUT_MS = 120_000;

export const HARBOR_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4.1-flash:free',
    name: 'DeepSeek V4.1 Flash (Harbor)',
    provider: 'harbor',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: 1048576,
    status: 'available',
    tier: 'economy',
    description: 'Grátis — franquia rolando de 7 dias',
  },
  {
    id: 'mimo-v2.6-flash:free',
    name: 'MiMo V2.6 Flash (Harbor)',
    provider: 'harbor',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: 1048576,
    status: 'available',
    tier: 'economy',
    description: 'Grátis — franquia rolando de 7 dias',
  },
];

export function getHarborModelById(id: string): ModelInfo | undefined {
  return HARBOR_MODELS.find(m => m.id === id);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function sendToHarbor(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  _thinking: ThinkingArg = false,
  temperature = 0.7,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getHarborModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in Token Harbor catalog`);
  }

  const systemPrompt = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  const conversation = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const res = await fetch(`${HARBOR_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelId,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...conversation,
      ],
      max_tokens: maxTokens,
      temperature,
    }),
    signal: withTimeout(HARBOR_TIMEOUT_MS, callOpts?.signal),
  });

  if (!res.ok) {
    const error = await res.text().catch(() => '');
    throw new Error(`Token Harbor error: ${res.status} - ${redactSecrets(error).slice(0, 400)}`);
  }

  const data = asRecord(await res.json());
  const choices = Array.isArray(data['choices']) ? data['choices'] : [];
  const message = asRecord(asRecord(choices[0])['message']);
  const content = typeof message['content'] === 'string' ? message['content'] : '';
  const reasoning = typeof message['reasoning_content'] === 'string' ? message['reasoning_content'] : undefined;
  const usage = asRecord(data['usage']);
  const inputTokens = Number(usage['prompt_tokens']) || estimateTokens(systemPrompt + JSON.stringify(conversation));
  const outputTokens = Number(usage['completion_tokens']) || estimateTokens(content);

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
