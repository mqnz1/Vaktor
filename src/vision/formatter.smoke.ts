#!/usr/bin/env node
/**
 * Smoke tests para formatador de imagens
 */

import {
  containsImagePath,
  formatImagePath,
  processMessageWithImage,
  detectImagePlaceholders,
  hasImagePlaceholders,
  expandHomeDir,
  formatImagePathsForDisplay,
} from './formatter.js';

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

test('Detectar caminho Windows PNG', () => {
  const text = 'C:\\Users\\user\\image.png';
  assert(containsImagePath(text), 'Deve detectar caminho Windows');
});

test('Detectar caminho Windows JPG', () => {
  const text = 'D:/Photos/screenshot.jpg';
  assert(containsImagePath(text), 'Deve detectar caminho Windows com /');
});

test('Detectar caminho Linux', () => {
  const text = '/home/user/image.png';
  assert(containsImagePath(text), 'Deve detectar caminho Linux');
});

test('Detectar caminho Mac com home', () => {
  const text = '~/Pictures/screenshot.png';
  assert(containsImagePath(text), 'Deve detectar caminho com ~');
});

test('Não detectar texto normal', () => {
  const text = 'Olá, como você está?';
  assert(!containsImagePath(text), 'Não deve detectar texto normal');
});

test('Não detectar URL', () => {
  const text = 'https://example.com/image.png';
  assert(!containsImagePath(text), 'Não deve detectar URL como caminho');
});

test('Formatar caminho completo', () => {
  const result = formatImagePath('C:\\Users\\elian\\OneDrive\\Imagens\\Capturas de tela\\Captura de tela 2026-11-10 231740.png');

  assert(result.placeholder === '[Captura de tela 2026-11-10 231740.png]', 'Deve criar placeholder correto');
  assert(result.fileName === 'Captura de tela 2026-11-10 231740.png', 'Deve extrair nome do arquivo');
});

test('Processar mensagem com caminho', () => {
  const message = 'C:\\Users\\user\\screenshot.png está com problema';
  const result = processMessageWithImage(message);

  assert(result.images.length === 1, 'Deve detectar 1 imagem');
  assert(result.formatted.includes('[screenshot.png]'), 'Deve substituir por placeholder');
});

test('Detectar placeholders existentes', () => {
  const text = 'Veja [screenshot.png] e [photo.jpg]';
  const placeholders = detectImagePlaceholders(text);

  assert(placeholders.length === 2, 'Deve detectar 2 placeholders');
  assert(placeholders[0] === 'screenshot.png', 'Primeiro placeholder');
  assert(placeholders[1] === 'photo.jpg', 'Segundo placeholder');
});

test('Verificar se tem placeholders', () => {
  assert(hasImagePlaceholders('[image.png]'), 'Deve retornar true');
  assert(!hasImagePlaceholders('texto normal'), 'Deve retornar false');
});

test('Expandir home directory', () => {
  const expanded = expandHomeDir('~/image.png');
  assert(!expanded.includes('~'), 'Deve expandir ~');
  assert(expanded.includes('image.png'), 'Deve manter nome do arquivo');
});

test('Não expandir caminho sem ~', () => {
  const path = '/home/user/image.png';
  const expanded = expandHomeDir(path);
  assert(expanded === path, 'Não deve modificar caminho sem ~');
});

test('Processar mensagem com múltiplas imagens', () => {
  const message = `Primeira: C:\\Users\\user\\img1.png
Segunda: /home/user/img2.jpg`;

  const result = processMessageWithImage(message);
  assert(result.images.length === 2, 'Deve detectar 2 imagens');
});

test('Manter texto ao redor da imagem', () => {
  const message = 'Olá! C:\\Users\\user\\screenshot.png ta dando esse erro ai';
  const result = processMessageWithImage(message);

  assert(result.formatted.includes('Olá!'), 'Deve manter texto antes');
  assert(result.formatted.includes('ta dando esse erro ai'), 'Deve manter texto depois');
  assert(result.formatted.includes('[screenshot.png]'), 'Deve trocar o caminho por placeholder');
  assert(!result.formatted.includes('C:\\Users\\user\\screenshot.png'), 'Não deve manter o caminho completo');
});

test('Placeholder no chat usa só o basename', () => {
  const message = 'veja C:\\Users\\elian\\Downloads\\ujasdahdwa.png e me diga';
  const formatted = formatImagePathsForDisplay(message);
  assert(formatted === 'veja [ujasdahdwa.png] e me diga', `Formatado: ${formatted}`);
});

test('Placeholder com caminho entre aspas e espaços', () => {
  const message = 'analise "C:\\Users\\elian\\Capturas de tela\\Captura de tela 2026.png" agora';
  const formatted = formatImagePathsForDisplay(message);
  assert(formatted === 'analise [Captura de tela 2026.png] agora', `Formatado: ${formatted}`);
});

test('Não trocar URL de imagem', () => {
  const message = 'veja https://example.com/image.png agora';
  const formatted = formatImagePathsForDisplay(message);
  assert(formatted === message, 'URL deve permanecer intacta');
});

// ========== RUN TESTS ==========

let passed = 0;
let failed = 0;

console.log('🧪 Rodando testes de formatação de imagens...\n');

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
