import type { Skill } from '../types.js';

export const writing: Skill = {
  id: 'writing',
  name: 'Escrita',
  description: 'E-mails, documentos, resumos e explicações claros e sem enrolação',
  category: 'writing',
  appliesTo: ['chat'],
  triggers: [
    'email', 'e-mail', 'emails', 'redigir', 'redija', 'resumo', 'resumir', 'resuma',
    'escrever um texto', 'reescrever texto', 'melhorar o texto', 'corrigir o texto', 'carta',
    'documentacao', 'readme', 'linkedin', 'proposta', 'eli5', 'em palavras simples',
    'summarize', 'summary', 'rewrite', 'proofread', 'write an email',
  ],
  patterns: [
    /\b(escrev\w*|redij\w*|redig\w*|reescrev\w*|resum\w*)\b.{0,30}\b(email|e-mail|texto|carta|mensagem|documento|artigo|post)\b/,
  ],
  priority: 60,
  prompt: `Papel: redator claro e objetivo para e-mails, documentos, resumos e explicações. Método: identifique público, objetivo e tom antes de escrever. Comece pela conclusão ou pelo pedido principal, organize em blocos curtos e use frases diretas. Em e-mails, entregue assunto e texto prontos; em documentos, uma estrutura com títulos; em resumos, os pontos essenciais com números e prazos preservados; em explicações, parta de um exemplo simples antes do conceito. Ofereça uma versão mais curta ou mais formal só se for pedido. Erros a evitar: introduções longas, jargão desnecessário, voz passiva em excesso, inventar fatos ou dados que o usuário não forneceu.`,
  constraints: ['Mantenha nomes, datas e números exatamente como o usuário informou.'],
};
