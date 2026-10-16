export interface Env {
  SAFE_BROWSING_API_KEY: string;
  // WHOISXML_API_KEY?: string;
  // URLSCAN_API_KEY?: string;
  // REDIRECTCHECK_API_KEY?: string;
}

export interface ThreatMatch {
  threatType: string;
  platformType: string;
  threatEntryType: string;
  threat: { url: string };
  cacheDuration?: string;
}

export interface SafeBrowsingResponse {
  matches?: ThreatMatch[];
  negativeCacheDuration?: string;
}

export type ThreatLevel = 'safe' | 'suspicious' | 'malicious' | 'unknown';

export interface ScanResult {
  verdict: 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS' | 'UNKNOWN';
  score: number;
  cached: boolean;
  threats?: string[];
  cacheTtl?: number;
  error?: string;
  checkName?: string;
  threatLevel?: ThreatLevel;
  latencyMs?: number;
}

export interface CheckResult {
  checkName: string;
  threatLevel: ThreatLevel;
  score: number;
  detail?: string;
  latencyMs?: number;
}

export interface AggregatedResult {
  url: string;
  finalVerdict: ThreatLevel;
  score: number;
  checks: CheckResult[];
  scannedAt: string;
}
