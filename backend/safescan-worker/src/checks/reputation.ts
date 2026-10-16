import { Env, ThreatMatch, SafeBrowsingResponse } from '../utils/types';
import { parseDuration } from '../utils/parseDuration';
import { CheckResult } from '../utils/types';

// Tier 2 (external API, 200-400ms)
// checkReputation queries Google Safe Browsing and maps result to CheckResult
// TODO: preserve behavior exactly from previous implementation
// ttl (time to live) id how long we can trust the chached result.
export async function checkReputation(url: string, env: Env): Promise<{ checkResult: CheckResult; ttl: number }> {
  let response: Response;

  try {
    response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${env.SAFE_BROWSING_API_KEY}`,
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
      }
    );
  } catch (err) {
    return {
      checkResult: {
        checkName: 'reputation',
        threatLevel: 'unknown',
        score: -1,
        detail: 'Network error reaching Safe Browsing API',
      },
      ttl: 0,
    };
  }

  if (!response.ok) {
    return {
      checkResult: {
        checkName: 'reputation',
        threatLevel: 'unknown',
        score: -1,
        detail: `Safe Browsing API returned status ${response.status}`,
      },
      ttl: 0,
    };
  }

  const data = (await response.json()) as SafeBrowsingResponse;
  const matches = data.matches ?? [];

  if (matches.length === 0) {
    const ttl = parseDuration(data.negativeCacheDuration, 300);
    return {
      checkResult: {
        checkName: 'reputation',
        threatLevel: 'safe',
        score: 10,
        detail: 'No matches in Safe Browsing',
      },
      ttl,
    };
  }

  const ttl = parseDuration(matches[0].cacheDuration, 300);
  const threatTypes = matches.map((m: ThreatMatch) => m.threatType);

  return {
    checkResult: {
      checkName: 'reputation',
      threatLevel: 'malicious',
      score: 90,
      detail: `Threats: ${threatTypes.join(',')}`,
    },
    ttl,
  };
}


/**
 * ~ Api Guide for reference from documentation ~
 * 
 * use the request body as below.
 * if threat matches are found, it returns an object with a list of threat objects (refer to the example response) 
 * Note, no matches found returns {}
 * Google Safe Browsing API v4 — threatMatches.find
 * POST https://safebrowsing.googleapis.com/v4/threatMatches:find?key=API_KEY
 *
 * Request body:
 * {
 *   "client": { "clientId": string, "clientVersion": string },
 *   "threatInfo": {
 *     "threatTypes": string[],       // e.g. "MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"
 *     "platformTypes": string[],     // e.g. "ANY_PLATFORM"
 *     "threatEntryTypes": string[],  // e.g. "URL"
 *     "threatEntries": [{ "url": string }]
 *   }
 * }
 *
 * Response body — NO matches found:
 * {}                                 // <- empty object, NOT { "matches": [] }
 *
 * Response body — matches found:
 * {
 *   "matches": [
 *     {
 *       "threatType": string,            // e.g. "MALWARE"
 *       "platformType": string,          // e.g. "ANY_PLATFORM"
 *       "threat": { "url": string },
 *       "cacheDuration": string,         // e.g. "300s"
 *       "threatEntryType": string,       // e.g. "URL"
 *       "threatEntryMetadata"?: { ... }  // optional, only for some threat types
 *     }
 *   ]
 * }
 *
 * NOTE: data.matches can be `undefined` when there's no match (API omits the
 * field entirely), so always read it with `data.matches ?? []`.
 */