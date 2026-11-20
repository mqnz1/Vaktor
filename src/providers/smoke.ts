// Smoke do runtime Echo Free (extract.ts) e do pulso neon do Header.
// Offline: nenhuma chamada de rede. Executar: npx tsx src/providers/smoke.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ECHO_MODELS } from './echo.js';
import {
  ECHO_HUNTER_PROVENANCE,
  ECHO_SUPPORTS_REFRESH,
  EchoError,
  buildEchoHttpError,
  classifyEchoStatus,
  echoGuardSnapshot,
  ensureEchoReady,
  guardEchoCall,
  maskSecret,
  parseRetryAfter,
  readEchoCredential,
  redactSecrets,
  resetEchoBoot,
  resetEchoGuard,
} from './extract.js';
import {
  GEMINI_MODELS,
  buildGeminiBody,
  getGeminiModelById,
  isGeminiChatModel,
  mapGeminiCatalog,
  sendToGemini,
} from './gemini.js';
import {
  NOTION_MODELS,
  buildNotionPromptContext,
  mapNotionAgents,
  parseNotionAgentEvents,
  sendToNotion,
} from './notion.js';
import {
  NOTION_WEB_MODELS,
  buildNotionWebBody,
  buildNotionWebTranscript,
  mapNotionWebModels,
  notionWebCredentials,
  parseNotionWebEvent,
  sendToNotionWeb,
} from './notionWeb.js';
import {
  ITERACOMPUTE_MODELS,
  getIteraComputeModelById,
  sendToIteraCompute,
} from './iteracompute.js';
import {
  QODER_MODELS,
  getQoderModelById,
  resetQoderTokenCache,
  sendToQoder,
} from './qoder.js';
import {
  QRONOS_MODELS,
  mapQronosCatalog,
  sendToQronos,
} from './qronos.js';
import {
  ZRO_MODELS,
  applyZroCatalog,
  getZroModelById,
  mapZroCatalog,
  sendToZro,
} from './zro.js';
import {
  UNOROUTER_CONSENT_REQUIRED,
  UNOROUTER_MODELS,
  UNOROUTER_VERIFIED_FALLBACK,
  getUnoRouterModelById,
  isUnoRouterTextModel,
  mapUnoRouterCatalog,
  sendToUnoRouter,
} from './unorouter.js';
import {
  APINEX_MODELS,
  getApinexModelById,
  sendToApinex,
} from './apinex.js';
import {
  DEEPAI_MODELS,
  getDeepaiModelById,
  sendToDeepAI,
} from './deepai.js';
import {
  VYCEAI_MODELS,
  getVyceAIModelById,
  sendToVyceAI,
} from './vyceai.js';
import { mapPuterCatalog } from './puter.js';
import { AGENTROUTER_MODELS } from './agentrouter.js';
import { REQUESTY_MODELS } from './requesty.js';
import { KILO_MODELS } from './kilo.js';
import { FTA_MODELS } from './fta.js';
import { sendToOpenRouter } from './openrouter.js';
import { NUMES_MODELS, mapNumesCatalog, sendToNumes } from './numes.js';
import {
  NIGHTROUTER_MODELS,
  mapNightRouterCatalog,
  sendToNightRouter,
} from './nightrouter.js';
import { sendOpenAiCompatible } from './openaiCompat.js';
import { dispatchToProvider } from './adapter.js';
import { withTimeout } from './http.js';
import { PROVIDER_LABELS } from './registry.js';
import { hexToRgb, lerpHex, pulseColor, pulsePhase } from '../ui/neon.js';
import {
  PROVIDER_ENV_KEYS,
  findModelOwner,
  modelsOwnedBy,
  ownerOf,
  parseModelRef,
} from './registry.js';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FALHOU ${label}`);
  }
}

async function expectEchoError(
  label: string,
  promise: Promise<unknown>,
  kind: string,
): Promise<EchoError | null> {
  try {
    await promise;
    failures++;
    console.error(`FALHOU ${label} (não lançou erro)`);
    return null;
  } catch (error) {
    if (error instanceof EchoError && error.kind === kind) {
      console.log(`OK   ${label}`);
      return error;
    }
    failures++;
    console.error(`FALHOU ${label} (kind=${(error as EchoError).kind ?? String(error)})`);
    return null;
  }
}

function withKey<T>(value: string | undefined, run: () => T): T {
  const previous = process.env['ECHO_API_KEY'];
  if (value === undefined) {
    delete process.env['ECHO_API_KEY'];
  } else {
    process.env['ECHO_API_KEY'] = value;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env['ECHO_API_KEY'];
    } else {
      process.env['ECHO_API_KEY'] = previous;
    }
  }
}

const SAMPLE_KEY = 'echo_abcdefghijklmnopqrstuvwxyz0123456789';

async function main(): Promise<void> {
  // ── 1. Identidade visual ────────────────────────────────────────────────
  check('provedor exibido como "Echo Free"', PROVIDER_LABELS.echo === 'Echo Free');
  check('nome do modelo anuncia Echo Free', (ECHO_MODELS[0]?.name ?? '').includes('Echo Free'));
  check('AgentRouter tem 5 modelos', AGENTROUTER_MODELS.length === 5);
  check('Requesty tem 13 modelos free', REQUESTY_MODELS.length === 13);
  check('Requesty só tem modelos free', REQUESTY_MODELS.every(m => m.costPer1kTokensInput === 0 && m.costPer1kTokensOutput === 0));
  check('Kilo Code tem 17 modelos free', KILO_MODELS.length === 17);
  check('Kilo Code só tem modelos free', KILO_MODELS.every(m => m.costPer1kTokensInput === 0 && m.costPer1kTokensOutput === 0));
  check('FreeTheAI tem 5 modelos free', FTA_MODELS.length === 5);
  check('FreeTheAI só tem modelos free', FTA_MODELS.every(m => m.costPer1kTokensInput === 0 && m.costPer1kTokensOutput === 0));
  check('Requesty usa chave REQUESTY_API_KEY', PROVIDER_ENV_KEYS.requesty === 'REQUESTY');
  check('Kilo usa chave KILO_API_KEY', PROVIDER_ENV_KEYS.kilo === 'KILO');
  check('FreeTheAI usa chave FTAI_API_KEY', PROVIDER_ENV_KEYS.fta === 'FTAI');
  check('Numes usa chave NUMES_API_KEY', PROVIDER_ENV_KEYS.numes === 'NUMES');
  check('NightRouter usa chave NIGHTROUTER_API_KEY', PROVIDER_ENV_KEYS.nightrouter === 'NIGHTROUTER');
  check('Numes tem modelos de fallback', NUMES_MODELS.length > 0);
  check(
    'Numes expõe o catálogo free atual',
    NUMES_MODELS.length === 9 &&
      NUMES_MODELS.every(model => model.id.endsWith(':free') && model.costPer1kTokensInput === 0) &&
      [
        'deepseek/deepseek-v4.1-flash:free',
        'dealignai/deepseek-v4.1-flash-uncensored-fp8:free',
        'moonshotai/kimi-k3.1-pro:free',
        'uniboshi/kimi-k3-abliterated-v1:free',
        'z-ai/glm-5.3:free',
        'z-ai/glm-5.3-flash:free',
        'dealignai/glm-5.3-uncensored-fp8:free',
        'dealignai/glm-5.3-flash-uncensored-fp8:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free',
      ].every(id => NUMES_MODELS.some(model => model.id === id)),
  );
  check('NightRouter tem modelos de fallback', NIGHTROUTER_MODELS.length > 0);

  const numesMapped = mapNumesCatalog([
    {
      id: 'openai/gpt-6-luna',
      name: 'GPT-6 Luna',
      description: 'generalista',
      context_length: 131072,
      architecture: { output_modalities: ['text'] },
      pricing: { prompt: '0.00000007', completion: '0.00000038', request: '0' },
      billing_currency: 'USD',
    },
    {
      id: 'openai/image-only',
      name: 'Image',
      architecture: { output_modalities: ['image'] },
      pricing: { prompt: '0', completion: '0' },
    },
  ]);
  check(
    'Numes mapeia preço por token para 1k',
    numesMapped.length === 1 &&
      numesMapped[0]?.costPer1kTokensInput === 0.00007 &&
      numesMapped[0]?.costPer1kTokensOutput === 0.00038,
  );
  check('Numes descarta modelos sem saída de texto', !numesMapped.some(m => m.id.includes('image')));

  const numesBtc = mapNumesCatalog([
    {
      id: 'btc/fixed',
      billing_currency: 'BTC',
      architecture: { output_modalities: ['text'] },
      pricing: { prompt: '0.0005', completion: '0.001', request: '0', reference: { usd_per_btc: '100000' } },
    },
    {
      id: 'btc/indexed',
      billing_currency: 'BTC',
      architecture: { output_modalities: ['text'] },
      pricing: {
        prompt: '0.0005',
        completion: '0.001',
        request: '0',
        reference: { usd_per_btc: '100000' },
        usd_rates: { prompt: '0.0000002', completion: '0.0000008' },
      },
    },
  ]);
  check(
    'Numes converte sats por token para USD por 1k',
    numesBtc.find(m => m.id === 'btc/fixed')?.costPer1kTokensInput === 0.0005 &&
      numesBtc.find(m => m.id === 'btc/fixed')?.costPer1kTokensOutput === 0.001,
  );
  check(
    'Numes prefere usd_rates sem reaplicar o câmbio',
    numesBtc.find(m => m.id === 'btc/indexed')?.costPer1kTokensInput === 0.0002 &&
      numesBtc.find(m => m.id === 'btc/indexed')?.costPer1kTokensOutput === 0.0008,
  );

  const nightMapped = mapNightRouterCatalog([
    { id: 'gpt-6-luna', supported_endpoint_types: ['openai'] },
    { id: 'claude-fable-5', supported_endpoint_types: ['anthropic'] },
    { id: 'gemini-3.8-flash', supported_endpoint_types: ['openai', 'anthropic'] },
    { id: 'Gemini 4 Argon', supported_endpoint_types: ['openai'] },
  ]);
  check(
    'NightRouter só mantém modelos OpenAI Chat',
    nightMapped.length === 3 &&
      nightMapped.some(m => m.id === 'gpt-6-luna') &&
      nightMapped.some(m => m.id === 'gemini-3.8-flash') &&
      nightMapped.some(m => m.id === 'Gemini 4 Argon'),
  );
  check('NightRouter estima preço da família', nightMapped.find(m => m.id === 'gpt-6-luna')?.costPer1kTokensOutput === 0.00038);
  check('Notion AI usa chave NOTION_API_KEY', PROVIDER_ENV_KEYS.notion === 'NOTION');
  check('rótulo Notion AI', PROVIDER_LABELS.notion === 'Notion AI');
  check('Notion AI Web usa cookie NOTION_COOKIE', PROVIDER_ENV_KEYS.notion_web === 'NOTION_WEB');
  check('rótulo Notion AI Web', PROVIDER_LABELS.notion_web === 'Notion AI (Web)');

  // ── 2. Redação de segredos ──────────────────────────────────────────────
  check('maskSecret esconde o meio', maskSecret(SAMPLE_KEY) === 'echo_abc…6789');
  check('maskSecret em valor curto vira ***', maskSecret('abc') === '***');
  check('redactSecrets remove chave echo_', !redactSecrets(`falha com ${SAMPLE_KEY}`).includes('abcdefghij'));
  check('redactSecrets remove Bearer', redactSecrets('authorization: Bearer abcdefghijklmnop').includes('Bearer ***'));
  check(
    'redactSecrets limpa cabeçalho x-api-key',
    !redactSecrets('x-api-key: abcdefghijklmnop').includes('abcdefghijklmnop'),
  );
  const GOOGLE_SAMPLE = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWX1234567890';
  check(
    'redactSecrets remove chave Google AIza',
    !redactSecrets(`falha com ${GOOGLE_SAMPLE}`).includes(GOOGLE_SAMPLE.slice(8, -4)),
  );
  const NOTION_SAMPLE = 'ntn_abcdefghijklmnopqrstuvwxyz0123456789';
  check(
    'redactSecrets remove chave Notion ntn_',
    !redactSecrets(`falha com ${NOTION_SAMPLE}`).includes(NOTION_SAMPLE.slice(8, -4)),
  );

  // ── 3. Credencial autorizada ────────────────────────────────────────────
  const fromExplicit = readEchoCredential(SAMPLE_KEY);
  check('credencial explícita tem prioridade', fromExplicit?.source === 'explicit');
  check('formato echo_ reconhecido', fromExplicit?.formatOk === true);
  check(
    'chave fora do padrão ainda é aceita',
    readEchoCredential('chave-customizada-123456')?.formatOk === false,
  );
  check(
    'sem chave alguma devolve null',
    withKey(undefined, () => readEchoCredential('') === null),
  );
  check(
    'fallback para ECHO_API_KEY',
    withKey(SAMPLE_KEY, () => readEchoCredential('')?.source === 'env'),
  );

  // ── 4. Bootstrap (papel legítimo de boot.py) ────────────────────────────
  resetEchoGuard();
  resetEchoBoot();
  await expectEchoError(
    'sem chave → missing-credential com dica de .env',
    Promise.resolve().then(() => withKey(undefined, () => ensureEchoReady(''))),
    'missing-credential',
  );
  check('bootstrap é idempotente na 1ª chamada', withKey(SAMPLE_KEY, () => ensureEchoReady().booted));
  check('bootstrap não repete na 2ª chamada', withKey(SAMPLE_KEY, () => ensureEchoReady().booted === false));
  check(
    'troca de chave reinicia o bootstrap',
    withKey('echo_outra_chave_abcdefghijklmnop', () => ensureEchoReady().booted),
  );
  check('renovação automática é declarada inexistente', ECHO_SUPPORTS_REFRESH === false);

  // ── 5. Classificação de status HTTP ─────────────────────────────────────
  check('401 vira invalid-credential sem retry', classifyEchoStatus(401).kind === 'invalid-credential' && !classifyEchoStatus(401).retryable);
  check('402 vira quota sem retry', classifyEchoStatus(402).kind === 'quota' && !classifyEchoStatus(402).retryable);
  check('403 vira forbidden sem retry', classifyEchoStatus(403).kind === 'forbidden' && !classifyEchoStatus(403).retryable);
  check('404 vira model', classifyEchoStatus(404).kind === 'model');
  check('429 vira rate-limit com retry', classifyEchoStatus(429).retryable);
  check('500 vira upstream com retry', classifyEchoStatus(500).kind === 'upstream' && classifyEchoStatus(500).retryable);

  // ── 6. Retry-After ──────────────────────────────────────────────────────
  check('Retry-After em segundos', parseRetryAfter('2') === 2000);
  check('Retry-After em data HTTP', parseRetryAfter(new Date(Date.now() + 5000).toUTCString()) !== null);
  check('Retry-After inválido vira null', parseRetryAfter('xyz') === null);

  // ── 7. Erro HTTP redigido ───────────────────────────────────────────────
  const httpError = buildEchoHttpError('chat', 401, `Incorrect API key provided: ${SAMPLE_KEY}`);
  check('erro 401 classificado', httpError.kind === 'invalid-credential');
  check('erro 401 traz dica acionável', (httpError.hint ?? '').includes('ECHO_API_KEY'));
  check('erro 401 não vaza a chave', !httpError.message.includes('abcdefghij'));
  check('erro 401 preserva o status', httpError.status === 401);

  // 401 repassado do upstream: a chave do usuário está OK; o problema é do Echo.
  const upstreamAuth = buildEchoHttpError(
    'chat',
    401,
    '{"error":{"error":{"message":"Incorrect API key provided: sk-svcac1234567890","code":"invalid_api_key"}}}',
  );
  check('401 do upstream vira upstream-auth', upstreamAuth.kind === 'upstream-auth');
  check('401 do upstream não culpa ECHO_API_KEY', !(upstreamAuth.hint ?? '').includes('Confira ECHO_API_KEY'));

  const spendCap = buildEchoHttpError(
    'gemini',
    429,
    '{"error":{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap.","status":"RESOURCE_EXHAUSTED"}}}',
  );
  check('429 spend cap vira quota (sem retry)', spendCap.kind === 'quota');

  // ── 8. Guarda de execução ───────────────────────────────────────────────
  resetEchoGuard();
  resetEchoBoot();
  const ok = await guardEchoCall('chat', async () => 'resposta');
  check('chamada bem-sucedida passa direto', ok === 'resposta');

  let attempts = 0;
  const sleeps: number[] = [];
  const recovered = await guardEchoCall(
    'chat',
    async () => {
      attempts++;
      if (attempts === 1) throw buildEchoHttpError('chat', 503, 'upstream indisponível');
      return 'recuperado';
    },
    { sleep: async (ms: number) => { sleeps.push(ms); }, jitter: false },
  );
  check('5xx é repetido uma vez', recovered === 'recuperado' && attempts === 2);
  check('backoff exponencial a partir de 400ms', sleeps[0] === 400);

  resetEchoGuard();
  let authCalls = 0;
  await expectEchoError(
    '401 não é repetido',
    guardEchoCall('chat', async () => {
      authCalls++;
      throw buildEchoHttpError('chat', 401, `bad key ${SAMPLE_KEY}`);
    }, { sleep: async () => {}, jitter: false }),
    'invalid-credential',
  );
  check('401 tentou uma única vez', authCalls === 1);
  await expectEchoError(
    'cooldown bloqueia chamada seguinte',
    guardEchoCall('chat', async () => {
      authCalls++;
      return 'não deveria executar';
    }),
    'cooldown',
  );
  check('cooldown não chegou a chamar o provedor', authCalls === 1);
  check('snapshot registra a falha de auth', echoGuardSnapshot().lastFailureKind === 'invalid-credential');

  resetEchoGuard();
  const rateSleeps: number[] = [];
  let rateAttempts = 0;
  await guardEchoCall(
    'chat',
    async () => {
      rateAttempts++;
      if (rateAttempts === 1) {
        throw buildEchoHttpError('chat', 429, 'slow down', new Headers({ 'retry-after': '2' }));
      }
      return 'ok';
    },
    { sleep: async (ms: number) => { rateSleeps.push(ms); }, maxWaitMs: 4000, jitter: false },
  );
  check('429 respeita Retry-After', rateAttempts === 2 && rateSleeps[0] === 2000);

  resetEchoGuard();
  let networkCalls = 0;
  await expectEchoError(
    'falha de rede é repetida e então propagada',
    guardEchoCall('chat', async () => {
      networkCalls++;
      throw new Error('fetch failed');
    }, { sleep: async () => {}, jitter: false }),
    'network',
  );
  check('rede tentou duas vezes', networkCalls === 2);

  resetEchoGuard();
  check('reset limpa contadores', echoGuardSnapshot().failures === 0);

  // ── 9. Pulso neon do Header ─────────────────────────────────────────────
  check('hexToRgb lê #rrggbb', hexToRgb('#22d3ee')?.g === 211);
  check('lerpHex no início devolve a cor base', lerpHex('#0891b2', '#67e8f9', 0) === '#0891b2');
  check('lerpHex no fim devolve a cor de pico', lerpHex('#0891b2', '#67e8f9', 1) === '#67e8f9');
  check('lerpHex no meio interpola', lerpHex('#000000', '#ffffff', 0.5) === '#808080');
  check('lerpHex limita t fora do intervalo', lerpHex('#000000', '#ffffff', 9) === '#ffffff');

  const phases = [0, 650, 1300, 1950].map(ms => pulsePhase(ms, 2600));
  check('pulso começa no repouso', phases[0] === 0);
  check('pulso atinge o pico no meio do ciclo', Math.abs((phases[2] ?? 0) - 1) < 1e-9);
  check('pulso sobe de forma monotônica', (phases[0] ?? 0) < (phases[1] ?? 0) && (phases[1] ?? 0) < (phases[2] ?? 0));
  check('pulso fecha o ciclo sem salto', Math.abs(pulsePhase(2600, 2600) - pulsePhase(0, 2600)) < 1e-9);
  check('fase sempre dentro de [0,1]', Array.from({ length: 200 }, (_, i) => pulsePhase(i * 37, 2600)).every(p => p >= 0 && p <= 1));
  check('cor do pulso é hex válido', /^#[0-9a-f]{6}$/.test(pulseColor(900, '#0891b2', '#67e8f9')));

  // ── 10. Proveniência documentada ────────────────────────────────────────
  check('proveniência cita os dois scripts', ECHO_HUNTER_PROVENANCE.sources.length === 2);
  check(
    'proveniência registra o que foi descartado',
    ECHO_HUNTER_PROVENANCE.dropped.some(item => item.includes('contas descartáveis')),
  );

  // ── 11. Registro de provedores (dono único + chave coerente) ────────────
  check(
    'modelo presente em Puter e Echo pertence ao Echo',
    ownerOf('claude-haiku-4-5-20251001') === 'echo',
  );
  check(
    'findModelOwner concorda com ownerOf',
    findModelOwner('gpt-5')?.provider === ownerOf('gpt-5'),
  );
  check(
    'chave do Echo acompanha o dono do modelo',
    PROVIDER_ENV_KEYS[ownerOf('claude-haiku-4-5-20251001')] === 'ECHO',
  );
  check(
    'Puter não anuncia modelos que o dispatch envia ao Echo',
    !modelsOwnedBy('puter').some(model => model.id === 'claude-haiku-4-5-20251001'),
  );
  check(
    'todo modelo tem exatamente um dono',
    (['puter', 'echo', 'opencode', 'nvidia', 'harbor', 'iteracompute', 'qoder', 'qronos', 'zro', 'unorouter', 'apinex', 'deepai', 'vyceai', 'openrouter', 'numes', 'nightrouter', 'proxygatellm', 'gemini', 'notion', 'notion_web'] as const)
      .every(provider => modelsOwnedBy(provider).every(model => ownerOf(model.id) === provider)),
  );
  check('modelo desconhecido cai no Puter', ownerOf('modelo-inexistente-xyz') === 'puter');
  check('ID qualificado fixa o provedor', ownerOf('puter::gpt-5') === 'puter');
  check(
    'findModelOwner entende ID qualificado',
    findModelOwner('puter::gpt-5')?.provider === 'puter' &&
      findModelOwner('puter::gpt-5')?.model.id === 'gpt-5',
  );
  check('parseModelRef separa provedor e ID', parseModelRef('puter::gpt-5').id === 'gpt-5');

  // ── 12. Catálogo Echo alinhado ao que o upstream aceita ─────────────────
  check(
    'catálogo Echo removeu Claude 3.5 Haiku (404 no upstream)',
    !ECHO_MODELS.some(model => model.id === 'claude-3-5-haiku-20241022'),
  );
  check(
    'catálogo Echo mantém Claude Haiku 4.5',
    ECHO_MODELS.some(model => model.id === 'claude-haiku-4-5-20251001'),
  );
  check(
    'catálogo Echo mantém Gemini 2.5 Flash',
    ECHO_MODELS.some(model => model.id === 'gemini-2.5-flash'),
  );
  check(
    'catálogo Echo removeu Gemini 2.0 (descontinuado)',
    !ECHO_MODELS.some(model => model.id.startsWith('gemini-2.0')),
  );

  // ── 13. Google Gemini (provedor nativo) ─────────────────────────────────
  check('modelo inicial do Gemini é gemini-2.5-flash', GEMINI_MODELS[0]?.id === 'gemini-2.5-flash');
  check(
    'catálogo Gemini tem flash e pro',
    getGeminiModelById('gemini-2.5-flash') !== undefined &&
      getGeminiModelById('gemini-2.5-pro') !== undefined,
  );
  check(
    'gemini-2.5-flash é dono do provedor gemini (não do Echo)',
    ownerOf('gemini-2.5-flash') === 'gemini',
  );
  check(
    'chave GEMINI acompanha o dono do modelo',
    PROVIDER_ENV_KEYS[ownerOf('gemini-2.5-flash')] === 'GEMINI',
  );
  check('rótulo Google Gemini', PROVIDER_LABELS['gemini'] === 'Google Gemini');
  check(
    'gemini comparece no modelo enviado ao router (FALLBACK)',
    findModelOwner('gemini-2.5-flash')?.provider === 'gemini',
  );

  const dynamicGemini = mapGeminiCatalog([
    {
      name: 'models/gemini-3.8-flash',
      displayName: 'Gemini 3.8 Flash',
      inputTokenLimit: 1_048_576,
      supportedGenerationMethods: ['generateContent', 'countTokens'],
    },
    {
      name: 'models/gemini-3-flash-preview',
      displayName: 'Gemini 3 Flash Preview',
      inputTokenLimit: 1_048_576,
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemini-3.8-flash-tts',
      displayName: 'Gemini 3.8 Flash TTS',
      inputTokenLimit: 8192,
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemini-2.5-flash-image',
      displayName: 'Nano Banana',
      inputTokenLimit: 32_768,
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemma-4-31b-it',
      displayName: 'Gemma 4 31B IT',
      inputTokenLimit: 262_144,
      supportedGenerationMethods: ['generateContent'],
    },
  ]);
  check(
    'Gemini dinâmico mapeia modelos de chat',
    dynamicGemini.length === 3 && dynamicGemini[0]?.id === 'gemini-3.8-flash',
  );
  check(
    'Gemini dinâmico exclui TTS e imagem',
    !dynamicGemini.some(model => model.id.includes('tts') || model.id.includes('image')),
  );
  check(
    'Gemini dinâmico usa o contexto da API',
    dynamicGemini.find(model => model.id === 'gemini-3.8-flash')?.contextWindow === 1_048_576,
  );
  check(
    'Gemini dinâmico estima custo por família',
    dynamicGemini.find(model => model.id === 'gemini-3.8-flash')?.costPer1kTokensInput ===
      0.0003 &&
      dynamicGemini.find(model => model.id === 'gemma-4-31b-it')?.costPer1kTokensInput === 0,
  );
  check(
    'Gemini dinâmico mantém Gemma no fim',
    dynamicGemini[dynamicGemini.length - 1]?.id === 'gemma-4-31b-it',
  );
  check(
    'Gemini exige generateContent',
    !isGeminiChatModel('gemini-3.8-flash-tts') &&
      isGeminiChatModel('gemini-3.8-flash'),
  );

  const bodyNative = buildGeminiBody(
    [
      { role: 'system', content: 'voce e util', timestamp: 1 },
      { role: 'user', content: 'oi', timestamp: 2 },
      { role: 'assistant', content: 'ola', timestamp: 3 },
    ],
    512,
    { strategy: 'native', budgetTokens: 4096, effort: 'medium' },
    0.5,
  );
  const contents = bodyNative['contents'] as Array<{ role: string; parts: Array<{ text: string }> }>;
  check('system sai do contents', !contents.some(c => c.role === 'system'));
  check('assistant vira role model', contents.some(c => c.role === 'model' && c.parts[0]?.text === 'ola'));
  check(
    'systemInstruction separada',
    JSON.stringify(bodyNative['systemInstruction']).includes('voce e util'),
  );
  const genNative = bodyNative['generationConfig'] as Record<string, unknown> & {
    thinkingConfig: { thinkingBudget: number };
    temperature: number;
  };
  check('thinking nativo repassa o orçamento', genNative.thinkingConfig.thinkingBudget === 4096);
  check('temperature chega no generationConfig', genNative.temperature === 0.5);

  const bodyOff = buildGeminiBody([{ role: 'user', content: 'oi', timestamp: 1 }], 256, false);
  const genOff = bodyOff['generationConfig'] as { thinkingConfig: { thinkingBudget: number } };
  check('thinking desligado manda budget 0', genOff.thinkingConfig.thinkingBudget === 0);

  const bodyVariant = buildGeminiBody(
    [{ role: 'user', content: 'oi', timestamp: 1 }],
    512,
    { strategy: 'native', budgetTokens: 4096, effort: 'high', variant: 'max' },
    0.7,
    'gemini-2.5-pro',
  );
  const genVariant = bodyVariant['generationConfig'] as {
    thinkingConfig: { includeThoughts: boolean; thinkingBudget: number };
  };
  check(
    'variante max usa orçamento próprio',
    genVariant.thinkingConfig.includeThoughts === true &&
      genVariant.thinkingConfig.thinkingBudget === 24576,
  );

  const bodyGemini3 = buildGeminiBody(
    [{ role: 'user', content: 'oi', timestamp: 1 }],
    512,
    { strategy: 'native', budgetTokens: 4096, effort: 'high', variant: 'high' },
    0.7,
    'gemini-3.1-pro',
  );
  const genGemini3 = bodyGemini3['generationConfig'] as {
    thinkingConfig: { includeThoughts: boolean; thinkingLevel: string };
  };
  check(
    'gemini-3 usa thinkingLevel e includeThoughts',
    genGemini3.thinkingConfig.includeThoughts === true &&
      genGemini3.thinkingConfig.thinkingLevel === 'high',
  );

  // ── 14. Notion AI (Agents API) ──────────────────────────────────────────
  check(
    'Notion AI tem agente pessoal de fallback',
    NOTION_MODELS.some(model => model.id === 'notion_ai' && model.provider === 'notion'),
  );
  check('notion_ai pertence ao provider notion', ownerOf('notion_ai') === 'notion');

  const notionDynamic = mapNotionAgents([
    {
      id: '1f0c7c06-781b-4987-9986-5c8dd3028013',
      agent_type: 'custom_agent',
      name: 'Pesquisa',
      description: 'Responde perguntas',
      model: { mode: 'pinned', id: 'claude-sonnet-5' },
      status: 'active',
    },
    {
      id: 'notion_ai',
      agent_type: 'notion_ai',
      name: 'Notion AI',
      model: { mode: 'auto' },
      status: 'active',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      agent_type: 'autofill_custom_agent',
      name: 'Autofill',
      model: { mode: 'auto' },
      status: 'active',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      agent_type: 'custom_agent',
      name: 'Desativado',
      model: { mode: 'auto' },
      status: 'disabled',
    },
  ]);
  check(
    'Notion AI mapeia agentes de chat',
    notionDynamic.length === 2 && notionDynamic[0]?.id === 'notion_ai',
  );
  check(
    'Notion AI mostra o modelo fixado do agente',
    notionDynamic.some(model => model.name === 'Pesquisa (claude-sonnet-5)'),
  );
  check(
    'Notion AI descarta autofill e agentes desativados',
    !notionDynamic.some(model => model.id.startsWith('2222') || model.id.startsWith('3333')),
  );

  const notionContext = buildNotionPromptContext([
    { role: 'system', content: 'regras', timestamp: 1 },
    { role: 'user', content: 'antiga', timestamp: 2 },
    { role: 'assistant', content: 'resposta', timestamp: 3 },
    { role: 'user', content: 'atual', timestamp: 4 },
  ]);
  check(
    'Notion AI monta contexto sem duplicar a mensagem atual',
    notionContext.includes('regras') &&
      notionContext.includes('antiga') &&
      notionContext.includes('resposta') &&
      !notionContext.includes('atual'),
  );
  check(
    'Notion AI limita o contexto a 10k',
    buildNotionPromptContext([{ role: 'system', content: 'x'.repeat(12_000), timestamp: 1 }])
      .length === 10_000,
  );

  const notionAnswer = parseNotionAgentEvents([
    { type: 'user.message', content: [{ type: 'text', text: 'pergunta' }] },
    {
      type: 'agent.message',
      content: [{ type: 'text', text: 'primeira' }],
      metadata: { model: 'claude-sonnet-5' },
    },
    {
      type: 'agent.message',
      content: [{ type: 'text', text: 'resposta final' }],
      metadata: { model: 'claude-sonnet-5' },
    },
  ]);
  check(
    'Notion AI extrai a última resposta do agente',
    notionAnswer.text === 'resposta final' && notionAnswer.model === 'claude-sonnet-5',
  );

  {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    let auth = '';
    const streamed: string[] = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      auth = new Headers(init?.headers).get('authorization') ?? '';
      if (url.endsWith('/v1/sessions')) {
        return new Response(JSON.stringify({ id: 'session-1', status: 'completed' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          results: [
            {
              type: 'agent.message',
              content: [{ type: 'text', text: 'Olá do Notion' }],
              metadata: { model: 'claude-sonnet-5' },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await sendToNotion(
        [
          { role: 'system', content: 'regras', timestamp: 1 },
          { role: 'user', content: 'antiga', timestamp: 2 },
          { role: 'assistant', content: 'resposta', timestamp: 3 },
          { role: 'user', content: 'pergunta atual', timestamp: 4 },
        ],
        'notion_ai',
        128,
        'ntn_FAKEKEY123',
        false,
        undefined,
        { onToken: chunk => streamed.push(chunk) },
      );
      check('Notion AI envia sessão e busca eventos', urls.length === 2);
      check(
        'Notion AI envia a mensagem atual e o contexto anterior',
        bodies[0]?.['message'] === 'pergunta atual' &&
          String(bodies[0]?.['prompt_context']).includes('antiga') &&
          !String(bodies[0]?.['prompt_context']).includes('pergunta atual'),
      );
      check('Notion AI usa Bearer token', auth === 'Bearer ntn_FAKEKEY123');
      check('Notion AI extrai texto e emite onToken', res.text === 'Olá do Notion' && streamed[0] === 'Olá do Notion');
      check('Notion AI não cobra em USD', res.estimatedCostUsd === 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          object: 'error',
          status: 403,
          code: 'restricted_resource',
          message: 'Insufficient permissions ntn_TOPSECRET999',
        }),
        { status: 403 },
      )) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToNotion(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'notion_ai',
          128,
          'ntn_TOPSECRET999',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('Notion AI 403 vira dica de permissão', caught.includes('View sessions and interact with agents'));
      check('Notion AI erro redige a chave', !caught.includes('ntn_TOPSECRET999'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          object: 'error',
          status: 400,
          code: 'validation_error',
          message: 'This endpoint requires a business plan',
        }),
        { status: 400 },
      )) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToNotion(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'notion_ai',
          128,
          'ntn_FAKEKEY123',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('Notion AI 400 vira dica de plano Business', caught.includes('Business/Enterprise'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ── 15. Notion AI Web (cookie token_v2) ────────────────────────────────
  check('Notion AI Web tem catálogo local', NOTION_WEB_MODELS.length >= 10);
  check(
    'Notion AI Web marca o provider correto',
    NOTION_WEB_MODELS.every(model => model.provider === 'notion_web'),
  );

  const mappedWeb = mapNotionWebModels({
    models: [
      { id: 'alpha-model', name: 'Alpha', provider: 'Anthropic' },
      { id: 'beta-model', displayName: 'Beta', family: 'OpenAI' },
      { id: 'gamma-model', available: false },
      { id: 'alpha-model', name: 'Duplicado' },
    ],
  });
  check('Notion AI Web mapeia catálogo dinâmico', mappedWeb.length === 2);
  check(
    'Notion AI Web usa nome/família da API',
    mappedWeb[0]?.name.startsWith('Alpha') === true,
  );
  const fromMap = mapNotionWebModels({
    models: { 'map-model': { name: 'Mapa', provider: 'Anthropic' } },
  });
  check(
    'Notion AI Web aceita catálogo em mapa',
    fromMap.length === 1 &&
      fromMap[0]?.id === 'map-model' &&
      fromMap[0]?.name.startsWith('Mapa') === true,
  );
  check(
    'Notion AI Web descarta modelos indisponíveis e duplicados',
    !mappedWeb.some(model => model.id === 'gamma-model') &&
      mappedWeb.filter(model => model.id === 'alpha-model').length === 1,
  );

  {
    const previous = {
      cookie: process.env['NOTION_COOKIE'],
      token: process.env['NOTION_TOKEN_V2'],
      space: process.env['NOTION_SPACE_ID'],
      user: process.env['NOTION_USER_ID'],
    };
    try {
      delete process.env['NOTION_COOKIE'];
      delete process.env['NOTION_USER_ID'];
      process.env['NOTION_TOKEN_V2'] = 'raw-token-123';
      process.env['NOTION_SPACE_ID'] = 'space-123';
      const fromToken = notionWebCredentials();
      check(
        'Notion AI Web aceita token_v2 cru',
        fromToken?.cookie === 'token_v2=raw-token-123' && fromToken.spaceId === 'space-123',
      );

      delete process.env['NOTION_TOKEN_V2'];
      process.env['NOTION_COOKIE'] = 'token_v2=cookie-token; notion_user_id=user-42; other=x';
      const fromCookie = notionWebCredentials();
      check(
        'Notion AI Web extrai notion_user_id do cookie',
        fromCookie?.userId === 'user-42' && fromCookie.cookie.includes('token_v2=cookie-token'),
      );
    } finally {
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      };
      restore('NOTION_COOKIE', previous.cookie);
      restore('NOTION_TOKEN_V2', previous.token);
      restore('NOTION_SPACE_ID', previous.space);
      restore('NOTION_USER_ID', previous.user);
    }
  }

  const webTranscript = buildNotionWebTranscript(
    [
      { role: 'system', content: 'regras', timestamp: 1 },
      { role: 'user', content: 'pergunta', timestamp: 2 },
      { role: 'assistant', content: 'resposta', timestamp: 3 },
      { role: 'tool', content: 'resultado', timestamp: 4 },
    ],
    'alpha-model',
  );
  check(
    'Notion AI Web monta config, pergunta e histórico',
    webTranscript[0]?.type === 'config' &&
      JSON.stringify(webTranscript[0]?.value).includes('alpha-model') &&
      webTranscript.filter(item => item.type === 'user').length === 3 &&
      webTranscript.some(
        item =>
          item.type === 'agent-inference' &&
          JSON.stringify(item.value).includes('resposta'),
      ),
  );
  check(
    'Notion AI Web transforma system em instrução do usuário',
    String((webTranscript[1]?.value as string[][])?.[0]?.[0]).includes('Instruções do sistema'),
  );

  const webCredentials = {
    cookie: 'token_v2=secret-token',
    spaceId: 'space-123',
    userId: 'user-42',
    baseUrl: 'https://www.notion.so',
    clientVersion: 'test-version',
  };
  const webBody = buildNotionWebBody(
    [{ role: 'user', content: 'oi', timestamp: 1 }],
    'alpha-model',
    webCredentials,
  );
  check(
    'Notion AI Web envia spaceId e thread nova',
    webBody['spaceId'] === 'space-123' && webBody['createThread'] === true,
  );
  check(
    'Notion AI Web extrai markdown-chat e erro do stream',
    parseNotionWebEvent({ type: 'markdown-chat', value: 'oi' }).text === 'oi' &&
      parseNotionWebEvent({ type: 'error', message: 'falhou' }).error === 'falhou',
  );

  {
    const originalFetch = globalThis.fetch;
    const streamed: string[] = [];
    let capturedUrl = '';
    let capturedCookie = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedCookie = new Headers(init?.headers).get('cookie') ?? '';
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(
        [
          '{"type":"markdown-chat","value":"Olá "}',
          '{"type":"markdown-chat","value":"mundo"}',
          '{"type":"recordMap","value":{}}',
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
      );
    }) as typeof fetch;
    try {
      const res = await sendToNotionWeb(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'alpha-model',
        256,
        false,
        undefined,
        { onToken: chunk => streamed.push(chunk) },
        webCredentials,
      );
      check('Notion AI Web envia para runInferenceTranscript', capturedUrl.endsWith('/api/v3/runInferenceTranscript'));
      check('Notion AI Web envia Cookie token_v2', capturedCookie.includes('token_v2=secret-token'));
      check('Notion AI Web envia spaceId no body', capturedBody['spaceId'] === 'space-123');
      check('Notion AI Web acumula o texto', res.text === 'Olá mundo');
      check('Notion AI Web emite onToken por trecho', streamed.join('') === 'Olá mundo');
      check('Notion AI Web não cobra em USD', res.estimatedCostUsd === 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    let inferenceBody: Record<string, unknown> = {};
    let activeUser = '';
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/api/v3/getSpaces')) {
        return new Response(
          JSON.stringify({
            'user-1': {
              notion_user: { 'user-1': { value: { email: 'a@b.c' } } },
              space: { 'space-9': { value: { name: 'Workspace' } } },
            },
          }),
          { status: 200 },
        );
      }
      inferenceBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      activeUser = new Headers(init?.headers).get('x-notion-active-user-header') ?? '';
      return new Response('{"type":"markdown-chat","value":"ok"}\n', {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }) as typeof fetch;
    try {
      const res = await sendToNotionWeb(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'alpha-model',
        256,
        false,
        undefined,
        undefined,
        { ...webCredentials, spaceId: '', userId: '' },
      );
      check('Notion AI Web descobre workspace/user pelo getSpaces', urls[0]?.endsWith('/api/v3/getSpaces') === true);
      check(
        'Notion AI Web usa o workspace descoberto',
        inferenceBody['spaceId'] === 'space-9' && activeUser === 'user-1',
      );
      check('Notion AI Web responde após descoberta', res.text === 'ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ message: 'Unauthorized token_v2=secret-token' }),
        { status: 401 },
      )) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToNotionWeb(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'alpha-model',
          256,
          false,
          undefined,
          undefined,
          webCredentials,
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('Notion AI Web 401 pede cookie novo', caught.includes('Atualize NOTION_COOKIE'));
      check('Notion AI Web redige o token_v2', !caught.includes('secret-token'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const previousCookie = process.env['NOTION_COOKIE'];
    const previousToken = process.env['NOTION_TOKEN_V2'];
    const previousAuto = process.env['NOTION_COOKIE_AUTO'];
    delete process.env['NOTION_COOKIE'];
    delete process.env['NOTION_TOKEN_V2'];
    process.env['NOTION_COOKIE_AUTO'] = 'false';
    try {
      let caught = '';
      try {
        await sendToNotionWeb(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'alpha-model',
          256,
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('Notion AI Web sem cookie explica a configuração', caught.includes('NOTION_COOKIE'));
    } finally {
      if (previousCookie !== undefined) process.env['NOTION_COOKIE'] = previousCookie;
      if (previousToken !== undefined) process.env['NOTION_TOKEN_V2'] = previousToken;
      if (previousAuto !== undefined) process.env['NOTION_COOKIE_AUTO'] = previousAuto;
      else delete process.env['NOTION_COOKIE_AUTO'];
    }
  }

  // ── 16. withTimeout (timeout + cancelamento externo) ────────────────────
  check('timeout sozinho não aborta já', !withTimeout(5_000).aborted);
  check('aborto pré-existente propaga', withTimeout(5_000, AbortSignal.abort('bye')).aborted);
  const externalCtrl = new AbortController();
  const combinedSignal = withTimeout(5_000, externalCtrl.signal);
  externalCtrl.abort();
  check('aborto externo cancela o sinal combinado', combinedSignal.aborted);

  // ── 15. sendToGemini com fetch stubado (offline) ────────────────────────
  const geminiMsgs = [{ role: 'user' as const, content: 'oi', timestamp: 1 }];
  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedKey = '';
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedKey = new Headers(init?.headers).get('x-goog-api-key') ?? '';
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Oi! Como vai?' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await sendToGemini(geminiMsgs, 'gemini-2.5-flash', 256, 'AIzaFAKEKEY123', false, 0.7);
      check('Gemini não-stream: texto extraído', res.text === 'Oi! Como vai?');
      check('Gemini não-stream: usage vira tokens', res.inputTokens === 10 && res.outputTokens === 5);
      check('Gemini não-stream: custo estimado > 0', res.estimatedCostUsd > 0);
      check(
        'Gemini: endpoint nativo da Google',
        capturedUrl.includes('generativelanguage.googleapis.com') && capturedUrl.includes(':generateContent'),
      );
      check('Gemini: chave no cabeçalho x-goog-api-key', capturedKey === 'AIzaFAKEKEY123');
      check('Gemini: chave nunca aparece na URL', !capturedUrl.includes('AIzaFAKEKEY123'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    const streamed: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      capturedUrl = String(input);
      const encoder = new TextEncoder();
      const events = [
        { candidates: [{ content: { parts: [{ text: 'Oi' }] } }] },
        {
          candidates: [{ content: { parts: [{ text: ' mundo' }] } }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
        },
      ].map(event => encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      let next = 0;
      // Response-like mínimo: sendToGemini só usa ok + body.getReader()
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read(): Promise<{ done: boolean; value?: Uint8Array }> {
                if (next >= events.length) return { done: true };
                return { done: false, value: events[next++] };
              },
            };
          },
        },
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const res = await sendToGemini(geminiMsgs, 'gemini-2.5-flash', 256, 'AIzaFAKEKEY123', false, 0.7, {
        onToken: chunk => streamed.push(chunk),
      });
      check('Gemini stream: chunks chegam via onToken', streamed.join('') === 'Oi mundo');
      check('Gemini stream: texto final acumula', res.text === 'Oi mundo');
      check('Gemini stream: usage do último evento', res.inputTokens === 7 && res.outputTokens === 3);
      check(
        'Gemini stream: URL usa streamGenerateContent?alt=sse',
        capturedUrl.includes('streamGenerateContent') && capturedUrl.includes('alt=sse'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    const streamed: string[] = [];
    const reasoning: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const encoder = new TextEncoder();
      const events = [
        { candidates: [{ content: { parts: [{ text: 'pensando', thought: true }] } }] },
        {
          candidates: [{ content: { parts: [{ text: 'Oi' }] } }],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 5,
          },
        },
      ].map(event => encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      let next = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read(): Promise<{ done: boolean; value?: Uint8Array }> {
                if (next >= events.length) return { done: true };
                return { done: false, value: events[next++] };
              },
            };
          },
        },
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const res = await sendToGemini(
        geminiMsgs,
        'gemini-2.5-flash',
        256,
        'AIzaFAKEKEY123',
        { strategy: 'native', budgetTokens: 4096, effort: 'high' },
        0.7,
        {
          onToken: chunk => streamed.push(chunk),
          onReasoningToken: chunk => reasoning.push(chunk),
        },
      );
      check('Gemini stream: reasoning chega via onReasoningToken', reasoning.join('') === 'pensando');
      check('Gemini stream: reasoning final no resultado', res.reasoning === 'pensando');
      check('Gemini stream: reasoningTokens do usage', res.reasoningTokens === 5);
      check(
        'Gemini stream: includeThoughts é enviado',
        (capturedBody['generationConfig'] as Record<string, unknown>)?.['thinkingConfig'] !== undefined &&
          JSON.stringify(capturedBody['generationConfig']).includes('includeThoughts'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"bad key AIzaTOPSECRET999"}}', { status: 400 })) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToGemini(geminiMsgs, 'gemini-2.5-flash', 256, 'AIzaTOPSECRET999', false);
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('Gemini erro 400 vira mensagem com status', caught.includes('400'));
      check('Gemini erro redige a chave', !caught.includes('AIzaTOPSECRET999'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    let caught = '';
    try {
      await sendToGemini(geminiMsgs, 'gemini-2.5-flash', 256, '', false);
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }
    check('Gemini sem chave falha com instrução clara', caught.includes('GEMINI_API_KEY'));
  }

  // ── 16. Desflexão gemini → Echo sem GEMINI_API_KEY ─────────────────────
  {
    const originalFetch = globalThis.fetch;
    const prevGemini = process.env['GEMINI_API_KEY'];
    const prevEcho = process.env['ECHO_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    process.env['ECHO_API_KEY'] = SAMPLE_KEY;
    resetEchoBoot();
    resetEchoGuard();
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'via echo' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await dispatchToProvider({
        model: 'gemini-2.5-flash',
        messages: geminiMsgs,
        thinking: undefined,
        maxTokens: 128,
      });
      check(
        'sem GEMINI_API_KEY: dispatch desvia para o Echo',
        urls[0]?.startsWith('https://echo.router.merit.systems') === true,
      );
      check('resposta do desvio chega intacta', res.text === 'via echo');
    } finally {
      globalThis.fetch = originalFetch;
      if (prevGemini === undefined) delete process.env['GEMINI_API_KEY'];
      else process.env['GEMINI_API_KEY'] = prevGemini;
      if (prevEcho === undefined) delete process.env['ECHO_API_KEY'];
      else process.env['ECHO_API_KEY'] = prevEcho;
      resetEchoBoot();
      resetEchoGuard();
    }
  }


  // ── 16b. Streaming de reasoning (OpenRouter e OpenAI-compatible) ──────
  {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    const reasoning: string[] = [];
    const streamed: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const encoder = new TextEncoder();
      const events = [
        'data: {"choices":[{"delta":{"reasoning":"penso"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Oi"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"completion_tokens_details":{"reasoning_tokens":5}}}\n\n',
        'data: [DONE]\n\n',
      ].map(line => encoder.encode(line));
      let next = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read(): Promise<{ done: boolean; value?: Uint8Array }> {
                if (next >= events.length) return { done: true };
                return { done: false, value: events[next++] };
              },
            };
          },
        },
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const res = await sendToOpenRouter(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'openai/gpt-5',
        256,
        'sk-or-fake',
        { strategy: 'native', budgetTokens: 4096, effort: 'medium', variant: 'high' },
        undefined,
        undefined,
        { onToken: chunk => streamed.push(chunk), onReasoningToken: chunk => reasoning.push(chunk) },
      );
      check('OpenRouter stream: reasoning via onReasoningToken', reasoning.join('') === 'penso');
      check('OpenRouter stream: reasoning final', res.reasoning === 'penso' && res.content === 'Oi');
      check('OpenRouter stream: reasoningTokens do usage', res.reasoningTokens === 5);
      check(
        'OpenRouter stream: variante vira reasoning.effort',
        (capturedBody['reasoning'] as Record<string, unknown>)?.['effort'] === 'high' &&
          capturedBody['stream'] === true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    const reasoning: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const encoder = new TextEncoder();
      const events = [
        'data: {"choices":[{"delta":{"reasoning_content":"penso"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Oi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":3,"completion_tokens_details":{"reasoning_tokens":5}}}\n\n',
        'data: [DONE]\n\n',
      ].map(line => encoder.encode(line));
      let next = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read(): Promise<{ done: boolean; value?: Uint8Array }> {
                if (next >= events.length) return { done: true };
                return { done: false, value: events[next++] };
              },
            };
          },
        },
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const res = await sendOpenAiCompatible(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        { id: 'test-model', name: 'Test', costPer1kTokensInput: 0, costPer1kTokensOutput: 0 },
        256,
        'sk-test',
        { strategy: 'native', budgetTokens: 4096, effort: 'medium', variant: 'low' },
        undefined,
        { onReasoningToken: chunk => reasoning.push(chunk) },
        { baseUrl: 'https://compat.test/v1', timeoutMs: 5000, providerName: 'Compat', auth: 'bearer' },
      );
      check('OpenAI-compat stream: reasoning via onReasoningToken', reasoning.join('') === 'penso');
      check('OpenAI-compat stream: reasoning final e tokens', res.reasoning === 'penso' && res.reasoningTokens === 5);
      check(
        'OpenAI-compat stream: variante vira reasoning_effort',
        capturedBody['reasoning_effort'] === 'low' && capturedBody['stream'] === true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        auth: new Headers(init?.headers).get('Authorization') ?? '',
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok', reasoning_content: 'pensei' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const numes = await sendToNumes(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'openai/gpt-6-luna',
        256,
        'sk-numes-test',
        { strategy: 'native', budgetTokens: 4096, effort: 'medium', variant: 'high' },
      );
      const night = await sendToNightRouter(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'gpt-6-luna',
        256,
        'sk-night-test',
        { strategy: 'native', budgetTokens: 4096, effort: 'medium', variant: 'low' },
      );
      check(
        'Numes usa o endpoint OpenAI-compatible',
        calls[0]?.url === 'https://api.numes.ai/api/v1/chat/completions' &&
          calls[0]?.auth === 'Bearer sk-numes-test',
      );
      check(
        'Numes envia reasoning.effort',
        (calls[0]?.body['reasoning'] as Record<string, unknown>)?.['effort'] === 'high',
      );
      check('Numes retorna texto e reasoning', numes.text === 'ok' && numes.reasoning === 'pensei');
      check(
        'NightRouter usa o endpoint OpenAI-compatible',
        calls[1]?.url === 'https://api.nightrouter.ai/v1/chat/completions' &&
          calls[1]?.auth === 'Bearer sk-night-test',
      );
      check('NightRouter envia reasoning_effort', calls[1]?.body['reasoning_effort'] === 'low');
      check('NightRouter retorna texto e reasoning', night.text === 'ok' && night.reasoning === 'pensei');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // ── 17. Catálogo remoto do Puter (mapeamento offline) ──────────────────
  const puterCatalog = mapPuterCatalog([
    {
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      provider: 'claude',
      costs: { tokens: 1_000_000, input_tokens: 500, output_tokens: 2500 },
      context: 1_000_000,
    },
    {
      id: 'gpt-5',
      name: 'GPT-5',
      provider: 'azure-openai',
      costs: { tokens: 1_000_000, prompt_tokens: 125, completion_tokens: 1000 },
      context: 128_000,
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'gemini',
      costs: { tokens: 1_000_000, prompt: 30, completion: 250 },
      context: 1_048_576,
    },
    {
      id: 'fun-asr',
      name: 'Fun ASR',
      provider: 'alibaba',
      costs: { tokens: 1_000_000 },
    },
    {
      id: 'image-only',
      name: 'Image Only',
      provider: 'alibaba',
      modalities: { output: ['image'] },
    },
  ]);
  check('Puter mapeia custo input_tokens', puterCatalog.find(m => m.id === 'claude-opus-4-8')?.costPer1kTokensInput === 0.005);
  check('Puter mapeia custo output_tokens', puterCatalog.find(m => m.id === 'claude-opus-4-8')?.costPer1kTokensOutput === 0.025);
  check('Puter aceita variante prompt/completion', puterCatalog.find(m => m.id === 'gpt-5')?.costPer1kTokensInput === 0.00125);
  check('Puter aceita variante prompt/completion (output)', puterCatalog.find(m => m.id === 'gpt-5')?.costPer1kTokensOutput === 0.01);
  check('Puter aceita variante prompt/completion curta', puterCatalog.find(m => m.id === 'gemini-2.5-flash')?.costPer1kTokensOutput === 0.0025);
  check('Puter mantém contexto da API', puterCatalog.find(m => m.id === 'gpt-5')?.contextWindow === 128_000);
  check('Puter filtra modelos ASR', !puterCatalog.some(m => m.id === 'fun-asr'));
  check('Puter filtra modelos sem saída de texto', !puterCatalog.some(m => m.id === 'image-only'));
  check('Puter qualifica o nome com (Puter)', (puterCatalog.find(m => m.id === 'gpt-5')?.name ?? '').includes('(Puter)'));

  // 18. Itera Compute (OpenAI-compatible, Qwen3.8 free) -----------------
  check('Itera Compute usa ITERACOMPUTE_API_KEY', PROVIDER_ENV_KEYS.iteracompute === 'ITERACOMPUTE');
  check('rotulo Itera Compute', PROVIDER_LABELS.iteracompute === 'Itera Compute');
  check(
    'Itera Compute tem apenas o Qwen3.8 free',
    ITERACOMPUTE_MODELS.length === 1 &&
      getIteraComputeModelById('qwen/qwen3.8-27b')?.provider === 'iteracompute',
  );
  check(
    'Itera Compute nao cobra USD',
    ITERACOMPUTE_MODELS.every(
      model => model.costPer1kTokensInput === 0 && model.costPer1kTokensOutput === 0,
    ),
  );
  check('modelo Itera pertence ao provider', ownerOf('qwen/qwen3.8-27b') === 'iteracompute');

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await sendToIteraCompute(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'qwen/qwen3.8-27b',
        20_000,
        'test-key',
      );
      check('Itera Compute usa o endpoint OpenAI', capturedUrl === 'https://api.iteracompute.com/v1/chat/completions');
      check('Itera Compute envia Bearer', capturedAuth === 'Bearer test-key');
      check(
        'Itera Compute limita max_tokens a 8192',
        capturedBody['model'] === 'qwen/qwen3.8-27b' && capturedBody['max_tokens'] === 8_192,
      );
      check(
        'Itera Compute desliga thinking do Qwen',
        capturedBody['reasoning'] === false &&
          (capturedBody['chat_template_kwargs'] as Record<string, unknown>)?.['enable_thinking'] === false,
      );
      check('Itera Compute retorna texto sem custo', res.text === 'ok' && res.estimatedCostUsd === 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
      })) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToIteraCompute(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'qwen/qwen3.8-27b',
          128,
          'test-key',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('Itera Compute explica resposta vazia', caught.includes('resposta vazia'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // 19. Qoder (PAT -> job token, OpenAI-compatible) --------------------
  check('Qoder usa QODER_API_KEY', PROVIDER_ENV_KEYS.qoder === 'QODER');
  check('rotulo Qoder', PROVIDER_LABELS.qoder === 'Qoder');
  check(
    'Qoder tem os 15 modelos do catalogo',
    QODER_MODELS.length === 15 &&
      QODER_MODELS.every(model => model.provider === 'qoder') &&
      getQoderModelById('qmodel_38max')?.name === 'Qwen3.8-Max',
  );
  check(
    'Qoder expoe todos os IDs retornados pela API',
    ['auto', 'ultimate', 'fast', 'efficient', 'smodel', 'cmodel', 'qmodel_38max', 'qfmodel',
      'kmodel_latest', 'kmodel', 'gmodel', 'gfmodel', 'dmodel', 'dfmodel', 'mmodel']
      .every(id => QODER_MODELS.some(model => model.id === id)),
  );
  check(
    'Qoder nao cobra USD (price_factor e credito)',
    QODER_MODELS.every(
      model => model.costPer1kTokensInput === 0 && model.costPer1kTokensOutput === 0,
    ),
  );
  check('modelo Qoder pertence ao provider', ownerOf('qmodel_38max') === 'qoder');

  {
    const originalFetch = globalThis.fetch;
    resetQoderTokenCache();
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, headers, body });
      if (url.endsWith('/api/v1/jobToken/exchange')) {
        return new Response(JSON.stringify({ token: 'jt-test-token', expires_in: 86_400_000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await sendToQoder(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'qmodel_38max',
        100_000,
        'pt-test-key',
      );
      check('Qoder troca a PAT por job token', calls.length === 2 &&
        calls[0]?.url === 'https://openapi.qoder.sh/api/v1/jobToken/exchange' &&
        calls[0]?.body['personal_token'] === 'pt-test-key');
      check(
        'Qoder usa o gateway api2-v2',
        calls[1]?.url === 'https://api2-v2.qoder.sh/model/v1/chat/completions',
      );
      check('Qoder envia Bearer do job token', calls[1]?.headers.get('authorization') === 'Bearer jt-test-token');
      check(
        'Qoder envia cabecalhos Cosy',
        calls[1]?.headers.get('cosy-clienttype') === '5' &&
          calls[1]?.headers.get('cosy-version') === '1.0.0' &&
          calls[1]?.headers.get('cosy-data-policy') === 'agree',
      );
      check(
        'Qoder limita max_tokens e usa o ID opaco',
        calls[1]?.body['model'] === 'qmodel_38max' && calls[1]?.body['max_tokens'] === 32_768,
      );
      check('Qoder retorna texto sem custo', res.text === 'ok' && res.estimatedCostUsd === 0);

      await sendToQoder(
        [{ role: 'user', content: 'oi de novo', timestamp: 2 }],
        'auto',
        128,
        'pt-test-key',
      );
      check('Qoder reutiliza o job token em cache', calls.length === 3);
    } finally {
      globalThis.fetch = originalFetch;
      resetQoderTokenCache();
    }
  }

  {
    const originalFetch = globalThis.fetch;
    resetQoderTokenCache();
    let calls = 0;
    let capturedAuth = '';
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      calls++;
      capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      await sendToQoder(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'auto',
        128,
        'jt-direct-token',
      );
      check('Qoder aceita job token direto sem exchange', calls === 1 &&
        capturedAuth === 'Bearer jt-direct-token');
    } finally {
      globalThis.fetch = originalFetch;
      resetQoderTokenCache();
    }
  }

  {
    const originalFetch = globalThis.fetch;
    resetQoderTokenCache();
    globalThis.fetch = (async (input: unknown) => {
      if (String(input).endsWith('/api/v1/jobToken/exchange')) {
        return new Response(JSON.stringify({ token: 'jt-quota-token', expires_in: 86_400_000 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ code: 116, error: 'quota exceeded' }), {
        status: 402,
      });
    }) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToQoder(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'auto',
          128,
          'pt-quota-key',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('Qoder explica quota 402', caught.includes('sem créditos') && caught.includes('402'));
    } finally {
      globalThis.fetch = originalFetch;
      resetQoderTokenCache();
    }
  }

  // 20. APInex (OpenAI-compatible, carteira USD e modelos free) --------
  check('APInex usa APINEX_API_KEY', PROVIDER_ENV_KEYS.apinex === 'APINEX');
  check('rotulo APInex', PROVIDER_LABELS.apinex === 'APInex');
  check(
    'APInex tem os 42 modelos do catalogo autenticado',
    APINEX_MODELS.length === 42 &&
      APINEX_MODELS.every(model => model.provider === 'apinex') &&
      getApinexModelById('free/qwen-3.8-max')?.id === 'free/qwen-3.8-max',
  );
  check(
    'APInex mantem modelos free com custo zero',
    APINEX_MODELS.filter(model => model.id.startsWith('free/'))
      .every(model => model.costPer1kTokensInput === 0 && model.costPer1kTokensOutput === 0),
  );
  check(
    'APInex converte preco por 1M para 1k',
    getApinexModelById('kimi-k3.1-pro')?.costPer1kTokensInput === 0.0003 &&
      getApinexModelById('kimi-k3.1-pro')?.costPer1kTokensOutput === 0.0004,
  );
  check('modelo APInex pertence ao provider', ownerOf('apinex::gpt-6.1-sol') === 'apinex');

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await sendToApinex(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'free/qwen-3.8-max',
        100_000,
        'sk-apx-test',
      );
      check('APInex usa o endpoint OpenAI', capturedUrl === 'https://api.apinex.bond/v1/chat/completions');
      check('APInex envia Bearer', capturedAuth === 'Bearer sk-apx-test');
      check(
        'APInex envia o modelo e limita max_tokens',
        capturedBody['model'] === 'free/qwen-3.8-max' && capturedBody['max_tokens'] === 32_768,
      );
      check('APInex free retorna texto sem custo', res.text === 'ok' && res.estimatedCostUsd === 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Insufficient balance' } }), {
        status: 402,
      })) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToApinex(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'gpt-6.1-sol',
          128,
          'sk-apx-test',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('APInex explica saldo insuficiente', caught.includes('saldo USD insuficiente'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // 21. DeepAI (texto/resumo + DeepAI Code) ---------------------------
  check('DeepAI usa DEEPAI_API_KEY', PROVIDER_ENV_KEYS.deepai === 'DEEPAI');
  check('rotulo DeepAI', PROVIDER_LABELS.deepai === 'DeepAI');
  check(
    'DeepAI expoe text-generator, summarization e modelos Code',
    DEEPAI_MODELS.length === 20 &&
      DEEPAI_MODELS.every(model => model.provider === 'deepai') &&
      getDeepaiModelById('text-generator')?.id === 'text-generator' &&
      getDeepaiModelById('deepai/summarization')?.id === 'summarization' &&
      getDeepaiModelById('deepai::deepseek-v4.1-flash')?.id === 'deepseek-v4.1-flash' &&
      getDeepaiModelById('deepai::gpt-6-astra')?.id === 'gpt-6-astra',
  );
  check(
    'DeepAI Code separa tiers por Theos',
    DEEPAI_MODELS.find(model => model.id === 'deepseek-v4.1-flash')?.tier === 'economy' &&
      DEEPAI_MODELS.find(model => model.id === 'glm-5.3')?.tier === 'standard' &&
      DEEPAI_MODELS.find(model => model.id === 'claude-opus-5-5')?.tier === 'premium',
  );
  check('modelo DeepAI pertence ao provider', ownerOf('deepai::text-generator') === 'deepai');
  check('modelo Code qualificado pertence ao deepai', ownerOf('deepai::kimi-k3') === 'deepai');
  check('ID nao qualificado mantem o dono anterior', ownerOf('kimi-k3') !== 'deepai');

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedKey = '';
    let capturedText = '';
    let capturedType = '';
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedKey = new Headers(init?.headers).get('api-key') ?? '';
      capturedType = new Headers(init?.headers).get('content-type') ?? '';
      capturedText = new URLSearchParams(String(init?.body ?? '')).get('text') ?? '';
      return new Response(JSON.stringify({ id: 'abc', output: 'resumo ok' }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await sendToDeepAI(
        [{ role: 'user', content: 'resuma isto', timestamp: 1 }],
        'deepai/summarization',
        1000,
        'deepai-test',
      );
      check(
        'DeepAI usa POST /api/{model}',
        capturedUrl === 'https://api.deepai.org/api/summarization',
      );
      check('DeepAI envia api-key', capturedKey === 'deepai-test');
      check(
        'DeepAI envia form-urlencoded com text',
        capturedType.includes('application/x-www-form-urlencoded') &&
          capturedText === 'resuma isto',
      );
      check('DeepAI converte data.output', res.text === 'resumo ok' && res.model === 'deepai/summarization');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ err: 'invalid api key' }), { status: 200 })) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToDeepAI(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'text-generator',
          128,
          'deepai-test',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check('DeepAI explica erro de credencial', caught.includes('invalid api key'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    const originalCodeKey = process.env['DEEPAI_CODE_API_KEY'];
    let capturedUrl = '';
    let capturedHeaders = new Headers();
    let capturedBody: Record<string, unknown> = {};
    process.env['DEEPAI_CODE_API_KEY'] = 'deepai-code-test';
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok', reasoning_content: 'pensei' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await sendToDeepAI(
        [
          { role: 'system', content: 'seja breve', timestamp: 1 },
          { role: 'user', content: 'oi', timestamp: 2 },
        ],
        'deepai/deepseek-v4.1-flash',
        1000,
        'deepai-test',
      );
      check(
        'DeepAI Code usa /deepai_code/chat/completions',
        capturedUrl === 'https://api.deepai.org/deepai_code/chat/completions',
      );
      check(
        'DeepAI Code prioriza DEEPAI_CODE_API_KEY',
        capturedHeaders.get('api-key') === 'deepai-code-test',
      );
      check(
        'DeepAI Code envia lane headers',
        capturedHeaders.get('X-DeepAI-Code-Theos') === '4' &&
          /^[0-9a-f]{32}$/.test(capturedHeaders.get('X-DeepAI-Code-Instance') ?? ''),
      );
      check(
        'DeepAI Code envia payload OpenAI-compatible',
        capturedBody['model'] === 'deepseek-v4.1-flash' &&
          Array.isArray(capturedBody['messages']) &&
          capturedBody['max_tokens'] === 1000,
      );
      check(
        'DeepAI Code converte conteudo e reasoning',
        res.text === 'ok' &&
          res.reasoning === 'pensei' &&
          res.model === 'deepai/deepseek-v4.1-flash',
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCodeKey === undefined) delete process.env['DEEPAI_CODE_API_KEY'];
      else process.env['DEEPAI_CODE_API_KEY'] = originalCodeKey;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    const originalCodeKey = process.env['DEEPAI_CODE_API_KEY'];
    const originalAccountFile = process.env['DEEPAI_CODE_ACCOUNT_FILE'];
    const dir = mkdtempSync(join(tmpdir(), 'vaktor-deepai-'));
    const accountFile = join(dir, 'deepai-account.bin');
    writeFileSync(accountFile, JSON.stringify({ apiKey: 'app-account-key', username: 'u' }), 'utf8');
    delete process.env['DEEPAI_CODE_API_KEY'];
    process.env['DEEPAI_CODE_ACCOUNT_FILE'] = accountFile;
    let capturedKey = '';
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedKey = new Headers(init?.headers).get('api-key') ?? '';
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), { status: 200 });
    }) as typeof fetch;
    try {
      await sendToDeepAI(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'deepai/glm-5.3-flash',
        64,
        '',
      );
      check('DeepAI Code le a conta salva do app', capturedKey === 'app-account-key');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCodeKey === undefined) delete process.env['DEEPAI_CODE_API_KEY'];
      else process.env['DEEPAI_CODE_API_KEY'] = originalCodeKey;
      if (originalAccountFile === undefined) delete process.env['DEEPAI_CODE_ACCOUNT_FILE'];
      else process.env['DEEPAI_CODE_ACCOUNT_FILE'] = originalAccountFile;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const encoder = new TextEncoder();
      const events = [
        'data: {"choices":[{"delta":{"content":"olá"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n',
        'data: [DONE]\n\n',
      ].map(event => encoder.encode(event));
      let next = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read(): Promise<{ done: boolean; value?: Uint8Array }> {
                if (next >= events.length) return { done: true };
                return { done: false, value: events[next++] };
              },
            };
          },
        },
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const streamed: string[] = [];
      const res = await sendToDeepAI(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'deepai/glm-5.3-flash',
        512,
        'deepai-test',
        false,
        0.7,
        { onToken: chunk => streamed.push(chunk) },
      );
      check(
        'DeepAI Code faz streaming SSE quando ha onToken',
        capturedBody['stream'] === true &&
          streamed.join('') === 'olá mundo' &&
          res.text === 'olá mundo',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // 22. Vyce AI (OpenAI-compatible com key rotation)
  check('Vyce AI usa VYCEAI_API_KEY', PROVIDER_ENV_KEYS.vyceai === 'VYCEAI');
  check('rotulo Vyce AI', PROVIDER_LABELS.vyceai === 'Vyce AI');
  check(
    'Vyce AI expoe 8 modelos OpenAI e Claude',
    VYCEAI_MODELS.length === 8 &&
      VYCEAI_MODELS.every(model => model.provider === 'vyceai') &&
      getVyceAIModelById('gpt-4o-mini')?.id === 'gpt-4o-mini' &&
      getVyceAIModelById('claude-3-haiku')?.id === 'claude-3-haiku' &&
      getVyceAIModelById('gpt-4-turbo')?.id === 'gpt-4-turbo' &&
      getVyceAIModelById('llama-2-70b')?.id === 'llama-2-70b',
  );
  check(
    'Vyce AI separa tiers por performance',
    VYCEAI_MODELS.find(model => model.id === 'gpt-4o-mini')?.tier === 'economy' &&
      VYCEAI_MODELS.find(model => model.id === 'gpt-4o')?.tier === 'standard' &&
      VYCEAI_MODELS.find(model => model.id === 'claude-3-opus')?.tier === 'premium',
  );
  check('modelo Vyce AI pertence ao provider', ownerOf('vyceai::gpt-4o') === 'vyceai');
  check('modelo qualificado com :: pertence ao vyceai', ownerOf('vyceai::claude-3-sonnet') === 'vyceai');

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedModel = '';
    let capturedTokens = 0;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get('Authorization') ?? '';
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      capturedModel = body['model'] as string;
      capturedTokens = body['max_tokens'] as number;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from Vyce' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await sendToVyceAI(
        [{ role: 'user', content: 'olá', timestamp: 1 }],
        'vyceai/gpt-4o-mini',
        256,
        'sk-test-key-123',
      );
      check(
        'Vyce AI usa POST /v1/chat/completions',
        capturedUrl === 'https://vyceai.com/v1/chat/completions',
      );
      check('Vyce AI envia Bearer token', capturedAuth.includes('Bearer'));
      check('Vyce AI envia modelo correto', capturedModel === 'gpt-4o-mini');
      check('Vyce AI envia max_tokens', capturedTokens === 256);
      check(
        'Vyce AI converte resposta OpenAI',
        res.text === 'Hello from Vyce' && res.inputTokens === 10 && res.outputTokens === 5,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    const originalPool = process.env['VYCEAI_API_KEYS'];
    process.env['VYCEAI_API_KEYS'] = 'sk-test-key-2,sk-test-key-3';
    let attemptCount = 0;
    let usedKeys: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      attemptCount++;
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      usedKeys.push(auth);
      // Simula: 1ª chave falha com 429, 2ª chave tem sucesso
      if (attemptCount === 1) {
        return new Response(JSON.stringify({ error: 'Rate limit' }), { status: 429 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Fallback success' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const res = await sendToVyceAI(
        [{ role: 'user', content: 'teste failover', timestamp: 1 }],
        'gpt-4o',
        128,
        'sk-test-key',
      );
      check(
        'Vyce AI failover em 429: tenta próxima chave',
        attemptCount >= 2 && res.text === 'Fallback success',
      );
      check(
        'Vyce AI usa chaves do ambiente no failover',
        usedKeys.length >= 2 && usedKeys[0] !== usedKeys[1],
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPool === undefined) delete process.env['VYCEAI_API_KEYS'];
      else process.env['VYCEAI_API_KEYS'] = originalPool;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'astra ok' }] },
          { type: 'reasoning', summary: [{ text: 'pensei' }] },
        ],
        usage: { input_tokens: 5, output_tokens: 2 },
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await sendToDeepAI(
        [
          { role: 'system', content: 'seja breve', timestamp: 1 },
          { role: 'user', content: 'oi', timestamp: 2 },
        ],
        'deepai::gpt-6-astra',
        4096,
        'deepai-test',
      );
      check(
        'DeepAI Code usa /responses para GPT-6 Astra',
        capturedUrl === 'https://api.deepai.org/deepai_code/responses',
      );
      check(
        'DeepAI Code envia instructions/input no Responses',
        capturedBody['instructions'] === 'seja breve' &&
          Array.isArray(capturedBody['input']) &&
          capturedBody['max_output_tokens'] === 4096,
      );
      check(
        'DeepAI Code converte output do Responses',
        res.text === 'astra ok' && res.reasoning === 'pensei',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { type: 'social_login_required', code: 'social_login_required' },
      check_in: { nonce: 'a'.repeat(32), seconds: 600 },
    }), { status: 403 })) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToDeepAI(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'deepai/glm-5.3-flash',
          128,
          'deepai-test',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check(
        'DeepAI Code explica login social obrigatorio',
        caught.includes('login social') && caught.includes('DEEPAI_CODE_API_KEY'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  check('Qronos AI usa QRONOS_API_KEY', PROVIDER_ENV_KEYS.qronos === 'QRONOS');
  check('rotulo Qronos AI', PROVIDER_LABELS.qronos === 'Qronos AI');

  {
    const mapped = mapQronosCatalog([
      { id: 'free-a', display_name: 'Free A', available: true, min_tier: 'free', context_window: 128000 },
      { id: 'paid-b', display_name: 'Paid B', available: true, min_tier: 'plus', context_window: 128000 },
      { id: 'offline-c', display_name: 'Offline C', available: false, min_tier: 'free', context_window: 128000 },
      { id: 'free-a', display_name: 'Duplicado', available: true, min_tier: 'free', context_window: 128000 },
    ]);
    check(
      'Qronos filtra apenas free tier disponível',
      mapped.length === 1 && mapped[0]?.id === 'free-a',
    );
    check(
      'Qronos free usa custo zero',
      mapped[0]?.costPer1kTokensInput === 0 && mapped[0]?.costPer1kTokensOutput === 0,
    );
    check(
      'Qronos catálogo estático contém Mercury 3',
      QRONOS_MODELS.some(model => model.id === 'mercury-3'),
    );
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'qronos ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await sendToQronos(
        [
          { role: 'system', content: 'seja breve', timestamp: 1 },
          { role: 'user', content: 'oi', timestamp: 2 },
        ],
        'mercury-3',
        256,
        'qronos-test',
      );
      check(
        'Qronos usa /chat/completions',
        capturedUrl === 'https://api.qronos.me/v1/chat/completions',
      );
      check(
        'Qronos envia Bearer e modelo correto',
        capturedHeaders['Authorization'] === 'Bearer qronos-test' &&
          capturedBody['model'] === 'mercury-3',
      );
      check('Qronos converte resposta OpenAI', res.text === 'qronos ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    let caught = '';
    try {
      await sendToQronos(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'modelo-pago',
        128,
        'qronos-test',
      );
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }
    check('Qronos bloqueia modelo fora do free tier', caught.includes('free tier'));
  }

  check('Zro usa ZRO_API_KEY', PROVIDER_ENV_KEYS.zro === 'ZRO');
  check('rotulo Zro', PROVIDER_LABELS.zro === 'Zro');
  check('UnoRouter usa UNOROUTER_API_KEY', PROVIDER_ENV_KEYS.unorouter === 'UNOROUTER');
  check('rotulo UnoRouter', PROVIDER_LABELS.unorouter === 'UnoRouter');

  {
    const mapped = mapZroCatalog([
      { id: 'deepseek-v4.1-flash', mode: 'chat', max_input_tokens: 1000000 },
      { id: 'zro/deepseek-v4.1-flash', mode: 'chat', max_input_tokens: 1000000 },
      { id: 'modelo-imagem', mode: 'image', max_input_tokens: 1000 },
      { id: 'glm-5.3', mode: 'chat', max_input_tokens: 1000000 },
      { id: 'novo-modelo', mode: 'chat', max_input_tokens: 2000000 },
    ]);
    check(
      'Zro deduplica aliases zro/ e ignora modo não-chat',
      mapped.length === 2 &&
        mapped.some(model => model.id === 'deepseek-v4.1-flash') &&
        mapped.some(model => model.id === 'glm-5.3') &&
        !mapped.some(model => model.id === 'novo-modelo'),
    );
    check(
      'Zro usa custos oficiais por 1k',
      getZroModelById('deepseek-v4.1-flash')?.costPer1kTokensInput === 0.0003 &&
        getZroModelById('deepseek-v4.1-flash')?.costPer1kTokensOutput === 0.0011 &&
        getZroModelById('glm-5.3')?.costPer1kTokensInput === 0.0014 &&
        getZroModelById('glm-5.3')?.costPer1kTokensOutput === 0.0042,
    );
    check(
      'Zro catálogo estático tem os 4 modelos oficiais',
      ZRO_MODELS.length === 4 &&
        ZRO_MODELS.some(model => model.id === 'deepseek-v4.1-flash') &&
        ZRO_MODELS.some(model => model.id === 'glm-5.3') &&
        ZRO_MODELS.some(model => model.id === 'dolly2-security') &&
        ZRO_MODELS.some(model => model.id === 'abyss1'),
    );
    check(
      'Zro marca modelos sem acesso como unavailable',
      getZroModelById('deepseek-v4.1-flash')?.status === 'available' &&
        getZroModelById('glm-5.3')?.status === 'unavailable' &&
        getZroModelById('dolly2-security')?.status === 'unavailable' &&
        getZroModelById('abyss1')?.status === 'unavailable',
    );
    const merged = applyZroCatalog([
      { id: 'deepseek-v4.1-flash', mode: 'chat', max_input_tokens: 1000000 },
    ]);
    check(
      'Zro loader dinâmico faz união sem remover modelos oficiais',
      merged === 4 && ZRO_MODELS.length === 4 &&
        getZroModelById('glm-5.3') !== undefined,
    );
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'zro ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await sendToZro(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'deepseek-v4.1-flash',
        256,
        'zro-test',
      );
      check(
        'Zro usa /chat/completions',
        capturedUrl === 'https://zro.moonmath.ai/v1/chat/completions',
      );
      check(
        'Zro envia Bearer e modelo correto',
        capturedHeaders['Authorization'] === 'Bearer zro-test' &&
          capturedBody['model'] === 'deepseek-v4.1-flash',
      );
      check('Zro converte resposta OpenAI', res.text === 'zro ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    let caught = '';
    try {
      await sendToZro(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'modelo-inexistente',
        128,
        'zro-test',
      );
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }
    check('Zro bloqueia modelo fora do catálogo', caught.includes('catálogo'));
  }

  {
    let caught = '';
    try {
      await sendToZro(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'glm-5.3',
        128,
        'zro-test',
      );
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }
    check(
      'Zro explica modelo sem acesso (403)',
      caught.includes('não está disponível') && caught.includes('deepseek-v4.1-flash'),
    );
  }

  {
    const mapped = mapUnoRouterCatalog([
      { id: 'gemini-3.5-flash-lite:free', context_length: 1000000, supported_endpoint_types: ['openai', 'gemini'] },
      { id: 'deepseek-v4.1-flash:free', context_length: 1000000, supported_endpoint_types: ['openai'] },
      { id: 'k-exaone-2.5:free', context_length: 131072, supported_endpoint_types: ['openai'] },
      { id: 'texto-desconhecido:free', context_length: 64000, supported_endpoint_types: ['openai'] },
      { id: 'gpt-4o', context_length: 128000, supported_endpoint_types: ['openai'] },
      { id: 'imagem:free', context_length: 1000, supported_endpoint_types: ['openai', 'image-generation'] },
      { id: 'embedding:free', context_length: 1000, supported_endpoint_types: ['openai', 'embedding'] },
      { id: 'horde:free', context_length: 1000, supported_endpoint_types: ['aihorde'] },
      { id: 'decisao:free', context_length: 1000, supported_endpoint_types: ['typesafe-decisions'] },
      { id: 'whisper-large:free', context_length: 1000, supported_endpoint_types: ['openai'] },
    ]);
    check(
      'UnoRouter inclui todos os LLMs free de texto',
      mapped.length === 4 &&
        mapped.every(model => model.id.endsWith(':free')) &&
        mapped.some(model => model.id === 'texto-desconhecido:free'),
    );
    check(
      'UnoRouter ignora imagem, áudio, embedding e aihorde',
      !mapped.some(model => /imagem|embedding|horde|decisao|whisper/.test(model.id)),
    );
    check(
      'UnoRouter marca consentimento como limited',
      mapped.find(model => model.id === 'deepseek-v4.1-flash:free')?.status === 'limited' &&
        UNOROUTER_CONSENT_REQUIRED.has('deepseek-v4.1-flash:free'),
    );
    check(
      'UnoRouter free usa custo zero',
      mapped.every(model => model.costPer1kTokensInput === 0 && model.costPer1kTokensOutput === 0),
    );
    check(
      'UnoRouter catálogo estático tem Gemini 3.5 e K ExaOne',
      UNOROUTER_MODELS.some(model => model.id === 'gemini-3.5-flash-lite:free') &&
        getUnoRouterModelById('k-exaone-2.5:free') !== undefined &&
        !UNOROUTER_MODELS.some(model => model.id === 'gemini-3-flash:free'),
    );
    check(
      'UnoRouter fallback só usa modelos verificados',
      UNOROUTER_VERIFIED_FALLBACK.every(id => getUnoRouterModelById(id) !== undefined) &&
        UNOROUTER_VERIFIED_FALLBACK.every(id => isUnoRouterTextModel(id, ['openai'])),
    );
  }

  {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'uno ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await sendToUnoRouter(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'gemini-3.5-flash-lite:free',
        256,
        'uno-test',
      );
      check(
        'UnoRouter usa /chat/completions',
        capturedUrl === 'https://api.unorouter.com/v1/chat/completions',
      );
      check(
        'UnoRouter envia Bearer e modelo com :free',
        capturedHeaders['Authorization'] === 'Bearer uno-test' &&
          capturedBody['model'] === 'gemini-3.5-flash-lite:free',
      );
      check('UnoRouter converte resposta OpenAI', res.text === 'uno ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { message: 'needs your consent for these providers' },
    }), { status: 403 })) as typeof fetch;
    try {
      let caught = '';
      try {
        await sendToUnoRouter(
          [{ role: 'user', content: 'oi', timestamp: 1 }],
          'deepseek-v4.1-flash:free',
          128,
          'uno-test',
        );
      } catch (error) {
        caught = error instanceof Error ? error.message : String(error);
      }
      check(
        'UnoRouter explica consentimento 403',
        caught.includes('consentimento') && caught.includes('unorouter.com/consents'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  {
    let caught = '';
    try {
      await sendToUnoRouter(
        [{ role: 'user', content: 'oi', timestamp: 1 }],
        'modelo-pago',
        128,
        'uno-test',
      );
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error);
    }
    check('UnoRouter bloqueia modelo fora do catálogo de texto', caught.includes('catálogo de texto'));
  }

  if (failures > 0) {
    console.error(`\n${failures} verificação(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log('\nProviders smoke OK.');
  }
}

void main();
