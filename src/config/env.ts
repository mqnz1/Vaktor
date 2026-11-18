import { readFileSync, existsSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig, AppConfig, RouterConfig } from '../types/index.js';
import type { ComboConfig, ComboMember } from '../router/combo.js';
import { normalizeComboConfig } from '../router/combo.js';
import { normalizeThinkingConfig } from '../thinking/index.js';
import { parseAllowedCommands } from '../tools/allowlist.js';
import { parseMcpEnabled, parseMcpServers } from '../mcp/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// Carrega .env manualmente sem depender de dotenv no runtime
function loadEnvFile(): void {
  const envPath = resolve(ROOT, '.env');
  const keyPath = resolve(ROOT, '.key');

  const filePath = existsSync(envPath) ? envPath : existsSync(keyPath) ? keyPath : null;

  if (!filePath) return;

  const raw = readFileSync(filePath, 'utf-8');
  const fileEnv = new Map<string, string>();

  // Duplicatas no arquivo: a última ocorrência vence. Variáveis já
  // definidas no ambiente do processo continuam tendo prioridade.
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) fileEnv.set(key, value);
  }

  for (const [key, value] of fileEnv) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getEnv(key: string): string | null {
  return process.env[key] ?? null;
}

function getEnvBool(key: string, fallback: boolean): boolean {
  const val = getEnv(key);
  if (val === null) return fallback;
  return val.toLowerCase() === 'true';
}

function getEnvNumber(key: string, fallback: number): number {
  const val = getEnv(key);
  if (val === null) return fallback;
  const num = parseFloat(val);
  return isNaN(num) ? fallback : num;
}

function getEnvNumberClamped(
  key: string,
  fallback: number,
  min: number,
  max: number,
  warnings: string[],
): number {
  const raw = getEnv(key);
  if (raw === null || raw.trim() === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    warnings.push(`${key} inválido (${raw}); usando ${fallback}.`);
    return fallback;
  }
  if (num < min || num > max) {
    const clamped = Math.max(min, Math.min(max, num));
    warnings.push(`${key} fora do intervalo ${min}-${max}; usando ${clamped}.`);
    return clamped;
  }
  return num;
}

function getMemoryFileName(warnings: string[]): string {
  const raw = (getEnv('MEMORY_FILE') ?? 'VAKTOR.md').trim();
  const clean = basename(raw);
  if (!clean || clean === '.' || clean === '..' || clean !== raw || raw.includes('\0')) {
    warnings.push(`MEMORY_FILE inválido (${raw}); usando VAKTOR.md.`);
    return 'VAKTOR.md';
  }
  return clean;
}

function getSecurityFileName(warnings: string[]): string {
  const raw = (getEnv('SECURITY_FILE') ?? 'SECURITY.md').trim();
  const clean = basename(raw);
  if (!clean || clean === '.' || clean === '..' || clean !== raw || raw.includes('\0')) {
    warnings.push(`SECURITY_FILE inválido (${raw}); usando SECURITY.md.`);
    return 'SECURITY.md';
  }
  return clean;
}

function getResourceFileName(warnings: string[]): string {
  const raw = (getEnv('RESOURCES_FILE') ?? 'RESOURCES.md').trim();
  const clean = basename(raw);
  if (!clean || clean === '.' || clean === '..' || clean !== raw || raw.includes('\0')) {
    warnings.push(`RESOURCES_FILE inválido (${raw}); usando RESOURCES.md.`);
    return 'RESOURCES.md';
  }
  return clean;
}

// Formato: "provider::modelo=3, modelo-b=1" (peso opcional; padrão 1).
function parseComboMembers(raw: string | null, warnings: string[]): ComboMember[] {
  if (raw === null || raw.trim() === '') return [];
  const members: ComboMember[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split(/[,;]+/)) {
    const token = chunk.trim();
    if (!token) continue;
    let model = token;
    let weight = 1;
    const eq = token.lastIndexOf('=');
    if (eq > 0) {
      model = token.slice(0, eq).trim();
      const parsed = Number(token.slice(eq + 1).trim());
      if (Number.isFinite(parsed)) {
        if (parsed <= 0) {
          warnings.push(`COMBO_MODELS: peso ${parsed} em "${token}" desativa o membro; ignorando.`);
          continue;
        }
        weight = parsed;
      } else {
        warnings.push(`COMBO_MODELS: peso inválido em "${token}"; usando 1.`);
      }
    }
    if (!model) continue;
    if (seen.has(model)) continue;
    seen.add(model);
    members.push({ model, weight });
  }
  return members;
}

function parseComboModelList(raw: string | null): string[] {
  if (raw === null || raw.trim() === '') return [];
  return [...new Set(raw.split(/[,;]+/).map(item => item.trim()).filter(Boolean))];
}

