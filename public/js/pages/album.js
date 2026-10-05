import { api, post, state, esc, fmt, cardHtml, toast, fail, $, $$, rarity, pageHead, emptyState, debounce, confirmDialog, icon } from '../core.js';
import { bindCards } from '../carddetail.js';

const TIERS = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
const SORTS = [['rarity', 'Rarest first'], ['recent', 'Newest'], ['atk', 'Attack'], ['def', 'Defence'], ['title', 'A–Z'], ['count', 'Most copies']];

export async function pageAlbum(ctx) {
  const { view, params, route } = ctx;
  const tab = params.get('tab') || 'cards';
  const set = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    location.hash = `#/album?${p}`;
  };

  view.innerHTML = `${pageHead({
    index: '02', eyebrow: 'Album', title: 'Your <em>collection</em>',
    lede: `${fmt(state.me.uniqueCards)} distinct entries · ${fmt(state.me.totalCards)} cards · ${fmt(state.me.score)} points`,
    aside: `<div class="row"><a class="btn quiet sm" href="/api/export?format=csv" download>${icon('download')} CSV</a><a class="btn quiet sm" href="/api/export" download>${icon('download')} JSON</a></div>`,
  })}
  <div class="tabs"><a href="#/album" class="${tab === 'cards' ? 'active' : ''}">Cards</a><a href="#/album?tab=wishlist" class="${tab === 'wishlist' ? 'active' : ''}">Wishlist</a></div>
  <div id="album-body"><div class="skeleton"></div></div>`;
  const body = $('#album-body');
  bindCards(body, { onChange: route });

  if (tab === 'wishlist') {
    const list = await api('/wishlist');
    body.innerHTML = list.length
      ? `<p class="muted small" style="margin-top:0">Cards leave the wishlist automatically when you obtain them. You are notified when one goes up for auction.</p>
         <div class="grid-cards">${list.map((c) => cardHtml(c, { ghost: false })).join('')}</div>`
      : emptyState('Nothing wished for yet', 'Open any card you do not own — in the market, a friend’s album, the recent finds — and add it to your wishlist.');
    return;
  }

  const q = params.get('q') || '';
  const r = params.get('rarity') || '';
  const sort = params.get('sort') || 'rarity';
  const tag = params.get('tag') || '';
  const dupes = params.get('dupes') === '1';
  const locked = params.get('locked') === '1';
  const page = Math.max(0, Number(params.get('page')) || 0);
  const limit = 60;
  const data = await api(`/collection?${new URLSearchParams({ q, rarity: r, sort, tag, dupes: dupes ? '1' : '', locked: locked ? '1' : '', limit, offset: page * limit })}`);
  const total = Object.values(data.byRarity).reduce((s, n) => s + n, 0);

  body.innerHTML = `
    <div class="spread" style="margin-bottom:16px">
      <div class="chips">
        <button class="chip ${!r ? 'on' : ''}" data-r="">All <span class="num">${fmt(total)}</span></button>
        ${TIERS.map((t) => `<button class="chip ${r === t ? 'on' : ''}" data-r="${t}"><span class="seal" data-r="${t}" style="height:16px;min-width:22px;font-size:9px">${t}</span> ${esc(rarity(t).name)} <span class="num">${fmt(data.byRarity[t])}</span></button>`).join('')}
      </div>
    </div>
    <div class="spread" style="margin-bottom:28px">
      <div class="row">
        <input class="input" id="q" placeholder="Search your album" value="${esc(q)}" style="width:240px">
        <select class="input" id="sort" style="width:160px">${SORTS.map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="chip ${dupes ? 'on' : ''}" id="dupes">Duplicates</button>
        <button class="chip ${locked ? 'on' : ''}" id="locked">${icon('lock')} Locked</button>
        ${data.tags.map((t) => `<button class="chip ${tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}
      </div>
      <button class="btn quiet sm" id="recycle-all">${icon('recycle')} Recycle spare C–R</button>
    </div>
    ${data.cards.length
      ? `<div class="grid-cards">${data.cards.map((c) => cardHtml(c)).join('')}</div>`
      : total ? emptyState('No match', 'Try another filter.') : emptyState('An empty album', 'Every collection starts with a single pack.', '<a class="btn solid" href="#/">Open a pack</a>')}
    ${data.total > limit ? `<div class="row" style="justify-content:center;margin-top:36px">
      <button class="btn quiet sm" id="prev" ${page === 0 ? 'disabled' : ''}>Previous</button>
      <span class="mono small muted">${page + 1} / ${Math.ceil(data.total / limit)}</span>
      <button class="btn quiet sm" id="next" ${(page + 1) * limit >= data.total ? 'disabled' : ''}>Next</button></div>` : ''}`;

  $$('[data-r]', body).forEach((b) => b.tagName === 'BUTTON' && (b.onclick = () => set('rarity', b.dataset.r)));
  $$('[data-tag]', body).forEach((b) => (b.onclick = () => set('tag', tag === b.dataset.tag ? '' : b.dataset.tag)));
  $('#sort').onchange = (e) => set('sort', e.target.value);
  $('#dupes').onclick = () => set('dupes', dupes ? '' : '1');
  $('#locked').onclick = () => set('locked', locked ? '' : '1');
  $('#q').addEventListener('input', debounce((e) => set('q', e.target.value.trim()), 350));
  if (q) {
    $('#q').focus();
    $('#q').setSelectionRange(q.length, q.length);
  }
  $('#prev')?.addEventListener('click', () => set('page', String(page - 1)));
  $('#next')?.addEventListener('click', () => set('page', String(page + 1)));
  $('#recycle-all').onclick = async () => {
    if (!(await confirmDialog('Recycle every spare Common, Uncommon and Rare copy into coins? One copy of each card stays, and locked cards are never touched.', { ok: 'Recycle' }))) return;
    try {
      const res = await post('/recycle/duplicates', { maxRarity: 'R' });
      toast(res.cards ? `Recycled ${res.cards} cards for ${fmt(res.coins)} coins` : 'No spare copies to recycle');
      route();
    } catch (e) {
      fail(e);
    }
  };
}
