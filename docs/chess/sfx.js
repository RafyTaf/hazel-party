'use strict';
export const SFX = (() => {
  let ctx = null, master, sfxG, muted = localStorage.getItem('hc_mute') === '1';
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfxG = ctx.createGain(); sfxG.gain.value = 0.55; sfxG.connect(master);
  }
  function tone(f, d, type = 'square', vol = 0.3, slide = 0, delay = 0) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(sfxG); o.start(t); o.stop(t + d + 0.05);
  }
  function noise(d, vol = 0.3, fc = 1200, delay = 0, q = 1) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * d), ctx.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = b; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fc; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(sfxG); s.start(t);
  }
  const S = {
    tap() { tone(880, 0.06, 'triangle', 0.25, 300); },
    pop() { tone(500, 0.1, 'sine', 0.35, 700); },
    bad() { tone(300, 0.25, 'sawtooth', 0.2, -180); },
    ding() { tone(1568, 0.4, 'triangle', 0.3); tone(2093, 0.5, 'sine', 0.2, 0, 0.1); },
    move() { tone(240, 0.06, 'sine', 0.5, -100); noise(0.05, 0.3, 2500, 0, 2); },
    capture() { tone(180, 0.15, 'square', 0.25, -90); noise(0.12, 0.4, 1500, 0, 1); },
    check() { tone(880, 0.12, 'square', 0.2); tone(880, 0.12, 'square', 0.2, 0, 0.16); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.2, 0, i * 0.11)); tone(1319, 0.6, 'triangle', 0.25, 0, 0.66); },
    lose() { [392, 370, 349, 330].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, -10, i * 0.25)); },
    join() { tone(523, 0.1, 'triangle', 0.3); tone(784, 0.2, 'triangle', 0.3, 0, 0.1); },
    castle() { tone(240, 0.08, 'sine', 0.4, -60); tone(360, 0.1, 'sine', 0.35, -40, 0.06); },
  };
  return {
    init, play(n) { if (S[n] && ctx) S[n](); },
    toggleMute() { muted = !muted; localStorage.setItem('hc_mute', muted ? '1' : '0'); if (master) master.gain.value = muted ? 0 : 1; return muted; },
    get muted() { return muted; },
  };
})();
export const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { } };
