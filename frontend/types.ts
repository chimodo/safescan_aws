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
}

export type StoredScan = {
  id: string;
  scanType: 'url' | 'barcode';
  displayValue: string;
  finalVerdict: ThreatLevel;
  checks: Array<Pick<SecurityCheck, 'checkName' | 'threatLevel'> & Partial<Pick<SecurityCheck, 'score' | 'detail'>>>;
  scannedAt: string;
  cached?: boolean;
} & (
  | { scanType: 'url'; barcodeType?: never }
  | { scanType: 'barcode'; barcodeType: string }
);
