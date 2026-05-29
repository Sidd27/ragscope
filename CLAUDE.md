# RAGScope — Claude Code Instructions

## Project overview

RAGScope is a local-first RAG pipeline debugger. `npx ragscope start` launches a server on **port 4321** (never 3000) that receives OTel spans, stores them in SQLite, and exposes a JSON/tRPC API for inspecting chunks, scores, latency, and context assembly.

## Package layout

```
ragscope/          ← single package
├── src/
│   ├── types.ts
│   ├── db/
│   ├── enrichment/
│   ├── ingestion/
│   └── audit/    ← coming soon
├── bin/
│   └── ragscope.ts
├── scripts/
│   └── send-test-trace.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Key constraints

- **Port is always 4321.** Never change it to 3000 or anything else.
- **No external DB.** SQLite via `better-sqlite3` + Drizzle ORM. No migrations — `CREATE TABLE IF NOT EXISTS` in `createDb()`.
- **No git push without asking.** Always confirm with the user before any `git push`.

## Common dev commands

```bash
# Run tests
pnpm test

# Typecheck everything
pnpm typecheck

# Start server for manual testing (port 4321, in-memory DB)
pnpm dev

# Send a synthetic 4-span trace
npx tsx scripts/send-test-trace.ts
```

## Architecture notes

- **OTLP ingestion**: `POST /v1/traces` accepts `application/json` (OTLP JSON format). Returns `{partialSuccess:{}}`.
- **Span kind inference**: Derived from `gen_ai.operation.name` + span name → CHAIN / EMBEDDING / RETRIEVER / RERANKER / LLM / SPAN.
- **Enrichment pipeline** (in order): score normalization → chunk building → context assembly → reranker diff → boundary detection → DB insert.
- **Context assembly**: Cross-span — scans all LLM span prompts to find which chunk contents appear in them (`inContext: true`).
- **Langfuse polling**: Starts automatically when `LANGFUSE_PUBLIC_KEY` env var is set. Polls every 30s.

## tsconfig quirks

- `tsconfig.json` — no `rootDir`; `target: ES2022` (required for BigInt literals).

## Test coverage

All tests in `src/**/*.test.ts` via vitest. Coverage target: ≥80% statements/branches/functions/lines. Use `@vitest/coverage-v8` matching the installed vitest version exactly.
