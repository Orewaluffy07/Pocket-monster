'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./data');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

/* ================= persistence ================= */
let db = { users: {}, cardSeq: 1, roomSeq: 1, tradeSeq: 1 };
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (raw && raw.users) db = raw;
  }
} catch (e) { console.error('Failed to load data.json:', e.message); }

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(db), err => { if (err) console.error('save failed', err.message); });
  }, 400);
}

/* ================= runtime state ================= */
const sessions = {};                       // token -> username
const live = new Map();                    // username -> Set<ws>
const rooms = new Map();                   // roomId -> room
const roomOf = new Map();                  // username -> roomId
const trades = new Map();                  // tradeId -> trade
const tradeLocks = new Map();              // card iid -> tradeId
const disconnectTimers = new Map();        // username -> timeout

function newId(prefix, key) { db[key] = (db[key] || 1) + 1; return prefix + (db[key] - 1); }

/* ================= helpers ================= */
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function pushUser(name, obj) {
  const set = live.get(name);
  if (set) for (const ws of set) send(ws, obj);
}
function isOnline(name) { const s = live.get(name); return !!s && s.size > 0; }

function hashPass(pass, salt) {
  return crypto.createHash('sha256').update(salt + '::' + pass).digest('hex');
}

function validUser(u) { return typeof u === 'string' && /^[a-z0-9_]{3,16}$/.test(u); }
function validPass(p) { return typeof p === 'string' && p.length >= 4 && p.length <= 64; }

function ownCard(user, iid) { return db.users[user].cards.find(c => c.iid === iid) || null; }

function sendState(name) {
  const u = db.users[name];
  if (!u) return;
  pushUser(name, {
    t: 'state',
    user: { name, coins: u.coins, starterTaken: u.starterTaken, created: u.created },
    cards: u.cards,
    friends: u.friends.map(f => ({ name: f, online: isOnline(f) })),
    incoming: u.incoming,
    outgoing: u.outgoing
  });
}

function effMult(moveType, defTypes) {
  let m = 1;
  for (const t of defTypes) m *= (D.CHART[moveType][t] || 1);
  return Math.max(0.6, Math.min(1.5625, m));
}

/* ================= packs ================= */
function rollTier() {
  const r = Math.random() * 100;
  if (r < 60) return 'C';
  if (r < 90) return 'U';
  if (r < 97) return 'E';
  if (r < 99) return 'M';
  return 'L';
}
function openPack(name, kind) {
  const u = db.users[name];
  const size = D.PACK_SIZES[kind];
  if (!size) return { err: 'Unknown pack' };
  if (kind === 'starter') {
    if (u.starterTaken) return { err: 'Starter pack already opened' };
    u.starterTaken = true;
  } else {
    if (u.coins < D.PACK_PRICE) return { err: 'Not enough coins (need ' + D.PACK_PRICE + ')' };
    u.coins -= D.PACK_PRICE;
  }
  const cards = [];
  for (let i = 0; i < size; i++) {
    const tier = rollTier();
    const pool = D.BY_TIER[tier];
    const cr = pool[Math.floor(Math.random() * pool.length)];
    const card = { iid: newId('c', 'cardSeq'), cr: cr.id };
    u.cards.push(card);
    cards.push(card);
  }
  save();
  return { cards };
}

/* ================= friends ================= */
function searchUsers(me, q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return [];
  const u = db.users[me];
  const matches = [];
  for (const name of Object.keys(db.users)) {
    if (name === me || !name.includes(q)) continue;
    const other = db.users[name];
    let rel = 'none';
    if (u.friends.includes(name)) rel = 'friend';
    else if (u.outgoing.includes(name)) rel = 'sent';
    else if (u.incoming.includes(name)) rel = 'incoming';
    const score = name === q ? 0 : (name.startsWith(q) ? 1 : 2);
    matches.push({ name, online: isOnline(name), rel, score });
  }
  matches.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return matches.slice(0, 10).map(({ score, ...rest }) => rest);
}

function friendReq(me, target) {
  const u = db.users[me];
  const o = db.users[target];
  if (!o) return { err: 'Player not found' };
  if (target === me) return { err: 'That is you' };
  if (u.friends.includes(target)) return { err: 'Already friends' };
  if (u.outgoing.includes(target)) return { err: 'Request already sent' };
  if (u.incoming.includes(target)) return { err: 'They already sent you a request' };
  u.outgoing.push(target);
  o.incoming.push(me);
  save();
  pushUser(target, { t: 'toast', kind: 'friend', msg: me + ' sent you a friend request' });
  sendState(target);
  return {};
}

