# RAGScope

**Lighthouse for RAG pipelines.** Instrument your pipeline, run `npx ragscope start`, fire test queries, and get an instant PASS/WARN/FAIL audit score in the terminal — before you ship.

```
 PASS  84/100  my-rag-app  "what is RAG?"
       ✓ precision:90  ✓ efficiency:80  ✓ redundancy:85  ✓ coverage:100

 WARN  61/100  my-rag-app  "what is dense passage retrieval?"
       ✗ precision:30  ✗ efficiency:45  ~ redundancy:70  ✓ coverage:100
       → Reduce TOP_K 10→5  · 2 near-duplicate chunks detected

 ─────────────────────────────────────────────
 Session  2 queries · avg 72/100  ↑ improving
```

---

## Install

```bash
npx ragscope start
```

Starts an OTLP receiver on **port 4321**. Point your pipeline's OTel exporter there and run queries — scores appear in the terminal as each trace arrives.

---

## What it scores

Every query gets four sub-scores combined into an overall 0–100:

| Sub-score | Weight | What it measures |
|---|---|---|
| **Retrieval Precision** | 40% | Fraction of retrieved chunks that reached the LLM |
| **Context Efficiency** | 30% | Token waste on chunks the LLM never saw |
| **Redundancy** | 20% | Near-duplicate chunks eating context window |
| **Score Coverage** | 10% | Whether chunks have similarity scores for optimization |

- **PASS** ≥ 75 — green
- **WARN** 50–74 — yellow
- **FAIL** < 50 — red

Add `--verbose` for a full breakdown with recommendations per query.

---

## Integrations

### Any OTel-compatible tool

Set your exporter URL to `http://localhost:4321/v1/traces` — no other changes:

**TraceAI / Traceloop** (auto-instruments LangChain, LlamaIndex, OpenAI, Pinecone, Qdrant…)

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { instrument } from '@traceloop/node-server-sdk'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
})
sdk.start()
instrument()
```

**Vercel AI SDK**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
})
sdk.start()
```

**Manual OpenTelemetry**

```typescript
import { trace } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
})
sdk.start()

const tracer = trace.getTracer('my-rag-app')
const span = tracer.startSpan('qdrant.query')
span.setAttribute('gen_ai.operation.name', 'retrieve')
span.setAttribute('gen_ai.retrieval.documents', JSON.stringify(docs))
span.end()
```

### Langfuse

Set two env vars — RAGScope polls every 30 seconds automatically:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... \
LANGFUSE_SECRET_KEY=sk-lf-... \
npx ragscope start
```

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

- **Vector stores**: Qdrant · Chroma · Pinecone · Weaviate · pgvector
- **LLM frameworks**: LangChain · LlamaIndex · Vercel AI SDK · custom
- **Models**: OpenAI · Anthropic · Cohere · Mistral · any OTel-instrumented provider
- **Rerankers**: Cohere Rerank · any span with `gen_ai.operation.name = rerank`
- **Ingestion sources**: Any OTel exporter · Langfuse · (LangSmith, Helicone — coming soon)

---

## Privacy

All data stays on your machine. No telemetry, no cloud, no accounts.
