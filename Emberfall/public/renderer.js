(function (root, factory) {
  'use strict';
  const Renderer = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = Renderer;
  else root.BattleRenderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SX = 0.72, SY = 0.36, WORLD = 2400, TAU = Math.PI * 2;
  const TEAM = ['#68edbe', '#ff966a'];
  const HERO = {
    aster: { color: '#f5c970', dark: '#745b35', kind: 0 },
    lyra: { color: '#60d7d0', dark: '#296879', kind: 1 },
    cinder: { color: '#ff985e', dark: '#733e43', kind: 2 },
    thorn: { color: '#95cf77', dark: '#3c6249', kind: 3 },
    nyx: { color: '#bd96ff', dark: '#51416c', kind: 4 },
    volt: { color: '#69c7ff', dark: '#354e87', kind: 5 }
  };
  const FALLBACK_MAP = {
    width: WORLD, height: WORLD,
    bases: [{ x: 220, y: 2180 }, { x: 2180, y: 220 }],
    lanes: [
      [{ x: 220, y: 2180 }, { x: 260, y: 260 }, { x: 2180, y: 220 }],
      [{ x: 220, y: 2180 }, { x: 1200, y: 1200 }, { x: 2180, y: 220 }],
      [{ x: 220, y: 2180 }, { x: 2140, y: 2140 }, { x: 2180, y: 220 }]
    ]
  };
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function random(seed) {
    let state = (seed >>> 0) || 17391;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  }
  function polygon(ctx, points, fill, stroke, width = 1) {
    ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1])); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function line(ctx, points, color, width = 1) {
    ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function ellipse(ctx, x, y, rx, ry, color, stroke, width = 1) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
    if (color) { ctx.fillStyle = color; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function glow(ctx, x, y, radius, color, strength = 0.4) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
    ctx.save(); ctx.globalAlpha *= strength; ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2); ctx.restore();
  }
  function roundRect(ctx, x, y, width, height, radius, color) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
    else { ctx.moveTo(x + radius, y); ctx.arcTo(x + width, y, x + width, y + height, radius); ctx.arcTo(x + width, y + height, x, y + height, radius); ctx.arcTo(x, y + height, x, y, radius); ctx.arcTo(x, y, x + width, y, radius); }
    ctx.fillStyle = color; ctx.fill();
  }
  function distanceToSegment(x, y, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
  }
  function distanceToLanes(x, y, lanes) {
    let distance = Infinity;
    for (const lane of lanes) for (let i = 1; i < lane.length; i++) distance = Math.min(distance, distanceToSegment(x, y, lane[i - 1], lane[i]));
    return distance;
  }
  function iso(x, y) { return { x: (x - y) * SX, y: (x + y) * SY }; }

  class BattleRenderer {
    constructor(canvas, options = {}) {
      if (!canvas || !canvas.getContext) throw new TypeError('BattleRenderer requires a canvas.');
      this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      if (!this.ctx) throw new Error('Canvas2D is not available.');
      this.options = options; this.width = 1; this.height = 1; this.dpr = 1;
      this.camera = { x: 220, y: 2180 }; this.zoom = clamp(finite(options.zoom, 0.95), 0.5, 1.6);
      this.map = options.map || (root.BattleCore && root.BattleCore.MAP) || FALLBACK_MAP;
      this.terrain = null; this.terrainSeed = null; this.props = []; this.lastFrame = null; this.initializedCamera = false;
      this.resize(options.width || canvas.clientWidth || canvas.width || 960, options.height || canvas.clientHeight || canvas.height || 640, options.dpr || root.devicePixelRatio || 1);
    }
    resize(width, height, dpr = root.devicePixelRatio || 1) {
      this.width = Math.max(1, Math.round(finite(width, 960))); this.height = Math.max(1, Math.round(finite(height, 640)));
      this.dpr = clamp(finite(dpr, 1), 1, 1.75);
      this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
      if (this.canvas.style) { this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`; }
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    setCamera(x, y) {
      this.camera.x = clamp(finite(x, 1200), 0, this.map.width || WORLD);
      this.camera.y = clamp(finite(y, 1200), 0, this.map.height || WORLD); this.initializedCamera = true;
    }
    worldToScreen(x, y) {
      const point = iso(finite(x) - this.camera.x, finite(y) - this.camera.y);
      return { x: this.width / 2 + point.x * this.zoom, y: this.height * 0.51 + point.y * this.zoom };
    }
    screenToWorld(screenX, screenY) {
      const x = (finite(screenX) - this.width / 2) / this.zoom;
      const y = (finite(screenY) - this.height * 0.51) / this.zoom;
      return { x: this.camera.x + (x / SX + y / SY) / 2, y: this.camera.y + (y / SY - x / SX) / 2 };
    }
    _newCanvas(width, height) {
      if (typeof root.OffscreenCanvas === 'function') return new root.OffscreenCanvas(width, height);
      const doc = this.canvas.ownerDocument || root.document;
      if (!doc || !doc.createElement) return null;
      const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
    }
    _buildTerrain(seed) {
      this.terrainSeed = seed;
      const width = (this.map.width || WORLD), height = (this.map.height || WORLD);
      const margin = 190, ox = height * SX + margin, oy = margin;
      const canvas = this._newCanvas(Math.ceil((width + height) * SX + margin * 2), Math.ceil((width + height) * SY + margin * 2));
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rng = random(seed + 637); this.props = [];
      const lanes = this.map.lanes || FALLBACK_MAP.lanes;
      // The near edges expose a faceted stone shelf, giving the battlefield real depth.
      const corner = [[0, height], [width, height], [width, 0]].map(([x, y]) => { const p = iso(x, y); return [p.x + ox, p.y + oy]; });
      for (let edge = 1; edge < corner.length; edge++) {
        const a = corner[edge - 1], b = corner[edge], steps = 35;
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps, t1 = (i + 1) / steps;
          const x0 = mix(a[0], b[0], t0), y0 = mix(a[1], b[1], t0), x1 = mix(a[0], b[0], t1), y1 = mix(a[1], b[1], t1);
          const depth = 26 + rng() * 18;
          polygon(ctx, [[x0, y0 - 1], [x1, y1 - 1], [x1, y1 + depth], [x0, y0 + depth * 0.85]], edge === 1 ? (i % 3 ? '#243833' : '#2a4038') : (i % 3 ? '#263538' : '#304047'), '#182d2c', 0.8);
          if (i % 3 === 0) line(ctx, [[x0 + 9, y0 + 6], [x0 + 15, y0 + 19], [x0 + 10, y0 + depth - 2]], '#3b5044', 1);
        }
      }
      ctx.save(); ctx.transform(SX, SY, -SX, SY, ox, oy);
      polygon(ctx, [[0, 0], [width, 0], [width, height], [0, height]], '#142c2a');
      // Gentle tile variation forms a painted ground rather than an outlined grid.
      for (let x = 0; x < width; x += 100) for (let y = 0; y < height; y += 100) {
        const ash = clamp((x - y + 950) / 2500, 0, 1), light = rng();
        const red = Math.round(mix(23, 47, ash) + light * 5), green = Math.round(mix(58, 46, ash) + light * 7), blue = Math.round(mix(47, 56, ash) + light * 5);
        ctx.fillStyle = `rgb(${red},${green},${blue})`; ctx.fillRect(x, y, Math.min(101, width - x), Math.min(101, height - y));
      }
      const forestShade = ctx.createRadialGradient(1200, 1200, 300, 1200, 1200, 1600);
      forestShade.addColorStop(0, 'rgba(16,31,30,0)'); forestShade.addColorStop(1, 'rgba(4,18,21,.5)');
      ctx.fillStyle = forestShade; ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < 8200; i++) {
        const x = rng() * width, y = rng() * height;
        ctx.fillStyle = rng() < 0.48 ? 'rgba(129,161,115,.12)' : 'rgba(5,22,24,.17)';
        ctx.fillRect(x, y, 2 + rng() * 7, 1 + rng() * 3);
      }
      // A broad, shallow river separates the two realms. It is cosmetic and walkable.
      const river = [[-80, -20], [400, 360], [690, 770], [1060, 1030], [1320, 1390], [1770, 1730], [2100, 2200], [2500, 2470]];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      line(ctx, river, '#122728', 247); line(ctx, river, '#416463', 213); line(ctx, river, '#173f49', 183); line(ctx, river, '#205563', 145);
      ctx.save(); ctx.globalAlpha = 0.25;
      for (let i = 0; i < 160; i++) {
        const k = rng() * (river.length - 1), a = river[Math.floor(k)], b = river[Math.min(river.length - 1, Math.floor(k) + 1)];
        const t = k % 1, x = mix(a[0], b[0], t) + (rng() - 0.5) * 95, y = mix(a[1], b[1], t) + (rng() - 0.5) * 95;
        line(ctx, [[x, y], [x + 14 + rng() * 35, y + 14 + rng() * 35]], '#a3e7df', 1.4);
      }
      ctx.restore();
      // Carved lanes have a wide soft shoulder, then irregular individual flagstones.
      lanes.forEach(lane => {
        const points = lane.map(point => [point.x, point.y]);
        line(ctx, points, '#293c35', 170); line(ctx, points, '#3c4840', 122); line(ctx, points, '#566054', 88);
        for (let i = 1; i < lane.length; i++) {
          const a = lane[i - 1], b = lane[i], length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.ceil(length / 43), dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
          for (let j = 0; j < steps; j++) {
            const t = (j + 0.5) / steps, x = mix(a.x, b.x, t), y = mix(a.y, b.y, t);
            const px = -dy * (26 + rng() * 10), py = dx * (26 + rng() * 10), hx = dx * 17, hy = dy * 17;
            polygon(ctx, [[x - hx + px, y - hy + py], [x + hx + px, y + hy + py], [x + hx - px, y + hy - py], [x - hx - px, y - hy - py]], rng() > 0.5 ? '#62695b' : '#535e52', '#394940', 2.3);
            if (rng() > 0.75) line(ctx, [[x - hx, y - hy], [x + px * 0.6, y + py * 0.6]], '#34463d', 1);
          }
        }
      });
      // Stone plazas and runic rings anchor each team's base.
      (this.map.bases || FALLBACK_MAP.bases).forEach((base, team) => {
        ellipse(ctx, base.x, base.y, 208, 208, team ? '#3c363b' : '#354940', '#69726a', 8);
        ellipse(ctx, base.x, base.y, 173, 173, team ? '#484046' : '#41574c', team ? '#8d6556' : '#60876b', 3);
        ellipse(ctx, base.x, base.y, 140, 140, team ? '#39363d' : '#31483f', '#242e2e', 7);
        for (let angle = 0; angle < TAU; angle += TAU / 14) {
          const x = base.x + Math.cos(angle) * 189, y = base.y + Math.sin(angle) * 189;
          ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.strokeStyle = team ? '#b77a61' : '#7ba58d'; ctx.lineWidth = 2;
          ctx.strokeRect(-6, -9, 12, 18); line(ctx, [[-6, -9], [6, 9]], team ? '#b77a61' : '#7ba58d', 2); ctx.restore();
        }
      });
      // Tiny flowers, moss, and embedded stones add material at gameplay scale.
      for (let i = 0; i < 1100; i++) {
        const x = 60 + rng() * (width - 120), y = 60 + rng() * (height - 120);
        if (distanceToLanes(x, y, lanes) < 88 || Math.abs(x - y) < 135) continue;
        ellipse(ctx, x, y, 12 + rng() * 24, 8 + rng() * 19, rng() < 0.5 ? 'rgba(7,26,25,.22)' : 'rgba(111,137,89,.1)');
        if (rng() < 0.28) { ctx.fillStyle = x < y ? '#98bca0' : '#b2a299'; ctx.fillRect(x, y, 3, 3); }
      }
      // World edge: quiet engraving prevents the playable diamond feeling cut off.
      polygon(ctx, [[8, 8], [width - 8, 8], [width - 8, height - 8], [8, height - 8]], null, '#56766a', 12);
      polygon(ctx, [[25, 25], [width - 25, 25], [width - 25, height - 25], [25, height - 25]], null, '#203b35', 6);
      ctx.restore();
      // Props are separate from terrain so heroes sort correctly behind trees and ruins.
      for (let i = 0; i < 430; i++) {
        const x = 90 + rng() * (width - 180), y = 90 + rng() * (height - 180);
        if (distanceToLanes(x, y, lanes) < 115 || Math.abs(x - y) < 140) continue;
        if ((this.map.bases || FALLBACK_MAP.bases).some(base => Math.hypot(base.x - x, base.y - y) < 250)) continue;
        const ash = x > y;
        const prop = { x, y, kind: rng() < 0.66 ? 'tree' : rng() < 0.72 ? 'rock' : 'ruin', size: 0.65 + rng() * 0.85, variant: rng(), ash };
        this.props.push(prop);
        const point = iso(x, y);
        ellipse(ctx, point.x + ox + 8, point.y + oy + 3, (prop.kind === 'tree' ? 33 : 23) * prop.size, 14 * prop.size, 'rgba(3,13,18,.2)');
      }
      // Three river shrines give lane junctions memorable landmarks.
      [{ x: 525, y: 500, ash: false }, { x: 1500, y: 1450, ash: true }, { x: 1950, y: 1960, ash: true }].forEach((point, i) => this.props.push({ ...point, kind: 'shrine', size: i === 1 ? 1.3 : 0.9, variant: i / 3 }));
      this.props.sort((a, b) => a.x + a.y - b.x - b.y);
      // Bake depth-sorted scenery once. Only canopies overlapping units are recomposed
      // dynamically; terrain is a single viewport-sized blit instead of hundreds of paths.
      for (const prop of this.props) {
        const point = iso(prop.x, prop.y);
        ctx.save(); ctx.translate(point.x + ox, point.y + oy); this._drawProp(ctx, prop, 0, false); ctx.restore();
      }
      this.terrain = { canvas, ox, oy };
    }
    render(state, options = {}) {
      if (!state) return;
      const ctx = this.ctx;
      // Optional animation time is in seconds; simulation time is a useful fallback.
      const visualTime = finite(options.time, finite(state.time));
      const heroes = state.heroes || [], creeps = state.creeps || [], structures = state.structures || [];
      const local = heroes.find(hero => hero.playerId === options.playerId) || heroes[0];
      const localTeam = local ? local.team : 0;
      const camera = options.camera;
      if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y)) { this.setCamera(camera.x, camera.y); if (Number.isFinite(camera.zoom)) this.zoom = clamp(camera.zoom, 0.5, 1.6); }
      else if (local) {
        if (!this.initializedCamera) this.setCamera(local.x, local.y);
        else {
          const time = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const dt = this.lastFrame === null ? 0.016 : clamp((time - this.lastFrame) / 1000, 0, 0.1); this.lastFrame = time;
          const weight = 1 - Math.exp(-dt * 9);
          this.camera.x = mix(this.camera.x, local.x, weight); this.camera.y = mix(this.camera.y, local.y, weight);
        }
      }
      if (!this.terrain || this.terrainSeed !== finite(state.seed, 1)) this._buildTerrain(finite(state.seed, 1));
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#071718'; ctx.fillRect(0, 0, this.width, this.height);
      const background = ctx.createRadialGradient(this.width * 0.45, this.height * 0.4, 30, this.width * 0.45, this.height * 0.4, this.width * 0.8);
      background.addColorStop(0, '#173932'); background.addColorStop(1, '#071517'); ctx.fillStyle = background; ctx.fillRect(0, 0, this.width, this.height);
      if (this.terrain) {
        const projected = iso(this.camera.x, this.camera.y), terrain = this.terrain;
        const dx = this.width / 2 - (projected.x + terrain.ox) * this.zoom, dy = this.height * 0.51 - (projected.y + terrain.oy) * this.zoom;
        // Draw just the visible cache region, avoiding a full-map resample every frame.
        const sx = clamp(-dx / this.zoom, 0, terrain.canvas.width), sy = clamp(-dy / this.zoom, 0, terrain.canvas.height);
        const sw = Math.min(terrain.canvas.width - sx, this.width / this.zoom + 2), sh = Math.min(terrain.canvas.height - sy, this.height / this.zoom + 2);
        if (sw > 0 && sh > 0) ctx.drawImage(terrain.canvas, sx, sy, sw, sh, dx + sx * this.zoom, dy + sy * this.zoom, sw * this.zoom, sh * this.zoom);
      }
      this._waterShimmer(ctx, visualTime, options.quality);
      for (const zone of state.zones || []) this._drawZone(ctx, zone, visualTime, options.quality === 'low');
      for (const effect of state.effects || []) if (!['death', 'levelup', 'impact', 'projectile'].includes(effect.type)) this._drawGroundEffect(ctx, effect, visualTime);
      if (local && !local.dead) {
        const point = this.worldToScreen(local.x, local.y);
        glow(ctx, point.x, point.y - 6, 65 * this.zoom, HERO[local.heroId] ? HERO[local.heroId].color : TEAM[localTeam], 0.12);
        this._ring(ctx, point.x, point.y, 24 * this.zoom, '#d9f8df', 0.86);
      }
      if (options.pointer && options.pointer.active !== false) {
        const pointer = options.pointer, x = finite(pointer.worldX, pointer.x), y = finite(pointer.worldY, pointer.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const point = this.worldToScreen(x, y);
          this._ring(ctx, point.x, point.y, 16 * this.zoom, '#a7dec8', 0.35);
        }
      }
      const scene = [];
      const low = options.quality === 'low';
      const visibleHeroes = heroes.filter(hero => !(hero.hiddenTime > 0 && hero.team !== localTeam && local && Math.hypot(hero.x - local.x, hero.y - local.y) > 135));
      const heroPoints = visibleHeroes.filter(hero => !hero.dead && hero.hp > 0).map(hero => ({ ...this.worldToScreen(hero.x, hero.y), depth: hero.x + hero.y }));
      for (const prop of this.props) {
        const point = this.worldToScreen(prop.x, prop.y);
        if (!this._visible(point, 190 * this.zoom)) continue;
        const depth = prop.x + prop.y;
        // Heroes may pass through decorative forests. A translucent foreground canopy
        // preserves depth without making a hero disappear behind cached scenery.
        if (prop.kind === 'tree' && heroPoints.some(hero => depth > hero.depth && Math.abs(hero.x - point.x) < 43 * prop.size * this.zoom && hero.y - point.y < 20 && hero.y - point.y > -145 * prop.size * this.zoom)) scene.push({ type: 'prop', entity: prop, point, depth });
      }
      for (const entity of structures) { const point = this.worldToScreen(entity.x, entity.y); if (this._visible(point, 145)) scene.push({ type: 'structure', entity, point, depth: entity.x + entity.y }); }
      for (const entity of creeps) { if (entity.hp <= 0) continue; const point = this.worldToScreen(entity.x, entity.y); if (this._visible(point, 55)) scene.push({ type: 'creep', entity, point, depth: entity.x + entity.y }); }
      for (const entity of visibleHeroes) {
        const point = this.worldToScreen(entity.x, entity.y); if (this._visible(point, 100)) scene.push({ type: 'hero', entity, point, depth: entity.x + entity.y });
      }
      scene.sort((a, b) => a.depth - b.depth);
      for (const item of scene) {
        const { entity, point } = item;
        ctx.save(); ctx.translate(point.x, point.y); ctx.scale(this.zoom, this.zoom);
        if (item.type === 'prop') {
          // Canopies become transparent around every hero: decorative trees never hide combat.
          ctx.globalAlpha = 0.36;
          this._drawProp(ctx, entity, visualTime, low);
        } else if (item.type === 'structure') this._drawStructure(ctx, entity, visualTime, options.selectedTargetId === entity.id);
        else if (item.type === 'creep') this._drawCreep(ctx, entity, visualTime, options.selectedTargetId === entity.id);
        else this._drawHero(ctx, entity, visualTime, entity.playerId === options.playerId, options.selectedTargetId === entity.id);
        ctx.restore();
      }
      for (const projectile of state.projectiles || []) this._drawProjectile(ctx, projectile, visualTime);
      for (const effect of state.effects || []) this._drawAirEffect(ctx, effect, visualTime);
      this._ambient(ctx, visualTime, low);
      const vignette = ctx.createRadialGradient(this.width / 2, this.height * 0.47, Math.min(this.width, this.height) * 0.32, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.66);
      vignette.addColorStop(0, 'rgba(2,12,16,0)'); vignette.addColorStop(1, 'rgba(2,10,15,.38)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }
    _visible(point, margin = 80) { return point.x > -margin && point.y > -margin && point.x < this.width + margin && point.y < this.height + margin; }
    _ring(ctx, x, y, radius, color, opacity = 1) {
      ctx.save(); ctx.globalAlpha *= opacity; ellipse(ctx, x, y, radius, radius * 0.48, null, color, 1.6);
      ellipse(ctx, x, y, radius * 0.84, radius * 0.4, null, color, 0.4); ctx.restore();
    }
    _waterShimmer(ctx, time, quality) {
      const count = quality === 'low' ? 10 : 25;
      ctx.save();
      for (let i = 0; i < count; i++) {
        const value = (i * 127.6 + time * 8) % WORLD;
        const point = this.worldToScreen(value + Math.sin(i * 4) * 45, value + Math.cos(i * 2) * 45);
        if (!this._visible(point, 20)) continue;
        ctx.globalAlpha = (0.12 + Math.sin(time * 1.4 + i) * 0.08);
        line(ctx, [[point.x - 8 * this.zoom, point.y], [point.x + 9 * this.zoom, point.y + 1]], '#b3eee1', this.zoom);
      }
      ctx.restore();
    }
    _drawProp(ctx, prop, time, low) {
      ctx.save(); ctx.scale(prop.size, prop.size);
      if (prop.kind === 'tree') {
        const ash = prop.ash, variant = prop.variant;
        ellipse(ctx, 4, 1, 29, 11, 'rgba(2,13,17,.3)');
        polygon(ctx, [[-4, 1], [-2, -58], [5, -61], [8, 0]], ash ? '#49434a' : '#4b5140', '#263d32', 1);
        line(ctx, [[1, -30], [-15, -49], [-21, -65]], ash ? '#65515a' : '#4f5e45', 4);
        line(ctx, [[3, -46], [19, -67], [25, -80]], ash ? '#65515a' : '#4f5e45', 3);
        const shades = ash ? ['#303b3c', '#3c4a45', '#4d574b', '#59644e'] : ['#1b4c38', '#255d40', '#34704b', '#4a8555'];
        if (variant < 0.48) {
          for (let level = 0; level < 3; level++) {
            const y = -28 - level * 23, width = 35 - level * 7;
            polygon(ctx, [[-width, y], [-width * 0.55, y - 23], [-width * 0.73, y - 18], [0, y - 56], [width * 0.77, y - 20], [width * 0.55, y - 24], [width, y], [0, y + 8]], shades[level], '#173a31', 1);
            polygon(ctx, [[0, y - 55], [-width * 0.1, y + 5], [-width, y], [-width * 0.5, y - 24]], shades[level + 1]);
            line(ctx, [[-width * 0.65, y - 2], [-width * 0.27, y - 7]], ash ? '#7c8365' : '#80a36b', 1);
          }
        } else {
          const blobs = [[-21, -55, 23], [17, -62, 25], [-9, -83, 28], [15, -91, 21], [-27, -80, 19], [0, -108, 19]];
          blobs.forEach((blob, i) => {
            ellipse(ctx, blob[0], blob[1], blob[2], blob[2] * 0.8, shades[i % 3]);
            if (!low) ellipse(ctx, blob[0] - 4, blob[1] - 5, blob[2] * 0.65, blob[2] * 0.42, shades[(i % 2) + 2]);
          });
          line(ctx, [[-30, -75], [-22, -82], [-17, -83]], ash ? '#7c8365' : '#83a268', 1.2);
        }
        if (!low && variant > 0.82) { ellipse(ctx, -14, -51, 2.5, 2, ash ? '#d99a6c' : '#b6df83'); ellipse(ctx, 19, -77, 2, 1.5, '#b6df83'); }
      } else if (prop.kind === 'rock') {
        ellipse(ctx, 3, 2, 28, 11, 'rgba(5,15,20,.29)');
        polygon(ctx, [[-28, -6], [-21, -28], [2, -43], [24, -29], [32, -8], [8, 5]], '#516269', '#283f40', 1);
        polygon(ctx, [[-28, -6], [-21, -28], [2, -43], [-1, -11]], '#667b7a');
        polygon(ctx, [[2, -43], [24, -29], [32, -8], [-1, -11]], '#435559');
        line(ctx, [[-12, -29], [-2, -22], [2, -9], [11, -4]], '#304c4c', 1.3);
        ellipse(ctx, -15, -6, 12, 5, prop.ash ? '#626b52' : '#608364');
        polygon(ctx, [[29, -1], [30, -13], [40, -17], [45, -5], [39, 0]], '#50635e');
      } else if (prop.kind === 'ruin') {
        ellipse(ctx, 1, 0, 30, 10, 'rgba(4,14,20,.27)');
        polygon(ctx, [[-28, -6], [-7, -17], [25, -6], [4, 6]], '#637271');
        polygon(ctx, [[-24, -6], [-24, -49], [-5, -60], [12, -51], [12, -6], [-5, 2]], '#526667');
        polygon(ctx, [[-24, -49], [-5, -60], [12, -51], [-7, -41]], '#8a9990');
        polygon(ctx, [[-7, -41], [12, -51], [12, -6], [-7, 3]], '#3d5458');
        line(ctx, [[-19, -38], [-13, -31], [-21, -21]], '#28464b', 2);
        line(ctx, [[-4, -35], [4, -40], [4, -22], [-4, -17], [-4, -35]], prop.ash ? '#aa8365' : '#8fc6a5', 1.5);
        ellipse(ctx, -20, -4, 14, 5, '#486e54');
      } else {
        const color = prop.ash ? '#ecb17e' : '#79e3d2';
        glow(ctx, 0, -26, 40, color, 0.2);
        ellipse(ctx, 0, 0, 25, 11, '#2a4146', '#607d78', 2);
        polygon(ctx, [[-12, -5], [-12, -32], [0, -38], [12, -32], [12, -5], [0, 1]], '#566c70');
        polygon(ctx, [[-7, -31], [0, -59], [8, -31], [0, -20]], color, '#c2e3c5', 1);
        line(ctx, [[0, -57], [0, -22]], '#f2fbda', 1);
        if (!low) for (let i = 0; i < 3; i++) ellipse(ctx, Math.sin(time * 0.8 + i * 2) * 14, -48 + Math.cos(time + i) * 9, 1, 1, color);
      }
      ctx.restore();
    }
    _drawStructure(ctx, entity, time, selected) {
      const team = entity.team || 0, color = TEAM[team], alive = entity.hp > 0;
      if (selected && alive) this._ring(ctx, 0, 0, entity.type === 'core' ? 73 : 45, '#ffd1a3', 0.9);
      if (!alive) {
        ellipse(ctx, 0, 0, entity.type === 'core' ? 65 : 38, 20, '#263333');
        for (let i = 0; i < 5; i++) {
          const x = Math.sin(i * 8.3) * 25, y = Math.cos(i * 4.2) * 10;
          polygon(ctx, [[x - 12, y], [x - 7, y - 17], [x + 9, y - 13], [x + 15, y + 3]], '#4e5c58', '#283c39', 1);
        }
        return;
      }
      const core = entity.type === 'core';
      const r = core ? 62 : 35;
      ellipse(ctx, 4, 4, r + 13, r * 0.4, 'rgba(1,14,17,.32)');
      ellipse(ctx, 0, 0, r, r * 0.43, team ? '#5f4843' : '#4c6558', '#7f8f76', 2);
      ellipse(ctx, 0, -8, r - 6, r * 0.39, '#334b48', team ? '#b57b64' : '#8cad8b', 2);
      if (core) {
        glow(ctx, 0, -66, 90, color, 0.23);
        ellipse(ctx, 0, -13, 45, 18, '#1b393a', color, 1.4);
        ellipse(ctx, 0, -17, 36, 14, '#304849', '#9ba786', 1.5);
        for (let i = 0; i < 8; i++) {
          const angle = i / 8 * TAU, x = Math.cos(angle) * 39, y = Math.sin(angle) * 15 - 15;
          line(ctx, [[x, y], [x * 0.55, y - 10]], team ? '#b88d69' : '#a0b995', 2);
        }
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU, x = Math.cos(a) * 44, y = Math.sin(a) * 17 - 12;
          polygon(ctx, [[x - 8, y], [x - 8, y - 29], [x, y - 37], [x + 8, y - 29], [x + 8, y], [x, y + 4]], team ? '#795348' : '#637e68', '#283d3b', 1);
          ellipse(ctx, x, y - 29, 3, 2, color);
        }
        const bob = Math.sin(time * 1.6) * 4;
        polygon(ctx, [[-19, -51 + bob], [0, -119 + bob], [24, -61 + bob], [0, -28 + bob]], team ? '#b7523d' : '#3b9a80', '#d7e0a5', 1.5);
        polygon(ctx, [[-19, -51 + bob], [0, -119 + bob], [2, -55 + bob], [0, -28 + bob]], team ? '#ffba7f' : '#9af3bb');
        polygon(ctx, [[0, -119 + bob], [24, -61 + bob], [2, -55 + bob]], team ? '#f1764e' : '#60d6ae');
        line(ctx, [[0, -112 + bob], [2, -58 + bob], [0, -34 + bob]], '#fff2bc', 1.3);
        ctx.save(); ctx.translate(0, -67 + bob); ctx.rotate(Math.sin(time * 0.65) * 0.08);
        ellipse(ctx, 0, 0, 38, 12, null, color, 1.3); ctx.restore();
        for (let i = 0; i < 5; i++) ellipse(ctx, Math.sin(time + i * 2.4) * 30, -24 - ((time * 16 + i * 19) % 103), 1.4, 1.4, color);
      } else {
        polygon(ctx, [[-20, -11], [-17, -65], [0, -75], [18, -64], [21, -11], [0, -1]], team ? '#635354' : '#5b7164', '#243b39', 1.5);
        polygon(ctx, [[-20, -11], [-17, -65], [0, -75], [0, -1]], team ? '#7b6860' : '#7c9280');
        // Stone courses, a lit arrow slit, and a bronze belt make a tower architectural.
        line(ctx, [[-18, -26], [0, -18], [19, -27]], team ? '#54484b' : '#4c6155', 1.2);
        line(ctx, [[-18, -43], [0, -35], [18, -43]], team ? '#54484b' : '#4c6155', 1.2);
        line(ctx, [[-17, -58], [0, -50], [17, -58]], team ? '#54484b' : '#4c6155', 1.2);
        line(ctx, [[-9, -45], [-9, -30]], '#9fa88a', 0.9); line(ctx, [[8, -53], [8, -39]], '#344b47', 1.2);
        polygon(ctx, [[-5, -19], [-5, -38], [0, -43], [5, -39], [5, -19], [0, -16]], '#203c3a', '#a3ac89', 0.8);
        polygon(ctx, [[-2, -21], [-2, -36], [0, -39], [2, -36], [2, -21]], color);
        glow(ctx, 0, -29, 11, color, 0.17);
        polygon(ctx, [[-19, -14], [0, -5], [20, -15], [20, -11], [0, -1], [-20, -11]], team ? '#a17d57' : '#9aa17a');
        line(ctx, [[-12, -25], [-9, -54]], '#acb79a', 1.1);
        line(ctx, [[6, -23], [8, -52]], '#253b3c', 2);
        ellipse(ctx, 0, -68, 27, 12, '#3a4e4b', '#7e9884', 2);
        ellipse(ctx, 0, -71, 23, 9, '#63786c', team ? '#b89c76' : '#a7ba8e', 1.2);
        for (let i = 0; i < 4; i++) {
          const x = (i - 1.5) * 13;
          polygon(ctx, [[x - 5, -67], [x - 5, -80], [x + 4, -83], [x + 5, -70]], team ? '#81665b' : '#819580');
        }
        glow(ctx, 0, -88, 32, color, 0.28);
        polygon(ctx, [[-10, -88], [0, -113], [11, -88], [0, -76]], color, '#dceac0', 1);
        polygon(ctx, [[-10, -88], [0, -113], [0, -76]], team ? '#ffd3a2' : '#b3f2cb');
        if (entity.attackCooldown > 0) ellipse(ctx, 0, -91, 16, 7, null, color, 1.5);
        polygon(ctx, [[25, -48], [25, -83], [49, -76], [43, -61], [25, -66]], team ? '#873f35' : '#2c745c', color, 1);
      }
      this._healthbar(ctx, entity, core ? 84 : 54, core ? -140 : -128, false, false);
      if (entity.protected) {
        ctx.save(); ctx.globalAlpha *= 0.25;
        ellipse(ctx, 0, core ? -65 : -54, core ? 72 : 41, core ? 85 : 68, null, '#c1d9d3', 1);
        ctx.restore();
        const x = core ? 51 : 35, y = core ? -139 : -127;
        ctx.strokeStyle = '#b4c4bc'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 3, Math.PI, 0); ctx.stroke(); roundRect(ctx, x - 4, y, 8, 6, 1.5, '#b4c4bc');
      }
    }
    _drawCreep(ctx, entity, time, selected) {
      const team = entity.team || 0, color = TEAM[team];
      if (selected) this._ring(ctx, 0, 0, 17, '#ffcf98', 1);
      ellipse(ctx, 1, 2, 12, 5, 'rgba(0,12,18,.35)');
      const moving = entity.moveTarget || entity.targetId || entity.pathIndex !== undefined;
      const bounce = moving ? Math.sin(time * 8 + finite(entity.x) * 0.02) * 1.3 : 0;
      line(ctx, [[-5, -4], [-6, -11 + bounce]], '#283b3d', 4); line(ctx, [[5, -4], [5, -11 + bounce]], '#283b3d', 4);
      polygon(ctx, [[-9, -12 + bounce], [-7, -26 + bounce], [6, -27 + bounce], [10, -11 + bounce], [0, -8 + bounce]], team ? '#8a5345' : '#507c68', '#233b39', 1);
      polygon(ctx, [[-8, -26 + bounce], [0, -35 + bounce], [9, -27 + bounce], [7, -22 + bounce], [-6, -22 + bounce]], team ? '#ba856b' : '#91b698', '#354e46', 1);
      line(ctx, [[-3, -25 + bounce], [3, -25 + bounce]], '#15282d', 2.5);
      if (entity.ranged || entity.type === 'ranged') {
        line(ctx, [[11, -11], [11, -38]], '#8d7863', 2.5); ellipse(ctx, 11, -39, 3, 4, color);
      } else {
        polygon(ctx, [[10, -11], [16, -31], [20, -32], [16, -12]], '#a8bbaf', '#354f4b', 1);
        polygon(ctx, [[-14, -9], [-14, -25], [-7, -28], [-2, -22], [-3, -11], [-8, -6]], team ? '#963f35' : '#2e755d', '#99b296', 1);
      }
      if (entity.hp < entity.maxHp || selected) this._healthbar(ctx, entity, 26, -43, false, true);
    }
    _drawHero(ctx, hero, time, local, selected) {
      const def = HERO[hero.heroId] || HERO.aster, dead = hero.dead || hero.hp <= 0;
      if (dead) {
        ellipse(ctx, 0, 0, 24, 10, 'rgba(6,19,25,.3)', '#6d7b80', 0.6);
        ctx.save(); ctx.globalAlpha = 0.32; this._heroSprite(ctx, hero.heroId, time, false, true); ctx.restore();
        if (local) { ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#d2dbe0'; ctx.fillText(`Возрождение ${Math.ceil(finite(hero.respawn))}с`, 0, -67); }
        return;
      }
      if (selected) { this._ring(ctx, 0, 0, 29, '#ffd49f', 0.95); this._ring(ctx, 0, 0, 32 + Math.sin(time * 4) * 2, '#f7a967', 0.35); }
      ellipse(ctx, 2, 2, 19, 8, 'rgba(0,13,18,.42)');
      ctx.save(); if (hero.hiddenTime > 0) ctx.globalAlpha *= 0.48;
      this._heroSprite(ctx, hero.heroId, time + String(hero.id).length * 0.47, !!hero.moveTarget, false, hero.facing);
      ctx.restore();
      if (hero.root > 0) {
        for (let i = 0; i < 4; i++) {
          const x = (i - 1.5) * 8;
          line(ctx, [[x, 4], [x - 5, -7], [x + 3, -17], [x - 4, -26]], i % 2 ? '#84b66b' : '#b5d188', 2);
        }
        this._ring(ctx, 0, 0, 23, '#a2cd7a', 0.75);
      }
      if (hero.stun > 0) {
        ctx.beginPath(); ctx.ellipse(0, -76, 18, 5, 0, 0, TAU); ctx.strokeStyle = '#e9d298'; ctx.lineWidth = 0.9; ctx.stroke();
        for (let i = 0; i < 3; i++) { const a = time * 3 + i * TAU / 3, x = Math.cos(a) * 18, y = -76 + Math.sin(a) * 5; polygon(ctx, [[x, y - 3], [x + 3, y], [x, y + 3], [x - 3, y]], '#fff1b4'); }
      }
      if (hero.markTime > 0) { ellipse(ctx, 0, -31, 25, 32, null, '#db91e8', 1); polygon(ctx, [[-5, -89], [0, -83], [5, -89]], '#d6a0ec'); }
      if (hero.shield > 0 || hero.shieldHp > 0 || hero.shieldTime > 0) {
        ctx.save(); ctx.globalAlpha = 0.4; ellipse(ctx, 0, -27, 29, 43, null, def.color, 1.5); glow(ctx, -19, -37, 16, def.color, 0.25); ctx.restore();
      }
      if (hero.recall > 0 || hero.recalling || hero.recallTime > 0) {
        const pulse = Math.sin(time * 4) * 2;
        this._ring(ctx, 0, 0, 29 + pulse, TEAM[hero.team || 0], 0.9);
        ctx.save(); ctx.globalAlpha = 0.25; const beam = ctx.createLinearGradient(0, -130, 0, 0); beam.addColorStop(0, 'transparent'); beam.addColorStop(1, TEAM[hero.team || 0]); ctx.fillStyle = beam; ctx.fillRect(-15, -130, 30, 130); ctx.restore();
      }
      this._healthbar(ctx, hero, local ? 56 : 48, -70, true, false);
      if (local || selected) {
        ctx.textAlign = 'center'; ctx.font = `${local ? '600' : '500'} 10px system-ui,sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,17,22,.9)';
        const label = String(hero.name || '').slice(0, 18); ctx.strokeText(label, 0, -82); ctx.fillStyle = local ? '#f4f1d7' : '#e1e9e1'; ctx.fillText(label, 0, -82);
      }
    }
    _heroSprite(ctx, heroId, time, moving, portrait = false, facing) {
      const def = HERO[heroId] || HERO.aster, color = def.color, dark = def.dark;
      const bob = moving ? Math.sin(time * 9) * 1.4 : Math.sin(time * 2.1) * 0.55;
      const stride = moving ? Math.sin(time * 9) * 3 : 0;
      ctx.save(); ctx.translate(0, bob);
      // A silhouette and one strong colored material distinguish each role at a glance.
      line(ctx, [[-6, -3], [-6 + stride, -16]], '#24323d', 7); line(ctx, [[7, -3], [6 - stride, -16]], '#1d2d36', 7);
      polygon(ctx, [[-10, -13], [-15, -39], [-7, -47], [10, -46], [16, -15], [0, -7]], dark, '#152c33', 1.2);
      if (def.kind === 0) {
        polygon(ctx, [[-16, -10], [-17, -38], [-10, -46], [10, -46], [17, -39], [16, -12]], '#af8e50', '#303e39', 1.2);
        polygon(ctx, [[-13, -35], [0, -42], [12, -35], [9, -18], [0, -12], [-10, -19]], '#ead38a', '#6b6d4d', 1);
        polygon(ctx, [[-17, -38], [-23, -44], [-17, -51], [-7, -45], [-7, -36]], '#dbc688');
        polygon(ctx, [[10, -45], [19, -51], [25, -42], [17, -35], [9, -36]], '#c3ab6b');
        polygon(ctx, [[-30, -13], [-32, -39], [-20, -46], [-8, -38], [-10, -17], [-21, -8]], '#7b784d', '#f0d789', 2);
        polygon(ctx, [[-25, -31], [-20, -39], [-15, -30], [-20, -22]], '#f9e9ab');
        line(ctx, [[25, -9], [25, -52]], '#b0bcb1', 5); polygon(ctx, [[21, -50], [25, -69], [30, -50]], '#f6eaca', '#778475', 1); line(ctx, [[18, -42], [33, -42]], '#d9b771', 3);
        polygon(ctx, [[-9, -44], [-10, -56], [0, -62], [10, -55], [9, -44], [0, -39]], '#bfa776', '#454b43', 1);
        line(ctx, [[-6, -49], [6, -49]], '#182d34', 3); line(ctx, [[0, -59], [0, -42]], '#f2df99', 2);
      } else if (def.kind === 1) {
        polygon(ctx, [[-17, -5], [-13, -34], [-8, -42], [9, -42], [17, -5], [1, 1]], '#3e8d99', '#183d4b', 1);
        polygon(ctx, [[-11, -32], [0, -40], [11, -32], [4, -10], [-2, -4]], '#7adcd2');
        polygon(ctx, [[-14, -40], [-20, -23], [-25, -26], [-19, -45], [-10, -49]], '#5eaeab');
        line(ctx, [[18, -7], [22, -65]], '#aaa98a', 3);
        ctx.save(); ctx.translate(23, -63); ctx.rotate(-0.3); ctx.beginPath(); ctx.arc(0, 0, 9, -0.1, Math.PI * 1.7); ctx.strokeStyle = '#b9f6df'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
        glow(ctx, 23, -63, 13, color, 0.4); ellipse(ctx, 23, -63, 3.5, 3.5, '#caffed');
        ellipse(ctx, 0, -48, 8, 10, '#d1c6ab');
        polygon(ctx, [[-10, -43], [-11, -56], [-1, -64], [10, -55], [11, -44], [5, -49], [3, -56], [-5, -54], [-4, -40]], '#b9e6d5');
        line(ctx, [[-7, -58], [3, -60], [10, -55]], '#e4f3cb', 2);
      } else if (def.kind === 2) {
        polygon(ctx, [[-15, -6], [-20, -35], [-10, -47], [5, -44], [13, -13]], '#824c46', '#27373b', 1);
        polygon(ctx, [[-12, -36], [0, -42], [11, -34], [9, -18], [-9, -17]], '#ce7f53');
        line(ctx, [[-9, -35], [8, -20]], '#e1c58c', 3); line(ctx, [[-10, -20], [10, -20]], '#4f4543', 3);
        line(ctx, [[-14, -41], [-24, -62]], '#837d64', 4); line(ctx, [[-24, -62], [-26, -70]], '#ddb88c', 1.5);
        ctx.beginPath(); ctx.moveTo(16, -46); ctx.quadraticCurveTo(43, -24, 17, -5); ctx.strokeStyle = '#e6ba7e'; ctx.lineWidth = 3; ctx.stroke(); line(ctx, [[16, -46], [20, -25], [17, -5]], '#d3d7ae', 0.8);
        line(ctx, [[6, -29], [31, -29]], '#bcb99b', 1.8); polygon(ctx, [[31, -32], [39, -29], [31, -26]], '#f1ba6d');
        ellipse(ctx, 0, -49, 8, 10, '#d1b692');
        polygon(ctx, [[-12, -42], [-13, -55], [-1, -64], [11, -55], [9, -44], [5, -50], [-2, -55], [-7, -49], [-7, -42]], '#bd7050', '#4b3c3b', 1);
        polygon(ctx, [[-10, -60], [0, -68], [5, -59]], '#e6a45d');
      } else if (def.kind === 3) {
        polygon(ctx, [[-15, -12], [-19, -38], [-9, -49], [10, -47], [21, -33], [15, -10]], '#596c46', '#263b36', 1.3);
        polygon(ctx, [[-13, -33], [0, -43], [15, -33], [9, -17], [-1, -11], [-10, -18]], '#91aa60');
        polygon(ctx, [[-21, -27], [-27, -46], [-14, -51], [-5, -40], [-9, -28]], '#729652', '#b0c87d', 1);
        polygon(ctx, [[10, -40], [20, -53], [27, -36], [21, -24]], '#5d7b49', '#a2b96b', 1);
        line(ctx, [[-20, -44], [-29, -57], [-26, -60]], '#b5c080', 2.5); line(ctx, [[19, -47], [27, -62], [33, -65]], '#b5c080', 2.5);
        line(ctx, [[24, -8], [27, -62]], '#776748', 5);
        polygon(ctx, [[25, -57], [39, -67], [43, -51], [30, -40], [20, -43]], '#a5bd7d', '#3a5748', 1.5); line(ctx, [[29, -58], [39, -63]], '#d9de9f', 2);
        ellipse(ctx, 0, -49, 9, 11, '#b0b28a');
        polygon(ctx, [[-11, -50], [-10, -59], [-3, -66], [2, -62], [8, -66], [12, -56], [8, -47], [5, -56], [-5, -56]], '#6e8e56');
        polygon(ctx, [[-6, -44], [0, -37], [7, -44], [6, -34], [0, -29], [-6, -36]], '#aec28b');
      } else if (def.kind === 4) {
        polygon(ctx, [[-21, -4], [-15, -41], [-5, -50], [12, -42], [23, -7], [5, -13], [-7, -5]], '#51446f', '#26303e', 1);
        polygon(ctx, [[-11, -34], [0, -43], [12, -33], [7, -16], [-8, -14]], '#8f76ad');
        line(ctx, [[-10, -33], [8, -17]], '#d4b6df', 2);
        polygon(ctx, [[-16, -24], [-34, -34], [-23, -46], [-23, -35], [-12, -30]], '#d9d5e0', '#645d82', 1);
        polygon(ctx, [[15, -21], [32, -36], [35, -27], [20, -11]], '#bcb8dd', '#645d82', 1);
        ellipse(ctx, 0, -49, 7, 10, '#b5adc2');
        polygon(ctx, [[-12, -43], [-14, -56], [0, -67], [13, -55], [10, -43], [5, -52], [0, -57], [-6, -52], [-7, -43]], '#655181', '#a091b7', 1);
        polygon(ctx, [[-6, -48], [7, -48], [5, -42], [-4, -42]], '#403750');
        line(ctx, [[-5, -50], [-1, -50]], '#eee0ff', 1.5); line(ctx, [[3, -50], [6, -50]], '#eee0ff', 1.5);
      } else {
        polygon(ctx, [[-17, -3], [-13, -38], [-6, -45], [9, -44], [18, -3], [2, 1]], '#4d68a2', '#22354d', 1);
        polygon(ctx, [[-12, -35], [0, -43], [12, -35], [5, -21], [-6, -19]], '#91b2cf');
        line(ctx, [[0, -39], [0, -13]], '#d7d9b7', 2); line(ctx, [[-11, -13], [11, -13]], '#c3b78b', 2);
        ellipse(ctx, -22, -29, 6, 6, '#7dcceb'); glow(ctx, -22, -29, 19, color, 0.3);
        line(ctx, [[16, -8], [20, -64]], '#aab9bd', 3);
        polygon(ctx, [[18, -52], [12, -63], [21, -74], [28, -63], [23, -52]], '#7ab5d5', '#c6e1da', 1);
        polygon(ctx, [[20, -72], [16, -62], [24, -65], [19, -55]], '#e8f7de');
        ellipse(ctx, 0, -49, 8, 10, '#c8bda7');
        polygon(ctx, [[-12, -49], [-9, -58], [-3, -62], [1, -73], [6, -59], [13, -51]], '#8daabd', '#d5dcb8', 1);
        polygon(ctx, [[-7, -43], [1, -37], [7, -43], [5, -32], [0, -28]], '#b7d7da');
      }
      if (!portrait) { ellipse(ctx, -3, -51, 1, 0.8, '#f5f1d8'); ellipse(ctx, 4, -51, 1, 0.8, '#f5f1d8'); }
      ctx.restore();
    }
    _healthbar(ctx, entity, width, y, mana, small) {
      const hp = clamp(finite(entity.hp) / Math.max(1, finite(entity.maxHp, 1)), 0, 1), team = entity.team || 0;
      roundRect(ctx, -width / 2 - 1, y - 1, width + 2, (small ? 3 : 5) + (mana ? 4 : 0) + 2, 2, 'rgba(3,15,21,.9)');
      roundRect(ctx, -width / 2, y, width, small ? 3 : 5, 1, '#253b3c');
      if (hp > 0) roundRect(ctx, -width / 2, y, Math.max(0.1, width * hp), small ? 3 : 5, 1, TEAM[team]);
      if (!small) {
        ctx.strokeStyle = 'rgba(6,27,29,.48)'; ctx.lineWidth = 1;
        for (let x = 10; x < width; x += 10) { ctx.beginPath(); ctx.moveTo(-width / 2 + x, y); ctx.lineTo(-width / 2 + x, y + 5); ctx.stroke(); }
      }
      if (mana) {
        roundRect(ctx, -width / 2, y + 7, width, 2, 0.5, '#24343e');
        const ratio = clamp(finite(entity.mana) / Math.max(1, finite(entity.maxMana, 1)), 0, 1);
        if (ratio) roundRect(ctx, -width / 2, y + 7, Math.max(0.1, width * ratio), 2, 0.5, '#7fb7e6');
        roundRect(ctx, -width / 2 - 15, y - 2, 13, 13, 3, '#172d31');
        ctx.fillStyle = '#ecdcab'; ctx.font = '700 8px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(entity.level || 1), -width / 2 - 8.5, y + 7);
      }
    }
    _effectData(effect) {
      const life = Math.max(0, finite(effect.life)), maxLife = Math.max(0.01, finite(effect.maxLife, life || 1));
      return { point: this.worldToScreen(effect.x, effect.y), remaining: clamp(life / maxLife, 0, 1), progress: 1 - clamp(life / maxLife, 0, 1), color: effect.color || (HERO[effect.heroId] && HERO[effect.heroId].color) || TEAM[effect.team || 0] };
    }
    _drawZone(ctx, zone, time, low) {
      if (!(zone.duration > 0)) return;
      const point = this.worldToScreen(zone.x, zone.y), radius = clamp(finite(zone.radius, 120), 10, 600) * this.zoom, color = zone.color || TEAM[zone.team || 0];
      if (!this._visible(point, radius + 60)) return;
      ctx.save(); ctx.translate(point.x, point.y); ctx.globalAlpha = clamp(zone.duration, 0, 1) * 0.75;
      const fill = ctx.createRadialGradient(0, 0, 1, 0, 0, radius); fill.addColorStop(0, color); fill.addColorStop(0.6, 'rgba(14,37,48,.3)'); fill.addColorStop(1, 'transparent');
      ctx.save(); ctx.scale(1, 0.48); ctx.globalAlpha *= 0.3; ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill(); ctx.restore();
      this._ring(ctx, 0, 0, radius, color, 0.65);
      this._ring(ctx, 0, 0, radius * (0.94 + Math.sin(time * 3) * 0.035), color, 0.2);
      if (zone.type === 'vortex') {
        ctx.save(); ctx.scale(1, 0.48);
        for (let i = 0; i < 3; i++) { const a = time * 1.8 + i * TAU / 3; ctx.beginPath(); ctx.arc(0, 0, radius * (0.3 + i * 0.23), a, a + Math.PI * 1.2); ctx.strokeStyle = i === 1 ? '#c6eee6' : color; ctx.lineWidth = this.zoom * (i === 1 ? 2 : 4); ctx.stroke(); }
        ctx.restore();
      } else if (zone.type === 'fire') {
        for (let i = 0; i < (low ? 5 : 9); i++) {
          const a = i * 2.4, d = radius * (0.3 + (i % 3) * 0.23), x = Math.cos(a) * d, y = Math.sin(a) * d * 0.48, h = (13 + Math.sin(time * 6 + i) * 5) * this.zoom;
          ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.quadraticCurveTo(x - 7, y - h * 0.4, x + Math.sin(time * 4 + i) * 4, y - h); ctx.quadraticCurveTo(x + 10, y - h * 0.3, x + 4, y); ctx.closePath(); ctx.fillStyle = i % 2 ? '#f6a465' : '#ffcd85'; ctx.fill();
        }
      } else if (zone.type === 'storm') {
        for (let i = 0; i < (low ? 2 : 4); i++) {
          const phase = Math.floor(time * 5 + i * 3), a = phase * 2.39, d = radius * 0.65, x = Math.cos(a) * d, y = Math.sin(a) * d * 0.48;
          line(ctx, [[x - 5, y - 52 * this.zoom], [x + 3, y - 36 * this.zoom], [x - 5, y - 25 * this.zoom], [x + 5, y - 13 * this.zoom], [x, y]], '#c3ecff', 1.3);
          ellipse(ctx, x, y, 7 * this.zoom, 3 * this.zoom, null, color, 1);
        }
      }
      ctx.restore();
    }
    _drawGroundEffect(ctx, effect, time) {
      if (effect.life <= 0) return;
      const { point, remaining, progress, color } = this._effectData(effect);
      const radius = clamp(finite(effect.radius, 55), 10, 600) * this.zoom;
      if (!this._visible(point, radius + 40)) return;
      ctx.save(); ctx.translate(point.x, point.y); ctx.globalAlpha = remaining;
      if (effect.type === 'heal') {
        glow(ctx, 0, -10, radius * 0.8, '#81f5bb', 0.28);
        this._ring(ctx, 0, 0, radius * (0.65 + progress * 0.5), '#8cf3c2', 0.75);
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + time, x = Math.cos(a) * radius * 0.5, y = Math.sin(a) * radius * 0.23 - progress * 35; line(ctx, [[x - 3, y], [x + 3, y]], '#bdf9d0', 2); line(ctx, [[x, y - 3], [x, y + 3]], '#bdf9d0', 2); }
      } else if (effect.type === 'recall' || effect.type === 'spawn') {
        this._ring(ctx, 0, 0, radius * (0.8 + Math.sin(time * 5) * 0.07), color, 0.9);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + time * 0.7; ellipse(ctx, Math.cos(a) * radius, Math.sin(a) * radius * 0.48, 2, 2, color); }
      } else if (effect.type === 'dash' && Number.isFinite(effect.tx) && Number.isFinite(effect.ty)) {
        const end = this.worldToScreen(effect.tx, effect.ty); line(ctx, [[0, -9], [end.x - point.x, end.y - point.y - 9]], color, 9 * remaining); line(ctx, [[0, -9], [end.x - point.x, end.y - point.y - 9]], '#f2f3d2', 1.8 * remaining);
      } else if (effect.type === 'shield') {
        this._ring(ctx, 0, 0, radius * (0.8 + progress * 0.2), color, 0.6);
      } else {
        const r = radius * (0.35 + progress * 0.7);
        ellipse(ctx, 0, 0, r, r * 0.48, null, color, Math.max(0.5, 4 * remaining));
        ellipse(ctx, 0, 0, r * 0.78, r * 0.38, null, color, 0.8);
        glow(ctx, 0, -3, r * 1.1, color, remaining * 0.17);
        if (effect.type === 'burst' || effect.type === 'ring') for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + progress; line(ctx, [[Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.36], [Math.cos(a) * r, Math.sin(a) * r * 0.48]], color, 1.2); }
      }
      ctx.restore();
    }
    _drawAirEffect(ctx, effect, time) {
      if (effect.life <= 0) return;
      const { point, remaining, progress, color } = this._effectData(effect);
      const radius = clamp(finite(effect.radius, 45), 10, 400) * this.zoom;
      if (!this._visible(point, radius + 110)) return;
      ctx.save(); ctx.translate(point.x, point.y); ctx.globalAlpha = remaining;
      if (effect.type === 'impact' || effect.type === 'burst' || effect.type === 'slash') {
        const r = Math.min(radius, 75) * (0.3 + progress);
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * TAU + finite(effect.slot) * 0.7, length = (i % 3 + 1) * 4;
          line(ctx, [[Math.cos(a) * r, Math.sin(a) * r * 0.7 - 21 - progress * 14], [Math.cos(a) * (r + length), Math.sin(a) * (r + length) * 0.7 - 21 - progress * 14]], i % 2 ? color : '#fff1cb', Math.max(0.6, 2 * remaining));
        }
        if (effect.type === 'slash') { ctx.save(); ctx.translate(0, -25); ctx.rotate(-0.8 + progress * 1.5); ctx.beginPath(); ctx.arc(0, 0, 32, -1, 1); ctx.strokeStyle = '#ffecc2'; ctx.lineWidth = remaining * 5; ctx.stroke(); ctx.restore(); }
        else glow(ctx, 0, -24, 26 * (1 - progress * 0.4), color, remaining * 0.45);
      } else if (effect.type === 'death') {
        for (let i = 0; i < 8; i++) { const a = i * 2.4; ellipse(ctx, Math.sin(a) * progress * 30, -15 - progress * (35 + i * 4), 1.5, 2.5, color); }
      } else if (effect.type === 'levelup') {
        glow(ctx, 0, -40, 55, '#f6d888', 0.32);
        for (let i = 0; i < 5; i++) line(ctx, [[(i - 2) * 11, -progress * 80], [(i - 2) * 11, -progress * 80 - 20]], '#fbe4ac', 1.6);
        ctx.font = '700 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffedb8'; ctx.fillText('НОВЫЙ УРОВЕНЬ', 0, -85 - progress * 22);
      } else if (effect.type === 'shield') {
        ellipse(ctx, 0, -28, 31, 46, null, color, 2 * remaining); glow(ctx, 16, -49, 17, color, 0.3);
      } else if (effect.type === 'spark') {
        for (let i = 0; i < 9; i++) { const a = i * 2.4, x = Math.sin(a) * progress * 24, y = -13 - progress * (20 + i * 4); polygon(ctx, [[x - 2, y], [x, y - 3], [x + 2, y], [x, y + 3]], '#f9df9b'); }
      }
      if (effect.text && effect.type !== 'levelup') {
        ctx.font = '700 15px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = '#122b2c'; ctx.lineWidth = 3; ctx.strokeText(String(effect.text).slice(0, 24), 0, -65 - progress * 35); ctx.fillStyle = color; ctx.fillText(String(effect.text).slice(0, 24), 0, -65 - progress * 35);
      }
      ctx.restore();
    }
    _drawProjectile(ctx, projectile, time) {
      const point = this.worldToScreen(projectile.x, projectile.y);
      if (!this._visible(point, 50)) return;
      const end = this.worldToScreen(finite(projectile.tx, projectile.x + 1), finite(projectile.ty, projectile.y));
      const color = projectile.color || TEAM[projectile.team || 0], angle = Math.atan2(end.y - point.y, end.x - point.x);
      ctx.save(); ctx.translate(point.x, point.y - 24 * this.zoom); ctx.rotate(angle); ctx.scale(this.zoom, this.zoom);
      glow(ctx, 0, 0, projectile.kind === 'orb' ? 19 : 13, color, 0.4);
      line(ctx, [[-25, 0], [-4, 0]], color, 2.2);
      if (projectile.kind === 'arrow') {
        line(ctx, [[-13, 0], [9, 0]], '#e6d2ad', 1.6); polygon(ctx, [[6, -3], [14, 0], [6, 3]], '#fff1c9'); line(ctx, [[-10, 0], [-15, -4]], '#bda980', 1);
      } else if (projectile.kind === 'bolt') {
        polygon(ctx, [[-15, -2], [-2, -5], [-4, -1], [11, -2], [2, 4], [3, 0]], '#e5fbff');
      } else { ellipse(ctx, 0, 0, Math.max(3, finite(projectile.radius, 4)), Math.max(2, finite(projectile.radius, 4)), '#edffe9'); }
      ctx.restore();
    }
    _ambient(ctx, time, low) {
      ctx.save();
      // Low-cost drifting motes, anchored to the world, keep the scene alive.
      const count = low ? 10 : 26;
      for (let i = 0; i < count; i++) {
        const x = (Math.sin(i * 123.45) * 0.5 + 0.5) * WORLD + Math.sin(time * 0.3 + i) * 12;
        const y = (Math.sin(i * 43.72 + 3) * 0.5 + 0.5) * WORLD;
        const point = this.worldToScreen(x, y);
        if (!this._visible(point, 20)) continue;
        const ash = x > y;
        ctx.globalAlpha = 0.2 + (Math.sin(time * 1.2 + i * 2) * 0.5 + 0.5) * 0.5;
        ellipse(ctx, point.x, point.y - 20 - Math.sin(time * 0.6 + i) * 12, ash ? 1.1 : 1.5, ash ? 1.8 : 1.2, ash ? '#ffd39d' : '#c4eb9a');
      }
      // Translucent cloud shadows cross the map slowly without hiding unit silhouettes.
      if (!low) for (let i = 0; i < 3; i++) {
        const x = ((time * 3 + i * 310) % (this.width + 500)) - 250, y = this.height * (0.2 + i * 0.27);
        const shadow = ctx.createRadialGradient(x, y, 5, x, y, 200); shadow.addColorStop(0, 'rgba(4,22,30,.075)'); shadow.addColorStop(1, 'rgba(4,22,30,0)'); ctx.fillStyle = shadow; ctx.fillRect(x - 200, y - 200, 400, 400);
      }
      ctx.restore();
    }
    drawMinimap(canvas, state, playerId) {
      if (!canvas || !canvas.getContext || !state) return;
      const ctx = canvas.getContext('2d'), width = canvas.width || 160, height = canvas.height || 160;
      if (!ctx) return;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
      const pad = 7, scale = Math.min((width - pad * 2) / WORLD, (height - pad * 2) / WORLD), left = (width - WORLD * scale) / 2, top = (height - WORLD * scale) / 2;
      const point = (x, y) => [left + x * scale, top + y * scale];
      const bg = ctx.createLinearGradient(0, height, width, 0); bg.addColorStop(0, '#204638'); bg.addColorStop(1, '#493a3c');
      roundRect(ctx, 0, 0, width, height, 7, '#102927'); ctx.fillStyle = bg; ctx.fillRect(left, top, WORLD * scale, WORLD * scale);
      line(ctx, [point(0, 0), point(600, 600), point(1200, 1200), point(1800, 1800), point(WORLD, WORLD)], '#427b80', 180 * scale);
      for (const lane of this.map.lanes || FALLBACK_MAP.lanes) line(ctx, lane.map(p => point(p.x, p.y)), '#90907a', Math.max(2, 70 * scale));
      for (const structure of state.structures || []) {
        if (structure.hp <= 0) continue; const p = point(structure.x, structure.y), core = structure.type === 'core';
        if (core) polygon(ctx, [[p[0], p[1] - 5], [p[0] + 5, p[1]], [p[0], p[1] + 5], [p[0] - 5, p[1]]], TEAM[structure.team || 0], '#172e2b', 1);
        else { ctx.fillStyle = TEAM[structure.team || 0]; ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4); }
      }
      for (const creep of state.creeps || []) { if (creep.hp <= 0) continue; const p = point(creep.x, creep.y); ellipse(ctx, p[0], p[1], 1.1, 1.1, TEAM[creep.team || 0]); }
      const observer = (state.heroes || []).find(hero => hero.playerId === playerId);
      for (const hero of state.heroes || []) {
        if (hero.dead || hero.hp <= 0) continue;
        if (hero.hiddenTime > 0 && observer && hero.team !== observer.team && Math.hypot(hero.x - observer.x, hero.y - observer.y) > 135) continue;
        const p = point(hero.x, hero.y), local = hero.playerId === playerId;
        ellipse(ctx, p[0], p[1], local ? 3.6 : 2.7, local ? 3.6 : 2.7, local ? '#fff7cf' : TEAM[hero.team || 0], '#112c2c', 1);
      }
      const corners = [this.screenToWorld(0, 0), this.screenToWorld(this.width, 0), this.screenToWorld(this.width, this.height), this.screenToWorld(0, this.height)].map(p => point(p.x, p.y));
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, WORLD * scale, WORLD * scale); ctx.clip(); polygon(ctx, corners, 'rgba(232,242,217,.035)', '#d3e0c5', 0.8); ctx.restore();
      ctx.strokeStyle = '#668573'; ctx.lineWidth = 1; ctx.strokeRect(left + 0.5, top + 0.5, WORLD * scale - 1, WORLD * scale - 1); ctx.restore();
    }
    destroy() { this.terrain = null; this.props = []; this.lastFrame = null; }
  }

  BattleRenderer.drawPortrait = function (ctx, heroId, x, y, size) {
    if (!ctx || !Number.isFinite(size) || size <= 0) return;
    const def = HERO[heroId] || HERO.aster;
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.clip();
    const bg = ctx.createLinearGradient(0, 0, size, size); bg.addColorStop(0, def.dark); bg.addColorStop(1, '#152b33'); ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
    glow(ctx, size * 0.45, size * 0.42, size * 0.7, def.color, 0.22);
    for (let i = 0; i < 5; i++) {
      ctx.save(); ctx.globalAlpha = 0.08; line(ctx, [[size * (0.1 + i * 0.23), 0], [size * (i * 0.23 - 0.3), size]], '#fff0cc', 1); ctx.restore();
    }
    ctx.save(); ctx.translate(size * 0.49, size * 1.2); ctx.scale(size / 58, size / 58);
    BattleRenderer.prototype._heroSprite.call({}, ctx, heroId, 0, false, true); ctx.restore();
    const shade = ctx.createLinearGradient(0, size * 0.62, 0, size); shade.addColorStop(0, 'rgba(9,24,30,0)'); shade.addColorStop(1, 'rgba(5,17,23,.7)'); ctx.fillStyle = shade; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = def.color; ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(1, size / 80); ctx.strokeRect(0.5, 0.5, size - 1, size - 1); ctx.restore();
  };
  BattleRenderer.drawHeroArt = function (ctx, heroId, x, y, size) {
    if (!ctx || !Number.isFinite(size) || size <= 0) return;
    const def = HERO[heroId] || HERO.aster, color = def.color;
    ctx.save(); ctx.translate(x, y);
    // The stage remains transparent. A halo, flowing cape, and engraved summoning
    // circle frame the full silhouette, rather than enlarging a square portrait.
    glow(ctx, size * 0.5, size * 0.43, size * 0.47, color, 0.18);
    glow(ctx, size * 0.5, size * 0.81, size * 0.29, color, 0.11);
    const fx = size * 0.5, fy = size * 0.85;
    ellipse(ctx, fx, fy + size * 0.015, size * 0.29, size * 0.075, 'rgba(3,16,20,.32)');
    ellipse(ctx, fx, fy, size * 0.32, size * 0.083, null, color, Math.max(1, size / 450));
    ellipse(ctx, fx, fy, size * 0.28, size * 0.069, null, color, Math.max(0.5, size / 800));
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU, px = fx + Math.cos(a) * size * 0.302, py = fy + Math.sin(a) * size * 0.077;
      polygon(ctx, [[px, py - size * 0.005], [px + size * 0.008, py], [px, py + size * 0.005], [px - size * 0.008, py]], color);
    }
    ctx.save(); ctx.translate(size * 0.49, size * 0.825); ctx.scale(size / 100, size / 100);
    const cape = ctx.createLinearGradient(-25, -50, 20, 1); cape.addColorStop(0, def.dark); cape.addColorStop(0.5, '#233b40'); cape.addColorStop(1, 'rgba(15,31,38,.15)');
    ctx.beginPath(); ctx.moveTo(-12, -46); ctx.quadraticCurveTo(-26, -26, -37, -7); ctx.quadraticCurveTo(-9, 4, 5, -1); ctx.quadraticCurveTo(18, 1, 30, -4); ctx.quadraticCurveTo(17, -19, 12, -45); ctx.closePath(); ctx.fillStyle = cape; ctx.fill();
    line(ctx, [[-12, -44], [-20, -19], [-31, -8]], def.color, 0.6);
    ctx.save(); ctx.globalAlpha = 0.5;
    if (heroId === 'aster') {
      ellipse(ctx, 0, -49, 23, 23, null, color, 0.7);
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; line(ctx, [[Math.cos(a) * 26, -49 + Math.sin(a) * 26], [Math.cos(a) * 29, -49 + Math.sin(a) * 29]], color, 0.8); }
    } else if (heroId === 'lyra') {
      ctx.beginPath(); ctx.arc(-4, -47, 28, -1.9, 1.4); ctx.strokeStyle = color; ctx.lineWidth = 0.8; ctx.stroke();
      for (let i = 0; i < 5; i++) ellipse(ctx, Math.sin(i * 2) * 26, -40 - i * 7, 1.2, 1.2, '#bef8e8');
    } else if (heroId === 'cinder') {
      polygon(ctx, [[-23, -41], [-20, -67], [-9, -56], [3, -78], [10, -57], [26, -65], [22, -35]], null, color, 0.7);
    } else if (heroId === 'thorn') {
      for (const sign of [-1, 1]) { line(ctx, [[sign * 27, -10], [sign * 32, -31], [sign * 24, -47], [sign * 30, -64]], color, 0.8); polygon(ctx, [[sign * 30, -48], [sign * 39, -58], [sign * 30, -56]], color); }
    } else if (heroId === 'nyx') {
      ctx.beginPath(); ctx.arc(0, -49, 27, 1.1, 4.5); ctx.strokeStyle = '#d0b4f4'; ctx.lineWidth = 2; ctx.stroke();
      line(ctx, [[-27, -47], [-34, -48], [-29, -53]], color, 0.8);
    } else {
      line(ctx, [[-26, -22], [-34, -38], [-25, -41], [-32, -63], [-15, -69]], color, 1.1);
      line(ctx, [[26, -23], [34, -36], [27, -46], [31, -66]], '#b8e7fc', 0.8);
    }
    ctx.restore();
    BattleRenderer.prototype._heroSprite.call({}, ctx, heroId, 0, false, true);
    ctx.restore();
    for (let i = 0; i < 9; i++) {
      const px = size * (0.2 + (Math.sin(i * 8.2) * 0.5 + 0.5) * 0.6), py = size * (0.18 + (Math.cos(i * 3.2) * 0.5 + 0.5) * 0.62);
      ctx.save(); ctx.globalAlpha = 0.25 + i % 3 * 0.13; ellipse(ctx, px, py, size * 0.0018, size * 0.0024, '#f1e8bd'); ctx.restore();
    }
    ctx.restore();
  };
  BattleRenderer.HERO_PALETTE = Object.freeze(Object.fromEntries(Object.entries(HERO).map(([id, def]) => [id, def.color])));
  return BattleRenderer;
});
