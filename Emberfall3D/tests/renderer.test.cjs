'use strict';
const assert = require('node:assert/strict');
const Renderer = require('../public/renderer-portraits.js');

// This checks geometric input correctness and Canvas API paths; art is reviewed in a real browser separately.
function makeCanvas() {
  const draws = { drawImage: 0, fillRect: 0, fills: 0 };
  const gradient = () => ({ addColorStop() {} });
  const ctx = {
    save() {}, restore() {}, setTransform() {}, transform() {}, translate() {}, rotate() {}, scale() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, ellipse() {}, arc() {},
    rect() {}, roundRect() {}, quadraticCurveTo() {}, clip() {}, stroke() {}, strokeRect() {},
    fill() { draws.fills++; }, fillRect() { draws.fillRect++; }, clearRect() {},
    drawImage() { draws.drawImage++; }, fillText() {}, strokeText() {},
    createLinearGradient: gradient, createRadialGradient: gradient,
    globalAlpha: 1, globalCompositeOperation: 'source-over'
  };
  const canvas = { width: 960, height: 640, clientWidth: 960, clientHeight: 640, style: {}, getContext: () => ctx, ownerDocument: { createElement: () => makeCanvas().canvas } };
  return { canvas, ctx, draws };
}

const { canvas, ctx, draws } = makeCanvas();
const renderer = new Renderer(canvas, { width: 1280, height: 720, dpr: 4, zoom: 0.95 });
assert.equal(renderer.dpr, 1.75, 'DPR must stay within the rendering budget');
assert.equal(canvas.width, 2240);
renderer.setCamera(220, 2180);
const center = renderer.worldToScreen(220, 2180);
assert.equal(center.x, 640);
assert.equal(center.y, 367.2);
const positiveX = renderer.worldToScreen(320, 2180), positiveY = renderer.worldToScreen(220, 2280);
assert.ok(positiveX.x > center.x && positiveX.y > center.y);
assert.ok(positiveY.x < center.x && positiveY.y > center.y);
for (const zoom of [0.5, 0.95, 1.6]) {
  renderer.zoom = zoom;
  for (const point of [{ x: 0, y: 0 }, { x: 2400, y: 2400 }, { x: 2180, y: 220 }, { x: 1234.567, y: 891.011 }]) {
    const screen = renderer.worldToScreen(point.x, point.y), world = renderer.screenToWorld(screen.x, screen.y);
    assert.ok(Math.abs(world.x - point.x) < 1e-8 && Math.abs(world.y - point.y) < 1e-8, `Round-trip projection failed at zoom ${zoom}`);
  }
}
renderer.zoom = 0.95;
const ids = ['aster', 'lyra', 'cinder', 'thorn', 'nyx', 'volt'];
const state = {
  seed: 42, time: 25, status: 'playing',
  heroes: ids.map((heroId, index) => ({ id: `hero-${index}`, playerId: `p-${index}`, heroId, name: heroId, team: index % 2, x: 1000 + index * 35, y: 1100 + index * 35, hp: 600, maxHp: 800, mana: 200, maxMana: 300, level: index + 1, moveTarget: { x: 1200, y: 1200 } })),
  creeps: [{ id: 'creep', team: 0, x: 1120, y: 1200, hp: 80, maxHp: 100 }, { id: 'range', team: 1, x: 1160, y: 1230, hp: 100, maxHp: 100, type: 'ranged' }],
  structures: [{ id: 'tower', team: 0, type: 'tower', x: 1000, y: 1200, hp: 1000, maxHp: 1500 }, { id: 'core', team: 1, type: 'core', x: 1200, y: 1100, hp: 3000, maxHp: 3000 }, { id: 'ruin', team: 1, type: 'tower', x: 1300, y: 1300, hp: 0, maxHp: 1500 }],
  projectiles: ['orb', 'bolt', 'arrow'].map((kind, i) => ({ id: kind, kind, x: 1080 + i * 30, y: 1150, tx: 1200, ty: 1200, team: i % 2 })),
  effects: ['impact', 'slash', 'burst', 'heal', 'shield', 'dash', 'ring', 'projectile', 'recall', 'death', 'levelup', 'spawn', 'victory', 'spark'].map((type, i) => ({ id: type, type, x: 1100 + i * 5, y: 1200, tx: 1200, ty: 1200, life: 0.5, maxLife: 1, radius: 50, team: i % 2, text: type === 'impact' ? '42' : '' })),
  zones: ['vortex', 'fire', 'storm'].map((type, index) => ({ type, x: 1100 + index * 20, y: 1200, radius: 120, duration: 2, team: index % 2 }))
};
renderer.render(state, { playerId: 'p-0', selectedTargetId: 'hero-1', time: 26 });
const terrain = renderer.terrain;
assert.ok(terrain && terrain.canvas.width < 4000 && terrain.canvas.height < 2200);
assert.ok(draws.drawImage > 0, 'The visible terrain cache should be composed');
renderer.render(state, { playerId: 'p-0', quality: 'low', camera: { x: 1200, y: 1200 } });
assert.equal(renderer.terrain, terrain, 'Static terrain must be reused across frames');
renderer.resize(420, 600, 1.25);
renderer.render(state, { playerId: 'p-0' });
const mini = makeCanvas().canvas; mini.width = mini.height = 160;
renderer.drawMinimap(mini, state, 'p-0');
for (const id of ids) { Renderer.drawPortrait(ctx, id, 0, 0, 72); Renderer.drawHeroArt(ctx, id, 0, 0, 640); }
state.heroes[0].stun = 1; state.heroes[0].root = 1; state.heroes[0].markTime = 1; state.heroes[1].hiddenTime = 2; state.structures[0].protected = true;
renderer.render(state, { playerId: 'p-0' });
state.heroes[0].dead = true; state.heroes[0].hp = 0; state.heroes[0].respawn = 12;
renderer.render(state, { playerId: 'p-0' });
renderer.destroy();
assert.equal(renderer.terrain, null);
console.log('PASS renderer: CSS-coordinate projection/inverse at 3 zooms, DPR budget, full hero/effect/structure API smoke, terrain caching, compact resize, minimap, portraits, dead hero, cleanup.');

