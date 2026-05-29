import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '../db/index.js'
import { ingestTrace } from './pipeline.js'
import { getTraces, getTraceById } from '../db/queries.js'
import type { ParsedTrace } from '../types.js'

function makeTrace(): ParsedTrace {
  return {
    traceId: 'trace-pipeline-001',
    serviceName: 'test-svc',
    spans: [
      {
        traceId: 'trace-pipeline-001',
        spanId: 'span-chain',
        name: 'rag.pipeline',
        kind: 'CHAIN',
        startTimeMs: 1000,
        endTimeMs: 1500,
        latencyMs: 500,
        rawAttributes: '[]',
        prompt: 'What is Paris?',
      },
      {
        traceId: 'trace-pipeline-001',
        spanId: 'span-retriever',
        parentSpanId: 'span-chain',
        name: 'qdrant.query',
        kind: 'RETRIEVER',
        startTimeMs: 1050,
        endTimeMs: 1150,
        latencyMs: 100,
        system: 'qdrant',
        rawAttributes: '[]',
        documents: [
          { id: 'doc-1', score: 0.9, content: 'Paris is the capital of France.' },
          { id: 'doc-2', score: 0.7, content: 'France is a country in Europe.' },
        ],
      },
    ],
  }
}

describe('ingestTrace', () => {
  let db: ReturnType<typeof createDb>

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('inserts trace, spans, and chunks', async () => {
    await ingestTrace(db, makeTrace(), 'traceai')
    const traces = await getTraces(db)
    expect(traces).toHaveLength(1)
    expect(traces[0].spanCount).toBe(2)
    expect(traces[0].chunkCount).toBe(2)
  })

  it('sets correct totalLatencyMs', async () => {
    await ingestTrace(db, makeTrace(), 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    expect(result!.trace.totalLatencyMs).toBe(500)
  })

  it('extracts query from CHAIN span prompt', async () => {
    await ingestTrace(db, makeTrace(), 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    expect(result!.trace.query).toBe('What is Paris?')
  })

  it('normalizes scores for qdrant (pass-through)', async () => {
    await ingestTrace(db, makeTrace(), 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    const topChunk = result!.chunks.find(c => c.chunkId === 'doc-1')!
    expect(topChunk.scoreRaw).toBeCloseTo(0.9)
    expect(topChunk.scoreNormalized).toBeCloseTo(0.9)
  })

  it('assigns rankRetrieval to chunks', async () => {
    await ingestTrace(db, makeTrace(), 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    const ranks = result!.chunks.map(c => c.rankRetrieval).sort()
    expect(ranks).toEqual([1, 2])
  })

  it('sets tokenCount for chunks with content', async () => {
    await ingestTrace(db, makeTrace(), 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    for (const chunk of result!.chunks) {
      expect(chunk.tokenCount).not.toBeNull()
      expect(chunk.tokenCount).toBeGreaterThan(0)
    }
  })

  it('marks scoreMissing=true for langfuse source with zero score', async () => {
    const trace = makeTrace()
    trace.spans[1].documents = [{ id: 'doc-x', score: 0 }]
    await ingestTrace(db, trace, 'langfuse')
    const result = await getTraceById(db, 'trace-pipeline-001')
    expect(result!.chunks.find(c => c.chunkId === 'doc-x')!.scoreMissing).toBe(true)
  })

  it('sets inContext=true for chunks whose content appears in LLM prompt', async () => {
    const trace = makeTrace()
    trace.spans.push({
      traceId: 'trace-pipeline-001',
      spanId: 'span-llm',
      parentSpanId: 'span-chain',
      name: 'openai.chat',
      kind: 'LLM',
      startTimeMs: 1200,
      endTimeMs: 1450,
      latencyMs: 250,
      rawAttributes: '[]',
      // Only doc-1 content appears in the prompt
      prompt: 'Context:\nParis is the capital of France.\n\nQuestion: What is Paris?',
    })
    await ingestTrace(db, trace, 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    const doc1 = result!.chunks.find(c => c.chunkId === 'doc-1')!
    const doc2 = result!.chunks.find(c => c.chunkId === 'doc-2')!
    expect(doc1.inContext).toBe(true)
    expect(doc1.contextPosition).toBe(0)
    expect(doc2.inContext).toBe(false)
    expect(doc2.contextPosition).toBeNull()
  })

  it('leaves inContext=false when no LLM span has a prompt', async () => {
    await ingestTrace(db, makeTrace(), 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    for (const chunk of result!.chunks) {
      expect(chunk.inContext).toBe(false)
    }
  })

  it('sets overlapWithNext on chunks via boundary detection', async () => {
    const trace = makeTrace()
    trace.spans[1].documents = [
      { id: 'a', score: 0.9, content: 'The quick brown fox' },
      { id: 'b', score: 0.7, content: 'brown fox jumps over' },
    ]
    await ingestTrace(db, trace, 'traceai')
    const result = await getTraceById(db, 'trace-pipeline-001')
    const chunkA = result!.chunks.find(c => c.chunkId === 'a')!
    expect(chunkA.overlapWithNext).toBeGreaterThan(0)
  })
})
