'use strict';
const $ = (s) => document.querySelector(s);
const IMG = {};
['ralph', 'jordan', 'hazel', 'bone', 'broccoli', 'ball', 'cookie', 'pizza', 'couch', 'bowl', 'heart'].forEach(n => { IMG[n] = new Image(); IMG[n].src = `art/${n}.png`; });
['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'].forEach(n => { IMG['pc_' + n] = new Image(); IMG['pc_' + n].src = `art/chess/${n}.svg`; });
['bg_yard', 'bg_kitchen', 'bg_apartment'].forEach(n => { IMG[n] = new Image(); IMG[n].src = `art/${n}.jpg`; });
const NAMES = { ralph: 'Ralph', jordan: 'Jordan' };
const COLORS = ['#ff3d7f', '#1f9bff'];
const INFO = {
  dash: { ic: '🐕💨', name: 'Hazel Dash', bg: 'bg_yard', tips: ['Hazel is doing zoomies in the yard!', 'TAP Hazel to catch her — first tap wins.', 'She gets faster every catch.', 'Most catches in 45 seconds wins.'] },
  treat: { ic: '🦴', name: 'Treat Toss', bg: 'bg_yard', tips: ['Treats rain down from the sky!', 'DRAG left/right to move your character.', '🦴 Bone +1 · 🍪 Cookie +3 · 🥦 Broccoli −2', 'Highest score in 40 seconds wins.'] },
  fetch: { ic: '🎾', name: "Who's the Favorite?", bg: 'bg_yard', tips: ['Hazel is waiting for a toy…', 'Your target ring bounces around — TAP to throw when it is right next to Hazel.', 'She fetches whichever toy lands closest.', 'First to 5 fetches wins!'] },
  snack: { ic: '🍕', name: 'Snack Snatch', bg: 'bg_kitchen', tips: ['Snacks keep appearing on the kitchen floor.', 'DRAG anywhere like a joystick to run.', 'Grab snacks before Hazel gobbles them!', 'Ram into each other to BUMP them away. Most snacks in 45s wins.'] },
  zoomies: { ic: '🏁', name: 'Zoomies Race', bg: 'bg_apartment', tips: ['Ride Hazel across the apartment!', 'Mash RUN as fast as you can.', 'Hit JUMP to hop over couches and bowls — crashing stuns you.', 'First to the finish wins!'] },
  snow: { ic: '☃️', name: 'Snowball Summit', bg: null, tips: ['Top of a snowy mountain — roll your snowball!', 'DRAG anywhere like a joystick. Your snowball GROWS as it rolls.', 'Bigger = heavier. Tap 💨 SHOVE to charge into them!', 'Knock them off the cliff! First to 2 knockouts wins.'] },
  chess: { ic: '♟️', name: 'Hazel Chess', bg: null, tips: ['Classic chess, one board, two phones.', 'Tap a piece, then tap where it goes.', '5 minutes on each clock. Pawns auto-promote to queens.', 'Checkmate wins the point · Draw = no point.'] },
};
let token = localStorage.getItem('hp_token'); if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('hp_token', token); }
let myChar = localStorage.getItem('hp_char') || 'ralph';
let me = -1, room = null, gs = null, gsAt = 0, lastPhase = null, curScreen = null;
// sock is a thin proxy so the same handlers work for the online server or the offline bot room
const SH = {}; let back = null, offline = false, online = false;
const sock = { on(e, f) { (SH[e] = SH[e] || []).push(f); if (back) back.on(e, f); }, emit(...a) { if (back) back.emit(...a); } };
function useBack(b) { back = b; for (const e in SH) SH[e].forEach(f => b.on(e, f)); }
function setOnline(ok, msg) {
  online = ok; document.body.classList.toggle('noserver', !ok);
  $('#t-srv').innerHTML = ok ? '' : (msg || '🌐 Online play needs the game server — tap <b>Play vs Hazel Bot</b> to play solo!');
}
if (window.io) {
  try {
    const s = io({ transports: ['websocket', 'polling'], reconnectionAttempts: Infinity });
    useBack(s); setOnline(true);
    s.on('connect', () => { if (!offline) setOnline(true); });
    s.on('connect_error', () => { if (!offline && !s.connected) setOnline(false, '📡 Can’t reach the game server right now — <b>Play vs Hazel Bot</b> works offline!'); });
  } catch (e) { setOnline(false); }
} else setOnline(false);
function startBot() {
  if (!window.HazelOffline) return err('Bot mode failed to load');
  if (back && back.off) { back.off(); back.disconnect(); }
  offline = true; banner(null); back = null; useBack(HazelOffline.createSocket());
  sock.emit('create', { char: myChar, token });
}

