import { describe, it, expect } from 'vitest';
import { parseOtlpPayload } from './otlp-parser.js';
import type { OtlpPayload } from '../types.js';

const minimalPayload: OtlpPayload = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-rag-app' } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'trace-abc',
              spanId: 'span-001',
              name: 'qdrant.query',
              kind: 3,
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000000050000000',
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'retrieve' } },
                { key: 'gen_ai.system', value: { stringValue: 'qdrant' } },
                {
                  key: 'gen_ai.retrieval.documents',
                  value: {
                    stringValue: JSON.stringify([
                      { id: 'doc-1', score: 0.92, content: 'Paris is the capital' },
                      { id: 'doc-2', score: 0.75 },
                    ]),
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('parseOtlpPayload', () => {
  it('extracts service name from resource attributes', () => {
    const traces = parseOtlpPayload(minimalPayload);
    expect(traces[0].serviceName).toBe('my-rag-app');
  });

  it('groups spans by traceId', () => {
    const traces = parseOtlpPayload(minimalPayload);
    expect(traces).toHaveLength(1);
    expect(traces[0].traceId).toBe('trace-abc');
    expect(traces[0].spans).toHaveLength(1);
  });

  it('converts nanosecond timestamps to milliseconds', () => {
    const traces = parseOtlpPayload(minimalPayload);
    const span = traces[0].spans[0];
    expect(span.startTimeMs).toBe(1700000000000);
    expect(span.latencyMs).toBe(50);
  });

  it('infers RETRIEVER kind from gen_ai.operation.name', () => {
    const traces = parseOtlpPayload(minimalPayload);
    expect(traces[0].spans[0].kind).toBe('RETRIEVER');
  });

  it('parses gen_ai.retrieval.documents JSON string', () => {
    const traces = parseOtlpPayload(minimalPayload);
    const docs = traces[0].spans[0].documents!;
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({ id: 'doc-1', score: 0.92, content: 'Paris is the capital' });
    expect(docs[1].id).toBe('doc-2');
  });

  it('infers LLM kind from operation name', () => {
    const payload: OtlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'openai.chat',
                  kind: 3,
                  startTimeUnixNano: '1000000000000',
                  endTimeUnixNano: '2000000000000',
                  attributes: [
                    { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                    { key: 'gen_ai.usage.input_tokens', value: { intValue: '100' } },
                    { key: 'gen_ai.usage.output_tokens', value: { intValue: '50' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const traces = parseOtlpPayload(payload);
    const span = traces[0].spans[0];
    expect(span.kind).toBe('LLM');
    expect(span.inputTokens).toBe(100);
    expect(span.outputTokens).toBe(50);
  });

  it('falls back to SPAN kind for unknown spans', () => {
    const payload: OtlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'some.unknown.operation',
                  kind: 1,
                  startTimeUnixNano: '1000000000000',
                  endTimeUnixNano: '1000000001000',
                },
              ],
            },
          ],
        },
      ],
    };
    const traces = parseOtlpPayload(payload);
    expect(traces[0].spans[0].kind).toBe('SPAN');
  });

  it('handles empty payload gracefully', () => {
    const traces = parseOtlpPayload({});
    expect(traces).toHaveLength(0);
  });

  it('parses indexed gen_ai.retrieval.documents.N.field attributes', () => {
    const payload: OtlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'qdrant.query',
                  kind: 3,
                  startTimeUnixNano: '1000000000000',
                  endTimeUnixNano: '1001000000000',
                  attributes: [
                    { key: 'gen_ai.retrieval.documents.0.id', value: { stringValue: 'chunk-a' } },
                    { key: 'gen_ai.retrieval.documents.0.score', value: { doubleValue: 0.88 } },
                    {
                      key: 'gen_ai.retrieval.documents.0.content',
                      value: { stringValue: 'First chunk' },
                    },
                    { key: 'gen_ai.retrieval.documents.1.id', value: { stringValue: 'chunk-b' } },
                    { key: 'gen_ai.retrieval.documents.1.score', value: { doubleValue: 0.72 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const traces = parseOtlpPayload(payload);
    const docs = traces[0].spans[0].documents!;
    expect(docs).toHaveLength(2);
    expect(docs[0].id).toBe('chunk-a');
    expect(docs[0].score).toBeCloseTo(0.88);
    expect(docs[0].content).toBe('First chunk');
    expect(docs[1].id).toBe('chunk-b');
  });

  it('ignores malformed gen_ai.retrieval.documents JSON and falls back to indexed', () => {
    const payload: OtlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'retriever',
                  kind: 3,
                  startTimeUnixNano: '1000000000000',
                  endTimeUnixNano: '1001000000000',
                  attributes: [
                    {
                      key: 'gen_ai.retrieval.documents',
                      value: { stringValue: 'not valid json {{' },
                    },
                    {
                      key: 'gen_ai.retrieval.documents.0.id',
                      value: { stringValue: 'fallback-doc' },
                    },
                    { key: 'gen_ai.retrieval.documents.0.score', value: { doubleValue: 0.5 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const traces = parseOtlpPayload(payload);
    const docs = traces[0].spans[0].documents!;
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('fallback-doc');
  });

  it('infers EMBEDDING kind', () => {
    const payload: OtlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'openai.embed',
                  kind: 3,
                  startTimeUnixNano: '1000000000000',
                  endTimeUnixNano: '1001000000000',
                  attributes: [
                    { key: 'gen_ai.operation.name', value: { stringValue: 'embeddings' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseOtlpPayload(payload)[0].spans[0].kind).toBe('EMBEDDING');
  });

  it('infers RERANKER kind', () => {
    const payload: OtlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'cohere.rerank',
                  kind: 3,
                  startTimeUnixNano: '1000000000000',
                  endTimeUnixNano: '1001000000000',
                  attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'rerank' } }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseOtlpPayload(payload)[0].spans[0].kind).toBe('RERANKER');
  });

  it('defaults serviceName to unknown when resource has no service.name', () => {
    const payload: OtlpPayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'op',
                  kind: 1,
                  startTimeUnixNano: '1000000000000',
                  endTimeUnixNano: '1001000000000',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseOtlpPayload(payload)[0].serviceName).toBe('unknown');
  });
});
