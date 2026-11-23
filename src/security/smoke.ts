// Smoke do perfil de segurança (SECURITY.md).
// Executar: npx tsx src/security/smoke.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SECURITY_MARKER,
  buildSecurityBlock,
  loadSecurityProfile,
  resolveSecurityFile,
  securityFileName,
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

const root = mkdtempSync(join(tmpdir(), 'vaktor-security-'));

async function main(): Promise<void> {
  try {
    check('nome padrão é SECURITY.md', securityFileName('') === 'SECURITY.md');
    check('nome é reduzido ao basename', securityFileName('../../etc/passwd') === 'passwd');

    check(
      'arquivo ausente devolve vazio',
      loadSecurityProfile(root, 4000, 'PROFILE-QUE-NAO-EXISTE.md') === '',
    );

    const path = join(root, 'SECURITY.md');
    const fakeSecret = ['sk', 'super', 'secreta', '12345678'].join('-');
    writeFileSync(
      path,
      `# Perfil\nDetalhe técnico esperado.\nchave ${fakeSecret}\n`,
      'utf8',
    );

    const loaded = loadSecurityProfile(root, 4000, 'SECURITY.md');
    check('lê o arquivo do workdir', loaded.includes('Detalhe técnico esperado.'));
    check('redige segredo', loaded.includes('[REDACTED]') && !loaded.includes(fakeSecret.slice(0, 14)));
    check('resolveSecurityFile aponta para o workdir', resolveSecurityFile(root, 'SECURITY.md') === path);

    const block = buildSecurityBlock(loaded);
    check('bloco tem marcador', block.startsWith(SECURITY_MARKER));
    check('bloco contém o perfil', block.includes('Detalhe técnico esperado.'));
    check('bloco vazio para perfil vazio', buildSecurityBlock('   ') === '');

    const short = loadSecurityProfile(root, 20, 'SECURITY.md');
    check('trunca perfil longo', short.length <= 120 && short.includes('truncado'));

    // O default embarcado (SECURITY.md na raiz do projeto) é encontrado como fallback.
    const fallback = loadSecurityProfile(root, 4000, 'SECURITY.md');
    check('workdir tem prioridade', fallback.includes('Detalhe técnico esperado.'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} verificação(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nSecurity smoke OK.');
  }
}

void main();
