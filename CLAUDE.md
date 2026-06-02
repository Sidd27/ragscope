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
- **Always use the release script.** Never bump the version, tag, or create a GitHub release manually. Use `pnpm release <patch|minor|major>` (`scripts/release.js`) which handles version bump, commit, tag, push, and creates a **draft** GitHub release. The `publish.yml` workflow triggers on `release: types: [published]`, so npm publish only fires when the draft is manually published on GitHub.

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

# Release (patch / minor / major) — creates a draft GitHub release; publish the draft to trigger npm publish
pnpm release patch
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
