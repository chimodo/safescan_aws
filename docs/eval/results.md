# Scan evaluation results

Run 2026-10-27T06:18:29.344Z against `https://hggnmfb55rkvypwevw5owgj3y40srnpp.lambda-url.us-east-1.on.aws/` by `docs/eval/evaluate-scan.mjs`.

**12 of 15 cases matched the expected level.** Median latency: 118 ms on first scan, 61 ms on repeat (13 of 13 repeats served from the cache). Latency is measured from the test machine and includes its network.

| Group | Link | Expected | Got | First ms | Repeat ms | Cached | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Known threat (Google test page) | `http://testsafebrowsing.appspot.com/s/phishing.html` | 4 | 4 Likely malicious | 452 | 152 | true | Pass |
| Known threat (Google test page) | `http://testsafebrowsing.appspot.com/s/malware.html` | 4 | 4 Likely malicious | 118 | 82 | true | Pass |
| Known threat (Google test page) | `http://testsafebrowsing.appspot.com/s/unwanted.html` | 4 | 4 Likely malicious | 118 | 79 | true | Pass |
| Known threat (Google test page) | `http://testsafebrowsing.appspot.com/s/social_engineering_extended_report.html` | 4 | 1 No known threats | 121 | 62 | true | **Fail** |
| Popular site | `https://www.wikipedia.org/` | 1 | 1 No known threats | 57 | 60 | true | Pass |
| Popular site | `https://github.com/` | 1 | 1 No known threats | 139 | 59 | true | Pass |
| Popular site | `https://www.bbc.co.uk/news` | 1 | 1 No known threats | 119 | 65 | true | Pass |
| Popular site | `https://www.google.com/search?q=safescan&utm_source=qr` | 1 | 1 No known threats | 138 | 56 | true | Pass |
| Suspicious pattern (made up, not registered) | `http://192.168.4.20/bank/login` | 2 | 2 Use caution | 119 | 61 | true | Pass |
| Suspicious pattern (made up, not registered) | `https://paypal-secure-login.verify-account-update.xyz/signin` | 2 | 1 No known threats | 98 | 60 | true | **Fail** |
| Suspicious pattern (made up, not registered) | `https://xn--pple-43d.com/id/login` | 2 | 2 Use caution | 100 | 60 | true | Pass |
| Suspicious pattern (made up, not registered) | `http://login-microsoftonline.com.account-verify.top/` | 2 | 1 No known threats | 124 | 57 | true | **Fail** |
| Community-reported | `https://evil_site.com/` | 2 | 2 Use caution | 58 | 79 | true | Pass |
| Not a web link | `WIFI:S:CafeGuest;T:WPA;P:hunter22;;` | 400 | 400 Body must include a valid http(s) url | 45 |  |  | Pass |
| Not a web link | `javascript:alert(1)` | 400 | 400 Body must include a valid http(s) url | 53 |  |  | Pass |

## Reasons returned

- `http://testsafebrowsing.appspot.com/s/phishing.html`: Google Safe Browsing: SOCIAL_ENGINEERING
- `http://testsafebrowsing.appspot.com/s/malware.html`: Google Safe Browsing: MALWARE
- `http://testsafebrowsing.appspot.com/s/unwanted.html`: Google Safe Browsing: UNWANTED_SOFTWARE
- `http://192.168.4.20/bank/login`: Uses an IP address instead of a domain name; Mentions login or payment
- `https://paypal-secure-login.verify-account-update.xyz/signin`: Uncommon domain ending .xyz; Mentions login or payment
- `https://xn--pple-43d.com/id/login`: Uses international characters that can imitate another domain; Mentions login or payment
- `http://login-microsoftonline.com.account-verify.top/`: Uncommon domain ending .top; Mentions login or payment
- `https://evil_site.com/`: Shared 1 time by the SafeScan community
