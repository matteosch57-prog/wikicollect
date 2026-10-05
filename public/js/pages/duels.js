import { api, post, state, esc, fmt, cardHtml, toast, fail, $, $$, pageHead, emptyState, timeAgo, icon } from '../core.js';
import { bindCards } from '../carddetail.js';

const STATUS_LABEL = { pending: 'invited', active: 'in play', finished: 'finished', declined: 'declined', cancelled: 'cancelled' };

function maskClue(text) {
  return esc(text).replaceAll('▇▇▇', '<span class="mask">▇▇▇▇▇</span>');
}

// Deck picker: resolves with the selected card ids.
async function deckPicker(container, { size, cta }) {
  const data = await api('/collection?limit=200&sort=atk');
  const picked = new Set();
  container.innerHTML = `
    <div class="spread" style="margin-bottom:14px"><p class="muted" style="margin:0">Pick ${size} cards. Round N pits your card N against theirs: high attack scores, high defence absorbs.</p>
      <div class="row"><span class="mono small" id="deck-sum">0/${size}</span><button class="btn solid" id="deck-go" disabled>${esc(cta)}</button></div></div>
    ${data.cards.length >= size ? `<div class="grid-cards picker" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${data.cards.map((c) => cardHtml(c, { mini: true })).join('')}</div>`
      : emptyState('Not enough cards', `You need at least ${size} cards to duel.`, '<a class="btn solid" href="#/">Open packs</a>')}`;
  const byId = new Map(data.cards.map((c) => [c.id, c]));
  return new Promise((resolve) => {
    const update = () => {
      const cards = [...picked].map((id) => byId.get(id));
      const atk = cards.reduce((s, c) => s + c.atk, 0);
      const def = cards.reduce((s, c) => s + c.def, 0);
      $('#deck-sum', container).textContent = `${picked.size}/${size} · ATK ${fmt(atk)} · DEF ${fmt(def)}`;
      $('#deck-go', container).disabled = picked.size !== size;
    };
    $$('.card', container).forEach((el) => el.addEventListener('click', () => {
      const id = Number(el.dataset.id);
      if (picked.has(id)) picked.delete(id);
      else if (picked.size < size) picked.add(id);
      else return toast(`A deck holds ${size} cards`);
      el.classList.toggle('picked', picked.has(id));
      update();
    }));
    $('#deck-go', container)?.addEventListener('click', () => resolve([...picked]));
  });
}

export async function pageDuels(ctx) {
  const { view, params, route } = ctx;
  const tab = params.get('tab') || 'duels';
  view.innerHTML = `${pageHead({
    index: '04', eyebrow: 'Duels', title: 'Know your <em>cards</em>',
    lede: `A quiz built from your own deck. You have ${state.config.duel.answerWindowMs / 1000} seconds per question. Win: +${state.config.duel.winCoins} coins · take part: +${state.config.duel.loseCoins}.`,
    aside: `<span class="mono small muted">${state.me.duels.wins} W · ${state.me.duels.losses} L</span>`,
  })}
  <div class="tabs">
    <a href="#/duels" class="${tab === 'duels' ? 'active' : ''}">Your duels</a>
    <a href="#/duels?tab=new" class="${tab === 'new' ? 'active' : ''}">Challenge</a>
    <a href="#/duels?tab=training" class="${tab === 'training' ? 'active' : ''}">Training</a>
  </div>
  <div id="duels-body"><div class="skeleton"></div></div>`;
  const body = $('#duels-body');

  if (tab === 'new') {
    const friends = await api('/friends');
    const pre = params.get('with') || '';
    body.innerHTML = `
      <div class="row" style="margin-bottom:22px">
        <div class="field" style="min-width:260px"><label>Opponent</label>
          <input class="input" id="opp" list="friend-list" placeholder="Username" value="${esc(pre)}"></div>
        <datalist id="friend-list">${friends.friends.map((f) => `<option value="${esc(f.username)}">`).join('')}</datalist>
      </div><div id="picker"></div>`;
    const deck = await deckPicker($('#picker'), { size: state.config.duel.deckSize, cta: 'Send challenge' });
    const opponent = $('#opp').value.trim();
    if (!opponent) return fail(new Error('Choose an opponent first'));
    try {
      const d = await post('/duels', { opponent, deck });
      toast(`Challenge sent to ${opponent}`);
      location.hash = `#/duels/${d.id}`;
    } catch (e) {
      fail(e);
      route();
    }
    return;
  }

  if (tab === 'training') return training(body);

  const list = await api('/duels');
  const group = (title, items) => (items.length ? `
    <section style="margin-bottom:36px"><div class="eyebrow" style="margin-bottom:10px">${title}</div>
    <div class="list">${items.map((d) => `
      <a class="list-row" href="#/duels/${d.id}" style="text-decoration:none">
        <span class="rank">${icon('swords')}</span>
        <span><b>${esc(d.you)}</b> <span class="muted">vs</span> <b>${esc(d.them)}</b>
          <span class="small muted"> · ${timeAgo(d.createdAt)}</span></span>
        <span class="row">${d.result ? `<span class="mono small">${fmt(d.myScore)} – ${fmt(d.theirScore)}</span><span class="status-tag ${d.result}">${d.result}</span>`
          : `<span class="status-tag ${d.status}">${d.needsMyDeck ? 'your answer' : d.myTurn ? 'your turn' : STATUS_LABEL[d.status]}</span>`}</span>
      </a>`).join('')}</div></section>` : '');
  body.innerHTML = list.length
    ? group('Waiting for you', list.filter((d) => d.needsMyDeck || d.myTurn))
      + group('Waiting for them', list.filter((d) => ['pending', 'active'].includes(d.status) && !d.needsMyDeck && !d.myTurn))
      + group('Finished', list.filter((d) => !['pending', 'active'].includes(d.status)))
    : emptyState('No duels yet', 'Challenge a friend — or anyone on the ranking.', '<a class="btn solid" href="#/duels?tab=new">Challenge someone</a>');
}

