import type { ParsedSpan, RagChunk } from '../types.js';

export function applyRerankerResults(chunks: RagChunk[], rerankerSpans: ParsedSpan[]): RagChunk[] {
  if (rerankerSpans.length === 0) return chunks;

  // Use the first RERANKER span — pipelines rarely have more than one
  const span = rerankerSpans[0];
  if (!span.documents || span.documents.length === 0) return chunks;

  const reranked = new Map(
    span.documents.map((doc, i) => [doc.id, { rank: i + 1, score: doc.score }]),
  );

  return chunks.map((chunk) => {
    const r = reranked.get(chunk.chunkId);
    if (r == null) return chunk;
    return { ...chunk, rankReranked: r.rank, scoreReranked: r.score };
  });
}
