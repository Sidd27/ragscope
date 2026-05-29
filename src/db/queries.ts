import { eq, desc } from 'drizzle-orm'
import type { Db } from './index.js'
import { traces, spans, chunks } from './schema.js'
import type { RagTrace, RagSpan, RagChunk } from '../types.js'

export async function insertTrace(db: Db, trace: RagTrace): Promise<void> {
  await db.insert(traces).values(trace).onConflictDoNothing()
}

export async function insertSpans(db: Db, rows: RagSpan[]): Promise<void> {
  if (rows.length === 0) return
  await db.insert(spans).values(rows).onConflictDoNothing()
}

export async function insertChunks(db: Db, rows: RagChunk[]): Promise<void> {
  if (rows.length === 0) return
  await db.insert(chunks).values(rows).onConflictDoNothing()
}

export async function getTraces(db: Db, limit = 100): Promise<RagTrace[]> {
  return db
    .select()
    .from(traces)
    .orderBy(desc(traces.createdAt))
    .limit(limit) as unknown as RagTrace[]
}

export async function getTraceById(db: Db, traceId: string): Promise<{
  trace: RagTrace
  spans: RagSpan[]
  chunks: RagChunk[]
} | null> {
  const traceRows = await db.select().from(traces).where(eq(traces.id, traceId))
  if (traceRows.length === 0) return null

  const spanRows = await db.select().from(spans).where(eq(spans.traceId, traceId))
  const chunkRows = await db.select().from(chunks).where(eq(chunks.traceId, traceId))

  return {
    trace: traceRows[0] as unknown as RagTrace,
    spans: spanRows as unknown as RagSpan[],
    chunks: chunkRows as unknown as RagChunk[],
  }
}
