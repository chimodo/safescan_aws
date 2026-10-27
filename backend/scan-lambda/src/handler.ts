// SafeScan API, served from one Lambda function URL. Contract: backend/scan-lambda/API.md
//   POST /scan          verdict for a scanned link
//   POST /report        share a link with the community (human check required)
//   POST /vote          mark a submission helpful (human check required)
//   GET  /link/{hash}   a link's verdict level, counts and visible submissions
//   GET  /recent        newest visible submissions, for the community home page
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { normalizeUrl } from '../../../shared/normalizeUrl';
import { scoreHeuristics } from '../../../shared/heuristics';
import { decideLevel, type ScanResponse } from '../../../shared/verdict';
import {
  DETAILS_MAX_LENGTH,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_MAX_COUNT,
  SCREENSHOT_TYPES,
  TAMPER_WARNINGS,
  THREAT_TYPES,
  isScreenshotType,
  isThreatType,
  type TamperWarning,
} from '../../../shared/community';
import { approvedScreenshotLinks, uploadSlot } from './screenshots';
import { ddb, TABLES, type ReportRow, type VerdictRow } from './db';
import { CONFIG } from './config';
import { sha256, hashIdentity, readInstallId } from './identity';
import { withinLimit } from './rateLimit';
import { lookupVerdict } from './lookup';
import { verifyCaptcha } from './captcha';
import { PROTECTED_DOMAINS, hostMatches } from './domainLists';
import {
  addVote,
  createSubmission,
  getLinkStats,
  getReport,
  publicSubmission,
  recentSubmissions,
  visibleSubmissionsForUrl,
  type LinkStats,
} from './community';

