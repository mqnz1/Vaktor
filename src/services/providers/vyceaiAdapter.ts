// Caminho de compatibilidade com a especificação
// (`src/services/providers/vyceaiAdapter.ts`): o adaptador real vive em
// `src/providers/vyceai.ts`, junto dos demais provedores do Vaktor.
export {
  VYCEAI_MODELS,
  getVyceAIModelById,
  normalizeVyceAIModelId,
  sendToVyceAI,
} from '../../providers/vyceai.js';
