# Echo Free — dos scripts `Echo Hunter` ao `extract.ts`

Documento de migração e de escopo. Explica o que os dois scripts originais faziam,
o que foi consolidado em `src/providers/extract.ts` e o que foi **deliberadamente
descartado** — com o motivo técnico e de política de uso.

---

## 1. Análise dos arquivos originais

### `Echo Hunter/boot.py` (46 linhas)

| Responsabilidade | Detalhe |
|---|---|
| Bootstrap de dependências | Cria `imports/`, injeta no `sys.path` e instala com `pip --target` o que faltar (`requests`, `urllib3`, `selenium`, `webdriver-manager`). |
| Lançamento | Executa `hacking.py` como processo filho, repassando `os.environ`. |
| Diagnóstico | Mostra o código de saída do filho. |

Função real: **preflight do ambiente + launcher**. Nada aqui gera ou lê credenciais.

### `Echo Hunter/hacking.py` (328 linhas)

| Bloco | O que faz | Avaliação |
|---|---|---|
| `criar_email_mailtm()` | Cria conta descartável no `mail.tm` e obtém token JWT da caixa. | Criação automatizada de identidade para burlar cadastro. **Não portado.** |
| `pegar_link()` | Faz polling de 15×3s na caixa, lê o HTML do e-mail e extrai o link `link.merit.systems`. | Existe só para o fluxo acima. **Não portado.** |
| `forjar_callback()` | Reescreve a URL para `echo.merit.systems/api/auth/callback/resend?...&token=...` pulando a etapa normal de confirmação. | Forja de callback de verificação. **Não portado.** |
| `criar_conta_e_key()` | Selenium headless com flags anti-detecção: login, "claim" de créditos de boas-vindas, cria app tier `low`, gera API key e raspa o valor do DOM. | Provisionamento de contas + coleta de chaves. **Não portado.** |
| `rodar_servidor()` | Loop **infinito** repetindo tudo, com `sleep` aleatório de 20–40s e append em `apis.txt`. | Farm de chaves/contas em escala. **Não portado.** |
| `HEADERS`, regex de key, tratamento de 429 | Constantes e utilidades genéricas de cliente HTTP. | Aproveitável — virou validação de formato + política de retry. |

Em resumo: `boot.py` é infraestrutura; `hacking.py` é um provisionador de contas
com e-mail descartável, resgate repetido de créditos de boas-vindas e scraping de
API keys. A parte "útil para um cliente" é só a **camada de credencial/retry**.

---

## 2. O que foi consolidado (`src/providers/extract.ts`)

| Origem | Recurso | Implementação em TypeScript |
|---|---|---|
| `boot.py` | preflight antes da primeira chamada | `ensureEchoReady()` — idempotente por chave, lança `missing-credential` com dica acionável |
| `boot.py` | detectar troca de ambiente | comparação do token em cache; chave nova ⇒ novo bootstrap e `resetEchoGuard()` |
| `hacking.py` | leitura de chave | `readEchoCredential()` — argumento explícito → `ECHO_API_KEY`; nunca hardcoded, nunca gravado |
| `hacking.py` | regex de formato | `ECHO_KEY_PATTERN` (`echo_…`); formato inesperado é aceito, mas sinalizado |
| `hacking.py` | espera em 429 | `parseRetryAfter()` + espera limitada por `ECHO_MAX_WAIT_MS` |
| `hacking.py` | impressão de erros | `redactSecrets()` / `maskSecret()` — Bearer, `echo_`, `sk-`, `thk_`, `nvapi-`, `gsk_`, `oc_sk_`, `x-api-key` |
| — (novo) | classificação de falha | `classifyEchoStatus()` + `EchoError.kind` |
| — (novo) | anti-loop | cooldown de autenticação (60s) e de rate-limit (até 120s) |

### Fluxo quando um modelo Echo é usado

```
/models → modelo do catálogo ECHO_MODELS
   ↓
router.dispatch() detecta o provider pelo catálogo
   ↓
sendToEcho()
   ├─ ensureEchoReady()        ← bootstrap único (boot.py)
   │     └─ sem chave → EchoError('missing-credential')
   │     └─ 1ª vez → onBoot("Echo Free autenticado · echo_75e…411a")
   ├─ rota nativa por família (guardEchoCall):
   │     Anthropic → POST /v1/messages (anthropic-version)
   │     OpenAI    → POST /chat/completions (fallback /responses)
   │     Gemini    → POST /v1beta/models/{model}:generateContent
   ├─ sucesso → recordEchoSuccess() limpa cooldowns
   └─ falha  → classifica → retry limitado ou cooldown
```

> O Echo é um proxy para as APIs nativas; **não** existe um endpoint único
> OpenAI-compatible. `echo.merit.systems/api/*` é o site (404 HTML) e
> `/v1/chat/completions` não existe no router. Usar `/responses` num modelo
> Claude devolve o 401 da credencial upstream do OpenAI, escondendo o erro
> real (modelo inexistente).

### Matriz de erros

| Status | `kind` | Retry automático | Cooldown |
|---|---|---|---|
| — (sem chave) | `missing-credential` | não | — |
| 401 (chave Echo) | `invalid-credential` | **não** | 60s |
| 401 upstream (`sk-svcac…`) | `upstream-auth` | **não** | — |
| 402 | `quota` | **não** | — |
| 429 spend cap / `RESOURCE_EXHAUSTED` | `quota` | **não** | — |
| 403 | `forbidden` | **não** | 60s |
| 404 / 422 | `model` | não (`/responses` só p/ OpenAI) | — |
| 425 / 408 | `network` | sim (1×) | — |
| 429 | `rate-limit` | sim, respeitando `Retry-After` | até 120s |
| 5xx | `upstream` | sim (1×) | — |
| rede/timeout | `network` | sim (1×) | — |

