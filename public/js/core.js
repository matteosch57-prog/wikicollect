// Shared client plumbing: state, API, formatting, icons, card rendering,
// drawer/toasts and live countdowns. No framework, no build step.

export const state = { config: null, me: null };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const listeners = new Set();
export function onProfile(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setMe(me) {
  state.me = me;
  listeners.forEach((fn) => fn(me));
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.me) setMe(null);
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (data && data.profile) setMe(data.profile);
  return data;
}

export const post = (path, body = {}) => api(path, { method: 'POST', body });

// ---------- formatting ----------

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n) => nf.format(n ?? 0).replace(/,/g, ' ');
export const pct = (p) => (p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(2)}%`);
export const catno = (id) => `№ ${String(id).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

export function rarity(id) {
  return state.config?.rarities.find((r) => r.id === id) || { id, name: id };
}
export const rarityRank = (id) => state.config?.rarities.findIndex((r) => r.id === id) ?? 0;

export function timeAgo(t) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function duration(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function wikiUrl(card) {
  return card.url || `https://${state.config?.lang || 'en'}.wikipedia.org/wiki/${encodeURIComponent(card.title.replaceAll(' ', '_'))}`;
}

// ---------- icons (1.5px line, 24 grid) ----------

const P = {
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10a2.5 2 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2 0 0 0 5 0"/>',
  pack: '<path d="M6 3.5h12l-1 2 1 2v11l-1 2 1 2H6l1-2-1-2v-11l1-2z"/><path d="M9 11h6M9 14h4"/>',
  album: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M8 3.5v17M11 8h6M11 11h4"/>',
  sets: '<rect x="3.5" y="5" width="7" height="9.5" rx="1"/><rect x="13.5" y="5" width="7" height="9.5" rx="1"/><path d="M3.5 18.5h17"/>',
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
  shield: '<path d="M12 21c-4-1.5-7-4.5-7-9V5.5L12 3l7 2.5V12c0 4.5-3 7.5-7 9z"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  gavel: '<path d="m14 5 5 5M11 8l5 5M12.5 6.5l5 5-2 2-5-5zM10.5 11.5 4 18l2 2 6.5-6.5M3 21h9"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v3.5M8.5 20.5h7l-1-3h-5z"/>',
  chat: '<path d="M4 5.5h16v10H10l-4.5 4v-4H4z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.8"/>',
  pin: '<path d="M9 3.5h6l-1 5 3.5 3.5v1.5H6.5V12L10 8.5zM12 13.5v7"/>',
  tag: '<path d="M3.5 12V4.5c0-.6.4-1 1-1H12l8.5 8.5-8 8z"/><circle cx="8" cy="8" r="1.4"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  close: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>',
  arrow: '<path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5"/>',
  download: '<path d="M12 3.5v12M7 11l5 5 5-5M4 20.5h16"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>',
  recycle: '<path d="M7.5 9 5 13.5h5M16.5 9 19 13.5h-5M9 5.5l3-2 3 5.5M5 13.5l3 5.5h8l3-5.5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  logout: '<path d="M14 4.5h5.5v15H14M10 8l-4 4 4 4M6 12h10"/>',
  admin: '<path d="M12 3 4.5 6v6c0 4.2 3 7.5 7.5 9 4.5-1.5 7.5-4.8 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.6-4.2 3.8-6.5 8-6.5s7.4 2.3 8 6.5"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  book: '<path d="M4 5.5c3-1.5 5.5-1.5 8 0v14c-2.5-1.5-5-1.5-8 0zM20 5.5c-3-1.5-5.5-1.5-8 0v14c2.5-1.5 5-1.5 8 0z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.5 11.5 8-8M16.5 6.5l2.5 2.5M14 9l2 2"/>',
};

// Google's multicolour "G", per their sign-in branding guidelines.
export const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- cards ----------

const FOIL = new Set(['SR', 'UR', 'L']);

export function cardHtml(card, { count = card.count, isNew = false, ghost = false, mini = false, cls = '', attrs = '' } = {}) {
  const plate = card.image
    ? `<img src="${esc(card.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="${esc(card.title[0] || '?')}">`
    : `<span class="initial">${esc(card.title[0] || '?')}</span>`;
  const marks = [card.pinned && icon('pin'), card.locked && icon('lock')].filter(Boolean);
  return `
  <article class="card ${FOIL.has(card.rarity) ? 'foil' : ''} ${ghost ? 'ghost' : ''} ${mini ? 'mini' : ''} ${cls}"
    data-r="${esc(card.rarity)}" data-id="${card.id}" ${attrs} aria-label="${esc(card.title)}, ${esc(rarity(card.rarity).name)}">
    ${count > 1 ? `<span class="flag count">×${count}</span>` : ''}
    ${isNew ? '<span class="flag new">NEW</span>' : ''}
    ${marks.length ? `<div class="marks">${marks.map((m) => `<span>${m}</span>`).join('')}</div>` : ''}
    <div class="frame">
      <div class="meta"><span>${catno(card.id)}</span><span class="seal" data-r="${esc(card.rarity)}">${esc(card.rarity)}</span></div>
      <div class="plate">${plate}</div>
      <div><div class="title">${esc(card.title)}</div><div class="desc">${esc(card.description || '')}</div></div>
      <div class="stats"><div><span>ATK</span><b>${fmt(card.atk)}</b></div><div><span>DEF</span><b>${fmt(card.def)}</b></div></div>
    </div>
  </article>`;
}

// Broken thumbnails fall back to the typographic plate.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.dataset.fallback !== undefined) {
    const span = document.createElement('span');
    span.className = 'initial';
    span.textContent = img.dataset.fallback;
    img.replaceWith(span);
  }
}, true);

