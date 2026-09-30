'use strict';
// Tiny WebAudio chip-sound engine: synthesized SFX + a step sequencer for music.
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let enabled = true;
  try { enabled = localStorage.getItem('cosmic-calamity.sound') !== 'off'; } catch (e) { /* ignore */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.55 : 0;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (pendingSong) playMusic(pendingSong);
  }

  function setEnabled(on) {
    enabled = on;
    try { localStorage.setItem('cosmic-calamity.sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.02);
  }

  function tone(f, dur, o = {}) {
    if (!ctx) return;
    const t = (o.at || ctx.currentTime) + (o.delay || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    const vol = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.03);
  }

  function noise(dur, o = {}) {
    if (!ctx) return;
    const t = (o.at || ctx.currentTime) + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    const vol = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  const last = {};
  function throttle(name, ms) {
    const now = performance.now();
    if (last[name] && now - last[name] < ms) return false;
    last[name] = now; return true;
  }

  const sfx = {
    shoot() { noise(0.09, { vol: 0.35, freq: 2600, filter: 'bandpass', q: 0.8 }); tone(1100, 0.07, { vol: 0.06, slide: 180 }); },
    click() { tone(1800, 0.02, { vol: 0.08 }); },
    eshoot() { tone(820, 0.2, { type: 'sawtooth', vol: 0.09, slide: 160 }); tone(1640, 0.12, { type: 'square', vol: 0.03, slide: 400 }); },
    hit() { noise(0.12, { vol: 0.35, freq: 900 }); tone(180, 0.08, { type: 'triangle', vol: 0.15, slide: 70 }); },
    spark() { noise(0.05, { vol: 0.12, freq: 5000, filter: 'highpass' }); },
    hurt() { tone(240, 0.22, { vol: 0.18, slide: 70 }); noise(0.18, { vol: 0.25, freq: 700 }); },
    alert() {
      if (!throttle('alert', 400)) return;
      tone(988, 0.1, { vol: 0.2 });
      tone(1480, 0.45, { vol: 0.2, delay: 0.1 });
      tone(2960, 0.3, { vol: 0.05, delay: 0.1, type: 'triangle' });
    },
    question() {
      if (!throttle('q', 250)) return;
      tone(620, 0.09, { vol: 0.1, type: 'triangle' }); tone(830, 0.16, { vol: 0.1, type: 'triangle', delay: 0.09 });
    },
    takedown() { noise(0.16, { vol: 0.45, freq: 500 }); tone(150, 0.2, { type: 'triangle', vol: 0.35, slide: 50 }); },
    punch() { noise(0.07, { vol: 0.35, freq: 1400 }); tone(220, 0.07, { type: 'triangle', vol: 0.2, slide: 110 }); },
    whiff() { noise(0.08, { vol: 0.12, freq: 3000, filter: 'highpass', slide: 800 }); },
    pickup() { tone(880, 0.07, { vol: 0.12 }); tone(1320, 0.12, { vol: 0.12, delay: 0.07 }); },
    card() { [880, 1175, 1568, 2093].forEach((f, i) => tone(f, 0.1, { vol: 0.1, delay: i * 0.07 })); },
    door() { noise(0.4, { vol: 0.2, freq: 400, slide: 1800 }); tone(260, 0.35, { type: 'sawtooth', vol: 0.05, slide: 520 }); },
    locked() { tone(160, 0.12, { vol: 0.12 }); tone(120, 0.18, { vol: 0.12, delay: 0.13 }); },
    knock() { noise(0.05, { vol: 0.5, freq: 650 }); noise(0.05, { vol: 0.5, freq: 650, delay: 0.17 }); },
    hide() { noise(0.18, { vol: 0.25, freq: 900 }); tone(170, 0.12, { type: 'triangle', vol: 0.18 }); },
    explode() { noise(1.0, { vol: 0.6, freq: 1200, slide: 60 }); tone(110, 0.7, { type: 'sawtooth', vol: 0.2, slide: 28 }); },
    smallboom() { noise(0.4, { vol: 0.4, freq: 1500, slide: 150 }); tone(160, 0.25, { type: 'square', vol: 0.1, slide: 40 }); },
    goo() { tone(300, 0.3, { type: 'sine', vol: 0.15, slide: 60 }); noise(0.2, { vol: 0.08, freq: 400 }); },
    beep() { if (throttle('beep', 300)) tone(1600, 0.05, { vol: 0.05 }); },
    plant() { [440, 440, 660].forEach((f, i) => tone(f, 0.08, { vol: 0.12, delay: i * 0.12 })); },
    download() { for (let i = 0; i < 8; i++) tone(600 + i * 150, 0.05, { vol: 0.07, delay: i * 0.06 }); },
    codecRing() { for (let i = 0; i < 3; i++) { tone(1320, 0.07, { vol: 0.09, delay: i * 0.2 }); tone(1760, 0.07, { vol: 0.09, delay: i * 0.2 + 0.08 }); } },
    text() { if (throttle('txt', 45)) tone(1900 + Math.random() * 200, 0.015, { vol: 0.025 }); },
    select() { tone(660, 0.05, { vol: 0.1 }); tone(990, 0.08, { vol: 0.1, delay: 0.05 }); },
    move() { tone(520, 0.03, { vol: 0.06 }); },
    gameover() { [392, 370, 349, 330, 262].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.2, delay: i * 0.28 })); },
    clear() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.5 : 0.14, { vol: 0.12, delay: i * 0.13 })); },
    tick() { tone(2400, 0.02, { vol: 0.05 }); },
  };

  // ---------------- music ----------------
  const _ = null;
  const SONGS = {
    sneak: {
      bpm: 100,
      bass: [45,_,_,45,_,_,52,_, 45,_,_,45,_,_,50,_, 43,_,_,43,_,_,50,_, 43,_,_,43,_,_,48,_,
             41,_,_,41,_,_,48,_, 41,_,_,41,_,_,47,_, 40,_,_,40,_,_,47,_, 40,_,44,_,47,_,52,_],
      lead: [_,_,_,_,69,_,_,_, _,_,72,_,_,_,71,_, _,_,_,_,67,_,_,_, _,_,71,_,_,_,69,_,
             _,_,_,_,65,_,_,_, _,_,69,_,_,_,72,_, _,_,_,_,76,_,_,75,_, _,_,_,_,_,_,_,_],
      hat:  'x.x.x.xxx.x.x.x.',
      kick: 'k.......k.....k.',
      leadType: 'triangle', leadVol: 0.07, bassVol: 0.13,
    },
    alert: {
      bpm: 152,
      bass: [45,45,57,45,45,57,46,58, 45,45,57,45,48,60,47,59, 45,45,57,45,45,57,46,58, 50,50,62,50,49,61,48,60],
      lead: [81,_,80,_,81,_,_,_, 84,_,83,_,81,_,_,_, 81,_,80,_,81,_,_,_, 86,_,85,_,84,_,83,_],
      hat:  'xxxxxxxxxxxxxxxx',
      kick: 'k...k...k...k.k.',
      snare:'....s.......s...',
      leadType: 'square', leadVol: 0.05, bassVol: 0.14,
    },
    ship: {
      bpm: 88,
      bass: [38,_,_,_,38,_,45,_, 37,_,_,_,37,_,44,_, 36,_,_,_,36,_,43,_, 37,_,_,_,37,_,41,44],
      lead: [74,_,_,_,_,_,73,_, _,_,_,_,69,_,_,_, 72,_,_,_,_,_,71,_, _,_,_,_,68,_,_,_],
      hat:  '..x...x...x...xx',
      kick: 'k.........k.....',
      leadType: 'sine', leadVol: 0.08, bassVol: 0.14,
    },
    title: {
      bpm: 76,
      bass: [33,_,_,_,_,_,_,_, 40,_,_,_,_,_,_,_, 36,_,_,_,_,_,_,_, 31,_,_,_,38,_,_,_],
      lead: [69,_,_,72,_,_,76,_, 74,_,_,_,72,_,71,_, 72,_,_,76,_,_,79,_, 77,_,_,_,76,_,74,_],
      hat:  '................',
      kick: 'k...............',
      leadType: 'triangle', leadVol: 0.06, bassVol: 0.12,
    },
    escape: {
      bpm: 170,
      bass: [40,52,40,52,40,52,41,53, 40,52,40,52,43,55,42,54],
      lead: [76,_,76,_,77,_,76,_, 79,_,78,_,77,_,76,_],
      hat:  'xxxxxxxxxxxxxxxx',
      kick: 'k.k.k.k.k.k.k.k.',
      snare:'....s.......s..s',
      leadType: 'square', leadVol: 0.05, bassVol: 0.14,
    },
  };
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  let song = null, songName = null, pendingSong = null, step = 0, nextTime = 0, timer = null;

  function scheduleStep(s, i, t) {
    const len = 60 / s.bpm / 4;
    const b = s.bass[i % s.bass.length];
    if (b != null) tone(midi(b), len * 1.8, { type: 'triangle', vol: s.bassVol, at: t, dest: musicBus });
    const l = s.lead[i % s.lead.length];
    if (l != null) tone(midi(l), len * 2.2, { type: s.leadType, vol: s.leadVol, at: t, dest: musicBus, attack: 0.01 });
    const hi = i % 16;
    if (s.hat[hi] === 'x') noise(0.03, { vol: 0.05, freq: 8000, filter: 'highpass', at: t, dest: musicBus });
    if (s.kick[hi] === 'k') { tone(110, 0.12, { type: 'sine', vol: 0.3, slide: 40, at: t, dest: musicBus }); }
    if (s.snare && s.snare[hi] === 's') noise(0.1, { vol: 0.12, freq: 2500, filter: 'bandpass', at: t, dest: musicBus });
  }

  function pump() {
    if (!ctx || !song) return;
    while (nextTime < ctx.currentTime + 0.15) {
      scheduleStep(song, step, nextTime);
      step++;
      nextTime += 60 / song.bpm / 4;
    }
  }

  function playMusic(name) {
    if (name === songName && song) return;
    pendingSong = name;
    if (!ctx) return;
    songName = name;
    song = name ? SONGS[name] : null;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    if (!timer) timer = setInterval(pump, 30);
  }
  function stopMusic() { song = null; songName = null; pendingSong = null; }

  return {
    init, sfx, playMusic, stopMusic, setEnabled,
    get enabled() { return enabled; },
    toggle() { setEnabled(!enabled); return enabled; },
  };
})();
