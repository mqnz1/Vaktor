// =============================================================
// Camada unificada de despacho aos provedores.
//
// Ponto único de extensão: todo o switch de roteamento (chave por
// owner, normalização de roles, adaptações de resposta, deflexões)
// vive aqui — o router só chama `dispatchToProvider`.
// =============================================================
import type { ChatMessage, RouterResponse } from '../types/index.js';
import type { ThinkingOptions } from '../thinking/index.js';
import { sendToPuter } from './puter.js';
import { sendToProxyGateLLM } from './proxygatellm.js';
import { sendToAgentRouter } from './agentrouter.js';
import { sendToOpenRouter, type OpenRouterResponse } from './openrouter.js';
import { sendToNumes } from './numes.js';
import { sendToNightRouter } from './nightrouter.js';
import { sendToRequesty } from './requesty.js';
import { sendToKilo } from './kilo.js';
import { sendToFta } from './fta.js';
import { sendToEcho, getEchoModelById } from './echo.js';
import {
  EchoError,
  echoPoolSize,
  nextEchoRotation,
  readEchoCredential,
  resetEchoBoot,
  resetEchoGuard,
} from './extract.js';
import { sendToNvidia } from './nvidia.js';
import { sendToOpenCode } from './opencode.js';
import { sendToHarbor } from './harbor.js';
import { sendToGemini } from './gemini.js';
import { sendToNotion } from './notion.js';
import { sendToNotionWeb } from './notionWeb.js';
import { sendToIteraCompute } from './iteracompute.js';
import { sendToQoder } from './qoder.js';
import { sendToApinex } from './apinex.js';
import { sendToDeepAI } from './deepai.js';
import { sendToVyceAI } from './vyceai.js';
import { sendToQronos } from './qronos.js';
import { sendToZro } from './zro.js';
import { sendToUnoRouter } from './unorouter.js';
import { PROVIDER_ENV_KEYS, isCustomProviderId, ownerOf, parseModelRef } from './registry.js';
import { getCustomProvider, sendToCustomProvider } from './custom.js';
import type { ProviderCallOpts } from './http.js';
import type { ProviderId } from '../thinking/types.js';

const ECHO_POOL_MAX_ATTEMPTS = 6;

function isEchoPoolError(error: unknown): error is EchoError {
  if (!(error instanceof EchoError)) return false;
  return error.kind === 'invalid-credential'
    || error.kind === 'forbidden'
    || error.kind === 'quota'
    || error.kind === 'rate-limit'
    || error.kind === 'upstream-auth';
}

export interface DispatchParams {
  model: string;
  messages: ChatMessage[];
  thinking: ThinkingOptions | undefined;
  maxTokens: number;
  temperature?: number | undefined;
  providerOverride?: ProviderId | undefined;
  opts?: ProviderCallOpts | undefined;
  /** Aviso não-fatal (ex.: bootstrap do Echo) para a UI. */
  onNotice?: ((notice: string) => void) | undefined;
}

// Adapter para converter resposta OpenRouter
function adaptOpenRouterResponse(response: OpenRouterResponse, model: string): RouterResponse {
  return {
    text: response.content,
    model: model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    estimatedCostUsd: response.estimatedCostUsd,
    fromCache: response.fromCache,
    ...(response.reasoning ? { reasoning: response.reasoning } : {}),
  };
}

