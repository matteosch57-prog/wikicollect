// WikiCollect single-page client. No build step: plain ES modules + template strings.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

const state = { config: null, me: null, timer: null };

// ---------- helpers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') {
      state.me = null;
      renderChrome();
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}

const fmt = new Intl.NumberFormat();
const rarityName = (id) => state.config?.rarities.find((r) => r.id === id)?.name || id;
const rarityRank = (id) => state.config?.rarities.findIndex((r) => r.id === id) ?? 0;

function formatBytes(b) {
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`;
}
function formatViews(v) {
  return v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
function wikiUrl(card) {
  return card.url || `https://${state.config?.lang || 'en'}.wikipedia.org/wiki/${encodeURIComponent(card.title.replaceAll(' ', '_'))}`;
}
function timeAgo(t) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function cardHtml(card, { badge = true, isNew = false, ghost = false, extraClass = '' } = {}) {
  const art = card.image
    ? `<img src="${esc(card.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'initial',textContent:${esc(JSON.stringify(card.title[0] || '?'))}}))">`
    : `<span class="initial">${esc(card.title[0] || '?')}</span>`;
  return `
    <div class="card ${ghost ? 'ghost' : ''} ${extraClass}" data-rarity="${esc(card.rarity)}" data-id="${card.id}" title="${esc(card.title)}">
      ${badge && card.count > 1 ? `<span class="count-badge">×${card.count}</span>` : ''}
      ${isNew ? '<span class="new-badge">NEW</span>' : ''}
      <div class="card-inner">
        <div class="card-head"><div class="card-title">${esc(card.title)}</div><span class="gem"></span></div>
        <div class="card-art">${art}</div>
        <div class="card-desc">${esc(card.description || '')}</div>
        <div class="card-stats">
          <span title="Average daily views">👁 ${formatViews(card.views)}/d</span>
          <span title="Article size">📄 ${formatBytes(card.bytes)}</span>
          <span title="Card score">★ ${Math.round(card.score)}</span>
        </div>
        <div class="card-foot"><span>#${card.id}</span><span class="r">${esc(rarityName(card.rarity))}</span></div>
      </div>
    </div>`;
}

function bindCardClicks(root) {
  $$('.card[data-id]', root).forEach((el) => el.addEventListener('click', () => openCardModal(Number(el.dataset.id))));
}

function modal(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal"><button class="btn ghost close" aria-label="Close">✕</button>${html}</div>`;
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  wrap.addEventListener('click', (e) => e.target === wrap && close());
  $('.close', wrap).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  return { el: $('.modal', wrap), close };
}

