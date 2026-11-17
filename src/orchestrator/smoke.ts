// =============================================================
// Smoke do orquestrador: defaults, payload, store e motor dinâmico.
// =============================================================
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ASSIGNMENTS,
  ORCHESTRATOR_ROLES,
  buildOrchestrationPayload,
  createVaktorApi,
  ensureVaktorWorkspace,
  normalizeOrchestrationPayload,
  OrchestratorStore,
  readVaktorAgentPrompt,
  roleDefinition,
  runOrchestration,
  vaktorWorkspaceExists,
  type OrchestrationPayload,
  type OrchestrationPlan,
  type OrchestrationTaskResult,
  type OrchestratorCompleteFn,
} from './index.js';
import type { ChatMessage } from '../types/index.js';

let failures = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) failures++;
}

const PLAN_JSON = JSON.stringify({
  summary: 'Implementar a feature em duas frentes e revisar.',
  tasks: [
    {
      id: 't1',
      role: 'scout',
      title: 'Mapear projeto',
      instructions: 'Leia os arquivos relevantes.',
      files: [],
      dependsOn: [],
    },
    {
      id: 't2',
      role: 'builder_backend',
      title: 'Implementar back-end',
      instructions: 'Implemente a feature.',
      files: ['src/backend.ts'],
      dependsOn: ['t1'],
    },
    {
      id: 't3',
      role: 'fixer',
      title: 'Revisar',
      instructions: 'Revise e corrija.',
      files: [],
      dependsOn: ['t2'],
    },
  ],
  verification: ['npm run typecheck'],
});

function fakeComplete(failModels: readonly string[] = []): OrchestratorCompleteFn {
  return async (messages: ChatMessage[], options) => {
    const model = options?.model ?? 'unknown';
    if (failModels.some(item => model.includes(item))) {
      throw new Error(`falha simulada em ${model}`);
    }
    const system = messages.find(message => message.role === 'system')?.content ?? '';
    const text = system.includes('revisando o resultado final')
      ? `revisão final de ${model}: verificação ok`
      : system.includes('Task Graph')
        ? PLAN_JSON
        : `resposta de ${model} :: ${system.split('\n')[0] ?? ''}`;
    return {
      text,
      model,
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: 0,
      agent: {
        ok: true,
        iterations: 1,
        toolCalls: 0,
        modifiedFiles: [],
        commands: [],
        tools: [],
        verify: { ran: false, ok: true, attempts: 0 },
      },
    };
  };
}

