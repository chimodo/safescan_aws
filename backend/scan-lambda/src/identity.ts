import { createHash, createHmac } from 'node:crypto';
import { getParam, PARAMS } from './params';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Install IDs and IPs are stored only as keyed hashes. A plain SHA-256 of an IPv4
 * address can be reversed by trying all 4 billion, so the hash needs a secret pepper.
 */
export async function hashIdentity(kind: 'install' | 'ip', value: string): Promise<string> {
  const pepper = await getParam(PARAMS.hashPepper);
  return createHmac('sha256', pepper).update(`${kind}:${value}`).digest('hex');
}

const INSTALL_ID = /^[A-Za-z0-9-]{16,64}$/;

/** The app sends a random install ID (UUID) in X-Install-Id; anything else is ignored */
export function readInstallId(headers: Record<string, string | undefined>): string | undefined {
  const id = headers['x-install-id'];
  return id && INSTALL_ID.test(id) ? id : undefined;
}
