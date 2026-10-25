// Maintainer review of community reports. Uses your local AWS credentials.
//
//   node scripts/review.mts list               open reports grouped by URL, with their evidence
//   node scripts/review.mts approve <urlHash>  mark every report for the URL verified
//   node scripts/review.mts reject <urlHash>   mark every report for the URL rejected
//
// Approving or rejecting fires the stream verifier, which updates UrlVerdicts.
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const STACK = process.env.SAFESCAN_STACK ?? 'InfraStack';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function tableNames() {
  const { Stacks } = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: STACK }));
  const out = Object.fromEntries((Stacks?.[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
  if (!out.ReportsTable || !out.UrlVerdictsTable) throw new Error(`Stack ${STACK} has no table outputs; deploy it first`);
  return { reports: out.ReportsTable as string, verdicts: out.UrlVerdictsTable as string };
}

async function query(table: string, index: string, key: string, value: string) {
  const items: Record<string, any>[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: index,
        KeyConditionExpression: '#k = :v',
        ExpressionAttributeNames: { '#k': key },
        ExpressionAttributeValues: { ':v': value },
        ExclusiveStartKey,
      })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function list() {
  const t = await tableNames();
  const open = [
    ...(await query(t.reports, 'byStatus', 'urlStatus', 'pending')),
    ...(await query(t.reports, 'byStatus', 'urlStatus', 'corroborated')),
  ];
  const groups = new Map<string, Record<string, any>[]>();
  for (const r of open) groups.set(r.urlHash, [...(groups.get(r.urlHash) ?? []), r]);

  if (groups.size === 0) return console.log('No open reports.');
  for (const [urlHash, reports] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const { Item: verdict } = await ddb.send(new GetCommand({ TableName: t.verdicts, Key: { urlHash } }));
    const installs = new Set(reports.map((r) => r.installIdHash)).size;
    const ips = new Set(reports.map((r) => r.ipHash)).size;
    console.log(`\n${reports[0].url}`);
    console.log(`  urlHash      ${urlHash}`);
    console.log(`  status       ${reports[0].urlStatus}${reports.some((r) => r.needsReview) ? '  (NEEDS REVIEW: popular domain)' : ''}`);
    console.log(`  reporters    ${reports.length} reports, ${installs} installs, ${ips} IPs`);
    console.log(`  categories   ${[...new Set(reports.map((r) => r.category))].join(', ')}`);
    console.log(`  cached       ${verdict ? `${verdict.verdict} via ${verdict.source}` : 'none'}`);
    for (const r of reports.filter((r) => r.note).slice(0, 3)) console.log(`  note         "${r.note}"`);
  }
}

async function setAll(urlHash: string, status: 'verified' | 'rejected') {
  const t = await tableNames();
  const reports = await query(t.reports, 'byUrl', 'urlHash', urlHash);
  if (reports.length === 0) throw new Error(`No reports for ${urlHash}`);
  for (const r of reports) {
    await ddb.send(
      new UpdateCommand({
        TableName: t.reports,
        Key: { reportId: r.reportId },
        UpdateExpression: 'SET urlStatus = :s, needsReview = :f, reviewedAt = :now',
        ExpressionAttributeValues: { ':s': status, ':f': false, ':now': new Date().toISOString() },
      })
    );
  }
  console.log(`${reports.length} report(s) for ${reports[0].url} set to ${status}.`);
}

const [command, arg] = process.argv.slice(2);
if (command === 'list') await list();
else if ((command === 'approve' || command === 'reject') && arg) await setAll(arg, command === 'approve' ? 'verified' : 'rejected');
else {
  console.log('Usage: node scripts/review.mts list | approve <urlHash> | reject <urlHash>');
  process.exitCode = 1;
}
