import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from './index.js'
import { insertTrace, insertSpans, insertChunks, getTraces, getTraceById } from './queries.js'
import type { RagTrace, RagSpan, RagChunk } from '../types.js'

function makeTrace(overrides: Partial<RagTrace> = {}): RagTrace {
  return {
    id: 'trace-001',
    serviceName: 'test-app',
    query: 'What is Paris?',
    source: 'traceai',
    totalLatencyMs: 250,
    spanCount: 2,
    chunkCount: 3,
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeSpan(overrides: Partial<RagSpan> = {}): RagSpan {
  return {
    id: 'span-001',
    traceId: 'trace-001',
    parentSpanId: null,
    name: 'qdrant.query',
    kind: 'RETRIEVER',
    startTimeMs: 1000,
    endTimeMs: 1100,
    latencyMs: 100,
    operationName: 'retrieve',
    model: null,
    system: 'qdrant',
    inputTokens: null,
    outputTokens: null,
    ...overrides,
  }
}

function makeChunk(overrides: Partial<RagChunk> = {}): RagChunk {
  return {
    id: 'chunk-uuid-001',
    spanId: 'span-001',
    traceId: 'trace-001',
    chunkId: 'doc-1',
    content: 'Paris is the capital of France',
    scoreRaw: 0.92,
    scoreNormalized: 0.92,
    rankRetrieval: 1,
    rankReranked: null,
    scoreReranked: null,
    tokenCount: 7,
    vectorStore: 'qdrant',
    inContext: true,
    contextPosition: 0,
    overlapWithNext: null,
    scoreMissing: false,
    ...overrides,
  }
}

describe('DB queries', () => {
  let db: ReturnType<typeof createDb>

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('inserts and retrieves a trace', async () => {
    await insertTrace(db, makeTrace())
    const traces = await getTraces(db)
    expect(traces).toHaveLength(1)
    expect(traces[0].id).toBe('trace-001')
    expect(traces[0].serviceName).toBe('test-app')
  })

  it('orders traces by createdAt descending', async () => {
    await insertTrace(db, makeTrace({ id: 'trace-old', createdAt: 1000 }))
    await insertTrace(db, makeTrace({ id: 'trace-new', createdAt: 9000 }))
    const traces = await getTraces(db)
    expect(traces[0].id).toBe('trace-new')
    expect(traces[1].id).toBe('trace-old')
  })

  it('returns null for unknown traceId', async () => {
    const result = await getTraceById(db, 'nonexistent')
    expect(result).toBeNull()
  })

  it('retrieves trace with spans and chunks', async () => {
    await insertTrace(db, makeTrace())
    await insertSpans(db, [makeSpan()])
    await insertChunks(db, [makeChunk()])

    const result = await getTraceById(db, 'trace-001')
    expect(result).not.toBeNull()
    expect(result!.spans).toHaveLength(1)
    expect(result!.chunks).toHaveLength(1)
    expect(result!.chunks[0].chunkId).toBe('doc-1')
  })

  it('ignores duplicate inserts gracefully', async () => {
    const trace = makeTrace()
    await insertTrace(db, trace)
    await insertTrace(db, trace)
    const traces = await getTraces(db)
    expect(traces).toHaveLength(1)
  })

  it('handles empty spans and chunks insert', async () => {
    await expect(insertSpans(db, [])).resolves.toBeUndefined()
    await expect(insertChunks(db, [])).resolves.toBeUndefined()
  })
})
