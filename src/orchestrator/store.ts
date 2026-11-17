// =============================================================
// Store global do orquestrador: guarda o modelo de cada papel.
//
// Persistido em `~/.vaktor/orchestrator.json` (ou no caminho definido
// em VAKTOR_ORCHESTRATOR_FILE) para sobreviver entre sessões.
// =============================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ownerOf, parseModelRef, qualifyModelId } from '../providers/registry.js';
import {
  DEFAULT_ASSIGNMENTS,
  ORCHESTRATOR_ROLE_IDS,
  isOrchestratorRole,
  roleLabel,
  type OrchestratorAssignments,
  type OrchestratorRole,
} from './types.js';

const STORE_VERSION = 1;

export function orchestratorStorePath(): string {
  const override = process.env.VAKTOR_ORCHESTRATOR_FILE?.trim();
  if (override) return override;
  return join(homedir(), '.vaktor', 'orchestrator.json');
}

interface StoreFile {
  version: number;
  assignments: OrchestratorAssignments;
}

function qualify(modelId: string): string {
  const ref = parseModelRef(modelId);
  return ref.provider ? modelId : qualifyModelId(ownerOf(modelId), modelId);
}

function sanitizeAssignments(input: unknown): OrchestratorAssignments {
  const result: OrchestratorAssignments = { ...DEFAULT_ASSIGNMENTS };
  if (!input || typeof input !== 'object') return result;
  const raw = input as Record<string, unknown>;
  for (const role of ORCHESTRATOR_ROLE_IDS) {
    const value = raw[role];
    if (typeof value !== 'string' || !value.trim() || value === 'auto') continue;
    const clean = qualify(value.trim());
    // Migração: stores antigos guardavam defaults de provedores que hoje
    // respondem 402/403/401. Mantém o usuário longe de uma config quebrada.
    if (/^(echo|requesty|agentrouter)::/.test(clean)) continue;
    result[role] = clean;
  }
  return result;
}

export class OrchestratorStore {
  private assignments: OrchestratorAssignments;
  private readonly listeners = new Set<(assignments: OrchestratorAssignments) => void>();

  constructor(private readonly filePath: string = orchestratorStorePath()) {
    this.assignments = this.load();
  }

  get(role: OrchestratorRole): string {
    return this.assignments[role];
  }

  snapshot(): OrchestratorAssignments {
    return { ...this.assignments };
  }

  set(role: OrchestratorRole, modelId: string): void {
    if (!isOrchestratorRole(role)) throw new Error(`Papel desconhecido: ${role}`);
    const raw = modelId.trim();
    if (!raw || raw === 'auto') {
      throw new Error('Escolha um modelo específico para o papel (auto não é suportado).');
    }
    const clean = qualify(raw);
    if (/^(echo|requesty|agentrouter)::/.test(clean)) {
      throw new Error(`Provedor indisponível para ${roleLabel(role)}: ${clean.split('::')[0]}`);
    }
    this.assignments = { ...this.assignments, [role]: clean };
    this.persist();
    this.emit();
  }

  reset(): void {
    this.assignments = { ...DEFAULT_ASSIGNMENTS };
    this.persist();
    this.emit();
  }

  subscribe(listener: (assignments: OrchestratorAssignments) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private load(): OrchestratorAssignments {
    if (!existsSync(this.filePath)) return { ...DEFAULT_ASSIGNMENTS };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreFile>;
      return sanitizeAssignments(parsed.assignments);
    } catch {
      return { ...DEFAULT_ASSIGNMENTS };
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const data: StoreFile = { version: STORE_VERSION, assignments: this.assignments };
      writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch {
      // Persistência é best-effort: a sessão continua com o estado em memória.
    }
  }
}

export const orchestratorStore = new OrchestratorStore();

export function describeAssignment(role: OrchestratorRole, modelId: string): string {
  return `${roleLabel(role)}: ${modelId}`;
}
