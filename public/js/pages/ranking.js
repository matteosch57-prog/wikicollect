import { api, state, esc, fmt, pageHead } from '../core.js';

export async function pageRanking({ view, params }) {
  const tab = params.get('tab') || 'score';
  const lb = await api('/leaderboard');
  const me = state.me?.username;
  const tabs = [['score', 'Collectors'], ['week', 'This week'], ['duels', 'Duelists'], ['quiz', 'Quiz'], ['guilds', 'Guilds']];
  const row = (i, who, right, sub = '') => `<div class="list-row ${who === me ? 'me' : ''}">
    <span class="rank">${i + 1}</span><span>${who ? `<a class="who" href="#/u/${encodeURIComponent(who)}">${esc(who)}</a>` : ''}${sub}</span><span class="mono">${right}</span></div>`;
  const body = {
    score: () => lb.score.map((r, i) => row(i, r.username, `${fmt(r.score)} pts`,
      `${r.guild ? `<span class="tag">[${esc(r.guild)}]</span>` : ''}<br><span class="small muted">${fmt(r.cards)} cards${r.best ? ` · best <span class="seal" data-r="${r.best}" style="height:15px;font-size:8.5px">${r.best}</span>` : ''}</span>`)),
    week: () => lb.week.rows.map((r, i) => row(i, r.username, `${fmt(r.score)} pts`, `<br><span class="small muted">${fmt(r.cards)} new cards since Monday</span>`)),
    duels: () => lb.duels.map((r, i) => row(i, r.username, `${r.wins} W · ${r.losses} L`)),
    quiz: () => lb.quiz.map((r, i) => row(i, r.username, `${fmt(r.correct)} correct`)),
    guilds: () => lb.guilds.map((g, i) => `<div class="list-row"><span class="rank">${i + 1}</span>
      <span><b>${esc(g.name)}</b> <span class="tag">[${esc(g.tag)}]</span><br><span class="small muted">${g.members} members</span></span><span class="mono">${fmt(g.score)} pts</span></div>`),
  }[tab]?.() || [];
  view.innerHTML = `${pageHead({
    index: '09', eyebrow: 'Ranking', title: 'The <em>standings</em>',
    lede: `Points per distinct card: ${state.config.rarities.map((r) => `${r.id} ${r.points}`).join(' · ')}. The weekly table restarts every Monday.`,
  })}
  <div class="tabs">${tabs.map(([id, l]) => `<a href="#/ranking?tab=${id}" class="${tab === id ? 'active' : ''}">${l}</a>`).join('')}</div>
  <div class="list" id="board">${body.join('') || '<p class="muted" style="padding:18px 0">No entries yet.</p>'}</div>`;
}
