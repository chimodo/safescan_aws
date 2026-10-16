import { CheckResult, Env } from '../utils/types';

// Tier 2 (external API, 200-400ms)
// TODO: follow redirects and evaluate redirect chain length / suspicious hosts
export async function checkRedirects(url: string, env: Env): Promise<CheckResult> {
  return {
    checkName: 'redirects',
    threatLevel: 'unknown',
    score: 0,
    detail: 'stub: redirects not implemented yet',
  };
}
