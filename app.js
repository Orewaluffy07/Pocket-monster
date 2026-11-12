'use strict';

/* ================= state ================= */
let WS = null, META = null, STATE = null;
let ROOMS = [], ROOM = null, TRADE = null;
let token = localStorage.getItem('pa_token') || null;
let authMode = 'login';
let currentView = 'battle';
let colFilter = { kind: 'all', val: null };
let expectRoom = false;
let myRoomId = null;
let lastSearch = [];
let reconnectTried = 0;

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPE_COLORS = {
  fire: '#ff7043', water: '#42a5f5', leaf: '#66bb6a', electric: '#ffca28',
  dark: '#b39ddb', ghost: '#7e57c2', fighting: '#ef5350', flying: '#4fc3f7', steel: '#90a4ae'
};
const TIER_LABEL = { C: 'Common', U: 'Uncommon', E: 'Epic', M: 'Mythic', L: 'Legendary' };

function send(obj) {
  if (WS && WS.readyState === 1) WS.send(JSON.stringify(obj));
}

/* ================= toasts ================= */
function toast(msg, kind) {
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || 'info');
  d.textContent = msg;
  $('toasts').appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = '.4s'; setTimeout(() => d.remove(), 400); }, 4500);
}

/* ================= websocket ================= */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  WS = new WebSocket(proto + '://' + location.host);
  WS.onopen = () => {
    reconnectTried = 0;
    $('conn-banner').hidden = true;
    if (token) send({ t: 'auth', token });
    else showAuth();
  };
  WS.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    handle(m);
  };
  WS.onclose = () => {
    $('conn-banner').hidden = false;
    const delay = Math.min(8000, 1500 + reconnectTried * 700);
    reconnectTried++;
    setTimeout(connect, delay);
  };
  WS.onerror = () => {};
}

function showAuth() {
  $('screen-auth').hidden = false;
  $('screen-main').hidden = true;
}
function showMain() {
  $('screen-auth').hidden = true;
  $('screen-main').hidden = false;
}

/* ================= message router ================= */
function handle(m) {
  switch (m.t) {
    case 'authRes':
      if (m.ok) {
        if (m.token) { token = m.token; localStorage.setItem('pa_token', token); }
        showMain();
        send({ t: 'roomList' });
        switchView(currentView === 'room' || currentView === 'trade' ? 'battle' : currentView);
      } else {
        token = null; localStorage.removeItem('pa_token');
        showAuth();
        if (m.msg) $('auth-err').textContent = m.msg;
      }
      break;
    case 'meta': META = m; break;
    case 'state':
      STATE = m;
      renderCoins();
      if (currentView === 'collection') renderCollection();
      if (currentView === 'shop') renderShop();
      if (currentView === 'friends') renderFriends();
      if (currentView === 'battle') renderModePick();
      if (STATE && !STATE.user.starterTaken && !STATE._greeted) {
        STATE._greeted = true;
        toast('🎁 Welcome! Your free starter pack is waiting in the Shop', 'friend');
      }
      break;
    case 'rooms': ROOMS = m.list || []; if (currentView === 'battle') renderRooms(); break;
    case 'room':
      ROOM = m.room;
      myRoomId = ROOM.id;
      if (expectRoom || currentView === 'room') { expectRoom = false; switchView('room'); }
      else if (currentView === 'room') renderRoom();
      if (currentView === 'battle') renderRooms();
      break;
    case 'roomClosed':
      if (ROOM && m.reason) { /* keep last room for display */ }
      if (myRoomId) myRoomId = null;
      ROOM = null;
      if (currentView === 'room') { switchView('battle'); toast(m.reason || 'Room closed', 'err'); }
      break;
    case 'pack': showPack(m.cards); break;
    case 'searchRes': lastSearch = m.users || []; renderSearch(); break;
    case 'trade':
      TRADE = m.trade;
      if (TRADE) {
        if (currentView === 'room') { /* don't yank players out of a match */ }
        else switchView('trade');
      } else if (currentView === 'trade') switchView('friends');
      break;
    case 'presence':
      if (STATE) {
        const f = STATE.friends.find(x => x.name === m.u);
        if (f) f.online = m.online;
        if (currentView === 'friends') renderFriends();
      }
      break;
    case 'toast': toast(m.msg, m.kind); break;
    case 'err': toast(m.msg, 'err'); break;
  }
}

/* ================= auth ================= */
$('tab-login').onclick = () => setAuthMode('login');
$('tab-register').onclick = () => setAuthMode('register');
function setAuthMode(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-register').classList.toggle('active', mode === 'register');
  $('auth-go').textContent = mode === 'login' ? 'Enter the Arena' : 'Create Account';
  $('auth-err').textContent = '';
}
$('auth-form').onsubmit = e => {
  e.preventDefault();
  $('auth-err').textContent = '';
  send({ t: authMode, u: $('auth-user').value, p: $('auth-pass').value });
};

