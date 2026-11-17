// =============================================================
// Echo Free — roteador multi-provedor (Anthropic, OpenAI, Gemini).
// https://echo.router.merit.systems
//
// O Echo é um proxy para as APIs NATIVAS de cada provedor. Não existe um
// endpoint unificado OpenAI-compatible: a rota muda por família de modelo.
//   1. Anthropic → POST /v1/messages (header anthropic-version)
//   2. OpenAI    → POST /chat/completions (fallback: /responses)
//   3. Gemini    → POST /v1beta/models/{model}:generateContent
//
// Rotas como `echo.merit.systems/api/*` são o site (404 HTML) e
// `/v1/chat/completions` não existe no router. O fallback `/responses` só
// vale para OpenAI: usá-lo num Claude devolve o 401 da credencial upstream
// do OpenAI, mascarando o erro real.
//
// Credencial e política de falhas vêm de `extract.ts`: bootstrap único,
// retry limitado em 429/5xx/rede, nenhum retry em 401/402/403, cooldown
// após falha final e redação de segredos em toda mensagem de erro.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import {
  EchoError,
  buildEchoHttpError,
  ensureEchoReady,
  guardEchoCall,
  redactSecrets,
} from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const ECHO_BASE_URL = 'https://echo.router.merit.systems';
const ECHO_TIMEOUT_MS = 120_000;
const ANTHROPIC_VERSION = '2023-06-01';

// Modelos de raciocínio: max_completion_tokens (não max_tokens) e sem temperature
const REASONING_RE = /^(gpt-5|o[1-9])/;

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
    name: `${name} (Echo Free)`,
    provider: 'echo',
    costPer1kTokensInput: costPer1MInput / 1000,
    costPer1kTokensOutput: costPer1MOutput / 1000,
    contextWindow,
    status: 'available',
    tier: costPer1MInput >= 10 ? 'premium' : costPer1MInput >= 0.8 ? 'standard' : 'economy',
    description,
  };
}