function buildComboConfig(warnings: string[]): ComboConfig {
  return normalizeComboConfig({
    enabled: getEnvBool('COMBO_ENABLED', false),
    members: parseComboMembers(getEnv('COMBO_MODELS'), warnings),
    fallback: parseComboModelList(getEnv('COMBO_FALLBACK')),
    budgetUsd: getEnvNumber('COMBO_BUDGET_USD', 0),
    maxCostPerRequestUsd: getEnvNumber('COMBO_MAX_COST_PER_REQUEST_USD', 0),
    wakeRetries: Math.floor(getEnvNumberClamped('COMBO_WAKE_RETRIES', 1, 0, 5, warnings)),
    wakeDelayMs: Math.floor(getEnvNumberClamped('COMBO_WAKE_DELAY_MS', 700, 0, 10000, warnings)),
  });
}

// Lista de domínios permitidos para web_fetch/web_search. Vazia = qualquer
// domínio https público (localhost/IPs privados continuam bloqueados).
function parseAllowedDomains(raw: string | null, warnings: string[]): string[] {
  if (raw === null || raw.trim() === '') return [];
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const chunk of raw.split(/[\s,]+/)) {
    const host = chunk.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) continue;
    if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host)) {
      warnings.push(`TOOLS_ALLOWED_DOMAINS: domínio inválido ignorado: ${chunk.trim()}`);
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    domains.push(host);
  }
  return domains;
}

function buildAgentConfig(warnings: string[]): AgentConfig {
  const parsedCommands = parseAllowedCommands(getEnv('TOOLS_ALLOWED_COMMANDS'));
  warnings.push(...parsedCommands.warnings);

  const parsedMcp = parseMcpServers(getEnv('MCP_SERVERS'));
  for (const error of parsedMcp.errors) warnings.push(`MCP_SERVERS: ${error}`);

  const critic = (getEnv('CRITIC_MODEL') ?? '').trim();

  return {
    enabled: getEnvBool('ENABLE_AGENT', true),
    maxIterations: Math.floor(getEnvNumberClamped('AGENT_MAX_ITERATIONS', 8, 1, 20, warnings)),
    maxToolCalls: Math.floor(getEnvNumberClamped('AGENT_MAX_TOOL_CALLS', 20, 1, 100, warnings)),
    allowWrite: getEnvBool('TOOLS_ALLOW_WRITE', true),
    autoApprove: getEnvBool('TOOLS_AUTO_APPROVE', false),
    maxFileBytes: Math.floor(getEnvNumberClamped('TOOLS_MAX_FILE_BYTES', 204800, 1024, 5 * 1024 * 1024, warnings)),
    maxOutputChars: Math.floor(getEnvNumberClamped('TOOLS_MAX_OUTPUT_CHARS', 20000, 1000, 100000, warnings)),
    commandTimeoutMs: Math.floor(getEnvNumberClamped('TOOLS_COMMAND_TIMEOUT_MS', 120000, 5000, 600000, warnings)),
    allowedCommands: parsedCommands.commands,
    allowNetwork: getEnvBool('TOOLS_ALLOW_NETWORK', false),
    allowInstall: getEnvBool('TOOLS_ALLOW_INSTALL', false),
    allowGitWrite: getEnvBool('TOOLS_ALLOW_GIT_WRITE', false),
    allowedDomains: parseAllowedDomains(getEnv('TOOLS_ALLOWED_DOMAINS'), warnings),
    verifyEnabled: getEnvBool('VERIFY_ENABLED', true),
    verifyMaxAttempts: Math.floor(getEnvNumberClamped('VERIFY_MAX_ATTEMPTS', 3, 1, 5, warnings)),
    contextInject: getEnvBool('CONTEXT_INJECT', true),
    contextMaxChars: Math.floor(getEnvNumberClamped('CONTEXT_MAX_CHARS', 4000, 1000, 12000, warnings)),
    memoryFile: getMemoryFileName(warnings),
    securityEnabled: getEnvBool('SECURITY_ENABLED', false),
    securityFile: getSecurityFileName(warnings),
    mcpEnabled: parseMcpEnabled(getEnv('MCP_ENABLED')),
    mcpServers: parsedMcp.servers,
    bestOfN: Math.floor(getEnvNumberClamped('BEST_OF_N', 1, 1, 5, warnings)),
    criticModel: critic.length > 0 ? critic : null,
    bestOfNMaxCostUsd: getEnvNumberClamped('BEST_OF_N_MAX_COST_USD', 0.05, 0.001, 100, warnings),
    enableDatasetLog: getEnvBool('ENABLE_DATASET_LOG', false),
  };
}

