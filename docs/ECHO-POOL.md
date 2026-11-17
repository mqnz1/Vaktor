# Echo API Keys - Pool de Rotação

## Visão Geral

O Vaktor suporta um **pool de até 20 chaves Echo** com rotação automática inteligente. Isso permite:

- **Distribuir carga** entre múltiplas chaves
- **Economizar créditos** mantendo cada chave descansando
- **Failover automático** quando uma chave expira ou esgota cota
- **Zero configuração manual** - funciona transparentemente

## Configuração

### 1. Adicione ao `.env`

```bash
# Chave única (modo compatível)
ECHO_API_KEY=echo_588995bb030b4434b096d30dff9e8303c6ab413418ac9195e459a522fc9b3eff

# OU Pool de múltiplas chaves (modo recomendado)
ECHO_API_KEY_POOL=echo_588995bb030b4434b096d30dff9e8303c6ab413418ac9195e459a522fc9b3eff,echo_b2b740bb5fa94d43b8621c0e343f6fffcf4d737d7eb9ca329c4f6df2a62f8baa,echo_e58fda6199e243048d411ffb560fca44bb7f9f08289a04ad7523e3f49b85a8b4

# Modo de rotação (padrão: round-robin)
ECHO_ROTATION_MODE=round-robin
```

### 2. Entenda a Precedência

1. Se `ECHO_API_KEY` existe → usa chave fixa
2. Se `ECHO_API_KEY_POOL` existe → usa rotação automática
3. Se nenhuma → erro (Echo não configurada)

## Como Funciona

### Fluxo Normal (Round-Robin)

```
Requisição 1: Chave 0 → Sucesso ✅
Requisição 2: Chave 1 → Sucesso ✅
Requisição 3: Chave 2 → Sucesso ✅
...
Requisição 20: Chave 19 → Sucesso ✅
Requisição 21: Chave 0 → Sucesso ✅ (volta ao início)
```

### Failover em Erro

```
Requisição com Chave [5]: Erro 401 ❌
  → Sistema rotaciona automaticamente
Requisição com Chave [6]: Sucesso ✅
```

**Erros que disparam failover:**
- `401 Unauthorized` - Chave expirada/inválida
- `402 Payment Required` - Cota esgotada

**Erros que não disparam failover:**
- `429 Rate Limited` - Espera com backoff
- `5xx Server Errors` - Tenta novamente
- Erros de rede - Retry automático

## Implementação Interna

### Rotação Global

```typescript
// src/providers/extract.ts
let echoRotationIndex = 0;

export function getEchoRotationIndex(): number {
  return echoRotationIndex;
}

export function nextEchoRotation(): void {
  echoRotationIndex++;
}
```

### Seleção de Chave

```typescript
export function readEchoCredential(explicit?: string | null): EchoCredential | null {
  // Se ECHO_API_KEY_POOL existe
  const poolStr = process.env['ECHO_API_KEY_POOL']?.trim();
  if (poolStr) {
    const pool = poolStr.split(',').map(k => k.trim());
    const rotationIndex = getEchoRotationIndex();
    const selected = pool[rotationIndex % pool.length];
    return { token: selected, ... };
  }
  // ...
}
```

### Failover

```typescript
// Em guardEchoCall()
if ((normalized.kind === 'invalid-credential' || normalized.kind === 'quota')
    && process.env['ECHO_API_KEY_POOL']) {
  nextEchoRotation();      // Próxima chave
  resetEchoBoot();         // Recarrega do .env
}
```

## Exemplo: 20 Chaves

