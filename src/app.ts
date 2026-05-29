import Fastify from 'fastify'
import cors from '@fastify/cors'
import { parseOtlpPayload } from './ingestion/otlp-parser.js'
import { ingestTrace } from './enrichment/pipeline.js'
import { getTraces, getTraceById } from './db/queries.js'
import type { Db } from './db/index.js'
import type { OtlpPayload, RagChunk, RagSpan } from './types.js'

function tokenBudget(spans: RagSpan[], chunks: RagChunk[]) {
  const llm = spans.find(s => s.kind === 'LLM')
  return {
    totalInput: llm?.inputTokens ?? null,
    outputTokens: llm?.outputTokens ?? null,
    chunkTokens: chunks.filter(c => c.inContext).reduce((n, c) => n + (c.tokenCount ?? 0), 0),
    wastedTokens: chunks.filter(c => !c.inContext).reduce((n, c) => n + (c.tokenCount ?? 0), 0),
  }
}

function buildTrace(result: NonNullable<Awaited<ReturnType<typeof getTraceById>>>) {
  const { spans, chunks } = result
  const hasReranker = spans.some(s => s.kind === 'RERANKER')
  const rerankerDiff = hasReranker
    ? chunks
        .filter(c => c.rankRetrieval != null && c.rankReranked != null)
        .map(c => ({
          chunkId: c.chunkId,
          rankRetrieval: c.rankRetrieval!,
          rankReranked: c.rankReranked!,
          rankDelta: c.rankRetrieval! - c.rankReranked!,
          scoreRaw: c.scoreRaw,
          scoreReranked: c.scoreReranked,
          scoreDelta: c.scoreReranked != null && c.scoreRaw != null ? c.scoreReranked - c.scoreRaw : null,
        }))
        .sort((a, b) => a.rankReranked - b.rankReranked)
    : null
  return { ...result, tokenBudget: tokenBudget(spans, chunks), rerankerDiff }
}

export function createApp(db: Db, onTrace?: (traceId: string) => void) {
  const app = Fastify({ logger: false })

  app.register(cors, { origin: true })

  app.get('/health', () => ({ ok: true }))

  // OTLP ingestion
  app.post('/v1/traces', async (req, reply) => {
    const ct = req.headers['content-type'] ?? ''
    if (!ct.includes('application/json')) return reply.code(415).send({ error: 'Only application/json is supported' })
    const traces = parseOtlpPayload(req.body as OtlpPayload)
    for (const trace of traces) {
      await ingestTrace(db, trace, 'manual')
      onTrace?.(trace.traceId)
    }
    return { partialSuccess: {} }
  })

  // List traces
  app.get('/api/traces', async (req) => {
    const limit = parseInt((req.query as Record<string, string>).limit ?? '100', 10)
    return getTraces(db, isNaN(limit) ? 100 : limit)
  })

  // Trace detail
  app.get<{ Params: { id: string } }>('/api/traces/:id', async (req, reply) => {
    const result = await getTraceById(db, req.params.id)
    if (!result) return reply.code(404).send({ error: 'Not found' })
    return buildTrace(result)
  })

  // Similarity matrix (lazy-loads HuggingFace)
  app.get<{ Params: { id: string } }>('/api/traces/:id/similarity', async (req, reply) => {
    const result = await getTraceById(db, req.params.id)
    if (!result) return reply.code(404).send({ error: 'Not found' })
    const chunks = result.chunks.filter(c => c.content)
    if (chunks.length < 2) return reply.send(null)
    const { computeSimilarityMatrix } = await import('./enrichment/embeddings.js')
    const matrix = await computeSimilarityMatrix(chunks)
    if (!matrix) return reply.send(null)
    return { chunkIds: chunks.map(c => c.chunkId), matrix }
  })

  // Compare two traces
  app.get<{ Querystring: { a: string; b: string } }>('/api/compare', async (req, reply) => {
    const { a, b } = req.query
    if (!a || !b) return reply.code(400).send({ error: 'Missing ?a= and ?b= params' })
    const [traceA, traceB] = await Promise.all([getTraceById(db, a), getTraceById(db, b)])
    if (!traceA || !traceB) return reply.code(404).send({ error: 'One or both traces not found' })
    return { a: buildTrace(traceA), b: buildTrace(traceB) }
  })

  return app
}
