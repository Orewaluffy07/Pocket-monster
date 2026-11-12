'use strict';

/* ============================ TYPES ============================ */

const TYPES = ['fire', 'water', 'leaf', 'electric', 'dark', 'ghost', 'fighting', 'flying', 'steel'];

const TYPE_INFO = {
  fire:     { name: 'Fire',     icon: '🔥' },
  water:    { name: 'Water',    icon: '💧' },
  leaf:     { name: 'Leaf',     icon: '🌿' },
  electric: { name: 'Electric', icon: '⚡' },
  dark:     { name: 'Dark',     icon: '🌙' },
  ghost:    { name: 'Ghost',    icon: '👻' },
  fighting: { name: 'Fighting', icon: '👊' },
  flying:   { name: 'Flying',   icon: '🕊️' },
  steel:    { name: 'Steel',    icon: '⚙️' }
};

/* Attacker type -> defender type -> multiplier (1 = neutral) */
const CHART = {
  fire:     { leaf: 1.25, steel: 1.25, water: 0.75, ghost: 0.75 },
  water:    { fire: 1.25, fighting: 1.25, electric: 0.75, leaf: 0.75 },
  leaf:     { water: 1.25, fighting: 1.25, fire: 0.75, flying: 0.75 },
  electric: { water: 1.25, flying: 1.25, leaf: 0.75, steel: 0.75 },
  dark:     { ghost: 1.25, leaf: 1.25, dark: 0.75, steel: 0.75 },
  ghost:    { fighting: 1.25, ghost: 1.25, dark: 0.75, steel: 0.75 },
  fighting: { dark: 1.25, steel: 1.25, ghost: 0.75, flying: 0.75 },
  flying:   { leaf: 1.25, fighting: 1.25, steel: 0.75, electric: 0.75 },
  steel:    { leaf: 1.25, dark: 1.25, fire: 0.75, water: 0.75 }
};

/* ============================ RULES ============================ */

const TIER_HP = { C: 100, U: 125, E: 150, M: 175, L: 210 };
const TIER_NAME = { C: 'Common', U: 'Uncommon', E: 'Epic', M: 'Mythic', L: 'Legendary' };
const TIER_ORDER = ['L', 'M', 'E', 'U', 'C'];

/* Per-card pack odds (percent) */
const PACK_ODDS = { C: 60, U: 30, E: 7, M: 2, L: 1 };
const PACK_SIZES = { starter: 7, shop: 8 };
const PACK_PRICE = 250;
const REWARD = { win: 10, lose: 5 };

const DODGE_CHANCE = 0.35;   // % chance a dodging fighter evades an incoming hit
const GUARD_REDUCE = 0.35;   // damage reduction while guarding
const STAB = 1.15;           // same-type attack bonus
const FOCUS = { mult: 1.25, attacks: 2 };

/* ============================ MOVES ============================ */
/* power: damage, cd: cooldown in the user's own turns (basic = 0)
   fx: leech / dodge / guard / atk / heal                                                */

const MOVES = {
  /* ---- FIRE ---- */
  flame_nip:      { name: 'Flame Nip',      type: 'fire', kind: 'basic',   power: 12, cd: 0 },
  ember_slash:    { name: 'Ember Slash',    type: 'fire', kind: 'mid',     power: 21, cd: 2 },
  heat_wave:      { name: 'Heat Wave',      type: 'fire', kind: 'mid',     power: 24, cd: 2 },
  blaze_rush:     { name: 'Blaze Rush',     type: 'fire', kind: 'mid',     power: 17, cd: 1 },
  inferno_claw:   { name: 'Inferno Claw',   type: 'fire', kind: 'special', power: 36, cd: 3 },
  wildfire:       { name: 'Wildfire',       type: 'fire', kind: 'special', power: 40, cd: 3 },

  /* ---- WATER ---- */
  bubble_bash:    { name: 'Bubble Bash',    type: 'water', kind: 'basic',  power: 12, cd: 0 },
  aqua_jet:       { name: 'Aqua Jet',       type: 'water', kind: 'mid',    power: 17, cd: 1 },
  tidal_shot:     { name: 'Tidal Shot',     type: 'water', kind: 'mid',    power: 22, cd: 2 },
  undertow:       { name: 'Undertow',       type: 'water', kind: 'mid',    power: 0,  cd: 3, fx: { dodge: DODGE_CHANCE } },
  hydro_cannon:   { name: 'Hydro Cannon',   type: 'water', kind: 'special', power: 36, cd: 3 },
  tsunami:        { name: 'Tsunami',        type: 'water', kind: 'special', power: 40, cd: 3 },

  /* ---- LEAF ---- */
  leaf_cutter:    { name: 'Leaf Cutter',    type: 'leaf', kind: 'basic',   power: 12, cd: 0 },
  vine_whip:      { name: 'Vine Whip',      type: 'leaf', kind: 'mid',     power: 21, cd: 2 },
  razor_leaf:     { name: 'Razor Leaf',     type: 'leaf', kind: 'mid',     power: 22, cd: 2 },
  pollen_mend:    { name: 'Pollen Mend',    type: 'leaf', kind: 'mid',     power: 0,  cd: 3, fx: { heal: 16 } },
  bark_skin:      { name: 'Bark Skin',      type: 'leaf', kind: 'mid',     power: 0,  cd: 3, fx: { guard: GUARD_REDUCE } },
  solar_beam:     { name: 'Solar Beam',     type: 'leaf', kind: 'special', power: 36, cd: 3 },
  bloom_burst:    { name: 'Bloom Burst',    type: 'leaf', kind: 'special', power: 38, cd: 3 },

  /* ---- ELECTRIC ---- */
  spark_jab:      { name: 'Spark Jab',      type: 'electric', kind: 'basic',  power: 12, cd: 0 },
  static_touch:   { name: 'Static Touch',   type: 'electric', kind: 'mid',    power: 18, cd: 1 },
  thunder_jolt:   { name: 'Thunder Jolt',   type: 'electric', kind: 'mid',    power: 21, cd: 2 },
  charge_up:      { name: 'Charge Up',      type: 'electric', kind: 'mid',    power: 0,  cd: 3, fx: { atk: FOCUS.mult, attacks: FOCUS.attacks } },
  thunderbolt:    { name: 'Thunderbolt',    type: 'electric', kind: 'special', power: 36, cd: 3 },
  lightning_storm:{ name: 'Lightning Storm',type: 'electric', kind: 'special', power: 40, cd: 3 },

  /* ---- DARK ---- */
  shadow_poke:    { name: 'Shadow Poke',    type: 'dark', kind: 'basic',   power: 12, cd: 0 },
  dark_claw:      { name: 'Dark Claw',      type: 'dark', kind: 'mid',     power: 21, cd: 2 },
  night_slash:    { name: 'Night Slash',    type: 'dark', kind: 'mid',     power: 23, cd: 2 },
  dread_bite:     { name: 'Dread Bite',     type: 'dark', kind: 'mid',     power: 18, cd: 2, fx: { leech: 0.4 } },
  life_leech:     { name: 'Life Leech',     type: 'dark', kind: 'mid',     power: 16, cd: 3, fx: { leech: 0.5 } },
  abyss_fang:     { name: 'Abyss Fang',     type: 'dark', kind: 'special', power: 36, cd: 3, fx: { leech: 0.4 } },
  void_rend:      { name: 'Void Rend',      type: 'dark', kind: 'special', power: 40, cd: 3 },

  /* ---- GHOST ---- */
  spirit_tap:     { name: 'Spirit Tap',     type: 'ghost', kind: 'basic',  power: 12, cd: 0 },
  wail:           { name: 'Wail',           type: 'ghost', kind: 'mid',    power: 22, cd: 2 },
  ghost_grasp:    { name: 'Ghost Grasp',    type: 'ghost', kind: 'mid',    power: 19, cd: 2, fx: { leech: 0.3 } },
  phase_shift:    { name: 'Phase Shift',    type: 'ghost', kind: 'mid',    power: 0,  cd: 3, fx: { dodge: DODGE_CHANCE } },
  shadow_blast:   { name: 'Shadow Blast',   type: 'ghost', kind: 'special', power: 36, cd: 3 },
  phantom_torment:{ name: 'Phantom Torment',type: 'ghost', kind: 'special', power: 38, cd: 3, fx: { leech: 0.3 } },

  /* ---- FIGHTING ---- */
  quick_jab:      { name: 'Quick Jab',      type: 'fighting', kind: 'basic',  power: 13, cd: 0 },
  karate_chop:    { name: 'Karate Chop',    type: 'fighting', kind: 'mid',    power: 22, cd: 2 },
  low_kick:       { name: 'Low Kick',       type: 'fighting', kind: 'mid',    power: 21, cd: 2 },
  battle_focus:   { name: 'Battle Focus',   type: 'fighting', kind: 'mid',    power: 0,  cd: 3, fx: { atk: FOCUS.mult, attacks: FOCUS.attacks } },
  sidestep:       { name: 'Sidestep',       type: 'fighting', kind: 'mid',    power: 0,  cd: 3, fx: { dodge: DODGE_CHANCE } },
  meteor_fist:    { name: 'Meteor Fist',    type: 'fighting', kind: 'special', power: 38, cd: 3 },
  warrior_rush:   { name: 'Warrior Rush',   type: 'fighting', kind: 'special', power: 36, cd: 3 },

  /* ---- FLYING ---- */
  peck:           { name: 'Peck',           type: 'flying', kind: 'basic',  power: 12, cd: 0 },
  gust:           { name: 'Gust',           type: 'flying', kind: 'mid',    power: 16, cd: 1 },
  wing_attack:    { name: 'Wing Attack',    type: 'flying', kind: 'mid',    power: 21, cd: 2 },
  sky_dive:       { name: 'Sky Dive',       type: 'flying', kind: 'mid',    power: 24, cd: 2 },
  wind_veil:      { name: 'Wind Veil',      type: 'flying', kind: 'mid',    power: 0,  cd: 3, fx: { dodge: DODGE_CHANCE } },
  air_slash:      { name: 'Air Slash',      type: 'flying', kind: 'special', power: 34, cd: 3 },
  cyclone:        { name: 'Cyclone',        type: 'flying', kind: 'special', power: 38, cd: 3 },

  /* ---- STEEL ---- */
  metal_tap:      { name: 'Metal Tap',      type: 'steel', kind: 'basic',  power: 13, cd: 0 },
  iron_bash:      { name: 'Iron Bash',      type: 'steel', kind: 'mid',    power: 22, cd: 2 },
  steel_slam:     { name: 'Steel Slam',     type: 'steel', kind: 'mid',    power: 24, cd: 2 },
  iron_guard:     { name: 'Iron Guard',     type: 'steel', kind: 'mid',    power: 0,  cd: 3, fx: { guard: GUARD_REDUCE } },
  chrome_crusher: { name: 'Chrome Crusher', type: 'steel', kind: 'special', power: 40, cd: 3 },
  steel_tempest:  { name: 'Steel Tempest',  type: 'steel', kind: 'special', power: 36, cd: 3 }
};

