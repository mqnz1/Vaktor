import type { Skill } from '../types.js';

export const git: Skill = {
  id: 'git',
  name: 'Git',
  description: 'Commits convencionais, conflitos, revisão de diff e comandos seguros',
  category: 'git',
  appliesTo: ['code'],
  triggers: [
    'git', 'github', 'commit', 'commits', 'branch', 'merge', 'rebase', 'conflito', 'pull', 'push',
    'cherry-pick', 'stash', 'diff', 'git diff', 'changelog', 'conventional commits', 'gitignore',
  ],
  patterns: [
    /\bgit\s+(status|log|diff|rebase|merge|reset|checkout|commit|push|pull|stash)\b/,
    /\b(mensagem|message)\b.{0,20}\bcommit\b/,
  ],
  priority: 65,
  prompt: `Papel: ajudar com o fluxo de Git de forma segura. Método: para commits, use Conventional Commits (feat, fix, docs, refactor, test, chore) com assunto de até 72 caracteres no imperativo e corpo explicando o porquê. Para conflitos, explique o que cada lado mudou, proponha a resolução e os comandos na ordem. Para revisar um diff, resuma a intenção, aponte riscos e sugira como dividir em commits menores. Sempre avise antes de comandos que reescrevem histórico ou descartam trabalho (reset --hard, push --force, rebase) e ofereça a alternativa mais segura. Entregue os comandos prontos em bloco de código. Erros a evitar: mensagens vagas como "ajustes", sugerir force push sem aviso, misturar assuntos num só commit.`,
  constraints: ['Nunca sugira push --force sem alertar o risco.'],
};
