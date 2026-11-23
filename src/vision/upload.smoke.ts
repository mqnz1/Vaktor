#!/usr/bin/env node
/**
 * Smoke tests para o módulo de upload de imagens
 */

import {
  getImageUploadDir,
  isValidImageFile,
  getMimeType,
  extractImagesFromMessage,
  createImagePlaceholder,
  formatImagesForChat,
  type UploadedImage,
} from './upload.js';
import { existsSync } from 'node:fs';

interface Test {
  name: string;
  fn: () => void;
}

const tests: Test[] = [];

function test(name: string, fn: () => void): void {
  tests.push({ name, fn });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ========== TESTES ==========

test('Obter diretório de upload', () => {
  const dir = getImageUploadDir();
  assert(dir.includes('.vaktor'), 'Deve conter .vaktor');
  assert(dir.includes('uploads'), 'Deve conter uploads');
  assert(existsSync(dir), 'Diretório deve existir');
});

test('Validar PNG como imagem', () => {
  const valid = isValidImageFile('screenshot.png');
  assert(valid, 'PNG deve ser válido');
});

test('Validar JPG como imagem', () => {
  const valid = isValidImageFile('photo.jpg');
  assert(valid, 'JPG deve ser válido');
});

test('Validar JPEG como imagem', () => {
  const valid = isValidImageFile('image.jpeg');
  assert(valid, 'JPEG deve ser válido');
});

test('Validar WebP como imagem', () => {
  const valid = isValidImageFile('modern.webp');
  assert(valid, 'WebP deve ser válido');
});

test('Validar GIF como imagem', () => {
  const valid = isValidImageFile('animation.gif');
  assert(valid, 'GIF deve ser válido');
});

test('Rejeitar BMP como imagem', () => {
  const valid = isValidImageFile('photo.bmp');
  assert(!valid, 'BMP não deve ser válido');
});

test('Rejeitar TXT como imagem', () => {
  const valid = isValidImageFile('document.txt');
  assert(!valid, 'TXT não deve ser válido');
});

test('Obter MIME PNG', () => {
  const mime = getMimeType('image.png');
  assert(mime === 'image/png', 'Deve retornar image/png');
});

test('Obter MIME JPEG', () => {
  const mime = getMimeType('photo.jpg');
  assert(mime === 'image/jpeg', 'Deve retornar image/jpeg');
});

test('Obter MIME WebP', () => {
  const mime = getMimeType('modern.webp');
  assert(mime === 'image/webp', 'Deve retornar image/webp');
});

test('Criar placeholder de imagem', () => {
  const img: UploadedImage = {
    localPath: '/home/user/img_123_abc.png',
    originalName: 'screenshot.png',
    fileName: 'img_123_abc.png',
    displayName: '[screenshot.png]',
  };

  const placeholder = createImagePlaceholder(img);
  assert(placeholder === '[screenshot.png]', 'Deve criar placeholder correto');
});

test('Formatar múltiplas imagens', () => {
  const images: UploadedImage[] = [
    {
      localPath: '/img1.png',
      originalName: 'shot1.png',
      fileName: 'img_1.png',
      displayName: '[shot1.png]',
    },
    {
      localPath: '/img2.jpg',
      originalName: 'photo.jpg',
      fileName: 'img_2.jpg',
      displayName: '[photo.jpg]',
    },
  ];

  const formatted = formatImagesForChat(images);
  assert(formatted === '[shot1.png] [photo.jpg]', 'Deve formatar com espaço');
});

test('Extrair imagens de mensagem', () => {
  const content = 'Olá! Veja essas imagens: [screenshot.png] e [photo.jpg]';
  const images = extractImagesFromMessage(content);

  assert(images.length === 2, 'Deve extrair 2 imagens');
  assert(images[0] === 'screenshot.png', 'Primeira deve ser screenshot.png');
  assert(images[1] === 'photo.jpg', 'Segunda deve ser photo.jpg');
});

test('Não extrair imagens inexistentes', () => {
  const content = 'Sem imagens aqui!';
  const images = extractImagesFromMessage(content);

  assert(images.length === 0, 'Não deve extrair nada');
});

test('Case-insensitive na extração', () => {
  const content = 'Imagens: [SCREENSHOT.PNG] [Photo.JPG]';
  const images = extractImagesFromMessage(content);

  assert(images.length === 2, 'Deve extrair com case-insensitive');
});

// ========== RUN TESTS ==========

let passed = 0;
let failed = 0;

console.log('🧪 Rodando testes de upload de imagens...\n');

for (const t of tests) {
  try {
    t.fn();
    console.log(`✓ ${t.name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${t.name}`);
    console.log(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`✅ ${passed} testes passaram`);
if (failed > 0) {
  console.log(`❌ ${failed} testes falharam`);
  process.exit(1);
}