async function openCardModal(id) {
  const card = await api(`/cards/${id}`).catch((e) => toast(e.message, 'error'));
  if (!card) return;
  const recycleValue = state.config.rarities.find((r) => r.id === card.rarity)?.recycle || 0;
  const { el, close } = modal(`
    <div class="card-detail">
      <div>${cardHtml({ ...card, count: card.mine }, { badge: true })}</div>
      <div>
        <div class="rarity-label" style="color: var(--${esc(card.rarity)})">${esc(rarityName(card.rarity))}</div>
        <h2>${esc(card.title)}</h2>
        ${card.description ? `<p class="muted"><em>${esc(card.description)}</em></p>` : ''}
        <p>${esc(card.extract || '')}</p>
        <dl class="kv">
          <dt>Daily views</dt><dd>${fmt.format(card.views)}</dd>
          <dt>Article size</dt><dd>${formatBytes(card.bytes)}</dd>
          <dt>Score</dt><dd>${card.score} / 100</dd>
          <dt>Collectors</dt><dd>${fmt.format(card.owners)}</dd>
          ${card.discoveredBy ? `<dt>First pulled by</dt><dd>${esc(card.discoveredBy)}</dd>` : ''}
          <dt>In your album</dt><dd>${card.mine ? `×${card.mine}` : 'Not yet'}</dd>
        </dl>
        <div class="row">
          <a class="btn" href="${esc(wikiUrl(card))}" target="_blank" rel="noopener">Read on Wikipedia ↗</a>
          ${card.mine > 1 ? `<button class="btn" id="recycle">Recycle 1 duplicate (+${recycleValue} 🪙)</button>` : ''}
        </div>
      </div>
    </div>`);
  $('#recycle', el)?.addEventListener('click', async () => {
    try {
      const r = await api('/recycle', { method: 'POST', body: { articleId: id, qty: 1 } });
      state.me = r.profile;
      renderChrome();
      toast(`+${r.coins} coins`, 'success');
      close();
      route();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

// ---------- chrome ----------

const NAV = [
  ['#/', 'Pulls'],
  ['#/album', 'Album'],
  ['#/sets', 'Sets'],
  ['#/quiz', 'Quiz'],
  ['#/exchange', 'Exchange'],
  ['#/ranking', 'Ranking'],
];

function renderChrome() {
  const path = location.hash.split('?')[0] || '#/';
  $('#nav').innerHTML = state.me
    ? NAV.map(([href, label]) => {
        const active = href === '#/' ? path === '#/' || path === '' : path.startsWith(href);
        const badge = href === '#/exchange' && state.me.incomingTrades ? `<span class="badge">${state.me.incomingTrades}</span>` : '';
        return `<a href="${href}" class="${active ? 'active' : ''}">${label}${badge}</a>`;
      }).join('')
    : `<a href="#/ranking" class="${path === '#/ranking' ? 'active' : ''}">Ranking</a>`;
  $('#wallet').innerHTML = state.me
    ? `<span class="chip" title="Packs in stock">🎴 ${state.me.packs}</span>
       <span class="chip" title="Coins">🪙 ${fmt.format(state.me.coins)}</span>
       <span class="chip" title="Collection score">★ ${fmt.format(state.me.score)}</span>
       <button class="btn ghost small" id="logout" title="Log out ${esc(state.me.username)}">${esc(state.me.username)} ⏏</button>`
    : `<a class="btn primary" href="#/">Play</a>`;
  $('#logout')?.addEventListener('click', async () => {
    await api('/logout', { method: 'POST', body: {} }).catch(() => {});
    state.me = null;
    location.hash = '#/';
    renderChrome();
    route();
  });
}

async function refreshMe() {
  state.me = await api('/me').catch(() => null);
  renderChrome();
}

// ---------- pages ----------

async function pageLanding() {
  const sample = [
    { id: 1, title: 'Albert Einstein', description: 'German-born theoretical physicist', views: 21000, bytes: 225000, score: 93, rarity: 'mythic' },
    { id: 2, title: 'Axolotl', description: 'Species of salamander', views: 3100, bytes: 46000, score: 72, rarity: 'legendary' },
    { id: 3, title: 'Emu War', description: '1932 Australian wildlife operation', views: 900, bytes: 25000, score: 56, rarity: 'epic' },
  ];
  view.innerHTML = `
    <section class="landing">
      <div>
        <h1>Every Wikipedia article is a collectible card.</h1>
        <p class="lead">Open free packs, discover the 6 million articles of Wikipedia, complete themed albums,
          trade your duplicates and prove your knowledge in quizzes.</p>
        <div class="steps">
          <div><b>🎴 Pull</b>A free 5-card pack every 10 minutes, up to 10 in stock.</div>
          <div><b>💎 Rarity</b>Set by real page views and article depth — from Common to Mythic.</div>
          <div><b>📚 Albums</b>Complete themed sets for bonus packs.</div>
          <div><b>🔁 Trade</b>Swap duplicates with other players or recycle them for coins.</div>
          <div><b>🧠 Quiz</b>Guess the article from its intro to earn coins and packs.</div>
        </div>
        <div class="fan">
          ${sample.map((c, i) => `<div style="left:${i * 110}px; transform: rotate(${(i - 1) * 7}deg); top:${i === 1 ? 0 : 18}px">${cardHtml(c)}</div>`).join('')}
        </div>
      </div>
      <div class="panel auth">
        <div class="tabs"><button class="active" data-mode="register">Create account</button><button data-mode="login">Log in</button></div>
        <form id="auth-form">
          <input class="input" name="username" placeholder="Username" autocomplete="username" required minlength="3" maxlength="20">
          <input class="input" name="password" type="password" placeholder="Password (6+ characters)" autocomplete="new-password" required minlength="6">
          <button class="btn primary big" type="submit">Start collecting — 10 free packs</button>
          <p class="small muted">No email needed. Your album is saved to your account.</p>
        </form>
      </div>
    </section>`;
  let mode = 'register';
  $$('.auth .tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $$('.auth .tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $('#auth-form button').textContent = mode === 'register' ? 'Start collecting — 10 free packs' : 'Log in';
      $('#auth-form [name=password]').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    }),
  );
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api(`/${mode}`, { method: 'POST', body: { username: form.get('username'), password: form.get('password') } });
      await refreshMe();
      route();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function stockHtml(me) {
  const slots = Math.max(me.maxStock, me.packs);
  return Array.from({ length: slots }, (_, i) =>
    `<span class="${i < me.packs ? (i >= me.maxStock ? 'bonus' : 'on') : ''}"></span>`).join('');
}

function startTimer() {
  clearInterval(state.timer);
  const tick = () => {
    const el = $('#next-pack');
    if (!el || !state.me) return clearInterval(state.timer);
    if (!state.me.nextPackAt) {
      el.textContent = 'Stock full — open some packs!';
      return;
    }
    const ms = state.me.nextPackAt - Date.now();
    if (ms <= 0) {
      clearInterval(state.timer);
      refreshMe().then(updatePullsHeader);
      return;
    }
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `Next free pack in ${m}:${String(s).padStart(2, '0')}`;
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

function updatePullsHeader() {
  const me = state.me;
  if (!me || !$('#stock')) return;
  $('#stock').innerHTML = stockHtml(me);
  $('#pack-count').textContent = `${me.packs} pack${me.packs === 1 ? '' : 's'} ready`;
  $('#open-btn').disabled = me.packs < 1;
  $('#pack').classList.toggle('empty', me.packs < 1);
  $('#buy-btn').disabled = me.coins < state.config.packs.shopPrice;
  startTimer();
}

async function pagePulls() {
  const me = state.me;
  view.innerHTML = `
    <section class="pulls-hero">
      <div class="pack ${me.packs < 1 ? 'empty' : ''}" id="pack" role="button" aria-label="Open a pack">
        <div class="crimp top"></div>
        <div><div class="pack-logo">W</div><div class="pack-name">Wiki Pack</div><div class="pack-sub">${state.config.packs.cardsPerPack} cards · ${state.config.lang}.wikipedia.org</div></div>
        <div class="crimp bottom"></div>
      </div>
      <div>
        <h1>Pulls</h1>
        <p class="muted">Each pack holds ${state.config.packs.cardsPerPack} random Wikipedia articles. The last card has boosted odds of a famous article or a set card.</p>
        <div class="stock" id="stock"></div>
        <div class="row"><strong id="pack-count"></strong><span class="muted timer" id="next-pack"></span></div>
        <div class="row" style="margin-top:16px">
          <button class="btn primary big" id="open-btn">Open a pack</button>
          <button class="btn" id="buy-btn">Buy a pack · ${state.config.packs.shopPrice} 🪙</button>
        </div>
      </div>
    </section>
    <section id="reveal-area" style="margin-top:34px"></section>
    <section style="margin-top:40px">
      <div class="page-head"><h2>Latest big pulls</h2><span class="muted small">Rare and better, from every player</span></div>
      <div class="feed" id="feed"><div class="spinner"></div></div>
    </section>`;
  updatePullsHeader();

  const open = async () => {
    if (state.me.packs < 1 || $('#open-btn').disabled) return;
    $('#open-btn').disabled = true;
    $('#pack').classList.add('shake');
    try {
      const [result] = await Promise.all([api('/packs/open', { method: 'POST', body: {} }), new Promise((r) => setTimeout(r, 500))]);
      state.me = result.profile;
      renderChrome();
      showReveal(result.cards);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      $('#pack')?.classList.remove('shake');
      updatePullsHeader();
    }
  };
  $('#open-btn').addEventListener('click', open);
  $('#pack').addEventListener('click', open);
  $('#buy-btn').addEventListener('click', async () => {
    try {
      const r = await api('/shop/pack', { method: 'POST', body: {} });
      state.me = r.profile;
      renderChrome();
      updatePullsHeader();
      toast('Pack added to your stock', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  loadFeed();
}

async function loadFeed() {
  const feed = $('#feed');
  if (!feed) return;
  const pulls = await api('/pulls/recent?min=rare&limit=18').catch(() => []);
  feed.innerHTML = pulls.length
    ? pulls.map((p) => `<div>${cardHtml(p, { badge: false })}<div class="who">${esc(p.username)} · ${timeAgo(p.at)}</div></div>`).join('')
    : '<p class="muted">No big pulls yet — be the first!</p>';
  bindCardClicks(feed);
}

function showReveal(cards) {
  const area = $('#reveal-area');
  area.innerHTML = `
    <div class="page-head"><h2>Your pack</h2>
      <div class="row"><button class="btn" id="reveal-all">Reveal all</button><button class="btn primary hidden" id="again">Open another</button></div></div>
    <div class="reveal">
      ${cards.map((c) => `
        <div class="flip ${rarityRank(c.rarity) >= 4 ? 'big-hit' : ''}" data-id="${c.id}">
          <div class="flip-inner">
            <div class="face back hint" ${rarityRank(c.rarity) >= 3 ? `data-glow="${esc(c.rarity)}"` : ''}>W</div>
            <div class="face front">${cardHtml(c, { badge: true, isNew: c.isNew })}</div>
          </div>
        </div>`).join('')}
    </div>
    <p class="muted small" id="pack-summary"></p>`;
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const flips = $$('.flip', area);
  const done = () => {
    if (flips.every((f) => f.classList.contains('flipped'))) {
      $('#reveal-all').classList.add('hidden');
      $('#again').classList.toggle('hidden', state.me.packs < 1);
      const fresh = cards.filter((c) => c.isNew).length;
      $('#pack-summary').textContent = `${fresh} new card${fresh === 1 ? '' : 's'} for your album. Click a card for details.`;
      loadFeed();
    }
  };
  flips.forEach((f) =>
    f.addEventListener('click', () => {
      if (!f.classList.contains('flipped')) {
        f.classList.add('flipped');
        done();
      } else {
        openCardModal(Number(f.dataset.id));
      }
    }),
  );
  $('#reveal-all').addEventListener('click', () => {
    flips.forEach((f, i) => setTimeout(() => {
      f.classList.add('flipped');
      done();
    }, i * 220));
  });
  $('#again').addEventListener('click', () => $('#open-btn').click());
}

async function pageAlbum(params) {
  const q = params.get('q') || '';
  const rarity = params.get('rarity') || '';
  const sort = params.get('sort') || 'rarity';
  const dupes = params.get('dupes') === '1';
  const page = Math.max(0, Number(params.get('page')) || 0);
  const limit = 60;
  view.innerHTML = '<div class="spinner"></div>';
  const qs = new URLSearchParams({ q, rarity, sort, limit, offset: page * limit, dupes: dupes ? '1' : '' });
  const data = await api(`/collection?${qs}`);
  const setParam = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    location.hash = `#/album?${p}`;
  };
  const totalUnique = Object.values(data.byRarity).reduce((s, n) => s + n, 0);
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Album</h1><p class="muted">${fmt.format(totalUnique)} unique cards · ${fmt.format(state.me.totalCards)} total</p></div>
      <div class="row">
        <input class="input" id="search" placeholder="Search your cards…" value="${esc(q)}">
        <select class="input" id="sort">
          ${[['rarity', 'Rarest first'], ['recent', 'Newest'], ['title', 'A → Z'], ['count', 'Most copies']]
            .map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="row" style="margin-bottom:18px">
      <button class="filter-chip ${!rarity ? 'active' : ''}" data-r="">All · ${totalUnique}</button>
      ${state.config.rarities.map((r) => `<button class="filter-chip ${rarity === r.id ? 'active' : ''}" data-r="${r.id}" style="color:var(--${r.id})">${r.name} · ${data.byRarity[r.id] || 0}</button>`).join('')}
      <span class="spacer"></span>
      <label class="row small"><input type="checkbox" id="dupes" ${dupes ? 'checked' : ''}> Duplicates only</label>
      <button class="btn small" id="recycle-all" title="Keeps one copy of everything; only Common → Rare duplicates">Recycle duplicates (≤ Rare)</button>
    </div>
    ${data.cards.length
      ? `<div class="grid" id="album-grid">${data.cards.map((c) => cardHtml(c)).join('')}</div>`
      : `<div class="empty">${totalUnique ? 'No cards match.' : 'Your album is empty. <a href="#/">Open your first pack!</a>'}</div>`}
    ${data.total > limit ? `
      <div class="row" style="justify-content:center;margin-top:24px">
        <button class="btn" id="prev" ${page === 0 ? 'disabled' : ''}>← Prev</button>
        <span class="muted">Page ${page + 1} / ${Math.ceil(data.total / limit)}</span>
        <button class="btn" id="next" ${(page + 1) * limit >= data.total ? 'disabled' : ''}>Next →</button>
      </div>` : ''}`;
  bindCardClicks(view);
  $$('.filter-chip').forEach((b) => b.addEventListener('click', () => setParam('rarity', b.dataset.r)));
  $('#sort').addEventListener('change', (e) => setParam('sort', e.target.value));
  $('#dupes').addEventListener('change', (e) => setParam('dupes', e.target.checked ? '1' : ''));
  let debounce;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => setParam('q', e.target.value.trim()), 350);
  });
  if (q) {
    const s = $('#search');
    s.focus();
    s.setSelectionRange(q.length, q.length);
  }
  $('#prev')?.addEventListener('click', () => setParam('page', String(page - 1)));
  $('#next')?.addEventListener('click', () => setParam('page', String(page + 1)));
  $('#recycle-all').addEventListener('click', async () => {
    if (!confirm('Recycle every Common, Uncommon and Rare duplicate into coins? One copy of each card is kept.')) return;
    try {
      const r = await api('/recycle/duplicates', { method: 'POST', body: { maxRarity: 'rare' } });
      state.me = r.profile;
      renderChrome();
      toast(r.cards ? `Recycled ${r.cards} cards for ${r.coins} coins` : 'No duplicates to recycle', 'success');
      route();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

async function pageSets() {
  view.innerHTML = '<div class="spinner"></div>';
  const sets = await api('/sets');
  const done = sets.filter((s) => s.complete).length;
  view.innerHTML = `
    <div class="page-head"><div><h1>Sets</h1>
      <p class="muted">Themed albums you can actually finish. Set cards drop from packs (boosted in the last slot). Each completed set gives ${state.config.setRewardPacks} bonus packs.</p></div>
      <span class="chip">${done} / ${sets.length} complete</span></div>
    ${sets.length ? sets.map((s) => `
      <section class="panel set">
        <div class="set-head">
          <span class="set-emoji">${s.emoji}</span>
          <div><h2 style="margin:0">${esc(s.name)}</h2><span class="muted small">${s.owned} / ${s.size} collected</span></div>
          <div class="progress"><div style="width:${(s.owned / s.size) * 100}%"></div></div>
          <span class="spacer"></span>
          ${s.claimed ? '<span class="chip">✓ Reward claimed</span>'
            : s.complete ? `<button class="btn primary" data-claim="${esc(s.id)}">Claim ${s.reward} packs</button>`
            : `<span class="muted small">Reward: ${s.reward} packs</span>`}
        </div>
        <div class="set-grid">
          ${s.members.map((m) => m.owned
            ? cardHtml(m.card)
            : `<div class="slot-missing"><div><div style="font-size:26px">?</div>${esc(m.title)}</div></div>`).join('')}
        </div>
      </section>`).join('') : '<div class="empty">No sets are defined for this language yet.</div>'}`;
  bindCardClicks(view);
  $$('[data-claim]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api(`/sets/${b.dataset.claim}/claim`, { method: 'POST', body: {} });
      state.me = r.profile;
      renderChrome();
      toast(`+${r.packs} packs!`, 'success');
      route();
    } catch (e) {
      toast(e.message, 'error');
    }
  }));
}

async function pageQuiz() {
  view.innerHTML = '<div class="spinner"></div>';
  let q;
  try {
    q = await api('/quiz/next');
  } catch (e) {
    view.innerHTML = `<div class="quiz"><h1>Quiz</h1><div class="empty">${esc(e.message)}<br><br><a class="btn primary" href="#/">Open packs</a></div></div>`;
    return;
  }
  const me = state.me;
  view.innerHTML = `
    <div class="quiz">
      <div class="page-head">
        <div><h1>Quiz</h1><p class="muted">Which article is this? The subject has been blanked out.</p></div>
        <div class="row">
          <span class="chip" title="Correct in a row">🔥 ${me.quiz.streak}</span>
          <span class="chip" title="Rewarded answers left today">🪙 ${q.rewardsLeft} left today</span>
        </div>
      </div>
      <div class="clue">${esc(q.clue)}${q.hint ? `<div class="small muted" style="margin-top:10px;color:#666">Hint: ${esc(q.hint)}</div>` : ''}</div>
      <div class="choices">${q.choices.map((c) => `<button class="choice" data-id="${c.id}">${esc(c.title)}</button>`).join('')}</div>
      <div id="quiz-result" style="margin-top:22px"></div>
      <p class="small muted" style="margin-top:22px">+${state.config.quiz.rewardCoins} coins per correct answer (up to ${state.config.quiz.rewardedPerDay} a day) · a bonus pack every ${state.config.quiz.streakForPack} in a row.</p>
    </div>`;
  $$('.choice').forEach((btn) => btn.addEventListener('click', async () => {
    $$('.choice').forEach((b) => (b.disabled = true));
    try {
      const r = await api(`/quiz/${q.id}/answer`, { method: 'POST', body: { choice: Number(btn.dataset.id) } });
      state.me = r.profile;
      renderChrome();
      $$('.choice').forEach((b) => {
        if (Number(b.dataset.id) === r.answer.id) b.classList.add('correct');
        else if (b === btn) b.classList.add('wrong');
      });
      const reward = [r.coins && `+${r.coins} 🪙`, r.packs && `+${r.packs} pack 🎴`].filter(Boolean).join(' ');
      $('#quiz-result').innerHTML = `
        <div class="panel row" style="align-items:flex-start">
          <div style="width:150px">${cardHtml(r.answer, { badge: false })}</div>
          <div style="flex:1;min-width:200px">
            <h2>${r.correct ? '✅ Correct!' : '❌ Not quite'}</h2>
            <p>It was <strong>${esc(r.answer.title)}</strong>. ${reward ? `<strong>${reward}</strong>` : ''} ${r.correct ? `Streak: ${r.streak}` : ''}</p>
            <div class="row"><button class="btn primary" id="next-q">Next question →</button>
            <a class="btn" href="${esc(wikiUrl(r.answer))}" target="_blank" rel="noopener">Read the article ↗</a></div>
          </div>
        </div>`;
      bindCardClicks($('#quiz-result'));
      $('#next-q').addEventListener('click', pageQuiz);
      $('#next-q').focus();
    } catch (e) {
      toast(e.message, 'error');
    }
  }));
}

// ---------- exchange ----------

async function pageExchange(params) {
  const tab = params.get('tab') || 'offers';
  view.innerHTML = `
    <div class="page-head"><div><h1>Exchange</h1><p class="muted">Swap duplicates with other collectors. Ownership is re-checked when an offer is accepted.</p></div></div>
    <div class="tabs">
      ${[['offers', `Offers${state.me.incomingTrades ? ` (${state.me.incomingTrades})` : ''}`], ['market', 'Find cards'], ['new', 'Trade with a player']]
        .map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="tab-body"><div class="spinner"></div></div>`;
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => (location.hash = `#/exchange?tab=${b.dataset.tab}`)));
  const body = $('#tab-body');
  if (tab === 'market') return exchangeMarket(body, params);
  if (tab === 'new') return exchangeCompose(body, params.get('with') || '', Number(params.get('want')) || null);
  return exchangeOffers(body);
}

async function exchangeOffers(body) {
  const trades = await api('/trades');
  const side = (title, cards) => `
    <div class="side"><h4>${title}</h4>
      ${cards.length ? `<div class="mini-cards">${cards.map((c) => cardHtml({ ...c, count: c.qty })).join('')}</div>` : '<p class="muted small">Nothing</p>'}
    </div>`;
  body.innerHTML = trades.length ? trades.map((t) => `
    <div class="trade">
      ${side(t.direction === 'incoming' ? `${esc(t.from)} gives you` : `You give ${esc(t.to)}`, t.give)}
      <div style="text-align:center">
        <div style="font-size:26px">⇄</div>
        <div class="status ${t.status}">${t.status}</div>
        <div class="small muted">${timeAgo(t.createdAt)}</div>
        ${t.message ? `<p class="small">“${esc(t.message)}”</p>` : ''}
        ${t.status === 'pending' && t.direction === 'incoming' ? `
          <div class="row" style="justify-content:center;margin-top:8px">
            <button class="btn primary" data-act="accept" data-id="${t.id}">Accept</button>
            <button class="btn danger" data-act="decline" data-id="${t.id}">Decline</button></div>` : ''}
        ${t.status === 'pending' && t.direction === 'outgoing' ? `<button class="btn" style="margin-top:8px" data-act="cancel" data-id="${t.id}">Cancel</button>` : ''}
      </div>
      ${side(t.direction === 'incoming' ? 'You give' : `${esc(t.to)} gives you`, t.want)}
    </div>`).join('')
    : '<div class="empty">No offers yet. Find a card you are missing in <a href="#/exchange?tab=market">Find cards</a>.</div>';
  bindCardClicks(body);
  $$('[data-act]', body).forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/trades/${b.dataset.id}/${b.dataset.act}`, { method: 'POST', body: {} });
      toast(`Offer ${b.dataset.act === 'accept' ? 'accepted' : b.dataset.act + 'd'}`, 'success');
      await refreshMe();
      route();
    } catch (e) {
      toast(e.message, 'error');
    }
  }));
}

async function exchangeMarket(body, params) {
  const q = params.get('q') || '';
  const cards = await api(`/market${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  body.innerHTML = `
    <div class="row" style="margin-bottom:16px"><input class="input" id="mq" placeholder="Search…" value="${esc(q)}">
      <span class="muted small">Cards other players have spare copies of — and you don't own yet.</span></div>
    ${cards.length ? `<div class="grid">${cards.map((c) => `
      <div>${cardHtml({ ...c, count: 0 })}
        <div class="row small" style="justify-content:space-between;margin-top:6px">
          <span class="muted">${esc(c.owner)} · ${c.spare} spare</span>
          <a class="btn small" href="#/exchange?tab=new&with=${encodeURIComponent(c.owner)}&want=${c.id}">Offer</a>
        </div></div>`).join('')}</div>`
      : '<div class="empty">Nobody has spare copies of cards you\'re missing right now.</div>'}`;
  bindCardClicks(body);
  $('#mq').addEventListener('change', (e) => (location.hash = `#/exchange?tab=market&q=${encodeURIComponent(e.target.value.trim())}`));
}

async function exchangeCompose(body, withUser, wantId) {
  body.innerHTML = `
    <form class="row" id="pick-user" style="margin-bottom:18px">
      <input class="input" name="u" placeholder="Player username" value="${esc(withUser)}" required>
      <button class="btn">Load cards</button>
    </form>
    <div id="compose"></div>`;
  $('#pick-user').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/exchange?tab=new&with=${encodeURIComponent(new FormData(e.target).get('u').trim())}`;
  });
  if (!withUser) return;
  const compose = $('#compose');
  compose.innerHTML = '<div class="spinner"></div>';
  let theirs, mine;
  try {
    [theirs, mine] = await Promise.all([api(`/users/${encodeURIComponent(withUser)}/cards`), api('/collection?limit=200&sort=count')]);
  } catch (e) {
    compose.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  const want = new Set(wantId ? [wantId] : []);
  const give = new Set();
  const max = state.config.trade.maxItemsPerSide;
  const picker = (cards, set, key) => `
    <div class="mini-cards pickable" data-key="${key}">
      ${cards.map((c) => cardHtml(c, { extraClass: set.has(c.id) ? 'picked' : '' }).replace('data-id=', 'data-pick=')).join('')}
    </div>`;
  compose.innerHTML = `
    <div class="two-col">
      <div class="panel"><h3>You want from ${esc(theirs.username)}</h3><p class="small muted">Click to select (max ${max}).</p>
        ${theirs.cards.length ? picker(theirs.cards, want, 'want') : '<p class="muted">They have no cards yet.</p>'}</div>
      <div class="panel"><h3>You give</h3><p class="small muted">Your cards — duplicates first.</p>
        ${mine.cards.length ? picker(mine.cards, give, 'give') : '<p class="muted">You have no cards yet.</p>'}</div>
    </div>
    <div class="row" style="margin-top:18px">
      <input class="input" id="msg" placeholder="Message (optional)" maxlength="200" style="flex:1">
      <button class="btn primary big" id="send">Send offer</button>
    </div>`;
  $$('.pickable', compose).forEach((grid) => {
    const set = grid.dataset.key === 'want' ? want : give;
    $$('.card', grid).forEach((el) => el.addEventListener('click', () => {
      const id = Number(el.dataset.pick);
      if (set.has(id)) set.delete(id);
      else if (set.size < max) set.add(id);
      else return toast(`At most ${max} cards per side`, 'error');
      el.classList.toggle('picked', set.has(id));
    }));
  });
  $('#send').addEventListener('click', async () => {
    try {
      await api('/trades', { method: 'POST', body: { to: theirs.username, give: [...give], want: [...want], message: $('#msg').value } });
      toast('Offer sent!', 'success');
      location.hash = '#/exchange?tab=offers';
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

async function pageRanking() {
  view.innerHTML = '<div class="spinner"></div>';
  const lb = await api('/leaderboard');
  const me = state.me?.username;
  const table = (rows, cols) => `
    <table><thead><tr><th>#</th><th>Player</th>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${r.username === me ? 'me' : ''}"><td class="rank">${i + 1}</td><td>${esc(r.username)}</td>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')
      || '<tr><td colspan="5" class="muted">No players yet</td></tr>'}</tbody></table>`;
  view.innerHTML = `
    <div class="page-head"><div><h1>Ranking</h1><p class="muted">Collection score: Common 1 · Uncommon 3 · Rare 10 · Epic 30 · Legendary 100 · Mythic 400 points per unique card.</p></div></div>
    <div class="two-col">
      <div class="panel"><h2>Top collectors</h2>${table(lb.score, [
        ['Score', (r) => fmt.format(r.score)],
        ['Cards', (r) => fmt.format(r.uniqueCards)],
        ['Best', (r) => (r.best ? `<span style="color:var(--${r.best})">${esc(rarityName(r.best))}</span>` : '—')],
      ])}</div>
      <div class="panel"><h2>Quiz masters</h2>${table(lb.quiz, [['Correct', (r) => fmt.format(r.quizCorrect)]])}</div>
    </div>`;
}

// ---------- router ----------

async function route() {
  const [path, query = ''] = (location.hash || '#/').split('?');
  const params = new URLSearchParams(query);
  renderChrome();
  try {
    if (path === '#/ranking') return await pageRanking();
    if (!state.me) return await pageLanding();
    switch (path) {
      case '#/album': return await pageAlbum(params);
      case '#/sets': return await pageSets();
      case '#/quiz': return await pageQuiz();
      case '#/exchange': return await pageExchange(params);
      default: return await pagePulls();
    }
  } catch (e) {
    view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && state.me && refreshMe());

(async function init() {
  state.config = await api('/config');
  $('#offline').classList.toggle('hidden', !state.config.offline);
  await refreshMe();
  route();
})();
