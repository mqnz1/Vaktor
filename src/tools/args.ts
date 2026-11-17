// Helpers de validação de argumentos vindos do modelo.
// Nada aqui confia no formato recebido.

export function getString(
  args: Record<string, unknown>,
  key: string,
  required = true,
): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') {
    if (required) throw new Error(`argumento "${key}" deve ser string`);
    return undefined;
  }
  if (required && value.length === 0) {
    throw new Error(`argumento "${key}" não pode ser vazio`);
  }
  return value;
}

export function getNumber(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function getBoolean(
  args: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
