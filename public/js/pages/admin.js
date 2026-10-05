import { api, post, esc, fmt, toast, fail, $$, pageHead, timeAgo } from '../core.js';

export async function pageAdmin({ view, route }) {
  const d = await api('/admin');
  view.innerHTML = `${pageHead({ eyebrow: 'Moderation', title: 'The <em>back office</em>', lede: 'Reports, bans, renames, and where the coins are flowing.' })}
  <div class="cols-main">
    <section>
      <div class="section-head" style="border:0;padding:0"><h2>Open reports</h2><span class="mono small">${d.reports.length}</span></div>
      ${d.reports.length ? `<div class="list">${d.reports.map((r) => `
        <div class="list-row" style="grid-template-columns:1fr auto">
          <span><b>${esc(r.target)}</b>${r.banned ? ' <span class="status-tag declined">banned</span>' : ''} <span class="small muted">reported by ${esc(r.reporter)} · ${timeAgo(r.at)}</span><br>${esc(r.reason)}</span>
          <span class="row">
            <button class="btn quiet sm" data-rename="${esc(r.target)}">Rename</button>
            <button class="btn hot sm" data-ban="${esc(r.target)}">Ban</button>
            <button class="btn quiet sm" data-resolve="${r.id}">Resolve</button>
            <button class="btn link small" data-dismiss="${r.id}">dismiss</button></span>
        </div>`).join('')}</div>` : '<p class="muted">Inbox zero.</p>'}
      <div class="section"><div class="section-head"><h2>Banned</h2></div>
        ${d.banned.length ? `<div class="list">${d.banned.map((b) => `<div class="list-row" style="grid-template-columns:1fr auto"><span>${esc(b.username)} <span class="small muted">${esc(b.ban_reason || '')}</span></span><button class="btn quiet sm" data-unban="${esc(b.username)}">Unban</button></div>`).join('')}</div>` : '<p class="muted">Nobody.</p>'}</div>
    </section>
    <aside class="stack">
      <div class="sheet"><div class="eyebrow plain" style="margin-bottom:10px">Coins gained · 24h</div>
        ${d.earners.map((e) => `<div class="spread small"><span>${esc(e.username)}</span><span class="mono">+${fmt(e.gained)}</span></div>`).join('') || '<p class="muted small">Quiet.</p>'}</div>
      <div class="sheet"><div class="eyebrow plain" style="margin-bottom:10px">Richest</div>
        ${d.richest.map((e) => `<div class="spread small"><span>${esc(e.username)}</span><span class="mono">${fmt(e.coins)}</span></div>`).join('')}</div>
    </aside>
  </div>`;
  const act = (sel, fn) => $$(sel).forEach((b) => (b.onclick = async () => {
    try {
      if ((await fn(b)) !== false) route();
    } catch (e) {
      fail(e);
    }
  }));
  act('[data-ban]', async (b) => {
    const reason = prompt(`Ban ${b.dataset.ban}? Reason:`);
    if (reason === null) return false;
    await post('/admin/ban', { username: b.dataset.ban, reason });
    toast(`${b.dataset.ban} banned`);
  });
  act('[data-unban]', (b) => post('/admin/unban', { username: b.dataset.unban }));
  act('[data-rename]', async (b) => {
    const newName = prompt(`New username for ${b.dataset.rename}:`, `player_${Math.floor(Math.random() * 1e5)}`);
    if (!newName) return false;
    await post('/admin/rename', { username: b.dataset.rename, newName });
  });
  act('[data-resolve]', (b) => post(`/admin/reports/${b.dataset.resolve}`, { status: 'resolved' }));
  act('[data-dismiss]', (b) => post(`/admin/reports/${b.dataset.dismiss}`, { status: 'dismissed' }));
}
