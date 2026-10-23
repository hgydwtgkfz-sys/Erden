import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import Worker from '../dist/server/index.js';
import SourceWorker from '../worker/index.js';

// Import the actual built Worker modules. Requests never leave this process.
const origin = 'https://emberfall.test';
const load = relative => readFile(new URL(relative, import.meta.url), 'utf8');
function request(route, { method = 'GET', token, body, ip = 'test-player' } = {}) {
  const headers = { 'CF-Connecting-IP': ip, ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(origin + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(worker, env, route, options) {
  const response = await worker.fetch(request(route, options), env);
  const body = await response.json();
  assert.match(response.headers.get('content-type'), /^application\/json(?:; charset=utf-8)?$/i);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, body, response };
}
function sqliteBinding(sql) {
  const database = new DatabaseSync(':memory:');
  database.exec(sql.replaceAll('--> statement-breakpoint', ''));
  const queries = [];
  const DB = {
    prepare(statement) {
      queries.push(statement);
      return {
        bind(...values) {
          return {
            async first() { return database.prepare(statement).get(...values) || null; },
            async run() { return { meta: { changes: Number(database.prepare(statement).run(...values).changes) } }; }
          };
        }
      };
    }
  };
  return { DB, database, queries };
}

test('Built Worker imports as real ESM, both generated entrypoints match and all frontend assets are exact', async () => {
  assert.equal(typeof Worker.fetch, 'function'); assert.equal(typeof SourceWorker.fetch, 'function');
  assert.equal(await load('../dist/server/index.js'), await load('../worker/index.js'));
  const assets = [
    ['/', '../public/index.html', 'text/html'],
    ['/index.html', '../public/index.html', 'text/html'],
    ['/styles.css', '../public/styles.css', 'text/css'],
    ['/game-core.js', '../public/game-core.js', 'text/javascript'],
    ['/renderer.js', '../public/renderer.js', 'text/javascript'],
    ['/app.js', '../public/app.js', 'text/javascript']
  ];
  for (const [route, file, type] of assets) {
    const response = await Worker.fetch(request(route + '?cache=independent'), {});
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('content-type'), type + '; charset=utf-8', route);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(await response.text(), await load(file), route + ' must serve the current checked source');
    const head = await Worker.fetch(request(route, { method: 'HEAD' }), {});
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-type'), type + '; charset=utf-8');
  }
});

test('Offline HTML download is truly standalone and preserved phone aliases return the original artifact', async () => {
  const response = await Worker.fetch(request('/Emberfall.html'), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Emberfall.html"');
  const standalone = await response.text();
  assert.equal(standalone, await load('../Emberfall.html'));
  assert.ok(standalone.includes('root.BattleCore = api;'));
  assert.ok(standalone.includes('window.BattleRenderer') || standalone.includes('root.BattleRenderer'));
  assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(standalone));
  assert.ok(!/<link\b[^>]*rel=["']stylesheet["']/i.test(standalone));
  const downloadHead = await Worker.fetch(request('/Emberfall.html', { method: 'HEAD' }), {});
  assert.equal(downloadHead.headers.get('content-disposition'), response.headers.get('content-disposition'));
  assert.equal(await downloadHead.text(), '');
  const phone = await load('../public/phone/index.html');
  for (const route of ['/phone', '/phone/', '/phone/index.html']) {
    const result = await Worker.fetch(request(route), {});
    assert.equal(result.status, 200); assert.equal(result.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await result.text(), phone, route + ' must preserve Pocket Lab');
    const head = await Worker.fetch(request(route, { method: 'HEAD' }), {});
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  }
});

test('Static missing routes and forbidden methods return real errors, APIs without DB return honest 503', async () => {
  for (const route of ['/not-a-route', '/missing.js', '/phone/missing.html', '/server/rooms.mjs', '/.openai/hosting.json']) {
    const response = await Worker.fetch(request(route), {});
    assert.equal(response.status, 404, route); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const denied = await Worker.fetch(request('/', { method: 'POST', body: {} }), {});
  assert.equal(denied.status, 405);
  for (const route of ['/api/rooms', '/api/rooms/ABC234']) {
    const unavailable = await call(Worker, {}, route, route === '/api/rooms' ? { method: 'POST', body: { name: 'Игрок', heroId: 'aster' } } : undefined);
    assert.equal(unavailable.status, 503); assert.equal(unavailable.body.error, 'storage_unavailable');
    assert.match(unavailable.body.message, /база комнат не подключена/);
  }
});

test('Actual bundled Worker API creates, joins and starts two independent tokens through real SQLite D1 SQL', async () => {
  const sql = await load('../drizzle/0000_emberfall_rooms.sql');
  const { DB, database, queries } = sqliteBinding(sql), env = { DB };
  const originalNow = Date.now; let now = 2000000; Date.now = () => now;
  try {
    const a = await call(Worker, env, '/api/rooms', { method: 'POST', body: { name: 'Первый', heroId: 'aster', team: 0 }, ip: 'first' });
    assert.equal(a.status, 201); assert.match(a.body.code, /^[A-HJ-NP-Z2-9]{6}$/); assert.match(a.body.token, /^[a-f0-9]{64}$/);
    const code = a.body.code, host = a.body.token;
    const b = await call(SourceWorker, env, `/api/rooms/${code}/join`, { method: 'POST', body: { name: 'Второй', heroId: 'lyra', team: 1 }, ip: 'second' });
    assert.equal(b.status, 200); assert.notEqual(b.body.token, host); assert.notEqual(b.body.playerId, a.body.playerId);
    assert.equal(b.body.room.players.length, 2);
    const guest = b.body.token;
    assert.equal((await call(SourceWorker, env, `/api/rooms/${code}/start`, { method: 'POST', token: guest, body: {} })).status, 403);
    assert.equal((await call(SourceWorker, env, `/api/rooms/${code}`)).status, 401);
    const started = await call(Worker, env, `/api/rooms/${code}/start`, { method: 'POST', token: host, body: {} });
    assert.equal(started.status, 200); assert.equal(started.body.room.status, 'playing');
    assert.equal(started.body.state.heroes.length, 10); assert.equal(started.body.state.heroes.filter(hero => !hero.bot).length, 2);
    const before = started.body.state.heroes.find(hero => hero.playerId === a.body.playerId);
    const move = await call(Worker, env, `/api/rooms/${code}/action`, { method: 'POST', token: host, body: { seq: 1, action: { type: 'move', x: 1100, y: 1300 } } });
    assert.equal(move.status, 200); assert.equal(move.body.actionResult.ok, true); assert.equal(move.body.ackSeq, 1);
    now += 1000;
    const observed = await call(SourceWorker, env, `/api/rooms/${code}`, { token: guest });
    const moved = observed.body.state.heroes.find(hero => hero.playerId === a.body.playerId);
    assert.ok(Math.hypot(moved.x - before.x, moved.y - before.y) > 10, 'A second Worker must observe authoritative movement persisted by the first');
    assert.deepEqual((await call(Worker, env, `/api/rooms/${code}`, { token: host })).body.state, observed.body.state);
    const replay = await call(SourceWorker, env, `/api/rooms/${code}/action`, { method: 'POST', token: host, body: { seq: 1, action: { type: 'move', x: 50, y: 50 } } });
    assert.equal(replay.body.duplicate, true); assert.deepEqual(replay.body.state.heroes.find(hero => hero.playerId === a.body.playerId).moveTarget, { x: 1100, y: 1300 });
    const spoof = await call(Worker, env, `/api/rooms/${code}/action`, { method: 'POST', token: host, body: { seq: 2, action: { type: 'move', playerId: b.body.playerId, x: 1, y: 1 } } });
    assert.equal(spoof.status, 400);
    const publicData = JSON.stringify(observed.body); assert.ok(!publicData.includes(host)); assert.ok(!publicData.includes(guest)); assert.ok(!publicData.includes('tokenHash'));
    const row = database.prepare('SELECT version, data_json FROM emberfall_rooms WHERE code = ?').get(code);
    assert.ok(row.version >= 5); assert.ok(!row.data_json.includes(host)); assert.ok(JSON.parse(row.data_json).players.every(player => /^[a-f0-9]{64}$/.test(player.tokenHash)));
    assert.ok(queries.some(statement => statement.startsWith('INSERT OR IGNORE')));
    assert.ok(queries.some(statement => statement.includes('AND version = ?')), 'The actual bundled D1 adapter must use guarded CAS writes');
    const left = await call(Worker, env, `/api/rooms/${code}/leave`, { method: 'POST', token: host, body: {} });
    assert.equal(left.status, 200); assert.equal(left.body.room.hostId, b.body.playerId);
    assert.equal((await call(SourceWorker, env, `/api/rooms/${code}`, { token: host })).status, 403);
  } finally { Date.now = originalNow; database.close(); }
});

test('Actual bundled API rejects invalid payloads and hides storage errors', async () => {
  const sql = await load('../drizzle/0000_emberfall_rooms.sql');
  const { DB, database } = sqliteBinding(sql);
  try {
    const invalid = await call(Worker, { DB }, '/api/rooms', { method: 'POST', body: { name: 'Третий', heroId: 'invented' } });
    assert.equal(invalid.status, 400); assert.equal(invalid.body.error, 'invalid_hero');
    const malformed = await Worker.fetch(new Request(origin + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }), { DB });
    assert.equal(malformed.status, 400);
    const unknown = await call(Worker, { DB }, '/api/unrelated'); assert.equal(unknown.status, 404);
    const brokenDB = { prepare() { throw new Error('secret SQL failure: internal_credentials'); } };
    const failed = await call(Worker, { DB: brokenDB }, '/api/rooms', { method: 'POST', body: { name: 'Четвёртый', heroId: 'volt' }, ip: 'storage-test' });
    assert.equal(failed.status, 503); assert.equal(failed.body.error, 'service_unavailable');
    assert.ok(!JSON.stringify(failed.body).includes('internal_credentials'));
  } finally { database.close(); }
});
