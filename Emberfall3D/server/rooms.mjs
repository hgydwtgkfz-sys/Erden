import '../public/game-core.js';

const Core = globalThis.BattleCore;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HERO_IDS = new Set(['aster', 'lyra', 'cinder', 'thorn', 'nyx', 'volt']);
const TICK_MS = 50;
const MAX_CATCH_UP_MS = 2_000;
const BODY_LIMIT = 4_096;
const LOBBY_TTL = 30 * 60_000;
const PLAY_TTL = 15 * 60_000;
const FINISHED_TTL = 5 * 60_000;
const DISCONNECT_MS = 15_000;
const MAX_RETRIES = 12;
const clone = value => structuredClone(value);

export class RoomError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => { throw new RoomError(status, code, message); };

/** Stores only SHA-256 digests of bearer tokens. Returned credentials are never in snapshots. */
async function digest(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
function secret(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
function roomCode() {
  // 32-symbol alphabet: masking is unbiased. INSERT's unique key resolves collisions.
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), value => CODE_ALPHABET[value & 31]).join('');
}
function validCode(code) {
  if (typeof code !== 'string') fail(400, 'invalid_code', 'Неверный код комнаты.');
  code = code.toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) fail(400, 'invalid_code', 'Код комнаты содержит 6 букв или цифр.');
  return code;
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    fail(400, 'invalid_fields', 'Переданы неподдерживаемые поля.');
  }
}
function profile(input) {
  keys(input, ['name', 'heroId', 'team']);
  if (typeof input.name !== 'string') fail(400, 'invalid_name', 'Укажите имя игрока.');
  const name = input.name.normalize('NFC').trim();
  if (name.length < 1 || [...name].length > 24 || /[\u0000-\u001f\u007f-\u009f<>]/u.test(name)) {
    fail(400, 'invalid_name', 'Имя: от 1 до 24 символов без управляющих знаков.');
  }
  if (!HERO_IDS.has(input.heroId)) fail(400, 'invalid_hero', 'Выберите одного из шести героев.');
  if (input.team !== undefined && input.team !== 0 && input.team !== 1) {
    fail(400, 'invalid_team', 'Номер команды должен быть 0 или 1.');
  }
  return { name, heroId: input.heroId, team: input.team };
}
function actionInput(input) {
  keys(input, ['seq', 'action']);
  if (!Number.isSafeInteger(input.seq) || input.seq < 1 || input.seq > 2_147_483_647) {
    fail(400, 'invalid_sequence', 'Неверный номер команды.');
  }
  const action = input.action;
  if (!object(action) || typeof action.type !== 'string') fail(400, 'invalid_action', 'Неверная команда.');
  const point = () => {
    if (!Number.isFinite(action.x) || !Number.isFinite(action.y) ||
        action.x < 0 || action.y < 0 || action.x > Core.MAP.width || action.y > Core.MAP.height) {
      fail(400, 'invalid_position', 'Цель должна находиться на карте.');
    }
  };
  const target = () => {
    if (typeof action.targetId !== 'string' || !/^[\w-]{1,80}$/.test(action.targetId)) {
      fail(400, 'invalid_target', 'Неверная цель.');
    }
  };
  switch (action.type) {
    case 'move':
    case 'attackMove':
      keys(action, ['type', 'x', 'y']); point(); break;
    case 'attack':
      keys(action, ['type', 'targetId']); target(); break;
    case 'cast':
      keys(action, ['type', 'slot', 'x', 'y', 'targetId']); point();
      if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot > 3) {
        fail(400, 'invalid_spell', 'Неверный номер способности.');
      }
      if (action.targetId !== undefined) target();
      break;
    case 'buy':
      keys(action, ['type', 'itemId']);
      if (typeof action.itemId !== 'string' || !Core.ITEMS.some(item => item.id === action.itemId)) {
        fail(400, 'invalid_item', 'Неизвестный предмет.');
      }
      break;
    case 'recall':
    case 'stop': keys(action, ['type']); break;
    default: fail(400, 'invalid_action', 'Неизвестная команда.');
  }
  return { seq: input.seq, action: clone(action) };
}

