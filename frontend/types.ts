export type ThreatLevel = 'safe' | 'suspicious' | 'malicious' | 'unknown';

export interface SecurityCheck {
  checkName: string;
  threatLevel: ThreatLevel;
  score?: number;
  detail?: string;
  latencyMs?: number;
}

export interface ScanReport {
  url: string;
  finalVerdict: ThreatLevel;
  checks: SecurityCheck[];
  scannedAt: string;
  cached?: boolean;
  serviceMessage?: string;
}

export interface StoredScan {
  id: string;
  scanType: 'url' | 'barcode';
  displayValue: string;
  finalVerdict: ThreatLevel;
  checks: SecurityCheck[];
  scannedAt: string;
  cached?: boolean;
  barcodeType?: string;
}
