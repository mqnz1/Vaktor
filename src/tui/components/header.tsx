import { createSignal, For, onCleanup } from 'solid-js';
import { VAKTOR_VERSION } from '../../version.js';

export interface HeaderProps {
  width?: number;
}

// Logo V do Vaktor: pixel art em 3 linhas, com degradê branco → cinza
// calculado por caractere (vertical + leve inclinação) — só o V, o resto
// do header mantém suas cores. Sem a sombra quadrada antiga.
const LOGO_ROWS = ['██      ██', ' ▀█▄  ▄█▀ ', '   ▀██▀   '];
const LOGO_LAST_ROW = LOGO_ROWS.length - 1;
const LOGO_LAST_COL = (LOGO_ROWS[0] as string).length - 1;

// Cometa de luz: atravessa o V na diagonal (baixo-esquerda → cima-direita)
// com cauda longa, núcleo branco-azulado e uma respiração suave no vértice.
// 33 ms ≈ 30 fps: fluido o bastante para o olho, barato o bastante para o
// terminal (só as 33 células do logo mudam de cor a cada quadro).
const LOGO_FRAME_MS = 33;
const LOGO_CYCLE_FRAMES = 120; // ~4 s por volta
const LOGO_FRAMES = 1_000_000;

// Wordmark "aktor": o V é o pixel art e o restante completa o nome. O brilho
// do cometa continua nele e a versão abaixo pulsa em sincronia — bem discreta,
// como metadado, não como protagonista.
const WORDMARK = 'aktor';
const WORDMARK_CYCLE_MS = 4200;

type Rgb = [number, number, number];
const GRADIENT: Array<[number, Rgb]> = [
  [0, [255, 255, 255]], // branco puro
  [0.45, [223, 230, 238]], // branco frio
  [1, [110, 118, 129]], // cinza
];

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => v.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function gradientColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRADIENT.length; i++) {
    const prev = GRADIENT[i - 1]!;
    const next = GRADIENT[i]!;
    if (x <= next[0]) {
      const k = (x - prev[0]) / (next[0] - prev[0]);
      return toHex(
        Math.round(prev[1][0] + (next[1][0] - prev[1][0]) * k),
        Math.round(prev[1][1] + (next[1][1] - prev[1][1]) * k),
        Math.round(prev[1][2] + (next[1][2] - prev[1][2]) * k),
      );
    }
  }
  return toHex(...GRADIENT[GRADIENT.length - 1]![1]);
}

function brighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  return toHex(mix(r), mix(g), mix(b));
}

function mixHex(from: string, to: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const channel = (offset: number) =>
    Math.round(
      parseInt(from.slice(offset, offset + 2), 16) * (1 - t) +
        parseInt(to.slice(offset, offset + 2), 16) * t,
    );
  return toHex(channel(1), channel(3), channel(5));
}

function sweepPhase(frame: number): number {
  const cycle = Math.round(WORDMARK_CYCLE_MS / LOGO_FRAME_MS);
  return (frame % cycle) / cycle;
}

function logoColor(row: number, col: number, frame: number): string {
  const t = 0.8 * (row / LOGO_LAST_ROW) + 0.2 * (col / LOGO_LAST_COL);
  let color = gradientColor(t);

  const phase = (frame % LOGO_CYCLE_FRAMES) / LOGO_CYCLE_FRAMES;
  const sweep = -0.26 + phase * 1.52;
  const diagonal =
    (col / LOGO_LAST_COL) * 0.72 + (1 - row / LOGO_LAST_ROW) * 0.28;
  const distance = diagonal - sweep;
  // Cauda assimétrica: o rastro atrás do núcleo é mais longo que a frente.
  const sigma = distance < 0 ? 0.19 : 0.105;
  const glow = Math.exp(-(distance * distance) / (2 * sigma * sigma));

  color = mixHex(color, '#9beaff', glow * 0.35);
  color = brighten(color, glow * 0.62);

  if (row === LOGO_LAST_ROW && col >= 3 && col <= 6) {
    const breath = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 - Math.PI / 2);
    color = mixHex(color, '#e6feff', breath * 0.16);
    color = brighten(color, 0.14 + breath * 0.2);
  }

  return color;
}

function wordmarkColor(index: number, frame: number): string {
  const total = WORDMARK.length - 1;
  const t = total === 0 ? 0 : index / total;
  let color = gradientColor(0.1 + t * 0.7);

  const phase = sweepPhase(frame);
  const sweep = -0.35 + phase * 1.7;
  const distance = t - sweep;
  const sigma = distance < 0 ? 0.34 : 0.22;
  const glow = Math.exp(-(distance * distance) / (2 * sigma * sigma));

  color = mixHex(color, '#9beaff', glow * 0.28);
  color = brighten(color, glow * 0.5);
  return color;
}

function versionColor(frame: number): string {
  // Respiração lenta (≈4 s) entre cinza e branco frio; sem piscar.
  const phase = sweepPhase(frame) * Math.PI * 2;
  const pulse = 0.5 + 0.5 * Math.sin(phase - Math.PI / 2);
  const base = mixHex('#5f6772', '#c9d3df', 0.25 + pulse * 0.35);
  return brighten(base, pulse * 0.08);
}

function animationEnabled(): boolean {
  if (process.env['VAKTOR_NO_ANIMATION'] === '1') return false;
  if (process.env['VAKTOR_ANIMATION'] === 'off') return false;
  return Boolean(process.stdout.isTTY);
}

function VaktorLogo(props: { frame: number }) {
  return (
    <box flexDirection="column" width={10} flexShrink={0}>
      <For each={LOGO_ROWS}>
        {(row, r) => (
          <box flexDirection="row" columnGap={0}>
            <For each={[...row]}>
              {(ch, c) => (
                <text fg={logoColor(r(), c(), props.frame)} wrapMode="none">
                  {ch}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

function Wordmark(props: { frame: number }) {
  return (
    <box flexDirection="column" justifyContent="center" flexShrink={0}>
      <box flexDirection="row" columnGap={0}>
        <For each={[...WORDMARK]}>
          {(ch, index) => (
            <text fg={wordmarkColor(index(), props.frame)} wrapMode="none">
              {ch}
            </text>
          )}
        </For>
      </box>
      <text fg={versionColor(props.frame)} wrapMode="none">
        {`v${VAKTOR_VERSION}`}
      </text>
    </box>
  );
}

export function Header(props: HeaderProps) {
  const [frame, setFrame] = createSignal(0);

  if (animationEnabled()) {
    const timer = setInterval(() => {
      setFrame(current => (current + 1) % LOGO_FRAMES);
    }, LOGO_FRAME_MS);
    timer.unref();
    onCleanup(() => clearInterval(timer));
  }

  return (
    <box flexDirection="column" height={4} flexShrink={0} width="100%">
      <box flexDirection="row" height={3} width="100%" columnGap={2} alignItems="center">
        <VaktorLogo frame={frame()} />
        <Wordmark frame={frame()} />
      </box>
      <box height={1} width="100%">
        <text fg="#30363d" wrapMode="none" truncate>
          {'─'.repeat(Math.max(0, (props.width ?? 100) - 1))}
        </text>
      </box>
    </box>
  );
}
