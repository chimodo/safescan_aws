// Community submissions, helpful votes and per-link counts.
//
// The Community table holds two kinds of item, keyed by `pk`:
//   link#<urlHash>                  submissions and votes counts for one link (read on every scan)
//   vote#<reportId>#<voterHash>     one record per vote, so nobody votes twice
// Counts change in the same transaction as the submission or vote, so they can't drift.
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { THREAT_TYPES } from '../../../shared/community';
import { ddb, TABLES, REPORT_INDEXES, type ReportRow } from './db';
import { reportsForUrl } from './verification';

const linkKey = (urlHash: string) => `link#${urlHash}`;
const voteKey = (reportId: string, voterHash: string) => `vote#${reportId}#${voterHash}`;

export interface LinkStats {
  submissions: number; // visible submissions
  votes: number; // helpful votes across those submissions
  url?: string;
}

export async function getLinkStats(urlHash: string): Promise<LinkStats> {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLES.community, Key: { pk: linkKey(urlHash) } }));
  return { submissions: Item?.submissions ?? 0, votes: Item?.votes ?? 0, url: Item?.url };
}

export async function getReport(reportId: string): Promise<ReportRow | undefined> {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLES.reports, Key: { reportId } }));
  return Item as ReportRow | undefined;
}

/** Saves a visible submission and counts it toward its link */
export async function createSubmission(report: ReportRow): Promise<void> {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLES.reports,
            Item: report,
            ConditionExpression: 'attribute_not_exists(reportId)',
          },
        },
        {
          Update: {
            TableName: TABLES.community,
            Key: { pk: linkKey(report.urlHash) },
            UpdateExpression: 'ADD #submissions :one SET #urlHash = :hash, #url = if_not_exists(#url, :url), #updatedAt = :now',
            ExpressionAttributeNames: { '#submissions': 'submissions', '#urlHash': 'urlHash', '#url': 'url', '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: { ':one': 1, ':hash': report.urlHash, ':url': report.url, ':now': report.createdAt },
          },
        },
      ],
    })
  );
}

export type VoteResult = 'ok' | 'already_voted' | 'not_visible';

/** One helpful vote: the vote record, the submission's count and the link's count change together or not at all */
export async function addVote(report: ReportRow, voterHash: string): Promise<VoteResult> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLES.community,
              Item: { pk: voteKey(report.reportId, voterHash), reportId: report.reportId, urlHash: report.urlHash, createdAt: now },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Update: {
              TableName: TABLES.reports,
              Key: { reportId: report.reportId },
              UpdateExpression: 'ADD #helpful :one',
              ConditionExpression: '#visibility = :visible',
              ExpressionAttributeNames: { '#helpful': 'helpfulVotes', '#visibility': 'visibility' },
              ExpressionAttributeValues: { ':one': 1, ':visible': 'visible' },
            },
          },
          {
            Update: {
              TableName: TABLES.community,
              Key: { pk: linkKey(report.urlHash) },
              UpdateExpression: 'ADD #votes :one SET #updatedAt = :now',
              ExpressionAttributeNames: { '#votes': 'votes', '#updatedAt': 'updatedAt' },
              ExpressionAttributeValues: { ':one': 1, ':now': now },
            },
          },
        ],
      })
    );
    return 'ok';
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const codes = err.CancellationReasons?.map((r) => r.Code);
      if (codes?.[0] === 'ConditionalCheckFailed') return 'already_voted';
      if (codes?.[1] === 'ConditionalCheckFailed') return 'not_visible';
    }
    throw err;
  }
}

export async function visibleSubmissionsForUrl(urlHash: string): Promise<ReportRow[]> {
  return (await reportsForUrl(urlHash)).filter((r) => r.visibility === 'visible');
}

/** Newest visible submissions across all links, for the community home page */
export async function recentSubmissions(limit: number): Promise<ReportRow[]> {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.reports,
      IndexName: REPORT_INDEXES.byVisibility,
      KeyConditionExpression: '#visibility = :visible',
      ExpressionAttributeNames: { '#visibility': 'visibility' },
      ExpressionAttributeValues: { ':visible': 'visible' },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  return (Items ?? []) as ReportRow[];
}

/**
 * What the public API shows of a submission. Never the install, voter or IP hashes.
 * Details are plain text: the page must escape them, never insert them as HTML.
 */
export function publicSubmission(report: ReportRow, callerHash?: string) {
  const threatType = report.threatType ?? 'other';
  return {
    reportId: report.reportId,
    threatType,
    threatLabel: THREAT_TYPES[threatType],
    details: report.details ?? '',
    tamperWarning: report.tamperWarning,
    helpfulVotes: report.helpfulVotes ?? 0,
    createdAt: report.createdAt,
    /** Lets the page disable the Helpful button on the caller's own submissions */
    isYours: callerHash !== undefined && report.installIdHash === callerHash,
  };
}
