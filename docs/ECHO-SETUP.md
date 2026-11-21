# Echo Free - Setup

## 1. Obtenha as chaves

Gere uma ou mais chaves no painel do Echo. O prefixo é `echo_`.

## 2. Configure o `.env`

```bash
ECHO_API_KEY=echo_chave_principal
ECHO_API_KEY_POOL=echo_chave_1,echo_chave_2,echo_chave_3
ECHO_ROTATION_MODE=round-robin
ECHO_BUDGET_USD=0.30
```

Regras:

- não use espaços dentro do pool;
- não versione o `.env`;
- uma chave já basta; o pool é opcional.

## 3. Reinicie

```bash
npm run dev
```

## 4. Confirme

```bash
npm run smoke:providers
```

O boot mostra a chave mascarada e a quantidade de chaves do pool.

## Troubleshooting

### `Echo Free: credencial não configurada`

Verifique `ECHO_API_KEY` ou `ECHO_API_KEY_POOL` no `.env`.

### Todas as chaves retornam `401`

As chaves expiraram ou foram revogadas. Gere novas e reinicie.

### A rotação não acontece

Confirme que o pool está no `.env` e que o processo foi reiniciado. O pool é lido na inicialização.

### `temperature is deprecated`

Modelos `claude-opus-4-8` não aceitam `temperature`. O provider remove o campo automaticamente e repete uma vez se o upstream ainda retornar esse `400`.
