import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from './app.js';
import { createStore, upsertTrace } from './store/index.js';
import type { RagTrace } from './types.js';

function makeTrace(id: string): RagTrace {
  return {
    id,
    serviceName: 'svc',
    query: 'q',
    source: 'otlp',
    totalLatencyMs: 100,
    spanCount: 1,
    chunkCount: 0,
    createdAt: Date.now(),
  };
}

const otlpTrace = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'app-test-trace-001',
              spanId: 'span-1',
              name: 'qdrant.query',
              kind: 3,
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000000100000000',
              attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'retrieve' } }],
            },
          ],
        },
      ],
    },
  ],
};

describe('Fastify app integration', () => {
  let store: ReturnType<typeof createStore>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = createStore();
    app = createApp(store);
    await app.ready();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('POST /v1/traces ingests a trace', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(otlpTrace),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().partialSuccess).toBeDefined();
  });

  it('GET /api/traces/:id returns trace detail', async () => {
    upsertTrace(store, makeTrace('rest-trace-1'), [], []);
    const res = await app.inject({ method: 'GET', url: '/api/traces/rest-trace-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().trace.id).toBe('rest-trace-1');
  });

  it('GET /api/traces/:id returns 404 for unknown trace', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/traces/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
