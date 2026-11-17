# Vaktor

**Router de IA com interface de terminal moderna, gestão inteligente de créditos, multi-provedor e fallback automático para modelos 100% gratuitos.**

---

## ⭐ Destaque: ProxyGateLLM Free Fallback (SEM Servidor!)

Vaktor suporta **mais de 20 provedores** com fallback inteligente:

1. **Puter.com** - $0.30 orçamento
2. **AgentRouter** - $0.30 orçamento
3. **OpenRouter** - $0.30 orçamento
4. **Requesty** - 13 modelos gratuitos
5. **Kilo Code** - 17 modelos gratuitos
6. **FreeTheAI (FTA)** - modelos gratuitos
7. **ProxyGateLLM** - 🎉 **GRÁTIS ILIMITADO** (direto, sem servidor!)
   - GPT-4o via Pollinations
   - Llama 3.1 70B via DuckDuckGo
   - Mistral via Pollinations
   - DeepSeek R1 via Pollinations
   - Blackbox AI
   - Phind 70B (código)
   - E mais 5 modelos
8. **Google Gemini** - API nativa (`GEMINI_API_KEY`) com catálogo dinâmico da
   própria chave (modelos de chat Gemini/Gemma), streaming SSE e cancelamento;
   sem a chave, os IDs `gemini-2.5-*` rodam pelo Echo Free (desflexão automática
   no adapter de provedores)
9. **Notion AI** - API pública beta de agentes (`NOTION_API_KEY`) com catálogo
   dinâmico dos agentes acessíveis, `notion_ai` como fallback e polling de sessão
10. **Notion AI (Web)** - API interna `runInferenceTranscript` com o cookie
    `token_v2` da sessão do navegador, streaming NDJSON e 16 modelos
11. **Itera Compute** - API OpenAI-compatible com o Qwen3.8 27B free
    (`$0` input/output, 30M tokens/mês e 128K de contexto)
12. **Qoder** - API nativa com PAT trocada por job token e catálogo de
    15 modelos (Qwen3.8, Kimi, GLM, DeepSeek, MiniMax, Sonus/Cantus)
13. **APInex** - gateway OpenAI-compatible com carteira USD e 42 modelos
    (Claude, GPT, Gemini, Grok, Qwen, Kimi, GLM, DeepSeek e free/)
14. **DeepAI** - API nativa de texto (`DEEPAI_API_KEY`) e **DeepAI Code**
    com 18 modelos de chat (`DEEPAI_CODE_API_KEY`, 9 grátis/0 Theos)
15. **Numes** - marketplace OpenAI-compatible (`NUMES_API_KEY`) com catálogo
    dinâmico de modelos `autor/modelo`, preços por token e reasoning
16. **NightRouter** - gateway OpenAI-compatible (`NIGHTROUTER_API_KEY`) com
    Claude, GPT, Gemini, Kimi, GLM, Qwen e DeepSeek; catálogo via `/v1/models`
17. **Qronos AI** - gateway OpenAI-compatible (`QRONOS_API_KEY`) com apenas os
    modelos do free tier: Claude Haiku 5.5, GLM 5.3 Flash e Mercury 3 (`$0`)

Também: **Echo Free** (Anthropic · OpenAI · Gemini), **NVIDIA NIM**,
**OpenCode Zen**, **Token Harbor**, **Itera Compute**, **Qoder**, **APInex**
e **Qronos AI**.

**Sem API key necessária! Sem servidor para rodar!**

👉 [Guia de Setup ProxyGateLLM Direto](./PROXYGATELLM_DIRECT.md)

---

## Instalação (Windows)

Pré-requisito: apenas internet na primeira execução. **Não precisa instalar Node.js, npm nem TypeScript manualmente.**

1. Baixe ou clone a pasta do Vaktor.
2. Dê duplo clique em **`vaktor.cmd`** (ou rode `vaktor.cmd` no cmd).

Esse único arquivo faz tudo:

- usa o Node.js já instalado ou baixa uma versão portátil;
- instala as dependências (o npm vem junto com o Node);
- cria o `.env` modelo (e pede para você preencher as chaves);
- compila o TypeScript (instalado como dependência do projeto);
- registra o comando `vaktor` no `PATH` do usuário;
- abre a interface.

3. Na primeira vez, edite o `.env` e preencha suas chaves de API.
4. Abra um **novo** cmd e digite:

```bat
vaktor
```

A partir daí o comando funciona em qualquer pasta, e o Vaktor usa o diretório atual como `workdir`.
Nas execuções seguintes ele só recompila se algum arquivo de `src/` mudou.

Para desfazer o comando global: remova `C:\caminho\do\Vaktor` da variável `Path` do usuário.

### Linux / macOS

```bash
npm install
npm run build
npm link      # opcional: cria o comando global "vaktor"
vaktor
```

---

## Uso

```bash
# Desenvolvimento (sem build, lê direto do src)
npm run dev

# Produção
npm run build
npm start
```

---

## Interface

O cabeçalho traz o logo **V** em ASCII — braço esquerdo roxo, direito azul,
ponta em **ciano neon pulsante** (respiração de 2,6 s, ~14 fps) e sombra preta:

```
██      ██
 ▀█▄  ▄█▀   Vaktor
   ▀██▀     claude-sonnet-4-6 (Echo Free) · Auto · Code · Home
    ▄▄▄▄
```

O pulso usa **truecolor** (`#0891b2` → `#67e8f9`) com curva de cosseno — sem
saltos, sem mudança de largura, sem re-render do resto do header (o timer vive
isolado no componente da ponta). A animação é desligada automaticamente fora de
terminal interativo (pipe, CI, testes) e pode ser forçada off:

```bash
VAKTOR_NO_ANIMATION=1   # ou VAKTOR_ANIMATION=off
```

Em terminais sem suporte a truecolor, o Ink degrada para a cor mais próxima.

---

## Compartilhar o projeto

O `.env` contém **suas chaves de API**. Não compartilhe a pasta com o `.env` dentro.

Antes de compartilhar a pasta, **apague o `.env`** — ele contém suas chaves. Quem receber o projeto deve:

1. rodar `vaktor.cmd` uma vez (ele instala tudo);
2. preencher o próprio `.env` gerado pelo script;
3. digitar `vaktor` em um cmd novo.

Vaktor automaticamente faz fallback para modelos grátis quando orçamento dos pagos esgotar!

---

## Skills

Skills são instruções reutilizáveis que o Vaktor injeta automaticamente no system prompt, para que qualquer modelo (Claude, GPT, Gemini, DeepSeek, Llama, Mistral) responda melhor em código e no dia a dia. São texto puro, sem tool-calling nem sintaxe de provedor.

A cada mensagem, o Vaktor escolhe a skill `core` (sempre ativa) mais até 2 skills pelo conteúdo da mensagem e pelo modo atual (`chat` ou `code`). O bloco injetado nunca passa de `SKILLS_MAX_PROMPT_CHARS` (padrão 3200 caracteres, cerca de 800 tokens).

### Skills embutidas

| id | Modo | O que faz |
|---|---|---|
| `core` | chat, code | Persona do Vaktor e regras globais (sempre ativa) |
| `codegen` | code | Código pronto para colar, com tipos, erros tratados e exemplo |
| `debug` | code | Hipótese, evidência, causa raiz, correção mínima, como testar |
| `review` | code | Revisão por severidade, com linha e patch |
| `refactor` | code | Refatora preservando comportamento, com antes/depois |
| `tests` | code | Testes felizes, de borda e de erro no framework do projeto |
| `architecture` | code | Trade-offs, alternativas descartadas e decisão |
| `git` | code | Commits convencionais, conflitos, revisão de diff |
| `daily` | chat | Organização, planos, checklists e priorização |
| `writing` | chat | E-mails, documentos, resumos e explicações |

### Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `ENABLE_SKILLS` | `true` | Liga/desliga o sistema (desligado = comportamento original) |
| `SKILLS_MAX_PROMPT_CHARS` | `3200` | Orçamento de caracteres do bloco de skills |
| `SKILLS_MAX_PER_REQUEST` | `3` | Máximo de skills por chamada (inclui a `core`) |

### Criar uma skill nova

1. Crie `src/skills/builtin/minha-skill.ts` exportando um objeto `Skill` (veja `debug.ts` como modelo).
2. Use `triggers` em minúsculas e sem acento; cada trigger vale +3 pontos e cada `pattern` +4.
3. Escreva o `prompt` em texto puro (80 a 200 palavras): papel, método, formato de saída e erros a evitar.
4. Registre a skill no array `SKILLS` em `src/skills/index.ts`.
5. Rode `npx tsx src/skills/smoke.ts` para conferir a seleção e o orçamento.

---

## Thinking

O Vaktor tem um motor de raciocínio próprio, independente do provedor. Ele decide quando pensar, injeta a diretiva certa e separa o raciocínio da resposta final.

- **Trivial** (`oi`, `ok`) em `auto` → não pensa e não gasta tokens extras.
- **Normal/difícil** → `scratchpad`: o modelo raciocina em `<thinking>...</thinking>` e a resposta final chega sem as tags.
- **Modelo nativo** (o1/o3, DeepSeek R1, Claude 4+, Gemini 2.5) → usa o parâmetro do provedor, sem diretiva de "pense passo a passo".
- **Difícil + não nativo + `THINKING_MAX_PASSES=2`** → `two-pass`: primeiro o plano, depois a resposta.
- **Falha de parâmetro** (400/422) → repete uma vez em `scratchpad`, sem quebrar a resposta.

O raciocínio fica oculto por padrão. Use `/thinking show` para exibir (até 12 linhas, sem tags).

### Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `ENABLE_THINKING` | `false` | Liga o motor na inicialização |
| `THINKING_MODE` | `auto` | `off`, `auto` ou `always` |
| `THINKING_MIN_COMPLEXITY` | `normal` | Complexidade mínima para pensar em `auto` |
| `THINKING_BUDGET_TOKENS` | `8000` | Orçamento de raciocínio (clamp 1000–32000) |
| `THINKING_MAX_PASSES` | `1` | `1` ou `2` (dois passes só em tarefa difícil não nativa) |
| `THINKING_SHOW` | `false` | Exibe o raciocínio por padrão |

### Cache

A chave do cache inclui a estratégia de thinking. Ligar o thinking **não** devolve uma resposta antiga gerada sem ele.

---

## Comandos

| Comando     | Descrição                                                        |
|-------------|------------------------------------------------------------------|
| `/mode [chat\|code]` | Alterna ou define o modo; sem argumento alterna chat ↔ código |
| `/modelos`  | Abre menu de seleção de modelo com preços e metadados            |
| `/models` SHIFT/TAB | Alterna para a tela de provedores; Enter filtra os modelos de um provedor |
| `/orquestrator [tarefa]` | Abre o orquestrador (planner + 4 workers); escolha o modelo de cada papel e inicie |
| `/new`      | Cria uma nova sessão com o histórico da conversa limpo           |
| `/credits`  | Exibe painel detalhado de consumo de créditos e cache            |
| `/skills`   | Lista as skills e mostra quais estão ativas                      |
| `/skill <id>` | Força a skill na próxima mensagem                              |
| `/skill off` | Limpa as skills forçadas                                        |
| `/skills on` / `/skills off` | Liga ou desliga o sistema em runtime            |
| `/thinking` | Mostra o estado atual do thinking                               |
| `/thinking on` / `off` / `auto` | Define o modo (`on` = always)                   |
| `/thinking show` / `hide` | Exibe ou oculta o raciocínio                      |
| `/thinking budget N` | Ajusta o orçamento (1000–32000)                        |
| `/agente` / `/agent` | Mostra o estado do agente (`on/off`, max iterations, tools)        |
| `/agent on` / `off`  | Liga ou desliga o agente de código                               |
| `/agent max N`       | Ajusta o máximo de iterações do agente (1–20)                    |
| `/verify`   | Roda a verificação do projeto (typecheck → test → build)        |
| `/context`  | Mostra o repo map usado como contexto do agente                 |
| `/memory`   | Mostra a memória do projeto (`VAKTOR.md`)                       |
| `/memory add <texto>` | Acrescenta uma entrada na memória (só cria o arquivo aqui) |
| `/security` | Mostra o perfil de segurança (`SECURITY.md`) e o estado |
| `/security on` / `off` | Liga/desliga o perfil de segurança em runtime         |
| `/mcp`       | Estado dos servidores MCP (`●` conectado, `✗` erro, `○` parado) |
| `/mcp connect <nome>` | Conecta a um servidor MCP                        |
| `/mcp disconnect <nome>` | Desconecta de um servidor MCP                  |
| `/mcp tools [nome]` | Lista as ferramentas descobertas (marca `⚠` destrutivas) |
| `/tools`    | Lista as ferramentas do agente e o estado das capacidades (write/rede/install/git) |
| `/limpar`   | Limpa o histórico da conversa atual                              |
| `/sair`     | Encerra a aplicação                                              |

A TUI toca cues curtos ao abrir/fechar menus, ao criar uma sessão e quando a IA
termina de responder. Defina `VAKTOR_SOUND=off` para silenciar (ou
`VAKTOR_SOUND=on` para forçar em terminais sem TTY detectado).

### Orquestrador de agentes (`/orquestrator`)

`/orquestrator <tarefa>` abre o menu com cinco papéis: **Planner (líder)**,
**Scout**, **Builder 1 (back-end)**, **Builder 2 (front-end)** e **Fixer**.
Selecionar um papel abre `/models` para escolher o modelo daquele papel; a
escolha é persistida em `~/.vaktor/orchestrator.json` (ou
`VAKTOR_ORCHESTRATOR_FILE`). `🚀 Iniciar Orquestração da Tarefa` monta o payload
`{ command: "orchestrate", orchestration, taskPrompt }` e executa o líder e os
workers em sequência, com fallback por papel e relatórios de status em tempo
real. Por padrão roda localmente; defina `VAKTOR_API_URL` (ou
`VAKTOR_ORCHESTRATOR_URL`) para enviar ao endpoint `/orchestrate`, com queda
automática para o motor local se a API não responder.

---

## Modos

- **chat** — Modo conversa padrão. IA responde perguntas, discute ideias. Usa `router.send()`, com skills, thinking e cache.
- **code** — Modo desenvolvimento. Prompt do input muda para `code ›`. Quando o agente está ligado (`/agent on`), o Vaktor executa o loop de agente com ferramentas; quando desligado, se comporta como o chat.

---

## Agente de Código

No modo `code` com o agente ligado, o Vaktor deixa de ser um consultor de uma
resposta só e passa a **agir no seu projeto**: lê arquivos, busca código, edita
com confirmação, roda a verificação e itera até resolver.

Liga/desliga em runtime com `/agent on` e `/agent off`. Por padrão,
`ENABLE_AGENT=true`.

### Ferramentas

O modelo **nunca escolhe o binário**: ele escolhe apenas um `label` da allowlist
de comandos. As 14 ferramentas são:

| Ferramenta    | O que faz                                                             |
|---------------|-----------------------------------------------------------------------|
| `list_dir`    | Lista arquivos/diretórios (`node_modules`, `.git`, `dist` etc. ocultos) |
| `read_file`   | Lê arquivo de texto com numeração de linhas                          |
| `write_file`  | Cria/sobrescreve arquivo (requer leitura prévia + confirmação)        |
| `apply_patch` | Substitui um trecho único de um arquivo (requer confirmação)          |
| `search`      | Busca texto ou regex nos arquivos do projeto                         |
| `run_command` | Executa um comando da allowlist (npm/npx/git)                        |
| `git_status`  | Estado do git                                                         |
| `git_diff`    | Diff do projeto (opcionalmente de um path)                           |
| `web_fetch`   | Baixa uma URL https e devolve o texto (conteúdo não confiável)        |
| `web_search`  | Busca na web (DuckDuckGo) e devolve resultados e links               |
| `npm_install` | Instala pacotes npm (irreversível; sempre confirmado)                |
| `git_commit`  | Faz `git add` + `git commit` (irreversível; sempre confirmado)        |
| `create_pr`   | Faz push do branch e abre um Pull Request com `gh` (sempre confirmado) |
| `mcp_call`    | Chama ferramentas de servidores MCP externos (destrutivas confirmam)   |

