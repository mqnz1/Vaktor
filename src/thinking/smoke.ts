// Teste de fumaça: npx tsx src/thinking/smoke.ts
// Exige que buildCacheKey esteja exportado em src/router/cache.ts (ver INTEGRACAO-THINKING.md)
import { buildCacheKey } from '../router/cache.js';
import type { ChatMessage } from '../types/index.js';
import {
  buildReasoningParts, cacheVariant, cleanReasoning, finalizeThinking, footerLabel,
  formatReasoningForDisplay, listThinkingVariants, normalizeThinkingConfig, parseThinkingCommand,
  parseThinkingEffort, prepareThinking, reasoningTextOf, supportsNativeReasoning,
  toThinkingOptions, upsertBlock, upsertBlockAtStart,
} from './index.js';
import type { ThinkingConfig, ThinkingPlan } from './index.js';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'OK    ' : 'FALHOU'} ${name}${detail ? ` → ${detail}` : ''}`);
}

const base: ThinkingConfig = {
  enabled: true, mode: 'auto', minComplexity: 'normal', budgetTokens: 8000, maxPasses: 1, show: false,
};
const plain = (input: string, cfg: ThinkingConfig = base, enabled = true): ThinkingPlan =>
  prepareThinking(input, 'gpt-4o-mini', 'openrouter', cfg, enabled);

const trace = [
  'TypeError: x is undefined',
  '    at foo (src/a.ts:10:5)',
  '    at bar (src/b.ts:2:1)',
  'Requisitos:',
  '- manter a API',
  '- não quebrar os testes',
  '- sem dependências novas',
  'corrige isso',
].join('\n');

console.log('--- classificação e estratégia ---');
check('oi (auto) → none', plain('oi').strategy === 'none');
check('ok (auto) → none', plain('ok').strategy === 'none');
check('explica o que é closure (auto) → scratchpad', plain('explica o que é closure').strategy === 'scratchpad');
check('refatora esse arquivo (auto) → scratchpad', plain('refatora esse arquivo').strategy === 'scratchpad');
check('stack trace + 3 requisitos (auto) → scratchpad', plain(trace).strategy === 'scratchpad');
check('stack trace + maxPasses=2 → two-pass', plain(trace, { ...base, maxPasses: 2 }).strategy === 'two-pass');
check('qualquer entrada com mode off → none', plain(trace, { ...base, mode: 'off' }).strategy === 'none');
check('enabled=false → none', plain(trace, base, false).strategy === 'none');
check('provedor não é confundido com "prove"', plain('qual provedor uso?').complexity === 'normal');
check('always + trivial + não nativo → scratchpad curto',
  (() => { const p = plain('oi', { ...base, mode: 'always' }); return p.strategy === 'scratchpad' && p.directive.length < 300; })());
check('directive ≤ 700 caracteres e com marcador',
  (() => { const d = plain(trace).directive; return d.length <= 700 && d.startsWith('## MODO THINKING'); })());
check('two-pass: passes=2 e diretiva pede só o plano',
  (() => { const p = plain(trace, { ...base, maxPasses: 2 }); return p.passes === 2 && p.directive.includes('Do NOT write the final answer'); })());

console.log('--- nativo ---');
const r1 = prepareThinking('explica closures', 'deepseek/deepseek-r1', 'openrouter', { ...base, mode: 'always' }, true);
check('deepseek-r1 + always → native, directive vazia', r1.strategy === 'native' && r1.directive === '');
const r1hard = prepareThinking(trace, 'deepseek-r1', 'openrouter', { ...base, maxPasses: 2 }, true);
check('nativo nunca vira two-pass', r1hard.strategy === 'native');
check('gpt-5 nativo', supportsNativeReasoning('openai/gpt-5', 'openrouter'));
check('claude-sonnet-4.5 via openrouter é nativo', supportsNativeReasoning('anthropic/claude-sonnet-4.5', 'openrouter'));
check('claude via proxygatellm não é nativo (sem parâmetro)', !supportsNativeReasoning('claude-sonnet-4.5', 'proxygatellm'));
check('gemini-2.5 via puter não é nativo (scratchpad)', !supportsNativeReasoning('gemini-2.5-pro', 'puter'));
check('claude via puter não é nativo (scratchpad visível)', !supportsNativeReasoning('claude-sonnet-5', 'puter'));
check('gpt-4o não é nativo', !supportsNativeReasoning('openai/gpt-4o', 'openrouter'));

console.log('--- parsing ---');
const sp = plain('explica closures');
const f = (t: string, native?: string) => finalizeThinking(t, native, sp, true);
const p1 = f('<thinking>a</thinking>\nresposta');
check('1) bloco fechado', p1.reasoning === 'a' && p1.answer === 'resposta', JSON.stringify(p1));
const p2 = f('<thinking>a');
check('2) bloco aberto → answer não vazio', p2.answer.length > 0 && !p2.answer.includes('<'), JSON.stringify(p2));
const p3 = f('só texto');
check('3) sem tags', p3.reasoning === '' && p3.answer === 'só texto');
const p4 = f('```thinking\nplanejando\n```\nresposta');
check('4) fence thinking', p4.reasoning === 'planejando' && p4.answer === 'resposta', JSON.stringify(p4));
const p5 = f('<thinking>x</thinking>\nresposta', 'raciocínio nativo');
check('5) nativo tem prioridade', p5.reasoning === 'raciocínio nativo' && p5.answer === 'resposta');
const p6 = f('pensando...</think>resposta final');
check('extra) </think> órfão (R1)', p6.answer === 'resposta final' && p6.reasoning === 'pensando...', JSON.stringify(p6));
const p7 = finalizeThinking('<thinking>a</thinking>\nok', undefined, sp, false);
check('show=false esconde o raciocínio, mas conta os caracteres', p7.reasoning === '' && p7.reasoningChars === 1 && p7.answer === 'ok');
const off = plain('oi');
check('strategy none devolve o texto intocado',
  finalizeThinking('<thinking>a</thinking> oi', undefined, off, true).answer === '<thinking>a</thinking> oi');

console.log('--- cache ---');
const msgs: ChatMessage[] = [{ role: 'user', content: 'mesma mensagem', timestamp: Date.now() }];
const kPlain = buildCacheKey(msgs, 'm', 'plain');
const kThink = buildCacheKey(msgs, 'm', 'thinking:scratchpad:normal:8000');
check('variantes → chaves diferentes', kPlain !== kThink, `${kPlain} vs ${kThink}`);
check('cacheVariant none = plain', cacheVariant(off) === 'plain');
check('cacheVariant scratchpad inclui estratégia e orçamento', cacheVariant(sp) === 'thinking:scratchpad:normal:8000', cacheVariant(sp));

console.log('--- variantes de esforço ---');
check('parseThinkingEffort aceita high', parseThinkingEffort('HIGH') === 'high');
check('parseThinkingEffort rejeita inválido', parseThinkingEffort('turbo') === undefined);
check('gpt-5 via openrouter expõe xhigh', listThinkingVariants('openai/gpt-5', 'openrouter').includes('xhigh'));
check('gemini-2.5 nativo expõe high/max', listThinkingVariants('gemini-2.5-pro', 'gemini').join(',') === 'high,max');
check('gpt-4o não expõe variantes', listThinkingVariants('gpt-4o', 'openrouter').length === 0);
check('proxygatellm não expõe variantes', listThinkingVariants('gpt-5', 'proxygatellm').length === 0);
const variantCfg = normalizeThinkingConfig({ ...base, variant: 'high' });
check('config normaliza variante', variantCfg.variant === 'high');
check('variante inválida é descartada', normalizeThinkingConfig({ ...base, variant: 'turbo' }).variant === undefined);
const variantPlan = prepareThinking('explica closures', 'gpt-5', 'openrouter', variantCfg, true);
check('plano carrega a variante', variantPlan.variant === 'high');
check('toThinkingOptions usa a variante', toThinkingOptions(variantPlan)?.variant === 'high' && toThinkingOptions(variantPlan)?.effort === 'high');
check('cacheVariant inclui a variante', cacheVariant(variantPlan).endsWith(':high'), cacheVariant(variantPlan));
const parts = buildReasoningParts('passo 1\n[REDACTED]\npasso 2', { startedAt: 100, endedAt: 250 });
check('buildReasoningParts remove [REDACTED]', parts.length === 1 && !parts[0]!.text.includes('[REDACTED]'), JSON.stringify(parts));
check('reasoningTextOf reconstrói o texto', reasoningTextOf(parts) === 'passo 1\n\npasso 2');
check('cleanReasoning remove [REDACTED]', cleanReasoning('a[REDACTED]b') === 'ab');

console.log('--- blocos de system prompt ---');
const skills = '## VAKTOR SKILLS\nAtivas: core\n\n## REGRAS GLOBAIS\n- x';
const once = upsertBlock(skills, sp.directive, '## MODO THINKING');
const twice = upsertBlock(once, sp.directive, '## MODO THINKING');
check('thinking não duplica a cada mensagem', once === twice && twice.split('## MODO THINKING').length === 2);
check('skills preservadas', twice.includes('## VAKTOR SKILLS') && twice.includes('## REGRAS GLOBAIS'));
const atStart = upsertBlockAtStart(skills, sp.directive, '## MODO THINKING');
check('thinking no início preserva skills', atStart.startsWith('## MODO THINKING') && atStart.includes('## VAKTOR SKILLS'));
check('thinking no início é idempotente', upsertBlockAtStart(atStart, sp.directive, '## MODO THINKING') === atStart);

console.log('--- config, comandos e rodapé ---');
const cfg = normalizeThinkingConfig({ enabled: true, mode: 'XYZ', minComplexity: '??', budgetTokens: 999999, maxPasses: 5, show: false });
check('env inválido cai nos padrões', cfg.mode === 'auto' && cfg.minComplexity === 'normal' && cfg.budgetTokens === 32000 && cfg.maxPasses === 1);
check('budget mínimo 1000', normalizeThinkingConfig({ ...cfg, budgetTokens: 10, mode: 'off', minComplexity: 'hard', maxPasses: 2 }).budgetTokens === 1000);
check('/thinking budget 12000', JSON.stringify(parseThinkingCommand('budget 12000')) === '{"kind":"budget","value":12000}');
check('/thinking budget 50 → clamp', JSON.stringify(parseThinkingCommand('budget 50')) === '{"kind":"budget","value":1000}');
check('/thinking (vazio) → status', parseThinkingCommand('').kind === 'status');
check('/thinking xyz → invalid', parseThinkingCommand('xyz').kind === 'invalid');
check('rodapé off/auto/on', footerLabel(false, 'auto') === 'think off' && footerLabel(true, 'auto') === 'think auto' && footerLabel(true, 'always') === 'think on' && footerLabel(true, 'off') === 'think off');

console.log('--- exibição ---');
const long = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n');
const shown = formatReasoningForDisplay(`<thinking>${long}</thinking>`);
check('máximo 12 linhas + "…" e sem tags', shown.split('\n').length === 13 && shown.endsWith('…') && !shown.includes('<'), `${shown.split('\n').length} linhas`);
check('texto curto não é truncado', formatReasoningForDisplay('a\nb') === 'a\nb');

process.exitCode = failed === 0 ? 0 : 1;
console.log(failed === 0 ? '\nTudo OK' : `\n${failed} verificação(ões) FALHARAM`);
