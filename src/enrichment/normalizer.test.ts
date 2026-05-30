import { describe, it, expect } from 'vitest';
import { normalizeScores } from './normalizer.js';

const docs = [
  { id: 'a', score: 0.9, content: 'doc a' },
  { id: 'b', score: 0.6 },
  { id: 'c', score: 0.3 },
];

describe('normalizeScores', () => {
  it('passes through qdrant scores unchanged', () => {
    const result = normalizeScores(docs, 'qdrant');
    expect(result[0].scoreNormalized).toBeCloseTo(0.9);
    expect(result[1].scoreNormalized).toBeCloseTo(0.6);
  });

  it('converts chroma L2 distance to similarity', () => {
    const chromaDocs = [
      { id: 'x', score: 0.2 },
      { id: 'y', score: 0.8 },
    ];
    const result = normalizeScores(chromaDocs, 'chroma');
    expect(result[0].scoreNormalized).toBeCloseTo(0.8);
    expect(result[1].scoreNormalized).toBeCloseTo(0.2);
  });

  it('clamps chroma negative distances to 0', () => {
    const result = normalizeScores([{ id: 'x', score: 1.5 }], 'chroma');
    expect(result[0].scoreNormalized).toBe(0);
  });

  it('normalizes pinecone scores by max', () => {
    const result = normalizeScores(docs, 'pinecone');
    expect(result[0].scoreNormalized).toBeCloseTo(1.0);
    expect(result[1].scoreNormalized).toBeCloseTo(0.6 / 0.9);
  });

  it('normalizes unknown store scores by max', () => {
    const result = normalizeScores(docs, undefined);
    expect(result[0].scoreNormalized).toBeCloseTo(1.0);
  });

  it('handles all-zero scores without division error', () => {
    const zeroDocs = [
      { id: 'a', score: 0 },
      { id: 'b', score: 0 },
    ];
    const result = normalizeScores(zeroDocs, 'pinecone');
    expect(result[0].scoreNormalized).toBe(0);
  });

  it('preserves raw scores alongside normalized', () => {
    const result = normalizeScores(docs, 'qdrant');
    expect(result[0].scoreRaw).toBe(0.9);
    expect(result[0].scoreNormalized).toBe(0.9);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeScores([], 'qdrant')).toHaveLength(0);
  });
});
