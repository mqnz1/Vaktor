/**
 * Integração de imagens ao chat
 * Processa mensagens com imagens e as converte para formato adequado
 */

import type { ChatMessage } from '../types/index.js';
import {
  loadImageAsBase64,
  imageFromUrl,
  buildAnthropicImageBlock,
  buildOpenAIImageBlock,
  buildGeminiImageBlock,
  extractImagePath,
  type ImageData,
} from './index.js';

export type MessageFormat = 'anthropic' | 'openai' | 'gemini' | 'generic';

/**
 * Converte uma mensagem com imagem em formato adequado para a API
 */
export async function enrichMessageWithImage(
  message: ChatMessage,
  format: MessageFormat,
): Promise<ChatMessage> {
  const imagePath = extractImagePath(message.content);

  if (!imagePath) {
    return message; // Sem imagem, retorna original
  }

  let imageData: ImageData;

  try {
    // Se é URL, carrega como URL; senão, carrega como base64
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      imageData = imageFromUrl(imagePath);
    } else {
      imageData = loadImageAsBase64(imagePath);
    }
  } catch (err) {
    console.warn('Erro ao processar imagem:', err);
    return message; // Se falhar, retorna original
  }

  // Cria bloco de imagem adequado para a API
  let imageBlock: Record<string, unknown>;

  switch (format) {
    case 'anthropic':
      imageBlock = buildAnthropicImageBlock(imageData);
      break;
    case 'openai':
      imageBlock = buildOpenAIImageBlock(imageData);
      break;
    case 'gemini':
      imageBlock = buildGeminiImageBlock(imageData);
      break;
    default:
      imageBlock = buildAnthropicImageBlock(imageData);
  }

  // Retorna mensagem com conteúdo que inclui imagem e texto
  return {
    ...message,
    // Alguns formatos esperam array de blocos de conteúdo
    content: message.content, // Mantém o texto original
    // Adiciona a imagem em campo separado (será processado por cada provider)
    image: imageBlock as any,
  };
}

/**
 * Processa múltiplas mensagens com imagens
 */
export async function enrichMessagesWithImages(
  messages: ChatMessage[],
  format: MessageFormat,
): Promise<ChatMessage[]> {
  const enriched: ChatMessage[] = [];

  for (const msg of messages) {
    enriched.push(await enrichMessageWithImage(msg, format));
  }

  return enriched;
}

/**
 * Cria uma mensagem de sistema que instrui a IA a extrair texto de imagens
 */
export function createOCRSystemPrompt(): string {
  return `Você é um assistente especializado em análise de imagens.
Quando uma imagem for fornecida:
1. Identifique TODO o texto visível na imagem (OCR)
2. Descreva o layout e estrutura do texto
3. Identifique gráficos, tabelas, diagramas
4. Extraia informações-chave
5. Corrija erros de OCR óbvios
6. Mantenha a formatação original quando possível

Sempre indique claramente qual texto foi extraído da imagem.`;
}

/**
 * Verifica se o modelo suporta visão
 */
export function supportsVision(modelId: string): boolean {
  const visionModels = [
    // Claude (Anthropic)
    'claude-3-5-sonnet',
    'claude-3-opus',
    'claude-3-haiku',
    'claude-opus-4-1',

    // Gemini
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-pro-vision',

    // GPT-4 (OpenAI)
    'gpt-4-turbo',
    'gpt-4-vision',
    'gpt-4o',
    'gpt-4o-mini',

    // Outros
    'llama-2-vision',
    'mistral-vision',
  ];

  return visionModels.some(vm => modelId.toLowerCase().includes(vm.toLowerCase()));
}
