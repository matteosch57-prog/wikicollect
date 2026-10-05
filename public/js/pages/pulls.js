import { api, post, state, esc, fmt, pct, icon, cardHtml, toast, fail, $, $$, rarity, rarityRank, countdown, timeAgo, onProfile } from '../core.js';
import { bindCards, openCard } from '../carddetail.js';

const TIERS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];

function oddsTable(slots) {
  const normal = slots[0];
  const hit = slots.at(-1);
  return `<table class="odds"><thead><tr><th>Tier</th><th>Cards 1–${slots.length - 1}</th><th>Card ${slots.length}</th></tr></thead><tbody>
    ${TIERS.map((t) => `<tr><td><span class="seal" data-r="${t}">${t}</span> ${esc(rarity(t).name)}</td>
      <td>${normal[t] ? pct(normal[t]) : '—'}</td><td>${hit[t] ? pct(hit[t]) : '—'}</td></tr>`).join('')}
  </tbody></table>`;
}

function themeOdds(odds) {
  const tiers = TIERS.filter((t) => odds[t]);
  if (!tiers.length) return '<p class="small muted">Odds are computed once the set has been catalogued.</p>';
  return `<table class="odds"><tbody>${tiers.map((t) => `<tr><td><span class="seal" data-r="${t}">${t}</span> ${esc(rarity(t).name)}</td><td>${pct(odds[t])}</td></tr>`).join('')}</tbody></table>`;
}

function pouch({ cls = '', name, series, count = 5, mark = 'wc' }) {
  return `<div class="pouch ${cls}" role="button" tabindex="0">
    <div class="foilbag"></div><div class="tear"></div>
    <div class="face"><div class="series">${esc(series)}</div><div class="mark">${esc(mark)}</div>
      <div><div class="name">${esc(name)}</div><div class="count">${count} cards · ${esc(state.config.lang)}.wikipedia</div></div></div>
  </div>`;
}

