#!/usr/bin/env node
import { createApp } from '../src/app.js';
import { createStore, getTraceById } from '../src/store/index.js';
import { LangfusePoller } from '../src/ingestion/langfuse.js';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import pc from 'picocolors';
import { scoreTrace } from '../src/audit/scorer.js';
import type { AuditResult } from '../src/audit/scorer.js';

const sessionScores: number[] = [];
const verbose = !process.argv.includes('--compact');

function labelColor(label: AuditResult['label']): (s: string) => string {
  return label === 'PASS' ? pc.green : label === 'WARN' ? pc.yellow : pc.red;
}

function symColor(sym: '✓' | '~' | '✗'): (s: string) => string {
  return sym === '✓' ? pc.green : sym === '~' ? pc.yellow : pc.red;
}

function subLabel(score: number): AuditResult['label'] {
  return score >= 75 ? 'PASS' : score >= 50 ? 'WARN' : 'FAIL';
}

function makeBar(score: number, label: AuditResult['label']): string {
  const filled = Math.round(score / 10);
  const fill = labelColor(label);
  return fill('█'.repeat(filled)) + pc.dim('░'.repeat(10 - filled));
}

function printAudit(result: AuditResult): void {
  const col = labelColor(result.label);
  const badge = col(pc.bold(` ${result.label} `));
  const score = pc.bold(`${result.overall}/100`);
  const bar = makeBar(result.overall, result.label);
  const svc = pc.cyan(result.serviceName);
  const q = result.query
    ? pc.dim(`"${result.query.slice(0, 55)}${result.query.length > 55 ? '…' : ''}"`)
    : '';

  if (verbose) {
    const border = pc.dim('│');
    console.log();
    console.log(`  ${badge}  ${score}  ${bar}  ${svc}`);
    if (q) console.log(`  ${border}  ${q}`);
    console.log(`  ${border}`);
    for (const s of result.subscores) {
      const c = symColor(s.symbol);
      const subBar = makeBar(s.score, subLabel(s.score));
      console.log(
        `  ${border}  ${c(s.symbol)}  ${pc.dim(s.name.padEnd(11))} ${pc.bold(String(s.score).padStart(3))}  ${subBar}  ${pc.dim(s.finding)}`,
      );
    }
    const recs = result.subscores.filter((s) => s.recommendation);
    if (recs.length > 0) {
      console.log(`  ${border}`);
      for (const s of recs) console.log(`  ${border}  ${pc.yellow('→')} ${s.recommendation}`);
    }
    console.log(`  ${border}`);
  } else {
    console.log();
    const header = [badge, score, bar, svc, q].filter(Boolean).join('  ');
    console.log(`  ${header}`);
    const subs = result.subscores
      .map((s) => `${symColor(s.symbol)(s.symbol)} ${pc.dim(s.name)}:${pc.bold(String(s.score))}`)
      .join('  ');
    console.log(`          ${subs}`);
    const recs = result.subscores.filter((s) => s.recommendation).map((s) => s.recommendation!);
    if (recs.length > 0) console.log(`          ${pc.yellow('→')} ${recs.join('  ·  ')}`);
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
  console.log(`\n  ${pc.dim('─'.repeat(50))}`);
  console.log(
    `  ${pc.dim('Session')}  ${sessionScores.length} ${sessionScores.length === 1 ? 'query' : 'queries'}  ·  avg ${pc.bold(String(avg))}/100${trend}\n`,
  );
}

function handleTrace(traceId: string): void {
  const result = getTraceById(store, traceId);
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

const store = createStore();
const app = createApp(store, handleTrace);

await app.listen({ port: apiPort, host: '0.0.0.0' });

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

const BANNER = [
  '██████╗  █████╗  ██████╗ ███████╗ ██████╗  ██████╗ ██████╗ ███████╗',
  '██╔══██╗██╔══██╗██╔════╝ ██╔════╝ ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██████╔╝███████║██║  ███╗███████╗ ██║      ██║   ██║██████╔╝█████╗  ',
  '██╔══██╗██╔══██║██║   ██║╚════██║ ██║      ██║   ██║██╔═══╝ ██╔══╝  ',
  '██║  ██║██║  ██║╚██████╔╝███████║ ╚██████╗ ╚██████╔╝██║     ███████╗',
  '╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝  ╚═════╝  ╚═════╝╚═╝     ╚══════╝',
];

const maxW = Math.max(...BANNER.map((l) => l.length));
const boxW = maxW + 2; // inner width: 1 space padding each side

const boxRow = (coloredContent: string, rawLen: number) => {
  const pad = ' '.repeat(Math.max(0, boxW - rawLen));
  return `  ${pc.dim('│')}${coloredContent}${pad}${pc.dim('│')}`;
};
const blankRow = boxRow(' '.repeat(boxW), boxW);
const sepRow = `  ${pc.dim('├' + '─'.repeat(boxW) + '┤')}`;
const infoRow = (label: string, value: string) => {
  const raw = ` · ${label.padEnd(9)} ${value}`;
  const colored = ` ${pc.cyan('·')} ${label.padEnd(9)} ${pc.bold(value)}`;
  return boxRow(colored, raw.length);
};

const langfuseKey = process.env['LANGFUSE_PUBLIC_KEY'];
const langfuseSecret = process.env['LANGFUSE_SECRET_KEY'];
let poller: LangfusePoller | null = null;
if (langfuseKey && langfuseSecret) {
  poller = new LangfusePoller({
    publicKey: langfuseKey,
    secretKey: langfuseSecret,
    baseUrl: process.env['LANGFUSE_BASE_URL'],
  });
  poller.start(store, handleTrace);
}

console.log();
console.log(`  ${pc.dim('╭' + '─'.repeat(boxW) + '╮')}`);
for (const line of BANNER) {
  const raw = ` ${line.padEnd(maxW)} `;
  console.log(boxRow(` ${pc.cyan(line.padEnd(maxW))} `, raw.length));
}
console.log(sepRow);
console.log(blankRow);
console.log(infoRow('Port', `:${apiPort}`));
console.log(infoRow('Version', `v${pkg.version}`));
console.log(infoRow('OTLP', `http://localhost:${apiPort}/v1/traces`));
if (poller) console.log(infoRow('Langfuse', 'polling every 30s'));
console.log(blankRow);
console.log(`  ${pc.dim('╰' + '─'.repeat(boxW) + '╯')}`);
console.log();
