(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Core = window.BattleCore;
  const Renderer = window.BattleRenderer;
  let booted = false;
  window.addEventListener('error', event => {
    if (!booted) { $('boot').hidden = true; $('fatal').hidden = false; $('fatal-text').textContent = event.message || 'Проверь, что все файлы игры распакованы вместе.'; }
    else console.error('Emberfall:', event.error || event.message);
  });
  if (!Core || !Renderer) throw new Error('Не загружены игровые файлы. Распакуй архив целиком или открой автономный Emberfall.html.');
  const local = {
    get(key, fallback) { try { const value = localStorage.getItem('emberfall:' + key); return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } },
    set(key, value) { try { localStorage.setItem('emberfall:' + key, JSON.stringify(value)); } catch (_) {} },
    remove(key) { try { localStorage.removeItem('emberfall:' + key); } catch (_) {} }
  };
  const roomStorage={get(){try{return JSON.parse(sessionStorage.getItem('emberfall:room')||'null');}catch(_){return null;}},set(value){try{if(value)sessionStorage.setItem('emberfall:room',JSON.stringify(value));else sessionStorage.removeItem('emberfall:room');}catch(_){}}};
  const prefs = Object.assign({ sound: true, volume: .35, quality: 'high', reduced: matchMedia('(prefers-reduced-motion: reduce)').matches }, local.get('settings', {}));
  prefs.volume = Math.max(0, Math.min(1, Number(prefs.volume) || 0));
  prefs.quality = prefs.quality === 'low' ? 'low' : 'high';
  let selectedHero = Core.HEROES.some(h => h.id === local.get('hero', 'aster')) ? local.get('hero', 'aster') : 'aster';
  let mode = 'offline', state = null, demo = null, view = 'lobby', playerId = 'local-player';
  let renderer, lastFrame = performance.now(), accumulator = 0, demoAccumulator = 0, paused = false;
  let activeModal = null, previousModal = null, armedSpell = null, attackMove = false, pointer = null, targetId = null;
  let manualCamera = null, zoom = .95, hudAt = 0, lastEventId = null, resultShown = false, toastTimer;
  let session = null, polling = false, pollTimer = 0, queuedActions = [], sending = false, commandSequence = 0;
  let networkFailureSince = 0, requestGeneration = 0, currentSnapshotVersion = -1, windowFocused = true;
  let interpolation = new Map(), snapshotAt = 0;
  const glyphs = ['✦', '◈', '❖', '☄'];
  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const heroDef = id => Core.HEROES.find(h => h.id === id) || Core.HEROES[0];
  const getHero = () => state && Core.getHero(state, playerId);
  const clock = value => { const s = Math.max(0, Math.floor(Number(value) || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const num = value => Math.round(Number(value) || 0);
  const abilities = def => def.abilities || [];
  const spellMana = ability => ability.mana ?? ability.cost ?? 0;
  const spellGlyph = (ability, index) => ability.icon && String(ability.icon).length < 5 ? ability.icon : glyphs[index];
  const itemGlyph = item => item.icon && String(item.icon).length < 5 ? item.icon : '◈';

  const audio = {
    context: null, last: 0,
    wake() { if (!prefs.sound) return; try { this.context ||= new (window.AudioContext || window.webkitAudioContext)(); this.context.resume().catch(() => {}); } catch (_) {} },
    tone(kind = 'click') {
      if (!prefs.sound || !this.context || this.context.state !== 'running' || prefs.volume <= 0) return;
      const t = this.context.currentTime;
      if (kind === 'click' && t - this.last < .08) return;
      this.last = t;
      const config = {click:[450,680,.075,'sine'],cast:[320,780,.22,'triangle'],buy:[700,1100,.14,'sine'],error:[170,120,.14,'triangle'],kill:[600,900,.3,'triangle'],victory:[440,880,.8,'sine'],death:[220,90,.6,'triangle']};
      const [from, to, duration, type] = config[kind] || config.click;
      const o = this.context.createOscillator(), g = this.context.createGain();
      o.type = type; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + duration);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0001, prefs.volume * .12), t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
      o.connect(g); g.connect(this.context.destination); o.start(t); o.stop(t + duration + .02);
    }
  };
  function toast(message, error) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3300); if (error) audio.tone('error'); }
  function tooltip(element, title, text, detail) {
    element.addEventListener('pointerenter', () => {
      if (matchMedia('(pointer: coarse)').matches) return;
      $('tooltip').innerHTML = '<b>' + escapeText(title) + '</b>' + escapeText(text) + (detail ? '<small>' + escapeText(detail) + '</small>' : '');
      $('tooltip').hidden = false;
      const rect = element.getBoundingClientRect(), tip = $('tooltip').getBoundingClientRect();
      $('tooltip').style.left = Math.max(10, Math.min(innerWidth - tip.width - 10, rect.left + rect.width / 2 - tip.width / 2)) + 'px';
      $('tooltip').style.top = Math.max(8, rect.top - tip.height - 12) + 'px';
    });
    element.addEventListener('pointerleave', () => $('tooltip').hidden = true);
  }
  function openModal(id) {
    if (activeModal === 'pause' && (id === 'settings' || id === 'guide')) previousModal = 'pause';
    else if (id !== activeModal) previousModal = null;
    document.querySelectorAll('.modal').forEach(el => el.hidden = true);
    $(id + '-modal').hidden = false; $('modal-backdrop').hidden = false;
    activeModal = id; $('tooltip').hidden = true; armedSpell = null; attackMove = false;
    if (view === 'match' && mode === 'offline') paused = true;
    if (id === 'score') drawScoreboard();
    if (id === 'pause') { $('pause-label').textContent = mode === 'offline' ? 'СРАЖЕНИЕ НА ПАУЗЕ' : 'СЕТЕВОЙ МАТЧ ПРОДОЛЖАЕТСЯ'; $('pause-description').textContent = mode === 'offline' ? 'Твой отряд ждёт возвращения.' : 'Остальные игроки продолжают бой. Вернись к своему герою.'; }
    const focus = $(id + '-modal').querySelector('button, input, select'); if (focus) focus.focus({preventScroll:true});
  }
  function closeModal() {
    if (previousModal) { const id = previousModal; previousModal = null; openModal(id); return; }
    $('modal-backdrop').hidden = true; document.querySelectorAll('.modal').forEach(el => el.hidden = true); activeModal = null;
    if (view === 'match') { paused = false; lastFrame = performance.now(); accumulator = 0; }
    $('tooltip').hidden = true;
  }
  function setMode(next) {
    mode = next; $('mode-offline').classList.toggle('selected', next === 'offline'); $('mode-online').classList.toggle('selected', next === 'online');
    $('offline-options').hidden = next !== 'offline'; $('online-options').hidden = next !== 'online';
    $('play-button').querySelector('span').textContent = next === 'offline' ? 'НАЧАТЬ СРАЖЕНИЕ' : 'СОЗДАТЬ КОМНАТУ';
    $('play-note').textContent = next === 'offline' ? 'Ты и 9 ботов · матч до уничтожения Истока' : 'До 10 игроков · свободные места займут боты';
    if (location.protocol === 'file:' && next === 'online') $('network-hint').textContent = 'Для игры по сети открой опубликованную версию или запусти сервер из комплекта. Этот файл работает автономно с ботами.';
  }
  function drawPortrait(canvas, id) { const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); Renderer.drawPortrait(ctx,id,0,0,Math.min(canvas.width,canvas.height)); }
  function selectHero(id) {
    selectedHero = id; local.set('hero', id); const h = heroDef(id), index = Core.HEROES.indexOf(h);
    $('hero-number').textContent = String(index + 1).padStart(2,'0') + ' / 06'; $('hero-name').textContent = h.name; $('hero-role').textContent = h.role; $('hero-description').textContent = h.description;
    document.querySelectorAll('.hero-card').forEach(el => { const selected = el.dataset.hero === id; el.classList.toggle('selected',selected); el.setAttribute('aria-pressed',String(selected)); });
    const stats = [['УРОН', Math.max(1,Math.min(5,Math.round((h.damage || 50)/15)))],['ЗДОРОВЬЕ', Math.max(1,Math.min(5,Math.round((h.hp || 900)/260)))],['ДАЛЬНОСТЬ', Math.max(1,Math.min(5,Math.round((h.range || 150)/95)))]];
    $('hero-stats').innerHTML = stats.map(([name,n]) => '<div class="hero-stat"><span>'+name+'</span><div class="stat-segments">'+Array.from({length:5},(_,i)=>'<i class="'+(i<n?'on':'')+'"></i>').join('')+'</div></div>').join('');
    $('hero-abilities-preview').replaceChildren();
    abilities(h).forEach((ability,i) => { const b=document.createElement('button');b.innerHTML=escapeText(spellGlyph(ability,i))+'<small>'+['Q','W','E','R'][i]+'</small>';b.setAttribute('aria-label',ability.name);tooltip(b,ability.name,ability.description,spellMana(ability)+' маны · '+ability.cooldown+' с перезарядка');b.onclick=()=>toast(ability.name+': '+ability.description);$('hero-abilities-preview').append(b); });
    const art=$('hero-art'),artContext=art.getContext('2d');artContext.clearRect(0,0,art.width,art.height);
    if(Renderer.drawHeroArt)Renderer.drawHeroArt(artContext,id,0,0,Math.min(art.width,art.height));else drawPortrait(art,id);
    document.querySelector('.hero-halo').style.background='radial-gradient(ellipse,'+(h.color || '#7ebc92')+'44,transparent 67%)';
  }
  function buildRoster() {
    Core.HEROES.forEach(h => { const b=document.createElement('button');b.className='hero-card';b.dataset.hero=h.id;b.setAttribute('aria-label',h.name+', '+h.role); const c=document.createElement('canvas');c.width=100;c.height=100;b.append(c);const text=document.createElement('span');text.innerHTML='<b>'+escapeText(h.name)+'</b><small>'+escapeText(h.role)+'</small>';b.append(text);b.onclick=()=>{selectHero(h.id);audio.wake();audio.tone();};$('hero-cards').append(b);drawPortrait(c,h.id); });
    selectHero(selectedHero);
  }
  function beginMatch(game, id, matchMode) {
    state=game;playerId=id;mode=matchMode;view='match';paused=false;resultShown=false;manualCamera=null;armedSpell=null;attackMove=false;targetId=null;pointer=null;zoom=.95;lastEventId=null;accumulator=0;lastFrame=performance.now();interpolation.clear();
    closeModal();$('lobby').hidden=true;$('match-ui').hidden=false;$('shop').hidden=true;$('kill-feed').replaceChildren();$('connection-notice').hidden=true;$('death-notice').hidden=true;
    $('match-mode').textContent=matchMode==='offline'?'БОТЫ · 5 × 5':'ПО СЕТИ · '+(session?.code || '5 × 5');
    const h=getHero(),def=heroDef(h?.heroId||selectedHero);drawPortrait($('hud-portrait'),def.id);$('hud-name').textContent=def.name;$('hud-role').textContent=def.role;buildAbilities(def);buildShop();updateHud();
    audio.wake();audio.tone('cast');
    toast('Защищай союзников и разрушь вражеский Исток. Q W E R — способности.');
  }
  function startOffline() {
    stopNetwork(false);setMode('offline');const game=Core.createGame({seed:Math.floor(Math.random()*2147483646)+1,difficulty:$('difficulty').value,players:[{id:'local-player',name:local.get('playerName','Искатель')||'Искатель',team:0,heroId:selectedHero}],mode:'offline'});
    beginMatch(game,'local-player','offline');
  }
  function lobby() {
    stopNetwork(true);view='lobby';state=null;paused=false;manualCamera=null;armedSpell=null;attackMove=false;closeModal();$('match-ui').hidden=true;$('lobby').hidden=false;$('shop').hidden=true;$('toast').hidden=true;$('tooltip').hidden=true;
    setMode('offline');makeDemo();
  }
  function makeDemo() {
    demo=Core.createGame({seed:421,players:[],mode:'offline'});for(let i=0;i<100;i++)Core.step(demo,.2);demoAccumulator=0;
  }
  function buildAbilities(def) {
    $('ability-buttons').replaceChildren();
    abilities(def).forEach((ability,i)=>{const b=document.createElement('button');b.className='ability-button';b.dataset.slot=i;b.setAttribute('aria-label',ability.name+', '+['Q','W','E','R'][i]);b.innerHTML='<span class="ability-glyph">'+escapeText(spellGlyph(ability,i))+'</span><span class="ability-key">'+['Q','W','E','R'][i]+'</span><span class="ability-mana">'+spellMana(ability)+'</span><span class="ability-cooldown" hidden></span>';b.onclick=()=>arm(i);tooltip(b,ability.name,ability.description,spellMana(ability)+' маны · '+ability.cooldown+' с перезарядка');$('ability-buttons').append(b);});
  }
  function arm(slot) {
    const hero=getHero();if(!hero||hero.dead||paused)return;
    const spell=abilities(heroDef(hero.heroId))[slot];if(!spell)return;
    if ((hero.cooldowns?.[slot]||0)>.05) { toast('Способность восстанавливается.',true);return; }
    if(hero.mana<spellMana(spell)) { toast('Недостаточно маны.',true);return; }
    armedSpell=armedSpell===slot?null:slot;attackMove=false;audio.wake();audio.tone();updateHud();
  }
  function sendAction(action) {
    if(!state||state.status!=='playing'||paused)return;
    if(mode==='offline') { const result=Core.command(state,playerId,action);if(!result.ok)toast(result.error||'Сейчас это действие недоступно.',true);else if(action.type==='cast')audio.tone('cast');else if(action.type==='buy')audio.tone('buy');updateHud();return; }
    if(!session)return;if(queuedActions.length>12){toast('Ждём ответа сервера…');return;}
    queuedActions.push({seq:++commandSequence,action});flushActions();
  }
  function buildShop() {
    $('shop-items').replaceChildren();
    Core.ITEMS.forEach(item=>{const el=document.createElement('article');el.className='shop-item';el.innerHTML='<span class="item-glyph">'+escapeText(itemGlyph(item))+'</span><div><h3>'+escapeText(item.name)+'</h3><p>'+escapeText(item.description)+'</p></div><button data-item="'+escapeText(item.id)+'" aria-label="Купить '+escapeText(item.name)+'">◈ '+item.cost+'</button>';el.querySelector('button').onclick=()=>sendAction({type:'buy',itemId:item.id});$('shop-items').append(el);});
  }
  function itemId(item) {return typeof item==='string'?item:item?.id;}
  function updateHud() {
    if(!state)return;const hero=getHero();if(!hero)return;
    $('score-dawn').textContent=state.kills?.[0]||0;$('score-dusk').textContent=state.kills?.[1]||0;$('match-time').textContent=clock(state.time);
    $('hp-fill').style.width=Math.max(0,Math.min(100,hero.hp/hero.maxHp*100))+'%';$('hp-text').textContent=num(hero.hp)+' / '+num(hero.maxHp);
    $('mana-fill').style.width=Math.max(0,Math.min(100,hero.mana/hero.maxMana*100))+'%';$('mana-text').textContent=num(hero.mana)+' / '+num(hero.maxMana);
    $('hud-level').textContent=hero.level;$('hud-damage').textContent=num(hero.damage);$('hud-kda').textContent=[hero.kills||0,hero.deaths||0,hero.assists||0].join(' / ');$('hud-gold').textContent=Math.floor(hero.gold||0);
    const threshold=hero.xpToNext||hero.nextLevelXp||((hero.level||1)*180);$('xp-fill').style.width=Math.max(0,Math.min(100,(hero.xp||0)/threshold*100))+'%';
    $('hero-state').textContent=hero.dead?'ВОЗРОЖДЕНИЕ':hero.recall>0?'НА БАЗУ: '+Math.ceil(hero.recall)+' с':'ГОТОВ К БОЮ';
    $('death-notice').hidden=!hero.dead;if(hero.dead)$('respawn-time').textContent=Math.ceil(hero.respawn||hero.respawnTime||0);
    $('cast-notice').hidden=armedSpell===null&&!attackMove;
    if(armedSpell!==null)$('cast-notice').textContent=abilities(heroDef(hero.heroId))[armedSpell]?.name+' · выбери цель · Esc — отмена';
    else if(attackMove)$('cast-notice').textContent='Атака по пути · выбери точку · Esc — отмена';
    document.querySelectorAll('.ability-button').forEach((el,i)=>{const cooldown=hero.cooldowns?.[i]||0,ability=abilities(heroDef(hero.heroId))[i];el.classList.toggle('armed',armedSpell===i);el.classList.toggle('unavailable',hero.dead||cooldown>.05||hero.mana<spellMana(ability));const c=el.querySelector('.ability-cooldown');c.hidden=cooldown<=.05;c.textContent=Math.ceil(cooldown);});
    const owned=(hero.items||[]).map(itemId);const key=owned.join(',');
    if($('inventory').dataset.items!==key){$('inventory').dataset.items=key;$('inventory').replaceChildren();for(let i=0;i<6;i++){const item=Core.ITEMS.find(it=>it.id===owned[i]),el=document.createElement('button');el.className='item-slot'+(item?' filled':'');el.textContent=item?itemGlyph(item):'·';el.setAttribute('aria-label',item?item.name:'Пустая ячейка '+(i+1));if(item)tooltip(el,item.name,item.description);else el.onclick=()=>{$('shop').hidden=false;};$('inventory').append(el);}}
    const base=Core.MAP.bases[hero.team],nearBase=Math.hypot(hero.x-base.x,hero.y-base.y)<=330;
    document.querySelectorAll('#shop-items button').forEach(el=>{const item=Core.ITEMS.find(i=>i.id===el.dataset.item),has=owned.includes(item.id);el.disabled=hero.dead||has||hero.gold<item.cost||owned.length>=6||!nearBase;el.classList.toggle('owned',has);el.textContent=has?'Куплено':'◈ '+item.cost;el.title=has?'Уже в инвентаре':!nearBase?'Покупка доступна рядом со своим Истоком':'';});
    $('shop-message').textContent=nearBase?'Ты у Истока. Покупка доступна.':'Вернись к своему Истоку, чтобы купить предметы. Клавиша D — возврат.';
    const events=(state.events||[]).filter(e=>['kill','tower','victory','core','hero-kill','structure'].includes(e.type));
    const latest=events[events.length-1];if(latest&&latest.id!==lastEventId){lastEventId=latest.id;$('kill-feed').replaceChildren();events.slice(-4).reverse().forEach(e=>{const el=document.createElement('div');el.className='feed-line';el.textContent=e.text||'';$('kill-feed').append(el);});if(latest.type==='kill'||latest.type==='hero-kill')audio.tone('kill');}
    if(state.status==='finished'&&!resultShown)showResult();
    if(activeModal==='score')drawScoreboard();
  }
  function drawScoreboard() {
    if(!state)return;$('score-table').innerHTML=[0,1].map(team=>'<div class="team-score"><h3 class="'+(team===0?'dawn':'dusk')+'">'+(team===0?'РАССВЕТ':'ПЕПЕЛ')+'</h3><div class="score-row header"><span>ИГРОК / ГЕРОЙ</span><span>УР.</span><span>У / С / П</span><span>ЗОЛОТО</span></div>'+state.heroes.filter(h=>h.team===team).map(h=>'<div class="score-row '+(h.playerId===playerId?'you':'')+'"><span>'+escapeText(h.name)+(h.playerId===playerId?' · ТЫ':'')+'<small>'+escapeText(heroDef(h.heroId).name)+(h.bot?' · бот':'')+'</small></span><span>'+h.level+'</span><span>'+(h.kills||0)+' / '+(h.deaths||0)+' / '+(h.assists||0)+'</span><span>'+Math.floor(h.gold||0)+'</span></div>').join('')+'</div>').join('');
  }
  function showResult() {
    resultShown=true;const hero=getHero(),won=state.winner===hero?.team;
    $('result-eyebrow').textContent=won?'ИСТОК ПОД ТВОЕЙ ЗАЩИТОЙ':'ЛЕГЕНДА ЕЩЁ НЕ ЗАКОНЧЕНА';$('result-title').textContent=won?'Победа':'Поражение';$('result-title').style.color=won?'var(--gold)':'var(--red)';
    $('result-description').textContent=won?'Вражеское сердце разрушено. Твой отряд вписал своё имя в историю.':'Твой Исток пал. Смени тактику, выбери героя и вернись сильнее.';
    $('result-stats').innerHTML='<span><b>'+clock(state.time)+'</b>ВРЕМЯ МАТЧА</span><span><b>'+(hero?.kills||0)+' / '+(hero?.deaths||0)+'</b>УБИЙСТВА / СМЕРТИ</span><span><b>'+(hero?.level||1)+'</b>УРОВЕНЬ</span>';
    audio.tone(won?'victory':'death');openModal('result');
  }

  async function api(path,options={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
    const headers={'Content-Type':'application/json'};if(options.auth&&session)headers.Authorization='Bearer '+session.token;
    try{const response=await fetch(path,{method:options.method||'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body),signal:controller.signal,cache:'no-store'});let value;try{value=await response.json();}catch(_){throw new Error('Сервер сетевой игры недоступен по этому адресу.');}if(!response.ok){const error=new Error(value.message||'Ошибка сетевой комнаты.');error.status=response.status;throw error;}return value;}finally{clearTimeout(timer);}
  }
  function saveSession(){roomStorage.set(session?{...session,seq:commandSequence}:null);}
  function acceptSnapshot(data) {
    if(!session||!data?.room)return;
    const version=data.room.version;
    if(Number.isFinite(version)&&version<currentSnapshotVersion)return;
    if(Number.isFinite(version))currentSnapshotVersion=version;
    networkFailureSince=0;$('connection-notice').hidden=true;commandSequence=Math.max(commandSequence,data.ackSeq||0);
    if(data.state){
      if(view!=='match')beginMatch(data.state,session.playerId,'online');
      else{const old=state;interpolation.clear();if(old){for(const entity of [...(old.heroes||[]),...(old.creeps||[])])interpolation.set(entity.id,{x:entity.x,y:entity.y});}state=data.state;snapshotAt=performance.now();}
      updateHud();
    }else drawRoom(data.room);
  }
  function drawRoom(room) {
    if(!session)return;if(activeModal!=='room')openModal('room');$('room-code-display').textContent=room.code;
    $('room-title').textContent='Отряд собирается';const host=room.hostId===session.playerId;$('start-room').hidden=!host;$('room-status').textContent=host?'Ты создатель комнаты. Начни матч, когда все будут готовы.':'Создатель комнаты начнёт матч, когда все будут готовы.';
    $('room-players').innerHTML=[0,1].map(team=>{const players=room.players.filter(p=>p.team===team);return '<section class="room-team"><h3 class="'+(team===0?'dawn':'dusk')+'">'+(team===0?'РАССВЕТ':'ПЕПЕЛ')+'</h3>'+Array.from({length:5},(_,i)=>{const p=players[i];return p?'<div class="room-player"><i></i><span>'+escapeText(p.name)+(p.id===session.playerId?' · ТЫ':'')+(p.id===room.hostId?' ♛':'')+'<small>'+escapeText(heroDef(p.heroId).name)+(p.connected===false?' · отключён':'')+'</small></span></div>':'<div class="room-player bot"><i></i><span>Союзник-бот<small>Вступит в начале матча</small></span></div>';}).join('')+'</section>';}).join('');
  }
  async function enterRoom(join) {
    if(location.protocol==='file:'){toast('Сетевая игра работает через сервер. Открой сетевую версию или START_SERVER.cmd из архива.',true);return;}
    const name=$('player-name').value.trim()||'Искатель';local.set('playerName',name);const code=$('room-code').value.trim().toUpperCase();if(join&&!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){toast('Введи шестизначный код комнаты.',true);return;}
    $('play-button').disabled=true;$('join-room').disabled=true;
    try{const data=await api(join?'/api/rooms/'+code+'/join':'/api/rooms',{method:'POST',body:{name,heroId:selectedHero}});stopNetwork(false);session={code:data.code||data.room.code,token:data.token,playerId:data.playerId};playerId=session.playerId;commandSequence=0;currentSnapshotVersion=-1;saveSession();mode='online';acceptSnapshot(data);startPolling();audio.wake();audio.tone('cast');}
    catch(error){toast(error.name==='AbortError'?'Сервер не ответил. Попробуй ещё раз.':error.message,true);}
    finally{$('play-button').disabled=false;$('join-room').disabled=false;}
  }
  function stopNetwork(leave) {
    const old=session;if(leave&&old){fetch('/api/rooms/'+old.code+'/leave',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+old.token},body:'{}',keepalive:true}).catch(()=>{});}
    clearTimeout(pollTimer);requestGeneration++;session=null;queuedActions=[];sending=false;polling=false;currentSnapshotVersion=-1;networkFailureSince=0;saveSession();
  }
  function networkFailure(error) {
    if(!session)return;
    if(error.status===401||error.status===403||error.status===404||error.status===410){const msg=error.message;stopNetwork(false);lobby();toast(msg,true);return;}
    networkFailureSince ||= Date.now();$('connection-notice').hidden=false;$('connection-notice').textContent='Связь с сервером потеряна. Переподключаемся…';
  }
  function startPolling() {
    const gen=requestGeneration;clearTimeout(pollTimer);
    async function poll(){if(!session||gen!==requestGeneration)return;if(!sending&&!polling){polling=true;try{const data=await api('/api/rooms/'+session.code,{auth:true});if(gen===requestGeneration)acceptSnapshot(data);}catch(error){if(gen===requestGeneration)networkFailure(error);}finally{polling=false;}}if(gen===requestGeneration&&session)pollTimer=setTimeout(poll,260);}
    pollTimer=setTimeout(poll,260);
  }
  async function flushActions() {
    if(sending||!session||!queuedActions.length)return;const gen=requestGeneration;sending=true;
    try{while(queuedActions.length&&session&&gen===requestGeneration){const command=queuedActions[0];const data=await api('/api/rooms/'+session.code+'/action',{method:'POST',auth:true,body:command});if(gen!==requestGeneration)break;queuedActions.shift();saveSession();acceptSnapshot(data);if(data.actionResult&&!data.actionResult.ok)toast(data.actionResult.error||'Действие недоступно.',true);else if(command.action.type==='cast')audio.tone('cast');else if(command.action.type==='buy')audio.tone('buy');}}
    catch(error){if(gen===requestGeneration)networkFailure(error);}finally{if(gen===requestGeneration){sending=false;if(queuedActions.length)setTimeout(flushActions,1000);}}
  }
  async function restoreSession() {
    const saved=roomStorage.get();if(!saved?.code||!saved?.token||location.protocol==='file:')return;
    session={code:saved.code,token:saved.token,playerId:saved.playerId};commandSequence=saved.seq||0;mode='online';
    try{const data=await api('/api/rooms/'+session.code,{auth:true});playerId=session.playerId;acceptSnapshot(data);startPolling();toast('Ты вернулся в сетевую комнату.');}catch(_){stopNetwork(false);}
  }
  function pointFromEvent(event) {const r=$('world').getBoundingClientRect();return renderer.screenToWorld(event.clientX-r.left,event.clientY-r.top);}
  function nearestEnemy(point) {
    const hero=getHero();if(!hero)return null;const units=[...(state.heroes||[]),...(state.creeps||[]),...(state.structures||[])];let nearest=null,distance=Infinity;
    for(const e of units){if(e.team===hero.team||e.dead||e.hp<=0)continue;const d=Math.hypot(e.x-point.x,e.y-point.y),hit=e.type==='core'?105:e.type==='tower'?65:48;if(d<hit&&d<distance){distance=d;nearest=e;}}
    return nearest;
  }
  function worldClick(event) {
    if(view!=='match'||activeModal||paused||event.button>2)return;event.preventDefault();audio.wake();const hero=getHero();if(!hero||hero.dead)return;
    const p=pointFromEvent(event);p.x=Math.max(0,Math.min(Core.MAP.width,p.x));p.y=Math.max(0,Math.min(Core.MAP.height,p.y));const enemy=nearestEnemy(p);targetId=enemy?.id||null;
    if(armedSpell!==null){const action={type:'cast',slot:armedSpell,x:p.x,y:p.y};if(enemy)action.targetId=enemy.id;sendAction(action);armedSpell=null;}
    else if(attackMove){sendAction({type:'attackMove',x:p.x,y:p.y});attackMove=false;}
    else if(enemy)sendAction({type:'attack',targetId:enemy.id});else sendAction({type:'move',x:p.x,y:p.y});
    pointer={x:p.x,y:p.y,at:performance.now()};updateHud();
  }
  function bindEvents() {
    $('mode-offline').onclick=()=>setMode('offline');$('mode-online').onclick=()=>setMode('online');$('play-button').onclick=()=>{audio.wake();mode==='offline'?startOffline():enterRoom(false);};$('join-room').onclick=()=>enterRoom(true);
    $('player-name').value=local.get('playerName','Искатель');$('room-code').addEventListener('input',()=>{$('room-code').value=$('room-code').value.toUpperCase().replace(/[^A-Z2-9]/g,'');});
    document.querySelectorAll('[data-open]').forEach(el=>el.onclick=()=>{audio.wake();audio.tone();openModal(el.dataset.open);});document.querySelectorAll('[data-close]').forEach(el=>el.onclick=closeModal);
    document.querySelector('.brand').onclick=e=>{e.preventDefault();if(view==='lobby')selectHero('aster');};
    $('match-menu').onclick=()=>openModal('pause');$('resume-button').onclick=closeModal;$('pause-settings').onclick=()=>openModal('settings');$('leave-match').onclick=lobby;$('result-menu').onclick=lobby;
    $('replay-button').onclick=()=>{if(mode==='offline')startOffline();else{lobby();setMode('online');}};
    $('scoreboard-button').onclick=()=>openModal('score');$('shop-button').onclick=()=>{$('shop').hidden=!$('shop').hidden;};$('close-shop').onclick=()=>{$('shop').hidden=true;};
    $('recall-button').onclick=$('touch-recall').onclick=()=>sendAction({type:'recall'});$('touch-stop').onclick=()=>sendAction({type:'stop'});$('touch-follow').onclick=()=>{manualCamera=null;};
    $('setting-sound').checked=!!prefs.sound;$('setting-volume').value=prefs.volume*100;$('setting-quality').value=prefs.quality;$('setting-reduced').checked=!!prefs.reduced;document.body.classList.toggle('reduced-motion',!!prefs.reduced);
    function settings(){prefs.sound=$('setting-sound').checked;prefs.volume=$('setting-volume').value/100;prefs.quality=$('setting-quality').value;prefs.reduced=$('setting-reduced').checked;local.set('settings',prefs);document.body.classList.toggle('reduced-motion',prefs.reduced);$('sound-toggle').textContent=prefs.sound?'♫':'♪';$('sound-toggle').setAttribute('aria-label',prefs.sound?'Выключить звук':'Включить звук');if(prefs.sound)audio.wake();}
    ['setting-sound','setting-volume','setting-quality','setting-reduced'].forEach(id=>$(id).addEventListener('input',settings));$('sound-toggle').onclick=()=>{$('setting-sound').checked=!prefs.sound;settings();};settings();
    $('fullscreen-button').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch(_){toast('Полный экран недоступен в этом браузере.');}};
    $('start-room').onclick=async()=>{if(!session)return;$('start-room').disabled=true;try{const data=await api('/api/rooms/'+session.code+'/start',{method:'POST',auth:true,body:{}});acceptSnapshot(data);}catch(error){toast(error.message,true);}finally{$('start-room').disabled=false;}};
    $('leave-room').onclick=()=>{stopNetwork(true);closeModal();setMode('online');};
    $('copy-room').onclick=async()=>{if(!session)return;try{await navigator.clipboard.writeText(session.code);toast('Код '+session.code+' скопирован.');}catch(_){toast('Код комнаты: '+session.code+'. Выдели и скопируй его вручную.');}};
    $('world').addEventListener('pointerdown',worldClick);$('world').addEventListener('contextmenu',e=>e.preventDefault());
    $('world').addEventListener('pointermove',event=>{if(view==='match'&&(armedSpell!==null||attackMove)){const p=pointFromEvent(event);pointer={x:p.x,y:p.y,at:performance.now()};}});
    $('world').addEventListener('wheel',event=>{if(view!=='match'||activeModal)return;event.preventDefault();zoom=Math.max(.55,Math.min(1.5,zoom-event.deltaY*.0007));},{passive:false});
    $('minimap').addEventListener('pointerdown',event=>{event.preventDefault();if(!state)return;const r=$('minimap').getBoundingClientRect(),x=(event.clientX-r.left)/r.width*Core.MAP.width,y=(event.clientY-r.top)/r.height*Core.MAP.height;if(event.button===2||event.shiftKey)sendAction({type:'move',x,y});else manualCamera={x,y,zoom};});$('minimap').addEventListener('contextmenu',e=>e.preventDefault());
    document.addEventListener('keydown',event=>{
      const editing=/INPUT|TEXTAREA|SELECT/.test(event.target.tagName);if(editing&&event.code!=='Escape')return;
      if(event.code==='Tab'&&activeModal){const items=[...$(activeModal+'-modal').querySelectorAll('button:not([disabled]):not([hidden]),input,select')].filter(el=>el.getClientRects().length);if(items.length){const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}return;}
      if(event.code==='Escape'){event.preventDefault();if(armedSpell!==null||attackMove){armedSpell=null;attackMove=false;updateHud();return;}if(!$('shop').hidden){$('shop').hidden=true;return;}if(activeModal&&activeModal!=='room'&&activeModal!=='result'){closeModal();return;}if(view==='match'&&!activeModal)openModal('pause');return;}
      if(view!=='match'||activeModal||event.repeat)return;
      const slot=['KeyQ','KeyW','KeyE','KeyR'].indexOf(event.code);if(slot>=0){event.preventDefault();arm(slot);return;}
      if(event.code==='Space'){event.preventDefault();manualCamera=null;}
      if(event.code==='KeyA'){event.preventDefault();attackMove=!attackMove;armedSpell=null;updateHud();}
      if(event.code==='KeyS')sendAction({type:'stop'});
      if(event.code==='KeyD')sendAction({type:'recall'});
      if(event.code==='KeyB'){$('shop').hidden=!$('shop').hidden;}
      if(event.code==='Tab'){event.preventDefault();openModal('score');}
    });
    document.addEventListener('keyup',e=>{if(e.code==='Tab'&&activeModal==='score')closeModal();});
    document.addEventListener('visibilitychange',()=>{windowFocused=!document.hidden;lastFrame=performance.now();accumulator=0;if(document.hidden&&view==='match'&&mode==='offline'&&!activeModal)openModal('pause');});
    window.addEventListener('resize',resize);window.addEventListener('pagehide',()=>{saveSession();});
  }
  function resize(){renderer.resize(innerWidth,innerHeight,Math.min(devicePixelRatio||1,1.75));}
  function drawInterpolated() {
    if(mode!=='online'||!state||!interpolation.size)return state;
    const alpha=Math.min(1,(performance.now()-snapshotAt)/220);if(alpha>=1)return state;
    // Only visual coordinates interpolate. Rules and HUD always use authoritative state.
    return {...state,heroes:state.heroes.map(e=>{const old=interpolation.get(e.id);return old&&!e.dead&&Math.hypot(e.x-old.x,e.y-old.y)<450?{...e,x:old.x+(e.x-old.x)*alpha,y:old.y+(e.y-old.y)*alpha}:e;}),creeps:state.creeps.map(e=>{const old=interpolation.get(e.id);return old?{...e,x:old.x+(e.x-old.x)*alpha,y:old.y+(e.y-old.y)*alpha}:e;})};
  }
  function frame(now) {
    const elapsed=Math.min(.25,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    if(view==='match'&&state){
      if(mode==='offline'&&!paused&&state.status==='playing'){accumulator+=elapsed;while(accumulator>=.05){Core.step(state,.05);accumulator-=.05;}}
      const shown=drawInterpolated();let cam=manualCamera?{...manualCamera,zoom}:undefined;renderer.zoom=zoom;
      renderer.render(shown,{playerId,selectedTargetId:targetId,pointer:pointer&&(armedSpell!==null||attackMove||now-pointer.at<950)?pointer:null,quality:prefs.quality,camera:cam,time:now/1000,zoom});
      if(now-hudAt>120){hudAt=now;updateHud();renderer.drawMinimap($('minimap'),state,playerId);}
    }else if(demo){
      if(!prefs.reduced&&windowFocused){demoAccumulator+=elapsed;while(demoAccumulator>=.1){Core.step(demo,.1);demoAccumulator-=.1;}if(demo.status==='finished')makeDemo();}
      renderer.render(demo,{quality:prefs.quality,camera:{x:1200+Math.sin(now/30000)*150,y:1200,zoom:.6},time:prefs.reduced?0:now/1000});
    }
    requestAnimationFrame(frame);
  }
  renderer=new Renderer($('world'));resize();buildRoster();bindEvents();makeDemo();$('boot').hidden=true;$('lobby').hidden=false;booted=true;requestAnimationFrame(frame);restoreSession();
})();
