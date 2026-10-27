# SafeScan API

One Lambda function URL serves every route. The base URL is the `ScanUrl` output of `InfraStack`.

Every request that writes data needs:

- An `X-Install-Id` header: a random UUID made once per app install, or once per browser and kept in `localStorage`. The backend stores only a keyed hash of it.
- A `captchaToken` in the body, from the Turnstile widget (or hCaptcha, if the stack is deployed with `-c captchaProvider=hcaptcha`). Without a valid token, the write is refused with `403`.

Show every string from this API as plain text. Never insert submitted text or links as HTML, and never make submitted links clickable.

## Verdict levels

| `level` | `levelLabel` | Set by |
| --- | --- | --- |
| 1 | No known threats | Nothing reported |
| 2 | Use caution | Heuristics, or at least 1 community submission |
| 3 | Very suspicious | At least 1 submission and 10 helpful votes in total |
| 4 | Likely malicious | Google Safe Browsing, a threat feed, or a maintainer |

Community activity never reaches level 4, and never changes a popular domain. The submission and vote thresholds are set at deploy time with `-c communityRule='{"minSubmissions":1,"minVotes":10}'`.

`verdict` (`SAFE`, `SUSPICIOUS` or `DANGEROUS`) is still returned for older app builds: level 4 is `DANGEROUS`, levels 2 and 3 are `SUSPICIOUS`, and level 1 is `SAFE`.

## POST /scan

```json
{ "url": "https://example.com/menu" }
```

Returns `200`:

```json
{
  "url": "https://example.com/menu",
  "verdict": "SUSPICIOUS",
  "level": 2,
  "levelLabel": "Use caution",
  "score": 40,
  "reasons": ["Shared 1 time by the SafeScan community"],
  "limited": false,
  "cached": true,
  "community": { "submissions": 1, "votes": 0 }
}
```

`limited: true` means Safe Browsing couldn't be reached, so no threat database was checked.

## POST /report

Shares a link with the community. Needs `X-Install-Id` and `captchaToken`.

```json
{
  "url": "https://bad.example/login",
  "threatType": "phishing",
  "details": "Arrived in the school email incident",
  "tamperWarning": "unchecked",
  "captchaToken": "<token from the widget>"
}
```

- `threatType`: `phishing`, `malware`, `spam`, `adware`, `inappropriate`, `tampered_qr` or `other`. Labels are in `shared/community.ts`.
- `details`: optional, up to 1,000 characters.
- `tamperWarning`: optional. `unchecked` (the default), `none`, `possible` or `likely`. Send `unchecked` unless sticker detection ran.
- `screenshotTypes`: optional. One entry per screenshot you'll upload, up to 3, each `image/jpeg` or `image/png`, for example `["image/png", "image/jpeg"]`.

Returns `201`:

```json
{
  "ok": true,
  "reportId": "8a1f…",
  "urlHash": "3c9e…",
  "linkPath": "/link/3c9e…",
  "uploads": [
    { "slot": 0, "contentType": "image/png", "url": "https://….s3.amazonaws.com/", "fields": { "key": "uploads/8a1f…/0", "Content-Type": "image/png", "Policy": "…", "X-Amz-Signature": "…" }, "expiresInSeconds": 600 }
  ],
  "uploadRules": { "maxBytes": 5242880, "types": ["image/jpeg", "image/png"] }
}
```

Use `linkPath` for the "See what others said" link. Submissions show publicly right away; maintainers can hide them.

### Uploading screenshots

For each entry in `uploads`, send one `multipart/form-data` POST to its `url`, within 10 minutes:

1. Add every entry of `fields` as a form field, unchanged.
2. Add the image last, as the field `file`. It must match the slot's `contentType` and be at most 5 MB.

S3 answers `204` on success. A wrong type or a file over 5 MB is refused by S3 itself, and each slot takes only one upload.

```js
const form = new FormData();
for (const [k, v] of Object.entries(slot.fields)) form.append(k, v);
form.append('file', imageBlob);            // in React Native: { uri, name: 'shot.png', type: slot.contentType }
await fetch(slot.url, { method: 'POST', body: form });
```

After upload, the server checks that the file really is a JPEG or PNG no larger than 8000×8000, and removes its metadata, including location, device and time. Screenshots stay hidden until a maintainer approves them, so don't show them as part of the submission straight away. Removing metadata also drops photo orientation, so a sideways phone photo may show sideways; re-encoding photos upright before upload avoids that.

## POST /vote

Marks one submission helpful. Needs `X-Install-Id` and `captchaToken`.

```json
{ "reportId": "8a1f…", "captchaToken": "<token from the widget>" }
```

Returns `200` `{ "ok": true, "helpfulVotes": 4 }`, `409` if this install already voted on it, `403` for your own submission, or `404` if it's hidden or doesn't exist.

## GET /link/{urlHash}

`urlHash` is the 64-character SHA-256 from `/scan` or `/report`. Send `X-Install-Id` if you have one, so `isYours` is set.

Returns `200`:

```json
{
  "urlHash": "3c9e…",
  "url": "https://bad.example/login",
  "level": 3,
  "levelLabel": "Very suspicious",
  "verdict": "SUSPICIOUS",
  "score": 75,
  "reasons": ["Shared 2 times by the SafeScan community", "12 people found these reports helpful"],
  "limited": false,
  "counts": { "submissions": 2, "votes": 12 },
  "submissions": [
    {
      "reportId": "8a1f…",
      "threatType": "phishing",
      "threatLabel": "Phishing",
      "details": "Arrived in the school email incident",
      "tamperWarning": "unchecked",
      "helpfulVotes": 9,
      "createdAt": "2026-10-26T21:14:03.120Z",
      "isYours": false,
      "screenshots": [{ "url": "https://….s3.amazonaws.com/approved/…?X-Amz-…", "width": 1080, "height": 2125 }]
    }
  ]
}
```

Submissions are sorted by helpful votes, then newest first. `screenshots` lists only maintainer-approved images; each `url` works for 15 minutes, so load the page's data again rather than storing the links. Returns `404` if SafeScan has never seen the link.

## GET /recent?limit=20

The newest visible submissions across all links, for the community home page. `limit` is 1 to 50.

Returns `200` `{ "submissions": [ … ] }`. Each item has the same fields as a submission above, plus `url`, `urlHash` and `linkPath`.

## Errors

Every error is JSON: `{ "error": "<message for the person>" }`.

| Status | Meaning |
| --- | --- |
| 400 | Missing or invalid field; the message says which |
| 403 | Human check failed, or voting on your own submission |
| 404 | Unknown route, link or submission |
| 409 | Already voted |
| 429 | Rate limit: per hour, 120 scans, 10 reports and 60 votes per install, with looser limits per IP |
| 503 | Human check or hashing secret unavailable; try again later |

## Calling it from the website

The function URL allows CORS from the CloudFront site (`SiteUrl` output). For local development, deploy with `-c corsOrigins=http://localhost:8080`. Allowed headers are `Content-Type` and `X-Install-Id`.
