// =============================================================
// DeepAI — API nativa de texto (api.deepai.org) e DeepAI Code.
//
// Texto:  POST https://api.deepai.org/api/{model_id}
//         header api-key, corpo form-urlencoded (text=<prompt>).
//
// Code:   POST https://api.deepai.org/deepai_code/chat/completions
//         POST https://api.deepai.org/deepai_code/responses
//         headers api-key + X-DeepAI-Code-Theos/Instance/Machine,
//         payload OpenAI-compatible. Modelos "0 Theos" são gratuitos.
//
// A chave de conta do app DeepAI Code (login Google/Apple) pode vir de
// DEEPAI_CODE_API_KEY; sem ela, usa-se DEEPAI_API_KEY.
// =============================================================
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { redactSecrets } from './extract.js';
import { withTimeout, type ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const DEEPAI_BASE_URL = 'https://api.deepai.org/api';
const DEEPAI_CODE_BASE_URL = 'https://api.deepai.org/deepai_code';
const DEEPAI_TIMEOUT_MS = 120_000;
const DEEPAI_CODE_TIMEOUT_MS = 330_000;
const DEEPAI_INSTANCE = randomBytes(16).toString('hex');
const DEEPAI_MACHINE_HEADER = 'X-DeepAI-Code-Machine';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SMBIOS_PLACEHOLDERS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '03000200-0400-0500-0006-000700080009',
]);

interface DeepaiCodeEntry {
  id: string;
  name: string;
  mode: 'chat' | 'responses';
  contextWindow: number;
  maxTokens: number;
  theosPerRequest: number;
  premier: boolean;
}

const DEEPAI_CODE_CATALOG: readonly DeepaiCodeEntry[] = [
  { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 0, premier: false },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 0, premier: false },
  { id: 'mimo-2.6-flash', name: 'MiMo 2.6 Flash', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 0, premier: false },
  { id: 'solar-mini-4', name: 'Solar Mini 4', mode: 'chat', contextWindow: 524_288, maxTokens: 131_072, theosPerRequest: 0, premier: false },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', mode: 'chat', contextWindow: 1_048_576, maxTokens: 128_000, theosPerRequest: 0, premier: false },
  { id: 'mimo-2.6-pro', name: 'MiMo 2.6 Pro', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 0, premier: false },
  { id: 'crouton-alpha', name: 'Crouton Alpha', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 0, premier: false },
  { id: 'glyph-cluster', name: 'Glyph Cluster', mode: 'chat', contextWindow: 256_000, maxTokens: 131_072, theosPerRequest: 0, premier: false },
  { id: 'deepai-cyber', name: 'DeepAI Cyber', mode: 'chat', contextWindow: 65_536, maxTokens: 8_192, theosPerRequest: 0, premier: false },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', mode: 'chat', contextWindow: 1_048_576, maxTokens: 128_000, theosPerRequest: 10, premier: true },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 10, premier: true },
  { id: 'glm-5.3', name: 'GLM 5.3', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 3, premier: true },
  { id: 'kimi-k3', name: 'Kimi K3', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 3, premier: true },
  { id: 'muse-spark-1.3', name: 'Muse Spark 1.3', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 6, premier: true },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', mode: 'chat', contextWindow: 1_000_000, maxTokens: 64_000, theosPerRequest: 15, premier: true },
  { id: 'muse-wonder', name: 'Muse Wonder', mode: 'chat', contextWindow: 1_048_576, maxTokens: 131_072, theosPerRequest: 15, premier: true },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', mode: 'chat', contextWindow: 1_000_000, maxTokens: 64_000, theosPerRequest: 25, premier: true },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', mode: 'responses', contextWindow: 1_000_000, maxTokens: 128_000, theosPerRequest: 50, premier: true },
];

function codeTier(theos: number): ModelInfo['tier'] {
  if (theos === 0) return 'economy';
  return theos >= 15 ? 'premium' : 'standard';
}

export const DEEPAI_CODE_MODELS: ModelInfo[] = DEEPAI_CODE_CATALOG.map(entry => ({
  id: entry.id,
  name: entry.name,
  provider: 'deepai',
  costPer1kTokensInput: 0,
  costPer1kTokensOutput: 0,
  contextWindow: entry.contextWindow,
  status: 'available',
  tier: codeTier(entry.theosPerRequest),
  description: entry.premier
    ? `${entry.theosPerRequest} Theos por requisição · chat DeepAI Code`
    : 'Grátis (0 Theos) · chat DeepAI Code',
}));

