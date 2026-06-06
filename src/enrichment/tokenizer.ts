import { models, Tokenizer } from 'ai-tokenizer';
import * as encodings from 'ai-tokenizer/encoding';

// Cache tokenizer instances by encoding name
const tokenizerCache = new Map<string, Tokenizer>();

function getTokenizer(encodingName: string): Tokenizer {
  if (!tokenizerCache.has(encodingName)) {
    const enc = (encodings as Record<string, unknown>)[encodingName];
    if (!enc) throw new Error(`Unknown encoding: ${encodingName}`);
    tokenizerCache.set(
      encodingName,
      new Tokenizer(enc as ConstructorParameters<typeof Tokenizer>[0]),
    );
  }
  return tokenizerCache.get(encodingName)!;
}

function resolveEncoding(model: string | undefined): string {
  if (!model) return 'cl100k_base';

  // Try exact match
  if (model in models) {
    return (models as Record<string, { encoding: string }>)[model].encoding;
  }

  // Try prefix match (e.g. "gpt-4o" → "openai/gpt-4o")
  for (const [key, val] of Object.entries(models)) {
    if (key.endsWith(`/${model}`) || key === model) {
      return (val as { encoding: string }).encoding;
    }
  }

  // Heuristics
  if (model.startsWith('claude')) return 'claude';
  if (model.includes('gpt-4o') || model.includes('o1') || model.includes('o3')) return 'o200k_base';
  return 'cl100k_base';
}

export function countTokens(text: string, model?: string): number {
  const encodingName = resolveEncoding(model);
  const tokenizer = getTokenizer(encodingName);
  return tokenizer.encode(text).length;
}
