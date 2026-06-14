import type { RagSpan, RagChunk } from '../types.js';

export interface SubScore {
  name: string;
  score: number;
  symbol: '✓' | '~' | '✗';
  finding: string;
  recommendation: string | null;
}

export interface AuditResult {
  overall: number;
  label: 'PASS' | 'WARN' | 'FAIL';
  query: string | null;
  serviceName: string;
  subscores: SubScore[];
}

function symbol(score: number): '✓' | '~' | '✗' {
  if (score >= 75) return '✓';
  if (score >= 50) return '~';
  return '✗';
}

const BURIED_PENALTY_PER_CHUNK = 12;
const BURIED_PENALTY_CAP = 36;

// A chunk is "buried" when a high-retrieval-rank chunk lands in the
// lost-in-the-middle zone of the assembled prompt — the central ~50% of
// positions, where LLMs attend least. Edges (first/last 25%) are exempt.
function countBuriedChunks(chunks: RagChunk[]): number {
  const inContext = chunks
    .filter((c) => c.inContext && c.contextPosition != null)
    .sort((a, b) => a.contextPosition! - b.contextPosition!);
  const n = inContext.length;
  if (n <= 3) return 0; // no meaningful middle

  const lo = Math.floor((n - 1) * 0.25);
  const hi = Math.ceil((n - 1) * 0.75);
  const highValueCutoff = Math.max(3, Math.ceil(chunks.length / 3));

  return inContext.filter((c) => {
    const inMiddle = c.contextPosition! > lo && c.contextPosition! < hi;
    const highValue = c.rankRetrieval != null && c.rankRetrieval <= highValueCutoff;
    return inMiddle && highValue;
  }).length;
}

function scoreRetrieval(chunks: RagChunk[]): SubScore {
  if (chunks.length === 0) {
    return {
      name: 'precision',
      score: 100,
      symbol: '✓',
      finding: 'no chunks',
      recommendation: null,
    };
  }
  const used = chunks.filter((c) => c.inContext).length;
  const base = Math.round((used / chunks.length) * 100);
  const buried = countBuriedChunks(chunks);
  const penalty = Math.min(buried * BURIED_PENALTY_PER_CHUNK, BURIED_PENALTY_CAP);
  const score = Math.max(0, Math.min(100, base - penalty));

  const finding =
    buried > 0
      ? `${used}/${chunks.length} chunks used · ${buried} buried mid-context`
      : `${used}/${chunks.length} chunks used`;

  let recommendation: string | null = null;
  if (buried > 0) {
    recommendation = `Move top-ranked chunks to the prompt edges — ${buried} high-rank chunk${buried > 1 ? 's' : ''} buried in the lost-in-the-middle zone`;
  } else if (base < 60) {
    recommendation = `Reduce TOP_K ${chunks.length}→${Math.max(used, 3)} (only ${used} chunks reached LLM)`;
  }

  return {
    name: 'precision',
    score,
    symbol: symbol(score),
    finding,
    recommendation,
  };
}

function scoreEfficiency(chunks: RagChunk[]): SubScore {
  const usedTokens = chunks.filter((c) => c.inContext).reduce((n, c) => n + (c.tokenCount ?? 0), 0);
  const wastedTokens = chunks
    .filter((c) => !c.inContext)
    .reduce((n, c) => n + (c.tokenCount ?? 0), 0);
  const total = usedTokens + wastedTokens;
  if (total === 0) {
    return {
      name: 'efficiency',
      score: 100,
      symbol: '✓',
      finding: 'no token data',
      recommendation: null,
    };
  }
  const score = Math.round((usedTokens / total) * 100);
  const wastedPct = 100 - score;
  return {
    name: 'efficiency',
    score,
    symbol: symbol(score),
    finding: `${wastedPct}% tokens wasted`,
    recommendation: score < 60 ? `${wastedPct}% of retrieved tokens never reached the LLM` : null,
  };
}

