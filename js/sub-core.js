/* Safety Union Backup – shared interactions */
const IC = {
  home: '<path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  shield: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 8v5M12 17h.01"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  credit: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'
};

const svg = (n, sw = 1.8) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function seg(id, cb) {
  const g = $(id);
  if (!g) return;
  g.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    if (cb) cb(b.dataset.v);
  });
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID();

/* ---------- API client: same-origin, HttpOnly cookies, no tokens in JS ---------- */
class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
const Api = {
  async call(method, path, body, idem) {
    const r = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, d.error || 'error', d.message);
    return d;
  },
  get: p => Api.call('GET', p),
  post: (p, b, idem) => Api.call('POST', p, b ?? {}, idem),
  del: p => Api.call('DELETE', p)
};

let _cfg;
async function getConfig() { return _cfg || (_cfg = await Api.get('/config')); }

function money(minor, cur) {
  cur = cur || (_cfg && _cfg.fees.currency) || 'NGN';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(minor / 100);
}
const parseMajor = v => Math.round(parseFloat(v) * 100) || 0;

/* Fee preview only. The server recomputes every fee from its own config. */
function previewFee(minor, type, discountBps = 0) {
  const f = _cfg.fees;
  const raw = type === 'receive' ? minor * f.receive_bps / 10000 : minor * f.withdraw_bps / 10000 + f.withdraw_fixed;
  return Math.round(raw * (10000 - discountBps) / 10000);
}

let ME = null;
async function requireUser() {
  try {
    await getConfig();
    ME = await Api.get('/me');
  } catch (e) {
    if (e.status === 401) { location.href = '/pages/login.html'; return new Promise(() => {}); }
    throw e;
  }
  const nav = $('.rail .nav');
  if (ME.isAdmin && nav && !$('a[href="admin.html"]')) {
    nav.insertAdjacentHTML('beforeend', '<a href="admin.html" title="Admin" data-ic="user"></a>');
    hydrateIcons();
  }
  const lo = $('#logoutBtn');
  if (lo) lo.onclick = async () => { await Api.post('/auth/logout').catch(() => {}); location.href = '/pages/login.html'; };
  return ME;
}

/* ---------- step-up (TOTP) ---------- */
function askCode() {
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'modal-back';
    d.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Two-step check">' +
      '<h2>Confirm it is you</h2><p class="sub">Enter the 6 digit code from your authenticator app.</p>' +
      '<div class="field" style="margin-top:14px"><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></div>' +
      '<div style="display:flex;gap:10px"><button class="btn ghost" id="mfaNo" type="button">Cancel</button><button class="btn" id="mfaOk" type="button">Verify</button></div></div>';
    document.body.appendChild(d);
    const input = d.querySelector('#mfaCode'); input.focus();
    const done = v => { d.remove(); res(v); };
    d.querySelector('#mfaNo').onclick = () => done(null);
    d.querySelector('#mfaOk').onclick = () => done(input.value.trim());
    input.onkeydown = e => { if (e.key === 'Enter') done(input.value.trim()); };
  });
}
async function withStepUp(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.code === 'mfa_enroll_required') { toast(e.message); setTimeout(() => location.href = 'settings.html', 1200); throw e; }
    if (e.code !== 'mfa_required') throw e;
    const code = await askCode();
    if (!code) throw e;
    await Api.post('/mfa/verify', { factorId: ME.mfaFactors[0], code });
    ME.aal = 'aal2';
    return fn();
  }
}

/* ---------- Turnstile ---------- */
async function captcha(el) {
  const key = (await getConfig()).turnstileSiteKey;
  if (!key || !el) return { token: () => '', reset() {} };
  await new Promise(r => {
    if (window.turnstile) return r();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = r; document.head.appendChild(s);
  });
  const id = window.turnstile.render(el, { sitekey: key, theme: 'dark' });
  return { token: () => window.turnstile.getResponse(id) || '', reset: () => window.turnstile.reset(id) };
}

const humanErr = e => e.message && e.message !== e.code ? e.message : ({
  insufficient_funds: 'Not enough balance', daily_limit: 'Daily limit reached', rate_limited: 'Too many attempts, slow down',
  amount_too_small: 'Amount is too small', payout_cooldown: 'New bank accounts unlock after a short safety delay',
  recipient_not_found: 'Recipient not found', account_frozen: 'This account is frozen. Contact support.'
}[e.code] || 'Something went wrong. Try again.');

/* Render icons in [data-ic] */
function hydrateIcons() {
  $$('[data-ic]').forEach(el => {
    const n = el.dataset.ic;
    if (['BUTTON', 'SPAN', 'I', 'DIV', 'A'].includes(el.tagName)) {
      el.innerHTML = svg(n, n === 'check' ? 3 : 1.8);
    }
  });
}

/* ---------- interactive activity notes (local, privacy-friendly) ---------- */
const Activity = {
  key: 'sub_activity_v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch { return {}; }
  },
  save(o) { try { localStorage.setItem(this.key, JSON.stringify(o)); } catch {} },
  note(event, meta) {
    const s = this.load();
    s.last = { event, at: Date.now(), ...(meta || {}) };
    s.counts = s.counts || {};
    s.counts[event] = (s.counts[event] || 0) + 1;
    s.pages = s.pages || {};
    const path = location.pathname.split('/').pop() || 'home';
    s.pages[path] = (s.pages[path] || 0) + 1;
    this.save(s);
    // Soft interactive feedback on meaningful actions
    if (event === 'view_dashboard' && s.counts.view_dashboard === 1) {
      // first visit only – avoid noise
    }
    return s;
  },
  summary() {
    const s = this.load();
    return {
      lastEvent: s.last?.event || null,
      visits: Object.values(s.pages || {}).reduce((a, b) => a + b, 0),
      actions: s.counts || {}
    };
  }
};

document.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  $$('[data-toast]').forEach(b => b.addEventListener('click', () => toast(b.dataset.toast)));
  // Auto-note page interaction
  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
  Activity.note('view_' + page);
  // Click tracking on primary actions (non-PII)
  document.body.addEventListener('click', e => {
    const t = e.target.closest('a.btn, button.btn, a[href*="withdraw"], a[href*="request"]');
    if (!t) return;
    const label = (t.textContent || t.getAttribute('title') || 'action').trim().slice(0, 40);
    Activity.note('click', { label });
  }, { passive: true });
});
