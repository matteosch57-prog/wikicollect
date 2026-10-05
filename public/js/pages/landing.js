import { post, state, $, $$, cardHtml, fail, toast, GOOGLE_G } from '../core.js';

const SAMPLE = [
  { id: 736, title: 'Albert Einstein', description: 'German-born theoretical physicist (1879–1955)', rarity: 'L', atk: 9430, def: 9150 },
  { id: 24726, title: 'Axolotl', description: 'Species of neotenic salamander', rarity: 'SR', atk: 6120, def: 7280 },
  { id: 4029, title: 'Emu War', description: '1932 Australian wildlife management operation', rarity: 'R', atk: 4180, def: 6060 },
  { id: 19331, title: 'Mpemba effect', description: 'Hot water freezing faster than cold', rarity: 'PC', atk: 2540, def: 5880 },
  { id: 48781, title: 'Voynich manuscript', description: 'Codex written in an unknown script', rarity: 'UR', atk: 8210, def: 8460 },
  { id: 9228, title: 'Earth', description: 'Third planet from the Sun', rarity: 'L', atk: 9610, def: 9770 },
  { id: 6693, title: 'Codex Gigas', description: 'Largest extant medieval manuscript', rarity: 'R', atk: 4320, def: 6610 },
  { id: 27680, title: 'Tardigrade', description: 'Eight-legged micro-animals', rarity: 'SR', atk: 6470, def: 7920 },
  { id: 11103, title: 'Little Snoring', description: 'Village in Norfolk, England', rarity: 'C', atk: 1210, def: 3330 },
  { id: 32927, title: 'Kowloon Walled City', description: 'Former enclave in Hong Kong', rarity: 'UR', atk: 7780, def: 8030 },
];

export async function pageLanding({ view, params, refreshMe, route }) {
  const startLogin = params.get('login') === '1';
  const strip = [...SAMPLE, ...SAMPLE].map((c) => cardHtml(c)).join('');
  view.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">A collectible card game · 6.9 million entries</div>
        <h1 class="display" style="margin-top:18px">The encyclopedia,<br><em>collected.</em></h1>
        <p class="lede">Every Wikipedia article is a card. How much it is read sets its rarity, its length sets its attack, its quality sets its defence. Open packs, fill your album, duel your friends, trade what you have twice.</p>
      </div>
      <div class="sheet auth" id="auth"></div>
    </section>

    <div class="ticker" aria-hidden="true"><div class="track">${strip}</div></div>

    <section class="pillars">
      <div><div class="eyebrow plain mono">§ 1</div><h3>Open packs</h3><p>A free pack of five every ten minutes, ten in reserve. Drop rates are published and exact: the rarity is rolled first, then a real article is drawn.</p></div>
      <div><div class="eyebrow plain mono">§ 2</div><h3>Complete the album</h3><p>Tag your cards, pin a showcase, lock the ones you never want to lose. Themed sets — the planets, the Olympians, the noble gases — can actually be finished.</p></div>
      <div><div class="eyebrow plain mono">§ 3</div><h3>Duel on what you know</h3><p>A quiz built from your own deck. Answer in thirty seconds and your attack lands; their defence absorbs the blow.</p></div>
      <div><div class="eyebrow plain mono">§ 4</div><h3>Trade, counter, agree</h3><p>Offer duplicates for the cards you are missing, and negotiate with counter-offers. Locked cards stay out of reach.</p></div>
      <div><div class="eyebrow plain mono">§ 5</div><h3>An honest market</h3><p>Escrowed auctions that never jump, anti-sniping, a burned sales tax against inflation, and no instant flipping.</p></div>
      <div><div class="eyebrow plain mono">§ 6</div><h3>Guilds & friends</h3><p>Chat, invite, climb the guild table together. Your collection is always yours: export it any time.</p></div>
    </section>`;

  const renderAuth = (mode) => {
    const signup = mode === 'signup';
    $('#auth').innerHTML = `
      <div class="tabs" style="margin-bottom:22px">
        <button class="${signup ? 'active' : ''}" data-mode="signup">Create an account</button>
        <button class="${signup ? '' : 'active'}" data-mode="login">Sign in</button>
      </div>
      ${state.config.googleAuth ? `
        <a class="btn google lg" href="/auth/google">${GOOGLE_G} ${signup ? 'Sign up' : 'Sign in'} with Google</a>
        <div class="or"><span>or with email</span></div>` : ''}
      <form id="auth-form" novalidate>
        <div class="field"><label for="u">${signup ? 'Username' : 'Username or email'}</label>
          <input class="input" id="u" name="username" autocomplete="username" required maxlength="${signup ? 20 : 120}"></div>
        ${signup ? `<div class="field"><label for="e">Email</label><input class="input" id="e" name="email" type="email" autocomplete="email" required></div>` : ''}
        <div class="field"><label for="p">Password</label>
          <input class="input" id="p" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8"></div>
        ${signup ? `
          <label class="check"><input type="checkbox" name="adult"> I am at least 18 and understand cards come from Wikipedia and may cover sensitive subjects.</label>
          <label class="check"><input type="checkbox" name="terms"> I will keep usernames and messages civil. Offensive names, cheating and harassment lead to a ban.</label>` : ''}
        <button class="btn solid lg" type="submit">${signup ? 'Open my first ten packs' : 'Sign in'}</button>
        <p class="small muted" style="margin:0">${signup ? 'Free. No ads, no pay-to-win.' : ''}</p>
      </form>`;
    $$('#auth [data-mode]').forEach((b) => (b.onclick = () => renderAuth(b.dataset.mode)));
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = $('#auth-form button[type=submit]');
      btn.disabled = true;
      try {
        if (signup) {
          await post('/register', {
            username: f.get('username'), email: f.get('email'), password: f.get('password'),
            adult: f.get('adult') === 'on', terms: f.get('terms') === 'on',
          });
        } else {
          await post('/login', { username: f.get('username'), password: f.get('password') });
        }
        await refreshMe();
        location.hash = '#/';
        route();
      } catch (err) {
        fail(err);
        btn.disabled = false;
      }
    });
  };
  renderAuth(startLogin ? 'login' : 'signup');
  if (params.get('auth_error')) {
    toast(params.get('auth_error'), 'error');
    history.replaceState(null, '', '#/');
  }
}
