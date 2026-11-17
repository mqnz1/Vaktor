// Caminho de compatibilidade com a especificação
// (`src/services/providers/deepaiAdapter.ts`): o adaptador real vive em
// `src/providers/deepai.ts`, junto dos demais provedores do Vaktor.
export {
  DEEPAI_MODELS,
  getDeepaiModelById,
  normalizeDeepaiModelId,
  sendToDeepAI,
} from '../../providers/deepai.js';
