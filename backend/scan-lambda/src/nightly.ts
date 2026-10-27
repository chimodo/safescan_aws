// Nightly job, run by EventBridge Scheduler:
// 1. load OpenPhish and URLhaus into UrlVerdicts (source: feed)
// 2. re-check open reports, since a new feed entry can verify them
// 3. count reports per geohash5 cell into HotspotAggregates
// 4. commit the public hotspot and verified-threat files to GitHub Pages
import { PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { normalizeUrl } from '../../../shared/normalizeUrl';
import { ddb, TABLES, REPORT_INDEXES, verdictRow, type ReportRow, type UrlStatus } from './db';
import { CONFIG } from './config';
import { sha256 } from './identity';
import { evaluateUrl } from './verification';
import { getParam, PARAMS } from './params';
import { putFile } from './github';

// Check each feed's terms before relying on it; abuse.ch may require an Auth-Key for downloads
const FEEDS = [
  { name: 'openphish', url: 'https://openphish.com/feed.txt' },
  { name: 'urlhaus', url: 'https://urlhaus.abuse.ch/downloads/text_online/' },
];

export const handler = async () => {
  const feeds = await ingestFeeds();
  const reevaluated = await reevaluateOpenReports();
  const { cells, campaigns } = await buildHotspots();
  const threats = await buildThreatExport();
  const published = await publish(cells, campaigns, threats);

  const summary = { feeds, reevaluated, cells: cells.length, campaigns: campaigns.length, threats: threats.length, published };
  console.log(JSON.stringify(summary));
  return summary;
};

/** Runs fn over items with a small fixed concurrency */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function ingestFeeds(): Promise<Record<string, number | string>> {
  const result: Record<string, number | string> = {};
  const entries = new Map<string, { url: string; feed: string }>();

  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let count = 0;
      for (const line of (await res.text()).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const url = normalizeUrl(trimmed);
        if (!url) continue;
        const urlHash = sha256(url);
        if (!entries.has(urlHash)) entries.set(urlHash, { url, feed: feed.name });
        count++;
      }
      result[feed.name] = count;
    } catch (err) {
      console.error(`Feed ${feed.name} failed`, err);
      result[feed.name] = `failed: ${(err as Error).message}`;
    }
  }

  const toWrite = [...entries].slice(0, CONFIG.maxFeedUrls);
  if (entries.size > toWrite.length) console.warn(`Feed capped at ${toWrite.length} of ${entries.size} URLs`);

  const now = Date.now();
  let written = 0;
  await pool(toWrite, 4, async ([urlHash, { url, feed }]) => {
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLES.verdicts,
          Item: verdictRow(
            { urlHash, url, verdict: 'DANGEROUS', threatTypes: [`FEED_${feed.toUpperCase()}`], source: 'feed' },
            CONFIG.feedVerdictMs,
            now
          ),
          // Don't replace a community verdict, which lasts longer
          ConditionExpression: 'attribute_not_exists(urlHash) OR #source <> :community',
          ExpressionAttributeNames: { '#source': 'source' },
          ExpressionAttributeValues: { ':community': 'community' },
        })
      );
      written++;
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
    }
  });
  result.written = written;
  return result;
}

