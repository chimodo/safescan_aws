import { parseDuration } from './parseDuration';

// Ported from safescan-worker/src/checks/reputation.ts.
// Returns raw facts instead of a 10/90 score; the handler turns them into a verdict.
export type ReputationResult =
  | { ok: true; match: boolean; threatTypes: string[]; cacheSeconds: number }
  | { ok: false; error: string };

interface ThreatMatch {
  threatType: string;
  cacheDuration?: string;
}

interface SafeBrowsingResponse {
  matches?: ThreatMatch[]; // omitted entirely when there is no match
}

export async function checkReputation(url: string, apiKey: string): Promise<ReputationResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'safescan-app', clientVersion: '1.0.0' },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }],
          },
        }),
        // fail fast so a slow Google response can't hit the Lambda's 10s timeout
        signal: AbortSignal.timeout(3000),
      }
    );
  } catch {
    // never log the request URL: it contains the API key
    return { ok: false, error: 'Network error reaching Safe Browsing API' };
  }

  if (!response.ok) {
    return { ok: false, error: `Safe Browsing API returned status ${response.status}` };
  }

  const data = (await response.json()) as SafeBrowsingResponse;
  const matches = data.matches ?? [];

  if (matches.length === 0) {
    // the handler applies the team-set negative TTL for clean results
    return { ok: true, match: false, threatTypes: [], cacheSeconds: 0 };
  }

  return {
    ok: true,
    match: true,
    threatTypes: [...new Set(matches.map((m) => m.threatType))],
    cacheSeconds: parseDuration(matches[0].cacheDuration, 300),
  };
}
