'use strict';
/* Browser UI smoke test: register → pack → collection → room → battle */
const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'http://localhost:3000';
const SHOTS = __dirname + '/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const PFX = 'u' + (Date.now() % 1000000);
let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ✓ ' + label);
  else { failures++; console.error('  ✗ FAIL: ' + label); }
}

(async () => {
  const browser = await chromium.launch();
  const errors1 = [], errors2 = [];

  /* ---------- player 1 ---------- */
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p1 = await ctx1.newPage();
  p1.on('pageerror', e => { errors1.push(String(e)); console.log('P1 PAGEERROR:', e); });
  p1.on('console', m => { if (m.type() === 'error') { errors1.push(m.text()); console.log('P1 CONSOLE:', m.text()); } });

  await p1.goto(URL);
  await p1.waitForSelector('#screen-auth');
  console.log('— auth screen —');
  await p1.screenshot({ path: SHOTS + '/01-auth.png' });

  await p1.click('#tab-register');
  await p1.fill('#auth-user', PFX + 'red');
  await p1.fill('#auth-pass', 'pass1234');
  await p1.click('#auth-go');
  await p1.waitForSelector('#screen-main', { timeout: 8000 });
  ok(true, 'player 1 registered and main screen shown');
  await p1.screenshot({ path: SHOTS + '/02-home.png' });

  /* starter pack */
  await p1.click('#nav button[data-view="shop"]');
  await p1.waitForSelector('#view-shop:not([hidden])');
  await p1.screenshot({ path: SHOTS + '/03-shop.png' });
  await p1.click('#btn-starter');
  await p1.waitForSelector('#pack-overlay:not([hidden])');
  await p1.click('#pack-flipall');
  await p1.waitForFunction(() => !document.getElementById('pack-done').disabled, null, { timeout: 8000 });
  await p1.screenshot({ path: SHOTS + '/04-pack.png' });
  await p1.click('#pack-done');
  ok(true, 'starter pack opened & collected');

  /* collection */
  await p1.click('#nav button[data-view="collection"]');
  await p1.waitForSelector('#collection .card');
  const cardCount = await p1.locator('#collection .card').count();
  ok(cardCount >= 5, 'collection shows cards (' + cardCount + ' species)');
  await p1.screenshot({ path: SHOTS + '/05-collection.png' });
  await p1.locator('#collection .card').first().click();
  await p1.waitForSelector('#card-modal:not([hidden])');
  const abilityCount = await p1.locator('#card-modal .ability').count();
  ok(abilityCount >= 2, 'card modal shows abilities (' + abilityCount + ')');
  await p1.screenshot({ path: SHOTS + '/06-card-modal.png' });
  await p1.click('#modal-close');

  /* create room */
  await p1.click('#nav button[data-view="battle"]');
  await p1.fill('#room-name', 'UI Test Arena');
  await p1.click('#btn-create-room');
  await p1.waitForSelector('#view-room:not([hidden])');
  await p1.waitForSelector('#pick-grid .mini');
  ok(true, 'room created, pick grid visible');
  await p1.screenshot({ path: SHOTS + '/07-room-waiting.png' });

  /* ---------- player 2 ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => { errors2.push(String(e)); console.log('P2 PAGEERROR:', e); });
  p2.on('console', m => { if (m.type() === 'error') { errors2.push(m.text()); console.log('P2 CONSOLE:', m.text()); } });

  await p2.goto(URL);
  await p2.click('#tab-register');
  await p2.fill('#auth-user', PFX + 'blue');
  await p2.fill('#auth-pass', 'pass1234');
  await p2.click('#auth-go');
  await p2.waitForSelector('#screen-main', { timeout: 8000 });

  /* open starter quickly so collection exists for picking */
  await p2.click('#nav button[data-view="shop"]');
  await p2.click('#btn-starter');
  await p2.waitForSelector('#pack-overlay:not([hidden])');
  await p2.click('#pack-flipall');
  await p2.waitForFunction(() => !document.getElementById('pack-done').disabled, null, { timeout: 8000 });
  await p2.click('#pack-done');

  /* join the room */
  await p2.click('#nav button[data-view="battle"]');
  await p2.waitForFunction(() => document.body.innerText.includes('UI Test Arena'), null, { timeout: 8000 });
  const badgeCount = await p2.locator('.mode-badge').count();
  ok(badgeCount > 0, 'room list shows mode badge');
  await p2.screenshot({ path: SHOTS + '/08-lobby-with-room.png' });
  await p2.locator('[data-join]').first().click();
  await p2.waitForSelector('#view-room:not([hidden])');
  await p2.waitForSelector('#pick-grid .mini');
  ok(true, 'player 2 joined the room');

  /* both pick */
  await p1.waitForSelector('#pick-status:has-text("Opponent joined")');
  await p1.screenshot({ path: SHOTS + '/09-both-in-room.png' });
  await p1.locator('#pick-grid .mini').first().click();
  await p1.waitForSelector('#pick-chosen:not([hidden])');
  await p2.locator('#pick-grid .mini').first().click();

  /* battle phase */
  await p1.waitForSelector('#phase-battle:not([hidden])', { timeout: 8000 });
  await p2.waitForSelector('#phase-battle:not([hidden])', { timeout: 8000 });
  const abtns = await p1.locator('#ability-bar .abtn').count();
  ok(abtns >= 2, 'ability buttons rendered (' + abtns + ')');
  const myName = (await p1.textContent('#me-name')).trim();
  ok(myName.length > 0 && myName.includes(PFX + 'red'), 'fighter name shows in arena: ' + myName.slice(0, 30));
  const topName = (await p1.textContent('#topbar-user')).trim();
  ok(topName === PFX + 'red', 'topbar username intact: ' + topName);
  const banner = await p1.textContent('#turn-banner');
  ok(/YOUR TURN|Waiting/i.test(banner), 'turn banner: ' + banner.trim());
  await p1.screenshot({ path: SHOTS + '/10-battle-p1.png' });
  await p2.screenshot({ path: SHOTS + '/11-battle-p2.png' });

  /* player 1 attacks */
  const logBefore = await p1.locator('#battle-log .log-line').count();
  await p1.locator('#ability-bar .abtn:not([disabled])').first().click();
  await p1.waitForFunction(n => document.querySelectorAll('#battle-log .log-line').length > n, logBefore, { timeout: 8000 });
  const logText = await p1.textContent('#battle-log');
  ok(/used/.test(logText), 'battle log shows an attack');
  await p1.screenshot({ path: SHOTS + '/12-battle-action.png' });

  /* chat */
  await p1.fill('#chat-input', 'good luck!');
  await p1.press('#chat-input', 'Enter');
  await p2.waitForFunction(() => document.getElementById('chat-log').innerText.includes('good luck!'), null, { timeout: 8000 });
  ok(true, 'chat delivered to player 2');

  /* spectator joins */
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errors2.push('spectator: ' + e));
  await p3.goto(URL);
  await p3.click('#tab-register');
  await p3.fill('#auth-user', PFX + 'watch');
  await p3.fill('#auth-pass', 'pass1234');
  await p3.click('#auth-go');
  await p3.waitForSelector('#screen-main', { timeout: 8000 });
  await p3.waitForFunction(() => document.body.innerText.includes('UI Test Arena'), null, { timeout: 8000 });
  await p3.locator('[data-watch]').first().click();
  await p3.waitForSelector('#phase-battle:not([hidden])', { timeout: 8000 });
  const spectText = await p3.textContent('#ability-bar');
  ok(/Spectator/i.test(spectText), 'spectator sees battle without controls');
  await p3.screenshot({ path: SHOTS + '/13-spectator.png' });

  /* friends page render */
  await p2.click('#nav button[data-view="friends"]');
  await p2.fill('#friend-search', PFX + 'red');
  await p2.click('#btn-friend-search');
  await p2.waitForSelector('#search-results .list-row');
  await p2.screenshot({ path: SHOTS + '/14-friends.png' });

  /* ---------- surrender the pvp battle, then fight the bot (3v3) ---------- */
  p1.on('dialog', d => d.accept());
  await p1.click('#btn-surrender');
  await p1.waitForSelector('#battle-end:not([hidden])', { timeout: 8000 });
  ok(true, 'surrender ends the battle with overlay');
  await p1.screenshot({ path: SHOTS + '/15-end-overlay.png' });
  await p1.click('#btn-end-lobby');
  await p1.waitForSelector('#view-battle:not([hidden])');

  const modeBtns = await p1.locator('#mode-pick button').count();
  ok(modeBtns === 3, 'mode picker has 1v1 / 3v3 / 5v5');
  await p1.click('#mode-pick button[data-mode="3"]');
  await p1.fill('#room-name', 'Bot Arena');
  await p1.click('#btn-fight-bot');
  await p1.waitForSelector('#view-room:not([hidden])');
  const botTitle = await p1.textContent('#room-title');
  ok(/3v3/.test(botTitle) && /Bot/.test(botTitle), 'bot room title: ' + botTitle.trim());
  await p1.waitForSelector('#pick-grid .mini');
  await p1.screenshot({ path: SHOTS + '/16-bot-pick.png' });
  for (let i = 0; i < 3; i++) await p1.locator('#pick-grid .mini:not(.locked)').nth(i).click();
  await p1.waitForSelector('#phase-battle:not([hidden])', { timeout: 8000 });
  ok(true, 'bot 3v3 battle started');
  await p1.waitForTimeout(3000);
  const teamSlots = await p1.locator('#me-team .tslot').count();
  ok(teamSlots === 3, 'team strip shows 3 creatures (' + teamSlots + ')');
  const oppText = await p1.textContent('#opp-name');
  ok(/Bot/.test(oppText), 'opponent is the bot: ' + oppText.trim().slice(0, 40));
  await p1.screenshot({ path: SHOTS + '/17-bot-battle.png' });

  console.log('— page errors —');
  ok(errors1.length === 0, 'player 1 no console/page errors' + (errors1.length ? ': ' + errors1.join(' | ') : ''));
  ok(errors2.length === 0, 'player 2/spectator no errors' + (errors2.length ? ': ' + errors2.join(' | ') : ''));

  await browser.close();
  console.log(failures === 0 ? '\n✅ UI SMOKE TEST PASSED' : '\n❌ ' + failures + ' FAILURES');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('UI TEST ERROR:', e); process.exit(2); });
