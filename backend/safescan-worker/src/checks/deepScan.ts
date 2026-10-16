import { CheckResult, Env } from '../utils/types';

// Tier 3 (async/non-blocking, 30-60s)
// This check MUST be kicked off with ctx.waitUntil() from the orchestrator
// TODO: implement deep scan via URLScan.io (async job)
export async function checkDeepScan(url: string, env: Env, ctx: ExecutionContext): Promise<CheckResult> {
  // stub: schedule async deep scan and return unknown immediately
  ctx.waitUntil((async () => {
    // TODO: call URLScan.io and persist results
  })());

  return {
    checkName: 'deepScan',
    threatLevel: 'unknown',
    score: 0,
    detail: 'stub: deep scan scheduled via ctx.waitUntil()',
  };
}
