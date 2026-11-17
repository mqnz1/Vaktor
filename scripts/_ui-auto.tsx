import React from 'react';
import { EventEmitter } from 'node:events';
import { Box, render } from 'ink';
import { MessageList } from '../src/ui/components/MessageList.js';
import { Header } from '../src/ui/components/Header.js';
import { Footer } from '../src/ui/components/Footer.js';
import { InputBar } from '../src/ui/components/InputBar.js';
import { messageAreaLines, SAFETY_LINES } from '../src/ui/layout.js';

class S extends EventEmitter { constructor(c, r) { super(); this.columns = c; this.rows = r; this.isTTY = true; this.frames = []; } write(x) { this.frames.push(x); return true; } }
class I extends EventEmitter { constructor() { super(); this.isTTY = true; this.setRawMode = () => {}; this.setEncoding = () => {}; this.resume = () => {}; this.pause = () => {}; this.ref = () => {}; this.unref = () => {}; this.read = () => null; } }

const state = { activeModel: 'claude-sonnet-5', isAutoMode: true, isFallbackActive: false, appMode: 'chat',
  credits: { remainingUsd: 1, percentUsed: 0, totalUsd: 1, spentUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 },
  thinkingEnabled: false, thinkingMode: 'auto', thinkingShow: false, skillsEnabled: false, activeSkills: [], forcedSkillIds: [], workdir: process.cwd(), agentEnabled: false };

async function run(rows, cols, typed) {
  const out = new S(cols, rows);
  const stdin = new I();
  let extra = 0;
  const Comp = () => {
    const [e, setE] = React.useState(0);
    extra = e;
    return React.createElement(Box, { flexDirection: 'column', height: rows - SAFETY_LINES, width: cols },
      React.createElement(Header, { state, cols }),
      React.createElement(MessageList, { messages: [], isThinking: false, lastWasCached: false, thinkingShow: false, maxLines: Math.max(1, messageAreaLines(rows) - e), cols }),
      React.createElement(Footer, { state, agentTools: 0, verifyStatus: null, cols }),
      React.createElement(InputBar, { onSubmit() {}, onEscape() {}, onToggleThinking() {}, isThinking: false, overlayOpen: false, cols, rows, onExtraLines: setE, initialValue: typed }),
    );
  };
  const inst = render(React.createElement(Comp), { stdout: out, stdin, debug: true, patchConsole: false, exitOnCtrlC: false });
  await new Promise(r => setTimeout(r, 200));
  const last = out.frames[out.frames.length - 1] ?? '';
  const clean = last.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  const raw = clean.split('\n');
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const lines = raw;
  const limit = rows - SAFETY_LINES;
  console.log(`\n${cols}x${rows} ${JSON.stringify(typed)} extra=${extra} linhas=${lines.length}/${limit} ok=${lines.length <= limit}`);
  lines.slice(-Math.min(lines.length, extra + 5)).forEach(l => console.log('  ', JSON.stringify(l.slice(0, 66))));
  inst.unmount();
}

await run(24, 100, '');
await run(24, 100, '/');
await run(24, 100, '/mo');
await run(30, 120, '/');
await run(14, 60, '/');
await run(16, 70, '/');
process.exit(0);
