import type { Level } from '../shared/verdict';

export type SignalLevel = 'low' | 'medium' | 'high';

export interface Signal {
  label: string;
  val: string;
  level: SignalLevel;
}

export type ThreatLevel = 'safe' | 'suspicious' | 'malicious' | 'unknown';

export interface SecurityCheck {
  checkName: string;
  threatLevel: ThreatLevel;
  score?: number;
  detail?: string;
}

export interface ScanReport {
  url: string;
  finalVerdict: ThreatLevel;
  checks: SecurityCheck[];
  scannedAt: string;
  cached?: boolean;
  serviceMessage?: string;
  /** Verdict level 1-4 from the backend, or worked out on the phone for a limited check */
  level?: Level;
  levelLabel?: string;
  /** SHA-256 of the normalized URL, for the community link page */
  urlHash?: string;
  community?: { submissions: number; votes: number };
}

export type StoredScan = {
  id: string;
  scanType: 'url' | 'barcode';
  displayValue: string;
  finalVerdict: ThreatLevel;
  checks: Array<Pick<SecurityCheck, 'checkName' | 'threatLevel'> & Partial<Pick<SecurityCheck, 'score' | 'detail'>>>;
  scannedAt: string;
  cached?: boolean;
  /** Missing on scans saved before the four levels; finalVerdict keeps its internal names */
  level?: Level;
} & (
  | { scanType: 'url'; barcodeType?: never }
  | { scanType: 'barcode'; barcodeType: string }
);
