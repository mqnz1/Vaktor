// Using built-in fetch from Node.js 18+
import type { ChatMessage } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const OPENROUTER_TIMEOUT_MS = 120_000;

export interface OpenRouterResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  fromCache: boolean;
  reasoning?: string;
  reasoningTokens?: number;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  costPer1kTokensInput: number;
  costPer1kTokensOutput: number;
}

// OpenRouter popular models catalog (IDs e preços verificados na API)
const OPENROUTER_MODELS: OpenRouterModel[] = [
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5 (OpenRouter)',
    description: 'Claude Sonnet 5, contexto de 1M',
    contextWindow: 1000000,
    costPer1kTokensInput: 0.002,
    costPer1kTokensOutput: 0.01,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5 (OpenRouter)',
    description: 'Claude Sonnet 4.5, ótimo em código',
    contextWindow: 1000000,
    costPer1kTokensInput: 0.003,
    costPer1kTokensOutput: 0.015,
  },
  {
    id: 'anthropic/claude-opus-4.8',
    name: 'Claude Opus 4.8 (OpenRouter)',
    description: 'Claude mais capaz',
    contextWindow: 1000000,
    costPer1kTokensInput: 0.005,
    costPer1kTokensOutput: 0.025,
  },
  {
    id: 'anthropic/claude-haiku-5.5',
    name: 'Claude Haiku 5.5 (OpenRouter)',
    description: 'Claude rápido e econômico',
    contextWindow: 1000000,
    costPer1kTokensInput: 0.0001,
    costPer1kTokensOutput: 0.0005,
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4 (OpenRouter)',
    description: 'GPT-5.4, contexto gigante',
    contextWindow: 1050000,
    costPer1kTokensInput: 0.0025,
    costPer1kTokensOutput: 0.015,
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5 (OpenRouter)',
    description: 'GPT-5 com raciocínio nativo',
    contextWindow: 400000,
    costPer1kTokensInput: 0.00125,
    costPer1kTokensOutput: 0.01,
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini (OpenRouter)',
    description: 'Rápido e barato',
    contextWindow: 128000,
    costPer1kTokensInput: 0.00015,
    costPer1kTokensOutput: 0.0006,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro (OpenRouter)',
    description: 'Gemini Pro com raciocínio',
    contextWindow: 1048576,
    costPer1kTokensInput: 0.00125,
    costPer1kTokensOutput: 0.01,
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (OpenRouter)',
    description: 'Google Flash, contexto gigante',
    contextWindow: 1048576,
    costPer1kTokensInput: 0.0003,
    costPer1kTokensOutput: 0.0025,
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash (OpenRouter)',
    description: 'DeepSeek rápido e barato',
    contextWindow: 1048576,
    costPer1kTokensInput: 0.000165,
    costPer1kTokensOutput: 0.00066,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B (OpenRouter)',
    description: 'Meta open source',
    contextWindow: 131072,
    costPer1kTokensInput: 0.0001,
    costPer1kTokensOutput: 0.00032,
  },
  {
    id: 'mistralai/mistral-small-2603',
    name: 'Mistral Small 4 (OpenRouter)',
    description: 'Mistral leve e econômico',
    contextWindow: 262144,
    costPer1kTokensInput: 0.00015,
    costPer1kTokensOutput: 0.0006,
  },
];

function getModelById(id: string): OpenRouterModel | undefined {
  return OPENROUTER_MODELS.find(m => m.id === id);
}

function extractText(response: unknown): string {
  if (typeof response === 'string') return response;

  if (!response || typeof response !== 'object') {
    return JSON.stringify(response);
  }

  const obj = response as any;
  if (obj.choices && Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    return obj.choices[0].message.content as string;
  }
  if (obj.content && typeof obj.content === 'string') return obj.content;

  return JSON.stringify(response);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Extrai raciocínio nativo (reasoning ou reasoning_details)
function extractReasoning(data: Record<string, unknown>): string | undefined {
  const choices = data['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const msg = (choices[0] as Record<string, unknown>)['message'] as Record<string, unknown> | undefined;
  if (!msg) return undefined;

  const direct = msg['reasoning'] ?? msg['reasoning_content'];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;

  const details = msg['reasoning_details'];
  if (Array.isArray(details)) {
    const parts: string[] = [];
    for (const item of details) {
      if (!item || typeof item !== 'object') continue;
      const d = item as Record<string, unknown>;
      const text = d['text'] ?? d['summary'] ?? d['content'];
      if (typeof text === 'string' && text.trim().length > 0) parts.push(text);
    }
    if (parts.length > 0) return parts.join('\n');
  }
  return undefined;
}

function reasoningDeltaText(delta: Record<string, unknown>): string {
  const direct = delta['reasoning'] ?? delta['reasoning_content'];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const details = delta['reasoning_details'];
  if (!Array.isArray(details)) return '';
  const parts: string[] = [];
  for (const item of details) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const text = d['text'] ?? d['summary'] ?? d['content'];
    if (typeof text === 'string' && text.length > 0) parts.push(text);
  }
  return parts.join('');
}

async function readStream(
  res: Response,
  onToken: ((chunk: string) => void) | undefined,
  onReasoningToken: ((chunk: string) => void) | undefined,
): Promise<{
  content: string;
  reasoning: string;
  usage: Record<string, unknown> | undefined;
}> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('OpenRouter stream sem corpo (body ausente)');

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage: Record<string, unknown> | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineAt = buffer.indexOf('\n');
    while (newlineAt >= 0) {
      const line = buffer.slice(0, newlineAt).trim();
      buffer = buffer.slice(newlineAt + 1);
      newlineAt = buffer.indexOf('\n');

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload.length === 0 || payload === '[DONE]') continue;

      try {
        const chunk = JSON.parse(payload) as Record<string, unknown>;
        if (chunk['usage'] && typeof chunk['usage'] === 'object') {
          usage = chunk['usage'] as Record<string, unknown>;
        }
        const choices = chunk['choices'];
        if (!Array.isArray(choices) || choices.length === 0) continue;
        const delta = (choices[0] as Record<string, unknown>)['delta'];
        if (!delta || typeof delta !== 'object') continue;

        const record = delta as Record<string, unknown>;
        const text = record['content'];
        if (typeof text === 'string' && text.length > 0) {
          content += text;
          onToken?.(text);
        }
        const think = reasoningDeltaText(record);
        if (think.length > 0) {
          reasoning += think;
          onReasoningToken?.(think);
        }
      } catch {
        // Fragmento incompleto: o buffer continua no próximo read.
      }
    }
  }

  return { content, reasoning, usage };
}

