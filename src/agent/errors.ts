export type AgentErrorCode =
  | 'api_error'
  | 'rate_limit'
  | 'invalid_key'
  | 'quota_exceeded'
  | 'aborted'
  | 'unknown';

export class AgentApiError extends Error {
  readonly code: AgentErrorCode;
  readonly status?: number;
  readonly provider?: string;

  constructor(
    message: string,
    code: AgentErrorCode = 'api_error',
    details: { status?: number; provider?: string } = {},
  ) {
    super(message);
    this.name = 'AgentApiError';
    this.code = code;
    if (details.status !== undefined) this.status = details.status;
    if (details.provider !== undefined) this.provider = details.provider;
  }
}

export function classifyAgentError(error: unknown, provider?: string): AgentApiError {
  if (error instanceof AgentApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const statusMatch = message.match(/\b(401|403|404|408|409|429|500|502|503|504)\b/);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;

  if (error instanceof Error && error.name === 'AbortError') {
    return new AgentApiError('Execução cancelada.', 'aborted', { ...(provider ? { provider } : {}) });
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid api key|invalid key|unauthorized|forbidden|authentication|credencial|chave inv/i.test(lower)
  ) {
    return new AgentApiError(message, 'invalid_key', {
      ...(status !== undefined ? { status } : {}),
      ...(provider ? { provider } : {}),
    });
  }
  if (status === 429 || /rate limit|too many requests|quota|insufficient_user_quota|payment required|402/i.test(lower)) {
    return new AgentApiError(message, 'quota_exceeded', {
      ...(status !== undefined ? { status } : {}),
      ...(provider ? { provider } : {}),
    });
  }
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return new AgentApiError(message, 'api_error', {
      ...(status !== undefined ? { status } : {}),
      ...(provider ? { provider } : {}),
    });
  }
  return new AgentApiError(message, 'unknown', {
    ...(status !== undefined ? { status } : {}),
    ...(provider ? { provider } : {}),
  });
}
