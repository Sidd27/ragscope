import type { ParsedTrace, ParsedSpan, SpanKind, RetrievalDocument } from '../types.js';
import { ingestTrace } from '../enrichment/pipeline.js';
import type { Store } from '../store/index.js';

interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
}

type ObservationType = 'SPAN' | 'GENERATION' | 'EVENT';

interface LangfuseObservation {
  id: string;
  traceId: string;
  parentObservationId?: string | null;
  name?: string | null;
  type: ObservationType;
  startTime: string;
  endTime?: string | null;
  model?: string | null;
  input?: unknown;
  output?: unknown;
  usage?: {
    input?: number | null;
    output?: number | null;
  } | null;
  metadata?: Record<string, unknown> | null;
}

interface LangfuseTrace {
  id: string;
  name?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown> | null;
  observations?: LangfuseObservation[];
}

interface LangfuseTracesPage {
  data: LangfuseTrace[];
  meta: { totalItems: number; totalPages: number; page: number };
}

function inferKindFromObservation(obs: LangfuseObservation): SpanKind {
  const name = (obs.name ?? '').toLowerCase();
  if (obs.type === 'GENERATION') return 'LLM';
  if (name.includes('rerank')) return 'RERANKER';
  if (name.includes('embed')) return 'EMBEDDING';
  if (name.includes('retriev') || name.includes('search') || name.includes('query'))
    return 'RETRIEVER';
  if (name.includes('chain') || name.includes('pipeline')) return 'CHAIN';
  return 'SPAN';
}

function extractDocuments(obs: LangfuseObservation): RetrievalDocument[] | undefined {
  const output = obs.output;
  if (!Array.isArray(output)) return undefined;
  return output
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d, i) => ({
      id: String(d['id'] ?? d['document_id'] ?? i),
      score: typeof d['score'] === 'number' ? d['score'] : 0,
      content: typeof d['content'] === 'string' ? d['content'] : undefined,
    }));
}

function observationToSpan(obs: LangfuseObservation, traceId: string): ParsedSpan {
  const startMs = new Date(obs.startTime).getTime();
  const endMs = obs.endTime ? new Date(obs.endTime).getTime() : startMs;
  const docs = extractDocuments(obs);
  const inputText =
    typeof obs.input === 'string' ? obs.input : obs.input ? JSON.stringify(obs.input) : undefined;

  return {
    traceId,
    spanId: obs.id,
    parentSpanId: obs.parentObservationId ?? undefined,
    name: obs.name ?? obs.type,
    kind: inferKindFromObservation(obs),
    startTimeMs: startMs,
    endTimeMs: endMs,
    latencyMs: endMs - startMs,
    model: obs.model ?? undefined,
    inputTokens: obs.usage?.input ?? undefined,
    outputTokens: obs.usage?.output ?? undefined,
    documents: docs,
    prompt: inputText,
  };
}

export class LangfusePoller {
  private readonly config: LangfuseConfig;
  private lastPolledAt: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: LangfuseConfig) {
    this.config = config;
    this.lastPolledAt = Date.now() - 5 * 60 * 1000;
  }

  start(store: Store, onTrace?: (traceId: string) => void): void {
    this.poll(store, onTrace).catch(console.error);
    this.timer = setInterval(() => this.poll(store, onTrace).catch(console.error), 30_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(store: Store, onTrace?: (traceId: string) => void): Promise<void> {
    const since = new Date(this.lastPolledAt).toISOString();
    const pollStart = Date.now();

    const baseUrl = this.config.baseUrl ?? 'https://cloud.langfuse.com';
    const auth = Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString(
      'base64',
    );

    const url = `${baseUrl}/api/public/traces?fromTimestamp=${encodeURIComponent(since)}&limit=50&page=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      console.error(`[LangfusePoller] fetch failed: ${res.status} ${res.statusText}`);
      return;
    }

    const page = (await res.json()) as LangfuseTracesPage;
    this.lastPolledAt = pollStart;

    for (const trace of page.data) {
      if (!trace.observations?.length) continue;

      const spans: ParsedSpan[] = trace.observations.map((obs) => observationToSpan(obs, trace.id));
      const parsed: ParsedTrace = {
        traceId: trace.id,
        serviceName: (trace.metadata?.['service.name'] as string | undefined) ?? 'langfuse',
        spans,
      };
      ingestTrace(store, parsed, 'langfuse');
      onTrace?.(parsed.traceId);
    }

    if (page.data.length > 0) {
      console.log(`[LangfusePoller] ingested ${page.data.length} traces`);
    }
  }
}
