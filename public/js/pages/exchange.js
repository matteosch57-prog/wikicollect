import { api, post, state, esc, cardHtml, toast, fail, $, $$, pageHead, emptyState, timeAgo, icon, debounce } from '../core.js';
import { bindCards } from '../carddetail.js';

export async function pageExchange(ctx) {
  const { view, params, route } = ctx;
  const tab = params.get('tab') || 'offers';
  view.innerHTML = `${pageHead({
    index: '05', eyebrow: 'Exchange', title: 'Trade your <em>doubles</em>',
    lede: 'Offer spare cards for the ones you are missing; counter any offer you receive. Locked cards can be neither offered nor requested.',
  })}
  <div class="tabs">
    <a href="#/exchange" class="${tab === 'offers' ? 'active' : ''}">Open offers${state.me.pending.trades ? ` <i>${state.me.pending.trades}</i>` : ''}</a>
    <a href="#/exchange?tab=find" class="${tab === 'find' ? 'active' : ''}">Find cards</a>
    <a href="#/exchange?tab=new" class="${tab === 'new' ? 'active' : ''}">New offer</a>
    <a href="#/exchange?tab=history" class="${tab === 'history' ? 'active' : ''}">History</a>
  </div>
  <div id="ex-body"><div class="skeleton"></div></div>`;
  const body = $('#ex-body');
  bindCards(body, { onChange: route });

  if (tab === 'find') return finder(body, params);
  if (tab === 'new') return composer(body, { to: params.get('with') || '', want: Number(params.get('want')) || null });

  const trades = await api('/trades');
  const shown = trades.filter((t) => (tab === 'history' ? t.status !== 'pending' : t.status === 'pending'));
  body.innerHTML = shown.length ? shown.map((t) => dealHtml(t)).join('')
    : tab === 'history' ? emptyState('No past trades this week')
    : emptyState('No open offers', 'Find a card you are missing and make someone an offer.', '<a class="btn solid" href="#/exchange?tab=find">Find cards</a>');

  $$('[data-act]', body).forEach((b) => (b.onclick = async () => {
    const t = trades.find((x) => x.id === Number(b.dataset.id));
    if (b.dataset.act === 'counter') {
      // Counter: roles swap — you give what they asked for, you want what they offered.
      body.innerHTML = '';
      return composer(body, { to: t.from, counterOf: t, give: t.want.map((c) => c.id), want: t.give.map((c) => c.id) });
    }
    try {
      await post(`/trades/${b.dataset.id}/${b.dataset.act}`);
      toast({ accept: 'Trade done — cards exchanged', decline: 'Offer declined', cancel: 'Offer withdrawn' }[b.dataset.act]);
      await ctx.refreshMe();
      route();
    } catch (e) {
      fail(e);
    }
  }));
}

function dealHtml(t) {
  const side = (label, cards) => `<div><div class="eyebrow plain" style="margin-bottom:10px">${label}</div>
    ${cards.length ? `<div class="mini-row">${cards.map((c) => cardHtml({ ...c, count: c.qty }, { mini: true })).join('')}</div>` : '<p class="muted small">nothing</p>'}</div>`;
  const incoming = t.direction === 'incoming';
  return `<div class="deal">
    ${side(incoming ? `${esc(t.from)} gives you` : `You give ${esc(t.to)}`, t.give)}
    <div class="swap">${icon('swap')}<span class="status-tag ${t.status}">${t.status}</span><span class="small muted mono">${timeAgo(t.createdAt)}</span></div>
    ${side(incoming ? 'You give' : `${esc(t.to)} gives you`, t.want)}
    ${t.message ? `<p style="grid-column:1/-1;margin:0;font:italic 400 19px/1.3 var(--serif)">“${esc(t.message)}”</p>` : ''}
    ${t.status === 'pending' ? `<div class="row" style="grid-column:1/-1">${incoming
      ? `<button class="btn solid" data-act="accept" data-id="${t.id}">Accept</button>
         <button class="btn quiet" data-act="counter" data-id="${t.id}">Counter-offer</button>
         <button class="btn quiet" data-act="decline" data-id="${t.id}">Decline</button>`
      : `<button class="btn quiet" data-act="cancel" data-id="${t.id}">Withdraw</button>`}</div>` : ''}
  </div>`;
}