function friendAccept(me, from) {
  const u = db.users[me];
  const o = db.users[from];
  if (!o || !u.incoming.includes(from)) return { err: 'No such request' };
  u.incoming = u.incoming.filter(x => x !== from);
  u.outgoing = u.outgoing.filter(x => x !== from);
  if (!u.friends.includes(from)) u.friends.push(from);
  if (!o.friends.includes(me)) o.friends.push(me);
  o.outgoing = o.outgoing.filter(x => x !== me);
  o.incoming = o.incoming.filter(x => x !== me);
  save();
  pushUser(from, { t: 'toast', kind: 'friend', msg: me + ' accepted your friend request' });
  sendState(from);
  return {};
}

function friendDecline(me, from) {
  const u = db.users[me];
  if (!u.incoming.includes(from)) return { err: 'No such request' };
  u.incoming = u.incoming.filter(x => x !== from);
  const o = db.users[from];
  if (o) o.outgoing = o.outgoing.filter(x => x !== me);
  save();
  sendState(from);
  return {};
}

/* ================= rooms ================= */
const BOT_NAME = '🤖 Bot';
const MODES = [1, 3, 5];
const BOT_DELAY = parseInt(process.env.BOT_DELAY || '700', 10);

function roomList() {
  const out = [];
  for (const r of rooms.values()) {
    out.push({
      id: r.id, name: r.name, host: r.host, status: r.status,
      mode: r.mode || 1, bot: !!r.bot,
      players: (r.host ? 1 : 0) + (r.guest ? 1 : 0),
      watchers: r.watchers.length
    });
  }
  return out;
}
function broadcastRooms() {
  const list = roomList();
  for (const set of live.values()) for (const ws of set) send(ws, { t: 'rooms', list });
}

function createRoom(name, ws, mode) {
  const id = newId('r', 'roomSeq');
  const clean = String(name || '').trim().slice(0, 24);
  const room = {
    id, name: clean || (ws.__user + "'s room"),
    mode: MODES.includes(mode) ? mode : 1,
    bot: false, botTeam: null,
    host: null, guest: null, watchers: [],
    status: 'waiting', picks: { host: [], guest: [] },
    battle: null, chat: [], createdAt: Date.now(), _botTimer: null
  };
  rooms.set(id, room);
  joinRoom(ws.__user, room, 'host');
  room.status = 'waiting';
  broadcastRooms();
  return room;
}

/* Bot picks from the whole roster, but never stacks the best tiers:
   at most 1 Legendary and 1 Mythic per team. */
function pickBotTeam(mode) {
  const picked = [];
  let lCount = 0, mCount = 0, guard = 0;
  while (picked.length < mode && guard++ < 600) {
    const r = Math.random() * 100;
    let tier = r < 40 ? 'C' : r < 70 ? 'U' : r < 88 ? 'E' : r < 96 ? 'M' : 'L';
    if (tier === 'L' && lCount >= 1) tier = 'E';
    if (tier === 'M' && mCount >= 1) tier = 'U';
    const pool = D.BY_TIER[tier];
    const cand = pool[Math.floor(Math.random() * pool.length)];
    if (picked.includes(cand.id)) continue;
    if (tier === 'L') lCount++;
    if (tier === 'M') mCount++;
    picked.push(cand.id);
  }
  return picked;
}

function joinRoom(user, room, side) {
  roomOf.set(user, room.id);
  if (side === 'host') room.host = user;
  else room.guest = user;
}

function watchRoom(user, room) {
  roomOf.set(user, room.id);
  if (!room.watchers.includes(user)) room.watchers.push(user);
}

function roomView(room, forUser) {
  let you = null;
  if (room.host === forUser) you = 'host';
  else if (room.guest === forUser) you = 'guest';
  else you = 'watcher';
  const b = room.battle;
  return {
    t: 'room',
    room: {
      id: room.id, name: room.name, host: room.host, guest: room.guest,
      status: room.status, you,
      mode: room.mode || 1, bot: !!room.bot,
      picks: room.picks,
      watchers: room.watchers.slice(),
      battle: b ? {
        players: b.players.map(bp => ({
          name: bp.name, isBot: bp.isBot, active: bp.active,
          disconnected: !!bp.disconnected,
          team: bp.team.map(m => ({
            cr: m.cr, iid: m.iid, hp: m.hp, maxHp: m.maxHp, cd: m.cd,
            evade: m.evade, guard: m.guard, atkLeft: m.atkLeft,
            atkMult: m.atkMult, fainted: m.fainted
          }))
        })),
        turn: b.turn, log: b.log.slice(-70), over: b.over, winner: b.winner,
        mode: b.mode
      } : null,
      chat: room.chat.slice(-40)
    }
  };
}
function bcastRoom(room) {
  const names = [room.host, room.guest, ...room.watchers].filter(Boolean);
  for (const n of names) {
    const set = live.get(n);
    if (set) for (const ws of set) send(ws, roomView(room, n));
  }
}