A allowlist padrão cobre `typecheck`, `test`, `build`, `tsc`, `lint`,
`git-status`, `git-diff` e `git-log`. Personalize com
`TOOLS_ALLOWED_COMMANDS` no formato `label=bin arg1 arg2;label2=...`.

### Autonomia com confirmação

As ferramentas de rede, instalação e git vêm **desligadas por padrão** e só
funcionam com as flags ligadas no `.env`:

| Flag                     | Padrão  | Habilita                                        |
|--------------------------|---------|-------------------------------------------------|
| `TOOLS_ALLOW_NETWORK`    | `false` | `web_fetch` e `web_search`                       |
| `TOOLS_ALLOW_INSTALL`    | `false` | `npm_install`                                    |
| `TOOLS_ALLOW_GIT_WRITE`  | `false` | `git_commit` e `create_pr`                       |
| `TOOLS_ALLOWED_DOMAINS`  | vazio   | allowlist de domínios (vazio = qualquer https)   |

Ações irreversíveis (`npm_install`, `git_commit`, `create_pr`) **sempre** param
na mesma tela de confirmação da UI, mesmo com `TOOLS_AUTO_APPROVE=true`: o
humano vê o comando exato (e o `git status`, no caso do commit) e aperta `y`.
Publicar/deployar (`npm publish`, `deploy`) **não** é exposto ao agente.

### Fluxo de execução

1. O Vaktor monta um system prompt próprio (6 000 chars; +2 500 quando o perfil
   de segurança está ativo) com regras, segurança,
   catálogo de ferramentas e o protocolo textual.
2. O modelo responde com zero a 4 blocos no formato:
   ```text
   <tool_call>{"name":"read_file","args":{"path":"src/index.ts"}}</tool_call>
   ```
3. Cada chamada é validada (nome conhecido, JSON válido, args corretos) e só
   então executada. O resultado volta como uma mensagem `## TOOL RESULT`.
4. Escritas passam por uma tela de confirmação (`y` confirma, `n`/`Esc` cancela).
   Ações irreversíveis (`npm_install`, `git_commit`, `create_pr`) **sempre**
   confirmam, mesmo com `TOOLS_AUTO_APPROVE=true`.
5. Quando o modelo responde **sem** tool calls, o resultado é final. Se
   `VERIFY_ENABLED=true`, o Vaktor roda `typecheck → test → build`, para no
   primeiro que falhar e devolve os erros ao modelo para correção (até
   `VERIFY_MAX_ATTEMPTS`).

O agente chama o provedor via `router.complete()` com `bypassCache: true`,
`thinking: false` e `temperature: 0.2`.

### Contexto e memória

- **Repo map**: o agente recebe a lista de caminhos + exports (cacheada por 60 s),
  não o conteúdo inteiro. Controlado por `CONTEXT_INJECT` / `CONTEXT_MAX_CHARS`.
  Veja com `/context`.
- **Memória**: o arquivo `VAKTOR.md` (nome configurável em `MEMORY_FILE`) guarda
  decisões e preferências. Ele **nunca é criado automaticamente** — só por
  `/memory add <texto>`. Veja com `/memory`.

### Perfil de segurança (SECURITY.md)

O `SECURITY.md` é um perfil opcional que ajusta **tom e profundidade** das
respostas em segurança ofensiva/defensiva e redes — para o modelo trazer
protocolo, flag, CVE, trade-off e PoC conceitual em vez de respostas genéricas.
Ele é injetado no system prompt do chat e do agente, antes de processar a
pergunta.

O arquivo é procurado primeiro no **workdir** do usuário e, se não existir, no
diretório de instalação do Vaktor (o `SECURITY.md` deste repositório é o default).
Controlado por `SECURITY_ENABLED` (padrão `false`) e `SECURITY_FILE`. Em runtime:
`/security on|off` para ligar/desligar e `/security` para inspecionar.

Importante: **não é um jailbreak**. O próprio perfil define os limites
(autorizado/educacional) e o Vaktor continua recusando ataque a sistemas de
terceiros sem autorização, malware pronto para uso malicioso, fraude etc. O
loader também passa o texto pela redação de segredos (chaves e paths absolutos).

### Cliente MCP

O Vaktor é também um **cliente MCP** (Model Context Protocol): conecta a
servidores externos (locais via stdio ou remotos via HTTPS) e o agente passa a
usar as ferramentas deles pela tool `mcp_call`. A descoberta é automática
(`tools/list`), o catálogo entra como contexto e o `/mcp` gerencia tudo.
Desligado por padrão (`MCP_ENABLED=false`).

```
# .env
MCP_ENABLED=true
MCP_SERVERS=fs=stdio npx -y @modelcontextprotocol/server-filesystem .;github=http https://api.github.com/mcp
```

Segurança (mesma filosofia do resto do agente):
- Servidores HTTP **somente https**, com DNS resolvido e IPs privados/localhost
  bloqueados; redirects nunca seguidos; sessão via `Mcp-Session-Id`.
- Processo stdio **não herda** o ambiente do Vaktor (chaves de API não vazam);
  no Windows, `npx`/`npm` vão via `cmd.exe /d /s /c` com argumentos validados.
- Tools destrutivas (heurística de nome + `destructiveHint`) **sempre confirmam
  na UI**, mesmo com `TOOLS_AUTO_APPROVE=true`. `readOnlyHint` do servidor é
  ignorado de propósito (servidor malicioso não afrouxa regra).
- Tudo que vem de servidor MCP é **dado não confiável**: redação de segredos
  (JWT, `sk-*`, `AKIA*`...), caminhos do workdir relativizados, ANSI e
  caracteres invisíveis removidos, sintaxe de tool call neutralizada.
- Suporta protocolos `2025-06-18`, `2025-03-26` e `2024-11-05`; notificações de
  progresso/log; `roots/list` (servidor enxerga só o workdir); reconexão
  preguiçosa; timeout e cancelamento por chamada.

### Best-of-N

Para a **resposta final** (quando não há tool calls) e apenas em tarefas
classificadas como difíceis, com `BEST_OF_N > 1`:

1. gera N candidatas em paralelo (temperaturas 0.2 / 0.5 / 0.8);
2. um crítico pontua cada candidata de 0 a 10;
3. a resposta é a de maior score, **mas** uma candidata que passe na verificação
   vence o score.

O Best-of-N respeita `BEST_OF_N_MAX_COST_USD`: se a estimativa passar do limite,
ele é pulado. Nunca é aplicado a execuções com ferramentas.

### Segurança

- Todo path é resolvido com `realpath` e confinado ao diretório de trabalho
  (sem `..`, symlink ou path absoluto para fora).
- `.env`, `.env.*`, `.key`, `*.pem`, `id_rsa*`, `.npmrc`, `.git-credentials` e
  `.git/config` **nunca** são lidos nem gravados.
- Escrita exige leitura prévia do arquivo e confirmação explícita (a menos que
  `TOOLS_AUTO_APPROVE=true`). Ações irreversíveis ignoram `TOOLS_AUTO_APPROVE`:
  sempre confirmam.
- Allowlist de comandos com bloqueios (sem shell, sem `&&`/`|`/`>`; `npm publish`
  e `git push` proibidos). No Windows, `npm`/`npx` rodam via `node <cli.js>` com
  `shell: false`.
