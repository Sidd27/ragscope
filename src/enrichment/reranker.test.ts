import { describe, it, expect } from 'vitest';
import { applyRerankerResults } from './reranker.js';
import type { RagChunk, ParsedSpan } from '../types.js';

function makeChunk(chunkId: string, rank: number, score = 0.9): RagChunk {
  return {
    id: `id-${chunkId}`,
    spanId: 's1',
    traceId: 't1',
    chunkId,
    content: `content of ${chunkId}`,
    scoreRaw: score,
    scoreNormalized: score,
    rankRetrieval: rank,
    rankReranked: null,
    scoreReranked: null,
    tokenCount: 5,
    vectorStore: null,
    inContext: false,
    contextPosition: null,
    overlapWithNext: 0,
    scoreMissing: false,
  };
}

function makeRerankerSpan(docs: Array<{ id: string; score: number }>): ParsedSpan {
  return {
    traceId: 't1',
    spanId: 'reranker-span',
    name: 'cohere.rerank',
    kind: 'RERANKER',
    startTimeMs: 200,
    endTimeMs: 350,
    latencyMs: 150,
    rawAttributes: '[]',
    documents: docs,
  };
}

describe('applyRerankerResults', () => {
  const chunks = [
    makeChunk('doc-a', 1, 0.8),
    makeChunk('doc-b', 2, 0.75),
    makeChunk('doc-c', 3, 0.6),
  ];

  it('returns unchanged chunks when no reranker spans', () => {
    const { chunks: out, diffs } = applyRerankerResults(chunks, []);
    expect(out).toEqual(chunks);
    expect(diffs).toHaveLength(0);
  });

  it('sets rankReranked on matching chunks', () => {
    const span = makeRerankerSpan([
      { id: 'doc-c', score: 0.95 },
      { id: 'doc-a', score: 0.88 },
      { id: 'doc-b', score: 0.72 },
    ]);
    const { chunks: out } = applyRerankerResults(chunks, [span]);
    expect(out.find((c) => c.chunkId === 'doc-c')!.rankReranked).toBe(1);
    expect(out.find((c) => c.chunkId === 'doc-a')!.rankReranked).toBe(2);
    expect(out.find((c) => c.chunkId === 'doc-b')!.rankReranked).toBe(3);
  });

  it('computes positive rankDelta for chunks that moved up', () => {
    const span = makeRerankerSpan([
      { id: 'doc-c', score: 0.95 }, // was rank 3, now rank 1 → delta = +2
      { id: 'doc-a', score: 0.88 },
      { id: 'doc-b', score: 0.72 },
    ]);
    const { diffs } = applyRerankerResults(chunks, [span]);
    const diffC = diffs.find((d) => d.chunkId === 'doc-c')!;
    expect(diffC.rankDelta).toBe(2); // moved up 2 positions
  });

  it('computes negative rankDelta for chunks that moved down', () => {
    const span = makeRerankerSpan([
      { id: 'doc-c', score: 0.95 },
      { id: 'doc-a', score: 0.88 },
      { id: 'doc-b', score: 0.72 },
    ]);
    const { diffs } = applyRerankerResults(chunks, [span]);
    const diffA = diffs.find((d) => d.chunkId === 'doc-a')!;
    expect(diffA.rankDelta).toBe(-1); // was rank 1, now rank 2
  });

  it('includes scoreDelta in diffs', () => {
    const span = makeRerankerSpan([{ id: 'doc-a', score: 0.95 }]);
    const { diffs } = applyRerankerResults(chunks, [span]);
    const diff = diffs.find((d) => d.chunkId === 'doc-a')!;
    expect(diff.scoreDelta).toBeCloseTo(0.95 - 0.8);
  });

  it('leaves rankReranked null for chunks not in reranker output', () => {
    const span = makeRerankerSpan([{ id: 'doc-a', score: 0.9 }]);
    const { chunks: out } = applyRerankerResults(chunks, [span]);
    expect(out.find((c) => c.chunkId === 'doc-b')!.rankReranked).toBeNull();
  });

  it('returns diffs sorted by rankReranked', () => {
    const span = makeRerankerSpan([
      { id: 'doc-c', score: 0.95 },
      { id: 'doc-b', score: 0.88 },
      { id: 'doc-a', score: 0.72 },
    ]);
    const { diffs } = applyRerankerResults(chunks, [span]);
    expect(diffs.map((d) => d.rankReranked)).toEqual([1, 2, 3]);
  });
});
