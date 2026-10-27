// Settings shared by index.html and captcha.html.
// The Turnstile site key is public and belongs here; the secret key stays in AWS and never goes in this site.
// If apiBase changes, update connect-src in index.html's Content-Security-Policy too.
window.SAFESCAN_CONFIG = {
  apiBase: 'https://hggnmfb55rkvypwevw5owgj3y40srnpp.lambda-url.us-east-1.on.aws/',
  turnstileSiteKey: '0x4AAAAAAFne9NtSnmWy2ZEx',
};