/* ================= navigation ================= */
document.querySelectorAll('#nav button').forEach(b => {
  b.onclick = () => switchView(b.dataset.view);
});
const TAB_OF = { battle: 'battle', collection: 'collection', shop: 'shop', friends: 'friends', trade: 'friends', room: 'battle' };
function switchView(v) {
  currentView = v;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === TAB_OF[v]));
  document.querySelectorAll('.view').forEach(x => { x.hidden = true; });
  const el = $('view-' + v);
  if (el) el.hidden = false;
  if (v === 'battle') { renderModePick(); renderRooms(); }
  if (v === 'collection') renderCollection();
  if (v === 'shop') renderShop();
  if (v === 'friends') renderFriends();
  if (v === 'trade') renderTrade();
  if (v === 'room') renderRoom();
}
function renderCoins() {
  if (!STATE) return;
  $('coin-n').textContent = STATE.user.coins;
  $('topbar-user').textContent = STATE.user.name;
}

/* ================= helpers ================= */
function creatureOf(crId) { return META && META.CREATURES[crId]; }
function myCards() { return STATE ? STATE.cards : []; }
function groupedCards() {
  const map = new Map();
  for (const c of myCards()) {
    if (!map.has(c.cr)) map.set(c.cr, []);
    map.get(c.cr).push(c.iid);
  }
  return map;
}
function effOf(mt, defs) {
  let m = 1;
  for (const t of defs) m *= (META.CHART[mt][t] || 1);
  return Math.max(0.6, Math.min(1.5625, m));
}
function typePills(types) {
  return types.map(t => `<span class="type-pill" style="--tc:${TYPE_COLORS[t]}">${META.TYPE_INFO[t].icon} ${META.TYPE_INFO[t].name}</span>`).join('');
}
function mvIcon(mv) {
  if (mv.fx && mv.fx.dodge) return '💨';
  if (mv.fx && mv.fx.guard) return '🛡️';
  if (mv.fx && mv.fx.atk) return '⬆️';
  if (mv.fx && mv.fx.heal) return '💚';
  if (mv.fx && mv.fx.leech) return '🩸';
  if (mv.kind === 'special') return '💥';
  if (mv.kind === 'basic') return '👊';
  return '⚔️';
}
function mvDesc(mv) {
  const s = [];
  if (mv.power > 0) s.push(mv.power + ' dmg');
  s.push(mv.cd === 0 ? 'no cooldown' : 'CD ' + mv.cd + ' turn' + (mv.cd > 1 ? 's' : ''));
  const fx = mv.fx || {};
  if (fx.leech) s.push('heals ' + Math.round(fx.leech * 100) + '% of damage dealt');
  if (fx.dodge) s.push(Math.round(fx.dodge * 100) + '% chance to dodge the next hit');
  if (fx.guard) s.push('take ' + Math.round(fx.guard * 100) + '% less damage from next hit');
  if (fx.atk) s.push('+' + Math.round((fx.atk - 1) * 100) + '% damage on next ' + fx.attacks + ' attacks');
  if (fx.heal) s.push('restores ' + fx.heal + ' HP');
  return s.join(' · ');
}
function hpClass(r) { return r <= 0.25 ? 'low' : (r <= 0.5 ? 'mid' : ''); }

