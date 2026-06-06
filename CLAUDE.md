# RAGScope — Claude Code Instructions

## Project overview

RAGScope is a local-first RAG pipeline debugger. `npx ragscope start` launches a server on **port 4321** (never 3000) that receives OTel spans, keeps them in an in-memory store, and prints PASS/WARN/FAIL audit scores to the terminal on every trace. A JSON API exposes trace detail for tooling integrations.

## Package layout

```
ragscope/          ← single package
├── src/
│   ├── types.ts
│   ├── store/         ← in-memory Map store (TraceRecord)
│   ├── enrichment/
│   ├── ingestion/
│   └── audit/
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
- **No external DB.** All trace data lives in a `Map<traceId, TraceRecord>` for the lifetime of the process. No files written to disk.
- **Never downgrade versions.** Do not lower Node.js, npm, package, or any other version unless the user explicitly asks. If there is any reason to consider a downgrade, ask first.
- **No git push without asking.** Always confirm with the user before any `git push`.
- **Always use the release script.** Never bump the version, tag, or create a GitHub release manually. Use `pnpm release <patch|minor|major>` (`scripts/release.js`) which handles version bump, commit, tag, push, and creates a **draft** GitHub release. The `publish.yml` workflow triggers on `release: types: [published]`, so npm publish only fires when the draft is manually published on GitHub.

## Common dev commands

```bash
# Run tests
pnpm test

# Typecheck everything
pnpm typecheck

# Start server for manual testing (port 4321)
pnpm dev

# Send a synthetic 4-span trace
npx tsx scripts/send-test-trace.ts

# Release (patch / minor / major) — creates a draft GitHub release; publish the draft to trigger npm publish
pnpm release patch
```

## Architecture notes

- **OTLP ingestion**: `POST /v1/traces` accepts `application/json` (OTLP JSON format). Returns `{partialSuccess:{}}`. Source tagged as `'otlp'`.
- **Langfuse polling**: Starts automatically when `LANGFUSE_PUBLIC_KEY` env var is set. Polls every 30s. Source tagged as `'langfuse'`.
- **Span kind inference**: Derived from `gen_ai.operation.name` + span name → CHAIN / EMBEDDING / RETRIEVER / RERANKER / LLM / SPAN.
- **Enrichment pipeline** (`src/enrichment/pipeline.ts`, in order): score normalization → chunk building → context assembly → reranker diff → boundary detection → store upsert.
- **Context assembly**: Cross-span — scans all LLM span prompts to find which chunk contents appear in them (`inContext: true`).
- **Audit scoring** (`src/audit/scorer.ts`): runs on every ingested trace; prints PASS/WARN/FAIL with subscores for precision, efficiency, uniqueness, and coverage. Verbose output is the default; `--compact` flag switches to one-line-per-query mode.
- **Store** (`src/store/index.ts`): `createStore()` returns a plain `Map`. `upsertTrace` ignores duplicate traceIds. `getTraceById` is a Map lookup.

## tsconfig quirks

- `tsconfig.json` — no `rootDir`; `target: ES2022` (required for BigInt literals).

## Test coverage

All tests in `src/**/*.test.ts` via vitest. Coverage target: ≥80% statements/branches/functions/lines. Use `@vitest/coverage-v8` matching the installed vitest version exactly.