// Pointer-tracked foil sheen + tilt on rare cards (and the pack pouch).
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('.card.foil, .pouch');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty('--mx', `${x * 100}%`);
  el.style.setProperty('--my', `${y * 100}%`);
  if (el.classList.contains('card')) {
    el.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
  }
}, { passive: true });
document.addEventListener('pointerout', (e) => {
  const el = e.target.closest?.('.card.foil');
  if (el && !el.contains(e.relatedTarget)) {
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }
});

// ---------- toasts ----------

export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}
export const fail = (e) => toast(e.message || String(e), 'error');

// ---------- drawer ----------

export function drawer(html, { onClose } = {}) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const panel = document.createElement('aside');
  panel.className = 'drawer';
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = `<button class="btn quiet icon close" aria-label="Close">${icon('close')}</button>${html}`;
  const close = () => {
    scrim.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  scrim.addEventListener('click', close);
  $('.close', panel).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, panel);
  return { el: panel, close };
}

export function confirmDialog(message, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const d = drawer(`
      <div class="eyebrow">Please confirm</div>
      <p style="font: 400 26px/1.2 var(--serif); margin: 18px 0 26px">${esc(message)}</p>
      <div class="row"><button class="btn ${danger ? 'hot' : 'solid'}" data-ok>${esc(ok)}</button><button class="btn quiet" data-no>Cancel</button></div>`,
    { onClose: () => resolve(false) });
    $('[data-ok]', d.el).onclick = () => {
      resolve(true);
      d.close();
    };
    $('[data-no]', d.el).onclick = () => d.close();
  });
}

// ---------- live countdowns ----------
// Any element with data-until="<timestamp>" counts down every second.

setInterval(() => {
  const t = Date.now();
  for (const el of $$('[data-until]')) {
    const left = Number(el.dataset.until) - t;
    el.textContent = left > 0 ? duration(left) : el.dataset.done || 'ended';
    el.classList.toggle('soon', left > 0 && left < 5 * 60_000);
  }
}, 1000);

export function countdown(until, { done = 'ended' } = {}) {
  return `<span class="countdown" data-until="${until}" data-done="${esc(done)}">${duration(until - Date.now())}</span>`;
}

// ---------- misc ----------

export function emptyState(title, body = '', action = '') {
  return `<div class="empty"><div class="display">${title}</div><p class="muted">${body}</p>${action}</div>`;
}

export function pageHead({ index, eyebrow, title, lede = '', aside = '' }) {
  return `<header class="page-head">
    <div><div class="eyebrow">${index ? `<span class="mono">${index}</span> ` : ''}${esc(eyebrow)}</div>
    <h1 class="display" style="font-size: clamp(44px, 6vw, 76px)">${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>
    <div>${aside}</div></header>`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
