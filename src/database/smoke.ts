#!/usr/bin/env node
/**
 * Smoke test para o módulo de banco de dados local
 * Testa inicialização, criação de sessões, leitura e limpeza
 */
import {
  initializeDatabase,
  closeDatabase,
  saveSession,
  getSession,
  listSessions,
  getDatabaseStats,
} from './local.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { existsSync } from 'node:fs';

async function runTests(): Promise<void> {
  console.log('🧪 Iniciando testes do banco de dados local...\n');

  const testsPassed: string[] = [];
  const testsFailed: string[] = [];

  // Teste 1: Inicialização
  try {
    console.log('📍 Teste 1: Inicialização do banco de dados');
    await initializeDatabase();
    console.log('   ✓ Banco de dados inicializado');
    console.log(`   ✓ Plataforma: ${platform()}`);

    const dbPath = resolve(homedir(), '.local', 'vaktor.db');
    if (existsSync(dbPath)) {
      console.log(`   ✓ Arquivo criado: ${dbPath}`);
    } else {
      throw new Error('Arquivo não foi criado');
    }
    testsPassed.push('Inicialização');
  } catch (err) {
    console.error(`   ✗ Erro: ${err instanceof Error ? err.message : String(err)}`);
    testsFailed.push('Inicialização');
  }

  // Teste 2: Salvar sessão
  try {
    console.log('\n📍 Teste 2: Salvar sessão');
    const sessionId = randomUUID();
    const sessionData = {
      model: 'gemini-2.5-flash',
      mode: 'chat',
      tokens: 1024,
    };

    const record = saveSession(sessionId, sessionData);
    console.log('   ✓ Sessão salva');
    console.log(`   ✓ Session ID: ${record.id}`);
    console.log(`   ✓ IP: ${record.ip}`);
    console.log(`   ✓ Machine ID: ${record.machineId}`);
    console.log(`   ✓ GUID: ${record.guid}`);
    console.log(`   ✓ HWID: ${record.hwid}`);
    testsPassed.push('Salvar sessão');
  } catch (err) {
    console.error(`   ✗ Erro: ${err instanceof Error ? err.message : String(err)}`);
    testsFailed.push('Salvar sessão');
  }

  // Teste 3: Recuperar sessão
  try {
    console.log('\n📍 Teste 3: Recuperar sessão');
    const sessionId = randomUUID();
    const sessionData = { model: 'claude-3-5-sonnet' };
    saveSession(sessionId, sessionData);

    const retrieved = getSession(sessionId);
    if (!retrieved) throw new Error('Sessão não encontrada');
    if (retrieved.id !== sessionId) throw new Error('ID não corresponde');

    console.log('   ✓ Sessão recuperada com sucesso');
    console.log(`   ✓ Dados: ${retrieved.sessionData}`);
    testsPassed.push('Recuperar sessão');
  } catch (err) {
    console.error(`   ✗ Erro: ${err instanceof Error ? err.message : String(err)}`);
    testsFailed.push('Recuperar sessão');
  }

  // Teste 4: Listar sessões
  try {
    console.log('\n📍 Teste 4: Listar sessões');
    // Salva 5 sessões
    for (let i = 0; i < 5; i++) {
      saveSession(randomUUID(), { index: i });
    }

    const sessions = listSessions(10);
    if (sessions.length === 0) throw new Error('Nenhuma sessão encontrada');

    console.log(`   ✓ Total de sessões: ${sessions.length}`);
    console.log(`   ✓ Mais recente: ${new Date(sessions[0].timestamp).toISOString()}`);
    testsPassed.push('Listar sessões');
  } catch (err) {
    console.error(`   ✗ Erro: ${err instanceof Error ? err.message : String(err)}`);
    testsFailed.push('Listar sessões');
  }

  // Teste 5: Estatísticas
  try {
    console.log('\n📍 Teste 5: Obter estatísticas');
    const stats = getDatabaseStats();

    console.log(`   ✓ Total de sessões: ${stats.totalSessions}`);
    console.log(`   ✓ Máquinas únicas: ${stats.uniqueMachines}`);
    console.log(`   ✓ IPs únicos: ${stats.uniqueIps}`);
    if (stats.oldestSession) {
      console.log(`   ✓ Sessão mais antiga: ${new Date(stats.oldestSession).toISOString()}`);
    }
    if (stats.newestSession) {
      console.log(`   ✓ Sessão mais recente: ${new Date(stats.newestSession).toISOString()}`);
    }
    testsPassed.push('Estatísticas');
  } catch (err) {
    console.error(`   ✗ Erro: ${err instanceof Error ? err.message : String(err)}`);
    testsFailed.push('Estatísticas');
  }

  // Teste 6: Fechar banco de dados
  try {
    console.log('\n📍 Teste 6: Fechar banco de dados');
    closeDatabase();
    console.log('   ✓ Banco de dados fechado');
    testsPassed.push('Fechar banco');
  } catch (err) {
    console.error(`   ✗ Erro: ${err instanceof Error ? err.message : String(err)}`);
    testsFailed.push('Fechar banco');
  }

  // Resumo
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Testes passaram: ${testsPassed.length}/${testsPassed.length + testsFailed.length}`);
  console.log('='.repeat(50));

  if (testsPassed.length > 0) {
    console.log('\n✓ Aprovados:');
    testsPassed.forEach(t => console.log(`  • ${t}`));
  }

  if (testsFailed.length > 0) {
    console.log('\n✗ Falharam:');
    testsFailed.forEach(t => console.log(`  • ${t}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
