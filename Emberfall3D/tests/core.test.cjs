'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../public/game-core.js');
let checks = 0;
function test(title, run) { run(); checks++; console.log('PASS ' + title); }
function advance(state, seconds, dt = .25) {
  const until = state.time + seconds;
  while (state.status === 'playing' && state.time + 1e-9 < until) Core.step(state, Math.min(dt, until - state.time));
}
function player(id = 'me', heroId = 'aster', team = 0, slot) { return { id, name: id, heroId, team, slot }; }
function quietGame(heroId = 'aster') {
  const state = Core.createGame({ seed: 17, players: [player('me', heroId), player('ally', 'lyra', 0, 1)] });
  state.heroes.forEach(h => { h.bot = false; h.moveTarget = null; h.targetId = null; });
  return state;
}
function finiteTree(value, prefix = '') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'finite number required at ' + prefix);
  if (value && typeof value === 'object') for (const key of Object.keys(value)) finiteTree(value[key], prefix + '.' + key);
}

test('UMD works as CommonJS and as a dependency-free classic browser script', () => {
  assert.equal(globalThis.BattleCore, Core);
  const context = {}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/game-core.js'), 'utf8'), context);
  assert.equal(context.BattleCore.HEROES.length, 6);
  assert.equal(context.BattleCore.createGame().heroes.length, 10);
});

test('Six original heroes have four active Q/W/E/R abilities; six real items are unique', () => {
  assert.equal(Core.HEROES.length, 6); assert.equal(new Set(Core.HEROES.map(h => h.id)).size, 6);
  for (const h of Core.HEROES) {
    assert.deepEqual(h.abilities.map(a => a.key), ['Q', 'W', 'E', 'R']);
    assert.ok(h.hp > 0 && h.mana > 0 && h.damage > 0 && h.speed > 0);
    for (const a of h.abilities) assert.ok(a.cooldown > 0 && a.mana > 0 && a.description.length > 10);
  }
  assert.equal(Core.ITEMS.length, 6); assert.equal(new Set(Core.ITEMS.map(i => i.id)).size, 6);
});

