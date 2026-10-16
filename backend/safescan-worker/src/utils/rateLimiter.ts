import { Env } from './types';

// TODO: implement with Durable Object or KV counter; will require binding in wrangler.jsonc
export async function checkRateLimit(ip: string, env: Env): Promise<boolean> {
  // Currently a stub that always allows the request
  return true;
}
