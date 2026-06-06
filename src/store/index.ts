import type { RagTrace, RagSpan, RagChunk } from '../types.js';

export interface TraceRecord {
  trace: RagTrace;
  spans: RagSpan[];
  chunks: RagChunk[];
}

export type Store = Map<string, TraceRecord>;

export function createStore(): Store {
  return new Map();
}

export function upsertTrace(
  store: Store,
  trace: RagTrace,
  spans: RagSpan[],
  chunks: RagChunk[],
): void {
  if (!store.has(trace.id)) {
    store.set(trace.id, { trace, spans, chunks });
  }
}

export function getTraceById(store: Store, traceId: string): TraceRecord | null {
  return store.get(traceId) ?? null;
}