test('Exactly five slots per team, human assignment, unique IDs and reserved-looking player IDs', () => {
  const state = Core.createGame({ players: [player('me', 'volt', 1, 4), player('__proto__', 'nyx', 0), player('__proto__', 'thorn', 0)] });
  assert.equal(state.heroes.length, 10);
  assert.equal(state.heroes.filter(h => h.team === 0).length, 5);
  assert.equal(state.heroes.filter(h => h.team === 1).length, 5);
  assert.equal(state.heroes.filter(h => !h.bot).length, 2);
  const me = Core.getHero(state, 'me'); assert.equal(me.team, 1); assert.equal(me.slot, 4); assert.equal(me.heroId, 'volt');
  assert.equal(Core.getHero(state, 'missing'), null);
  const ids = state.heroes.concat(state.structures).map(u => u.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(state.structures.length, 20);
  assert.equal(Core.MAP.lanes.length, 3);
  finiteTree(state); JSON.parse(JSON.stringify(state));
});

test('Commands reject missing identity, arbitrary mutation, NaN/Infinity, friendly attacks and bad spell slots', () => {
  const state = quietGame(), h = Core.getHero(state, 'me'), ally = Core.getHero(state, 'ally');
  assert.equal(Core.command(state, 'intruder', { type: 'move', x: 1, y: 1 }).ok, false);
  assert.equal(Core.command(state, 'me', { type: 'setHp', hp: 1e99 }).ok, false);
  for (const value of [NaN, Infinity, -Infinity, '100', null]) {
    assert.equal(Core.command(state, 'me', { type: 'move', x: value, y: 3 }).ok, false);
    assert.equal(Core.command(state, 'me', { type: 'cast', slot: 0, x: value, y: 3 }).ok, false);
  }
  assert.equal(Core.command(state, 'me', { type: 'attack', targetId: ally.id }).ok, false);
  for (const slot of [-1, 4, 1.2, '0']) assert.equal(Core.command(state, 'me', { type: 'cast', slot, x: 500, y: 500 }).ok, false);
  assert.equal(h.hp, h.maxHp);
  assert.equal(Core.command(state, 'me', { type: 'move', x: -1e6, y: 1e6 }).ok, true);
  assert.deepEqual(h.moveTarget, { x: 50, y: 2350 });
});

test('Movement, stop and attack-move are actual orders; dt bounds are enforced', () => {
  const state = quietGame(), h = Core.getHero(state, 'me');
  const original = { x: h.x, y: h.y };
  assert.equal(Core.command(state, 'me', { type: 'move', x: 800, y: 1800 }).ok, true);
  advance(state, 1);
  assert.ok(Math.hypot(h.x - original.x, h.y - original.y) > 100);
  Core.command(state, 'me', { type: 'stop' }); const stopped = { x: h.x, y: h.y };
  advance(state, .5); assert.equal(h.x, stopped.x); assert.equal(h.y, stopped.y);
  assert.equal(Core.command(state, 'me', { type: 'attackMove', x: 700, y: 1700 }).ok, true);
  assert.equal(h.order, 'attackMove');
  for (const dt of [-.1, .251, Infinity, NaN, '0.1']) assert.throws(() => Core.step(state, dt), RangeError);
  const before = JSON.stringify(state); Core.step(state, 0); assert.equal(JSON.stringify(state), before);
});

test('Purchases require the base and gold, update real stats and prevent duplicate items', () => {
  const state = quietGame(), h = Core.getHero(state, 'me'), baseSpeed = h.speed;
  assert.equal(Core.command(state, 'me', { type: 'buy', itemId: 'swiftboots' }).ok, true);
  assert.equal(h.speed, baseSpeed + 30); assert.equal(h.gold, 300); assert.deepEqual(h.items, ['swiftboots']);
  assert.equal(Core.command(state, 'me', { type: 'buy', itemId: 'swiftboots' }).ok, false);
  assert.equal(Core.command(state, 'me', { type: 'buy', itemId: 'ironheart' }).ok, false);
  h.gold = 10000; const hp = h.maxHp;
  assert.equal(Core.command(state, 'me', { type: 'buy', itemId: 'ironheart' }).ok, true);
  assert.equal(h.maxHp, hp + 320); assert.ok(h.armor > .2);
  h.x = 1200; h.y = 1200;
  assert.equal(Core.command(state, 'me', { type: 'buy', itemId: 'emberblade' }).ok, false);
  assert.equal(Core.command(state, 'me', { type: 'buy', itemId: '__proto__' }).ok, false);
});

test('All 24 active abilities alter battle state, spend mana and enforce cooldowns', () => {
  for (const def of Core.HEROES) for (let slot = 0; slot < 4; slot++) {
    const state = quietGame(def.id), h = Core.getHero(state, 'me'), ally = Core.getHero(state, 'ally');
    state.structures = [];
    h.x = 1000; h.y = 1000; h.hp *= .5;
    ally.x = 1040; ally.y = 1020; ally.hp *= .35;
    const enemies = state.heroes.filter(e => e.team !== h.team);
    enemies.forEach((e, i) => { e.x = 1120 + i * 17; e.y = 1000 + i * 14; e.hp = 10000; e.maxHp = 10000; e.armor = 0; });
    const before = { enemyHp: enemies.map(e => e.hp), hp: h.hp, allyHp: ally.hp, x: h.x, mana: h.mana };
    const target = def.id === 'lyra' && slot === 1 ? ally : enemies[0];
    const action = { type: 'cast', slot, x: target.x, y: target.y, targetId: target.id };
    const result = Core.command(state, 'me', action);
    assert.equal(result.ok, true, def.id + ' ' + slot + ': ' + result.error);
    assert.equal(h.mana, before.mana - def.abilities[slot].mana);
    assert.equal(h.cooldowns[slot], def.abilities[slot].cooldown);
    assert.ok(state.effects.length > 0);
    const meaningful = enemies.some((e, i) => e.hp < before.enemyHp[i]) || h.hp > before.hp || ally.hp > before.allyHp || h.shield > 0 || state.zones.length > 0 || h.x !== before.x;
    assert.ok(meaningful, def.id + ' ' + slot + ' must have a real gameplay effect');
    assert.equal(Core.command(state, 'me', action).ok, false, 'cooldown: ' + def.id + ' ' + slot);
    h.cooldowns[slot] = 0; h.mana = 0;
    assert.equal(Core.command(state, 'me', action).ok, false, 'mana: ' + def.id + ' ' + slot);
  }
});

test('Ground effects deal repeated damage; roots reject dash and stun rejects casting', () => {
  const state = quietGame('volt'), h = Core.getHero(state, 'me'), enemy = state.heroes.find(e => e.team === 1);
  state.structures = []; h.x = 1000; h.y = 1000; enemy.x = 1120; enemy.y = 1000;
  enemy.hp = enemy.maxHp = 20000; enemy.order = 'idle';
  Core.command(state, 'me', { type: 'cast', slot: 3, x: enemy.x, y: enemy.y });
  const immediate = enemy.hp; advance(state, 2.2);
  assert.ok(enemy.hp < immediate - 100); assert.ok(state.zones.length > 0);
  h.root = 2; assert.equal(Core.command(state, 'me', { type: 'cast', slot: 1, x: 900, y: 900 }).ok, false);
  h.stun = 2; assert.equal(Core.command(state, 'me', { type: 'cast', slot: 0, x: 1100, y: 1000 }).ok, false);
});

test('Recall channels for three seconds, teleports, and is cancelled by movement or damage', () => {
  const state = quietGame(), h = Core.getHero(state, 'me'); state.structures = [];
  h.x = 1200; h.y = 1200;
  assert.equal(Core.command(state, 'me', { type: 'recall' }).ok, true);
  advance(state, 2.75); assert.equal(h.x, 1200); assert.ok(h.recall > 0);
  advance(state, .25); assert.equal(h.x, Core.MAP.bases[h.team].x); assert.equal(h.y, Core.MAP.bases[h.team].y);
  h.x = 1200; h.y = 1200; Core.command(state, 'me', { type: 'recall' });
  Core.command(state, 'me', { type: 'move', x: 1300, y: 1300 }); assert.equal(h.recall, 0);
  Core.command(state, 'me', { type: 'recall' });
  const enemy = state.heroes.find(e => e.team === 1);
  enemy.x = h.x + 40; enemy.y = h.y; enemy.targetId = h.id; enemy.order = 'attack'; enemy.attackCooldown = 0;
  const hp = h.hp; Core.step(state, .25);
  assert.ok(h.hp < hp); assert.equal(h.recall, 0);
});

test('Hero kills grant gold, experience, levels and assists; death prevents commands and respawn restores health', () => {
  const state = quietGame(), h = Core.getHero(state, 'me'), ally = Core.getHero(state, 'ally'), enemy = state.heroes.find(e => e.team === 1);
  state.structures = []; h.x = 1000; h.y = 1000; ally.x = 990; ally.y = 1000; enemy.x = 1060; enemy.y = 1000;
  enemy.hp = 500; h.xp = 130;
  assert.equal(Core.command(state, 'ally', { type: 'cast', slot: 0, x: enemy.x, y: enemy.y, targetId: enemy.id }).ok, true);
  h.damage = 1000; h.attackCooldown = 0; Core.command(state, 'me', { type: 'attack', targetId: enemy.id });
  Core.step(state, .1);
  assert.equal(enemy.dead, true); assert.equal(enemy.deaths, 1); assert.equal(h.kills, 1); assert.equal(ally.assists, 1);
  assert.equal(state.kills[0], 1); assert.ok(h.gold > 600); assert.ok(h.level >= 2);
  enemy.playerId = 'fallen'; assert.equal(Core.command(state, 'fallen', { type: 'move', x: 0, y: 0 }).ok, false);
  Core.command(state, 'me', { type: 'stop' }); const respawn = enemy.respawn;
  advance(state, respawn + .25);
  assert.equal(enemy.dead, false); assert.ok(enemy.hp > enemy.maxHp * .95); assert.equal(enemy.respawn, 0);
});

test('Outer-to-inner tower protection and core prerequisite are authoritative; victory freezes the match', () => {
  const state = quietGame(), h = Core.getHero(state, 'me');
  const towers = state.structures.filter(s => s.team === 1 && s.type === 'tower' && s.lane === 1).sort((a, b) => a.tier - b.tier);
  const core = state.structures.find(s => s.team === 1 && s.type === 'core');
  assert.equal(Core.command(state, 'me', { type: 'attack', targetId: towers[1].id }).ok, false);
  assert.equal(Core.command(state, 'me', { type: 'attack', targetId: core.id }).ok, false);
  h.damage = 1e6;
  for (const tower of towers) {
    assert.equal(tower.protected, false);
    h.x = tower.x - 30; h.y = tower.y; h.attackCooldown = 0;
    assert.equal(Core.command(state, 'me', { type: 'attack', targetId: tower.id }).ok, true);
    Core.step(state, .05); assert.equal(tower.dead, true);
  }
  assert.equal(core.protected, false);
  h.x = core.x - 30; h.y = core.y; h.attackCooldown = 0; h.damage = 1e6;
  Core.command(state, 'me', { type: 'attack', targetId: core.id }); Core.step(state, .05);
  assert.equal(state.status, 'finished'); assert.equal(state.winner, 0); assert.equal(core.hp, 0);
  const frozen = JSON.stringify(state); Core.step(state, .25); assert.equal(JSON.stringify(state), frozen);
  assert.equal(Core.command(state, 'me', { type: 'move', x: 10, y: 10 }).ok, false);
});

test('Same seed and commands reproduce exact JSON, and a serialized snapshot resumes identically', () => {
  const one = Core.createGame({ seed: 711, players: [player('me', 'cinder')] });
  const two = Core.createGame({ seed: 711, players: [player('me', 'cinder')] });
  Core.command(one, 'me', { type: 'move', x: 1200, y: 1200 }); Core.command(two, 'me', { type: 'move', x: 1200, y: 1200 });
  advance(one, 35); advance(two, 35); assert.equal(JSON.stringify(one), JSON.stringify(two));
  const resumed = JSON.parse(JSON.stringify(one)); advance(one, 20); advance(resumed, 20);
  assert.equal(JSON.stringify(one), JSON.stringify(resumed)); finiteTree(one);
});

test('Bounded full matches finish by genuine core destruction with bots on all three lanes', () => {
  const winners = new Set();
  for (const seed of [1, 42, 103]) {
    const state = Core.createGame({ seed });
    while (state.status === 'playing' && state.time < 1000) Core.step(state, .25);
    assert.equal(state.status, 'finished', 'seed ' + seed + ' must complete');
    assert.ok(state.time > 300 && state.time < 1000, 'paced match duration: ' + state.time);
    assert.ok(state.kills[0] + state.kills[1] > 15);
    const core = state.structures.find(s => s.type === 'core' && s.team !== state.winner);
    assert.equal(core.hp, 0); assert.equal(core.dead, true);
    assert.ok([0, 1, 2].some(lane => !state.structures.some(s => s.team === core.team && s.type === 'tower' && s.lane === lane && !s.dead)));
    assert.ok(state.heroes.some(h => h.level >= 5)); assert.ok(state.heroes.every(h => h.items.length > 0));
    assert.ok(state.creeps.length <= 280 && state.effects.length <= 180 && state.projectiles.length <= 120 && state.events.length <= 32);
    const ids = state.heroes.concat(state.creeps, state.structures, state.effects, state.projectiles, state.zones).map(u => u.id);
    assert.equal(ids.length, new Set(ids).size); finiteTree(state);
    JSON.parse(JSON.stringify(state)); winners.add(state.winner);
    console.log('  seed ' + seed + ': team ' + state.winner + ', ' + state.time.toFixed(2) + 's, kills ' + state.kills.join(':'));
  }
  assert.equal(winners.size, 2, 'both sides can win without a scripted winner');
});

console.log('\n' + checks + ' meaningful core test groups passed.');