async function finder(body, params) {
  const q = params.get('q') || '';
  const cards = await api(`/trade-finder${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  body.innerHTML = `
    <div class="row" style="margin-bottom:24px"><input class="input" id="fq" placeholder="Search" value="${esc(q)}" style="width:260px">
      <span class="small muted">Spare, unlocked copies held by other players — of cards you do not own. Wishlist matches first.</span></div>
    ${cards.length ? `<div class="grid-cards">${cards.map((c) => `<div>${cardHtml({ ...c, count: 0 })}
      <div class="spread small" style="margin-top:8px"><span class="muted">${c.wished ? `${icon('star')} ` : ''}<a href="#/u/${encodeURIComponent(c.owner)}">${esc(c.owner)}</a> · ${c.spare} spare</span>
      <a class="btn quiet sm" href="#/exchange?tab=new&with=${encodeURIComponent(c.owner)}&want=${c.id}">Offer</a></div></div>`).join('')}</div>`
      : emptyState('Nothing on offer right now', 'Spare copies appear here as players open packs.')}`;
  $('#fq').addEventListener('input', debounce((e) => (location.hash = `#/exchange?tab=find&q=${encodeURIComponent(e.target.value.trim())}`), 400));
}

async function composer(body, { to = '', want = null, give = [], counterOf = null }) {
  body.insertAdjacentHTML('beforeend', `
    ${counterOf ? `<p class="lede" style="margin-top:0">Countering ${esc(counterOf.from)}’s offer. Adjust both sides, then send it back.</p>`
      : `<form class="row" id="who" style="margin-bottom:24px"><div class="field" style="min-width:260px"><label>Trade with</label>
        <input class="input" name="u" placeholder="Username" value="${esc(to)}" required></div><button class="btn quiet" style="align-self:end">Load their album</button></form>`}
    <div id="compose"></div>`);
  $('#who')?.addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/exchange?tab=new&with=${encodeURIComponent(new FormData(e.target).get('u').trim())}`;
  });
  if (!to) return;
  const el = $('#compose');
  el.innerHTML = '<div class="skeleton"></div>';
  let theirs;
  let mine;
  try {
    [theirs, mine] = await Promise.all([api(`/users/${encodeURIComponent(to)}/cards`), api('/collection?limit=200&sort=count')]);
  } catch (e) {
    el.innerHTML = emptyState('Player not found', esc(e.message));
    return;
  }
  const max = state.config.trade.maxItemsPerSide;
  const wantSet = new Set(want ? [want] : []);
  const giveSet = new Set(give);
  if (counterOf) counterOf.give.forEach((c) => wantSet.add(c.id));
  const grid = (cards, set, key) => `<div class="grid-cards picker" data-key="${key}" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:14px">
    ${cards.filter((c) => !c.locked).map((c) => cardHtml(c, { mini: true, cls: set.has(c.id) ? 'picked' : '' })).join('')}</div>`;
  el.innerHTML = `
    <div class="cols-2">
      <div><div class="spread" style="margin-bottom:12px"><h3 class="display">You ask ${esc(theirs.username)} for</h3><span class="mono small" id="n-want"></span></div>
        ${theirs.cards.length ? grid(theirs.cards, wantSet, 'want') : '<p class="muted">Their album is empty.</p>'}</div>
      <div><div class="spread" style="margin-bottom:12px"><h3 class="display">You give</h3><span class="mono small" id="n-give"></span></div>
        ${mine.cards.length ? grid(mine.cards, giveSet, 'give') : '<p class="muted">Your album is empty.</p>'}</div>
    </div>
    <div class="row" style="margin-top:28px;position:sticky;bottom:16px;background:var(--paper);padding:12px 0;border-top:1px solid var(--rule)">
      <input class="input" id="msg" maxlength="200" placeholder="A note (optional)" style="flex:1;min-width:220px">
      <button class="btn solid lg" id="send">${counterOf ? 'Send counter-offer' : 'Send offer'}</button>
    </div>`;
  const counts = () => {
    $('#n-want').textContent = `${wantSet.size}/${max}`;
    $('#n-give').textContent = `${giveSet.size}/${max}`;
  };
  counts();
  $$('.picker', el).forEach((g) => {
    const set = g.dataset.key === 'want' ? wantSet : giveSet;
    $$('.card', g).forEach((c) => c.addEventListener('click', () => {
      const id = Number(c.dataset.id);
      if (set.has(id)) set.delete(id);
      else if (set.size < max) set.add(id);
      else return toast(`At most ${max} cards per side`);
      c.classList.toggle('picked', set.has(id));
      counts();
    }));
  });
  $('#send').onclick = async () => {
    const payload = { give: [...giveSet], want: [...wantSet], message: $('#msg').value };
    try {
      if (counterOf) await post(`/trades/${counterOf.id}/counter`, payload);
      else await post('/trades', { ...payload, to: theirs.username });
      toast(counterOf ? 'Counter-offer sent' : 'Offer sent');
      location.hash = '#/exchange';
    } catch (e) {
      fail(e);
    }
  };
}
