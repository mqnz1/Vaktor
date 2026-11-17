// =============================================================
// OpenCode Zen — gateway de modelos do OpenCode (opencode.ai/zen).
// https://opencode.ai/zen/v1
//
// Um endpoint por FAMÍLIA de modelo (validado com chamadas reais):
//  - chat/completions (Bearer): GLM, Kimi, MiniMax, DeepSeek, Mistral,
//    Qwen3.8 Max e os Free (big-pickle, beam-free, flint, mimo, nemotron)
//  - responses (Bearer): famílias GPT-5/6, Grok e Muse (API Responses)
//  - messages (x-api-key + anthropic-version): Claude e Qwen Plus/Flash
//  - models/{id}:generateContent (x-goog-api-key): Gemini
//
// Custos: o /v1/models não expõe preços; os valores abaixo são estimativas
// por família (documentados no README). Modelos Free custam zero.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
const ZEN_TIMEOUT_MS = 120_000;

type ZenMode = 'chat' | 'responses' | 'anthropic' | 'google';

interface ZenEntry {
  id: string;
  name: string;
  mode: ZenMode;
  costPer1MInput: number;
  costPer1MOutput: number;
  contextWindow: number;
  description: string;
}

// Catálogo Zen (lista viva de opencode.ai/zen/v1/models, 81 modelos de chat;
// fora: jev-1.13/-free [decisão estruturada], test, claude-opus-5-5-backup).
const CATALOG: ZenEntry[] = [
  // ── Claude (formato Anthropic) ──
  { id: 'claude-fable-5', name: 'Claude Fable 5', mode: 'anthropic', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 200000, description: 'Variante Fable do Claude' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', mode: 'anthropic', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 200000, description: 'Fable 5.1' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', mode: 'anthropic', costPer1MInput: 1, costPer1MOutput: 5, contextWindow: 200000, description: 'Rápido e econômico' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', mode: 'anthropic', costPer1MInput: 1, costPer1MOutput: 5, contextWindow: 200000, description: 'Haiku mais recente' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', mode: 'anthropic', costPer1MInput: 15, costPer1MOutput: 75, contextWindow: 200000, description: 'Opus 4.5' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', mode: 'anthropic', costPer1MInput: 15, costPer1MOutput: 75, contextWindow: 200000, description: 'Opus 4.6' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', mode: 'anthropic', costPer1MInput: 15, costPer1MOutput: 75, contextWindow: 200000, description: 'Opus 4.7' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', mode: 'anthropic', costPer1MInput: 15, costPer1MOutput: 75, contextWindow: 200000, description: 'Opus 4.8' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', mode: 'anthropic', costPer1MInput: 15, costPer1MOutput: 75, contextWindow: 200000, description: 'Opus 5' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', mode: 'anthropic', costPer1MInput: 15, costPer1MOutput: 75, contextWindow: 200000, description: 'Claude topo de linha' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', mode: 'anthropic', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 200000, description: 'Sonnet 4.5' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', mode: 'anthropic', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 200000, description: 'Sonnet 4.6' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', mode: 'anthropic', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 200000, description: 'Sonnet 5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', mode: 'anthropic', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 200000, description: 'Sonnet mais recente' },
  // ── Gemini (formato Google) ──
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', mode: 'google', costPer1MInput: 0.3, costPer1MOutput: 2.5, contextWindow: 1048576, description: 'Flash da geração 3' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', mode: 'google', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 1048576, description: 'Pro com raciocínio' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', mode: 'google', costPer1MInput: 0.3, costPer1MOutput: 2.5, contextWindow: 1048576, description: 'Flash 3.5' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', mode: 'google', costPer1MInput: 0.1, costPer1MOutput: 0.4, contextWindow: 1048576, description: 'Lite econômico' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', mode: 'google', costPer1MInput: 0.3, costPer1MOutput: 2.5, contextWindow: 1048576, description: 'Flash 3.6' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', mode: 'google', costPer1MInput: 0.3, costPer1MOutput: 2.5, contextWindow: 1048576, description: 'Flash 3.7' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', mode: 'google', costPer1MInput: 0.3, costPer1MOutput: 2.5, contextWindow: 1048576, description: 'Flash mais recente' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', mode: 'google', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 1048576, description: 'Geração 4, Argon' },
  // ── Qwen ──
  { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', mode: 'anthropic', costPer1MInput: 0.4, costPer1MOutput: 1.6, contextWindow: 131072, description: 'Qwen Plus' },
  { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', mode: 'anthropic', costPer1MInput: 0.4, costPer1MOutput: 1.6, contextWindow: 131072, description: 'Qwen Plus' },
  { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', mode: 'anthropic', costPer1MInput: 0.1, costPer1MOutput: 0.4, contextWindow: 131072, description: 'Qwen rápido' },
  { id: 'qwen3.8-max', name: 'Qwen 3.8 Max', mode: 'chat', costPer1MInput: 1.2, costPer1MOutput: 6, contextWindow: 131072, description: 'Qwen topo de linha' },
  // ── GPT (API Responses) ──
  { id: 'gpt-5', name: 'GPT-5', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'GPT-5' },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Especialista em código' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', mode: 'responses', costPer1MInput: 0.05, costPer1MOutput: 0.4, contextWindow: 400000, description: 'O mais barato' },
  { id: 'gpt-5.1', name: 'GPT-5.1', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'GPT-5.1' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Codex 5.1' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', mode: 'responses', costPer1MInput: 15, costPer1MOutput: 120, contextWindow: 400000, description: 'Codex com mais compute' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', mode: 'responses', costPer1MInput: 0.25, costPer1MOutput: 2, contextWindow: 400000, description: 'Codex econômico' },
  { id: 'gpt-5.2', name: 'GPT-5.2', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'GPT-5.2' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Codex 5.2' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Codex 5.3' },
  { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', mode: 'responses', costPer1MInput: 0.25, costPer1MOutput: 2, contextWindow: 400000, description: 'Codex veloz' },
  { id: 'gpt-5.4', name: 'GPT-5.4', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', mode: 'responses', costPer1MInput: 0.25, costPer1MOutput: 2, contextWindow: 400000, description: '5.4 econômico' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', mode: 'responses', costPer1MInput: 0.05, costPer1MOutput: 0.4, contextWindow: 400000, description: '5.4 nano' },
  { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', mode: 'responses', costPer1MInput: 15, costPer1MOutput: 120, contextWindow: 400000, description: 'Raciocínio profundo' },
  { id: 'gpt-5.5', name: 'GPT-5.5', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'GPT-5.5' },
  { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', mode: 'responses', costPer1MInput: 15, costPer1MOutput: 120, contextWindow: 400000, description: '5.5 com mais compute' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Variante Luna' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Variante Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Variante Terra' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Geração 6, Astra' },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Geração 6, Sol' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'GPT-6.1' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', mode: 'responses', costPer1MInput: 1.25, costPer1MOutput: 10, contextWindow: 400000, description: 'Geração 6, Luna' },
  // ── Grok (API Responses) ──
  { id: 'grok-4.5', name: 'Grok 4.5', mode: 'responses', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 131072, description: 'xAI Grok 4.5' },
  { id: 'grok-4.6', name: 'Grok 4.6', mode: 'responses', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 131072, description: 'xAI Grok 4.6' },
  { id: 'grok-4.7', name: 'Grok 4.7', mode: 'responses', costPer1MInput: 3, costPer1MOutput: 15, contextWindow: 131072, description: 'xAI Grok 4.7' },
  { id: 'grok-build-0.1', name: 'Grok Build 0.1', mode: 'responses', costPer1MInput: 0.2, costPer1MOutput: 0.8, contextWindow: 131072, description: 'Grok para builds' },
  // ── Muse (API Responses) ──
  { id: 'muse-spark-1.2', name: 'Muse Spark 1.2', mode: 'responses', costPer1MInput: 0.2, costPer1MOutput: 0.8, contextWindow: 131072, description: 'Muse Spark 1.2' },
  { id: 'muse-spark-1.3', name: 'Muse Spark 1.3', mode: 'responses', costPer1MInput: 0.2, costPer1MOutput: 0.8, contextWindow: 131072, description: 'Muse Spark 1.3' },
  { id: 'muse-wonder-1.0', name: 'Muse Wonder 1.0', mode: 'responses', costPer1MInput: 0.2, costPer1MOutput: 0.8, contextWindow: 131072, description: 'Muse Wonder' },
  // ── GLM (chat/completions) ──
  { id: 'glm-5', name: 'GLM 5', mode: 'chat', costPer1MInput: 0.6, costPer1MOutput: 2.2, contextWindow: 131072, description: 'Zhipu GLM 5' },
  { id: 'glm-5.1', name: 'GLM 5.1', mode: 'chat', costPer1MInput: 0.6, costPer1MOutput: 2.2, contextWindow: 131072, description: 'GLM 5.1' },
  { id: 'glm-5.2', name: 'GLM 5.2', mode: 'chat', costPer1MInput: 0.6, costPer1MOutput: 2.2, contextWindow: 131072, description: 'GLM 5.2' },
  { id: 'glm-5.3', name: 'GLM 5.3', mode: 'chat', costPer1MInput: 0.6, costPer1MOutput: 2.2, contextWindow: 131072, description: 'GLM geralista forte' },
  { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', mode: 'chat', costPer1MInput: 0.06, costPer1MOutput: 0.24, contextWindow: 131072, description: 'GLM rápido' },
  { id: 'glm-5.3-flash-free', name: 'GLM 5.3 Flash (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 131072, description: 'Grátis' },
  // ── Kimi (chat/completions) ──
  { id: 'kimi-k2.5', name: 'Kimi K2.5', mode: 'chat', costPer1MInput: 0.6, costPer1MOutput: 2.2, contextWindow: 262144, description: 'Moonshot Kimi' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', mode: 'chat', costPer1MInput: 0.6, costPer1MOutput: 2.2, contextWindow: 262144, description: 'Kimi K2.6' },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', mode: 'chat', costPer1MInput: 0.6, costPer1MOutput: 2.2, contextWindow: 262144, description: 'Kimi para código' },
  { id: 'kimi-k3', name: 'Kimi K3', mode: 'chat', costPer1MInput: 1, costPer1MOutput: 3, contextWindow: 262144, description: 'Kimi topo de linha' },
  // ── MiniMax (chat/completions) ──
  { id: 'minimax-m2.5', name: 'MiniMax M2.5', mode: 'chat', costPer1MInput: 0.3, costPer1MOutput: 1.2, contextWindow: 1000000, description: 'MiniMax M2.5' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7', mode: 'chat', costPer1MInput: 0.3, costPer1MOutput: 1.2, contextWindow: 1000000, description: 'MiniMax M2.7' },
  { id: 'minimax-m3', name: 'MiniMax M3', mode: 'chat', costPer1MInput: 0.3, costPer1MOutput: 1.2, contextWindow: 1000000, description: 'MiniMax M3' },
  // ── DeepSeek (chat/completions) ──
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', mode: 'chat', costPer1MInput: 0.1, costPer1MOutput: 0.4, contextWindow: 131072, description: 'DeepSeek rápido' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', mode: 'chat', costPer1MInput: 0.1, costPer1MOutput: 0.4, contextWindow: 131072, description: 'Flash mais recente' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', mode: 'chat', costPer1MInput: 0.8, costPer1MOutput: 2.4, contextWindow: 131072, description: 'DeepSeek Pro' },
  { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 131072, description: 'Grátis' },
  // ── Mistral (chat/completions) ──
  { id: 'mistral-large-4', name: 'Mistral Large 4', mode: 'chat', costPer1MInput: 2, costPer1MOutput: 6, contextWindow: 131072, description: 'Mistral Large 4' },
  // ── Free (chat/completions) ──
  { id: 'big-pickle', name: 'Big Pickle (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 32768, description: 'Grátis' },
  { id: 'beam-free', name: 'Beam (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 32768, description: 'Grátis' },
  { id: 'flint-40b-free', name: 'Flint 40B (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 32768, description: 'Grátis' },
  { id: 'mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 131072, description: 'Grátis' },
  { id: 'nemotron-3.5-super-vl-free', name: 'Nemotron 3.5 Super VL (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 131072, description: 'Grátis' },
  { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning (Free)', mode: 'chat', costPer1MInput: 0, costPer1MOutput: 0, contextWindow: 131072, description: 'Grátis' },
];

export const OPENCODE_MODELS: ModelInfo[] = CATALOG.map(entry => ({
  id: entry.id,
  name: `${entry.name} (OpenCode)`,
  provider: 'opencode',
  costPer1kTokensInput: entry.costPer1MInput / 1000,
  costPer1kTokensOutput: entry.costPer1MOutput / 1000,
  contextWindow: entry.contextWindow,
  status: 'available',
  tier: entry.costPer1MInput === 0
    ? 'economy'
    : entry.costPer1MInput >= 10 ? 'premium' : entry.costPer1MInput >= 0.8 ? 'standard' : 'economy',
  description: entry.description,
}));

export function getOpencodeModelById(id: string): ModelInfo | undefined {
  return OPENCODE_MODELS.find(m => m.id === id);
}

function getZenEntry(id: string): ZenEntry | undefined {
  return CATALOG.find(entry => entry.id === id);
}

/** Família do modelo Zen (para agrupar no menu). */
export function opencodeFamily(id: string): string {
  if (id.startsWith('claude')) return 'Claude';
  if (id.startsWith('gemini')) return 'Gemini';
  if (id.startsWith('gpt')) return 'GPT';
  if (id.startsWith('grok')) return 'Grok';
  if (id.startsWith('qwen')) return 'Qwen';
  if (id.startsWith('glm')) return 'GLM';
  if (id.startsWith('kimi')) return 'Kimi';
  if (id.startsWith('minimax')) return 'MiniMax';
  if (id.startsWith('deepseek')) return 'DeepSeek';
  if (id.startsWith('muse')) return 'Muse';
  if (id.startsWith('mistral')) return 'Mistral';
  return 'Outros';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface CallParts {
  systemPrompt: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
}

async function readError(res: Response, label: string): Promise<Error> {
  const text = await res.text().catch(() => '');
  return new Error(`OpenCode Zen error (${label}): ${res.status} - ${redactSecrets(text).slice(0, 400)}`);
}

/* ── Formato 1: chat/completions (Bearer) ── */
async function viaChat(parts: CallParts, model: string, maxTokens: number, apiKey: string, temperature: number, info: ModelInfo, signal?: AbortSignal): Promise<RouterResponse> {
  const res = await fetch(`${ZEN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        ...(parts.systemPrompt ? [{ role: 'system', content: parts.systemPrompt }] : []),
        ...parts.conversation,
      ],
      max_tokens: maxTokens,
      temperature,
    }),
    signal: withTimeout(ZEN_TIMEOUT_MS, signal),
  });
  if (!res.ok) throw await readError(res, 'chat');

  const data = asRecord(await res.json());
  const choices = Array.isArray(data['choices']) ? data['choices'] : [];
  const message = asRecord(asRecord(choices[0])['message']);
  const content = typeof message['content'] === 'string' ? message['content'] : '';
  const usage = asRecord(data['usage']);
  const reasoning = typeof message['reasoning_content'] === 'string' ? message['reasoning_content'] : undefined;
  const inputTokens = Number(usage['prompt_tokens']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['completion_tokens']) || estimateTokens(content);

  return {
    text: content,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens / 1000) * info.costPer1kTokensInput + (outputTokens / 1000) * info.costPer1kTokensOutput,
    fromCache: false,
    ...(reasoning ? { reasoning } : {}),
  };
}

/* ── Formato 2: responses (Bearer) ── */
async function viaResponses(parts: CallParts, model: string, maxTokens: number, apiKey: string, temperature: number, info: ModelInfo, signal?: AbortSignal): Promise<RouterResponse> {
  const res = await fetch(`${ZEN_BASE_URL}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      ...(parts.systemPrompt ? { instructions: parts.systemPrompt } : {}),
      input: parts.conversation,
      max_output_tokens: maxTokens,
      temperature,
    }),
    signal: withTimeout(ZEN_TIMEOUT_MS, signal),
  });
  if (!res.ok) throw await readError(res, 'responses');

  const data = asRecord(await res.json());
  const out: string[] = [];
  const reasoningParts: string[] = [];
  const output = Array.isArray(data['output']) ? data['output'] : [];
  for (const item of output) {
    const record = asRecord(item);
    if (record['type'] === 'message') {
      const content = Array.isArray(record['content']) ? record['content'] : [];
      for (const block of content) {
        const blockRecord = asRecord(block);
        if (blockRecord['type'] === 'output_text' && typeof blockRecord['text'] === 'string') out.push(blockRecord['text']);
      }
    } else if (record['type'] === 'reasoning') {
      const summary = Array.isArray(record['summary']) ? record['summary'] : [];
      for (const piece of summary) {
        const text = asRecord(piece)['text'];
        if (typeof text === 'string' && text.trim().length > 0) reasoningParts.push(text);
      }
    }
  }
  const content = out.join('\n');
  const usage = asRecord(data['usage']);
  const inputTokens = Number(usage['input_tokens']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['output_tokens']) || estimateTokens(content);

  return {
    text: content,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens / 1000) * info.costPer1kTokensInput + (outputTokens / 1000) * info.costPer1kTokensOutput,
    fromCache: false,
    ...(reasoningParts.length > 0 ? { reasoning: reasoningParts.join('\n') } : {}),
  };
}

/* ── Formato 3: messages (x-api-key, estilo Anthropic) ── */
async function viaAnthropic(parts: CallParts, model: string, maxTokens: number, apiKey: string, temperature: number, info: ModelInfo, signal?: AbortSignal): Promise<RouterResponse> {
  const res = await fetch(`${ZEN_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      ...(parts.systemPrompt ? { system: parts.systemPrompt } : {}),
      max_tokens: maxTokens,
      temperature,
      messages: parts.conversation,
    }),
    signal: withTimeout(ZEN_TIMEOUT_MS, signal),
  });
  if (!res.ok) throw await readError(res, 'messages');

  const data = asRecord(await res.json());
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const content = Array.isArray(data['content']) ? data['content'] : [];
  for (const block of content) {
    const record = asRecord(block);
    if (record['type'] === 'text' && typeof record['text'] === 'string') textParts.push(record['text']);
    if (record['type'] === 'thinking' && typeof record['thinking'] === 'string') thinkingParts.push(record['thinking']);
  }
  const text = textParts.join('\n');
  const usage = asRecord(data['usage']);
  const inputTokens = Number(usage['input_tokens']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['output_tokens']) || estimateTokens(text);

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens / 1000) * info.costPer1kTokensInput + (outputTokens / 1000) * info.costPer1kTokensOutput,
    fromCache: false,
    ...(thinkingParts.length > 0 ? { reasoning: thinkingParts.join('\n') } : {}),
  };
}

/* ── Formato 4: models/{id}:generateContent (x-goog-api-key, estilo Google) ── */
async function viaGoogle(parts: CallParts, model: string, maxTokens: number, apiKey: string, temperature: number, info: ModelInfo, signal?: AbortSignal): Promise<RouterResponse> {
  const res = await fetch(`${ZEN_BASE_URL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: parts.conversation.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      ...(parts.systemPrompt
        ? { systemInstruction: { parts: [{ text: parts.systemPrompt }] } }
        : {}),
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
    signal: withTimeout(ZEN_TIMEOUT_MS, signal),
  });
  if (!res.ok) throw await readError(res, 'google');

  const data = asRecord(await res.json());
  const candidates = Array.isArray(data['candidates']) ? data['candidates'] : [];
  const first = asRecord(candidates[0]);
  const contentRecord = asRecord(first['content']);
  const partsOut = Array.isArray(contentRecord['parts']) ? contentRecord['parts'] : [];
  const textParts: string[] = [];
  for (const piece of partsOut) {
    const text = asRecord(piece)['text'];
    if (typeof text === 'string') textParts.push(text);
  }
  const text = textParts.join('\n');
  const usage = asRecord(data['usageMetadata']);
  const inputTokens = Number(usage['promptTokenCount']) || estimateTokens(parts.systemPrompt + JSON.stringify(parts.conversation));
  const outputTokens = Number(usage['candidatesTokenCount']) || estimateTokens(text);

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens / 1000) * info.costPer1kTokensInput + (outputTokens / 1000) * info.costPer1kTokensOutput,
    fromCache: false,
  };
}

export async function sendToOpenCode(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  _thinking: ThinkingArg = false,
  temperature = 0.7,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const info = getOpencodeModelById(modelId);
  const entry = getZenEntry(modelId);
  if (!info || !entry) {
    throw new Error(`Model ${modelId} not found in OpenCode Zen catalog`);
  }

  const parts: CallParts = {
    systemPrompt: messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n'),
    conversation: messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  };

  switch (entry.mode) {
    case 'chat':
      return viaChat(parts, modelId, maxTokens, apiKey, temperature, info, callOpts?.signal);
    case 'responses':
      return viaResponses(parts, modelId, maxTokens, apiKey, temperature, info, callOpts?.signal);
    case 'anthropic':
      return viaAnthropic(parts, modelId, maxTokens, apiKey, temperature, info, callOpts?.signal);
    case 'google':
      return viaGoogle(parts, modelId, maxTokens, apiKey, temperature, info, callOpts?.signal);
  }
}
