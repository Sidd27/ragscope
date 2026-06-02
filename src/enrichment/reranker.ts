import type { ParsedSpan, RagChunk } from '../types.js';

export interface RerankerDiff {
  chunkId: string;
  rankRetrieval: number;
  rankReranked: number;
  rankDelta: number; // positive = moved up, negative = moved down
  scoreRaw: number | null;
  scoreReranked: number | null;
  scoreDelta: number | null;
}

export function applyRerankerResults(
  chunks: RagChunk[],
  rerankerSpans: ParsedSpan[],
): { chunks: RagChunk[]; diffs: RerankerDiff[] } {
  if (rerankerSpans.length === 0) return { chunks, diffs: [] };

  // Use the first RERANKER span — pipelines rarely have more than one
  const span = rerankerSpans[0];
  if (!span.documents || span.documents.length === 0) return { chunks, diffs: [] };

  const rerankedRank = new Map<string, number>();
  const rerankedScore = new Map<string, number>();
  span.documents.forEach((doc, i) => {
    rerankedRank.set(doc.id, i + 1);
    rerankedScore.set(doc.id, doc.score);
  });

  const updatedChunks = chunks.map((chunk) => {
    const newRank = rerankedRank.get(chunk.chunkId);
    if (newRank == null) return chunk;
    const newScore = rerankedScore.get(chunk.chunkId) ?? null;
    return { ...chunk, rankReranked: newRank, scoreReranked: newScore };
  });

  const diffs: RerankerDiff[] = chunks
    .filter((c) => rerankedRank.has(c.chunkId) && c.rankRetrieval != null)
    .map((c) => {
      const rr = rerankedRank.get(c.chunkId)!;
      const sr = rerankedScore.get(c.chunkId) ?? null;
      return {
        chunkId: c.chunkId,
        rankRetrieval: c.rankRetrieval!,
        rankReranked: rr,
        rankDelta: c.rankRetrieval! - rr,
        scoreRaw: c.scoreRaw,
        scoreReranked: sr,
        scoreDelta: sr != null && c.scoreRaw != null ? sr - c.scoreRaw : null,
      };
    })
    .sort((a, b) => a.rankReranked - b.rankReranked);

  return { chunks: updatedChunks, diffs };
}
