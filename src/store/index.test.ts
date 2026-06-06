import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, upsertTrace, getTraceById } from './index.js';
import type { RagTrace, RagSpan, RagChunk } from '../types.js';

function makeTrace(overrides: Partial<RagTrace> = {}): RagTrace {
  return {
    id: 'trace-001',
    serviceName: 'test-app',
    query: 'What is Paris?',
    source: 'otlp',
    totalLatencyMs: 250,
    spanCount: 2,
    chunkCount: 3,
    createdAt: Date.now(),
    ...overrides,
  };
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
  };
}

function makeChunk(overrides: Partial<RagChunk> = {}): RagChunk {
  return {
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
  };
}

describe('Store', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  it('inserts and retrieves a trace', () => {
    upsertTrace(store, makeTrace(), [makeSpan()], [makeChunk()]);
    const result = getTraceById(store, 'trace-001');
    expect(result).not.toBeNull();
    expect(result!.trace.id).toBe('trace-001');
    expect(result!.trace.serviceName).toBe('test-app');
  });

  it('returns null for unknown traceId', () => {
    expect(getTraceById(store, 'nonexistent')).toBeNull();
  });

  it('retrieves spans and chunks with trace', () => {
    upsertTrace(store, makeTrace(), [makeSpan()], [makeChunk()]);
    const result = getTraceById(store, 'trace-001');
    expect(result!.spans).toHaveLength(1);
    expect(result!.chunks).toHaveLength(1);
    expect(result!.chunks[0].chunkId).toBe('doc-1');
  });

  it('ignores duplicate inserts, preserving original data', () => {
    upsertTrace(store, makeTrace(), [makeSpan()], [makeChunk()]);
    upsertTrace(store, makeTrace(), [], []);
    const result = getTraceById(store, 'trace-001');
    expect(result!.spans).toHaveLength(1);
  });
});
