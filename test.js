'use strict';
/* End-to-end test: auth, packs, friends, rooms (1v1/3v3/5v5), bot matches,
   spectating, team battles, rewards, chat, trades */
const WebSocket = require('ws');
const URL = 'ws://localhost:3000';

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ✓ ' + label);
  else { failures++; console.error('  ✗ FAIL: ' + label); }
}

class P {
  constructor(name) {
    this.name = name;
    this.history = [];
    this.waiters = [];
    this.meta = null;
    this.state = null;
    this.room = null;
    this.ws = null;
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', d => {
        const m = JSON.parse(d.toString());
        if (m.t === 'meta') this.meta = m;
        if (m.t === 'state') this.state = m;
        if (m.t === 'room') this.room = m.room;
        for (let i = 0; i < this.waiters.length; i++) {
          const w = this.waiters[i];
          try { if (w.pred(m)) { this.waiters.splice(i, 1); clearTimeout(w.to); w.res(m); return; } } catch (e) {}
        }
        this.history.push(m);
        if (this.history.length > 500) this.history.shift();
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  flush() { this.history = []; }
  wait(pred, ms = 8000) {
    for (let i = 0; i < this.history.length; i++) {
      const m = this.history[i];
      let hit = false;
      try { hit = pred(m); } catch (e) {}
      if (hit) { this.history.splice(i, 1); return Promise.resolve(m); }
    }
    return new Promise((res, rej) => {
      const to = setTimeout(() => {
        const idx = this.waiters.findIndex(w => w.res === res);
        if (idx >= 0) this.waiters.splice(idx, 1);
        rej(new Error(this.name + ': timeout waiting for message'));
      }, ms);
      this.waiters.push({ pred, res, to });
    });
  }
  async register(pass) {
    this.send({ t: 'register', u: this.name, p: pass });
    const r = await this.wait(m => m.t === 'authRes');
    if (!r.ok) throw new Error(this.name + ': register failed: ' + r.msg);
    await this.wait(m => m.t === 'meta');
    await this.wait(m => m.t === 'state');
    return r;
  }
  async openPack(kind) {
    const before = this.state.cards.length;
    this.send({ t: 'openPack', kind });
    const p = await this.wait(m => m.t === 'pack');
    await this.wait(m => m.t === 'state' && m.cards.length === before + p.cards.length);
    return p;
  }
  async createRoom(opts) {
    this.send(Object.assign({ t: 'roomCreate' }, opts));
    return this.wait(m => m.t === 'room');
  }
  async pickAll(room, iids) {
    this.send({ t: 'pick', iids });
    return this.wait(m => m.t === 'room' && m.room.id === room.id &&
      ((m.room.picks.host || []).length >= 0));
  }
}

function chooseKey(view, bp) {
  const member = bp.team[bp.active];
  const cr = view.meta.CREATURES[member.cr];
  const usable = cr.abilities.filter(k => (member.cd[k] || 0) === 0);
  return (
    usable.find(k => view.meta.MOVES[k].kind === 'special') ||
    usable.find(k => view.meta.MOVES[k].kind === 'mid' && view.meta.MOVES[k].power > 0) ||
    usable.find(k => view.meta.MOVES[k].kind === 'basic') ||
    usable[0]
  );
}

/* play a full battle to completion (PvP: both humans; bot: A alone) */
async function playBattleToEnd(A, B, logLabel) {
  const botMode = !!(A.room && A.room.bot);
  const waitFresh = (p, after) =>
    p.wait(m => m.t === 'room' && m.room.battle && (m.room.battle.over || m.room.battle.log.length > after), 15000);
  let rounds = 0;
  let actor = A;
  while (true) {
    const room = actor.room;
    if (!room || !room.battle || room.battle.over) break;
    rounds++;
    if (rounds > 800) throw new Error('battle never ended (' + logLabel + ')');
    const myIdx = botMode ? 0 : (actor === A ? 0 : 1);
    if (room.battle.turn !== myIdx) {
      await waitFresh(actor, room.battle.log.length);
      continue;
    }
    const key = chooseKey(actor, room.battle.players[myIdx]);
    if (!key) throw new Error('no usable ability');
    actor.send({ t: 'ability', key });
    if (botMode) {
      await waitFresh(A, room.battle.log.length);
    } else {
      const other = actor === A ? B : A;
      await waitFresh(other, room.battle.log.length);
      actor = other;
    }
  }
  if (!(A.room && A.room.battle && A.room.battle.over)) {
    await A.wait(m => m.t === 'room' && m.room.battle && m.room.battle.over, 15000);
  }
  return { final: A.room, rounds };
}

/* fetch a guaranteed-fresh state snapshot */
async function freshState(p) {
  p.flush();
  p.send({ t: 'state' });
  return p.wait(m => m.t === 'state');
}

(async () => {
  console.log('— connect & register —');
  const PFX = 'z' + (Date.now() % 1000000);
  const A = new P(PFX + 'alice'), B = new P(PFX + 'bob'), C = new P(PFX + 'carol');
  await A.connect(); await B.connect(); await C.connect();
  await A.register('pass1234');
  await B.register('pass1234');
  await C.register('pass1234');
  ok(true, 'three players registered (' + PFX + '…)');

  /* username uniqueness */
  const dup = new P(PFX + 'alice');
  await dup.connect();
  dup.send({ t: 'register', u: A.name, p: 'whatever1' });
  const dupRes = await dup.wait(m => m.t === 'authRes');
  ok(!dupRes.ok && /taken/i.test(dupRes.msg), 'duplicate username rejected: ' + dupRes.msg);
  dup.ws.close();

  console.log('— packs —');
  const pa = await A.openPack('starter');
  ok(pa.cards.length === 7, 'starter pack has 7 cards');
  A.send({ t: 'openPack', kind: 'starter' });
  const dupErr = await A.wait(m => m.t === 'err');
  ok(/already/i.test(dupErr.msg), 'starter cannot be claimed twice');
  await B.openPack('starter');
  await C.openPack('starter');
  ok(B.state.cards.length === 7 && C.state.cards.length === 7, 'bob & carol opened starters');

  console.log('— shop error path (broke) —');
  A.send({ t: 'openPack', kind: 'shop' });
  const broke = await A.wait(m => m.t === 'err');
  ok(/coins/i.test(broke.msg), 'shop blocks purchase without coins');

  console.log('— friends —');
  A.send({ t: 'search', q: B.name });
  const sr = await A.wait(m => m.t === 'searchRes' && m.users.some(u => u.name === B.name));
  ok(sr.users.some(u => u.name === B.name), 'search finds bob');
  A.send({ t: 'friendReq', u: B.name });
  await A.wait(m => m.t === 'state' && m.outgoing.includes(B.name));
  B.send({ t: 'friendAccept', u: A.name });
  await B.wait(m => m.t === 'state' && m.friends.some(f => f.name === A.name));
  await A.wait(m => m.t === 'state' && m.friends.some(f => f.name === B.name));
  ok(true, 'friend request accepted');

  /* ================= human 1v1 ================= */
  console.log('— human 1v1 room & spectating —');
  const rmA = await A.createRoom({ name: 'Alpha Arena', mode: 1 });
  ok(rmA.room.host === A.name && rmA.room.mode === 1 && rmA.room.status === 'waiting', '1v1 room created');
  B.send({ t: 'roomJoin', id: rmA.room.id });
  const rmB = await B.wait(m => m.t === 'room' && m.room.guest === B.name);
  ok(rmB.room.status === 'picking', 'bob joined → picking');
  C.send({ t: 'roomWatch', id: rmA.room.id });
  await C.wait(m => m.t === 'room' && m.room.you === 'watcher');
  ok(true, 'carol spectating');

  A.send({ t: 'pick', iids: [A.state.cards[0].iid] });
  await A.wait(m => m.t === 'room' && m.room.id === rmA.room.id && (m.room.picks.host || []).length === 1);
  ok(true, 'host picked 1/1');
  B.send({ t: 'pick', iids: [B.state.cards[0].iid] });
  const started = await A.wait(m => m.t === 'room' && m.room.status === 'battle');
  ok(!!started.room.battle && started.room.battle.players.length === 2, '1v1 battle started');
  ok(started.room.battle.players.every(p => p.team.length === 1), 'each side has 1 creature');

  const { final, rounds } = await playBattleToEnd(A, B, 'human 1v1');
  ok(final.battle.over, '1v1 ended after ' + rounds + ' actions');
  const w1 = final.battle.winner;
  const stA1 = await A.wait(m => m.t === 'state' && m.user.coins > 0);
  const stB1 = await B.wait(m => m.t === 'state' && m.user.coins > 0);
  ok(w1 === 0 ? (stA1.user.coins === 10 && stB1.user.coins === 5) : (stA1.user.coins === 5 && stB1.user.coins === 10),
    `pvp rewards: alice=${stA1.user.coins} bob=${stB1.user.coins} (10/5)`);

  console.log('— chat —');
  A.send({ t: 'chat', m: 'gg wp' });
  await C.wait(m => m.t === 'room' && m.room.chat.some(c => c.m === 'gg wp'));
  ok(true, 'spectator receives chat');

  A.send({ t: 'roomLeave' });
  await A.wait(m => m.t === 'roomClosed');
  B.send({ t: 'roomLeave' });
  await B.wait(m => m.t === 'roomClosed').catch(() => null);
  C.send({ t: 'roomLeave' });
  ok(true, 'room closed');

  /* ================= human 3v3 ================= */
  console.log('— human 3v3 —');
  A.flush(); B.flush(); C.flush();
  const rm3 = await A.createRoom({ name: 'Trio Fight', mode: 3 });
  ok(rm3.room.mode === 3, '3v3 room created');
  B.send({ t: 'roomJoin', id: rm3.room.id });
  await B.wait(m => m.t === 'room' && m.room.status === 'picking');
  const iidsA3 = A.state.cards.slice(0, 3).map(c => c.iid);
  const iidsB3 = B.state.cards.slice(0, 3).map(c => c.iid);
  A.send({ t: 'pick', iids: iidsA3 });
  await A.wait(m => m.t === 'room' && m.room.id === rm3.room.id && (m.room.picks.host || []).length === 3);
  ok(true, 'host picked 3/3');
  B.send({ t: 'pick', iids: iidsB3 });
  const started3 = await A.wait(m => m.t === 'room' && m.room.status === 'battle');
  ok(started3.room.battle.players.every(p => p.team.length === 3), 'both teams have 3 creatures');
  ok(started3.room.battle.players[0].team.every(m => iidsA3.includes(m.iid)), 'team members match picks');
  /* surrender →10/5 */
  const coinsBeforeSurr = A.state.user.coins;
  A.send({ t: 'surrender' });
  const over3 = await A.wait(m => m.t === 'room' && m.room.battle && m.room.battle.over);
  ok(over3.room.battle.winner === 1, 'surrender → opponent wins');
  const stA3 = await A.wait(m => m.t === 'state' && m.user.coins === coinsBeforeSurr + 5);
  ok(stA3.user.coins === coinsBeforeSurr + 5, 'loser got +5 in pvp 3v3');
  A.send({ t: 'roomLeave' }); B.send({ t: 'roomLeave' });
  await A.wait(m => m.t === 'roomClosed').catch(() => null);

  /* ================= bot 1v1 (0 coins) ================= */
  console.log('— bot 1v1 (practice, 0 coins) —');
  A.flush();
  const coinsPreBot1 = A.state.user.coins;
  const rmB1 = await A.createRoom({ name: 'Bot Practice', mode: 1, bot: true });
  ok(rmB1.room.bot === true && rmB1.room.guest === '🤖 Bot' && rmB1.room.status === 'picking', 'bot room created, bot ready');
  ok((rmB1.room.picks.guest || []).length === 1, 'bot pre-picked its team');
  A.send({ t: 'pick', iids: [A.state.cards[1].iid] });
  const botStart1 = await A.wait(m => m.t === 'room' && m.room.status === 'battle');
  ok(botStart1.room.battle.players[1].isBot === true, 'battle vs bot started');
  const botRes1 = await playBattleToEnd(A, null, 'bot 1v1');
  ok(botRes1.final.battle.over, 'bot 1v1 finished after ' + botRes1.rounds + ' actions');
  const fs1 = await freshState(A);
  ok(fs1.user.coins === coinsPreBot1, `bot 1v1 paid 0 coins (${coinsPreBot1} → ${fs1.user.coins})`);
  A.send({ t: 'roomLeave' });
  await A.wait(m => m.t === 'roomClosed').catch(() => null);

  /* ================= bot 3v3 (5 coins on win) ================= */
  console.log('— bot 3v3 (5 coins on win) —');
  A.flush();
  const coinsPreBot3 = A.state.user.coins;
  const rmB3 = await A.createRoom({ name: 'Bot Trio', mode: 3, bot: true });
  ok(rmB3.room.mode === 3 && rmB3.room.bot, 'bot 3v3 room created');
  ok((rmB3.room.picks.guest || []).length === 3, 'bot picked 3 creatures');
  const botTeam3 = rmB3.room.picks.guest; /* creature ids */
  const tiers3 = botTeam3.map(id => A.meta.CREATURES[id].tier);
  ok(tiers3.filter(t => t === 'L').length <= 1 && tiers3.filter(t => t === 'M').length <= 1,
    'bot team never stacks best tiers: [' + tiers3.join(',') + ']');
  const iidsA5 = A.state.cards.slice(0, 3).map(c => c.iid);
  A.send({ t: 'pick', iids: iidsA5 });
  const botStart3 = await A.wait(m => m.t === 'room' && m.room.status === 'battle');
  ok(botStart3.room.battle.players[0].team.length === 3 && botStart3.room.battle.players[1].team.length === 3, 'both teams of 3');
  const botRes3 = await playBattleToEnd(A, null, 'bot 3v3');
  ok(botRes3.final.battle.over, 'bot 3v3 finished after ' + botRes3.rounds + ' actions');
  const humanWon3 = botRes3.final.battle.winner === 0;
  const fs3 = await freshState(A);
  const expect3 = coinsPreBot3 + (humanWon3 ? 5 : 0);
  ok(fs3.user.coins === expect3,
    `bot 3v3: human ${humanWon3 ? 'won → +5' : 'lost → +0'} (${coinsPreBot3} → ${fs3.user.coins})`);
  A.send({ t: 'roomLeave' });
  await A.wait(m => m.t === 'roomClosed').catch(() => null);

  /* ================= bot 5v5 ================= */
  console.log('— bot 5v5 —');
  A.flush();
  const coinsPreBot5 = A.state.user.coins;
  const rmB5 = await A.createRoom({ name: 'Bot Five', mode: 5, bot: true });
  ok(rmB5.room.mode === 5 && (rmB5.room.picks.guest || []).length === 5, 'bot 5v5 room, bot picked 5');
  const iidsA5v5 = A.state.cards.slice(0, 5).map(c => c.iid);
  A.send({ t: 'pick', iids: iidsA5v5 });
  const botStart5 = await A.wait(m => m.t === 'room' && m.room.status === 'battle');
  ok(botStart5.room.battle.players.every(p => p.team.length === 5), 'both teams of 5');
  A.send({ t: 'surrender' });
  await A.wait(m => m.t === 'room' && m.room.battle && m.room.battle.over);
  const fs5 = await freshState(A);
  ok(fs5.user.coins === coinsPreBot5, `surrendering to bot pays 0 (${coinsPreBot5} → ${fs5.user.coins})`);
  A.send({ t: 'roomLeave' });
  await A.wait(m => m.t === 'roomClosed').catch(() => null);

  /* ================= trade ================= */
  console.log('— trade —');
  A.flush(); B.flush();
  A.send({ t: 'tradeOpen', u: B.name });
  await A.wait(m => m.t === 'trade');
  const trB = await B.wait(m => m.t === 'trade');
  ok(trB.trade.partner === A.name, 'trade opened between friends');
  const aGive = A.state.cards[0].iid, bGive = B.state.cards[0].iid;
  A.send({ t: 'tradeUpdate', offer: [aGive] });
  await A.wait(m => m.t === 'trade' && m.trade.mine.length === 1);
  B.send({ t: 'tradeUpdate', offer: [bGive] });
  await B.wait(m => m.t === 'trade' && m.trade.mine.length === 1);
  A.send({ t: 'tradeAccept' });
  await A.wait(m => m.t === 'trade' && m.trade.myOk);
  B.send({ t: 'tradeAccept' });
  await A.wait(m => m.t === 'trade' && m.trade === null);
  const stA2 = await A.wait(m => m.t === 'state' && !m.cards.some(c => c.iid === aGive));
  ok(!stA2.cards.some(c => c.iid === aGive) && stA2.cards.some(c => c.iid === bGive), 'alice received bob\'s card');

  console.log('— trading with a non-friend is blocked —');
  C.send({ t: 'tradeOpen', u: A.name });
  const noTr = await C.wait(m => m.t === 'err');
  ok(/friend/i.test(noTr.msg), 'non-friend trade blocked');

  console.log('\n' + (failures === 0 ? '✅ ALL TESTS PASSED' : '❌ ' + failures + ' FAILURES'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(2); });
