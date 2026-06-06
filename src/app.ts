import Fastify from 'fastify';
import cors from '@fastify/cors';
import { parseOtlpPayload } from './ingestion/otlp-parser.js';
import { ingestTrace } from './enrichment/pipeline.js';
import { getTraceById, type Store } from './store/index.js';
import type { OtlpPayload, RagChunk, RagSpan } from './types.js';

function tokenBudget(spans: RagSpan[], chunks: RagChunk[]) {
  const llm = spans.find((s) => s.kind === 'LLM');
  return {
    totalInput: llm?.inputTokens ?? null,
    outputTokens: llm?.outputTokens ?? null,
    chunkTokens: chunks.filter((c) => c.inContext).reduce((n, c) => n + (c.tokenCount ?? 0), 0),
    wastedTokens: chunks.filter((c) => !c.inContext).reduce((n, c) => n + (c.tokenCount ?? 0), 0),
  };
}

function buildTrace(result: NonNullable<ReturnType<typeof getTraceById>>) {
  const { spans, chunks } = result;
  const hasReranker = spans.some((s) => s.kind === 'RERANKER');
  const rerankerDiff = hasReranker
    ? chunks
        .filter((c) => c.rankRetrieval != null && c.rankReranked != null)
        .map((c) => ({
          chunkId: c.chunkId,
          rankRetrieval: c.rankRetrieval!,
          rankReranked: c.rankReranked!,
          rankDelta: c.rankRetrieval! - c.rankReranked!,
          scoreRaw: c.scoreRaw,
          scoreReranked: c.scoreReranked,
          scoreDelta:
            c.scoreReranked != null && c.scoreRaw != null ? c.scoreReranked - c.scoreRaw : null,
        }))
        .sort((a, b) => a.rankReranked - b.rankReranked)
    : null;
  return { ...result, tokenBudget: tokenBudget(spans, chunks), rerankerDiff };
}

export function createApp(store: Store, onTrace?: (traceId: string) => void) {
  const app = Fastify({ logger: false });

  app.register(cors, { origin: true });

  app.get('/health', () => ({ ok: true }));

  app.post('/v1/traces', async (req, reply) => {
    const ct = req.headers['content-type'] ?? '';
    if (!ct.includes('application/json'))
      return reply.code(415).send({ error: 'Only application/json is supported' });
    const traces = parseOtlpPayload(req.body as OtlpPayload);
    for (const trace of traces) {
      ingestTrace(store, trace, 'otlp');
      onTrace?.(trace.traceId);
    }
    return { partialSuccess: {} };
  });

  app.get<{ Params: { id: string } }>('/api/traces/:id', async (req, reply) => {
    const result = getTraceById(store, req.params.id);
    if (!result) return reply.code(404).send({ error: 'Not found' });
    return buildTrace(result);
  });

  app.get<{ Params: { id: string } }>('/api/traces/:id/similarity', async (req, reply) => {
    const result = getTraceById(store, req.params.id);
    if (!result) return reply.code(404).send({ error: 'Not found' });
    const chunks = result.chunks.filter((c) => c.content);
    if (chunks.length < 2) return reply.send(null);
    const { computeSimilarityMatrix } = await import('./enrichment/embeddings.js');
    const matrix = await computeSimilarityMatrix(chunks);
    if (!matrix) return reply.send(null);
    return { chunkIds: chunks.map((c) => c.chunkId), matrix };
  });

  return app;
}
