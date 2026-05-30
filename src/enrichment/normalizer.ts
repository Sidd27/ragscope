import type { RetrievalDocument } from '../types.js';

export type VectorStore = 'qdrant' | 'pinecone' | 'chroma' | 'weaviate' | 'unknown';

function detectStore(system: string | undefined): VectorStore {
  const s = system?.toLowerCase() ?? '';
  if (s.includes('qdrant')) return 'qdrant';
  if (s.includes('pinecone')) return 'pinecone';
  if (s.includes('chroma')) return 'chroma';
  if (s.includes('weaviate')) return 'weaviate';
  return 'unknown';
}

export interface NormalizedDoc {
  id: string;
  scoreRaw: number;
  scoreNormalized: number;
  content?: string;
}

export function normalizeScores(
  docs: RetrievalDocument[],
  system: string | undefined,
): NormalizedDoc[] {
  if (docs.length === 0) return [];

  const store = detectStore(system);

  if (store === 'qdrant' || store === 'weaviate') {
    // Already cosine similarity in [0,1]
    return docs.map((d) => ({
      id: d.id,
      scoreRaw: d.score,
      scoreNormalized: d.score,
      content: d.content,
    }));
  }

  if (store === 'chroma') {
    // chroma returns L2 distance; convert: similarity = 1 - distance (clamp to [0,1])
    return docs.map((d) => ({
      id: d.id,
      scoreRaw: d.score,
      scoreNormalized: Math.max(0, Math.min(1, 1 - d.score)),
      content: d.content,
    }));
  }

  // pinecone + unknown: normalize by max score in batch
  const maxScore = Math.max(...docs.map((d) => d.score));
  if (maxScore === 0) {
    return docs.map((d) => ({
      id: d.id,
      scoreRaw: d.score,
      scoreNormalized: 0,
      content: d.content,
    }));
  }
  return docs.map((d) => ({
    id: d.id,
    scoreRaw: d.score,
    scoreNormalized: d.score / maxScore,
    content: d.content,
  }));
}
