import { api, post, state, esc, fmt, cardHtml, toast, fail, $, $$, pageHead, emptyState, countdown, timeAgo, icon, debounce, rarity } from '../core.js';
import { bindCards } from '../carddetail.js';

const TIERS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];

export async function pageMarket(ctx) {
  const { view, params } = ctx;
  const scope = params.get('scope') || 'all';
  const q = params.get('q') || '';
  const r = params.get('rarity') || '';
  const sort = params.get('sort') || 'ending';
  const M = state.config.market;
  const set = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    location.hash = `#/market?${p}`;
  };
  view.innerHTML = `${pageHead({
    index: '06', eyebrow: 'Market', title: 'The <em>auction</em> house',
    lede: `Bids are held in escrow and refunded the moment you are outbid. Late bids add two minutes. A ${Math.round(M.salesTaxRate * 100)}% sales tax is destroyed, and cards bought here cannot be relisted for 48 hours.`,
    aside: `<span class="mono">${icon('coin')} ${fmt(state.me.coins)}</span>`,
  })}
  <div class="tabs">
    ${[['all', 'Open lots'], ['wishlist', 'From my wishlist'], ['bidding', 'My bids'], ['mine', 'My sales']]
      .map(([s, l]) => `<a href="#/market?scope=${s}" class="${scope === s ? 'active' : ''}">${l}</a>`).join('')}
  </div>
  <div class="spread" style="margin-bottom:26px">
    <div class="row">
      <input class="input" id="mq" placeholder="Search lots" value="${esc(q)}" style="width:240px">
      <select class="input" id="ms" style="width:150px">${[['ending', 'Ending soonest'], ['newest', 'Newest'], ['price', 'Lowest price']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="chips"><button class="chip ${!r ? 'on' : ''}" data-tier="">All</button>${TIERS.map((t) => `<button class="chip ${r === t ? 'on' : ''}" data-tier="${t}">${t}</button>`).join('')}</div>
  </div>
  <div id="lots"><div class="skeleton"></div></div>
  <p class="small muted" style="margin-top:32px">To sell, open any card in your album and choose “Put up for auction”.</p>`;
  $('#mq').addEventListener('input', debounce((e) => set('q', e.target.value.trim()), 400));
  $('#ms').onchange = (e) => set('sort', e.target.value);
  $$('[data-tier]').forEach((b) => (b.onclick = () => set('rarity', b.dataset.tier)));

  const lots = await api(`/auctions?${new URLSearchParams({ scope, q, rarity: r, sort })}`);
  const el = $('#lots');
  el.innerHTML = lots.length ? `<div class="grid-cards">${lots.map(lotHtml).join('')}</div>`
    : emptyState(scope === 'mine' ? 'Nothing listed' : 'No lots here', scope === 'wishlist' ? 'Wishlisted cards appear here as soon as someone lists them.' : '');
  el.addEventListener('click', (e) => {
    const lot = e.target.closest('[data-lot]');
    if (lot) location.hash = `#/market/${lot.dataset.lot}`;
  });
}

function lotHtml(a) {
  const price = a.currentBid ?? a.startPrice;
  return `<div class="lot" data-lot="${a.id}" style="cursor:pointer">
    ${cardHtml(a.card, { attrs: 'data-nodrawer="1"' })}
    <div class="lot-meta">
      <span class="price">${fmt(price)}</span>
      <span class="small ${a.status === 'open' ? '' : 'muted'}">${a.status === 'open' ? countdown(a.endsAt) : `<span class="status-tag ${a.status}">${a.status}</span>`}</span>
      <span class="small muted">${a.bids ? `${a.bids} bid${a.bids > 1 ? 's' : ''}` : 'starting price'}${a.leading ? ' · <b class="accent">leading</b>' : ''}</span>
      <span class="small muted">${a.mine ? 'your lot' : esc(a.seller)}</span>
    </div></div>`;
}

export async function pageLot(ctx, idStr) {
  const { view, route, onLeave } = ctx;
  const id = Number(idStr);
  const a = await api(`/auctions/${id}`);
  const open = a.status === 'open' && a.endsAt > Date.now();
  view.innerHTML = `
    <div class="eyebrow"><a href="#/market">Market</a> · Lot № ${a.id}</div>
    <div class="cols-main" style="margin-top:22px;grid-template-columns:minmax(260px,360px) 1fr">
      <div id="lot-card">${cardHtml(a.card)}</div>
      <div>
        <h1 class="display" style="font-size:clamp(40px,5vw,68px)">${esc(a.card.title)}</h1>
        <p class="muted">${esc(rarity(a.card.rarity).name)} · listed by <a href="#/u/${encodeURIComponent(a.seller)}">${esc(a.seller)}</a> ${timeAgo(a.createdAt)}</p>
        <dl class="kv">
          <dt>${a.currentBid ? 'Current bid' : 'Starting price'}</dt><dd style="font-size:22px">${fmt(a.currentBid ?? a.startPrice)}</dd>
          <dt>Leader</dt><dd>${a.leader ? esc(a.leader) : '—'}</dd>
          <dt>${open ? 'Ends in' : 'Status'}</dt><dd>${open ? countdown(a.endsAt) : `<span class="status-tag ${a.status}">${a.status}</span>`}</dd>
          <dt>Sales tax (burned)</dt><dd>${Math.round(a.taxRate * 100)}%</dd>
        </dl>
        ${open && !a.mine ? `
          <form class="row" id="bid" style="margin:22px 0">
            <div class="field" style="flex:1;min-width:160px"><label>Your bid · minimum ${fmt(a.minBid)}</label>
              <input class="input" name="amount" type="number" min="${a.minBid}" step="1" value="${a.minBid}" style="height:52px;font:500 20px var(--mono)"></div>
            <button class="btn solid lg" style="align-self:end">${icon('gavel')} Place bid</button>
          </form>
          <p class="small muted">You have ${fmt(state.me.coins)} coins. Your bid is held until you are outbid or the lot closes.</p>` : ''}
        ${open && a.mine && !a.bids ? '<button class="btn quiet" id="withdraw">Withdraw lot</button>' : ''}
        <div class="section" style="margin-top:36px"><div class="section-head"><h2>Bids</h2></div>
          ${a.history.length ? `<div class="list">${a.history.map((b) => `<div class="list-row" style="grid-template-columns:1fr auto auto"><span>${esc(b.by)}</span><span class="mono">${fmt(b.amount)}</span><span class="small muted">${timeAgo(b.at)}</span></div>`).join('')}</div>` : '<p class="muted">No bids yet.</p>'}
        </div>
      </div>
    </div>`;
  bindCards($('#lot-card'));
  $('#bid')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post(`/auctions/${id}/bid`, { amount: Number(new FormData(e.target).get('amount')) });
      toast('Bid placed — you are leading');
      route();
    } catch (err) {
      fail(err);
    }
  });
  $('#withdraw')?.addEventListener('click', async () => {
    try {
      await post(`/auctions/${id}/cancel`);
      toast('Lot withdrawn — the card is back in your album');
      location.hash = '#/market?scope=mine';
    } catch (err) {
      fail(err);
    }
  });
  if (open) {
    const poll = setInterval(async () => {
      try {
        const fresh = await api(`/auctions/${id}`);
        if (fresh.currentBid !== a.currentBid || fresh.status !== a.status || fresh.endsAt !== a.endsAt) route();
      } catch {}
    }, 5000);
    onLeave(() => clearInterval(poll));
  }
}
