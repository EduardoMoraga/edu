#!/usr/bin/env node
// External deterministic oracle for the synthetic transfer pilot; NOT an LLM benchmark generator.
import { readFile } from 'node:fs/promises';
const [questions, answers] = process.argv.slice(2);
if (!questions || !answers) throw new Error('Usage: node scripts/pilot-oracle.mjs <questions.json> <answers.json>');
const rows = JSON.parse(await readFile(questions, 'utf8'));
const submitted = JSON.parse(await readFile(answers, 'utf8'));
if (!Array.isArray(rows) || !Array.isArray(submitted)) throw new Error('Expected arrays');
function expected(row) {
  const tenant = row.tenant.trim().toLowerCase();
  const sku = row.sku.normalize('NFKC').trim().toUpperCase();
  const valid = Boolean(tenant && sku);
  return { id: row.id, cacheKey: valid ? `${tenant}::${sku}` : null,
    ttlSeconds: valid && tenant !== 'trial' ? 47 : 0,
    retryAllowed: valid && row.attempts < 2 && (row.method === 'GET' || (row.method === 'POST' && Boolean(row.idempotencyKey.trim()))),
    retentionHours: 72 };
}
const results = rows.map(row => {
  const matches = submitted.filter(answer => answer?.id === row.id);
  const target = expected(row); const answer = matches[0];
  const ok = matches.length === 1 && answer && Object.keys(answer).length === Object.keys(target).length && Object.entries(target).every(([key, value]) => answer[key] === value);
  return { id: row.id, ok: Boolean(ok), ...(ok ? {} : { expected: target, actual: answer ?? null }) };
});
const extras = submitted.filter(answer => !rows.some(row => row.id === answer?.id)).length;
const report = { passed: results.filter(row => row.ok).length, total: rows.length, extras, results };
console.log(JSON.stringify(report, null, 2));
if (report.passed !== report.total || extras) process.exitCode = 1;