function closeRoom(room, reason) {
  if (room._botTimer) { clearTimeout(room._botTimer); room._botTimer = null; }
  const names = [room.host, room.guest, ...room.watchers].filter(Boolean);
  for (const n of names) {
    if (roomOf.get(n) === room.id) roomOf.delete(n);
    pushUser(n, { t: 'roomClosed', reason });
  }
  rooms.delete(room.id);
  broadcastRooms();
}

function leaveRoom(user) {
  const roomId = roomOf.get(user);
  if (!roomId) return;
  const room = rooms.get(roomId);
  roomOf.delete(user);
  if (!room) return;

  if (room.watchers.includes(user)) {
    room.watchers = room.watchers.filter(w => w !== user);
    sendState(user);
    bcastRoom(room);
    return;
  }

  const isPlayer = room.host === user || room.guest === user;
  if (!isPlayer) return;

  /* leaving mid-battle = forfeit, then close */
  if (room.status === 'battle' && room.battle && !room.battle.over) {
    finishBattle(room, room.host === user ? 1 : 0, 'forfeit');
  }
  closeRoom(room, 'Room closed');
}

/* ================= battle engine (team battles) ================= */
function buildMember(crId, iid) {
  const cr = D.CREATURES[crId];
  const cd = {};
  for (const ab of cr.abilities) cd[ab] = 0;
  return {
    cr: cr.id, iid, hp: cr.hp, maxHp: cr.hp, cd,
    evade: false, guard: false, atkMult: 1, atkLeft: 0, fainted: false
  };
}

function startBattle(room) {
  const hostCards = room.picks.host.map(iid => ownCard(room.host, iid));
  const guestCards = room.bot ? null : room.picks.guest.map(iid => ownCard(room.guest, iid));
  if (hostCards.some(c => !c) || (guestCards && guestCards.some(c => !c))) return false;

  const players = [
    {
      name: room.host, isBot: false, active: 0, disconnected: false,
      team: hostCards.map(c => buildMember(c.cr, c.iid))
    },
    room.bot
      ? { name: BOT_NAME, isBot: true, active: 0, disconnected: false, team: room.botTeam.map(id => buildMember(id, null)) }
      : { name: room.guest, isBot: false, active: 0, disconnected: false, team: guestCards.map(c => buildMember(c.cr, c.iid)) }
  ];

  room.status = 'battle';
  room.battle = {
    players, turn: 0, over: false, winner: null, mode: room.mode,
    log: [{
      k: 'sys',
      msg: '⚔️ ' + room.mode + 'v' + room.mode + ' battle! ' +
        players[0].name + (room.bot ? ' 🤖 vs Bot' : ' vs ' + players[1].name) +
        ' — ' + room.mode + ' creature' + (room.mode > 1 ? 's' : '') + ' each'
    }]
  };
  broadcastRooms();
  bcastRoom(room);
  return true;
}

function beginTurn(b, pi) {
  const m = b.players[pi].team[b.players[pi].active];
  m.evade = false;
  m.guard = false;
  for (const k in m.cd) if (m.cd[k] > 0) m.cd[k]--;
}

function rewardFor(room, winnerIdx) {
  if (room.bot) {
    const humanWon = winnerIdx === 0;
    return { win: humanWon ? ((room.mode || 1) === 1 ? 0 : 5) : 0, lose: 0 };
  }
  return { win: D.REWARD.win, lose: D.REWARD.lose };
}

function finishBattle(room, winnerIdx, reason) {
  const b = room.battle;
  if (!b || b.over) return;
  b.over = true;
  b.winner = winnerIdx;
  const w = b.players[winnerIdx];
  const l = b.players[1 - winnerIdx];
  if (reason === 'forfeit') b.log.push({ k: 'sys', msg: l.name + ' left the battle!' });
  b.log.push({ k: 'end', w: w.name, l: l.name });
  room.status = 'over';
  if (room._botTimer) { clearTimeout(room._botTimer); room._botTimer = null; }

  const rw = rewardFor(room, winnerIdx);
  if (db.users[w.name]) db.users[w.name].coins += rw.win;
  if (db.users[l.name]) db.users[l.name].coins += rw.lose;
  save();

  b.log.push({ k: 'reward', w: w.name, winCoins: rw.win, loseCoins: rw.lose, bot: !!room.bot, mode: room.mode || 1 });
  bcastRoom(room);

  const practice = rw.win === 0 && !!room.bot;
  if (db.users[w.name]) {
    pushUser(w.name, {
      t: 'toast', kind: 'win',
      msg: practice ? '🏆 Victory! Practice match — no coins' : '🏆 Victory! You earned ' + rw.win + ' coins'
    });
    sendState(w.name);
  }
  if (db.users[l.name]) {
    pushUser(l.name, {
      t: 'toast', kind: 'lose',
      msg: room.bot ? 'Defeated by the bot — no coins this match' : 'Defeated — you earned ' + rw.lose + ' coins'
    });
    sendState(l.name);
  }
}