export async function pageDuel(ctx, idStr) {
  const { view, route } = ctx;
  const id = Number(idStr);
  const d = await api(`/duels/${id}`);
  const head = `<div class="eyebrow"><a href="#/duels">Duels</a> · № ${id}</div>
    <div class="versus" style="margin:18px 0 30px">
      <div><div class="display" style="font-size:44px">${esc(d.you)}</div><div class="mono">${fmt(d.myScore)} pts</div></div>
      <div class="vs">vs</div>
      <div style="text-align:right"><div class="display" style="font-size:44px">${esc(d.them)}</div><div class="mono">${d.theirScore === null ? 'hidden' : `${fmt(d.theirScore)} pts`}</div></div>
    </div>`;

  if (d.needsMyDeck) {
    view.innerHTML = `${head}<div class="spread" style="margin-bottom:18px"><p class="lede" style="margin:0">${esc(d.challenger)} challenged you. Pick your deck to accept.</p>
      <button class="btn quiet" id="decline">Decline</button></div><div id="picker"></div>`;
    $('#decline').onclick = async () => {
      await post(`/duels/${id}/decline`).catch(fail);
      route();
    };
    const deck = await deckPicker($('#picker'), { size: state.config.duel.deckSize, cta: 'Accept the duel' });
    try {
      await post(`/duels/${id}/accept`, { deck });
      route();
    } catch (e) {
      fail(e);
    }
    return;
  }

  if (d.myTurn) return play(ctx, id, head);

  const rounds = d.myRounds.map((r, i) => ({ mine: r, theirs: d.theirRounds[i] }));
  view.innerHTML = `${head}
    ${d.result ? `<div class="display" style="font-size:64px;margin-bottom:24px">${d.result === 'won' ? 'Victory.' : d.result === 'lost' ? '<em>Defeat.</em>' : 'A draw.'}</div>`
      : d.status === 'pending' ? `<p class="lede">Waiting for ${esc(d.them)} to accept. <button class="btn link" id="cancel">Withdraw the challenge</button></p>`
      : d.status === 'active' ? `<p class="lede">You have played every round. Waiting for ${esc(d.them)}.</p>`
      : `<p class="lede">This duel was ${esc(d.status)}.</p>`}
    <div class="list">${rounds.map(({ mine, theirs }, i) => `
      <div class="list-row" style="grid-template-columns:44px 1fr 1fr auto">
        <span class="rank">${i + 1}</span>
        <span>${mine.card ? `<b>${esc(mine.card.title)}</b> <span class="mono small muted">ATK ${fmt(mine.card.atk)}</span>` : '—'}</span>
        <span>${theirs?.card ? `${esc(theirs.card.title)} <span class="mono small muted">DEF ${fmt(theirs.card.def)}</span>` : '<span class="muted">hidden</span>'}</span>
        <span class="mono">${mine.answered ? (mine.correct ? `+${fmt(mine.points)}` : 'miss') : '—'}${theirs?.points !== undefined ? ` <span class="muted">/ ${theirs.correct ? `+${fmt(theirs.points)}` : 'miss'}</span>` : ''}</span>
      </div>`).join('')}</div>
    <div class="row" style="margin-top:28px"><a class="btn solid" href="#/duels?tab=new&with=${encodeURIComponent(d.them)}">${icon('swords')} Rematch</a></div>`;
  $('#cancel')?.addEventListener('click', async () => {
    await post(`/duels/${id}/decline`).catch(fail);
    route();
  });
}

