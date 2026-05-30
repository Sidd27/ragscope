import type { RagChunk } from '../types.js';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function computeSimilarityMatrix(chunks: RagChunk[]): Promise<number[][] | null> {
  const contents = chunks.map((c) => c.content!);

  // Lazy-load to avoid pulling ~80MB WASM on startup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pipeline: (...args: any[]) => any;
  try {
    const mod = await import('@huggingface/transformers');
    pipeline = mod.pipeline;
  } catch {
    return null; // package not installed
  }
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'fp32',
  });

  const embeddings: number[][] = [];
  for (const text of contents) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output: any = await extractor(text, { pooling: 'mean', normalize: true });
    // output is a Tensor; convert to plain array
    const arr = output.tolist
      ? (output.tolist()[0] as number[])
      : Array.from(output.data as Float32Array);
    embeddings.push(arr);
  }

  const n = embeddings.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => cosineSimilarity(embeddings[i], embeddings[j])),
  );
}
