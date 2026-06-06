<div align="center">

# RAGScope

**You can't fix what you can't see.**

A local diagnostic tool for RAG pipelines. Scores every query your pipeline processes and tells you exactly what's wrong — before you ship.

[![npm version](https://img.shields.io/npm/v/ragscope.svg?style=flat-square)](https://www.npmjs.com/package/ragscope)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![CI](https://github.com/Sidd27/ragscope/actions/workflows/ci.yml/badge.svg)](https://github.com/Sidd27/ragscope/actions/workflows/ci.yml)

</div>

---

```
  PASS  90/100  █████████░  my-rag-app
  │  "What is RAG?"
  │
  │  ✓  precision    90  █████████░  9/10 chunks used
  │  ✓  efficiency   80  ████████░░  20% tokens wasted
  │  ✓  uniqueness  100  ██████████  chunks are distinct
  │  ✓  coverage    100  ██████████  all chunks scored
  │

  WARN  54/100  █████░░░░░  my-rag-app
  │  "What is dense passage retrieval?"
  │
  │  ✗  precision    40  ████░░░░░░  4/10 chunks used
  │  ~  efficiency   50  █████░░░░░  50% tokens wasted
  │  ~  uniqueness   65  ███████░░░  2 near-duplicate pairs
  │  ✓  coverage    100  ██████████  all chunks scored
  │
  │  → Reduce TOP_K 10→4 (only 4 chunks reached LLM)
  │  → 50% of retrieved tokens never reached the LLM
  │  → 2 near-duplicate chunks — deduplicate at ingest time
  │

  ──────────────────────────────────────────────────
  Session  2 queries  ·  avg 72/100  ↓
```

---

## The problem

Most RAG pipelines fail silently. You retrieve 10 chunks, the LLM prompt only contains 3, and nothing in your logs tells you the other 7 were dropped. You're retrieving near-duplicates that eat your context window. Your similarity scores are zero because your vector store returns distances and nobody normalized them. The model gives vague answers, and there's nothing to debug.

These are all retrieval mechanics problems. They're fixable. But you can't see them without tracing.

RAGScope makes them visible — scored, labelled, and actionable — in your terminal, before users ever see the output.

---

## What it is

RAGScope is a local OTLP receiver that runs on port 4321 alongside your development server. It receives the telemetry your RAG pipeline already emits, analyzes the full trace end-to-end, and prints a diagnostic score to your terminal the moment each query completes.

It is a **dev-time quality gate** — the same category as a linter or type checker. You run it locally while building, catch the problems, and ship with confidence. It is not a production monitoring tool.

---

## How it works

Your RAG app emits OpenTelemetry spans as it runs: a retrieval span (with chunk IDs, scores, and content), optionally a reranking span, and an LLM span (with the full prompt text). RAGScope receives these via standard OTLP and extracts what it needs.

```
Your RAG app  ──(OTLP/JSON)──▶  RAGScope :4321
                                      │
                     ┌────────────────┼────────────────────┐
                     ▼                ▼                     ▼
               parse spans      normalize scores      detect context
               (wire format     (Qdrant/Chroma/        (which chunks
               → typed)         Pinecone → [0,1])      reached the LLM)
                     │                │                     │
                     └────────────────┼─────────────────────┘
                                      ▼
                              score the trace
                        (precision · efficiency ·
                          redundancy · coverage)
                                      │
                                      ▼
                             print to terminal
```

**Context detection** is the key mechanism: RAGScope compares each chunk's content against the actual LLM prompt text. If the chunk appears in the prompt, it was used (`inContext: true`). If not, it was retrieved and discarded. This is how RAGScope measures precision and efficiency without any special integration — it reads the spans your instrumentation already emits.

All trace data lives in memory for the session. Nothing is written to disk. Nothing leaves your machine.

---

## Quick start

```bash
# 1. Start RAGScope (no install needed)
npx ragscope start

# 2. Point your pipeline at it — one environment variable
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4321

# 3. Run your test queries — scores appear the moment each one completes
```

No config files. No accounts. No data leaving your machine. Requires Node.js ≥ 24.

---

## The four scores

Every trace gets a 0–100 score built from four sub-scores. The weights reflect their practical impact on answer quality.

### Retrieval Precision — 40%

**What it measures:** The fraction of retrieved chunks that actually appeared in the LLM's prompt.

**Why it's weighted highest:** A chunk that doesn't reach the LLM contributes nothing to the answer. It costs retrieval latency, vector store bandwidth, and context window space — and then gets silently dropped. If your pipeline retrieves 10 chunks and the LLM only sees 3, your TOP_K is more than 3× too high for this query.

**What a bad score looks like:**

```
✗ precision:30
→ Reduce TOP_K 10→3 (only 3 chunks reached LLM)
```

---

### Context Efficiency — 30%

**What it measures:** The fraction of retrieved tokens that the LLM actually consumed.

**Why it matters:** Every token in a retrieved chunk that doesn't reach the prompt is a token you paid to embed, store, and retrieve — and then threw away. Low efficiency means your context window is being filled with chunks that get cut before the LLM sees them, which also means the chunks that _do_ matter might be getting truncated.

**What a bad score looks like:**

```
✗ efficiency:45
```

55% of retrieved tokens were never seen by the model.

---

### Uniqueness — 20%

**What it measures:** How distinct your retrieved chunks are from each other. 100 = fully unique, 0 = all near-duplicates. Computed from text overlap between adjacent chunks.

**Why it matters:** When your chunking strategy creates overlapping segments, the model receives the same information multiple times. This wastes context window space, can bias the model toward repeated facts, and usually indicates a chunking configuration problem rather than a retrieval problem.

**What a bad score looks like:**

```
~ uniqueness:60
→ 2 near-duplicate chunks — deduplicate at ingest time
```

---

### Score Coverage — 10%

**What it measures:** Whether retrieved chunks carry non-zero similarity scores.

**Why it matters:** Without similarity scores you can't understand which chunks are the strongest matches, can't tune retrieval thresholds, and can't detect when your vector store is returning results in arbitrary order. This score is a signal flag, not a performance metric.

**Common cause of zero scores:** Langfuse sometimes omits scores from trace exports. Chroma returns L2 distances — RAGScope normalizes those automatically, so they won't trigger this flag.

---

### Labels

| Score | Label    | Meaning                                 |
| ----- | -------- | --------------------------------------- |
| ≥ 75  | **PASS** | Pipeline is healthy for this query      |
| 50–74 | **WARN** | Issues present — review recommendations |
| < 50  | **FAIL** | Significant retrieval problems          |

Run with `--verbose` for a per-score breakdown with specific tuning recommendations.

---

## Integrations

RAGScope accepts traces via two paths.

### Path 1 — OTLP (any OTel-compatible tool)

Set one environment variable. No code changes in most setups.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4321
```

Works with any instrumentation library that emits OpenTelemetry spans. Common setups:

**Traceloop / OpenLLMetry** — auto-instruments LangChain, LlamaIndex, OpenAI, Pinecone, Qdrant, Cohere, and more:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Traceloop } from '@traceloop/node-server-sdk';

Traceloop.init({
  exporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
});
```

**Vercel AI SDK:**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4321/v1/traces' }),
}).start();
```

**Phoenix (Arize):** set `PHOENIX_COLLECTOR_ENDPOINT=http://localhost:4321`

