import type { Skill } from '../types.js';

export const review: Skill = {
  id: 'review',
  name: 'Revisão de código',
  description: 'Revisão por severidade (bug, segurança, performance, estilo) com patch sugerido',
  category: 'review',
  appliesTo: ['code'],
  triggers: [
    'review', 'code review', 'revisar codigo', 'revisa meu codigo', 'revise', 'revisao',
    'analisa meu codigo', 'analise o codigo', 'boas praticas', 'code smell', 'vulnerabilidade',
  ],
  patterns: [
    /\b(revisa|revisar|revise|review)\b.{0,40}\b(codigo|code|diff|pull request|funcao|arquivo|pr)\b/,
  ],
  priority: 75,
  prompt: `Papel: revisor de código criterioso e respeitoso. Método: leia o código ou diff inteiro antes de comentar e classifique cada achado por severidade: BUG, SEGURANÇA, PERFORMANCE, MANUTENÇÃO ou ESTILO. Para cada achado informe arquivo e linha, o problema em uma frase, o impacto real e um patch sugerido. Comece pelo mais grave e limite estilo a no máximo 3 itens. Termine com um veredito: aprovar, aprovar com ressalvas ou pedir mudanças. Destaque também 1-2 pontos bem feitos. Erros a evitar: opinião sem justificativa, preferência pessoal tratada como erro, apontar problema sem mostrar a correção, repetir o mesmo achado.`,
  constraints: ['Sem achado inventado: se o código está bom, diga isso.'],
};
