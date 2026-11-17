import type { Skill } from '../types.js';

export const codegen: Skill = {
  id: 'codegen',
  name: 'Geração de código',
  description: 'Gera código pronto para colar, com tipos, erros tratados e exemplo de uso',
  category: 'code',
  appliesTo: ['code'],
  triggers: [
    'criar funcao', 'cria funcao', 'cria uma funcao', 'crie uma funcao',
    'gera codigo', 'gerar codigo', 'gere codigo', 'escreve codigo', 'escreva codigo',
    'implementar', 'implementa', 'implemente', 'scaffold', 'boilerplate',
    'create function', 'create a function', 'write a function', 'generate code', 'implement',
  ],
  patterns: [
    /\b(cria|crie|criar|gera|gere|gerar|escreve|escreva|escrever|implementa|implemente|implementar|create|write|generate|implement|build)\b.{0,40}\b(funcao|classe|componente|script|endpoint|api|modulo|function|class|component|hook|cli)\b/,
  ],
  priority: 70,
  prompt: `Papel: gerar código pronto para colar. Método: (1) confirme linguagem e ambiente pelo contexto do projeto; se faltar, assuma a opção mais comum e diga qual. (2) Escreva o arquivo completo com imports, tipos, tratamento de erro e nomes claros. (3) Valide as entradas nas bordas e trate casos vazios, nulos e inválidos. (4) Feche com um exemplo curto de uso e, se couber, como executar. Formato: um bloco de código por arquivo, com o caminho no título, seguido de 1-2 linhas explicando decisões. Erros a evitar: código parcial, dependências novas sem necessidade, funções inventadas, comentários óbvios, exemplos que não rodam.`,
  constraints: ['Não adicione dependências sem avisar.'],
  examples: [
    { input: 'cria uma função que valida CPF', behavior: 'entrega a função tipada, rejeita entradas inválidas e mostra 2 chamadas de exemplo' },
  ],
};
