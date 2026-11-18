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
import { PROVIDER_ENV_KEYS, ownerOf, parseModelRef } from './registry.js';
import type { ProviderCallOpts } from './http.js';
import type { ProviderId } from '../thinking/types.js';

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
  const apiKey = process.env[`${PROVIDER_ENV_KEYS[owner]}_API_KEY`] || '';

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

    case 'echo':
      // O Echo Free entende multi-turn com roles; recebe as mensagens
      // normalizadas. O bootstrap de credencial avisa a UI uma única vez.
      try {
        return await sendToEcho(normalized, modelId, maxTokens, apiKey, thinking, temperature, onNotice, opts);
      } catch (error) {
        // Se falhou com 402 (Payment Required/quota) e temos pool, rotaciona e tenta novamente
        if (process.env['ECHO_API_KEY_POOL']) {
          const msg = error instanceof Error ? error.message : String(error);

          if (msg.includes('402') || msg.includes('Payment Required') || msg.includes('quota')) {
            // Rotaciona para próxima chave silenciosamente
            const { nextEchoRotation, resetEchoBoot, readEchoCredential } = await import('./extract.js');
            nextEchoRotation();
            resetEchoBoot();

            // Lê a nova chave com índice atualizado
            const newCred = readEchoCredential();
            const nextKey = newCred?.token || '';

            if (nextKey && nextKey !== apiKey) {
              // Tenta NOVAMENTE com a mesma requisição mas chave diferente
              // SEM notificar o usuário (silencioso)
              return await sendToEcho(normalized, modelId, maxTokens, nextKey, thinking, temperature, undefined, opts);
            }
          }
        }
        throw error;
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
