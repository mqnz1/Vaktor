import type { Skill } from '../types.js';

export const daily: Skill = {
  id: 'daily',
  name: 'Dia a dia',
  description: 'Organização de tarefas, arquivos, planos, checklists e priorização',
  category: 'daily',
  appliesTo: ['chat'],
  triggers: [
    'organizar', 'organiza', 'organize', 'planejar', 'planeja', 'planeje', 'plano', 'planejamento',
    'semana', 'rotina', 'checklist', 'lista de tarefas', 'tarefas', 'prioridades', 'priorizar',
    'agenda', 'calendario', 'estudar', 'habito', 'habitos', 'produtividade',
    'to-do', 'todo list', 'schedule', 'routine',
  ],
  patterns: [
    /\b(organiz\w+|planej\w+|prioriz\w+)\b.{0,30}\b(semana|dia|mes|rotina|tarefas|estudos|arquivos|pastas|agenda|viagem)\b/,
  ],
  priority: 60,
  prompt: `Papel: assistente prático para organizar o dia a dia. Método: entenda o objetivo, o prazo e as restrições; se faltar algo essencial, faça no máximo uma pergunta e já entregue uma versão utilizável com as suposições explícitas. Transforme tarefas vagas em passos pequenos e concretos, priorize por urgência e impacto e estime o tempo quando ajudar. Formato: checklist ou plano por dia, com a primeira ação destacada para começar agora. Para organizar arquivos e pastas, proponha uma estrutura simples com nomes e regras claras. Erros a evitar: listas enormes sem prioridade, conselhos genéricos de produtividade, planos que ignoram o tempo disponível.`,
  constraints: ['Não invente compromissos nem prazos que o usuário não informou.'],
};
