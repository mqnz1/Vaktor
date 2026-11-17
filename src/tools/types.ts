// =============================================================
// Contratos das ferramentas do agente
// =============================================================
import type { AllowedCommand } from '../types/index.js';
import type { PendingConfirm } from '../agent/types.js';
import type { McpClient } from '../mcp/client.js';
import type { McpProgressEvent } from '../mcp/types.js';

export interface ToolResult {
  ok: boolean;
  output: string;
  meta?: {
    exitCode?: number;
    matches?: number;
    bytes?: number;
  };
}

export interface ToolContext {
  workdir: string;
  allowWrite: boolean;
  autoApprove: boolean;
  maxFileBytes: number;
  maxOutputChars: number;
  commandTimeoutMs: number;
  allowedCommands: AllowedCommand[];
  // Capacidades extras (ver AgentConfig).
  allowNetwork: boolean;
  allowInstall: boolean;
  allowGitWrite: boolean;
  allowedDomains: string[];
  // Arquivos lidos nesta execução. Escrita só é permitida depois da leitura.
  readPaths: Set<string>;
  // Cliente MCP (injetado pela sessão quando MCP_ENABLED=true).
  mcpClient?: McpClient;
  // Restringe quais servidores MCP podem ser usados (padrão: todos os habilitados).
  mcpAllowedServers?: string[];
  // Progresso de chamadas MCP longas (notificações do servidor).
  onMcpProgress?: (event: McpProgressEvent) => void;
  // Confirmação da UI. Obrigatória para ações irreversíveis.
  confirmAction?: (pending: PendingConfirm) => Promise<boolean>;
}

export interface ToolSpec {
  name: string;
  description: string;
  // Nome do parâmetro -> descrição curta. Renderizado no system prompt.
  parameters: Record<string, string>;
  destructive: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}
