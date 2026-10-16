import { describe, it, expect } from 'vitest';
import { checkReputation } from '../../checks/reputation';

describe('checks/reputation (stub)', () => {
  it('returns a checkResult shape', async () => {
    const env = { SAFE_BROWSING_API_KEY: 'TEST' } as any;
    const res = await checkReputation('https://example.com', env);
    expect(res).toHaveProperty('checkResult');
    expect(res).toHaveProperty('ttl');
  });
});
