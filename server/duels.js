// Duels: a quiz built from your own cards. Each player brings a deck of 5
// cards; round N pits your card N against the opponent's card N. Answer the
// question about your own card within 30 seconds to strike: your ATK scores
// points and their DEF absorbs part of it. Highest total after 5 rounds wins.
// Rounds are played asynchronously, so nobody has to be online at once.

import { config } from './config.js';
import { tx, addCoins } from './db.js';
import { GameError } from './errors.js';
import { cardView } from './game.js';
import { notify, checkAchievements } from './notify.js';
import { buildQuestion } from './quiz.js';

const D = config.duel;

export function damage(atk, def) {
  return Math.max(Math.round(atk * 0.2), atk - Math.round(def * 0.5));
}

export function createDuels({ db, game, now = Date.now, random = Math.random }) {
  const nameOf = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username;

  function validateDeck(userId, deck) {
    const ids = [...new Set((Array.isArray(deck) ? deck : []).map(Number))];
    if (ids.length !== D.deckSize) throw new GameError(`Pick exactly ${D.deckSize} different cards`);
    for (const id of ids) {
      if (!db.prepare('SELECT 1 FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, id)) {
        throw new GameError("You don't own every card of this deck", 409);
      }
    }
    return ids;
  }

  function insertDeck(duelId, userId, ids) {
    ids.forEach((articleId, slot) =>
      db.prepare('INSERT INTO duel_rounds (duel_id, user_id, slot, article_id) VALUES (?, ?, ?, ?)').run(duelId, userId, slot, articleId));
  }

  function challenge(userId, { opponent, deck }) {
    const opp = db.prepare('SELECT id FROM users WHERE username = ? AND banned_at IS NULL').get(String(opponent || ''));
    if (!opp) throw new GameError('Player not found', 404);
    if (opp.id === userId) throw new GameError("You can't duel yourself");
    const ids = validateDeck(userId, deck);
    return tx(db, () => {
      const open = db.prepare("SELECT COUNT(*) AS n FROM duels WHERE challenger_id = ? AND status IN ('pending', 'active')").get(userId).n;
      if (open >= 10) throw new GameError('You already have 10 duels in progress');
      const { lastInsertRowid } = db.prepare('INSERT INTO duels (challenger_id, opponent_id, created_at) VALUES (?, ?, ?)')
        .run(userId, opp.id, now());
      const id = Number(lastInsertRowid);
      insertDeck(id, userId, ids);
      notify(db, opp.id, 'battle_invite', { duelId: id, from: nameOf(userId) }, now());
      return get(userId, id);
    });
  }

  function load(userId, id) {
    const d = db.prepare('SELECT * FROM duels WHERE id = ?').get(id);
    if (!d || (d.challenger_id !== userId && d.opponent_id !== userId)) throw new GameError('Duel not found', 404);
    return d;
  }

  function accept(userId, id, { deck }) {
    const ids = validateDeck(userId, deck);
    return tx(db, () => {
      expire();
      const d = load(userId, id);
      if (d.opponent_id !== userId) throw new GameError('Only the challenged player can accept', 403);
      if (d.status !== 'pending') throw new GameError(`This duel is ${d.status}`, 409);
      insertDeck(id, userId, ids);
      db.prepare("UPDATE duels SET status = 'active' WHERE id = ?").run(id);
      notify(db, d.challenger_id, 'battle_accepted', { duelId: id, by: nameOf(userId) }, now());
      return get(userId, id);
    });
  }

  function decline(userId, id) {
    return tx(db, () => {
      const d = load(userId, id);
      if (d.status !== 'pending') throw new GameError(`This duel is ${d.status}`, 409);
      const status = d.challenger_id === userId ? 'cancelled' : 'declined';
      db.prepare('UPDATE duels SET status = ?, finished_at = ? WHERE id = ?').run(status, now(), id);
      return get(userId, id);
    });
  }

  const roundsOf = (duelId, userId) =>
    db.prepare('SELECT * FROM duel_rounds WHERE duel_id = ? AND user_id = ? ORDER BY slot').all(duelId, userId);

  // Rounds whose 30s window passed without an answer count as misses.
  function closeExpiredRound(r) {
    if (r.served_at && !r.answered && now() - r.served_at > D.answerWindowMs) {
      db.prepare('UPDATE duel_rounds SET answered = 1, correct = 0, points = 0 WHERE duel_id = ? AND user_id = ? AND slot = ?')
        .run(r.duel_id, r.user_id, r.slot);
      r.answered = 1;
    }
  }

  function question(userId, id) {
    return tx(db, () => {
      const d = load(userId, id);
      if (d.status !== 'active') throw new GameError('This duel is not in progress', 409);
      const mine = roundsOf(id, userId);
      mine.forEach(closeExpiredRound);
      const r = mine.find((x) => !x.answered);
      if (!r) {
        maybeFinish(id);
        return { done: true, duel: get(userId, id) };
      }
      let q;
      if (r.served_at) {
        q = JSON.parse(r.choices);
      } else {
        const subject = db.prepare('SELECT * FROM articles WHERE id = ?').get(r.article_id);
        q = buildQuestion(db, subject, random);
        db.prepare('UPDATE duel_rounds SET choices = ?, served_at = ? WHERE duel_id = ? AND user_id = ? AND slot = ?')
          .run(JSON.stringify(q), now(), id, userId, r.slot);
        r.served_at = now();
      }
      const oppId = d.challenger_id === userId ? d.opponent_id : d.challenger_id;
      const oppRound = db.prepare('SELECT article_id FROM duel_rounds WHERE duel_id = ? AND user_id = ? AND slot = ?').get(id, oppId, r.slot);
      const card = (aid) => cardView(db.prepare('SELECT * FROM articles WHERE id = ?').get(aid));
      return {
        done: false,
        slot: r.slot,
        rounds: D.deckSize,
        clue: q.clue,
        hint: q.hint,
        choices: q.choices,
        expiresAt: r.served_at + D.answerWindowMs,
        myCard: card(r.article_id),
        theirCard: card(oppRound.article_id),
      };
    });
  }

  function answer(userId, id, choice) {
    return tx(db, () => {
      const d = load(userId, id);
      if (d.status !== 'active') throw new GameError('This duel is not in progress', 409);
      const r = roundsOf(id, userId).find((x) => !x.answered);
      if (!r || !r.served_at) throw new GameError('No question waiting for an answer', 409);
      const late = now() - r.served_at > D.answerWindowMs;
      const correct = !late && Number(choice) === r.article_id;
      const oppId = d.challenger_id === userId ? d.opponent_id : d.challenger_id;
      const mine = db.prepare('SELECT atk FROM articles WHERE id = ?').get(r.article_id);
      const theirs = db.prepare(`SELECT a.def FROM duel_rounds r JOIN articles a ON a.id = r.article_id
        WHERE r.duel_id = ? AND r.user_id = ? AND r.slot = ?`).get(id, oppId, r.slot);
      const points = correct ? damage(mine.atk, theirs.def) : 0;
      db.prepare('UPDATE duel_rounds SET answered = 1, correct = ?, points = ? WHERE duel_id = ? AND user_id = ? AND slot = ?')
        .run(correct ? 1 : 0, points, id, userId, r.slot);
      maybeFinish(id);
      return { correct, late, points, answerId: r.article_id, duel: get(userId, id) };
    });
  }

  function finish(d) {
    const total = (uid) => db.prepare('SELECT COALESCE(SUM(points), 0) AS s FROM duel_rounds WHERE duel_id = ? AND user_id = ?').get(d.id, uid).s;
    const a = total(d.challenger_id);
    const b = total(d.opponent_id);
    const winner = a === b ? null : a > b ? d.challenger_id : d.opponent_id;
    const t = now();
    db.prepare("UPDATE duels SET status = 'finished', winner_id = ?, finished_at = ? WHERE id = ?").run(winner, t, d.id);
    for (const uid of [d.challenger_id, d.opponent_id]) {
      const won = uid === winner;
      const draw = winner === null;
      addCoins(db, uid, won ? D.winCoins : D.loseCoins, `duel:${d.id}`, t);
      if (!draw) db.prepare(`UPDATE users SET ${won ? 'duel_wins = duel_wins + 1' : 'duel_losses = duel_losses + 1'} WHERE id = ?`).run(uid);
      notify(db, uid, 'battle_finished', { duelId: d.id, result: draw ? 'draw' : won ? 'won' : 'lost' }, t);
      checkAchievements(db, uid, t);
    }
  }

  function maybeFinish(id) {
    const d = db.prepare('SELECT * FROM duels WHERE id = ?').get(id);
    if (d.status !== 'active') return;
    const left = db.prepare('SELECT COUNT(*) AS n FROM duel_rounds WHERE duel_id = ? AND answered = 0').get(id).n;
    if (!left) finish(d);
  }

  // Pending invites expire; active duels past the deadline are scored as-is.
  function expire() {
    const cutoff = now() - D.expiryMs;
    db.prepare("UPDATE duels SET status = 'cancelled', finished_at = ? WHERE status = 'pending' AND created_at < ?").run(now(), cutoff);
    for (const d of db.prepare("SELECT * FROM duels WHERE status = 'active' AND created_at < ?").all(cutoff)) {
      db.prepare('UPDATE duel_rounds SET answered = 1 WHERE duel_id = ? AND answered = 0').run(d.id);
      finish(d);
    }
  }

  function get(userId, id) {
    const d = load(userId, id);
    const oppId = d.challenger_id === userId ? d.opponent_id : d.challenger_id;
    const finished = d.status === 'finished';
    const side = (uid, reveal) => roundsOf(id, uid).map((r) => ({
      slot: r.slot,
      card: reveal || r.answered ? cardView(db.prepare('SELECT * FROM articles WHERE id = ?').get(r.article_id)) : null,
      answered: !!r.answered,
      correct: reveal ? !!r.correct : undefined,
      points: reveal ? r.points : undefined,
    }));
    const me = side(userId, true);
    // The opponent's results stay hidden until the duel ends.
    const them = side(oppId, finished);
    const sum = (rs) => rs.reduce((s, r) => s + (r.points || 0), 0);
    return {
      id: d.id,
      status: d.status,
      challenger: nameOf(d.challenger_id),
      opponent: nameOf(d.opponent_id),
      you: nameOf(userId),
      them: nameOf(oppId),
      createdAt: d.created_at,
      finishedAt: d.finished_at,
      result: finished ? (d.winner_id === null ? 'draw' : d.winner_id === userId ? 'won' : 'lost') : null,
      myRounds: me,
      theirRounds: them.map((r) => (finished ? r : { slot: r.slot, answered: r.answered, card: r.card })),
      myScore: sum(me),
      theirScore: finished ? sum(them) : null,
      myTurn: d.status === 'active' && me.some((r) => !r.answered),
      needsMyDeck: d.status === 'pending' && d.opponent_id === userId,
    };
  }

  function list(userId) {
    tx(db, expire);
    const rows = db.prepare(`SELECT id FROM duels WHERE (challenger_id = ? OR opponent_id = ?)
      AND (status IN ('pending', 'active') OR finished_at > ?) ORDER BY id DESC LIMIT 50`)
      .all(userId, userId, now() - 14 * 86400_000);
    return rows.map((r) => get(userId, r.id));
  }

  return { challenge, accept, decline, question, answer, get, list, expire };
}
