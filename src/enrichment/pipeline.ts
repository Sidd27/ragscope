import type { ParsedTrace, ParsedSpan, RagTrace, RagSpan, RagChunk } from '../types.js';
import { normalizeScores } from './normalizer.js';
import { countTokens } from './tokenizer.js';
import { annotateChunkBoundaries } from './boundaries.js';
import { applyRerankerResults } from './reranker.js';
import { upsertTrace, type Store } from '../store/index.js';

function assembleContext(chunks: RagChunk[], llmSpans: ParsedSpan[]): RagChunk[] {
  const llmPrompts = llmSpans.map((s) => s.prompt).filter((p): p is string => !!p);
  if (llmPrompts.length === 0) return chunks;

  let position = 0;
  return chunks.map((chunk) => {
    if (!chunk.content) return chunk;
    const inContext = llmPrompts.some((p) => p.includes(chunk.content!));
    if (inContext) {
      return { ...chunk, inContext: true, contextPosition: position++ };
    }
    return { ...chunk, inContext: false, contextPosition: null };
  });
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

    if (span.documents && span.documents.length > 0) {
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