- **Rede**: apenas `https`, sem credenciais na URL, até 3 redirects (cada um
  revalidado), timeout de 15 s e limite de 1 MB por resposta. `localhost`, IPs
  privados/internos e nomes de intranet são sempre bloqueados; `TOOLS_ALLOWED_DOMAINS`
  restringe ainda mais quando preenchido.
- **Install/git**: `npm_install` valida o nome do pacote (nada de `file:`,
  `git+https:`, paths ou flags vindos do modelo); `git_commit` recusa preparar
  arquivos sensíveis e `create_pr` recusa abrir PR a partir de `main`/`master` e
  nunca faz force-push.
- Arquivos binários e arquivos acima de `TOOLS_MAX_FILE_BYTES` são recusados.
- Saídas e histórico são truncados (`TOOLS_MAX_OUTPUT_CHARS`, ~60 KB de tool
  history).
- Anti prompt injection: conteúdo de arquivos, README, páginas web e saídas de
  comandos são tratados como **dados não confiáveis**, nunca como instruções.

### Dataset para fine-tuning

Ative `ENABLE_DATASET_LOG=true` para gravar cada execução em JSONL local
(`.vaktor/logs/sessions/AAAA-MM-DD.jsonl`), com segredos redigidos. O Vaktor
**só coleta e exporta** dados — o treino é externo e opcional. Exporte com:

```bash
npm run export:dataset -- --out dataset.jsonl
```

Veja o guia completo em [`docs/FINE-TUNING.md`](./docs/FINE-TUNING.md).

---

## Gestão de Créditos

### Como funciona

O `CreditManager` rastreia cada requisição e estima o custo com base nos preços por 1k tokens de cada modelo.

### Fallback automático multi-provedor

Quando um provedor esgota o orçamento:

1. Router troca automaticamente para o próximo provedor
2. Notificação aparece: `! Trocado para [Modelo] ([Provedor]) — limite anterior atingido`
3. Quando **todos os 3 pagos** esgotam → **ProxyGateLLM FREE assume**

**Chain de fallback:**
```
Puter ($0.30)
  ↓ orçamento esgota
AgentRouter ($0.30)
  ↓ orçamento esgota
OpenRouter ($0.30)
  ↓ orçamento esgota
Echo Free ($0.30)
  ↓ orçamento esgota
NVIDIA ($0.30)
  ↓ orçamento esgota
OpenCode ($0.30)
  ↓ orçamento esgota
Token Harbor ($0.30)
  ↓ orçamento esgota
Requesty (free)
  ↓ limite diário
Kilo Code (free)
  ↓ limite/indisponível
FreeTheAI (free)
  ↓ limite/indisponível
ProxyGateLLM FREE 🎉
  ↓ ilimitado
```

### Redução de desperdício

- **Cache**: Respostas idênticas retornadas sem custos. TTL 1h.
- **Truncamento**: Histórico limitado a `MAX_CONTEXT_MESSAGES`.
- **Smart Routing**: Perguntas triviais → modelo mais barato automaticamente.

---

## Modelos disponíveis

### Via Puter.com (Provedor 1)

O catálogo do Puter é carregado em runtime de `/puterai/chat/models/details`
(atualmente ~978 modelos de chat após filtrar ASR/imagem/embedding). Custos e
contexto vêm da própria API. Se a consulta falhar ou `PUTER_DYNAMIC_MODELS=false`,
o Vaktor usa a lista curada de 11 modelos como fallback offline.

| Recurso | Valor |
|---------|-------|
| Catálogo dinâmico | ~978 modelos de texto/chat |
| Fallback estático | 11 modelos curados |
| Fonte de custo/contexto | campos `costs` e `context` da API do Puter |
| Desativar dinâmico | `PUTER_DYNAMIC_MODELS=false` |

### Via ProxyGateLLM FREE 🎉 (Direto, sem servidor)

| Modelo                      | Provedor    | Contexto | Custo  |
|-----------------------------|-------------|----------|--------|
| GPT-4o (Pollinations)       | Pollinations| 4k       | FREE   |
| Llama 3.1 70B (Pollinations)| Pollinations| 4k       | FREE   |
| Mistral (Pollinations)      | Pollinations| 4k       | FREE   |
| DeepSeek R1 (Pollinations)  | Pollinations| 4k       | FREE   |
| Qwen 2.5 (Pollinations)     | Pollinations| 4k       | FREE   |
| GPT-4o Mini (DuckDuckGo)    | DuckDuckGo  | 4k       | FREE   |
| Claude Haiku (DuckDuckGo)   | DuckDuckGo  | 4k       | FREE   |
| Mixtral (DuckDuckGo)        | DuckDuckGo  | 4k       | FREE   |
| Llama 3.1 70B (DuckDuckGo)  | DuckDuckGo  | 4k       | FREE   |
| Blackbox AI                 | Blackbox    | 4k       | FREE   |
| Phind 70B                   | Phind       | 4k       | FREE   |

**Total: 11 modelos grátis, sem API key, sem servidor!**

---

## Configuração (.env)