export async function pagePulls(ctx) {
  const { view, params, onLeave } = ctx;
  const me = state.me;
  view.innerHTML = `
    <section class="pack-stage">
      <div id="free-pouch">${pouch({ name: 'Wiki Pack', series: 'Série I · free', cls: me.packs < 1 ? 'empty' : '' })}</div>
      <div>
        <div class="eyebrow"><span class="mono">01</span> Pulls</div>
        <div class="row" style="align-items:flex-end; gap: 18px; margin-top: 14px">
          <div class="big-count num" id="pack-count">${String(me.packs).padStart(2, '0')}</div>
          <div style="padding-bottom:10px"><div class="display" style="font-size:30px">free packs<br><em>in reserve</em></div></div>
        </div>
        <div class="stock" id="stock"></div>
        <p class="muted small mono" id="next-pack"></p>
        <div class="row" style="margin-top:22px">
          <button class="btn solid lg" id="open-free">${icon('pack')} Open a pack</button>
          <a class="btn quiet lg" href="#/?shop=1" id="to-shop">${icon('coin')} Shop</a>
        </div>
        <details style="margin-top:22px"><summary class="btn link" style="list-style:none">Published drop rates</summary>
          <div style="max-width:420px;margin-top:12px" id="free-odds"></div></details>
      </div>
    </section>

    <section id="reveal" class="section hidden"></section>

    <section class="section" id="shop">
      <div class="section-head"><h2>The shop</h2><span class="small muted mono" id="burned"></span></div>
      <div id="shop-body"><div class="skeleton" style="height:180px"></div></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Recent finds</h2><span class="small muted">Super Rare and above, every player</span></div>
      <div class="grid-cards" id="feed"></div>
    </section>`;

  const updateHeader = () => {
    const m = state.me;
    if (!m || !$('#stock')) return;
    $('#pack-count').textContent = String(m.packs).padStart(2, '0');
    $('#stock').innerHTML = Array.from({ length: Math.max(m.maxStock, m.packs) }, (_, i) =>
      `<span class="${i < m.packs ? (i >= m.maxStock ? 'extra' : 'on') : ''}"></span>`).join('');
    $('#next-pack').innerHTML = m.nextPackAt
      ? `Next free pack in ${countdown(m.nextPackAt, { done: 'a moment' })}`
      : 'Reserve full — open a pack to restart the clock';
    $('#open-free').disabled = m.packs < 1;
    $('#free-pouch .pouch').classList.toggle('empty', m.packs < 1);
  };
  updateHeader();
  onLeave(onProfile(updateHeader));

  const openPack = async (body, pouchEl) => {
    const area = $('#reveal');
    if (area.dataset.busy) return;
    area.dataset.busy = '1';
    pouchEl?.classList.add('ripping');
    try {
      const [res] = await Promise.all([post('/packs/open', body), new Promise((r) => setTimeout(r, 550))]);
      if (ctx.stale()) return; // the player navigated away meanwhile
      reveal(res.cards);
      for (const a of res.achievements || []) toast(`Achievement unlocked — ${a.name} (+${a.reward} coins)`);
      loadShop();
    } catch (e) {
      fail(e);
    } finally {
      delete area.dataset.busy;
      pouchEl?.classList.remove('ripping');
    }
  };

  const free = $('#free-pouch .pouch');
  free.addEventListener('click', () => state.me.packs > 0 && openPack({ type: 'free' }, free));
  free.addEventListener('keydown', (e) => e.key === 'Enter' && free.click());
  $('#open-free').addEventListener('click', () => openPack({ type: 'free' }, free));

  function reveal(cards) {
    const area = $('#reveal');
    area.classList.remove('hidden');
    area.innerHTML = `
      <div class="section-head"><h2>Your pack</h2>
        <div class="row"><button class="btn quiet sm" id="reveal-all">Reveal all</button><button class="btn solid sm hidden" id="again">${icon('pack')} Another</button></div></div>
      <div class="reveal">${cards.map((c) => `
        <div class="flip ${rarityRank(c.rarity) >= 4 ? 'hit' : ''}" data-id="${c.id}">
          <div class="flip-inner">
            <div class="face back"><div class="card-back ${rarityRank(c.rarity) >= 3 ? `glow-${c.rarity}` : ''}"></div></div>
            <div class="face front">${cardHtml(c, { isNew: c.isNew })}</div>
          </div>
        </div>`).join('')}</div>
      <p class="muted small" id="summary" style="margin-top:18px"></p>`;
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const flips = $$('.flip', area);
    const check = () => {
      if (!flips.every((f) => f.classList.contains('open'))) return;
      $('#reveal-all').classList.add('hidden');
      $('#again').classList.toggle('hidden', state.me.packs < 1);
      const fresh = cards.filter((c) => c.isNew).length;
      const best = cards.reduce((b, c) => (rarityRank(c.rarity) > rarityRank(b.rarity) ? c : b), cards[0]);
      $('#summary').innerHTML = `${fresh} new to your album · best pull <b>${esc(best.title)}</b> (${esc(rarity(best.rarity).name)}). Select a card to inspect it.`;
      loadFeed();
    };
    flips.forEach((f) => f.addEventListener('click', () => {
      if (!f.classList.contains('open')) {
        f.classList.add('open');
        check();
      } else openCard(Number(f.dataset.id));
    }));
    $('#reveal-all').onclick = () => flips.forEach((f, i) => setTimeout(() => {
      f.classList.add('open');
      check();
    }, i * 180));
    $('#again').onclick = () => openPack({ type: 'free' }, free);
  }

  async function loadShop() {
    let shop;
    try {
      shop = await api('/shop');
    } catch (e) {
      return fail(e);
    }
    if (!$('#shop-body')) return;
    $('#free-odds').innerHTML = oddsTable(shop.packs.find((p) => p.id === 'free').slots);
    $('#burned').textContent = `${fmt(shop.coinsBurned)} coins destroyed so far`;
    const paid = shop.packs.filter((p) => p.price > 0);
    const J = shop.jackpot;
    $('#shop-body').innerHTML = `
      <div class="shop-grid">
        ${paid.map((p) => `
          <div class="shop-item">
            <div>${pouch({ name: p.name, series: p.id === 'premium' ? 'Rare or better' : 'Série I', cls: p.id === 'premium' ? 'premium' : '' })}</div>
            <div>${oddsTable(p.slots)}</div>
            <div class="spread"><span class="price">${icon('coin')} ${fmt(p.price)}</span>
              <button class="btn solid" data-buy="${p.id}" ${state.me.coins < p.price ? 'disabled' : ''}>Buy & open</button></div>
          </div>`).join('')}
        ${shop.themes.map((t) => `
          <div class="shop-item">
            <div>${pouch({ name: t.name, series: 'Theme · rotating', cls: 'theme', mark: t.name[0] })}</div>
            <div><div class="spread small"><span class="muted">Leaves the shop in</span>${countdown(t.endsAt, { done: 'rotating…' })}</div>
              <p class="small muted">Only cards from the “${esc(t.name)}” set. Rarity mix:</p>${themeOdds(t.odds)}</div>
            <div class="spread"><span class="price">${icon('coin')} ${fmt(t.price)}</span>
              <button class="btn solid" data-theme-pack="${esc(t.id)}" ${state.me.coins < t.price ? 'disabled' : ''}>Buy & open</button></div>
          </div>`).join('')}
        <div class="shop-item">
          <div><div class="eyebrow plain">Jackpot</div>
            <div class="big-count num" style="font-size:64px;margin-top:14px">${fmt(J.pot)}</div>
            <p class="small muted">coins in the pot</p></div>
          <p class="small" style="margin:0">A ${fmt(J.ticket)}-coin ticket wins the whole pot ${pct(J.winChance)} of the time. Otherwise half the ticket is destroyed and half grows the pot.</p>
          <div class="spread"><span class="price">${icon('coin')} ${fmt(J.ticket)}</span>
            <button class="btn quiet" id="spin" ${state.me.coins < J.ticket ? 'disabled' : ''}>${icon('dice')} Buy a ticket</button></div>
        </div>
      </div>`;
    $$('[data-buy]').forEach((b) => (b.onclick = () => openPack({ type: b.dataset.buy })));
    $$('[data-theme-pack]').forEach((b) => (b.onclick = () => openPack({ type: 'theme', theme: b.dataset.themePack })));
    $('#spin').onclick = async () => {
      try {
        const r = await post('/jackpot/spin');
        toast(r.won ? `Jackpot! You won ${fmt(r.prize)} coins` : `No luck this time — the pot is now ${fmt(r.pot)}`);
        loadShop();
      } catch (e) {
        fail(e);
      }
    };
  }

  async function loadFeed() {
    const feed = $('#feed');
    if (!feed) return;
    const pulls = await api('/pulls/recent?min=SR&limit=12').catch(() => []);
    feed.innerHTML = pulls.length
      ? pulls.map((p) => `<div>${cardHtml(p)}<div class="small muted" style="margin-top:8px"><a href="#/u/${encodeURIComponent(p.username)}">${esc(p.username)}</a> · ${timeAgo(p.at)}</div></div>`).join('')
      : '<p class="muted">No Super Rare pulled yet. Yours could be the first.</p>';
  }
  bindCards($('#feed'));

  await Promise.all([loadShop(), loadFeed()]);
  if (params.get('shop') === '1') $('#shop').scrollIntoView({ behavior: 'smooth' });
}
