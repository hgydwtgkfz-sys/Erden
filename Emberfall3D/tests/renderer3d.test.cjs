'use strict';

// Geometry uses the real bundled Three implementation. The GPU smoke below
// substitutes only WebGLRenderer; browser verification covers actual shaders.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Three = require('../public/vendor/three.min.js');
const Core = require('../public/game-core.js');

function loadRenderer(three = Three) {
  const sandbox = { THREE: three, BattleCore: Core, console, devicePixelRatio: 1, performance: { now: () => 1000 } };
  vm.createContext(sandbox);
  for (const name of ['renderer-portraits.js', 'renderer.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'), sandbox, { filename: name });
  }
  return sandbox.BattleRenderer;
}

function cameraHarness(Renderer, { width = 1366, height = 768, yaw = -.785, pitch = .82, zoom = .95, x = 1200, y = 1200 } = {}) {
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, {
    T: Three, width, height, dpr: 1.75, yaw, pitch, zoom,
    camera: { x, y }, map: Core.MAP,
    viewCamera: new Three.PerspectiveCamera(42, width / height, 1, 12000),
    raycaster: new Three.Raycaster(), groundPlane: new Three.Plane(new Three.Vector3(0, 1, 0), 0),
    pickNdc: new Three.Vector2(), pickPoint: new Three.Vector3(), projectPoint: new Three.Vector3()
  });
  renderer._updateCamera();
  return renderer;
}

