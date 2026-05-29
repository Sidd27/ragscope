# RAGScope

**Chrome DevTools for RAG pipelines.** Inspect every chunk, score, and latency hop — locally, with zero data leaving your machine.

```bash
npx ragscope start
# → Listening on http://localhost:4321
# → Open http://localhost:4321 in your browser
```

---

## What it shows

| View | What you see |
|------|-------------|
| **Latency Waterfall** | Chain → Embedding → Retriever → LLM timeline |
| **Chunk Inspector** | Per-chunk scores, token counts, overlap highlights |
| **Context Assembly** | Which chunks made it into the LLM prompt and which were dropped |
| **Token Budget** | Stacked bar: chunks-in-context / system+query / wasted / output vs model limit |
| **Reranker Diff** | Before/after rankings with ↑↓ movement indicators |
| **Similarity Matrix** | Pairwise cosine similarity heatmap — spot redundant chunks instantly |

---

## Integrations

### traceAI (auto-instrument OpenAI, Qdrant, LangChain…)

```bash
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @traceloop/node-server-sdk
```

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { instrument } from '@traceloop/node-server-sdk'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4321/v1/traces',
  }),
})
sdk.start()
instrument()  // auto-instruments OpenAI, Qdrant, LangChain, etc.
```

### Langfuse

Set env vars — RAGScope polls every 30 seconds automatically:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... \
LANGFUSE_SECRET_KEY=sk-lf-... \
npx ragscope start
```

### Vercel AI SDK

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4321/v1/traces',
  }),
})
sdk.start()
```

### Manual OpenTelemetry

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
span.setAttribute('gen_ai.system', 'qdrant')
span.setAttribute('gen_ai.retrieval.documents', JSON.stringify(docs))
span.end()
```

---

## Docker

```bash
docker compose up
# → RAGScope on http://localhost:4321, data persisted in a named volume
```

With Langfuse:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... docker compose up
```

---

## CLI options

```
npx ragscope start [options]

  --port <n>   Port to listen on (default: 4321)
  --db <path>  Path to SQLite database file (default: ~/.ragscope/db.sqlite)
```

---

## Works with

- **Vector stores**: Qdrant · Chroma · Pinecone · Weaviate · pgvector
- **LLM frameworks**: LangChain · LlamaIndex · Vercel AI SDK · custom
- **Models**: OpenAI · Anthropic · Cohere · Mistral · any OTel-instrumented provider
- **Rerankers**: Cohere Rerank · any span with `gen_ai.operation.name = rerank`

---

## Privacy

All data stays on your machine. No telemetry, no cloud, no accounts.
