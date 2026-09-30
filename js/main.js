'use strict';
// Boot, main loop, screens, terminal comms and HUD.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const params0 = new URLSearchParams(location.search);
  const mapMode = params0.has('map');
  if (!mapMode) Render3D.init(canvas);
  const radar = $('radar');
  const SAVE_KEY = 'cosmic-calamity.progress';
  const STEP = 1 / 60;

  let view = { w: 384, h: 216 };
  let mode = 'title';          // title | select | help | card | codec | play | pause | gameover | clear | ending
  let helpReturn = 'title';
  let stageIndex = 0;
  let run = null;              // totals across a playthrough
  let acc = 0, last = performance.now();
  const params = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ save data
  function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || { unlocked: 0 }; } catch (e) { return { unlocked: 0 }; } }
  function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  let save = loadSave();

  // ------------------------------------------------------------------ layout
  const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  function setTouch(on) {
    Input.isTouch = on;
    document.body.classList.toggle('touch', on);
    $('touch').classList.toggle('hidden', !(on && mode === 'play'));
  }
  setTouch(coarse);
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !Input.isTouch) setTouch(true); });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    document.body.classList.toggle('portrait', Input.isTouch && H > W);
    if (!mapMode) Render3D.resize(W, H, dpr);
    sizeStars();
  }
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 150));
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);

  // ------------------------------------------------------------------ screens
  const SCREENS = ['title', 'select', 'help', 'stagecard', 'codec', 'pause', 'gameover', 'clear', 'ending'];
  function show(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    const playing = mode === 'play';
    $('hud').classList.toggle('hidden', !(playing || mode === 'pause'));
    $('touch').classList.toggle('hidden', !(Input.isTouch && playing));
    $('btnPause').classList.toggle('hidden', !playing);
    if (!playing) { $('prompt').classList.add('hidden'); }
    focusIndex = 0;
    updateFocus();
  }
  function setMode(m, screen) { mode = m; show(screen === undefined ? m : screen); }

  let toastT = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // keyboard / gamepad menu navigation
  let focusIndex = 0;
  function menuButtons() {
    const vis = SCREENS.map($).filter((el) => !el.classList.contains('hidden'));
    const top = vis[vis.length - 1];
    if (!top) return [];
    return [...top.querySelectorAll('.btn')].filter((b) => !b.classList.contains('hidden') && !b.disabled);
  }
  function updateFocus() {
    const bs = menuButtons();
    document.querySelectorAll('.btn.focus').forEach((b) => b.classList.remove('focus'));
    if (bs.length && !Input.isTouch) bs[Math.min(focusIndex, bs.length - 1)].classList.add('focus');
  }
  Input.onPress((a) => {
    Sound.init();
    if (a === 'mute') { toggleSound(); return; }
    if (mode === 'play') { if (a === 'pause' || a === 'start') pause(); return; }
    if (mode === 'pause' && a === 'pause') { resume(); return; }
    if (mode === 'codec') { if (a === 'act' || a === 'start' || a === 'fire') codecAdvance(); return; }
    if (mode === 'card') { if (a === 'act' || a === 'start') cardDone(); return; }
    const bs = menuButtons();
    if (!bs.length) return;
    if (a === 'up' || a === 'down') {
      focusIndex = (focusIndex + (a === 'up' ? -1 : 1) + bs.length) % bs.length;
      Sound.sfx.move();
      updateFocus();
    } else if (a === 'act' || a === 'start') {
      if (Input.isTouch) return;
      bs[Math.min(focusIndex, bs.length - 1)].click();
    } else if (a === 'pause' && (mode === 'help' || mode === 'select')) back();
  });
  addEventListener('keydown', (e) => {
    if (e.key === '?' && (mode === 'play' || mode === 'pause' || mode === 'title')) { if (mode === 'play') pause(); openHelp(); }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    Sound.init();
    Sound.sfx.select();
    const a = b.dataset.action;
    ({
      start: () => newGame(0),
      continue: openSelect,
      controls: openHelp,
      sound: toggleSound,
      back,
      resume,
      restart: () => (powActive ? startPow() : startStage(stageIndex, true)),
      quit: toTitle,
      retry: () => { run.continues++; startStage(stageIndex, true); },
      next: nextStage,
    })[a]?.();
  });

  function toggleSound() {
    const on = Sound.toggle();
    $('btnSound').textContent = $('btnSound2').textContent = 'SOUND: ' + (on ? 'ON' : 'OFF');
    if (mode === 'play') toast(on ? 'SOUND ON' : 'SOUND OFF');
  }
  $('btnSound').textContent = $('btnSound2').textContent = 'SOUND: ' + (Sound.enabled ? 'ON' : 'OFF');

  function openHelp() { helpReturn = mode === 'pause' ? 'pause' : 'title'; setMode('help'); }
  function back() {
    if (mode === 'help' && helpReturn === 'pause') { setMode('pause'); return; }
    toTitle();
  }
  function openSelect() {
    const list = $('stageList');
    list.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `${i + 1}. ${L.name}`;
      if (i > save.unlocked) { b.disabled = true; b.textContent = `${i + 1}. ??????`; }
      b.addEventListener('click', () => { Sound.init(); Sound.sfx.select(); newGame(i); });
      list.appendChild(b);
    });
    setMode('select');
  }
  function toTitle() {
    Game.unload();
    setMode('title');
    $('btnContinue').classList.toggle('hidden', save.unlocked <= 0);
    Sound.playMusic('title');
    updateFocus();
  }

  // ------------------------------------------------------------------ flow
  function newGame(i) {
    run = { time: 0, alerts: 0, kills: 0, takedowns: 0, continues: 0, captures: 0, rescued: [] };
    try { if (Input.isTouch && window.TouchZoomGuard) TouchZoomGuard.enterFullscreen('landscape'); } catch (e) { /* ignore */ }
    startStage(i, false);
  }

  const hooks = {
    toast,
    codec: (lines) => { if (mode === 'play') openCodec(lines, () => { setMode('play'); Input.flush(); }); },
    complete: (stats) => setTimeout(() => stageClear(stats), 900),
    gameover: (reason) => { $('goReason').textContent = reason; setMode('gameover'); },
    captured: () => { run.captures++; startPow(); },
  };

  // ------------------------------------------------------------------ capture -> POW camp -> retry the stage
  let powActive = false, bonusAmmo = 0;
  const powTotal = POW_CAMP.map.join('').replace(/[^hyu]/g, '').length;
  function startPow() {
    powActive = true;
    Game.load(POW_CAMP, hooks);
    $('stageNum').textContent = 'CAPTURED';
    $('stageName').textContent = POW_CAMP.name;
    $('stageLoc').textContent = POW_CAMP.loc;
    $('objective').textContent = POW_CAMP.objective;
    $('pauseObj').textContent = POW_CAMP.objective;
    setMode('card', 'stagecard');
    Sound.stopMusic();
    Sound.sfx.gameover();
    cardNext = () => openCodec(POW_CAMP.briefing, beginPlay);
    clearTimeout(cardTimer);
    cardTimer = setTimeout(cardDone, 2600);
  }

  let cardTimer = null, cardNext = null;
  function startStage(i, retry) {
    stageIndex = i;
    powActive = false;
    Game.load(i, hooks);
    if (bonusAmmo) { Game.state.player.ammo = Math.min(30, Game.state.player.ammo + bonusAmmo); bonusAmmo = 0; }
    const L = LEVELS[i];
    $('stageNum').textContent = `STAGE ${i + 1} / ${LEVELS.length}`;
    $('stageName').textContent = L.name;
    $('stageLoc').textContent = L.loc;
    $('objective').textContent = L.objective;
    $('pauseObj').textContent = L.objective;
    setMode('card', 'stagecard');
    Sound.playMusic('title');
    cardNext = () => {
      if (retry || params.has('skipintro')) beginPlay();
      else openCodec(L.briefing, beginPlay);
    };
    clearTimeout(cardTimer);
    cardTimer = setTimeout(cardDone, retry ? 1200 : 2400);
  }
  function cardDone() { if (mode !== 'card') return; clearTimeout(cardTimer); const n = cardNext; cardNext = null; n && n(); }
  $('stagecard').addEventListener('pointerdown', () => { Sound.init(); cardDone(); });

  function beginPlay() {
    setMode('play');
    Input.flush();
    Sound.playMusic(Game.state ? Game.state.def.music : 'sneak');
    if (stageIndex === 0) setTimeout(() => mode === 'play' && toast(Input.isTouch ? 'STICK: MOVE   ACT: TAKEDOWN / HIDE' : 'WASD: MOVE   J: TAKEDOWN / HIDE   K: FIRE'), 500);
  }

  function pause() { if (mode !== 'play') return; Input.reset(); setMode('pause'); }
  function resume() { if (mode !== 'pause') return; setMode('play'); Input.flush(); }

  function rankFor(s, continues) {
    if (continues >= 6) return 'CHICKEN';
    if (s.alerts === 0 && s.kills === 0) return 'PHANTOM';
    if (s.alerts === 0) return 'GHOST';
    if (s.alerts <= 2) return 'FOX';
    if (s.alerts <= 5) return 'JACKAL';
    return 'RHINO';
  }
  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function statRows(s) {
    return [['TIME', fmtTime(s.time)], ['ALERTS', s.alerts], ['TAKEDOWNS', s.takedowns], ['KILLS', s.kills]]
      .map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  }

  function stageClear(stats) {
    if (mode !== 'play') return;
    if (powActive) {
      const fresh = (stats.rescued || []).filter((id) => !run.rescued.includes(id));
      run.rescued.push(...fresh);
      bonusAmmo = stats.rescued.length * 2;
      $('clearStats').innerHTML = [['TIME', fmtTime(stats.time)], ['ALERTS', stats.alerts], ['SURVIVORS OUT', `${stats.rescued.length} / ${stats.prisoners}`], ['BONUS AMMO', '+' + bonusAmmo]]
        .map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
      $('clearRank').textContent = stats.rescued.length >= stats.prisoners ? 'LIBERATOR' : stats.rescued.length ? 'SHEPHERD' : 'LONE WOLF';
      document.querySelector('#clear h2').textContent = 'ESCAPED';
      setMode('clear');
      Sound.playMusic('title');
      return;
    }
    document.querySelector('#clear h2').textContent = 'STAGE CLEAR';
    run.time += stats.time; run.alerts += stats.alerts; run.kills += stats.kills; run.takedowns += stats.takedowns;
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length - 1, stageIndex + 1));
    writeSave(save);
    if (stageIndex >= LEVELS.length - 1) { ending(); return; }
    $('clearStats').innerHTML = statRows(stats);
    $('clearRank').textContent = rankFor(stats, 0);
    setMode('clear');
    Sound.playMusic('title');
  }
  function nextStage() {
    if (powActive) { powActive = false; openCodec(POW_CAMP.escaped, () => startStage(stageIndex, true)); return; }
    startStage(stageIndex + 1, false);
  }

  function ending() {
    Game.unload();
    endT = 0;
    mode = 'codec';
    Sound.playMusic('title');
    openCodec(ENDING, () => {
      $('endStats').innerHTML = statRows(run) + `<tr><td>TIMES CAPTURED</td><td>${run.captures}</td></tr><tr><td>SURVIVORS RESCUED</td><td>${run.rescued.length} / ${powTotal}</td></tr><tr><td>CONTINUES</td><td>${run.continues}</td></tr>`;
      $('endRank').textContent = rankFor(run, run.continues) + (run.rescued.length >= powTotal ? ' \u2605 LIBERATOR' : '');
      setMode('ending');
    });
  }

  // ------------------------------------------------------------------ terminal comms
  const codec = { lines: null, i: 0, shown: 0, done: null, speaker: null, t: 0 };
  const bars = $('freqBars');
  for (let i = 0; i < 10; i++) bars.appendChild(document.createElement('i'));

  function openCodec(lines, done) {
    codec.lines = lines; codec.i = 0; codec.done = done; codec.shown = 0;
    setMode('codec');
    Sound.sfx.codecRing();
    setLine();
  }
  function setLine() {
    const [who] = codec.lines[codec.i];
    codec.speaker = who;
    codec.shown = 0;
    const c = CAST[who];
    $('nameR').textContent = c.name;
    $('codecWho').textContent = c.name + ':';
    const tt = document.querySelector('.term-text');
    tt.classList.toggle('ai', who === 'iris');
    tt.classList.toggle('thr', who === 'threnody');
    $('termChan').textContent = who === 'threnody' ? 'CH ?.?? // UNKNOWN ORIGIN' : 'CH 141.12';
    $('termPage').textContent = `PAGE ${codec.i + 1}/${codec.lines.length}`;
    $('codecText').textContent = '';
  }
  function codecAdvance() {
    const text = codec.lines[codec.i][1];
    if (codec.shown < text.length) { codec.shown = text.length; $('codecText').textContent = text; return; }
    codec.i++;
    if (codec.i >= codec.lines.length) { const d = codec.done; codec.lines = null; d && d(); return; }
    Sound.sfx.move();
    setLine();
  }
  $('codec').addEventListener('pointerdown', (e) => {
    if (e.target.closest('#codecSkip')) return;
    Sound.init();
    codecAdvance();
  });
  $('codecSkip').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!codec.lines) return;
    const d = codec.done; codec.lines = null; d && d();
  });
  function updateCodec(dt) {
    if (mode !== 'codec' || !codec.lines) return;
    codec.t += dt;
    const text = codec.lines[codec.i][1];
    if (codec.shown < text.length) {
      const before = Math.floor(codec.shown);
      codec.shown = Math.min(text.length, codec.shown + dt * 60);
      if (Math.floor(codec.shown) !== before) { $('codecText').textContent = text.slice(0, Math.floor(codec.shown)); Sound.sfx.text(); }
    }
    const talking = codec.shown < text.length;
    if (((codec.t * 12) | 0) !== codec.frame) {
      codec.frame = (codec.t * 12) | 0;
      const who = CAST[codec.speaker].portrait;
      Art.portrait($('portR'), who, talking && (codec.frame % 2 === 0), Math.sin(codec.t * 2.1) > 0.96, codec.t);
      [...bars.children].forEach((b, i) => { b.style.height = (talking ? 3 + Math.abs(Math.sin(codec.t * 9 + i * 0.9)) * 19 : 3) + 'px'; });
    }
  }

  // ------------------------------------------------------------------ HUD
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function updateHud() {
    const S = Game.state;
    if (!S) return;
    const P = S.player;
    const pct = Math.max(0, P.hp / P.maxHp * 100);
    if (hudCache.hp !== pct) { hudCache.hp = pct; $('lifeFill').style.width = pct + '%'; $('lifeFill').classList.toggle('low', pct <= 30); }
    setText('ammo', String(P.ammo).padStart(2, '0'));
    $('card').classList.toggle('hidden', !S.hasCard);
    let obj = S.def.objective;
    if (S.def.requires === 'cores') obj = S.cores < S.coresTotal ? `CORES ARMED ${S.cores}/${S.coresTotal}` : 'REACH AN ESCAPE POD!';
    else if (S.def.requires === 'intel' && S.intel) obj = 'INTEL ACQUIRED. REACH THE SHUTTLE LIFT.';
    else if (S.def.isPow) {
      const freed = S.pows.filter((w) => w.state === 'follow').length;
      obj = S.player.caged ? 'PICK YOUR CELL LOCK (ACT).' : (S.player.ammo === 0 ? 'RECOVER YOUR GEAR (GUARD ROOM, NORTH-EAST).' : 'ESCAPE THROUGH THE GATE (SOUTH-EAST).') + ` FREED ${freed}/${S.pows.length}`;
    }
    setText('objective', obj);
    const ph = $('phase');
    let name = '', time = '', cls = '';
    if (S.escape != null) { name = 'DETONATION'; time = S.escape.toFixed(2); cls = 'escape'; }
    else if (S.phase === 'alert') { name = 'ALERT'; time = S.alertTimer.toFixed(2); cls = 'alert'; }
    else if (S.phase === 'evasion') { name = 'EVASION'; time = S.evadeTimer.toFixed(2); cls = 'evasion'; }
    ph.classList.toggle('hidden', !name);
    if (name) { setText('phaseName', name); setText('phaseTime', time.padStart(5, '0')); if (hudCache.cls !== cls) { hudCache.cls = cls; ph.className = cls; } }
    const pr = S.prompt;
    if (hudCache.prompt !== pr) {
      hudCache.prompt = pr;
      $('prompt').classList.toggle('hidden', !pr || Input.isTouch);
      $('prompt').textContent = pr ? (Input.isTouch ? pr : 'ACT: ' + pr) : '';
      const act = $('hintAct');
      act.textContent = pr ? pr.split(' ').slice(0, 2).join('\n').replace(' IN', '') : 'ACT';
      act.classList.toggle('ctx', !!pr);
    }
  }

  // ------------------------------------------------------------------ title attract: starfield + alien mothership over Earth
  const starCanvases = [$('stars'), $('stars2')];
  let stars = [];
  function sizeStars() {
    const k = Math.max(2, Math.round(Math.min(innerWidth, innerHeight) / 200));
    for (const c of starCanvases) { c.width = Math.ceil(innerWidth / k); c.height = Math.ceil(innerHeight / k); }
    const c = starCanvases[0];
    stars = [];
    for (let i = 0; i < 140; i++) stars.push({ x: Math.random() * c.width, y: Math.random() * c.height, z: Math.random() });
  }
  function drawAttract(c, t, boom) {
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.fillStyle = '#03040a'; g.fillRect(0, 0, W, H);
    for (const s of stars) {
      const x = (s.x - t * (4 + s.z * 12)) % W, xx = x < 0 ? x + W : x;
      g.fillStyle = s.z > 0.8 ? '#ffffff' : s.z > 0.4 ? '#8a94a8' : '#3c4454';
      g.fillRect(xx | 0, s.y | 0, 1, 1);
    }
    // Earth limb
    const R = W * 1.2, ex = W * 0.5, ey = H + R * 0.82;
    g.fillStyle = '#0b2a4a'; g.beginPath(); g.arc(ex, ey, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a5a8a'; g.beginPath(); g.arc(ex, ey + 3, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b2a4a'; g.beginPath(); g.arc(ex, ey + 6, R, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i - 4) * 0.08 + t * 0.004; g.fillStyle = '#2d6b3a'; g.fillRect(ex + Math.cos(a) * (R - 8) | 0, ey + Math.sin(a) * (R - 8) | 0, 14, 3); }
    // mothership: a long dark hull with violet lights
    const mx = W * 0.5 + Math.sin(t * 0.1) * W * 0.05, my = H * 0.28;
    const hw = Math.min(W * 0.42, 190);
    if (!boom) {
      g.fillStyle = '#16121e';
      g.beginPath(); g.moveTo(mx - hw, my); g.lineTo(mx - hw * 0.6, my - 10); g.lineTo(mx + hw * 0.7, my - 12); g.lineTo(mx + hw, my - 2); g.lineTo(mx + hw * 0.6, my + 9); g.lineTo(mx - hw * 0.7, my + 7); g.closePath(); g.fill();
      g.fillStyle = '#2a2238'; g.fillRect(mx - hw * 0.5 | 0, my - 10, hw | 0, 3);
      for (let i = 0; i < 18; i++) { const lx = mx - hw * 0.8 + i * hw * 0.09; g.fillStyle = (i + (t * 3 | 0)) % 5 === 0 ? '#e59bff' : '#6a3a8a'; g.fillRect(lx | 0, my + 2, 2, 1); }
      // the Lullaby emitter beam, pulsing toward Earth
      const a = 0.12 + 0.1 * Math.sin(t * 2);
      g.fillStyle = `rgba(211,91,255,${a})`;
      g.beginPath(); g.moveTo(mx - 3, my + 8); g.lineTo(mx + 3, my + 8); g.lineTo(mx + 40, H); g.lineTo(mx - 40, H); g.closePath(); g.fill();
    } else {
      const k = Math.min(1, boom);
      g.fillStyle = `rgba(255,230,200,${1 - k})`; g.beginPath(); g.arc(mx, my, 20 + k * 120, 0, Math.PI * 2); g.fill();
    }
  }

  // ------------------------------------------------------------------ main loop
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.max(0, Math.min(dt, 0.1));
    Input.pollPad();
    if (mode === 'play') {
      acc += dt;
      while (acc >= STEP) { Game.update(STEP); acc -= STEP; }
    } else acc = 0;
    updateCodec(dt);

    if (Game.state && (mode === 'play' || mode === 'pause' || mode === 'gameover' || mode === 'clear')) {
      Render3D.render(Game.state, dt);
      if (mode === 'play' || mode === 'pause') { Game.renderRadar(radar); updateHud(); }
    } else if (mode === 'play' || mode === 'card') Render3D.render(null, dt);
    if (mode === 'play' && Input.isTouch) Input.drawTouch($('touchfx'));
    const t = now / 1000;
    if (mode === 'title' || mode === 'select' || (mode === 'help' && helpReturn === 'title')) drawAttract(starCanvases[0], t, 0);
    if (mode === 'ending') { endT += dt; drawAttract(starCanvases[1], t, endT * 0.6); }
    requestAnimationFrame(frame);
  }
  let endT = 0;

  // ------------------------------------------------------------------ auto-pause
  addEventListener('blur', () => pause());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // ------------------------------------------------------------------ boot
  Input.setupTouch();
  if (window.TouchZoomGuard) TouchZoomGuard.init({ allowSelector: '[data-touch-allow]', onZoomChange: (z) => { if (z) pause(); } });
  resize();
  $('btnContinue').classList.toggle('hidden', save.unlocked <= 0);

  // debug / tooling hooks (used by tools/smoke.mjs)
  window.GAME = {
    start(i = 0) {
      Sound.init(); run = { time: 0, alerts: 0, kills: 0, takedowns: 0, continues: 0, captures: 0, rescued: [] };
      if (i === 'pow') { powActive = true; Game.load(POW_CAMP, hooks); } else { powActive = false; stageIndex = i; Game.load(i, hooks); }
      $('objective').textContent = Game.state.def.objective; beginPlay();
    },
    ff(sec) { for (let i = 0; i < sec * 60; i++) Game.update(STEP); },
    get mode() { return mode; },
    get state() { return Game.state; },
    Game,
  };

  if (params.has('map')) {
    // full-level preview: ?map=0..4
    const i = params.get('map') === 'pow' ? POW_CAMP : Math.min(LEVELS.length - 1, Number(params.get('map')) || 0);
    Game.load(i, hooks);
    const S = Game.state;
    const mc = document.createElement('canvas');
    mc.id = 'mapview';
    mc.width = S.w * 16; mc.height = S.h * 16;
    mc.style.cssText = `position:absolute;left:0;top:0;z-index:50;image-rendering:pixelated;width:${mc.width * 2}px;height:${mc.height * 2}px`;
    canvas.replaceWith(mc);
    SCREENS.forEach((s) => $(s).classList.add('hidden'));
    $('scan').classList.add('hidden');
    Game.renderMap(mc.getContext('2d'));
    document.body.style.overflow = 'auto';
    return;
  }

  setMode('title');
  if (params.has('stage')) newGame(Math.min(LEVELS.length - 1, Number(params.get('stage')) || 0));
  requestAnimationFrame((t) => { last = t; frame(t); });

  // offline play once loaded (skip on localhost so dev/test builds never go stale)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ } });
  }
})();
