import { api, post, state, esc, fmt, cardHtml, toast, fail, $, pageHead, emptyState, icon } from '../core.js';
import { bindCards } from '../carddetail.js';

export async function pageProfile({ view, route }, name) {
  const p = await api(`/users/${encodeURIComponent(name)}`);
  const since = new Date(p.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  const actions = !state.me || p.isMe ? '' : `
    <div class="row">
      ${p.friendship === 'friends' ? `<a class="btn solid sm" href="#/friends/${encodeURIComponent(p.username)}">${icon('chat')} Message</a>`
        : p.friendship === 'requested' ? '<span class="status-tag pending">request sent</span>'
        : `<button class="btn solid sm" id="befriend">${icon('plus')} ${p.friendship === 'incoming' ? 'Accept friend request' : 'Add friend'}</button>`}
      <a class="btn quiet sm" href="#/duels?tab=new&with=${encodeURIComponent(p.username)}">${icon('swords')} Duel</a>
      <a class="btn quiet sm" href="#/exchange?tab=new&with=${encodeURIComponent(p.username)}">${icon('swap')} Trade</a>
      <button class="btn link small" id="report">${icon('flag')} Report</button>
    </div>`;
  view.innerHTML = `${pageHead({
    eyebrow: `Collector since ${since}`,
    title: `${esc(p.username)}${p.guild ? ` <span class="mono" style="font-size:.35em;vertical-align:middle">[${esc(p.guild.tag)}]</span>` : ''}`,
    lede: `${fmt(p.uniqueCards)} cards · ${fmt(p.score)} points · ${p.duels.wins} duels won · ${fmt(p.quizCorrect)} quiz answers`,
    aside: actions,
  })}
  <section><div class="section-head"><h2>Showcase</h2><span class="small muted">${p.isMe ? 'Pin cards from your album to show them here' : 'Pinned by the collector'}</span></div>
    ${p.showcase.length ? `<div class="grid-cards" id="showcase">${p.showcase.map((c) => cardHtml(c)).join('')}</div>` : emptyState('An empty vitrine', p.isMe ? 'Open a card in your album and pin it.' : '')}</section>
  <section class="section"><div class="section-head"><h2>Achievements</h2><span class="mono small muted">${p.achievements.length}</span></div>
    ${p.achievements.length ? `<div class="chips">${p.achievements.map((a) => `<span class="chip" title="${esc(a.desc)}">${icon('trophy')} ${esc(a.name)}</span>`).join('')}</div>` : '<p class="muted">None yet.</p>'}</section>`;
  if ($('#showcase')) bindCards($('#showcase'));
  $('#befriend')?.addEventListener('click', async () => {
    try {
      await post('/friends', { username: p.username });
      route();
    } catch (e) {
      fail(e);
    }
  });
  $('#report')?.addEventListener('click', async () => {
    const reason = prompt(`What is wrong with ${p.username}? (offensive name, harassment, cheating…)`);
    if (!reason) return;
    try {
      await post('/reports', { username: p.username, reason });
      toast('Thank you — a moderator will review it');
    } catch (e) {
      fail(e);
    }
  });
}

export async function pageAchievements({ view }) {
  const list = await api('/achievements');
  const done = list.filter((a) => a.unlockedAt).length;
  view.innerHTML = `${pageHead({
    eyebrow: 'Achievements', title: `${done} <em>of ${list.length}</em>`,
    lede: 'Each achievement pays out once, in coins.',
  })}
  <div class="cols-2">${[list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))].map((col) => `<div>${col.map((a) => `
    <div class="ach ${a.unlockedAt ? 'done' : ''}"><span class="medal">${icon('trophy')}</span>
      <span><b>${esc(a.name)}</b><br><span class="small muted">${esc(a.desc)}</span></span>
      <span class="mono small ${a.unlockedAt ? '' : 'muted'}">${a.unlockedAt ? new Date(a.unlockedAt).toLocaleDateString() : `+${fmt(a.reward)}`}</span></div>`).join('')}</div>`).join('')}</div>`;
}
