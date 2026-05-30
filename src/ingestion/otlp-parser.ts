import type {
  OtlpPayload,
  OtlpAttribute,
  OtlpAttributeValue,
  ParsedSpan,
  ParsedTrace,
  SpanKind,
  RetrievalDocument,
} from '../types.js';

function attrValue(v: OtlpAttributeValue): string | number | boolean | null {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return parseInt(v.intValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return null;
}

function attrsToMap(attrs: OtlpAttribute[] = []): Record<string, string | number | boolean | null> {
  const map: Record<string, string | number | boolean | null> = {};
  for (const a of attrs) map[a.key] = attrValue(a.value);
  return map;
}

function nanoToMs(nano: string): number {
  return Number(BigInt(nano) / 1_000_000n);
}

function inferKind(
  spanName: string,
  attrs: Record<string, string | number | boolean | null>,
): SpanKind {
  const op = (attrs['gen_ai.operation.name'] as string | null)?.toLowerCase() ?? '';
  const name = spanName.toLowerCase();

  if (op === 'rerank' || name.includes('rerank')) return 'RERANKER';
  if (op === 'embeddings' || op === 'embed' || name.includes('embed')) return 'EMBEDDING';
  if (op === 'retrieve' || op === 'retrieval' || name.includes('retriev')) return 'RETRIEVER';
  if (
    op === 'chat' ||
    op === 'completion' ||
    op === 'text_generation' ||
    name.includes('llm') ||
    name.includes('chat')
  )
    return 'LLM';
  if (name.includes('chain') || name.includes('pipeline') || name.includes('graph')) return 'CHAIN';
  return 'SPAN';
}

function parseDocuments(
  attrs: Record<string, string | number | boolean | null>,
  rawAttrs: OtlpAttribute[],
): RetrievalDocument[] {
  // gen_ai.retrieval.documents is encoded as a JSON string in a string attribute
  const raw = attrs['gen_ai.retrieval.documents'] as string | null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((d: { id?: string; score?: number; content?: string }, i: number) => ({
          id: d.id ?? String(i),
          score: d.score ?? 0,
          content: d.content,
        }));
      }
    } catch {
      // fall through to array-based parsing
    }
  }

  // Also look for indexed attributes like gen_ai.retrieval.documents.0.id
  const docs: Map<number, Partial<RetrievalDocument>> = new Map();
  for (const attr of rawAttrs) {
    const m = attr.key.match(/^gen_ai\.retrieval\.documents\.(\d+)\.(id|score|content)$/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const field = m[2] as 'id' | 'score' | 'content';
    if (!docs.has(idx)) docs.set(idx, {});
    const doc = docs.get(idx)!;
    const val = attrValue(attr.value);
    if (field === 'id') doc.id = String(val ?? idx);
    if (field === 'score') doc.score = typeof val === 'number' ? val : 0;
    if (field === 'content') doc.content = String(val ?? '');
  }

  if (docs.size > 0) {
    return Array.from(docs.entries())
      .sort(([a], [b]) => a - b)
      .map(([i, d]) => ({ id: d.id ?? String(i), score: d.score ?? 0, content: d.content }));
  }

  return [];
}

export function parseOtlpPayload(payload: OtlpPayload): ParsedTrace[] {
  const traces: ParsedTrace[] = [];

  for (const rs of payload.resourceSpans ?? []) {
    const resourceAttrs = attrsToMap(rs.resource?.attributes ?? []);
    const serviceName = (resourceAttrs['service.name'] as string | null) ?? 'unknown';

    const traceSpans = new Map<string, ParsedSpan[]>();

    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const attrs = attrsToMap(span.attributes ?? []);
        const startTimeMs = nanoToMs(span.startTimeUnixNano);
        const endTimeMs = nanoToMs(span.endTimeUnixNano);
        const documents = parseDocuments(attrs, span.attributes ?? []);
        const prompt = (attrs['ai.prompt'] ?? attrs['gen_ai.prompt']) as string | undefined;

        const parsed: ParsedSpan = {
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          name: span.name,
          kind: inferKind(span.name, attrs),
          startTimeMs,
          endTimeMs,
          latencyMs: endTimeMs - startTimeMs,
          operationName: attrs['gen_ai.operation.name'] as string | undefined,
          model:
            (attrs['gen_ai.request.model'] as string | undefined) ??
            (attrs['gen_ai.response.model'] as string | undefined),
          system: attrs['gen_ai.system'] as string | undefined,
          inputTokens: attrs['gen_ai.usage.input_tokens'] as number | undefined,
          outputTokens: attrs['gen_ai.usage.output_tokens'] as number | undefined,
          rawAttributes: JSON.stringify(span.attributes ?? []),
          documents: documents.length > 0 ? documents : undefined,
          prompt: typeof prompt === 'string' ? prompt : undefined,
        };

        if (!traceSpans.has(span.traceId)) traceSpans.set(span.traceId, []);
        traceSpans.get(span.traceId)!.push(parsed);
      }
    }

    for (const [traceId, spanList] of traceSpans) {
      traces.push({ traceId, serviceName, spans: spanList });
    }
  }

  return traces;
}
