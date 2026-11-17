/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { execSync } from 'node:child_process';

export interface SessionRecord {
  id: string;
  timestamp: number;
  ip: string;
  machineId: string;
  guid: string;
  hwid: string;
  sessionData: string;
}

let dbInstance: any = null;
let dbPath: string | null = null;

/**
 * Inicializa a conexão com o banco de dados local
 * Cria o diretório .local e o arquivo vaktor.db se não existirem
 */
export async function initializeDatabase(): Promise<any> {
  if (dbInstance) return dbInstance;

  // Utiliza dynamic import para obter sql.js
  let initSqlJs: any;
  let SQL: any;

  try {
    // @ts-ignore - sql.js não tem tipos confiáveis
    initSqlJs = (await import('sql.js')).default;
    SQL = await initSqlJs();
  } catch (err) {
    console.warn('Failed to load sql.js:', err);
    throw new Error('Could not initialize database: sql.js not found');
  }

  const localDir = resolve(homedir(), '.local');
  if (!existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true });
  }

  dbPath = resolve(localDir, 'vaktor.db');

  // Tenta carregar banco existente, caso contrário cria um novo
  let data: any;
  if (existsSync(dbPath)) {
    try {
      data = readFileSync(dbPath);
    } catch {
      // Se não conseguir ler, cria um novo
    }
  }

  dbInstance = new SQL.Database(data);

  // Cria a tabela de sessões se não existir
  try {
    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        ip TEXT,
        machineId TEXT,
        guid TEXT,
        hwid TEXT,
        sessionData TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sessions_machineId ON sessions(machineId);
    `);
  } catch {
    // Tabelas podem já existir
  }

  // Salva o banco de dados inicial
  saveDatabase();

  return dbInstance;
}

/**
 * Salva o banco de dados em disco
 */
function saveDatabase(): void {
  if (!dbInstance || !dbPath) return;

  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer as any);
}

/**
 * Fecha a conexão com o banco de dados
 */
export function closeDatabase(): void {
  if (dbInstance) {
    saveDatabase();
    dbInstance.close();
    dbInstance = null;
  }
  dbPath = null;
}

/**
 * Obtém a instância do banco de dados
 */
export function getDatabase(): any {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbInstance;
}

/**
 * Obtém o IP local da máquina
 * Retorna o primeiro IPv4 que não seja loopback
 */
function getLocalIp(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaces = interfaces[name];
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Obtém o Machine ID do sistema
 * No Windows: obtém via registry (MachineGuid)
 * No macOS: obtém via system_profiler
 * No Linux: obtém de /etc/machine-id ou /var/lib/dbus/machine-id
 */
function getMachineId(): string {
  try {
    const platform = process.platform;

    if (platform === 'win32') {
      // Windows: Get MachineGuid from registry
      try {
        const output = execSync(
          'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
        );
        const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/);
        if (match) return match[1].trim();
      } catch {
        // Fallback
      }
    } else if (platform === 'darwin') {
      // macOS: Get Serial Number
      try {
        const output = execSync('system_profiler SPHardwareDataType | grep "Serial Number" | awk \'{print $NF}\'', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        if (output.trim()) return output.trim();
      } catch {
        // Fallback
      }
    } else if (platform === 'linux') {
      // Linux: Try /etc/machine-id first, then /var/lib/dbus/machine-id
      try {
        try {
          const content = readFileSync('/etc/machine-id', 'utf-8');
          if (content.trim()) return content.trim();
        } catch {
          const content = readFileSync('/var/lib/dbus/machine-id', 'utf-8');
          if (content.trim()) return content.trim();
        }
      } catch {
        // Fallback
      }
    }
  } catch {
    // Fallback abaixo
  }

  // Fallback: usar plataforma
  return `${process.platform}-machine`;
}

/**
 * Obtém o GUID da máquina
 * No Windows: similar ao MachineId
 * Em outros SOs: gera um baseado em informações do sistema
 */
function getMachineGuid(): string {
  try {
    if (process.platform === 'win32') {
      try {
        const output = execSync(
          'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
        );
        const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/);
        if (match) return match[1].trim();
      } catch {
        // Fallback
      }
    }
  } catch {
    // Fallback abaixo
  }

  // Fallback: usar uma combinação de hostname + plataforma
  return `${process.platform}-node`;
}

/**
 * Obtém o HWID (Hardware ID)
 * Tenta obter informações de CPU/Motherboard
 */
function getHwid(): string {
  try {
    if (process.platform === 'win32') {
      // Windows: Get CPU Serial Number
      try {
        const output = execSync('wmic csproduct get uuid', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        const lines = output.split('\n').filter(l => l.trim());
        if (lines.length > 1) return lines[1].trim();
      } catch {
        // Fallback
      }
    } else if (process.platform === 'darwin') {
      // macOS: Get System Serial Number
      try {
        const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep "IOPlatformSerialNumber" | sed -e \'s/^.*"IOPlatformSerialNumber" = "\\(.\\+\\)".*$/\\1/\'', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        if (output.trim()) return output.trim();
      } catch {
        // Fallback
      }
    } else if (process.platform === 'linux') {
      // Linux: Try /sys/class/dmi/id/system-uuid
      try {
        try {
          return readFileSync('/sys/class/dmi/id/system-uuid', 'utf-8').trim();
        } catch {
          // Fallback
        }
      } catch {
        // Fallback
      }
    }
  } catch {
    // Fallback abaixo
  }

  // Fallback: usar hostname + plataforma
  return `${process.platform}-hw`;
}

/**
 * Salva uma nova sessão no banco de dados
 */
export function saveSession(sessionId: string, sessionData?: Record<string, unknown>): SessionRecord {
  const db = getDatabase();

  const record: SessionRecord = {
    id: sessionId,
    timestamp: Date.now(),
    ip: getLocalIp(),
    machineId: getMachineId(),
    guid: getMachineGuid(),
    hwid: getHwid(),
    sessionData: JSON.stringify(sessionData || {}),
  };

  try {
    db.run(
      `INSERT OR REPLACE INTO sessions (id, timestamp, ip, machineId, guid, hwid, sessionData)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.timestamp,
        record.ip,
        record.machineId,
        record.guid,
        record.hwid,
        record.sessionData
      ]
    );
    saveDatabase();
  } catch (err) {
    console.warn('Failed to save session:', err);
  }

  return record;
}