/* Move pools used to build each creature's kit */
const BASICS = {
  fire: 'flame_nip', water: 'bubble_bash', leaf: 'leaf_cutter', electric: 'spark_jab',
  dark: 'shadow_poke', ghost: 'spirit_tap', fighting: 'quick_jab', flying: 'peck', steel: 'metal_tap'
};

const MID_POOL = {
  fire:     ['ember_slash', 'heat_wave', 'blaze_rush'],
  water:    ['aqua_jet', 'tidal_shot', 'undertow'],
  leaf:     ['vine_whip', 'razor_leaf', 'pollen_mend', 'bark_skin'],
  electric: ['thunder_jolt', 'static_touch', 'charge_up'],
  dark:     ['dark_claw', 'night_slash', 'dread_bite', 'life_leech'],
  ghost:    ['wail', 'ghost_grasp', 'phase_shift'],
  fighting: ['karate_chop', 'low_kick', 'battle_focus', 'sidestep'],
  flying:   ['gust', 'wing_attack', 'sky_dive', 'wind_veil'],
  steel:    ['iron_bash', 'steel_slam', 'iron_guard']
};

const SPECIAL_POOL = {
  fire: ['inferno_claw', 'wildfire'],
  water: ['hydro_cannon', 'tsunami'],
  leaf: ['solar_beam', 'bloom_burst'],
  electric: ['thunderbolt', 'lightning_storm'],
  dark: ['abyss_fang', 'void_rend'],
  ghost: ['shadow_blast', 'phantom_torment'],
  fighting: ['meteor_fist', 'warrior_rush'],
  flying: ['air_slash', 'cyclone'],
  steel: ['chrome_crusher', 'steel_tempest']
};

