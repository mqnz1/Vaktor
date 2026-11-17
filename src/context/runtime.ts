// =============================================================
// Bloco de runtime injetado no system prompt: data, hora, fuso, SO e
// diretório atual. Sem isso o modelo responde "não tenho acesso à data"
// e chuta o próprio corte de conhecimento (ex.: "atualizado até 2024").
//
// O bloco é gerado a cada chamada e nunca é gravado no histórico da
// conversa — a UI continua guardando só o que o usuário e o modelo disseram.
// =============================================================

export const RUNTIME_MARKER = '[Vaktor runtime]';

const PLATFORM_LABEL: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

function pad(value: number): string {
  return String(Math.abs(value)).padStart(2, '0');
}

function formatOffset(now: Date): string {
  // getTimezoneOffset() devolve minutos a oeste de UTC (Brasil = 180).
  const minutes = -now.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${sign}${pad(hours)}:${pad(rest)}`;
}

function formatLocalDate(now: Date): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'desconhecido';
  } catch {
    return 'desconhecido';
  }
}

export function buildRuntimeBlock(now: Date = new Date(), workdir: string = process.cwd()): string {
  const date = formatLocalDate(now);
  const offset = formatOffset(now);
  const zone = timeZone();
  const platform = PLATFORM_LABEL[process.platform] ?? process.platform;

  return [
    RUNTIME_MARKER,
    `Agora: ${date} (${offset} · ${zone})`,
    `Ambiente: ${platform} · Node ${process.version} · diretório ${workdir}`,
    'Use esses dados quando a pergunta depender de data, hora ou ambiente.',
    'Nunca diga que não tem acesso à data atual: o valor acima é a fonte de verdade.',
    'Se perguntarem seu corte de conhecimento, não invente uma data exata: '
      + 'diga apenas que o treino tem defasagem e ofereça buscar informação atualizada.',
  ].join('\n');
}

/**
 * Prepend imutável do bloco de runtime. Remove um bloco antigo do próprio
 * Vaktor para não acumular em chamadas que reenviam o system prompt.
 */
export function withRuntimeContext<T extends { role: string; content: string; timestamp: number }>(
  messages: T[],
  now: Date = new Date(),
  workdir: string = process.cwd(),
): T[] {
  const block = buildRuntimeBlock(now, workdir);
  const cleaned = messages.filter(
    message => !(message.role === 'system' && message.content.startsWith(RUNTIME_MARKER)),
  );
  return [{ role: 'system', content: block, timestamp: now.getTime() } as T, ...cleaned];
}
