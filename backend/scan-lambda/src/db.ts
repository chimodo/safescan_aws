import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Adaptive retries back off when a provisioned table throttles,
// which matters on the small free-tier capacity.
export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ maxAttempts: 8, retryMode: 'adaptive' }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export const TABLES = {
  verdicts: process.env.TABLE_VERDICTS!,
  reports: process.env.TABLE_REPORTS!,
  hotspots: process.env.TABLE_HOTSPOTS!,
  rateLimits: process.env.TABLE_RATE_LIMITS!,
};

// Global secondary indexes on Reports (names must match the CDK stack)
export const REPORT_INDEXES = {
  byUrl: 'byUrl', // urlHash + createdAt
  byArea: 'byArea', // geohash5 + createdAt
  byStatus: 'byStatus', // urlStatus + createdAt
};

export type Verdict = 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';
export type VerdictSource = 'safebrowsing' | 'community' | 'feed';

/** One row of UrlVerdicts */
export interface VerdictRow {
  urlHash: string;
  url: string;
  verdict: Verdict;
  threatTypes: string[];
  source: VerdictSource;
  fetchedAt: number; // epoch ms
  expiresAt: number; // epoch ms; reads treat anything past this as a miss
  ttl: number; // epoch seconds; DynamoDB cleanup only
}

export type UrlStatus = 'pending' | 'corroborated' | 'verified' | 'rejected';
export type TamperWarning = 'none' | 'possible' | 'likely';
export type ReportCategory = 'sticker' | 'fake_login' | 'payment_or_personal_info' | 'other';

/** One row of Reports */
export interface ReportRow {
  reportId: string;
  urlHash: string;
  url: string;
  category: ReportCategory;
  note?: string;
  geohash5?: string;
  tamperWarning: TamperWarning;
  urlStatus: UrlStatus;
  needsReview?: boolean; // votes met the bar but the domain is on the protected list
  installIdHash: string;
  ipHash: string;
  createdAt: string; // ISO 8601, sorts correctly as a string
}

/** Build a UrlVerdicts row; ttl lags expiresAt by a day since it is cleanup only */
export function verdictRow(
  fields: Omit<VerdictRow, 'fetchedAt' | 'expiresAt' | 'ttl'>,
  lifetimeMs: number,
  now = Date.now()
): VerdictRow {
  const expiresAt = now + lifetimeMs;
  return { ...fields, fetchedAt: now, expiresAt, ttl: Math.floor(expiresAt / 1000) + 86400 };
}