/* ==================== CREATURE BUILDER ==================== */

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Ability counts per tier:
   C = 2 abilities            U = 3 abilities
   E = 4 (some: 3 + special)  M = 4 + 1 special   L = 4 + 2 specials  */
function buildCreature(name, tier, types) {
  const rng = mulberry32(hashStr(name));
  let need, spCount;

  if (tier === 'C')      { need = 1; spCount = 0; }
  else if (tier === 'U') { need = 2; spCount = 0; }
  else if (tier === 'E') { const withSp = rng() < 0.55; need = withSp ? 2 : 3; spCount = withSp ? 1 : 0; }
  else if (tier === 'M') { need = 3; spCount = 1; }
  else                   { need = 3; spCount = 2; } // L

  /* --- pick regular moves (basic + mids), dual-types alternate between their types --- */
  const perType = types.map(t => shuffle(MID_POOL[t], rng));
  const picks = [];

  if (types.length === 1) {
    for (let i = 0; i < need && i < perType[0].length; i++) picks.push(perType[0][i]);
  } else {
    const idx = [0, 0];
    let turn = 0;
    while (picks.length < need) {
      const t = turn % 2;
      const other = 1 - t;
      if (idx[t] < perType[t].length) picks.push(perType[t][idx[t]++]);
      else if (idx[other] < perType[other].length) picks.push(perType[other][idx[other]++]);
      else break;
      turn++;
    }
  }

  /* nudge: with decent chance make sure utility moves (dodge/guard/focus/leech/heal) show up */
  if (need >= 2) {
    const hasFx = picks.some(id => MOVES[id].power === 0 || (MOVES[id].fx && MOVES[id].fx.leech));
    const fxPool = [];
    for (const t of types) for (const id of MID_POOL[t]) {
      const mv = MOVES[id];
      if ((mv.power === 0 && mv.fx) || (mv.fx && mv.fx.leech)) fxPool.push(id);
    }
    if (!hasFx && fxPool.length && rng() < 0.65) {
      const cand = shuffle(fxPool, rng).find(id => !picks.includes(id));
      if (cand) picks[picks.length - 1] = cand;
    }
  }

  /* --- specials --- */
  const specials = [];
  if (spCount === 1) {
    const t = types.length > 1 && rng() < 0.5 ? 1 : 0;
    specials.push(shuffle(SPECIAL_POOL[types[t]], rng)[0]);
  } else if (spCount === 2) {
    if (types.length > 1) {
      specials.push(shuffle(SPECIAL_POOL[types[0]], rng)[0]);
      specials.push(shuffle(SPECIAL_POOL[types[1]], rng)[0]);
    } else {
      specials.push(...shuffle(SPECIAL_POOL[types[0]], rng));
    }
  }

  return {
    id: name.toLowerCase(),
    name,
    tier,
    types,
    hp: TIER_HP[tier],
    abilities: [BASICS[types[0]], ...picks, ...specials]
  };
}

/* ==================== ROSTER ==================== */
/* name, tier, [types] — dual-type creatures draw moves from both types,
   e.g. Gearwing is steel + flying (a levitating metal crank).          */

