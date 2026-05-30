# Contributing to RAGScope

Thanks for your interest. Contributions of all kinds are welcome — bug reports, feature requests, docs, and code.

## Setup

```bash
git clone https://github.com/Sidd27/ragscope.git
cd ragscope
pnpm install
pnpm rebuild better-sqlite3   # native binding, required after install
pnpm test                      # 70 tests should pass
```

## Dev workflow

```bash
pnpm dev          # start server in watch mode (port 4321)
pnpm typecheck    # TypeScript check without emitting
pnpm test         # run full test suite
```

To send a synthetic trace while the server is running:

```bash
npx tsx scripts/send-test-trace.ts
```

## Where things live

```
src/
  types.ts          — all shared types
  app.ts            — Fastify server, REST routes
  db/               — SQLite schema + queries (Drizzle ORM)
  enrichment/       — scoring, tokenization, boundary detection, reranker diff
  ingestion/        — OTLP parser, Langfuse poller
  audit/            — scoring engine (scoreTrace, sub-scores)
bin/
  ragscope.ts       — CLI entry: wires server + audit output + session tracking
scripts/
  send-test-trace.ts — synthetic 4-span trace for local testing
```

## Adding an ingestion adapter

The easiest high-value contribution. Implement this interface in `src/ingestion/`:

```typescript
export interface IngestionAdapter {
  name: string;
  poll(db: Db, onTrace?: (traceId: string) => void): Promise<void>;
}
```

See `src/ingestion/langfuse.ts` for a reference implementation. Register the adapter in `bin/ragscope.ts`.

**Wanted:** LangSmith · Helicone · LangFuse webhooks (instead of polling)

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Add or update tests for any logic changes
- Run `pnpm test && pnpm typecheck` before opening
- PRs should pass CI

## Reporting bugs

Open an issue with the bug report template. Include the trace source (OTel / Langfuse), Node.js version, and what you expected vs what happened.

## License

By contributing, you agree your contributions are licensed under Apache 2.0.
