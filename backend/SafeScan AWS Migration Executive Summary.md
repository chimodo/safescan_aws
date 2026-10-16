# SafeScan AWS Migration: Executive Summary

Oct 16, 2026 · @Munashe Mukweya

## Bottom line

The SafeScan backend now runs on AWS, and the app calls it instead of the Cloudflare Worker. Scanning is tested end to end on AWS. Community reporting and the nightly job are deployed but have not run yet.

- **Where it runs:** one CDK stack, `InfraStack`, in `us-east-1`, built to the SafeScan Community design document and kept inside the AWS free tier.
- **Not merged yet:** most code changes are on the `munashe` branch. Teammates on `main` still use the old Worker.
- **Map publishing is off** until the `chimodo/safescan_aws` owner sets up GitHub Pages and stores their own GitHub token (next section).

A diagram of the new flows is in the [SafeScan Backend Map](https://claude.ai/artifact/Dg8Y6TXMZq7SiniEiVcmWx).

## Action required: chimodo owner sets up GitHub Pages

**The owner of `chimodo/safescan_aws` must set up GitHub Pages and replace the GitHub token stored in AWS with one they create.** The token in AWS today belongs to Langton49 and is for `Langton49/safescan_aws`. Until this is done, the nightly job skips publishing the hotspot map.

The token stays a **GitHub** token. The owner's **AWS IAM user** is only how they sign in to AWS to store it. The backend never uses the IAM user itself.

1. **Check the repo can use Pages.** On a free GitHub account, Pages needs a public repo. Keep it private only with GitHub Pro or a Team plan. Check the history for secrets before making it public.
2. **Get `docs/` onto `main`.** Merge the pull request that adds `docs/map/index.html` and `docs/data/`.
3. **Turn on Pages.** Repo → Settings → Pages → Deploy from a branch → `main`, folder `/docs` → Save. The map will be at `https://chimodo.github.io/safescan_aws/map/`.
4. **Create a fine-grained GitHub token.** GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
   - Resource owner: `chimodo`. Repository access: only `safescan_aws`.
   - Permissions: **Contents: Read and write**. Nothing else.
   - Expiry: up to one year. Set a reminder to renew it.
5. **Get an IAM user in the SafeScan AWS account.** Ask the account admin for a user (or IAM Identity Center access) with at least this permission:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ssm:PutParameter",
    "Resource": "arn:aws:ssm:us-east-1:<account-id>:parameter/safescan/github-token"
  }]
}
```

6. **Sign in with that IAM user** and confirm it is the right account: `aws configure` (or `aws login`), then `aws sts get-caller-identity`.
7. **Replace the token in SSM.** In PowerShell, run each line on its own. Paste the token at the prompt, so it stays out of shell history:

```powershell
$t = Read-Host "Paste token"
aws ssm put-parameter --name /safescan/github-token --type SecureString --value "$t" --overwrite --region us-east-1
Remove-Variable t
```

8. **Point publishing at the chimodo repo and turn it on.** Someone with deploy rights runs this from `infra/`:

```powershell
npx cdk deploy -c publish=true -c githubRepo=chimodo/safescan_aws
```

To keep it on for future deploys, add `"publish": "true"` and `"githubRepo": "chimodo/safescan_aws"` under `context` in `infra/cdk.json`.

9. **Check it works.** After the next 03:00 UTC run, `main` should have a commit named "Nightly data update", or the files should be unchanged. To test sooner, someone with `lambda:InvokeFunction` runs the nightly function once and looks for `"published"` in its output.
10. **Clean up.** Langton49 revokes their old token on GitHub once the new one is stored.

## What we finished

The scan path, cache, rate limits and secrets are tested against AWS. Everything else passes type-checks, lint and builds but has not run for real yet.

| Area | What it does | State |
| --- | --- | --- |
| Scan API (`POST /scan`) | Cleans the link, checks the DynamoDB cache, calls Google Safe Browsing only on a miss, applies heuristics, returns a verdict | Tested live |
| Cache, rate limits, secrets | `UrlVerdicts` cache, hourly limits per install and per IP, Safe Browsing key, hash pepper and GitHub token in SSM | Tested live |
| Community reporting | `POST /report`, `Reports` table with three indexes, stream-triggered verifier, maintainer review script | Deployed, not run |
| Nightly job | Loads OpenPhish and URLhaus, re-checks open reports, counts hotspots, exports public data; 03:00 UTC, publishing off, one retry | Deployed, not run |
| Shared rules (`shared/`) | URL cleaning, heuristics and the verdict rule, used by both the app and the Lambda | Built, used by the live scan |
| App | Calls AWS with a random install ID; shows a limited heuristics-only result when offline or throttled | Built, not run on a phone |
| Expo upgrade | SDK 54 to 57 (React Native 0.86), with fixes for removed APIs and stricter lint | expo-doctor, type-check, lint and Android build pass |
| Hotspot map (`docs/map/`) | MapLibre page reading the nightly JSON | Built, not published |
| Report screen in the app | Category chips, note, location toggle | Not started |

**Live test results:** Google's test phishing page returned DANGEROUS (SOCIAL\_ENGINEERING), and the repeat scan came from the cache in 0.25 s. A clean link returned SAFE with its tracking parameter removed. A Wi-Fi QR code returned 400, and an unknown path returned 404. No errors appeared in any log.

**Old Worker bugs fixed along the way:**

- The app never displayed a verdict, because it read a different field than the Worker sent.
- Known threats were averaged down to "safe" by placeholder checks that all scored zero.
- The cache did nothing on `*.workers.dev`.
- The rate limiter always allowed every request.

## Decisions we made

Most decisions follow the design document. These are the ones we made where it was silent or where we chose a specific value.

| Area | Decision | Why |
| --- | --- | --- |
| Infrastructure | AWS CDK in TypeScript, one stack | Same language as the app and backend; the design allowed CDK or SAM |
| API | Lambda function URL on arm64, Node 22, no API Gateway | Free, and the design's choice |
| Trust | The Lambda recomputes the URL hash and ignores the one the phone sends | Otherwise one phone could mark a phishing URL as safe for everyone |
| Verdict | Dangerous only on a Safe Browsing, feed or verified community match; heuristics alone reach Suspicious at most | The design's rule; also replaces the Worker's averaging bug |
| Limited results | If Safe Browsing or the backend can't be reached, the result is heuristics-only and marked limited; a limited "safe" shows as Not verified | The design's fallback, without implying a link is safe |
| Clean-result cache | Reused for 300 seconds | Short, because a clean link can be flagged later |
| URL form | Internationalized domains kept in their ASCII `xn--` form | The app and the Lambda produce identical text without a punycode library |
| Privacy | Install IDs and IPs stored only as hashes keyed with a secret pepper in SSM | A plain hash of an IPv4 address can be reversed by trying all 4 billion |
| Rate limits | 120 scans and 10 reports per install per hour; 30 reports per IP; new `RateLimits` table | The design named per-install limits but no table; the IP limit is looser because carriers share IPs |
| Failure modes | Scans go through if rate limiting breaks; reports are refused | The concurrency cap still bounds scans; reports need the pepper to count reporters |
| Distinct reporters | Counted as the lower of distinct installs and distinct IPs | Stops one person inflating votes with reinstalls |
| Popular domains | Can't be verified by votes alone, only by Safe Browsing, a feed, or a maintainer | Stops rivals mass-reporting a real business |
| Status changes | Automatic checks only move a URL up (pending, corroborated, verified); only maintainers move it down | Keeps the verifier simple and predictable |
| Expiry | Community verdicts last 90 days, feed entries 2 days; up to 3,000 feed URLs a night | Fits the free-tier write capacity |
| Database capacity | 17 read and 20 write units of the free 25 each, auto scaling off | Usage can't grow into a bill |
| Nightly job | 03:00 UTC; GitHub publishing off by default; one retry within an hour; a publish error doesn't fail the run | The default of 185 retries over 24 hours would re-run the feed load all day |
| Map | Data committed to `docs/data/` on `main`; MapLibre with OpenFreeMap tiles | No API keys and no hosting cost |
| App | Upgraded to Expo SDK 57 | Expo Go on the test phone only runs SDK 57 |
| Old backend | Cloudflare Worker kept running and in the repo | The design keeps Cloudflare as a fallback; nothing in the new app calls it |
| Traffic cap | Reserved concurrency left off for now | New accounts often can't set it; the account's own concurrency limit applies |

## Assumptions we haven't verified

None of these block the scan path. Each could change how reporting, the nightly job or publishing behaves.

| Assumption | Risk if wrong | How to confirm |
| --- | --- | --- |
| Tuning values are placeholders: suspicious threshold 40; 3 reporters (N) within 7 days (W) with a heuristic score of 40 (T); minimum 3 reports per map cell | Too many or too few links flagged or verified | Tune on real reports and a labelled set of links |
| The 20-domain "popular" list stands in for the Tranco top list | A real business outside the 20 could be voted into Verified | Load the Tranco top 10,000 into `domainLists.ts` |
| OpenPhish and URLhaus can be downloaded without a key, and their terms allow this use | A feed fails each night, or the use breaks its terms | Read each feed's terms; check the first nightly run's output |
| Safe Browsing's lookup response has no `negativeCacheDuration` | None now: clean results use our own 300-second limit | Check Google's API reference |
| SafeScan stays non-commercial | Safe Browsing is free only for non-commercial use | Plan for Google Web Risk before any commercial launch |
| Fine-grained GitHub tokens only cover repos owned by your own account or an organization you belong to | Langton49 can't make a token for `chimodo` | The chimodo owner creates the token (Action required, above) |
| GitHub Pages on a free account needs a public repo | Pages can't be enabled on the private repo | Make the repo public, or use GitHub Pro or a Team plan |
| The AWS account's Lambda concurrency limit is low (often 10 on new accounts) | Reserved concurrency of 5 can't be set | `aws lambda get-account-settings` |
| React Native's built-in `URL` is incomplete, so the app needs a polyfill | None: the polyfill is installed either way | Already handled |
| Expo Go for SDK 57 opens the upgraded app | Teammates on SDK 54 Expo Go can't open the app | Each tester updates Expo Go |

## What's left, in priority order

- [x] **Commit and merge** the backend, `infra/`, `shared/` and app changes from `munashe`, so teammates use AWS too. Everyone runs `npm install` afterwards.
- [ ] **Run the end-to-end tests:** scan, report, maintainer approve and reject, and one nightly run. Delete the test reports afterwards.
- [ ] **Open the app in Expo Go 57** and check the dangerous, safe, suspicious and airplane-mode cases.
- [ ] **chimodo owner sets up GitHub Pages and the token** (Action required, above).
- [ ] **Add cost limits:** a $1 budget alert, and reserved concurrency of about 5 once the account's limit allows it.
- [ ] **Build the report screen:** buttons on results, category chips, a 280-character note, and a location toggle that is off by default. Add an `unchecked` tamper value so reports don't claim "no sticker" before sticker detection exists.
- [ ] **Add CORS to the function URL** if the web version of the app should work; browsers block it today.
- [ ] **Replace the placeholders:** the Tranco list, the tuning values, and the feed terms check.
- [ ] **Write unit tests** for `shared/` and the verifier.
- [ ] **Later, after a development build:** share-sheet intake, then sticker detection on the phone.
