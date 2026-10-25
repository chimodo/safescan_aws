import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES, REPORT_INDEXES, type ReportRow, type UrlStatus } from './db';
import { CONFIG } from './config';
import { getFreshVerdict } from './lookup';
import { ALLOWLIST, PROTECTED_DOMAINS, hostMatches } from './domainLists';
import { scoreHeuristics } from '../../../shared/heuristics';

const RANK: Record<UrlStatus, number> = { rejected: -1, pending: 0, corroborated: 1, verified: 2 };

export async function reportsForUrl(urlHash: string): Promise<ReportRow[]> {
  const items: ReportRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: TABLES.reports,
        IndexName: REPORT_INDEXES.byUrl,
        KeyConditionExpression: 'urlHash = :h',
        ExpressionAttributeValues: { ':h': urlHash },
        ExclusiveStartKey,
      })
    );
    items.push(...((page.Items ?? []) as ReportRow[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Distinct reporters count by install hash and by IP hash, whichever is lower */
function distinctReporters(reports: ReportRow[]): number {
  return Math.min(
    new Set(reports.map((r) => r.installIdHash)).size,
    new Set(reports.map((r) => r.ipHash)).size
  );
}

export async function setStatus(report: ReportRow, urlStatus: UrlStatus, needsReview?: boolean) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLES.reports,
      Key: { reportId: report.reportId },
      UpdateExpression: needsReview === undefined ? 'SET urlStatus = :s' : 'SET urlStatus = :s, needsReview = :r',
      ExpressionAttributeValues: needsReview === undefined ? { ':s': urlStatus } : { ':s': urlStatus, ':r': needsReview },
    })
  );
}

/**
 * Applies the design's verification states to every report for one URL.
 * - verified: a Safe Browsing or feed match, or N distinct reporters within W plus heuristic score >= T
 * - corroborated: a second distinct reporter
 * - rejected: the domain is on the allowlist
 * Popular (protected) domains never auto-verify on votes; they're flagged for manual review.
 * Statuses only move up here; only maintainers move a URL down (scripts/review.mts).
 */
export async function evaluateUrl(urlHash: string, now = Date.now()): Promise<UrlStatus | undefined> {
  const active = (await reportsForUrl(urlHash)).filter((r) => r.urlStatus !== 'rejected');
  if (active.length === 0) return undefined;

  const url = active[0].url;
  const host = new URL(url).hostname;

  if (hostMatches(host, ALLOWLIST)) {
    await Promise.all(active.map((r) => setStatus(r, 'rejected')));
    return 'rejected';
  }

  const row = await getFreshVerdict(urlHash, now);
  const independentMatch = row?.verdict === 'DANGEROUS' && row.source !== 'community';

  const since = new Date(now - CONFIG.verifyWindowMs).toISOString();
  const recentReporters = distinctReporters(active.filter((r) => r.createdAt >= since));
  const votesMet =
    recentReporters >= CONFIG.verifyReporters && scoreHeuristics(url).score >= CONFIG.verifyHeuristicScore;
  const isProtected = hostMatches(host, PROTECTED_DOMAINS);

  let target: UrlStatus = 'pending';
  if (independentMatch || (votesMet && !isProtected)) target = 'verified';
  else if (distinctReporters(active) >= 2) target = 'corroborated';

  // A new report joins whatever status the URL already reached (e.g. maintainer approval)
  for (const r of active) if (RANK[r.urlStatus] > RANK[target]) target = r.urlStatus;

  const needsReview = target !== 'verified' && votesMet && isProtected;
  await Promise.all(
    active
      .filter((r) => RANK[target] > RANK[r.urlStatus] || Boolean(r.needsReview) !== needsReview)
      .map((r) => setStatus(r, RANK[target] > RANK[r.urlStatus] ? target : r.urlStatus, needsReview))
  );
  return target;
}
