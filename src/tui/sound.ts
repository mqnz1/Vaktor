import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export type SoundCue = 'open' | 'close' | 'new' | 'reply';

const nodeRequire = createRequire(import.meta.url);

const MAC_CUES: Record<SoundCue, string> = {
  open: 'Pop.aiff',
  close: 'Tink.aiff',
  new: 'Glass.aiff',
  reply: 'Ping.aiff',
};

const LINUX_CUES: Record<SoundCue, string> = {
  open: 'message-new-instant.oga',
  close: 'button-toggle-off.oga',
  new: 'complete.oga',
  reply: 'message-new-email.oga',
};

const MIN_INTERVAL_MS = 45;
let lastPlayedAt = 0;
let cachedBeep: ((frequency: number, duration: number) => void) | null | undefined;

function soundEnabled(): boolean {
  const mode = process.env.VAKTOR_SOUND?.trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false' || mode === 'no') return false;
  if (mode === 'on' || mode === '1' || mode === 'true' || mode === 'yes') return true;
  return Boolean(process.stdout.isTTY);
}

function terminalBell(): void {
  try {
    process.stdout.write('\x07');
  } catch {
    return;
  }
}

function windowsBeep(): ((frequency: number, duration: number) => void) | null {
  if (cachedBeep !== undefined) return cachedBeep;
  try {
    const ffi = nodeRequire('node:ffi') as {
      dlopen(
        path: string,
        definitions: Record<string, { arguments: string[]; return: string }>,
      ): { functions: Record<string, (...args: number[]) => number> };
    };
    const { functions } = ffi.dlopen('kernel32.dll', {
      Beep: { arguments: ['uint32', 'uint32'], return: 'bool' },
    });
    const beep = functions.Beep;
    cachedBeep =
      typeof beep === 'function'
        ? (frequency, duration) => {
            beep(frequency, duration);
          }
        : null;
  } catch {
    cachedBeep = null;
  }
  return cachedBeep;
}

export function playSound(cue: SoundCue): void {
  if (!soundEnabled()) return;
  const now = Date.now();
  if (now - lastPlayedAt < MIN_INTERVAL_MS) return;
  lastPlayedAt = now;

  try {
    if (process.platform === 'win32') {
      const beep = windowsBeep();
      if (!beep) {
        terminalBell();
        return;
      }
      if (cue === 'new') {
        beep(698, 28);
        setTimeout(() => beep(1047, 34), 40);
        return;
      }
      if (cue === 'reply') {
        beep(1047, 32);
        return;
      }
      beep(cue === 'open' ? 880 : 523, 25);
      return;
    }

    if (process.platform === 'darwin') {
      const child = spawn(
        'afplay',
        ['-v', '0.22', join('/System/Library/Sounds', MAC_CUES[cue])],
        { stdio: 'ignore' },
      );
      child.on('error', terminalBell);
      child.unref();
      return;
    }

    const child = spawn(
      'paplay',
      ['--volume=16000', join('/usr/share/sounds/freedesktop/stereo', LINUX_CUES[cue])],
      { stdio: 'ignore' },
    );
    child.on('error', terminalBell);
    child.unref();
  } catch {
    terminalBell();
  }
}