export async function dispatchToProvider(params: DispatchParams): Promise<RouterResponse> {
  const { model, messages, thinking, maxTokens, temperature, providerOverride, opts, onNotice } = params;

  // O protocolo do agente usa role "tool"; os provedores só entendem
  // user/assistant/system, então normalizamos antes de qualquer chamada.
  const normalized = messages.map(message =>
    message.role === 'tool'
      ? { ...message, role: 'user' as const }
      : message,
  );

  const systemPrompt = normalized
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  const ref = parseModelRef(model);
  const owner = ref.provider ?? providerOverride ?? ownerOf(model);
  const modelId = ref.id;
  const customProvider = isCustomProviderId(owner) ? getCustomProvider(owner) : undefined;
  const envPrefix = PROVIDER_ENV_KEYS[owner];
  const apiKey = customProvider?.apiKey
    || (envPrefix ? process.env[`${envPrefix}_API_KEY`] || '' : '');

  if (customProvider) {
    return sendToCustomProvider(
      normalized,
      modelId,
      maxTokens,
      thinking,
      temperature,
      opts,
      customProvider,
    );
  }

  // `ownerOf` define o provedor E a chave na mesma ordem — os dois nunca
  // divergem, mesmo quando o ID existe em mais de um catálogo. Quando o ID
  // vem qualificado (`puter::gpt-5`), o provedor explícito vence.
  switch (owner) {
    case 'proxygatellm':
      return sendToProxyGateLLM(normalized, modelId, maxTokens, thinking, temperature, opts);

    case 'agentrouter':
      return sendToAgentRouter(
        normalized, modelId, maxTokens, apiKey, thinking, temperature, opts,
      );

    case 'numes':
      return sendToNumes(
        normalized, modelId, maxTokens, apiKey, thinking, temperature, opts,
      );

    case 'nightrouter':
      return sendToNightRouter(
        normalized, modelId, maxTokens, apiKey, thinking, temperature, opts,
      );

    case 'requesty':
      return sendToRequesty(
        normalized, modelId, maxTokens, apiKey, thinking, temperature, opts,
      );

    case 'kilo':
      return sendToKilo(
        normalized, modelId, maxTokens, apiKey, thinking, temperature, opts,
      );

    case 'fta':
      return sendToFta(
        normalized, modelId, maxTokens, apiKey, thinking, temperature, opts,
      );

    case 'openrouter': {
      const response = await sendToOpenRouter(
        normalized, modelId, maxTokens, apiKey, thinking,
        systemPrompt.length > 0 ? systemPrompt : undefined,
        temperature,
        opts,
      );
      return adaptOpenRouterResponse(response, modelId);
    }

    case 'notion':
      return sendToNotion(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'notion_web':
      return sendToNotionWeb(normalized, modelId, maxTokens, thinking, temperature, opts);

    case 'gemini':
      if (apiKey.length > 0) {
        return sendToGemini(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);
      }
      // Sem GEMINI_API_KEY: deflexão para o Echo Free, que opera os
      // mesmos IDs gemini-2.5-*; se o ID for exclusivo da API nativa,
      // falha com a instrução de configuração.
      if (getEchoModelById(modelId)) {
        return sendToEcho(
          normalized, modelId, maxTokens, process.env.ECHO_API_KEY || '', thinking, temperature,
          onNotice,
          opts,
        );
      }
      throw new Error(
        `GEMINI_API_KEY não configurada no .env — o modelo ${modelId} exige a API nativa do Gemini.`,
      );

    case 'echo': {
      // O Echo Free entende multi-turn com roles; recebe as mensagens
      // normalizadas. O bootstrap de credencial avisa a UI uma única vez.
      const poolSize = echoPoolSize();
      const maxAttempts = poolSize > 0 ? Math.min(poolSize, ECHO_POOL_MAX_ATTEMPTS) : 1;
      let key = poolSize > 0 ? (readEchoCredential()?.token || apiKey) : apiKey;
      let lastError: unknown;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await sendToEcho(
            normalized,
            modelId,
            maxTokens,
            key,
            thinking,
            temperature,
            attempt === 0 ? onNotice : undefined,
            opts,
          );
        } catch (error) {
          lastError = error;
          if (poolSize === 0 || !isEchoPoolError(error)) throw error;

          nextEchoRotation();
          resetEchoBoot();
          // O cooldown de auth é global; ao trocar de chave ele não vale mais.
          resetEchoGuard();
          if (attempt >= maxAttempts - 1) break;

          const nextKey = readEchoCredential()?.token || '';
          if (!nextKey || nextKey === key) break;
          key = nextKey;
        }
      }

      throw lastError;
    }

    case 'deepai':
      return sendToDeepAI(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'vyceai':
      return sendToVyceAI(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'nvidia':
      return sendToNvidia(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'opencode':
      return sendToOpenCode(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'harbor':
      return sendToHarbor(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'iteracompute':
      return sendToIteraCompute(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'qoder':
      return sendToQoder(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'qronos':
      return sendToQronos(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'zro':
      return sendToZro(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'unorouter':
      return sendToUnoRouter(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'apinex':
      return sendToApinex(normalized, modelId, maxTokens, apiKey, thinking, temperature, opts);

    case 'puter':
    default:
      return sendToPuter(normalized, modelId, maxTokens, thinking, temperature, opts);
  }
}