**OpenLLMetry:** set `TRACELOOP_BASE_URL=http://localhost:4321`

**Manual instrumentation** — the minimum RAGScope needs to score a trace is a retrieval span with two attributes:

```typescript
span.setAttribute('gen_ai.operation.name', 'retrieve');
span.setAttribute(
  'gen_ai.retrieval.documents',
  JSON.stringify([
    { id: 'chunk-1', score: 0.92, content: 'The actual chunk text...' },
    { id: 'chunk-2', score: 0.81, content: 'Another chunk...' },
  ]),
);
```

For context detection to work, add an LLM span with the full prompt:

```typescript
span.setAttribute('gen_ai.operation.name', 'chat');
span.setAttribute('ai.prompt', fullPromptText);
```

---

### Path 2 — Langfuse (zero code changes)

If you're already logging traces to Langfuse, set two env vars. RAGScope polls your project every 30 seconds and scores any new traces it finds — no code changes, no redeployment.

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... \
LANGFUSE_SECRET_KEY=sk-lf-... \
npx ragscope start
```

For a self-hosted instance, add `LANGFUSE_BASE_URL=https://your-langfuse.com`.

> **Coming soon:** LangSmith · Helicone adapters. [Open an issue](https://github.com/Sidd27/ragscope/issues) to request or contribute one.

---

## Problems it catches

| Symptom                                               | Root cause                                                                    | RAGScope signal                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| Answers are vague despite relevant documents existing | TOP_K too high — most retrieved chunks are discarded before the LLM sees them | Low precision + specific TOP_K recommendation |
| High token costs, slow responses                      | Retrieving large chunks that mostly get dropped                               | Low efficiency + wasted token count           |
| Model repeats the same information                    | Near-duplicate chunks in retrieval output                                     | Low uniqueness score + near-duplicate count   |
| Can't tune retrieval thresholds                       | Scores missing from trace data                                                | Low coverage + normalization note             |
| Reranker not improving answer quality                 | Chunks are reordered but the same ones are still dropped                      | Reranker diff in `/api/traces/:id`            |

---

## CLI reference

```
npx ragscope start [options]

  --port <n>     Port to listen on (default: 4321)
  --compact      One-line output per query instead of the full per-score breakdown
```

---

## Compatibility

|                   | Supported                                                              |
| ----------------- | ---------------------------------------------------------------------- |
| **Node.js**       | ≥ 24.0.0                                                               |
| **Ingestion**     | OTLP/HTTP · Langfuse polling                                           |
| **Languages**     | Any with OTel support (Node.js, Python, Go, Java…)                     |
| **Frameworks**    | LangChain · LlamaIndex · Vercel AI SDK · custom pipelines              |
| **Vector stores** | Qdrant · Chroma · Pinecone · Weaviate · pgvector · any OTLP source     |
| **Rerankers**     | Cohere Rerank · any span with `gen_ai.operation.name = rerank`         |
| **Models**        | OpenAI · Anthropic · Cohere · Mistral · any OTel-instrumented provider |

---

## What it doesn't do

RAGScope is deliberately narrow. Knowing what it won't do matters as much as knowing what it will.

**It is not a production monitoring tool.** Trace data lives in memory for the process lifetime. Use Langfuse, Phoenix, or Arize for production observability.

**It does not evaluate answer quality.** RAGScope measures retrieval mechanics — whether the right chunks are reaching the LLM efficiently. It does not judge whether the answers are factually correct or semantically appropriate.

**It does not run your reranker.** It observes your existing reranker span and reports whether the reordering is helping. It does not add reranking to your pipeline.

**It has limited support for agentic patterns.** It understands linear CHAIN → RETRIEVER → RERANKER → LLM pipelines well. Complex agent loops with tool use, multi-hop retrieval, or dynamic prompt construction may produce partial or misleading scores.

---

## Why not Langfuse / Phoenix / Arize?

Those are production observability platforms. They're designed to record, store, and analyze what happens after you ship — at scale, over time, with dashboards and alerting.

RAGScope is a development tool. It answers a different question: _"Is my pipeline working correctly right now, before I ship?"_ Zero setup, zero cloud, immediate feedback in the terminal. Different job, different tool.

Think of it as the difference between a linter (runs in your editor while you code) and a production error tracker (records what breaks for real users). You need both. They don't replace each other.

---

## Roadmap

### Current (v0.1.x)

- [x] OTLP ingestion — any OTel-compatible source
- [x] Langfuse polling adapter
- [x] Score normalization per vector store (Qdrant · Chroma · Pinecone · Weaviate)
- [x] Context assembly detection — which chunks actually reached the LLM
- [x] Reranker diff — before/after rank and score comparison
- [x] Four sub-scores: precision · efficiency · uniqueness · coverage
- [x] Actionable recommendations per score (TOP_K sizing, deduplication, score logging)
- [x] Rolling session average with trend indicator

### v0.2

- [ ] **LangSmith adapter** — poll runs via LangSmith API, zero code changes
- [ ] **Helicone adapter** — fetch requests via Helicone API
- [ ] **Langfuse webhooks** — real-time instead of 30s polling
- [ ] **Audit report** — `npx ragscope report` exports a Markdown/JSON summary of the session, shareable and committable

### Later

- [ ] **Compare mode** — `npx ragscope compare` diffs two pipeline versions from separate sessions
- [ ] **Threshold config** — `.ragscope.json` for custom PASS/WARN/FAIL thresholds per project
- [ ] **Trace drill-down** — `--trace <id>` to inspect a single trace in detail in the terminal
- [ ] **Python instrumentation helpers** — common patterns for Python RAG stacks

> Vote on features or propose new ones — [open an issue](https://github.com/Sidd27/ragscope/issues).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, code layout, and how to add a new ingestion adapter.

Good first contributions: LangSmith adapter · Helicone adapter · audit report export · scoring heuristic improvements

---

## Privacy

All trace data stays in memory on your machine. The only outbound network request RAGScope ever makes is the Langfuse poll — and only if you configure it with your own keys. No telemetry, no analytics, no accounts.

---

[Apache 2.0](LICENSE) — © 2026 Siddharth Pandey
