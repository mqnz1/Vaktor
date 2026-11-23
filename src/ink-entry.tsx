#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { loadConfig } from './config/env.js';
import { AIRouter } from './router/index.js';
import { App } from './ui/App.js';
import { initGlobalSession, closeGlobalSession } from './database/session.js';

async function main(): Promise<void> {
  // Inicializa a sessão global e o banco de dados
  const session = await initGlobalSession();

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
    process.stderr.write(`Error initializing: ${err instanceof Error ? err.message : String(err)}\n`);
    closeGlobalSession();
    process.exit(1);
  }

  // Atualiza a sessão com informações do roteador
  session.update({
    defaultModel: config.router.defaultModel,
    budgetUsd: config.router.budgetUsd,
    agentEnabled: config.router.agent.enabled,
    thinkingEnabled: config.router.thinking.enabled,
  });

  // Enter alternate screen buffer — prevents terminal from scrolling on re-render
  process.stdout.write('\x1b[?1049h');

  const { waitUntilExit } = render(
    React.createElement(App, { router, initialState: router.getState() }),
    {
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  try {
    await waitUntilExit();
  } finally {
    // Leave alternate screen buffer
    process.stdout.write('\x1b[?1049l');
    closeGlobalSession();
  }
}

// Ensure terminal is restored on any exit path
const restoreTerminal = (): void => {
  process.stdout.write('\x1b[?1049l');
  closeGlobalSession();
};
process.on('exit', restoreTerminal);
process.on('SIGINT', () => { restoreTerminal(); process.exit(0); });
process.on('SIGTERM', () => { restoreTerminal(); process.exit(0); });

main().catch(err => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  restoreTerminal();
  process.exit(1);
});