async function main(): Promise<void> {
  check('5 papéis definidos', ORCHESTRATOR_ROLES.length === 5);
  check('planner é o líder', roleDefinition('planner').kind === 'leader');
  check('defaults cobrem todos os papéis', ORCHESTRATOR_ROLES.every(role => DEFAULT_ASSIGNMENTS[role.id].length > 0));
  check('defaults não usam provedores quebrados',
    !Object.values(DEFAULT_ASSIGNMENTS).some(model =>
      /^(echo|requesty|agentrouter)::/.test(model)));

  const payload = buildOrchestrationPayload(DEFAULT_ASSIGNMENTS, 'implementar feature');
  check('payload usa comando orchestrate', payload.command === 'orchestrate');
  check('líder é planner com provider explícito', payload.orchestration.leader.role === 'planner'
    && payload.orchestration.leader.provider.length > 0);
  check('líder aponta modelo ativo',
    payload.orchestration.leader.model === 'nvidia/nemotron-3-ultra-550b-a55b');
  check('4 workers no payload', payload.orchestration.workers.length === 4);
  check('workers têm provider explícito',
    payload.orchestration.workers.every(worker => worker.provider.length > 0));
  check('papéis dos workers corretos', payload.orchestration.workers.map(w => w.role).join(',')
    === 'scout,builder_backend,builder_frontend,fixer');

  const normalized = normalizeOrchestrationPayload(
    { command: 'orchestrate', taskPrompt: 'tarefa X', orchestration: { workers: [{ role: 'fixer', model: 'echo::x' }] } },
    DEFAULT_ASSIGNMENTS,
  );
  check('payload parcial é normalizado', normalized.orchestration.workers.length === 4
    && normalized.orchestration.workers.find(w => w.role === 'fixer')?.model === 'x'
    && normalized.orchestration.workers.find(w => w.role === 'fixer')?.provider === 'echo-free');

  const workspaceRoot = mkdtempSync(join(tmpdir(), 'vaktor-workspace-'));
  check('workspace não existe antes do orquestrador', !vaktorWorkspaceExists(workspaceRoot));
  const workspace = ensureVaktorWorkspace(workspaceRoot);
  check('ensure cria VAKTOR.md', existsSync(workspace.instructions));
  check('ensure cria agentes do orquestrador',
    existsSync(workspace.leaderAgentFile) && existsSync(workspace.workerAgentFile));
  check('ensure cria settings.json válido', (() => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(workspace.settingsFile, 'utf8'));
      return Boolean(parsed && typeof parsed === 'object');
    } catch {
      return false;
    }
  })());
  check('ensure cria skills e memoria',
    existsSync(workspace.skillsDir)
    && existsSync(workspace.sessionsDir)
    && existsSync(workspace.runsDir)
    && existsSync(workspace.lessonsDir));
  check('ensure lê o prompt do líder', readVaktorAgentPrompt(workspaceRoot, 'leader').includes('Orquestrador'));
  writeFileSync(workspace.instructions, '# VAKTOR customizado\n', 'utf8');
  writeFileSync(workspace.settingsFile, '{"custom":true}\n', 'utf8');
  ensureVaktorWorkspace(workspaceRoot);
  check('ensure preserva customizações',
    readFileSync(workspace.instructions, 'utf8').includes('customizado')
    && readFileSync(workspace.settingsFile, 'utf8').includes('"custom":true'));

  const storeFile = join(mkdtempSync(join(tmpdir(), 'vaktor-orch-')), 'orchestrator.json');
  const store = new OrchestratorStore(storeFile);
  store.set('scout', 'opencode::deepseek-v4.1-flash');
  const reloaded = new OrchestratorStore(storeFile);
  check('store persiste seleção por papel', reloaded.get('scout') === 'opencode::deepseek-v4.1-flash');
  check('store usa defaults para os demais', reloaded.get('planner') === DEFAULT_ASSIGNMENTS.planner);
  store.set('builder_backend', 'deepseek-v4.1-flash');
  const qualified = new OrchestratorStore(storeFile);
  check('store qualifica modelo sem provider',
    qualified.get('builder_backend') === 'opencode::deepseek-v4.1-flash');
  let rejected = false;
  try {
    store.set('fixer', 'echo::modelo-x');
  } catch {
    rejected = true;
  }
  check('store rejeita provedor indisponível', rejected);

  const events: string[] = [];
  const runRoot = mkdtempSync(join(tmpdir(), 'vaktor-orch-run-'));
  const result = await runOrchestration(payload, {
    complete: fakeComplete(['nemotron-3-ultra-550b-a55b']),
    workdir: runRoot,
    onEvent: event => events.push(`${event.type}:${event.role ?? '-'}`),
  });
  check('fallback do líder conclui a orquestração', result.ok === true);
  check('final é a revisão do líder', result.finalText.includes('revisão final'));
  check('emite plano', events.some(item => item.startsWith('plan:planner')));
  check('emite erro do modelo que falhou', events.some(item => item.startsWith('error:planner')));
  check('emite done', events.some(item => item.startsWith('done:')));
  check('task graph dinâmico executado', result.tasks?.length === 3);
  check('motor inicializa .vaktor/memoria',
    existsSync(join(runRoot, '.vaktor', 'memoria', 'sessions'))
    && existsSync(join(runRoot, '.vaktor', 'memoria', 'runs')));
  check('motor grava snapshot em .vaktor',
    Boolean(result.runId)
    && existsSync(join(runRoot, '.vaktor', 'memoria', 'sessions', `session-${result.runId}.md`)));

  const api = createVaktorApi({ complete: fakeComplete(), workdir: mkdtempSync(join(tmpdir(), 'vaktor-orch-api-')), endpoint: null });
  const local = await api.startOrchestration(payload);
  check('api sem endpoint roda local', local.ok === true && local.finalText.length > 0);

  const streamPlan: OrchestrationPlan = {
    summary: 'Plano remoto',
    tasks: [
      { id: 't1', role: 'scout', title: 'Mapear', instructions: 'Leia.', files: [], dependsOn: [] },
      { id: 't2', role: 'builder_backend', title: 'Implementar', instructions: 'Edite.', files: [], dependsOn: ['t1'] },
    ],
    verification: ['npm run typecheck'],
  };
  const streamTask: OrchestrationTaskResult = {
    id: 't1',
    role: 'scout',
    title: 'Mapear',
    status: 'done',
    ok: true,
    model: 'opencode::deepseek-v4.1-flash',
    text: 'mapeado',
    modifiedFiles: ['src/a.ts'],
    commands: [],
    durationMs: 12,
  };
  const streamLines = [
    { type: 'plan', message: 'plano', timestamp: 1, plan: streamPlan },
    { type: 'task_start', message: 't1', timestamp: 2, role: 'scout', taskId: 't1', taskTitle: 'Mapear' },
    { type: 'task_done', message: 't1 ok', timestamp: 3, role: 'scout', taskId: 't1', taskTitle: 'Mapear', task: streamTask },
    {
      type: 'result',
      message: 'ok',
      timestamp: 4,
      finalText: 'resultado remoto',
      model: 'opencode::deepseek-v4.1-flash',
      runId: 'run-remoto',
      plan: streamPlan,
      tasks: [streamTask],
      usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01 },
    },
  ].map(line => JSON.stringify(line)).join('\n') + '\n';
  const streamEvents: string[] = [];
  const streamApi = createVaktorApi({
    complete: fakeComplete(),
    workdir: mkdtempSync(join(tmpdir(), 'vaktor-orch-stream-')),
    endpoint: 'https://example.com/orchestrate',
    fetchImpl: async () => new Response(streamLines, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    }),
  });
  const streamed = await streamApi.startOrchestration(payload, {
    onEvent: event => streamEvents.push(`${event.type}:${event.taskId ?? event.role ?? '-'}`),
  });
  check('stream remoto despacha task_start/task_done',
    streamEvents.includes('task_start:t1') && streamEvents.includes('task_done:t1'));
  check('stream remoto devolve plano estruturado', streamed.plan?.tasks.length === 2);
  check('stream remoto devolve subtarefas', streamed.tasks?.length === 1
    && streamed.tasks[0]?.modifiedFiles[0] === 'src/a.ts');
  check('stream remoto devolve runId e custo', streamed.runId === 'run-remoto'
    && streamed.usage?.estimatedCostUsd === 0.01);

  const malformedLines = [
    {
      type: 'plan',
      message: 'plano ruim',
      timestamp: 1,
      plan: { summary: 42, tasks: [{ id: 7 }], verification: 'x' },
    },
    {
      type: 'task_done',
      message: 'tarefa ruim',
      timestamp: 2,
      task: { id: 7, role: 'hacker', modifiedFiles: 'x' },
    },
    {
      type: 'result',
      message: 'ok',
      timestamp: 3,
      finalText: 'parcial',
      runId: 123,
      tasks: [{
        id: 't2',
        role: 'fixer',
        title: 'Ajustar',
        ok: true,
        modifiedFiles: ['src/b.ts'],
        commands: [],
        text: 'ajustado',
        durationMs: 'rápido',
      }],
      usage: { inputTokens: '10' },
    },
  ].map(line => JSON.stringify(line)).join('\n') + '\n';
  const malformedApi = createVaktorApi({
    complete: fakeComplete(),
    workdir: mkdtempSync(join(tmpdir(), 'vaktor-orch-malformed-')),
    endpoint: 'https://example.com/orchestrate',
    fetchImpl: async () => new Response(malformedLines, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    }),
  });
  const malformed = await malformedApi.startOrchestration(payload);
  check('stream remoto ignora plano/tarefa inválidos', malformed.plan === undefined
    && malformed.tasks?.[0]?.id === 't2'
    && malformed.tasks[0]?.durationMs === 0
    && malformed.usage === undefined);

  const invalid = payload as unknown as OrchestrationPayload;
  check('payload inválido não derruba o helper', (() => {
    try {
      normalizeOrchestrationPayload(null, DEFAULT_ASSIGNMENTS);
      return false;
    } catch {
      return true;
    }
  })() && invalid.command === 'orchestrate');

  console.log(failures === 0 ? 'Orchestrator smoke OK.' : `Orchestrator smoke FALHOU (${failures}).`);
  if (failures > 0) process.exitCode = 1;
}

await main();
