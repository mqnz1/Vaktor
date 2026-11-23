# Echo Free - Pool de Chaves

## Visão geral

O provider Echo Free aceita uma chave principal e um pool opcional. O pool:

- distribui chamadas em round-robin;
- pula chaves que falharam com `401`, `402`, `403` ou `429`;
- mantém cooldown de 60 s por chave com falha;
- não repete a chamada quando o streaming já emitiu tokens;
- continua funcionando com uma única chave.

## Configuração

```bash
# Chave principal (opcional se o pool estiver preenchido)
ECHO_API_KEY=echo_chave_principal

# Pool separado por vírgula, ponto e vírgula ou espaço
ECHO_API_KEY_POOL=echo_chave_1,echo_chave_2,echo_chave_3

# Padrão: round-robin
ECHO_ROTATION_MODE=round-robin
```

Nunca versione o `.env` real. Use `.env.example` apenas com valores vazios.

## Precedência

1. `ECHO_API_KEY` explícita na chamada;
2. `ECHO_API_KEY_POOL`;
3. `ECHO_API_KEY`;
4. erro `missing-credential` com instrução para configurar o `.env`.

## Failover

- `401` / `402` / `403`: chave marcada como inválida e próxima chave é tentada.
- `429`: respeita `Retry-After` e entra em cooldown limitado.
- `5xx` e falhas de rede: retry limitado com backoff.
- `404` / `422`: modelo indisponível; não troca de chave.
- Erros de credencial do upstream são reportados como `upstream-auth`, sem culpar a chave do usuário.

## Verificação

```bash
npm run smoke:providers
```

O smoke test valida classificação de status, retry, redação de segredos e rotação do pool sem fazer chamadas reais.
