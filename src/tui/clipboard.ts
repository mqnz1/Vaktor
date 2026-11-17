// Acesso ao clipboard do sistema para a TUI. O OpenTUI já cobre o OSC52
// (quando o terminal suporta); aqui ficam os fallbacks nativos usados por
// Ctrl+C e Ctrl+V.
import { spawn } from 'node:child_process';

const READ_TIMEOUT_MS = 2000;

function writeCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') return { command: 'clip.exe', args: [] };
  if (process.platform === 'darwin') return { command: 'pbcopy', args: [] };
  return { command: 'xclip', args: ['-selection', 'clipboard'] };
}

function readCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[Console]::OutputEncoding; Get-Clipboard -Raw',
      ],
    };
  }
  if (process.platform === 'darwin') return { command: 'pbpaste', args: [] };
  return { command: 'xclip', args: ['-selection', 'clipboard', '-o'] };
}

export function writeHostClipboard(text: string): boolean {
  try {
    const { command, args } = writeCommand();
    const child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    child.on('error', () => undefined);
    child.stdin?.end(text);
    return true;
  } catch {
    return false;
  }
}

export function readHostClipboard(): Promise<string> {
  return new Promise(resolve => {
    const { command, args } = readCommand();
    let output = '';
    let settled = false;

    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      resolve('');
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish('');
    }, READ_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', chunk => {
      output += chunk;
    });
    child.on('error', () => finish(''));
    child.on('close', () => finish(output));
  });
}
