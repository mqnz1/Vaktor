# Integração do cliente MCP no Vektor

Os 8 arquivos de `src/mcp/` estão prontos, compilam em `strict` (+ `noUncheckedIndexedAccess`, `noUnusedLocals`)
e passam em 40 testes offline. Não alterei o restante do Vektor (não tenho o código), então estes são os pontos de ligação.

```
src/mcp/  types · transport (stdio) · http · client · security · bridge · config · smoke
```

## 1. Tipos do host (único ajuste "de encaixe")
`types.ts` define `ToolResult`, `ToolSpec` e `McpToolContext` de forma **estrutural**. Se o `ToolContext`/`ToolSpec`
reais tiverem campos equivalentes, nada muda; senão, troque esses aliases pelos imports reais. O que o MCP lê do contexto:

| Campo | Uso |
|---|---|
| `mcpClient` | instância única de `McpClient` |
| `confirmAction(title, detail)` | **adaptar para o `requireConfirm` de `src/tools/fs.ts`** (precisa perguntar SEMPRE, ignorando `autoApprove`) |
| `commandTimeoutMs`, `workdir` | timeout por chamada e relativização de paths |
| `onMcpProgress` | opcional, para a barra de progresso |

## 2. `src/tools/index.ts`
```ts
import { mcpCallTool } from '../mcp/bridge.js';
export const TOOLS: readonly ToolSpec[] = [/* 13 existentes */, mcpCallTool];
```

## 3. Config (`src/types/index.ts` + `src/config/env.ts`)
```ts
import { parseMcpEnabled, parseMcpServers } from '../mcp/config.js';
const parsed = parseMcpServers(process.env.MCP_SERVERS);          // parsed.errors → mostrar na UI
agent: { ..., mcpEnabled: parseMcpEnabled(process.env.MCP_ENABLED), mcpServers: parsed.servers }
```
Token de servidor http: `MCP_<NOME>_TOKEN=...` no `.env` vira `Authorization: Bearer` (não precisa ir em `MCP_SERVERS`).

## 4. `src/agent/loop.ts` (um cliente por sessão)
```ts
import { McpClient } from '../mcp/client.js';
const mcpClient = options.mcpEnabled ? new McpClient({
  roots: [workdir],
  onLog: (e) => notify(`[mcp:${e.server}] ${String(e.data)}`),
}) : undefined;
options.mcpServers.forEach((s) => mcpClient?.addServer(s));
// toolContext: { ..., mcpClient, confirmAction: (t, d) => requireConfirm(t, d, { force: true }) }
// ao sair: await mcpClient?.closeAllAsync();
```
Sampling é opt-in: só passe `onSampling: (server, req) => ...router.complete(...)` se quiser que servidores peçam
completions ao modelo (peça confirmação na UI dentro dele).

## 5. UI (`src/ui/App.tsx`)
```ts
import { runMcpCommand } from '../mcp/bridge.js';
// /mcp, /mcp connect <nome>, /mcp disconnect <nome>, /mcp tools [nome]
if (cmd === 'mcp') show(await runMcpCommand(mcpClient, args));
```

## 6. Contexto no `router.send()` (passo 6 do guia)
```ts
import { buildMcpContext, renderMcpPrompt } from '../mcp/bridge.js';
const mcpCtx = mcpClient ? await buildMcpContext(mcpClient, { workdir }) : '';   // catálogo de tools (descoberta automática)
// recursos: buildMcpContext(client, { includeResources: true, resourceFilter: (s, r) => ... })
// prompt escolhido pelo usuário: await renderMcpPrompt(client, 'servidor', 'prompt', { arg: 'valor' })
```
Tudo sai embrulhado em `## MCP ... (dado não confiável)`.

## 7. `package.json`
```json
"smoke:mcp": "<seu runner> src/mcp/smoke.ts"
```
(tsx/ts-node, ou `tsc` + `node dist/mcp/smoke.js`). Encadeie em `npm run smoke`. Mais `.env`, `vaktor.cmd` e `README.md` com `MCP_ENABLED` / `MCP_SERVERS`.

## Onde me afastei do guia (de propósito)
- `getPrompt(server, prompt, args?)`: o guia lista só `(name, args?)`, que não identifica o prompt.
- `readOnlyHint` do servidor é **ignorado** (um servidor malicioso poderia usá-lo para pular a confirmação); `destructiveHint` só aperta a regra.
- O processo stdio **não herda** o ambiente do Vektor (chaves de API não vazam); só PATH/HOME/proxies etc. + `env` da config.
- HTTP: além de https-only e `isPrivateHost`, o DNS é resolvido e bloqueado se qualquer IP for privado; redirects nunca são seguidos.
- Extras: `config.ts` (parser), `/mcp` pronto (`runMcpCommand`), neutralização de `<tool_call>` e de caracteres invisíveis em dados de servidor.

## Limites conhecidos
- Testado só offline (servidor mock stdio real + fetch simulado); **não** contra `server-filesystem`/GitHub reais (sandbox sem rede).
- No Windows, `npx/npm/pnpm/yarn` vão por `cmd.exe /d /s /c` com argumentos validados; essa lógica tem teste unitário, mas não rodei em Windows real.
- HTTP implementa "Streamable HTTP" (POST com JSON ou SSE). Não há o stream GET opcional nem o transporte legado HTTP+SSE de 2024-11-05.
- A lista de nomes "destrutivos" é heurística e pende para pedir confirmação (ex.: `create`, `post`, `run`, `sql`); ajuste `DESTRUCTIVE_STEMS/WORDS` em `security.ts`.
