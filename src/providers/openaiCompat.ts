// =============================================================
// Base compartilhada para provedores OpenAI-compatible.
//
// Concentra autenticação, histórico multi-turn, raciocínio nativo,
// parsing de usage/reasoning e cálculo de custo. Cada provedor só
// declara endpoint, cabeçalhos e catálogo.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

export interface OpenAiCompatConfig {
  baseUrl: string;
  timeoutMs: number;
  providerName: string;
  auth: 'bearer' | 'x-api-key';
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  maxTokensCap?: number;
  reasoningParam?: 'reasoning_effort' | 'reasoning';
}

type CompatModel = Pick<
  ModelInfo,
  'id' | 'name' | 'costPer1kTokensInput' | 'costPer1kTokensOutput'
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractReasoning(data: Record<string, unknown>): string | undefined {
  const choices = data['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = asRecord(asRecord(choices[0])['message']);

  for (const key of ['reasoning_content', 'reasoning']) {
    const direct = message[key];
    if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  }

  const details = message['reasoning_details'];
  if (Array.isArray(details)) {
    const parts: string[] = [];
    for (const item of details) {
      const detail = asRecord(item);
      const text = detail['text'] ?? detail['summary'] ?? detail['content'];
      if (typeof text === 'string' && text.trim().length > 0) parts.push(text);
    }
    if (parts.length > 0) return parts.join('\n');
  }

  return undefined;
}

function deltaReasoningText(delta: Record<string, unknown>): string {
  const direct = delta['reasoning_content'] ?? delta['reasoning'];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const details = delta['reasoning_details'];
  if (!Array.isArray(details)) return '';
  const parts: string[] = [];
  for (const item of details) {
    const detail = asRecord(item);
    const text = detail['text'] ?? detail['summary'] ?? detail['content'];
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
  if (!reader) throw new Error('Streaming sem corpo (body ausente)');

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
        const chunk = asRecord(JSON.parse(payload));
        if (chunk['usage'] && typeof chunk['usage'] === 'object') {
          usage = chunk['usage'] as Record<string, unknown>;
        }
        const choices = chunk['choices'];
        if (!Array.isArray(choices) || choices.length === 0) continue;
        const delta = asRecord(asRecord(choices[0])['delta']);

        const text = delta['content'];
        if (typeof text === 'string' && text.length > 0) {
          content += text;
          onToken?.(text);
        }
        const think = deltaReasoningText(delta);
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

export async function sendOpenAiCompatible(
  messages: ChatMessage[],
  model: CompatModel,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg,
  temperature: number | undefined,
  callOpts: ProviderCallOpts | undefined,
  config: OpenAiCompatConfig,
): Promise<RouterResponse> {
  const opts = typeof thinking === 'object' ? thinking : undefined;
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

  const requestedMax = config.maxTokensCap
    ? Math.min(maxTokens, config.maxTokensCap)
    : maxTokens;

  const wantsStream =
    typeof callOpts?.onToken === 'function' || typeof callOpts?.onReasoningToken === 'function';

  const body: Record<string, unknown> = {
    model: model.id,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...conversation,
    ],
    max_tokens: requestedMax,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    ...(opts?.strategy === 'native'
      ? config.reasoningParam === 'reasoning'
        ? { reasoning: { effort: opts.variant ?? opts.effort } }
        : { reasoning_effort: opts.variant ?? opts.effort }
      : {}),
    ...(config.extraBody ?? {}),
    ...(wantsStream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.extraHeaders ?? {}),
  };
  if (config.auth === 'x-api-key') {
    headers['x-api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: withTimeout(config.timeoutMs, callOpts?.signal),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '');
      throw new Error(
        `${config.providerName} API error: ${response.status} - ${redactSecrets(error).slice(0, 400)}`,
      );
    }

    let content = '';
    let reasoning: string | undefined;
    let usage: Record<string, unknown> = {};

    if (wantsStream) {
      const streamed = await readStream(response, callOpts?.onToken, callOpts?.onReasoningToken);
      content = streamed.content;
      reasoning = streamed.reasoning.trim().length > 0 ? streamed.reasoning : undefined;
      usage = streamed.usage ?? {};
    } else {
      const data = asRecord(await response.json());
      const choices = Array.isArray(data['choices']) ? data['choices'] : [];
      const message = asRecord(asRecord(choices[0])['message']);
      content = typeof message['content'] === 'string' ? message['content'] : '';
      usage = asRecord(data['usage']);
      reasoning = extractReasoning(data);
    }

    const inputTokens =
      Number(usage['prompt_tokens']) ||
      estimateTokens(systemPrompt + JSON.stringify(conversation));
    const outputTokens = Number(usage['completion_tokens']) || estimateTokens(content);
    const details = usage['completion_tokens_details'];
    const reasoningTokens =
      Number(asRecord(details)['reasoning_tokens']) ||
      Number(usage['reasoning_tokens']) ||
      undefined;

    return {
      text: content,
      model: model.id,
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        (inputTokens / 1000) * model.costPer1kTokensInput +
        (outputTokens / 1000) * model.costPer1kTokensOutput,
      fromCache: false,
      ...(reasoning ? { reasoning } : {}),
      ...(reasoningTokens ? { reasoningTokens } : {}),
    };
  } catch (error) {
    throw new Error(
      `Failed to send to ${config.providerName}: ${redactSecrets(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  }
}
