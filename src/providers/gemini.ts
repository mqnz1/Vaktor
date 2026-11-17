// =============================================================
// Google Gemini (Generative Language API, v1beta).
//
// - Autenticação via cabeçalho x-goog-api-key (a chave nunca vai
//   na URL, então nunca aparece em logs de rota).
// - Suporta streaming SSE quando há onToken (TUI mostra o texto
//   sendo gerado); sem onToken usa generateContent simples.
// - Sem GEMINI_API_KEY o router desvia para o Echo (catálogo
//   compartilhado) — ver adapter.ts.
// =============================================================
import type { ChatMessage, RouterResponse, ModelInfo } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

export const GEMINI_TIMEOUT_MS = 180_000;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_OUTPUT_TOKENS_CAP = 65_536;
const GEMINI_CATALOG_TIMEOUT_MS = 5000;

export interface GeminiModelDetails {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  inputTokenLimit?: unknown;
  supportedGenerationMethods?: unknown;
}

export const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Google)',
    provider: 'google',
    costPer1kTokensInput: 0.0003,
    costPer1kTokensOutput: 0.0025,
    contextWindow: 1_048_576,
    status: 'available',
    tier: 'standard',
    description: 'Rápido e barato, raciocínio adaptativo',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro (Google)',
    provider: 'google',
    costPer1kTokensInput: 0.00125,
    costPer1kTokensOutput: 0.01,
    contextWindow: 1_048_576,
    status: 'available',
    tier: 'premium',
    description: 'Raciocínio avançado para tarefas complexas',
  },
];

export function getGeminiModelById(id: string): ModelInfo | undefined {
  return GEMINI_MODELS.find(m => m.id === id);
}

const NON_CHAT_MODEL =
  /(?:^|[-/])(?:tts|image|transcribe|embedding|imagen|veo|lyria|nano-banana|robotics|computer-use|deep-research|antigravity)(?:$|[-/])/i;

export function isGeminiChatModel(id: string): boolean {
  return /^(?:gemini|gemma)-/i.test(id) && !NON_CHAT_MODEL.test(id);
}

function geminiCosts(id: string): { input: number; output: number } {
  const lower = id.toLowerCase();
  if (lower.includes('gemma')) return { input: 0, output: 0 };
  if (lower.includes('flash-lite') || lower.includes('-lite-')) {
    return { input: 0.0001, output: 0.0004 };
  }
  if (lower.includes('pro') || lower.includes('argon')) {
    return { input: 0.00125, output: 0.01 };
  }
  return { input: 0.0003, output: 0.0025 };
}

function geminiTier(id: string): ModelInfo['tier'] {
  const lower = id.toLowerCase();
  if (lower.includes('gemma') || lower.includes('flash-lite') || lower.includes('-lite-')) {
    return 'economy';
  }
  if (lower.includes('pro') || lower.includes('argon')) return 'premium';
  return 'standard';
}

