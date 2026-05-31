<div align="center">

# RAGScope

**Lighthouse for RAG pipelines.**
Get PASS/WARN/FAIL audit scores in your terminal before you ship.

[![npm version](https://img.shields.io/npm/v/ragscope.svg?style=flat-square)](https://www.npmjs.com/package/ragscope)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![CI](https://github.com/Sidd27/ragscope/actions/workflows/ci.yml/badge.svg)](https://github.com/Sidd27/ragscope/actions/workflows/ci.yml)

</div>

---

```
 PASS  84/100  my-rag-app  "what is RAG?"
       ✓ precision:90  ✓ efficiency:80  ✓ redundancy:85  ✓ coverage:100

 WARN  61/100  my-rag-app  "what is dense passage retrieval?"
       ✗ precision:30  ✗ efficiency:45  ~ redundancy:70  ✓ coverage:100
       → Reduce TOP_K 10→5  · 2 near-duplicate chunks detected

 ─────────────────────────────────────────────────────────────
 Session  2 queries · avg 72/100  ↑ improving
```

---

## The problem

You build a RAG pipeline. It looks fine in demos. You ship it. Users complain the answers are wrong or vague — but nothing in your logs tells you why.

The real issue is usually invisible: too many chunks retrieved, half of them never reaching the LLM, near-duplicate content eating your context window, no similarity scores to optimize against. RAGScope makes all of this visible — scored, labelled, and actionable — in your terminal, before you ship.

---

## Quick start

```bash
# 1. Start RAGScope (no install needed)
npx ragscope start

# 2. Point your pipeline's OTel exporter at it
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4321

# 3. Run your test queries — scores appear instantly
```

That's it. No config files, no accounts, no data leaving your machine.

---

## How it scores

Every query gets four sub-scores combined into a single 0–100:

| Sub-score               | Weight | What it measures                                           |
| ----------------------- | ------ | ---------------------------------------------------------- |
| **Retrieval Precision** | 40%    | Fraction of retrieved chunks that actually reached the LLM |
| **Context Efficiency**  | 30%    | Token waste on chunks the LLM never saw                    |
| **Redundancy**          | 20%    | Near-duplicate chunks eating your context window           |
| **Score Coverage**      | 10%    | Whether chunks carry similarity scores for optimization    |

| Label    | Score | Meaning                                    |
| -------- | ----- | ------------------------------------------ |
| **PASS** | ≥ 75  | Retrieval pipeline is healthy              |
| **WARN** | 50–74 | Issues detected — check recommendations    |
| **FAIL** | < 50  | Significant retrieval problems before ship |

Add `--verbose` for a full per-query breakdown with specific recommendations.

---

## Integrations

RAGScope is source-agnostic. Traces arrive via two paths.

### Path 1 — Any OTel-compatible tool

One line change: set the OTLP exporter URL to `http://localhost:4321/v1/traces`.

**TraceAI / Traceloop** (auto-instruments LangChain, LlamaIndex, OpenAI, Pinecone, Qdrant, Cohere…)

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { instrument } from '@traceloop/node-server-sdk';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
});
sdk.start();
instrument();
```

**Vercel AI SDK**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
});
sdk.start();
```

**Phoenix (Arize) / OpenLLMetry** — set `PHOENIX_COLLECTOR_ENDPOINT=http://localhost:4321` or `TRACELOOP_BASE_URL=http://localhost:4321`.

**Manual OpenTelemetry**

```typescript
import { trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
});
sdk.start();

const tracer = trace.getTracer('my-rag-app');

const span = tracer.startSpan('qdrant.query');
span.setAttribute('gen_ai.operation.name', 'retrieve');
span.setAttribute('gen_ai.retrieval.documents', JSON.stringify(docs));
span.end();
```

### Path 2 — Langfuse

Set two env vars — RAGScope polls every 30 seconds, zero code changes:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... \
LANGFUSE_SECRET_KEY=sk-lf-... \
npx ragscope start
```

> **Coming soon:** LangSmith · Helicone adapters. [Open an issue](https://github.com/Sidd27/ragscope/issues) to vote or contribute.

---

## CLI options

```
npx ragscope start [options]

  --port <n>     Port to listen on (default: 4321)
  --db <path>    Path to SQLite database file (default: in-memory)
  --verbose      Show full sub-score breakdown and recommendations per query
```

---

## Works with

| Category           | Tools                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| **Vector stores**  | Qdrant · Chroma · Pinecone · Weaviate · pgvector                       |
| **LLM frameworks** | LangChain · LlamaIndex · Vercel AI SDK · custom                        |
| **Models**         | OpenAI · Anthropic · Cohere · Mistral · any OTel-instrumented provider |
| **Rerankers**      | Cohere Rerank · any span with `gen_ai.operation.name = rerank`         |
| **Ingestion**      | Any OTel exporter · Langfuse · _(LangSmith, Helicone coming soon)_     |

---

## Why not just use Langfuse / Phoenix / Arize?

Those are excellent **production monitoring** tools — they record what happened after you ship.

RAGScope is a **pre-ship quality gate** — like ESLint or Lighthouse, you run it during development to catch retrieval problems before they reach users. Different job, smaller footprint, zero cloud dependency.

---

## Roadmap

### Now (v0.1.x)

- [x] OTLP ingestion — works with any OTel-compatible source
- [x] Langfuse polling adapter
- [x] Four sub-scores: precision, efficiency, redundancy, coverage
- [x] PASS / WARN / FAIL per query with rolling session average
- [x] `--verbose` flag for full breakdown + recommendations

### Next (v0.2)

- [ ] **LangSmith adapter** — poll runs via LangSmith API, zero code changes
- [ ] **Helicone adapter** — fetch requests via Helicone API
- [ ] **Langfuse webhooks** — real-time instead of 30s polling
- [ ] **Audit report export** — `npx ragscope report` writes a Markdown/JSON summary you can commit or share

### Later

- [ ] **Compare mode** — `npx ragscope compare v1 v2` diffs two pipeline versions side-by-side
- [ ] **Python support** — native Python instrumentation helpers
- [ ] **Threshold config** — `.ragscope.json` to set custom PASS/WARN/FAIL thresholds per project
- [ ] **Span-level drill-down** — `--trace <id>` to inspect a single trace in detail

> Vote on features or propose new ones by [opening an issue](https://github.com/Sidd27/ragscope/issues).

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

**Good first issues:** LangSmith adapter, Helicone adapter, audit report export, improving scoring heuristics.

---

## Privacy

All data stays on your machine. No telemetry, no cloud, no accounts required.

---

## License

[Apache 2.0](LICENSE) — © 2026 Siddharth Pandey