async function reportsWithStatus(status: UrlStatus): Promise<ReportRow[]> {
  const items: ReportRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: TABLES.reports,
        IndexName: REPORT_INDEXES.byStatus,
        KeyConditionExpression: 'urlStatus = :s',
        ExpressionAttributeValues: { ':s': status },
        ExclusiveStartKey,
      })
    );
    items.push(...((page.Items ?? []) as ReportRow[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function reevaluateOpenReports(): Promise<number> {
  const open = [...(await reportsWithStatus('pending')), ...(await reportsWithStatus('corroborated'))];
  const hashes = [...new Set(open.map((r) => r.urlHash))];
  await pool(hashes, 2, async (h) => {
    await evaluateUrl(h);
  });
  return hashes.length;
}

interface PublicCell {
  geohash5: string;
  reportCount: number;
  tamperCount: number;
  distinctUrls: number;
  lastSeen: string;
  tamperingHotspot: boolean; // repeated tamper warnings with changing URLs
}

async function buildHotspots(): Promise<{ cells: PublicCell[]; campaigns: { url: string; cellCount: number }[] }> {
  const since = new Date(Date.now() - CONFIG.hotspotWindowMs).toISOString();
  const reports: Pick<ReportRow, 'geohash5' | 'urlHash' | 'url' | 'tamperWarning' | 'urlStatus' | 'createdAt'>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: TABLES.reports,
        ProjectionExpression: 'geohash5, urlHash, #url, tamperWarning, urlStatus, createdAt',
        FilterExpression: 'attribute_exists(geohash5) AND createdAt >= :since AND urlStatus <> :rejected',
        ExpressionAttributeNames: { '#url': 'url' },
        ExpressionAttributeValues: { ':since': since, ':rejected': 'rejected' },
        ExclusiveStartKey,
      })
    );
    reports.push(...((page.Items ?? []) as typeof reports));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const cells = new Map<string, { reportCount: number; tamperCount: number; urls: Set<string>; lastSeen: string }>();
  const verifiedCells = new Map<string, { url: string; cells: Set<string> }>();

  for (const r of reports) {
    const cell = cells.get(r.geohash5!) ?? { reportCount: 0, tamperCount: 0, urls: new Set(), lastSeen: '' };
    cell.reportCount++;
    if (r.tamperWarning === 'possible' || r.tamperWarning === 'likely') cell.tamperCount++;
    cell.urls.add(r.urlHash);
    if (r.createdAt > cell.lastSeen) cell.lastSeen = r.createdAt;
    cells.set(r.geohash5!, cell);

    if (r.urlStatus === 'verified') {
      const v = verifiedCells.get(r.urlHash) ?? { url: r.url, cells: new Set() };
      v.cells.add(r.geohash5!);
      verifiedCells.set(r.urlHash, v);
    }
  }

  const ttl = Math.floor(Date.now() / 1000) + 3 * 86400; // stale cells disappear if no longer counted
  await pool([...cells], 2, async ([geohash5, c]) => {
    await ddb.send(
      new PutCommand({
        TableName: TABLES.hotspots,
        Item: {
          geohash5,
          reportCount: c.reportCount,
          tamperCount: c.tamperCount,
          distinctUrls: c.urls.size,
          lastSeen: c.lastSeen,
          ttl,
        },
      })
    );
  });

  // A cell is public only once it has enough reports that it can't point to one person
  const publicCells: PublicCell[] = [...cells]
    .filter(([, c]) => c.reportCount >= CONFIG.minHotspotReports)
    .map(([geohash5, c]) => ({
      geohash5,
      reportCount: c.reportCount,
      tamperCount: c.tamperCount,
      distinctUrls: c.urls.size,
      lastSeen: c.lastSeen.slice(0, 10),
      tamperingHotspot: c.tamperCount >= 2 && c.urls.size >= 2,
    }))
    .sort((a, b) => a.geohash5.localeCompare(b.geohash5));

  const campaigns = [...verifiedCells.values()]
    .filter((v) => v.cells.size >= CONFIG.campaignMinCells)
    .map((v) => ({ url: v.url, cellCount: v.cells.size }))
    .sort((a, b) => b.cellCount - a.cellCount);

  return { cells: publicCells, campaigns };
}

/** Verified entries only: URL, category, status, first and last seen. No notes, hashes or locations. */
async function buildThreatExport() {
  const byUrl = new Map<string, { url: string; categories: Map<string, number>; firstSeen: string; lastSeen: string }>();
  for (const r of await reportsWithStatus('verified')) {
    const e = byUrl.get(r.urlHash) ?? { url: r.url, categories: new Map(), firstSeen: r.createdAt, lastSeen: r.createdAt };
    const category = r.threatType ?? r.category ?? 'other';
    e.categories.set(category, (e.categories.get(category) ?? 0) + 1);
    if (r.createdAt < e.firstSeen) e.firstSeen = r.createdAt;
    if (r.createdAt > e.lastSeen) e.lastSeen = r.createdAt;
    byUrl.set(r.urlHash, e);
  }
  return [...byUrl.values()]
    .map((e) => ({
      url: e.url,
      category: [...e.categories].sort((a, b) => b[1] - a[1])[0][0],
      status: 'verified' as const,
      firstSeen: e.firstSeen.slice(0, 10),
      lastSeen: e.lastSeen.slice(0, 10),
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.url.localeCompare(b.url));
}

async function publish(
  cells: PublicCell[],
  campaigns: { url: string; cellCount: number }[],
  threats: Awaited<ReturnType<typeof buildThreatExport>>
): Promise<Record<string, string>> {
  // Off until the team has GitHub Pages ready; turn on with `cdk deploy -c publish=true`
  if (process.env.PUBLISH_ENABLED !== 'true') return { skipped: 'publishing disabled' };
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH ?? 'main';
  const dir = process.env.GITHUB_DATA_DIR ?? 'docs/data';
  if (!repo) return { skipped: 'GITHUB_REPO not set' };

  let token: string;
  try {
    token = await getParam(PARAMS.githubToken);
  } catch (err) {
    console.error('GitHub token unavailable, skipping publish', err);
    return { skipped: 'no GitHub token in SSM' };
  }

  const files = {
    'hotspots.json': JSON.stringify({ cells, campaigns }, null, 1) + '\n',
    'threats.json': JSON.stringify({ threats }, null, 1) + '\n',
  };
  // A GitHub failure is logged, not thrown: the feed and hotspot work above is already saved,
  // and failing the run would make the scheduler retry the whole job
  const result: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    try {
      result[name] = await putFile({
        token,
        repo,
        branch,
        path: `${dir}/${name}`,
        content,
        message: `Nightly data update: ${name}`,
      });
    } catch (err) {
      console.error(`Publishing ${name} failed`, err);
      result[name] = `failed: ${(err as Error).message}`;
    }
  }
  return result;
}