/** In-memory adapter is intentionally local-only; hosted Worker must use D1RoomStore. */
export class MemoryRoomStore {
  constructor() { this.rows = new Map(); }
  async load(code) { return this.rows.has(code) ? clone(this.rows.get(code)) : null; }
  async insert(code, data, expiresAt) {
    if (this.rows.has(code)) return false;
    this.rows.set(code, { version: 1, data: clone(data), expiresAt });
    return true;
  }
  async cas(code, version, data, expiresAt) {
    if (this.rows.get(code)?.version !== version) return false;
    this.rows.set(code, { version: version + 1, data: clone(data), expiresAt });
    return true;
  }
  async remove(code, version) {
    if (this.rows.get(code)?.version !== version) return false;
    this.rows.delete(code);
    return true;
  }
  async cleanup(now) {
    let count = 0;
    for (const [code, row] of this.rows) {
      if (row.expiresAt <= now && count++ < 32) this.rows.delete(code);
    }
  }
}

/** One statement per prepare; all table creation is handled by schema migrations. */
export class D1RoomStore {
  constructor(db) {
    if (!db || typeof db.prepare !== 'function') throw new Error('D1 binding DB is required');
    this.db = db;
  }
  async load(code) {
    const row = await this.db.prepare('SELECT version, expires_at, data_json FROM emberfall_rooms WHERE code = ?').bind(code).first();
    return row ? { version: row.version, expiresAt: row.expires_at, data: JSON.parse(row.data_json) } : null;
  }
  async insert(code, data, expiresAt) {
    const result = await this.db.prepare('INSERT OR IGNORE INTO emberfall_rooms (code, version, expires_at, data_json) VALUES (?, 1, ?, ?)')
      .bind(code, expiresAt, JSON.stringify(data)).run();
    return Number(result.meta?.changes) === 1;
  }
  async cas(code, version, data, expiresAt) {
    const result = await this.db.prepare('UPDATE emberfall_rooms SET version = version + 1, expires_at = ?, data_json = ? WHERE code = ? AND version = ?')
      .bind(expiresAt, JSON.stringify(data), code, version).run();
    return Number(result.meta?.changes) === 1;
  }
  async remove(code, version) {
    const result = await this.db.prepare('DELETE FROM emberfall_rooms WHERE code = ? AND version = ?').bind(code, version).run();
    return Number(result.meta?.changes) === 1;
  }
  async cleanup(now) {
    await this.db.prepare('DELETE FROM emberfall_rooms WHERE code IN (SELECT code FROM emberfall_rooms WHERE expires_at <= ? LIMIT 32)').bind(now).run();
  }
}

function consume(bucket, now, capacity, perSecond) {
  const available = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) * perSecond / 1_000);
  if (available < 1) fail(429, 'rate_limited', 'Слишком много запросов. Подождите немного.');
  bucket.tokens = available - 1;
  bucket.at = now;
}
function snapshot(data, version, now, playerId, extra = {}) {
  return {
    room: {
      code: data.code, version, status: data.status, hostId: data.hostId,
      createdAt: data.createdAt, startedAt: data.startedAt ?? null,
      maxPlayers: 10, pollInterval: 250,
      players: data.players.map(player => ({
        id: player.id, name: player.name, heroId: player.heroId, team: player.team,
        connected: !player.left && now - player.lastSeen < DISCONNECT_MS
      }))
    },
    ...(data.state ? { state: clone(data.state) } : {}),
    serverTime: now,
    playerId,
    ackSeq: data.players.find(player => player.id === playerId)?.lastSeq ?? 0,
    ...extra
  };
}
function advance(data, now) {
  if (data.status !== 'playing') return;
  for (const player of data.players) {
    const hero = Core.getHero(data.state, player.id);
    if (hero) hero.bot = !!player.left || now - player.lastSeen >= DISCONNECT_MS;
  }
  const elapsed = Math.max(0, now - data.lastTick);
  const bounded = Math.min(MAX_CATCH_UP_MS, elapsed);
  const steps = Math.floor(bounded / TICK_MS);
  for (let tick = 0; tick < steps && data.state.status === 'playing'; tick++) Core.step(data.state, 0.05);
  data.lastTick = elapsed > MAX_CATCH_UP_MS ? now - (elapsed % TICK_MS) : data.lastTick + steps * TICK_MS;
  if (data.state.status === 'finished') data.status = 'finished';
}
function ttl(data) { return data.status === 'lobby' ? LOBBY_TTL : data.status === 'finished' ? FINISHED_TTL : PLAY_TTL; }

