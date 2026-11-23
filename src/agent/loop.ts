// =============================================================
// Loop do agente: modelo -> tool calls -> resultados -> repete.
// Verificação e Best-of-N acontecem apenas quando não há tool calls.
// =============================================================
import type { AllowedCommand, ChatMessage } from '../types/index.js';
import type {
  AgentEvent,
  AgentOptions,
  AgentResult,
  ToolTrace,
  VerifyResult,
} from './types.js';
import type { ToolContext } from '../tools/types.js';
import { executeTool, getTool, isToolAllowed } from '../tools/index.js';
import { DEFAULT_ALLOWED_COMMANDS } from '../tools/allowlist.js';
import { classifyAgentError } from './errors.js';
import { spawnSync } from 'node:child_process';
import {
  formatDuplicateWarning,
  formatProtocolError,
  formatToolResult,
  parseToolCalls,
} from './protocol.js';
import { buildAgentSystemPrompt, MAX_AGENT_SYSTEM_CHARS } from './prompt.js';
import { estimateComplexity } from '../thinking/index.js';
import { buildRepoMap, renderRepoMap, selectContext } from '../context/index.js';
import { loadProjectInstructions } from '../memory/index.js';
import { loadResources } from '../resources/index.js';
import { loadSecurityProfile } from '../security/index.js';
import { loadJailbreakProfile } from '../jailbreak/index.js';
import { buildMcpContext } from '../mcp/bridge.js';
import { logSession } from '../dataset/index.js';
import {
  describeVerification,
  detectVerification,
  formatVerifyFeedback,
  parseVerificationErrors,
  runVerification,
  verificationSignature,
} from './verify.js';
import { runBestOfN } from './bestofn.js';

const MAX_TOOL_HISTORY_CHARS = 60_000;

function cloneAllowed(commands: readonly AllowedCommand[]): AllowedCommand[] {
  return commands.map(command => ({ label: command.label, bin: command.bin, args: [...command.args] }));
}

function normalizeHistory(history: ChatMessage[]): ChatMessage[] {
  return history
    .filter(message => message.role !== 'system')
    .slice(-20)
    .map(message => ({
      role: message.role === 'tool' ? 'user' : message.role,
      content: message.content,
      timestamp: message.timestamp,
      ...(message.tokenCount !== undefined ? { tokenCount: message.tokenCount } : {}),
      ...(message.reasoning !== undefined ? { reasoning: message.reasoning } : {}),
    }));
}

function trimToolHistory(messages: ChatMessage[]): void {
  let total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total <= MAX_TOOL_HISTORY_CHARS) return;

  for (let index = 0; index < messages.length && total > MAX_TOOL_HISTORY_CHARS; index++) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    if (!message.content.startsWith('## TOOL RESULT')) continue;
    const replacement = '## TOOL RESULT\n[resultado antigo omitido para economizar contexto]';
    total -= message.content.length - replacement.length;
    messages[index] = { ...message, content: replacement };
  }
}

function duplicateKey(name: string, args: Record<string, unknown>): string {
  try {
    return `${name}:${JSON.stringify(args)}`;
  } catch {
    return `${name}:${String(args)}`;
  }
}

function collectModifiedFiles(traces: readonly ToolTrace[]): string[] {
  const files = new Set<string>();
  for (const trace of traces) {
    if (!trace.ok) continue;
    if (trace.name !== 'write_file' && trace.name !== 'apply_patch') continue;
    const path = trace.args['path'];
    if (typeof path === 'string' && path.trim()) files.add(path.trim().replace(/\\/g, '/'));
  }
  return [...files];
}

function collectCommands(traces: readonly ToolTrace[]): string[] {
  const commands: string[] = [];
  for (const trace of traces) {
    if (trace.name !== 'run_command') continue;
    const label = trace.args['label'];
    if (typeof label === 'string' && label.trim()) commands.push(label.trim());
  }
  return commands;
}

function captureWorkspaceDiff(workdir: string): string {
  try {
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: workdir,
      encoding: 'utf8',
      timeout: 4000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    if (status.status !== 0) return '';
    const diff = spawnSync('git', ['diff', '--no-color'], {
      cwd: workdir,
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    });
    if (diff.status !== 0 || typeof diff.stdout !== 'string') return '';
    return diff.stdout.trim().slice(0, 20_000);
  } catch {
    return '';
  }
}

