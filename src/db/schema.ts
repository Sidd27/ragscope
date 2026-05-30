import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const traces = sqliteTable('traces', {
  id: text('id').primaryKey(),
  serviceName: text('service_name').notNull(),
  query: text('query'),
  source: text('source').notNull(),
  totalLatencyMs: real('total_latency_ms'),
  spanCount: integer('span_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const spans = sqliteTable('spans', {
  id: text('id').primaryKey(),
  traceId: text('trace_id')
    .notNull()
    .references(() => traces.id),
  parentSpanId: text('parent_span_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  startTimeMs: integer('start_time_ms').notNull(),
  endTimeMs: integer('end_time_ms').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  operationName: text('operation_name'),
  model: text('model'),
  system: text('system'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  rawAttributes: text('raw_attributes').notNull().default('[]'),
  prompt: text('prompt'),
});

export const chunks = sqliteTable('chunks', {
  id: text('id').primaryKey(),
  spanId: text('span_id')
    .notNull()
    .references(() => spans.id),
  traceId: text('trace_id')
    .notNull()
    .references(() => traces.id),
  chunkId: text('chunk_id').notNull(),
  content: text('content'),
  scoreRaw: real('score_raw'),
  scoreNormalized: real('score_normalized'),
  rankRetrieval: integer('rank_retrieval'),
  rankReranked: integer('rank_reranked'),
  scoreReranked: real('score_reranked'),
  tokenCount: integer('token_count'),
  vectorStore: text('vector_store'),
  inContext: integer('in_context', { mode: 'boolean' }).notNull().default(false),
  contextPosition: integer('context_position'),
  overlapWithNext: real('overlap_with_next'),
  scoreMissing: integer('score_missing', { mode: 'boolean' }).notNull().default(false),
});