function geminiVersionRank(id: string): number {
  if (id.endsWith('-latest')) return 1000;
  if (/^gemma-/i.test(id)) return -1;
  const match = id.match(/^gemini-(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : 0;
}

function geminiFamilyRank(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes('pro') || lower.includes('argon')) return 3;
  if (lower.includes('flash-lite') || lower.includes('-lite-')) return 1;
  if (lower.includes('flash') || lower.includes('omni')) return 2;
  return 0;
}

export function mapGeminiCatalog(details: readonly GeminiModelDetails[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];

  for (const item of details) {
    const rawName = typeof item.name === 'string' ? item.name.trim() : '';
    const id = rawName.replace(/^models\//, '');
    if (id.length === 0 || seen.has(id) || !isGeminiChatModel(id)) continue;

    const methods = Array.isArray(item.supportedGenerationMethods)
      ? item.supportedGenerationMethods.filter((m): m is string => typeof m === 'string')
      : [];
    if (!methods.includes('generateContent')) continue;

    const displayName =
      typeof item.displayName === 'string' && item.displayName.trim().length > 0
        ? item.displayName.trim()
        : id;
    const description =
      typeof item.description === 'string' && item.description.trim().length > 0
        ? item.description.trim()
        : 'Modelo Gemini disponível para esta chave';
    const contextWindow =
      typeof item.inputTokenLimit === 'number' && item.inputTokenLimit > 0
        ? item.inputTokenLimit
        : 1_048_576;
    const costs = geminiCosts(id);

    seen.add(id);
    out.push({
      id,
      name: displayName,
      provider: 'google',
      costPer1kTokensInput: costs.input,
      costPer1kTokensOutput: costs.output,
      contextWindow,
      status: 'available',
      tier: geminiTier(id),
      description,
    });
  }

  return out.sort(
    (a, b) =>
      geminiVersionRank(b.id) - geminiVersionRank(a.id) ||
      geminiFamilyRank(b.id) - geminiFamilyRank(a.id) ||
      a.id.localeCompare(b.id),
  );
}

export function geminiDynamicEnabled(): boolean {
  return (process.env['GEMINI_DYNAMIC_MODELS'] ?? 'true').toLowerCase() !== 'false';
}

export async function loadGeminiCatalog(
  apiKey: string,
  timeoutMs = GEMINI_CATALOG_TIMEOUT_MS,
): Promise<number> {
  if (!apiKey || !geminiDynamicEnabled()) return 0;

  try {
    const res = await fetch(`${GEMINI_BASE_URL}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: withTimeout(timeoutMs),
    });
    if (!res.ok) return 0;

    const data = (await res.json()) as { models?: GeminiModelDetails[] };
    const mapped = mapGeminiCatalog(Array.isArray(data.models) ? data.models : []);
    if (mapped.length === 0) return 0;
    GEMINI_MODELS.splice(0, GEMINI_MODELS.length, ...mapped);
    return mapped.length;
  } catch {
    return 0;
  }
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: GeminiUsage;
}

function toContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    contents.push({
      // O Gemini usa 'model'; 'tool' vira 'user' (mesma normalização dos demais).
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    });
  }
  return contents;
}

function systemInstructionOf(messages: ChatMessage[]): string | undefined {
  const sys = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  return sys.length > 0 ? sys : undefined;
}

export function buildGeminiBody(
  messages: ChatMessage[],
  maxTokens: number,
  thinking: ThinkingArg,
  temperature?: number,
  modelId?: string,
): Record<string, unknown> {
  const opts = typeof thinking === 'object' ? thinking : undefined;
  const system = systemInstructionOf(messages);
  const isGemini3 = modelId !== undefined && /gemini-[3-9]/i.test(modelId);

  // Variantes altas têm orçamento próprio (mesma escala do OpenCode).
  const variantBudget =
    opts?.variant === 'max' ? 24_576 : opts?.variant === 'high' ? 16_000 : undefined;

  // thinkingConfig: 'native' pede orçamento explícito; qualquer outra
  // estratégia (scratchpad textual, off) desliga o raciocínio interno
  // para não consumir tokens de resposta sem uso.
  const thinkingConfig =
    opts?.strategy === 'native'
      ? isGemini3
        ? {
            includeThoughts: true,
            thinkingLevel:
              opts.variant && opts.variant !== 'none' && opts.variant !== 'max'
                ? opts.variant
                : 'high',
          }
        : {
            includeThoughts: true,
            thinkingBudget: Math.max(
              0,
              Math.min(variantBudget ?? opts.budgetTokens, MAX_OUTPUT_TOKENS_CAP),
            ),
          }
      : isGemini3
        ? { thinkingLevel: 'minimal' }
        : { thinkingBudget: 0 };

  return {
    contents: toContents(messages),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      maxOutputTokens: Math.max(1, Math.min(maxTokens, MAX_OUTPUT_TOKENS_CAP)),
      ...(typeof temperature === 'number' ? { temperature } : {}),
      thinkingConfig,
    },
  };
}

function extractChunk(chunk: GeminiChunk): { text: string; reasoning: string } {
  let text = '';
  let reasoning = '';
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (typeof part.text !== 'string') continue;
    if (part.thought === true) reasoning += part.text;
    else text += part.text;
  }
  return { text, reasoning };
}

function usageOf(usage: GeminiUsage | undefined): {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
} {
  const reasoningTokens = Number(usage?.thoughtsTokenCount) || 0;
  return {
    inputTokens: Number(usage?.promptTokenCount) || 0,
    outputTokens: (Number(usage?.candidatesTokenCount) || 0) + reasoningTokens,
    reasoningTokens,
  };
}

/** Lê o SSE do streamGenerateContent e emite texto e raciocínio. */
async function readSse(
  res: Response,
  onToken: ((chunk: string) => void) | undefined,
  onReasoningToken: ((chunk: string) => void) | undefined,
): Promise<{ text: string; reasoning: string; usage: GeminiUsage | undefined }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Gemini stream sem corpo (body ausente)');

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  let usage: GeminiUsage | undefined;

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
        const chunk = JSON.parse(payload) as GeminiChunk;
        const part = extractChunk(chunk);
        if (part.text.length > 0) {
          text += part.text;
          onToken?.(part.text);
        }
        if (part.reasoning.length > 0) {
          reasoning += part.reasoning;
          onReasoningToken?.(part.reasoning);
        }
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      } catch {
        // Fragmento de linha ainda incompleto: ignora (o buffer continua).
      }
    }
  }

  return { text, reasoning, usage };
}

export async function sendToGemini(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  opts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo =
    getGeminiModelById(modelId) ??
    mapGeminiCatalog([
      {
        name: `models/${modelId}`,
        displayName: modelId,
        supportedGenerationMethods: ['generateContent'],
        inputTokenLimit: 1_048_576,
      },
    ])[0];
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in Gemini catalog`);
  }
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no .env');
  }

  const wantsStream =
    typeof opts?.onToken === 'function' || typeof opts?.onReasoningToken === 'function';
  const url =
    `${GEMINI_BASE_URL}/models/${modelId}:` +
    (wantsStream ? 'streamGenerateContent?alt=sse' : 'generateContent');
  const body = buildGeminiBody(messages, maxTokens, thinking, temperature, modelId);

  let text = '';
  let reasoning: string | undefined;
  let usage: GeminiUsage | undefined;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: withTimeout(GEMINI_TIMEOUT_MS, opts?.signal),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    const redacted = redactSecrets(errorBody).slice(0, 400);
    throw new Error(`Gemini API error ${res.status} ${res.statusText} - ${redacted}`);
  }

  if (wantsStream) {
    const out = await readSse(res, opts?.onToken, opts?.onReasoningToken);
    text = out.text;
    reasoning = out.reasoning.length > 0 ? out.reasoning : undefined;
    usage = out.usage;
  } else {
    const data = (await res.json()) as GeminiChunk;
    const part = extractChunk(data);
    text = part.text;
    reasoning = part.reasoning.length > 0 ? part.reasoning : undefined;
    usage = data.usageMetadata;
  }

  const { inputTokens, outputTokens, reasoningTokens } = usageOf(usage);
  const estimatedCostUsd =
    (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
    (outputTokens / 1000) * modelInfo.costPer1kTokensOutput;

  return {
    text,
    model: modelId,
    inputTokens,
    outputTokens,
    fromCache: false,
    estimatedCostUsd,
    ...(reasoning ? { reasoning } : {}),
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
  };
}
