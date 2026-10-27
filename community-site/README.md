# SafeScan community website

Plain HTML and JavaScript, served from S3 through CloudFront at https://dyyaknu678lsn.cloudfront.net.
CloudFront serves `index.html` for any address without a file, so `app.js` picks the page from `location.pathname`.

| File | Purpose |
| --- | --- |
| `index.html`, `app.js`, `style.css` | Home page (`/`) and link pages (`/link/<urlHash>`) |
| `captcha.html` | Turnstile bridge for the app's share screen; posts `{ token }`, `{ expired: true }` or `{ error: true }` to `window.ReactNativeWebView` |
| `config.js` | API base URL and the Turnstile **site** key (public). Never put the secret key here. |

Before publishing, set `turnstileSiteKey` in `config.js` (Cloudflare → Turnstile → SafeScan widget), and make sure the widget's hostnames include `dyyaknu678lsn.cloudfront.net` and `localhost`.

## Test locally

```sh
npx serve -s community-site -l 8080
# -s serves index.html for /link/... paths, like CloudFront
```

The API allows browser calls from the CloudFront site and http://localhost:8080 only.

## Publish

```sh
aws s3 sync community-site s3://infrastack-communitysitec4341af2-9nvynpxxogvh --delete --exclude README.md
aws cloudfront create-invalidation --distribution-id E3VOJI7SJATCWJ --paths "/*"
```
