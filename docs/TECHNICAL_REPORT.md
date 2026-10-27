# SafeScan: Technical Report

Check a QR code before you open it. Repository: https://github.com/chimodo/safescan_aws · Live community site: https://dyyaknu678lsn.cloudfront.net

## 1. Problem

QR codes have replaced links that people could read. A code on a parking meter, a restaurant table or a flyer hides its destination until the phone has already opened it. Attackers exploit this ("quishing") in two ways: they print codes that point to phishing pages, and they paste a sticker with their own code over a legitimate one. Email and browser filters rarely see these links, because the user reaches them from a camera app.

SafeScan sits between the camera and the browser. It decodes the code, tells the person what the link is and how risky it looks, checks for a pasted-over sticker, and only then lets them choose to open it.

## 2. Users

- **People scanning codes in public:** parking, payments, menus, posters. They need a quick, plain answer and a safe default (not opening the link).
- **People who've been caught out, or nearly were:** they can share the link with the community, with a description and screenshots, so the next person gets a warning.
- **Maintainers:** a small trusted group who approve screenshots and hide abusive or wrong reports.

## 3. Architecture

The [README](../README.md#architecture) has the full diagram. In brief:

| Part | Technology | Role |
| --- | --- | --- |
| Mobile app | Expo SDK 57, React Native 0.86, expo-camera | Scans QR codes and barcodes, shows the verdict, opens links only after confirmation, shares reports |
| On-device vision | OpenCV 5.0.0 via `react-native-fast-opencv` (JSI) | Sticker-edge check on a still capture; the image never leaves the phone |
| Shared rules | TypeScript in `shared/` | URL normalization, heuristics, verdict levels and limits, compiled into both the app and the Lambda so they agree |
| API | AWS Lambda function URL (Node 22, arm64) | `/scan`, `/report`, `/vote`, `/link/{hash}`, `/recent` |
| Data | DynamoDB (5 tables), S3 (screenshots, website), SSM Parameter Store (secrets) | Verdict cache, reports, votes, rate limits, hotspot counts |
| Background jobs | DynamoDB stream to VerifierFn; S3 event to ShotProcessorFn; EventBridge Scheduler to NightlyFn | Report verification, screenshot cleaning, nightly threat-feed load |
| Website | Static HTML/JS on S3 behind CloudFront | Recent reports, per-link pages, helpful votes, and the human-check bridge used by the app |
| External | Google Safe Browsing, OpenPhish, URLhaus, Cloudflare Turnstile | Threat data and abuse protection |

Everything on AWS is one CDK stack in TypeScript (`infra/lib/infra-stack.ts`), sized to stay inside the free tier: DynamoDB capacity is fixed below the free 25 read and write units, with auto scaling off.

### Scan flow

1. The camera decodes a code. The app shows the decoded text and outlines the code live. It clears the result 500 ms after the code leaves view, so it can never verify a previous code.
2. When the person taps Verify, the app captures a still for the sticker check (QR codes only), normalizes the URL, and scores it with the shared heuristics.
3. `POST /scan` returns a level from 1 to 4 (table in the README). The Lambda recomputes the URL hash itself and ignores anything the phone claims, so one phone can't mark a link safe for everyone.
4. If the backend or Safe Browsing can't be reached, the app shows a **limited** result based on heuristics only. A limited "safe" result shows as **Not verified**, never as safe.
5. Opening the link always goes through the phone's browser. Anything other than "No known threats" first asks "Are you sure?", with Go back as the default.

### Community flow

A report carries the link, one of seven threat types, optional details (up to 1,000 characters) and up to 3 screenshots. It requires a Cloudflare Turnstile token, checked on the server before anything is saved. Screenshots are uploaded straight to S3 with presigned POSTs limited to 5 MB and JPEG or PNG. A processor then confirms the real file type, caps dimensions at 8000×8000 and strips all metadata, including location. Screenshots stay hidden until a maintainer approves them. Other people mark reports as helpful, one vote per device per report, and never on their own report. One visible report raises a link to level 2, and 10 helpful votes in total raise it to level 3.

## 4. OpenCV implementation

The sticker check runs on the phone in `frontend/features/qr-tamper/` (`opencv.native.ts`), through `react-native-fast-opencv`, a JSI binding to native OpenCV. The app links **OpenCV 5.0.0** (`org.opencv:opencv:5.0.0`). The binding ships with OpenCV 4.12, so `frontend/patches/react-native-fast-opencv+1.0.1.patch` points its Android build at the OpenCV 5 package (`opencv_java5`). `patch-package` applies the patch on every `npm install`, including on the EAS build servers.

1. **Capture:** one still frame (`takePictureAsync`) after a 250 ms settle. QR corners are detected again in that still (`scanFromURLAsync`), rather than mapped from the live preview, so the corners match the analysed image.
2. **Rectify:** a perspective warp maps the QR and its surroundings to a 960×960 image, with the QR occupying 640 pixels. Its quiet zone and the band where a sticker's edge would fall then sit at known positions.
3. **Normalize:** a 2nd-to-98th-percentile intensity stretch reduces lighting differences between captures.
4. **Measure:** Sobel gradients across the QR boundary. On textured surroundings, the check compares the low-gradient pattern inside the QR with an outer ring, because a sticker's smooth paper differs from the surface around it. On white or low-texture surroundings, it uses a normalized boundary-profile check that looks for an edge or contact shadow.
5. **Report:** a "possible sticker" flag, the measurements and timings. These are stored locally for a developer diagnostics screen that computes a confusion matrix from user-labelled trials. Captured images are not saved.

The algorithm uses core OpenCV operations (perspective transform, Sobel, percentile statistics), whose behaviour is unchanged in OpenCV 5. OpenCV 5 keeps the `features2d.hpp` and `calib3d.hpp` compatibility headers that the binding includes, so its C++ code needs no changes.

Before the method was ported to the phone, it was prototyped offline in Python with OpenCV, following the experiment plan in `examples/ANALYSIS_AGENT_INSTRUCTIONS.md`. That plan compares masking, global and adaptive thresholds, Canny, Sobel and contour filtering on the labelled positive and negative images in `examples/`.

## 5. AWS deployment

| Resource | Configuration |
| --- | --- |
| Region | us-east-1, one stack (`InfraStack`) |
| ScanFn | Lambda function URL, Node 22, arm64, CORS restricted to the community site |
| VerifierFn | Triggered by the Reports table stream; re-checks reported links |
| ShotProcessorFn | Triggered by S3 uploads; validates and re-encodes screenshots |
| NightlyFn | EventBridge Scheduler at 03:00 UTC, one retry; loads OpenPhish and URLhaus (up to 3,000 URLs), counts hotspots |
| DynamoDB | UrlVerdicts (cache), Reports (3 indexes), Community, RateLimits, HotspotAggregates |
| S3 + CloudFront | Website bucket behind CloudFront (unknown paths serve `index.html` for `/link/...`); private screenshots bucket with presigned access |
| Secrets | SSM SecureString: Safe Browsing key, hash pepper, Turnstile secret, GitHub token |
| Limits | Per device per hour: 120 scans, 10 reports, 60 votes, plus looser per-IP limits |

Deployment steps are in the [README](../README.md#deploy).

## 6. Evaluation

### Link verdicts (live system)

`docs/eval/evaluate-scan.mjs` scans 15 labelled links against the deployed API, twice each, and records the level, latency and cache use. Full results are in [docs/eval/results.md](eval/results.md).

**12 of 15 matched the expected level.**

| Group | Cases | Matched |
| --- | --- | --- |
| Known threats (Google Safe Browsing test pages) | 4 | 3 |
| Popular sites, including a tracking parameter | 4 | 4 |
| Made-up suspicious links (IP host, punycode lookalike, brand in subdomain, uncommon TLD) | 4 | 2 |
| Community-reported link | 1 | 1 |
| Not a web link (Wi-Fi QR, `javascript:`) | 2 | 2 (refused with 400) |

Median latency from the test machine was 118 ms for a first scan and 61 ms for a repeat, with all 13 repeats served from the DynamoDB cache. Both figures include the network round trip.

**Failure cases:**
- **Safe Browsing's "extended report" social-engineering test page scored level 1.** Our lookup uses the standard threat lists, which don't include that extended-coverage test. A real page listed only in extended coverage would be missed in the same way.
- **`paypal-secure-login.verify-account-update.xyz/signin` scored level 1.** It has an uncommon TLD and login words, but together they stayed under the suspicious threshold of 40. Brand names in hostnames aren't scored.
- **`login-microsoftonline.com.account-verify.top` scored level 1.** It's the same kind of gap: a brand domain used as a subdomain of an attacker's domain isn't detected.

These made-up links aren't in any threat list, so heuristics are the only defence until someone reports them. That's exactly the gap the community features are designed to close.

### Community features (live system)

Tested end to end on the deployed stack: a report submitted through the website appeared on the home page and on the link's page. One report moved the link from level 1 to **Use caution** (level 2), both on the website and in `POST /scan`. The server refused fake human-check tokens with 403 before saving anything, and refused non-web QR payloads with 400.

### Sticker check

The detector was developed on one labelled positive and one labelled negative image (`examples/`). Two images can't show accuracy, so we don't report an accuracy figure. The app records sticker trials with optional user feedback ("sticker present or not"), and the Developer mode screen computes a confusion matrix from them. **Known failure:** the TypeScript port is less accurate than the Python prototype on the hardest case, a white sticker on white paper. There the edge and shadow signal is close to the noise.

## 7. Limitations

- **Coverage:** detection of brand-new phishing links depends on heuristics and community reports. The heuristics miss brand-in-subdomain and some lookalike patterns (above).
- **Sticker check:** experimental. It isn't calibrated or validated on a meaningful dataset, and white-on-white is unreliable. It's shown as a hint, never as a verdict.
- **OpenCV on iOS:** the patch covers Android only. The iOS build still uses the prebuilt OpenCV framework in the binding's `FastOpenCV-iOS` 1.0.4 pod, and the Android build with OpenCV 5 has not yet been run on a device.
- **Tuning values are placeholders:** the suspicious threshold (40), the community thresholds (1 report, 10 votes) and the 20-domain "popular" list, which should be a real top-sites list such as Tranco.
- **Platforms:** tested on Android. The iOS build is configured but untested, and the sticker check and human check need a native build, not Expo Go or the web.
- **Safe Browsing terms:** the Lookup API is free for non-commercial use only. A commercial launch would need Google Web Risk.
- **Community reports can be wrong or malicious:** see below for the protections. A determined group with many devices could still push a little-known site to level 3.

## 8. Responsible use

- **SafeScan never visits a link.** It checks the link text against threat data and opens it only in the person's own browser, after they choose to.
- **No false reassurance.** The best label is "No known threats", not "safe". A check that couldn't reach the threat database is shown as Not verified, and every result explains what was and wasn't checked.
- **Privacy:**
  - Install IDs and IP addresses are stored only as hashes keyed with a secret pepper.
  - Scan history stays on the phone and keeps only the domain.
  - Tracking parameters are removed before lookup.
  - Sticker-check images stay on the device.
  - Screenshot metadata, including location, is stripped.
  - No location is collected with reports.
- **Abuse resistance:**
  - Every report and vote needs a human check and is rate-limited per device and per IP.
  - Community activity can never reach "Likely malicious".
  - Popular domains can't be pushed up by votes at all.
  - Reporters can't vote on their own reports.
  - Maintainers can hide reports, and screenshots need maintainer approval.
- **Untrusted content is treated as untrusted:**
  - The website inserts submitted text as plain text, never as HTML.
  - Submitted links are never clickable.
  - Images load only from the API's own short-lived URLs.
  - A Content-Security-Policy limits scripts and connections.
- **Cost safety:** fixed DynamoDB capacity, limits on every write, and a design that stays inside the AWS free tier.

## 9. Future work

- Package OpenCV 5 for iOS, and collect a labelled set of real sticker and non-sticker captures to calibrate it.
- Add brand-in-subdomain and lookalike-domain scoring, and replace the popular-domain list with the Tranco top 10,000.
- Feed the sticker check result into reports (`tamperWarning`), which today is always "unchecked".
- Publish the nightly hotspot map, and add a budget alarm and reserved concurrency.
