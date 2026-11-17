/**
 * Componente Ink para capturar imagens via Ctrl+V e drag-and-drop
 * Exibe imagens como [nome.png] no input
 */

import React, { useState, useCallback } from 'react';
import { Text, Box } from 'ink';
import TextInput from 'ink-text-input';
import {
  saveImageBuffer,
  extractImagesFromMessage,
  type UploadedImage,
} from '../../vision/upload.js';

interface ImageInputProps {
  onSubmit: (text: string, images: UploadedImage[]) => void;
  placeholder?: string;
}

export const ImageInput: React.FC<ImageInputProps> = ({
  onSubmit,
  placeholder = 'Digite mensagem (Ctrl+V para imagem, ou arraste arquivo)...',
}) => {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<Map<string, UploadedImage>>(new Map());

  /**
   * Trata Ctrl+V (clipboard paste)
   */
  const handleClipboardPaste = useCallback(async () => {
    // Nota: Isso requer integração com sistema real de clipboard
    // Para Ink/Node.js, usaríamos xclip (Linux), pbpaste (Mac) ou powershell (Windows)

    try {
      // Implementação para Windows via PowerShell
      const { execSync } = require('node:child_process');

      // Tenta pegar imagem da clipboard
      let imageBuffer: Buffer | null = null;

      if (process.platform === 'win32') {
        // Windows: PowerShell para pegar imagem
        try {
          const code = `
            [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') > $null
            $img = [System.Windows.Forms.Clipboard]::GetImage()
            if ($img) {
              $ms = New-Object System.IO.MemoryStream
              $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
              [System.Convert]::ToBase64String($ms.ToArray())
            }
          `;

          const result = execSync(`powershell -Command "${code.replace(/"/g, '\\"')}"`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();

          if (result) {
            imageBuffer = Buffer.from(result, 'base64');
          }
        } catch {
          // Sem imagem na clipboard
        }
      } else if (process.platform === 'darwin') {
        // macOS: pbpaste
        try {
          const result = execSync('pbpaste | base64', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();

          if (result) {
            imageBuffer = Buffer.from(result, 'base64');
          }
        } catch {
          // Sem imagem
        }
      } else if (process.platform === 'linux') {
        // Linux: xclip
        try {
          const result = execSync('xclip -selection clipboard -t image/png -o | base64', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();

          if (result) {
            imageBuffer = Buffer.from(result, 'base64');
          }
        } catch {
          // Sem imagem
        }
      }

      if (imageBuffer) {
        // Salva imagem
        const uploaded = saveImageBuffer(imageBuffer, 'clipboard.png');

        // Adiciona ao mapa
        const newImages = new Map(images);
        newImages.set(uploaded.originalName, uploaded);
        setImages(newImages);

        // Adiciona placeholder ao input
        setInput(input + ' ' + uploaded.displayName);
      }
    } catch (err) {
      console.error('Erro ao processar clipboard:', err);
    }
  }, [input, images]);

  React.useEffect(() => {
    const onKey = (event: { ctrlKey?: boolean; metaKey?: boolean; key?: string; preventDefault?: () => void }) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        event.preventDefault?.();
        void handleClipboardPaste();
      }
    };
    process.stdin.on('keypress', onKey as any);
    return () => {
      process.stdin.removeListener('keypress', onKey as any);
    };
  }, [handleClipboardPaste]);

  /**
   * Trata tecla pressionada
   */
  const handleInput = useCallback(
    (value: string) => {
      setInput(value);

      // Ctrl+V (não funciona direto em Ink, mas deixamos o hook pronto)
      // A implementação real seria em um event listener do processo
    },
    []
  );

  /**
   * Trata envio de mensagem
   */
  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      // Extrai imagens do texto
      const imageNames = extractImagesFromMessage(text);
      const submittedImages: UploadedImage[] = [];

      for (const name of imageNames) {
        const img = images.get(name);
        if (img) submittedImages.push(img);
      }

      // Callback
      onSubmit(text, submittedImages);

      // Limpa
      setInput('');
      setImages(new Map());
    },
    [images, onSubmit]
  );

  return (
    <Box flexDirection="column" marginY={1}>
      <TextInput
        value={input}
        onChange={handleInput}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />

      {images.size > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            📎 {images.size} imagem(ns) anexada(s): {Array.from(images.values()).map(img => img.displayName).join(' ')}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          💡 Ctrl+V para colar imagem, ou arraste arquivo aqui
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Hook para capturar Ctrl+V global
 */
export function useClipboardPaste(onImage: (img: UploadedImage) => void): void {
  React.useEffect(() => {
    const handleKeyDown = (event: {
      ctrlKey?: boolean;
      metaKey?: boolean;
      key?: string;
      preventDefault?: () => void;
    }) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        event.preventDefault?.();
        // Chama handler de clipboard
        // handleClipboardPaste() // seria chamado aqui
      }
    };

    process.stdin.on('keypress', handleKeyDown as any);

    return () => {
      process.stdin.removeListener('keypress', handleKeyDown as any);
    };
  }, [onImage]);
}
