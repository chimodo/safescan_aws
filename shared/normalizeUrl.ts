// Shared by the app and the Lambda. Both must produce identical strings,
// because the SHA-256 of this output is the UrlVerdicts key.

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_ga)$/i;
const MAX_URL_LENGTH = 2048;

/**
 * Returns the canonical form of an http(s) URL, or null if the input isn't one.
 * - host lowercased, default port dropped (done by the URL parser)
 * - internationalized hosts kept in their ASCII xn-- form, so both platforms agree
 * - tracking parameters and the #fragment removed
 */
export function normalizeUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) return null;

  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  u.hash = '';
  const tracking = [...u.searchParams.keys()].filter((k) => TRACKING_PARAM.test(k));
  for (const key of tracking) u.searchParams.delete(key);

  return u.toString();
}
