import { CheckResult, Env } from '../utils/types';

// Tier 1 (in-worker, <10ms)
// TODO: implement ML scoring (ONNX runtime) — separate task
export async function checkMlScoring(url: string, env: Env): Promise<CheckResult> {
  return {
    checkName: 'ml',
    threatLevel: 'unknown',
    score: 0,
    detail: 'stub: ml scoring not implemented',
  };
}
