import { CheckResult, Env } from '../utils/types';

// Tier 1 (in-worker, <10ms)
// TODO: implement heuristic checks (e.g., suspicious path patterns, short URLs)
export async function checkHeuristics(url: string, env: Env): Promise<CheckResult> {
  return {
    checkName: 'heuristics',
    threatLevel: 'unknown',
    score: 0,
    detail: 'stub: heuristics not implemented yet',
  };
}