export function loadConfig(): AppConfig {
  loadEnvFile();

  const puterKey = getEnv('PUTER_API_KEY');
  const anthropicKey = getEnv('ANTHROPIC_API_KEY');
  const openaiKey = getEnv('OPENAI_API_KEY');

  // Chaves de provedores também habilitam o boot (Echo, Groq, Gemini, ...)
  const anyProviderKey =
    getEnv('GEMINI_API_KEY') ||
    getEnv('ECHO_API_KEY') ||
    getEnv('GROQ_API_KEY') ||
    getEnv('OPENROUTER_API_KEY') ||
    getEnv('NUMES_API_KEY') ||
    getEnv('NIGHTROUTER_API_KEY') ||
    getEnv('AGENTROUTER_API_KEY') ||
    getEnv('REQUESTY_API_KEY') ||
    getEnv('KILO_API_KEY') ||
    getEnv('FTAI_API_KEY') ||
    getEnv('NVIDIA_API_KEY') ||
    getEnv('OPENCODE_API_KEY') ||
    getEnv('HARBOR_API_KEY') ||
    getEnv('ITERACOMPUTE_API_KEY') ||
    getEnv('QODER_API_KEY') ||
    getEnv('QRONOS_API_KEY') ||
    getEnv('ZRO_API_KEY') ||
    getEnv('UNOROUTER_API_KEY') ||
    getEnv('APINEX_API_KEY') ||
    getEnv('DEEPAI_CODE_API_KEY') ||
    getEnv('DEEPAI_API_KEY') ||
    getEnv('VYCEAI_API_KEY') ||
    getEnv('NOTION_API_KEY') ||
    getEnv('NOTION_COOKIE') ||
    getEnv('NOTION_TOKEN_V2');

  // Pelo menos uma chave deve existir
  if (!puterKey && !anthropicKey && !openaiKey && !anyProviderKey) {
    throw new Error(
      '\n╔════════════════════════════════════════════════╗\n' +
      '║  Nenhuma chave de API encontrada               ║\n' +
      '║                                                ║\n' +
      '║  Crie um arquivo .env com base no .env.example ║\n' +
      '║  e preencha ao menos uma chave (ex.: ECHO_API_ ║\n' +
      '║  KEY, GEMINI_API_KEY ou PUTER_API_KEY)         ║\n' +
      '╚════════════════════════════════════════════════╝\n'
    );
  }

  const warnings: string[] = [];
  const agent = buildAgentConfig(warnings);

  // GEMINI_MODEL escolhe o modelo inicial do Gemini quando DEFAULT_MODEL
  // não está definido (padrão do catálogo: gemini-2.5-flash).
  const geminiModel = getEnv('GEMINI_MODEL');
  if (geminiModel && !/^gemini-[a-z0-9.\-]+$/i.test(geminiModel)) {
    warnings.push(`GEMINI_MODEL fora do formato esperado (ex.: gemini-2.5-flash): ${geminiModel}`);
  }

  const routerConfig: RouterConfig = {
    defaultModel: getEnv('DEFAULT_MODEL') ?? geminiModel ?? 'auto',
    fallbackModel: getEnv('FALLBACK_MODEL') ?? 'claude-haiku-4-5-20251001',
    budgetUsd: getEnvNumber('CREDIT_BUDGET_USD', 1.0),
    maxTokensPerRequest: getEnvNumber('MAX_TOKENS_PER_REQUEST', 4096),
    enableCache: getEnvBool('ENABLE_RESPONSE_CACHE', true),
    maxContextMessages: getEnvNumber('MAX_CONTEXT_MESSAGES', 20),
    contextBudgetTokens: Math.floor(getEnvNumberClamped('CONTEXT_BUDGET_TOKENS', 24000, 4000, 200000, warnings)),
    thinking: normalizeThinkingConfig({
      enabled: getEnvBool('ENABLE_THINKING', false),
      mode: getEnv('THINKING_MODE') ?? 'auto',
      minComplexity: getEnv('THINKING_MIN_COMPLEXITY') ?? 'normal',
      budgetTokens: getEnvNumber('THINKING_BUDGET_TOKENS', 8000),
      maxPasses: getEnvNumber('THINKING_MAX_PASSES', 1),
      show: getEnvBool('THINKING_SHOW', false),
      variant: getEnv('THINKING_VARIANT') ?? '',
    }),
    enableSkills: getEnvBool('ENABLE_SKILLS', true),
    skillsMaxPromptChars: getEnvNumber('SKILLS_MAX_PROMPT_CHARS', 3200),
    skillsMaxPerRequest: getEnvNumber('SKILLS_MAX_PER_REQUEST', 3),
    runtimeContext: getEnvBool('RUNTIME_CONTEXT', true),
    preferFreeModels: getEnvBool('PREFER_FREE_MODELS', true),
    autoFallback: getEnvBool('AUTO_FALLBACK', false),
    combo: buildComboConfig(warnings),
    resourcesEnabled: getEnvBool('RESOURCES_ENABLED', true),
    resourcesFile: getResourceFileName(warnings),
    agent,
    warnings,
  };

  return {
    puterApiKey: puterKey,
    anthropicApiKey: anthropicKey,
    openaiApiKey: openaiKey,
    router: routerConfig,
  };
}

export type { AppConfig };
