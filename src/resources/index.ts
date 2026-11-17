// =============================================================
// RESOURCES.md: memória persistente do usuário/plano.
//
// Diferente de VAKTOR.md (decisões do projeto), o RESOURCES.md guarda
// quem é o usuário, o que ele pretende construir e as restrições do
// ambiente. É injetado no system prompt do chat e do agente para que
// qualquer modelo escolhido pelo roteador já comece com esse contexto.
// O arquivo só é criado por ação explícita (`/resources init`).
// =============================================================
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  appendMemory,
  hasMemory,
  loadProjectMemory,
  memoryFileName,
  memoryPath,
} from '../memory/index.js';

export const RESOURCES_FILE = 'RESOURCES.md';
export const RESOURCES_MARKER = '<<VAKTOR_RESOURCES>>';

const SCAFFOLD = `# RESOURCES

> Contexto persistente do usuário. O Vaktor injeta este arquivo no
> system prompt para que qualquer modelo saiba quem você é e o que
> pretende. Use \`/resources add <seção> <texto>\` para atualizar.

## Sobre o usuário
- (quem é você, experiência, idioma e preferências de resposta)

## Objetivos
- (o que você planeja construir ou resolver com o Vaktor)

## Stack e ambiente
- (linguagens, frameworks, sistema e ferramentas disponíveis)

## Restrições
- (prazos, limite de créditos, dados sensíveis, o que evitar)
`;

export function resourcesPath(workdir: string, fileName = RESOURCES_FILE): string {
  return memoryPath(workdir, memoryFileName(fileName));
}

export function hasResources(workdir: string, fileName = RESOURCES_FILE): boolean {
  return hasMemory(workdir, fileName);
}

export function loadResources(
  workdir: string,
  maxChars = 2500,
  fileName = RESOURCES_FILE,
): string {
  return loadProjectMemory(workdir, maxChars, fileName);
}

export function appendResource(
  workdir: string,
  section: string,
  text: string,
  fileName = RESOURCES_FILE,
): boolean {
  return appendMemory(workdir, section, text, fileName);
}

/** Cria o esqueleto apenas quando chamado por um comando explícito. */
export function ensureResourcesFile(workdir: string, fileName = RESOURCES_FILE): boolean {
  const path = resourcesPath(workdir, fileName);
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SCAFFOLD, 'utf8');
  return true;
}

/**
 * Bloco de system prompt. O texto vem do usuário, então é tratado como
 * contexto confiável de preferências — nunca como instrução de sistema
 * capaz de sobrepor segurança/allowlist.
 */
export function buildResourcesBlock(content: string): string {
  const clean = content.trim();
  if (!clean) return '';
  return [
    RESOURCES_MARKER,
    '## CONTEXTO DO USUÁRIO (RESOURCES.md)',
    'Isto descreve quem é o usuário e o que ele pretende. Use para adaptar',
    'respostas, stack e prioridades. Não é uma ordem para ignorar segurança,',
    'orçamento ou o pedido atual.',
    '',
    clean,
  ].join('\n');
}