// Catálogo Echo — preços por 1M tokens conforme tabela do provedor.
export const ECHO_MODELS: ModelInfo[] = [
  // ── Anthropic ──
  // Somente IDs aceitos pelo Echo (testados contra /v1/messages). Modelos
  // antigos como claude-3-5-haiku-20241022 retornam 404 no upstream.
  model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 1.00, 5.00, 200000, 'Haiku 4.5, rápido e capaz'),
  model('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', 3.00, 15.00, 200000, 'Sonnet 4.5, código forte'),
  model('claude-sonnet-4-6', 'Claude Sonnet 4.6', 3.00, 15.00, 200000, 'Sonnet 4.6'),
  model('claude-opus-4-8', 'Claude Opus 4.8', 5.00, 25.00, 200000, 'Opus 4.8, topo de linha'),
  // ── OpenAI ──
  model('gpt-3.5-turbo', 'GPT-3.5 Turbo', 0.50, 1.50, 16384, 'Legado, ainda útil'),
  model('gpt-3.5-turbo-0125', 'GPT-3.5 Turbo 0125', 0.50, 1.50, 16384, 'Revisão janeiro 2025'),
  model('gpt-3.5-turbo-1106', 'GPT-3.5 Turbo 1106', 0.50, 1.50, 16384, 'Revisão novembro 2024'),
  model('gpt-3.5-turbo-16k', 'GPT-3.5 Turbo 16k', 0.50, 1.50, 16384, 'Contexto estendido 16k'),
  model('gpt-3.5-turbo-instruct', 'GPT-3.5 Turbo Instruct', 1.50, 2.00, 4096, 'Modo instruct'),
  model('gpt-3.5-turbo-instruct-0914', 'GPT-3.5 Instruct 0914', 1.50, 2.00, 4096, 'Instruct revisão 0914'),
  model('gpt-4', 'GPT-4', 0.40, 1.60, 8192, 'Clássico GPT-4'),
  model('gpt-4-0125-preview', 'GPT-4 0125 Preview', 0.40, 1.60, 128000, 'Preview contexto 128k'),
  model('gpt-4-0613', 'GPT-4 0613', 0.40, 1.60, 8192, 'Revisão junho 2023'),
  model('gpt-4-1106-preview', 'GPT-4 1106 Preview', 0.40, 1.60, 128000, 'Preview contexto 128k'),
  model('gpt-4-turbo', 'GPT-4 Turbo', 10.00, 30.00, 128000, 'Turbo, rápido e capaz'),
  model('gpt-4-turbo-2024-04-09', 'GPT-4 Turbo 2024-04-09', 10.00, 30.00, 128000, 'Turbo revisão abril 2024'),
  model('gpt-4-turbo-preview', 'GPT-4 Turbo Preview', 10.00, 30.00, 128000, 'Turbo preview'),
  model('gpt-4.1', 'GPT-4.1', 2.00, 8.00, 1047576, 'Contexto de 1M tokens'),
  model('gpt-4.1-2025-04-14', 'GPT-4.1 (2025-04-14)', 2.00, 8.00, 1048576, 'GPT-4.1 com data'),
  model('gpt-4.1-mini', 'GPT-4.1 Mini', 0.40, 1.60, 1048576, '4.1 econômico'),
  model('gpt-4.1-mini-2025-04-14', 'GPT-4.1 Mini (2025-04-14)', 0.40, 1.60, 1048576, '4.1 Mini com data'),
  model('gpt-4.1-nano', 'GPT-4.1 Nano', 0.10, 0.40, 1048576, 'O mais barato da família'),
  model('gpt-4.1-nano-2025-04-14', 'GPT-4.1 Nano (2025-04-14)', 0.10, 0.40, 1048576, '4.1 Nano com data'),
  model('gpt-4o', 'GPT-4o', 2.50, 10.00, 128000, 'Multimodal rápido'),
  model('gpt-4o-2024-05-13', 'GPT-4o (2024-05-13)', 2.50, 10.00, 128000, '4o revisão maio 2024'),
  model('gpt-4o-2024-08-06', 'GPT-4o (2024-08-06)', 2.50, 10.00, 128000, '4o revisão agosto 2024'),
  model('gpt-4o-2024-11-20', 'GPT-4o (2024-11-20)', 2.50, 10.00, 128000, '4o revisão novembro 2024'),
  model('gpt-4o-mini', 'GPT-4o Mini', 0.15, 0.60, 128000, 'Econômico do dia a dia'),
  model('gpt-4o-mini-2024-07-18', 'GPT-4o Mini (2024-07-18)', 0.15, 0.60, 128000, '4o Mini com data'),
  model('gpt-4o-mini-search-preview', 'GPT-4o Mini Search', 0.15, 0.60, 128000, 'Com busca web'),
  model('gpt-4o-mini-search-preview-2025-03-11', 'GPT-4o Mini Search (03-11)', 0.15, 0.60, 128000, 'Search com data'),
  model('gpt-4o-search-preview', 'GPT-4o Search', 2.50, 10.00, 128000, '4o com busca web'),
  model('gpt-4o-search-preview-2025-03-11', 'GPT-4o Search (03-11)', 2.50, 10.00, 128000, 'Search com data'),
  model('gpt-5', 'GPT-5', 1.25, 10.00, 400000, 'Raciocínio nativo (API Responses)'),
  model('gpt-5-2025-08-07', 'GPT-5 (2025-08-07)', 1.25, 10.00, 400000, 'GPT-5 com data'),
  model('gpt-5-chat-latest', 'GPT-5 Chat', 1.25, 10.00, 128000, 'GPT-5 modo chat'),
  model('gpt-5-codex', 'GPT-5 Codex', 1.25, 10.00, 400000, 'Especialista em código'),
  model('gpt-5-mini', 'GPT-5 Mini', 0.25, 2.00, 400000, 'GPT-5 econômico'),
  model('gpt-5-mini-2025-08-07', 'GPT-5 Mini (2025-08-07)', 0.25, 2.00, 400000, 'GPT-5 Mini com data'),
  model('gpt-5-nano', 'GPT-5 Nano', 0.05, 0.40, 400000, 'O mais barato com raciocínio'),
  model('gpt-5-nano-2025-08-07', 'GPT-5 Nano (2025-08-07)', 0.05, 0.40, 400000, 'GPT-5 Nano com data'),
  model('gpt-5-pro', 'GPT-5 Pro', 15.00, 120.00, 400000, 'Raciocínio profundo'),
  model('gpt-5-pro-2025-10-06', 'GPT-5 Pro (2025-10-06)', 15.00, 120.00, 400000, 'GPT-5 Pro com data'),
  model('gpt-5-search-api', 'GPT-5 Search', 1.25, 10.00, 128000, 'GPT-5 com busca'),
  model('gpt-5-search-api-2025-10-14', 'GPT-5 Search (10-14)', 1.25, 10.00, 128000, 'Search com data'),
  model('o1', 'o1', 15.00, 60.00, 200000, 'Raciocínio profundo da série o'),
  model('o1-2024-12-17', 'o1 (2024-12-17)', 15.00, 60.00, 200000, 'o1 com data'),
  model('o1-mini', 'o1-mini', 15.00, 60.00, 128000, 'o1 compacto'),
  model('o1-mini-2024-09-12', 'o1-mini (09-12)', 15.00, 60.00, 128000, 'o1-mini com data'),
  model('o1-pro', 'o1-pro', 15.00, 60.00, 200000, 'o1 com mais compute'),
  model('o1-pro-2025-03-19', 'o1-pro (03-19)', 15.00, 60.00, 200000, 'o1-pro com data'),
  model('o3', 'o3', 2.00, 8.00, 200000, 'Série o3'),
  model('o3-2025-04-16', 'o3 (2025-04-16)', 2.00, 8.00, 200000, 'o3 com data'),
  model('o3-deep-research', 'o3 Deep Research', 2.00, 8.00, 200000, 'Pesquisa profunda'),
  model('o3-deep-research-2025-06-26', 'o3 Deep Research (06-26)', 2.00, 8.00, 200000, 'Deep Research com data'),
  model('o3-mini', 'o3-mini', 1.10, 4.40, 200000, 'o3 econômico'),
  model('o3-mini-2025-01-31', 'o3-mini (01-31)', 1.10, 4.40, 200000, 'o3-mini com data'),
  model('o3-pro', 'o3-pro', 2.00, 8.00, 200000, 'o3 com mais compute'),
  model('o3-pro-2025-06-10', 'o3-pro (06-10)', 2.00, 8.00, 200000, 'o3-pro com data'),
  // ── Gemini ──
  // IDs aceitos pelo Echo (testados contra /v1beta/models/{id}:generateContent).
  // A família 2.0 foi descontinuada pelo upstream; 2.5-flash-lite está fechada
  // para contas novas.
  model('gemini-2.5-flash', 'Gemini 2.5 Flash', 0.30, 2.50, 1048576, 'Flash 2.5, equilibrado'),
  model('gemini-2.5-pro', 'Gemini 2.5 Pro', 1.25, 10.00, 1048576, 'Pro com raciocínio'),
  model('gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 0.30, 2.50, 1048576, 'Geração de imagens'),
];

