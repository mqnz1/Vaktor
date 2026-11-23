# Fine-tuning com os dados do Vaktor

O Vaktor **não treina modelo**. Ele apenas coleta dados locais quando você liga
`ENABLE_DATASET_LOG=true` e exporta no formato de chat. O treino acontece fora
do app, com a ferramenta que você preferir (OpenAI, Anthropic, Axolotl,
Unsloth, LLaMA-Factory etc.).

## 1. Ligar a coleta

No `.env`:

```env
ENABLE_DATASET_LOG=true
```

Cada execução do agente grava uma linha JSONL em
`.vaktor/logs/sessions/AAAA-MM-DD.jsonl`. O diretório `.vaktor/` recebe um
`.gitignore` com `*`, então nada disso vai para o git.

Segredos são redigidos antes de gravar (`sk-...`, `Bearer ...`, campos com
`key`/`token`/`secret`/`password`). Ainda assim, revise os dados antes de
enviar para qualquer serviço.

## 2. Avaliar as sessões

A entrada tem este formato:

```json
{
  "id": "uuid",
  "ts": "2026-01-01T12:00:00.000Z",
  "workdir": "meu-projeto",
  "model": "claude-sonnet-5",
  "input": "pergunta do usuário",
  "output": "resposta final do agente",
  "tools": [{ "name": "read_file", "args": { "path": "src/a.ts" }, "ok": true }],
  "verify": { "ran": true, "ok": true, "attempts": 1, "command": "npm run typecheck" },
  "rating": null
}
```

Use `rating` para marcar de 1 a 5 as sessões boas. O campo nasce `null` e não é
editado pelo app.

## 3. Exportar

```bash
# só sessões cuja verificação passou
npm run export:dataset -- --out dataset.jsonl

# todas as sessões, inclusive falhas
npm run export:dataset -- --all --out dataset-all.jsonl

# só notas >= 4 e de um modelo específico
npm run export:dataset -- --min-rating 4 --model claude-sonnet-5 --out bom.jsonl
```

Opções:

| Flag | Efeito |
| --- | --- |
| `--all` | ignora o filtro de verificação |
| `--min-rating N` | exige `rating >= N` |
| `--model ID` | só sessões daquele modelo |
| `--logs DIR` | muda o diretório de logs |
| `--out ARQUIVO` | caminho do JSONL de saída |

A saída fica no formato de chat:

```json
{"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}],"metadata":{...}}
```

## 4. Treinar (exemplo conceitual)

```bash
# OpenAI
openai api fine_tuning.jobs.create -t dataset.jsonl -m gpt-4o-mini

# Axolotl / Unsloth / LLaMA-Factory
# aponte o dataset para o JSONL exportado no formato de chat
```

## 5. Cuidados

- Revise manualmente antes de exportar: o agente pode ter visto dados do seu
  projeto que você não quer publicar.
- Não use sessões com `verify.ok=false` sem revisar.
- O volume por sessão é limitado a ~200 KB; entradas gigantes são truncadas.
- Remova `.vaktor/` antes de compartilhar o repositório.