async function play(ctx, id, head) {
  const { view, onLeave } = ctx;
  let timer;
  onLeave(() => clearInterval(timer));
  const next = async () => {
    clearInterval(timer);
    const q = await api(`/duels/${id}/question`);
    if (q.done) return ctx.route();
    view.innerHTML = `${head}
      <div class="spread" style="margin-bottom:14px"><div class="eyebrow plain mono">Round ${q.slot + 1} / ${q.rounds}</div><span class="mono" id="left"></span></div>
      <div class="cols-main" style="grid-template-columns:minmax(0,1fr) 300px">
        <div>
          <div class="clue">${maskClue(q.clue)}${q.hint ? `<div class="small muted" style="font-family:var(--sans);margin-top:14px">Description: ${maskClue(q.hint)}</div>` : ''}</div>
          <div class="timebar"><div id="bar"></div></div>
          <div class="choices">${q.choices.map((c, i) => `<button class="choice" data-id="${c.id}"><i>${'ABCD'[i]}</i>${esc(c.title)}</button>`).join('')}</div>
          <div id="outcome" style="margin-top:18px"></div>
        </div>
        <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
          <div style="flex:1"><div class="small muted mono" style="margin-bottom:6px">Your card</div>${cardHtml({ ...q.myCard, id: '?', title: '?', description: 'Name it to strike', image: null }, { mini: true })}</div>
          <div style="flex:1"><div class="small muted mono" style="margin-bottom:6px">Facing</div>${cardHtml(q.theirCard, { mini: true })}</div>
        </div>
      </div>`;
    const total = state.config.duel.answerWindowMs;
    const tick = () => {
      const left = Math.max(0, q.expiresAt - Date.now());
      if ($('#left')) $('#left').textContent = `${Math.ceil(left / 1000)}s`;
      if ($('#bar')) $('#bar').style.transform = `scaleX(${left / total})`;
      if (left <= 0) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 200);
    $$('.choice').forEach((b) => (b.onclick = async () => {
      clearInterval(timer);
      $$('.choice').forEach((x) => (x.disabled = true));
      try {
        const r = await post(`/duels/${id}/answer`, { choice: Number(b.dataset.id) });
        $$('.choice').forEach((x) => {
          if (Number(x.dataset.id) === r.answerId) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        $('#outcome').innerHTML = `<div class="spread"><div class="display" style="font-size:34px">${r.correct ? `Hit — <em>+${fmt(r.points)}</em>` : r.late ? 'Too late.' : 'Missed.'}</div>
          <button class="btn solid" id="next-round">${r.duel.myTurn ? 'Next round' : 'See the result'} ${icon('arrow')}</button></div>`;
        $('#next-round').onclick = next;
        $('#next-round').focus();
      } catch (e) {
        fail(e);
      }
    }));
  };
  await next();
}

async function training(body) {
  let q;
  try {
    q = await api('/quiz/next');
  } catch (e) {
    body.innerHTML = emptyState('Not yet', esc(e.message), '<a class="btn solid" href="#/">Open packs</a>');
    return;
  }
  const me = state.me;
  body.innerHTML = `
    <div class="spread" style="margin-bottom:14px"><span class="small muted">Solo practice. Correct answers pay ${state.config.quiz.rewardCoins} coins (${q.rewardsLeft} left today), five in a row add a pack.</span>
      <span class="mono small">streak ${me.quiz.streak}</span></div>
    <div class="clue">${maskClue(q.clue)}${q.hint ? `<div class="small muted" style="font-family:var(--sans);margin-top:14px">Description: ${maskClue(q.hint)}</div>` : ''}</div>
    <div class="choices">${q.choices.map((c, i) => `<button class="choice" data-id="${c.id}"><i>${'ABCD'[i]}</i>${esc(c.title)}</button>`).join('')}</div>
    <div id="outcome" style="margin-top:22px"></div>`;
  bindCards($('#outcome'));
  $$('.choice', body).forEach((b) => (b.onclick = async () => {
    $$('.choice', body).forEach((x) => (x.disabled = true));
    try {
      const r = await post(`/quiz/${q.id}/answer`, { choice: Number(b.dataset.id) });
      $$('.choice', body).forEach((x) => {
        if (Number(x.dataset.id) === r.answer.id) x.classList.add('right');
        else if (x === b) x.classList.add('wrong');
      });
      const reward = [r.coins && `+${r.coins} coins`, r.packs && '+1 pack'].filter(Boolean).join(' · ');
      $('#outcome').innerHTML = `<div class="row" style="align-items:flex-start;gap:24px">
        <div style="width:150px">${cardHtml(r.answer)}</div>
        <div style="flex:1;min-width:220px"><div class="display" style="font-size:40px">${r.correct ? 'Correct.' : '<em>Not quite.</em>'}</div>
          <p>It was <b>${esc(r.answer.title)}</b>. ${reward}</p>
          <button class="btn solid" id="again">Next question ${icon('arrow')}</button></div></div>`;
      $('#again').onclick = () => training(body);
    } catch (e) {
      fail(e);
    }
  }));
}
