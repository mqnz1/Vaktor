# Echo Pool Setup - Guia Prático

## Passo 1: Copie as 20 Chaves

Você já tem estas 20 chaves:

```
echo_588995bb030b4434b096d30dff9e8303c6ab413418ac9195e459a522fc9b3eff
echo_b2b740bb5fa94d43b8621c0e343f6fffcf4d737d7eb9ca329c4f6df2a62f8baa
echo_e58fda6199e243048d411ffb560fca44bb7f9f08289a04ad7523e3f49b85a8b4
echo_02208a97c3564b6e9ef3449e235c5db309571c5c33a13f74f7b5d3bba45e9ebf
echo_67ea6e8dd09c4052a8d304b28e531d0a2d9bcf222e877d31f26a5bc44f5e330e
echo_78fea2d655fd4aadbaa1bc2db9f099383a3cc10fb753c8979ef305f43453b677
echo_4b5fc2ce606b4f54acb94d7bde23eb7e8a381473700135f25e114b85f65af467
echo_7a142eaf27cb4fe3bfbda4cb1a43f96dcff31f2e8be39e8cd9c3a172db236930
echo_1e81084af0bc41d9bf82876cd468bf540a8e461fc4801fb9456d01b5fc2ce3e8
echo_d864b08111894c678e2162e2c887df7eff3761df8949c29e37dda275257a06c1
echo_7761b18f60e24b9b8dd99a4a2089df6dc9e2cd895c9dda2645d402a5ae472d80
echo_026b82e1aead40e6b170ca6075704fb724395299bd8e7e9f67a2ff41fa831696
echo_703cf4a009e8477289adb0eb684b1f41af87ef081f8e2bfedf0c2022f01ae299
echo_19376a4c8711499285d762672589cc3e630f0dc9cffc699943f8320ec49f40c4
echo_0b95284009974dfda6492cfbb1ee60de9b93f218b3b748ef01bf8a30fa5624ee
echo_f87a95ffbc654d999bb723fbfa878803fb064d88ba70de5f0745d80ec9eaadc7
echo_54ffc0f8b16544f181c57014acf87edf979bdefb8127e1ffb92990f650dc07bf
echo_7bc907cc4ca741fa8abbff61049ed45d0ee6c3b465a2b8cd8c975e3a16a5ea06
echo_715afb1702f64fb49a16675ddbb09e671b2d34a77fb6c1653bed521296c5bf18
echo_447fbcf184a44a5c99afc08d4f76672a08e49e594d399442693586963c7dc7cd
```

## Passo 2: Abra o `.env`

```bash
# No seu projeto Vaktor
code .env
```

## Passo 3: Encontre a Seção Echo

Procure por:
```bash
# Echo (roteador multi-provedor: Anthropic, OpenAI, Gemini)
ECHO_API_KEY=echo_...
ECHO_BUDGET_USD=0.30
```

## Passo 4: Substitua por Pool

**ANTES:**
```bash
ECHO_API_KEY=echo_75ef9e4bb25d40088d4e6a8d95227e3e94ee9d92b7e0de4179fbd3305aad411a
```

**DEPOIS:**
```bash
ECHO_API_KEY=echo_588995bb030b4434b096d30dff9e8303c6ab413418ac9195e459a522fc9b3eff
ECHO_API_KEY_POOL=echo_588995bb030b4434b096d30dff9e8303c6ab413418ac9195e459a522fc9b3eff,echo_b2b740bb5fa94d43b8621c0e343f6fffcf4d737d7eb9ca329c4f6df2a62f8baa,echo_e58fda6199e243048d411ffb560fca44bb7f9f08289a04ad7523e3f49b85a8b4,echo_02208a97c3564b6e9ef3449e235c5db309571c5c33a13f74f7b5d3bba45e9ebf,echo_67ea6e8dd09c4052a8d304b28e531d0a2d9bcf222e877d31f26a5bc44f5e330e,echo_78fea2d655fd4aadbaa1bc2db9f099383a3cc10fb753c8979ef305f43453b677,echo_4b5fc2ce606b4f54acb94d7bde23eb7e8a381473700135f25e114b85f65af467,echo_7a142eaf27cb4fe3bfbda4cb1a43f96dcff31f2e8be39e8cd9c3a172db236930,echo_1e81084af0bc41d9bf82876cd468bf540a8e461fc4801fb9456d01b5fc2ce3e8,echo_d864b08111894c678e2162e2c887df7eff3761df8949c29e37dda275257a06c1,echo_7761b18f60e24b9b8dd99a4a2089df6dc9e2cd895c9dda2645d402a5ae472d80,echo_026b82e1aead40e6b170ca6075704fb724395299bd8e7e9f67a2ff41fa831696,echo_703cf4a009e8477289adb0eb684b1f41af87ef081f8e2bfedf0c2022f01ae299,echo_19376a4c8711499285d762672589cc3e630f0dc9cffc699943f8320ec49f40c4,echo_0b95284009974dfda6492cfbb1ee60de9b93f218b3b748ef01bf8a30fa5624ee,echo_f87a95ffbc654d999bb723fbfa878803fb064d88ba70de5f0745d80ec9eaadc7,echo_54ffc0f8b16544f181c57014acf87edf979bdefb8127e1ffb92990f650dc07bf,echo_7bc907cc4ca741fa8abbff61049ed45d0ee6c3b465a2b8cd8c975e3a16a5ea06,echo_715afb1702f64fb49a16675ddbb09e671b2d34a77fb6c1653bed521296c5bf18,echo_447fbcf184a44a5c99afc08d4f76672a08e49e594d399442693586963c7dc7cd
ECHO_ROTATION_MODE=round-robin
ECHO_BUDGET_USD=0.30
```