/** Família do modelo Echo (para agrupar no menu: Anthropic/OpenAI/Gemini). */
export function echoFamily(id: string): 'Anthropic' | 'OpenAI' | 'Gemini' {
  if (id.startsWith('claude')) return 'Anthropic';
  if (id.startsWith('gemini')) return 'Gemini';
  return 'OpenAI';
}

export function getEchoModelById(id: string): ModelInfo | undefined {
  return ECHO_MODELS.find(m => m.id === id);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Raciocínio nativo no formato chat (reasoning/reasoning_content/reasoning_details)
function extractChatReasoning(data: Record<string, unknown>): string | undefined {
  const choices = data['choices'];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = asRecord(asRecord(choices[0])['message']);
  const direct = message['reasoning'] ?? message['reasoning_content'];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  const details = message['reasoning_details'];
  if (Array.isArray(details)) {
    const parts: string[] = [];
    for (const item of details) {
      const text = asRecord(item)['text'] ?? asRecord(item)['summary'] ?? asRecord(item)['content'];
      if (typeof text === 'string' && text.trim().length > 0) parts.push(text);
    }
    if (parts.length > 0) return parts.join('\n');
  }
  return undefined;
}

// Raciocínio no formato Responses (item type "reasoning" com summary[])
function extractResponsesReasoning(data: Record<string, unknown>): string | undefined {
  const output = data['output'];
  if (!Array.isArray(output)) return undefined;
  const parts: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (record['type'] !== 'reasoning') continue;
    const summary = record['summary'];
    if (!Array.isArray(summary)) continue;
    for (const piece of summary) {
      const text = asRecord(piece)['text'];
      if (typeof text === 'string' && text.trim().length > 0) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

// output_text no formato Responses: concatena blocos output_text das mensagens
function extractResponsesText(data: Record<string, unknown>): string {
  const output = data['output'];
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (record['type'] !== 'message') continue;
    const content = record['content'];
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const blockRecord = asRecord(block);
      if (blockRecord['type'] === 'output_text' && typeof blockRecord['text'] === 'string') {
        parts.push(blockRecord['text']);
      }
    }
  }
  return parts.join('\n');
}

// Anthropic Messages: content[] com blocos text/thinking.
function extractAnthropicText(data: Record<string, unknown>): string {
  const content = data['content'];
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (record['type'] === 'text' && typeof record['text'] === 'string') {
      parts.push(record['text']);
    }
  }
  return parts.join('\n');
}

