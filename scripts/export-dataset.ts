// =============================================================
// Exporta as sessões gravadas em .vaktor/logs/sessions para o formato
// de chat usado no fine-tuning.
//
// Uso:
//   npm run export:dataset -- --all --out dataset.jsonl
//   npm run export:dataset -- --min-rating 4
//
// O treino do modelo é externo; o Vaktor só coleta e exporta dados.
// =============================================================
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface DatasetRecord {
  id?: string;
  ts?: string;
  model?: string;
  input?: string;
  output?: string;
  verify?: { ok?: boolean };
  rating?: number | null;
}

const SYSTEM_PROMPT =
  'Você é o Vaktor Agent, engenheiro de software sênior. Responda em português do Brasil, ' +
  'leia antes de escrever e não invente resultados de ferramentas.';

interface Args {
  all: boolean;
  out: string;
  minRating: number;
  model: string | null;
  logs: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    all: false,
    out: join(process.cwd(), 'dataset.jsonl'),
    minRating: 0,
    model: null,
    logs: join(process.cwd(), '.vaktor', 'logs', 'sessions'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--out' && argv[i + 1]) args.out = resolve(argv[++i] as string);
    else if (arg === '--min-rating' && argv[i + 1]) args.minRating = Number(argv[++i]);
    else if (arg === '--model' && argv[i + 1]) args.model = argv[++i] as string;
    else if (arg === '--logs' && argv[i + 1]) args.logs = resolve(argv[++i] as string);
  }

  return args;
}

function readRecords(file: string): DatasetRecord[] {
  const records: DatasetRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        records.push(parsed as DatasetRecord);
      }
    } catch {
      // linha corrompida: ignora
    }
  }
  return records;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.logs)) {
    console.error(`Nada para exportar: ${args.logs} não existe.`);
    console.error('Ative ENABLE_DATASET_LOG=true e use o agente primeiro.');
    process.exitCode = 1;
    return;
  }

  const files = readdirSync(args.logs).filter(file => file.endsWith('.jsonl'));
  const output: string[] = [];
  let considered = 0;
  let skipped = 0;

  for (const file of files) {
    for (const record of readRecords(join(args.logs, file))) {
      considered++;
      if (typeof record.input !== 'string' || typeof record.output !== 'string') {
        skipped++;
        continue;
      }
      if (!args.all && record.verify?.ok !== true) {
        skipped++;
        continue;
      }
      if (args.minRating > 0 && (record.rating ?? 0) < args.minRating) {
        skipped++;
        continue;
      }
      if (args.model && record.model !== args.model) {
        skipped++;
        continue;
      }

      output.push(JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: record.input },
          { role: 'assistant', content: record.output },
        ],
        metadata: {
          id: record.id ?? null,
          ts: record.ts ?? null,
          model: record.model ?? null,
        },
      }));
    }
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, output.length > 0 ? `${output.join('\n')}\n` : '', 'utf8');

  console.log(`Sessões lidas: ${considered}`);
  console.log(`Exportadas: ${output.length}`);
  console.log(`Ignoradas: ${skipped}`);
  console.log(`Arquivo: ${args.out}`);
}

main();
