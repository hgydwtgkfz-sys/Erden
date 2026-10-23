(function (root, factory) {
  'use strict';
  const Renderer = factory(root, root.BattleRenderer);
  if (typeof module === 'object' && module.exports) module.exports = Renderer;
  else root.BattleRenderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Legacy) {
  'use strict';
  const WORLD = 2400, TAU = Math.PI * 2;
  const COLORS = { aster: '#f2c66a', lyra: '#69e2d3', cinder: '#ff9958', thorn: '#9ed77a', nyx: '#bb99ff', volt: '#79ceff' };
  const TEAM = ['#72f2bf', '#ff9b77'];
  const FALLBACK_MAP = { width: WORLD, height: WORLD, bases: [{ x: 220, y: 2180 }, { x: 2180, y: 220 }], lanes: [
    [{ x: 220, y: 2180 }, { x: 260, y: 260 }, { x: 2180, y: 220 }],
    [{ x: 220, y: 2180 }, { x: 1200, y: 1200 }, { x: 2180, y: 220 }],
    [{ x: 220, y: 2180 }, { x: 2140, y: 2140 }, { x: 2180, y: 220 }]
  ] };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
  function random(seed) { let s = (seed >>> 0) || 47831; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function laneDistance(x, z, lanes) {
    let best = Infinity;
    for (const path of lanes) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], dx = b.x - a.x, dz = b.y - a.y;
      const t = clamp(((x - a.x) * dx + (z - a.y) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.y - t * dz));
    }
    return best;
  }

  class BattleRenderer {
    constructor(canvas, options = {}) {
      if (!canvas || !canvas.getContext) throw new TypeError('BattleRenderer requires a canvas.');
      if (!root.THREE) throw new Error('Не загружен 3D-движок. Распакуй все файлы Emberfall 3D вместе.');
      const T = this.T = root.THREE;
      this.mode = 'webgl3d'; this.canvas = canvas; this.options = options;
      this.width = 1; this.height = 1; this.dpr = 1; this.zoom = clamp(finite(options.zoom, .95), .5, 1.6);
      this.camera = { x: 220, y: 2180 }; this.yaw = -Math.PI / 4; this.pitch = .82;
      this.map = options.map || (root.BattleCore && root.BattleCore.MAP) || FALLBACK_MAP;
      this.initializedCamera = false; this.lastFrame = null; this.quality = null; this.terrainSeed = null;
      this.geometries = new Map(); this.materials = new Map(); this.entities = new Map(); this.effectMeshes = new Map();
      this.scene = new T.Scene(); this.scene.background = new T.Color('#10272d'); this.scene.fog = new T.Fog('#18383a', 1700, 4100);
      this.viewCamera = new T.PerspectiveCamera(43, 1, 5, 6500);
      this.raycaster = new T.Raycaster(); this.groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
      this.pickNdc = new T.Vector2(); this.pickPoint = new T.Vector3(); this.projectPoint = new T.Vector3();
      try { this.gpu = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); }
      catch (error) { throw new Error('Для Emberfall 3D нужен WebGL. Включи аппаратное ускорение браузера. ' + error.message); }
      this.gpu.outputColorSpace = T.SRGBColorSpace; this.gpu.toneMapping = T.ACESFilmicToneMapping; this.gpu.toneMappingExposure = 1.22;
      this.gpu.shadowMap.enabled = true; this.gpu.shadowMap.type = T.PCFSoftShadowMap;
      this.scene.add(new T.HemisphereLight('#d0e8e4', '#36452c', 2.05));
      this.sun = new T.DirectionalLight('#ffe3ac', 2.85); this.sun.position.set(-400, 1400, 600); this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.camera.left = -850; this.sun.shadow.camera.right = 850;
      this.sun.shadow.camera.top = 850; this.sun.shadow.camera.bottom = -850; this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 3100;
      this.sun.shadow.bias = -.00035; this.sun.shadow.normalBias = 1.25; this.sun.shadow.radius = 2; this.scene.add(this.sun); this.scene.add(this.sun.target);
      const rim = new T.DirectionalLight('#72b9e4', .65); rim.position.set(1600, 800, -1600); this.scene.add(rim);
      this.world = new T.Group(); this.world.name = '3D battlefield'; this.scene.add(this.world);
      this.actors = new T.Group(); this.actors.name = '3D units'; this.scene.add(this.actors);
      this.fxGroup = new T.Group(); this.fxGroup.name = '3D abilities'; this.scene.add(this.fxGroup);
      this.localRing = this._ring(29, '#fff2be', 2.1); this.localRing.material.depthTest = false; this.localRing.renderOrder = 8; this.scene.add(this.localRing);
      this.targetRing = this._ring(31, '#ffb08c', 2.4); this.targetRing.material.depthTest = false; this.targetRing.renderOrder = 9; this.scene.add(this.targetRing);
      this.pointerRing = this._ring(17, '#d6ffd8', 1.4); this.pointerRing.material.depthTest = false; this.pointerRing.renderOrder = 10; this.scene.add(this.pointerRing);
      this.resize(options.width || canvas.clientWidth || canvas.width || 960, options.height || canvas.clientHeight || canvas.height || 640, options.dpr || root.devicePixelRatio || 1);
    }
    _geometry(key, make) { if (!this.geometries.has(key)) this.geometries.set(key, make()); return this.geometries.get(key); }
    _material(color, roughness = .82, metalness = .05, emissive = 0) {
      const key = `${color}:${roughness}:${metalness}:${emissive}`;
      if (!this.materials.has(key)) this.materials.set(key, new this.T.MeshStandardMaterial({ color, roughness, metalness, flatShading: true, emissive: color, emissiveIntensity: emissive }));
      return this.materials.get(key);
    }
    _mesh(parent, shape, color, position, scale, options = {}) {
      const T = this.T;
      const geometry = this._geometry(shape, () => ({ box: () => new T.BoxGeometry(1, 1, 1), sphere: () => new T.IcosahedronGeometry(1, 1), gem: () => new T.OctahedronGeometry(1, 0), cone: () => new T.ConeGeometry(1, 1, 7), cylinder: () => new T.CylinderGeometry(1, 1, 1, 8), tapered: () => new T.CylinderGeometry(.7, 1, 1, 8), rock: () => new T.DodecahedronGeometry(1, 0), torus: () => new T.TorusGeometry(1, .075, 4, 40) })[shape]());
      const mesh = new T.Mesh(geometry, this._material(color, options.roughness ?? .82, options.metalness ?? .05, options.emissive || 0));
      if (position) mesh.position.set(...position); if (scale) mesh.scale.set(...scale);
      mesh.castShadow = options.castShadow !== false; mesh.receiveShadow = options.receiveShadow !== false; parent.add(mesh); return mesh;
    }
    _ring(radius, color, thickness = 1.5, opacity = 1) {
      const T = this.T, key = `ring-${radius}-${thickness}`;
      const ring = new T.Mesh(this._geometry(key, () => new T.RingGeometry(Math.max(.1, radius - thickness), radius + thickness, 64)), new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; return ring;
    }
    resize(width, height, dpr = root.devicePixelRatio || 1) {
      this.width = Math.max(1, Math.round(finite(width, 960))); this.height = Math.max(1, Math.round(finite(height, 640))); this.dpr = clamp(finite(dpr, 1), 1, 1.75);
      this.gpu.setPixelRatio(this.dpr); this.gpu.setSize(this.width, this.height, false);
      if (this.canvas.style) { this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`; } this._updateCamera();
    }
    setCamera(x, y) { this.camera.x = clamp(finite(x, 1200), 0, this.map.width || WORLD); this.camera.y = clamp(finite(y, 1200), 0, this.map.height || WORLD); this.initializedCamera = true; this._updateCamera(); }
    orbit(deltaYaw, deltaPitch = 0) { this.yaw += finite(deltaYaw); this.pitch = clamp(this.pitch + finite(deltaPitch), .38, 1.23); this._updateCamera(); }
    resetCameraAngle() { this.yaw = -Math.PI / 4; this.pitch = .82; this._updateCamera(); }
    _updateCamera() {
      const distance = 1330 / clamp(finite(this.zoom, .95), .5, 1.6), horizontal = Math.cos(this.pitch) * distance;
      this.viewCamera.aspect = this.width / this.height; this.viewCamera.position.set(this.camera.x + Math.sin(this.yaw) * horizontal, Math.sin(this.pitch) * distance, this.camera.y + Math.cos(this.yaw) * horizontal);
      this.viewCamera.lookAt(this.camera.x, 12, this.camera.y); this.viewCamera.updateProjectionMatrix(); this.viewCamera.updateMatrixWorld(true);
    }
    worldToScreen(x, y, height = 0) { this.projectPoint.set(finite(x), finite(height), finite(y)).project(this.viewCamera); return { x: (this.projectPoint.x + 1) * this.width / 2, y: (1 - this.projectPoint.y) * this.height / 2 }; }
    screenToWorld(screenX, screenY) {
      this.pickNdc.set(finite(screenX) / this.width * 2 - 1, 1 - finite(screenY) / this.height * 2); this.raycaster.setFromCamera(this.pickNdc, this.viewCamera);
      const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.pickPoint); return hit ? { x: hit.x, y: hit.z } : { x: this.camera.x, y: this.camera.y };
    }
    pickEntity(screenX, screenY) {
      this.pickNdc.set(finite(screenX) / this.width * 2 - 1, 1 - finite(screenY) / this.height * 2); this.raycaster.setFromCamera(this.pickNdc, this.viewCamera); this.actors.updateMatrixWorld(true);
      for (const hit of this.raycaster.intersectObjects(this.actors.children, true)) { let object = hit.object; if (object.isSprite) continue; while (object && object !== this.actors) { if (!object.visible) break; if (object.userData.entityId && object.visible) return object.userData.entityId; object = object.parent; } }
      return null;
    }

    _buildTerrain(seed) {
      const T = this.T; this._clearWorld(); this.terrainSeed = seed;
      const rng = random(seed + 731), width = this.map.width || WORLD, height = this.map.height || WORLD, lanes = this.map.lanes || FALLBACK_MAP.lanes;
      this._mesh(this.world, 'box', '#213c37', [width / 2, -54, height / 2], [width + 12, 104, height + 12]); this._mesh(this.world, 'box', '#152d2d', [width / 2, -110, height / 2], [width - 28, 50, height - 28]);
      const terrain = new T.PlaneGeometry(width, height, 48, 48); terrain.rotateX(-Math.PI / 2); terrain.translate(width / 2, 0, height / 2);
      const p = terrain.attributes.position, colors = [], color = new T.Color();
      for (let i = 0; i < p.count; i++) { const east = clamp((p.getX(i) - p.getZ(i) + 1200) / 2400, 0, 1), noise = rng() * .08; color.setRGB(.125 + east * .045 + noise, .235 - east * .028 + noise, .158 + east * .012 + noise); colors.push(color.r, color.g, color.b); }
      terrain.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); const terrainMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }); if (this.materials.has('terrain')) this.materials.get('terrain').dispose(); this.materials.set('terrain', terrainMat);
      const ground = new T.Mesh(terrain, terrainMat); ground.receiveShadow = true; ground.userData.terrainGeometry = true; this.world.add(ground);
      this._ribbon([{ x: -80, y: -80 }, { x: width + 80, y: height + 80 }], 205, '#344f4c', .65);
      this.river = this._ribbon([{ x: -80, y: -80 }, { x: width + 80, y: height + 80 }], 165, '#438e92', 1);
      if (this.materials.has('water')) this.materials.get('water').dispose();
      this.river.material = new T.MeshStandardMaterial({ color: '#3c8a91', roughness: .27, metalness: .38, emissive: '#183f49', emissiveIntensity: .23, transparent: true, opacity: .92 }); this.materials.set('water', this.river.material);
      for (const lane of lanes) { this._ribbon(lane, 142, '#56614b', 2); this._ribbon(lane, 110, '#96947a', 2.3); this._ribbon(lane, 68, '#a4a18a', 2.4); }
      for (let team = 0; team < 2; team++) { const base = this.map.bases[team], group = new T.Group(); group.position.set(base.x, 0, base.y); this.world.add(group); this._mesh(group, 'cylinder', team ? '#6d5651' : '#60786a', [0, 2, 0], [164, 9, 164]); this._mesh(group, 'cylinder', team ? '#a48670' : '#a1b19a', [0, 8, 0], [125, 4, 125]); const ring = this._ring(149, TEAM[team], 2.7, .48); ring.position.y = 8; ring.userData.ownedMaterial = true; group.add(ring); for (let j = 0; j < 8; j++) { const a = j * TAU / 8, plinth = this._mesh(group, 'box', '#b3b69c', [Math.cos(a) * 142, 8, Math.sin(a) * 142], [17, 14, 35]); plinth.rotation.y = -a; } }
      const trees = [], rocks = [], shrubs = [];
      for (let i = 0; i < 1400; i++) { const x = 35 + rng() * (width - 70), z = 35 + rng() * (height - 70); if (laneDistance(x, z, lanes) < 105 || Math.abs(x - z) < 150 || this.map.bases.some(b => Math.hypot(x - b.x, z - b.y) < 220)) continue; const scale = .6 + rng() * .65, yaw = rng() * TAU; if (i % 6 === 0) rocks.push({ x, z, scale: scale * (13 + rng() * 14), yaw }); else if (i % 4 === 0) shrubs.push({ x, z, scale: scale * 19, yaw }); else if (trees.length < 360) trees.push({ x, z, scale, yaw }); }
      const dummy = new T.Object3D(), instances = (key, material, list, transform) => { const mesh = new T.InstancedMesh(this.geometries.get(key), material, list.length); list.forEach((item, i) => { transform(dummy, item); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); }); mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); this.world.add(mesh); return mesh; };
      this._geometry('cone', () => new T.ConeGeometry(1, 1, 7)); this._geometry('cylinder', () => new T.CylinderGeometry(1, 1, 1, 8)); this._geometry('rock', () => new T.DodecahedronGeometry(1, 0));
      instances('cylinder', this._material('#675344'), trees, (o, p) => { o.position.set(p.x, 26 * p.scale, p.z); o.rotation.set(0, p.yaw, 0); o.scale.set(7 * p.scale, 52 * p.scale, 7 * p.scale); });
      instances('cone', this._material('#355f46'), trees, (o, p) => { o.position.set(p.x, 63 * p.scale, p.z); o.rotation.set(0, p.yaw, 0); o.scale.set(39 * p.scale, 76 * p.scale, 39 * p.scale); });
      instances('cone', this._material('#477952'), trees, (o, p) => { o.position.set(p.x, 88 * p.scale, p.z); o.rotation.set(0, p.yaw + .35, 0); o.scale.set(29 * p.scale, 61 * p.scale, 29 * p.scale); });
      instances('rock', this._material('#6d7d70'), rocks, (o, p) => { o.position.set(p.x, p.scale * .42, p.z); o.rotation.set(.1, p.yaw, .16); o.scale.set(p.scale, p.scale * .7, p.scale * .8); });
      instances('rock', this._material('#4c7749'), shrubs, (o, p) => { o.position.set(p.x, p.scale * .35, p.z); o.rotation.set(0, p.yaw, 0); o.scale.set(p.scale, p.scale * .6, p.scale * .7); });
      const riverRocks = []; for (let i = 0; i < 40; i++) { const v = i / 40 * WORLD; if (laneDistance(v, v, lanes) > 160) riverRocks.push({ x: v + 74, z: v - 74, scale: 10 + rng() * 7, yaw: rng() * TAU }); }
      instances('rock', this._material('#91b6ae'), riverRocks, (o, p) => { o.position.set(p.x, 3, p.z); o.rotation.set(0, p.yaw, 0); o.scale.set(p.scale, 4, p.scale * .75); });
      this._buildBridge(); this._buildLanterns(lanes); this._batchScenery();
    }
    _clearWorld() { this.world.traverse(object => { if (object.isInstancedMesh) object.dispose(); if (object.userData.terrainGeometry && object.geometry) object.geometry.dispose(); if (object.userData.ownedMaterial && object.material) object.material.dispose(); }); this.world.clear(); }
    _batchScenery() {
      const T = this.T, batches = new Map(); this.world.updateMatrixWorld(true);
      this.world.traverse(mesh => { if (!mesh.isMesh || mesh.isInstancedMesh || mesh.userData.terrainGeometry) return; const key = mesh.geometry.uuid + ':' + mesh.material.uuid; if (!batches.has(key)) batches.set(key, []); batches.get(key).push(mesh); });
      for (const list of batches.values()) {
        if (list.length < 3) continue;
        const first = list[0], batch = new T.InstancedMesh(first.geometry, first.material, list.length);
        list.forEach((mesh, index) => { batch.setMatrixAt(index, mesh.matrixWorld); mesh.parent.remove(mesh); });
        batch.instanceMatrix.needsUpdate = true; batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow; batch.computeBoundingSphere(); this.world.add(batch);
      }
    }
    _ribbon(points, width, color, y) {
      const T = this.T, vertices = [], indices = [];
      for (let i = 0; i < points.length; i++) { const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz) || 1; vertices.push(points[i].x - dz / length * width / 2, y, points[i].y + dx / length * width / 2, points[i].x + dz / length * width / 2, y, points[i].y - dx / length * width / 2); if (i) { const k = i * 2; indices.push(k - 2, k - 1, k, k - 1, k + 1, k); } }
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); const mesh = new T.Mesh(geometry, this._material(color)); mesh.material.side = T.DoubleSide; mesh.receiveShadow = true; mesh.userData.terrainGeometry = true; this.world.add(mesh); return mesh;
    }
    _buildBridge() { const T = this.T, bridge = new T.Group(); bridge.position.set(1200, 0, 1200); bridge.rotation.y = Math.PI / 4; this.world.add(bridge); this._mesh(bridge, 'box', '#a3a18e', [0, 2.8, 0], [145, 4, 225]); for (const x of [-82, 82]) { this._mesh(bridge, 'box', '#777d70', [x, 16, 0], [14, 27, 235]); for (const z of [-115, 115]) this._mesh(bridge, 'tapered', '#bbbaa0', [x, 24, z], [15, 47, 15]); } for (let i = -4; i <= 4; i++) this._mesh(bridge, 'box', '#7b8174', [0, 5.3, i * 24], [141, 1.5, 2], { castShadow: false }); }
    _buildLanterns(lanes) { const T = this.T; for (const path of lanes) for (let s = 1; s < path.length; s++) { const a = path[s - 1], b = path[s], length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.floor(length / 420); for (let i = 1; i < steps; i++) { const t = i / steps, nx = -(b.y - a.y) / length, nz = (b.x - a.x) / length; for (const side of [-1, 1]) { const group = new T.Group(); group.position.set(a.x + (b.x - a.x) * t + nx * 94 * side, 0, a.y + (b.y - a.y) * t + nz * 94 * side); this.world.add(group); this._mesh(group, 'tapered', '#b0af91', [0, 12, 0], [8, 24, 8]); this._mesh(group, 'gem', '#ffda8c', [0, 29, 0], [6, 10, 6], { emissive: .55 }); } } } }

    _createHero(hero) {
      const T = this.T, group = new T.Group(), body = new T.Group(); group.add(body);
      const color = COLORS[hero.heroId] || COLORS.aster, dark = { aster: '#50596a', lyra: '#2b6470', cinder: '#663f34', thorn: '#4d6242', nyx: '#433551', volt: '#355778' }[hero.heroId] || '#50596a';
      const meta = group.userData = { kind: 'hero', body, legs: [], arms: [], ornaments: [], color, resources: [] };
      if (hero.heroId === 'lyra' || hero.heroId === 'volt') this._mesh(body, 'cone', dark, [0, 18, 0], [20, 37, 20]);
      else for (const side of [-1, 1]) { const pivot = new T.Group(); pivot.position.set(side * 7.5, 21, 0); body.add(pivot); this._mesh(pivot, 'box', dark, [0, -9, 0], [11, 21, 12]); this._mesh(pivot, 'box', '#2e3b3e', [0, -18, 3], [12, 7, 18]); meta.legs.push(pivot); }
      const bulky = hero.heroId === 'thorn' ? 1.3 : hero.heroId === 'aster' ? 1.12 : .87;
      this._mesh(body, 'tapered', dark, [0, 35, 0], [17 * bulky, 30, 12 * bulky]); this._mesh(body, 'box', color, [0, 39, 5], [25 * bulky, 19, 10], { roughness: .55, metalness: .25 }); this._mesh(body, 'box', '#c9b885', [0, 23, 1], [29 * bulky, 4, 19]);
      const head = this._mesh(body, 'sphere', '#dbc8a2', [0, 61, 1], [10.7, 11.5, 10]); this._mesh(body, 'box', '#142b35', [0, 62, 9], [13, 3.6, 3]); for (const x of [-4, 4]) this._mesh(body, 'box', color, [x, 62, 11], [3, 2, 2], { emissive: .5 });
      for (const side of [-1, 1]) { const arm = new T.Group(); arm.position.set(side * 18 * bulky, 44, 0); body.add(arm); this._mesh(arm, 'box', dark, [0, -9, 0], [10, 21, 11]); this._mesh(arm, 'sphere', color, [0, 0, 0], [10, 8, 10], { metalness: .25 }); this._mesh(arm, 'sphere', '#cbb895', [0, -21, 2], [5.5, 5.5, 6]); meta.arms.push(arm); }
      if (hero.heroId === 'aster') { this._mesh(body, 'tapered', '#e6c776', [0, 65, 0], [12, 17, 12], { metalness: .45 }); this._mesh(body, 'box', '#415367', [0, 65, 11.5], [14, 3, 3]); this._mesh(body, 'cone', '#f6dec0', [0, 80, -2], [5, 21, 8]); const sword = this._mesh(meta.arms[1], 'box', '#e1ebdf', [0, -14, 17], [5, 45, 4], { metalness: .65, roughness: .25 }); sword.rotation.x = .4; this._mesh(meta.arms[1], 'box', '#e7c56b', [0, -27, 11], [19, 4, 5]); const shield = this._mesh(meta.arms[0], 'tapered', '#d8b969', [0, -13, 12], [17, 34, 6], { metalness: .4 }); shield.rotation.x = Math.PI / 2; this._mesh(meta.arms[0], 'gem', '#eaf8d6', [0, -13, 19], [7, 10, 3], { emissive: .3 }); }
      else if (hero.heroId === 'lyra') { this._mesh(body, 'cone', '#3c8390', [0, 66, -1], [14, 24, 14]); this._mesh(meta.arms[1], 'cylinder', '#c9d7b7', [0, -1, 10], [2.7, 87, 2.7]); const crescent = this._mesh(meta.arms[1], 'torus', '#ccefd6', [0, 45, 10], [11, 15, 5], { metalness: .35, emissive: .2 }); const gem = this._mesh(meta.arms[1], 'gem', color, [0, 45, 10], [6, 10, 5], { emissive: .6 }); meta.ornaments.push(gem, crescent); for (const side of [-1, 1]) { const fin = this._mesh(body, 'cone', color, [side * 26, 43, -3], [10, 33, 4]); fin.rotation.z = side * -.5; } }
      else if (hero.heroId === 'cinder') { this._mesh(body, 'cone', '#783f31', [0, 66, -2], [14, 23, 14]); const weapon = new T.Group(); weapon.position.set(0, -15, 19); meta.arms[1].add(weapon); this._mesh(weapon, 'box', '#473d39', [0, 0, 0], [5, 5, 35]); this._mesh(weapon, 'box', '#f5b26d', [0, 0, 9], [33, 3, 4]); const pack = this._mesh(body, 'cylinder', '#d59b5c', [-5, 38, -16], [7, 26, 7]); pack.rotation.z = -.35; }
      else if (hero.heroId === 'thorn') { head.material = this._material('#759967'); this._mesh(body, 'cone', '#b1c985', [0, 71, -3], [14, 18, 13]); for (const side of [-1, 1]) { const horn = this._mesh(body, 'cone', '#82694e', [side * 15, 77, -3], [5, 32, 5]); horn.rotation.z = side * -.55; this._mesh(body, 'gem', '#aad17b', [side * 24, 44, -2], [12, 20, 10]); } const club = this._mesh(meta.arms[1], 'tapered', '#785f46', [0, -13, 15], [8, 51, 8]); club.rotation.x = .4; this._mesh(meta.arms[1], 'rock', '#acc98a', [0, 10, 23], [17, 18, 15]); }
      else if (hero.heroId === 'nyx') { this._mesh(body, 'cone', '#4e3c68', [0, 66, -2], [14, 25, 14]); this._mesh(body, 'gem', color, [0, 43, 13], [4, 8, 3], { emissive: .45 }); for (const arm of meta.arms) { const knife = this._mesh(arm, 'cone', '#dfd3ff', [0, -17, 15], [4, 34, 3], { metalness: .6, emissive: .17 }); knife.rotation.x = .75; } const cape = this._mesh(body, 'cone', '#3b345a', [0, 28, -10], [22, 42, 9]); cape.rotation.x = -.22; }
      else { const hat = this._mesh(body, 'cone', '#4d85af', [0, 79, -1], [15, 38, 15]); hat.rotation.z = -.13; this._mesh(body, 'cylinder', '#93c2d0', [0, 64, 0], [18, 3, 18]); this._mesh(meta.arms[1], 'cylinder', '#8bb4cd', [0, -1, 11], [2.6, 86, 2.6]); const orb = this._mesh(meta.arms[1], 'gem', '#b2f1ff', [0, 46, 11], [11, 17, 11], { emissive: .85 }); const halo = this._mesh(meta.arms[1], 'torus', color, [0, 46, 11], [18, 18, 18], { emissive: .6 }); meta.ornaments.push(orb, halo); }
      const ring = this._ring(24, TEAM[hero.team || 0], 1.5, .6); ring.position.y = 3; group.add(ring); meta.resources.push(ring.material);
      const shieldMaterial = new T.MeshBasicMaterial({ color, transparent: true, opacity: .13, side: T.DoubleSide, depthWrite: false, wireframe: true }); const shield = new T.Mesh(this._geometry('shield', () => new T.IcosahedronGeometry(1, 1)), shieldMaterial); shield.scale.set(34, 45, 34); shield.position.y = 37; shield.visible = false; group.add(shield); meta.shield = shield; meta.resources.push(shieldMaterial);
      this._addHealthBar(group, hero, 100, true); return group;
    }
    _addHealthBar(group, entity, height, hero) {
      const T = this.T, doc = this.canvas.ownerDocument || root.document; if (!doc || !doc.createElement) return;
      const canvas = doc.createElement('canvas'); canvas.width = hero ? 256 : 128; canvas.height = hero ? 70 : 24;
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.minFilter = T.LinearFilter;
      const material = new T.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }); const sprite = new T.Sprite(material); sprite.position.y = height; sprite.scale.set(hero ? 116 : 68, hero ? 31.7 : 12.75, 1); sprite.renderOrder = 20; group.add(sprite);
      group.userData.bar = { canvas, ctx: canvas.getContext('2d'), texture, sprite, key: '', hero }; group.userData.resources ||= []; group.userData.resources.push(material, texture); this._updateHealthBar(group, entity, false);
    }
    _updateHealthBar(group, entity, local) {
      const bar = group.userData.bar; if (!bar || !bar.ctx) return;
      const hp = clamp(finite(entity.hp) / (entity.maxHp || 1), 0, 1), mana = clamp(finite(entity.mana) / (entity.maxMana || 1), 0, 1), key = `${Math.round(hp * 100)}:${Math.round(mana * 100)}:${entity.level}:${entity.name}:${local}:${entity.shield > 0}:${entity.protected}`;
      if (key === bar.key) return; bar.key = key; const ctx = bar.ctx, width = bar.canvas.width; ctx.clearRect(0, 0, width, bar.canvas.height); const top = bar.hero ? 35 : 3;
      if (bar.hero) { ctx.font = '600 21px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#0b2025'; ctx.fillStyle = local ? '#fff4c7' : '#e9eee3'; const name = (entity.name || '').slice(0, 19); ctx.strokeText(`${entity.level || 1}  ${name}`, width / 2, 24); ctx.fillText(`${entity.level || 1}  ${name}`, width / 2, 24); }
      ctx.fillStyle = '#0c2028'; ctx.fillRect(1, top, width - 2, bar.hero ? 18 : 16); ctx.fillStyle = local ? '#c1f382' : entity.team === 1 ? '#f29979' : '#76d9a4'; ctx.fillRect(4, top + 3, (width - 8) * hp, bar.hero ? 12 : 10);
      if (entity.shield > 0) { ctx.fillStyle = '#dce9d6'; ctx.fillRect(4, top + 3, Math.min(width - 8, (width - 8) * finite(entity.shield) / (entity.maxHp || 1)), 3); }
      if (entity.protected) { ctx.fillStyle = '#c6d6e1'; ctx.fillRect(width / 2 - 5, top + 4, 10, 9); }
      if (bar.hero) { ctx.fillStyle = '#102631'; ctx.fillRect(3, top + 20, width - 6, 5); ctx.fillStyle = '#77bcf5'; ctx.fillRect(3, top + 20, (width - 6) * mana, 5); } bar.texture.needsUpdate = true;
    }
    _createCreep(creep) {
      const T = this.T, group = new T.Group(), body = new T.Group(); group.add(body); const siege = creep.kind === 'siege', ranged = creep.kind === 'ranged', color = TEAM[creep.team || 0]; group.userData = { kind: 'creep', body, resources: [] };
      if (siege) { this._mesh(body, 'box', '#746e57', [0, 15, 0], [30, 20, 37]); for (const x of [-19, 19]) for (const z of [-12, 12]) { const wheel = this._mesh(body, 'cylinder', '#3b4641', [x, 10, z], [10, 6, 10]); wheel.rotation.z = Math.PI / 2; } const gun = this._mesh(body, 'cylinder', color, [0, 28, 9], [7, 34, 7], { metalness: .35 }); gun.rotation.x = Math.PI / 2; }
      else { this._mesh(body, 'tapered', color, [0, 15, 0], [10, 24, 9]); this._mesh(body, 'sphere', '#d3c6ab', [0, 32, 0], [7, 8, 7]); this._mesh(body, ranged ? 'cone' : 'tapered', '#526472', [0, 38, -1], [9, ranged ? 17 : 9, 9]); const weapon = this._mesh(body, 'box', ranged ? '#bea57d' : '#dae0d0', [13, 17, 7], [ranged ? 19 : 3, ranged ? 3 : 24, 4]); weapon.rotation.z = -.2; }
      this._addHealthBar(group, creep, siege ? 54 : 52, false); return group;
    }
    _createStructure(entity) {
      const T = this.T, group = new T.Group(), color = TEAM[entity.team || 0], core = entity.type === 'core', meta = group.userData = { kind: 'structure', resources: [], core, ornaments: [] };
      this._mesh(group, 'cylinder', '#52625c', [0, 6, 0], [core ? 80 : 42, 12, core ? 80 : 42]); this._mesh(group, 'cylinder', core ? '#a7ab8d' : '#9caa96', [0, 16, 0], [core ? 62 : 34, 13, core ? 62 : 34]);
      if (core) { for (let i = 0; i < 5; i++) { const a = i * TAU / 5, pillar = this._mesh(group, 'tapered', '#8c9b88', [Math.cos(a) * 56, 41, Math.sin(a) * 56], [9, 72, 9]); pillar.rotation.z = Math.sin(a) * .15; pillar.rotation.x = Math.cos(a) * -.15; } const crystal = this._mesh(group, 'gem', color, [0, 83, 0], [31, 63, 31], { metalness: .35, roughness: .3, emissive: .55 }); const orbit = this._mesh(group, 'torus', '#e6dbb7', [0, 73, 0], [44, 44, 44], { metalness: .5, emissive: .08 }); orbit.rotation.x = Math.PI / 2 - .4; meta.ornaments.push(crystal, orbit); const ring = this._ring(87, color, 2, .55); ring.position.y = 8; group.add(ring); meta.resources.push(ring.material); }
      else { this._mesh(group, 'tapered', '#758879', [0, 49, 0], [24, 63, 24]); this._mesh(group, 'cylinder', '#aab699', [0, 81, 0], [31, 13, 31]); for (let i = 0; i < 4; i++) { const a = i * TAU / 4; this._mesh(group, 'box', '#b7b99f', [Math.sin(a) * 25, 96, Math.cos(a) * 25], [12, 23, 12]); } meta.ornaments.push(this._mesh(group, 'gem', color, [0, 106, 0], [13, 24, 13], { emissive: .55, roughness: .3, metalness: .25 })); }
      const shieldMaterial = new T.MeshBasicMaterial({ color, transparent: true, opacity: .065, wireframe: true, depthWrite: false }); const shield = new T.Mesh(this._geometry('shield', () => new T.IcosahedronGeometry(1, 1)), shieldMaterial); shield.position.y = core ? 67 : 57; shield.scale.set(core ? 99 : 55, core ? 91 : 73, core ? 99 : 55); group.add(shield); meta.shield = shield; meta.resources.push(shieldMaterial); this._addHealthBar(group, entity, core ? 171 : 145, false); return group;
    }
    _removeGroup(group) { if (!group) return; group.parent?.remove(group); for (const resource of group.userData.resources || []) resource.dispose(); }
    _syncEntities(state, options, time, local) {
      const seen = new Set(), localTeam = local ? local.team : 0;
      for (const [kind, list] of [['structure', state.structures || []], ['creep', state.creeps || []], ['hero', state.heroes || []]]) for (const entity of list) {
        const key = `${kind}:${entity.id}`, signature = `${kind}:${entity.heroId || entity.kind || entity.type}:${entity.team}`; seen.add(key); let group = this.entities.get(key);
        if (group && group.userData.signature !== signature) { this._removeGroup(group); this.entities.delete(key); group = null; }
        if (!group) { group = kind === 'hero' ? this._createHero(entity) : kind === 'creep' ? this._createCreep(entity) : this._createStructure(entity); group.userData.entityId = entity.id; group.userData.signature = signature; this.entities.set(key, group); this.actors.add(group); }
        const meta = group.userData, concealed = kind === 'hero' && entity.hiddenTime > 0 && entity.team !== localTeam && local && Math.hypot(entity.x - local.x, entity.y - local.y) > 135;
        group.visible = !entity.dead && entity.hp > 0 && !concealed; group.position.set(finite(entity.x), 0, finite(entity.y)); if (!group.visible) continue;
        if (meta.body) { const moving = entity.moveTarget || entity.order === 'move' || entity.order === 'attackMove', phase = time * (kind === 'hero' ? 10 : 13) + Number(String(entity.id).replace(/\D/g, '')) * .7; meta.body.position.y = moving ? Math.sin(phase) * 1.4 : Math.sin(time * 2.2) * .5; meta.body.rotation.y = Math.PI / 2 - finite(entity.facing, entity.team ? Math.PI * .75 : -Math.PI * .25); const swing = moving ? Math.sin(phase) * .34 : 0; (meta.legs || []).forEach((leg, i) => leg.rotation.x = swing * (i ? 1 : -1)); (meta.arms || []).forEach((arm, i) => arm.rotation.x = -swing * (i ? 1 : -1) * .5 + (entity.attackCooldown > .65 ? -.6 : 0)); }
        if (meta.shield) { meta.shield.visible = kind === 'hero' ? entity.shield > 0 : !!entity.protected; meta.shield.rotation.y = time * .35; }
        (meta.ornaments || []).forEach((piece, i) => { piece.rotation.y = time * (.5 + i * .3); if (meta.core && i === 0) piece.position.y = 83 + Math.sin(time * 1.8) * 6; }); this._updateHealthBar(group, entity, entity.playerId === options.playerId);
      }
      for (const [key, group] of this.entities) if (!seen.has(key)) { this._removeGroup(group); this.entities.delete(key); }
    }
    _createEffect(effect, zone) {
      const T = this.T, group = new T.Group(), color = effect.color || TEAM[effect.team || 0], resources = []; group.userData = { resources, zone };
      const material = new T.MeshBasicMaterial({ color, transparent: true, opacity: .7, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }); resources.push(material);
      const ring = new T.Mesh(this._geometry('effect-ring', () => new T.RingGeometry(.92, 1, 48)), material); ring.rotation.x = -Math.PI / 2; ring.position.y = 8; group.add(ring); group.userData.ring = ring;
      if (zone || ['recall', 'levelup', 'death'].includes(effect.type)) { const pillarMaterial = new T.MeshBasicMaterial({ color, transparent: true, opacity: .12, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }); resources.push(pillarMaterial); const pillar = new T.Mesh(this._geometry('effect-pillar', () => new T.CylinderGeometry(1, 1, 1, 24, 1, true)), pillarMaterial); group.add(pillar); group.userData.pillar = pillar; }
      if (effect.type === 'slash' || effect.type === 'dash') { const beam = new T.Mesh(this.geometries.get('box'), material); group.add(beam); group.userData.beam = beam; }
      if (['cast', 'impact', 'spawn', 'death'].includes(effect.type)) { const sparks = []; for (let i = 0; i < 6; i++) { const gem = new T.Mesh(this.geometries.get('gem'), material); group.add(gem); sparks.push(gem); } group.userData.sparks = sparks; }
      this.fxGroup.add(group); return group;
    }
    _syncEffects(state, time, low) {
      const T = this.T, seen = new Set(), lists = [['zone', state.zones || []], ['effect', (state.effects || []).slice(low ? -40 : -110)], ['projectile', state.projectiles || []]];
      for (const [kind, effects] of lists) for (const effect of effects) {
        const key = `${kind}:${effect.id}`; seen.add(key); let group = this.effectMeshes.get(key);
        if (!group) { if (kind === 'projectile') { group = new T.Group(); group.userData.resources = []; group.userData.orb = this._mesh(group, 'gem', effect.color || TEAM[effect.team || 0], [0, 0, 0], [6, 10, 6], { emissive: .9 }); this._mesh(group, 'cone', effect.color || TEAM[effect.team || 0], [0, -14, 0], [3, 26, 3], { emissive: .65 }); this.fxGroup.add(group); } else group = this._createEffect(effect, kind === 'zone'); this.effectMeshes.set(key, group); }
        group.position.set(finite(effect.x), kind === 'projectile' ? 36 + Math.sin(clamp(1 - effect.life / (effect.maxLife || 1), 0, 1) * Math.PI) * 26 : 0, finite(effect.y));
        if (kind === 'projectile') { group.rotation.set(0, -Math.atan2(effect.ty - effect.y, effect.tx - effect.x), -Math.PI / 2); group.userData.orb.rotation.y = time * 7; continue; }
        const fraction = kind === 'zone' ? .5 : clamp(1 - finite(effect.life) / (effect.maxLife || 1), 0, 1), radius = Math.max(8, finite(effect.radius, 45)), meta = group.userData, pulse = kind === 'zone' ? .98 + Math.sin(time * 4) * .025 : .4 + fraction * .72;
        meta.ring.scale.setScalar(radius * pulse); meta.ring.material.opacity = kind === 'zone' ? .48 : Math.max(0, (1 - fraction) * .8);
        if (meta.pillar) { const h = effect.type === 'recall' ? 170 : effect.type === 'levelup' ? 135 : kind === 'zone' ? 23 : 65; meta.pillar.position.y = h / 2; meta.pillar.scale.set(radius * pulse, h, radius * pulse); meta.pillar.material.opacity = kind === 'zone' ? .075 : (1 - fraction) * .16; }
        if (meta.beam) { const dx = finite(effect.tx, effect.x) - effect.x, dz = finite(effect.ty, effect.y) - effect.y; meta.beam.position.set(dx / 2, 16, dz / 2); meta.beam.scale.set(7 * (1 - fraction) + 2, 5, Math.max(Math.hypot(dx, dz), 1)); meta.beam.rotation.y = Math.atan2(dx, dz); }
        (meta.sparks || []).forEach((spark, i) => { const a = i * TAU / 6 + fraction * 2; spark.position.set(Math.cos(a) * radius * fraction, 12 + Math.sin(fraction * Math.PI) * (effect.type === 'death' ? 110 : 50), Math.sin(a) * radius * fraction); spark.scale.setScalar((1 - fraction) * 7 + 1); spark.rotation.set(time + i, i, time); });
      }
      for (const [key, group] of this.effectMeshes) if (!seen.has(key)) { this._removeGroup(group); this.effectMeshes.delete(key); }
    }
    _setQuality(quality) {
      const value = quality === 'low' ? 'low' : 'high'; if (this.quality === value) return; this.quality = value; this.gpu.shadowMap.enabled = value === 'high'; this.sun.castShadow = value === 'high'; this.gpu.setPixelRatio(value === 'low' ? Math.min(this.dpr, 1.15) : this.dpr);
      this.scene.traverse(object => { if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.needsUpdate = true); });
    }
    render(state, options = {}) {
      if (!state) return; const now = typeof performance !== 'undefined' ? performance.now() : Date.now(), dt = this.lastFrame === null ? .016 : clamp((now - this.lastFrame) / 1000, 0, .1); this.lastFrame = now;
      const time = finite(options.time, state.time), local = (state.heroes || []).find(hero => hero.playerId === options.playerId) || (state.heroes || [])[0];
      if (options.camera && Number.isFinite(options.camera.x) && Number.isFinite(options.camera.y)) { this.camera.x = options.camera.x; this.camera.y = options.camera.y; this.initializedCamera = true; if (Number.isFinite(options.camera.zoom)) this.zoom = options.camera.zoom; }
      else if (local) { const weight = this.initializedCamera ? 1 - Math.exp(-dt * 8) : 1; this.camera.x += (local.x - this.camera.x) * weight; this.camera.y += (local.y - this.camera.y) * weight; this.initializedCamera = true; }
      this.zoom = clamp(finite(this.zoom, .95), .5, 1.6); this._updateCamera(); if (this.terrainSeed !== finite(state.seed, 1)) this._buildTerrain(finite(state.seed, 1)); this._setQuality(options.quality);
      this.sun.position.set(this.camera.x - 550, 1450, this.camera.y + 350); this.sun.target.position.set(this.camera.x, 0, this.camera.y); this.sun.target.updateMatrixWorld(); if (this.river) this.river.material.emissiveIntensity = .22 + Math.sin(time * .8) * .035;
      this._syncEntities(state, options, time, local); this._syncEffects(state, time, options.quality === 'low');
      this.localRing.visible = !!local && !local.dead && local.hp > 0 && !!options.playerId; if (local) { this.localRing.position.set(local.x, 6, local.y); this.localRing.scale.setScalar(1 + Math.sin(time * 3) * .025); }
      const target = [...(state.heroes || []), ...(state.creeps || []), ...(state.structures || [])].find(entity => entity.id === options.selectedTargetId && entity.hp > 0 && !entity.dead); this.targetRing.visible = !!target; if (target) { this.targetRing.position.set(target.x, 7, target.y); this.targetRing.scale.setScalar(target.type === 'core' ? 2.8 : target.type === 'tower' ? 1.4 : 1); }
      this.pointerRing.visible = !!options.pointer && options.pointer.active !== false; if (options.pointer) this.pointerRing.position.set(finite(options.pointer.worldX, options.pointer.x), 8, finite(options.pointer.worldY, options.pointer.y)); this.gpu.render(this.scene, this.viewCamera);
    }
    drawMinimap(canvas, state, playerId) { if (Legacy && Legacy.prototype.drawMinimap) Legacy.prototype.drawMinimap.call(this, canvas, state, playerId); }
    destroy() { for (const group of this.entities.values()) this._removeGroup(group); for (const group of this.effectMeshes.values()) this._removeGroup(group); this.entities.clear(); this.effectMeshes.clear(); this._clearWorld(); for (const geometry of this.geometries.values()) geometry.dispose(); for (const material of this.materials.values()) material.dispose(); for (const ring of [this.localRing, this.targetRing, this.pointerRing]) ring.material.dispose(); this.gpu.dispose(); this.scene.clear(); }
  }
  BattleRenderer.drawPortrait = function (...args) { if (Legacy && Legacy.drawPortrait) return Legacy.drawPortrait(...args); };
  BattleRenderer.drawHeroArt = function (...args) { if (Legacy && Legacy.drawHeroArt) return Legacy.drawHeroArt(...args); };
  BattleRenderer.HERO_PALETTE = Object.freeze({ ...COLORS }); BattleRenderer.MODE = 'webgl3d'; return BattleRenderer;
});
