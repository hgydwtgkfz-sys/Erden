(function (root, factory) {
  'use strict';
  var api = factory();
  root.BattleCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAP = {
    width: 2400, height: 2400,
    bases: [{ x: 220, y: 2180 }, { x: 2180, y: 220 }],
    lanes: [
      [{ x: 220, y: 2180 }, { x: 220, y: 1580 }, { x: 240, y: 850 }, { x: 360, y: 360 }, { x: 850, y: 240 }, { x: 1580, y: 220 }, { x: 2180, y: 220 }],
      [{ x: 220, y: 2180 }, { x: 700, y: 1700 }, { x: 1200, y: 1200 }, { x: 1700, y: 700 }, { x: 2180, y: 220 }],
      [{ x: 220, y: 2180 }, { x: 850, y: 2180 }, { x: 1580, y: 2160 }, { x: 2040, y: 2040 }, { x: 2160, y: 1580 }, { x: 2180, y: 850 }, { x: 2180, y: 220 }]
    ]
  };
  function ability(name, key, description, cooldown, mana, icon) {
    return { name: name, key: key, description: description, cooldown: cooldown, mana: mana, icon: icon };
  }
  var HEROES = [
    { id: 'aster', name: 'Астер', role: 'Страж', color: '#f5c970', description: 'Страж Рассвета. Врывается в бой и защищает союзников солнечными щитами.', hp: 1100, mana: 420, damage: 48, range: 86, speed: 148, abilities: [
      ability('Солнечный выпад', 'Q', 'Рывок к цели до 270. Урон и короткое оглушение в конце пути.', 9, 45, '➶'),
      ability('Клятва щита', 'W', 'Щит себе и ближайшим союзникам на 5 секунд.', 15, 55, '◈'),
      ability('Световой разлом', 'E', 'Урон и оглушение в области. Дальность 440.', 13, 60, '✧'),
      ability('Знамя рассвета', 'R', 'Мощный круг света: лечение и щиты союзникам, урон врагам.', 52, 110, '☀')
    ] },
    { id: 'lyra', name: 'Лира', role: 'Поддержка', color: '#60d7d0', description: 'Ткачиха Приливов. Лечит отряд и сдерживает врагов водоворотами.', hp: 760, mana: 620, damage: 39, range: 345, speed: 150, abilities: [
      ability('Жемчужная стрела', 'Q', 'Волна по прямой: урон и замедление. Дальность 650.', 7, 40, '❖'),
      ability('Лечебная волна', 'W', 'Лечит раненого союзника возле указателя или себя. Дальность 530.', 11, 65, '✚'),
      ability('Водоворот', 'E', 'Область на 4 секунды: периодический урон и замедление.', 15, 70, '◎'),
      ability('Прилив жизни', 'R', 'Лечит и очищает союзников рядом; бьёт врагов волной.', 56, 125, '≋')
    ] },
    { id: 'cinder', name: 'Синдер', role: 'Стрелок', color: '#ff985e', description: 'Пепельная Стрела. Держит дистанцию и накрывает линии огнём.', hp: 800, mana: 440, damage: 59, range: 390, speed: 154, abilities: [
      ability('Огненная стрела', 'Q', 'Пробивает врагов на прямой до 820. Урон каждой цели.', 8, 40, '➹'),
      ability('Пепельный шаг', 'W', 'Рывок до 260, щит и ускорение на 3 секунды.', 13, 45, '»'),
      ability('Горящая земля', 'E', 'Поджигает область на 5 секунд. Дальность 620.', 15, 65, '♨'),
      ability('Звёздный залп', 'R', 'Большой огненный взрыв в указанной области. Дальность 850.', 49, 110, '✹')
    ] },
    { id: 'thorn', name: 'Торн', role: 'Боец', color: '#95cf77', description: 'Хранитель Терний. Живучий воин, сковывающий врагов корнями.', hp: 1040, mana: 430, damage: 55, range: 90, speed: 145, abilities: [
      ability('Корневой удар', 'Q', 'Мощный удар по прямой: урон и замедление.', 7, 35, '❧'),
      ability('Живая кора', 'W', 'Лечит себя и даёт крепкий щит на 5 секунд.', 14, 55, '▣'),
      ability('Опутывание', 'E', 'Урон и корни на 1,7 секунды в выбранной области.', 13, 55, '♧'),
      ability('Зелёный исполин', 'R', 'Лечение, щит и усиление атак на 8 секунд; удар вокруг.', 51, 100, '♜')
    ] },
    { id: 'nyx', name: 'Никс', role: 'Убийца', color: '#bd96ff', description: 'Лунная Тень. Быстрые выпады, метки и завершающий удар.', hp: 820, mana: 460, damage: 61, range: 82, speed: 164, abilities: [
      ability('Лунный клинок', 'Q', 'Рывок до 350 и режущий круг в конце пути.', 8, 40, '☾'),
      ability('Теневой покров', 'W', 'Щит, ускорение и скрытность на 3 секунды. Вблизи вас видно.', 16, 55, '◐'),
      ability('Метка полумесяца', 'E', 'Урон и замедление. Ваш урон по отмеченной цели выше на 25%.', 12, 45, '⌖'),
      ability('Последний отсвет', 'R', 'Сильный удар, усиленный недостающим здоровьем врага. Дальность 480.', 47, 100, '✴')
    ] },
    { id: 'volt', name: 'Вольт', role: 'Маг', color: '#69c7ff', description: 'Искровой Архонт. Цепные молнии и грозовые области разрушают строй врага.', hp: 740, mana: 650, damage: 42, range: 350, speed: 149, abilities: [
      ability('Цепная искра', 'Q', 'Молния прыгает между четырьмя врагами, теряя часть силы.', 7, 45, 'ϟ'),
      ability('Молниеносный рывок', 'W', 'Рывок до 280, электрический удар вокруг и небольшой щит.', 14, 55, '↯'),
      ability('Грозовой круг', 'E', 'Урон и оглушение в области. Дальность 610.', 12, 65, '⊕'),
      ability('Сердце бури', 'R', 'Гроза на 5 секунд: первоначальный и периодический урон.', 54, 125, '☈')
    ] }
  ];
  var ITEMS = [
    { id: 'emberblade', name: 'Клинок углей', description: '+24 к атаке, +90 здоровья.', cost: 650, icon: '⚔', damage: 24, hp: 90 },
    { id: 'stormbow', name: 'Грозовая тетива', description: '+13 к атаке, +24% скорости атаки, +35 дальности.', cost: 720, icon: '➶', damage: 13, attackSpeed: .24, range: 35 },
    { id: 'moonlens', name: 'Лунная линза', description: '+30% силы умений, +180 маны.', cost: 620, icon: '◈', spellPower: .3, mana: 180 },
    { id: 'ironheart', name: 'Железное сердце', description: '+320 здоровья, +16% защиты от урона.', cost: 680, icon: '♥', hp: 320, armor: .16 },
    { id: 'swiftboots', name: 'Сапоги ветра', description: '+30 к скорости передвижения.', cost: 300, icon: '»', speed: 30 },
    { id: 'tidecharm', name: 'Оберег прилива', description: '+5 здоровья и +3 маны в секунду.', cost: 480, icon: '✚', regen: 5, manaRegen: 3 }
  ];
  var HERO_INDEX = {}, ITEM_INDEX = {};
  HEROES.forEach(function (h) { HERO_INDEX[h.id] = h; });
  ITEMS.forEach(function (i) { ITEM_INDEX[i.id] = i; });
  var laneLengths = MAP.lanes.map(function (lane) {
    var lengths = [0];
    for (var i = 1; i < lane.length; i++) lengths.push(lengths[i - 1] + distance(lane[i], lane[i - 1]));
    return lengths;
  });

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function distance(a, b) { var x = a.x - b.x, y = a.y - b.y; return Math.sqrt(x * x + y * y); }
  function dist2(a, b) { var x = a.x - b.x, y = a.y - b.y; return x * x + y * y; }
  function alive(unit) { return !!unit && !unit.dead && unit.hp > 0; }
  function boundedPoint(x, y) { return { x: clamp(x, 50, MAP.width - 50), y: clamp(y, 50, MAP.height - 50) }; }
  function hashSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return (seed >>> 0) || 1;
    var text = String(seed), hash = 2166136261;
    for (var i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0) || 1;
  }
  function random(state) {
    var x = state.rngState | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    state.rngState = x >>> 0;
    return state.rngState / 4294967296;
  }
  function uid(state, prefix) { return prefix + (state.nextId++); }
  function heroDefinition(id) { return Object.prototype.hasOwnProperty.call(HERO_INDEX, id) ? HERO_INDEX[id] : null; }
  function itemDefinition(id) { return Object.prototype.hasOwnProperty.call(ITEM_INDEX, id) ? ITEM_INDEX[id] : null; }
  function event(state, type, text, team) {
    var entry = { id: uid(state, 'ev'), time: state.time, type: type, text: text };
    if (team === 0 || team === 1) entry.team = team;
    state.events.push(entry);
    if (state.events.length > 32) state.events.splice(0, state.events.length - 32);
  }
  function effect(state, type, x, y, team, radius, color, life, extra) {
    var e = { id: uid(state, 'fx'), type: type, x: x, y: y, team: team, radius: radius || 50, color: color || (team === 0 ? '#78e5b1' : '#ff9879'), life: life || .6, maxLife: life || .6 };
    if (extra) Object.keys(extra).forEach(function (key) { e[key] = extra[key]; });
    state.effects.push(e);
    if (state.effects.length > 180) state.effects.shift();
    return e;
  }
  function projectile(state, from, to, color, kind) {
    var duration = Math.max(.08, distance(from, to) / 1050);
    state.projectiles.push({ id: uid(state, 'pr'), x: from.x, y: from.y, tx: to.x, ty: to.y, team: from.team, color: color, kind: kind || 'bolt', radius: 3, life: duration, maxLife: duration });
    if (state.projectiles.length > 120) state.projectiles.shift();
  }
  function pointOnLane(lane, progress) {
    var path = MAP.lanes[lane], lengths = laneLengths[lane];
    progress = clamp(progress, 0, lengths[lengths.length - 1]);
    for (var i = 1; i < path.length; i++) {
      if (progress <= lengths[i]) {
        var t = (progress - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
        return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
      }
    }
    return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  }
  function laneProgress(unit, lane) {
    var path = MAP.lanes[lane], lengths = laneLengths[lane], nearest = Infinity, progress = 0;
    for (var i = 1; i < path.length; i++) {
      var ax = path[i - 1].x, ay = path[i - 1].y, dx = path[i].x - ax, dy = path[i].y - ay;
      var t = clamp(((unit.x - ax) * dx + (unit.y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      var p = { x: ax + dx * t, y: ay + dy * t }, d = dist2(unit, p);
      if (d < nearest) { nearest = d; progress = lengths[i - 1] + t * (lengths[i] - lengths[i - 1]); }
    }
    return progress;
  }
  function laneForward(unit, step) { return pointOnLane(unit.lane, laneProgress(unit, unit.lane) + (unit.team === 0 ? step : -step)); }
  function getHero(state, playerId) {
    if (typeof playerId !== 'string' || !playerId) return null;
    for (var i = 0; i < state.heroes.length; i++) if (state.heroes[i].playerId === playerId) return state.heroes[i];
    return null;
  }
  function findUnit(state, id) {
    if (typeof id !== 'string') return null;
    var lists = [state.heroes, state.creeps, state.structures];
    for (var l = 0; l < lists.length; l++) for (var i = 0; i < lists[l].length; i++) if (lists[l][i].id === id) return lists[l][i];
    return null;
  }
  function isProtected(state, structure) {
    if (!structure || !structure.type || !alive(structure)) return false;
    if (structure.type === 'core') {
      for (var lane = 0; lane < 3; lane++) {
        var blocked = state.structures.some(function (s) { return s.team === structure.team && s.type === 'tower' && s.lane === lane && alive(s); });
        if (!blocked) return false;
      }
      return true;
    }
    return state.structures.some(function (s) { return s.team === structure.team && s.type === 'tower' && s.lane === structure.lane && s.tier < structure.tier && alive(s); });
  }
  function updateProtection(state) {
    state.structures.forEach(function (structure) { structure.protected = isProtected(state, structure); });
  }
  function visibleTo(unit, observer) { return !(unit.hiddenTime > 0) || distance(unit, observer) < 135; }
  function enemyUnits(state, team, includeStructures) {
    var list = state.heroes.concat(state.creeps);
    if (includeStructures) list = list.concat(state.structures);
    return list.filter(function (u) { return u.team !== team && alive(u) && (!u.type || !isProtected(state, u)); });
  }
  function nearestEnemy(state, from, radius, includeStructures, predicate) {
    var best = null, bestDistance = radius * radius;
    var candidates = enemyUnits(state, from.team, includeStructures);
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (!visibleTo(candidate, from) || (predicate && !predicate(candidate))) continue;
      var d = dist2(from, candidate);
      if (d < bestDistance) { best = candidate; bestDistance = d; }
    }
    return best;
  }
  function heroStats(hero) {
    var def = heroDefinition(hero.heroId), oldHp = hero.maxHp || 0, oldMana = hero.maxMana || 0;
    hero.maxHp = (def.hp + (hero.level - 1) * 83) * hero.strength;
    hero.maxMana = def.mana + (hero.level - 1) * 33;
    hero.damage = (def.damage + (hero.level - 1) * 4.8) * hero.strength;
    hero.range = def.range; hero.speed = def.speed;
    hero.armor = (def.id === 'aster' || def.id === 'thorn' ? .07 : .025) + (hero.level - 1) * .003;
    hero.regen = 2.6; hero.manaRegen = 2.7; hero.attackSpeed = 0; hero.spellPower = 0;
    hero.items.forEach(function (id) {
      var item = itemDefinition(id);
      if (!item) return;
      hero.maxHp += item.hp || 0; hero.maxMana += item.mana || 0; hero.damage += item.damage || 0;
      hero.range += item.range || 0; hero.speed += item.speed || 0; hero.armor += item.armor || 0;
      hero.regen += item.regen || 0; hero.manaRegen += item.manaRegen || 0;
      hero.attackSpeed += item.attackSpeed || 0; hero.spellPower += item.spellPower || 0;
    });
    if (!hero.dead) {
      hero.hp = clamp((hero.hp || 0) + hero.maxHp - oldHp, 0, hero.maxHp);
      hero.mana = clamp((hero.mana || 0) + hero.maxMana - oldMana, 0, hero.maxMana);
    }
    hero.xpToNext = 95 + hero.level * 45;
  }
  function createHero(state, team, slot, player, strength) {
    var def = heroDefinition(player && player.heroId) || HEROES[(slot + team * 3) % HEROES.length];
    var base = MAP.bases[team];
    var hero = {
      id: uid(state, 'h'), playerId: player ? String(player.id) : null, bot: !player,
      name: player ? String(player.name || def.name).slice(0, 32) : def.name + ' · ИИ', heroId: def.id,
      team: team, slot: slot, lane: [0, 1, 2, 1, 0][slot], x: base.x + (slot - 2) * 24, y: base.y + (slot % 2 ? 22 : -22),
      hp: 0, maxHp: 0, mana: 0, maxMana: 0, damage: 0, range: 0, speed: 0,
      level: 1, xp: 0, xpToNext: 140, gold: 600, kills: 0, deaths: 0, assists: 0, dead: false, respawn: 0,
      attackCooldown: .15 * slot, cooldowns: [0, 0, 0, 0], items: [], targetId: null, moveTarget: null,
      order: 'idle', recall: 0, shield: 0, shieldTime: 0, stun: 0, root: 0, slow: 0, slowTime: 0,
      hasteTime: 0, boostTime: 0, hiddenTime: 0, markTime: 0, markedBy: null, contributors: {},
      strength: strength, aiTimer: slot * .09, aiRetreat: false, facing: team === 0 ? -.78 : 2.36
    };
    heroStats(hero);
    return hero;
  }
  function createGame(options) {
    options = options && typeof options === 'object' ? options : {};
    var seed = hashSeed(options.seed === undefined ? 1 : options.seed);
    var state = {
      version: 1, seed: seed, rngState: seed, difficulty: ['easy', 'normal', 'hard'].includes(options.difficulty) ? options.difficulty : 'normal',
      mode: options.mode === 'online' ? 'online' : 'offline', time: 0, status: 'playing', winner: null, nextId: 1,
      heroes: [], creeps: [], structures: [], projectiles: [], effects: [], events: [], zones: [], kills: [0, 0],
      wave: 0, nextWave: 3, escalation: 0
    };
    var assignments = [new Array(5), new Array(5)], seen = Object.create(null);
    var players = Array.isArray(options.players) ? options.players.slice(0, 10) : [];
    players.forEach(function (player) {
      if (!player || typeof player.id !== 'string' || !player.id || player.id.length > 120 || Object.prototype.hasOwnProperty.call(seen, player.id)) return;
      var team = player.team === 0 || player.team === 1 ? player.team : (assignments[0].filter(Boolean).length <= assignments[1].filter(Boolean).length ? 0 : 1);
      var slot = Number.isInteger(player.slot) && player.slot >= 0 && player.slot < 5 && !assignments[team][player.slot] ? player.slot : assignments[team].findIndex(function (entry) { return !entry; });
      if (slot < 0) return;
      assignments[team][slot] = player; seen[player.id] = true;
    });
    var humanTeam = players.length && (players[0].team === 0 || players[0].team === 1) ? players[0].team : 0;
    for (var team = 0; team < 2; team++) {
      for (var slot = 0; slot < 5; slot++) {
        var strength = 1;
        if (state.difficulty === 'easy' && team !== humanTeam) strength = .84;
        if (state.difficulty === 'hard' && team !== humanTeam) strength = 1.14;
        state.heroes.push(createHero(state, team, slot, assignments[team][slot], strength));
      }
      for (var lane = 0; lane < 3; lane++) {
        var total = laneLengths[lane][laneLengths[lane].length - 1];
        for (var tier = 0; tier < 3; tier++) {
          // Tier zero is the outer tower, and must fall before the inner tiers.
          var progress = total * ([.40, .255, .125][tier]);
          var p = pointOnLane(lane, team === 0 ? progress : total - progress);
          var hp = [1800, 2150, 2450][tier];
          state.structures.push({ id: uid(state, 't'), type: 'tower', team: team, lane: lane, tier: tier, x: p.x, y: p.y, hp: hp, maxHp: hp, range: 360, damage: 92 + tier * 16, attackCooldown: 0, dead: false, targetId: null, protected: tier > 0 });
        }
      }
      state.structures.push({ id: uid(state, 'core'), type: 'core', team: team, x: MAP.bases[team].x, y: MAP.bases[team].y, hp: 5200, maxHp: 5200, range: 300, damage: 115, attackCooldown: 0, dead: false, targetId: null, protected: true });
    }
    updateProtection(state);
    event(state, 'start', 'Осколки пробудились. Защитите своё ядро и разрушьте вражеское.');
    return state;
  }

  function addXp(state, hero, amount) {
    if (!hero || hero.level >= 18 || !Number.isFinite(amount) || amount <= 0) return;
    hero.xp += amount;
    while (hero.level < 18 && hero.xp >= hero.xpToNext) {
      hero.xp -= hero.xpToNext; hero.level++;
      heroStats(hero);
      if (!hero.dead) effect(state, 'levelup', hero.x, hero.y, hero.team, 75, heroDefinition(hero.heroId).color, .9, { text: String(hero.level) });
    }
    if (hero.level === 18) hero.xp = 0;
  }
  function rewardNearby(state, target, team, xp) {
    var nearby = state.heroes.filter(function (h) { return h.team === team && alive(h) && distance(h, target) < 750; });
    nearby.forEach(function (hero) { addXp(state, hero, xp / Math.max(1, Math.sqrt(nearby.length))); });
  }
  function heal(state, hero, amount, visual) {
    if (!alive(hero)) return;
    var restored = Math.min(amount, hero.maxHp - hero.hp);
    hero.hp += restored;
    if (visual && restored > .5) effect(state, 'heal', hero.x, hero.y, hero.team, 65, '#75f4b5', .7, { text: '+' + Math.round(restored) });
  }
  function addShield(state, hero, amount, duration) {
    if (!alive(hero)) return;
    hero.shield = Math.min(hero.maxHp, hero.shield + amount);
    hero.shieldTime = Math.max(hero.shieldTime, duration);
    effect(state, 'shield', hero.x, hero.y, hero.team, 50, heroDefinition(hero.heroId).color, .8);
  }
  function die(state, target, source) {
    target.hp = 0; target.dead = true; target.targetId = null; target.moveTarget = null;
    var killer = source && source.heroId ? source : (source && source.ownerId ? findUnit(state, source.ownerId) : null);
    if (target.heroId) {
      target.deaths++; target.respawn = Math.min(32, 7 + target.level * 1.15 + state.time / 110);
      target.recall = 0; target.shield = 0; target.shieldTime = 0; target.hiddenTime = 0;
      target.stun = 0; target.root = 0; target.aiRetreat = false;
      state.kills[1 - target.team]++;
      if (killer && killer.team !== target.team) { killer.kills++; killer.gold += 170 + target.level * 12; addXp(state, killer, 80 + target.level * 12); }
      Object.keys(target.contributors).forEach(function (id) {
        var helper = findUnit(state, id);
        if (helper && helper !== killer && helper.team !== target.team && state.time - target.contributors[id] < 10) { helper.assists++; helper.gold += 65; addXp(state, helper, 45); }
      });
      rewardNearby(state, target, 1 - target.team, 40 + target.level * 5);
      var killerName = killer ? killer.name : source && source.type === 'tower' ? 'Башня' : 'Воины линии';
      event(state, 'kill', killerName + ' побеждает ' + target.name, 1 - target.team);
      effect(state, 'death', target.x, target.y, target.team, 100, heroDefinition(target.heroId).color, 1.2);
    } else if (target.type) {
      if (target.type === 'core') {
        state.status = 'finished'; state.winner = 1 - target.team;
        event(state, 'victory', (state.winner === 0 ? 'Изумрудный союз' : 'Пепельный легион') + ' разрушает вражеское ядро!', state.winner);
        effect(state, 'victory', target.x, target.y, state.winner, 500, state.winner === 0 ? '#8fffd0' : '#ffb080', 5);
      } else {
        state.heroes.forEach(function (hero) { if (hero.team !== target.team) { hero.gold += 110; addXp(state, hero, 60); } });
        if (killer) killer.gold += 70;
        event(state, 'tower', 'Башня ' + ['верхней', 'средней', 'нижней'][target.lane] + ' линии разрушена.', 1 - target.team);
        effect(state, 'burst', target.x, target.y, 1 - target.team, 165, '#ffd89b', 1.3);
      }
      updateProtection(state);
    } else {
      if (killer && killer.team !== target.team) killer.gold += target.bounty;
      rewardNearby(state, target, 1 - target.team, target.xp);
    }
  }
  function damage(state, source, target, amount, spell) {
    if (state.status !== 'playing' || !alive(target) || !source || source.team === target.team || amount <= 0 || !Number.isFinite(amount)) return 0;
    if (target.type && isProtected(state, target)) return 0;
    if (spell && target.type) amount *= .45;
    if (target.heroId) {
      if (target.markTime > 0 && target.markedBy === source.id) amount *= 1.25;
      amount *= 1 - Math.min(.65, target.armor || 0);
      target.recall = 0;
      if (source.heroId) target.contributors[source.id] = state.time;
      if (source.heroId) state.structures.forEach(function (tower) {
        if (tower.team === target.team && alive(tower) && distance(tower, source) <= tower.range) tower.targetId = source.id;
      });
    }
    var absorbed = Math.min(target.shield || 0, amount);
    if (absorbed) target.shield -= absorbed;
    var actual = Math.min(target.hp, amount - absorbed);
    target.hp = Math.max(0, target.hp - (amount - absorbed));
    if (target.hp <= 0) die(state, target, source);
    return actual;
  }
  function applyStatus(target, slow, duration, stun, roots) {
    if (!alive(target) || target.type) return;
    target.slow = Math.max(target.slow || 0, slow || 0); target.slowTime = Math.max(target.slowTime || 0, duration || 0);
    target.stun = Math.max(target.stun || 0, stun || 0); target.root = Math.max(target.root || 0, roots || 0);
  }
  function inArea(state, hero, point, radius, amount, status) {
    var hits = [];
    enemyUnits(state, hero.team, true).forEach(function (target) {
      if (distance(target, point) <= radius + (target.type ? 25 : 12)) {
        damage(state, hero, target, amount, true);
        if (status) applyStatus(target, status.slow, status.duration, status.stun, status.root);
        hits.push(target);
      }
    });
    return hits;
  }
  function pointSegmentDistance(point, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    var t = length2 ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length2, 0, 1) : 0;
    return distance(point, { x: a.x + dx * t, y: a.y + dy * t });
  }
  function lineDamage(state, hero, point, range, width, amount, status) {
    var length = distance(hero, point), dx = length > 1 ? (point.x - hero.x) / length : Math.cos(hero.facing), dy = length > 1 ? (point.y - hero.y) / length : Math.sin(hero.facing);
    var end = boundedPoint(hero.x + dx * range, hero.y + dy * range);
    enemyUnits(state, hero.team, true).forEach(function (target) {
      if (pointSegmentDistance(target, hero, end) <= width + (target.type ? 24 : 12)) {
        damage(state, hero, target, amount, true);
        if (status) applyStatus(target, status.slow, status.duration, status.stun, status.root);
      }
    });
    effect(state, 'slash', hero.x, hero.y, hero.team, width, heroDefinition(hero.heroId).color, .5, { tx: end.x, ty: end.y, heroId: hero.heroId });
  }
  function dash(state, hero, point, range, radius, amount) {
    var origin = { x: hero.x, y: hero.y }, d = distance(hero, point), scale = d > range ? range / d : 1;
    var end = boundedPoint(hero.x + (point.x - hero.x) * scale, hero.y + (point.y - hero.y) * scale);
    if (hero.root > 0) return false;
    hero.x = end.x; hero.y = end.y; hero.moveTarget = null;
    effect(state, 'dash', origin.x, origin.y, hero.team, 42, heroDefinition(hero.heroId).color, .55, { tx: end.x, ty: end.y, heroId: hero.heroId });
    if (amount) inArea(state, hero, hero, radius, amount);
    return true;
  }
  function makeZone(state, hero, point, radius, duration, amount, slow, type) {
    state.zones.push({ id: uid(state, 'z'), type: type, ownerId: hero.id, team: hero.team, x: point.x, y: point.y, radius: radius, duration: duration, tickTimer: .7, damage: amount, slow: slow || 0, color: heroDefinition(hero.heroId).color });
    effect(state, 'ring', point.x, point.y, hero.team, radius, heroDefinition(hero.heroId).color, duration, { heroId: hero.heroId, zone: true });
    if (state.zones.length > 30) state.zones.shift();
  }
  function castPoint(hero, action, target, range) {
    var point = target ? { x: target.x, y: target.y } : (Number.isFinite(action.x) && Number.isFinite(action.y) ? boundedPoint(action.x, action.y) : { x: hero.x, y: hero.y });
    var d = distance(hero, point);
    if (d > range && range > 0) point = { x: hero.x + (point.x - hero.x) * range / d, y: hero.y + (point.y - hero.y) * range / d };
    return point;
  }
  function cast(state, hero, action) {
    var slot = action.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return { ok: false, error: 'Неизвестное умение.' };
    if (hero.stun > 0) return { ok: false, error: 'Герой оглушён.' };
    var def = heroDefinition(hero.heroId), skill = def.abilities[slot];
    if (hero.cooldowns[slot] > .001) return { ok: false, error: 'Умение ещё восстанавливается.' };
    if (hero.mana < skill.mana) return { ok: false, error: 'Недостаточно маны.' };
    if ((action.x !== undefined && !Number.isFinite(action.x)) || (action.y !== undefined && !Number.isFinite(action.y))) return { ok: false, error: 'Некорректная точка применения.' };
    var target = action.targetId ? findUnit(state, action.targetId) : null;
    if (action.targetId && !alive(target)) return { ok: false, error: 'Цель недоступна.' };
    var isSelf = slot === 1 && ['aster', 'thorn', 'nyx'].includes(hero.heroId) || slot === 3 && ['aster', 'lyra', 'thorn'].includes(hero.heroId);
    var isDash = slot === 0 && ['aster', 'nyx'].includes(hero.heroId) || slot === 1 && ['cinder', 'volt'].includes(hero.heroId);
    if (!isSelf && !(hero.heroId === 'lyra' && slot === 1) && !target && (!Number.isFinite(action.x) || !Number.isFinite(action.y))) return { ok: false, error: 'Укажите цель или точку на карте.' };
    if (isDash && hero.root > 0) return { ok: false, error: 'Корни мешают рывку.' };
    if (hero.heroId === 'nyx' && (slot === 2 || slot === 3)) {
      var searchPoint = castPoint(hero, action, null, 500);
      searchPoint.team = hero.team;
      target = target && target.team !== hero.team ? target : nearestEnemy(state, searchPoint, slot === 3 ? 145 : 150, true);
      if (!alive(target) || target.team === hero.team || distance(hero, target) > (slot === 3 ? 500 : 580)) return { ok: false, error: 'Враг слишком далеко от метки.' };
      if (target.type && isProtected(state, target)) return { ok: false, error: 'Цель защищена башнями.' };
    }
    if (target && target.team === hero.team && !(hero.heroId === 'lyra' && slot === 1) && !isSelf) return { ok: false, error: 'Это союзник. Выберите врага или точку на карте.' };
    if (target && target.type && isProtected(state, target) && !isSelf) return { ok: false, error: 'Цель защищена башнями.' };
    var power = (1 + hero.spellPower) * (1 + (hero.level - 1) * .065);
    var point = castPoint(hero, action, target, [700, 530, 610, 850][slot]);
    hero.mana -= skill.mana; hero.cooldowns[slot] = skill.cooldown; hero.recall = 0;
    hero.hiddenTime = 0;
    if (distance(hero, point) > 2) hero.facing = Math.atan2(point.y - hero.y, point.x - hero.x);
    effect(state, 'cast', point.x, point.y, hero.team, slot === 3 ? 160 : 60, def.color, .55, { heroId: hero.heroId, slot: slot });

    if (hero.heroId === 'aster') {
      if (slot === 0) { dash(state, hero, point, 270, 110, 88 * power); inArea(state, hero, hero, 112, 0, { stun: .65 }); }
      if (slot === 1) state.heroes.forEach(function (ally) { if (ally.team === hero.team && distance(ally, hero) < 285) addShield(state, ally, (ally === hero ? 170 : 95) * power, 5); });
      if (slot === 2) { point = castPoint(hero, action, target, 440); inArea(state, hero, point, 150, 105 * power, { stun: 1.1 }); effect(state, 'burst', point.x, point.y, hero.team, 150, def.color, .8); }
      if (slot === 3) {
        state.heroes.forEach(function (ally) { if (ally.team === hero.team && distance(ally, hero) < 360) { heal(state, ally, 190 * power, true); addShield(state, ally, 190 * power, 6); } });
        inArea(state, hero, hero, 360, 170 * power, { stun: 1.1 }); effect(state, 'burst', hero.x, hero.y, hero.team, 360, def.color, 1.3);
      }
    } else if (hero.heroId === 'lyra') {
      if (slot === 0) lineDamage(state, hero, point, 650, 47, 105 * power, { slow: .35, duration: 2.4 });
      if (slot === 1) {
        var candidates = state.heroes.filter(function (ally) { return ally.team === hero.team && alive(ally) && distance(ally, hero) <= 530; });
        var focus = target && target.heroId && target.team === hero.team && distance(hero, target) <= 530 ? target : null;
        if (!focus) {
          candidates.sort(function (a, b) { return a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id); });
          focus = candidates[0] || hero;
        }
        candidates.forEach(function (ally) { if (ally === focus || distance(ally, focus) < 140) heal(state, ally, (ally === focus ? 185 : 85) * power, true); });
        effect(state, 'heal', focus.x, focus.y, hero.team, 140, def.color, .9);
      }
      if (slot === 2) { point = castPoint(hero, action, target, 580); inArea(state, hero, point, 160, 35 * power, { slow: .42, duration: 1 }); makeZone(state, hero, point, 160, 4, 37 * power, .42, 'vortex'); }
      if (slot === 3) {
        state.heroes.forEach(function (ally) { if (ally.team === hero.team && distance(ally, hero) < 460 && alive(ally)) { heal(state, ally, 300 * power, true); ally.stun = 0; ally.root = 0; ally.slow = 0; ally.slowTime = 0; } });
        inArea(state, hero, hero, 460, 155 * power, { slow: .4, duration: 2.5 }); effect(state, 'burst', hero.x, hero.y, hero.team, 460, def.color, 1.5);
      }
    } else if (hero.heroId === 'cinder') {
      if (slot === 0) lineDamage(state, hero, point, 820, 38, 155 * power);
      if (slot === 1) { dash(state, hero, point, 260, 0, 0); addShield(state, hero, 80 * power, 3); hero.hasteTime = 3; }
      if (slot === 2) { point = castPoint(hero, action, target, 620); inArea(state, hero, point, 175, 30 * power); makeZone(state, hero, point, 175, 5, 43 * power, 0, 'fire'); }
      if (slot === 3) { inArea(state, hero, point, 285, 285 * power); effect(state, 'burst', point.x, point.y, hero.team, 285, def.color, 1.4); }
    } else if (hero.heroId === 'thorn') {
      if (slot === 0) lineDamage(state, hero, point, 270, 90, 125 * power, { slow: .4, duration: 2 });
      if (slot === 1) { heal(state, hero, 95 * power, true); addShield(state, hero, 185 * power, 5); }
      if (slot === 2) { point = castPoint(hero, action, target, 480); inArea(state, hero, point, 165, 85 * power, { root: 1.7 }); effect(state, 'ring', point.x, point.y, hero.team, 165, def.color, 1.7); }
      if (slot === 3) { heal(state, hero, 250 * power, true); addShield(state, hero, 230 * power, 8); hero.boostTime = 8; inArea(state, hero, hero, 245, 135 * power); effect(state, 'burst', hero.x, hero.y, hero.team, 245, def.color, 1.1); }
    } else if (hero.heroId === 'nyx') {
      if (slot === 0) dash(state, hero, point, 350, 115, 135 * power);
      if (slot === 1) { addShield(state, hero, 115 * power, 3); hero.hasteTime = 3; hero.hiddenTime = 3; effect(state, 'ring', hero.x, hero.y, hero.team, 95, def.color, .8); }
      if (slot === 2) { damage(state, hero, target, 95 * power, true); applyStatus(target, .4, 2, 0, 0); if (!target.type) { target.markTime = 5; target.markedBy = hero.id; } projectile(state, hero, target, def.color, 'orb'); }
      if (slot === 3) {
        var execute = (230 + (target.maxHp - target.hp) * .22) * power;
        damage(state, hero, target, execute, true);
        effect(state, 'slash', hero.x, hero.y, hero.team, 65, def.color, .7, { tx: target.x, ty: target.y, heroId: hero.heroId });
        if (!alive(target)) hero.cooldowns[3] = 7;
      }
    } else if (hero.heroId === 'volt') {
      if (slot === 0) {
        var first = target && target.team !== hero.team && distance(hero, target) <= 650 ? target : nearestEnemy(state, { x: point.x, y: point.y, team: hero.team }, 160, true);
        if (first && distance(hero, first) <= 710) {
          var used = {}, from = hero, victim = first;
          for (var jump = 0; jump < 4 && victim; jump++) {
            used[victim.id] = true; projectile(state, from, victim, def.color, 'bolt');
            damage(state, hero, victim, 130 * power * Math.pow(.8, jump), true);
            from = victim;
            victim = nearestEnemy(state, { x: from.x, y: from.y, team: hero.team }, 250, true, function (candidate) { return !used[candidate.id]; });
          }
        }
      }
      if (slot === 1) { dash(state, hero, point, 280, 110, 90 * power); addShield(state, hero, 95 * power, 3); }
      if (slot === 2) { inArea(state, hero, point, 165, 125 * power, { stun: 1.15 }); effect(state, 'burst', point.x, point.y, hero.team, 165, def.color, .9); }
      if (slot === 3) { inArea(state, hero, point, 270, 100 * power); makeZone(state, hero, point, 270, 5, 72 * power, .2, 'storm'); }
    }
    return { ok: true };
  }

  function buy(state, hero, itemId) {
    var item = itemDefinition(itemId);
    if (!item) return { ok: false, error: 'Предмет не найден.' };
    if (distance(hero, MAP.bases[hero.team]) > 330) return { ok: false, error: 'Магазин доступен у своего ядра.' };
    if (hero.items.length >= 6) return { ok: false, error: 'Все шесть ячеек заняты.' };
    if (hero.items.includes(item.id)) return { ok: false, error: 'Этот предмет уже куплен.' };
    if (hero.gold < item.cost) return { ok: false, error: 'Не хватает золота.' };
    hero.gold -= item.cost; hero.items.push(item.id); heroStats(hero);
    effect(state, 'spark', hero.x, hero.y, hero.team, 45, '#ffe2a0', .65);
    return { ok: true };
  }
  function command(state, playerId, action) {
    if (!state || state.status !== 'playing') return { ok: false, error: 'Матч уже завершён.' };
    var hero = getHero(state, playerId);
    if (!hero) return { ok: false, error: 'Игрок не участвует в матче.' };
    if (!action || typeof action !== 'object' || Array.isArray(action)) return { ok: false, error: 'Некорректная команда.' };
    if (!alive(hero)) return { ok: false, error: 'Герой возрождается.' };
    if (action.type === 'buy') return buy(state, hero, action.itemId);
    if (action.type === 'cast') return cast(state, hero, action);
    if (action.type === 'stop') { hero.targetId = null; hero.moveTarget = null; hero.order = 'idle'; hero.recall = 0; return { ok: true }; }
    if (action.type === 'recall') {
      if (hero.stun > 0) return { ok: false, error: 'Герой оглушён.' };
      hero.targetId = null; hero.moveTarget = null; hero.order = 'idle'; hero.recall = 3;
      effect(state, 'recall', hero.x, hero.y, hero.team, 75, heroDefinition(hero.heroId).color, 3);
      return { ok: true };
    }
    if (action.type === 'move' || action.type === 'attackMove') {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return { ok: false, error: 'Некорректные координаты.' };
      hero.moveTarget = boundedPoint(action.x, action.y); hero.targetId = null; hero.order = action.type; hero.recall = 0;
      return { ok: true };
    }
    if (action.type === 'attack') {
      var target = findUnit(state, action.targetId);
      if (!alive(target) || target.team === hero.team) return { ok: false, error: 'Выберите живую вражескую цель.' };
      if (target.type && isProtected(state, target)) return { ok: false, error: 'Сначала разрушьте внешние башни этой линии.' };
      hero.targetId = target.id; hero.moveTarget = null; hero.order = 'attack'; hero.recall = 0;
      return { ok: true };
    }
    return { ok: false, error: 'Неизвестная команда.' };
  }

  function moveToward(unit, point, dt) {
    if (unit.stun > 0 || unit.root > 0) return;
    var dx = point.x - unit.x, dy = point.y - unit.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < .1) return;
    var speed = unit.speed * (unit.slowTime > 0 ? 1 - (unit.slow || 0) : 1) * (unit.hasteTime > 0 ? 1.32 : 1);
    var travel = Math.min(d, speed * dt);
    unit.x = clamp(unit.x + dx / d * travel, 50, 2350); unit.y = clamp(unit.y + dy / d * travel, 50, 2350);
    if (unit.heroId) unit.facing = Math.atan2(dy, dx);
  }
  function autoAttack(state, unit, target) {
    if (!alive(unit) || !alive(target) || unit.attackCooldown > 0 || unit.stun > 0 || !visibleTo(target, unit)) return;
    if (target.type && isProtected(state, target)) return;
    if (distance(unit, target) > unit.range + (target.type ? 30 : 15)) return;
    unit.attackCooldown = unit.heroId ? 1.05 / (1 + unit.attackSpeed) : (unit.type ? 1.05 : unit.kind === 'siege' ? 1.65 : 1.2);
    var attack = unit.damage * (.94 + random(state) * .12) * (unit.boostTime > 0 ? 1.48 : 1);
    unit.hiddenTime = 0;
    if (unit.range > 150) projectile(state, unit, target, unit.heroId ? heroDefinition(unit.heroId).color : unit.team === 0 ? '#a6e5a0' : '#ffb990', unit.kind === 'ranged' ? 'orb' : 'arrow');
    else effect(state, 'impact', target.x, target.y, unit.team, 27, unit.heroId ? heroDefinition(unit.heroId).color : null, .25);
    damage(state, unit, target, attack, false);
  }
  function tickStatus(unit, dt) {
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    ['stun', 'root', 'slowTime', 'hasteTime', 'boostTime', 'hiddenTime', 'markTime', 'shieldTime'].forEach(function (key) {
      if (unit[key] > 0) unit[key] = Math.max(0, unit[key] - dt);
    });
    if (!unit.slowTime) unit.slow = 0;
    if (!unit.shieldTime && unit.shield) unit.shield = 0;
    if (!unit.markTime) unit.markedBy = null;
  }
  function spawnWave(state) {
    state.wave++;
    var scaling = 1 + state.wave * .045 + Math.max(0, state.time - 240) / 180;
    for (var team = 0; team < 2; team++) {
      for (var lane = 0; lane < 3; lane++) {
        var kinds = ['melee', 'melee', 'melee', 'ranged'];
        if (state.wave % 3 === 0 || state.time > 360) kinds.push('siege');
        for (var n = 0; n < kinds.length; n++) {
          var kind = kinds[n], base = MAP.bases[team], hp = (kind === 'siege' ? 650 : kind === 'ranged' ? 235 : 340) * scaling;
          var unit = {
            id: uid(state, 'c'), team: team, lane: lane, kind: kind, x: base.x + (n - 2) * 19, y: base.y + (n - 2) * 19,
            hp: hp, maxHp: hp, damage: (kind === 'siege' ? 48 : kind === 'ranged' ? 27 : 23) * scaling,
            range: kind === 'melee' ? 36 : kind === 'siege' ? 280 : 230, speed: kind === 'siege' ? 94 : 110,
            attackCooldown: n * .08, targetId: null, dead: false, stun: 0, root: 0, slow: 0, slowTime: 0,
            bounty: kind === 'siege' ? 44 : kind === 'ranged' ? 24 : 20, xp: kind === 'siege' ? 45 : 25
          };
          state.creeps.push(unit);
        }
      }
    }
    if (state.wave === 1) event(state, 'wave', 'Воины выходят на три линии.');
    if (state.time > 360 && state.escalation === 0) { state.escalation = 1; event(state, 'wave', 'Пепельный прилив: осадные големы теперь в каждой волне.'); }
    // The cap is a defensive bound for long abandoned rooms, never reached by normal play.
    if (state.creeps.length > 280) state.creeps.splice(0, state.creeps.length - 280);
  }
  function nearestLaneStructure(state, unit) {
    var best = null, d = Infinity;
    state.structures.forEach(function (s) {
      if (s.team === unit.team || !alive(s) || isProtected(state, s) || (s.type === 'tower' && s.lane !== unit.lane)) return;
      var gap = distance(unit, s);
      if (gap < d) { d = gap; best = s; }
    });
    return best;
  }
  function botBuy(state, hero) {
    if (distance(hero, MAP.bases[hero.team]) > 325) return;
    var mage = hero.heroId === 'volt' || hero.heroId === 'lyra';
    var tank = hero.heroId === 'aster' || hero.heroId === 'thorn';
    var order = mage ? ['swiftboots', 'moonlens', 'tidecharm', 'ironheart', 'emberblade', 'stormbow'] : tank ? ['swiftboots', 'ironheart', 'tidecharm', 'emberblade', 'stormbow', 'moonlens'] : ['swiftboots', 'emberblade', 'stormbow', 'ironheart', 'tidecharm', 'moonlens'];
    for (var i = 0; i < order.length; i++) if (!hero.items.includes(order[i])) { buy(state, hero, order[i]); break; }
  }
  function botSpells(state, hero, target) {
    var nearby = enemyUnits(state, hero.team, false).filter(function (unit) { return distance(hero, unit) < 360; });
    var lowAllies = state.heroes.filter(function (ally) { return ally.team === hero.team && alive(ally) && distance(ally, hero) < 430 && ally.hp / ally.maxHp < .64; });
    var id = hero.heroId;
    if (hero.hp / hero.maxHp < .74 || nearby.length > 1 || lowAllies.length) {
      if (['aster', 'thorn', 'nyx'].includes(id)) cast(state, hero, { slot: 1 });
      else if (id === 'lyra' && lowAllies.length) cast(state, hero, { slot: 1, targetId: lowAllies[0].id });
    }
    if (!target || !alive(target)) return;
    var gap = distance(hero, target);
    var action = { x: target.x, y: target.y, targetId: target.id };
    if (gap < (id === 'aster' ? 350 : id === 'nyx' ? 410 : id === 'thorn' ? 300 : 650)) cast(state, hero, Object.assign({ slot: 0 }, action));
    if (gap < (id === 'aster' ? 465 : id === 'thorn' ? 500 : id === 'nyx' ? 570 : 620)) cast(state, hero, Object.assign({ slot: 2 }, action));
    if (['cinder', 'volt'].includes(id) && gap < 450 && (hero.hp / hero.maxHp < .44 || gap > hero.range + 70)) {
      var direction = hero.hp / hero.maxHp < .44 ? MAP.bases[hero.team] : target;
      cast(state, hero, { slot: 1, x: direction.x, y: direction.y });
    }
    if (nearby.length >= 3 || target.heroId && target.hp / target.maxHp < .58 || target.type && target.hp / target.maxHp < .36 || id === 'lyra' && lowAllies.length >= 2 || id === 'thorn' && nearby.length >= 2 || id === 'aster' && lowAllies.length) {
      if (gap < (['aster', 'lyra', 'thorn'].includes(id) ? 370 : id === 'nyx' ? 490 : 830)) cast(state, hero, Object.assign({ slot: 3 }, action));
    }
  }
  function thinkBot(state, hero) {
    botBuy(state, hero);
    var base = MAP.bases[hero.team], hpRatio = hero.hp / hero.maxHp;
    if (hpRatio < .21) hero.aiRetreat = true;
    if (hero.aiRetreat) {
      if (hpRatio > .86) hero.aiRetreat = false;
      else {
        hero.targetId = null; hero.moveTarget = { x: base.x, y: base.y }; hero.order = 'move';
        var threat = nearestEnemy(state, hero, 400, false);
        if (threat) botSpells(state, hero, threat);
        if (!threat && distance(hero, base) > 600 && !hero.recall) {
          hero.moveTarget = null; hero.recall = 3; effect(state, 'recall', hero.x, hero.y, hero.team, 65, heroDefinition(hero.heroId).color, 3);
        }
        return;
      }
    }
    if (hero.recall > 0) return;
    var target = nearestEnemy(state, hero, 470, false, function (unit) { return !!unit.heroId; });
    if (!target) target = nearestEnemy(state, hero, 400, false);
    if (!target) {
      var tower = nearestLaneStructure(state, hero);
      if (tower && distance(hero, tower) < 540) {
        var tanks = state.creeps.filter(function (creep) { return alive(creep) && creep.team === hero.team && distance(creep, tower) < tower.range + 70; });
        var allies = state.heroes.filter(function (ally) { return alive(ally) && ally.team === hero.team && distance(ally, tower) < 400; });
        if (tanks.length || tower.hp < hero.damage * 4 || allies.length >= 3) target = tower;
        else {
          var waiting = pointOnLane(hero.lane, laneProgress(tower, hero.lane) - (hero.team === 0 ? 435 : -435));
          hero.targetId = null; hero.moveTarget = waiting; hero.order = 'move';
          botSpells(state, hero, null);
          return;
        }
      }
    }
    if (target) {
      hero.targetId = target.id; hero.moveTarget = null; hero.order = 'attack';
      botSpells(state, hero, target);
    } else {
      hero.targetId = null; hero.moveTarget = laneForward(hero, 180); hero.order = 'move';
      botSpells(state, hero, null);
    }
  }
  function tickHero(state, hero, dt) {
    tickStatus(hero, dt);
    for (var slot = 0; slot < 4; slot++) hero.cooldowns[slot] = Math.max(0, hero.cooldowns[slot] - dt);
    hero.gold += dt * 1.65;
    if (hero.dead) {
      hero.respawn = Math.max(0, hero.respawn - dt);
      if (hero.respawn <= 0) {
        var base = MAP.bases[hero.team]; hero.dead = false; hero.x = base.x + (hero.slot - 2) * 17; hero.y = base.y;
        hero.hp = hero.maxHp; hero.mana = hero.maxMana; hero.contributors = {}; hero.markTime = 0;
        hero.order = 'idle'; hero.aiRetreat = false; hero.recall = 0; hero.shield = 0;
        effect(state, 'spawn', hero.x, hero.y, hero.team, 85, heroDefinition(hero.heroId).color, 1.1);
      }
      return;
    }
    var atBase = distance(hero, MAP.bases[hero.team]) < 265;
    hero.hp = Math.min(hero.maxHp, hero.hp + dt * (hero.regen + (atBase ? hero.maxHp * .13 : 0)));
    hero.mana = Math.min(hero.maxMana, hero.mana + dt * (hero.manaRegen + (atBase ? hero.maxMana * .16 : 0)));
    if (hero.recall > 0) {
      hero.recall = Math.max(0, hero.recall - dt);
      if (hero.recall <= 0) {
        hero.x = MAP.bases[hero.team].x; hero.y = MAP.bases[hero.team].y; hero.moveTarget = null; hero.targetId = null;
        effect(state, 'spawn', hero.x, hero.y, hero.team, 90, heroDefinition(hero.heroId).color, .9);
      }
      return;
    }
    if (hero.bot) {
      hero.aiTimer -= dt;
      if (hero.aiTimer <= 0 && hero.stun <= 0) { hero.aiTimer += .32; thinkBot(state, hero); }
      if (hero.recall > 0) return;
    }
    if (hero.stun > 0) return;
    var target = hero.targetId ? findUnit(state, hero.targetId) : null;
    if (!alive(target) || target.team === hero.team || !visibleTo(target, hero) || target.type && isProtected(state, target)) { target = null; hero.targetId = null; }
    if (hero.order === 'attackMove' && !target) target = nearestEnemy(state, hero, 380, true);
    if (target) {
      if (distance(hero, target) > hero.range + (target.type ? 25 : 9)) moveToward(hero, target, dt);
      autoAttack(state, hero, target);
    } else {
      if (hero.moveTarget) {
        moveToward(hero, hero.moveTarget, dt);
        if (distance(hero, hero.moveTarget) < 5) { hero.moveTarget = null; if (!hero.bot) hero.order = 'idle'; }
      }
      var inRange = nearestEnemy(state, hero, hero.range + 10, true);
      if (inRange && hero.order !== 'move') autoAttack(state, hero, inRange);
    }
  }
  function tickCreep(state, creep, dt) {
    if (!alive(creep)) return;
    tickStatus(creep, dt);
    if (creep.stun > 0) return;
    var target = creep.targetId ? findUnit(state, creep.targetId) : null;
    if (!alive(target) || target.team === creep.team || distance(creep, target) > 490 || target.type && isProtected(state, target) || !visibleTo(target, creep)) target = null;
    if (!target) target = nearestEnemy(state, creep, creep.range + 150, false);
    if (!target) {
      var structure = nearestLaneStructure(state, creep);
      if (structure && distance(creep, structure) < 450) target = structure;
    }
    creep.targetId = target ? target.id : null;
    if (target) {
      if (distance(creep, target) > creep.range + (target.type ? 25 : 8)) moveToward(creep, target, dt);
      autoAttack(state, creep, target);
    } else moveToward(creep, laneForward(creep, 160), dt);
  }
  function tickStructure(state, structure, dt) {
    if (!alive(structure)) return;
    structure.attackCooldown = Math.max(0, structure.attackCooldown - dt);
    var target = structure.targetId ? findUnit(state, structure.targetId) : null;
    if (!alive(target) || target.team === structure.team || distance(target, structure) > structure.range + 10 || !visibleTo(target, structure)) target = null;
    if (!target) target = nearestEnemy(state, structure, structure.range, false, function (unit) { return !unit.heroId; });
    if (!target) target = nearestEnemy(state, structure, structure.range, false);
    structure.targetId = target ? target.id : null;
    if (target) autoAttack(state, structure, target);
  }
  function tickZones(state, dt) {
    state.zones.forEach(function (zone) {
      zone.duration -= dt; zone.tickTimer -= dt;
      if (zone.duration < -.001 || zone.tickTimer > 0) return;
      zone.tickTimer += 1;
      var owner = findUnit(state, zone.ownerId);
      if (!owner) return;
      inArea(state, owner, zone, zone.radius, zone.damage, zone.slow ? { slow: zone.slow, duration: 1.2 } : null);
    });
    state.zones = state.zones.filter(function (zone) { return zone.duration > 0; });
  }
  function step(state, dt) {
    if (!Number.isFinite(dt) || dt < 0 || dt > .25) throw new RangeError('dt must be a finite number between 0 and 0.25');
    if (!state || state.status !== 'playing' || dt === 0) return state;
    state.time += dt;
    state.effects.forEach(function (e) { e.life -= dt; });
    state.effects = state.effects.filter(function (e) { return e.life > 0; });
    state.projectiles.forEach(function (p) {
      var fraction = Math.min(1, dt / Math.max(dt, p.life));
      p.x += (p.tx - p.x) * fraction; p.y += (p.ty - p.y) * fraction; p.life -= dt;
    });
    state.projectiles = state.projectiles.filter(function (p) { return p.life > 0; });
    if (state.time >= state.nextWave) { spawnWave(state); state.nextWave += 24; }
    tickZones(state, dt);
    for (var t = 0; t < state.structures.length && state.status === 'playing'; t++) tickStructure(state, state.structures[t], dt);
    for (var c = 0; c < state.creeps.length && state.status === 'playing'; c++) tickCreep(state, state.creeps[c], dt);
    for (var h = 0; h < state.heroes.length && state.status === 'playing'; h++) tickHero(state, state.heroes[h], dt);
    state.creeps = state.creeps.filter(alive);
    return state;
  }

  return { VERSION: 1, HEROES: HEROES, ITEMS: ITEMS, MAP: MAP, createGame: createGame, getHero: getHero, command: command, step: step };
}));
