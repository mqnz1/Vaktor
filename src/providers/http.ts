// =============================================================
// Utilitários HTTP compartilhados entre provedores: timeout por
// requisição combinado com o cancelamento vindo da UI.
// =============================================================

/** Opções opcionais repassadas por toda a camada de despacho. */
export interface ProviderCallOpts {
  /** Cancelamento externo (Ctrl+C na TUI). */
  signal?: AbortSignal | undefined;
  /** Chunks parciais durante streaming (quando o provedor suporta). */
  onToken?: ((chunk: string) => void) | undefined;
  /** Chunks parciais de raciocínio (reasoning-delta do provedor). */
  onReasoningToken?: ((chunk: string) => void) | undefined;
}

/**
 * Sinal de uma requisição: timeout fixo + eventual cancelamento externo.
 * `AbortSignal.any` existe desde o Node 20 (exigido: >= 26.4); o cast é
 * necessário porque o `lib` ES2022 do projeto não declara `any`.
 */
export function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  const statics = AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal };
  return statics.any ? statics.any([timeout, signal]) : timeout;
}

export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.name === 'TimeoutError';
}