// ---------- screens ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  curScreen = id;
}
function selChar(c) { myChar = c; localStorage.setItem('hp_char', c); document.querySelectorAll('.pick').forEach(b => b.classList.toggle('sel', b.dataset.c === c)); }
selChar(myChar);
document.querySelectorAll('.pick').forEach(b => b.onclick = () => { SFX.init(); SFX.play('pop'); selChar(b.dataset.c); });
const urlCode = new URLSearchParams(location.search).get('r');
if (urlCode) $('#i-code').value = urlCode.toUpperCase();
$('#b-create').onclick = () => { SFX.init(); SFX.play('tap'); if (!online) return err('Online play needs the server'); sock.emit('create', { char: myChar, token }); };
$('#b-join').onclick = () => { SFX.init(); SFX.play('tap'); const c = $('#i-code').value.trim().toUpperCase(); if (!online) return err('Online play needs the server'); if (c.length < 4) return err('Enter the 4-letter code'); sock.emit('join', { code: c, token }); };
$('#b-bot').onclick = () => { SFX.init(); SFX.play('tap'); startBot(); };
$('#i-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#b-join').click(); });
function err(m) { $('#t-err').textContent = m; SFX.play('bad'); }
$('#b-share').onclick = async () => {
  SFX.play('tap'); const url = `${location.origin}${location.pathname}?r=${room.code}`;
  try { if (navigator.share) await navigator.share({ title: 'Hazel Party 🐾', text: `Join my Hazel Party! Code ${room.code}`, url }); else { await navigator.clipboard.writeText(url); toastDom('Link copied!'); } } catch (e) { }
};
$('#seg-target').onclick = e => { const v = +e.target.dataset.v; if (v) { SFX.play('tap'); sock.emit('settings', { target: v }); } };
$('#c-chess').onchange = e => { SFX.play('tap'); sock.emit('settings', { chess: e.target.checked }); };
$('#b-swap').onclick = () => { SFX.play('boing'); sock.emit('settings', { swap: true }); };
$('#b-start').onclick = () => { SFX.play('tap'); sock.emit('start'); };
$('#b-ready').onclick = () => { SFX.play('pop'); buzz(20); sock.emit('ready'); };
$('#b-skip').onclick = () => { SFX.play('whoosh'); sock.emit('skip'); };
$('#b-rematch').onclick = () => { SFX.play('pop'); sock.emit('rematch'); };
$('#b-mute').onclick = () => { SFX.init(); const m = SFX.toggleMute(); $('#b-mute').textContent = m ? '🔇' : '🔊'; };
$('#b-mute').textContent = SFX.muted ? '🔇' : '🔊';
document.addEventListener('pointerdown', () => { SFX.init(); if (!SFX._started) { SFX._started = 1; SFX.music('menu'); } }, { capture: true });
document.addEventListener('touchmove', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

// ---------- socket ----------
sock.on('connect', () => {
  const saved = JSON.parse(sessionStorage.getItem('hp_room') || 'null') || JSON.parse(localStorage.getItem('hp_room') || 'null');
  if (saved && Date.now() - saved.t < 3 * 3600e3) sock.emit('join', { code: saved.code, token });
  banner(null);
});
sock.on('disconnect', () => { if (!offline) banner('📡 Reconnecting…'); });
sock.on('err', (m) => { err(m); localStorage.removeItem('hp_room'); });
sock.on('you', (y) => { me = y.i; document.body.classList.toggle('botmode', !!y.bot); if (y.bot) return; localStorage.setItem('hp_room', JSON.stringify({ code: y.code, t: Date.now() })); history.replaceState(null, '', `${location.pathname}?r=${y.code}`); });
sock.on('room', onRoom);
sock.on('gs', (g) => { gs = g; gsAt = performance.now(); updateHud(); });
sock.on('fx', onFx);
if (!sessionStorage.getItem('x')) show('s-title');

function pname(i) { return room && room.players[i] ? room.players[i].name : '?'; }
function pchar(i) { return room && room.players[i] ? room.players[i].char : (i ? 'jordan' : 'ralph'); }

function onRoom(r) {
  const prev = room; room = r; document.body.classList.toggle('guest', me !== 0);
  const ph = r.phase, changed = ph !== lastPhase || (prev && prev.round !== r.round && ph === 'pick'); lastPhase = ph;
  const away = r.players.findIndex(p => p && !p.on);
  banner(away >= 0 && ph !== 'lobby' && ph !== 'final' ? `📵 ${r.players[away].name} lost connection…<br><small>Game paused — waiting for them</small>` : null);
  document.body.classList.toggle('playing', ph === 'play' || ph === 'countdown');
  $('#hud').classList.toggle('on', ph === 'play' || ph === 'countdown');
  if (ph !== 'play') setControls(null);
  if (ph === 'lobby') { show('s-lobby'); renderLobby(prev); if (changed) SFX.music('menu'); }
  else if (ph === 'intro') { if (changed) doIntro(); }
  else if (ph === 'pick') { if (changed) doPick(); }
  else if (ph === 'tutorial') { if (changed) doTut(); renderReady(); }
  else if (ph === 'countdown') { if (changed) doCountdown(); }
  else if (ph === 'play') { if (changed) startPlay(); }
  else if (ph === 'result') { if (changed) doResult(); }
  else if (ph === 'final') { if (changed) doFinal(); $('#t-rematchwait').textContent = r.players.some(p => p.ready) ? (r.players[me].ready ? 'Waiting for the other player…' : `${r.players.find(p => p.ready).name} wants a rematch!`) : ''; }
}
function slotHtml(i) {
  const p = room.players[i];
  if (!p) return `<div class="slot empty">Waiting…<br>📲</div>`;
  return `<div class="slot">${i === me ? '<span class="me">YOU</span>' : ''}${p.on ? '' : '<span class="off">offline</span>'}<img src="art/${p.char}.png">${p.name}</div>`;
}
function renderLobby(prev) {
  $('#t-code').textContent = room.code;
  $('#slot0').outerHTML = `<div id="slot0">${slotHtml(0)}</div>`; $('#slot1').outerHTML = `<div id="slot1">${slotHtml(1)}</div>`;
  document.querySelectorAll('#seg-target button').forEach(b => b.classList.toggle('sel', +b.dataset.v === room.settings.target));
  $('#c-chess').checked = room.settings.chess;
  const ok = !!room.players[1]; $('#b-start').disabled = !ok; $('#b-start').textContent = ok ? "▶ Let's Play!" : 'Waiting for player 2…';
  $('#t-guestwait').innerHTML = `First to <b>${room.settings.target}</b> · Chess ${room.settings.chess ? 'ON' : 'OFF'}<br>Waiting for ${pname(0)} to start…`;
  if (prev && !prev.players[1] && room.players[1]) { SFX.play('join'); buzz([30, 40, 30]); }
}
function doIntro() {
  show('s-intro'); SFX.music('menu');
  $('#ic0').innerHTML = `<img src="art/${pchar(0)}.png">${pname(0)}`; $('#ic1').innerHTML = `<img src="art/${pchar(1)}.png">${pname(1)}`;
  ['#ic0', '#ic1', '.introvs', '.introhazel'].forEach(s => { const e = $(s); e.style.animation = 'none'; e.offsetHeight; e.style.animation = ''; });
  setTimeout(() => SFX.play('whoosh'), 50); setTimeout(() => SFX.play('whoosh'), 550); setTimeout(() => { SFX.play('crash'); shake(); }, 1050); setTimeout(() => SFX.play('bark'), 1750);
}
function doPick() {
  show('s-pick'); $('#t-round').textContent = room.round; $('#t-pickname').textContent = '';
  const keys = Object.keys(INFO), strip = $('#strip'); let html = '';
  const cards = []; for (let i = 0; i < 18; i++) cards.push(keys[i % keys.length]); cards.push(room.game); cards.push(keys[0], keys[1]);
  strip.innerHTML = cards.map(k => `<div class="gcard"><div class="ic">${INFO[k].ic}</div>${INFO[k].name}</div>`).join('');
  const target = (cards.length - 3) * 162 + 75; strip.style.transition = 'none'; strip.style.transform = 'translateX(0)'; strip.offsetHeight;
  strip.style.transition = 'transform 2.6s cubic-bezier(.15,.7,.2,1)'; strip.style.transform = `translateX(${-target}px)`;
  let n = 0; const iv = setInterval(() => { SFX.play('roll'); if (++n > 22) clearInterval(iv); }, 40 + n * 4);
  setTimeout(() => { $('#t-pickname').textContent = INFO[room.game].name + '!'; SFX.play('ding'); buzz(40); }, 2650);
}
function doTut() {
  show('s-tut'); const I = INFO[room.game];
  $('#t-tuticon').textContent = I.ic; $('#t-tutname').textContent = I.name; $('#t-tutlist').innerHTML = I.tips.map(t => `<li>${t}</li>`).join('');
  $('#b-skip').textContent = room.game === 'chess' ? '⏭ Skip chess this time' : '🎲 Skip this game';
}
function renderReady() {
  $('#readyrow').innerHTML = room.players.map((p, i) => `<div class="rp ${p.ready ? 'ok' : ''}"><img src="art/${p.char}.png">${p.name}</div>`).join('');
  const mine = room.players[me] && room.players[me].ready; $('#b-ready').disabled = mine; $('#b-ready').textContent = mine ? 'Waiting…' : "I'm Ready!";
}
function doCountdown() {
  show(null); gs = null; SFX.stopMusic(); updateHud();
  const cd = $('#countdown'); cd.classList.add('on');
  [3, 2, 1, 0].forEach((n, k) => setTimeout(() => { cd.innerHTML = `<span>${n || 'GO!'}</span>`; SFX.play('cd', n); buzz(n ? 25 : 80); if (!n) setTimeout(() => cd.classList.remove('on'), 700); }, k * 850));
}
function startPlay() { show(null); SFX.music('game'); setupControls(room.game); $('#countdown').classList.remove('on'); }
function stars(i, fresh) {
  const p = room.players[i]; let s = '';
  for (let k = 0; k < room.settings.target; k++) s += `<span class="${k < p.score ? (fresh && k === p.score - 1 ? 'n' : '') : 'e'}">⭐</span>`;
  return `<div class="brow"><img src="art/${p.char}.png">${p.name}<div class="stars">${s}</div>${p.score}</div>`;
}
function doResult() {
  show('s-result'); SFX.stopMusic(); setControls(null); $('#hud').classList.remove('on');
  const w = room.lastWin;
  if (w >= 0) {
    $('#t-restitle').textContent = `${pname(w)} wins the round!`;
    $('#reswinner').innerHTML = `<img src="art/${pchar(w)}.png"><img src="art/hazel.png" style="height:18vh"><img class="sad" src="art/${pchar(1 - w)}.png">`;
    if (w === me) { SFX.play('win'); buzz([60, 40, 60, 40, 120]); } else { SFX.play('lose'); buzz(200); }
    confetti(70);
  } else { $('#t-restitle').textContent = "It's a tie! No point"; $('#reswinner').innerHTML = `<img src="art/${pchar(0)}.png" class="sad"><img src="art/hazel.png" style="height:18vh"><img class="sad" src="art/${pchar(1)}.png">`; SFX.play('lose'); }
  setTimeout(() => SFX.play('bark'), 900);
  $('#scoreboard').innerHTML = `<div class="lbl">First to ${room.settings.target} ⭐</div>` + [0, 1].map(i => stars(i, i === w)).join('');
  if (w >= 0) setTimeout(() => SFX.play('coin'), 500);
}
function doFinal() {
  show('s-final'); const c = room.champ;
  $('#t-champ').textContent = `${pname(c)} is the CHAMPION!`;
  $('#champimg').innerHTML = `<img src="art/${pchar(c)}.png"><img src="art/hazel.png" style="height:22vh">`;
  $('#finalboard').innerHTML = [0, 1].map(i => stars(i)).join('') + `<div class="lbl" style="margin-top:6px">${room.history.map(h => INFO[h.g].ic + (h.w >= 0 ? (h.w === 0 ? '🩷' : '💙') : '➖')).join(' ')}</div>`;
  SFX.play('fanfare'); buzz([100, 50, 100, 50, 300]); confetti(160); setTimeout(() => confetti(120), 1500); setTimeout(() => SFX.music('menu'), 2500);
}

// ---------- FX helpers ----------
function confetti(n) {
  const L = $('#fxlayer'), cols = ['#ff3d7f', '#ffcc00', '#1f9bff', '#7cf06a', '#b67bff', '#ff9a1f'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div'); d.className = 'conf';
    d.style.left = Math.random() * 100 + 'vw'; d.style.background = cols[i % cols.length];
    d.style.animationDuration = (1.8 + Math.random() * 2) + 's'; d.style.animationDelay = Math.random() * 0.8 + 's'; d.style.transform = `rotate(${Math.random() * 360}deg)`;
    L.appendChild(d); setTimeout(() => d.remove(), 5000);
  }
}
function toastDom(t, x = innerWidth / 2, y = innerHeight / 2, col = '#fff') {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.color = col;
  $('#fxlayer').appendChild(d); setTimeout(() => d.remove(), 1000);
}
function shake() { const a = $('#app'); a.classList.remove('shake'); a.offsetHeight; a.classList.add('shake'); }
function flash() { const d = document.createElement('div'); d.className = 'flash'; $('#fxlayer').appendChild(d); setTimeout(() => d.remove(), 300); }
function banner(h) { const b = $('#banner'); b.innerHTML = h || ''; b.classList.toggle('on', !!h); }

// ---------- canvas / world ----------
const cv = $('#cv'), cx = cv.getContext('2d');
let VW = 0, VH = 0, S = 1, OX = 0, OY = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1); VW = innerWidth; VH = innerHeight; cv.width = VW * DPR; cv.height = VH * DPR;
  S = Math.min(VW / 100, (VH - 0) / 160); OX = (VW - 100 * S) / 2; OY = (VH - 160 * S) / 2;
}
addEventListener('resize', resize); resize();
const toW = (px, py) => ({ x: (px - OX) / S, y: (py - OY) / S });
const toS = (x, y) => ({ x: OX + x * S, y: OY + y * S });
function cover(img, x = 0, y = 0, w = VW, h = VH) {
  if (!img.complete || !img.naturalWidth) return; const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * r, ih = img.naturalHeight * r; cx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function spr(img, x, y, h, o = {}) { // world coords, anchor bottom-center
  if (!img.complete || !img.naturalWidth) return; const w = h * img.naturalWidth / img.naturalHeight;
  cx.save(); cx.translate(OX + x * S, OY + y * S); if (o.rot) cx.rotate(o.rot); cx.scale((o.flip ? -1 : 1) * (o.sx || 1), o.sy || 1);
  if (o.alpha !== undefined) cx.globalAlpha = o.alpha;
  if (o.shadow !== false) { cx.fillStyle = 'rgba(0,0,0,.22)'; cx.beginPath(); cx.ellipse(0, 0, w * S * 0.38, h * S * 0.07, 0, 0, 7); cx.fill(); }
  cx.drawImage(img, -w * S / 2, -h * S * (o.ay ?? 1), w * S, h * S); cx.restore();
}
const disp = {};
function sm(k, v, r = 14, dt = 1 / 60) { if (disp[k] === undefined || Math.abs(disp[k] - v) > 60) disp[k] = v; disp[k] += (v - disp[k]) * Math.min(1, dt * r); return disp[k]; }
let parts = [];
function burst(x, y, col, n = 14, sp = 40, emoji) { for (let i = 0; i < n; i++) { const a = Math.random() * 7, v = sp * (0.4 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, l: 0.6 + Math.random() * 0.5, c: Array.isArray(col) ? col[i % col.length] : col, s: 1 + Math.random() * 1.6, e: emoji && i % 3 === 0 ? emoji : null }); } }
function wtext(t, x, y, col) { parts.push({ x, y, vx: 0, vy: -28, l: 1, txt: t, c: col }); }
let shakeT = 0;
function onFx(e) {
  const mine = e.i === me, G = room && room.game;
  if (e.only !== undefined && e.only !== me) return;
  const pc = e.i !== undefined ? COLORS[e.i] : '#fff';
  switch (e.t) {
    case 'joined': break;
    case 'bark': SFX.play('bark'); wtext('WOOF!', e.x, e.y - 30, '#fff'); hazelBark = 0.6; break;
    case 'catch': SFX.play('catch'); burst(e.x, e.y - 10, ['#ffcc00', pc, '#fff'], 22, 60, '⭐'); wtext(`+1 ${pname(e.i)}`, e.x, e.y - 30, pc); if (mine) { buzz(40); shakeT = 0.2; } hazelBark = 0.4; break;
    case 'miss': SFX.play('miss'); burst(e.x, e.y, '#ffffffaa', 6, 20); break;
    case 'good': SFX.play(e.v >= 3 ? 'catch' : 'coin'); burst(e.x, e.y, ['#ffcc00', pc], 14, 45); wtext(`+${e.v}`, e.x, e.y - 12, pc); if (mine) buzz(25); hop[e.i] = 0.25; break;
    case 'bad': SFX.play('bad'); burst(e.x, e.y, ['#3a9d23', '#7cf06a'], 14, 45); wtext(`${e.v}`, e.x, e.y - 12, '#ff4444'); if (mine) { buzz([60, 30, 60]); shakeT = 0.3; } break;
    case 'throw': SFX.play('whoosh'); if (mine) buzz(20); break;
    case 'fetch': SFX.play('bark'); setTimeout(() => SFX.play('catch'), 300); burst(e.x, e.y, ['#ffcc00', pc], 22, 50, '💛'); wtext(`${pname(e.i)}'s toy!`, 50, 60, pc); if (mine) buzz([40, 30, 40]); break;
    case 'bump': SFX.play(e.hard ? 'bump' : 'boing'); burst(e.x, e.y, ['#fff', '#ffcc00'], e.hard ? 16 : 6, 50, e.hard ? '💥' : null); if (e.hard) { shakeT = 0.25; buzz(60); } break;
    case 'grab': SFX.play('coin'); burst(e.x, e.y, ['#ffcc00', pc], 12, 40); wtext('+1', e.x, e.y - 8, pc); if (mine) buzz(25); break;
    case 'munch': SFX.play('munch'); burst(e.x, e.y, ['#c58b4b', '#fff'], 10, 30); wtext('CHOMP!', e.x, e.y - 10, '#fff'); hazelBark = 0.4; break;
    case 'crash': SFX.play('crash'); if (mine) { buzz(150); shakeT = 0.35; } crashFx[e.i] = 0.9; break;
    case 'clear': SFX.play('coin'); break;
    case 'jump': SFX.play('jump'); break;
    case 'finish': SFX.play('fanfare'); flash(); break;
    case 'sgo': SFX.play('ding'); wtext('PUSH!', 50, 60, '#ffcc00'); break;
    case 'sbump': SFX.play('snowhit'); burst(e.x, e.y, ['#fff', '#d8f1ff', '#bfe3ff'], e.hard ? 26 : 10, e.hard ? 70 : 35, e.hard ? '❄️' : null); if (e.hard) { shakeT = 0.3; buzz(80); } else buzz(20); break;
    case 'sdash': SFX.play('snowdash'); burst(e.x, e.y, ['#fff', '#d8f1ff'], 10, 30); if (mine) buzz(30); break;
    case 'sfall': SFX.play('fall'); setTimeout(() => { shakeT = 0.4; }, 950); wtext(`${pname(e.w)} +1!`, 50, 40, COLORS[e.w]); if (e.i === me) buzz([100, 50, 200]); else buzz([30, 30, 30]); setTimeout(() => SFX.play(e.w === me ? 'coin' : 'bad'), 1100); break;
    case 'cmove': SFX.play(e.cap ? 'capture' : 'move'); if (e.chk) setTimeout(() => SFX.play('check'), 150); buzz(e.cap ? 50 : 15); if (e.cap) shakeT = 0.15; chessSel = null; break;
    case 'chessend': SFX.play(e.w === me ? 'win' : e.w < 0 ? 'ding' : 'lose'); banner(`${e.why === 'checkmate' ? 'CHECKMATE!' : e.why === 'timeout' ? "Time's up!" : e.why === 'resign' ? 'Resigned!' : 'Draw!'}${e.w >= 0 ? `<br>${pname(e.w)} wins` : ''}`); setTimeout(() => banner(null), 2900); break;
  }
}
let hazelBark = 0, hop = [0, 0], crashFx = [0, 0];

