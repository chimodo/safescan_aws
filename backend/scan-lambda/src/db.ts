import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { TamperWarning, ThreatType } from '../../../shared/community';
import type { Screenshot } from './screenshots';

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
  community: process.env.TABLE_COMMUNITY!,
};

// Global secondary indexes on Reports (names must match the CDK stack)
export const REPORT_INDEXES = {
  byUrl: 'byUrl', // urlHash + createdAt
  byArea: 'byArea', // geohash5 + createdAt
  byStatus: 'byStatus', // urlStatus + createdAt
  byVisibility: 'byVisibility', // visibility + createdAt: the community home page's recent list
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

/** Maintainer review state of the URL claim. Only maintainers and threat-database matches move it. */
export type UrlStatus = 'pending' | 'corroborated' | 'verified' | 'rejected';
/** Whether a submission shows on the community pages and counts toward the verdict level */
export type Visibility = 'visible' | 'hidden';

/** One row of Reports: a community submission */
export interface ReportRow {
  reportId: string;
  urlHash: string; // computed by the Lambda, never trusted from the client
  url: string; // as cleaned by shared/normalizeUrl
  threatType?: ThreatType;
  details?: string; // plain text, at most DETAILS_MAX_LENGTH characters
  tamperWarning: TamperWarning;
  urlStatus: UrlStatus;
  visibility?: Visibility; // absent on reports made before the community features
  helpfulVotes?: number;
  /** One entry per upload slot; images stay hidden until a maintainer approves them */
  screenshots?: Screenshot[];
  needsReview?: boolean;
  installIdHash: string;
  ipHash: string;
  createdAt: string; // ISO 8601, sorts correctly as a string
  /** Fields from the first report form (before the 26 Oct build instructions) */
  category?: string;
  note?: string;
  geohash5?: string;
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
