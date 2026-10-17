import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES, verdictRow, type VerdictRow } from './db';
import { CONFIG } from './config';
import { getParam, PARAMS } from './params';
import { checkReputation } from './reputation';

export interface Lookup {
  row?: VerdictRow; // undefined when no threat database could be consulted
  cached: boolean;
}

/** Reads a UrlVerdicts row, treating an expired row as missing */
export async function getFreshVerdict(urlHash: string, now = Date.now()): Promise<VerdictRow | undefined> {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLES.verdicts, Key: { urlHash } }));
  const row = Item as VerdictRow | undefined;
  return row && row.expiresAt > now ? row : undefined;
}

/**
 * Cache first (this also covers community-verified and feed rows), then Safe Browsing on a miss.
 * Safe Browsing failures return no row, so the caller gives a heuristics-only result.
 */
export async function lookupVerdict(url: string, urlHash: string): Promise<Lookup> {
  const now = Date.now();
  const cached = await getFreshVerdict(urlHash, now);
  if (cached) return { row: cached, cached: true };

  let apiKey: string;
  try {
    apiKey = await getParam(PARAMS.safeBrowsingKey);
  } catch (err) {
    console.error('Safe Browsing key unavailable', err);
    return { cached: false };
  }

  const res = await checkReputation(url, apiKey);
  if (!res.ok) {
    console.warn(res.error);
    return { cached: false };
  }

  const row = verdictRow(
    {
      urlHash,
      url,
      verdict: res.match ? 'DANGEROUS' : 'SAFE',
      threatTypes: res.threatTypes,
      source: 'safebrowsing',
    },
    (res.match ? res.cacheSeconds : CONFIG.negativeTtlSeconds) * 1000,
    now
  );
  await ddb.send(new PutCommand({ TableName: TABLES.verdicts, Item: row }));
  return { row, cached: false };
}
