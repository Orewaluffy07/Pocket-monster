# ⚡ Pocket Arena — Class Card Battles

A multiplayer Pokémon-style card battler for the class: open packs, collect creatures,
battle classmates **1v1 / 3v3 / 5v5**, fight the **bot**, spectate matches, and trade with friends.

## Run

```bash
npm install
npm start          # serves on http://localhost:3000
```

Tests (server must be running):

```bash
npm test           # end-to-end gameplay test (incl. bot matches)
node ui-test.js    # browser UI smoke test (needs playwright)
```

## How to play

1. **Register** a username (3–16 chars: a-z 0-9 _). Usernames are **unique** — once taken,
   nobody else can claim them. Every new player gets a **free starter pack of 7 cards**.
2. **Battle** → pick your **mode: 1v1 / 3v3 / 5v5** (you need at least N cards for NvN),
   then either **Create Room** (a classmate joins) or **🤖 Fight Bot** (instant match).
   In team modes each side picks N creatures; when one faints, the next is sent out automatically.
   Anyone else can click **👁 Watch** to spectate, and everyone in the room can chat.
   **🏳️ Surrender** concedes the current battle.
3. **Coins**: PvP win **+10**, lose **+5** (surrender still pays +5).
   **Vs bot**: 1v1 is practice — **0 coins** either way; **3v3 & 5v5 win = +5**, losing = 0.
   Spend **250 coins** in the Shop for an **8-card booster pack**.
4. **The bot** can pick any creature in the game, but never stacks the best tiers —
   its team is rolled with weighted odds (mostly C/U) and capped at **max 1 Legendary + max 1 Mythic**.
5. **Friends**: search a username → send a request → they accept. Trade cards **only with friends**.
6. **Trades**: each side offers at least one card, both confirm — cards swap instantly.

## Card rules

| Tier | HP | Abilities |
|------|-----|-----------|
| C Common | 100 | 2 |
| U Uncommon | 125 | 3 |
| E Epic | 150 | 4 (some: 3 + 1 special) |
| M Mythic | 175 | 4 + 1 special |
| L Legendary | 210 | 4 + 2 specials |

**Pack odds per card:** C 60% · U 30% · E 7% · M 2% · **L 1%** (super rare!)

- **9 types**: fire 🔥 water 💧 leaf 🌿 electric ⚡ dark 🌙 ghost 👊 fighting 👊 flying 🕊️ steel ⚙️
  with a full type-advantage chart (super effective ×1.25 / not very effective ×0.75).
- **Dual-type creatures** (e.g. Gearwing = steel + flying) use moves from both types.
- **Cooldowns**: basic moves 0 (every turn), most moves 2 turns, specials 3 turns —
  you must wait that many of your own turns before using them again.
- **Utility abilities** (balanced, not OP): **Life Leech** (damage + heal 40–50% of it),
  **Dodge** (35% evade the next hit), **Focus** (+25% damage for 2 attacks),
  **Guard** (−35% damage from next hit), **Pollen Mend** (heal 16).
- Same-type attacks get ×1.15 STAB.

## 🌐 Deploy — play with friends anywhere

**Option A — keep it on this machine (quick test with friends on the same Wi-Fi):**

```bash
npm start
# friends open:  http://YOUR_LAN_IP:3000     (e.g. http://192.168.1.7:3000)
```

Find your LAN IP with `ipconfig` (Windows) or `hostname -I` (Mac/Linux).
Everyone must be on the same network; no internet needed.

**Option B — public website (anyone with the link can play):**

1. Create a free GitHub account → put this folder in a new repository
   (`git init`, add files, push — or use GitHub Desktop).
2. Go to <https://render.com> → **New → Web Service** → connect the repo.
   - **Build command:** `npm install`
   - **Start command:** `npm start`
3. Deploy → Render gives you a public URL like `https://pocket-arena.onrender.com`.
   Share that link — friends register and play, WebSockets work out of the box.

Notes for Option B: the free tier sleeps after inactivity (first click may take ~30 s),
and `data.json` (accounts/cards) lives on the service's disk — it resets if you redeploy,
unless you add a paid persistent disk. For a school project that's usually fine.

**Option C — instant link while this session runs:** the live preview above is the game —
just share it while the server is running.

## Tech

- Node.js + Express + WebSocket (`server.js`), zero-framework frontend (`public/`)
- Accounts persisted to `data.json`; rooms/trades are live in memory
- Team-battle engine: per-creature HP/cooldowns, automatic faint → switch-out, bot AI
- 86 creatures across 9 types generated in `data.js`

## Tests

- `test.js` — registers 3 players, packs, friends, unique-name check, **1v1 & 3v3 PvP rooms**,
  spectator, full battles with cooldowns/specials, rewards (10/5 PvP, 0 for bot 1v1,
  +5 bot 3v3 win, 0 for losing/surrendering to bot), **bot team tier caps**,
  bot 5v5 start, chat, surrender, and a card trade
- `ui-test.js` — Playwright walkthrough of the real UI (mode picker, bot battle, team strips,
  surrender, spectating) with screenshots in `shots/`
