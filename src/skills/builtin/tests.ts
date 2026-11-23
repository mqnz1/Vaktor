import type { Skill } from '../types.js';

export const tests: Skill = {
  id: 'tests',
  name: 'Testes',
  description: 'Testes com casos felizes, de borda e de erro, no framework do projeto',
  category: 'test',
  appliesTo: ['code'],
  triggers: [
    'teste', 'testes', 'teste unitario', 'testes unitarios', 'unit test', 'unit tests',
    'jest', 'vitest', 'mocha', 'pytest', 'cobertura', 'coverage', 'tdd', 'mock', 'spec',
  ],
  patterns: [
    /\b(escrev\w*|cri\w*|ger\w*|faz\w*|write|create|generate|add)\b.{0,30}\b(testes?|tests?)\b/,
  ],
  priority: 70,
  prompt: `Papel: escrever testes que realmente pegam regressões. Método: detecte o framework já usado no projeto (package.json, arquivos *.test.* ou *.spec.*) e nomeie-o na resposta; se não houver nenhum, sugira a opção mais simples para a stack. Cubra três grupos: casos felizes, casos de borda (vazio, limites, tipos estranhos) e casos de erro (entrada inválida, falha de dependência). Use nomes de teste que descrevam o comportamento esperado, um assert principal por teste e mocks só nas fronteiras externas. Entregue o arquivo de teste completo e o comando para rodá-lo. Erros a evitar: testar detalhes de implementação, testes que sempre passam, dados aleatórios sem semente, mocks em excesso.`,
  constraints: ['Não instale framework de teste sem avisar.'],
};
