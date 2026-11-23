#!/usr/bin/env node
// Despachante de entrada: a nova TUI (Solid/OpenTUI) é o padrão;
// VAKTOR_UI=ink volta para a UI legada (Ink/React) durante a migração.
// O import é não-literal de propósito: evita que o tsconfig legado
// (jsx react) enxergue e tente compilar src/tui.
const entry: string = process.env.VAKTOR_UI === 'ink' ? './ink-entry.js' : './tui/entry.js';
await import(entry);
