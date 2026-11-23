/**
 * Gerenciador de upload de imagens
 * Salva imagens da clipboard e drag-and-drop localmente
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export interface UploadedImage {
  localPath: string;
  originalName: string;
  fileName: string;
  displayName: string;
}

/**
 * Diretório onde salvar imagens temporárias/uploaded
 */
export function getImageUploadDir(): string {
  const dir = join(homedir(), '.vaktor', 'uploads');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  return dir;
}

/**
 * Gera nome único para arquivo
 */
function generateFileName(originalName: string): string {
  const ext = originalName.split('.').pop() || 'jpg';
  const hash = randomBytes(4).toString('hex');
  const timestamp = Date.now();

  return `img_${timestamp}_${hash}.${ext}`;
}

/**
 * Salva buffer de imagem em disco
 */
export function saveImageBuffer(buffer: Buffer, originalName: string): UploadedImage {
  const uploadDir = getImageUploadDir();
  const fileName = generateFileName(originalName);
  const localPath = join(uploadDir, fileName);

  writeFileSync(localPath, buffer as any);

  return {
    localPath,
    originalName,
    fileName,
    displayName: `[${originalName}]`,
  };
}

/**
 * Salva imagem a partir de base64 (clipboard)
 */
export function saveImageFromBase64(base64Data: string, originalName: string = 'clipboard.png'): UploadedImage {
  const buffer = Buffer.from(base64Data, 'base64');
  return saveImageBuffer(buffer, originalName);
}

/**
 * Cria um bloco de marcação para exibir no chat
 * Exemplo: "[screenshot.png]"
 */
export function createImagePlaceholder(image: UploadedImage): string {
  return image.displayName;
}

/**
 * Formata múltiplas imagens como inline text
 */
export function formatImagesForChat(images: UploadedImage[]): string {
  return images.map(img => img.displayName).join(' ');
}

/**
 * Detecta se é imagem válida pela extensão
 */
export function isValidImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '');
}

/**
 * Obtém tipo MIME de uma imagem pelo nome
 */
export function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return 'image/jpeg';
  }
}

/**
 * Extrai lista de imagens de uma mensagem
 * Procura por padrão [nome.ext]
 */
export function extractImagesFromMessage(content: string): string[] {
  const regex = /\[([^\]]+\.(?:png|jpg|jpeg|webp|gif))\]/gi;
  const matches = content.match(regex) || [];

  return matches.map(m => m.slice(1, -1)); // Remove [ ]
}

/**
 * Substitui placeholders [image.png] por caminhos reais
 */
export function resolveImagePlaceholders(
  content: string,
  imageMap: Map<string, UploadedImage>,
): { text: string; images: UploadedImage[] } {
  const images: UploadedImage[] = [];
  const names = extractImagesFromMessage(content);

  for (const name of names) {
    const img = imageMap.get(name);
    if (img) images.push(img);
  }

  return {
    text: content,
    images,
  };
}

/**
 * Simula drag-and-drop de arquivo
 */
export function handleDropEvent(files: File[]): UploadedImage[] {
  const uploaded: UploadedImage[] = [];

  for (const file of files) {
    if (isValidImageFile(file.name)) {
      // Nota: Em Node.js puro, isso seria diferente
      // Este é um placeholder para integração com a UI
      // A UI real faria: const buffer = await file.arrayBuffer();
      uploaded.push({
        localPath: file.name,
        originalName: file.name,
        fileName: file.name,
        displayName: `[${file.name}]`,
      });
    }
  }

  return uploaded;
}

/**
 * Trata evento Ctrl+V (clipboard paste)
 * Retorna imagem se houver na clipboard
 */
export async function handleClipboardPaste(): Promise<UploadedImage | null> {
  // Nota: Isso requer integração com a UI real
  // Em Node.js puro, não há acesso direto a clipboard
  // A implementação real estaria na TUI (React/Ink component)

  // Placeholder:
  return null;
}
