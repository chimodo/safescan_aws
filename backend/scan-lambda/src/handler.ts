// POST /scan and POST /report, served from one Lambda function URL
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { normalizeUrl } from '../../../shared/normalizeUrl';
import { scoreHeuristics } from '../../../shared/heuristics';
import { decideVerdict, type ScanResponse } from '../../../shared/verdict';
import { ddb, TABLES, type ReportCategory, type ReportRow, type TamperWarning } from './db';
import { CONFIG } from './config';
import { sha256, hashIdentity, readInstallId } from './identity';
import { withinLimit } from './rateLimit';
import { lookupVerdict } from './lookup';

const json = (statusCode: number, body: unknown): LambdaFunctionURLResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function parseBody(event: LambdaFunctionURLEvent): Record<string, unknown> | null {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : event.body ?? '{}';
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

export const handler = async (event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> => {
  const { method } = event.requestContext.http;
  if (method === 'POST' && event.rawPath === '/scan') return handleScan(event);
  if (method === 'POST' && event.rawPath === '/report') return handleReport(event);
  return json(404, { error: 'Not found' });
};

async function handleScan(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const body = parseBody(event);
  if (!body) return json(400, { error: 'Body must be JSON' });
  const url = normalizeUrl(body.url);
  if (!url) return json(400, { error: 'Body must include a valid http(s) url' });

  // Fail open: the reserved-concurrency cap still bounds traffic if rate limiting is unavailable
  try {
    const installId = readInstallId(event.headers);
    const caller = installId
      ? await hashIdentity('install', installId)
      : await hashIdentity('ip', event.requestContext.http.sourceIp);
    if (!(await withinLimit('scan', caller, CONFIG.scansPerHour))) {
      return json(429, { error: 'Too many scans from this device. Try again within the hour.' });
    }
  } catch (err) {
    console.error('Rate limiting unavailable', err);
  }

  const urlHash = sha256(url); // never trust a hash sent by the client
  const { row, cached } = await lookupVerdict(url, urlHash);
  const heur = scoreHeuristics(url);
  const { verdict, score } = decideVerdict(row?.verdict === 'DANGEROUS', heur);

  const sourceReasons =
    row?.verdict !== 'DANGEROUS' ? []
    : row.source === 'community' ? ['Confirmed by SafeScan community reports']
    : row.source === 'feed' ? ['Listed in a public phishing feed']
    : row.threatTypes.map((t) => `Google Safe Browsing: ${t}`);

  const response: ScanResponse = {
    url,
    verdict,
    score,
    reasons: [...sourceReasons, ...heur.reasons],
    limited: !row,
    cached,
  };
  return json(200, response);
}

const CATEGORIES = new Set<ReportCategory>(['sticker', 'fake_login', 'payment_or_personal_info', 'other']);
const TAMPER = new Set<TamperWarning>(['none', 'possible', 'likely']);
const GEOHASH = /^[0-9b-hjkmnp-z]{5,12}$/;
const MAX_NOTE = 280;

async function handleReport(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const body = parseBody(event);
  if (!body) return json(400, { error: 'Body must be JSON' });

  const url = normalizeUrl(body.url);
  if (!url) return json(400, { error: 'Body must include a valid http(s) url' });
  const category = body.category as ReportCategory;
  if (!CATEGORIES.has(category)) {
    return json(400, { error: `category must be one of: ${[...CATEGORIES].join(', ')}` });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : undefined;
  if (note && note.length > MAX_NOTE) return json(400, { error: `note must be ${MAX_NOTE} characters or fewer` });
  const geohash = typeof body.geohash === 'string' ? body.geohash.toLowerCase() : undefined;
  if (geohash !== undefined && !GEOHASH.test(geohash)) return json(400, { error: 'geohash is not valid' });
  const tamperWarning = (body.tamperWarning ?? 'none') as TamperWarning;
  if (!TAMPER.has(tamperWarning)) return json(400, { error: 'tamperWarning must be none, possible or likely' });

  const installId = readInstallId(event.headers);
  if (!installId) return json(400, { error: 'X-Install-Id header is required to report' });

  // Fail closed: without the pepper we can't count distinct reporters safely
  let installIdHash: string;
  let ipHash: string;
  try {
    installIdHash = await hashIdentity('install', installId);
    ipHash = await hashIdentity('ip', event.requestContext.http.sourceIp);
  } catch (err) {
    console.error('Hash pepper unavailable', err);
    return json(503, { error: 'Reporting is temporarily unavailable' });
  }

  const allowed =
    (await withinLimit('report', installIdHash, CONFIG.reportsPerHour)) &&
    (await withinLimit('report', ipHash, CONFIG.reportsPerHour * 3)); // looser: carriers share IPs
  if (!allowed) return json(429, { error: 'Too many reports from this device. Try again within the hour.' });

  const urlHash = sha256(url);
  // Make sure UrlVerdicts has a Safe Browsing answer for the verifier to use as evidence
  await lookupVerdict(url, urlHash).catch((err) => console.warn('Lookup before report failed', err));

  const report: ReportRow = {
    reportId: randomUUID(),
    urlHash,
    url,
    category,
    note: note || undefined,
    geohash5: geohash?.slice(0, 5), // store only the ~5 km cell, never a finer location
    tamperWarning,
    urlStatus: 'pending',
    installIdHash,
    ipHash,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(
    new PutCommand({ TableName: TABLES.reports, Item: report, ConditionExpression: 'attribute_not_exists(reportId)' })
  );
  // Verification happens in the stream-triggered verifier, not here
  return json(202, { ok: true });
}