function useAbility(room, user, moveKey) {
  const b = room.battle;
  if (!b || b.over) return { err: 'Battle is not running' };
  const pi = b.players[0].name === user ? 0 : (b.players[1].name === user ? 1 : -1);
  if (pi < 0) return { err: 'Not in this battle' };
  if (b.turn !== pi) return { err: 'Not your turn' };

  const bp = b.players[pi];
  const obp = b.players[1 - pi];
  const p = bp.team[bp.active];
  const opp = obp.team[obp.active];
  const pCr = D.CREATURES[p.cr];
  const oCr = D.CREATURES[opp.cr];
  if (!pCr.abilities.includes(moveKey)) return { err: 'Unknown ability' };
  if ((p.cd[moveKey] || 0) > 0) return { err: 'Ability on cooldown' };

  const mv = D.MOVES[moveKey];
  p.cd[moveKey] = mv.cd;

  /* utility move (no damage) */
  if (mv.power <= 0) {
    if (mv.fx && mv.fx.dodge) {
      p.evade = true;
      b.log.push({ k: 'util', a: pCr.name, m: mv.name, mt: mv.type, act: 'dodge' });
    } else if (mv.fx && mv.fx.guard) {
      p.guard = true;
      b.log.push({ k: 'util', a: pCr.name, m: mv.name, mt: mv.type, act: 'guard' });
    } else if (mv.fx && mv.fx.atk) {
      p.atkMult = mv.fx.atk;
      p.atkLeft = mv.fx.attacks;
      b.log.push({ k: 'util', a: pCr.name, m: mv.name, mt: mv.type, act: 'atk' });
    } else if (mv.fx && mv.fx.heal) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + mv.fx.heal);
      b.log.push({ k: 'util', a: pCr.name, m: mv.name, mt: mv.type, act: 'heal', v: p.hp - before });
    }
  } else {
    /* attack */
    if (opp.evade && Math.random() < D.DODGE_CHANCE) {
      b.log.push({ k: 'atk', a: pCr.name, m: mv.name, mt: mv.type, t: oCr.name, d: 0, miss: true });
    } else {
      const base = mv.power * (0.92 + Math.random() * 0.16);
      let mult = 1;
      if (pCr.types.includes(mv.type)) mult *= D.STAB;
      const e = effMult(mv.type, oCr.types);
      mult *= e;
      if (p.atkLeft > 0) mult *= p.atkMult;
      if (opp.guard) mult *= (1 - D.GUARD_REDUCE);
      const dmg = Math.max(1, Math.round(base * mult));

      if (p.atkLeft > 0) { p.atkLeft--; if (p.atkLeft <= 0) { p.atkLeft = 0; p.atkMult = 1; } }

      opp.hp = Math.max(0, opp.hp - dmg);
      const entry = {
        k: 'atk', a: pCr.name, m: mv.name, mt: mv.type, t: oCr.name, d: dmg,
        eff: e > 1.05 ? 'sup' : (e < 0.95 ? 'weak' : '')
      };
      if (mv.fx && mv.fx.leech) {
        const heal = Math.min(p.maxHp - p.hp, Math.round(dmg * mv.fx.leech));
        if (heal > 0) { p.hp += heal; entry.leech = heal; }
      }
      b.log.push(entry);

      if (opp.hp <= 0) {
        /* faint — send out next creature or end the battle */
        opp.fainted = true;
        opp.hp = 0;
        b.log.push({ k: 'faint', t: obp.name, m: oCr.name });
        const nextIdx = obp.team.findIndex(m => !m.fainted);
        if (nextIdx < 0) {
          finishBattle(room, pi, 'ko');
          return {};
        }
        obp.active = nextIdx;
        b.log.push({ k: 'switch', a: obp.name, m: D.CREATURES[obp.team[nextIdx].cr].name });
      }
    }
  }

  /* next turn */
  b.turn = 1 - b.turn;
  beginTurn(b, b.turn);
  bcastRoom(room);
  if (room.bot && !b.over && b.turn === 1) scheduleBot(room);
  return {};
}

/* ---------- bot AI ---------- */
function scheduleBot(room) {
  if (room._botTimer) clearTimeout(room._botTimer);
  room._botTimer = setTimeout(() => {
    room._botTimer = null;
    botAct(room);
  }, BOT_DELAY);
}