/* ================= collection ================= */
function renderFilters() {
  const f = $('col-filters');
  const tiers = ['all', 'L', 'M', 'E', 'U', 'C'];
  let html = tiers.map(t => `<button data-k="${t === 'all' ? 'all' : 'tier'}" data-v="${t}" class="${colFilter.kind === (t === 'all' ? 'all' : 'tier') && (t === 'all' || colFilter.val === t) ? 'active' : ''}">${t === 'all' ? 'All' : t + ' ' + TIER_LABEL[t]}</button>`).join('');
  html += Object.keys(META.TYPE_INFO).map(t => `<button data-k="type" data-v="${t}" class="${colFilter.kind === 'type' && colFilter.val === t ? 'active' : ''}">${META.TYPE_INFO[t].icon} ${META.TYPE_INFO[t].name}</button>`).join('');
  f.innerHTML = html;
  f.querySelectorAll('button').forEach(b => b.onclick = () => {
    colFilter = b.dataset.k === 'all' ? { kind: 'all' } : { kind: b.dataset.k, val: b.dataset.v };
    renderCollection();
  });
}
function cardHTML(cr, count) {
  const icon = META.TYPE_INFO[cr.types[0]].icon;
  return `<div class="card t${cr.tier}" data-cr="${cr.id}" style="--tc:${TYPE_COLORS[cr.types[0]]}">
    <div class="tier tier-${cr.tier}">${cr.tier}</div>
    <div class="cicon">${icon}</div>
    <div class="cname">${esc(cr.name)}</div>
    <div class="ctypes">${typePills(cr.types)}</div>
    <div class="chp">❤️ ${cr.hp} HP · ${cr.abilities.length} abilities</div>
    <div class="cabils">${cr.abilities.map(() => '<i></i>').join('')}</div>
    ${count > 1 ? `<span class="cdupe">×${count}</span>` : ''}
  </div>`;
}
function renderCollection() {
  if (!META || !STATE) return;
  renderFilters();
  const grid = groupedCards();
  let list = [...grid.keys()].map(id => creatureOf(id)).filter(Boolean);
  if (colFilter.kind === 'tier') list = list.filter(c => c.tier === colFilter.val);
  if (colFilter.kind === 'type') list = list.filter(c => c.types.includes(colFilter.val));
  const order = { L: 0, M: 1, E: 2, U: 3, C: 4 };
  list.sort((a, b) => order[a.tier] - order[b.tier] || a.name.localeCompare(b.name));
  $('col-count').textContent = `(${myCards().length} cards · ${grid.size} species)`;
  $('collection').innerHTML = list.length
    ? list.map(c => cardHTML(c, grid.get(c.id).length)).join('')
    : '<div class="empty">No cards yet — open a pack in the Shop!</div>';
  $('collection').querySelectorAll('.card').forEach(el => {
    el.onclick = () => openCardModal(el.dataset.cr);
  });
}
function openCardModal(crId) {
  const cr = creatureOf(crId);
  if (!cr) return;
  const ab = cr.abilities.map((k, i) => {
    const mv = META.MOVES[k];
    const sp = mv.kind === 'special' ? ' sp' : '';
    return `<div class="ability${sp}">
      <div class="a-icon">${mvIcon(mv)}</div>
      <div>
        <div class="a-name">${esc(mv.name)} <span class="type-pill" style="--tc:${TYPE_COLORS[mv.type]}">${META.TYPE_INFO[mv.type].icon}</span></div>
        <div class="a-meta">${mvDesc(mv)}</div>
        ${mv.kind === 'special' ? '<div class="a-desc">✨ Special move</div>' : ''}
      </div>
    </div>`;
  }).join('');
  $('card-modal-body').innerHTML = `
    <div class="big-head">
      <div class="big-icon t${cr.tier}" style="--tc:${TYPE_COLORS[cr.types[0]]}">${META.TYPE_INFO[cr.types[0]].icon}</div>
      <div>
        <h2>${esc(cr.name)} <span class="t${cr.tier}" style="font-weight:900">${cr.tier} · ${TIER_LABEL[cr.tier]}</span></h2>
        <div class="ctypes">${typePills(cr.types)}</div>
        <div class="muted small" style="margin-top:6px">❤️ ${cr.hp} HP · ${cr.abilities.length} abilities</div>
      </div>
    </div>
    <div class="ability-list">${ab}</div>
    <div class="row center" style="margin-top:16px"><button class="ghost" id="modal-close">Close</button></div>`;
  $('card-modal').hidden = false;
  $('modal-close').onclick = () => { $('card-modal').hidden = true; };
}
$('card-modal').onclick = e => { if (e.target.id === 'card-modal') $('card-modal').hidden = true; };

/* ================= shop ================= */
function renderShop() {
  if (!META || !STATE) return;
  $('starter-pack').style.display = STATE.user.starterTaken ? 'none' : '';
  $('btn-buy-pack').disabled = STATE.user.coins < META.PACK_PRICE;
  $('btn-buy-pack').textContent = 'Buy — ' + META.PACK_PRICE + ' 💰';
  $('odds-row').innerHTML = ['C', 'U', 'E', 'M', 'L'].map(t =>
    `<div class="odd t${t}"><b>${META.PACK_ODDS[t]}%</b><span>${t} · ${TIER_LABEL[t]}</span></div>`).join('');
}
$('btn-starter').onclick = () => send({ t: 'openPack', kind: 'starter' });
$('btn-buy-pack').onclick = () => send({ t: 'openPack', kind: 'shop' });

/* ================= pack overlay ================= */
let packCards = [];
function showPack(cards) {
  packCards = cards;
  const box = $('pack-cards');
  box.innerHTML = cards.map((c, i) => {
    const cr = creatureOf(c.cr);
    const icon = META.TYPE_INFO[cr.types[0]].icon;
    return `<div class="pcard ${cr.tier === 'L' ? 'legendary' : ''}" data-i="${i}">
      <div class="inner">
        <div class="face back">⚡</div>
        <div class="face front t${cr.tier}" style="--tc:${TYPE_COLORS[cr.types[0]]}">
          <div class="ptier t${cr.tier}">${cr.tier}</div>
          <div class="picon">${icon}</div>
          <div class="pname">${esc(cr.name)}</div>
          <div class="newtag">NEW</div>
        </div>
      </div>
    </div>`;
  }).join('');
  $('pack-title').textContent = 'You opened a ' + (cards.length >= 8 ? 'booster' : 'starter') + ' pack! (' + cards.length + ' cards)';
  $('pack-flipall').disabled = false;
  $('pack-done').disabled = true;
  $('pack-overlay').hidden = false;
  box.querySelectorAll('.pcard').forEach(el => el.onclick = () => flipOne(el));
}
function flipOne(el) {
  if (el.classList.contains('flipped')) return;
  el.classList.add('flipped');
  checkPackDone();
}
function checkPackDone() {
  const all = $('pack-cards').querySelectorAll('.pcard');
  const done = $('pack-cards').querySelectorAll('.pcard.flipped');
  if (done.length === all.length && all.length) {
    $('pack-done').disabled = false;
    $('pack-flipall').disabled = true;
  }
}
$('pack-flipall').onclick = () => {
  $('pack-cards').querySelectorAll('.pcard').forEach((el, i) => setTimeout(() => flipOne(el), i * 130));
};
$('pack-done').onclick = () => { $('pack-overlay').hidden = true; if (currentView === 'shop') renderShop(); };

