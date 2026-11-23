// Smoke do perfil persistente (JAILBREAK.md).
// Executar: npx tsx src/jailbreak/smoke.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JAILBREAK_MARKER,
  buildJailbreakBlock,
  jailbreakFileName,
  loadJailbreakProfile,
  resolveJailbreakFile,
} from './index.js';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FALHOU ${label}`);
  }
}

const root = mkdtempSync(join(tmpdir(), 'vaktor-jailbreak-'));

async function main(): Promise<void> {
  try {
    check('nome padrão é JAILBREAK.md', jailbreakFileName('') === 'JAILBREAK.md');
    check('nome é reduzido ao basename', jailbreakFileName('../../etc/passwd') === 'passwd');
    check(
      'arquivo ausente devolve vazio',
      loadJailbreakProfile(root, 4000, 'PROFILE-QUE-NAO-EXISTE.md') === '',
    );

    const path = join(root, 'JAILBREAK.md');
    const fakeSecret = ['sk', 'super', 'secreta', '12345678'].join('-');
    writeFileSync(
      path,
      `# Modo\nResponda direto.\nchave ${fakeSecret}\n`,
      'utf8',
    );

    const loaded = loadJailbreakProfile(root, 4000, 'JAILBREAK.md');
    check('lê o arquivo do workdir', loaded.includes('Responda direto.'));
    check('redige segredo', loaded.includes('[REDACTED]') && !loaded.includes(fakeSecret.slice(0, 14)));
    check('resolveJailbreakFile aponta para o workdir', resolveJailbreakFile(root, 'JAILBREAK.md') === path);

    const block = buildJailbreakBlock(loaded);
    check('bloco tem marcador', block.startsWith(JAILBREAK_MARKER));
    check('bloco contém o perfil', block.includes('Responda direto.'));
    check('bloco vazio para perfil vazio', buildJailbreakBlock('   ') === '');

    const short = loadJailbreakProfile(root, 20, 'JAILBREAK.md');
    check('trunca perfil longo', short.length <= 120 && short.includes('truncado'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} verificação(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nJailbreak smoke OK.');
  }
}

void main();