// ---------- HUD ----------
function updateHud() {
  if (!room || !room.players[1]) return;
  [0, 1].forEach(i => {
    const el = $('#hp' + i); el.querySelector('img').src = `art/${pchar(i)}.png`; el.querySelector('b').textContent = pname(i) + (i === me ? ' (you)' : '');
    let v = gs && gs.sc ? gs.sc[i] : 0;
    if (room.game === 'zoomies' && gs && gs.p) v = Math.min(100, Math.round(gs.p[i][0] / gs.len * 100)) + '%';
    if (room.game === 'chess' && gs && gs.clk) { const c = gs.clk[i]; v = `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`; }
    if (room.game === 'snow' && gs && gs.sc) v = '⛄'.repeat(gs.sc[i]) || '0';
    const ie = el.querySelector('i'); if (ie.textContent !== String(v)) { ie.textContent = v; el.classList.remove('bump'); el.offsetHeight; el.classList.add('bump'); }
  });
  const t = $('#htimer'); let tt = '';
  if (gs && gs.t !== undefined) tt = Math.max(0, Math.ceil(gs.t));
  if (room.game === 'fetch' && gs) tt = `🎾 to 5`;
  if (room.game === 'snow' && gs) tt = `☃️ to 2`;
  if (room.game === 'chess' && gs) tt = gs.end !== null ? '🏁' : ((gs.turn === 'w') === (gs.white === me) ? 'Your move' : 'Waiting…');
  if (t.textContent !== String(tt)) { t.textContent = tt; if (typeof tt === 'number' && tt <= 5 && tt > 0) SFX.play('tick'); }
  t.classList.toggle('hot', typeof tt === 'number' && tt <= 5);
}

