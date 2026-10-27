// Human check for every write. The function URL is public, so a script can post as the app;
// a CAPTCHA checked here, before anything is saved, is what stops that.
import { getParam, PARAMS } from './params';

type Provider = 'turnstile' | 'hcaptcha';

const VERIFY_URL: Record<Provider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
};

export type CaptchaResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'rejected' }
  | { ok: false; reason: 'unavailable'; detail: string };

/** Set at deploy time with `-c captchaProvider=hcaptcha`; Turnstile by default */
function provider(): Provider {
  return process.env.CAPTCHA_PROVIDER === 'hcaptcha' ? 'hcaptcha' : 'turnstile';
}

/** Checks a token from the CAPTCHA widget. Fails closed: no secret or no answer means no write. */
export async function verifyCaptcha(token: unknown, remoteIp: string): Promise<CaptchaResult> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return { ok: false, reason: 'missing' };

  let secret: string;
  try {
    secret = await getParam(PARAMS.captchaSecret);
  } catch (err) {
    console.error('CAPTCHA secret unavailable', err);
    return { ok: false, reason: 'unavailable', detail: 'CAPTCHA secret missing from SSM' };
  }

  let res: Response;
  try {
    res = await fetch(VERIFY_URL[provider()], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }).toString(),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error('CAPTCHA verification request failed', err);
    return { ok: false, reason: 'unavailable', detail: 'CAPTCHA service unreachable' };
  }
  if (!res.ok) return { ok: false, reason: 'unavailable', detail: `CAPTCHA service returned ${res.status}` };

  const body = (await res.json().catch(() => ({}))) as { success?: boolean; 'error-codes'?: string[] };
  if (body.success === true) return { ok: true };
  console.warn('CAPTCHA rejected', body['error-codes']);
  return { ok: false, reason: 'rejected' };
}
