import { api, post, esc, fmt, icon, cardHtml, drawer, toast, fail, rarity, wikiUrl, state, $, confirmDialog } from './core.js';

// Opens the card drawer. `onChange` lets the calling page refresh itself.
export async function openCard(id, { onChange } = {}) {
  let card;
  try {
    card = await api(`/cards/${id}`);
  } catch (e) {
    return fail(e);
  }
  const r = rarity(card.rarity);
  const owned = card.mine > 0;
  const recycle = r.recycle || 0;
  const M = state.config.market;

  const d = drawer(`
    <div class="detail-card">${cardHtml({ ...card, count: card.mine })}</div>
    <div class="eyebrow plain"><span class="seal" data-r="${esc(card.rarity)}">${esc(card.rarity)}</span> ${esc(r.name)}</div>
    <h2 class="display" style="font-size: 44px; margin: 12px 0 6px">${esc(card.title)}</h2>
    ${card.description ? `<p class="muted" style="margin:0 0 14px"><em>${esc(card.description)}</em></p>` : ''}
    <p style="font-size: 15.5px; line-height: 1.6">${esc(card.extract || '')}</p>
    <dl class="kv">
      <dt>Attack <span class="small">· length × ${r.multiplier} rarity multiplier</span></dt><dd>${fmt(card.atk)}</dd>
      <dt>Defence <span class="small">· article quality</span></dt><dd>${fmt(card.def)}</dd>
      <dt>Readers per day</dt><dd>${fmt(card.views)}</dd>
      <dt>Length</dt><dd>${fmt(Math.round(card.bytes / 1024))} kB</dd>
      <dt>References · images · sections</dt><dd>${fmt(card.refs)} · ${fmt(card.images)} · ${fmt(card.sections)}</dd>
      ${card.badge ? `<dt>Wikipedia label</dt><dd>${card.badge === 'featured' ? 'Featured article' : 'Good article'}</dd>` : ''}
      <dt>Collectors</dt><dd>${fmt(card.owners)}</dd>
      ${card.discoveredBy ? `<dt>First pulled by</dt><dd><a href="#/u/${encodeURIComponent(card.discoveredBy)}">${esc(card.discoveredBy)}</a></dd>` : ''}
      <dt>In your album</dt><dd>${owned ? `×${card.mine}` : '—'}</dd>
    </dl>

    ${owned ? `
      <div class="row" style="margin-bottom:12px">
        <button class="btn quiet sm" data-act="pin">${icon('pin')} ${card.pinned ? 'Unpin from showcase' : 'Pin to showcase'}</button>
        <button class="btn quiet sm" data-act="lock">${icon(card.locked ? 'unlock' : 'lock')} ${card.locked ? 'Unlock' : 'Lock'}</button>
        ${card.mine > 1 ? `<button class="btn quiet sm" data-act="recycle" ${card.locked ? 'disabled' : ''}>${icon('recycle')} Recycle one · +${recycle}</button>` : ''}
      </div>
      <form class="row" data-form="tags" style="margin-bottom:12px">
        <input class="input" name="tags" placeholder="Tags, comma separated" value="${esc(card.tags.join(', '))}" style="flex:1; height:36px">
        <button class="btn quiet sm">${icon('tag')} Save tags</button>
      </form>
      <details ${card.locked ? '' : ''}>
        <summary class="btn link" style="list-style:none">${icon('gavel')} Put up for auction</summary>
        ${card.locked ? '<p class="small muted">Unlock the card to sell it.</p>'
          : card.relistAfter ? `<p class="small muted">Bought at auction — can be relisted after ${new Date(card.relistAfter).toLocaleString()}.</p>`
          : `<form data-form="auction" class="stack" style="margin-top:14px">
            <div class="row">
              <div class="field" style="flex:1"><label>Starting price</label><input class="input" name="price" type="number" min="1" step="1" value="${Math.max(10, recycle * 2)}"></div>
              <div class="field"><label>Duration</label><select class="input" name="h">${M.durationsH.map((h) => `<option value="${h}" ${h === 24 ? 'selected' : ''}>${h} h</option>`).join('')}</select></div>
            </div>
            <p class="small muted" style="margin:0">Listing fee ${Math.round(M.listingFeeRate * 100)}% (min ${M.minListingFee}) and ${Math.round(M.salesTaxRate * 100)}% sales tax — both are destroyed to fight inflation.</p>
            <div><button class="btn solid">${icon('gavel')} List this card</button></div>
          </form>`}
      </details>`
    : `<div class="row"><button class="btn ${card.wished ? 'quiet' : 'solid'}" data-act="wish">${icon('star')} ${card.wished ? 'On your wishlist' : 'Add to wishlist'}</button>
        <a class="btn quiet" href="#/market?scope=all&q=${encodeURIComponent(card.title)}">${icon('gavel')} Find at auction</a></div>`}

    <div class="row" style="margin-top:18px"><a class="btn quiet sm" href="${esc(wikiUrl(card))}" target="_blank" rel="noopener">${icon('book')} Read on Wikipedia</a></div>
    <p class="attribution">Text and image from the Wikipedia article “${esc(card.title)}”, available under CC BY-SA 4.0. Stats are computed by WikiCollect when the card was first discovered.</p>
  `);

  const refresh = () => {
    d.close();
    onChange?.();
  };
  const act = async (name, fn) => {
    const btn = $(`[data-act="${name}"]`, d.el);
    btn?.addEventListener('click', async () => {
      try {
        await fn();
      } catch (e) {
        fail(e);
      }
    });
  };
  act('pin', async () => {
    await post(`/cards/${id}/flags`, { pinned: !card.pinned });
    toast(card.pinned ? 'Removed from your showcase' : 'Pinned to your showcase');
    refresh();
  });
  act('lock', async () => {
    await post(`/cards/${id}/flags`, { locked: !card.locked });
    toast(card.locked ? 'Card unlocked' : 'Card locked — it can no longer be recycled, sold or traded');
    refresh();
  });
  act('recycle', async () => {
    const res = await post('/recycle', { articleId: id, qty: 1 });
    toast(`+${res.coins} coins`);
    refresh();
  });
  act('wish', async () => {
    await post(`/cards/${id}/wish`, { wished: !card.wished });
    toast(card.wished ? 'Removed from wishlist' : 'Added to your wishlist — you will be notified when it is auctioned');
    refresh();
  });
  $('[data-form="tags"]', d.el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const tags = new FormData(e.target).get('tags').split(',').map((t) => t.trim()).filter(Boolean);
      await post(`/cards/${id}/flags`, { tags });
      toast('Tags saved');
      refresh();
    } catch (err) {
      fail(err);
    }
  });
  $('[data-form="auction"]', d.el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const ok = await confirmDialog(`List “${card.title}” starting at ${f.get('price')} coins for ${f.get('h')} hours?`, { ok: 'List it' });
    if (!ok) return;
    try {
      const a = await post('/auctions', { articleId: id, startPrice: Number(f.get('price')), durationH: Number(f.get('h')) });
      toast('Your card is on the market');
      d.close();
      location.hash = `#/market/${a.id}`;
    } catch (err) {
      fail(err);
    }
  });
}

// Delegated click handler: any card in `root` opens its drawer.
export function bindCards(root, opts) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('.card[data-id]');
    if (el && !el.closest('.picker') && root.contains(el)) openCard(Number(el.dataset.id), opts);
  });
}
