import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
const cache = new Map<string, Promise<string>>();

/** Reads a SecureString once per cold start. A failed read isn't cached, so the next call retries. */
export function getParam(name: string): Promise<string> {
  let value = cache.get(name);
  if (!value) {
    value = ssm
      .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
      .then((r) => {
        if (!r.Parameter?.Value) throw new Error(`SSM parameter ${name} is empty`);
        return r.Parameter.Value;
      });
    value.catch(() => cache.delete(name));
    cache.set(name, value);
  }
  return value;
}

export const PARAMS = {
  safeBrowsingKey: process.env.SB_KEY_PARAM ?? '/safescan/safe-browsing-key',
  hashPepper: process.env.PEPPER_PARAM ?? '/safescan/hash-pepper',
  githubToken: process.env.GITHUB_TOKEN_PARAM ?? '/safescan/github-token',
  captchaSecret: process.env.CAPTCHA_SECRET_PARAM ?? '/safescan/captcha-secret',
};
