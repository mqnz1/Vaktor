// =============================================================
// APInex - gateway OpenAI-compatible com uma carteira USD.
//
// Base: https://api.apinex.bond/v1
// Auth: Authorization: Bearer sk-apx...
// Catálogo: GET /v1/models (42 modelos) + preços/contexto de
// https://apinex.bond/api/public/models. Modelos free/... custam $0;
// os demais debitam saldo USD e exigem créditos na conta.
// =============================================================
import type { ChatMessage, ModelInfo, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import type { ProviderCallOpts } from './http.js';

type ThinkingArg = boolean | ThinkingOptions | undefined;

const APINEX_BASE_URL = 'https://api.apinex.bond/v1';
const APINEX_TIMEOUT_MS = 180_000;
const APINEX_MAX_OUTPUT_TOKENS = 32_768;

function apinexModel(
  id: string,
  name: string,
  contextWindow: number,
  tier: ModelInfo['tier'],
  inputPer1M: number,
  outputPer1M: number,
  description: string,
): ModelInfo {
  return {
    id,
    name,
    provider: 'apinex',
    costPer1kTokensInput: inputPer1M / 1000,
    costPer1kTokensOutput: outputPer1M / 1000,
    contextWindow,
    status: 'available',
    tier,
    description,
  };
}

/** Catálogo autenticado de GET /v1/models, com preço/contexto oficiais. */
export const APINEX_MODELS: ModelInfo[] = [
  apinexModel('free/deepseek-v4-pro-0813', 'Deepseek V4 Pro (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · ferramentas'),
  apinexModel('free/deepseek-v4-flash-0731', 'Deepseek V4 Flash (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · ferramentas'),
  apinexModel('free/hy4', 'HY 4 (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/deepseek-v4.1-flash', 'Deepseek V4.1 Flash 1017 (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/muse-spark-1.3', 'Muse Spark 1.3 (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('claude-opus-5.5', 'Claude Opus 5.5 (APInex)', 1_000_000, 'standard', 0.5, 0.5, 'Claude · $0.5/1M · visão · ferramentas'),
  apinexModel('gemini-4-argon', 'Gemini 4 Argon (APInex)', 1_000_000, 'premium', 0.6, 0.6, 'Gemini · $0.6/1M · visão · ferramentas'),
  apinexModel('free/mimo-v2.6-flash', 'Mimo V2.6 Flash (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/gemini-3.8-flash', 'Gemini 3.8 Flash (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/qwen-3.8-max', 'Qwen 3.8 MAX (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/kimi-k3', 'Kimi K3 (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/glm-5.3', 'GLM 5.3 (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · ferramentas'),
  apinexModel('free/glm-5.3-flash', 'GLM-5.3 Flash (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('claude-sonnet-5.5', 'Claude Sonnet 5.5 (APInex)', 1_000_000, 'standard', 0.4, 0.4, 'Claude · $0.4/1M · visão · ferramentas'),
  apinexModel('claude-fable-5.1', 'Claude Fable 5.1 (APInex)', 1_000_000, 'premium', 2, 2, 'Claude · $2/1M · visão · ferramentas'),
  apinexModel('gpt-6.1-terra', 'Gpt 6.1 Terra (APInex)', 1_000_000, 'standard', 0.17, 0.17, 'GPT · $0.17/1M · visão · ferramentas'),
  apinexModel('gpt-6.1-sol', 'Gpt 6.1 Sol (APInex)', 1_000_000, 'standard', 0.3, 0.3, 'GPT · $0.3/1M · visão · ferramentas'),
  apinexModel('gpt-6-astra', 'Gpt 6 Astra (APInex)', 1_000_000, 'standard', 0.5, 0.5, 'GPT · $0.5/1M · visão · ferramentas'),
  apinexModel('deepseek-v4.1-flash', 'Deepseek V4.1 Flash 1017 (APInex)', 1_000_000, 'economy', 0.06, 0.06, 'DeepSeek · $0.06/1M · visão · ferramentas'),
  apinexModel('grok-4.7', 'Grok 4.7 (APInex)', 500_000, 'standard', 0.3, 0.3, 'Grok · $0.3/1M · visão · ferramentas'),
  apinexModel('gemini-3.8-flash', 'Gemini 3.8 Flash (APInex)', 1_000_000, 'economy', 0.1, 0.1, 'Gemini · $0.1/1M · visão · ferramentas'),
  apinexModel('deepseek-v4-flash', 'Deepseek V4 Flash (APInex)', 1_000_000, 'economy', 0.05, 0.05, 'DeepSeek · $0.05/1M · ferramentas'),
  apinexModel('deepseek-v4-pro', 'Deepseek V4 Pro (APInex)', 1_000_000, 'economy', 0.07, 0.07, 'DeepSeek · $0.07/1M · ferramentas'),
  apinexModel('gemini-3.1-pro', 'Gemini 3.1 Pro (APInex)', 1_000_000, 'standard', 0.15, 0.15, 'Gemini · $0.15/1M · visão · ferramentas'),
  apinexModel('gpt-6-luna', 'Gpt 6 Luna (APInex)', 1_000_000, 'economy', 0.075, 0.075, 'GPT · $0.075/1M · visão · ferramentas'),
  apinexModel('free/minimax-m3.1-flash', 'MiniMax M3.1 Flash (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/gpt-6-luna', 'Gpt 6 Luna (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/jev-1.13', 'Jev 1.13 (APInex)', 64_000, 'economy', 0, 0, 'Grátis'),
  apinexModel('free/glm-5.3-flashx', 'GLM 5.3 FlashX (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/mimo-v2.6-pro', 'Mimo V2.6 Pro (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/minimax-m3', 'MiniMax M3 (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/claude-sonnet-4.6', 'Claude 4.6 Sonnet (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/claude-opus-4.6', 'Claude 4.6 Opus (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/gemini-3.1-pro', 'Gemini 3.1 Pro (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('free/kimi-k2.8', 'Kimi K2.8 (APInex)', 1_000_000, 'economy', 0, 0, 'Grátis · visão · ferramentas'),
  apinexModel('glm-5.3-flash', 'GLM-5.3 Flash (APInex)', 1_000_000, 'economy', 0.05, 0.05, 'GLM · $0.05/1M · visão · ferramentas'),
  apinexModel('glm-5.3', 'GLM 5.3 (APInex)', 1_000_000, 'standard', 0.15, 0.15, 'GLM · $0.15/1M · ferramentas'),
  apinexModel('kimi-k3.1-pro', 'Kimi K3.1 Pro (APInex)', 1_000_000, 'standard', 0.3, 0.4, 'Kimi · entrada $0.3/1M · saída $0.4/1M · visão · ferramentas'),
  apinexModel('drex-v2.0', 'Drex 2.0 (APInex)', 131_000, 'economy', 0.04, 0, 'Jev Group · $0.04/1M'),
  apinexModel('jev-1.13', 'Jev 1.13 (APInex)', 64_000, 'economy', 0.042, 0, 'Jev Group · $0.042/1M'),
  apinexModel('muse-spark-1.3', 'Muse Spark 1.3 (APInex)', 1_000_000, 'standard', 0.3, 0.3, 'Muse · $0.3/1M · visão · ferramentas'),
  apinexModel('hy4-preview', 'Tencent Hy4 (APInex)', 1_000_000, 'standard', 0.3, 0.3, 'Tencent · $0.3/1M · visão · ferramentas'),
];

export function getApinexModelById(id: string): ModelInfo | undefined {
  return APINEX_MODELS.find(model => model.id === id);
}

export async function sendToApinex(
  messages: ChatMessage[],
  modelId: string,
  maxTokens: number,
  apiKey: string,
  thinking: ThinkingArg = false,
  temperature?: number,
  callOpts?: ProviderCallOpts,
): Promise<RouterResponse> {
  const modelInfo = getApinexModelById(modelId);
  if (!modelInfo) {
    throw new Error(`Model ${modelId} not found in APInex catalog`);
  }
  if (apiKey.trim().length === 0) {
    throw new Error('APINEX_API_KEY não configurada no .env');
  }

  let response: RouterResponse;
  try {
    response = await sendOpenAiCompatible(
      messages,
      modelInfo,
      maxTokens,
      apiKey,
      thinking,
      temperature,
      callOpts,
      {
        baseUrl: APINEX_BASE_URL,
        timeoutMs: APINEX_TIMEOUT_MS,
        providerName: 'APInex',
        auth: 'bearer',
        maxTokensCap: APINEX_MAX_OUTPUT_TOKENS,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\b402\b|insufficient|balance|quota/i.test(message)) {
      throw new Error(
        'APInex: saldo USD insuficiente para este modelo. Use um modelo free/... ou adicione créditos em apinex.bond.',
      );
    }
    throw error;
  }

  if (response.text.trim().length === 0) {
    throw new Error(
      'APInex: resposta vazia. Confira se o modelo está ativo e se a conta tem saldo.',
    );
  }
  return response;
}
