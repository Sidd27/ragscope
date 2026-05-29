import type { RagSpan, RagChunk } from '../types.js'

export interface SubScore {
  name: string
  score: number
  symbol: '✓' | '~' | '✗'
  finding: string
  recommendation: string | null
}

export interface AuditResult {
  overall: number
  label: 'PASS' | 'WARN' | 'FAIL'
  query: string | null
  serviceName: string
  subscores: SubScore[]
}

function symbol(score: number): '✓' | '~' | '✗' {
  if (score >= 75) return '✓'
  if (score >= 50) return '~'
  return '✗'
}

function scoreRetrieval(chunks: RagChunk[]): SubScore {
  if (chunks.length === 0) {
    return { name: 'precision', score: 100, symbol: '✓', finding: 'no chunks', recommendation: null }
  }
  const used = chunks.filter(c => c.inContext).length
  const score = Math.round(used / chunks.length * 100)
  return {
    name: 'precision',
    score,
    symbol: symbol(score),
    finding: `${used}/${chunks.length} chunks used`,
    recommendation: score < 60
      ? `Reduce TOP_K ${chunks.length}→${Math.max(used, 3)} (only ${used} chunks reached LLM)`
      : null,
  }
}

function scoreEfficiency(chunks: RagChunk[]): SubScore {
  const usedTokens = chunks.filter(c => c.inContext).reduce((n, c) => n + (c.tokenCount ?? 0), 0)
  const wastedTokens = chunks.filter(c => !c.inContext).reduce((n, c) => n + (c.tokenCount ?? 0), 0)
  const total = usedTokens + wastedTokens
  if (total === 0) {
    return { name: 'efficiency', score: 100, symbol: '✓', finding: 'no token data', recommendation: null }
  }
  const score = Math.round(usedTokens / total * 100)
  const wastedPct = 100 - score
  return {
    name: 'efficiency',
    score,
    symbol: symbol(score),
    finding: `${wastedPct}% tokens wasted`,
    recommendation: score < 60 ? `${wastedPct}% of retrieved tokens never reached the LLM` : null,
  }
}

function scoreRedundancy(chunks: RagChunk[]): SubScore {
  const withOverlap = chunks.filter(c => c.overlapWithNext != null)
  if (withOverlap.length === 0) {
    return { name: 'redundancy', score: 100, symbol: '✓', finding: 'no overlap data', recommendation: null }
  }
  const avgOverlap = withOverlap.reduce((n, c) => n + c.overlapWithNext!, 0) / withOverlap.length
  const score = Math.round((1 - avgOverlap) * 100)
  const highOverlap = withOverlap.filter(c => c.overlapWithNext! > 0.8).length
  return {
    name: 'redundancy',
    score,
    symbol: symbol(score),
    finding: highOverlap > 0 ? `${highOverlap} near-duplicate pairs` : 'chunks are distinct',
    recommendation: score < 70 && highOverlap > 0
      ? `${highOverlap} near-duplicate chunks — deduplicate at ingest time`
      : null,
  }
}

function scoreCoverage(chunks: RagChunk[]): SubScore {
  if (chunks.length === 0) {
    return { name: 'coverage', score: 100, symbol: '✓', finding: 'no chunks', recommendation: null }
  }
  const missing = chunks.filter(c => c.scoreMissing).length
  const score = Math.round((1 - missing / chunks.length) * 100)
  return {
    name: 'coverage',
    score,
    symbol: symbol(score),
    finding: missing > 0 ? `${missing} chunks missing scores` : 'all chunks scored',
    recommendation: score < 80 ? `Log scores in retriever output to unlock score optimizations` : null,
  }
}

export function scoreTrace(
  serviceName: string,
  query: string | null,
  spans: RagSpan[],
  chunks: RagChunk[],
): AuditResult {
  const precision = scoreRetrieval(chunks)
  const efficiency = scoreEfficiency(chunks)
  const redundancy = scoreRedundancy(chunks)
  const coverage = scoreCoverage(chunks)

  const overall = Math.round(
    precision.score * 0.4 +
    efficiency.score * 0.3 +
    redundancy.score * 0.2 +
    coverage.score * 0.1,
  )
  const label: AuditResult['label'] = overall >= 75 ? 'PASS' : overall >= 50 ? 'WARN' : 'FAIL'

  return { overall, label, query, serviceName, subscores: [precision, efficiency, redundancy, coverage] }
}
