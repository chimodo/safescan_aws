// Two domain lists the verifier consults. A host matches when it equals a listed
// domain or is a subdomain of one, so no public-suffix list is needed.

/**
 * Domains the team has confirmed are legitimate. Reports against them are rejected.
 * Add entries after a dispute is resolved in the domain owner's favour.
 */
export const ALLOWLIST = new Set<string>([]);

/**
 * Popular domains that votes alone must not verify (the design's Tranco check).
 * They go to manual review instead. Safe Browsing and feed matches still verify them.
 *
 * TODO: replace this starter set with the Tranco top list (https://tranco-list.eu),
 * e.g. the top 10,000 domains, regenerated every few months.
 */
export const PROTECTED_DOMAINS = new Set<string>([
  'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'whatsapp.com',
  'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'office.com',
  'amazon.com', 'paypal.com', 'netflix.com', 'linkedin.com', 'x.com', 'twitter.com',
  'tiktok.com', 'wikipedia.org', 'github.com', 'cloudflare.com',
]);

export function hostMatches(host: string, list: Set<string>): boolean {
  const labels = host.toLowerCase().split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (list.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}
