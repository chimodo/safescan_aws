// Maintainer tools for community submissions. Uses your local AWS credentials.
//
//   node scripts/review.mts recent [n]          newest submissions (visible and hidden), with their ids
//   node scripts/review.mts hide <reportId>     hide a submission; it stops counting toward the link's level
//   node scripts/review.mts unhide <reportId>   show it again
//   node scripts/review.mts list                links awaiting review, grouped, with their evidence
//   node scripts/review.mts approve <urlHash>   confirm a link is malicious: it becomes "Likely malicious" (level 4)
//   node scripts/review.mts reject <urlHash>    reject the reports for a link
//   node scripts/review.mts shots                screenshots waiting for review, with 1-hour viewing links
//   node scripts/review.mts approve-shot <reportId> <slot>   show a screenshot on the link page
//   node scripts/review.mts reject-shot <reportId> <slot>    delete a screenshot
//
// Approving or rejecting a link fires the stream verifier, which updates UrlVerdicts.
// Before approving a screenshot, check it shows no one's name, email address or ID.
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const STACK = process.env.SAFESCAN_STACK ?? 'InfraStack';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function tableNames() {
  const { Stacks } = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: STACK }));
  const out = Object.fromEntries((Stacks?.[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
  if (!out.ReportsTable || !out.UrlVerdictsTable || !out.CommunityTable) {
    throw new Error(`Stack ${STACK} is missing table outputs; deploy the latest stack first`);
  }
  return {
    reports: out.ReportsTable as string,
    verdicts: out.UrlVerdictsTable as string,
    community: out.CommunityTable as string,
    screenshots: out.ScreenshotsBucket as string | undefined,
  };
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

const oneLine = (s: string | undefined, max = 90) => (s ?? '').replace(/\s+/g, ' ').slice(0, max);

async function recent(n: number) {
  const t = await tableNames();
  // Hidden submissions aren't in the visibility index, so read the table; fine at review-script volumes
  const items: Record<string, any>[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: t.reports, FilterExpression: 'attribute_exists(#v)', ExpressionAttributeNames: { '#v': 'visibility' }, ExclusiveStartKey })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (items.length === 0) return console.log('No community submissions yet.');
  for (const r of items.slice(0, n)) {
    console.log(`\n${r.reportId}  ${r.visibility.toUpperCase()}  ${r.threatType ?? r.category}  ${r.helpfulVotes ?? 0} votes  ${r.createdAt}`);
    console.log(`  ${r.url}`);
    if (r.details) console.log(`  "${oneLine(r.details)}"`);
  }
}

async function setVisibility(reportId: string, visible: boolean) {
  const t = await tableNames();
  const { Item: r } = await ddb.send(new GetCommand({ TableName: t.reports, Key: { reportId } }));
  if (!r) throw new Error(`No submission ${reportId}`);
  if (!r.visibility) throw new Error(`${reportId} is a report from before the community features; it isn't shown publicly`);
  const target = visible ? 'visible' : 'hidden';
  if (r.visibility === target) return console.log(`${reportId} is already ${target}.`);

  // Hiding removes the submission and its votes from the link's counts; showing adds them back
  const sign = visible ? 1 : -1;
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: t.reports,
              Key: { reportId },
              UpdateExpression: 'SET #v = :target, reviewedAt = :now',
              ConditionExpression: '#v = :current',
              ExpressionAttributeNames: { '#v': 'visibility' },
              ExpressionAttributeValues: { ':target': target, ':current': r.visibility, ':now': new Date().toISOString() },
            },
          },
          {
            Update: {
              TableName: t.community,
              Key: { pk: `link#${r.urlHash}` },
              UpdateExpression: 'ADD #s :ds, #votes :dv',
              ExpressionAttributeNames: { '#s': 'submissions', '#votes': 'votes' },
              ExpressionAttributeValues: { ':ds': sign, ':dv': sign * (r.helpfulVotes ?? 0) },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) throw new Error(`${reportId} changed while updating; run the command again`);
    throw err;
  }
  console.log(`${reportId} is now ${target}. ${r.url}`);
}

