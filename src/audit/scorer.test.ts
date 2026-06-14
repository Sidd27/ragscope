import { describe, it, expect } from 'vitest';
import { scoreTrace } from './scorer.js';
import type { RagSpan, RagChunk } from '../types.js';

function makeChunk(overrides: Partial<RagChunk> = {}): RagChunk {
  return {
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

  it('returns 4 subscores named precision, efficiency, uniqueness, coverage', () => {
    const result = scoreTrace('svc', 'q', [], [makeChunk()]);
    const names = result.subscores.map((s) => s.name);
    expect(names).toEqual(['precision', 'efficiency', 'uniqueness', 'coverage']);
  });

  describe('buried-context (lost-in-the-middle) precision penalty', () => {
    it('penalizes a high-retrieval-rank chunk buried in the middle of the prompt', () => {
      const chunks = [
        makeChunk({ chunkId: 'c0', inContext: true, contextPosition: 0, rankRetrieval: 2 }),
        makeChunk({ chunkId: 'c1', inContext: true, contextPosition: 1, rankRetrieval: 4 }),
        makeChunk({ chunkId: 'c2', inContext: true, contextPosition: 2, rankRetrieval: 1 }), // top rank, buried
        makeChunk({ chunkId: 'c3', inContext: true, contextPosition: 3, rankRetrieval: 5 }),
        makeChunk({ chunkId: 'c4', inContext: true, contextPosition: 4, rankRetrieval: 3 }),
      ];
      const result = scoreTrace('svc', 'q', [], chunks);
      const precision = result.subscores.find((s) => s.name === 'precision')!;
      expect(precision.score).toBe(88); // base 100 (5/5) − 12 for one buried chunk
      expect(precision.finding).toContain('buried');
      expect(precision.recommendation).toBeTruthy();
    });

    it('does not penalize a high-rank chunk placed at a prompt edge', () => {
      const chunks = [
        makeChunk({ chunkId: 'c0', inContext: true, contextPosition: 0, rankRetrieval: 1 }), // top rank, edge
        makeChunk({ chunkId: 'c1', inContext: true, contextPosition: 1, rankRetrieval: 2 }),
        makeChunk({ chunkId: 'c2', inContext: true, contextPosition: 2, rankRetrieval: 5 }), // middle, low rank
        makeChunk({ chunkId: 'c3', inContext: true, contextPosition: 3, rankRetrieval: 4 }),
        makeChunk({ chunkId: 'c4', inContext: true, contextPosition: 4, rankRetrieval: 3 }),
      ];
      const result = scoreTrace('svc', 'q', [], chunks);
      const precision = result.subscores.find((s) => s.name === 'precision')!;
      expect(precision.score).toBe(100);
      expect(precision.finding).not.toContain('buried');
    });

    it('applies no penalty when 3 or fewer chunks are in context', () => {
      const chunks = [
        makeChunk({ chunkId: 'c0', inContext: true, contextPosition: 0, rankRetrieval: 2 }),
        makeChunk({ chunkId: 'c1', inContext: true, contextPosition: 1, rankRetrieval: 1 }),
        makeChunk({ chunkId: 'c2', inContext: true, contextPosition: 2, rankRetrieval: 3 }),
      ];
      const result = scoreTrace('svc', 'q', [], chunks);
      const precision = result.subscores.find((s) => s.name === 'precision')!;
      expect(precision.score).toBe(100);
    });

    it('caps the total position penalty at 36', () => {
      const ranks = [5, 6, 7, 1, 2, 3, 4, 8, 9, 10]; // top ranks 1-4 at middle positions 3-6
      const chunks = ranks.map((rank, i) =>
        makeChunk({ chunkId: `c${i}`, inContext: true, contextPosition: i, rankRetrieval: rank }),
      );
      const result = scoreTrace('svc', 'q', [], chunks);
      const precision = result.subscores.find((s) => s.name === 'precision')!;
      expect(precision.score).toBe(64); // base 100 − min(4*12, 36)
    });
  });

  describe('rerank-gain subscore', () => {
    it('is absent (4 subscores) when the trace has no reranker', () => {
      const result = scoreTrace('svc', 'q', [], [makeChunk({ rankReranked: null })]);
      const names = result.subscores.map((s) => s.name);
      expect(names).not.toContain('rerank-gain');
      expect(names).toHaveLength(4);
    });

    it('is present (5 subscores) when any chunk was reranked', () => {
      const chunks = [
        makeChunk({ chunkId: 'c0', inContext: true, rankRetrieval: 1, rankReranked: 1 }),
      ];
      const result = scoreTrace('svc', 'q', [], chunks);
      const names = result.subscores.map((s) => s.name);
      expect(names).toContain('rerank-gain');
      expect(names).toHaveLength(5);
    });

    it('scores high when the reranker promotes the chunks the LLM used', () => {
      const chunks = [
        makeChunk({
          chunkId: 'c0',
          inContext: true,
          contextPosition: 0,
          rankRetrieval: 4,
          rankReranked: 1,
        }),
        makeChunk({
          chunkId: 'c1',
          inContext: true,
          contextPosition: 1,
          rankRetrieval: 5,
          rankReranked: 2,
        }),
        makeChunk({
          chunkId: 'c2',
          inContext: true,
          contextPosition: 2,
          rankRetrieval: 6,
          rankReranked: 3,
        }),
      ];
      const result = scoreTrace('svc', 'q', [], chunks);
      const rerank = result.subscores.find((s) => s.name === 'rerank-gain')!;
      expect(rerank.score).toBeGreaterThanOrEqual(75);
    });

    it('scores low when the reranker demotes the chunks the LLM used', () => {
      const chunks = [
        makeChunk({
          chunkId: 'c0',
          inContext: true,
          contextPosition: 0,
          rankRetrieval: 1,
          rankReranked: 5,
        }),
        makeChunk({
          chunkId: 'c1',
          inContext: true,
          contextPosition: 1,
          rankRetrieval: 2,
          rankReranked: 6,
        }),
      ];
      const result = scoreTrace('svc', 'q', [], chunks);
      const rerank = result.subscores.find((s) => s.name === 'rerank-gain')!;
      expect(rerank.score).toBeLessThan(50);
    });
  });
});