// ---------- controls ----------
let ctl = { game: null }, joy = null, chessSel = null;
function setControls(html) { $('#controls').innerHTML = html || ''; }
function send(m) { sock.emit('in', m); }
function setupControls(g) {
  ctl = { game: g, lastX: 0 }; joy = null; chessSel = null; parts = [];
  if (g === 'zoomies') {
    setControls(`<button class="big purple" id="c-jump">⬆️ JUMP</button><button class="big yellow" id="c-run">🐾 RUN!</button>`);
    const run = $('#c-run'), jump = $('#c-jump');
    const r = e => { e.preventDefault(); send({ t: 'run' }); SFX.play('step'); buzz(8); hop[me] = 0.12; };
    run.addEventListener('pointerdown', r); jump.addEventListener('pointerdown', e => { e.preventDefault(); send({ t: 'jump' }); });
  } else if (g === 'snow') {
    setControls(`<button class="big blue" id="c-shove" style="flex:0 0 42%;margin-left:auto">💨 SHOVE</button>`);
    $('#c-shove').addEventListener('pointerdown', e => { e.preventDefault(); send({ t: 'dash' }); });
  } else if (g === 'chess') {
    setControls(`<button class="mid red" id="c-resign" style="flex:0 0 auto;height:auto;margin-left:auto;font-size:16px">🏳️ Resign</button>`);
    $('#c-resign').onclick = () => { if (confirm('Resign this chess game?')) send({ t: 'resign' }); };
  } else setControls(null);
}
addEventListener('keydown', e => { if (room && room.phase === 'play' && room.game === 'snow' && e.code === 'Space') send({ t: 'dash' }); if (room && room.phase === 'play' && room.game === 'zoomies') { if (e.code === 'Space' || e.code === 'ArrowUp') send({ t: 'jump' }); else send({ t: 'run' }); } });
cv.addEventListener('pointerdown', e => {
  if (!room || room.phase !== 'play' || !gs) return; const w = toW(e.clientX, e.clientY), g = room.game;
  if (g === 'dash') send({ t: 'tap', x: w.x, y: w.y });
  if (g === 'treat') { send({ t: 'x', x: w.x }); ctl.drag = true; }
  if (g === 'fetch') { if (!gs.th[me] && gs.ph === 'aim') { const p = fetchRet(me); send({ t: 'throw', x: p.x, y: p.y }); } }
  if (g === 'snack' || g === 'snow') { joy = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, id: e.pointerId }; }
  if (g === 'chess') chessTap(e.clientX, e.clientY);
});
cv.addEventListener('pointermove', e => {
  if (!room || room.phase !== 'play') return; const g = room.game;
  if (g === 'treat' && (ctl.drag || e.pointerType === 'mouse')) { const now = performance.now(); if (now - ctl.lastX > 30) { ctl.lastX = now; send({ t: 'x', x: toW(e.clientX, 0).x }); } }
  if ((g === 'snack' || g === 'snow') && joy && e.pointerId === joy.id) {
    joy.cx = e.clientX; joy.cy = e.clientY; const R = 50; const now = performance.now();
    if (now - (ctl.lastX || 0) > 40) { ctl.lastX = now; send({ t: 'dir', dx: (joy.cx - joy.x) / R, dy: (joy.cy - joy.y) / R }); }
  }
});
const endPtr = e => { ctl.drag = false; if (joy && e.pointerId === joy.id) { joy = null; send({ t: 'dir', dx: 0, dy: 0 }); } };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);

