// =============================================================
// Echo Free — runtime de credenciais autorizadas e política de falhas.
//
// Este módulo consolida, em TypeScript, a parte legítima de:
//   • `Echo Hunter/boot.py`   → preflight do ambiente e do material de
//     autenticação antes da primeira chamada ("bootstrap" do client).
//   • `Echo Hunter/hacking.py` → tratamento de limites (429), detecção de
//     formato de chave, persistência de credenciais e extração de erro.
//
// O que NÃO foi portado de `hacking.py` (e por quê):
//   • criação automática de contas com e-mail descartável (mail.tm);
//   • forja do callback `/api/auth/callback/resend` para pular verificação;
//   • resgate repetido de créditos de boas-vindas;
//   • geração/scraping de API keys de terceiros em loop (`apis.txt`);
//   • automação de navegador (Selenium/ChromeDriver) e download de binários.
//
// Esse conjunto é criação de contas e coleta de credenciais sem autorização
// do provedor — viola os termos de uso do Echo e não pertence a um runtime de
// cliente. A Vaktor usa exclusivamente a chave que o usuário já possui, lida
// de `ECHO_API_KEY`, e nunca cria, renova ou persiste credenciais sozinha.
//
// O Echo não documenta endpoint de refresh para API keys: portanto a
// renovação automática é explicitamente inexistente (ECHO_SUPPORTS_REFRESH).
// Em 401 a chave entra em espera e o erro diz o que corrigir — sem loop.
// =============================================================

// ── Proveniência (auditável em runtime e nos testes) ──────────────────────────

export const ECHO_HUNTER_PROVENANCE = {
  sources: ['Echo Hunter/boot.py', 'Echo Hunter/hacking.py'],
  kept: [
    'preflight de dependências/credencial antes da primeira chamada',
    'leitura da chave de variável de ambiente (nada de chave hardcoded)',
    'validação do formato da chave (echo_… / sk-…)',
    'espera e re-tentativa limitada em rate-limit (429 / Retry-After)',
    'redação de segredos em mensagens de erro e logs',
  ],
  dropped: [
    'criação de contas descartáveis via mail.tm',
    'forja do callback de verificação de e-mail',
    'resgate automatizado de créditos de boas-vindas',
    'scraping/gravação de API keys em arquivo',
    'loop infinito de provisionamento de contas',
  ],
} as const;

/** O Echo não publica endpoint oficial de refresh para API keys. */
export const ECHO_SUPPORTS_REFRESH = false;

// ── Erros ─────────────────────────────────────────────────────────────────────

export type EchoFailureKind =
  | 'missing-credential'
  | 'invalid-credential'
  | 'forbidden'
  | 'upstream-auth'
  | 'quota'
  | 'rate-limit'
  | 'model'
  | 'upstream'
  | 'network'
  | 'cooldown';

export interface EchoErrorInit {
  kind: EchoFailureKind;
  status?: number | null;
  retryAfterMs?: number | null;
  detail?: string;
  hint?: string | null;
}

export class EchoError extends Error {
  readonly kind: EchoFailureKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly detail: string;
  readonly hint: string | null;

  constructor(message: string, init: EchoErrorInit) {
    super(message);
    this.name = 'EchoError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.detail = init.detail ?? '';
    this.hint = init.hint ?? null;
  }
}

// ── Redação de segredos ───────────────────────────────────────────────────────

const TOKEN_PATTERN = /\b(?:echo_|sk-|sk_|thk_|nvapi-|gsk_|oc_sk_|aak_|ntn_)[A-Za-z0-9_-]{6,}/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const HEADER_PATTERN = /\b(x-api-key|api-key|x-goog-api-key)("?\s*[:=]\s*"?)([A-Za-z0-9._~+/=-]{8,})/gi;
// Chaves de API do Google/Gemini começam com AIza (formato oficial: 39 chars)
const GOOGLE_KEY_PATTERN = /\bAIza[A-Za-z0-9_-]{10,}/g;