function botAct(room) {
  if (!rooms.has(room.id)) return;
  const b = room.battle;
  if (!b || b.over || b.turn !== 1) return;
  const bp = b.players[1];
  const m = bp.team[bp.active];
  const cr = D.CREATURES[m.cr];
  const usable = cr.abilities.filter(k => (m.cd[k] || 0) === 0);
  if (!usable.length) return;

  const humanActive = b.players[0].team[b.players[0].active];
  const hTypes = D.CREATURES[humanActive.cr].types;
  const scored = usable.map(k => {
    const mv = D.MOVES[k];
    const score = mv.power > 0 ? mv.power * effMult(mv.type, hTypes) : 3;
    return { k, score };
  });
  let key;
  if (Math.random() < 0.75) {
    scored.sort((a, c) => c.score - a.score);
    key = scored[0].k;
  } else {
    key = usable[Math.floor(Math.random() * usable.length)];
  }
  const res = useAbility(room, BOT_NAME, key);
  if (res.err) console.log('[bot]', res.err);
}

function surrender(room, user) {
  const b = room.battle;
  if (!b || b.over) return { err: 'Battle is not running' };
  const pi = b.players[0].name === user ? 0 : (b.players[1].name === user ? 1 : -1);
  if (pi < 0) return { err: 'Not in this battle' };
  finishBattle(room, 1 - pi, 'forfeit');
  return {};
}

/* ================= trades ================= */
function cardsView(name, iids) {
  const u = db.users[name];
  return iids.map(iid => {
    const c = u ? u.cards.find(x => x.iid === iid) : null;
    return { iid, cr: c ? c.cr : null };
  });
}
function tradeView(tr, forUser) {
  const mineName = forUser === tr.a ? tr.a : tr.b;
  const theirName = forUser === tr.a ? tr.b : tr.a;
  const mine = forUser === tr.a ? tr.oa : tr.ob;
  const theirs = forUser === tr.a ? tr.ob : tr.oa;
  const myOk = forUser === tr.a ? tr.okA : tr.okB;
  const theirOk = forUser === tr.a ? tr.okB : tr.okA;
  return {
    t: 'trade',
    trade: {
      id: tr.id,
      partner: forUser === tr.a ? tr.b : tr.a,
      mine: cardsView(mineName, mine), theirs: cardsView(theirName, theirs),
      myOk, theirOk
    }
  };
}
function pushTrade(tr) {
  pushUser(tr.a, tradeView(tr, tr.a));
  pushUser(tr.b, tradeView(tr, tr.b));
}
function tradeOf(user) {
  for (const tr of trades.values()) if (tr.a === user || tr.b === user) return tr;
  return null;
}
function releaseLocks(tr) {
  for (const iid of [...tr.oa, ...tr.ob]) if (tradeLocks.get(iid) === tr.id) tradeLocks.delete(iid);
}
function cancelTrade(tr, reason) {
  releaseLocks(tr);
  trades.delete(tr.id);
  pushUser(tr.a, { t: 'trade', trade: null });
  pushUser(tr.b, { t: 'trade', trade: null });
  if (reason) {
    pushUser(tr.a, { t: 'toast', kind: 'err', msg: reason });
    pushUser(tr.b, { t: 'toast', kind: 'err', msg: reason });
  }
}

function openTrade(me, target) {
  if (!db.users[target]) return { err: 'Player not found' };
  if (!db.users[me].friends.includes(target)) return { err: 'You can only trade with friends' };
  if (!isOnline(target)) return { err: target + ' is offline' };
  if (tradeOf(me) || tradeOf(target)) return { err: 'A player is already in a trade' };
  const tr = { id: newId('t', 'tradeSeq'), a: me, b: target, oa: [], ob: [], okA: false, okB: false };
  trades.set(tr.id, tr);
  pushTrade(tr);
  pushUser(target, { t: 'toast', kind: 'trade', msg: me + ' started a trade with you' });
  return {};
}

function tradeUpdate(me, offer) {
  const tr = tradeOf(me);
  if (!tr) return { err: 'No active trade' };
  if (!Array.isArray(offer) || offer.length > 12) return { err: 'Bad offer' };
  const u = db.users[me];
  const side = me === tr.a ? 'oa' : 'ob';
  const old = tr[side];

  for (const iid of offer) {
    if (!ownCard(me, iid)) return { err: 'You do not own that card' };
    const lockedBy = tradeLocks.get(iid);
    if (lockedBy && lockedBy !== tr.id) return { err: 'A card is locked in another trade' };
  }
  if (new Set(offer).size !== offer.length) return { err: 'Duplicate cards in offer' };

  for (const iid of old) if (tradeLocks.get(iid) === tr.id) tradeLocks.delete(iid);
  tr[side] = offer.slice();
  for (const iid of offer) tradeLocks.set(iid, tr.id);
  tr.okA = false; tr.okB = false;
  pushTrade(tr);
  return {};
}