async function list() {
  const t = await tableNames();
  const open = [
    ...(await query(t.reports, 'byStatus', 'urlStatus', 'pending')),
    ...(await query(t.reports, 'byStatus', 'urlStatus', 'corroborated')),
  ];
  const groups = new Map<string, Record<string, any>[]>();
  for (const r of open) groups.set(r.urlHash, [...(groups.get(r.urlHash) ?? []), r]);

  if (groups.size === 0) return console.log('No links awaiting review.');
  for (const [urlHash, reports] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const { Item: verdict } = await ddb.send(new GetCommand({ TableName: t.verdicts, Key: { urlHash } }));
    const { Item: stats } = await ddb.send(new GetCommand({ TableName: t.community, Key: { pk: `link#${urlHash}` } }));
    const installs = new Set(reports.map((r) => r.installIdHash)).size;
    const ips = new Set(reports.map((r) => r.ipHash)).size;
    console.log(`\n${reports[0].url}`);
    console.log(`  urlHash      ${urlHash}`);
    console.log(`  status       ${reports[0].urlStatus}`);
    console.log(`  reporters    ${reports.length} reports, ${installs} installs, ${ips} IPs`);
    console.log(`  community    ${stats?.submissions ?? 0} visible submissions, ${stats?.votes ?? 0} helpful votes`);
    console.log(`  types        ${[...new Set(reports.map((r) => r.threatType ?? r.category))].join(', ')}`);
    console.log(`  cached       ${verdict ? `${verdict.verdict} via ${verdict.source}` : 'none'}`);
    for (const r of reports.filter((r) => r.details ?? r.note).slice(0, 3)) console.log(`  details      "${oneLine(r.details ?? r.note)}"`);
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

const s3 = new S3Client({});

async function shotsTables() {
  const t = await tableNames();
  if (!t.screenshots) throw new Error(`Stack ${STACK} has no ScreenshotsBucket output; deploy the latest stack first`);
  return t as typeof t & { screenshots: string };
}

async function shots() {
  const t = await shotsTables();
  const items: Record<string, any>[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: t.reports, FilterExpression: 'attribute_exists(screenshots)', ExclusiveStartKey })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  let count = 0;
  for (const r of items) {
    for (const s of r.screenshots as Record<string, any>[]) {
      if (s.status !== 'pending') continue;
      count++;
      const link = await getSignedUrl(s3, new GetObjectCommand({ Bucket: t.screenshots, Key: s.key, ResponseContentType: s.contentType }), {
        expiresIn: 3600,
      });
      console.log(`\n${r.reportId} slot ${s.slot}  ${s.contentType} ${s.width}x${s.height}  (${r.visibility}, ${r.url})`);
      console.log(`  ${link}`);
    }
  }
  console.log(count ? `\n${count} screenshot(s) waiting. Check each shows no one's name, email address or ID.` : 'No screenshots waiting for review.');
}

async function reviewShot(reportId: string, slot: number, approve: boolean) {
  const t = await shotsTables();
  const { Item: r } = await ddb.send(new GetCommand({ TableName: t.reports, Key: { reportId } }));
  const shot = r?.screenshots?.[slot];
  if (!shot) throw new Error(`No screenshot ${slot} on ${reportId}`);
  if (shot.status !== 'pending') throw new Error(`Screenshot ${slot} on ${reportId} is ${shot.status}, not pending`);

  let key: string | undefined;
  if (approve) {
    key = String(shot.key).replace(/^pending\//, 'approved/');
    await s3.send(new CopyObjectCommand({ Bucket: t.screenshots, Key: key, CopySource: `${t.screenshots}/${shot.key}`, ContentType: shot.contentType, MetadataDirective: 'REPLACE' }));
  }
  await s3.send(new DeleteObjectCommand({ Bucket: t.screenshots, Key: shot.key }));
  await ddb.send(
    new UpdateCommand({
      TableName: t.reports,
      Key: { reportId },
      UpdateExpression: `SET #shots[${slot}].#status = :status, #shots[${slot}].#key = :key, reviewedAt = :now`,
      ConditionExpression: `#shots[${slot}].#status = :pending`,
      ExpressionAttributeNames: { '#shots': 'screenshots', '#status': 'status', '#key': 'key' },
      ExpressionAttributeValues: { ':status': approve ? 'approved' : 'rejected', ':key': key ?? null, ':pending': 'pending', ':now': new Date().toISOString() },
    })
  );
  console.log(`Screenshot ${slot} on ${reportId} ${approve ? 'approved; it now shows on the link page' : 'rejected and deleted'}.`);
}

const [command, arg, arg2] = process.argv.slice(2);
if (command === 'shots') await shots();
else if ((command === 'approve-shot' || command === 'reject-shot') && arg && /^[0-9]$/.test(arg2 ?? '')) {
  await reviewShot(arg, Number(arg2), command === 'approve-shot');
} else if (command === 'recent') await recent(Number(arg) || 20);
else if ((command === 'hide' || command === 'unhide') && arg) await setVisibility(arg, command === 'unhide');
else if (command === 'list') await list();
else if ((command === 'approve' || command === 'reject') && arg) await setAll(arg, command === 'approve' ? 'verified' : 'rejected');
else {
  console.log(
    'Usage: node scripts/review.mts recent [n] | hide <reportId> | unhide <reportId> | list | approve <urlHash> | reject <urlHash>\n' +
      '                               shots | approve-shot <reportId> <slot> | reject-shot <reportId> <slot>'
  );
  process.exitCode = 1;
}
