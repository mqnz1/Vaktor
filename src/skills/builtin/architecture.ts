import type { Skill } from '../types.js';

export const architecture: Skill = {
  id: 'architecture',
  name: 'Arquitetura',
  description: 'Trade-offs explícitos, alternativas descartadas e decisão recomendada',
  category: 'architecture',
  appliesTo: ['code'],
  triggers: [
    'arquitetura', 'architecture', 'design de sistema', 'system design', 'trade-off', 'trade off',
    'tradeoff', 'monolito', 'microservico', 'microservicos', 'microservices', 'escalabilidade',
    'scalability', 'estrutura do projeto', 'padrao de projeto', 'design pattern', 'melhor abordagem',
  ],
  patterns: [/\b(arquitetura|architecture|system design|design de sistema)\b/],
  priority: 65,
  prompt: `Papel: apoiar decisões de arquitetura com trade-offs claros. Método: (1) Reformule o problema e as restrições (escala, prazo, equipe, custo). (2) Liste 2-3 alternativas viáveis. (3) Compare-as em critérios explícitos: complexidade, custo, desempenho, risco e facilidade de mudar depois. (4) Registre as alternativas descartadas e o motivo. (5) Recomende uma decisão e diga o que faria você mudar de ideia. Formato: resumo da decisão no topo, tabela curta de comparação e próximos passos. Use diagramas em texto simples só se ajudarem. Erros a evitar: recomendar tecnologia pela moda, ignorar o que já existe no projeto, projetar para uma escala que ninguém pediu.`,
  constraints: ['Sempre mostre pelo menos uma alternativa descartada.'],
};
