// =============================================================
// Entrada da nova TUI (Solid/OpenTUI). Espelha o bootstrap do
// src/index.tsx legado: config → router → render em alt-screen.
// =============================================================
import { render } from '@opentui/solid';
import { loadConfig } from '../config/env.js';
import { AIRouter } from '../router/index.js';
import { App } from './app.js';
import { RouterController } from './controller.js';
import { initGlobalSession, closeGlobalSession } from '../database/session.js';
import { syncCustomProviderRegistry } from '../providers/custom.js';

export async function main(): Promise<void> {
  // Inicializa a sessǜo global e o banco de dados
  const session = await initGlobalSession();
  syncCustomProviderRegistry();

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    closeGlobalSession();
    process.exit(1);
  }

  const router = new AIRouter(config.router);
  try {
    await router.init(config.puterApiKey);
  } catch (err) {
    process.stderr.write(
      `Error initializing: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    closeGlobalSession();
    process.exit(1);
  }

  const controller = new RouterController(router);

  // Atualiza a sessão com informações do roteador
  session.update({
    defaultModel: config.router.defaultModel,
    budgetUsd: config.router.budgetUsd,
    agentEnabled: config.router.agent.enabled,
    thinkingEnabled: config.router.thinking.enabled,
  });

  await render(
    () => <App controller={controller} onExit={() => {
      closeGlobalSession();
      process.exit(0);
    }} />,
    {
      screenMode: 'alternate-screen',
      exitOnCtrlC: false,
      clearOnShutdown: true,
    },
  );
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  closeGlobalSession();
  process.exit(1);
});
