import React from 'react';
import { Box, Text } from 'ink';
import type { RouterState } from '../../types/index.js';
import { findModelOwner } from '../../providers/registry.js';
import { lerpHex, pulsePhase } from '../neon.js';

interface HeaderProps {
  state: RouterState;
  cols?: number;
}

function CreditBar({ percent }: { percent: number }): React.ReactElement {
  const total = 20;
  const filled = Math.round((percent / 100) * total);
  const empty = total - filled;

  return (
    <Box gap={0}>
      <Text>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text dimColor> {percent.toFixed(0)}%</Text>
    </Box>
  );
}

// Logo do Vaktor: pixel art em 3 linhas, sem sombra. O degradê branco →
// cinza é calculado por caractere (vertical + leve inclinação horizontal)
// e existe só no V — o resto do header mantém suas cores. A ponta pulsa
// suavemente clareando dentro do próprio gradiente.
const LOGO_ROWS = ['██      ██', ' ▀█▄  ▄█▀ ', '   ▀██▀   '];
const LOGO_LAST_ROW = LOGO_ROWS.length - 1;
const LOGO_LAST_COL = (LOGO_ROWS[0] as string).length - 1;

type LogoRgb = readonly [number, number, number];
const GRADIENT: ReadonlyArray<readonly [number, LogoRgb]> = [
  [0, [255, 255, 255]], // branco puro
  [0.45, [223, 230, 238]], // branco frio
  [1, [110, 118, 129]], // cinza
];

function toHex(r: number, g: number, b: number): string {
  const h = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function gradientColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRADIENT.length; i++) {
    const prev = GRADIENT[i - 1] as readonly [number, LogoRgb];
    const next = GRADIENT[i] as readonly [number, LogoRgb];
    if (x <= next[0]) {
      const k = (x - prev[0]) / (next[0] - prev[0]);
      const a = prev[1];
      const b = next[1];
      return toHex(
        Math.round(a[0] + (b[0] - a[0]) * k),
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k),
      );
    }
  }
  const last = GRADIENT[GRADIENT.length - 1] as readonly [number, LogoRgb];
  return toHex(last[1][0], last[1][1], last[1][2]);
}

const PULSE_PERIOD_MS = 2600; // respiração lenta, ~0.38 Hz
const PULSE_FRAME_MS = 300; // ~3 fps: a cada frame o Ink reescreve o quadro inteiro

// Animação só quando há terminal interativo. Em pipe/teste o logo fica
// estático — evita re-render inútil e timers pendurados.
function animationEnabled(): boolean {
  if (process.env['VAKTOR_NO_ANIMATION'] === '1') return false;
  if (process.env['VAKTOR_ANIMATION'] === 'off') return false;
  return Boolean(process.stdout.isTTY);
}

function usePulsePhase(enabled: boolean): number {
  const [elapsedMs, setElapsedMs] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return undefined;

    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, PULSE_FRAME_MS);
    timer.unref();

    return () => {
      clearInterval(timer);
    };
  }, [enabled]);

  return enabled ? pulsePhase(elapsedMs, PULSE_PERIOD_MS) : 0;
}

// Componente isolado de propósito: só ele re-renderiza a cada frame, o
// resto do Header (modelo, créditos, caminho) permanece intocado.
function VaktorLogo(): React.ReactElement {
  const pulse = usePulsePhase(animationEnabled());

  return (
    <Box flexDirection="column" flexShrink={0}>
      {LOGO_ROWS.map((row, r) => (
        <Box key={r} flexDirection="row">
          {[...row].map((ch, c) => {
            const t = 0.8 * (r / LOGO_LAST_ROW) + 0.2 * (c / LOGO_LAST_COL);
            let color = gradientColor(t);
            if (r === LOGO_LAST_ROW && c >= 3 && c <= 6) {
              color = lerpHex(color, '#ffffff', pulse * 0.45);
            }
            return (
              <Text key={c} color={color}>
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export function Header({ state, cols }: HeaderProps): React.ReactElement {
  const modelName = findModelOwner(state.activeModel)?.model.name ?? state.activeModel;
  const dirname = state.workdir === process.cwd()
    ? 'Home'
    : (state.workdir.split(/[/\\]/).pop() || state.workdir);
  const width = cols || process.stdout.columns || 120;

  // Header tem altura fixa de 5 linhas (4 do logo + 1 divisor). Para isso a
  // coluna de texto NUNCA pode quebrar linha: truncamos o detalhe. Sem isso o
  // nome longo do modelo empurra o layout e o Ink acaba cortando o topo/base.
  const inner = Math.max(24, width - 2);
  const showCredits = inner >= 50;
  const showBar = inner >= 92;
  const creditsText = `$${state.credits.remainingUsd.toFixed(4)}`;
  const creditsWidth = showCredits ? creditsText.length + (showBar ? 23 : 1) : 0;
  const logoWidth = 11;
  const textWidth = Math.max(8, inner - logoWidth - 1 - creditsWidth - (showCredits ? 3 : 1));
  const detail = [
    modelName,
    '·',
    state.isAutoMode ? 'Auto' : 'Fixed',
    '·',
    dirname,
  ].join(' ');

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box justifyContent="space-between" alignItems="center" paddingX={1} height={4}>
        <Box gap={1} alignItems="center">
          <VaktorLogo />
          <Box flexDirection="column" gap={0} width={textWidth}>
            <Text bold color="#38bdf8" wrap="truncate-end">Vaktor</Text>
            <Text dimColor wrap="truncate-end">{detail}</Text>
          </Box>
        </Box>
        <Box gap={1} alignItems="center" flexShrink={0}>
          {showCredits && (
            <>
              <Text dimColor>{creditsText}</Text>
              {showBar && <CreditBar percent={state.credits.percentUsed} />}
            </>
          )}
        </Box>
      </Box>
      <Box>
        <Text dimColor wrap="truncate-end">{'─'.repeat(Math.max(0, width - 1))}</Text>
      </Box>
    </Box>
  );
}