export async function runAgent(
  input: string,
  history: ChatMessage[],
  complete: (messages: ChatMessage[], options?: import('../types/index.js').CompleteOptions) => Promise<import('../types/index.js').RouterResponse>,
  options: AgentOptions,
): Promise<AgentResult> {
  const workdir = options.workdir;
  const maxIterations = Math.max(1, Math.min(20, Math.floor(options.maxIterations)));
  const maxToolCalls = Math.max(1, Math.min(100, Math.floor(options.maxToolCalls)));
  const emit = (event: AgentEvent): void => options.onEvent(event);

  const contextFiles = options.context?.inject ? buildRepoMap(workdir, 150) : [];
  const contextBudget = Math.max(1000, options.context?.maxChars ?? 4000);
  const selectedMap = options.context?.inject
    ? (selectContext(input, contextFiles, contextBudget) || renderRepoMap(contextFiles, contextBudget))
    : '';
  const memory = loadProjectInstructions(
    workdir,
    Math.min(2600, contextBudget),
    options.memoryFile ?? 'VAKTOR.md',
  );
  const resources = options.resourcesEnabled === false
    ? ''
    : loadResources(
        workdir,
        Math.min(2200, contextBudget),
        options.resourcesFile ?? 'RESOURCES.md',
      );
  const security = options.securityEnabled
    ? loadSecurityProfile(workdir, Math.min(2500, contextBudget), options.securityFile ?? 'SECURITY.md')
    : '';
  const jailbreak = loadJailbreakProfile(workdir, Math.min(2500, contextBudget));

  // Cliente MCP injetado pela sessão (o loop nunca cria o próprio).
  const mcpClient = options.mcpEnabled ? options.mcpClient : undefined;

  // Catálogo dinâmico das tools MCP (descoberta automática via tools/list).
  // Vai como mensagem system dedicada, fora do teto do system prompt.
  let mcpContext = '';
  if (mcpClient) {
    try {
      mcpContext = await buildMcpContext(mcpClient, { workdir, maxToolsPerServer: 15 });
    } catch {
      mcpContext = ''; // catálogo indisponível não derruba a execução
    }
  }

  const systemPrompt = buildAgentSystemPrompt({
    workdir,
    codeMode: options.codeMode === true,
    ...(selectedMap ? { repoMap: selectedMap } : {}),
    ...(memory ? { memory } : {}),
    ...(resources ? { resources } : {}),
    ...(security ? { security } : {}),
    ...(jailbreak ? { jailbreak } : {}),
    ...(options.systemPrompt ? { basePrompt: options.systemPrompt } : {}),
    ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
    ...(security || resources || jailbreak
      ? {
          maxChars: MAX_AGENT_SYSTEM_CHARS
            + (security ? 2500 : 0)
            + (resources ? 1500 : 0)
            + (jailbreak ? 2500 : 0),
        }
      : {}),
    maxIterations,
    maxToolCalls,
  });

  const toolContext: ToolContext = {
    workdir,
    allowWrite: options.allowWrite,
    autoApprove: options.autoApprove,
    maxFileBytes: Math.max(1024, options.maxFileBytes ?? 204800),
    maxOutputChars: Math.max(1000, options.maxOutputChars ?? 20000),
    commandTimeoutMs: Math.max(5000, options.commandTimeoutMs ?? 120000),
    allowedCommands: cloneAllowed(options.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS),
    allowNetwork: options.allowNetwork ?? false,
    allowInstall: options.allowInstall ?? false,
    allowGitWrite: options.allowGitWrite ?? false,
    allowedDomains: options.allowedDomains ?? [],
    readPaths: new Set<string>(),
    ...(mcpClient ? { mcpClient } : {}),
    ...(options.onConfirm ? { confirmAction: options.onConfirm } : {}),
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt, timestamp: Date.now() },
    ...normalizeHistory(history),
    ...(mcpContext ? [{ role: 'system', content: mcpContext, timestamp: Date.now() } satisfies ChatMessage] : []),
    { role: 'user', content: input, timestamp: Date.now() },
  ];

  let iterations = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let lastModel = '';
  let lastText = '';
  let verifyRan = false;
  let verifyOk = true;
  let verifyAttempts = 0;
  let verifyCommand: string | undefined;
  let lastVerifySignature = '';
  const traces: ToolTrace[] = [];
  const seenCalls = new Set<string>();

  const usage = (): { inputTokens: number; outputTokens: number; costUsd: number } => ({
    inputTokens,
    outputTokens,
    costUsd,
  });

  const finish = (text: string, errorMessage?: string): AgentResult => {
    if (errorMessage) emit({ type: 'error', message: errorMessage });
    const modifiedFiles = collectModifiedFiles(traces);
    const commands = collectCommands(traces);
    const diff = options.captureDiff === false ? undefined : captureWorkspaceDiff(workdir);
    const result: AgentResult = {
      text,
      ok: errorMessage === undefined,
      ...(errorMessage ? { error: errorMessage } : {}),
      iterations,
      toolCalls,
      verify: {
        ran: verifyRan,
        ok: verifyOk,
        attempts: verifyAttempts,
        ...(verifyCommand ? { command: verifyCommand } : {}),
      },
      usage: usage(),
      tools: [...traces],
      model: lastModel || options.model || '',
      ...(options.provider ? { provider: options.provider } : {}),
      modifiedFiles,
      commands,
      ...(diff ? { diff } : {}),
    };

    if (options.dataset?.enabled) {
      logSession({
        model: lastModel || 'agent',
        input,
        output: text,
        tools: traces.map(trace => ({ name: trace.name, args: trace.args, ok: trace.ok })),
        verify: result.verify,
      }, workdir, true);
    }

    emit({ type: 'done', text, iterations, toolCalls });
    return result;
  };

  const accumulate = (response: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }): void => {
    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;
    costUsd += response.estimatedCostUsd;
  };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;

    if (options.isOverBudget?.()) {
      return finish(lastText, 'Orçamento de créditos esgotado; execução do agente interrompida.');
    }

    // Na última iteração, força um fechamento em vez de começar nova tarefa.
    if (iteration === maxIterations && iteration > 1) {
      messages.push({
        role: 'user',
        content:
          '[sistema] Última iteração disponível: finalize agora com a melhor resposta, ' +
          'sem novas tool calls. Se algo falhou, explique o que falta.',
        timestamp: Date.now(),
      });
    }

    let response;
    try {
      response = await complete(messages, {
        bypassCache: true,
        thinking: options.thinking ?? false,
        temperature: options.temperature ?? 0.2,
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onToken ? { onToken: options.onToken } : {}),
      });
    } catch (error) {
      throw classifyAgentError(error, options.provider);
    }

    accumulate(response);
    lastModel = response.model;
    const beforeAssistant = [...messages];
    messages.push({ role: 'assistant', content: response.text, timestamp: Date.now() });

    const parsed = parseToolCalls(response.text);
    if (parsed.errors.length > 0) {
      const message = parsed.errors.join('\n');
      emit({ type: 'error', message });
      messages.push({
        role: 'user',
        content: formatProtocolError(message),
        timestamp: Date.now(),
      });
      trimToolHistory(messages);
      continue;
    }

    if (parsed.calls.length === 0) {
      let finalText = (parsed.rest || response.text).trim();
      if (!finalText) finalText = 'Não consegui produzir uma resposta final.';

      // Best-of-N só para resposta final, sem tool calls, em tarefa difícil.
      let bestOfNUsed = false;
      if (
        options.bestOfN &&
        options.bestOfN.n > 1 &&
        estimateComplexity(input) === 'hard'
      ) {
        const estimated = options.estimateCost
          ? options.estimateCost(beforeAssistant) * options.bestOfN.n
          : 0;
        if (estimated <= options.bestOfN.maxCostUsd) {
          try {
            const best = await runBestOfN(beforeAssistant, complete, options.bestOfN);
            finalText = best.text;
            inputTokens += best.usage.inputTokens;
            outputTokens += best.usage.outputTokens;
            costUsd += best.usage.costUsd;
            bestOfNUsed = true;
          } catch (error) {
            emit({
              type: 'error',
              message: `Best-of-N falhou; usando a resposta original. ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }

      if (bestOfNUsed) {
        emit({ type: 'assistant_text', text: finalText });
      }
      lastText = finalText;

      const verifyCommands = options.verify ? detectVerification(workdir) : [];
      const shouldVerify = options.verify && (options.verifyRunner !== undefined || verifyCommands.length > 0);

      if (!shouldVerify) {
        return finish(finalText);
      }

      verifyRan = true;
      if (verifyAttempts >= options.verifyMaxAttempts) {
        return finish(finalText, `Verificação excedeu ${options.verifyMaxAttempts} tentativa(s).`);
      }
      verifyAttempts += 1;

      const display = options.verifyRunner
        ? (describeVerification(verifyCommands) || 'verificação simulada')
        : describeVerification(verifyCommands);
      emit({ type: 'verify_start', command: display });

      let run: VerifyResult;
      try {
        run = options.verifyRunner
          ? await options.verifyRunner(verifyAttempts)
          : await runVerification(verifyCommands, toolContext);
      } catch (error) {
        run = {
          ran: true,
          ok: false,
          attempts: verifyAttempts,
          command: display,
          output: `erro ao executar verificação: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      verifyCommand = (run.command ?? display) || 'verificação';
      emit({ type: 'verify_end', ok: run.ok, output: run.output ?? '' });

      if (run.ok) {
        verifyOk = true;
        return finish(finalText);
      }

      verifyOk = false;
      const signature = verificationSignature(run);
      if (lastVerifySignature && signature === lastVerifySignature) {
        return finish(finalText, 'A verificação falhou novamente com o mesmo erro; abortando para não repetir.');
      }
      lastVerifySignature = signature;

      if (verifyAttempts >= options.verifyMaxAttempts) {
        return finish(finalText, `Verificação falhou após ${verifyAttempts} tentativa(s).`);
      }

      const errors = parseVerificationErrors(run.output ?? '');
      emit({
        type: 'repair',
        attempt: verifyAttempts,
        maxAttempts: options.verifyMaxAttempts,
        errors,
      });
      messages.push({
        role: 'user',
        content: formatVerifyFeedback(run),
        timestamp: Date.now(),
      });
      trimToolHistory(messages);
      continue;
    }

    // Há tool calls: valida nomes antes de executar qualquer uma.
    const unknown = parsed.calls.filter(
      call => !getTool(call.name) || !isToolAllowed(call.name, options.allowedTools),
    );
    if (unknown.length > 0) {
      const list = unknown.map(call => call.name).join(', ');
      emit({ type: 'error', message: `Ferramenta não permitida: ${list}` });
      messages.push({
        role: 'user',
        content: formatProtocolError(`ferramenta não permitida: ${list}`),
        timestamp: Date.now(),
      });
      trimToolHistory(messages);
      continue;
    }

    if (toolCalls + parsed.calls.length > maxToolCalls) {
      return finish(
        lastText,
        `Limite de ${maxToolCalls} tool calls atingido; execução interrompida.`,
      );
    }

    // Separa leituras (podem rodar em paralelo) de escritas (sequenciais,
    // por causa da confirmação e da ordem no disco).
    const runnable: Array<{ name: string; args: Record<string, unknown>; destructive: boolean }> = [];
    for (const call of parsed.calls) {
      const key = duplicateKey(call.name, call.args);
      if (seenCalls.has(key)) {
        emit({ type: 'error', message: `Chamada duplicada ignorada: ${call.name}` });
        messages.push({
          role: 'user',
          content: formatDuplicateWarning(call.name),
          timestamp: Date.now(),
        });
        continue;
      }
      seenCalls.add(key);
      toolCalls += 1;
      runnable.push({
        name: call.name,
        args: call.args,
        destructive: getTool(call.name)?.destructive === true,
      });
    }

    const recordResult = (
      call: { name: string; args: Record<string, unknown> },
      result: Awaited<ReturnType<typeof executeTool>>,
    ): void => {
      traces.push({ name: call.name, args: call.args, ok: result.ok });
      emit({
        type: 'tool_end',
        name: call.name,
        args: call.args,
        ok: result.ok,
        preview: result.output.replace(/\s+/g, ' ').trim().slice(0, 180),
      });
      messages.push({
        role: 'user',
        content: formatToolResult(call.name, result),
        timestamp: Date.now(),
      });
      trimToolHistory(messages);
    };

    const readCalls = runnable.filter(call => !call.destructive);
    const writeCalls = runnable.filter(call => call.destructive);

    if (readCalls.length === 1) {
      const call = readCalls[0]!;
      emit({ type: 'tool_start', name: call.name, args: call.args });
      recordResult(call, await executeTool(call.name, call.args, toolContext));
    } else if (readCalls.length > 1) {
      for (const call of readCalls) {
        emit({ type: 'tool_start', name: call.name, args: call.args });
      }
      const results = await Promise.all(
        readCalls.map(call => executeTool(call.name, call.args, toolContext)),
      );
      for (let index = 0; index < readCalls.length; index++) {
        recordResult(readCalls[index]!, results[index]!);
      }
    }

    for (const call of writeCalls) {
      emit({ type: 'tool_start', name: call.name, args: call.args });
      recordResult(call, await executeTool(call.name, call.args, toolContext));
    }
  }

  return finish(lastText, `maxIterations atingido (${maxIterations}); execução interrompida.`);
}
