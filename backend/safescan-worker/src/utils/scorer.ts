import { CheckResult } from './types';

const WEIGHTS: Record<string, number> = {
  heuristics: 1,
  typosquatting: 1,
  ml: 1,
  reputation: 3,
  redirects: 2,
  domainAge: 1,
  deepScan: 2,
};

// TODO: refine weights once all checks are live
export function aggregateResults(checks: CheckResult[]): { verdict: string; score: number } {
  if (!checks || checks.length === 0) return { verdict: 'unknown', score: 0 };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const c of checks) {
    const key = c.checkName.toLowerCase();
    const weight = WEIGHTS[key] ?? 1;
    totalWeight += weight;
    weightedSum += c.score * weight;
  }

  const score = totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight);

  // naive mapping: score thresholds to verdicts (placeholder)
  const verdict = score >= 75 ? 'malicious' : score >= 40 ? 'suspicious' : score > 0 ? 'safe' : 'unknown';

  return { verdict, score };
}
