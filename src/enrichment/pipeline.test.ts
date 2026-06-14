import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, getTraceById } from '../store/index.js';
import { ingestTrace } from './pipeline.js';
import type { ParsedTrace } from '../types.js';

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
        documents: [
          { id: 'doc-1', score: 0.9, content: 'Paris is the capital of France.' },
          { id: 'doc-2', score: 0.7, content: 'France is a country in Europe.' },
        ],
      },
    ],
  };
}

describe('ingestTrace', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  it('inserts trace, spans, and chunks', () => {
    ingestTrace(store, makeTrace(), 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    expect(result).not.toBeNull();
    expect(result!.trace.spanCount).toBe(2);
    expect(result!.trace.chunkCount).toBe(2);
  });

  it('sets correct totalLatencyMs', () => {
    ingestTrace(store, makeTrace(), 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    expect(result!.trace.totalLatencyMs).toBe(500);
  });

  it('extracts query from CHAIN span prompt', () => {
    ingestTrace(store, makeTrace(), 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    expect(result!.trace.query).toBe('What is Paris?');
  });

  it('normalizes scores for qdrant (pass-through)', () => {
    ingestTrace(store, makeTrace(), 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    const topChunk = result!.chunks.find((c) => c.chunkId === 'doc-1')!;
    expect(topChunk.scoreRaw).toBeCloseTo(0.9);
    expect(topChunk.scoreNormalized).toBeCloseTo(0.9);
  });

  it('assigns rankRetrieval to chunks', () => {
    ingestTrace(store, makeTrace(), 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    const ranks = result!.chunks.map((c) => c.rankRetrieval).sort();
    expect(ranks).toEqual([1, 2]);
  });

  it('sets tokenCount for chunks with content', () => {
    ingestTrace(store, makeTrace(), 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    for (const chunk of result!.chunks) {
      expect(chunk.tokenCount).not.toBeNull();
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('marks scoreMissing=true for langfuse source with zero score', () => {
    const trace = makeTrace();
    trace.spans[1].documents = [{ id: 'doc-x', score: 0 }];
    ingestTrace(store, trace, 'langfuse');
    const result = getTraceById(store, 'trace-pipeline-001');
    expect(result!.chunks.find((c) => c.chunkId === 'doc-x')!.scoreMissing).toBe(true);
  });

  it('sets inContext=true for chunks whose content appears in LLM prompt', () => {
    const trace = makeTrace();
    trace.spans.push({
      traceId: 'trace-pipeline-001',
      spanId: 'span-llm',
      parentSpanId: 'span-chain',
      name: 'openai.chat',
      kind: 'LLM',
      startTimeMs: 1200,
      endTimeMs: 1450,
      latencyMs: 250,
      prompt: 'Context:\nParis is the capital of France.\n\nQuestion: What is Paris?',
    });
    ingestTrace(store, trace, 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    const doc1 = result!.chunks.find((c) => c.chunkId === 'doc-1')!;
    const doc2 = result!.chunks.find((c) => c.chunkId === 'doc-2')!;
    expect(doc1.inContext).toBe(true);
    expect(doc1.contextPosition).toBe(0);
    expect(doc2.inContext).toBe(false);
    expect(doc2.contextPosition).toBeNull();
  });

  it('assigns contextPosition by textual order in the prompt, not retrieval order', () => {
    const trace = makeTrace();
    trace.spans[1].documents = [
      { id: 'doc-1', score: 0.9, content: 'Alpha chunk content.' }, // retrieval rank 1
      { id: 'doc-2', score: 0.7, content: 'Beta chunk content.' }, // retrieval rank 2
    ];
    trace.spans.push({
      traceId: 'trace-pipeline-001',
      spanId: 'span-llm',
      parentSpanId: 'span-chain',
      name: 'openai.chat',
      kind: 'LLM',
      startTimeMs: 1200,
      endTimeMs: 1450,
      latencyMs: 250,
      // prompt places the rank-2 chunk BEFORE the rank-1 chunk
      prompt: 'Context:\nBeta chunk content.\n\nAlpha chunk content.\n\nQuestion: ?',
    });
    ingestTrace(store, trace, 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    const doc1 = result!.chunks.find((c) => c.chunkId === 'doc-1')!;
    const doc2 = result!.chunks.find((c) => c.chunkId === 'doc-2')!;
    expect(doc2.contextPosition).toBe(0); // appears first in the prompt text
    expect(doc1.contextPosition).toBe(1);
  });

  it('leaves inContext=false when no LLM span has a prompt', () => {
    ingestTrace(store, makeTrace(), 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    for (const chunk of result!.chunks) {
      expect(chunk.inContext).toBe(false);
    }
  });

  it('does not create duplicate chunks from a reranker span', () => {
    const trace = makeTrace(); // retriever has doc-1, doc-2
    trace.spans.push({
      traceId: 'trace-pipeline-001',
      spanId: 'span-reranker',
      parentSpanId: 'span-chain',
      name: 'cohere.rerank',
      kind: 'RERANKER',
      startTimeMs: 1160,
      endTimeMs: 1190,
      latencyMs: 30,
      operationName: 'rerank',
      // same documents, reordered
      documents: [
        { id: 'doc-2', score: 0.95, content: 'France is a country in Europe.' },
        { id: 'doc-1', score: 0.8, content: 'Paris is the capital of France.' },
      ],
    });
    ingestTrace(store, trace, 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    // 2 retrieved chunks, NOT 4 (the reranker span must not spawn new chunks)
    expect(result!.chunks).toHaveLength(2);
    expect(result!.trace.chunkCount).toBe(2);
    // reranker ranks are merged onto the existing retriever chunks
    const doc1 = result!.chunks.find((c) => c.chunkId === 'doc-1')!;
    expect(doc1.rankRetrieval).toBe(1);
    expect(doc1.rankReranked).toBe(2);
  });

  it('sets overlapWithNext on chunks via boundary detection', () => {
    const trace = makeTrace();
    trace.spans[1].documents = [
      { id: 'a', score: 0.9, content: 'The quick brown fox' },
      { id: 'b', score: 0.7, content: 'brown fox jumps over' },
    ];
    ingestTrace(store, trace, 'otlp');
    const result = getTraceById(store, 'trace-pipeline-001');
    const chunkA = result!.chunks.find((c) => c.chunkId === 'a')!;
    expect(chunkA.overlapWithNext).toBeGreaterThan(0);
  });
});
