import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function createDb(dbPath = ':memory:'): Db {
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      service_name TEXT NOT NULL,
      query TEXT,
      source TEXT NOT NULL,
      total_latency_ms REAL,
      span_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spans (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES traces(id),
      parent_span_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_time_ms INTEGER NOT NULL,
      end_time_ms INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      operation_name TEXT,
      model TEXT,
      system TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      raw_attributes TEXT NOT NULL DEFAULT '[]',
      prompt TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      span_id TEXT NOT NULL REFERENCES spans(id),
      trace_id TEXT NOT NULL REFERENCES traces(id),
      chunk_id TEXT NOT NULL,
      content TEXT,
      score_raw REAL,
      score_normalized REAL,
      rank_retrieval INTEGER,
      rank_reranked INTEGER,
      score_reranked REAL,
      token_count INTEGER,
      vector_store TEXT,
      in_context INTEGER NOT NULL DEFAULT 0,
      context_position INTEGER,
      overlap_with_next REAL,
      score_missing INTEGER NOT NULL DEFAULT 0
    );
  `);

  return db;
}
