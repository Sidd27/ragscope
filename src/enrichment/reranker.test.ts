import { describe, it, expect } from 'vitest';
import { applyRerankerResults } from './reranker.js';
import type { RagChunk, ParsedSpan } from '../types.js';

function makeChunk(chunkId: string, rank: number, score = 0.9): RagChunk {
  return {
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
    const out = applyRerankerResults(chunks, []);
    expect(out).toEqual(chunks);
  });

  it('sets rankReranked on matching chunks', () => {
    const span = makeRerankerSpan([
      { id: 'doc-c', score: 0.95 },
      { id: 'doc-a', score: 0.88 },
      { id: 'doc-b', score: 0.72 },
    ]);
    const out = applyRerankerResults(chunks, [span]);
    expect(out.find((c) => c.chunkId === 'doc-c')!.rankReranked).toBe(1);
    expect(out.find((c) => c.chunkId === 'doc-a')!.rankReranked).toBe(2);
    expect(out.find((c) => c.chunkId === 'doc-b')!.rankReranked).toBe(3);
  });

  it('sets scoreReranked on matching chunks', () => {
    const span = makeRerankerSpan([{ id: 'doc-a', score: 0.95 }]);
    const out = applyRerankerResults(chunks, [span]);
    expect(out.find((c) => c.chunkId === 'doc-a')!.scoreReranked).toBeCloseTo(0.95);
  });

  it('chunk that moved up has rankReranked < rankRetrieval', () => {
    const span = makeRerankerSpan([
      { id: 'doc-c', score: 0.95 },
      { id: 'doc-a', score: 0.88 },
      { id: 'doc-b', score: 0.72 },
    ]);
    const out = applyRerankerResults(chunks, [span]);
    const c = out.find((c) => c.chunkId === 'doc-c')!;
    expect(c.rankReranked).toBeLessThan(c.rankRetrieval!); // was 3, now 1
  });

  it('chunk that moved down has rankReranked > rankRetrieval', () => {
    const span = makeRerankerSpan([
      { id: 'doc-c', score: 0.95 },
      { id: 'doc-a', score: 0.88 },
      { id: 'doc-b', score: 0.72 },
    ]);
    const out = applyRerankerResults(chunks, [span]);
    const a = out.find((c) => c.chunkId === 'doc-a')!;
    expect(a.rankReranked).toBeGreaterThan(a.rankRetrieval!); // was 1, now 2
  });

  it('leaves rankReranked null for chunks not in reranker output', () => {
    const span = makeRerankerSpan([{ id: 'doc-a', score: 0.9 }]);
    const out = applyRerankerResults(chunks, [span]);
    expect(out.find((c) => c.chunkId === 'doc-b')!.rankReranked).toBeNull();
  });
});