function scoreRedundancy(chunks: RagChunk[]): SubScore {
  const withOverlap = chunks.filter((c) => c.overlapWithNext != null);
  if (withOverlap.length === 0) {
    return {
      name: 'uniqueness',
      score: 100,
      symbol: '✓',
      finding: 'no overlap data',
      recommendation: null,
    };
  }
  const avgOverlap = withOverlap.reduce((n, c) => n + c.overlapWithNext!, 0) / withOverlap.length;
  const score = Math.round((1 - avgOverlap) * 100);
  const highOverlap = withOverlap.filter((c) => c.overlapWithNext! > 0.8).length;
  return {
    name: 'uniqueness',
    score,
    symbol: symbol(score),
    finding: highOverlap > 0 ? `${highOverlap} near-duplicate pairs` : 'chunks are distinct',
    recommendation:
      score < 70 && highOverlap > 0
        ? `${highOverlap} near-duplicate chunks — deduplicate at ingest time`
        : null,
  };
}

function scoreCoverage(chunks: RagChunk[]): SubScore {
  if (chunks.length === 0) {
    return {
      name: 'coverage',
      score: 100,
      symbol: '✓',
      finding: 'no chunks',
      recommendation: null,
    };
  }
  const missing = chunks.filter((c) => c.scoreMissing).length;
  const score = Math.round((1 - missing / chunks.length) * 100);
  return {
    name: 'coverage',
    score,
    symbol: symbol(score),
    finding: missing > 0 ? `${missing} chunks missing scores` : 'all chunks scored',
    recommendation:
      score < 80 ? `Log scores in retriever output to unlock score optimizations` : null,
  };
}

// Effectiveness of the reranker stage: did it pull the chunks the LLM
// actually used toward the top? Average rank improvement of used chunks,
// mapped so neutral (no movement) = 50, +4 ranks = 100, −4 ranks = 0.
function scoreRerank(chunks: RagChunk[]): SubScore {
  const reranked = chunks.filter((c) => c.rankReranked != null && c.rankRetrieval != null);
  const usedReranked = reranked.filter((c) => c.inContext);
  const sample = usedReranked.length > 0 ? usedReranked : reranked;

  const avgImprovement =
    sample.reduce((n, c) => n + (c.rankRetrieval! - c.rankReranked!), 0) / sample.length;
  const score = Math.max(0, Math.min(100, Math.round(50 + avgImprovement * 12.5)));

  let finding: string;
  if (avgImprovement > 0.5) {
    finding = `used chunks promoted avg +${avgImprovement.toFixed(1)} ranks`;
  } else if (avgImprovement < -0.5) {
    finding = `used chunks demoted avg ${avgImprovement.toFixed(1)} ranks`;
  } else {
    finding = 'reranker left used chunks in place';
  }

  return {
    name: 'rerank-gain',
    score,
    symbol: symbol(score),
    finding,
    recommendation:
      score < 60 ? 'Reranker is not surfacing the chunks the LLM actually uses' : null,
  };
}

export function scoreTrace(
  serviceName: string,
  query: string | null,
  spans: RagSpan[],
  chunks: RagChunk[],
): AuditResult {
  const precision = scoreRetrieval(chunks);
  const efficiency = scoreEfficiency(chunks);
  const redundancy = scoreRedundancy(chunks);
  const coverage = scoreCoverage(chunks);
  const hasReranker = chunks.some((c) => c.rankReranked != null);

  let overall: number;
  let subscores: SubScore[];

  if (hasReranker) {
    const rerank = scoreRerank(chunks);
    overall = Math.round(
      precision.score * 0.35 +
        efficiency.score * 0.25 +
        rerank.score * 0.15 +
        redundancy.score * 0.15 +
        coverage.score * 0.1,
    );
    subscores = [precision, efficiency, rerank, redundancy, coverage];
  } else {
    overall = Math.round(
      precision.score * 0.4 +
        efficiency.score * 0.3 +
        redundancy.score * 0.2 +
        coverage.score * 0.1,
    );
    subscores = [precision, efficiency, redundancy, coverage];
  }

  const label: AuditResult['label'] = overall >= 75 ? 'PASS' : overall >= 50 ? 'WARN' : 'FAIL';

  return {
    overall,
    label,
    query,
    serviceName,
    subscores,
  };
}
