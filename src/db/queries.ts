import type { Db } from './index.js';
import type { RagTrace, RagSpan, RagChunk } from '../types.js';

type Row = Record<string, unknown>;

function rowToTrace(r: Row): RagTrace {
  return {
    id: r['id'] as string,
    serviceName: r['service_name'] as string,
    query: r['query'] as string | null,
    source: r['source'] as RagTrace['source'],
    totalLatencyMs: r['total_latency_ms'] as number | null,
    spanCount: r['span_count'] as number,
    chunkCount: r['chunk_count'] as number,
    createdAt: r['created_at'] as number,
  };
}

function rowToSpan(r: Row): RagSpan {
  return {
    id: r['id'] as string,
    traceId: r['trace_id'] as string,
    parentSpanId: r['parent_span_id'] as string | null,
    name: r['name'] as string,
    kind: r['kind'] as RagSpan['kind'],
    startTimeMs: r['start_time_ms'] as number,
    endTimeMs: r['end_time_ms'] as number,
    latencyMs: r['latency_ms'] as number,
    operationName: r['operation_name'] as string | null,
    model: r['model'] as string | null,
    system: r['system'] as string | null,
    inputTokens: r['input_tokens'] as number | null,
    outputTokens: r['output_tokens'] as number | null,
  };
}

function rowToChunk(r: Row): RagChunk {
  return {
    id: r['id'] as string,
    spanId: r['span_id'] as string,
    traceId: r['trace_id'] as string,
    chunkId: r['chunk_id'] as string,
    content: r['content'] as string | null,
    scoreRaw: r['score_raw'] as number | null,
    scoreNormalized: r['score_normalized'] as number | null,
    rankRetrieval: r['rank_retrieval'] as number | null,
    rankReranked: r['rank_reranked'] as number | null,
    scoreReranked: r['score_reranked'] as number | null,
    tokenCount: r['token_count'] as number | null,
    vectorStore: r['vector_store'] as string | null,
    inContext: Boolean(r['in_context']),
    contextPosition: r['context_position'] as number | null,
    overlapWithNext: r['overlap_with_next'] as number | null,
    scoreMissing: Boolean(r['score_missing']),
  };
}

export function insertTrace(db: Db, trace: RagTrace): void {
  db.prepare(
    `
    INSERT OR IGNORE INTO traces
      (id, service_name, query, source, total_latency_ms, span_count, chunk_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    trace.id,
    trace.serviceName,
    trace.query,
    trace.source,
    trace.totalLatencyMs,
    trace.spanCount,
    trace.chunkCount,
    trace.createdAt,
  );
}

export function insertSpans(db: Db, rows: RagSpan[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO spans
      (id, trace_id, parent_span_id, name, kind, start_time_ms, end_time_ms,
       latency_ms, operation_name, model, system, input_tokens, output_tokens, raw_attributes, prompt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL)
  `);
  for (const s of rows) {
    stmt.run(
      s.id,
      s.traceId,
      s.parentSpanId,
      s.name,
      s.kind,
      s.startTimeMs,
      s.endTimeMs,
      s.latencyMs,
      s.operationName,
      s.model,
      s.system,
      s.inputTokens,
      s.outputTokens,
    );
  }
}

export function insertChunks(db: Db, rows: RagChunk[]): void {
  if (rows.length === 0) return;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO chunks
      (id, span_id, trace_id, chunk_id, content, score_raw, score_normalized,
       rank_retrieval, rank_reranked, score_reranked, token_count, vector_store,
       in_context, context_position, overlap_with_next, score_missing)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of rows) {
    stmt.run(
      c.id,
      c.spanId,
      c.traceId,
      c.chunkId,
      c.content,
      c.scoreRaw,
      c.scoreNormalized,
      c.rankRetrieval,
      c.rankReranked,
      c.scoreReranked,
      c.tokenCount,
      c.vectorStore,
      Number(c.inContext),
      c.contextPosition,
      c.overlapWithNext,
      Number(c.scoreMissing),
    );
  }
}

export function getTraces(db: Db, limit = 100): RagTrace[] {
  return (
    db.prepare('SELECT * FROM traces ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]
  ).map(rowToTrace);
}

export function getTraceById(
  db: Db,
  traceId: string,
): { trace: RagTrace; spans: RagSpan[]; chunks: RagChunk[] } | null {
  const traceRow = db.prepare('SELECT * FROM traces WHERE id = ?').get(traceId) as Row | undefined;
  if (!traceRow) return null;

  const spanRows = db.prepare('SELECT * FROM spans WHERE trace_id = ?').all(traceId) as Row[];
  const chunkRows = db.prepare('SELECT * FROM chunks WHERE trace_id = ?').all(traceId) as Row[];

  return {
    trace: rowToTrace(traceRow),
    spans: spanRows.map(rowToSpan),
    chunks: chunkRows.map(rowToChunk),
  };
}
