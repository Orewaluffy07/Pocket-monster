'use strict';
/* Shop purchase flow: run phase1 first, patch coins, restart, run phase2 */
const WebSocket = require('ws');
const URL = 'ws://localhost:3000';
const phase = process.argv[2] || '1';

function client() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    const p = { ws, history: [], waiters: [], state: null, meta: null };
    ws.on('open', () => res(p));
    ws.on('error', rej);
    ws.on('message', d => {
      const m = JSON.parse(d.toString());
      if (m.t === 'state') p.state = m;
      if (m.t === 'meta') p.meta = m;
      for (let i = 0; i < p.waiters.length; i++) {
        const w = p.waiters[i];
        try { if (w.pred(m)) { p.waiters.splice(i, 1); clearTimeout(w.to); w.res(m); return; } } catch (e) {}
      }
      p.history.push(m);
    });
  });
}
const send = (p, o) => p.ws.send(JSON.stringify(o));
function wait(p, pred, ms = 5000) {
  for (let i = 0; i < p.history.length; i++) {
    try { if (pred(p.history[i])) return Promise.resolve(p.history.splice(i, 1)[0]); } catch (e) {}
  }
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('timeout')), ms);
    p.waiters.push({ pred, res: m => { clearTimeout(to); res(m); }, to });
  });
}

(async () => {
  const p = await client();
  if (phase === '1') {
    send(p, { t: 'register', u: 'shopper99', p: 'pass1234' });
    const r = await wait(p, m => m.t === 'authRes');
    if (!r.ok) { console.log('register:', r.msg); process.exit(1); }
    await wait(p, m => m.t === 'state');
    send(p, { t: 'openPack', kind: 'starter' });
    await wait(p, m => m.t === 'pack');
    console.log('PHASE1 OK — shopper99 created with starter pack, coins=', p.state.user.coins);
  } else {
    send(p, { t: 'login', u: 'shopper99', p: 'pass1234' });
    const r = await wait(p, m => m.t === 'authRes');
    if (!r.ok) { console.log('login failed:', r.msg); process.exit(1); }
    await wait(p, m => m.t === 'state');
    console.log('coins before buy:', p.state.user.coins, 'cards:', p.state.cards.length);
    send(p, { t: 'openPack', kind: 'shop' });
    const pk = await wait(p, m => m.t === 'pack');
    await wait(p, m => m.t === 'state' && m.user.coins === 50);
    const ok1 = pk.cards.length === 8;
    const ok2 = p.state.user.coins === 50;
    const ok3 = p.state.cards.length === 15;
    console.log(ok1 ? '✓' : '✗', 'pack has 8 cards:', pk.cards.length);
    console.log(ok2 ? '✓' : '✗', 'coins 300 → 50:', p.state.user.coins);
    console.log(ok3 ? '✓' : '✗', 'collection 7 → 15:', p.state.cards.length);
    /* rarity sanity: roll 400 cards via... just verify pack odds message shape */
    if (ok1 && ok2 && ok3) { console.log('SHOP TEST PASSED'); process.exit(0); }
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
