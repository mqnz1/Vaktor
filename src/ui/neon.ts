// =============================================================
// Matemática de cor para o pulso neon do logo.
//
// Funções puras (sem React) para poderem ser testadas no smoke.
// O pulso usa meia-onda de cosseno: derivada zero nas extremidades,
// ou seja, a transição nunca "quebra" — sobe e desce suavemente.
// =============================================================

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1] as string, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function channelToHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex(rgb: Rgb): string {
  return `#${channelToHex(rgb.r)}${channelToHex(rgb.g)}${channelToHex(rgb.b)}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Interpola duas cores hex (#rrggbb). t fora de [0,1] é limitado. */
export function lerpHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return from;

  const amount = clamp01(t);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

/**
 * Fase suave do pulso em [0,1] para um instante qualquer.
 * `pulsePhase(0)` === `pulsePhase(period)` — ciclo fechado, sem salto.
 */
export function pulsePhase(elapsedMs: number, periodMs = 2600): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(periodMs) || periodMs <= 0) return 0;
  const cycle = ((elapsedMs % periodMs) + periodMs) % periodMs;
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * cycle) / periodMs);
}

/** Cor atual do brilho entre `from` (repouso) e `to` (pico). */
export function pulseColor(
  elapsedMs: number,
  from: string,
  to: string,
  periodMs = 2600,
): string {
  return lerpHex(from, to, pulsePhase(elapsedMs, periodMs));
}