export const DEEPAI_MODELS: ModelInfo[] = [
  {
    id: 'text-generator',
    name: 'DeepAI Text Generator',
    provider: 'deepai',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: 8_192,
    status: 'available',
    tier: 'economy',
    description: 'Geração e processamento de texto · créditos DeepAI',
  },
  {
    id: 'summarization',
    name: 'DeepAI Summarization',
    provider: 'deepai',
    costPer1kTokensInput: 0,
    costPer1kTokensOutput: 0,
    contextWindow: 8_192,
    status: 'available',
    tier: 'economy',
    description: 'Resumo e mapeamento de leitura · créditos DeepAI',
  },
  ...DEEPAI_CODE_MODELS,
];

export function getDeepaiModelById(id: string): ModelInfo | undefined {
  const clean = normalizeDeepaiModelId(id);
  return DEEPAI_MODELS.find(model => model.id === clean);
}

/** Aceita `text-generator`, `deepai/text-generator` e `deepai::text-generator`. */
export function normalizeDeepaiModelId(id: string): string {
  const clean = id.trim().replace(/^deepai::/i, '').replace(/^deepai\//i, '');
  return clean;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildPrompt(messages: ChatMessage[]): string {
  return messages
    .filter(message => message.content.trim().length > 0)
    .map(message => message.content.trim())
    .join('\n\n')
    .trim();
}

function extractOutput(data: Record<string, unknown>): string {
  const output = data['output'];
  if (typeof output === 'string') return output.trim();
  if (Array.isArray(output)) {
    return output
      .map(item => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join('\n')
      .trim();
  }
  if (output && typeof output === 'object') {
    const nested = asRecord(output);
    const text = nested['text'] ?? nested['output'] ?? nested['summary'];
    if (typeof text === 'string') return text.trim();
  }
  return '';
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise(resolve => {
    execFile(file, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : String(stdout ?? ''));
    });
  });
}

function parseIoPlatformUuid(output: string): string | null {
  const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output);
  return match?.[1] && UUID_RE.test(match[1]) ? match[1].toLowerCase() : null;
}

function parseSmbiosUuid(output: string): string | null {
  const uuid = UUID_RE.exec(output)?.[0]?.toLowerCase() ?? null;
  return uuid && !SMBIOS_PLACEHOLDERS.has(uuid) ? uuid : null;
}

function parseMachineGuid(output: string): string | null {
  const match = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(output);
  return match?.[1] && UUID_RE.test(match[1]) ? match[1].toLowerCase() : null;
}

async function detectMachineId(): Promise<string | null> {
  if (platform() === 'darwin') {
    return parseIoPlatformUuid(await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']));
  }
  if (platform() === 'win32') {
    return parseSmbiosUuid(await run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance Win32_ComputerSystemProduct).UUID',
    ])) ?? parseMachineGuid(await run('reg', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid',
    ]));
  }
  return null;
}

let machineIdPromise: Promise<string | null> | undefined;

function deepaiMachineId(): Promise<string | null> {
  machineIdPromise ??= detectMachineId();
  return machineIdPromise;
}

async function deepaiMachineHeaders(): Promise<Record<string, string>> {
  const id = await deepaiMachineId();
  return id === null ? {} : { [DEEPAI_MACHINE_HEADER]: createHash('sha256').update(id).digest('hex') };
}

function readDeepAIAppKey(): string {
  const configured = process.env['DEEPAI_CODE_ACCOUNT_FILE']?.trim();
  const file = configured && configured.length > 0
    ? configured
    : join(homedir(), '.deepai-code', 'userdata', 'secrets', 'deepai-account.bin');
  try {
    const data = asRecord(JSON.parse(readFileSync(file, 'utf8')));
    return typeof data['apiKey'] === 'string' ? data['apiKey'].trim() : '';
  } catch {
    return '';
  }
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchDeepAICode(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 409) return res;

    let busy = false;
    try {
      const body = asRecord(await res.clone().json());
      busy = asRecord(body['error'])['code'] === 'session_busy';
    } catch {
      busy = false;
    }
    if (!busy || attempt >= 2) return res;

    await res.body?.cancel();
    const retry = Number(res.headers.get('retry-after') ?? 2);
    const delayMs = (Number.isFinite(retry) ? Math.min(30, Math.max(1, retry)) : 2) * 1000;
    await wait(delayMs, signal);
  }
}

async function deepaiCodeError(res: Response, label: string): Promise<Error> {
  const raw = await res.text().catch(() => '');
  if (res.status === 403 && raw.includes('social_login_required')) {
    return new Error(
      'DeepAI Code exige login social (Google/Apple). Entre no app DeepAI Code com Google ou Apple e use a chave dessa conta em DEEPAI_CODE_API_KEY.',
    );
  }
  if (res.status === 401) {
    return new Error('DeepAI Code: chave de API inválida. Defina DEEPAI_CODE_API_KEY com a chave da conta DeepAI Code.');
  }
  if (res.status === 402) {
    return new Error('DeepAI Code: sem Theos/créditos suficientes para este modelo.');
  }
  return new Error(
    `DeepAI Code error (${label}): ${res.status} - ${redactSecrets(raw).slice(0, 400)}`,
  );
}

