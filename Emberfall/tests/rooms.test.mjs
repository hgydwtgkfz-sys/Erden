import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { makeRoomService, MemoryRoomStore, D1RoomStore } from '../server/rooms.mjs';
import { createNodeServer } from '../server/node-server.mjs';

const Core = globalThis.BattleCore;
const profile = (name = 'Игрок', heroId = 'aster', team) => ({ name, heroId, ...(team === undefined ? {} : { team }) });
const command = (seq, action = { type: 'stop' }) => ({ seq, action });
const errorCode = (code, status) => error => error.code === code && error.status === status;
function setup(Store = MemoryRoomStore) {
  let time = 1_000_000;
  const store = new Store();
  const service = makeRoomService({ store, now: () => time, random: () => 0.5 });
  return { service, store, advance: value => { time += value; }, now: () => time };
}
async function pair(service) {
  const a = await service.create(profile('Первый', 'aster', 0));
  const b = await service.join(a.code, profile('Второй', 'lyra', 1));
  return { a, b };
}

test('credentials are independent, secret, room-scoped; host only; unknown fields rejected', async () => {
  const { service, store } = setup();
  const { a, b } = await pair(service);
  assert.match(a.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(a.token.length, 64);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.playerId, b.playerId);
  const other = await service.create(profile('Другая комната'), 'second-address');
  await assert.rejects(service.get(a.code, other.token), errorCode('forbidden', 403));
  await assert.rejects(service.get(a.code, 'wrong'), errorCode('unauthorized', 401));
  await assert.rejects(service.start(a.code, b.token), errorCode('host_only', 403));
  await assert.rejects(service.create({ ...profile(), state: { gold: 99999 } }), errorCode('invalid_fields', 400));
  await assert.rejects(service.create(profile('<script>')), errorCode('invalid_name', 400));
  await assert.rejects(service.create(profile('x', 'unknown')), errorCode('invalid_hero', 400));
  const row = await store.load(a.code);
  assert.ok(row.data.players.every(player => player.tokenHash.length === 64));
  assert.ok(!JSON.stringify(row).includes(a.token));
  const publicSnapshot = await service.get(a.code, a.token);
  assert.ok(!JSON.stringify(publicSnapshot).includes('tokenHash'));
  assert.ok(!JSON.stringify(publicSnapshot).includes(a.token));
  assert.equal(publicSnapshot.room.players.length, 2);
  assert.equal(publicSnapshot.room.pollInterval, 250);
});

test('concurrent joins use CAS, limit both teams to five, and start fills remaining slots with bots', async () => {
  const { service } = setup();
  const host = await service.create(profile('Хост', 'aster', 0));
  const guests = await Promise.all(Array.from({ length: 9 }, (_, index) => service.join(host.code, profile(`Гость ${index}`, 'lyra'), `address-${index}`)));
  const lobby = await service.get(host.code, host.token);
  assert.equal(lobby.room.players.length, 10);
  assert.deepEqual([0, 1].map(team => lobby.room.players.filter(player => player.team === team).length), [5, 5]);
  assert.equal(new Set(guests.map(item => item.playerId)).size, 9);
  await assert.rejects(service.join(host.code, profile('Лишний')), errorCode('room_full', 409));
  const started = await service.start(host.code, host.token);
  assert.equal(started.state.heroes.length, 10);
  assert.equal(started.state.heroes.filter(hero => !hero.bot).length, 10);
  await assert.rejects(service.join(host.code, profile('Поздний')), errorCode('already_started', 409));
  const smaller = await service.create(profile('Маленькая'), 'another-address');
  const withBots = await service.start(smaller.code, smaller.token);
  assert.equal(withBots.state.heroes.length, 10);
  assert.equal(withBots.state.heroes.filter(hero => hero.bot).length, 9);
  assert.deepEqual([0, 1].map(team => withBots.state.heroes.filter(hero => hero.team === team).length), [5, 5]);
});

test('team capacity is enforced before overall room is full', async () => {
  const { service } = setup();
  const host = await service.create(profile('Хост', 'aster', 0));
  for (let index = 0; index < 4; index++) await service.join(host.code, profile(`Игрок ${index}`, 'thorn', 0));
  await assert.rejects(service.join(host.code, profile('Шестой', 'volt', 0)), errorCode('team_full', 409));
  const guest = await service.join(host.code, profile('Другая команда', 'nyx', 1));
  assert.equal(guest.room.players.length, 6);
});

