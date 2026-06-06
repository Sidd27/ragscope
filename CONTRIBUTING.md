# Contributing to RAGScope

Thanks for your interest. Contributions of all kinds are welcome — bug reports, feature requests, docs, and code.

## Setup

```bash
git clone https://github.com/Sidd27/ragscope.git
cd ragscope
pnpm install
pnpm test        # 68 tests should pass
```

No native dependencies — install is a plain `pnpm install`.

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
  types.ts          — all shared types (ParsedSpan, RagChunk, RagTrace, …)
  app.ts            — Fastify server and REST routes
  store/            — in-memory Map store (createStore, upsertTrace, getTraceById)
  enrichment/       — normalizer, tokenizer, boundary detection, reranker diff, pipeline
  ingestion/        — OTLP parser, Langfuse poller
  audit/            — scoring engine (scoreTrace, sub-scores)
bin/
  ragscope.ts       — CLI entry: wires server + audit output + session tracking
scripts/
  send-test-trace.ts — synthetic 4-span trace for local testing
```

## Adding an ingestion adapter

The easiest high-value contribution. Implement a poller in `src/ingestion/` that calls `ingestTrace` from the enrichment pipeline:

```typescript
import { ingestTrace } from '../enrichment/pipeline.js';
import type { Store } from '../store/index.js';

export class MyAdapter {
  start(store: Store, onTrace?: (traceId: string) => void): void {
    // poll your source, call ingestTrace(store, parsedTrace, 'otlp') per trace
    // call onTrace(traceId) so the CLI prints the audit score
  }
}
```

See `src/ingestion/langfuse.ts` for a reference implementation. Wire the adapter into `bin/ragscope.ts` behind an env-var guard.

**Wanted:** LangSmith · Helicone · Langfuse webhooks (instead of polling)

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Add or update tests for any logic changes
- Run `pnpm test && pnpm typecheck` before opening
- PRs should pass CI

## Reporting bugs

Open an issue with the bug report template. Include the trace source (OTel / Langfuse), Node.js version, and what you expected vs what happened.

## License

By contributing, you agree your contributions are licensed under Apache 2.0.