| Variável                 | Padrão      | Descrição                                              |
|--------------------------|-------------|------------------------------------------------|
| `PUTER_API_KEY`          | —           | Token JWT do Puter.com                         |
| `PUTER_DYNAMIC_MODELS`   | `true`      | Carrega o catálogo completo via API do Puter   |
| `PUTER_BUDGET_USD`       | `0.30`      | Orçamento Puter por sessão (USD)               |
| `AGENTROUTER_API_KEY`    | —           | Chave AgentRouter (`co.agentrouter.org`)       |
| `AGENTROUTER_BUDGET_USD` | `0.30`      | Orçamento AgentRouter (USD)                    |
| `OPENROUTER_API_KEY`     | —           | Chave OpenRouter                               |
| `OPENROUTER_BUDGET_USD`  | `0.30`      | Orçamento OpenRouter (USD)                     |
| `NUMES_API_KEY`          | —           | Chave Numes (`api.numes.ai/api/v1`)            |
| `NIGHTROUTER_API_KEY`    | —           | Chave NightRouter (`api.nightrouter.ai/v1`)    |
| `REQUESTY_API_KEY`       | —           | Chave Requesty (`rqsty_...`)                   |
| `KILO_API_KEY`           | —           | Chave Kilo Code (JWT; enviada via `x-api-key`) |
| `FTAI_API_KEY`           | —           | Chave FreeTheAI (`ftai_...`)                   |
| `GROQ_API_KEY`           | —           | Chave Groq (provedor ProxyGateLLM)             |
| `GROQ_BUDGET_USD`        | `0.30`      | Orçamento Groq (USD)                           |
| `ECHO_API_KEY`           | —           | Chave Echo Free (`echo_...`, roteador multi-IA) |
| `ECHO_BUDGET_USD`        | `0.30`      | Orçamento Echo Free (USD)                      |
| `NVIDIA_API_KEY`         | —           | Chave NVIDIA NIM (`nvapi-...`)                  |
| `NVIDIA_BUDGET_USD`      | `0.30`      | Orçamento NVIDIA (USD)                         |
| `OPENCODE_API_KEY`       | —           | Chave OpenCode Zen (`oc_...`)                   |
| `OPENCODE_BUDGET_USD`    | `0.30`      | Orçamento OpenCode (USD)                       |
| `HARBOR_API_KEY`         | —           | Chave Token Harbor (`thk_live_...`)             |
| `HARBOR_BUDGET_USD`      | `0.30`      | Orçamento Token Harbor (USD)                   |
| `ITERACOMPUTE_API_KEY`   | -           | Chave Itera Compute (API OpenAI-compatible)     |
| `QODER_API_KEY`          | -           | PAT Qoder (`pt-...`; vira job token `jt-...`)   |
| `APINEX_API_KEY`         | -           | Chave APInex (`sk-apx...`, carteira USD)       |
| `QRONOS_API_KEY`         | -           | Chave Qronos AI (`qr_...`; free tier, custo `$0`) |
| `VYCEAI_API_KEY`         | -           | Chave principal Vyce AI                         |
| `VYCEAI_API_KEYS`        | -           | Pool opcional Vyce AI separado por vírgula      |
| `DEEPAI_API_KEY`         | -           | Chave DeepAI (texto/resumo e fallback do DeepAI Code) |
| `DEEPAI_CODE_API_KEY`    | -           | Chave da conta DeepAI Code (login Google/Apple; preferida no chat) |
| `DEEPAI_CODE_ACCOUNT_FILE` | `~/.deepai-code/userdata/secrets/deepai-account.bin` | Conta salva pelo app DeepAI Code (fallback quando não há chave no `.env`) |
| `GEMINI_API_KEY`         | —           | Chave Google Gemini (`AIza...`, API nativa)    |
| `GEMINI_BUDGET_USD`      | `0.30`      | Orçamento Google Gemini (USD)                  |
| `GEMINI_MODEL`           | `gemini-2.5-flash` | Modelo inicial quando `DEFAULT_MODEL` não está definido |
| `GEMINI_DYNAMIC_MODELS`  | `true`      | Carrega o catálogo real da chave em `/v1beta/models` |
| `NOTION_API_KEY`         | -           | Token da conexão Notion (`ntn_...`, API de agentes) |
| `NOTION_DYNAMIC_MODELS`  | `true`      | Carrega os agentes acessíveis em `/v1/agents/query` |
| `NOTION_COOKIE`          | -           | Cookie completo da sessão (`token_v2` + `notion_user_id`) |
| `NOTION_TOKEN_V2`        | -           | Alternativa ao cookie completo: só o valor de `token_v2` |
| `NOTION_SPACE_ID`        | -           | UUID do workspace; se omitido, é descoberto via `getSpaces` |
| `NOTION_USER_ID`         | -           | ID do usuário; se omitido, é lido do cookie |
| `NOTION_COOKIE_AUTO`     | `true`      | Lê o cookie do Firefox/Chromium local automaticamente |
| `NOTION_COOKIE_BROWSER`  | -           | Filtra `firefox`, `edge`, `chrome`, `brave` ou `chromium` |
| `NOTION_WEB_BASE_URL`    | `https://www.notion.so` | Base interna; use `https://app.notion.com` se necessário |
| `NOTION_WEB_WORKFLOW_ID` | -           | Opcional: workflow de um Custom Agent |
| `NOTION_WEB_CONTEXT_PAGE_ID` | -       | Opcional: página de contexto do Custom Agent |
| `PROXYGATELLM_ENABLED`   | `true`      | Ativar ProxyGateLLM direto (sem servidor)      |
| `MAX_TOKENS_PER_REQUEST` | `4096`      | Limite de tokens por requisição                |
| `ENABLE_RESPONSE_CACHE`  | `true`      | Habilita cache de respostas                    |
| `MAX_CONTEXT_MESSAGES`   | `20`        | Máximo de mensagens no contexto                |
| `DEFAULT_MODEL`          | `auto`      | Modelo inicial (`auto` ou ID do modelo)        |
| `FALLBACK_MODEL`         | `claude-haiku-4-5-20251001` | Modelo de fallback                |

**Orçamento Total**: `$2.70` (Puter + AgentRouter + OpenRouter + Echo Free + NVIDIA + OpenCode + Token Harbor + Google Gemini) + **∞** (ProxyGateLLM FREE)

> **Google Gemini**: API nativa `generativelanguage.googleapis.com/v1beta`. No boot, o catálogo real da própria chave é carregado de `/v1beta/models` e filtrado para modelos de chat com `generateContent` (Gemini/Gemma); TTS, imagem, música, transcrição e modelos especializados ficam de fora. `GEMINI_DYNAMIC_MODELS=false` mantém o fallback estático (`gemini-2.5-flash`, `gemini-2.5-pro`). A chave vai **só no cabeçalho `x-goog-api-key`** (nunca na URL), com timeout de 180s combinado ao cancelamento (Ctrl+C na TUI). Suporta streaming SSE (`streamGenerateContent?alt=sse`) — a TUI mostra o texto chegando token a token — e `thinkingConfig.thinkingBudget` quando o thinking nativo está ativo. **Custos são estimativas por família** (flash, flash-lite, pro), porque o endpoint de modelos não expõe preço. Sem `GEMINI_API_KEY`, o adapter de provedores desvia os IDs `gemini-2.5-*` para o Echo Free e só falha com instrução clara se o ID for exclusivo da API nativa.

> **Notion AI**: API pública beta de agentes (`Notion-Version: 2026-03-11`). Cada agente acessível vira um "modelo" (`id` do agente; `notion_ai` para o agente pessoal). No boot, `POST /v1/agents/query` carrega os agentes ativos dos tipos `custom_agent` e `notion_ai`; o nome mostra o modelo fixado (`Pesquisa (claude-sonnet-5)`) ou `auto`. A conversa usa `POST /v1/sessions`, polling do status e `POST /v1/sessions/:id/events/query`, com timeout de 180s. Requer workspace **Business/Enterprise**, a capability **View sessions and interact with agents** na conexão e que o Custom Agent seja compartilhado com ela; sem o plano, a API retorna `400 This endpoint requires a business plan`, e sem a capability, `403 restricted_resource`. `NOTION_DYNAMIC_MODELS=false` mantém apenas `notion_ai`. A chave vai somente no cabeçalho `Authorization`, nunca na URL.

> **Notion AI (Web)**: usa a API interna do app Notion (`POST /api/v3/runInferenceTranscript` e `POST /api/v3/getAvailableModels` (corpo `{"spaceId":"..."}`)), autenticada pelo cookie `token_v2` da sessão do navegador. Funciona sem plano Business, mas é uma API não oficial e pode mudar sem aviso. Com `NOTION_COOKIE_AUTO=true` (padrão), o Vaktor lê o cookie automaticamente do **Firefox** (texto puro) ou de Chrome/Edge/Brave/Chromium quando usam `v10`. Chrome/Edge 140+ gravam `v20` com **app-bound encryption**, que só o próprio navegador descriptografa; nesses casos entre no Notion pelo Firefox ou configure `NOTION_COOKIE`/`NOTION_TOKEN_V2`. Use `NOTION_COOKIE_BROWSER=firefox` para forçar um navegador. O `NOTION_SPACE_ID` é descoberto via `getSpaces` se omitido. O provider envia `Cookie`, `Origin`, `Referer`, `x-notion-space-id`, `x-notion-active-user-header` e `x-notion-client-version`, e lê a resposta NDJSON em streaming (`{"type":"markdown-chat","value":"..."}`). Se o Notion bloquear a requisição, tente `NOTION_WEB_BASE_URL=https://app.notion.com`. Para um Custom Agent, capture o `workflowId` em `runInferenceTranscript` e use `NOTION_WEB_WORKFLOW_ID`. **Não commit o `.env`**: o cookie dá acesso à sua conta.

> **Itera Compute**: API OpenAI-compatible (`https://api.iteracompute.com/v1`) com o único modelo free `qwen/qwen3.8-27b` (`$0` input, cached input e output; 30M tokens/mês e 128K de contexto). O thinking do Qwen é desligado (`reasoning:false` e `chat_template_kwargs.enable_thinking=false`) para devolver conteúdo visível; resposta vazia normalmente indica chave/modelo ainda inativo. Em horário de pico a requisição pode entrar em fila. A chave vai somente no `Authorization: Bearer`.

> **Qoder**: API nativa (`openapi.qoder.sh` + `api2-v2.qoder.sh/model/v1`) com 15 modelos. A `QODER_API_KEY` (`pt-...`) **não** vai direto ao chat: o provider troca a PAT por um job token `jt-...` em `POST /api/v1/jobToken/exchange` (cache de ~24h) e envia `Cosy-ClientType: 5`, `Cosy-Version`, `Cosy-MachineOS` e `Cosy-Data-Policy: agree` no gateway. O catálogo vem de `GET https://api.qoder.com/api/v1/cloud/models`; os `price_factor` são créditos Qoder, não USD, então o custo estimado no Vaktor fica `$0`. Sem créditos, o chat responde `402 {"code":116,"error":"quota exceeded"}`. Use o ID opaco (`qmodel_38max`, `smodel`, ...) ou `qoder::ID`.

