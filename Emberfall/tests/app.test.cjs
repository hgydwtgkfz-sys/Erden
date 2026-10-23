'use strict';
// Integration tests execute the unmodified application with its real BattleCore.
// A minimal event/element surface replaces a browser; no game or app internals are exposed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../public/game-core.js');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[entity]));
const dataKey = key => key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

class Element {
  constructor(tagName, owner) {
    this.tagName = tagName.toUpperCase(); this.ownerDocument = owner; this.children = []; this.parentNode = null;
    this.attributes = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.className = '';
    this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.width = 300; this.height = 150;
    this._text = ''; this._html = '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, value) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); const on = value === undefined ? !set.has(name) : !!value; if (on) set.add(name); else set.delete(name); this.className = [...set].join(' '); return on; },
      add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)
    };
  }
  setAttribute(name, value) {
    value = String(value); this.attributes[name] = value;
    if (name === 'class') this.className = value;
    else if (name === 'id') this.id = value;
    else if (name.startsWith('data-')) this.dataset[dataKey(name.slice(5))] = value;
    else if (name === 'hidden' || name === 'disabled' || name === 'checked') this[name] = true;
    else if (name === 'value') this.value = value;
    else if (name === 'width' || name === 'height') this[name] = Number(value);
  }
  getAttribute(name) { return name === 'class' ? this.className : this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'hidden' || name === 'disabled') this[name] = false; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children.forEach(n => n.parentNode = null); this.children = []; this._text = ''; this._html = ''; this.append(...nodes); }
  set innerHTML(value) { this.replaceChildren(); this._html = String(value); parseInto(this, this._html); }
  get innerHTML() { return this._html; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (matches(node, selector)) return node; return null; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== callback); }
  dispatchEvent(event) {
    event.target ||= this; event.preventDefault ||= () => { event.defaultPrevented = true; };
    if (event.type === 'click' && this.disabled) return;
    const result = typeof this['on' + event.type] === 'function' ? this['on' + event.type](event) : undefined;
    for (const callback of this.listeners[event.type] || []) callback(event);
    return result;
  }
  focus() { this.ownerDocument.activeElement = this; }
  getClientRects() { for (let node = this; node; node = node.parentNode) if (node.hidden) return []; return [this.getBoundingClientRect()]; }
  getBoundingClientRect() { const width = this.id === 'world' ? 1440 : this.id === 'minimap' ? 220 : 160; return { left: 0, top: 0, width, height: this.id === 'world' ? 900 : 100 }; }
  getContext() { return { clearRect() {} }; }
}
function descendants(root) { return root.children.flatMap(child => [child, ...descendants(child)]); }
function simpleMatch(element, selector) {
  const prohibited = [...selector.matchAll(/:not\(\[([^\]]+)\]\)/g)].map(m => m[1]);
  if (prohibited.some(name => name === 'disabled' ? element.disabled : name === 'hidden' ? element.hidden : element.getAttribute(name) !== null)) return false;
  selector = selector.replace(/:not\([^)]*\)/g, '');
  const tag = selector.match(/^[a-z][\w-]*/i); if (tag && element.tagName !== tag[0].toUpperCase()) return false;
  const id = selector.match(/#([\w-]+)/); if (id && element.id !== id[1]) return false;
  for (const part of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(part[1])) return false;
  for (const part of selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
    const name = part[1], value = name.startsWith('data-') ? element.dataset[dataKey(name.slice(5))] : element.getAttribute(name);
    if (value === undefined || value === null || part[2] !== undefined && value !== part[2]) return false;
  }
  return true;
}
function matches(element, selector) {
  return selector.split(',').some(alternative => {
    const parts = alternative.trim().split(/\s+/); if (!simpleMatch(element, parts.pop())) return false;
    let ancestor = element.parentNode;
    while (parts.length) { const part = parts.pop(); while (ancestor && !simpleMatch(ancestor, part)) ancestor = ancestor.parentNode; if (!ancestor) return false; ancestor = ancestor.parentNode; }
    return true;
  });
}
function parseInto(parent, source) {
  const stack = [parent], voidTags = new Set(['INPUT', 'META', 'LINK', 'BR', 'IMG', 'HR', 'SOURCE']);
  const tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const tag = token.slice(2).match(/[\w-]+/)[0].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag) { stack.length = i; break; }
    } else if (token.startsWith('<')) {
      const tag = token.slice(1).match(/[\w-]+/); if (!tag) continue;
      const element = new Element(tag[0], parent.ownerDocument);
      const attrs = token.slice(1 + tag[0].length, -1);
      for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) element.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
      stack[stack.length - 1].append(element);
      if (!voidTags.has(element.tagName) && !token.endsWith('/>')) stack.push(element);
    } else stack[stack.length - 1]._text += decode(token);
  }
  for (const select of parent.querySelectorAll('select')) { const options = select.querySelectorAll('option'); const chosen = options.find(option => option.getAttribute('selected') !== null) || options[0]; if (chosen) select.value = chosen.getAttribute('value') ?? chosen.textContent; }
}

