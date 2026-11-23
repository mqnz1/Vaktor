// Comandos do prompt e filtro do autocomplete.
// O App usa isto para calcular a altura do menu no MESMO render em que o
// InputBar o desenha — reportar a altura depois (via effect) cria um frame
// mais alto que o terminal, e o Ink dessincroniza a tela nesse frame.
export interface PromptCommand {
  cmd: string;
  desc: string;
}

export const COMMANDS: PromptCommand[] = [
  { cmd: '/mode', desc: 'Alternar chat/código' },
  { cmd: '/models', desc: 'Selecionar modelo (/models free lista grátis)' },
  { cmd: '/free', desc: 'Provedores grátis e seleção de modelos' },
  { cmd: '/provider', desc: 'Cadastrar provider customizado (API compatível)' },
  { cmd: '/combo', desc: 'Combo ponderado (on/off/status/set)' },
  { cmd: '/orquestrator', desc: 'Orquestrador de agentes (planner + workers)' },
  { cmd: '/new', desc: 'Nova sessão com histórico limpo' },
  { cmd: '/sessions', desc: 'Sessões de conversa' },
  { cmd: '/directory', desc: 'Diretório de trabalho (/directory <caminho>)' },
  { cmd: '/credits', desc: 'Créditos' },
  { cmd: '/skills', desc: 'Skills on/off e lista' },
  { cmd: '/thinking', desc: 'Raciocínio manual (on/off/auto)' },
  { cmd: '/agent', desc: 'Agente manual (on/off)' },
  { cmd: '/context', desc: 'Mapa do repositório' },
  { cmd: '/memory', desc: 'Memória do projeto (show/add/path)' },
  { cmd: '/resources', desc: 'Contexto do usuário (RESOURCES.md)' },
  { cmd: '/exit', desc: 'Sair' },
];

export function filterCommands(value: string): PromptCommand[] {
  if (!value.startsWith('/')) return [];
  const lower = value.toLowerCase();
  return COMMANDS.filter(c => c.cmd.startsWith(lower));
}
