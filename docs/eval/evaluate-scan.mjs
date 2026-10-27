// Scans a labelled set of links against the live SafeScan API and records the verdict level,
// latency and cache use. Run from the repo root with Node 18 or later (no dependencies):
//   node docs/eval/evaluate-scan.mjs
// Writes docs/eval/results.json and docs/eval/results.md. Uses about 30 of the 120 hourly scans per install.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = process.env.SAFESCAN_API ?? 'https://hggnmfb55rkvypwevw5owgj3y40srnpp.lambda-url.us-east-1.on.aws/';
const INSTALL_ID = `eval-${randomUUID()}`;

// expected: the level the design says this link should get; null = the scan should be refused (400)
const CASES = [
  { group: 'Known threat (Google test page)', url: 'http://testsafebrowsing.appspot.com/s/phishing.html', expected: 4 },
  { group: 'Known threat (Google test page)', url: 'http://testsafebrowsing.appspot.com/s/malware.html', expected: 4 },
  { group: 'Known threat (Google test page)', url: 'http://testsafebrowsing.appspot.com/s/unwanted.html', expected: 4 },
  { group: 'Known threat (Google test page)', url: 'http://testsafebrowsing.appspot.com/s/social_engineering_extended_report.html', expected: 4 },
  { group: 'Popular site', url: 'https://www.wikipedia.org/', expected: 1 },
  { group: 'Popular site', url: 'https://github.com/', expected: 1 },
  { group: 'Popular site', url: 'https://www.bbc.co.uk/news', expected: 1 },
  { group: 'Popular site', url: 'https://www.google.com/search?q=safescan&utm_source=qr', expected: 1 },
  { group: 'Suspicious pattern (made up, not registered)', url: 'http://192.168.4.20/bank/login', expected: 2 },
  { group: 'Suspicious pattern (made up, not registered)', url: 'https://paypal-secure-login.verify-account-update.xyz/signin', expected: 2 },
  { group: 'Suspicious pattern (made up, not registered)', url: 'https://xn--pple-43d.com/id/login', expected: 2 },
  { group: 'Suspicious pattern (made up, not registered)', url: 'http://login-microsoftonline.com.account-verify.top/', expected: 2 },
  { group: 'Community-reported', url: 'https://evil_site.com/', expected: 2 },
  { group: 'Not a web link', url: 'WIFI:S:CafeGuest;T:WPA;P:hunter22;;', expected: null },
  { group: 'Not a web link', url: 'javascript:alert(1)', expected: null },
];

async function scan(url) {
  const started = performance.now();
  const response = await fetch(new URL('scan', API), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Install-Id': INSTALL_ID },
    body: JSON.stringify({ url }),
  });
  const ms = Math.round(performance.now() - started);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ms, body };
}

const rows = [];
for (const testCase of CASES) {
  const first = await scan(testCase.url);
  const second = first.status === 200 ? await scan(testCase.url) : null;
  const level = first.status === 200 ? first.body.level : null;
  const pass = testCase.expected === null ? first.status === 400 : level === testCase.expected;
  rows.push({
    ...testCase,
    status: first.status,
    level,
    label: first.body.levelLabel ?? first.body.error ?? '',
    limited: first.body.limited ?? null,
    reasons: first.body.reasons ?? [],
    firstMs: first.ms,
    repeatMs: second?.ms ?? null,
    repeatCached: second?.body.cached ?? null,
    pass,
  });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${testCase.url}  -> ${first.status} ${level ?? ''} ${first.ms}ms`);
}

const passed = rows.filter((row) => row.pass).length;
const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const summary = {
  ranAt: new Date().toISOString(),
  api: API,
  passed,
  total: rows.length,
  medianFirstMs: median(rows.map((r) => r.firstMs)),
  medianRepeatMs: median(rows.map((r) => r.repeatMs)),
  repeatCacheHits: rows.filter((r) => r.repeatCached === true).length,
  repeats: rows.filter((r) => r.repeatMs !== null).length,
};

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ summary, rows }, null, 2));

const escape = (text) => String(text).replace(/\|/g, '\\|');
const md = [
  '# Scan evaluation results',
  '',
  `Run ${summary.ranAt} against \`${API}\` by \`docs/eval/evaluate-scan.mjs\`.`,
  '',
  `**${passed} of ${rows.length} cases matched the expected level.** Median latency: ${summary.medianFirstMs} ms on first scan, ${summary.medianRepeatMs} ms on repeat (${summary.repeatCacheHits} of ${summary.repeats} repeats served from the cache). Latency is measured from the test machine and includes its network.`,
  '',
  '| Group | Link | Expected | Got | First ms | Repeat ms | Cached | Result |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.group} | \`${escape(r.url)}\` | ${r.expected ?? '400'} | ${r.status === 200 ? `${r.level} ${escape(r.label)}` : `${r.status} ${escape(r.label)}`} | ${r.firstMs} | ${r.repeatMs ?? ''} | ${r.repeatCached ?? ''} | ${r.pass ? 'Pass' : '**Fail**'} |`),
  '',
  '## Reasons returned',
  '',
  ...rows.filter((r) => r.reasons.length).map((r) => `- \`${escape(r.url)}\`: ${r.reasons.join('; ')}`),
  '',
];
writeFileSync(new URL('./results.md', import.meta.url), md.join('\n'));
console.log(`\n${passed}/${rows.length} passed. Wrote docs/eval/results.md and results.json`);
