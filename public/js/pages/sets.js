import { api, post, state, esc, fmt, cardHtml, toast, fail, $, $$, pageHead, emptyState } from '../core.js';
import { bindCards } from '../carddetail.js';

export async function pageSets({ view, route }) {
  view.innerHTML = `${pageHead({
    index: '03', eyebrow: 'Sets', title: 'Albums you can <em>finish</em>',
    lede: `Fixed lists of articles. Set cards drop from the theme packs in the shop and from regular packs. Each finished set pays ${state.config.setRewardPacks} bonus packs.`,
  })}<div id="sets"><div class="skeleton"></div></div>`;
  const sets = await api('/sets');
  const el = $('#sets');
  if (!sets.length) {
    el.innerHTML = emptyState('No sets for this language yet');
    return;
  }
  el.innerHTML = sets.map((s, i) => `
    <section class="section" style="margin-top:${i ? 56 : 0}px">
      <div class="spread" style="margin-bottom:12px">
        <div><div class="eyebrow plain mono">Set ${String(i + 1).padStart(2, '0')} · ${s.owned}/${s.size}</div>
          <h2 class="display" style="font-size:40px;margin-top:8px">${esc(s.name)}</h2></div>
        ${s.claimed ? '<span class="status-tag accepted">Reward claimed</span>'
          : s.complete ? `<button class="btn hot" data-claim="${esc(s.id)}">Claim ${s.reward} packs</button>`
          : `<span class="small muted">${s.size - s.owned} to go · ${s.reward} packs</span>`}
      </div>
      <div class="progress" style="margin-bottom:22px"><div style="width:${(s.owned / s.size) * 100}%"></div></div>
      <div class="set-row">${s.members.map((m) => (m.owned
        ? cardHtml(m.card)
        : m.card ? cardHtml(m.card, { ghost: true }) : `<div class="slot-empty">${esc(m.title)}</div>`)).join('')}</div>
    </section>`).join('');
  bindCards(el, { onChange: route });
  $$('[data-claim]', el).forEach((b) => (b.onclick = async () => {
    try {
      const r = await post(`/sets/${b.dataset.claim}/claim`);
      toast(`+${fmt(r.packs)} packs added to your reserve`);
      route();
    } catch (e) {
      fail(e);
    }
  }));
}
