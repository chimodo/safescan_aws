import { ScanReport, SecurityCheck, ThreatLevel } from '../types';

const SCANNER_ENDPOINT = 'https://safescan-worker.tinenyashadev.workers.dev/';

function isThreatLevel(value: unknown): value is ThreatLevel {
  return value === 'safe' || value === 'suspicious' || value === 'malicious' || value === 'unknown';
}

function parseLegacyVerdict(value: unknown): ThreatLevel | null {
  if (value === 'SAFE') return 'safe';
  if (value === 'SUSPICIOUS') return 'suspicious';
  if (value === 'MALICIOUS') return 'malicious';
  if (value === 'UNKNOWN') return 'unknown';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseCheck(value: unknown): SecurityCheck | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.checkName !== 'string' ||
    !isThreatLevel(value.threatLevel) ||
    typeof value.score !== 'number'
  ) {
    return null;
  }

  return {
    checkName: value.checkName,
    threatLevel: value.threatLevel,
    score: value.score,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    latencyMs: typeof value.latencyMs === 'number' ? value.latencyMs : undefined,
  };
}

export async function scanURL(url: string): Promise<ScanReport> {
  const endpoint = new URL(SCANNER_ENDPOINT);
  endpoint.searchParams.set('url', url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  let response: Response;
  try {
    response = await fetch(endpoint.toString(), { signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new Error('The scan timed out. Please check your connection and try again.');
    }
    throw new Error('Could not connect to the SafeScan service. Please try again.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`The scanner returned an error (${response.status}). Please try again.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The scanner returned an unreadable response. Please try again later.');
  }

  if (isRecord(payload) && typeof payload.verdict === 'string' && typeof payload.cached === 'boolean') {
    const verdict = parseLegacyVerdict(payload.verdict);
    if (!verdict) {
      throw new Error('The scanner returned an unsupported verdict. Please try again later.');
    }
    const threatEvidence =
      Array.isArray(payload.threats) && payload.threats.every((item) => typeof item === 'string')
        ? payload.threats.join(', ')
        : undefined;
    return {
      url,
      finalVerdict: verdict,
      checks: [],
      scannedAt: new Date().toISOString(),
      cached: payload.cached,
      serviceMessage: typeof payload.error === 'string' ? payload.error : threatEvidence,
    };
  }

  if (
    !isRecord(payload) ||
    typeof payload.url !== 'string' ||
    !isThreatLevel(payload.finalVerdict) ||
    !Array.isArray(payload.checks) ||
    typeof payload.scannedAt !== 'string'
  ) {
    throw new Error('The scanner returned an unexpected response. Please try again later.');
  }

  const checks = payload.checks.map(parseCheck);
  if (checks.some((check) => check === null)) {
    throw new Error('The scanner returned incomplete check data. Please try again later.');
  }
  const validChecks = checks.filter((check): check is SecurityCheck => check !== null);

  return {
    url: payload.url,
    finalVerdict: payload.finalVerdict,
    checks: validChecks,
    scannedAt: payload.scannedAt,
    cached: response.headers.get('X-Cache')?.toUpperCase() === 'HIT',
  };
}
