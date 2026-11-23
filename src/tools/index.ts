// =============================================================
// Registro central de ferramentas do agente
// =============================================================
import type { ToolContext, ToolResult, ToolSpec } from './types.js';
import { applyPatchTool, listDirTool, readFileTool, writeFileTool } from './fs.js';
import { searchTool } from './search.js';
import { gitDiffTool, gitStatusTool, runCommandTool } from './shell.js';
import { webFetchTool, webSearchTool } from './web.js';
import { npmInstallTool } from './packages.js';
import { createPrTool, gitCommitTool } from './git.js';
import { mcpCallTool } from '../mcp/bridge.js';
import { truncateOutput } from './fs.js';

export type { ToolContext, ToolResult, ToolSpec } from './types.js';

export const TOOLS: readonly ToolSpec[] = [
  listDirTool,
  readFileTool,
  writeFileTool,
  applyPatchTool,
  searchTool,
  runCommandTool,
  gitStatusTool,
  gitDiffTool,
  webFetchTool,
  webSearchTool,
  npmInstallTool,
  gitCommitTool,
  createPrTool,
  mcpCallTool,
];

export function getTool(name: string): ToolSpec | undefined {
  return TOOLS.find(tool => tool.name === name);
}

export function getToolSpecs(): readonly ToolSpec[] {
  return TOOLS;
}

export function isToolAllowed(name: string, allowed?: readonly string[]): boolean {
  return allowed === undefined || allowed.includes(name);
}

export function getAllowedToolSpecs(allowed?: readonly string[]): readonly ToolSpec[] {
  if (allowed === undefined) return TOOLS;
  const set = new Set(allowed);
  return TOOLS.filter(tool => set.has(tool.name));
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, output: `ferramenta desconhecida: ${name}` };
  }

  try {
    const result = await tool.run(args, ctx);
    return {
      ...result,
      output: truncateOutput(result.output, ctx.maxOutputChars, 'start'),
    };
  } catch (error) {
    return {
      ok: false,
      output: `erro na ferramenta ${name}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function formatToolCatalog(allowed?: readonly string[]): string {
  return getAllowedToolSpecs(allowed).map(tool => {
    const params = Object.entries(tool.parameters)
      .map(([key, description]) => `${key}: ${description}`)
      .join('; ');
    return `### ${tool.name}\n${tool.description}\nargs: ${params || '(nenhum)'}`;
  }).join('\n');
}

export function toolsSummary(): string {
  return `${TOOLS.length} ferramentas: ${TOOLS.map(tool => tool.name).join(', ')}`;
}

export function describeTools(): string[] {
  return TOOLS.map(tool => `${tool.name}${tool.destructive ? ' [escrita]' : ''} — ${tool.description}`);
}