interface ChatUsage {
  input: number;
  output: number;
}

interface ChatOutput {
  text: string;
  reasoning: string;
  usage: ChatUsage | undefined;
}

function extractMessageContent(message: Record<string, unknown>): string {
  return typeof message['content'] === 'string' ? message['content'] : '';
}

function extractMessageReasoning(message: Record<string, unknown>): string {
  for (const key of ['reasoning_content', 'reasoning']) {
    const value = message[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function extractChatUsage(usage: Record<string, unknown>): ChatUsage | undefined {
  if (Object.keys(usage).length === 0) return undefined;
  return {
    input: Number(usage['prompt_tokens'] ?? usage['input_tokens']) || 0,
    output: Number(usage['completion_tokens'] ?? usage['output_tokens']) || 0,
  };
}

async function readChatJson(res: Response): Promise<ChatOutput> {
  const data = asRecord(await res.json());
  const choices = Array.isArray(data['choices']) ? data['choices'] : [];
  const message = asRecord(asRecord(choices[0])['message']);
  return {
    text: extractMessageContent(message),
    reasoning: extractMessageReasoning(message),
    usage: extractChatUsage(asRecord(data['usage'])),
  };
}

async function readChatStream(
  res: Response,
  onToken: ((chunk: string) => void) | undefined,
): Promise<ChatOutput> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('DeepAI Code stream sem corpo (body ausente).');

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  let usage: ChatUsage | undefined;

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (payload.length === 0 || payload === '[DONE]') return;

    try {
      const chunk = asRecord(JSON.parse(payload));
      const choices = Array.isArray(chunk['choices']) ? chunk['choices'] : [];
      const choice = asRecord(choices[0]);
      const delta = asRecord(choice['delta']);
      const message = asRecord(choice['message']);
      const piece = extractMessageContent(delta) || extractMessageContent(message);
      if (piece.length > 0) {
        text += piece;
        onToken?.(piece);
      }
      reasoning += extractMessageReasoning(delta) || extractMessageReasoning(message);
      const chunkUsage = extractChatUsage(asRecord(chunk['usage']));
      if (chunkUsage) usage = chunkUsage;
    } catch {
      // Fragmento JSON incompleto: o buffer é reprocessado na próxima linha.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineAt = buffer.indexOf('\n');
    while (newlineAt >= 0) {
      handleLine(buffer.slice(0, newlineAt));
      buffer = buffer.slice(newlineAt + 1);
      newlineAt = buffer.indexOf('\n');
    }
  }
  if (buffer.trim().length > 0) handleLine(buffer);

  return { text, reasoning, usage };
}

function extractResponsesOutput(data: Record<string, unknown>): { text: string; reasoning: string } {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const output = Array.isArray(data['output']) ? data['output'] : [];

  for (const item of output) {
    const record = asRecord(item);
    if (record['type'] === 'message') {
      const content = Array.isArray(record['content']) ? record['content'] : [];
      for (const block of content) {
        const blockRecord = asRecord(block);
        if (blockRecord['type'] === 'output_text' && typeof blockRecord['text'] === 'string') {
          textParts.push(blockRecord['text']);
        }
      }
    } else if (record['type'] === 'reasoning') {
      const summary = Array.isArray(record['summary']) ? record['summary'] : [];
      for (const piece of summary) {
        const text = asRecord(piece)['text'];
        if (typeof text === 'string' && text.trim().length > 0) reasoningParts.push(text);
      }
    }
  }

  return { text: textParts.join('\n'), reasoning: reasoningParts.join('\n') };
}

async function sendToDeepAICode(
  messages: ChatMessage[],
  entry: DeepaiCodeEntry,
  maxTokens: number,
  apiKey: string,
  temperature: number,
  callOpts: ProviderCallOpts | undefined,
): Promise<RouterResponse> {
  const key = process.env['DEEPAI_CODE_API_KEY']?.trim() || apiKey.trim() || readDeepAIAppKey();
  if (!key) {
    throw new Error(
      'DeepAI Code sem chave: entre no app DeepAI Code com Google/Apple (o Vaktor lê ~/.deepai-code/userdata/secrets/deepai-account.bin) ou defina DEEPAI_CODE_API_KEY no .env.',
    );
  }

  const systemPrompt = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n');
  const conversation = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({ role: message.role as 'user' | 'assistant', content: message.content }));
  const requestedMax = Math.max(1, Math.min(maxTokens, entry.maxTokens));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'api-key': key,
    'X-DeepAI-Code-Theos': '4',
    'X-DeepAI-Code-Instance': DEEPAI_INSTANCE,
    ...(await deepaiMachineHeaders()),
  };
  const signal = withTimeout(DEEPAI_CODE_TIMEOUT_MS, callOpts?.signal);

  if (entry.mode === 'responses') {
    const res = await fetchDeepAICode(`${DEEPAI_CODE_BASE_URL}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: entry.id,
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
        input: conversation,
        max_output_tokens: requestedMax,
        temperature,
      }),
      signal,
    }, callOpts?.signal);
    if (!res.ok) throw await deepaiCodeError(res, 'responses');

    const data = asRecord(await res.json());
    const parsed = extractResponsesOutput(data);
    if (!parsed.text && !parsed.reasoning) {
      throw new Error('DeepAI Code retornou resposta vazia.');
    }
    callOpts?.onToken?.(parsed.text);
    const usage = extractChatUsage(asRecord(data['usage']));
    const inputTokens = usage?.input || estimateTokens(systemPrompt + JSON.stringify(conversation));
    const outputTokens = usage?.output || estimateTokens(parsed.text);
    return {
      text: parsed.text,
      model: `deepai/${entry.id}`,
      inputTokens,
      outputTokens,
      estimatedCostUsd: 0,
      fromCache: false,
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
    };
  }

  const wantsStream = typeof callOpts?.onToken === 'function';
  const res = await fetchDeepAICode(`${DEEPAI_CODE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: entry.id,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...conversation,
      ],
      max_tokens: requestedMax,
      temperature,
      ...(wantsStream ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
    signal,
  }, callOpts?.signal);
  if (!res.ok) throw await deepaiCodeError(res, 'chat');

  const parsed = wantsStream
    ? await readChatStream(res, callOpts?.onToken)
    : await readChatJson(res);
  if (!parsed.text && !parsed.reasoning) {
    throw new Error('DeepAI Code retornou resposta vazia.');
  }
  if (!wantsStream) callOpts?.onToken?.(parsed.text);

  const inputTokens = parsed.usage?.input || estimateTokens(systemPrompt + JSON.stringify(conversation));
  const outputTokens = parsed.usage?.output || estimateTokens(parsed.text);
  return {
    text: parsed.text,
    model: `deepai/${entry.id}`,
    inputTokens,
    outputTokens,
    estimatedCostUsd: 0,
    fromCache: false,
    ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
  };
}

export async function sendToDeepAI(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  _thinking: ThinkingArg = false,
  temperature = 0.7,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const cleanId = normalizeDeepaiModelId(modelId);
  const codeEntry = DEEPAI_CODE_CATALOG.find(entry => entry.id === cleanId);
  if (codeEntry) {
    return sendToDeepAICode(messages, codeEntry, maxTokens, apiKey, temperature, callOpts);
  }

  const modelInfo = getDeepaiModelById(cleanId);
  if (!modelInfo) {
    throw new Error(
      `Modelo DeepAI desconhecido: ${modelId}. Use deepai/text-generator, deepai/summarization ou um modelo DeepAI Code.`,
    );
  }
  if (!apiKey) {
    throw new Error('DEEPAI_API_KEY não configurada no .env');
  }

  const prompt = buildPrompt(messages);
  if (!prompt) throw new Error('DeepAI: prompt vazio.');

  const res = await fetch(`${DEEPAI_BASE_URL}/${cleanId}`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text: prompt }).toString(),
    signal: withTimeout(DEEPAI_TIMEOUT_MS, callOpts?.signal),
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(
      `DeepAI error: ${res.status} - ${redactSecrets(raw).slice(0, 400)}`,
    );
  }

  let data: Record<string, unknown> = {};
  try {
    data = asRecord(JSON.parse(raw));
  } catch {
    throw new Error('DeepAI retornou uma resposta que não é JSON.');
  }

  const apiError = data['err'];
  if (typeof apiError === 'string' && apiError.trim().length > 0) {
    throw new Error(`DeepAI: ${redactSecrets(apiError).slice(0, 400)}`);
  }

  let text = extractOutput(data);
  if (!text) {
    const outputUrl = typeof data['output_url'] === 'string' ? data['output_url'] : '';
    if (/^https?:\/\//i.test(outputUrl)) {
      const follow = await fetch(outputUrl, {
        signal: withTimeout(DEEPAI_TIMEOUT_MS, callOpts?.signal),
      });
      if (follow.ok) text = (await follow.text()).trim();
    }
  }
  if (!text) {
    throw new Error('DeepAI retornou resposta vazia (sem `output`).');
  }

  if (callOpts?.onToken) callOpts.onToken(text);

  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(text);
  return {
    text,
    model: `deepai/${cleanId}`,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens / 1000) * modelInfo.costPer1kTokensInput +
      (outputTokens / 1000) * modelInfo.costPer1kTokensOutput,
    fromCache: false,
  };
}