export async function sendToOpenRouter(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  systemPromptText?: string,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<OpenRouterResponse> {
  const modelInfo = getModelById(model);
  if (!modelInfo) {
    throw new Error(`Model ${model} not found in OpenRouter catalog`);
  }

  const opts = typeof thinking === 'object' ? thinking : undefined;
  // O system prompt real (skills + diretiva) vai no papel `system`, não achatado no usuário.
  const systemPrompt = systemPromptText ?? 'You are a helpful assistant.';

  // Histórico completo (não achado): cada turno preserva role e conteúdo.
  const conversation = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  const requestedMax = Math.min(maxTokens, 4000);
  const wantsStream =
    typeof callOpts?.onToken === 'function' || typeof callOpts?.onReasoningToken === 'function';

  const makeBody = (max: number): string => JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversation,
    ],
    max_tokens: max,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    ...(opts?.strategy === 'native'
      ? {
          reasoning: { effort: opts.variant ?? opts.effort },
          include_reasoning: true,
        }
      : {}),
    ...(wantsStream ? { stream: true, stream_options: { include_usage: true } } : {}),
  });

  const post = (max: number): Promise<Response> => fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://vaktor.local',
        'X-Title': 'Vaktor',
      },
      body: makeBody(max),
      signal: withTimeout(OPENROUTER_TIMEOUT_MS, callOpts?.signal),
    },
  );

  try {
    let response = await post(requestedMax);

    // 402 por crédito insuficiente: repete com o máximo que a conta comporta
    if (!response.ok && response.status === 402) {
      const errorText = await response.text();
      const afford = /can only afford (\d+)/i.exec(errorText);
      const retryMax = afford
        ? Math.max(64, Number(afford[1]) - 64)
        : Math.floor(requestedMax / 2);

      if (retryMax >= 64 && retryMax < requestedMax) {
        response = await post(retryMax);
      } else {
        throw new Error(`OpenRouter API error: 402 - ${redactSecrets(errorText)}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${redactSecrets(error)}`);
    }

    let content = '';
    let reasoning: string | undefined;
    let usage: Record<string, unknown> | undefined;

    if (wantsStream) {
      const streamed = await readStream(response, callOpts?.onToken, callOpts?.onReasoningToken);
      content = streamed.content;
      reasoning = streamed.reasoning.trim().length > 0 ? streamed.reasoning : undefined;
      usage = streamed.usage;
    } else {
      const data = (await response.json()) as Record<string, unknown>;
      content = extractText(data);
      reasoning = extractReasoning(data);
      usage = data.usage as Record<string, unknown> | undefined;
    }

    // Usa o usage real quando disponível
    const inputTokens = Number(usage?.['prompt_tokens']) || estimateTokens(systemPrompt + JSON.stringify(conversation));
    const outputTokens = Number(usage?.['completion_tokens']) || estimateTokens(content);
    const details = usage?.['completion_tokens_details'];
    const reasoningTokens =
      Number((details as Record<string, unknown> | undefined)?.['reasoning_tokens']) ||
      Number(usage?.['reasoning_tokens']) ||
      undefined;

    const estimatedCostUsd =
      (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
      (outputTokens / 1000) * modelInfo.costPer1kTokensOutput;

    return {
      content,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      fromCache: false,
      ...(reasoning ? { reasoning } : {}),
      ...(reasoningTokens ? { reasoningTokens } : {}),
    };
  } catch (error) {
    throw new Error(
      `Failed to send to OpenRouter: ${redactSecrets(error instanceof Error ? error.message : String(error))}`
    );
  }
}

export { OPENROUTER_MODELS };