## Passo 5: Salve e Reinicie

```bash
# Salve o arquivo (Ctrl+S)
# Depois reinicie:
npm run dev
```

## Verificar se Funciona

Ao iniciar, você verá:

```
✓ Echo Ready
  Chave: echo_588995bb**** (masked)
  Pool: 20 chaves ativadas
  Modo: round-robin
```

## Como Saber que Está Funcionando

### ✅ Primeira Requisição
```
[1] Usando chave 0: echo_588995bb****
    POST https://echo.router.merit.systems/v1/chat/completions
    Status: 200 OK
```

### ✅ Segunda Requisição
```
[2] Usando chave 1: echo_b2b740bb****
    POST https://echo.router.merit.systems/v1/chat/completions
    Status: 200 OK
```

### ✅ Se Uma Chave Falhar
```
[5] Usando chave 4: echo_67ea6e8d****
    POST https://echo.router.merit.systems/v1/chat/completions
    Status: 401 Unauthorized ❌

    → Rotacionando para chave 5...

[6] Usando chave 5: echo_78fea2d6****
    POST https://echo.router.merit.systems/v1/chat/completions
    Status: 200 OK ✅
```

## Formato Correto

⚠️ **IMPORTANTE:** As chaves devem estar:

1. **Sem espaços entre elas:**
   ```bash
   # ✅ CERTO
   ECHO_API_KEY_POOL=chave1,chave2,chave3

   # ❌ ERRADO (não funciona)
   ECHO_API_KEY_POOL=chave1, chave2, chave3
   ```

2. **Todas com prefixo `echo_`:**
   ```bash
   # ✅ Todos começam com echo_
   echo_588995bb..., echo_b2b740bb..., echo_e58fda61...
   ```

3. **Uma linha ou com `\` no final:**
   ```bash
   # ✅ OPÇÃO 1: Uma linha longa
   ECHO_API_KEY_POOL=echo_588995bb...,echo_b2b740bb...,echo_e58fda61...

   # ✅ OPÇÃO 2: Multi-linha com backslash
   ECHO_API_KEY_POOL=\
     echo_588995bb...,\
     echo_b2b740bb...,\
     echo_e58fda61...
   ```

## Troubleshooting

### Erro: "ECHO_API_KEY não configurada"
- Verifique se `ECHO_API_KEY_POOL` está no `.env`
- Não tem espaços extras
- Está na linha correta

### Todas as requisições usam a mesma chave
- Possível que não haja `ECHO_API_KEY_POOL`
- Sistema está usando `ECHO_API_KEY` (chave fixa)
- Solução: Remova `ECHO_API_KEY` se tiver `ECHO_API_KEY_POOL`

### Rotação não está funcionando
- Reinicie com `npm run dev`
- Verifique se o `.env` foi salvo
- Confirme que não há cache de ambiente antigo

## Monitorando o Pool

Para ver qual chave está sendo usada:

```bash
# Ver índice atual
node -e "console.log(process.env.ECHO_API_KEY_POOL?.split(',')[Math.floor(Math.random()*20)])"
```

Ou adicione `console.log` no código:

```typescript
const credential = readEchoCredential();
console.log(`📌 Usando chave: ${credential?.masked}`);
```

## Próximos Passos

✅ Pool configurado e funcionando
✅ Rotação automática ativada
✅ Failover em caso de erro 401/402

Agora você pode:
- Usar `/mode code` para ativar o agent
- Fazer requisições normalmente
- Sistema rotaciona automaticamente entre as 20 chaves
