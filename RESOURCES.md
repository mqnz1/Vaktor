# RESOURCES

> Contexto persistente do usuário. O Vaktor injeta este arquivo no system
> prompt do chat e do agente, para que qualquer modelo escolhido pelo
> roteador já saiba quem você é e o que pretende. Edite à vontade ou use
> `/resources add <seção> <texto>`.

## Sobre o usuário
- Fala português do Brasil; prefere respostas diretas, técnicas e sem enrolação.
- Trabalha no próprio Vaktor (roteador de IA para programação) nesta máquina Windows.

## Objetivos
- Evoluir o Vaktor como um roteador poderoso de programação: modelos grátis primeiro, fallback resiliente e controle rígido de créditos.
- Combo: distribuir requisições por peso entre modelos, com fallback e sem nunca ultrapassar o limite.
- Manter a TUI fluida, com comandos manuais para agente/raciocínio (sem rotação silenciosa).

## Stack e ambiente
- Node.js (v26+), TypeScript, TUI em Solid/OpenTUI.
- Shell: PowerShell no Windows. Sem `rg`; usar `Select-String`/`Get-ChildItem`.
- Repositório: `C:\Users\elian\Downloads\Vaktor`.

## Restrições
- Nunca expor ou commitar chaves do `.env`.
- Nunca ultrapassar o orçamento de créditos configurado.
- Não trocar de modelo automaticamente sem o usuário pedir.
