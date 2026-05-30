#!/usr/bin/env tsx
/**
 * Sends a synthetic OTLP trace to a running RAGScope instance.
 * Usage: tsx scripts/send-test-trace.ts [--url http://localhost:4321]
 */

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE_URL = urlIdx !== -1 && args[urlIdx + 1] ? args[urlIdx + 1] : 'http://localhost:4321';

function nano(ms: number): string {
  return String(BigInt(ms) * 1_000_000n);
}

const now = Date.now();
const traceId = `test-trace-${Date.now().toString(16)}`;
const chainSpanId = 'span-chain-001';
const embedSpanId = 'span-embed-002';
const retrieverSpanId = 'span-retriever-003';
const llmSpanId = 'span-llm-004';

const docs = [
  {
    id: 'doc-paris-1',
    score: 0.92,
    content: 'Paris is the capital city of France, known for the Eiffel Tower.',
  },
  {
    id: 'doc-paris-2',
    score: 0.85,
    content: 'France is a country in Western Europe. Its capital is Paris.',
  },
  {
    id: 'doc-paris-3',
    score: 0.71,
    content: 'The Louvre Museum is located in Paris and houses the Mona Lisa.',
  },
];

const payload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-rag-app' } },
          { key: 'service.version', value: { stringValue: '1.0.0' } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: 'traceai', version: '0.1.0' },
          spans: [
            // Root CHAIN span
            {
              traceId,
              spanId: chainSpanId,
              name: 'rag.pipeline',
              kind: 1,
              startTimeUnixNano: nano(now),
              endTimeUnixNano: nano(now + 420),
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'chain' } },
                { key: 'ai.prompt', value: { stringValue: 'What is the capital of France?' } },
              ],
            },
            // EMBEDDING span
            {
              traceId,
              spanId: embedSpanId,
              parentSpanId: chainSpanId,
              name: 'openai.embeddings',
              kind: 3,
              startTimeUnixNano: nano(now + 10),
              endTimeUnixNano: nano(now + 60),
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'embeddings' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'text-embedding-3-small' } },
                { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                { key: 'gen_ai.usage.input_tokens', value: { intValue: '8' } },
              ],
            },
            // RETRIEVER span
            {
              traceId,
              spanId: retrieverSpanId,
              parentSpanId: chainSpanId,
              name: 'qdrant.query',
              kind: 3,
              startTimeUnixNano: nano(now + 65),
              endTimeUnixNano: nano(now + 165),
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'retrieve' } },
                { key: 'gen_ai.system', value: { stringValue: 'qdrant' } },
                {
                  key: 'gen_ai.retrieval.documents',
                  value: { stringValue: JSON.stringify(docs) },
                },
              ],
            },
            // LLM span
            {
              traceId,
              spanId: llmSpanId,
              parentSpanId: chainSpanId,
              name: 'openai.chat',
              kind: 3,
              startTimeUnixNano: nano(now + 170),
              endTimeUnixNano: nano(now + 400),
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
                { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                { key: 'gen_ai.usage.input_tokens', value: { intValue: '120' } },
                { key: 'gen_ai.usage.output_tokens', value: { intValue: '42' } },
                {
                  key: 'ai.prompt',
                  value: {
                    stringValue: [
                      'Context:',
                      docs[0].content,
                      docs[1].content,
                      '',
                      'Question: What is the capital of France?',
                    ].join('\n'),
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

async function main() {
  console.log(`Sending test trace to ${BASE_URL}/v1/traces`);
  console.log(`Trace ID: ${traceId}`);

  const res = await fetch(`${BASE_URL}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error ${res.status}: ${text}`);
    process.exit(1);
  }

  const body = await res.json();
  console.log('Response:', JSON.stringify(body));
  console.log(`\nView trace at: ${BASE_URL.replace(':4321', ':3000')}/traces/${traceId}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