> **APInex**: gateway OpenAI-compatible em `https://api.apinex.bond/v1` com 42 modelos e uma carteira USD única. A chave `sk-apx...` vai no `Authorization: Bearer` (ou `x-api-key`). Os IDs `free/...` custam `$0`; os demais debitam saldo e podem responder erro de saldo insuficiente. Preços/contexto vêm do catálogo público `https://apinex.bond/api/public/models`; o Vaktor converte `$/1M` para `$/1k`. Use `free/qwen-3.8-max`, `free/kimi-k3`, `gpt-6.1-sol`, `claude-opus-5.5` etc., ou `apinex::ID`.
>
> **Qronos AI**: gateway OpenAI-compatible em `https://api.qronos.me/v1`. A chave `qr_...` vai no `Authorization: Bearer`. No boot, `GET /v1/models` é filtrado para `available: true` + `min_tier: "free"`; só Claude Haiku 5.5, GLM 5.3 Flash e Mercury 3 entram no catálogo, com custo `$0`. A conta free tem 100 requisições e 100k tokens por dia (`GET /v1/me`). Use `qronos::ID` se houver colisão de ID. `QRONOS_DYNAMIC_MODELS=false` mantém a lista estática.

> **DeepAI**: a API de texto usa `https://api.deepai.org/api/{model}` com `api-key` e corpo form-urlencoded (`text=<prompt>`); `data.output` vira o texto do Vaktor (com follow de `output_url`). Modelos legados: `deepai/text-generator` e `deepai/summarization`.
>
> **DeepAI Code**: 18 modelos em `https://api.deepai.org/deepai_code` (OpenAI-compatible) — `chat/completions` e `responses` (GPT-6 Astra). O `POST` leva `api-key` e os cabeçalhos `X-DeepAI-Code-Theos: 4`, `X-DeepAI-Code-Instance` e `X-DeepAI-Code-Machine` (hash do UUID da máquina). Os 9 modelos `0 Theos` são grátis: `glm-5.3-flash`, `deepseek-v4.1-flash`, `mimo-2.6-flash`, `solar-mini-4`, `gpt-6-luna`, `mimo-2.6-pro`, `crouton-alpha`, `glyph-cluster` e `deepai-cyber`; os pagos custam de 3 a 50 Theos/req (`glm-5.3`, `kimi-k3`, `muse-spark-1.3`, `gpt-6.1-sol`, `gemini-4-argon`, `claude-opus-5-5`, `muse-wonder`, `claude-fable-5-1`, `gpt-6-astra`). A chave da conta precisa de login Google/Apple (o app DeepAI Code faz o fluxo); sem isso o servidor responde `403 social_login_required`. Use `DEEPAI_CODE_API_KEY` (fallback `DEEPAI_API_KEY`); se nenhuma estiver definida, o Vaktor lê a conta salva pelo app em `~/.deepai-code/userdata/secrets/deepai-account.bin` (ou no caminho de `DEEPAI_CODE_ACCOUNT_FILE`). Selecione `deepai::ID`. Custo em Theos, exibido como `$0` no Vaktor.

> **Token Harbor**: gateway OpenAI-compatible (`tokenharbor.ai/v1`) com catálogo oficial de 73 modelos e **preços/contexto reais** em `/v1/models`. Ativados por pedido: os 2 free — `deepseek-v4.1-flash:free` e `mimo-v2.6-flash:free` (custo zero, franquia rolando de 7 dias; quando esgota, devolve rate-limit sem cobrar). Respondem com raciocínio nativo (`reasoning_content`).

> **OpenCode Zen**: gateway oficial do OpenCode com 81 modelos de chat (GPT-6, Claude Opus 5.5/Sonnet 5.5/Fable, Gemini 3.8/4-Argon, Grok 4.7, GLM, Kimi K3, MiniMax M3, Qwen3.8, DeepSeek V4 — incluindo 9 gratuitos). Cada família usa um formato próprio, todos validados com chamada real: `chat/completions` (Bearer), `responses` (Bearer, famílias GPT/Grok/Muse), `messages` (x-api-key + anthropic-version, Claude/Qwen) e `models/{id}:generateContent` (x-goog-api-key, Gemini). Pega a chave em `opencode.ai/auth` (créditos pay-per-use). **Custos são estimativas por família** — os modelos `*-free` custam zero.

> **NVIDIA NIM**: 13 modelos de chat verificados com chamada real contra a conta (Llama 3.2 Vision, Nemotron 3/3.5, GLM 5.3, GPT-OSS 20B, Step 5, MiniMax M3.1 Flash, Laguna XS). A API lista ~85 entradas, mas a maioria é embedding/guardrail/vision puro ou não provisionada ("Function not found"); só entram os que respondem. **Cold start**: a primeira chamada a um modelo pode levar 60-100s (o provider usa timeout de 180s). **Custos são estimativas por classe de tamanho** — a NIM cobra por créditos sem preço por token no endpoint; ajuste `src/providers/nvidia.ts` quando tiver a tabela oficial.

> **Echo Free**: roteador multi-provedor (`https://echo.router.merit.systems`) com 62 modelos no catálogo — Anthropic, OpenAI e Gemini — com preços por 1M tokens convertidos para o custo por 1k do Vektor. **O Echo não é um endpoint único OpenAI-compatible**: ele repassa para a API nativa de cada família, então a rota muda por modelo:
>
> | Família | Rota | Observação |
> |---|---|---|
> | Anthropic | `POST /v1/messages` | header `anthropic-version: 2023-06-01` |
> | OpenAI | `POST /chat/completions` | fallback `POST /responses` só quando o modelo exige |
> | Gemini | `POST /v1beta/models/{model}:generateContent` | `contents`/`generationConfig` |
>
> `echo.merit.systems/api/*` é o site (responde 404 HTML) e `/v1/chat/completions` não existe no router. O runtime de credencial vive em `src/providers/extract.ts`: **bootstrap único por chave** (avisa a UI uma vez: `Echo Free autenticado · echo_75e…411a`), **retry limitado** só em 429/5xx/rede respeitando `Retry-After`, **nenhum retry** em 401/402/403/404/422, **cooldown** após falha final (evita loop de autenticação) e **redação de segredos** em toda mensagem de erro. O `401` repassado do upstream OpenAI vira `upstream-auth` (não culpa `ECHO_API_KEY`, não entra em cooldown) e o `429` de spend cap vira `quota` (sem retry). Não existe refresh automático (`ECHO_SUPPORTS_REFRESH = false`) porque o Echo não publica endpoint oficial para isso. Detalhes da consolidação dos scripts antigos: `docs/ECHO-FREE.md`.