function extractAnthropicReasoning(data: Record<string, unknown>): string | undefined {
  const content = data['content'];
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (record['type'] === 'thinking' && typeof record['thinking'] === 'string' && record['thinking'].trim()) {
      parts.push(record['thinking']);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

// Gemini generateContent: candidates[0].content.parts[]
function geminiParts(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const candidates = data['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const content = asRecord(asRecord(candidates[0])['content']);
  const parts = content['parts'];
  return Array.isArray(parts) ? parts.map(part => asRecord(part)) : [];
}

function extractGeminiText(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const part of geminiParts(data)) {
    if (part['thought'] === true) continue;
    if (typeof part['text'] === 'string') parts.push(part['text']);
  }
  return parts.join('');
}

function extractGeminiReasoning(data: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const part of geminiParts(data)) {
    if (part['thought'] === true && typeof part['text'] === 'string' && part['text'].trim()) {
      parts.push(part['text']);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

// Só vale tentar /responses quando o chat/completions do OpenAI rejeitou O
// MODELO (404/422/not found/não suportado). Erros de autenticação, cota e 5xx
// do upstream nunca devem gerar segunda tentativa — mascararia o erro real.
function shouldRetryWithResponses(error: unknown): boolean {
  if (!(error instanceof EchoError)) return false;
  if (error.status === 404 || error.status === 422) return true;
  return error.kind === 'model'
    && /not[_ ]found|no longer available|does not yet support/i.test(error.detail);
}

/**
 * Chamada HTTP única, mediada pela guarda de credenciais: timeout por
 * tentativa, retry limitado e erro já classificado/redigido.
 */
async function postEcho(
  label: string,
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  return guardEchoCall(label, async () => {
    const res = await fetch(`${ECHO_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: withTimeout(ECHO_TIMEOUT_MS, signal),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw buildEchoHttpError(label, res.status, text, res.headers);
    }

    const raw = await res.text();
    try {
      return asRecord(JSON.parse(raw) as unknown);
    } catch {
      throw new EchoError(`Echo Free (${label}): resposta ilegível do provedor`, {
        kind: 'upstream',
        status: res.status,
        detail: redactSecrets(raw).slice(0, 200),
        hint: 'O Echo Free respondeu sem JSON válido; confira o status do serviço.',
      });
    }
  });
}

interface EchoCallParts {
  systemPrompt: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// Anthropic nativo: /v1/messages (o Echo repassa para api.anthropic.com).
async function viaAnthropicMessages(
  parts: EchoCallParts,
  model: string,
  maxTokens: number,
  apiKey: string,
  temperature: number,
  modelInfo: ModelInfo,
  signal?: AbortSignal,
): Promise<RouterResponse> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: parts.conversation,
    temperature,
    ...(parts.systemPrompt ? { system: parts.systemPrompt } : {}),
  };

  const data = await postEcho('anthropic', '/v1/messages', body, apiKey, signal, {
    'anthropic-version': ANTHROPIC_VERSION,
  });
  const content = extractAnthropicText(data);
  const usage = asRecord(data['usage']);
  const inputTokens = Number(usage['input_tokens']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['output_tokens']) || estimateTokens(content);
  const reasoning = extractAnthropicReasoning(data);

  return {
    text: content,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
      (outputTokens / 1000) * modelInfo.costPer1kTokensOutput,
    fromCache: false,
    ...(reasoning ? { reasoning } : {}),
  };
}

// Gemini nativo: /v1beta/models/{model}:generateContent.
async function viaGemini(
  parts: EchoCallParts,
  model: string,
  maxTokens: number,
  apiKey: string,
  temperature: number,
  modelInfo: ModelInfo,
  signal?: AbortSignal,
): Promise<RouterResponse> {
  const body: Record<string, unknown> = {
    contents: parts.conversation.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
    ...(parts.systemPrompt
      ? { systemInstruction: { parts: [{ text: parts.systemPrompt }] } }
      : {}),
  };

  const data = await postEcho(
    'gemini',
    `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    body,
    apiKey,
    signal,
  );
  const content = extractGeminiText(data);
  const usage = asRecord(data['usageMetadata']);
  const inputTokens = Number(usage['promptTokenCount']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['candidatesTokenCount']) || estimateTokens(content);
  const reasoning = extractGeminiReasoning(data);

  return {
    text: content,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
      (outputTokens / 1000) * modelInfo.costPer1kTokensOutput,
    fromCache: false,
    ...(reasoning ? { reasoning } : {}),
  };
}

async function viaChatCompletions(
  parts: EchoCallParts,
  model: string,
  maxTokens: number,
  apiKey: string,
  opts: ThinkingOptions | undefined,
  temperature: number,
  modelInfo: ModelInfo,
  signal?: AbortSignal,
): Promise<RouterResponse> {
  const isReasoning = REASONING_RE.test(model);
  const body: Record<string, unknown> = {
    model,
    messages: [
      ...(parts.systemPrompt ? [{ role: 'system', content: parts.systemPrompt }] : []),
      ...parts.conversation,
    ],
    ...(isReasoning
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens, temperature }),
    ...(opts?.strategy === 'native' && isReasoning
      ? { reasoning_effort: opts.effort }
      : {}),
  };

  const data = await postEcho('chat', '/chat/completions', body, apiKey, signal);
  const choices = Array.isArray(data['choices']) ? data['choices'] : [];
  const message = asRecord(asRecord(choices[0])['message']);
  const content = typeof message['content'] === 'string' ? message['content'] : '';
  const usage = asRecord(data['usage']);
  const inputTokens = Number(usage['prompt_tokens']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['completion_tokens']) || estimateTokens(content);
  const reasoning = extractChatReasoning(data);

  return {
    text: content,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
      (outputTokens / 1000) * modelInfo.costPer1kTokensOutput,
    fromCache: false,
    ...(reasoning ? { reasoning } : {}),
  };
}

async function viaResponses(
  parts: EchoCallParts,
  model: string,
  maxTokens: number,
  apiKey: string,
  opts: ThinkingOptions | undefined,
  temperature: number,
  modelInfo: ModelInfo,
  signal?: AbortSignal,
): Promise<RouterResponse> {
  const isReasoning = REASONING_RE.test(model);
  const body: Record<string, unknown> = {
    model,
    ...(parts.systemPrompt ? { instructions: parts.systemPrompt } : {}),
    input: parts.conversation,
    max_output_tokens: maxTokens,
    ...(!isReasoning ? { temperature } : {}),
    ...(opts?.strategy === 'native' && isReasoning
      ? { reasoning: { effort: opts.effort } }
      : {}),
  };

  const data = await postEcho('responses', '/responses', body, apiKey, signal);
  const content = extractResponsesText(data);
  const usage = asRecord(data['usage']);
  const inputTokens = Number(usage['input_tokens']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['output_tokens']) || estimateTokens(content);
  const reasoning = extractResponsesReasoning(data);

  return {
    text: content,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
      (outputTokens / 1000) * modelInfo.costPer1kTokensOutput,
    fromCache: false,
    ...(reasoning ? { reasoning } : {}),
  };
}

export async function sendToEcho(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature = 0.7,
  onBoot?: (notice: string) => void,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getEchoModelById(modelId);
  if (!modelInfo) {
    throw new EchoError(`Model ${modelId} not found in Echo Free catalog`, {
      kind: 'model',
      hint: 'Modelo fora do catálogo Echo Free; escolha outro em /models.',
    });
  }

  // Bootstrap único por chave (papel legítimo herdado de boot.py): valida a
  // credencial antes da primeira chamada e avisa a UI uma única vez.
  const boot = ensureEchoReady(apiKey);
  if (boot.booted) {
    const suffix = boot.credential.formatOk ? '' : ' (formato de chave não padrão)';
    onBoot?.(`Echo Free autenticado · ${boot.credential.masked}${suffix}`);
  }

  const opts = typeof thinking === 'object' ? thinking : undefined;
  const parts: EchoCallParts = {
    systemPrompt: messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n'),
    conversation: messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  };

  const signal = callOpts?.signal;
  const family = echoFamily(modelId);
  if (family === 'Anthropic') {
    return viaAnthropicMessages(
      parts, modelId, maxTokens, boot.credential.token, temperature, modelInfo, signal,
    );
  }
  if (family === 'Gemini') {
    return viaGemini(
      parts, modelId, maxTokens, boot.credential.token, temperature, modelInfo, signal,
    );
  }

  // OpenAI: chat/completions nativo; /responses só quando o modelo exigir.
  try {
    return await viaChatCompletions(
      parts, modelId, maxTokens, boot.credential.token, opts, temperature, modelInfo, signal,
    );
  } catch (error) {
    if (!shouldRetryWithResponses(error)) throw error;
    return viaResponses(
      parts, modelId, maxTokens, boot.credential.token, opts, temperature, modelInfo, signal,
    );
  }
}