function harness({ protocol = 'file:', transport } = {}) {
  const document = new Element('document', null); document.ownerDocument = document; document.createElement = name => new Element(name, document);
  document.getElementById = id => descendants(document).find(el => el.id === id) || null;
  parseInto(document, html); document.body = document.querySelector('body'); document.documentElement = document.querySelector('html'); document.activeElement = document.body; document.hidden = false;
  let now = 0, nextTimer = 1; const timers = new Map(), frames = [], store = new Map(), games = [], commands = [], requests = [], errors = [];
  class Renderer {
    constructor() { Renderer.instance = this; }
    static drawPortrait() {}
    resize() {}
    render(state, options) { this.state = state; this.options = options; }
    drawMinimap() {}
    screenToWorld(x, y) { return { x, y }; }
    worldToScreen(x, y) { return { x, y }; }
  }
  const context = {
    document, BattleCore: { ...Core,
      createGame(options) { const state = Core.createGame(options); games.push({ options, state }); return state; },
      command(state, id, action) { const result = Core.command(state, id, action); commands.push({ id, action, result }); return result; }
    }, BattleRenderer: Renderer, location: { protocol, reload() {} }, navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    matchMedia: () => ({ matches: false }), innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    performance: { now: () => now }, requestAnimationFrame: callback => frames.push(callback),
    setTimeout: (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, ms }); return id; }, clearTimeout: id => timers.delete(id),
    AbortController, console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    fetch: async (url, options = {}) => { requests.push({ url, options }); if (!transport) throw new Error('Unexpected network in offline flow'); return transport(url, options); },
    addEventListener(type, callback) { (context.listeners[type] ||= []).push(callback); }, listeners: {}
  };
  context.window = context; vm.createContext(context); vm.runInContext(app, context, { filename: 'app.js' });
  const id = name => { const el = document.getElementById(name); assert.ok(el, 'Missing HTML id: ' + name); return el; };
  return {
    document, context, games, commands, requests, errors, store, renderer: Renderer.instance, id,
    click(target) { const el = typeof target === 'string' ? id(target) : target; return el.dispatchEvent({ type: 'click', button: 0 }); },
    pointer(x, y, button = 0, target = 'world') { return id(target).dispatchEvent({ type: 'pointerdown', clientX: x, clientY: y, button }); },
    key(code, extra = {}) { return document.dispatchEvent({ type: 'keydown', code, repeat: false, target: document.body, ...extra }); },
    frame(ms = 150) { now += ms; const callback = frames.shift(); assert.ok(callback, 'Application must schedule animation'); callback(now); },
    async timer(ms) { const entry = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, 'Timer ' + ms + ' must exist'); timers.delete(entry[0]); await entry[1].callback(); await settle(); },
    get game() { return games.find(entry => entry.options.players?.length)?.state; }
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
let checks = 0;
async function test(title, run) { await run(); checks++; console.log('PASS ' + title); }