> **AgentRouter**: API OpenAI-compatible em `https://co.agentrouter.org/v1` (Anthropic sem `/v1`). Catálogo do portal: `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `gpt-5.5` e `glm-5.2`. A chave `AGENTROUTER_API_KEY` é a mesma para todos os agentes.
>
> **Requesty**: gateway OpenAI-compatible em `https://router.requesty.ai/v1`. Só entram os **13 modelos gratuitos** documentados (Nemotron, Laguna, Gemma 4, Leanstral, Ling); nenhum modelo pago é exposto. Limite free: 200 req/dia e 20 req/min para organizações novas.
>
> **Numes**: marketplace OpenAI-compatible em `https://api.numes.ai/api/v1` com IDs `autor/modelo` (ex.: `openai/gpt-6-luna`). O catálogo vem de `GET /models?output_modalities=text` e só lista ofertas na moeda da chave. Preços USD usam `pricing.*` por token; chaves BTC usam satoshis e são convertidas pelo `reference.usd_per_btc` (com `usd_rates` preferido quando presente). Reasoning vai como `reasoning: { effort }`. Use `numes::autor/modelo` para forçar o provedor quando o ID também existir em outro catálogo.
>
> **NightRouter**: gateway OpenAI-compatible em `https://api.nightrouter.ai/v1`. `GET /v1/models` expõe ~54 IDs (Claude, GPT, Gemini, Kimi, GLM, Qwen, DeepSeek e modelos `custom`); só entram os que aceitam `supported_endpoint_types: ["openai"]`. A API não publica preços/contexto, então os custos são estimativas por família (`pricePer1M`). IDs como `gpt-6-luna` podem colidir com outros provedores; use `nightrouter::ID` para selecionar a rota.
>
> **Kilo Code**: gateway OpenAI-compatible em `https://ai-gateway.kilo.ai/api/v1`. O gateway autentica com **`x-api-key`**, não com `Authorization: Bearer`. Catálogo: 17 modelos com `isFree=true` no endpoint público `/api/v1/models`.
>
> **FreeTheAI (FTA)**: API OpenAI-compatible em `https://api.freetheai.org/v1`, autenticada com `Authorization: Bearer ftai_...`. Catálogo inicial de 5 modelos gratuitos recomendados: `fta/zai/glm-5.3`, `fta/zai/glm-5.3-flash`, `fta/kimi/k3`, `fta/mmx/minimax-m3` e `fta/olf/gpt-oss:120b`.

**Nenhuma configuração extra necessária para ProxyGateLLM!**

### Variáveis do agente

| Variável                  | Padrão       | Descrição                                             |
|---------------------------|--------------|-------------------------------------------------------|
| `ENABLE_AGENT`            | `true`       | Liga o agente no modo `code`                          |
| `AGENT_MAX_ITERATIONS`    | `8`          | Máximo de iterações do loop (1–20)                    |
| `AGENT_MAX_TOOL_CALLS`    | `20`         | Máximo de tool calls por execução (1–100)             |
| `TOOLS_ALLOW_WRITE`       | `true`       | Permite escrita de arquivos                           |
| `TOOLS_AUTO_APPROVE`      | `false`      | Pula a confirmação de escrita (use com cuidado)       |
| `TOOLS_MAX_FILE_BYTES`    | `204800`     | Tamanho máximo de arquivo lido/gravado                |
| `TOOLS_MAX_OUTPUT_CHARS`  | `20000`      | Truncamento de saída de ferramentas                   |
| `TOOLS_COMMAND_TIMEOUT_MS`| `120000`     | Timeout de comando (mata a árvore de processos)       |
| `TOOLS_ALLOWED_COMMANDS`  | —            | Allowlist custom (`label=bin args;...`); vazio = padrão |
| `TOOLS_ALLOW_NETWORK`     | `false`      | Habilita `web_fetch`/`web_search` (https, sem hosts internos) |
| `TOOLS_ALLOW_INSTALL`     | `false`      | Habilita `npm_install` (sempre confirmado)            |
| `TOOLS_ALLOW_GIT_WRITE`   | `false`      | Habilita `git_commit`/`create_pr` (sempre confirmados) |
| `TOOLS_ALLOWED_DOMAINS`   | vazio        | Allowlist de domínios web; vazio = qualquer https público |
| `VERIFY_ENABLED`          | `true`       | Roda typecheck → test → build após a resposta final   |
| `VERIFY_MAX_ATTEMPTS`     | `3`          | Tentativas de verificação/reparo (1–5)                |
| `CONTEXT_INJECT`          | `true`       | Injeta repo map no system prompt do agente            |
| `CONTEXT_MAX_CHARS`       | `4000`       | Tamanho máximo do repo map (1000–12000)               |
| `RUNTIME_CONTEXT`         | `true`       | Injeta data/hora/fuso/SO/cwd no system prompt         |
| `MEMORY_FILE`             | `VAKTOR.md`  | Nome do arquivo de memória do projeto                 |
| `SECURITY_ENABLED`        | `false`      | Injeta o perfil `SECURITY.md` no system prompt        |
| `SECURITY_FILE`           | `SECURITY.md`| Nome do arquivo de perfil de segurança                |
| `MCP_ENABLED`             | `false`      | Habilita o cliente MCP (tool `mcp_call` + `/mcp`)     |
| `MCP_SERVERS`             | —            | `nome=stdio cmd args;nome2=http https://url`          |
| `BEST_OF_N`               | `1`          | Candidatas do Best-of-N na resposta final (1–5)       |
| `CRITIC_MODEL`            | —            | Modelo do crítico (vazio = modelo ativo)              |
| `BEST_OF_N_MAX_COST_USD`  | `0.05`       | Orçamento máximo por Best-of-N                        |
| `ENABLE_DATASET_LOG`      | `false`      | Grava sessões em JSONL local para fine-tuning         |

Valores fora do intervalo são ajustados automaticamente (com aviso na UI).

---

## Estrutura do projeto