/* ================= friends ================= */
$('btn-friend-search').onclick = () => send({ t: 'search', q: $('friend-search').value });
$('friend-search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send({ t: 'search', q: $('friend-search').value }); } });

function renderFriends() {
  if (!STATE) return;
  renderSearch();
  /* incoming */
  const inc = STATE.incoming || [];
  $('incoming-panel').hidden = inc.length === 0;
  $('incoming-list').innerHTML = inc.map(n => `
    <div class="list-row"><span class="grow"><b>${esc(n)}</b> wants to be friends</span>
      <button class="primary" data-acc="${esc(n)}">✓ Accept</button>
      <button class="ghost" data-dec="${esc(n)}">✕</button></div>`).join('');
  $('incoming-list').querySelectorAll('[data-acc]').forEach(b => b.onclick = () => send({ t: 'friendAccept', u: b.dataset.acc }));
  $('incoming-list').querySelectorAll('[data-dec]').forEach(b => b.onclick = () => send({ t: 'friendDecline', u: b.dataset.dec }));

  /* friends */
  const fr = STATE.friends || [];
  $('friend-list').innerHTML = fr.length ? fr.map(f => `
    <div class="list-row">
      <span class="dot ${f.online ? 'on' : ''}"></span>
      <span class="grow"><b>${esc(f.name)}</b> <span class="muted small">${f.online ? 'online' : 'offline'}</span></span>
      <button class="ghost" data-trade="${esc(f.name)}" ${f.online ? '' : 'disabled'}>🤝 Trade</button>
    </div>`).join('') : '<div class="empty">No friends yet — search a classmate above!</div>';
  $('friend-list').querySelectorAll('[data-trade]').forEach(b => b.onclick = () => send({ t: 'tradeOpen', u: b.dataset.trade }));
}
function renderSearch() {
  const box = $('search-results');
  if (!box) return;
  if (!lastSearch.length) { box.innerHTML = '<div class="empty" style="padding:8px">Type a username and hit search</div>'; return; }
  box.innerHTML = lastSearch.map(u => {
    let btn = `<button class="primary" data-add="${esc(u.name)}">＋ Add friend</button>`;
    if (u.rel === 'friend') btn = `<span class="rel-tag">✓ friends</span>`;
    if (u.rel === 'sent') btn = `<span class="rel-tag">request sent</span>`;
    if (u.rel === 'incoming') btn = `<button class="primary" data-acc="${esc(u.name)}">✓ Accept</button>`;
    return `<div class="list-row"><span class="dot ${u.online ? 'on' : ''}"></span>
      <span class="grow"><b>${esc(u.name)}</b></span>${btn}</div>`;
  }).join('');
  box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => send({ t: 'friendReq', u: b.dataset.add }));
  box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => send({ t: 'friendAccept', u: b.dataset.acc }));
}

/* ================= trade ================= */
function renderTrade() {
  if (!TRADE) { switchView('friends'); return; }
  if (!META || !STATE) return;

  const mineSet = new Set(TRADE.mine.map(c => c.iid));

  $('trade-status').className = 'trade-status' + (TRADE.myOk && TRADE.theirOk ? ' ok' : '');
  $('trade-status').innerHTML = `Trading with <b>${esc(TRADE.partner)}</b> — ` +
    (TRADE.myOk && TRADE.theirOk ? 'both confirmed ✓' :
      TRADE.myOk ? 'you confirmed — waiting for partner…' :
      TRADE.theirOk ? 'partner confirmed ✓ — confirm yours!' : 'pick cards, then confirm');

  $('trade-mine').innerHTML = TRADE.mine.map(c => miniOfCard(c, true)).join('');
  $('trade-theirs').innerHTML = TRADE.theirs.map(c => miniOfCard(c, false)).join('');
  $('trade-mine').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const offer = TRADE.mine.filter(c => c.iid !== b.dataset.rm).map(c => c.iid);
    send({ t: 'tradeUpdate', offer });
  });

  /* picker: grouped by species */
  const grid = groupedCards();
  const rows = [];
  for (const [crId, iids] of grid) {
    const cr = creatureOf(crId);
    const inOffer = iids.filter(x => mineSet.has(x)).length;
    const avail = iids.length - inOffer;
    rows.push(`<div class="mini ${avail > 0 ? '' : 'locked'}" data-cr="${crId}">
      <div class="micon">${META.TYPE_INFO[cr.types[0]].icon}</div>
      <div class="mname">${esc(cr.name)}</div>
      <div class="mtier t${cr.tier}">${cr.tier} · ${iids.length}×${inOffer ? ' (' + inOffer + ' offered)' : ''}</div>
    </div>`);
  }
  $('trade-picker').innerHTML = rows.join('') || '<div class="empty">No cards to trade</div>';
  $('trade-picker').querySelectorAll('[data-cr]').forEach(el => {
    el.onclick = () => {
      const iids = grid.get(el.dataset.cr).filter(x => !mineSet.has(x));
      if (!iids.length) return;
      send({ t: 'tradeUpdate', offer: [...TRADE.mine.map(c => c.iid), iids[0]] });
    };
  });

  $('btn-trade-confirm').textContent = TRADE.myOk ? '✓ Confirmed' : '✓ Confirm trade';
  $('btn-trade-confirm').disabled = TRADE.myOk;
  $('trade-ok-hint').textContent = TRADE.mine.length && TRADE.theirs.length ? '' : 'Both players must offer at least one card';
}
function miniOfCard(card, removable) {
  const cr = card.cr ? creatureOf(card.cr) : null;
  if (!cr) return `<div class="mini"><div class="micon">❓</div><div class="mname">card</div></div>`;
  return `<div class="mini">
    ${removable ? `<button class="x" data-rm="${card.iid}">✕</button>` : ''}
    <div class="micon">${META.TYPE_INFO[cr.types[0]].icon}</div>
    <div class="mname">${esc(cr.name)}</div>
    <div class="mtier t${cr.tier}">${cr.tier}</div>
  </div>`;
}
$('btn-trade-leave').onclick = () => send({ t: 'tradeCancel' });