```
ECHO_API_KEY_POOL=\
  echo_588995bb030b4434b096d30dff9e8303c6ab413418ac9195e459a522fc9b3eff,\
  echo_b2b740bb5fa94d43b8621c0e343f6fffcf4d737d7eb9ca329c4f6df2a62f8baa,\
  echo_e58fda6199e243048d411ffb560fca44bb7f9f08289a04ad7523e3f49b85a8b4,\
  echo_02208a97c3564b6e9ef3449e235c5db309571c5c33a13f74f7b5d3bba45e9ebf,\
  echo_67ea6e8dd09c4052a8d304b28e531d0a2d9bcf222e877d31f26a5bc44f5e330e,\
  echo_78fea2d655fd4aadbaa1bc2db9f099383a3cc10fb753c8979ef305f43453b677,\
  echo_4b5fc2ce606b4f54acb94d7bde23eb7e8a381473700135f25e114b85f65af467,\
  echo_7a142eaf27cb4fe3bfbda4cb1a43f96dcff31f2e8be39e8cd9c3a172db236930,\
  echo_1e81084af0bc41d9bf82876cd468bf540a8e461fc4801fb9456d01b5fc2ce3e8,\
  echo_d864b08111894c678e2162e2c887df7eff3761df8949c29e37dda275257a06c1,\
  echo_7761b18f60e24b9b8dd99a4a2089df6dc9e2cd895c9dda2645d402a5ae472d80,\
  echo_026b82e1aead40e6b170ca6075704fb724395299bd8e7e9f67a2ff41fa831696,\
  echo_703cf4a009e8477289adb0eb684b1f41af87ef081f8e2bfedf0c2022f01ae299,\
  echo_19376a4c8711499285d762672589cc3e630f0dc9cffc699943f8320ec49f40c4,\
  echo_0b95284009974dfda6492cfbb1ee60de9b93f218b3b748ef01bf8a30fa5624ee,\
  echo_f87a95ffbc654d999bb723fbfa878803fb064d88ba70de5f0745d80ec9eaadc7,\
  echo_54ffc0f8b16544f181c57014acf87edf979bdefb8127e1ffb92990f650dc07bf,\
  echo_7bc907cc4ca741fa8abbff61049ed45d0ee6c3b465a2b8cd8c975e3a16a5ea06,\
  echo_715afb1702f64fb49a16675ddbb09e671b2d34a77fb6c1653bed521296c5bf18,\
  echo_447fbcf184a44a5c99afc08d4f76672a08e49e594d399442693586963c7dc7cd
```

## Testes

Execute o teste de rotação:

```bash
npx ts-node scripts/echo-pool-test.ts
```

Ou rode os testes de provider:

```bash
npm run smoke:providers
```

## Benefícios Práticos

| Cenário | Sem Pool | Com Pool |
|---------|----------|----------|
| 1 chave com cota esgotada | ❌ Sistema quebra | ✅ Pula para chave 2 |
| 5 requisições simultâneas | 1 chave sobrecarregada | ✅ Distribuído em 5 chaves |
| Uso 24/7 | Cota acaba | ✅ Rotação economiza |
| Failover | Manual (reiniciar) | ✅ Automático |

## Troubleshooting

### "Echo Free: ECHO_API_KEY não configurada"

**Solução:** Adicione `ECHO_API_KEY` ou `ECHO_API_KEY_POOL` no `.env`

### Todas as chaves retornam 401

**Diagnóstico:**
1. Verifique se as chaves estão corretas no `.env`
2. Teste manualmente: `curl -H "Authorization: Bearer <chave>" https://echo.router.merit.systems/v1/models`
3. Se todas retornam 401, todas expiraram

**Solução:**
- Gere novas chaves no painel oficial do Echo
- Atualize o `.env`
- Execute `npm run dev` (recarrega ambiente)

### Sistema pula chaves mas não funciona

**Verificar:**
1. `echo $ECHO_API_KEY_POOL` - chaves separadas por vírgula?
2. Sem espaços extras: `chave1,chave2` (não `chave1, chave2`)
3. Todas as chaves têm prefixo `echo_`?

## Notas

- A rotação é **global e persistente** durante a execução
- Índice não reseta entre requisições
- Pool é lido uma vez no `.env` na inicialização
- Mudanças no `.env` exigem reiniciar com `npm run dev`