test('authoritative commands are bound to bearer player and stale seq cannot mutate twice', async () => {
  const { service } = setup();
  const { a, b } = await pair(service);
  const initial = await service.start(a.code, a.token);
  const aHero = Core.getHero(initial.state, a.playerId);
  const bHero = Core.getHero(initial.state, b.playerId);
  const sent = await service.action(a.code, a.token, command(1, { type: 'move', x: 900, y: 1_300 }));
  assert.equal(sent.ackSeq, 1);
  assert.equal(sent.actionResult.ok, true);
  assert.deepEqual(Core.getHero(sent.state, a.playerId).moveTarget, { x: 900, y: 1_300 });
  assert.deepEqual(Core.getHero(sent.state, b.playerId).moveTarget, bHero.moveTarget);
  const replay = await service.action(a.code, a.token, command(1, { type: 'move', x: 2_000, y: 100 }));
  assert.equal(replay.duplicate, true);
  assert.deepEqual(Core.getHero(replay.state, a.playerId).moveTarget, { x: 900, y: 1_300 });
  await assert.rejects(service.action(a.code, a.token, {
    seq: 2, action: { type: 'move', x: 1, y: 2, playerId: b.playerId }
  }), errorCode('invalid_fields', 400));
  await assert.rejects(service.action(a.code, a.token, {
    seq: 2, state: { gold: 999999 }, action: { type: 'stop' }
  }), errorCode('invalid_fields', 400));
  await assert.rejects(service.action(a.code, a.token, command(2, { type: 'move', x: -1, y: Infinity })), errorCode('invalid_position', 400));
  assert.equal(Core.getHero(sent.state, a.playerId).gold, aHero.gold);
  const after = await service.get(a.code, b.token);
  assert.deepEqual(Core.getHero(after.state, a.playerId).moveTarget, { x: 900, y: 1_300 });
  assert.equal(after.ackSeq, 0);
});

test('fixed 50ms ticks retain sub-tick remainder and discard catch-up beyond two seconds', async () => {
  const { service, advance } = setup();
  const a = await service.create(profile());
  const initial = await service.start(a.code, a.token);
  advance(249);
  const first = await service.get(a.code, a.token);
  assert.ok(Math.abs(first.state.time - initial.state.time - 0.2) < 1e-8);
  advance(1);
  const second = await service.get(a.code, a.token);
  assert.ok(Math.abs(second.state.time - initial.state.time - 0.25) < 1e-8);
  advance(60_000);
  const catchUp = await service.get(a.code, a.token);
  assert.ok(Math.abs(catchUp.state.time - second.state.time - 2) < 1e-8);
  const repeat = await service.get(a.code, a.token);
  assert.equal(repeat.state.time, catchUp.state.time);
});

test('authoritative spells damage another player, purchases cannot be replayed or forged', async () => {
  const { service, advance } = setup();
  const { a, b } = await pair(service);
  await service.start(a.code, a.token);
  const purchase = await service.action(a.code, a.token, command(1, { type: 'buy', itemId: 'swiftboots' }));
  const purchasedHero = Core.getHero(purchase.state, a.playerId);
  assert.deepEqual(purchasedHero.items, ['swiftboots']);
  assert.equal(purchasedHero.gold, 300);
  const replay = await service.action(a.code, a.token, command(1, { type: 'buy', itemId: 'tidecharm' }));
  assert.equal(replay.duplicate, true);
  assert.equal(Core.getHero(replay.state, a.playerId).gold, 300);
  const denied = await service.action(a.code, a.token, command(2, { type: 'buy', itemId: 'ironheart' }));
  assert.equal(denied.actionResult.ok, false);
  assert.equal(denied.ackSeq, 2);
  await service.action(a.code, a.token, command(3, { type: 'move', x: 1_200, y: 1_200 }));
  await service.action(a.code, b.token, command(1, { type: 'move', x: 1_215, y: 1_200 }));
  let before;
  for (let tick = 0; tick < 5; tick++) {
    advance(2_000);
    before = await service.get(a.code, a.token);
    await service.get(a.code, b.token);
  }
  const target = Core.getHero(before.state, b.playerId);
  assert.equal(target.dead, false);
  const hit = await service.action(a.code, a.token, command(4, { type: 'cast', slot: 2, x: target.x, y: target.y, targetId: target.id }));
  assert.equal(hit.actionResult.ok, true);
  const damaged = Core.getHero(hit.state, b.playerId);
  assert.ok(damaged.hp < target.hp, `Expected enemy health below ${target.hp}, got ${damaged.hp}`);
  const observer = await service.get(a.code, b.token);
  assert.equal(Core.getHero(observer.state, b.playerId).hp, damaged.hp);
  const duplicate = await service.action(a.code, a.token, command(4, { type: 'cast', slot: 2, x: target.x, y: target.y, targetId: target.id }));
  assert.equal(Core.getHero(duplicate.state, b.playerId).hp, damaged.hp);
});

