import { describe, it, expect } from 'vitest';
import { detectOverlap, annotateChunkBoundaries } from './boundaries.js';
import type { RagChunk } from '../types.js';

function makeChunk(id: string, rank: number, content: string): RagChunk {
  return {
    id,
    spanId: 's1',
    traceId: 't1',
    chunkId: id,
    content,
    scoreRaw: 0.9,
    scoreNormalized: 0.9,
    rankRetrieval: rank,
    rankReranked: null,
    scoreReranked: null,
    tokenCount: null,
    vectorStore: null,
    inContext: false,
    contextPosition: null,
    overlapWithNext: null,
    scoreMissing: false,
  };
}

describe('detectOverlap', () => {
  it('returns 0 for completely distinct strings', () => {
    expect(detectOverlap('Hello world', 'Goodbye moon')).toBe(0);
  });

  it('detects exact overlap at boundary', () => {
    const a = 'The capital of France is Paris';
    const b = 'Paris is a city in Europe';
    expect(detectOverlap(a, b)).toBe(5); // "Paris"
  });

  it('handles empty strings', () => {
    expect(detectOverlap('', 'hello')).toBe(0);
    expect(detectOverlap('hello', '')).toBe(0);
  });

  it('detects multi-word overlap', () => {
    const a = 'The quick brown fox';
    const b = 'brown fox jumps over';
    expect(detectOverlap(a, b)).toBe(9); // "brown fox"
  });
});

describe('annotateChunkBoundaries', () => {
  it('sets overlapWithNext=0 for last chunk', () => {
    const chunks = [makeChunk('a', 1, 'Hello world'), makeChunk('b', 2, 'Goodbye world')];
    const result = annotateChunkBoundaries(chunks);
    expect(result.find((c) => c.chunkId === 'b')!.overlapWithNext).toBe(0);
  });

  it('annotates overlap between consecutive chunks', () => {
    const chunks = [
      makeChunk('a', 1, 'The quick brown fox'),
      makeChunk('b', 2, 'brown fox jumps over'),
      makeChunk('c', 3, 'over the lazy dog'),
    ];
    const result = annotateChunkBoundaries(chunks);
    const sorted = [...result].sort((x, y) => x.rankRetrieval! - y.rankRetrieval!);
    expect(sorted[0].overlapWithNext).toBe(9); // "brown fox"
    expect(sorted[1].overlapWithNext).toBe(4); // "over"
    expect(sorted[2].overlapWithNext).toBe(0);
  });

  it('handles null content gracefully', () => {
    const chunks = [
      { ...makeChunk('a', 1, 'some content'), content: null },
      makeChunk('b', 2, 'other content'),
    ];
    const result = annotateChunkBoundaries(chunks as RagChunk[]);
    expect(result.find((c) => c.chunkId === 'a')!.overlapWithNext).toBe(0);
  });

  it('sorts by rankRetrieval before annotating', () => {
    const chunks = [makeChunk('b', 2, 'brown fox jumps'), makeChunk('a', 1, 'The quick brown fox')];
    const result = annotateChunkBoundaries(chunks);
    expect(result.find((c) => c.chunkId === 'a')!.overlapWithNext).toBeGreaterThan(0);
  });
});
