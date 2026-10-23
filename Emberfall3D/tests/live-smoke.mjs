// Explicit opt-in integration check against the ACTUAL deployed HTTP API.
// Tokens exist only in memory. Both temporary players leave in finally.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.argv.includes('--live')) {
  await main();
}

async function main() {
  const args = process.argv.slice(2).filter(value => value !== '--live');
  const base = new URL(args[0] || 'https://emberfall-3d.quietchub17.chatgpt.site');
  assert.equal(base.protocol, 'https:', 'Run only against the approved HTTPS deployment');
  const output = resolve(args[1] || '../../outputs/Emberfall3D/online-verification.json');
  const summary = { publicUrl: base.origin, checkedAt: new Date().toISOString(), transport: 'actual HTTPS fetch to public deployment', checks: [], cleanup: [], passed: false };
  try {
    const previous = JSON.parse(await readFile(output, 'utf8'));
    if (previous.staticChecks?.length) {
      summary.staticVerification = { checkedAt: previous.checkedAt, completedAt: previous.completedAt, publicStaticPassed: previous.publicStaticPassed, staticChecks: previous.staticChecks };
    } else if (previous.staticVerification) summary.staticVerification = previous.staticVerification;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const clients = [];
  let code;
  const check = (name, details = {}) => { summary.checks.push({ name, passed: true, ...details }); console.log('PASS ' + name); };
  const pause = ms => new Promise(done => setTimeout(done, ms));
  async function request(route, { token, method = 'GET', body, expect = 200 } = {}) {
    const response = await fetch(new URL(route, base), {
      method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error'
    });
    const type = response.headers.get('content-type') || '';
    assert.match(type, /^application\/json/i, 'Expected API JSON, received HTTP ' + response.status);
    const result = await response.json();
    assert.equal(response.status, expect, `HTTP ${response.status}: ${result.error || ''} ${result.message || ''}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return result;
  }
  const own = (snapshot, client) => snapshot.state.heroes.find(hero => hero.playerId === client.id);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const get = client => request('/api/rooms/' + code, { token: client.token });
  const act = (client, action, seq = ++client.seq) => request(`/api/rooms/${code}/action`, { method: 'POST', token: client.token, body: { seq, action } });
  try {
    const first = await request('/api/rooms', { method: 'POST', body: { name: 'QA A', heroId: 'aster', team: 0 }, expect: 201 });
    code = first.code;
    clients.push({ token: first.token, id: first.playerId, seq: 0 });
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    const second = await request(`/api/rooms/${code}/join`, { method: 'POST', body: { name: 'QA B', heroId: 'aster', team: 1 } });
    clients.push({ token: second.token, id: second.playerId, seq: 0 });
    const [host, guest] = clients;
    assert.notEqual(host.token, guest.token); assert.notEqual(host.id, guest.id);
    assert.equal(second.room.players.length, 2);
    check('two independent authenticated players create and join', { players: 2, teams: [0, 1] });
    await request(`/api/rooms/${code}`, { expect: 401 });
    const denied = await request(`/api/rooms/${code}/start`, { method: 'POST', token: guest.token, body: {}, expect: 403 });
    assert.equal(denied.error, 'host_only');
    check('authentication and host-only start');
    const started = await request(`/api/rooms/${code}/start`, { method: 'POST', token: host.token, body: {} });
    assert.equal(started.room.status, 'playing'); assert.equal(started.state.heroes.length, 10);
    assert.equal(started.state.heroes.filter(hero => hero.bot).length, 8);
    assert.equal(started.state.heroes.filter(hero => !hero.bot).length, 2);
    check('authoritative 5 versus 5 match starts', { heroes: 10, humanPlayers: 2, bots: 8, structures: started.state.structures.length });
    const originalHost = structuredClone(own(started, host));
    const bought = await act(host, { type: 'buy', itemId: 'swiftboots' });
    assert.equal(bought.actionResult.ok, true); assert.equal(own(bought, host).items.filter(item => item === 'swiftboots').length, 1);
    const replayBuy = await act(host, { type: 'buy', itemId: 'swiftboots' }, host.seq);
    assert.equal(replayBuy.duplicate, true);
    assert.equal(own(replayBuy, host).items.filter(item => item === 'swiftboots').length, 1);
    assert.ok(own(replayBuy, host).gold < originalHost.gold - 250);
    const boughtGuest = await act(guest, { type: 'buy', itemId: 'swiftboots' });
    assert.equal(boughtGuest.actionResult.ok, true);
    check('shop purchase and sequence replay do not duplicate items', { item: 'swiftboots', itemCountAfterReplay: 1 });
    const beforeW = own(replayBuy, host);
    const shielded = await act(host, { type: 'cast', slot: 1, x: beforeW.x, y: beforeW.y });
    const afterW = own(shielded, host);
    assert.equal(shielded.actionResult.ok, true); assert.ok(afterW.shield >= 170);
    assert.ok(afterW.mana < beforeW.mana - 35); assert.ok(afterW.cooldowns[1] > 14);
    const rejectedW = await act(host, { type: 'cast', slot: 1, x: afterW.x, y: afterW.y });
    assert.equal(rejectedW.actionResult.ok, false); assert.match(rejectedW.actionResult.error, /восстанавливается/);
    check('W spends mana, creates shield and enforces cooldown', { manaBefore: beforeW.mana, manaAfter: afterW.mana, shield: afterW.shield, cooldown: afterW.cooldowns[1] });
    const targets = [{ x: 1000, y: 1500 }, { x: 1400, y: 1500 }];
    await act(host, { type: 'move', ...targets[0] });
    const moveSeq = host.seq;
    const replayMove = await act(host, { type: 'move', x: 50, y: 50 }, moveSeq);
    assert.equal(replayMove.duplicate, true); assert.deepEqual(own(replayMove, host).moveTarget, targets[0]);
    await act(guest, { type: 'move', ...targets[1] });
    let observation, closeEnough = false;
    const until = Date.now() + 25000;
    while (Date.now() < until) {
      await pause(400);
      observation = await get(guest);
      // Both tokens heartbeat independently; no disconnect replacement by a bot.
      await get(host);
      const a = own(observation, host), b = own(observation, guest);
      assert.equal(a.bot, false); assert.equal(b.bot, false);
      assert.equal(a.dead, false); assert.equal(b.dead, false);
      if (distance(a, b) <= 430 && distance(a, targets[0]) < 60 && distance(b, targets[1]) < 60) { closeEnough = true; break; }
    }
    const observedA = own(observation, host), observedB = own(observation, guest);
    const travelled = distance(originalHost, observedA);
    assert.ok(travelled > 500, 'Second independent token must observe remote authoritative movement');
    check('movement and replay protection visible to the other client', { observedDistance: Number(travelled.toFixed(2)), observedPosition: { x: observedA.x, y: observedA.y }, rejectedReplayTarget: { x: 50, y: 50 } });
    assert.ok(closeEnough, 'Both player heroes must approach normal legal combat range within 25 seconds');
    await act(host, { type: 'stop' });
    await act(guest, { type: 'stop' });
    const beforeCombat = await get(guest), victimBefore = own(beforeCombat, guest), casterBefore = own(beforeCombat, host);
    assert.ok(distance(casterBefore, victimBefore) <= 440);
    const cast = await act(host, { type: 'cast', slot: 2, targetId: victimBefore.id, x: victimBefore.x, y: victimBefore.y });
    assert.equal(cast.actionResult.ok, true, 'Aster E must be accepted');
    const victimAfter = own(cast, guest);
    const damage = victimBefore.hp + victimBefore.shield - victimAfter.hp - victimAfter.shield;
    assert.ok(damage > 40, 'Enemy HP/shield must actually decrease after the HTTP ability command');
    assert.equal(victimAfter.contributors[casterBefore.id], cast.state.time, 'Server records this exact caster as contributor at the cast simulation time');
    assert.ok(victimAfter.stun > 0.9, 'The ability applies its real stun');
    const enemyView = await get(guest), victimObserved = own(enemyView, guest);
    assert.ok(victimObserved.hp + victimObserved.shield < victimBefore.hp + victimBefore.shield - 40);
    const actualCaster = own(enemyView, host);
    assert.ok(actualCaster.cooldowns[2] > 11);
    check('real enemy damage and stun propagate to the other client', {
      ability: 'Aster E', distanceAtCast: Number(distance(casterBefore, victimBefore).toFixed(2)),
      victimHpBefore: victimBefore.hp, victimHpAfter: victimAfter.hp, victimShieldBefore: victimBefore.shield, victimShieldAfter: victimAfter.shield,
      combinedHpShieldLoss: Number(damage.toFixed(3)), stunAfter: victimAfter.stun,
      exactCasterContributionRecorded: true, secondClientObservedDamage: true,
      simulationTime: cast.state.time, cooldownObserved: actualCaster.cooldowns[2]
    });
    const serialized = JSON.stringify(enemyView);
    for (const client of clients) assert.ok(!serialized.includes(client.token));
    assert.ok(!serialized.includes('tokenHash'));
    check('snapshots contain no bearer tokens or token hashes');
    summary.passed = true;
    summary.remoteMatch = 'passed';
  } catch (error) {
    summary.error = String(error.message).replace(/[a-f0-9]{64}/g, '[redacted]');
    console.error('FAIL ' + summary.error);
    process.exitCode = 1;
    summary.remoteMatch = 'failed';
  } finally {
    for (const [index, client] of clients.entries()) {
      try {
        const left = await request(`/api/rooms/${code}/leave`, { method: 'POST', token: client.token, body: {} });
        assert.equal(left.left, true);
        summary.cleanup.push({ player: index + 1, left: true, remainingHost: left.room.hostId !== null });
      } catch (error) {
        summary.cleanup.push({ player: index + 1, left: false, error: String(error.message).replace(/[a-f0-9]{64}/g, '[redacted]') });
        summary.passed = false; process.exitCode = 1;
      }
    }
    if (clients.length && summary.cleanup.every(player => player.left)) {
      try {
        const removed = await request(`/api/rooms/${code}`, { token: clients[0].token, expect: 404 });
        assert.equal(removed.error, 'room_not_found');
        summary.roomDeleted = true;
        check('both players left and the disposable room was deleted', { httpStatusAfterLeave: 404 });
      } catch (error) {
        summary.roomDeleted = false;
        summary.cleanupVerificationError = String(error.message).replace(/[a-f0-9]{64}/g, '[redacted]');
        summary.passed = false; process.exitCode = 1;
      }
    }
    summary.completedAt = new Date().toISOString();
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ passed: summary.passed, checkCount: summary.checks.length, cleanup: summary.cleanup, output }));
  }
}
