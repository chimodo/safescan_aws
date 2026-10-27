import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES, REPORT_INDEXES, type ReportRow, type UrlStatus } from './db';
import { getFreshVerdict } from './lookup';
import { ALLOWLIST, hostMatches } from './domainLists';

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

export async function setStatus(report: ReportRow, urlStatus: UrlStatus) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLES.reports,
      Key: { reportId: report.reportId },
      UpdateExpression: 'SET urlStatus = :s',
      ExpressionAttributeValues: { ':s': urlStatus },
    })
  );
}

/**
 * Maintainer review state for one URL's reports. This is separate from the verdict level:
 * community submissions and votes raise a link to level 2 or 3 (shared/verdict.ts decideLevel),
 * and only this path can make it level 4 through a community report.
 * - verified: a Safe Browsing or feed match, or maintainer approval (scripts/review.mts)
 * - corroborated: a second distinct reporter
 * - rejected: the domain is on the allowlist, or a maintainer rejected it
 * Votes and report counts never verify a URL by themselves.
 */
export async function evaluateUrl(urlHash: string, now = Date.now()): Promise<UrlStatus | undefined> {
  const active = (await reportsForUrl(urlHash)).filter((r) => r.urlStatus !== 'rejected');
  if (active.length === 0) return undefined;

  if (hostMatches(new URL(active[0].url).hostname, ALLOWLIST)) {
    await Promise.all(active.map((r) => setStatus(r, 'rejected')));
    return 'rejected';
  }

  const row = await getFreshVerdict(urlHash, now);
  const independentMatch = row?.verdict === 'DANGEROUS' && row.source !== 'community';

  let target: UrlStatus = independentMatch ? 'verified' : distinctReporters(active) >= 2 ? 'corroborated' : 'pending';
  // A new report joins whatever status the URL already reached (e.g. maintainer approval)
  for (const r of active) if (RANK[r.urlStatus] > RANK[target]) target = r.urlStatus;

  await Promise.all(active.filter((r) => RANK[target] > RANK[r.urlStatus]).map((r) => setStatus(r, target)));
  return target;
}
