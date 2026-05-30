import { describe, it, expect } from 'vitest';
import { countTokens } from './tokenizer.js';

describe('countTokens', () => {
  it('counts tokens for a simple string with default encoding', () => {
    const count = countTokens('Hello world');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it('returns more tokens for longer text', () => {
    const short = countTokens('Hi');
    const long = countTokens(
      'This is a much longer sentence with many words that should tokenize to more tokens',
    );
    expect(long).toBeGreaterThan(short);
  });

  it('counts tokens with a GPT-4o model hint', () => {
    const count = countTokens('The capital of France is Paris.', 'openai/gpt-4o');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(15);
  });

  it('counts tokens with a Claude model hint', () => {
    const count = countTokens('The capital of France is Paris.', 'anthropic/claude-3.5-sonnet');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(15);
  });

  it('handles empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('falls back gracefully for unknown model', () => {
    const count = countTokens('Hello world', 'some-unknown-model-v99');
    expect(count).toBeGreaterThan(0);
  });

  it('uses claude encoding for claude- prefix models', () => {
    const count = countTokens('Hello world', 'claude-3-haiku');
    expect(count).toBeGreaterThan(0);
  });
});