> Catálogo atual: 4 modelos Anthropic (`claude-haiku-4-5-20251001`,
> `claude-sonnet-4-5-20250929`, `claude-sonnet-4-6`, `claude-opus-4-8`),
> 3 Gemini (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-image`)
> e 55 OpenAI. Só os Claude respondem hoje: a credencial upstream do OpenAI
> no Echo está inválida (401 `sk-svcac…` → `upstream-auth`) e o projeto
> Gemini estourou o spend cap mensal (429 → `quota`). Nada disso é
> corrigível no cliente.

Toda mensagem passa por `redactSecrets()` antes de chegar ao log, à UI ou ao
dataset. A chave nunca é impressa inteira em nenhum caminho.

---

## 3. O que não foi implementado — e por quê

Os blocos de `hacking.py` marcados como **não portados** dependem de:

1. **Criar contas em nome de terceiros** com e-mail descartável;
2. **Forjar o callback** de verificação para pular o fluxo do provedor;
3. **Resgatar créditos de boas-vindas repetidamente**;
4. **Automatizar navegador** para gerar e raspar API keys em loop;
5. **Persistir chaves de terceiros** em `apis.txt`.

Isso é abuso de cadastro gratuito e coleta de credenciais sem autorização do
provedor — além de violar os termos de uso do Echo. Um cliente legítimo não
precisa de nada disso: ele usa a chave que o usuário já obteve no painel.

`ECHO_HUNTER_PROVENANCE` (exportado pelo módulo) registra essa decisão em
runtime, e `src/providers/smoke.ts` verifica que ela está documentada.

### Dependência externa conhecida

A conta Echo usada nos testes responde **401** com a mensagem
`Incorrect API key provided: sk-svcac…` — a chave quebrada é a do **upstream do
próprio Echo**, não a `ECHO_API_KEY` local. Nada aqui simula sucesso: o erro é
classificado como `invalid-credential`, redigido e devolvido com a dica de
conferir o `.env`. Quando o upstream do Echo for normalizado, a chamada passa a
funcionar sem mudança de código.

---

## 4. Cobertura de testes

`npm run smoke:providers` — 61 verificações offline (sem rede):

- rótulo `Echo Free` e nomes de modelo;
- `maskSecret`, `redactSecrets` (Bearer, `x-api-key`, `echo_`);
- precedência explícito → `ECHO_API_KEY`, formato, chave ausente;
- bootstrap idempotente e reinício na troca de chave;
- tabela de classificação de status e `Retry-After` (segundos e data HTTP);
- erro HTTP redigido e com dica;
- retry em 5xx/rede, **sem** retry em 401, cooldown bloqueando a chamada seguinte;
- espera de 429 conforme `Retry-After`;
- matemática do pulso neon (extremos, monotonicidade, ciclo fechado).

---

## 5. Notas de escopo

- O provider continua sendo **um só** (`src/providers/echo.ts`); `extract.ts`
  não é um provider, é a camada de credencial/política usada por ele.
- O identificador interno do provider segue `echo`; apenas o rótulo visível
  passou a ser **Echo Free** (`PROVIDER_LABELS.echo`).
- Nada é gravado em disco: sem cache de token, sem rotação de chaves.
  Um `apis.txt` fornecido pelo usuário é material externo: o runtime não o
  lê, não o grava e não troca de credencial sozinho.
- `ECHO_SUPPORTS_REFRESH = false` é uma constante, não um TODO: só muda se o
  Echo publicar um endpoint oficial de renovação.

---

## 6. Correção de roteamento descoberta na integração

Ao testar o fluxo completo (`router.complete` → Echo), o aviso de bootstrap
mostrou a chave errada: `eyJhbGci…` — o JWT do **Puter** — em vez de
`echo_75e…411a`.

Causa: 12 IDs de modelo existem em mais de um catálogo, por exemplo:

| ID | Catálogos | `dispatch` enviava para | chave usada |
|---|---|---|---|
| `claude-haiku-4-5-20251001` | Puter + Echo | Echo | **Puter** ❌ |
| `claude-sonnet-5` | Puter + OpenCode | OpenCode | **Puter** ❌ |
| `gpt-5` | Puter + Echo + OpenCode | Echo | **Puter** ❌ |
| `deepseek-v4.1-flash` | Puter + OpenCode | OpenCode | **Puter** ❌ |

`dispatch()` decidia o provedor por uma ordem (Groq → AgentRouter → OpenRouter →
Echo → NVIDIA → OpenCode → Harbor → Puter), enquanto `getProviderEnvKey()`
decidia a chave por outra (Puter primeiro). Nos IDs duplicados a chamada ia para
um provedor autenticada com a chave de outro — 401 garantido.

Correção: `src/providers/registry.ts` centraliza a **ordem única**
(`PROVIDER_ORDER`). `dispatch`, a chave (`PROVIDER_ENV_KEYS`), o rótulo, o nome
e o custo passam todos por `ownerOf()` / `findModelOwner()`. O menu também
esconde entradas "emprestadas" (`modelsOwnedBy`), para o rótulo do modelo nunca
contradizer o provedor que realmente atende a chamada.

Cobertura: 6 verificações novas em `smoke:providers` (dono único, coerência
entre dono e chave, Puter sem modelos que vão para o Echo, fallback para `puter`).
