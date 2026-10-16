import { CheckResult, Env } from '../utils/types';

// Tier 1 (in-worker, <10ms)
// TODO: implement typosquatting checks (e.g., edit distance to known brands)
export async function checkTyposquatting(url: string, env: Env): Promise<CheckResult> {
  return {
    checkName: 'typosquatting',
    threatLevel: 'unknown',
    score: 0,
    detail: 'stub: typosquatting not implemented yet',
  };
}