async function main() {
  await test('HTML IDs used by app exist and classic scripts load in dependency order', () => {
    const declared = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(declared.length, new Set(declared).size, 'Unique HTML IDs');
    for (const match of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(declared.includes(match[1]), 'Missing static element: ' + match[1]);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(scripts, ['game-core.js', 'renderer.js', 'app.js']);
  });
  await test('Offline boot, hero selection, real match creation, abilities and item purchases', () => {
    const h = harness(); assert.equal(h.id('boot').hidden, true); assert.equal(h.id('lobby').hidden, false);
    const cards = h.id('hero-cards').querySelectorAll('button'); assert.equal(cards.length, 6);
    h.click(cards[2]); assert.equal(h.id('hero-name').textContent, Core.HEROES[2].name);
    h.click('play-button'); assert.equal(h.id('lobby').hidden, true); assert.equal(h.id('match-ui').hidden, false);
    const hero = Core.getHero(h.game, 'local-player'); assert.equal(hero.heroId, 'cinder'); assert.equal(h.id('ability-buttons').children.length, 4);
    const initial = { x: hero.x, y: hero.y }; h.pointer(700, 1700); assert.equal(h.commands.at(-1).action.type, 'move');
    h.frame(250); assert.ok(Math.hypot(hero.x - initial.x, hero.y - initial.y) > 20);
    h.key('KeyS'); assert.equal(hero.moveTarget, null);
    h.key('KeyQ'); assert.equal(h.id('cast-notice').hidden, false); h.pointer(1000, 1400);
    assert.equal(h.commands.at(-1).action.type, 'cast'); assert.equal(h.commands.at(-1).result.ok, true); assert.ok(hero.cooldowns[0] > 0);
    h.key('KeyB'); assert.equal(h.id('shop').hidden, false);
    const boots = h.id('shop-items').querySelectorAll('button').find(button => button.dataset.item === 'swiftboots');
    h.click(boots); assert.ok(hero.items.includes('swiftboots')); assert.equal(h.commands.at(-1).result.ok, true);
    assert.equal(h.requests.length, 0, 'Offline gameplay must not fetch anything'); assert.equal(h.errors.length, 0);
  });
  await test('Offline pause, modal navigation, resume, recall HUD, scoreboard and visibility pause', () => {
    const h = harness(); h.click('play-button'); h.frame(150); const hero = Core.getHero(h.game, 'local-player');
    h.click('recall-button'); assert.match(h.id('hero-state').textContent, /НА БАЗУ/);
    h.key('Escape'); assert.equal(h.id('pause-modal').hidden, false); const time = h.game.time;
    h.frame(250); assert.equal(h.game.time, time);
    h.click('pause-settings'); assert.equal(h.id('settings-modal').hidden, false);
    const closeSettings = h.id('settings-modal').querySelector('[data-close]'); h.click(closeSettings);
    assert.equal(h.id('pause-modal').hidden, false); h.click('resume-button'); assert.equal(h.id('modal-backdrop').hidden, true);
    h.frame(250); assert.ok(h.game.time > time);
    h.key('Tab'); assert.equal(h.id('score-modal').hidden, false); assert.ok(h.id('score-table').textContent.includes('Искатель'));
    h.document.dispatchEvent({ type: 'keyup', code: 'Tab' }); assert.equal(h.id('score-modal').hidden, true);
    h.document.hidden = true; h.document.dispatchEvent({ type: 'visibilitychange' }); assert.equal(h.id('pause-modal').hidden, false);
    assert.equal(hero.dead, false); assert.equal(h.errors.length, 0);
  });
  await test('End-of-match result, replay and return to lobby preserve usable lifecycle', () => {
    const h = harness(); h.click('play-button'); const previous = h.game;
    previous.status = 'finished'; previous.winner = 0; h.frame(200);
    assert.equal(h.id('result-modal').hidden, false); assert.equal(h.id('result-title').textContent, 'Победа');
    h.click('replay-button'); assert.equal(h.id('result-modal').hidden, true); assert.equal(h.id('match-ui').hidden, false);
    const latest = h.games.filter(entry => entry.options.players?.length).at(-1).state; assert.notEqual(latest, previous); assert.equal(latest.status, 'playing');
    h.click('match-menu'); h.click('leave-match'); assert.equal(h.id('lobby').hidden, false); assert.equal(h.id('match-ui').hidden, true); assert.equal(h.errors.length, 0);
  });
  await test('Standalone offline file refuses online requests with actionable message', async () => {
    const h = harness(); h.click('mode-online'); h.click('play-button'); await settle();
    assert.equal(h.requests.length, 0); assert.match(h.id('toast').textContent, /START_SERVER|сервер/i);
    assert.equal(h.id('lobby').hidden, false);
  });
  await test('Online client uses authenticated commands, authoritative snapshots, sequence IDs and stale-snapshot rejection', async () => {
    let version = 1, ack = 0, onlineState = null, stale = false;
    const room = { code: 'ABC234', hostId: 'host', status: 'lobby', version, players: [playerFixture('host', 0), playerFixture('guest', 1)] };
    const snapshot = extra => ({ room: { ...room, version: stale ? 1 : version }, ...(onlineState ? { state: JSON.parse(JSON.stringify(onlineState)) } : {}), ackSeq: ack, ...extra });
    const transport = async (url, options) => {
      let value;
      if (url === '/api/rooms') value = snapshot({ code: room.code, token: 'test-secret', playerId: 'host' });
      else {
        assert.equal(options.headers.Authorization, 'Bearer test-secret');
        if (url.endsWith('/start')) { onlineState = Core.createGame({ seed: 1, mode: 'online', players: room.players }); room.status = 'playing'; version++; value = snapshot(); }
        else if (url.endsWith('/action')) { const input = JSON.parse(options.body); assert.ok(input.seq > ack); ack = input.seq; const actionResult = Core.command(onlineState, 'host', input.action); version++; value = snapshot({ actionResult }); }
        else if (url.endsWith('/leave')) value = { ok: true };
        else { if (stale) onlineState.heroes.find(hero => hero.playerId === 'host').gold = 1; value = snapshot(); }
      }
      return { ok: true, status: 200, json: async () => value };
    };
    const h = harness({ protocol: 'http:', transport }); h.click('mode-online'); h.click('play-button'); await settle();
    assert.equal(h.id('room-modal').hidden, false); assert.equal(h.id('room-code-display').textContent, room.code);
    h.click('start-room'); await settle(); assert.equal(h.id('match-ui').hidden, false); assert.equal(h.id('room-modal').hidden, true);
    h.pointer(900, 1500); await settle();
    assert.equal(ack, 1); assert.equal(onlineState.heroes.find(hero => hero.playerId === 'host').moveTarget.x, 900);
    const authoritativeTime = onlineState.time; h.frame(250); h.frame(250); assert.equal(onlineState.time, authoritativeTime, 'Client must not simulate online rules');
    const displayedGold = h.id('hud-gold').textContent; stale = true; await h.timer(260); assert.equal(h.id('hud-gold').textContent, displayedGold, 'Stale room.version must not overwrite newer state');
    h.click('match-menu'); h.click('leave-match'); await settle(); assert.ok(h.requests.some(request => request.url.endsWith('/leave')));
    assert.equal(h.id('lobby').hidden, false); assert.equal(h.errors.length, 0);
  });
  console.log('\n' + checks + ' application integration test groups passed.');
}
function playerFixture(id, team) { return { id, name: id, team, heroId: team === 0 ? 'aster' : 'volt', connected: true }; }
main().catch(error => { console.error(error); process.exitCode = 1; });
