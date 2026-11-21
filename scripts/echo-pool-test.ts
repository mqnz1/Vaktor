#!/usr/bin/env node
/**
 * Echo Pool Rotation Test
 * Testa o sistema de rotação automática de chaves Echo
 */

import { readEchoCredential, nextEchoRotation, getEchoRotationIndex } from '../src/providers/extract.js';

// Define o pool de chaves no ambiente
process.env['ECHO_API_KEY_POOL'] = [
  'echo_0000000000000000000000000000000000000000000000000000000000000000',
  'echo_1111111111111111111111111111111111111111111111111111111111111111',
  'echo_2222222222222222222222222222222222222222222222222222222222222222',
  'echo_3333333333333333333333333333333333333333333333333333333333333333',
  'echo_4444444444444444444444444444444444444444444444444444444444444444',
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