// ---------- per-game renderers ----------
function gsT() { return (performance.now() - gsAt) / 1000; }
function drawDash(dt, T) {
  cover(IMG.bg_yard);
  if (!gs || !gs.h) return;
  const x = sm('hx', gs.h.x, 18, dt), y = sm('hy', gs.h.y, 18, dt);
  const bob = Math.abs(Math.sin(T * 14)); const flip = gs.h.tx < gs.h.x;
  spr(IMG.hazel, x, y + 10, 26, { flip, sx: 1 + bob * 0.06, sy: 1 - bob * 0.08 + (hazelBark > 0 ? 0.1 : 0), rot: Math.sin(T * 20) * 0.08, alpha: gs.h.cd > 0 ? 0.5 : 1 });
  // dust trail
  if (Math.random() < 0.4) parts.push({ x: x + (flip ? 6 : -6), y: y + 10, vx: 0, vy: -5, l: 0.4, c: '#d9f7b0', s: 1.4 });
}
function drawTreat(dt, T) {
  cover(IMG.bg_yard);
  if (!gs || !gs.p) return;
  const hx = sm('thx', gs.hx, 6, dt);
  spr(IMG.hazel, hx, 26, 20, { sy: 1 + Math.sin(T * 10) * 0.05, rot: Math.sin(T * 6) * 0.1, shadow: false });
  for (const [id, ty, x, y, r] of gs.it) { const yy = sm('i' + id, y + 0, 20, dt), xx = sm('ix' + id, x, 20, dt); spr(IMG[ty], xx, yy + 5, 10, { rot: r + T * 3, shadow: false, ay: 0.5 }); }
  [0, 1].forEach(i => {
    const px = sm('tp' + i, gs.p[i], 20, dt); hop[i] = Math.max(0, hop[i] - dt); const h = hop[i] > 0 ? 4 : 0;
    spr(IMG[pchar(i)], px, 152 - h, 30, { sy: 1 - (hop[i] > 0.15 ? 0.1 : 0), alpha: i === me ? 1 : 0.8 });
    label(px, 152 - 32 - h, i === me ? '▼ YOU' : pname(i), COLORS[i]);
  });
}
function label(x, y, t, col) { const p = toS(x, y); cx.font = `${Math.round(S * 3.6)}px "Lilita One"`; cx.textAlign = 'center'; cx.lineWidth = S * 0.9; cx.strokeStyle = '#fff'; cx.strokeText(t, p.x, p.y); cx.fillStyle = col; cx.fillText(t, p.x, p.y); }
function fetchRet(i) { const T = gs.T + (gs.ph === 'aim' ? gsT() : 0), sd = gs.seed[i], sp = gs.spd; return { x: 50 + 40 * Math.sin(T * 1.7 * sp + sd), y: 70 + 48 * Math.sin(T * 1.13 * sp + sd * 2.1) }; }
function ring(x, y, r, col, w = 1) { const p = toS(x, y); cx.beginPath(); cx.arc(p.x, p.y, r * S, 0, 7); cx.lineWidth = w * S; cx.strokeStyle = col; cx.stroke(); }
function drawFetch(dt, T) {
  cover(IMG.bg_yard);
  if (!gs || !gs.h) return;
  const hx = sm('fhx', gs.h.x, 10, dt), hy = sm('fhy', gs.h.y, 10, dt);
  // target zone glow
  ring(hx, hy - 4, 8 + Math.sin(T * 5), 'rgba(255,255,255,.6)', 0.8);
  spr(IMG.hazel, hx, hy + 6, 22, { sy: 1 + Math.sin(T * 8) * 0.04, rot: gs.ph === 'run' ? Math.sin(T * 25) * 0.1 : 0 });
  const homes = [{ x: 14, y: 156 }, { x: 86, y: 156 }];
  [0, 1].forEach(i => spr(IMG[pchar(i)], homes[i].x, homes[i].y, 28, { sy: 1 + Math.sin(T * 6 + i) * 0.03 }));
  if (gs.ph === 'aim') {
    [0, 1].forEach(i => {
      if (gs.th[i]) { label(homes[i].x, 124, 'THROWN!', COLORS[i]); return; }
      const p = fetchRet(i); const mine = i === me;
      cx.globalAlpha = mine ? 1 : 0.35; ring(p.x, p.y, 5, COLORS[i], mine ? 1.4 : 0.8); ring(p.x, p.y, 1.2, COLORS[i], 1); cx.globalAlpha = 1;
      if (mine) label(p.x, p.y - 7, 'TAP!', COLORS[i]);
    });
    label(50, 145, `Fetch #${gs.n} · ${Math.max(0, Math.ceil(gs.rt + 0 - gsT()))}s`, '#45208f');
  } else if (gs.land) {
    const k = gs.ph === 'fly' ? Math.min(1, 1 - (gs.rt - gsT())) : 1;
    [0, 1].forEach(i => {
      const L = gs.land[i]; if (!L) return; const sx = homes[i].x, sy = homes[i].y - 20;
      const x = sx + (L.x - sx) * k, y = sy + (L.y - sy) * k - Math.sin(k * Math.PI) * 30;
      if (gs.ph === 'run' && i === gs.win) return;
      spr(IMG.ball, x, y, 6, { ay: 0.5, shadow: false, rot: k * 10 });
      cx.globalAlpha = 0.7; ring(L.x, L.y, 2, COLORS[i], 0.6); cx.globalAlpha = 1;
      if (gs.ph === 'run') { const a = toS(L.x, L.y), b = toS(hx, hy); cx.setLineDash([S * 2, S * 2]); cx.strokeStyle = COLORS[i]; cx.lineWidth = S * .6; cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke(); cx.setLineDash([]); }
    });
    if (gs.ph === 'run') spr(IMG.ball, hx + 4, hy - 8, 5, { ay: 0.5, shadow: false });
  }
}
function drawSnack(dt, T) {
  cover(IMG.bg_kitchen);
  if (!gs || !gs.p) return;
  for (const [id, ty, x, y] of gs.sn) spr(IMG[ty], x, y + 4 + Math.sin(T * 4 + id) * 0.8, 9);
  const order = [0, 1, 2].sort((a, b) => (a < 2 ? gs.p[a][1] : gs.h[1]) - (b < 2 ? gs.p[b][1] : gs.h[1]));
  for (const k of order) {
    if (k === 2) { const x = sm('shx', gs.h[0], 12, dt), y = sm('shy', gs.h[1], 12, dt); spr(IMG.hazel, x, y + 7, 18, { flip: !!gs.h[2], sy: 1 + Math.abs(Math.sin(T * 12)) * 0.06, rot: Math.sin(T * 18) * 0.06 }); continue; }
    const [px, py, st, vx] = gs.p[k]; const x = sm('sx' + k, px, 16, dt), y = sm('sy' + k, py, 16, dt);
    const w = Math.abs(Math.sin(T * 12)) * Math.min(1, Math.abs(vx) / 20);
    spr(IMG[pchar(k)], x, y + 9, 24, { flip: vx < -2, sx: 1 + w * 0.06, sy: 1 - w * 0.07, rot: st ? Math.sin(T * 30) * 0.3 : 0 });
    if (st) label(x, y - 16, '💫', '#fff');
    label(x, y - 17 + (st ? -4 : 0), k === me ? 'YOU' : pname(k), COLORS[k]);
  }
  if (joy) { cx.globalAlpha = 0.5; cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(joy.x, joy.y, 50, 0, 7); cx.fill(); cx.globalAlpha = 0.9; const dx = joy.cx - joy.x, dy = joy.cy - joy.y, l = Math.min(1, 50 / Math.max(1, Math.hypot(dx, dy))); cx.fillStyle = COLORS[me]; cx.beginPath(); cx.arc(joy.x + dx * l, joy.y + dy * l, 24, 0, 7); cx.fill(); cx.globalAlpha = 1; }
}
function drawZoomies(dt, T) {
  cx.fillStyle = '#3a1a8a'; cx.fillRect(0, 0, VW, VH);
  if (!gs || !gs.p) return;
  const top = 70, bottom = VH - 140, laneH = (bottom - top) / 2;
  const order = me === 1 ? [0, 1] : [1, 0]; // my lane at the bottom (closer to buttons)
  order.forEach((i, li) => {
    const y0 = top + li * laneH, [px, v, j, st] = gs.p[i];
    const x = sm('zx' + i, px, 12, dt); const ppu = laneH / 60; // pixels per unit
    const cam = x - 22;
    cx.save(); cx.beginPath(); cx.rect(0, y0 + 4, VW, laneH - 8); cx.clip();
    const img = IMG.bg_apartment; if (img.naturalWidth) { const s = laneH / img.naturalHeight, iw = img.naturalWidth * s; let off = -((cam * ppu * 0.6) % iw); if (off > 0) off -= iw; for (let xx = off; xx < VW; xx += iw) cx.drawImage(img, xx, y0, iw, laneH); }
    const floorY = y0 + laneH * 0.86;
    // finish line
    const fx = (gs.len - cam) * ppu; if (fx < VW + 50) { for (let k = 0; k < 8; k++) { cx.fillStyle = k % 2 ? '#000' : '#fff'; cx.fillRect(fx, y0 + k * laneH / 8, 10, laneH / 8); cx.fillStyle = k % 2 ? '#fff' : '#000'; cx.fillRect(fx + 10, y0 + k * laneH / 8, 10, laneH / 8); } }
    for (const [ox, ty] of gs.ob) { const sx = (ox - cam) * ppu; if (sx < -100 || sx > VW + 100) continue; const im = IMG[ty]; const h = (ty === 'couch' ? 14 : 8) * ppu; const w = h * im.naturalWidth / im.naturalHeight; cx.drawImage(im, sx - w / 2, floorY - h, w, h); }
    const jy = j > 0 ? Math.sin((0.7 - j) / 0.7 * Math.PI) * 22 * ppu : 0;
    const hx = 22 * ppu, hz = IMG.hazel, hh = 24 * ppu, hw = hh * hz.naturalWidth / hz.naturalHeight;
    const gal = st ? 0 : Math.abs(Math.sin(T * (6 + v / 6))) * 0.08;
    cx.save(); cx.translate(hx, floorY - jy); cx.rotate(st ? Math.sin(T * 30) * 0.2 : -gal);
    const ch = IMG[pchar(i)], chh = 20 * ppu, chw = chh * ch.naturalWidth / ch.naturalHeight;
    cx.drawImage(ch, -chw / 2 + 2 * ppu, -hh * 0.55 - chh * 0.75, chw, chh);
    cx.scale(1 + gal, 1 - gal); cx.drawImage(hz, -hw / 2, -hh, hw, hh); cx.restore();
    if (v > 30 && !st) for (let k = 0; k < 2; k++) parts.push({ sx: hx - hw / 2, sy: floorY - jy - Math.random() * hh * 0.5, vx: -v * 3, vy: 0, l: 0.25, c: '#ffffffaa', s: 2, scr: 1 });
    if (st) { cx.font = `${laneH * 0.12}px serif`; cx.textAlign = 'center'; cx.fillText('💫 OOF!', hx, floorY - hh - chh * 0.6); }
    cx.restore();
    cx.fillStyle = COLORS[i]; cx.fillRect(0, y0 + 4, 8, laneH - 8);
    cx.font = `bold ${Math.max(14, laneH * 0.08)}px "Lilita One"`; cx.textAlign = 'left'; cx.lineWidth = 4; cx.strokeStyle = '#fff'; const t = (i === me ? 'YOU · ' : '') + pname(i); cx.strokeText(t, 16, y0 + laneH * 0.12); cx.fillStyle = COLORS[i]; cx.fillText(t, 16, y0 + laneH * 0.12);
    // progress bar
    const bw = VW - 32, by = y0 + laneH * 0.17; cx.fillStyle = '#0005'; cx.fillRect(16, by, bw, 8); cx.fillStyle = COLORS[i]; cx.fillRect(16, by, bw * Math.min(1, px / gs.len), 8);
  });
}
function chessGeom() { const sz = Math.floor(Math.min(VW - 28, VH - 250) / 8) * 8, x0 = Math.round((VW - sz) / 2), y0 = Math.round(Math.max(96, (VH - sz) / 2 - 10)); return { sz, x0, y0, c: sz / 8 }; }
function chessTap(px, py) {
  const g = chessGeom(), flip = gs.white !== me; let f = Math.floor((px - g.x0) / g.c), r = Math.floor((py - g.y0) / g.c);
  if (f < 0 || f > 7 || r < 0 || r > 7) { chessSel = null; return; }
  if (flip) { f = 7 - f; r = 7 - r; } const sq = 'abcdefgh'[f] + (8 - r);
  const myTurn = (gs.turn === 'w') === (gs.white === me);
  if (chessSel && gs.legal[chessSel] && gs.legal[chessSel].includes(sq)) { send({ t: 'move', from: chessSel, to: sq }); chessSel = null; return; }
  if (myTurn && gs.legal[sq]) { chessSel = sq; SFX.play('tap'); buzz(8); } else chessSel = null;
}
let chessAnim = null, chessLastKey = '';
function drawChess(dt, T) {
  const gr = cx.createLinearGradient(0, 0, 0, VH); gr.addColorStop(0, '#8a5cff'); gr.addColorStop(1, '#2e1470'); cx.fillStyle = gr; cx.fillRect(0, 0, VW, VH);
  // soft polka dots
  cx.fillStyle = 'rgba(255,255,255,.06)'; for (let y = 0; y < VH; y += 46) for (let x = (y / 46 % 2) * 23; x < VW; x += 46) { cx.beginPath(); cx.arc(x, y, 7, 0, 7); cx.fill(); }
  if (!gs || !gs.fen) return;
  const g = chessGeom(), flip = gs.white !== me, rows = gs.fen.split(' ')[0].split('/'), c = g.c;
  // frame: wood with gold trim
  cx.save(); cx.shadowColor = 'rgba(0,0,0,.45)'; cx.shadowBlur = 24; cx.shadowOffsetY = 10;
  const fw = Math.max(14, c * 0.42); const wg = cx.createLinearGradient(0, g.y0 - fw, 0, g.y0 + g.sz + fw); wg.addColorStop(0, '#8b4a1f'); wg.addColorStop(0.5, '#6b3413'); wg.addColorStop(1, '#4a220a');
  cx.fillStyle = wg; rr(g.x0 - fw, g.y0 - fw, g.sz + fw * 2, g.sz + fw * 2, fw * 0.9); cx.fill(); cx.restore();
  cx.lineWidth = 3; cx.strokeStyle = '#ffcc33'; rr(g.x0 - fw + 4, g.y0 - fw + 4, g.sz + fw * 2 - 8, g.sz + fw * 2 - 8, fw * 0.7); cx.stroke();
  cx.fillStyle = '#2a1206'; cx.fillRect(g.x0 - 2, g.y0 - 2, g.sz + 4, g.sz + 4);
  const bd = {}; rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { bd['abcdefgh'[f] + (8 - r)] = ch; f++; } } });
  const kingSq = gs.chk ? Object.keys(bd).find(s => bd[s] === (gs.turn === 'w' ? 'K' : 'k')) : null;
  const scr = sq => { let f = sq.charCodeAt(0) - 97, r = 8 - +sq[1]; if (flip) { f = 7 - f; r = 7 - r; } return { x: g.x0 + f * c, y: g.y0 + r * c }; };
  // slide animation for the last move
  const key = gs.last ? gs.last.join('') + gs.n : ''; if (key !== chessLastKey) { if (chessLastKey && gs.last) chessAnim = { from: gs.last[0], to: gs.last[1], t: 0 }; chessLastKey = key; }
  if (chessAnim) { chessAnim.t += dt / 0.18; if (chessAnim.t >= 1) chessAnim = null; }
  const legal = chessSel && gs.legal[chessSel] ? gs.legal[chessSel] : [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const ff = flip ? 7 - f : f, rr2 = flip ? 7 - r : r, sq = 'abcdefgh'[ff] + (8 - rr2), x = g.x0 + f * c, y = g.y0 + r * c, dark = (f + r) % 2;
    const sg = cx.createLinearGradient(x, y, x + c, y + c);
    if (dark) { sg.addColorStop(0, '#c98a4f'); sg.addColorStop(1, '#b0733c'); } else { sg.addColorStop(0, '#fff1d2'); sg.addColorStop(1, '#f5deb0'); }
    cx.fillStyle = sg; cx.fillRect(x, y, c + 0.5, c + 0.5);
    if (gs.last && gs.last.includes(sq)) { cx.fillStyle = 'rgba(255,214,0,.48)'; cx.fillRect(x, y, c + 0.5, c + 0.5); }
    if (sq === chessSel) { cx.fillStyle = 'rgba(60,200,120,.6)'; cx.fillRect(x, y, c + 0.5, c + 0.5); }
    if (sq === kingSq) { const rg = cx.createRadialGradient(x + c / 2, y + c / 2, c * 0.1, x + c / 2, y + c / 2, c * 0.7); rg.addColorStop(0, 'rgba(255,40,40,.95)'); rg.addColorStop(1, 'rgba(255,40,40,0)'); cx.fillStyle = rg; cx.fillRect(x, y, c, c); }
    // coordinates
    cx.font = `bold ${Math.round(c * 0.2)}px "Lilita One",sans-serif`; cx.fillStyle = dark ? '#fff1d2' : '#b0733c';
    if (f === 0) { cx.textAlign = 'left'; cx.textBaseline = 'top'; cx.fillText(8 - rr2, x + 3, y + 2); }
    if (r === 7) { cx.textAlign = 'right'; cx.textBaseline = 'bottom'; cx.fillText('abcdefgh'[ff], x + c - 3, y + c - 1); }
  }
  cx.textBaseline = 'alphabetic';
  // pieces
  const drawPiece = (p, x, y, lift = 0, sc = 1) => {
    const im = IMG['pc_' + (p === p.toUpperCase() ? 'w' : 'b') + p.toUpperCase()]; if (!im || !im.complete) return;
    const s = c * 0.92 * sc, px = x + (c - s) / 2, py = y + (c - s) / 2 - lift;
    cx.save(); cx.fillStyle = 'rgba(0,0,0,.22)'; cx.beginPath(); cx.ellipse(x + c / 2, y + c * 0.86, c * 0.3, c * 0.08, 0, 0, 7); cx.fill();
    cx.shadowColor = 'rgba(0,0,0,.35)'; cx.shadowBlur = c * 0.06; cx.shadowOffsetY = c * 0.03; cx.drawImage(im, px, py, s, s); cx.restore();
  };
  for (const sq in bd) {
    if (chessAnim && sq === chessAnim.to) continue;
    const p = scr(sq); drawPiece(bd[sq], p.x, p.y, sq === chessSel ? 4 + Math.sin(T * 8) * 2 : 0, sq === chessSel ? 1.08 : 1);
  }
  if (chessAnim && bd[chessAnim.to]) { const a = scr(chessAnim.from), b = scr(chessAnim.to), k = 1 - Math.pow(1 - chessAnim.t, 3); drawPiece(bd[chessAnim.to], a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, Math.sin(k * Math.PI) * c * 0.25, 1.06); }
  for (const sq of legal) {
    const p = scr(sq), occ = !!bd[sq]; cx.beginPath();
    if (occ) { cx.lineWidth = c * 0.08; cx.strokeStyle = 'rgba(30,140,80,.85)'; cx.arc(p.x + c / 2, p.y + c / 2, c * 0.44, 0, 7); cx.stroke(); }
    else { cx.fillStyle = 'rgba(30,140,80,.7)'; cx.arc(p.x + c / 2, p.y + c / 2, c * (0.14 + Math.sin(T * 6) * 0.01), 0, 7); cx.fill(); }
  }
  // player tags
  const opp = 1 - me; const tag = (i, y, top) => {
    const im = IMG[pchar(i)]; const h = 48, myT = (gs.turn === 'w') === (gs.white === i), white = gs.white === i;
    cx.fillStyle = myT && gs.end === null ? 'rgba(255,204,0,.95)' : 'rgba(255,255,255,.18)'; rr(10, y - h - 2, Math.min(VW - 20, 300), h + 6, 16); cx.fill();
    if (im.naturalWidth) cx.drawImage(im, 16, y - h, h * im.naturalWidth / im.naturalHeight, h);
    const pi = IMG['pc_' + (white ? 'wK' : 'bK')]; if (pi.complete) cx.drawImage(pi, 58, y - h + 6, 34, 34);
    cx.font = '19px "Lilita One"'; cx.textAlign = 'left'; cx.fillStyle = myT && gs.end === null ? '#45208f' : '#fff';
    cx.fillText(`${pname(i)}${i === me ? ' (you)' : ''} · ${white ? 'White' : 'Black'}`, 98, y - h / 2 + 4);
    cx.font = '14px "Lilita One"'; cx.fillText(myT && gs.end === null ? (i === me ? 'Your move!' : 'Thinking…') : '', 98, y - h / 2 + 22);
  };
  const fw2 = Math.max(14, c * 0.42);
  tag(opp, g.y0 - fw2 - 8); tag(me, g.y0 + g.sz + fw2 + 62);
  spr(IMG.hazel, (VW - 44 - OX) / S, (g.y0 + g.sz + fw2 + 64 - OY) / S, 14, { rot: Math.sin(T * 3) * 0.08, shadow: false });
}
const snowFlakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: 1 + Math.random() * 2.5, v: 0.03 + Math.random() * 0.06, w: Math.random() * 6 }));
let snowCrunch = 0;
function drawSnow(dt, T) {
  const sk = cx.createLinearGradient(0, 0, 0, VH); sk.addColorStop(0, '#5bb8ff'); sk.addColorStop(0.55, '#bfe6ff'); sk.addColorStop(1, '#eaf7ff'); cx.fillStyle = sk; cx.fillRect(0, 0, VW, VH);
  // distant peaks
  const mt = (x0, w, h, col, cap) => { const b = VH * 0.62; cx.fillStyle = col; cx.beginPath(); cx.moveTo(x0 - w, b); cx.lineTo(x0, b - h); cx.lineTo(x0 + w, b); cx.fill(); cx.fillStyle = cap; cx.beginPath(); cx.moveTo(x0 - w * 0.28, b - h * 0.72); cx.lineTo(x0, b - h); cx.lineTo(x0 + w * 0.28, b - h * 0.72); cx.lineTo(x0 + w * 0.1, b - h * 0.66); cx.lineTo(x0 - w * 0.05, b - h * 0.74); cx.fill(); };
  mt(VW * 0.15, VW * 0.4, VH * 0.42, '#8fb3d9', '#fff'); mt(VW * 0.8, VW * 0.45, VH * 0.5, '#7a9fcc', '#fff'); mt(VW * 0.48, VW * 0.3, VH * 0.33, '#a6c6e6', '#fff');
  cx.fillStyle = 'rgba(255,255,255,.55)'; cx.fillRect(0, VH * 0.62, VW, VH);
  const cl = cx.createLinearGradient(0, VH * 0.62, 0, VH); cl.addColorStop(0, '#d6ecff'); cl.addColorStop(1, '#9cc4ea'); cx.fillStyle = cl; cx.fillRect(0, VH * 0.62, VW, VH);
  const G0 = gs && gs.p ? gs : { ar: 42, cx: 50, cy: 86, p: [], ph: 'ready', n: 1, sc: [0, 0] };
  const C = toS(G0.cx, G0.cy), ar = sm('sar', G0.ar, 6, dt) * S, R0 = 42 * S;
  // cliff body below the platform
  const dep = 26 * S; const rk = cx.createLinearGradient(0, C.y, 0, C.y + ar + dep); rk.addColorStop(0, '#6d7fa6'); rk.addColorStop(1, '#3b4670');
  cx.fillStyle = 'rgba(0,30,80,.18)'; cx.beginPath(); cx.ellipse(C.x, C.y + ar + dep + 4, ar * 0.9, ar * 0.18, 0, 0, 7); cx.fill();
  cx.fillStyle = rk; cx.beginPath(); cx.moveTo(C.x - ar, C.y); cx.lineTo(C.x - ar * 0.7, C.y + ar + dep * 0.7); cx.lineTo(C.x - ar * 0.2, C.y + ar + dep); cx.lineTo(C.x + ar * 0.35, C.y + ar + dep * 0.9); cx.lineTo(C.x + ar * 0.75, C.y + ar + dep * 0.6); cx.lineTo(C.x + ar, C.y); cx.closePath(); cx.fill();
  cx.strokeStyle = 'rgba(255,255,255,.25)'; cx.lineWidth = 2; for (let k = -2; k <= 2; k++) { cx.beginPath(); cx.moveTo(C.x + k * ar * 0.3, C.y + ar * 0.8); cx.lineTo(C.x + k * ar * 0.33 + 6, C.y + ar + dep * 0.6); cx.stroke(); }
  // old edge ghost while shrinking
  if (ar < R0 - 2) { cx.setLineDash([6, 8]); cx.strokeStyle = 'rgba(255,80,80,.55)'; cx.lineWidth = 2; cx.beginPath(); cx.arc(C.x, C.y, R0, 0, 7); cx.stroke(); cx.setLineDash([]); }
  // icy top
  const ice = cx.createRadialGradient(C.x - ar * 0.3, C.y - ar * 0.4, ar * 0.1, C.x, C.y, ar); ice.addColorStop(0, '#ffffff'); ice.addColorStop(0.7, '#e3f3ff'); ice.addColorStop(1, '#a9d4f5');
  cx.fillStyle = ice; cx.beginPath(); cx.arc(C.x, C.y, ar, 0, 7); cx.fill();
  cx.lineWidth = Math.max(3, S * 1.6); cx.strokeStyle = '#ffffff'; cx.stroke();
  cx.lineWidth = 2; cx.strokeStyle = 'rgba(80,150,220,.6)'; cx.beginPath(); cx.arc(C.x, C.y, ar - S * 1.5, 0, 7); cx.stroke();
  cx.strokeStyle = 'rgba(255,255,255,.8)'; cx.lineWidth = 2; for (let k = 0; k < 5; k++) { const a = k * 1.3 + 0.4; cx.beginPath(); cx.arc(C.x + Math.cos(a) * ar * 0.4, C.y + Math.sin(a) * ar * 0.4, ar * 0.14, a, a + 1.2); cx.stroke(); }
  if (G0.ar < 30) { cx.globalAlpha = 0.35 + Math.sin(T * 10) * 0.2; cx.strokeStyle = '#ff4060'; cx.lineWidth = 4; cx.beginPath(); cx.arc(C.x, C.y, ar, 0, 7); cx.stroke(); cx.globalAlpha = 1; }
  // snowballs + riders, sorted by y
  const order = G0.p.map((p, i) => i).sort((a, b) => G0.p[a][1] - G0.p[b][1]);
  for (const i of order) {
    const [px, py, pr, rot, cd, fx, fy, fz] = G0.p[i];
    const falling = G0.ph === 'fall' && G0.fall === i;
    const x = sm('snx' + i, px, falling ? 30 : 18, dt), y = sm('sny' + i, py, falling ? 30 : 18, dt), r = sm('snr' + i, pr, 10, dt);
    const k = falling ? Math.max(0, 1 - fz / 1.0) : 1; if (k <= 0) continue;
    const drop = falling ? fz * fz * 60 : 0;
    const sp = toS(x, y + drop), rs = r * S * (falling ? 0.5 + 0.5 * k : 1);
    cx.globalAlpha = falling ? k : 1;
    const fxx = sm('snfx' + i, fx, 8, dt), fyy = sm('snfy' + i, fy, 8, dt);
    const cpos = toS(x - fxx * (r + 3.5), y + drop - fyy * (r + 3.5) + 4);
    const chH = 17 * S * (falling ? k : 1), im = IMG[pchar(i)];
    const drawRider = () => { if (!im.naturalWidth) return; const w = chH * im.naturalWidth / im.naturalHeight; cx.save(); cx.translate(cpos.x, cpos.y); cx.rotate(fxx * 0.25 + Math.sin(T * 14) * 0.04); cx.scale(fxx < -0.1 ? -1 : 1, 1); cx.drawImage(im, -w / 2, -chH, w, chH); cx.restore(); };
    if (!falling) { cx.fillStyle = 'rgba(40,90,150,.25)'; cx.beginPath(); cx.ellipse(sp.x, sp.y + rs * 0.85, rs * 0.95, rs * 0.32, 0, 0, 7); cx.fill(); }
    if (fyy > 0.2) drawRider();
    const bg = cx.createRadialGradient(sp.x - rs * 0.35, sp.y - rs * 0.4, rs * 0.1, sp.x, sp.y, rs); bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.65, '#eef7ff'); bg.addColorStop(1, '#a8cdee');
    cx.fillStyle = bg; cx.beginPath(); cx.arc(sp.x, sp.y, rs, 0, 7); cx.fill();
    cx.lineWidth = Math.max(2, rs * 0.08); cx.strokeStyle = COLORS[i]; cx.stroke();
    // rolling texture
    cx.save(); cx.beginPath(); cx.arc(sp.x, sp.y, rs, 0, 7); cx.clip(); cx.strokeStyle = 'rgba(120,170,220,.45)'; cx.lineWidth = Math.max(1.5, rs * 0.07);
    for (let q = 0; q < 4; q++) { const ph = (rot + q * 1.57) % 6.283, off = Math.sin(ph) * rs; if (Math.cos(ph) < 0) continue; cx.beginPath(); cx.ellipse(sp.x + fxx * off, sp.y + fyy * off, rs * Math.abs(Math.cos(ph)) * 0.25 + 1, rs * 0.9, Math.atan2(fyy, fxx), 0, 7); cx.stroke(); }
    cx.restore();
    if (fyy <= 0.2) drawRider();
    cx.globalAlpha = 1;
    if (!falling) { label(x, y - r - 13, i === me ? 'YOU' : pname(i), COLORS[i]); if (i === me && cd > 0) { const p2 = toS(x, y); cx.strokeStyle = 'rgba(31,155,255,.8)'; cx.lineWidth = 3; cx.beginPath(); cx.arc(p2.x, p2.y, rs + 5, -1.57, -1.57 + 6.283 * (1 - cd / 1.6)); cx.stroke(); } }
    if (!falling && i === me && G0.ph === 'play') { snowCrunch -= dt; const v = Math.hypot(fx, fy); if (snowCrunch <= 0 && joy) { snowCrunch = 0.18; SFX.play('crunch'); } }
    if (!falling && Math.random() < 0.3) parts.push({ x: x - fxx * r, y: y + r * 0.8, vx: -fxx * 10, vy: -8, l: 0.35, c: '#ffffff', s: 1 + Math.random() });
  }
  // falling snow
  cx.fillStyle = 'rgba(255,255,255,.9)'; for (const f of snowFlakes) { f.y += f.v * dt; if (f.y > 1) { f.y = 0; f.x = Math.random(); } cx.beginPath(); cx.arc((f.x + Math.sin(T + f.w) * 0.02) * VW, f.y * VH, f.s, 0, 7); cx.fill(); }
  if (gs && gs.ph === 'ready') label(50, 34, `Bout ${gs.n} · Get ready…`, '#2a6fd6');
  if (gs && gs.ph === 'fall') label(50, 34, `${pname(1 - gs.fall)} knocked ${pname(gs.fall)} off!`, COLORS[1 - gs.fall]);
  if (gs && gs.ph === 'play' && gs.ar < 41.5) label(50, 34, '⚠️ The cliff is crumbling!', '#e0304e');
  if (joy) { cx.globalAlpha = 0.5; cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(joy.x, joy.y, 50, 0, 7); cx.fill(); cx.globalAlpha = 0.9; const dx = joy.cx - joy.x, dy = joy.cy - joy.y, l = Math.min(1, 50 / Math.max(1, Math.hypot(dx, dy))); cx.fillStyle = COLORS[me]; cx.beginPath(); cx.arc(joy.x + dx * l, joy.y + dy * l, 24, 0, 7); cx.fill(); cx.globalAlpha = 1; }
}
function rr(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
const DRAW = { dash: drawDash, treat: drawTreat, fetch: drawFetch, snack: drawSnack, zoomies: drawZoomies, snow: drawSnow, chess: drawChess };

let lastF = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastF) / 1000); lastF = now; const T = now / 1000;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, VW, VH);
  hazelBark = Math.max(0, hazelBark - dt); crashFx = crashFx.map(c => Math.max(0, c - dt));
  const active = room && (room.phase === 'play' || room.phase === 'countdown');
  if (active) {
    if (shakeT > 0) { shakeT -= dt; cx.translate((Math.random() - .5) * 10, (Math.random() - .5) * 10); }
    const g = room.game; if (room.phase === 'countdown' && INFO[g].bg) cover(IMG[INFO[g].bg]); else if (room.phase === 'countdown' && g === 'snow') drawSnow(dt, T); else DRAW[g](dt, T);
    // particles
    for (const p of parts) {
      p.l -= dt; p.x += p.vx * dt; p.y += p.vy * dt; if (!p.txt) p.vy += 60 * dt;
      if (p.scr) { p.sx += p.vx * dt; cx.globalAlpha = Math.max(0, p.l * 3); cx.fillStyle = p.c; cx.fillRect(p.sx, p.sy, 12, 3); continue; }
      const s = toS(p.x, p.y); cx.globalAlpha = Math.max(0, Math.min(1, p.l * 2));
      if (p.txt) { cx.font = `${Math.round(S * 5)}px "Lilita One"`; cx.textAlign = 'center'; cx.lineWidth = S; cx.strokeStyle = '#45208f'; cx.strokeText(p.txt, s.x, s.y); cx.fillStyle = p.c; cx.fillText(p.txt, s.x, s.y); }
      else if (p.e) { cx.font = `${Math.round(S * 4)}px serif`; cx.fillText(p.e, s.x, s.y); }
      else { cx.fillStyle = p.c; cx.beginPath(); cx.arc(s.x, s.y, p.s * S * 0.7, 0, 7); cx.fill(); }
    }
    cx.globalAlpha = 1; parts = parts.filter(p => p.l > 0);
    if (room.phase === 'play') updateHud();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__hp = { get room() { return room; }, get gs() { return gs; }, get me() { return me; }, send };