const ROSTER = [
  /* fire */
  ['Emberkit', 'C', ['fire']], ['Torchlet', 'C', ['fire']],
  ['Cindercub', 'U', ['fire']], ['Pyrowl', 'U', ['fire']],
  ['Blazehound', 'E', ['fire']], ['Magmutt', 'E', ['fire']],
  ['Infernyx', 'M', ['fire']], ['Volcaron', 'L', ['fire']],
  /* water */
  ['Bubblit', 'C', ['water']], ['Splashlet', 'C', ['water']],
  ['Tidalfin', 'U', ['water']], ['Coralisk', 'U', ['water']],
  ['Crocplash', 'E', ['water']], ['Hydroseal', 'M', ['water']],
  ['Tsunamaw', 'L', ['water']],
  /* leaf */
  ['Sproutle', 'C', ['leaf']], ['Fernabbit', 'C', ['leaf']],
  ['Thornbud', 'U', ['leaf']], ['Mossmole', 'U', ['leaf']],
  ['Vinegarb', 'E', ['leaf']], ['Bloomane', 'E', ['leaf']],
  ['Sylvantree', 'M', ['leaf']], ['Floraquin', 'L', ['leaf']],
  /* electric */
  ['Zaplet', 'C', ['electric']], ['Sparkid', 'C', ['electric']],
  ['Thunderpup', 'U', ['electric']], ['Voltkin', 'U', ['electric']],
  ['Ampfin', 'E', ['electric']], ['Wattiger', 'M', ['electric']],
  ['Stormew', 'L', ['electric']],
  /* dark */
  ['Shadelet', 'C', ['dark']], ['Nightimp', 'C', ['dark']],
  ['Umbrhound', 'U', ['dark']], ['Duskcrow', 'U', ['dark']],
  ['Voidmaw', 'E', ['dark']], ['Nyxbat', 'E', ['dark']],
  ['Obsidiagon', 'M', ['dark']], ['Eclipsire', 'L', ['dark']],
  /* ghost */
  ['Spookit', 'C', ['ghost']], ['Wispup', 'C', ['ghost']],
  ['Hauntail', 'U', ['ghost']], ['Phantwee', 'U', ['ghost']],
  ['Spectrake', 'E', ['ghost']], ['Gloomjaw', 'E', ['ghost']],
  ['Bansheen', 'M', ['ghost']], ['Gravewick', 'L', ['ghost']],
  /* fighting */
  ['Punchlet', 'C', ['fighting']], ['Scrappit', 'C', ['fighting']],
  ['Brawlound', 'U', ['fighting']], ['Jabsuki', 'U', ['fighting']],
  ['Kumodra', 'E', ['fighting']], ['Bruteleon', 'E', ['fighting']],
  ['Titansage', 'M', ['fighting']], ['Championox', 'L', ['fighting']],
  /* flying */
  ['Glidlet', 'C', ['flying']], ['Breezling', 'C', ['flying']],
  ['Skyrake', 'U', ['flying']], ['Aerowisp', 'U', ['flying']],
  ['Galevane', 'E', ['flying']], ['Plumebolt', 'E', ['flying']],
  ['Stormcrest', 'M', ['flying']], ['Zephyros', 'L', ['flying']],
  /* steel */
  ['Rivet', 'C', ['steel']], ['Cogling', 'C', ['steel']],
  ['Ironox', 'U', ['steel']], ['Steeldra', 'U', ['steel']],
  ['Ferrolisk', 'E', ['steel']], ['Ferralig', 'E', ['steel']],
  ['Chromadon', 'M', ['steel']], ['Platinox', 'L', ['steel']],
  /* dual-types (moves from both types) */
  ['Steamkit', 'C', ['fire', 'water']],
  ['Thornkite', 'C', ['leaf', 'flying']],
  ['Lilyfloat', 'U', ['water', 'leaf']],
  ['Ironbark', 'U', ['leaf', 'steel']],
  ['Coilviper', 'U', ['electric', 'steel']],
  ['Hawkfist', 'U', ['flying', 'fighting']],
  ['Voltwing', 'U', ['electric', 'flying']],
  ['Gearwing', 'E', ['steel', 'flying']],
  ['Emberwing', 'E', ['fire', 'flying']],
  ['Voltfin', 'E', ['electric', 'water']],
  ['Shadequill', 'E', ['dark', 'flying']],
  ['Chromafist', 'E', ['steel', 'fighting']],
  ['Magmaclad', 'M', ['fire', 'steel']],
  ['Phantair', 'M', ['ghost', 'flying']],
  ['Nighthex', 'M', ['dark', 'ghost']],
  ['Stormrake', 'L', ['electric', 'flying']]
];

const CREATURE_LIST = ROSTER.map(([n, t, ty]) => buildCreature(n, t, ty));
const CREATURES = {};
for (const c of CREATURE_LIST) CREATURES[c.id] = c;

const BY_TIER = { C: [], U: [], E: [], M: [], L: [] };
for (const c of CREATURE_LIST) BY_TIER[c.tier].push(c);

module.exports = {
  TYPES, TYPE_INFO, CHART,
  TIER_HP, TIER_NAME, TIER_ORDER,
  PACK_ODDS, PACK_SIZES, PACK_PRICE, REWARD,
  DODGE_CHANCE, GUARD_REDUCE, STAB, FOCUS,
  MOVES, CREATURES, CREATURE_LIST, BY_TIER
};
