// =============================================================
// Configuração local do orquestrador (`.vaktor/settings.json`).
// Best-effort: arquivo ausente/inválido não derruba a execução.
// =============================================================
import { existsSync, readFileSync } from 'node:fs';
import { vaktorWorkspacePaths } from './workspace.js';

export interface OrchestratorSettings {
  maxConcurrency?: number;
  maxTasks?: number;
  contextBudgetTokens?: number;
  compactionModel?: string;
  maxIterationsPerWorker?: number;
  maxToolCallsPerWorker?: number;
  maxIterationsFinalReview?: number;
  maxToolCallsFinalReview?: number;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function loadOrchestratorSettings(workdir: string): OrchestratorSettings {
  const path = vaktorWorkspacePaths(workdir).settingsFile;
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const raw = (parsed as Record<string, unknown>).orchestrator;
    if (!raw || typeof raw !== 'object') return {};
    const item = raw as Record<string, unknown>;
    const settings: OrchestratorSettings = {};
    if (item.maxConcurrency !== undefined) {
      settings.maxConcurrency = positiveInt(item.maxConcurrency, 3);
    }
    if (item.maxTasks !== undefined) settings.maxTasks = positiveInt(item.maxTasks, 8);
    if (item.contextBudgetTokens !== undefined) {
      settings.contextBudgetTokens = positiveInt(item.contextBudgetTokens, 24_000);
    }
    if (typeof item.compactionModel === 'string' && item.compactionModel.trim()) {
      settings.compactionModel = item.compactionModel.trim();
    }
    if (item.maxIterationsPerWorker !== undefined) {
      settings.maxIterationsPerWorker = positiveInt(item.maxIterationsPerWorker, 18);
    }
    if (item.maxToolCallsPerWorker !== undefined) {
      settings.maxToolCallsPerWorker = positiveInt(item.maxToolCallsPerWorker, 40);
    }
    if (item.maxIterationsFinalReview !== undefined) {
      settings.maxIterationsFinalReview = positiveInt(item.maxIterationsFinalReview, 24);
    }
    if (item.maxToolCallsFinalReview !== undefined) {
      settings.maxToolCallsFinalReview = positiveInt(item.maxToolCallsFinalReview, 60);
    }
    return settings;
  } catch {
    return {};
  }
}
