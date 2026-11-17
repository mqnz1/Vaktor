// Smoke da memória de projeto.
// Executar: npx tsx src/memory/smoke.ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendMemory,
  hasMemory,
  loadProjectInstructions,
  loadProjectMemory,
  memoryPath,
  sanitizeMemoryText,
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

const root = mkdtempSync(join(tmpdir(), 'vaktor-memory-'));

try {
  check('não cria VAKTOR.md sozinho', !hasMemory(root));
  check('load vazio', loadProjectMemory(root) === '');

  const first = appendMemory(root, 'Decisões', 'Usar NodeNext e imports .js');
  check('append cria arquivo', first && existsSync(memoryPath(root)));
  check('load contém entrada', loadProjectMemory(root).includes('NodeNext'));
  check('instruções do projeto usam VAKTOR.md',
    loadProjectInstructions(root).includes('### VAKTOR.md')
    && loadProjectInstructions(root).includes('NodeNext'));

  const duplicate = appendMemory(root, 'Decisões', 'Usar NodeNext e imports .js');
  check('não duplica entrada idêntica', !duplicate);

  appendMemory(root, 'Preferências', 'Responder em português');
  const loaded = loadProjectMemory(root);
  check('mantém duas seções', loaded.includes('## Decisões') && loaded.includes('## Preferências'));

  const sanitized = sanitizeMemoryText('chave sk-1234567890 e C:\\Users\\elian\\segredo.txt');
  check('redige chave', !sanitized.includes('sk-1234567890') && sanitized.includes('[REDACTED]'));
  check('redige path absoluto', !sanitized.includes('C:\\Users'));

  writeFileSync(memoryPath(root), '# VAKTOR\n\n' + 'x'.repeat(5000), 'utf8');
  const truncated = loadProjectMemory(root, 300);
  check('trunca memória', truncated.length <= 300 && truncated.includes('truncada'));
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log('\nMemory smoke OK.');
}
