import { CheckResult, Env } from '../utils/types';

// Tier 2 (external API, 200-400ms)
// TODO: query WHOIS / domain age services
export async function checkDomainAge(url: string, env: Env): Promise<CheckResult> {
  return {
    checkName: 'domainAge',
    threatLevel: 'unknown',
    score: 0,
    detail: 'stub: domain age check not implemented yet',
  };
}
