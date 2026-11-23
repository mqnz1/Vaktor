/**
 * Formatador automático de imagens
 * Converte caminhos absolutos em placeholders [nome.ext]
 */

import { basename } from 'node:path';
import { existsSync } from 'node:fs';

export interface FormattedImage {
  placeholder: string;
  fileName: string;
  fullPath: string;
  exists: boolean;
}

/**
 * Detecta se texto contém caminho de arquivo de imagem (Windows/Linux/Mac)
 */
export function containsImagePath(text: string): boolean {
  // Windows: C:\path\image.png ou C:/path/image.png
  // Linux/Mac: /home/user/image.png ou ~/image.png

  const windowsPattern = /^[A-Za-z]:[\\/].+\.(png|jpg|jpeg|webp|gif)$/i;
  const unixPattern = /^(\/|~\/).+\.(png|jpg|jpeg|webp|gif)$/i;

  return windowsPattern.test(text.trim()) || unixPattern.test(text.trim());
}

/**
 * Extrai caminho de imagem do texto
 */
export function extractImagePathFromText(text: string): string | null {
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Windows: C:\path\image.png
    const winMatch = trimmed.match(/^[A-Za-z]:[\\/].+\.(png|jpg|jpeg|webp|gif)$/i);
    if (winMatch) return trimmed;

    // Linux/Mac: /home/user/image.png
    const unixMatch = trimmed.match(/^\/[^\s]+\.(png|jpg|jpeg|webp|gif)$/i);
    if (unixMatch) return trimmed;

    // Home: ~/image.png
    const homeMatch = trimmed.match(/^~\/[^\s]+\.(png|jpg|jpeg|webp|gif)$/i);
    if (homeMatch) return trimmed;
  }

  return null;
}

/**
 * Formata caminho completo como placeholder [nome.ext]
 * Exemplo: "C:\Users\user\image.png" -> "[image.png]"
 */
export function formatImagePath(fullPath: string): FormattedImage {
  // Extrai nome do arquivo do caminho
  const fileName = basename(fullPath);
  const placeholder = `[${fileName}]`;
  const exists = existsSync(fullPath);

  return {
    placeholder,
    fileName,
    fullPath,
    exists,
  };
}

// Caminhos de imagem podem aparecer no meio da mensagem (drag-and-drop),
// entre aspas ou não. Estes padrões capturam o caminho sem consumir texto
// vizinho, para trocar apenas o path pelo placeholder [nome.ext].
const QUOTED_IMAGE_RE = /(["'])((?:[A-Za-z]:[\\/]|~?\/)[^"'\r\n]+?\.(?:png|jpe?g|webp|gif))\1/gi;
const WINDOWS_IMAGE_RE = /(^|[\s({])([A-Za-z]:[\\/][^\r\n\t"'<>|?*]+?\.(?:png|jpe?g|webp|gif))(?=$|[\s)\]}"',;:!?])/gi;
const UNIX_IMAGE_RE = /(^|[\s({])((?:~?\/)[^\r\n\t"'<>|?*]+?\.(?:png|jpe?g|webp|gif))(?=$|[\s)\]}"',;:!?])/gi;

function replaceImagePaths(text: string): { text: string; paths: string[] } {
  const paths: string[] = [];

  const quoted = text.replace(QUOTED_IMAGE_RE, (_match, _quote: string, path: string) => {
    paths.push(path);
    return `[${basename(path.trim())}]`;
  });

  const windows = quoted.replace(
    WINDOWS_IMAGE_RE,
    (_match, prefix: string, path: string) => {
      paths.push(path);
      return `${prefix}[${basename(path.trim())}]`;
    },
  );

  const unix = windows.replace(
    UNIX_IMAGE_RE,
    (_match, prefix: string, path: string) => {
      paths.push(path);
      return `${prefix}[${basename(path.trim())}]`;
    },
  );

  return { text: unix, paths };
}

/**
 * Troca caminhos de imagem por [nome.ext] para exibição no chat,
 * preservando o restante do texto.
 */
export function formatImagePathsForDisplay(text: string): string {
  return replaceImagePaths(text).text;
}

/**
 * Processa mensagem com caminho de imagem
 * Substitui caminho completo por [nome.ext]
 */
export function processMessageWithImage(message: string): {
  formatted: string;
  images: FormattedImage[];
} {
  const { text: formatted, paths } = replaceImagePaths(message);
  return { formatted, images: paths.map(formatImagePath) };
}

/**
 * Detecta placeholders [nome.png] na mensagem
 */
export function detectImagePlaceholders(text: string): string[] {
  const regex = /\[([^\]]+\.(?:png|jpg|jpeg|webp|gif))\]/gi;
  const matches = text.match(regex) || [];

  return matches.map(m => m.slice(1, -1)); // Remove [ ]
}

/**
 * Verifica se mensagem contém placeholders de imagem
 */
export function hasImagePlaceholders(text: string): boolean {
  return detectImagePlaceholders(text).length > 0;
}

/**
 * Expande ~ para home directory
 */
export function expandHomeDir(path: string): string {
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.replace(/^~[\\/]/, home + '/');
  }
  return path;
}
