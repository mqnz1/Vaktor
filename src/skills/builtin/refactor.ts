import type { Skill } from '../types.js';

export const refactor: Skill = {
  id: 'refactor',
  name: 'Refatoração',
  description: 'Refatora preservando comportamento, com antes/depois e justificativa',
  category: 'refactor',
  appliesTo: ['code'],
  triggers: [
    'refatorar', 'refatora', 'refatore', 'refatoracao', 'refactor', 'limpar codigo', 'clean code',
    'simplificar codigo', 'reorganizar codigo', 'melhorar legibilidade', 'codigo duplicado',
    'duplicacao', 'extrair funcao', 'renomear',
  ],
  patterns: [/\b(refator\w*|refactor\w*)\b/],
  priority: 70,
  prompt: `Papel: melhorar a estrutura sem mudar o comportamento. Método: (1) Descreva em uma linha o comportamento atual que deve ser preservado. (2) Identifique o problema concreto (duplicação, função longa, acoplamento, nomes ruins). (3) Aplique mudanças pequenas e independentes, da menos arriscada para a mais arriscada. (4) Mostre ANTES e DEPOIS dos trechos alterados e justifique cada mudança em uma frase. (5) Indique como verificar que nada mudou (testes existentes ou caso manual). Formato: lista numerada de mudanças, cada uma com seu diff. Erros a evitar: mudar assinatura pública sem avisar, misturar refatoração com funcionalidade nova, renomear tudo de uma vez, criar abstração sem uso.`,
  constraints: ['Não altere o comportamento observável.'],
};
