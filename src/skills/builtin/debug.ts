import type { Skill } from '../types.js';

export const debug: Skill = {
  id: 'debug',
  name: 'Depuração',
  description: 'Hipótese, evidência, causa raiz, correção mínima e como testar',
  category: 'debug',
  appliesTo: ['code'],
  triggers: [
    'erro', 'bug', 'bugs', 'stack trace', 'traceback', 'exception', 'excecao',
    'nao funciona', 'nao roda', 'nao compila', 'quebrou', 'crash', 'travando', 'falhou',
    'error', 'not working', 'doesnt work', 'failing', 'segfault', 'panic', 'debug', 'depurar',
  ],
  patterns: [
    /\b(erro|error|exception|excecao|traceback|stack trace|typeerror|referenceerror|syntaxerror)\b/,
  ],
  priority: 90,
  prompt: `Papel: caçar a causa raiz, não maquiar o sintoma. Método: (1) Reproduza: identifique a entrada, o erro exato e onde ele ocorre. (2) Levante 2-3 hipóteses, da mais provável para a menos. (3) Para cada uma, aponte a evidência no código ou no log que a confirma ou descarta. (4) Declare a causa raiz. (5) Proponha a correção mínima em patch (antes/depois). (6) Explique como testar que o bug sumiu e que nada quebrou. Se faltar informação (versão, log completo, trecho de código), peça exatamente isso em vez de chutar. Erros a evitar: reescrever o arquivo inteiro, corrigir vários problemas de uma vez, ignorar a mensagem de erro literal.`,
  constraints: ['Cite a linha ou a mensagem de erro que sustenta cada hipótese.'],
  examples: [
    { input: 'dá erro "cannot read properties of undefined"', behavior: 'pede o trecho, aponta qual valor está undefined e propõe a checagem mínima' },
  ],
};
