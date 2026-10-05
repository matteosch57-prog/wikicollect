import { api, post, esc, toast, fail, $, $$, pageHead, emptyState, timeAgo, icon, confirmDialog } from '../core.js';

export async function pageFriends(ctx) {
  const { view, route } = ctx;
  const f = await api('/friends');
  view.innerHTML = `${pageHead({
    index: '08', eyebrow: 'Friends', title: 'Your <em>correspondents</em>',
    lede: 'Message friends, challenge them to duels, offer them trades. Only friends can write to you.',
  })}
  <div class="cols-main">
    <div>
      ${f.incoming.length ? `<div class="eyebrow" style="margin-bottom:8px">Requests</div><div class="list" style="margin-bottom:36px">${f.incoming.map((r) => `
        <div class="list-row" style="grid-template-columns:1fr auto"><span><a class="who" href="#/u/${encodeURIComponent(r.username)}">${esc(r.username)}</a> <span class="small muted">wants to be friends</span></span>
          <span class="row"><button class="btn solid sm" data-accept="${esc(r.username)}">Accept</button><button class="btn quiet sm" data-decline="${esc(r.username)}">Ignore</button></span></div>`).join('')}</div>` : ''}
      <div class="eyebrow" style="margin-bottom:8px">Friends</div>
      ${f.friends.length ? `<div class="list">${f.friends.map((fr) => `
        <div class="list-row" style="grid-template-columns:1fr auto">
          <a href="#/friends/${encodeURIComponent(fr.username)}" style="text-decoration:none"><b>${esc(fr.username)}</b>${fr.unread ? ` <span class="status-tag pending">${fr.unread} new</span>` : ''}<br>
            <span class="small muted">${fr.lastMessage ? `${fr.lastMessage.mine ? 'You: ' : ''}${esc(fr.lastMessage.body)} · ${timeAgo(fr.lastMessage.at)}` : 'No messages yet'}</span></a>
          <span class="row"><a class="btn quiet sm icon" title="Message" href="#/friends/${encodeURIComponent(fr.username)}">${icon('chat')}</a>
            <a class="btn quiet sm icon" title="Duel" href="#/duels?tab=new&with=${encodeURIComponent(fr.username)}">${icon('swords')}</a>
            <a class="btn quiet sm icon" title="Trade" href="#/exchange?tab=new&with=${encodeURIComponent(fr.username)}">${icon('swap')}</a></span>
        </div>`).join('')}</div>` : emptyState('No friends yet', 'Add someone from the ranking, your guild or a trade.')}
    </div>
    <aside class="stack">
      <form class="sheet stack" id="add"><div class="eyebrow plain">Add a friend</div>
        <input class="input" name="u" placeholder="Username" required><button class="btn solid">Send request</button></form>
      ${f.outgoing.length ? `<div class="small muted">Pending: ${f.outgoing.map((o) => esc(o.username)).join(', ')}</div>` : ''}
    </aside>
  </div>`;
  $('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await post('/friends', { username: e.target.u.value.trim() });
      toast(r.status === 'friends' ? 'You are now friends' : 'Request sent');
      route();
    } catch (err) {
      fail(err);
    }
  });
  $$('[data-accept]').forEach((b) => (b.onclick = () => post(`/friends/${encodeURIComponent(b.dataset.accept)}/accept`).then(() => ctx.refreshMe()).then(route, fail)));
  $$('[data-decline]').forEach((b) => (b.onclick = () => post(`/friends/${encodeURIComponent(b.dataset.decline)}/decline`).then(route, fail)));
}

export async function pageChat(ctx, name) {
  const { view, onLeave } = ctx;
  let convo;
  try {
    convo = await api(`/dms/${encodeURIComponent(name)}`);
  } catch (e) {
    view.innerHTML = emptyState('Conversation unavailable', esc(e.message), '<a class="btn solid" href="#/friends">Back to friends</a>');
    return;
  }
  view.innerHTML = `
    <div class="eyebrow"><a href="#/friends">Friends</a> · conversation</div>
    <div class="spread" style="margin:14px 0 22px"><h1 class="display" style="font-size:56px">${esc(convo.with)}</h1>
      <div class="row"><a class="btn quiet sm" href="#/duels?tab=new&with=${encodeURIComponent(convo.with)}">${icon('swords')} Duel</a>
        <a class="btn quiet sm" href="#/exchange?tab=new&with=${encodeURIComponent(convo.with)}">${icon('swap')} Trade</a>
        <a class="btn quiet sm" href="#/u/${encodeURIComponent(convo.with)}">Profile</a>
        <button class="btn link small" id="unfriend">Remove friend</button></div></div>
    <div class="chat"><div class="log" id="log"></div>
      <form id="say"><input class="input" name="body" maxlength="1000" placeholder="Write a message" autocomplete="off" autofocus><button class="btn solid">Send</button></form></div>`;
  const log = $('#log');
  let last = 0;
  const add = (msgs) => {
    if (!msgs.length) return;
    $('[data-empty]', log)?.remove();
    log.insertAdjacentHTML('beforeend', msgs.map((m) => `<div class="msg ${m.mine ? 'mine' : ''}"><small>${timeAgo(m.at)}</small>${esc(m.body)}</div>`).join(''));
    last = Math.max(last, msgs.at(-1).id);
    log.scrollTop = log.scrollHeight;
  };
  if (convo.messages.length) add(convo.messages);
  else log.innerHTML = '<p class="muted small" data-empty>Start the conversation — perhaps with a trade proposal.</p>';
  const poll = setInterval(async () => {
    try {
      add((await api(`/dms/${encodeURIComponent(name)}?after=${last}`)).messages.filter((m) => m.id > last));
    } catch {}
  }, 4000);
  onLeave(() => clearInterval(poll));
  $('#say').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.body;
    if (!input.value.trim()) return;
    try {
      add([await post(`/dms/${encodeURIComponent(name)}`, { body: input.value })]);
      input.value = '';
    } catch (err) {
      fail(err);
    }
  });
  $('#unfriend').onclick = async () => {
    if (!(await confirmDialog(`Remove ${convo.with} from your friends?`, { ok: 'Remove', danger: true }))) return;
    await post(`/friends/${encodeURIComponent(name)}/remove`).catch(fail);
    location.hash = '#/friends';
  };
}