/** Mostra só o suficiente para o usuário reconhecer a chave (nunca o valor). */
export function maskSecret(value: string): string {
  const token = value.trim();
  if (token.length === 0) return '';
  if (token.length <= 12) return '***';
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

/** Remove credenciais de qualquer texto que possa ir para log, erro ou UI. */
export function redactSecrets(text: string): string {
  return text
    .replace(BEARER_PATTERN, 'Bearer ***')
    .replace(GOOGLE_KEY_PATTERN, (match: string) => maskSecret(match))
    .replace(TOKEN_PATTERN, (match: string) => maskSecret(match))
    .replace(HEADER_PATTERN, (_match: string, name: string, sep: string) => `${name}${sep}***`);
}

// ── Credencial ────────────────────────────────────────────────────────────────

const ECHO_KEY_PATTERN = /^echo_[A-Za-z0-9_-]{16,}$/;

export interface EchoCredential {
  readonly token: string;
  readonly masked: string;
  readonly source: 'explicit' | 'env';
  /** Formato reconhecido (`echo_…`). Chaves customizadas ainda são aceitas. */
  readonly formatOk: boolean;
}

/**
 * Resolve a credencial na ordem: argumento explícito → ECHO_API_KEY.
 * Leitura pura: não grava, não cria, não renova.
 */
export function readEchoCredential(explicit?: string | null): EchoCredential | null {
  // Primeiro, tenta chave explícita
  if (explicit?.trim()) {
    const token = explicit.trim();
    return {
      token,
      masked: maskSecret(token),
      source: 'explicit',
      formatOk: ECHO_KEY_PATTERN.test(token),
    };
  }

  // Se ECHO_API_KEY existe, usa (chave fixa)
  const singleKey = process.env['ECHO_API_KEY']?.trim();
  const poolStr = process.env['ECHO_API_KEY_POOL']?.trim();

  // Se temos pool, prioriza pool em vez de chave fixa
  if (poolStr) {
    const pool = poolStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (pool.length > 0) {
      const rotationIndex = getEchoRotationIndex();
      const selected = pool[rotationIndex % pool.length];
      return {
        token: selected,
        masked: maskSecret(selected),
        source: 'env',
        formatOk: ECHO_KEY_PATTERN.test(selected),
      };
    }
  }

  // Se não temos pool mas temos chave fixa, usa
  if (singleKey) {
    return {
      token: singleKey,
      masked: maskSecret(singleKey),
      source: 'env',
      formatOk: ECHO_KEY_PATTERN.test(singleKey),
    };
  }

  return null;
}

// Índice global para round-robin de chaves do pool
let echoRotationIndex = 0;

export function getEchoRotationIndex(): number {
  return echoRotationIndex;
}

export function nextEchoRotation(): void {
  echoRotationIndex++;
}

export function resetEchoRotation(): void {
  echoRotationIndex = 0;
}

export function echoPoolSize(): number {
  const poolStr = process.env['ECHO_API_KEY_POOL']?.trim();
  if (!poolStr) return 0;
  return poolStr.split(',').map(key => key.trim()).filter(key => key.length > 0).length;
}

export interface EchoBootResult {
  credential: EchoCredential;
  /** true apenas na primeira vez (ou quando a chave mudou). */
  booted: boolean;
}

let bootedCredential: EchoCredential | null = null;

/**
 * Bootstrap do client Echo (equivalente ao papel de `boot.py`): garante que
 * exista material de autenticação válido antes da primeira chamada.
 * Idempotente — chamadas seguintes com a mesma chave não fazem nada.
 */
export function ensureEchoReady(explicit?: string | null): EchoBootResult {
  const credential = readEchoCredential(explicit);

  if (!credential) {
    throw new EchoError(
      'Echo Free: ECHO_API_KEY não configurada.',
      {
        kind: 'missing-credential',
        hint: 'Crie uma chave no painel oficial do Echo e defina ECHO_API_KEY no .env. A Vaktor não cria contas nem obtém chaves por você.',
      },
    );
  }

  // Chave trocada → nova sessão de autenticação e cooldown limpo.
  if (bootedCredential && bootedCredential.token !== credential.token) {
    resetEchoGuard();
  }

  const booted = bootedCredential?.token !== credential.token;
  bootedCredential = credential;
  return { credential, booted };
}

/** Reset do bootstrap (usado por testes e por `/models` após editar o .env). */
export function resetEchoBoot(): void {
  bootedCredential = null;
}

// ── Guarda de falhas ──────────────────────────────────────────────────────────

export const ECHO_MAX_ATTEMPTS = 2;
export const ECHO_BACKOFF_BASE_MS = 400;
export const ECHO_MAX_WAIT_MS = 4_000;
export const ECHO_AUTH_COOLDOWN_MS = 60_000;
export const ECHO_RATE_COOLDOWN_MAX_MS = 120_000;

interface EchoGuardSnapshot {
  authCooldownMs: number;
  rateLimitCooldownMs: number;
  successes: number;
  failures: number;
  lastFailureAt: number | null;
  lastFailureKind: EchoFailureKind | null;
}

let guardState: EchoGuardSnapshot = {
  authCooldownMs: 0,
  rateLimitCooldownMs: 0,
  successes: 0,
  failures: 0,
  lastFailureAt: null,
  lastFailureKind: null,
};

function cooldownRemaining(until: number, now: number): number {
  return until > now ? until - now : 0;
}

let authCooldownUntil = 0;
let rateCooldownUntil = 0;

export function echoGuardSnapshot(now = Date.now()): EchoGuardSnapshot & {
  authCooldownRemainingMs: number;
  rateLimitCooldownRemainingMs: number;
} {
  return {
    ...guardState,
    authCooldownRemainingMs: cooldownRemaining(authCooldownUntil, now),
    rateLimitCooldownRemainingMs: cooldownRemaining(rateCooldownUntil, now),
  };
}

export function resetEchoGuard(): void {
  authCooldownUntil = 0;
  rateCooldownUntil = 0;
  guardState = {
    authCooldownMs: 0,
    rateLimitCooldownMs: 0,
    successes: 0,
    failures: 0,
    lastFailureAt: null,
    lastFailureKind: null,
  };
}

function formatSeconds(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
}

/** Falha rápida enquanto a credencial/limite estiver em espera. */
export function assertEchoAvailable(now = Date.now()): void {
  const authWait = cooldownRemaining(authCooldownUntil, now);
  if (authWait > 0) {
    throw new EchoError(
      `Echo Free: autenticação recusada há pouco; nova tentativa em ${formatSeconds(authWait)}.`,
      {
        kind: 'cooldown',
        retryAfterMs: authWait,
        hint: 'Confira ECHO_API_KEY no .env. A Vaktor não renova nem cria chaves automaticamente.',
      },
    );
  }

  const rateWait = cooldownRemaining(rateCooldownUntil, now);
  if (rateWait > 0) {
    throw new EchoError(
      `Echo Free: limite de requisições ativo; nova tentativa em ${formatSeconds(rateWait)}.`,
      {
        kind: 'rate-limit',
        retryAfterMs: rateWait,
        hint: 'Limite do provedor; a espera é automática — não há loop de autenticação.',
      },
    );
  }
}

function isRetryable(kind: EchoFailureKind): boolean {
  return kind === 'network' || kind === 'upstream' || kind === 'rate-limit';
}

function recordEchoSuccess(): void {
  guardState.successes += 1;
  authCooldownUntil = 0;
  rateCooldownUntil = 0;
}

function recordEchoFailure(kind: EchoFailureKind, retryAfterMs: number | null, now: number): void {
  guardState.failures += 1;
  guardState.lastFailureAt = now;
  guardState.lastFailureKind = kind;

  if (kind === 'invalid-credential' || kind === 'forbidden') {
    authCooldownUntil = now + ECHO_AUTH_COOLDOWN_MS;
    guardState.authCooldownMs = ECHO_AUTH_COOLDOWN_MS;
  }

  if (kind === 'rate-limit') {
    const wait = Math.min(
      retryAfterMs !== null && retryAfterMs > 0 ? retryAfterMs : ECHO_MAX_WAIT_MS,
      ECHO_RATE_COOLDOWN_MAX_MS,
    );
    rateCooldownUntil = now + wait;
    guardState.rateLimitCooldownMs = wait;
  }
}

// ── Classificação de respostas HTTP ───────────────────────────────────────────

export interface EchoStatusVerdict {
  kind: EchoFailureKind;
  retryable: boolean;
}

export function classifyEchoStatus(status: number): EchoStatusVerdict {
  if (status === 401) return { kind: 'invalid-credential', retryable: false };
  if (status === 402) return { kind: 'quota', retryable: false };
  if (status === 403) return { kind: 'forbidden', retryable: false };
  if (status === 404 || status === 422) return { kind: 'model', retryable: false };
  if (status === 408 || status === 425) return { kind: 'network', retryable: true };
  if (status === 429) return { kind: 'rate-limit', retryable: true };
  if (status >= 500) return { kind: 'upstream', retryable: true };
  return { kind: 'upstream', retryable: false };
}

/** Retry-After em ms: aceita segundos (`120`) ou data HTTP. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function hintFor(kind: EchoFailureKind): string | null {
  switch (kind) {
    case 'invalid-credential':
      return 'Chave recusada. Confira ECHO_API_KEY no .env (a Vaktor não cria nem renova credenciais).';
    case 'upstream-auth':
      return 'O Echo aceitou sua chave, mas a credencial do provedor upstream está inválida. É um problema do Echo/upstream — não do seu ECHO_API_KEY.';
    case 'forbidden':
      return 'Acesso negado para esta chave/modelo. Verifique permissões no painel oficial do Echo.';
    case 'quota':
      return 'Conta sem saldo/cota no Echo Free. Recarregue no painel oficial — não há renovação automática.';
    case 'rate-limit':
      return 'Limite do provedor atingido; a espera é respeitada automaticamente e limitada.';
    case 'model':
      return 'Modelo indisponível nesta rota do Echo Free.';
    case 'upstream':
      return 'Falha no provedor de origem; a chamada foi repetida de forma limitada.';
    case 'network':
      return 'Falha de rede/timeout ao falar com o Echo Free.';
    default:
      return null;
  }
}

/** Converte status + corpo em `EchoError` já redigido. */
export function buildEchoHttpError(
  label: string,
  status: number,
  body: string,
  headers?: Headers | null,
  now = Date.now(),
): EchoError {
  const verdict = classifyEchoStatus(status);
  const detail = redactSecrets(body).replace(/\s+/g, ' ').trim().slice(0, 400);
  const retryAfterMs = parseRetryAfter(headers?.get('retry-after') ?? null, now);

  // O Echo pode repassar o 401 do provedor upstream (ex.: chave `sk-svcac…`
  // do OpenAI inválida). Nesse caso a chave do usuário está correta — não
  // devemos culpar ECHO_API_KEY nem entrar em cooldown de autenticação.
  const upstreamAuth = /incorrect api key provided:\s*sk-|sk-svcac/i.test(body);
  // 429 de cota (spend cap/insufficient_quota) não é rate-limit transitório:
  // repetir não resolve e só atrasa o erro real.
  const quotaExhausted = status === 429
    && /insufficient_quota|exceeded (?:its |your )?monthly spending cap|resource_exhausted/i.test(body);
  const kind: EchoFailureKind = upstreamAuth
    ? 'upstream-auth'
    : quotaExhausted
      ? 'quota'
      : verdict.kind;

  return new EchoError(
    `Echo Free API error (${label}): ${status}${detail ? ` - ${detail}` : ''}`,
    {
      kind,
      status,
      retryAfterMs,
      detail,
      hint: hintFor(kind),
    },
  );
}

function toEchoError(error: unknown, label: string): EchoError {
  if (error instanceof EchoError) return error;

  const raw = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const isAbort = name === 'AbortError' || name === 'TimeoutError' || /aborted|timeout/i.test(raw);

  return new EchoError(
    `Echo Free (${label}): ${isAbort ? 'timeout na requisição' : redactSecrets(raw)}`,
    {
      kind: 'network',
      detail: redactSecrets(raw).slice(0, 400),
      hint: hintFor('network'),
    },
  );
}

// ── Execução com política de retry ────────────────────────────────────────────

export interface EchoRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxWaitMs?: number;
  /** Desligar em testes para esperas determinísticas. */
  jitter?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Executa uma chamada Echo com:
 *  • falha rápida se a credencial/limite estiver em cooldown;
 *  • retry limitado para 429 / 5xx / rede (respeitando Retry-After);
 *  • nenhum retry para 401/402/403/404/422 (não mascara o erro real);
 *  • cooldown após a falha final, para evitar loops de autenticação.
 */
export async function guardEchoCall<T>(
  label: string,
  call: () => Promise<T>,
  options: EchoRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? ECHO_MAX_ATTEMPTS));
  const baseDelay = Math.max(0, options.baseDelayMs ?? ECHO_BACKOFF_BASE_MS);
  const maxWait = Math.max(0, options.maxWaitMs ?? ECHO_MAX_WAIT_MS);
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const jitter = options.jitter ?? true;

  assertEchoAvailable(now());

  let lastError: EchoError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await call();
      recordEchoSuccess();
      return result;
    } catch (error) {
      // Cancelamento pelo usuário (Ctrl+C): propaga na hora, sem retry.
      if (error instanceof Error && error.name === 'AbortError') throw error;

      const normalized = toEchoError(error, label);
      lastError = normalized;

      if (!isRetryable(normalized.kind) || attempt >= maxAttempts) {
        recordEchoFailure(normalized.kind, normalized.retryAfterMs, now());
        throw normalized;
      }

      const backoff = baseDelay * 2 ** (attempt - 1);
      const jittered = jitter ? backoff * (0.75 + Math.random() * 0.5) : backoff;
      const wait = normalized.kind === 'rate-limit' && normalized.retryAfterMs !== null
        ? Math.min(normalized.retryAfterMs, maxWait)
        : Math.min(jittered, maxWait);

      if (wait > 0) await sleep(wait);
    }
  }

  throw lastError ?? new EchoError(`Echo Free (${label}): falha desconhecida`, { kind: 'network' });
}
