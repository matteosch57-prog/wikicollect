// Quiz: read an article intro with its subject blanked out and pick the right
// card among four. Questions favour cards from your own album.

import { config } from './config.js';
import { tx } from './db.js';
import { GameError } from './errors.js';

const MASK = '▇▇▇';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Hide the title (and its significant words) from the extract.
export function redact(extract, title) {
  const base = title.replace(/\s*\(.*\)\s*$/, '');
  let text = extract.replace(new RegExp(escapeRegExp(base), 'gi'), MASK);
  const words = base.split(/[\s,'’-]+/).filter((w) => w.length >= 4);
  for (const w of words) {
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}\\w*`, 'giu'), MASK);
  }
  return text.replace(new RegExp(`(${escapeRegExp(MASK)}[\\s]*){2,}`, 'g'), `${MASK} `).trim();
}

function today(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function createQuiz({ db, game, now = Date.now, random = Math.random }) {
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  function next(userId) {
    const minExtract = 80;
    const subject =
      (random() < 0.75 && db.prepare(`
        SELECT a.* FROM user_cards uc JOIN articles a ON a.id = uc.article_id
        WHERE uc.user_id = ? AND length(a.extract) >= ? ORDER BY random() LIMIT 1`).get(userId, minExtract)) ||
      db.prepare('SELECT * FROM articles WHERE length(extract) >= ? ORDER BY random() LIMIT 1').get(minExtract);
    if (!subject) throw new GameError('Open a few packs first — the quiz is built from discovered cards', 409);

    const decoys = db.prepare(`
      SELECT id, title, description FROM articles WHERE id != ? AND title != ?
      ORDER BY abs(score - ?) + (random() % 25) LIMIT 3`).all(subject.id, subject.title, subject.score);
    if (decoys.length < 3) throw new GameError('Not enough cards discovered yet for a quiz — open more packs', 409);

    const choices = shuffle([subject, ...decoys]).map((a) => ({ id: a.id, title: a.title }));
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO quiz_questions (user_id, article_id, choices, created_at) VALUES (?, ?, ?, ?)`)
      .run(userId, subject.id, JSON.stringify(choices.map((c) => c.id)), now());

    return {
      id: Number(lastInsertRowid),
      clue: redact(subject.extract, subject.title),
      hint: subject.description ? redact(subject.description, subject.title) : '',
      choices,
      rewardsLeft: rewardsLeft(userId),
    };
  }

  function rewardsLeft(userId) {
    const u = db.prepare('SELECT quiz_day, quiz_rewarded FROM users WHERE id = ?').get(userId);
    return u.quiz_day === today(now()) ? Math.max(0, config.quiz.rewardedPerDay - u.quiz_rewarded) : config.quiz.rewardedPerDay;
  }

  function answer(userId, questionId, choiceId) {
    return tx(db, () => {
      const q = db.prepare('SELECT * FROM quiz_questions WHERE id = ? AND user_id = ?').get(questionId, userId);
      if (!q) throw new GameError('Question not found', 404);
      if (q.answered) throw new GameError('Question already answered', 409);
      const correct = Number(choiceId) === q.article_id;
      db.prepare('UPDATE quiz_questions SET answered = 1, correct = ? WHERE id = ?').run(correct ? 1 : 0, q.id);

      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      const day = today(now());
      let rewarded = u.quiz_day === day ? u.quiz_rewarded : 0;
      let coins = 0;
      let packs = 0;
      let streak = correct ? u.quiz_streak + 1 : 0;
      if (correct && rewarded < config.quiz.rewardedPerDay) {
        coins = config.quiz.rewardCoins;
        rewarded += 1;
      }
      // Streak packs share the daily reward cap so the quiz can't be farmed.
      if (coins > 0 && streak % config.quiz.streakForPack === 0) packs = 1;
      db.prepare(`UPDATE users SET quiz_day = ?, quiz_rewarded = ?, quiz_streak = ?, coins = coins + ?, packs = packs + ?,
        quiz_correct = quiz_correct + ?, quiz_answered = quiz_answered + 1 WHERE id = ?`)
        .run(day, rewarded, streak, coins, packs, correct ? 1 : 0, userId);

      return { correct, answer: game.card(q.article_id, userId), coins, packs, streak, profile: game.profile(userId) };
    });
  }

  return { next, answer };
}