function near(actual, expected, label, tolerance = 1e-6) {
  assert.ok(Number.isFinite(actual), `${label} must be finite`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: expected ${expected}, got ${actual}`);
}

test('3D ground picking round-trips CSS pixels across camera rotation, zoom and aspect ratio', () => {
  const Renderer = loadRenderer();
  let cases = 0;
  for (const [width, height] of [[1366, 768], [390, 844], [1024, 1024]]) {
    for (const yaw of [-Math.PI / 4, 0, Math.PI / 2, Math.PI]) {
      for (const pitch of [.62, .82, 1.08]) {
        for (const zoom of [.55, .95, 1.5]) {
          for (const [x, y] of [[1200, 1200], [220, 2180]]) {
            const renderer = cameraHarness(Renderer, { width, height, yaw, pitch, zoom, x, y });
            assert.equal(renderer.viewCamera.isPerspectiveCamera, true);
            assert.ok(renderer.viewCamera.position.y > 0, 'Camera must be above the ground');
            for (const [dx, dy] of [[0, 0], [80, 0], [0, -80], [-120, 110], [180, -140]]) {
              const screen = renderer.worldToScreen(x + dx, y + dy);
              const world = renderer.screenToWorld(screen.x, screen.y);
              near(world.x, x + dx, 'picked world x');
              near(world.y, y + dy, 'picked world y');
              cases++;
            }
          }
        }
      }
    }
  }
  assert.equal(cases, 1080);
});

test('3D camera has perspective depth and active orbit/zoom, rather than an affine 2D projection', () => {
  const Renderer = loadRenderer();
  const renderer = cameraHarness(Renderer);
  const camera = renderer.viewCamera;
  const direction = new Three.Vector3(camera.position.x - renderer.camera.x, 0, camera.position.z - renderer.camera.y).normalize();
  const right = new Three.Vector3(direction.z, 0, -direction.x);
  const apparentSpan = (offset) => {
    const x = renderer.camera.x + direction.x * offset, y = renderer.camera.y + direction.z * offset;
    const a = renderer.worldToScreen(x - right.x * 30, y - right.z * 30);
    const b = renderer.worldToScreen(x + right.x * 30, y + right.z * 30);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  assert.ok(apparentSpan(180) > apparentSpan(-180) * 1.03, 'Near objects must appear larger than equal-size distant objects');
  const before = renderer.worldToScreen(1320, 1210);
  renderer.yaw += Math.PI / 2; renderer._updateCamera();
  const rotated = renderer.worldToScreen(1320, 1210);
  assert.ok(Math.hypot(before.x - rotated.x, before.y - rotated.y) > 20, 'Orbit must change the rendered view');
  const spanAt = zoom => { renderer.zoom = zoom; renderer._updateCamera(); const a = renderer.worldToScreen(1200, 1200), b = renderer.worldToScreen(1320, 1200); return Math.hypot(a.x - b.x, a.y - b.y); };
  assert.ok(spanAt(1.5) > spanAt(.55) * 1.4, 'Zoom must bring ground geometry closer');
});

function makeCanvas(width = 1280, height = 720) {
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy({ createLinearGradient: gradient, createRadialGradient: gradient, measureText: text => ({ width: String(text).length * 10 }) }, {
    get(target, name) { return name in target ? target[name] : () => {}; },
    set(target, name, value) { target[name] = value; return true; }
  });
  return { width, height, clientWidth: width, clientHeight: height, style: {}, getContext: () => ctx, ownerDocument: { createElement: () => makeCanvas() } };
}

class FakeGPU {
  constructor({ canvas }) { this.canvas = canvas; this.shadowMap = {}; this.frames = 0; this.ratio = 1; this.disposed = false; }
  setPixelRatio(ratio) { this.ratio = ratio; }
  setSize(width, height) { this.canvas.width = Math.round(width * this.ratio); this.canvas.height = Math.round(height * this.ratio); }
  render(scene, camera) { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); this.frames++; }
  dispose() { this.disposed = true; }
}

test('Real game snapshots build reusable volumetric actors and expire visual resources without changing rules', () => {
  const Renderer = loadRenderer({ ...Three, WebGLRenderer: FakeGPU });
  const canvas = makeCanvas();
  const renderer = new Renderer(canvas, { dpr: 4 });
  assert.equal(renderer.mode, 'webgl3d');
  assert.equal(renderer.dpr, 1.75, 'DPR must preserve the rendering budget');
  assert.equal(canvas.width, 2240);
  const game = Core.createGame({ seed: 421, players: Core.HEROES.map((h, i) => ({ id: 'qa-' + i, name: h.name, heroId: h.id, team: i % 2 })) });
  for (let i = 0; i < 140; i++) Core.step(game, .25);
  const options = { playerId: 'qa-0', camera: { x: 1200, y: 1200, zoom: .95 }, time: 35 };
  const before = JSON.stringify(game);
  renderer.render(game, options);
  assert.equal(JSON.stringify(game), before, 'Rendering must never alter the authoritative game state');
  assert.equal(renderer.entities.size, game.heroes.length + game.creeps.length + game.structures.length);
  assert.ok(renderer.gpu.frames > 0);
  let volumetricMeshes = 0;
  renderer.actors.traverse(object => {
    if (!object.isMesh || object.material.wireframe || !object.geometry.attributes.position) return;
    object.geometry.computeBoundingBox();
    const size = object.geometry.boundingBox.getSize(new Three.Vector3());
    if (size.x > 0 && size.y > 0 && size.z > 0) volumetricMeshes++;
  });
  assert.ok(volumetricMeshes > game.heroes.length * 5, 'Heroes and structures must be actual volumetric meshes');
  assert.ok(renderer.world.children.some(object => object.isInstancedMesh && object.count > 0), 'Forest should use GPU instances');
  const actors = new Map(renderer.entities), geometryCount = renderer.geometries.size;
  for (let i = 0; i < 10; i++) renderer.render(game, { ...options, time: 35 + i / 30 });
  for (const [id, group] of actors) assert.equal(renderer.entities.get(id), group, 'Stable units must reuse their mesh groups');
  assert.equal(renderer.geometries.size, geometryCount, 'Repeated frames must reuse geometry');
  renderer.render(game, { ...options, quality: 'low' });
  assert.equal(renderer.gpu.shadowMap.enabled, false);
  assert.ok(renderer.gpu.ratio <= 1.15);
  renderer.resize(390, 844, 1.5);
  renderer.render(game, { ...options, quality: 'high' });
  assert.equal(renderer.viewCamera.aspect, 390 / 844);
  assert.equal(renderer.gpu.shadowMap.enabled, true);
  const rematch = Core.createGame({ seed: 4321, players: [{ id: 'qa-0', name: 'QA', heroId: 'nyx', team: 0 }] });
  const reusedId = rematch.heroes[0].id, previousModel = renderer.entities.get('hero:' + reusedId);
  assert.equal(game.heroes[0].id, reusedId, 'A fresh match intentionally reuses logical IDs');
  assert.notEqual(game.heroes[0].heroId, rematch.heroes[0].heroId);
  renderer.render(rematch, options);
  const replacementModel = renderer.entities.get('hero:' + reusedId);
  assert.notEqual(replacementModel, previousModel, 'A new hero with a reused ID must replace the old model');
  assert.equal(replacementModel.userData.color, Renderer.HERO_PALETTE.nyx);
  renderer.render(rematch, options);
  assert.equal(renderer.entities.get('hero:' + reusedId), replacementModel, 'The replacement must then be reused normally');
  const resources = [];
  for (const group of renderer.entities.values()) for (const resource of group.userData.resources || []) {
    resource.addEventListener('dispose', () => resources.push(resource));
  }
  renderer.render({ ...rematch, heroes: [], creeps: [], structures: [], effects: [], zones: [], projectiles: [] }, options);
  assert.equal(renderer.entities.size, 0);
  assert.equal(renderer.effectMeshes.size, 0);
  assert.equal(renderer.actors.children.length, 0);
  assert.ok(resources.length > 10, 'Removed labels, shields and unit materials must be disposed');
  renderer.destroy();
  assert.equal(renderer.gpu.disposed, true);
  assert.equal(renderer.scene.children.length, 0);
});

test('Picking an elevated hero mesh works after orbit and ignores dead or concealed heroes', () => {
  const Renderer = loadRenderer({ ...Three, WebGLRenderer: FakeGPU });
  const renderer = new Renderer(makeCanvas());
  const game = Core.createGame({ seed: 9, players: [{ id: 'observer', name: 'QA', heroId: 'aster', team: 0 }] });
  const observer = Core.getHero(game, 'observer'), enemy = game.heroes.find(hero => hero.team === 1);
  observer.x = 900; observer.y = 1200;
  enemy.x = 1200; enemy.y = 1200;
  game.heroes = [observer, enemy]; game.structures = []; game.creeps = []; game.effects = []; game.projectiles = []; game.zones = [];
  for (const yaw of [-Math.PI / 4, 0, Math.PI / 2, Math.PI]) {
    renderer.yaw = yaw;
    renderer.render(game, { playerId: 'observer', camera: { x: enemy.x, y: enemy.y, zoom: 1.5 }, time: 0 });
    const head = renderer.worldToScreen(enemy.x, enemy.y, 60);
    assert.equal(renderer.pickEntity(head.x, head.y), enemy.id, 'Ray must select the elevated hero, not the ground behind it');
    enemy.dead = true;
    renderer.render(game, { playerId: 'observer', camera: { x: enemy.x, y: enemy.y }, time: 0 });
    assert.notEqual(renderer.pickEntity(head.x, head.y), enemy.id, 'Dead hidden meshes must not capture input');
    enemy.dead = false; enemy.hiddenTime = 2;
    renderer.render(game, { playerId: 'observer', camera: { x: enemy.x, y: enemy.y }, time: 0 });
    assert.notEqual(renderer.pickEntity(head.x, head.y), enemy.id, 'Concealed opponents must not be targetable through raycasting');
    enemy.hiddenTime = 0;
  }
  renderer.destroy();
});