/* ================= battle lobby ================= */
let selMode = 1;
function renderModePick() {
  const have = STATE ? STATE.cards.length : 0;
  document.querySelectorAll('#mode-pick button').forEach(b => {
    const n = Number(b.dataset.mode);
    b.classList.toggle('active', selMode === n);
    b.disabled = have < n;
    b.title = have < n ? 'You need at least ' + n + ' cards' : '';
  });
  const botBtn = $('btn-fight-bot');
  if (botBtn) botBtn.disabled = have < selMode;
}
document.querySelectorAll('#mode-pick button').forEach(b => {
  b.onclick = () => { selMode = Number(b.dataset.mode); renderModePick(); };
});

$('btn-create-room').onclick = () => {
  send({ t: 'roomCreate', name: $('room-name').value, mode: selMode });
  expectRoom = true;
};
$('btn-fight-bot').onclick = () => {
  send({ t: 'roomCreate', name: $('room-name').value || 'Bot match', mode: selMode, bot: true });
  expectRoom = true;
};
$('btn-refresh-rooms').onclick = () => send({ t: 'roomList' });

function renderRooms() {
  if (!META) return;
  const box = $('room-list');
  let html = '';
  if (myRoomId) {
    const r = ROOMS.find(x => x.id === myRoomId);
    html += `<div class="room-row"><span class="rname">↩ Your room</span>
      <span class="rmeta">${esc(r ? r.name : '')}</span>
      <button class="primary" id="btn-return-room">Enter</button></div>`;
  }
  const list = ROOMS.filter(r => r.id !== myRoomId);
  if (!list.length) html += '<div class="empty">No open rooms — create one!</div>';
  html += list.map(r => {
    const st = r.status === 'waiting' ? '<span class="badge wait">waiting</span>'
      : r.status === 'picking' ? '<span class="badge pick">picking</span>'
      : '<span class="badge live">battle</span>';
    const canJoin = r.status === 'waiting' && r.players < 2;
    return `<div class="room-row">
      <span class="rname">${esc(r.name)}</span>
      <span class="mode-badge ${r.bot ? 'bot-badge' : ''}">${r.mode}v${r.mode}${r.bot ? ' 🤖' : ''}</span>
      <span class="rmeta">by ${esc(r.host)} · ${r.watchers} 👁 watching</span>
      ${st}
      ${canJoin ? `<button class="primary" data-join="${r.id}">Join</button>` : ''}
      ${r.status !== 'waiting' ? `<button class="ghost" data-watch="${r.id}">👁 Watch</button>` : ''}
    </div>`;
  }).join('');
  box.innerHTML = html;
  const ret = $('btn-return-room');
  if (ret) ret.onclick = () => { expectRoom = true; send({ t: 'roomGet' }); };
  box.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { expectRoom = true; send({ t: 'roomJoin', id: b.dataset.join }); });
  box.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { expectRoom = true; send({ t: 'roomWatch', id: b.dataset.watch }); });
}

/* ================= room / battle ================= */
function mySide() { return ROOM ? (ROOM.you === 'host' || ROOM.you === 'guest' ? ROOM.you : null) : null; }
function myPlayerIdx() {
  if (!ROOM || !ROOM.battle) return -1;
  const me = STATE.user.name;
  return ROOM.battle.players[0].name === me ? 0 : (ROOM.battle.players[1].name === me ? 1 : -1);
}