function tradeAccept(me) {
  const tr = tradeOf(me);
  if (!tr) return { err: 'No active trade' };
  if (me === tr.a) tr.okA = true; else tr.okB = true;

  if (tr.okA && tr.okB) {
    if (tr.oa.length === 0 || tr.ob.length === 0) {
      tr.okA = tr.okB = false;
      pushTrade(tr);
      return { err: 'Both players must offer at least one card' };
    }
    /* final validation */
    const ua = db.users[tr.a], ub = db.users[tr.b];
    const aCards = tr.oa.map(iid => ownCard(tr.a, iid));
    const bCards = tr.ob.map(iid => ownCard(tr.b, iid));
    if (aCards.some(c => !c) || bCards.some(c => !c)) {
      cancelTrade(tr, 'Trade failed: a card is no longer available');
      return {};
    }
    ua.cards = ua.cards.filter(c => !tr.oa.includes(c.iid));
    ub.cards = ub.cards.filter(c => !tr.ob.includes(c.iid));
    ua.cards.push(...bCards);
    ub.cards.push(...aCards);
    releaseLocks(tr);
    trades.delete(tr.id);
    save();
    pushUser(tr.a, { t: 'trade', trade: null });
    pushUser(tr.b, { t: 'trade', trade: null });
    pushUser(tr.a, { t: 'toast', kind: 'win', msg: '🤝 Trade complete with ' + tr.b + '!' });
    pushUser(tr.b, { t: 'toast', kind: 'win', msg: '🤝 Trade complete with ' + tr.a + '!' });
    sendState(tr.a);
    sendState(tr.b);
    return {};
  }
  pushTrade(tr);
  return {};
}

/* ================= websocket ================= */
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function meta() {
  return {
    t: 'meta',
    TYPE_INFO: D.TYPE_INFO, CHART: D.CHART, MOVES: D.MOVES,
    CREATURES: D.CREATURES, CREATURE_LIST: D.CREATURE_LIST,
    TIER_HP: D.TIER_HP, TIER_NAME: D.TIER_NAME, TIER_ORDER: D.TIER_ORDER,
    PACK_ODDS: D.PACK_ODDS, PACK_SIZES: D.PACK_SIZES, PACK_PRICE: D.PACK_PRICE,
    REWARD: D.REWARD, DODGE_CHANCE: D.DODGE_CHANCE, GUARD_REDUCE: D.GUARD_REDUCE
  };
}

function afterAuth(ws, name, token) {
  ws.__user = name;
  if (!live.has(name)) live.set(name, new Set());
  live.get(name).add(ws);

  const timer = disconnectTimers.get(name);
  if (timer) { clearTimeout(timer); disconnectTimers.delete(name); }

  send(ws, { t: 'authRes', ok: true, token: token || undefined });
  send(ws, meta());
  sendState(name);
  send(ws, { t: 'rooms', list: roomList() });

  /* presence to friends */
  const u = db.users[name];
  for (const f of u.friends) pushUser(f, { t: 'presence', u: name, online: true });

  /* rejoin room if still in one */
  const rid = roomOf.get(name);
  if (rid && rooms.has(rid)) send(ws, roomView(rooms.get(rid), name));

  /* active trade re-sync */
  const tr = tradeOf(name);
  if (tr) send(ws, tradeView(tr, name));
}

function handleDisconnect(ws) {
  const name = ws.__user;
  if (!name) return;
  const set = live.get(name);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      live.delete(name);
      const u = db.users[name];
      if (u) for (const f of u.friends) pushUser(f, { t: 'presence', u: name, online: false });

      /* grace period for battles, immediate cleanup otherwise */
      const rid = roomOf.get(name);
      const room = rid && rooms.get(rid);
      if (room && room.status === 'battle' && room.battle && !room.battle.over) {
        const p = room.battle.players.find(x => x.name === name);
        if (p) { p.disconnected = true; room.battle.log.push({ k: 'sys', msg: name + ' disconnected — waiting 60s…' }); bcastRoom(room); }
        const timer = setTimeout(() => {
          disconnectTimers.delete(name);
          if (isOnline(name)) return;
          const r = rooms.get(room.id);
          if (!r || !r.battle || r.battle.over) return;
          const idx = r.battle.players.findIndex(x => x.name === name);
          if (idx >= 0) finishBattle(r, 1 - idx, 'forfeit');
        }, 60000);
        disconnectTimers.set(name, timer);
      } else if (room) {
        leaveRoom(name);
      }
      /* cancel trades the user is part of */
      const tr = tradeOf(name);
      if (tr) cancelTrade(tr, 'Trade cancelled: ' + name + ' disconnected');
    }
  }
}

wss.on('connection', ws => {
  ws.__alive = true;
  ws.on('pong', () => { ws.__alive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return send(ws, { t: 'err', msg: 'Bad message' }); }
    if (!m || typeof m.t !== 'string') return;
    try { route(ws, m); }
    catch (e) { console.error('handler error', m.t, e); send(ws, { t: 'err', msg: 'Server error' }); }
  });

  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => {});
});

function needAuth(ws) {
  if (!ws.__user) { send(ws, { t: 'err', msg: 'Not logged in' }); return false; }
  if (!db.users[ws.__user]) { send(ws, { t: 'err', msg: 'Account missing' }); return false; }
  return true;
}