test('disconnect takeover, resume, host hand-off and token invalidation on leave', async () => {
  const { service, advance } = setup();
  const { a, b } = await pair(service);
  await service.start(a.code, a.token);
  advance(16_000);
  const disconnected = await service.get(a.code, a.token);
  assert.equal(disconnected.room.players.find(player => player.id === b.playerId).connected, false);
  assert.equal(Core.getHero(disconnected.state, b.playerId).bot, true);
  const resumed = await service.get(a.code, b.token);
  assert.equal(Core.getHero(resumed.state, b.playerId).bot, false);
  const left = await service.leave(a.code, a.token);
  assert.equal(left.room.hostId, b.playerId);
  assert.equal(Core.getHero(left.state, a.playerId).bot, true);
  await assert.rejects(service.get(a.code, a.token), errorCode('forbidden', 403));
  await service.leave(a.code, b.token);
  await assert.rejects(service.get(a.code, b.token), errorCode('room_not_found', 404));
});

test('lobby leaves reclaim slots, rooms expire, and insert collisions retry safely', async () => {
  class CollidingStore extends MemoryRoomStore {
    attempts = 0;
    async insert(...args) { return ++this.attempts < 3 ? false : super.insert(...args); }
  }
  const { service, store, advance } = setup(CollidingStore);
  const { a, b } = await pair(service);
  assert.equal(store.attempts, 3);
  const left = await service.leave(a.code, a.token);
  assert.equal(left.room.hostId, b.playerId);
  assert.equal(left.room.players.length, 1);
  advance(30 * 60_000 + 1);
  await assert.rejects(service.get(a.code, b.token), errorCode('room_expired', 410));
  assert.equal(await store.load(a.code), null);
});

test('CAS retry does not commit losing writes and bounded action limits are durable', async () => {
  class ContendedStore extends MemoryRoomStore {
    misses = 0;
    async cas(...args) { if (this.misses-- > 0) return false; return super.cas(...args); }
  }
  const { service, store } = setup(ContendedStore);
  const a = await service.create(profile());
  await service.start(a.code, a.token);
  store.misses = 3;
  const accepted = await service.action(a.code, a.token, command(1));
  assert.equal(accepted.ackSeq, 1);
  const row = await store.load(a.code);
  assert.equal(row.data.players[0].actions.tokens, 24);
  for (let seq = 2; seq <= 25; seq++) await service.action(a.code, a.token, command(seq));
  await assert.rejects(service.action(a.code, a.token, command(26)), errorCode('rate_limited', 429));
  assert.equal((await store.load(a.code)).data.players[0].lastSeq, 25);
});

async function sqliteStore() {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(':memory:');
  const sql = await readFile(new URL('../drizzle/0000_emberfall_rooms.sql', import.meta.url), 'utf8');
  database.exec(sql.replaceAll('--> statement-breakpoint', ''));
  const db = {
    prepare(sql) {
      return { bind(...values) {
        return {
          async first() { return database.prepare(sql).get(...values) || null; },
          async run() { return { meta: { changes: Number(database.prepare(sql).run(...values).changes) } }; }
        };
      } };
    }
  };
  return { store: new D1RoomStore(db), database };
}

test('D1 SQL adapter and migration execute against real SQLite with optimistic version guards', async () => {
  const { store, database } = await sqliteStore();
  try {
    assert.equal(await store.insert('ABC234', { test: 1 }, 100), true);
    assert.equal(await store.insert('ABC234', { test: 999 }, 100), false);
    assert.equal(await store.cas('ABC234', 99, { test: 9 }, 200), false);
    assert.equal(await store.cas('ABC234', 1, { test: 2 }, 200), true);
    assert.deepEqual(await store.load('ABC234'), { version: 2, expiresAt: 200, data: { test: 2 } });
    assert.equal(await store.remove('ABC234', 1), false);
    await store.cleanup(199);
    assert.ok(await store.load('ABC234'));
    await store.cleanup(200);
    assert.equal(await store.load('ABC234'), null);
  } finally { database.close(); }
});