function renderRoom() {
  if (!ROOM || !META) return;
  const mode = ROOM.mode || 1;
  $('room-title').textContent = ROOM.bot
    ? `${ROOM.name} · ${mode}v${mode} · 🤖 Bot match`
    : `${ROOM.name} · ${mode}v${mode} · ${ROOM.host} vs ${ROOM.guest || '…'} · ${ROOM.watchers.length} 👁`;
  $('phase-pick').hidden = !(ROOM.status === 'waiting' || ROOM.status === 'picking');
  $('phase-battle').hidden = !(ROOM.status === 'battle' || ROOM.status === 'over');
  if (!$('phase-pick').hidden) renderPickPhase();
  if (!$('phase-battle').hidden) renderBattle();
  renderChat();
}

function renderPickPhase() {
  const side = mySide();
  const mode = ROOM.mode || 1;
  const grid = groupedCards();
  const surr = $('btn-surrender');
  if (surr) surr.hidden = true;
  const hostPicks = (ROOM.picks && ROOM.picks.host) || [];
  const guestPicks = (ROOM.picks && ROOM.picks.guest) || [];

  if (!side) {
    $('pick-status').innerHTML = `<b>👁 Spectating</b> — ${mode}v${mode}: host ${hostPicks.length}/${mode} · ${ROOM.bot ? 'bot' : 'guest'} ${guestPicks.length}/${mode} picked`;
    $('pick-grid').innerHTML = '';
    $('pick-chosen').hidden = true;
    return;
  }

  const myPicks = (ROOM.picks[side] || []).slice();
  const oppSide = side === 'host' ? 'guest' : 'host';
  const oppPicks = (ROOM.picks[oppSide] || []);
  const oppName = side === 'host' ? (ROOM.bot ? 'the bot 🤖' : ROOM.guest) : ROOM.host;

  /* status line */
  if (myPicks.length >= mode) {
    $('pick-status').innerHTML = oppPicks.length >= mode
      ? `<b>✅ Both teams locked!</b> starting…`
      : `<b>✅ Team ready (${mode}/${mode})</b> — waiting for ${esc(oppName)}…`;
  } else {
    $('pick-status').innerHTML = ROOM.bot
      ? `<b>🤖 Choose ${mode} creature${mode > 1 ? 's' : ''} to fight the bot</b> — ${myPicks.length}/${mode} picked · bot team: ${oppPicks.length}/${mode} ready`
      : ROOM.guest
        ? `<b>⚔️ Opponent joined!</b> choose your team — ${myPicks.length}/${mode} picked`
        : `<b>⏳ Waiting for an opponent…</b> you can pre-pick your team — ${myPicks.length}/${mode}`;
  }

  /* selected slots */
  const slots = myPicks.map(iid => {
    const card = myCards().find(c => c.iid === iid);
    const cr = card ? creatureOf(card.cr) : null;
    if (!cr) return '';
    return `<div class="mini picked" data-rm="${iid}">
      <button class="x" data-rmx="${iid}">✕</button>
      <div class="micon">${META.TYPE_INFO[cr.types[0]].icon}</div>
      <div class="mname">${esc(cr.name)}</div>
      <div class="mtier t${cr.tier}">${cr.tier} · ❤️${cr.hp}</div>
    </div>`;
  }).join('');
  $('pick-chosen').hidden = false;
  $('pick-chosen').className = 'pick-chosen team-slots';
  $('pick-chosen').innerHTML = slots || `<span class="muted small">no creatures selected yet — click below</span>`;

  /* species grid */
  $('pick-grid').innerHTML = [...grid.entries()].map(([crId, iids]) => {
    const cr = creatureOf(crId);
    const pickedCount = iids.filter(x => myPicks.includes(x)).length;
    const full = myPicks.length >= mode && pickedCount === 0;
    return `<div class="mini ${pickedCount ? 'picked' : ''} ${full ? 'locked' : ''}" data-cr="${crId}">
      <div class="micon">${META.TYPE_INFO[cr.types[0]].icon}</div>
      <div class="mname">${esc(cr.name)}</div>
      <div class="mtier t${cr.tier}">${cr.tier} · ❤️${cr.hp} · owned ${iids.length}${pickedCount ? ' · <b>✓' + pickedCount + '</b>' : ''}</div>
    </div>`;
  }).join('');

  const sendPicks = arr => send({ t: 'pick', iids: arr });
  $('pick-chosen').querySelectorAll('[data-rmx]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    sendPicks(myPicks.filter(x => x !== el.dataset.rmx));
  });
  $('pick-grid').querySelectorAll('[data-cr]').forEach(el => el.onclick = () => {
    const iids = grid.get(el.dataset.cr);
    const ownedPicked = iids.filter(x => myPicks.includes(x));
    if (ownedPicked.length) {
      sendPicks(myPicks.filter(x => x !== ownedPicked[0]));
    } else if (myPicks.length < mode) {
      const free = iids.find(x => !myPicks.includes(x));
      if (free) sendPicks([...myPicks, free]);
    }
  });
}

