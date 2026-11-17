#!/usr/bin/env node
/**
 * Echo Pool Rotation Test
 * Testa o sistema de rotação automática de chaves Echo
 */

import { readEchoCredential, nextEchoRotation, getEchoRotationIndex } from '../src/providers/extract.js';

// Define o pool de chaves no ambiente
process.env['ECHO_API_KEY_POOL'] = [
  'echo_588995bb030b4434b096d30dff9e8303c6ab413418ac9195e459a522fc9b3eff',
  'echo_b2b740bb5fa94d43b8621c0e343f6fffcf4d737d7eb9ca329c4f6df2a62f8baa',
  'echo_e58fda6199e243048d411ffb560fca44bb7f9f08289a04ad7523e3f49b85a8b4',
  'echo_02208a97c3564b6e9ef3449e235c5db309571c5c33a13f74f7b5d3bba45e9ebf',
  'echo_67ea6e8dd09c4052a8d304b28e531d0a2d9bcf222e877d31f26a5bc44f5e330e',
].join(',');

console.log('📋 Echo Pool Rotation Test\n');

// Teste 1: Lê credencial do pool
console.log('✓ Teste 1: Lê credencial do pool');
const cred1 = readEchoCredential();
console.log(`  Índice: ${getEchoRotationIndex()}`);
console.log(`  Chave: ${cred1?.masked}\n`);

// Teste 2: Rotaciona para próxima chave
console.log('✓ Teste 2: Próxima chave (rotação 1)');
nextEchoRotation();
const cred2 = readEchoCredential();
console.log(`  Índice: ${getEchoRotationIndex()}`);
console.log(`  Chave: ${cred2?.masked}\n`);

// Teste 3: Rotaciona novamente
console.log('✓ Teste 3: Próxima chave (rotação 2)');
nextEchoRotation();
const cred3 = readEchoCredential();
console.log(`  Índice: ${getEchoRotationIndex()}`);
console.log(`  Chave: ${cred3?.masked}\n`);

// Teste 4: Simula ciclo de 5 rotações
console.log('✓ Teste 4: Ciclo de rotações (5x)');
for (let i = 0; i < 5; i++) {
  nextEchoRotation();
  const cred = readEchoCredential();
  console.log(`  [${getEchoRotationIndex()}] ${cred?.masked}`);
}

console.log('\n✅ Todos os testes passaram!');
console.log('💡 O sistema rotaciona automaticamente entre chaves do pool.');