const json = (statusCode: number, body: unknown): LambdaFunctionURLResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const LINK_PATH = /^\/link\/([0-9a-f]{64})$/;
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Control characters other than tab and newline
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const handler = async (event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> => {
  const { method } = event.requestContext.http;
  const path = event.rawPath;
  try {
    if (method === 'POST' && path === '/scan') return await handleScan(event);
    if (method === 'POST' && path === '/report') return await handleReport(event);
    if (method === 'POST' && path === '/vote') return await handleVote(event);
    if (method === 'GET' && path === '/recent') return await handleRecent(event);
    const link = method === 'GET' ? LINK_PATH.exec(path) : null;
    if (link) return await handleLink(event, link[1]);
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error('Unhandled error', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};

function parseBody(event: LambdaFunctionURLEvent): Record<string, unknown> | null {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : event.body ?? '{}';
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const sourceIp = (event: LambdaFunctionURLEvent) => event.requestContext.http.sourceIp;

/** Everything that decides a link's level: threat databases, heuristics and community activity */
async function assessLink(url: string, urlHash: string, knownStats?: LinkStats) {
  const [{ row, cached }, stats] = await Promise.all([
    lookupVerdict(url, urlHash),
    knownStats
      ? Promise.resolve(knownStats)
      : getLinkStats(urlHash).catch((err) => {
          console.warn('Community counts unavailable', err);
          return { submissions: 0, votes: 0 } as LinkStats;
        }),
  ]);
  const heur = scoreHeuristics(url);
  const assessment = decideLevel(
    {
      knownThreat: row?.verdict === 'DANGEROUS',
      heuristics: heur,
      submissions: stats.submissions,
      votes: stats.votes,
      protectedDomain: hostMatches(new URL(url).hostname, PROTECTED_DOMAINS),
    },
    CONFIG.communityRule
  );

  const sourceReasons =
    row?.verdict !== 'DANGEROUS' ? []
    : row.source === 'community' ? ['Confirmed by SafeScan maintainers']
    : row.source === 'feed' ? ['Listed in a public phishing feed']
    : row.threatTypes.map((t) => `Google Safe Browsing: ${t}`);

  return {
    row,
    cached,
    stats,
    assessment,
    reasons: [...sourceReasons, ...assessment.communityReasons, ...heur.reasons],
  };
}

// ---- POST /scan ----

async function handleScan(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const body = parseBody(event);
  if (!body) return json(400, { error: 'Body must be a JSON object' });
  const url = normalizeUrl(body.url);
  if (!url) return json(400, { error: 'Body must include a valid http(s) url' });

  // Fail open: the concurrency cap still bounds traffic if rate limiting is unavailable
  try {
    const installId = readInstallId(event.headers);
    const caller = installId ? await hashIdentity('install', installId) : await hashIdentity('ip', sourceIp(event));
    if (!(await withinLimit('scan', caller, CONFIG.scansPerHour))) {
      return json(429, { error: 'Too many scans from this device. Try again within the hour.' });
    }
  } catch (err) {
    console.error('Rate limiting unavailable', err);
  }

  const urlHash = sha256(url); // never trust a hash sent by the client
  const { row, cached, stats, assessment, reasons } = await assessLink(url, urlHash);

  const response: ScanResponse = {
    url,
    verdict: assessment.verdict,
    score: assessment.score,
    reasons,
    limited: !row,
    cached,
    level: assessment.level,
    levelLabel: assessment.label,
    community: { submissions: stats.submissions, votes: stats.votes },
  };
  return json(200, response);
}

// ---- Shared by the write routes ----

type Caller = { installHash: string; ipHash: string };

/** Hashes the caller and checks the human-check token. Returns an error response, or the caller. */
async function authorizeWrite(
  event: LambdaFunctionURLEvent,
  body: Record<string, unknown>,
  action: 'report' | 'vote',
  perHour: number
): Promise<LambdaFunctionURLResult | Caller> {
  const installId = readInstallId(event.headers);
  if (!installId) return json(400, { error: 'X-Install-Id header is required' });

  // Fail closed: without the pepper we can't count reporters or voters safely
  let caller: Caller;
  try {
    caller = {
      installHash: await hashIdentity('install', installId),
      ipHash: await hashIdentity('ip', sourceIp(event)),
    };
  } catch (err) {
    console.error('Hash pepper unavailable', err);
    return json(503, { error: 'Sharing is temporarily unavailable' });
  }

  const allowed =
    (await withinLimit(action, caller.installHash, perHour)) &&
    (await withinLimit(action, caller.ipHash, perHour * 3)); // looser: carriers and schools share IPs
  if (!allowed) return json(429, { error: 'Too many requests from this device. Try again within the hour.' });

  const human = await verifyCaptcha(body.captchaToken, sourceIp(event));
  if (!human.ok) {
    if (human.reason === 'unavailable') return json(503, { error: 'The human check is temporarily unavailable' });
    return json(403, { error: 'The human check failed. Please try again.' });
  }
  return caller;
}

const isError = (value: LambdaFunctionURLResult | Caller): value is LambdaFunctionURLResult =>
  typeof value === 'object' && value !== null && 'statusCode' in value;

// ---- POST /report ----

async function handleReport(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const body = parseBody(event);
  if (!body) return json(400, { error: 'Body must be a JSON object' });

  const url = normalizeUrl(body.url);
  if (!url) return json(400, { error: 'Body must include a valid http(s) url' });
  if (!isThreatType(body.threatType)) {
    return json(400, { error: `threatType must be one of: ${Object.keys(THREAT_TYPES).join(', ')}` });
  }
  const details = typeof body.details === 'string' ? body.details.replace(CONTROL_CHARS, '').trim() : '';
  if (details.length > DETAILS_MAX_LENGTH) {
    return json(400, { error: `details must be ${DETAILS_MAX_LENGTH} characters or fewer` });
  }
  const tamperWarning = (body.tamperWarning ?? 'unchecked') as TamperWarning;
  if (!TAMPER_WARNINGS.includes(tamperWarning)) {
    return json(400, { error: `tamperWarning must be one of: ${TAMPER_WARNINGS.join(', ')}` });
  }
  // One entry per screenshot the client will upload, giving its type
  const screenshotTypes = body.screenshotTypes ?? [];
  if (
    !Array.isArray(screenshotTypes) ||
    screenshotTypes.length > SCREENSHOT_MAX_COUNT ||
    !screenshotTypes.every(isScreenshotType)
  ) {
    return json(400, {
      error: `screenshotTypes must list up to ${SCREENSHOT_MAX_COUNT} of: ${SCREENSHOT_TYPES.join(', ')}`,
    });
  }

  const caller = await authorizeWrite(event, body, 'report', CONFIG.reportsPerHour);
  if (isError(caller)) return caller;

  const urlHash = sha256(url);
  // Cache a Safe Browsing answer so maintainers and the verifier have evidence. Never fetches the link itself.
  await lookupVerdict(url, urlHash).catch((err) => console.warn('Lookup before report failed', err));

  const report: ReportRow = {
    reportId: randomUUID(),
    urlHash,
    url,
    threatType: body.threatType,
    details: details || undefined,
    tamperWarning,
    urlStatus: 'pending',
    visibility: 'visible',
    helpfulVotes: 0,
    screenshots: screenshotTypes.length
      ? screenshotTypes.map((contentType, slot) => ({ slot, status: 'awaiting_upload' as const, contentType }))
      : undefined,
    installIdHash: caller.installHash,
    ipHash: caller.ipHash,
    createdAt: new Date().toISOString(),
  };
  await createSubmission(report);

  // Upload straight to private storage, one slot per declared screenshot
  const uploads = await Promise.all(screenshotTypes.map((type, slot) => uploadSlot(report.reportId, slot, type)));
  return json(201, {
    ok: true,
    reportId: report.reportId,
    urlHash,
    linkPath: `/link/${urlHash}`,
    uploads,
    uploadRules: uploads.length ? { maxBytes: SCREENSHOT_MAX_BYTES, types: SCREENSHOT_TYPES } : undefined,
  });
}

// ---- POST /vote ----

async function handleVote(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const body = parseBody(event);
  if (!body) return json(400, { error: 'Body must be a JSON object' });
  const reportId = typeof body.reportId === 'string' ? body.reportId.toLowerCase() : '';
  if (!REPORT_ID.test(reportId)) return json(400, { error: 'reportId is not valid' });

  const caller = await authorizeWrite(event, body, 'vote', CONFIG.votesPerHour);
  if (isError(caller)) return caller;

  const report = await getReport(reportId);
  if (!report || report.visibility !== 'visible') return json(404, { error: 'Submission not found' });
  if (report.installIdHash === caller.installHash) {
    return json(403, { error: 'You can’t vote on your own submission.' });
  }

  const result = await addVote(report, caller.installHash);
  if (result === 'already_voted') return json(409, { error: 'You’ve already voted on this submission.' });
  if (result === 'not_visible') return json(404, { error: 'Submission not found' });
  return json(200, { ok: true, helpfulVotes: (report.helpfulVotes ?? 0) + 1 });
}

// ---- GET /link/{hash} ----

async function callerInstallHash(event: LambdaFunctionURLEvent): Promise<string | undefined> {
  const installId = readInstallId(event.headers);
  if (!installId) return undefined;
  return hashIdentity('install', installId).catch(() => undefined);
}

async function handleLink(event: LambdaFunctionURLEvent, urlHash: string): Promise<LambdaFunctionURLResult> {
  const stats = await getLinkStats(urlHash);
  // The link's address comes from a submission, or from the cache if it was only scanned
  let url = stats.url;
  if (!url) {
    const { Item } = await ddb.send(new GetCommand({ TableName: TABLES.verdicts, Key: { urlHash } }));
    url = (Item as VerdictRow | undefined)?.url;
  }
  if (!url) return json(404, { error: 'SafeScan has no record of this link yet' });

  const [{ row, assessment, reasons }, submissions, callerHash] = await Promise.all([
    assessLink(url, urlHash, stats),
    visibleSubmissionsForUrl(urlHash),
    callerInstallHash(event),
  ]);

  submissions.sort((a, b) => (b.helpfulVotes ?? 0) - (a.helpfulVotes ?? 0) || b.createdAt.localeCompare(a.createdAt));
  return json(200, {
    urlHash,
    url, // plain text: show it, never make it a clickable link
    level: assessment.level,
    levelLabel: assessment.label,
    verdict: assessment.verdict,
    score: assessment.score,
    reasons,
    limited: !row,
    counts: { submissions: stats.submissions, votes: stats.votes },
    submissions: await Promise.all(
      submissions.map(async (s) => ({
        ...publicSubmission(s, callerHash),
        // Only maintainer-approved images, as links that expire after 15 minutes
        screenshots: await approvedScreenshotLinks(s.screenshots),
      }))
    ),
  });
}

// ---- GET /recent ----

async function handleRecent(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const requested = Number(event.queryStringParameters?.limit ?? 20);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), CONFIG.maxRecent) : 20;
  const [items, callerHash] = await Promise.all([recentSubmissions(limit), callerInstallHash(event)]);
  return json(200, {
    submissions: items.map((s) => ({
      ...publicSubmission(s, callerHash),
      urlHash: s.urlHash,
      url: s.url, // plain text: show it, never make it a clickable link
      linkPath: `/link/${s.urlHash}`,
    })),
  });
}