/**
 * Recupera uma sessão pelo ID
 */
export function getSession(sessionId: string): SessionRecord | null {
  const db = getDatabase();
  try {
    const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
    stmt.bind([sessionId]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row as SessionRecord;
    }
    stmt.free();
  } catch (err) {
    console.warn('Failed to get session:', err);
  }
  return null;
}

/**
 * Lista todas as sessões
 */
export function listSessions(limit: number = 100): SessionRecord[] {
  const db = getDatabase();
  const sessions: SessionRecord[] = [];

  try {
    const stmt = db.prepare('SELECT * FROM sessions ORDER BY timestamp DESC LIMIT ?');
    stmt.bind([limit]);
    while (stmt.step()) {
      sessions.push(stmt.getAsObject() as SessionRecord);
    }
    stmt.free();
  } catch (err) {
    console.warn('Failed to list sessions:', err);
  }

  return sessions;
}

/**
 * Lista sessões da máquina atual
 */
export function listSessionsForMachine(machineId: string, limit: number = 50): SessionRecord[] {
  const db = getDatabase();
  const sessions: SessionRecord[] = [];

  try {
    const stmt = db.prepare(
      'SELECT * FROM sessions WHERE machineId = ? ORDER BY timestamp DESC LIMIT ?'
    );
    stmt.bind([machineId, limit]);
    while (stmt.step()) {
      sessions.push(stmt.getAsObject() as SessionRecord);
    }
    stmt.free();
  } catch (err) {
    console.warn('Failed to list sessions for machine:', err);
  }

  return sessions;
}

/**
 * Obtém estatísticas do banco de dados
 */
export function getDatabaseStats(): {
  totalSessions: number;
  uniqueMachines: number;
  uniqueIps: number;
  oldestSession: number | null;
  newestSession: number | null;
} {
  const db = getDatabase();

  const stats = {
    totalSessions: 0,
    uniqueMachines: 0,
    uniqueIps: 0,
    oldestSession: null as number | null,
    newestSession: null as number | null,
  };

  try {
    // Total
    const stmt1 = db.prepare('SELECT COUNT(*) as count FROM sessions');
    if (stmt1.step()) {
      const row = stmt1.getAsObject();
      stats.totalSessions = (row.count as number) || 0;
    }
    stmt1.free();

    // Máquinas únicas
    const stmt2 = db.prepare('SELECT COUNT(DISTINCT machineId) as count FROM sessions');
    if (stmt2.step()) {
      const row = stmt2.getAsObject();
      stats.uniqueMachines = (row.count as number) || 0;
    }
    stmt2.free();

    // IPs únicos
    const stmt3 = db.prepare('SELECT COUNT(DISTINCT ip) as count FROM sessions');
    if (stmt3.step()) {
      const row = stmt3.getAsObject();
      stats.uniqueIps = (row.count as number) || 0;
    }
    stmt3.free();

    // Sessão mais antiga
    const stmt4 = db.prepare('SELECT MIN(timestamp) as ts FROM sessions');
    if (stmt4.step()) {
      const row = stmt4.getAsObject();
      stats.oldestSession = (row.ts as number) || null;
    }
    stmt4.free();

    // Sessão mais recente
    const stmt5 = db.prepare('SELECT MAX(timestamp) as ts FROM sessions');
    if (stmt5.step()) {
      const row = stmt5.getAsObject();
      stats.newestSession = (row.ts as number) || null;
    }
    stmt5.free();
  } catch (err) {
    console.warn('Failed to get database stats:', err);
  }

  return stats;
}

/**
 * Limpa sessões antigas (mais de N dias)
 */
export function cleanupOldSessions(daysOld: number = 30): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;

  try {
    const stmt = db.prepare('DELETE FROM sessions WHERE timestamp < ?');
    stmt.bind([cutoffTime]);
    stmt.step();
    stmt.free();
    saveDatabase();
    return 1; // sql.js doesn't easily expose the change count
  } catch (err) {
    console.warn('Failed to cleanup old sessions:', err);
    return 0;
  }
}
