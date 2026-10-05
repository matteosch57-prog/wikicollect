import { state, api, post, setMe, onProfile, esc, fmt, icon, $, drawer, toast, timeAgo, fail } from './core.js';
import { pageLanding } from './pages/landing.js';
import { pagePulls } from './pages/pulls.js';
import { pageAlbum } from './pages/album.js';
import { pageSets } from './pages/sets.js';
import { pageDuels, pageDuel } from './pages/duels.js';
import { pageExchange } from './pages/exchange.js';
import { pageMarket, pageLot } from './pages/market.js';
import { pageGuild } from './pages/guild.js';
import { pageFriends, pageChat } from './pages/friends.js';
import { pageRanking } from './pages/ranking.js';
import { pageProfile, pageAchievements } from './pages/profile.js';
import { pageAdmin } from './pages/admin.js';

const view = $('#view');

const NAV = [
  { href: '#/', label: 'Pulls', icon: 'pack', match: (p) => p === '' || p === '/' },
  { href: '#/album', label: 'Album', icon: 'album' },
  { href: '#/sets', label: 'Sets', icon: 'sets' },
  { href: '#/duels', label: 'Duels', icon: 'swords', badge: (m) => m.pending.duels },
  { href: '#/exchange', label: 'Exchange', icon: 'swap', badge: (m) => m.pending.trades },
  { href: '#/market', label: 'Market', icon: 'gavel' },
  { href: '#/guild', label: 'Guild', icon: 'shield' },
  { href: '#/friends', label: 'Friends', icon: 'chat', badge: (m) => m.pending.friends + m.pending.messages },
  { href: '#/ranking', label: 'Ranking', icon: 'trophy' },
];
const TABBAR = ['#/', '#/album', '#/duels', '#/market', '#/friends'];

const path = () => (location.hash.slice(1) || '/').split('?')[0];
const isActive = (n) => (n.match ? n.match(path()) : path().startsWith(n.href.slice(1)));

// ---------- theme ----------

function applyTheme(t) {
  const theme = t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}
let savedTheme = null;
try {
  savedTheme = localStorage.getItem('wc-theme');
} catch {}
applyTheme(savedTheme);

// ---------- chrome ----------

function renderChrome() {
  const me = state.me;
  $('#nav').innerHTML = me
    ? NAV.map((n, i) => `<a href="${n.href}" class="${isActive(n) ? 'active' : ''}"><i>${String(i + 1).padStart(2, '0')}</i>${n.label}${n.badge?.(me) ? '<span class="dot"></span>' : ''}</a>`).join('')
    : `<a href="#/ranking" class="${path().startsWith('/ranking') ? 'active' : ''}">Ranking</a>`;

  $('#meters').innerHTML = me
    ? `<a class="meter" href="#/" title="Free packs">${icon('pack')} ${me.packs}<small>/${me.maxStock}</small>
         ${me.nextPackAt ? `<small class="countdown" data-until="${me.nextPackAt}" data-done="now"></small>` : ''}</a>
       <a class="meter optional" href="#/?shop=1" title="Coins">${icon('coin')} ${fmt(me.coins)}</a>
       <button class="meter" id="bell" title="Notifications">${icon('bell')}${me.unread ? `<span class="badge">${me.unread}</span>` : ''}</button>
       <button class="avatar" id="avatar" title="${esc(me.username)}" aria-label="Account menu">${esc(me.username[0].toUpperCase())}</button>`
    : `<a class="btn sm quiet" href="#/?login=1">Sign in</a><a class="btn sm solid" href="#/">Start collecting</a>`;

  $('#tabbar').innerHTML = me
    ? TABBAR.map((h) => NAV.find((n) => n.href === h)).map((n) =>
      `<a href="${n.href}" class="${isActive(n) ? 'active' : ''}">${icon(n.icon)}${n.label}${n.badge?.(me) ? '<span class="dot"></span>' : ''}</a>`).join('')
    : '';
  $('#tabbar').classList.toggle('hidden', !me);

  $('#bell')?.addEventListener('click', openNotifications);
  $('#avatar')?.addEventListener('click', openMenu);
}

