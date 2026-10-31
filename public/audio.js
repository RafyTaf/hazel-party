// Synthesized sound effects + background music (WebAudio, no files needed)
const SFX = (() => {
  let ctx = null, master, sfxG, musG, muted = localStorage.getItem('hp_mute') === '1', musicOn = false, musTimer = null, step = 0, nextT = 0, song = 'menu';
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfxG = ctx.createGain(); sfxG.gain.value = 0.55; sfxG.connect(master);
    musG = ctx.createGain(); musG.gain.value = 0.16; musG.connect(master);
  }
  function tone(f, d, type = 'square', vol = 0.3, slide = 0, delay = 0, dest) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(dest || sfxG); o.start(t); o.stop(t + d + 0.05);
  }
  function noise(d, vol = 0.3, fc = 1200, delay = 0, q = 1, dest) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * d), ctx.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fc; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(dest || sfxG); s.start(t);
  }
  const S = {
    tap() { tone(880, 0.06, 'triangle', 0.25, 300); },
    pop() { tone(500, 0.1, 'sine', 0.35, 700); },
    catch() { tone(660, 0.08, 'square', 0.2); tone(990, 0.12, 'square', 0.2, 0, 0.07); tone(1320, 0.15, 'triangle', 0.25, 0, 0.14); },
    coin() { tone(988, 0.07, 'square', 0.18); tone(1319, 0.22, 'square', 0.18, 0, 0.07); },
    bad() { tone(300, 0.25, 'sawtooth', 0.2, -180); tone(200, 0.3, 'square', 0.12, -100, 0.08); },
    miss() { tone(220, 0.08, 'triangle', 0.15, -60); },
    bark() { // two-part woof
      for (const dl of [0, 0.18]) { tone(420, 0.12, 'sawtooth', 0.25, -240, dl); noise(0.1, 0.25, 900, dl, 2); }
    },
    whoosh() { noise(0.35, 0.25, 1800, 0, 0.7); },
    bump() { tone(140, 0.18, 'sine', 0.6, -80); noise(0.12, 0.35, 400); },
    boing() { tone(200, 0.3, 'sine', 0.4, 500); },
    crash() { noise(0.4, 0.5, 300, 0, 0.5); tone(120, 0.3, 'square', 0.25, -70); },
    jump() { tone(300, 0.18, 'square', 0.18, 500); },
    munch() { for (let i = 0; i < 3; i++) noise(0.05, 0.35, 700 + i * 200, i * 0.07, 3); },
    step() { tone(1200, 0.03, 'square', 0.06); },
    tick() { tone(1500, 0.04, 'square', 0.1); },
    cd(n) { if (n > 0) tone(523, 0.25, 'square', 0.25); else { tone(1047, 0.5, 'square', 0.25); tone(784, 0.5, 'triangle', 0.2); } },
    roll() { tone(600 + Math.random() * 400, 0.04, 'square', 0.1); },
    ding() { tone(1568, 0.4, 'triangle', 0.3); tone(2093, 0.5, 'sine', 0.2, 0, 0.1); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.2, 0, i * 0.11)); tone(1319, 0.6, 'triangle', 0.25, 0, 0.66); },
    lose() { [392, 370, 349, 330].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, -10, i * 0.25)); },
    fanfare() { const n = [523, 523, 523, 659, 784, 659, 784, 1047]; n.forEach((f, i) => { tone(f, 0.2, 'square', 0.2, 0, i * 0.14); tone(f / 2, 0.2, 'triangle', 0.2, 0, i * 0.14); }); noise(1.2, 0.15, 6000, 0.4, 0.5); },
    move() { tone(240, 0.06, 'sine', 0.5, -100); noise(0.05, 0.3, 2500, 0, 2); },
    capture() { tone(180, 0.15, 'square', 0.25, -90); noise(0.12, 0.4, 1500, 0, 1); },
    check() { tone(880, 0.12, 'square', 0.2); tone(880, 0.12, 'square', 0.2, 0, 0.16); },
    snowhit() { tone(160, 0.2, 'sine', 0.6, -90); noise(0.25, 0.45, 600, 0, 0.6); noise(0.15, 0.25, 3000, 0.02, 1); },
    snowdash() { noise(0.3, 0.35, 2400, 0, 0.6); tone(260, 0.2, 'triangle', 0.2, 400); },
    fall() { tone(1200, 1.0, 'sine', 0.3, -1050); noise(0.5, 0.45, 250, 0.95, 0.5); tone(90, 0.4, 'square', 0.2, -50, 0.95); },
    crunch() { noise(0.06, 0.12, 1800 + Math.random() * 1500, 0, 2); },
    join() { tone(523, 0.1, 'triangle', 0.3); tone(784, 0.2, 'triangle', 0.3, 0, 0.1); },
  };
  // --- music: tiny step sequencer, two songs ---
  const SONGS = {
    menu: { bpm: 128, bass: [48, 0, 55, 0, 53, 0, 55, 0, 45, 0, 52, 0, 50, 0, 52, 55], mel: [72, 76, 79, 76, 77, 0, 76, 74, 72, 0, 69, 72, 74, 0, 71, 0, 72, 76, 79, 84, 81, 0, 79, 77, 76, 0, 74, 72, 74, 0, 0, 0], chord: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]] },
    game: { bpm: 150, bass: [45, 45, 57, 45, 43, 43, 55, 43, 41, 41, 53, 41, 43, 43, 55, 47], mel: [69, 0, 72, 69, 76, 0, 74, 72, 71, 0, 67, 0, 71, 72, 74, 0, 72, 0, 69, 72, 77, 0, 76, 74, 76, 0, 79, 0, 76, 74, 71, 0], chord: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [55, 59, 62]] },
  };
  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  function sched() {
    if (!ctx) return; const sg = SONGS[song], sp = 60 / sg.bpm / 2;
    while (nextT < ctx.currentTime + 0.2) {
      const dl = nextT - ctx.currentTime, b = sg.bass[step % 16], m = sg.mel[step % 32];
      if (b) tone(mf(b - 12), sp * 0.9, 'triangle', 0.5, 0, dl, musG);
      if (m) tone(mf(m), sp * 0.8, 'square', 0.16, 0, dl, musG);
      if (step % 8 === 0) sg.chord[(step / 8 | 0) % 4].forEach(c => tone(mf(c), sp * 3.5, 'sine', 0.1, 0, dl, musG));
      if (step % 4 === 0) tone(110, 0.08, 'sine', 0.6, -60, dl, musG);
      if (step % 4 === 2) noise(0.05, 0.25, 7000, dl, 1, musG);
      nextT += sp; step++;
    }
  }
  return {
    init, play(n, a) { if (S[n] && ctx) S[n](a); },
    music(name) { init(); if (name) { if (name !== song) step = 0; song = name; } if (!musicOn) { musicOn = true; nextT = ctx.currentTime + 0.1; musTimer = setInterval(sched, 60); } },
    stopMusic() { musicOn = false; clearInterval(musTimer); },
    toggleMute() { muted = !muted; localStorage.setItem('hp_mute', muted ? '1' : '0'); if (master) master.gain.value = muted ? 0 : 1; return muted; },
    get muted() { return muted; },
  };
})();
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { } };
