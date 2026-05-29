import type { RagChunk } from '../types.js'

export function detectOverlap(chunkA: string, chunkB: string): number {
  const maxLen = Math.min(chunkA.length, chunkB.length, 500)
  for (let len = maxLen; len > 0; len--) {
    if (chunkA.endsWith(chunkB.slice(0, len))) return len
  }
  return 0
}

export function annotateChunkBoundaries(chunks: RagChunk[]): RagChunk[] {
  const sorted = [...chunks].sort((a, b) => (a.rankRetrieval ?? 99) - (b.rankRetrieval ?? 99))
  return sorted.map((chunk, i) => {
    if (i === sorted.length - 1 || !chunk.content || !sorted[i + 1].content) {
      return { ...chunk, overlapWithNext: 0 }
    }
    const overlap = detectOverlap(chunk.content, sorted[i + 1].content!)
    return { ...chunk, overlapWithNext: overlap }
  })
}