function renderBattle() {
  const b = ROOM.battle;
  if (!b) return;
  const myIdx = myPlayerIdx();
  const watcher = myIdx < 0;
  const oppIdx = watcher ? 0 : 1 - myIdx;
  const meIdx = watcher ? 1 : myIdx;
  renderFighter('opp', b.players[oppIdx], b.turn === oppIdx && !b.over, b);
  renderFighter('me', b.players[meIdx], b.turn === meIdx && !b.over, b);

  /* turn banner */
  const banner = $('turn-banner');
  if (b.over) {
    const w = b.players[b.winner];
    banner.className = 'over';
    banner.textContent = '🏆 ' + w.name + ' wins the battle!';
  } else if (watcher) {
    banner.className = 'theirs';
    banner.textContent = '👁 Spectating — ' + b.players[b.turn].name + "'s turn";
  } else if (b.turn === myIdx) {
    banner.className = 'mine';
    banner.textContent = '⚡ YOUR TURN';
  } else {
    banner.className = 'theirs';
    banner.textContent = '⏳ Waiting for ' + b.players[b.turn].name + '…';
  }

  /* log */
  const log = $('battle-log');
  log.innerHTML = b.log.map(fmtLog).join('');
  log.scrollTop = log.scrollHeight;

  /* ability bar — operates on the ACTIVE creature */
  const bar = $('ability-bar');
  if (watcher) {
    bar.innerHTML = '<div class="muted" style="padding:10px;text-align:center;width:100%">👁 Spectator mode — abilities hidden until battle ends</div>';
  } else if (b.over) {
    bar.innerHTML = '';
  } else {
    const meBp = b.players[myIdx];
    const oppBp = b.players[1 - myIdx];
    const me = meBp.team[meBp.active];
    const opp = oppBp.team[oppBp.active];
    const cr = creatureOf(me.cr);
    const oppCr = creatureOf(opp.cr);
    const myTurn = b.turn === myIdx;
    bar.innerHTML = cr.abilities.map(k => {
      const mv = META.MOVES[k];
      const cd = me.cd[k] || 0;
      const eff = mv.power > 0 && oppCr ? effOf(mv.type, oppCr.types) : 0;
      const effTag = eff > 1.05 ? '<span class="efftag sup">SUPER</span>' : eff < 0.95 ? '<span class="efftag weak">WEAK</span>' : '';
      return `<button class="abtn" data-k="${k}" ${cd > 0 || !myTurn ? 'disabled' : ''}>
        ${cd > 0 ? `<span class="cdmask">⏳ ${cd}</span>` : ''}
        <div class="an">${mvIcon(mv)} ${esc(mv.name)}</div>
        <div class="am">${mvDesc(mv)}</div>
        ${effTag}
      </button>`;
    }).join('');
    bar.querySelectorAll('.abtn').forEach(el => el.onclick = () => send({ t: 'ability', key: el.dataset.k }));
  }

  /* surrender button (players only, while battle live) */
  const surr = $('btn-surrender');
  if (surr) surr.hidden = b.over || watcher;

  /* end overlay */
  const end = $('battle-end');
  if (b.over) {
    const won = myIdx >= 0 && b.winner === myIdx;
    const iAmPlayer = myIdx >= 0;
    const mode = ROOM.mode || 1;
    const winC = ROOM.bot ? (mode === 1 ? 0 : 5) : META.REWARD.win;
    const loseC = ROOM.bot ? 0 : META.REWARD.lose;
    const myReward = won ? winC : loseC;
    end.hidden = false;
    end.innerHTML = `<div class="end-box ${iAmPlayer ? (won ? 'win' : 'lose') : ''}">
      <h1>${iAmPlayer ? (won ? '🏆 VICTORY!' : '💔 DEFEAT') : '🏁 Battle over!'}</h1>
      <div class="muted">${esc(b.players[b.winner].name)} won the ${mode}v${mode} match</div>
      <div class="coins">${iAmPlayer
        ? (myReward > 0 ? '+' + myReward + ' 💰 coins'
          : (ROOM.bot ? '🤖 practice match — no coins' : '+0 coins'))
        : ''}</div>
      <button class="primary" id="btn-end-lobby">Back to Lobby</button>
    </div>`;
    $('btn-end-lobby').onclick = () => { send({ t: 'roomLeave' }); myRoomId = null; ROOM = null; switchView('battle'); };
  } else {
    end.hidden = true;
    end.innerHTML = '';
  }
}

