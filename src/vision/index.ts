/**
 * Módulo de visão: processa imagens e extrai texto (OCR)
 * Suporta PNG, JPG, WebP, GIF
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface ImageData {
  source: 'url' | 'base64';
  mediaType: ImageMediaType;
  data: string; // URL ou base64
}

/**
 * Detecta o tipo MIME de uma imagem pela extensão
 */
export function detectImageType(filePath: string): ImageMediaType {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      throw new Error(`Tipo de imagem não suportado: ${ext}`);
  }
}

/**
 * Carrega uma imagem do disco e converte para base64
 */
export function loadImageAsBase64(filePath: string): ImageData {
  try {
    const buffer = readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const mediaType = detectImageType(filePath);

    return {
      source: 'base64',
      mediaType,
      data: base64,
    };
  } catch (err) {
    throw new Error(`Erro ao ler imagem ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Converte URL de imagem para ImageData
 */
export function imageFromUrl(url: string): ImageData {
  // Detecta tipo pela URL
  let mediaType: ImageMediaType = 'image/jpeg'; // padrão

  if (url.includes('.png')) mediaType = 'image/png';
  else if (url.includes('.webp')) mediaType = 'image/webp';
  else if (url.includes('.gif')) mediaType = 'image/gif';
  else if (url.includes('.jpg') || url.includes('.jpeg')) mediaType = 'image/jpeg';

  return {
    source: 'url',
    mediaType,
    data: url,
  };
}

/**
 * Cria um bloco de conteúdo para visão (para APIs que suportam)
 * Formato para Claude/Anthropic
 */
export function buildAnthropicImageBlock(imageData: ImageData): Record<string, unknown> {
  if (imageData.source === 'url') {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: imageData.data,
      },
    };
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: imageData.mediaType,
      data: imageData.data,
    },
  };
}

/**
 * Cria um bloco de conteúdo para visão (para OpenAI)
 */
export function buildOpenAIImageBlock(imageData: ImageData): Record<string, unknown> {
  if (imageData.source === 'url') {
    return {
      type: 'image_url',
      image_url: {
        url: imageData.data,
      },
    };
  }

  return {
    type: 'image_url',
    image_url: {
      url: `data:${imageData.mediaType};base64,${imageData.data}`,
    },
  };
}

/**
 * Cria um bloco de conteúdo para visão (para Gemini)
 */
export function buildGeminiImageBlock(imageData: ImageData): Record<string, unknown> {
  if (imageData.source === 'url') {
    return {
      inline_data: {
        mime_type: imageData.mediaType,
        data: imageData.data, // Gemini espera URL ou base64 direto
      },
    };
  }

  return {
    inline_data: {
      mime_type: imageData.mediaType,
      data: imageData.data,
    },
  };
}

/**
 * Detecta se uma mensagem contém imagem
 */
export function hasImage(content: string): boolean {
  return /\.(png|jpg|jpeg|webp|gif)$/i.test(content) || content.startsWith('http');
}

/**
 * Extrai caminho de imagem de uma mensagem
 * Retorna o caminho se for arquivo local, URL se for URL, null caso contrário
 */
export function extractImagePath(content: string): string | null {
  const trimmed = content.trim();

  // Se é URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Se é caminho de arquivo com extensão de imagem
  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(trimmed)) {
    return trimmed;
  }

  return null;
}
