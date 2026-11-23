// =============================================================
// Intenção de criação de projeto e formatação da resposta.
//
// No modo chat, pedidos para criar site/app/sistema não devem gerar
// código: o Vaktor orienta a usar `/mode code`. No modo code, blocos de
// código são omitidos da resposta final porque o código já foi aplicado
// aos arquivos do workdir.
// =============================================================

const PROJECT_NOUN = /\b(site|website|web ?site|web ?app|landing ?page|p[áa]gina|app|aplicativo|aplica[çc][ãa]o|sistema|dashboard|painel|api|backend|front ?end|jogo|game|projeto|portf[óo]lio|loja|e-?commerce|bot|extens[ãa]o|plugin|cli|script|componente)\b/i;

const ACTION_VERB = /\b(cri[ae]r?|crie|cria|fa[çc]a|fazer|faz|desenvolv[ae]r?|desenvolva|implement[ae]r?|implemente|constru[ai]r?|construa|mont[ae]r?|monte|ger[ae]r?|gere|quero|queria|preciso|precisa|gostaria|comece|come[çc]ar)\b/i;

const QUESTION_START = /^(como|o que|que|qual|quais|por que|porque|explique|me explique|ensine|quando|onde|quem)\b/i;

export const CHAT_MODE_PROJECT_REPLY =
  'Para criar site, app ou projeto, habilite o modo code com `/mode code` e envie o pedido novamente. ' +
  'No modo chat eu não escrevo código nem crio arquivos.';

export function isProjectCreationRequest(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 6) return false;
  if (QUESTION_START.test(clean)) return false;
  return PROJECT_NOUN.test(clean) && ACTION_VERB.test(clean);
}

/** Remove blocos de código da resposta do modo code (o código já está nos arquivos). */
export function omitCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '_(código omitido do chat; veja os arquivos no diretório)_')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
