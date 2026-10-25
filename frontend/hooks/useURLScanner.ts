import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { normalizeUrl } from '../../shared/normalizeUrl';
import { scoreHeuristics, SUSPICIOUS_THRESHOLD, type HeuristicResult } from '../../shared/heuristics';
import { decideVerdict, type ScanResponse, type Verdict } from '../../shared/verdict';
import { ScanReport, SecurityCheck, ThreatLevel } from '../types';

// AWS Lambda function URL (InfraStack output "ScanUrl"). Override with EXPO_PUBLIC_SCAN_URL in frontend/.env.
const SCANNER_ENDPOINT =
  process.env.EXPO_PUBLIC_SCAN_URL ?? 'https://hggnmfb55rkvypwevw5owgj3y40srnpp.lambda-url.us-east-1.on.aws/';
const INSTALL_ID_KEY = '@safescan/install-id-v1';
const TIMEOUT_MS = 15000;

let installIdPromise: Promise<string> | undefined;

/** Random ID created on first launch. The backend stores only a hash of it, for rate limiting and report counting. */
export function getInstallId(): Promise<string> {
  installIdPromise ??= (async () => {
    const saved = await AsyncStorage.getItem(INSTALL_ID_KEY).catch(() => null);
    if (saved) return saved;
    const id = Crypto.randomUUID();
    await AsyncStorage.setItem(INSTALL_ID_KEY, id).catch(() => undefined);
    return id;
  })();
  return installIdPromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScanResponse(value: unknown): value is ScanResponse {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    (value.verdict === 'SAFE' || value.verdict === 'SUSPICIOUS' || value.verdict === 'DANGEROUS') &&
    typeof value.score === 'number' &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === 'string') &&
    typeof value.limited === 'boolean'
  );
}

/** A "safe" verdict without a threat-database check is shown as not verified */
function threatLevel(verdict: Verdict, limited: boolean): ThreatLevel {
  if (verdict === 'DANGEROUS') return 'malicious';
  if (verdict === 'SUSPICIOUS') return 'suspicious';
  return limited ? 'unknown' : 'safe';
}

function heuristicsCheck(heur: HeuristicResult): SecurityCheck {
  return {
    checkName: 'heuristics',
    threatLevel: heur.score >= SUSPICIOUS_THRESHOLD ? 'suspicious' : 'safe',
    score: heur.score,
    detail: heur.reasons.length ? heur.reasons.join('. ') + '.' : 'No risky link patterns were found.',
  };
}

function toReport(response: ScanResponse, heur: HeuristicResult): ScanReport {
  // The backend recomputes heuristics; whatever isn't a heuristic reason came from a threat database
  const databaseReasons = response.reasons.filter((reason) => !heur.reasons.includes(reason));
  const reputation: SecurityCheck = response.limited
    ? { checkName: 'reputation', threatLevel: 'unknown', detail: 'The threat database could not be reached, so only link patterns were checked.' }
    : response.verdict === 'DANGEROUS'
      ? { checkName: 'reputation', threatLevel: 'malicious', detail: databaseReasons.join('. ') + '.' }
      : { checkName: 'reputation', threatLevel: 'safe', detail: 'Not found in Google Safe Browsing, public phishing feeds or SafeScan community reports.' };

  return {
    url: response.url,
    finalVerdict: threatLevel(response.verdict, response.limited),
    checks: [reputation, heuristicsCheck(heur)],
    scannedAt: new Date().toISOString(),
    cached: response.cached,
    serviceMessage: response.limited ? 'Limited check: only link patterns were checked.' : undefined,
  };
}

/** Heuristics-only result for when the backend can't be reached or is throttling */
function limitedReport(url: string, heur: HeuristicResult, reason: string): ScanReport {
  const { verdict } = decideVerdict(false, heur);
  return {
    url,
    finalVerdict: threatLevel(verdict, true),
    checks: [{ checkName: 'reputation', threatLevel: 'unknown', detail: reason }, heuristicsCheck(heur)],
    scannedAt: new Date().toISOString(),
    serviceMessage: 'Limited check: only link patterns were checked.',
  };
}

export async function scanURL(rawUrl: string): Promise<ScanReport> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error('This is not a valid web address, so SafeScan did not check it.');

  // Computed on the phone for instant, offline-capable feedback; the backend recomputes its own
  const heur = scoreHeuristics(url);
  const [urlHash, installId] = await Promise.all([
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, url),
    getInstallId(),
  ]);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(new URL('scan', SCANNER_ENDPOINT).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': installId },
      body: JSON.stringify({ url, urlHash }),
      signal: controller.signal,
    });
  } catch {
    return limitedReport(
      url,
      heur,
      controller.signal.aborted
        ? 'The SafeScan service took too long to respond, so only link patterns were checked.'
        : 'SafeScan could not reach its service, so only link patterns were checked.'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    return limitedReport(url, heur, 'SafeScan is busy right now, so only link patterns were checked. Try again later for a full check.');
  }
  if (response.status === 400) {
    throw new Error('This is not a valid web address, so SafeScan did not check it.');
  }
  if (!response.ok) {
    return limitedReport(url, heur, `The SafeScan service returned an error (${response.status}), so only link patterns were checked.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return limitedReport(url, heur, 'The SafeScan service sent an unreadable response, so only link patterns were checked.');
  }
  if (!isScanResponse(payload)) {
    return limitedReport(url, heur, 'The SafeScan service sent an unexpected response, so only link patterns were checked.');
  }

  return toReport(payload, heur);
}
