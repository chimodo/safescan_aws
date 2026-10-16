/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { getCached, setCached } from './utils/cache';
import { aggregateResults } from './utils/scorer';
import { checkHeuristics } from './checks/heuristics';
import { checkTyposquatting } from './checks/typosquatting';
import { checkMlScoring } from './checks/mlScoring';
import { checkReputation } from './checks/reputation';
import { checkRedirects } from './checks/redirects';
import { checkDomainAge } from './checks/domainAge';
import { checkDeepScan } from './checks/deepScan';
import { checkRateLimit } from './utils/rateLimiter';
import type { Env, AggregatedResult, CheckResult, ScanResult } from './utils/types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders,
      });
    }

    // Extract target URL from query param
    const requestUrl = new URL(request.url);
    const targetUrl = requestUrl.searchParams.get('url');

    if (!targetUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing url parameter' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Rate limiting (stub)
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const allowed = await checkRateLimit(ip, env as unknown as Env);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check cache (legacy ScanResult shape)
    const cached = await getCached(targetUrl);
    if (cached) {
      // Wrap cached ScanResult into AggregatedResult-like response
      const cachedCheck: CheckResult = {
        checkName: 'reputation',
        threatLevel: cached.verdict === 'SAFE' ? 'safe' : cached.verdict === 'MALICIOUS' ? 'malicious' : cached.verdict === 'SUSPICIOUS' ? 'suspicious' : 'unknown',
        score: cached.score,
        detail: cached.error ?? cached.threats?.join(',') ?? undefined,
      };

      const agg: AggregatedResult = {
        url: targetUrl,
        finalVerdict: cachedCheck.threatLevel,
        score: cached.score,
        checks: [cachedCheck],
        scannedAt: new Date().toISOString(),
      };

      return new Response(JSON.stringify(agg), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }

    // Tier 1 checks (in-worker)
    const tier1 = await Promise.all([
      checkHeuristics(targetUrl, env as unknown as Env),
      checkTyposquatting(targetUrl, env as unknown as Env),
      checkMlScoring(targetUrl, env as unknown as Env),
    ]);

    // Tier 2 checks (external)
    const reputationRes = await checkReputation(targetUrl, env as unknown as Env);
    const tier2 = await Promise.all([
      Promise.resolve(reputationRes.checkResult),
      checkRedirects(targetUrl, env as unknown as Env),
      checkDomainAge(targetUrl, env as unknown as Env),
    ]);

    // Kick off tier 3 (async) and don't wait
    // deep scan will be scheduled via ctx.waitUntil

    // Aggregate all check results
    const allChecks: CheckResult[] = [...tier1, ...tier2];
    const aggScore = aggregateResults(allChecks);

    const aggregated: AggregatedResult = {
      url: targetUrl,
      finalVerdict: aggScore.verdict as any,
      score: aggScore.score,
      checks: allChecks,
      scannedAt: new Date().toISOString(),
    };

    // Cache reputation (legacy behavior)
    const ttl = reputationRes.ttl ?? 0;
    if (reputationRes.checkResult.threatLevel !== 'unknown' && ttl > 0) {
      const scanResult: ScanResult = {
        verdict: reputationRes.checkResult.threatLevel === 'safe' ? 'SAFE' : reputationRes.checkResult.threatLevel === 'malicious' ? 'MALICIOUS' : reputationRes.checkResult.threatLevel === 'suspicious' ? 'SUSPICIOUS' : 'UNKNOWN',
        score: reputationRes.checkResult.score,
        cached: false,
        threats: reputationRes.checkResult.detail ? [reputationRes.checkResult.detail] : undefined,
        cacheTtl: ttl,
      };
      await setCached(targetUrl, scanResult, ttl);
    }

    return new Response(JSON.stringify(aggregated), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    });
  },
} satisfies ExportedHandler<Env>;