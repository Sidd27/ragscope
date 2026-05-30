import { describe, it, expect } from 'vitest';
import { scoreTrace } from './scorer.js';
import type { RagSpan, RagChunk } from '../types.js';

function makeChunk(overrides: Partial<RagChunk> = {}): RagChunk {
  return {
    id: 'uuid-1',
    spanId: 'span-1',
    traceId: 'trace-1',
    chunkId: 'chunk-1',
    content: 'some content',
    scoreRaw: 0.8,
    scoreNormalized: 0.8,
    rankRetrieval: 1,
    rankReranked: null,
    scoreReranked: null,
    tokenCount: 100,
    vectorStore: null,
    inContext: true,
    contextPosition: 0,
    overlapWithNext: 0.1,
    scoreMissing: false,
    ...overrides,
  };
}

function makeSpan(overrides: Partial<RagSpan> = {}): RagSpan {
  return {
    id: 'span-1',
    traceId: 'trace-1',
    parentSpanId: null,
    name: 'llm',
    kind: 'LLM',
    startTimeMs: 0,
    endTimeMs: 1000,
    latencyMs: 1000,
    operationName: 'chat',
    model: 'llama3',
    system: null,
    inputTokens: 500,
    outputTokens: 100,
    ...overrides,
  };
}

describe('scoreTrace', () => {
  it('returns PASS when all chunks are in context', () => {
    const chunks = [makeChunk({ inContext: true }), makeChunk({ chunkId: 'c2', inContext: true })];
    const result = scoreTrace('svc', 'q', [makeSpan()], chunks);
    expect(result.label).toBe('PASS');
    expect(result.overall).toBeGreaterThanOrEqual(75);
  });

  it('returns FAIL when no chunks reach the LLM', () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk({ chunkId: `c${i}`, inContext: false, tokenCount: 100 }),
    );
    const result = scoreTrace('svc', 'q', [makeSpan()], chunks);
    expect(result.label).toBe('FAIL');
    expect(result.overall).toBeLessThan(50);
  });

  it('precision score is inContext/total * 100', () => {
    const chunks = [
      makeChunk({ chunkId: 'c1', inContext: true }),
      makeChunk({ chunkId: 'c2', inContext: false }),
      makeChunk({ chunkId: 'c3', inContext: false }),
      makeChunk({ chunkId: 'c4', inContext: false }),
    ];
    const result = scoreTrace('svc', 'q', [], chunks);
    const precision = result.subscores.find((s) => s.name === 'precision')!;
    expect(precision.score).toBe(25);
    expect(precision.symbol).toBe('✗');
  });

  it('coverage score is 100 when no scoreMissing', () => {
    const chunks = [makeChunk({ scoreMissing: false })];
    const result = scoreTrace('svc', 'q', [], chunks);
    const coverage = result.subscores.find((s) => s.name === 'coverage')!;
    expect(coverage.score).toBe(100);
  });

  it('coverage score penalizes scoreMissing chunks', () => {
    const chunks = [
      makeChunk({ chunkId: 'c1', scoreMissing: true }),
      makeChunk({ chunkId: 'c2', scoreMissing: true }),
      makeChunk({ chunkId: 'c3', scoreMissing: false }),
      makeChunk({ chunkId: 'c4', scoreMissing: false }),
    ];
    const result = scoreTrace('svc', 'q', [], chunks);
    const coverage = result.subscores.find((s) => s.name === 'coverage')!;
    expect(coverage.score).toBe(50);
  });

  it('returns PASS/WARN/FAIL label matching overall threshold', () => {
    const allIn = Array.from({ length: 4 }, (_, i) =>
      makeChunk({ chunkId: `c${i}`, inContext: true }),
    );
    const r1 = scoreTrace('s', 'q', [], allIn);
    expect(r1.label).toBe('PASS');

    const halfIn = [
      makeChunk({ chunkId: 'c1', inContext: true, tokenCount: 100 }),
      makeChunk({ chunkId: 'c2', inContext: false, tokenCount: 100 }),
    ];
    const r2 = scoreTrace('s', 'q', [], halfIn);
    expect(['WARN', 'FAIL']).toContain(r2.label);
  });

  it('returns 4 subscores named precision, efficiency, redundancy, coverage', () => {
    const result = scoreTrace('svc', 'q', [], [makeChunk()]);
    const names = result.subscores.map((s) => s.name);
    expect(names).toEqual(['precision', 'efficiency', 'redundancy', 'coverage']);
  });
});
