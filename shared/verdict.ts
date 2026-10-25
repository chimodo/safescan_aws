// Shared verdict rule and response shape, so the app's offline fallback
// and the Lambda reach the same answer for the same evidence.
import { SUSPICIOUS_THRESHOLD, type HeuristicResult } from './heuristics';

export type Verdict = 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';

export interface ScanResponse {
  url: string;
  verdict: Verdict;
  score: number; // 0-100, for the score bar: 100 for a known threat, else the heuristic score
  reasons: string[];
  limited: boolean; // true when no threat database was consulted (heuristics only)
  cached?: boolean;
}

/** Dangerous needs a known-threat match; heuristics alone can only reach Suspicious. */
export function decideVerdict(knownThreat: boolean, heur: HeuristicResult): { verdict: Verdict; score: number } {
  if (knownThreat) return { verdict: 'DANGEROUS', score: 100 };
  if (heur.score >= SUSPICIOUS_THRESHOLD) return { verdict: 'SUSPICIOUS', score: heur.score };
  return { verdict: 'SAFE', score: heur.score };
}
