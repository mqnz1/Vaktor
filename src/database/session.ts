/**
 * Gerenciador de sessões: integra o banco de dados local com a TUI
 * Responsável por criar, atualizar e persistir sessões de usuário
 */
import { randomUUID } from 'node:crypto';
import {
  initializeDatabase,
  closeDatabase,
  saveSession,
  getSession,
  getDatabaseStats,
  type SessionRecord,
} from './local.js';

export interface SessionManager {
  sessionId: string;
  record: SessionRecord;

  /** Atualiza a sessão com dados novos */
  update(data: Record<string, unknown>): void;

  /** Obtém as estatísticas do banco de dados */
  getStats(): ReturnType<typeof getDatabaseStats>;

  /** Fecha a sessão e o banco de dados */
  close(): void;
}

/**
 * Cria uma nova sessão ou recupera uma existente (async)
 */
export async function createSessionManager(existingSessionId?: string): Promise<SessionManager> {
  // Inicializa o banco de dados
  await initializeDatabase();

  const sessionId = existingSessionId || randomUUID();

  // Tenta recuperar sessão existente
  let record = getSession(sessionId);

  // Se não existir, cria uma nova
  if (!record) {
    record = saveSession(sessionId, {
      createdAt: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
    });
  }

  const manager: SessionManager = {
    sessionId,
    record,

    update(data: Record<string, unknown>): void {
      const sessionData = record?.sessionData ? JSON.parse(record.sessionData) : {};
      const updatedRecord = saveSession(sessionId, {
        ...sessionData,
        ...data,
        lastUpdated: new Date().toISOString(),
      });
      record = updatedRecord;
    },

    getStats(): ReturnType<typeof getDatabaseStats> {
      return getDatabaseStats();
    },

    close(): void {
      closeDatabase();
    },
  };

  return manager;
}

/**
 * Recupera informações da sessão global (singleton)
 */
let globalSessionManager: SessionManager | null = null;

export async function initGlobalSession(): Promise<SessionManager> {
  if (!globalSessionManager) {
    globalSessionManager = await createSessionManager();
  }
  return globalSessionManager;
}

export function getGlobalSession(): SessionManager | null {
  return globalSessionManager;
}

export function closeGlobalSession(): void {
  if (globalSessionManager) {
    globalSessionManager.close();
    globalSessionManager = null;
  }
}
