// Shared verdict rules and response shape, so the app's offline fallback,
// the community website and the Lambda reach the same answer for the same evidence.
import { SUSPICIOUS_THRESHOLD, type HeuristicResult } from './heuristics';

export type Verdict = 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';

/**
 * The four verdict levels from the 26 Oct build instructions.
 * Community activity can raise a link to 2 or 3, never to 4.
 */
export type Level = 1 | 2 | 3 | 4;

export const LEVEL_LABELS: Record<Level, string> = {
  1: 'No known threats',
  2: 'Use caution',
  3: 'Very suspicious',
  4: 'Likely malicious',
};

export interface ScanResponse {
  url: string;
  /** Three-value verdict kept for older app builds: level 4 = DANGEROUS, 2-3 = SUSPICIOUS, 1 = SAFE */
  verdict: Verdict;
  score: number; // 0-100, for the score bar
  reasons: string[];
  limited: boolean; // true when no threat database was consulted (heuristics only)
  cached?: boolean;
  level?: Level;
  levelLabel?: string;
  community?: { submissions: number; votes: number };
}

/** Dangerous needs a known-threat match; heuristics alone can only reach Suspicious. */
export function decideVerdict(knownThreat: boolean, heur: HeuristicResult): { verdict: Verdict; score: number } {
  if (knownThreat) return { verdict: 'DANGEROUS', score: 100 };
  if (heur.score >= SUSPICIOUS_THRESHOLD) return { verdict: 'SUSPICIOUS', score: heur.score };
  return { verdict: 'SAFE', score: heur.score };
}

/** How much community activity raises a link. A demo setting; the Lambda reads it from COMMUNITY_RULE. */
export interface CommunityRule {
  /** Visible submissions needed for level 2, and for level 3 together with the votes */
  minSubmissions: number;
  /** Helpful votes in total, across the link's visible submissions, needed for level 3 */
  minVotes: number;
}

export const DEFAULT_COMMUNITY_RULE: CommunityRule = { minSubmissions: 1, minVotes: 10 };

export interface LevelInput {
  /** Safe Browsing, a threat feed, or a maintainer-confirmed match */
  knownThreat: boolean;
  heuristics: HeuristicResult;
  submissions: number;
  votes: number;
  /** Popular domains are never raised by community activity alone */
  protectedDomain: boolean;
}

export interface LevelResult {
  level: Level;
  label: string;
  verdict: Verdict;
  score: number;
  /** Plain-language reasons for any community signal, to show beside the other reasons */
  communityReasons: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The highest level that any signal reaches wins. */
export function decideLevel(input: LevelInput, rule: CommunityRule = DEFAULT_COMMUNITY_RULE): LevelResult {
  const { knownThreat, heuristics, submissions, votes, protectedDomain } = input;
  const reported = submissions > 0 && submissions >= rule.minSubmissions;
  const community = reported && !protectedDomain;

  const communityReasons: string[] = [];
  if (submissions > 0) {
    communityReasons.push(
      protectedDomain
        ? `Shared ${plural(submissions, 'time', 'times')} by the community, but community reports alone don't change the verdict for popular sites`
        : `Shared ${plural(submissions, 'time', 'times')} by the SafeScan community`
    );
  }
  if (votes > 0 && !protectedDomain) communityReasons.push(`${plural(votes, 'person', 'people')} found these reports helpful`);

  const level: Level = knownThreat
    ? 4
    : community && votes >= rule.minVotes
      ? 3
      : community || heuristics.score >= SUSPICIOUS_THRESHOLD
        ? 2
        : 1;

  const score =
    level === 4 ? 100
    : level === 3 ? Math.max(heuristics.score, 75)
    : level === 2 ? Math.max(heuristics.score, community ? SUSPICIOUS_THRESHOLD : 0)
    : heuristics.score;

  return {
    level,
    label: LEVEL_LABELS[level],
    verdict: level === 4 ? 'DANGEROUS' : level === 1 ? 'SAFE' : 'SUSPICIOUS',
    score,
    communityReasons,
  };
}
