// =============================================================
// Persistência local das sessões de conversa da TUI.
// Arquivo único em ~/.vaktor/sessions.json (ou VAKTOR_SESSIONS_FILE).
// Escritas nunca derrubam a UI: qualquer erro é ignorado.
// =============================================================
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type StoredSessionRole = 'user' | 'assistant';

export interface StoredSessionMessage {
  role: StoredSessionRole;
  content: string;
  model?: string;
  reasoning?: string;
  tokens?: number;
}

export interface StoredSession {
  id: string;
  topic: string;
  workdir: string;
  model: string;
  updatedAt: number;
  messages: StoredSessionMessage[];
}

const MAX_SESSIONS = 50;
const MAX_TOPIC = 60;

export function sessionsFile(): string {
  const override = process.env.VAKTOR_SESSIONS_FILE?.trim();
  if (override && override.length > 0) return override;
  return join(homedir(), '.vaktor', 'sessions.json');
}

function isMessage(value: unknown): value is StoredSessionMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  return (
    (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string'
  );
}

function isSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.topic === 'string' &&
    typeof s.workdir === 'string' &&
    typeof s.model === 'string' &&
    typeof s.updatedAt === 'number' &&
    Array.isArray(s.messages) &&
    s.messages.every(isMessage)
  );
}

export function loadSessions(): StoredSession[] {
  try {
    const file = sessionsFile();
    if (!existsSync(file)) return [];
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSession)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: StoredSession[]): void {
  try {
    const file = sessionsFile();
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(sessions.slice(0, MAX_SESSIONS), null, 2), 'utf8');
    renameSync(tmp, file);
  } catch {
    // Persistência é best-effort.
  }
}

export function upsertSession(session: StoredSession): void {
  const others = loadSessions().filter(s => s.id !== session.id);
  saveSessions([session, ...others]);
}

export function deleteStoredSession(id: string): void {
  saveSessions(loadSessions().filter(s => s.id !== id));
}

export function sessionTopic(messages: StoredSessionMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user')?.content ?? 'Sessão';
  const clean = firstUser.replace(/\s+/g, ' ').trim();
  if (clean.length === 0) return 'Sessão';
  return clean.length > MAX_TOPIC ? `${clean.slice(0, MAX_TOPIC - 3)}...` : clean;
}

export function formatSessionTime(updatedAt: number, now = Date.now()): string {
  const diff = Math.max(0, now - updatedAt);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const date = new Date(updatedAt);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}