function route(ws, m) {
  switch (m.t) {
    /* ---------- auth ---------- */
    case 'register': {
      const u = String(m.u || '').toLowerCase().trim();
      const p = m.p;
      if (!validUser(u)) return send(ws, { t: 'authRes', ok: false, msg: 'Username: 3-16 chars, a-z 0-9 _' });
      if (!validPass(p)) return send(ws, { t: 'authRes', ok: false, msg: 'Password: 4-64 chars' });
      if (db.users[u]) return send(ws, { t: 'authRes', ok: false, msg: 'Username taken' });
      const salt = crypto.randomBytes(8).toString('hex');
      db.users[u] = {
        name: u, salt, hash: hashPass(p, salt), coins: 0,
        cards: [], starterTaken: false,
        friends: [], incoming: [], outgoing: [],
        created: Date.now()
      };
      save();
      const token = crypto.randomBytes(18).toString('hex');
      sessions[token] = u;
      afterAuth(ws, u, token);
      return;
    }
    case 'login': {
      const u = String(m.u || '').toLowerCase().trim();
      const acc = db.users[u];
      if (!acc || acc.hash !== hashPass(m.p || '', acc.salt))
        return send(ws, { t: 'authRes', ok: false, msg: 'Wrong username or password' });
      const token = crypto.randomBytes(18).toString('hex');
      sessions[token] = u;
      afterAuth(ws, u, token);
      return;
    }
    case 'auth': {
      const u = sessions[m.token];
      if (!u || !db.users[u]) return send(ws, { t: 'authRes', ok: false, msg: 'Session expired' });
      afterAuth(ws, u);
      return;
    }

    /* ---------- core ---------- */
    case 'state': if (needAuth(ws)) sendState(ws.__user); return;
    case 'openPack': {
      if (!needAuth(ws)) return;
      const res = openPack(ws.__user, m.kind);
      if (res.err) return send(ws, { t: 'err', msg: res.err });
      send(ws, { t: 'pack', kind: m.kind, cards: res.cards });
      sendState(ws.__user);
      return;
    }

    /* ---------- friends ---------- */
    case 'search': if (needAuth(ws)) send(ws, { t: 'searchRes', q: m.q, users: searchUsers(ws.__user, m.q) }); return;
    case 'friendReq': if (needAuth(ws)) return errOr(ws, friendReq(ws.__user, String(m.u || '').toLowerCase()), ws.__user);
    case 'friendAccept': if (needAuth(ws)) return errOr(ws, friendAccept(ws.__user, String(m.u || '').toLowerCase()), ws.__user);
    case 'friendDecline': if (needAuth(ws)) return errOr(ws, friendDecline(ws.__user, String(m.u || '').toLowerCase()), ws.__user);

    /* ---------- rooms ---------- */
    case 'roomList': if (needAuth(ws)) send(ws, { t: 'rooms', list: roomList() }); return;
    case 'roomGet': {
      if (!needAuth(ws)) return;
      const rid = roomOf.get(ws.__user);
      const room = rid && rooms.get(rid);
      if (!room) return send(ws, { t: 'err', msg: 'You are not in a room' });
      send(ws, roomView(room, ws.__user));
      return;
    }
    case 'roomCreate': {
      if (!needAuth(ws)) return;
      if (roomOf.has(ws.__user)) return send(ws, { t: 'err', msg: 'You are already in a room' });
      const mode = MODES.includes(Number(m.mode)) ? Number(m.mode) : 1;
      const me = db.users[ws.__user];
      if (me.cards.length < mode)
        return send(ws, { t: 'err', msg: 'You need at least ' + mode + ' cards for ' + mode + 'v' + mode + ' (you have ' + me.cards.length + ')' });
      const room = createRoom(m.name, ws, mode);
      if (m.bot) {
        /* bot match: opponent is picked immediately, human chooses alone */
        room.bot = true;
        room.guest = BOT_NAME;
        room.status = 'picking';
        room.botTeam = pickBotTeam(mode);
        room.picks.guest = room.botTeam.slice();
        broadcastRooms();
      }
      send(ws, roomView(room, ws.__user));
      return;
    }
    case 'roomJoin': {
      if (!needAuth(ws)) return;
      if (roomOf.has(ws.__user)) return send(ws, { t: 'err', msg: 'You are already in a room' });
      const room = rooms.get(m.id);
      if (!room) return send(ws, { t: 'err', msg: 'Room not found' });
      if (room.guest || room.status !== 'waiting') return send(ws, { t: 'err', msg: 'Room is full or in progress' });
      if (db.users[ws.__user].cards.length < (room.mode || 1))
        return send(ws, { t: 'err', msg: 'You need at least ' + room.mode + ' cards for ' + room.mode + 'v' + room.mode });
      joinRoom(ws.__user, room, 'guest');
      room.status = 'picking';
      broadcastRooms();
      bcastRoom(room);
      return;
    }
    case 'roomWatch': {
      if (!needAuth(ws)) return;
      if (roomOf.has(ws.__user)) return send(ws, { t: 'err', msg: 'You are already in a room' });
      const room = rooms.get(m.id);
      if (!room) return send(ws, { t: 'err', msg: 'Room not found' });
      watchRoom(ws.__user, room);
      send(ws, roomView(room, ws.__user));
      bcastRoom(room);
      return;
    }
    case 'roomLeave': if (needAuth(ws)) { leaveRoom(ws.__user); broadcastRooms(); } return;

    case 'pick': {
      if (!needAuth(ws)) return;
      const room = rooms.get(roomOf.get(ws.__user) || '');
      if (!room) return send(ws, { t: 'err', msg: 'Not in a room' });
      if (room.host !== ws.__user && room.guest !== ws.__user) return send(ws, { t: 'err', msg: 'Spectators cannot pick' });
      if (room.status !== 'waiting' && room.status !== 'picking') return send(ws, { t: 'err', msg: 'Battle already started' });
      if (room.bot && room.host !== ws.__user) return send(ws, { t: 'err', msg: 'Bot picks for itself' });

      const mode = room.mode || 1;
      const arr = Array.isArray(m.iids) ? m.iids : [];
      if (arr.length > mode) return send(ws, { t: 'err', msg: 'Pick at most ' + mode + ' creatures' });
      if (new Set(arr).size !== arr.length) return send(ws, { t: 'err', msg: 'Duplicate picks' });
      for (const iid of arr) {
        if (!ownCard(ws.__user, iid)) return send(ws, { t: 'err', msg: 'You do not own that card' });
      }

      const side = room.host === ws.__user ? 'host' : 'guest';
      room.picks[side] = arr.slice();

      const hostReady = room.picks.host.length === mode;
      const guestReady = (room.picks.guest || []).length === mode;
      if (hostReady && guestReady) {
        if (!startBattle(room)) {
          room.picks = { host: [], guest: room.bot ? room.picks.guest : [] };
          send(ws, { t: 'err', msg: 'A chosen card is no longer available' });
          bcastRoom(room);
        }
      } else {
        if (room.status === 'waiting') room.status = 'picking';
        bcastRoom(room);
      }
      return;
    }

    case 'ability': {
      if (!needAuth(ws)) return;
      const room = rooms.get(roomOf.get(ws.__user) || '');
      if (!room) return send(ws, { t: 'err', msg: 'Not in a room' });
      const res = useAbility(room, ws.__user, m.key);
      if (res.err) {
        console.log('[ability REJECTED]', ws.__user, m.key, '→', res.err,
          room.battle ? 'turn=' + room.battle.turn + ' over=' + room.battle.over : 'no-battle');
        send(ws, { t: 'err', msg: res.err });
      }
      return;
    }
    case 'surrender': {
      if (!needAuth(ws)) return;
      const room = rooms.get(roomOf.get(ws.__user) || '');
      if (!room) return send(ws, { t: 'err', msg: 'Not in a room' });
      const res = surrender(room, ws.__user);
      if (res.err) send(ws, { t: 'err', msg: res.err });
      return;
    }
    case 'chat': {
      if (!needAuth(ws)) return;
      const room = rooms.get(roomOf.get(ws.__user) || '');
      if (!room) return;
      const text = String(m.m || '').slice(0, 160).trim();
      if (!text) return;
      room.chat.push({ u: ws.__user, m: text, ts: Date.now() });
      if (room.chat.length > 60) room.chat = room.chat.slice(-60);
      bcastRoom(room);
      return;
    }

    /* ---------- trades ---------- */
    case 'tradeOpen': if (needAuth(ws)) return errOr(ws, openTrade(ws.__user, String(m.u || '').toLowerCase()), ws.__user);
    case 'tradeUpdate': if (needAuth(ws)) return errOr(ws, tradeUpdate(ws.__user, m.offer), ws.__user);
    case 'tradeAccept': if (needAuth(ws)) return errOr(ws, tradeAccept(ws.__user), ws.__user);
    case 'tradeCancel': {
      if (!needAuth(ws)) return;
      const tr = tradeOf(ws.__user);
      if (tr) cancelTrade(tr, 'Trade cancelled by ' + ws.__user);
      return;
    }

    default: send(ws, { t: 'err', msg: 'Unknown message' });
  }
}

function errOr(ws, res, me) {
  if (res && res.err) send(ws, { t: 'err', msg: res.err });
  else if (me) sendState(me);
}

/* heartbeat: drop dead sockets */
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.__alive === false) { ws.terminate(); continue; }
    ws.__alive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Pocket Arena running on port ' + PORT);
});
