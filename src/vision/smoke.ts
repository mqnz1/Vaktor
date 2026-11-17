#!/usr/bin/env node
/**
 * Smoke test para o módulo de visão (OCR/Image processing)
 */

import {
  detectImageType,
  imageFromUrl,
  buildAnthropicImageBlock,
  buildOpenAIImageBlock,
  buildGeminiImageBlock,
  extractImagePath,
  hasImage,
} from './index.js';
import { supportsVision } from './chat-integration.js';

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

test('Detectar tipo PNG', () => {
  const type = detectImageType('/path/to/image.png');
  assert(type === 'image/png', 'Deve detectar PNG');
});

test('Detectar tipo JPEG', () => {
  const type = detectImageType('/path/to/photo.jpg');
  assert(type === 'image/jpeg', 'Deve detectar JPEG');
});

test('Detectar tipo WebP', () => {
  const type = detectImageType('screenshot.webp');
  assert(type === 'image/webp', 'Deve detectar WebP');
});

test('Detectar tipo GIF', () => {
  const type = detectImageType('animation.gif');
  assert(type === 'image/gif', 'Deve detectar GIF');
});

test('Rejeitar tipo desconhecido', () => {
  try {
    detectImageType('file.bmp');
    throw new Error('Deveria ter lançado erro');
  } catch (err) {
    assert((err as Error).message.includes('não suportado'), 'Deve rejeitar BMP');
  }
});

test('Criar ImageData de URL', () => {
  const data = imageFromUrl('https://example.com/image.png');
  assert(data.source === 'url', 'Deve ser URL');
  assert(data.mediaType === 'image/png', 'Deve detectar PNG da URL');
  assert(data.data === 'https://example.com/image.png', 'Deve manter URL');
});

test('Detectar URL em mensagem', () => {
  const has = hasImage('https://example.com/photo.jpg');
  assert(has, 'Deve detectar URL de imagem');
});

test('Detectar arquivo de imagem', () => {
  const has = hasImage('screenshot.png');
  assert(has, 'Deve detectar arquivo PNG');
});

test('Não detectar texto normal', () => {
  const has = hasImage('Olá, como você está?');
  assert(!has, 'Não deve detectar texto normal como imagem');
});

test('Extrair caminho de arquivo', () => {
  const path = extractImagePath('  /home/user/image.jpg  ');
  assert(path === '/home/user/image.jpg', 'Deve extrair e trimpar caminho');
});

test('Extrair URL', () => {
  const url = extractImagePath('https://example.com/image.png');
  assert(url === 'https://example.com/image.png', 'Deve extrair URL');
});

test('Não extrair texto normal', () => {
  const path = extractImagePath('texto aleatório');
  assert(path === null, 'Deve retornar null para texto');
});

test('Build Anthropic image block', () => {
  const imageData = { source: 'url' as const, mediaType: 'image/png' as const, data: 'https://example.com/img.png' };
  const block = buildAnthropicImageBlock(imageData);
  assert(block.type === 'image', 'Deve criar bloco image');
  const source = block.source as Record<string, unknown>;
  assert(source.type === 'url', 'Deve usar URL source');
});

test('Build OpenAI image block', () => {
  const imageData = { source: 'url' as const, mediaType: 'image/png' as const, data: 'https://example.com/img.png' };
  const block = buildOpenAIImageBlock(imageData);
  assert(block.type === 'image_url', 'Deve criar bloco image_url');
  assert((block.image_url as any).url === 'https://example.com/img.png', 'Deve ter URL');
});

test('Build Gemini image block', () => {
  const imageData = { source: 'url' as const, mediaType: 'image/png' as const, data: 'https://example.com/img.png' };
  const block = buildGeminiImageBlock(imageData);
  assert(!!block.inline_data, 'Deve criar inline_data');
  const inlineData = block.inline_data as Record<string, unknown>;
  assert(inlineData.mime_type === 'image/png', 'Deve ter mime_type');
});

test('Claude suporta visão', () => {
  const supports = supportsVision('claude-3-5-sonnet-20241022');
  assert(supports, 'Claude deve suportar visão');
});

test('Gemini suporta visão', () => {
  const supports = supportsVision('gemini-2.5-flash');
  assert(supports, 'Gemini deve suportar visão');
});

test('GPT-4 suporta visão', () => {
  const supports = supportsVision('gpt-4o');
  assert(supports, 'GPT-4o deve suportar visão');
});

test('Modelo desconhecido sem visão', () => {
  const supports = supportsVision('unknown-model-xyz');
  assert(!supports, 'Modelo desconhecido não deve ter visão');
});

// ========== RUN TESTS ==========

let passed = 0;
let failed = 0;

console.log('🧪 Rodando testes de visão (OCR/Image)...\n');

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