async function listen(service) {
  const server = createNodeServer({ service });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function httpClient(base) {
  return {
    credentials: null,
    async call(route, body, token = this.credentials?.token) {
      const response = await fetch(base + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    }
  };
}

test('REAL HTTP: two independent clients through separate services share D1 movement, damage and isolation', async () => {
  const { store, database } = await sqliteStore();
  let time = 2_000_000;
  const first = await listen(makeRoomService({ store, now: () => time, random: () => 0.4 }));
  const second = await listen(makeRoomService({ store, now: () => time, random: () => 0.9 }));
  try {
    const a = httpClient(first.url);
    const b = httpClient(second.url);
    const created = await a.call('/api/rooms', profile('Альфа', 'aster', 0));
    assert.equal(created.status, 201);
    a.credentials = created.body;
    const code = a.credentials.code;
    const joined = await b.call(`/api/rooms/${code}/join`, profile('Бета', 'lyra', 1));
    assert.equal(joined.status, 200);
    b.credentials = joined.body;
    assert.notEqual(a.credentials.token, b.credentials.token);
    assert.equal((await b.call(`/api/rooms/${code}/start`, {})).status, 403);
    const started = await a.call(`/api/rooms/${code}/start`, {});
    assert.equal(started.status, 200);
    const original = Core.getHero(started.body.state, a.credentials.playerId);
    const move = await a.call(`/api/rooms/${code}/action`, command(1, { type: 'move', x: 1_100, y: 1_300 }));
    assert.equal(move.status, 200);
    time += 1_000;
    const observed = await b.call(`/api/rooms/${code}`);
    assert.equal(observed.status, 200);
    const moved = Core.getHero(observed.body.state, a.credentials.playerId);
    assert.ok(Math.hypot(moved.x - original.x, moved.y - original.y) > 10);
    const confirmed = await a.call(`/api/rooms/${code}`);
    assert.deepEqual(confirmed.body.state, observed.body.state);
    assert.ok(!JSON.stringify(observed.body).includes(a.credentials.token));
    assert.ok(!JSON.stringify(observed.body).includes('tokenHash'));
    const other = await b.call('/api/rooms', profile('Изоляция', 'volt'));
    assert.equal(other.status, 201);
    assert.equal((await b.call(`/api/rooms/${code}`, undefined, other.body.token)).status, 403);
    assert.equal((await httpClient(first.url).call(`/api/rooms/${code}`)).status, 401);
    assert.equal((await a.call(`/api/rooms/${code}/action`, { seq: 2, state: { hp: 1 }, action: { type: 'stop' } })).status, 400);
    assert.equal((await a.call(`/api/rooms/${code}/action`, command(2, { type: 'move', x: 1e99, y: 1 }))).status, 400);
    assert.equal((await a.call(`/api/rooms/${code}/action`, command(1, { type: 'stop' }))).body.duplicate, true);
    await a.call(`/api/rooms/${code}/action`, command(2, { type: 'move', x: 1_200, y: 1_200 }));
    await b.call(`/api/rooms/${code}/action`, command(1, { type: 'move', x: 1_215, y: 1_200 }));
    let beforeHit;
    for (let tick = 0; tick < 5; tick++) {
      time += 2_000;
      beforeHit = await a.call(`/api/rooms/${code}`);
      await b.call(`/api/rooms/${code}`);
    }
    const target = Core.getHero(beforeHit.body.state, b.credentials.playerId);
    const hit = await a.call(`/api/rooms/${code}/action`, command(3, { type: 'cast', slot: 2, x: target.x, y: target.y, targetId: target.id }));
    assert.equal(hit.status, 200);
    assert.equal(hit.body.actionResult.ok, true);
    const firstImpact = Core.getHero(hit.body.state, b.credentials.playerId);
    // Enemy support bots can shield their teammate. Damage must first consume that shield.
    assert.ok(firstImpact.hp + firstImpact.shield < target.hp + target.shield);
    const burst = await a.call(`/api/rooms/${code}/action`, command(4, { type: 'cast', slot: 3, x: target.x, y: target.y, targetId: target.id }));
    assert.equal(burst.status, 200);
    assert.equal(burst.body.actionResult.ok, true);
    const hurt = Core.getHero(burst.body.state, b.credentials.playerId);
    assert.ok(hurt.hp < target.hp, 'Server-authoritative spell combo must reduce opponent HP through its shield');
    const damageObserved = await b.call(`/api/rooms/${code}`);
    assert.equal(Core.getHero(damageObserved.body.state, b.credentials.playerId).hp, hurt.hp);
    assert.deepEqual((await a.call(`/api/rooms/${code}`)).body.state, damageObserved.body.state);
    const oversized = await fetch(first.url + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(5_000) }) });
    assert.equal(oversized.status, 413);
    const malformed = await fetch(first.url + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(malformed.status, 400);
    assert.equal((await fetch(first.url + '/api/rooms', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await a.call(`/api/rooms/${code}/leave`, {})).status, 200);
    assert.equal((await a.call(`/api/rooms/${code}`)).status, 403);
    assert.equal((await b.call(`/api/rooms/${code}`)).body.room.hostId, b.credentials.playerId);
  } finally {
    await close(first.server);
    await close(second.server);
    database.close();
  }
});
