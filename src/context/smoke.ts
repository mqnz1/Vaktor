// Smoke do contexto de projeto.
// Executar: npx tsx src/context/smoke.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRepoMap,
  invalidateRepoMap,
  renderRepoMap,
  selectContext,
} from './index.js';
import { RUNTIME_MARKER, buildRuntimeBlock, withRuntimeContext } from './runtime.js';
import {
  splitContextWindow,
  trimMessagesToBudget,
} from './budget.js';
import type { ChatMessage } from '../types/index.js';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FALHOU ${label}`);
  }
}

const root = mkdtempSync(join(tmpdir(), 'vaktor-context-'));

try {
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"demo"}\n', 'utf8');
  writeFileSync(join(root, '.env'), 'SECRET=1\n', 'utf8');
  writeFileSync(join(root, 'src', 'a.ts'), [
    'export function Foo() { return 1; }',
    'export const bar = 2;',
    'export interface Baz { x: number }',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'src', 'b.tsx'), 'export default function App() { return null; }\n', 'utf8');
  writeFileSync(join(root, 'node_modules', 'ignored.ts'), 'export const nope = 1;\n', 'utf8');

  invalidateRepoMap();
  const files = buildRepoMap(root);
  const paths = files.map(file => file.path);

  check('inclui src/a.ts', paths.includes('src/a.ts'));
  check('inclui src/b.tsx', paths.includes('src/b.tsx'));
  check('ignora node_modules', !paths.some(path => path.startsWith('node_modules/')));
  check('ignora .env', !paths.includes('.env'));

  const a = files.find(file => file.path === 'src/a.ts');
  check('extrai exports', Boolean(a && a.exports.includes('Foo') && a.exports.includes('bar') && a.exports.includes('Baz')));

  const rendered = renderRepoMap(files, 80);
  check('render respeita maxChars', rendered.length <= 90);
  check('render contém caminho', rendered.includes('src/a.ts'));

  const selected = selectContext('preciso mexer no Foo', files, 200);
  check('selectContext prioriza a.ts', selected.includes('src/a.ts'));

  const cached = buildRepoMap(root);
  check('cache devolve cópia', cached !== files && cached.length === files.length);

  // ── Bloco de runtime (data/hora no system prompt) ──────────────────────
  const fixed = new Date(2026, 9, 27, 23, 9, 0);
  const block = buildRuntimeBlock(fixed);
  check('runtime começa com o marcador', block.startsWith(RUNTIME_MARKER));
  check('runtime traz o ano atual', block.includes('2026'));
  check('runtime traz o dia do mês', block.includes('27'));
  check('runtime traz o fuso', /UTC[+-]\d{2}:\d{2}/.test(block));
  check('runtime manda não negar acesso à data', block.includes('Nunca diga que não tem acesso'));

  const customWorkdir = 'C:\\Projetos\\resume-ai';
  check(
    'runtime usa o workdir informado',
    buildRuntimeBlock(fixed, customWorkdir).includes(customWorkdir),
  );

  const history: Array<{ role: string; content: string; timestamp: number }> = [
    { role: 'user', content: 'que dia é hoje?', timestamp: fixed.getTime() },
  ];
  const withRuntime = withRuntimeContext(history, fixed, customWorkdir);
  check('runtime entra como system', withRuntime[0]?.role === 'system');
  check('runtime repassa o workdir ao bloco', withRuntime[0]?.content.includes(customWorkdir) === true);
  check('runtime não mexe no histórico original', history.length === 1);
  check('runtime preserva a mensagem do usuário', withRuntime[1]?.content === 'que dia é hoje?');

  const twice = withRuntimeContext(withRuntime, fixed);
  check(
    'runtime não duplica o próprio bloco',
    twice.filter(message => message.content.startsWith(RUNTIME_MARKER)).length === 1,
  );

  // ── Orçamento 40/60 do chat ────────────────────────────────────────────
  const budgetMessages: ChatMessage[] = [
    { role: 'system', content: 'regras do projeto', timestamp: 1 },
    { role: 'user', content: 'a'.repeat(1200), timestamp: 2 },
    { role: 'assistant', content: 'b'.repeat(1200), timestamp: 3 },
    { role: 'user', content: 'c'.repeat(1200), timestamp: 4 },
    { role: 'assistant', content: 'd'.repeat(1200), timestamp: 5 },
  ];
  const split = splitContextWindow(budgetMessages, 1000);
  check('orçamento reserva 40% para a sessão', split.sessionBudgetTokens === 400);
  check('orçamento reserva 60% para a execução ativa', split.activeBudgetTokens === 600);
  check('execução ativa fica no fim da conversa', split.active.length === 2);
  check('sessão antiga excede o próprio limite', split.sessionTokens > split.sessionBudgetTokens);

  const trimmed = trimMessagesToBudget(budgetMessages.slice(1), 600);
  check('trim mantém as mensagens mais recentes', trimmed.length === 2
    && trimmed[1]?.content === 'd'.repeat(1200));

  const huge = trimMessagesToBudget([
    { role: 'user', content: 'x'.repeat(4000), timestamp: 1 },
  ], 100);
  check('mensagem única gigante é truncada', huge[0]?.content.includes('[...] (truncado)') === true);
  check('mensagem truncada não fica vazia', (huge[0]?.content.length ?? 0) > 200);
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log('\nContext smoke OK.');
}