function openMenu(e) {
  e.stopPropagation();
  $('.menu')?.remove();
  const me = state.me;
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `
    <div style="padding: 8px 10px 10px"><div style="font: italic 400 22px/1 var(--serif)">${esc(me.username)}</div>
      <div class="small muted mono" style="margin-top:4px">${fmt(me.coins)} coins · ${fmt(me.score)} pts${me.guild ? ` · [${esc(me.guild.tag)}]` : ''}</div></div>
    <hr>
    <a href="#/u/${encodeURIComponent(me.username)}">${icon('user')} Profile & showcase</a>
    <a href="#/achievements">${icon('trophy')} Achievements</a>
    <a href="#/friends">${icon('chat')} Friends & messages</a>
    <a href="#/guild">${icon('shield')} Guild</a>
    <a href="#/?shop=1">${icon('coin')} Shop</a>
    <a href="/api/export" download>${icon('download')} Export collection (JSON)</a>
    <a href="/api/export?format=csv" download>${icon('download')} Export collection (CSV)</a>
    ${me.isAdmin ? `<a href="#/admin">${icon('admin')} Moderation</a>` : ''}
    <hr>
    <button data-toggle-theme>${icon('moon')} ${document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'} reading room</button>
    <button data-logout>${icon('logout')} Sign out</button>`;
  document.body.append(menu);
  const close = () => {
    menu.remove();
    document.removeEventListener('click', close);
  };
  setTimeout(() => document.addEventListener('click', close));
  menu.addEventListener('click', (ev) => {
    if (ev.target.closest('a')) close();
  });
  $('[data-toggle-theme]', menu).onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('wc-theme', next);
    } catch {}
    close();
  };
  $('[data-logout]', menu).onclick = async () => {
    await post('/logout').catch(() => {});
    setMe(null);
    close();
    location.hash = '#/';
  };
}

const NOTIF = {
  trade_offer: (d) => [`<b>${esc(d.from)}</b> sent you a trade offer`, '#/exchange'],
  trade_countered: (d) => [`<b>${esc(d.by)}</b> countered your offer`, '#/exchange'],
  trade_accepted: (d) => [`<b>${esc(d.by)}</b> accepted your trade`, '#/exchange?tab=history'],
  trade_declined: (d) => [`<b>${esc(d.by)}</b> declined your trade`, '#/exchange?tab=history'],
  battle_invite: (d) => [`<b>${esc(d.from)}</b> challenged you to a duel`, `#/duels/${d.duelId}`],
  battle_accepted: (d) => [`<b>${esc(d.by)}</b> accepted your duel`, `#/duels/${d.duelId}`],
  battle_finished: (d) => [`Duel finished — you <b>${esc(d.result)}</b>`, `#/duels/${d.duelId}`],
  friend_request: (d) => [`<b>${esc(d.from)}</b> wants to be friends`, '#/friends'],
  friend_accepted: (d) => [`<b>${esc(d.by)}</b> accepted your friend request`, '#/friends'],
  chat_message: (d) => [`New message from <b>${esc(d.from)}</b>`, `#/friends/${encodeURIComponent(d.from)}`],
  guild_invite: (d) => [`<b>${esc(d.from)}</b> invited you to <b>${esc(d.guild)}</b>`, `#/guild?join=${d.guildId}`],
  marketplace_outbid: (d) => [`Outbid on <b>${esc(d.title)}</b> (${fmt(d.amount)})`, `#/market/${d.auctionId}`],
  marketplace_auction_won: (d) => [`You won <b>${esc(d.title)}</b> for ${fmt(d.price)}`, `#/market/${d.auctionId}`],
  marketplace_auction_sold: (d) => [`<b>${esc(d.title)}</b> sold for ${fmt(d.price)} (you receive ${fmt(d.net)})`, `#/market/${d.auctionId}`],
  marketplace_auction_unsold: (d) => [`<b>${esc(d.title)}</b> did not sell and is back in your album`, `#/market/${d.auctionId}`],
  marketplace_wishlist_listed: (d) => [`<b>${esc(d.title)}</b> from your wishlist is up for auction`, `#/market/${d.auctionId}`],
  achievement: (d) => [`Achievement unlocked: <b>${esc(d.name)}</b> (+${fmt(d.reward)})`, '#/achievements'],
  custom: (d) => [esc(d.message), '#/'],
};