export function makeRoomService({ store, now = Date.now, random = Math.random } = {}) {
  if (!store) throw new Error('A room store is required');
  if (!Core?.createGame || !Core?.step || !Core?.command) throw new Error('BattleCore is not loaded');
  const addressLimits = new Map();

  function entranceLimit(key, type) {
    const time = now();
    // This best-effort per-isolate IP throttle complements durable per-player limits.
    const bucketKey = `${type}:${key || 'local'}`;
    let bucket = addressLimits.get(bucketKey);
    if (!bucket) {
      if (addressLimits.size >= 2_048) {
        for (const [key, entry] of addressLimits) if (time - entry.at > 60_000) addressLimits.delete(key);
        if (addressLimits.size >= 2_048) addressLimits.delete(addressLimits.keys().next().value);
      }
      bucket = { tokens: type === 'create' ? 8 : 30, at: time };
      addressLimits.set(bucketKey, bucket);
    }
    consume(bucket, time, type === 'create' ? 8 : 30, type === 'create' ? 8 / 60 : 0.5);
  }

  async function mutate(code, token, operation) {
    code = validCode(code);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail(401, 'unauthorized', 'Нужен секретный токен игрока.');
    const tokenHash = await digest(token);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const record = await store.load(code);
      if (!record) fail(404, 'room_not_found', 'Комната не найдена.');
      const time = now();
      if (record.expiresAt <= time) {
        await store.remove(code, record.version);
        fail(410, 'room_expired', 'Срок жизни комнаты истёк. Создайте новую.');
      }
      const data = record.data;
      const player = data.players.find(player => player.tokenHash === tokenHash && !player.left);
      if (!player) fail(403, 'forbidden', 'Токен не относится к этой комнате.');
      consume(player.requests, time, 45, 30);
      player.lastSeen = time;
      advance(data, time);
      const outcome = await operation(data, player, time) || {};
      const expiresAt = time + ttl(data);
      const committed = outcome.remove
        ? await store.remove(code, record.version)
        : await store.cas(code, record.version, data, expiresAt);
      if (committed) return snapshot(data, record.version + 1, time, player.id, outcome.extra);
      // Retry from persisted state. Commands/step never escape until CAS succeeds.
    }
    fail(409, 'room_busy', 'Комната занята. Повторите запрос.');
  }

  const service = {
    async create(input, address = 'local') {
      const info = profile(input);
      entranceLimit(address, 'create');
      const time = now();
      await store.cleanup(time);
      const token = secret();
      const player = {
        id: `p_${secret(12)}`, ...info, team: info.team ?? 0,
        tokenHash: await digest(token), lastSeq: 0, lastSeen: time, left: false,
        actions: { tokens: 25, at: time }, requests: { tokens: 45, at: time }
      };
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = roomCode();
        const data = {
          code, hostId: player.id, status: 'lobby', players: [player], createdAt: time,
          lastTick: time, seed: (Math.floor(random() * 0x7ffffffe) + 1) >>> 0
        };
        if (await store.insert(code, data, time + LOBBY_TTL)) {
          return { code, token, ...snapshot(data, 1, time, player.id) };
        }
      }
      fail(503, 'code_collision', 'Не удалось выделить код комнаты. Повторите запрос.');
    },
    async join(code, input, address = 'local') {
      code = validCode(code);
      const info = profile(input);
      entranceLimit(address, 'join');
      const token = secret();
      const tokenHash = await digest(token);
      const playerId = `p_${secret(12)}`;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const record = await store.load(code);
        if (!record) fail(404, 'room_not_found', 'Комната не найдена.');
        const time = now();
        if (record.expiresAt <= time) fail(410, 'room_expired', 'Срок жизни комнаты истёк.');
        const data = record.data;
        if (data.status !== 'lobby') fail(409, 'already_started', 'Матч уже начался.');
        if (data.players.length >= 10) fail(409, 'room_full', 'В комнате уже 10 игроков.');
        const counts = [0, 0];
        for (const player of data.players) counts[player.team]++;
        const team = info.team ?? (counts[0] <= counts[1] ? 0 : 1);
        if (counts[team] >= 5) fail(409, 'team_full', 'В этой команде уже 5 игроков.');
        data.players.push({
          id: playerId, name: info.name, heroId: info.heroId, team, tokenHash,
          lastSeq: 0, lastSeen: time, left: false,
          actions: { tokens: 25, at: time }, requests: { tokens: 45, at: time }
        });
        if (await store.cas(code, record.version, data, time + LOBBY_TTL)) {
          return { code, token, ...snapshot(data, record.version + 1, time, playerId) };
        }
      }
      fail(409, 'room_busy', 'Комната занята. Повторите запрос.');
    },
    async get(code, token) { return mutate(code, token, () => {}); },
    async start(code, token) {
      return mutate(code, token, (data, player, time) => {
        if (data.hostId !== player.id) fail(403, 'host_only', 'Начать матч может только создатель комнаты.');
        if (data.status !== 'lobby') return;
        data.state = Core.createGame({
          seed: data.seed, difficulty: 'normal', mode: 'online',
          players: data.players.map(({ id, name, heroId, team }) => ({ id, name, heroId, team }))
        });
        data.status = 'playing';
        data.startedAt = time;
        data.lastTick = time;
      });
    },
    async action(code, token, input) {
      const { seq, action } = actionInput(input);
      return mutate(code, token, (data, player, time) => {
        if (data.status !== 'playing') fail(409, 'not_playing', 'Матч не идёт.');
        if (seq <= player.lastSeq) return { extra: { duplicate: true, actionResult: { ok: true } } };
        consume(player.actions, time, 25, 20);
        const result = Core.command(data.state, player.id, action);
        player.lastSeq = seq;
        // Legal but unavailable commands consume their sequence as well.
        return { extra: { actionResult: { ok: !!result?.ok, ...(result?.error ? { error: String(result.error) } : {}) } } };
      });
    },
    async leave(code, token) {
      return mutate(code, token, (data, player) => {
        player.left = true;
        player.tokenHash = '';
        if (data.status === 'lobby') data.players = data.players.filter(item => item.id !== player.id);
        else {
          const hero = Core.getHero(data.state, player.id);
          if (hero) hero.bot = true;
        }
        const remaining = data.players.filter(item => !item.left);
        if (data.hostId === player.id) data.hostId = remaining[0]?.id ?? null;
        return { remove: remaining.length === 0, extra: { left: true } };
      });
    },
    async fetch(request) {
      try {
        const url = new URL(request.url);
        const match = url.pathname.match(/^\/api\/rooms(?:\/([^/]+)(?:\/(join|start|action|leave))?)?\/?$/);
        if (!match) fail(404, 'not_found', 'Маршрут не найден.');
        const [, code, operation] = match;
        const method = request.method.toUpperCase();
        let result;
        if (!code && method === 'POST') {
          result = await service.create(await readJson(request), request.headers.get('cf-connecting-ip') || 'local');
        } else if (code && operation === 'join' && method === 'POST') {
          result = await service.join(code, await readJson(request), request.headers.get('cf-connecting-ip') || 'local');
        } else if (code && !operation && method === 'GET') {
          result = await service.get(code, bearer(request));
        } else if (code && ['start', 'action', 'leave'].includes(operation) && method === 'POST') {
          const input = await readJson(request);
          if (operation !== 'action') keys(input, []);
          result = await service[operation](code, bearer(request), input);
        } else fail(405, 'method_not_allowed', 'Метод не поддерживается.');
        return json(result, !code ? 201 : 200);
      } catch (error) {
        if (error instanceof RoomError) return json({ error: error.code, message: error.message }, error.status);
        // Internal storage errors must not disclose SQL, credentials or saved game data.
        return json({ error: 'service_unavailable', message: 'Сервер временно недоступен. Повторите запрос.' }, 503);
      }
    }
  };
  return service;
}

function bearer(request) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/);
  if (!match) fail(401, 'unauthorized', 'Нужен секретный токен игрока.');
  return match[1];
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    fail(415, 'json_required', 'Используйте application/json.');
  }
  if (Number(request.headers.get('content-length')) > BODY_LIMIT) fail(413, 'body_too_large', 'Слишком большой запрос.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_json', 'Нужен JSON-объект.');
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) { await reader.cancel(); fail(413, 'body_too_large', 'Слишком большой запрос.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'invalid_json', 'Не удалось прочитать JSON.'); }
  if (!object(input)) fail(400, 'invalid_json', 'Нужен JSON-объект.');
  return input;
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(status === 429 ? { 'Retry-After': '1' } : {})
    }
  });
}
