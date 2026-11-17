import { testRender } from '@opentui/solid';
import { App } from './app.js';
import type { TuiController, TuiModelEntry, TuiSendResult } from './controller.js';
import type { RouterState, ChatMessage } from '../types/index.js';

const state: RouterState = {
  activeModel: 'fake-1', isAutoMode: false, isFallbackActive: false, appMode: 'chat',
  credits: { totalCostUsd: 0, budgetUsd: 5, remainingUsd: 5, percentUsed: 0, totalInputTokens: 0, totalOutputTokens: 0, cacheHits: 0, savedByCache: 0, usageHistory: [] },
  thinkingEnabled: false, thinkingMode: 'off', thinkingShow: false, workdir: '.',
  activeSkills: [], skillsEnabled: false, forcedSkillIds: [], agentEnabled: false, securityEnabled: false,
};
let sent = 0;
const controller: TuiController = {
  getState: () => state,
  listModels: (): TuiModelEntry[] => [{ id: 'fake-1', name: 'F', provider: 'echo', providerLabel: 'E', costPer1kTokensInput: 0 }],
  setModel: () => undefined,
  setMode: () => undefined,
  setWorkdir: () => undefined,
  send: async (_h: ChatMessage[]): Promise<TuiSendResult> => { sent++; return { text: 'x', model: 'm', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, fromCache: false }; },
  setOnNotification: () => undefined,
  setOnModelSwitch: () => undefined,
};
const setup = await testRender(() => <App controller={controller} onExit={() => undefined} />, { width: 60, height: 10 });
try {
  await setup.renderOnce();
  await setup.mockInput.typeText('/mod');
  await setup.flush();
  setup.captureCharFrame().split('\n').forEach((r, i) => console.log(`r${i}:${JSON.stringify(r)}`));
  setup.mockInput.pressTab();
  await new Promise(r => setTimeout(r, 50));
  await setup.flush();
  console.log('--- apos tab ---');
  setup.captureCharFrame().split('\n').forEach((r, i) => console.log(`t${i}:${JSON.stringify(r)}`));
  console.log('sent:', sent);
} finally { await setup.dispose(); }
