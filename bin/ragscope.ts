#!/usr/bin/env node
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { LangfusePoller } from '../src/ingestion/langfuse.js';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import pc from 'picocolors';
import { scoreTrace } from '../src/audit/scorer.js';
import type { AuditResult } from '../src/audit/scorer.js';
import { getTraceById } from '../src/db/queries.js';

const sessionScores: number[] = [];
const verbose = process.argv.includes('--verbose');

function printAudit(result: AuditResult): void {
  const col = result.label === 'PASS' ? pc.green : result.label === 'WARN' ? pc.yellow : pc.red;
  const label = col(pc.bold(` ${result.label} `));
  const score = pc.bold(`${result.overall}/100`);
  const svc = pc.cyan(result.serviceName);
  const q = result.query
    ? pc.dim(`"${result.query.slice(0, 60)}${result.query.length > 60 ? '…' : ''}"`)
    : pc.dim('(no query)');

  if (verbose) {
    console.log();
    console.log(pc.dim(' ' + '─'.repeat(52)));
    console.log(` ${label}  ${score}  ${svc}`);
    console.log(` ${pc.dim('Query')}  ${q}`);
    console.log();
    for (const s of result.subscores) {
      const c = s.symbol === '✓' ? pc.green : s.symbol === '~' ? pc.yellow : pc.red;
      console.log(
        `   ${c(s.symbol)}  ${s.name.padEnd(12)} ${String(s.score).padStart(3)}/100  ${pc.dim(s.finding)}`,
      );
    }
    const recs = result.subscores.filter((s) => s.recommendation);
    if (recs.length > 0) {
      console.log();
      console.log(` ${pc.bold('Recommendations')}`);
      for (const s of recs) console.log(`   ${pc.yellow('→')} ${s.recommendation}`);
    }
    console.log(pc.dim(' ' + '─'.repeat(52)));
  } else {
    const subs = result.subscores
      .map((s) => {
        const c = s.symbol === '✓' ? pc.green : s.symbol === '~' ? pc.yellow : pc.red;
        return c(`${s.name}:${s.score}`);
      })
      .join('  ');
    console.log(` ${label}  ${score}  ${svc}  ${q}`);
    console.log(`       ${subs}`);
    const recs = result.subscores.filter((s) => s.recommendation).map((s) => s.recommendation!);
    if (recs.length > 0) {
      console.log(`       ${pc.yellow('→')} ${recs.join(' · ')}`);
    }
    console.log();
  }
}

function printSession(): void {
  if (sessionScores.length === 0) return;
  const avg = Math.round(sessionScores.reduce((a, b) => a + b, 0) / sessionScores.length);
  const last = sessionScores[sessionScores.length - 1]!;
  const trend =
    sessionScores.length < 2
      ? ''
      : last > avg
        ? pc.green(' ↑')
        : last < avg
          ? pc.red(' ↓')
          : pc.dim(' →');
  process.stdout.write(` ${pc.dim('─'.repeat(52))}\n`);
  process.stdout.write(
    ` ${pc.dim('Session')}  ${sessionScores.length} ${sessionScores.length === 1 ? 'query' : 'queries'} · avg ${pc.bold(String(avg))}/100${trend}\n\n`,
  );
}

async function handleTrace(traceId: string): Promise<void> {
  const result = await getTraceById(db, traceId);
  if (!result) return;
  const audit = scoreTrace(
    result.trace.serviceName,
    result.trace.query,
    result.spans,
    result.chunks,
  );
  sessionScores.push(audit.overall);
  printAudit(audit);
  printSession();
}

function loadDotenv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotenv();

const args = process.argv.slice(2);
function getArg(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultValue;
}

const apiPort = parseInt(getArg('--port', '4321'), 10);
const dbPath = resolve(getArg('--db', './ragscope.db'));

const db = createDb(dbPath);
const app = createApp(db, handleTrace);

await app.listen({ port: apiPort, host: '0.0.0.0' });

console.log(`RAGScope API  →  http://localhost:${apiPort}`);
console.log(`  OTLP:     POST http://localhost:${apiPort}/v1/traces`);
console.log(`  Database: ${dbPath}`);

const langfuseKey = process.env['LANGFUSE_PUBLIC_KEY'];
const langfuseSecret = process.env['LANGFUSE_SECRET_KEY'];
if (langfuseKey && langfuseSecret) {
  const poller = new LangfusePoller({
    publicKey: langfuseKey,
    secretKey: langfuseSecret,
    baseUrl: process.env['LANGFUSE_BASE_URL'],
  });
  poller.start(db, handleTrace);
  console.log(`  Langfuse sync: enabled (polling every 30s)`);
}