```
src/
├── index.ts               # Despachante: VAKTOR_UI=ink → Ink; padrão → TUI Solid
├── ink-entry.tsx          # Bootstrap da UI Ink (fallback)
├── config/
│   └── env.ts             # Carregamento e validação do .env
├── router/
│   ├── index.ts           # Roteamento multi-provedor, complete()/send(), config do agente
│   ├── creditManager.ts   # Gestão de créditos por provedor
│   └── cache.ts           # Cache de respostas + detecção de triviais
├── providers/
│   ├── adapter.ts          # Despacho unificado (chave por owner, deflexões, streaming)
│   ├── http.ts             # withTimeout + ProviderCallOpts (timeout + cancelamento)
│   ├── puter.ts           # Integração Puter.com + catálogo dinâmico (~978) com fallback de 11
│   ├── openaiCompat.ts    # Base compartilhada OpenAI-compatible (auth, usage, reasoning)
│   ├── agentrouter.ts     # AgentRouter + 5 modelos (co.agentrouter.org/v1)
│   ├── openrouter.ts      # Integração OpenRouter + 12 modelos curados (multi-turn)
│   ├── requesty.ts        # Requesty + 13 modelos gratuitos
│   ├── kilo.ts            # Kilo Code + 17 modelos gratuitos (x-api-key)
│   ├── fta.ts             # FreeTheAI + 5 modelos gratuitos
│   ├── proxygatellm.ts    # Integração ProxyGateLLM FREE + 14 modelos ✨
│   ├── gemini.ts          # Google Gemini + catálogo dinâmico da chave (API nativa)
│   ├── notion.ts          # Notion AI + catálogo de agentes e sessões (API beta)
│   ├── notionWeb.ts       # Notion AI Web + cookie token_v2 e NDJSON interno
│   ├── notionCookie.ts    # Leitura automática do cookie (Firefox/Chromium/DPAPI)
│   ├── echo.ts            # Echo Free + 62 modelos, rota nativa por família
│   ├── extract.ts         # Runtime de credencial Echo Free (bootstrap, retry, cooldown, redação)
│   ├── nvidia.ts          # NVIDIA NIM + 13 modelos verificados
│   ├── opencode.ts        # OpenCode Zen + 81 modelos em 4 formatos
│   ├── harbor.ts          # Token Harbor + 2 modelos free
│   ├── iteracompute.ts    # Itera Compute + Qwen3.8 27B free (30M tokens/mês)
│   ├── qoder.ts           # Qoder + PAT→job token e 15 modelos nativos
│   ├── apinex.ts          # APInex + 42 modelos e carteira USD
│   ├── qronos.ts          # Qronos AI + free tier (Claude/GLM/Mercury)
│   ├── vyceai.ts          # Vyce AI + pool de chaves via ambiente
│   ├── deepai.ts          # DeepAI texto/resumo + DeepAI Code (18 modelos)
│   └── smoke.ts           # testes offline (credencial, retry, dono, Gemini, Notion, Notion Web, DeepAI Code, Qronos, pulso)
├── agent/
│   ├── loop.ts            # Loop do agente (tools → resultados → verificação → Best-of-N)
│   ├── protocol.ts        # Parser do protocolo <tool_call>
│   ├── prompt.ts          # System prompt do agente (6 000 chars, +2 500 com perfil)
│   ├── verify.ts          # Detecção e execução da verificação
│   ├── bestofn.ts         # Best-of-N com crítico
│   └── smoke.ts           # Smoke tests do agente
├── tools/
│   ├── index.ts           # Registro das 13 ferramentas
│   ├── fs.ts              # list_dir, read_file, write_file, apply_patch
│   ├── search.ts          # Busca recursiva em TypeScript puro
│   ├── shell.ts           # run_command, git_status, git_diff + spawn seguro
│   ├── web.ts             # web_fetch, web_search (https only, anti-SSRF)
│   ├── packages.ts        # npm_install (validado + confirmado)
│   ├── git.ts             # git_commit, create_pr (guardas + confirmados)
│   └── allowlist.ts       # Allowlist + resolução npm/npx no Windows
├── context/
│   ├── index.ts           # Repo map cacheado (caminhos + exports)
│   └── runtime.ts         # Data/hora/fuso/SO/cwd no system prompt
├── memory/
│   └── index.ts           # Memória do projeto (VAKTOR.md)
├── security/
│   ├── index.ts           # Perfil de segurança (SECURITY.md), com redação
│   └── smoke.ts           # Smoke tests do perfil
├── mcp/                   # Cliente MCP (Model Context Protocol)
│   ├── types.ts           # JSON-RPC 2.0 + tipos do protocolo MCP
│   ├── transport.ts       # Base + StdioTransport (spawn sem shell, env seguro)
│   ├── http.ts            # HttpTransport (https-only, anti-SSRF, SSE)
│   ├── client.ts          # McpClient: handshake, descoberta, roots, progresso
│   ├── security.ts        # Heurística destrutiva, confirmação, sanitização
│   ├── bridge.ts          # mcp_call + contexto + comando /mcp
│   ├── config.ts          # Parser de MCP_ENABLED / MCP_SERVERS
│   └── smoke.ts           # 40 testes offline (servidor mock + fetch fake)
├── dataset/
│   └── index.ts           # Coleta JSONL local com redação de segredos
├── ui/
│   ├── App.tsx            # UI Ink (fallback via VAKTOR_UI=ink)
│   ├── agentEvents.ts     # Exibição de eventos estilo Read/Edit (+N -M)
│   ├── neon.ts            # Matemática do pulso neon do logo (funções puras)
│   ├── theme.ts           # Paleta de cores e constantes visuais
│   ├── smoke.ts           # Smoke tests da exibição de eventos
│   └── components/
│       ├── Header.tsx     # Logo V com ponta neon pulsante + modo/modelo/créditos
│       ├── MessageList.tsx # Lista de mensagens + eventos do agente
│       ├── InputBar.tsx   # Input na parte inferior
│       ├── Footer.tsx     # Hints de comandos + estado do agente
│       ├── ConfirmWrite.tsx # Confirmação de escrita/ações irreversíveis
│       ├── Notification.tsx # Notificações sutis de estado
│       ├── ModelMenu.tsx  # Menu hierárquico de modelos
│       └── CreditsPanel.tsx # Painel de consumo de créditos
├── tui/                   # TUI Solid/OpenTUI (padrão; fallback Ink acima)
│   ├── entry.tsx          # Bootstrap: loadConfig → AIRouter → render
│   ├── app.tsx            # Chat, teclado global, streaming e cancelamento
│   ├── controller.ts      # TuiController + listAllModels (fake para testes)
│   ├── sessions.ts        # Persistência local de sessões em ~/.vaktor/sessions.json
│   ├── sound.ts           # Cues minimalistas de abrir/fechar menus
│   ├── components/        # Header, MessageList, InputBar, StatusBar, ModelMenu
│   └── smoke.tsx          # Smoke headless (testRender, 25 verificações)
├── thinking/              # Classificação, plano e parsing de raciocínio
├── skills/                # Skills embutidas e seleção
└── types/
    └── index.ts           # Tipos compartilhados (tipagem estrita)

scripts/
└── export-dataset.ts      # Exporta .vaktor/logs/sessions para JSONL de chat

docs/
└── FINE-TUNING.md         # Guia de coleta/exportação/treino
```

### Scripts npm

| Script             | Descrição                                             |
|--------------------|-------------------------------------------------------|
| `npm run dev`      | Roda a TUI lendo direto de `src/` (tsx)               |
| `npm run build`    | Compila o TypeScript                                  |
| `npm run typecheck`| Checagem de tipos sem emitir                          |
| `npm run smoke`    | Roda todos os smoke tests (thinking, tools, contexto, memória, segurança, ui, mcp, agente, providers, tui) |
| `npm run smoke:security` | Apenas os smoke tests do perfil de segurança   |
| `npm run smoke:ui` | Apenas os smoke tests da exibição de eventos do agente        |
| `npm run smoke:mcp` | Apenas os smoke tests do cliente MCP (40 testes offline)     |
| `npm run smoke:agent` | Apenas os smoke tests do agente                    |
| `npm run smoke:providers` | Apenas Echo Free + Gemini + Notion + Notion Web + Itera + DeepAI Code + pulso neon (231 testes offline) |
| `npm run smoke:tui` | Smoke headless da TUI Solid/OpenTUI (streaming, cancelamento, menu) |
| `npm run export:dataset` | Exporta o dataset de fine-tuning              |

---

## Decisões de design

- **Multi-provedor com fallback inteligente**: Cada provedor tem orçamento independente. Quando esgota, router muda automaticamente para o próximo. ProxyGateLLM FREE é o último recurso ilimitado.
- **Roteamento automático por categoria**: Prompts de código → Claude Opus, triviais → Claude Haiku, raciocínio → GPT-4o (via auto-routing quando no modo "auto").
- **Estimativa de tokens**: A contagem usa `chars/4` como heurística. Para precisão, considere adicionar `tiktoken` ou `anthropic-tokenizer`.
- **Cache em memória**: Adequado para sessões de terminal. Para persistência entre sessões, adicionar SQLite ou arquivo JSON.
- **Agente como modo separado**: o chat continua usando `router.send()` (skills, thinking, cache, truncamento). O agente usa `router.complete()` diretamente, que é o único ponto de chamada aos provedores.
- **Protocolo textual de tools**: `<tool_call>{...}</tool_call>` com JSON em uma linha, 1–4 por resposta. Nada é executado antes de validar nome, JSON e tipos dos argumentos.
- **Allowlist, não shell**: o modelo escolhe um `label`, nunca o binário. No Windows, `npm`/`npx` são resolvidos para `node <npm-cli.js>` com `shell: false` para evitar o `EINVAL` do `.cmd`.
- **Autonomia com trava humana**: `web_fetch`/`web_search`, `npm_install`, `git_commit` e `create_pr` existem, mas desligados por padrão e as ações irreversíveis sempre confirmam na UI (mesmo com `TOOLS_AUTO_APPROVE=true`). Rede é https-only e sem hosts internos; deploy/publish ficam fora do escopo do agente.
- **Verificação vence o score**: no Best-of-N, uma candidata que passa na verificação ganha de uma com score maior. Best-of-N só na resposta final, nunca em execuções com tools.
- **Dataset é coleta, não treino**: o app grava JSONL local com redação de segredos; o treino acontece fora do Vaktor.
- **Zero dependências novas**: agente, ferramentas, contexto, memória e dataset usam apenas builtins do Node (`node:fs`, `node:path`, `node:child_process`, `node:os`, `node:crypto`) e o `fetch` global para rede — nada de pacotes npm adicionais.
- **TUI com Solid + OpenTUI**: Interface nativa com streaming de tokens e cancelamento (Ctrl+C aborta a chamada via `AbortSignal`), renderização headless testável (`testRender`) e fallback Ink preservado (`VAKTOR_UI=ink`).
