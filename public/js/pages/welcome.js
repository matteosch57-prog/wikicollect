import { api, post, esc, $, fail, emptyState } from '../core.js';

// Last step of "Continue with Google" for a new player: pick a username and
// accept the rules. The Google identity itself was verified server-side.
export async function pageWelcome({ view, params, refreshMe, route }) {
  const token = params.get('t') || '';
  let info;
  try {
    info = await api(`/auth/google/pending?t=${encodeURIComponent(token)}`);
  } catch (e) {
    view.innerHTML = emptyState('This link has expired', esc(e.message), '<a class="btn solid" href="/auth/google">Continue with Google again</a>');
    return;
  }
  view.innerHTML = `
    <section class="hero" style="align-items:start">
      <div>
        <div class="eyebrow">Signed in with Google${info.email ? ` · ${esc(info.email)}` : ''}</div>
        <h1 class="display" style="margin-top:18px">One last<br><em>formality.</em></h1>
        <p class="lede">Choose the name other collectors will see on trades, duels and the rankings. Your Google account is only used to sign you in.</p>
      </div>
      <form class="sheet auth stack" id="welcome" novalidate>
        <div class="field"><label for="u">Collector name</label>
          <input class="input" id="u" name="username" value="${esc(info.suggestion)}" maxlength="20" required autocomplete="username"></div>
        <p class="small muted" style="margin:0">3–20 characters: letters, digits, _ - .</p>
        <label class="check"><input type="checkbox" name="adult"> I am at least 18 and understand cards come from Wikipedia and may cover sensitive subjects.</label>
        <label class="check"><input type="checkbox" name="terms"> I will keep usernames and messages civil. Offensive names, cheating and harassment lead to a ban.</label>
        <button class="btn solid lg">Open my first ten packs</button>
      </form>
    </section>`;
  $('#u').focus();
  $('#welcome').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $('#welcome button');
    btn.disabled = true;
    try {
      await post('/register/google', { token, username: f.get('username'), adult: f.get('adult') === 'on', terms: f.get('terms') === 'on' });
      await refreshMe();
      location.hash = '#/';
      route();
    } catch (err) {
      fail(err);
      btn.disabled = false;
    }
  });
}
