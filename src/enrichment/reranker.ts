import type { ParsedSpan, RagChunk } from '../types.js';

export function applyRerankerResults(chunks: RagChunk[], rerankerSpans: ParsedSpan[]): RagChunk[] {
  if (rerankerSpans.length === 0) return chunks;

  // Use the first RERANKER span — pipelines rarely have more than one
  const span = rerankerSpans[0];
  if (!span.documents || span.documents.length === 0) return chunks;

  const rerankedRank = new Map<string, number>();
  const rerankedScore = new Map<string, number>();
  span.documents.forEach((doc, i) => {
    rerankedRank.set(doc.id, i + 1);
    rerankedScore.set(doc.id, doc.score);
  });

  return chunks.map((chunk) => {
    const newRank = rerankedRank.get(chunk.chunkId);
    if (newRank == null) return chunk;
    return {
      ...chunk,
      rankReranked: newRank,
      scoreReranked: rerankedScore.get(chunk.chunkId) ?? null,
    };
  });
}
