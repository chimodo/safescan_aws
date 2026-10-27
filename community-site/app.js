// SafeScan community website: home page (recent reports and a report form) and per-link pages.
// Everything from the API is shown with textContent, and submitted links are never made clickable.
'use strict';

(() => {
  const CONFIG = window.SAFESCAN_CONFIG || {};
  const API_BASE = String(CONFIG.apiBase || '').replace(/\/+$/, '');
  const SITE_KEY = CONFIG.turnstileSiteKey;

  // Same values as shared/community.ts. The server checks every limit again.
  const THREAT_TYPES = {
    phishing: 'Phishing',
    malware: 'Malware or virus',
    spam: 'Spam',
    adware: 'Adware',
    inappropriate: 'Inappropriate content',
    tampered_qr: 'Tampered QR code',
    other: 'Other',
  };
  const DETAILS_MAX_LENGTH = 1000;
  const SCREENSHOT_MAX_COUNT = 3;
  const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
  const SCREENSHOT_TYPES = ['image/jpeg', 'image/png'];

  const URL_HASH = /^[0-9a-f]{64}$/;
  const INSTALL_ID_KEY = 'safescan.installId';
  const VOTED_KEY = 'safescan.voted';
  const FLASH_KEY = 'safescan.flash';

  const main = document.getElementById('main');

  // ---------- DOM ----------

  /** Builds an element. Children that are strings become text nodes, never HTML. */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function storage(kind) {
    try {
      return kind === 'session' ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  }

  // ---------- Voter ID and API ----------

  let memoryInstallId = null;

  /** Random ID kept in this browser. The server stores only a keyed hash of it. */
  function installId() {
    const store = storage('local');
    try {
      const saved = store && store.getItem(INSTALL_ID_KEY);
      if (saved && /^[A-Za-z0-9-]{16,64}$/.test(saved)) return saved;
      const id = crypto.randomUUID();
      if (store) store.setItem(INSTALL_ID_KEY, id);
      return id;
    } catch {
      memoryInstallId = memoryInstallId || crypto.randomUUID();
      return memoryInstallId;
    }
  }

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function fallbackMessage(status) {
    if (status === 403) return 'The human check failed or expired. Please try again.';
    if (status === 404) return 'SafeScan couldn’t find that.';
    if (status === 429) return 'You’ve reached the hourly limit. Please try again later.';
    if (status >= 500) return 'SafeScan is having trouble right now. Please try again in a few minutes.';
    return `Something went wrong (error ${status}).`;
  }

  async function api(path, body) {
    const headers = { 'X-Install-Id': installId() };
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(API_BASE + path, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'SafeScan couldn’t be reached. Check your connection and try again.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data.error === 'string' && data.error ? data.error : fallbackMessage(response.status);
      throw new ApiError(response.status, message);
    }
    return data;
  }

  // ---------- Human check ----------

  // One widget per page. Each token works once, so the widget is reset after every report or vote.
  const captcha = { widgetId: null, token: null, onChange: () => {} };

  function waitForTurnstile(timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function check() {
        if (window.turnstile) resolve(window.turnstile);
        else if (Date.now() - started > timeoutMs) reject(new Error('Turnstile did not load'));
        else setTimeout(check, 100);
      })();
    });
  }

  async function mountCaptcha(container, onChange) {
    captcha.onChange = onChange;
    const setToken = (token) => {
      captcha.token = token;
      captcha.onChange();
    };
    try {
      const turnstile = await waitForTurnstile(15000);
      captcha.widgetId = turnstile.render(container, {
        sitekey: SITE_KEY,
        callback: (token) => setToken(token),
        'expired-callback': () => setToken(null),
        'error-callback': () => setToken(null),
      });
    } catch {
      container.replaceChildren(el('p', { class: 'error' }, 'The human check couldn’t load. Reload the page to try again.'));
    }
  }

  /** Returns the current token and resets the widget so the next request gets a fresh one */
  function takeToken() {
    const token = captcha.token;
    captcha.token = null;
    if (captcha.widgetId !== null && window.turnstile) window.turnstile.reset(captcha.widgetId);
    captcha.onChange();
    return token;
  }

  // ---------- Shared pieces ----------

  function flash(message) {
    const store = storage('session');
    try {
      if (store) store.setItem(FLASH_KEY, message);
    } catch { /* the message is a nicety */ }
  }

  function takeFlash() {
    const store = storage('session');
    try {
      const message = store && store.getItem(FLASH_KEY);
      if (store) store.removeItem(FLASH_KEY);
      return message;
    } catch {
      return null;
    }
  }

  function votedIds() {
    const store = storage('local');
    try {
      const parsed = JSON.parse((store && store.getItem(VOTED_KEY)) || '[]');
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }

  function rememberVote(reportId) {
    const store = storage('local');
    const ids = votedIds();
    ids.add(reportId);
    try {
      if (store) store.setItem(VOTED_KEY, JSON.stringify([...ids].slice(-500)));
    } catch { /* the server still refuses a second vote */ }
  }

  function linkPathFor(item) {
    if (typeof item.linkPath === 'string' && /^\/link\/[0-9a-f]{64}$/.test(item.linkPath)) return item.linkPath;
    return URL_HASH.test(item.urlHash) ? `/link/${item.urlHash}` : null;
  }

  /** The link as plain, selectable text; never an <a> */
  function plainUrl(url) {
    return el('p', { class: 'plain-url', title: 'Shown as text on purpose. SafeScan never opens submitted links.' }, url);
  }

  function threatLabel(item) {
    return item.threatLabel || THREAT_TYPES[item.threatType] || 'Other';
  }

  function tamperNote(item) {
    if (item.tamperWarning === 'likely') return el('p', { class: 'tamper' }, 'The app found signs of a sticker over the QR code.');
    if (item.tamperWarning === 'possible') return el('p', { class: 'tamper' }, 'The app found possible signs of a sticker over the QR code.');
    return null;
  }

  function setStatus(node, message, kind) {
    node.textContent = message || '';
    node.className = `status ${kind || ''}`.trim();
    node.hidden = !message;
  }

  // ---------- Home ----------

  function renderHome() {
    document.title = 'SafeScan Community';
    const flashMessage = takeFlash();
    const recentList = el('ul', { class: 'card-list', 'aria-live': 'polite' }, el('li', { class: 'muted' }, 'Loading recent reports…'));

    main.replaceChildren(
      el('section', { class: 'hero' },
        el('h1', null, 'Check what others found'),
        el('p', null, 'People share suspicious links they scanned with SafeScan. Reports raise a link’s warning level for everyone, and helpful votes raise it further.')),
      flashMessage ? el('p', { class: 'status success' }, flashMessage) : '',
      el('div', { class: 'columns' },
        el('section', { class: 'panel', 'aria-labelledby': 'report-title' },
          el('h2', { id: 'report-title' }, 'Report a link'),
          reportForm()),
        el('section', { class: 'panel', 'aria-labelledby': 'recent-title' },
          el('h2', { id: 'recent-title' }, 'Recent reports'),
          recentList)));

    loadRecent(recentList);
  }

  async function loadRecent(list) {
    try {
      const data = await api('/recent?limit=20');
      const items = Array.isArray(data && data.submissions) ? data.submissions : [];
      if (!items.length) {
        list.replaceChildren(el('li', { class: 'muted' }, 'No reports yet.'));
        return;
      }
      list.replaceChildren(...items.map((item) => {
        const path = linkPathFor(item);
        const body = [
          el('div', { class: 'item-head' },
            el('span', { class: 'chip' }, threatLabel(item)),
            el('span', { class: 'muted' }, formatDate(item.createdAt))),
          el('p', { class: 'plain-url' }, String(item.url || '')),
          item.details ? el('p', { class: 'details clamp' }, item.details) : null,
          el('p', { class: 'muted small' }, plural(Number(item.helpfulVotes) || 0, 'helpful vote', 'helpful votes')),
        ];
        // The card links to SafeScan's own page for the link, never to the link itself
        return el('li', { class: 'card' }, path ? el('a', { class: 'card-link', href: path }, body) : body);
      }));
    } catch (error) {
      list.replaceChildren(el('li', { class: 'error' }, error.message));
    }
  }

  function parseLink(value) {
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    try {
      const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function reportForm() {
    const urlInput = el('input', { id: 'report-url', name: 'url', type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', maxlength: 2048, placeholder: 'https://example.com/login', required: true });
    const threatChips = el('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'threat-label' },
      Object.entries(THREAT_TYPES).map(([value, label]) =>
        el('label', { class: 'chip-option' },
          el('input', { type: 'radio', name: 'threatType', value, required: true }),
          el('span', null, label))));
    const details = el('textarea', { id: 'report-details', name: 'details', rows: 4, maxlength: DETAILS_MAX_LENGTH, placeholder: 'Where did you find it? What did it ask for?' });
    const counter = el('span', { class: 'muted small', 'aria-live': 'polite' }, `0/${DETAILS_MAX_LENGTH}`);
    details.addEventListener('input', () => { counter.textContent = `${details.value.length}/${DETAILS_MAX_LENGTH}`; });
    const files = el('input', { id: 'report-files', name: 'screenshots', type: 'file', accept: SCREENSHOT_TYPES.join(','), multiple: true });
    const captchaBox = el('div', { class: 'captcha' });
    const status = el('p', { class: 'status', role: 'alert', hidden: true });
    const submit = el('button', { type: 'submit', class: 'button primary', disabled: true }, 'Share report');

    const form = el('form', { novalidate: true },
      el('label', { for: 'report-url' }, 'Link'),
      urlInput,
      el('p', { id: 'threat-label', class: 'label' }, 'Threat type'),
      threatChips,
      el('div', { class: 'label-row' }, el('label', { for: 'report-details' }, 'Details (optional)'), counter),
      details,
      el('label', { for: 'report-files' }, `Screenshots (optional, up to ${SCREENSHOT_MAX_COUNT})`),
      files,
      el('p', { class: 'muted small' }, 'JPEG or PNG, 5 MB each. Screenshots appear after a maintainer approves them. Location and device details are removed.'),
      el('p', { class: 'label' }, 'Human check'),
      captchaBox,
      status,
      submit);

    const busy = { value: false };
    const refreshSubmit = () => { submit.disabled = busy.value || !captcha.token; };
    mountCaptcha(captchaBox, refreshSubmit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const url = parseLink(urlInput.value);
      const threat = form.querySelector('input[name="threatType"]:checked');
      const chosen = [...files.files];
      let problem = null;
      if (!url) problem = 'Enter a web address that starts with http:// or https://.';
      else if (!threat) problem = 'Choose a threat type.';
      else if (details.value.length > DETAILS_MAX_LENGTH) problem = `Details can be up to ${DETAILS_MAX_LENGTH} characters.`;
      else if (chosen.length > SCREENSHOT_MAX_COUNT) problem = `Choose up to ${SCREENSHOT_MAX_COUNT} screenshots.`;
      else if (chosen.some((file) => !SCREENSHOT_TYPES.includes(file.type))) problem = 'Screenshots must be JPEG or PNG images.';
      else if (chosen.some((file) => file.size > SCREENSHOT_MAX_BYTES)) problem = 'Each screenshot must be 5 MB or less.';
      else if (!captcha.token) problem = 'Complete the human check first.';
      if (problem) {
        setStatus(status, problem, 'error');
        return;
      }

      busy.value = true;
      submit.textContent = 'Sharing…';
      refreshSubmit();
      setStatus(status, '');
      try {
        const report = await api('/report', {
          url,
          threatType: threat.value,
          details: details.value.trim(),
          tamperWarning: 'unchecked',
          screenshotTypes: chosen.map((file) => file.type),
          captchaToken: takeToken(),
        });
        const failed = await uploadScreenshots(report.uploads, chosen, (done, total) => {
          setStatus(status, `Uploading screenshot ${done + 1} of ${total}…`);
        });
        const notes = ['Thanks, your report is live.'];
        if (chosen.length) notes.push('Screenshots appear after a maintainer approves them.');
        if (failed) notes.push(`${plural(failed, 'screenshot', 'screenshots')} couldn’t be uploaded.`);
        flash(notes.join(' '));
        location.assign(linkPathFor(report) || '/');
      } catch (error) {
        const retry = error.status === 403 ? ' Complete the human check again, then resend.' : '';
        setStatus(status, error.message + retry, 'error');
        busy.value = false;
        submit.textContent = 'Share report';
        refreshSubmit();
      }
    });

    return form;
  }

  /** S3 presigned POST for each slot: every policy field first, then the file. Returns how many failed. */
  async function uploadScreenshots(uploads, chosen, onProgress) {
    const slots = Array.isArray(uploads) ? uploads : [];
    let failed = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const file = chosen[slot.slot];
      if (!file || typeof slot.url !== 'string') {
        failed += 1;
        continue;
      }
      onProgress(i, slots.length);
      const form = new FormData();
      for (const [key, value] of Object.entries(slot.fields || {})) form.append(key, value);
      form.append('file', file);
      try {
        const response = await fetch(slot.url, { method: 'POST', body: form });
        if (response.status !== 204) failed += 1;
      } catch {
        failed += 1;
      }
    }
    return failed;
  }

  // ---------- Link page ----------

  function renderLinkPage(urlHash) {
    document.title = 'Link reports · SafeScan Community';
    const flashMessage = takeFlash();
    const verdictBox = el('div', { 'aria-live': 'polite' }, el('p', { class: 'muted' }, 'Loading…'));
    const submissionsBox = el('div');
    const voteStatus = el('p', { class: 'status', role: 'status', hidden: true });
    const captchaBox = el('div', { class: 'captcha' });
    const votePanel = el('section', { class: 'panel', 'aria-labelledby': 'reports-title', hidden: true },
      el('h2', { id: 'reports-title' }, 'Reports'),
      el('p', { class: 'muted small' }, 'Complete the human check, then mark the reports you found helpful. Each vote needs a fresh check.'),
      captchaBox,
      voteStatus,
      submissionsBox);

    main.replaceChildren(
      el('p', null, el('a', { href: '/', class: 'back' }, '← All reports')),
      flashMessage ? el('p', { class: 'status success' }, flashMessage) : '',
      verdictBox,
      votePanel);

    loadLink({ urlHash, verdictBox, submissionsBox, voteStatus, votePanel, captchaBox, captchaMounted: false });
  }

  async function loadLink(page) {
    let data;
    try {
      data = await api(`/link/${page.urlHash}`);
    } catch (error) {
      page.verdictBox.replaceChildren(error.status === 404
        ? el('section', { class: 'panel' },
            el('h1', null, 'SafeScan hasn’t seen this link yet'),
            el('p', null, 'No one has scanned or reported it. If you think it’s harmful, report it from the home page.'),
            el('a', { href: '/', class: 'button' }, 'Report a link'))
        : el('p', { class: 'error' }, error.message));
      return;
    }

    page.verdictBox.replaceChildren(verdictCard(data));
    renderSubmissions(page, Array.isArray(data.submissions) ? data.submissions : []);
    page.votePanel.hidden = false;
    if (!page.captchaMounted) {
      page.captchaMounted = true;
      mountCaptcha(page.captchaBox, () => {});
    }
  }

  function verdictCard(data) {
    const level = [1, 2, 3, 4].includes(data.level) ? data.level : 1;
    const counts = data.counts || {};
    const reasons = Array.isArray(data.reasons) ? data.reasons.filter((reason) => typeof reason === 'string') : [];
    return el('section', { class: `verdict level-${level}` },
      el('p', { class: 'level-badge' }, `Level ${level} of 4`),
      el('h1', null, data.levelLabel || ['No known threats', 'Use caution', 'Very suspicious', 'Likely malicious'][level - 1]),
      plainUrl(String(data.url || '')),
      data.limited ? el('p', { class: 'small' }, 'Limited check: Google Safe Browsing couldn’t be reached, so no threat database was checked.') : null,
      reasons.length ? el('ul', { class: 'reasons' }, reasons.map((reason) => el('li', null, reason))) : null,
      el('p', { class: 'counts' },
        `${plural(Number(counts.submissions) || 0, 'report', 'reports')} · ${plural(Number(counts.votes) || 0, 'helpful vote', 'helpful votes')}`));
  }

  function renderSubmissions(page, submissions) {
    if (!submissions.length) {
      page.submissionsBox.replaceChildren(el('p', { class: 'muted' }, 'No one has reported this link yet.'));
      return;
    }
    const voted = votedIds();
    page.submissionsBox.replaceChildren(el('ul', { class: 'card-list' }, submissions.map((item) => {
      const votes = Number(item.helpfulVotes) || 0;
      const alreadyVoted = voted.has(item.reportId);
      const button = el('button', {
        type: 'button',
        class: 'button',
        disabled: item.isYours || alreadyVoted,
      }, item.isYours ? 'Your report' : alreadyVoted ? 'Voted helpful' : 'Helpful');
      button.addEventListener('click', () => vote(page, item.reportId, button));

      const screenshots = Array.isArray(item.screenshots) ? item.screenshots : [];
      return el('li', { class: 'card' },
        el('div', { class: 'item-head' },
          el('span', { class: 'chip' }, threatLabel(item)),
          el('span', { class: 'muted' }, formatDate(item.createdAt))),
        item.details ? el('p', { class: 'details' }, item.details) : el('p', { class: 'muted small' }, 'No details given.'),
        tamperNote(item),
        screenshotGrid(screenshots),
        el('div', { class: 'item-foot' },
          el('span', { class: 'muted' }, plural(votes, 'person found this helpful', 'people found this helpful')),
          button));
    })));
  }

  /** Only addresses from the API's screenshots list. They expire after 15 minutes, so they're never stored. */
  function screenshotGrid(screenshots) {
    const images = screenshots
      .filter((shot) => shot && typeof shot.url === 'string' && shot.url.startsWith('https://'))
      .map((shot, i) => el('img', {
        src: shot.url,
        alt: `Screenshot ${i + 1} from this report`,
        width: Number(shot.width) || null,
        height: Number(shot.height) || null,
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      }));
    return images.length ? el('div', { class: 'shots' }, images) : null;
  }

  async function vote(page, reportId, button) {
    if (!captcha.token) {
      setStatus(page.voteStatus, 'Complete the human check above first.', 'error');
      return;
    }
    button.disabled = true;
    setStatus(page.voteStatus, '');
    try {
      await api('/vote', { reportId, captchaToken: takeToken() });
      rememberVote(reportId);
      setStatus(page.voteStatus, 'Thanks for your vote.', 'success');
      await loadLink(page);
    } catch (error) {
      if (error.status === 409) {
        rememberVote(reportId);
        button.textContent = 'Voted helpful';
        setStatus(page.voteStatus, error.message, 'error');
        return;
      }
      if (error.status === 403 && /own/i.test(error.message)) {
        button.textContent = 'Your report';
        setStatus(page.voteStatus, error.message, 'error');
        return;
      }
      if (error.status === 404) {
        setStatus(page.voteStatus, error.message, 'error');
        await loadLink(page);
        return;
      }
      button.disabled = false;
      const retry = error.status === 403 ? ' Complete the human check again, then vote.' : '';
      setStatus(page.voteStatus, error.message + retry, 'error');
    }
  }

  // ---------- Routing ----------

  function renderNotFound() {
    document.title = 'Not found · SafeScan Community';
    main.replaceChildren(el('section', { class: 'panel' },
      el('h1', null, 'Page not found'),
      el('a', { href: '/', class: 'button' }, 'Go to the community home page')));
  }

  // CloudFront serves index.html for every address without a file, so the path picks the page
  const path = location.pathname;
  const link = /^\/link\/([0-9a-f]{64})\/?$/.exec(path);
  if (link) renderLinkPage(link[1]);
  else if (path.startsWith('/link/')) {
    document.title = 'Link reports · SafeScan Community';
    main.replaceChildren(el('section', { class: 'panel' },
      el('h1', null, 'SafeScan hasn’t seen this link yet'),
      el('a', { href: '/', class: 'button' }, 'Go to the community home page')));
  } else if (path === '/' || path === '/index.html') renderHome();
  else renderNotFound();
})();
