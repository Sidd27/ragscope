import type { ParsedTrace, ParsedSpan, RagTrace, RagSpan, RagChunk } from '../types.js';
import { normalizeScores } from './normalizer.js';
import { countTokens } from './tokenizer.js';
import { annotateChunkBoundaries } from './boundaries.js';
import { applyRerankerResults } from './reranker.js';
import { upsertTrace, type Store } from '../store/index.js';

function assembleContext(chunks: RagChunk[], llmSpans: ParsedSpan[]): RagChunk[] {
  const llmPrompts = llmSpans.map((s) => s.prompt).filter((p): p is string => !!p);
  if (llmPrompts.length === 0) return chunks;

  // Build (chunk, promptOffset) pairs; contextPosition must reflect textual
  // placement in the prompt, not retrieval order, so the lost-in-the-middle
  // audit sees where high-rank chunks actually land.
  const withOffsets = chunks.map((chunk) => {
    if (!chunk.content)
      return { chunk: { ...chunk, inContext: false, contextPosition: null }, offset: -1 };
    let offset = -1;
    for (const p of llmPrompts) {
      const idx = p.indexOf(chunk.content);
      if (idx !== -1) {
        offset = idx;
        break;
      }
    }
    return {
      chunk: { ...chunk, inContext: offset !== -1, contextPosition: null as number | null },
      offset,
    };
  });

  // Assign ordinal contextPosition by sorting in-context chunks by prompt offset.
  withOffsets
    .filter((x) => x.offset !== -1)
    .sort((a, b) => a.offset - b.offset)
    .forEach((x, i) => {
      x.chunk.contextPosition = i;
    });

  return withOffsets.map((x) => x.chunk);
}

export function ingestTrace(store: Store, parsed: ParsedTrace, source: RagTrace['source']): void {
  const rootSpan = parsed.spans.find((s) => !s.parentSpanId) ?? parsed.spans[0];
  const allChunks: RagChunk[] = [];
  const ragSpans: RagSpan[] = [];

  for (const span of parsed.spans) {
    ragSpans.push({
      id: span.spanId,
      traceId: span.traceId,
      parentSpanId: span.parentSpanId ?? null,
      name: span.name,
      kind: span.kind,
      startTimeMs: span.startTimeMs,
      endTimeMs: span.endTimeMs,
      latencyMs: span.latencyMs,
      operationName: span.operationName ?? null,
      model: span.model ?? null,
      system: span.system ?? null,
      inputTokens: span.inputTokens ?? null,
      outputTokens: span.outputTokens ?? null,
    });

    // Reranker spans carry the same documents reordered; their ranks are merged
    // onto the retriever's chunks later by applyRerankerResults. Creating chunks
    // from them here would double-count every document.
    if (span.kind !== 'RERANKER' && span.documents && span.documents.length > 0) {
      const normalized = normalizeScores(span.documents, span.system);

      for (let rank = 0; rank < normalized.length; rank++) {
        const nd = normalized[rank];
        const content = nd.content ?? null;

        allChunks.push({
          spanId: span.spanId,
          traceId: span.traceId,
          chunkId: nd.id,
          content,
          scoreRaw: nd.scoreRaw,
          scoreNormalized: nd.scoreNormalized,
          rankRetrieval: rank + 1,
          rankReranked: null,
          scoreReranked: null,
          tokenCount: content ? countTokens(content, span.model ?? undefined) : null,
          vectorStore: span.system ?? null,
          inContext: false,
          contextPosition: null,
          overlapWithNext: null,
          scoreMissing: nd.scoreRaw === 0 && source === 'langfuse',
        });
      }
    }
  }

  const llmSpans = parsed.spans.filter((s) => s.kind === 'LLM');
  const rerankerSpans = parsed.spans.filter((s) => s.kind === 'RERANKER');
  const withContext = assembleContext(allChunks, llmSpans);
  const withReranked = applyRerankerResults(withContext, rerankerSpans);
  const withBoundaries = annotateChunkBoundaries(withReranked);

  const startTimes = parsed.spans.map((s) => s.startTimeMs);
  const endTimes = parsed.spans.map((s) => s.endTimeMs);

  const querySpan = parsed.spans.find((s) => s.kind === 'CHAIN' || s.kind === 'LLM');

  upsertTrace(
    store,
    {
      id: parsed.traceId,
      serviceName: parsed.serviceName,
      query: querySpan?.prompt ?? null,
      source,
      totalLatencyMs: Math.max(...endTimes) - Math.min(...startTimes),
      spanCount: parsed.spans.length,
      chunkCount: withBoundaries.length,
      createdAt: rootSpan?.startTimeMs ?? Date.now(),
    },
    ragSpans,
    withBoundaries,
  );
}
