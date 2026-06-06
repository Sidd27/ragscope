#!/usr/bin/env tsx
/**
 * Sends 4 synthetic OTLP traces covering distinct retrieval scenarios.
 * Usage: npx tsx scripts/send-test-trace.ts [--url http://localhost:4321]
 *
 * Scenario 1 — PASS:   3 chunks, all reach the LLM, clean boundaries
 * Scenario 2 — WARN:   8 chunks retrieved, only 2 reach the LLM (TOP_K too high)
 * Scenario 3 — FAIL:   5 chunks retrieved, none reach the LLM (broken pipeline)
 * Scenario 4 — PASS*:  3 chunks in context but 2 are near-duplicates (uniqueness warning)
 */

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE_URL = urlIdx !== -1 && args[urlIdx + 1] ? args[urlIdx + 1] : 'http://localhost:4321';

function nano(ms: number): string {
  return String(BigInt(ms) * 1_000_000n);
}

function uid(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Doc = { id: string; score: number; content: string };

function buildPayload(opts: {
  traceId: string;
  service: string;
  query: string;
  docs: Doc[];
  contextDocs: Doc[];
}) {
  const now = Date.now();
  const chainId = 'span-chain';
  const retrieverId = 'span-retriever';
  const llmId = 'span-llm';

  const prompt = opts.contextDocs.length
    ? `Context:\n${opts.contextDocs.map((d) => d.content).join('\n')}\n\nQuestion: ${opts.query}`
    : `Question: ${opts.query}`;

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: opts.service } }],
        },
        scopeSpans: [
          {
            scope: { name: 'ragscope-test' },
            spans: [
              {
                traceId: opts.traceId,
                spanId: chainId,
                name: 'rag.pipeline',
                kind: 1,
                startTimeUnixNano: nano(now),
                endTimeUnixNano: nano(now + 420),
                attributes: [
                  { key: 'gen_ai.operation.name', value: { stringValue: 'chain' } },
                  { key: 'ai.prompt', value: { stringValue: opts.query } },
                ],
              },
              {
                traceId: opts.traceId,
                spanId: retrieverId,
                parentSpanId: chainId,
                name: 'qdrant.query',
                kind: 3,
                startTimeUnixNano: nano(now + 20),
                endTimeUnixNano: nano(now + 120),
                attributes: [
                  { key: 'gen_ai.operation.name', value: { stringValue: 'retrieve' } },
                  { key: 'gen_ai.system', value: { stringValue: 'qdrant' } },
                  {
                    key: 'gen_ai.retrieval.documents',
                    value: { stringValue: JSON.stringify(opts.docs) },
                  },
                ],
              },
              {
                traceId: opts.traceId,
                spanId: llmId,
                parentSpanId: chainId,
                name: 'openai.chat',
                kind: 3,
                startTimeUnixNano: nano(now + 130),
                endTimeUnixNano: nano(now + 400),
                attributes: [
                  { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                  { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
                  { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                  {
                    key: 'gen_ai.usage.input_tokens',
                    value: { intValue: String(50 + opts.contextDocs.length * 25) },
                  },
                  { key: 'gen_ai.usage.output_tokens', value: { intValue: '42' } },
                  { key: 'ai.prompt', value: { stringValue: prompt } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function send(label: string, payload: unknown): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`[${label}] Error ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log(`  → ${label}`);
}

async function main() {
  console.log(`\nSending 4 test traces to ${BASE_URL} ...\n`);

  // ── Scenario 1: Clean pipeline ─────────────────────────────────────────
  // 3 chunks retrieved, all 3 appear in the LLM prompt, no overlap.
  // Expected: PASS ~100
  const s1docs: Doc[] = [
    {
      id: 's1-1',
      score: 0.92,
      content: 'Paris is the capital city of France, known for the Eiffel Tower.',
    },
    {
      id: 's1-2',
      score: 0.85,
      content: 'France is a country in Western Europe. Its capital is Paris.',
    },
    {
      id: 's1-3',
      score: 0.71,
      content: 'The Louvre Museum is located in Paris and houses the Mona Lisa.',
    },
  ];
  await send(
    'Scenario 1 — clean pipeline (expect PASS ~100)',
    buildPayload({
      traceId: uid(),
      service: 'my-rag-app',
      query: 'What is the capital of France?',
      docs: s1docs,
      contextDocs: s1docs,
    }),
  );
  await sleep(400);

  // ── Scenario 2: TOP_K too high ─────────────────────────────────────────
  // 8 chunks retrieved but only top 2 appear in the LLM prompt.
  // Expected: precision 25%, efficiency ~25% → FAIL
  const s2docs: Doc[] = [
    { id: 's2-1', score: 0.88, content: 'Leonardo da Vinci painted the Mona Lisa around 1503.' },
    {
      id: 's2-2',
      score: 0.81,
      content: 'The Mona Lisa is displayed at the Louvre Museum in Paris.',
    },
    {
      id: 's2-3',
      score: 0.74,
      content: 'Leonardo da Vinci was an Italian Renaissance artist and polymath.',
    },
    {
      id: 's2-4',
      score: 0.68,
      content: "The Louvre is the world's largest art museum, located in Paris.",
    },
    {
      id: 's2-5',
      score: 0.61,
      content: 'Renaissance art flourished in Italy during the 14th to 17th centuries.',
    },
    {
      id: 's2-6',
      score: 0.55,
      content: 'Italian artists were known for their mastery of perspective and light.',
    },
    {
      id: 's2-7',
      score: 0.49,
      content: 'Oil painting became widespread during the Northern Renaissance period.',
    },
    {
      id: 's2-8',
      score: 0.43,
      content: 'Museum collections often span multiple periods and movements.',
    },
  ];
  await send(
    'Scenario 2 — TOP_K too high (expect FAIL, precision 25%)',
    buildPayload({
      traceId: uid(),
      service: 'my-rag-app',
      query: 'Who painted the Mona Lisa?',
      docs: s2docs,
      contextDocs: s2docs.slice(0, 2),
    }),
  );
  await sleep(400);

  // ── Scenario 3: Broken pipeline ────────────────────────────────────────
  // 5 chunks retrieved but none appear in the LLM prompt (pipeline bug).
  // Expected: precision 0%, efficiency 0% → FAIL
  const s3docs: Doc[] = [
    {
      id: 's3-1',
      score: 0.79,
      content: 'World War II ended in 1945 with the surrender of Germany and Japan.',
    },
    {
      id: 's3-2',
      score: 0.71,
      content: 'The Allied powers declared victory in Europe on May 8, 1945 (V-E Day).',
    },
    {
      id: 's3-3',
      score: 0.65,
      content: 'Japan formally surrendered on September 2, 1945 (V-J Day).',
    },
    {
      id: 's3-4',
      score: 0.58,
      content: 'The United Nations was founded in 1945 following the end of the war.',
    },
    {
      id: 's3-5',
      score: 0.5,
      content: 'The Nuremberg Trials began in 1945 to prosecute Nazi war criminals.',
    },
  ];
  await send(
    'Scenario 3 — broken pipeline (expect FAIL, precision 0%)',
    buildPayload({
      traceId: uid(),
      service: 'my-rag-app',
      query: 'What year did World War II end?',
      docs: s3docs,
      contextDocs: [],
    }),
  );
  await sleep(400);

  // ── Scenario 4: Near-duplicate chunks ──────────────────────────────────
  // Sliding-window chunking artifact: the last 64 chars of chunk 1 are the
  // literal first 64 chars of chunk 2, so the boundary detector fires.
  // Expected: PASS overall (~92), but uniqueness shows as WARN (~62)
  const s4docs: Doc[] = [
    {
      id: 's4-1',
      score: 0.91,
      content:
        'Plants and algae use chlorophyll to capture light and convert it into chemical energy',
    },
    {
      id: 's4-2',
      score: 0.87,
      content:
        'chlorophyll to capture light and convert it into chemical energy through a process called photosynthesis',
    },
    {
      id: 's4-3',
      score: 0.72,
      content:
        'Photosynthesis produces glucose which is the primary energy source for plant growth and cellular respiration.',
    },
  ];
  await send(
    'Scenario 4 — near-duplicate chunks (expect PASS, uniqueness WARN)',
    buildPayload({
      traceId: uid(),
      service: 'my-rag-app',
      query: 'How does photosynthesis work?',
      docs: s4docs,
      contextDocs: s4docs,
    }),
  );

  console.log('\nAll traces sent. Check the RAGScope terminal.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
