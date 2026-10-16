// Shared by the app (instant feedback) and the Lambda (the score it trusts).
// Expects a URL already passed through normalizeUrl.

export interface HeuristicResult {
  score: number; // 0-100
  reasons: string[];
}

// Placeholder until the team sets the real threshold from test data
export const SUSPICIOUS_THRESHOLD = 40;

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'cutt.ly', 'rebrand.ly', 'shorturl.at', 't.ly', 'rb.gy', 'tiny.cc',
]);

const UNCOMMON_TLDS = new Set([
  'zip', 'mov', 'top', 'xyz', 'click', 'link', 'country', 'gq', 'tk', 'ml',
  'cf', 'ga', 'work', 'support', 'rest', 'cam', 'icu', 'buzz', 'fit',
]);

const LOGIN_OR_PAYMENT = /(log-?in|sign-?in|verify|account|password|wallet|payment|billing|invoice|bank|refund|parking|toll)/i;
const REDIRECT_PARAM = /^(url|redirect|redirect_ur[il]|next|target|dest|destination|continue|return|returnurl|goto|out|u)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LONG_PATH = 120;

export function scoreHeuristics(url: string): HeuristicResult {
  const u = new URL(url);
  const host = u.hostname;
  const reasons: string[] = [];
  let score = 0;
  const flag = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (IPV4.test(host) || host.startsWith('[')) flag(35, 'Uses an IP address instead of a domain name');
  if (host.split('.').some((label) => label.startsWith('xn--'))) {
    flag(30, 'Uses international characters that can imitate another domain');
  }
  if (SHORTENERS.has(host)) flag(20, 'Link shortener hides the real destination');

  const tld = host.split('.').pop() ?? '';
  if (UNCOMMON_TLDS.has(tld)) flag(15, `Uncommon domain ending .${tld}`);

  if (u.pathname.length + u.search.length > LONG_PATH) flag(10, 'Unusually long link');
  if (LOGIN_OR_PAYMENT.test(host + u.pathname + u.search)) flag(15, 'Mentions login or payment');

  for (const [key, value] of u.searchParams) {
    if (REDIRECT_PARAM.test(key) && /^(https?:)?\/\//i.test(value)) {
      flag(20, 'Forwards you to another website');
      break;
    }
  }

  return { score: Math.min(score, 100), reasons };
}
