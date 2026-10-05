import { api, post, state, esc, fmt, toast, fail, $, $$, pageHead, emptyState, timeAgo, confirmDialog, debounce } from '../core.js';

export async function pageGuild(ctx) {
  const { view, params, route, onLeave } = ctx;
  const mine = await api('/guild');
  const G = state.config.guild;

  if (!mine) {
    const q = params.get('q') || '';
    const join = Number(params.get('join')) || null;
    const guilds = await api(`/guilds${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    view.innerHTML = `${pageHead({
      index: '07', eyebrow: 'Guilds', title: 'Find your <em>circle</em>',
      lede: `Join a guild to chat and climb the guild table together — its score is the sum of its members’ collections. Up to ${G.maxMembers} members.`,
    })}
    <div class="cols-main">
      <div>
        <input class="input" id="gq" placeholder="Search guilds" value="${esc(q)}" style="max-width:320px;margin-bottom:20px">
        ${guilds.length ? `<div class="list">${guilds.map((g) => `
          <div class="list-row" style="grid-template-columns:64px 1fr auto;${g.id === join ? 'background:var(--paper-2)' : ''}">
            <span class="mono" style="font-weight:600">[${esc(g.tag)}]</span>
            <span><b>${esc(g.name)}</b><br><span class="small muted">${esc(g.description || '')}</span></span>
            <span class="row"><span class="mono small muted">${g.members}/${g.maxMembers}</span>
              <button class="btn ${g.id === join ? 'solid' : 'quiet'} sm" data-join="${g.id}" ${g.members >= g.maxMembers ? 'disabled' : ''}>Join</button></span>
          </div>`).join('')}</div>` : emptyState('No guild yet', 'Be the first to found one.')}
      </div>
      <form class="sheet stack" id="create">
        <div class="eyebrow plain">Found a guild</div>
        <div class="field"><label>Name</label><input class="input" name="name" maxlength="32" required></div>
        <div class="field"><label>Tag · 2–5 characters</label><input class="input" name="tag" maxlength="5" required style="text-transform:uppercase"></div>
        <div class="field"><label>Motto</label><textarea class="input" name="description" maxlength="300" rows="3"></textarea></div>
        <button class="btn solid">Found for ${fmt(G.createCost)} coins</button>
        <p class="small muted" style="margin:0">The fee is destroyed (coin sink).</p>
      </form>
    </div>`;
    $('#gq').addEventListener('input', debounce((e) => (location.hash = `#/guild?q=${encodeURIComponent(e.target.value.trim())}`), 400));
    $$('[data-join]').forEach((b) => (b.onclick = async () => {
      try {
        await post(`/guilds/${b.dataset.join}/join`);
        toast('Welcome to the guild');
        await ctx.refreshMe();
        location.hash = '#/guild';
      } catch (e) {
        fail(e);
      }
    }));
    $('#create').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await post('/guilds', { name: f.get('name'), tag: f.get('tag'), description: f.get('description') });
        await ctx.refreshMe();
        route();
      } catch (err) {
        fail(err);
      }
    });
    return;
  }

  const g = mine;
  view.innerHTML = `${pageHead({
    index: '07', eyebrow: `Guild · [${esc(g.tag)}]`, title: esc(g.name),
    lede: esc(g.description || ''),
    aside: `<div class="mono small" style="text-align:right">${fmt(g.score)} pts<br>${g.members.length}/${g.maxMembers} members</div>`,
  })}
  <div class="cols-main">
    <div class="chat"><div class="log" id="log"></div>
      <form id="say"><input class="input" name="body" maxlength="1000" placeholder="Write to the guild" autocomplete="off"><button class="btn solid">Send</button></form></div>
    <aside>
      <div class="eyebrow" style="margin-bottom:8px">Members</div>
      <div class="list">${g.members.map((m, i) => `
        <div class="list-row" style="grid-template-columns:28px 1fr auto">
          <span class="mono small muted">${i + 1}</span>
          <span><a class="who" href="#/u/${encodeURIComponent(m.username)}">${esc(m.username)}</a>${m.role === 'owner' ? '<span class="tag">FOUNDER</span>' : ''}</span>
          <span class="row"><span class="mono small">${fmt(m.score)}</span>${g.isOwner && m.role !== 'owner' ? `<button class="btn link small" data-kick="${esc(m.username)}">remove</button>` : ''}</span>
        </div>`).join('')}</div>
      <form class="row" id="invite" style="margin-top:18px"><input class="input" name="u" placeholder="Invite a friend" style="flex:1"><button class="btn quiet sm">Invite</button></form>
      <button class="btn link small" id="leave" style="margin-top:22px">Leave the guild</button>
    </aside>
  </div>`;

  let last = 0;
  const log = $('#log');
  const load = async () => {
    try {
      const msgs = await api(`/guild/chat?after=${last}`);
      if (!msgs.length) {
        if (!last && !log.children.length) log.innerHTML = '<p class="muted small" data-empty>No messages yet. Say hello.</p>';
        return;
      }
      $('[data-empty]', log)?.remove();
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
      log.insertAdjacentHTML('beforeend', msgs.map((m) => `<div class="msg ${m.mine ? 'mine' : ''}"><small>${esc(m.from)} · ${timeAgo(m.at)}</small>${esc(m.body)}</div>`).join(''));
      last = msgs.at(-1).id;
      if (atBottom || msgs.some((m) => m.mine)) log.scrollTop = log.scrollHeight;
    } catch {}
  };
  await load();
  log.scrollTop = log.scrollHeight;
  const poll = setInterval(load, 4000);
  onLeave(() => clearInterval(poll));

  $('#say').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.body;
    if (!input.value.trim()) return;
    try {
      await post('/guild/chat', { body: input.value });
      input.value = '';
      load();
    } catch (err) {
      fail(err);
    }
  });
  $('#invite').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post('/guild/invite', { username: e.target.u.value.trim() });
      toast('Invitation sent');
      e.target.reset();
    } catch (err) {
      fail(err);
    }
  });
  $$('[data-kick]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(`Remove ${b.dataset.kick} from the guild?`, { ok: 'Remove', danger: true }))) return;
    try {
      await post('/guild/kick', { username: b.dataset.kick });
      route();
    } catch (e) {
      fail(e);
    }
  }));
  $('#leave').onclick = async () => {
    if (!(await confirmDialog(`Leave ${g.name}?${g.isOwner ? ' The longest-standing member becomes founder.' : ''}`, { ok: 'Leave', danger: true }))) return;
    try {
      await post('/guild/leave');
      await ctx.refreshMe();
      route();
    } catch (e) {
      fail(e);
    }
  };
}
