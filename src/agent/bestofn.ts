// =============================================================
// Best-of-N para a RESPOSTA FINAL (nunca para execuções com tools).
//
// 1. gera N candidatas em paralelo (temperaturas 0.2/0.5/0.8);
// 2. um crítico pontua cada candidata de 0 a 10;
// 3. candidata que passa na verificação vence o score;
// 4. empate: primeira candidata.
// =============================================================
import type { ChatMessage } from '../types/index.js';
import type { BestOfNOptions, CompleteFn } from './types.js';

const TEMPERATURES = [0.2, 0.5, 0.8] as const;

export interface BestOfNResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

interface ScoredCandidate {
  index: number;
  text: string;
  score: number;
  verified: boolean | null;
}

function parseScore(text: string): number {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return 0;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
    const score = (parsed as Record<string, unknown>)['score'];
    if (typeof score !== 'number' || !Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(10, score));
  } catch {
    return 0;
  }
}

function criticPrompt(original: string, candidate: string): ChatMessage[] {
  const timestamp = Date.now();
  return [
    {
      role: 'system',
      content: [
        'Você é um crítico rigoroso de engenharia de software.',
        'Avalie a candidata de 0 a 10 considerando correção, completude, segurança e clareza.',
        'Responda SOMENTE com JSON válido em uma linha: {"score":0-10,"reason":"...","issues":["..."]}',
        'Não use markdown, não escreva nada fora do JSON.',
      ].join('\n'),
      timestamp,
    },
    {
      role: 'user',
      content: `Pergunta original:\n${original}\n\nCandidata:\n${candidate}`,
      timestamp,
    },
  ];
}

export async function runBestOfN(
  messages: ChatMessage[],
  complete: CompleteFn,
  options: BestOfNOptions,
): Promise<BestOfNResult> {
  const n = Math.max(1, Math.min(5, Math.floor(options.n)));
  if (n <= 1) {
    const response = await complete(messages, { bypassCache: true, thinking: false });
    return {
      text: response.text,
      usage: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: response.estimatedCostUsd,
      },
    };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  const requests = Array.from({ length: n }, (_, index) => complete(messages, {
    bypassCache: true,
    thinking: false,
    temperature: TEMPERATURES[index % TEMPERATURES.length] ?? 0.5,
  }));

  const settled = await Promise.allSettled(requests);
  const candidates: string[] = [];
  const failures: string[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      inputTokens += result.value.inputTokens;
      outputTokens += result.value.outputTokens;
      costUsd += result.value.estimatedCostUsd;
      candidates.push(result.value.text);
    } else {
      failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  if (candidates.length === 0) {
    throw new Error(`Best-of-N: todas as candidatas falharam. ${failures.join(' | ')}`);
  }

  const original = [...messages].reverse().find(message => message.role === 'user')?.content ?? '';

  const verified: (boolean | null)[] = await Promise.all(candidates.map(async candidate => {
    if (!options.verifyCandidate) return null;
    try {
      return await options.verifyCandidate(candidate);
    } catch {
      return false;
    }
  }));

  const scored: ScoredCandidate[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index] ?? '';
    let score = 0;
    try {
      const response = await complete(criticPrompt(original, candidate), {
        bypassCache: true,
        thinking: false,
        temperature: 0,
        ...(options.criticModel ? { model: options.criticModel } : {}),
      });
      inputTokens += response.inputTokens;
      outputTokens += response.outputTokens;
      costUsd += response.estimatedCostUsd;
      score = parseScore(response.text);
    } catch {
      score = 0;
    }
    scored.push({ index, text: candidate, score, verified: verified[index] ?? null });
  }

  const verifiedCandidates = scored.filter(candidate => candidate.verified === true);
  const pool = verifiedCandidates.length > 0 ? verifiedCandidates : scored;
  pool.sort((a, b) => b.score - a.score || a.index - b.index);

  const winner = pool[0];
  if (!winner) {
    throw new Error('Best-of-N: nenhuma candidata pôde ser escolhida');
  }

  return {
    text: winner.text,
    usage: { inputTokens, outputTokens, costUsd },
  };
}