function renderFighter(prefix, bp, active, b) {
  const m = bp.team[bp.active];
  const cr = creatureOf(m.cr);
  const hpR = m.hp / m.maxHp;
  const fig = $('fig-' + prefix);
  fig.classList.toggle('active-turn', active);
  fig.style.setProperty('--tc', TYPE_COLORS[cr.types[0]]);
  $('' + prefix + '-card').innerHTML = `<span class="ftier tier-${cr.tier}">${cr.tier}</span>${META.TYPE_INFO[cr.types[0]].icon}`;
  $('' + prefix + '-name').innerHTML =
    `<b>${esc(bp.name)}</b> ${typePills(cr.types)} <span class="muted small">${esc(cr.name)}</span>`;
  const fill = $('' + prefix + '-hp');
  fill.style.width = (hpR * 100) + '%';
  fill.className = 'hp-fill ' + hpClass(hpR);
  $('' + prefix + '-hpnum').textContent = m.hp + ' / ' + m.maxHp + ' HP';

  const buffs = [];
  if (m.evade) buffs.push('<span class="buff dodge">💨 dodge ready</span>');
  if (m.guard) buffs.push('<span class="buff guard">🛡 guarded</span>');
  if (m.atkLeft > 0) buffs.push('<span class="buff atk">⬆ focus ×' + m.atkLeft + '</span>');
  if (bp.disconnected) buffs.push('<span class="buff dc">⚠ offline</span>');
  $('' + prefix + '-buffs').innerHTML = buffs.join('');

  /* team strip — every creature in the squad */
  $('' + prefix + '-team').innerHTML = bp.team.map((tm, i) => {
    const tcr = creatureOf(tm.cr);
    const r = tm.maxHp ? tm.hp / tm.maxHp : 0;
    return `<div class="tslot ${i === bp.active && !tm.fainted ? 'active' : ''} ${tm.fainted ? 'dead' : ''}"
      title="${esc(tcr.name)}${tm.fainted ? ' (fainted)' : ''}">
      <span class="ti">${META.TYPE_INFO[tcr.types[0]].icon}</span>
      <div class="thp"><i class="${hpClass(r)}" style="width:${tm.fainted ? 0 : Math.round(r * 100)}%"></i></div>
    </div>`;
  }).join('');

  if (prefix === 'opp') {
    const cds = [];
    for (const k of cr.abilities) {
      const mv = META.MOVES[k];
      const cd = m.cd[k] || 0;
      cds.push(`<span class="cdpip ${cd === 0 ? 'ready' : ''}" title="${esc(mv.name)}">${mvIcon(mv)}${cd > 0 ? ' ' + cd : ''}</span>`);
    }
    $('opp-cds').innerHTML = cds.join('');
  }
}

function fmtLog(e) {
  switch (e.k) {
    case 'sys': return `<div class="log-line sys">${esc(e.msg)}</div>`;
    case 'atk': {
      if (e.miss) return `<div class="log-line"><b>${esc(e.a)}</b> used <b>${esc(e.m)}</b> — but <b>${esc(e.t)}</b> dodged! 💨</div>`;
      let s = `<div class="log-line"><b>${esc(e.a)}</b> used <b>${esc(e.m)}</b> → <span class="dmg">${e.d}</span> dmg to <b>${esc(e.t)}</b>`;
      if (e.eff === 'sup') s += ' <span class="sup">SUPER EFFECTIVE!</span>';
      if (e.eff === 'weak') s += ' <span class="weak">not very effective</span>';
      if (e.leech) s += ' <span class="heal">+' + e.leech + ' HP</span>';
      return s + '</div>';
    }
    case 'util': {
      const act = {
        dodge: 'is ready to dodge the next hit 💨',
        guard: 'raises its guard 🛡 (-' + Math.round(META.GUARD_REDUCE * 100) + '% dmg)',
        atk: 'focuses! next 2 attacks +25% dmg ⬆',
        heal: 'heals <span class="heal">+' + e.v + ' HP</span> 💚'
      }[e.act] || '';
      return `<div class="log-line util"><b>${esc(e.a)}</b> used <b>${esc(e.m)}</b> — ${act}</div>`;
    }
    case 'faint': return `<div class="log-line"><b>${esc(e.m)}</b> fainted! 💀 (${esc(e.t)}'s team)</div>`;
    case 'switch': return `<div class="log-line util">Go, <b>${esc(e.m)}</b>! ${esc(e.a)} sends out their next creature</div>`;
    case 'end': return `<div class="log-line end">🏆 <b>${esc(e.w)}</b> wins the battle! <b>${esc(e.l)}</b> is defeated!</div>`;
    case 'reward':
      if (e.bot && e.winCoins === 0) return `<div class="log-line sys">🤖 bot match · practice (no coins)</div>`;
      return `<div class="log-line sys">Winner +${e.winCoins} 💰 · Loser +${e.loseCoins} 💰</div>`;
    default: return '';
  }
}

$('btn-room-leave').onclick = () => {
  if (ROOM && ROOM.status === 'battle' && ROOM.battle && !ROOM.battle.over && mySide()) {
    if (!confirm('Leave the battle? You will forfeit (you still earn 5 coins).')) return;
  }
  send({ t: 'roomLeave' });
  myRoomId = null; ROOM = null;
  switchView('battle');
};

/* chat */
function renderChat() {
  if (!ROOM) return;
  const surr = $('btn-surrender');
  if (surr) surr.onclick = () => { if (confirm('🏳️ Surrender this battle?')) send({ t: 'surrender' }); };
  $('chat-log').innerHTML = ROOM.chat.map(c => `<div class="c"><u>${esc(c.u)}</u>: ${esc(c.m)}</div>`).join('') ||
    '<div class="sys">Say hi to your opponent or the spectators 👋</div>';
  const l = $('chat-log'); l.scrollTop = l.scrollHeight;
}
$('chat-form').onsubmit = e => {
  e.preventDefault();
  const v = $('chat-input').value.trim();
  if (!v) return;
  send({ t: 'chat', m: v });
  $('chat-input').value = '';
};

/* ================= boot ================= */
connect();
