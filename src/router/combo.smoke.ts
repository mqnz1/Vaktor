// Smoke do Combo sem rede: pesos, orçamento rígido, fallback e wake-up.
import {
  buildComboCandidates,
  emptyComboConfig,
  isWakeableError,
  normalizeComboConfig,
  parseComboMembersInput,
  weightedOrder,
} from './combo.js';

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FALHOU ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const members = [
  { model: 'free-model', weight: 3 },
  { model: 'paid-model', weight: 1 },
];

// random() = 0 sempre escolhe o primeiro peso restante.
const orderLow = weightedOrder(members, () => 0).map(member => member.model);
check('ordem inclui todos os membros', orderLow.length === 2);
check('random=0 prioriza o primeiro', orderLow[0] === 'free-model');

// random() quase 1 sempre escolhe o último peso restante.
const orderHigh = weightedOrder(members, () => 0.999).map(member => member.model);
check('random alto prioriza o último', orderHigh[0] === 'paid-model');

check('membro com peso 0 é ignorado', weightedOrder([{ model: 'x', weight: 0 }], () => 0).length === 0);

const costs: Record<string, number> = {
  free: 0,
  cheap: 0.2,
  expensive: 0.9,
};
const config = normalizeComboConfig({
  enabled: true,
  members: [
    { model: 'expensive', weight: 1 },
    { model: 'free', weight: 1 },
  ],
  fallback: ['cheap', 'free'],
  budgetUsd: 0,
  maxCostPerRequestUsd: 0,
});

const tight = buildComboCandidates(config, {
  estimateCost: model => costs[model] ?? 0,
  remainingUsd: 0.1,
});
check('pago que não cabe é cortado', !tight.some(candidate => candidate.model === 'expensive'));
check('grátis sempre cabe', tight.some(candidate => candidate.model === 'free'));
check('fallback que não cabe é cortado', !tight.some(candidate => candidate.model === 'cheap'));

const zeroBalance = buildComboCandidates(config, {
  estimateCost: model => costs[model] ?? 0,
  remainingUsd: 0,
});
check('saldo zero mantém só o grátis', zeroBalance.length === 1 && zeroBalance[0]?.model === 'free');

const generous = buildComboCandidates(config, {
  estimateCost: model => costs[model] ?? 0,
  remainingUsd: 10,
});
check('fallback entra depois dos membros', generous[generous.length - 1]?.model === 'cheap');
check('fallback duplicado não repete', generous.filter(candidate => candidate.model === 'free').length === 1);

const perRequest = normalizeComboConfig({ ...config, maxCostPerRequestUsd: 0.05 });
const capped = buildComboCandidates(perRequest, {
  estimateCost: model => costs[model] ?? 0,
  remainingUsd: 10,
});
check('teto por requisição corta o caro', !capped.some(candidate => candidate.model === 'expensive'));

check('wake-up reconhece 503', isWakeableError('HTTP 503 Service Unavailable'));
check('wake-up reconhece timeout', isWakeableError('fetch failed: ETIMEDOUT'));
check('wake-up não trata 401 como sono', !isWakeableError('401 invalid api key'));

const parsed = parseComboMembersInput('a=2, b, c=0, d=x');
check('parser lê pesos', parsed.find(member => member.model === 'a')?.weight === 2);
check('parser usa peso 1 por padrão', parsed.find(member => member.model === 'b')?.weight === 1);
check('parser ignora peso 0', !parsed.some(member => member.model === 'c'));
check('parser tolera peso inválido', parsed.find(member => member.model === 'd')?.weight === 1);
check('config vazia começa desligada', emptyComboConfig().enabled === false);

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exitCode = 1;
} else {
  console.log('\nCombo smoke OK.');
}