async function openNotifications() {
  let list;
  try {
    list = await api('/notifications');
  } catch (e) {
    return fail(e);
  }
  const d = drawer(`
    <div class="eyebrow">Notifications</div>
    <h2 class="display" style="font-size:44px;margin:12px 0 20px">Correspondence</h2>
    ${list.length ? list.map((n) => {
      const [text, href] = (NOTIF[n.type] || (() => [esc(n.type), '#/']))(n.data);
      return `<a class="notif ${n.read ? 'read' : ''}" href="${href}"><span class="pip"></span><span>${text}</span><span class="small muted mono">${timeAgo(n.createdAt)}</span></a>`;
    }).join('') : '<p class="muted">Nothing yet. Open a pack, challenge a friend, list a card.</p>'}`);
  d.el.addEventListener('click', (e) => e.target.closest('a') && d.close());
  if (list.some((n) => !n.read)) {
    await post('/notifications/read', { ids: 'all' }).catch(() => {});
    refreshMe();
  }
}

export async function refreshMe() {
  try {
    setMe(await api('/me'));
  } catch {
    setMe(null);
  }
}

// ---------- router ----------

const ROUTES = [
  [/^\/album$/, pageAlbum],
  [/^\/sets$/, pageSets],
  [/^\/duels\/(\d+)$/, pageDuel],
  [/^\/duels$/, pageDuels],
  [/^\/exchange$/, pageExchange],
  [/^\/market\/(\d+)$/, pageLot],
  [/^\/market$/, pageMarket],
  [/^\/guild$/, pageGuild],
  [/^\/friends\/(.+)$/, pageChat],
  [/^\/friends$/, pageFriends],
  [/^\/achievements$/, pageAchievements],
  [/^\/admin$/, pageAdmin],
];
const PUBLIC = [
  [/^\/ranking$/, pageRanking],
  [/^\/u\/(.+)$/, pageProfile],
];

let cleanup = null;
let routeSeq = 0;

export async function route() {
  const seq = ++routeSeq;
  cleanup?.();
  cleanup = null;
  $('.menu')?.remove();
  const p = path();
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  renderChrome();
  window.scrollTo({ top: 0 });
  const ctx = {
    view, params, refreshMe, route,
    onLeave: (fn) => { cleanup = fn; },
    stale: () => seq !== routeSeq,
  };
  try {
    for (const [re, page] of PUBLIC) {
      const m = p.match(re);
      if (m) return await page(ctx, ...m.slice(1).map(decodeURIComponent));
    }
    if (!state.me) return await pageLanding(ctx);
    for (const [re, page] of ROUTES) {
      const m = p.match(re);
      if (m) return await page(ctx, ...m.slice(1).map(decodeURIComponent));
    }
    return await pagePulls(ctx);
  } catch (e) {
    if (seq === routeSeq) view.innerHTML = `<div class="empty"><div class="display">Something went sideways</div><p class="muted">${esc(e.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', route);
onProfile(() => renderChrome());

// Keep counters fresh without hammering the server.
setInterval(() => {
  if (state.me && document.visibilityState === 'visible') refreshMe();
}, 30_000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && state.me && refreshMe());

(async function init() {
  try {
    state.config = await api('/config');
  } catch {
    view.innerHTML = '<div class="empty"><div class="display">The archive is closed</div><p class="muted">The server could not be reached. Try again in a moment.</p></div>';
    return;
  }
  $('#offline').classList.toggle('hidden', !state.config.offline);
  await refreshMe();
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();

export { toast };
