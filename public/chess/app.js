'use strict';
import { Chess } from '../vendor/chess.js';
import { Board, ANNO, COLOR_KEYS } from './board.js';
import { Bot, SKILL } from './bot.js';
import { SFX, buzz } from './sfx.js';
import {
  LichessClient, SEEK_CONTROLS, CHALLENGE_EXTRA, CORR_DAYS,
  applyUciMoves, moveToUci, parseUciList, resultFromState, clocksFromState, offerFlags,
  HOST, redirectUri, classifySpeed,
} from './lichess.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const SERVER = /github\.io$/.test(location.hostname) ? 'https://hazel-party.onrender.com' : '';
const token = (() => {
  let t = localStorage.getItem('hc_token');
  if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('hc_token', t); }
  return t;
})();

let myName = localStorage.getItem('hc_name') || '';
let mode = null; // 'online' | 'bot' | 'analysis'
let me = -1, room = null, gs = null, sock = null, online = false;
let chess = new Chess();
let hist = [];           // [{fen, from, to, san}]
let view = null;         // null = live, else ply index
let newMoveWhileReview = false;
let myColor = 'w';
let flipForced = null;
let bot = null, botSkill = 'medium', botThinking = false;
let board = null;
let promoResolver = null;
let ended = false;
let localClk = [300, 300], localTc = { base: 300, inc: 0 }, clkAt = 0, unlimited = false;
let names = { w: 'White', b: 'Black' };

/* ---------- screens ---------- */
function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  document.body.classList.toggle('ingame', id === 's-game');
  if (id === 's-game') requestAnimationFrame(() => board && board.resize());
}
$$('[data-go]').forEach(b => b.addEventListener('click', () => { SFX.play('tap'); show(b.dataset.go); }));

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './' }).catch(() => {});
}
(function a2hs() {
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const dismissed = localStorage.getItem('hc_a2hs') === '1';
  if (iOS && !standalone && !dismissed) {
    const el = $('#a2hs'); el.classList.remove('hidden');
    $('#a2hs-x').onclick = () => { el.classList.add('hidden'); localStorage.setItem('hc_a2hs', '1'); };
  }
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    if (standalone || localStorage.getItem('hc_a2hs') === '1') return;
    const el = $('#a2hs'); el.classList.remove('hidden');
    $('#a2hs p').textContent = 'Install Hazel Chess on your home screen for a full-screen app with arrow drawing.';
    $('#a2hs-x').textContent = 'Install';
    $('#a2hs-x').onclick = async () => {
      el.classList.add('hidden'); localStorage.setItem('hc_a2hs', '1');
      if (deferred) { deferred.prompt(); deferred = null; }
    };
  });
})();

/* ---------- audio / mute ---------- */
$('#b-mute').textContent = SFX.muted ? '🔇' : '🔊';
$('#b-mute').onclick = () => { SFX.init(); $('#b-mute').textContent = SFX.toggleMute() ? '🔇' : '🔊'; };
document.addEventListener('pointerdown', () => SFX.init(), { capture: true, once: false });

/* ---------- home ---------- */
$('#b-online').onclick = () => { SFX.init(); SFX.play('tap'); $('#i-name').value = myName; show('s-online'); };
$('#b-bot').onclick = () => { SFX.init(); SFX.play('tap'); show('s-botsetup'); };
$('#b-analyze').onclick = () => { SFX.init(); SFX.play('tap'); startAnalysis(); };

/* ---------- online setup ---------- */
let tcSel = '300+0', colorSel = 'r';
$('#seg-tc').onclick = e => { const b = e.target.closest('button'); if (!b) return; SFX.play('tap'); tcSel = b.dataset.v; $$('#seg-tc button').forEach(x => x.classList.toggle('sel', x === b)); };
$('#seg-color').onclick = e => { const b = e.target.closest('button'); if (!b) return; SFX.play('tap'); colorSel = b.dataset.v; $$('#seg-color button').forEach(x => x.classList.toggle('sel', x === b)); };

function setNameFromInput() {
  myName = ($('#i-name').value || '').trim().slice(0, 16) || guessName();
  localStorage.setItem('hc_name', myName);
}
function guessName() { return localStorage.getItem('hc_name') || 'Player'; }

function err(m) { $('#t-err').textContent = m || ''; if (m) SFX.play('bad'); }

$('#b-create').onclick = async () => {
  SFX.init(); SFX.play('tap'); setNameFromInput(); err('');
  const ok = await ensureSock();
  if (!ok) return err('Can’t reach the game server right now.');
  const [base, inc] = tcSel.split('+').map(Number);
  sock.emit('create', { name: myName, token, tc: { base, inc }, color: colorSel });
};
$('#b-join').onclick = async () => {
  SFX.init(); SFX.play('tap'); setNameFromInput(); err('');
  const code = $('#i-code').value.trim().toUpperCase();
  if (code.length < 4) return err('Enter the 4-letter code');
  const ok = await ensureSock();
  if (!ok) return err('Can’t reach the game server right now.');
  sock.emit('join', { code, token, name: myName });
};
$('#i-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#b-join').click(); });

$('#b-share').onclick = async () => {
  SFX.play('tap');
  const origin = SERVER || location.origin;
  const path = (location.pathname.endsWith('/') ? location.pathname : location.pathname + '/');
  const url = `${origin}${path}?r=${room && room.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Hazel Chess', text: `Join my chess game! Code ${room.code}`, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied!'); }
  } catch (_) {}
};
$('#b-leave-lobby').onclick = () => { if (sock) sock.emit('leave'); room = null; show('s-home'); };

/* ---------- bot setup ---------- */
let botColorSel = 'w';
$('#seg-botcolor').onclick = e => { const b = e.target.closest('button'); if (!b) return; SFX.play('tap'); botColorSel = b.dataset.v; $$('#seg-botcolor button').forEach(x => x.classList.toggle('sel', x === b)); };
$('#seg-skill').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; SFX.play('tap'); botSkill = b.dataset.v; $$('#seg-skill button').forEach(x => x.classList.toggle('sel', x === b)); };
$('#b-botgo').onclick = () => { SFX.play('pop'); startBotGame(); };

/* ---------- socket ---------- */
function setOnline(ok, msg) {
  online = ok;
  $('#t-srv').innerHTML = ok ? '' : (msg || '🌐 Online play needs the server — bot & analysis work offline.');
}
async function loadIO() {
  if (window.io) return true;
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = (SERVER || '') + '/socket.io/socket.io.js';
    s.onload = () => resolve(!!window.io);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
async function ensureSock() {
  if (sock && sock.connected) return true;
  const ok = await loadIO();
  if (!ok) { setOnline(false); return false; }
  return new Promise(resolve => {
    const s = window.io((SERVER || '') + '/hazelchess', { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity });
    const t = setTimeout(() => resolve(!!s.connected), 25000);
    s.on('connect', () => { setOnline(true); bindSock(s); clearTimeout(t); resolve(true); });
    s.on('connect_error', () => { if (!s.connected) setOnline(false, '📡 Can’t reach the server — bot & analysis still work.'); });
    sock = s;
  });
}
function bindSock(s) {
  if (s._bound) return; s._bound = true;
  s.on('err', m => { err(m); });
  s.on('you', y => {
    me = y.i;
    localStorage.setItem('hc_room', JSON.stringify({ code: y.code, t: Date.now() }));
    const path = location.pathname + (location.pathname.endsWith('/') ? '' : '/');
    history.replaceState(null, '', `${path}?r=${y.code}`);
  });
  s.on('room', onRoom);
  s.on('gs', onGs);
  s.on('fx', onFx);
  s.on('disconnect', () => { if (mode === 'online' && room) toast('📡 Reconnecting…'); });
  s.on('connect', () => {
    const saved = JSON.parse(localStorage.getItem('hc_room') || 'null');
    if (saved && Date.now() - saved.t < 3 * 3600e3) s.emit('join', { code: saved.code, token, name: myName || guessName() });
  });
}
(async () => {
  const ok = await ensureSock();
  setOnline(ok);
  const urlCode = new URLSearchParams(location.search).get('r');
  if (urlCode) {
    $('#i-code').value = urlCode.toUpperCase();
    show('s-online');
    if (ok) { setNameFromInput(); sock.emit('join', { code: urlCode.toUpperCase(), token, name: myName || guessName() }); }
  }
})();

function onRoom(r) {
  room = r;
  if (r.phase === 'lobby') {
    mode = 'online';
    show('s-lobby');
    $('#t-code').textContent = r.code;
    $('#slot0').innerHTML = slotHtml(r, 0);
    $('#slot1').innerHTML = slotHtml(r, 1);
    const tc = r.tc || { base: 300, inc: 0 };
    $('#t-lobbytc').textContent = tc.base ? `${Math.round(tc.base / 60)}+${tc.inc}` : 'Unlimited';
    $('#t-lobbywait').textContent = r.players[1] ? 'Game starting…' : 'Waiting for your opponent…';
  } else if (r.phase === 'play' || r.phase === 'over') {
    mode = 'online';
    if ($('#s-game').classList.contains('on') === false) enterGame();
    renderClocks();
    if (r.phase === 'over' && gs && gs.end !== null && gs.end !== undefined) showResult();
  }
}
function slotHtml(r, i) {
  const p = r.players[i];
  if (!p) return `<div class="slot empty">Waiting…<br>📲</div>`;
  const col = p.color === 'w' ? 'White' : p.color === 'b' ? 'Black' : '';
  return `<div class="slot">${i === me ? '<div class="who">YOU</div>' : ''}<div class="who">${esc(p.name)}</div><div class="col">${col}${p.on ? '' : ' · offline'}</div></div>`;
}

function onGs(g) {
  const prevN = gs ? gs.n : 0;
  const wasOver = !!(gs && gs.end != null);
  gs = g;
  if (wasOver && g.end == null) { ended = false; view = null; newMoveWhileReview = false; $('#result').classList.add('hidden'); enterGame(); }
  clkAt = performance.now();
  localClk = (g.clk || [0, 0]).slice();
  unlimited = !g.clk || (g.clk[0] <= 0 && g.clk[1] <= 0 && !g.n);
  if (g.tc) { unlimited = !g.tc.base; localTc = g.tc; }
  if (typeof g.unlimited === 'boolean') unlimited = g.unlimited;
  if (g.clk && g.clk[0] === 0 && g.clk[1] === 0 && g.tc && g.tc.base === 0) unlimited = true;

  syncFromServer();
  if (g.n > prevN) {
    const last = g.moves && g.moves[g.moves.length - 1];
    if (last) playMoveSound(last);
    if (view !== null) newMoveWhileReview = true;
    else board && board.afterMoveClears();
  }
  applyPosition();
  renderMoves();
  renderNav();
  renderClocks();
  updateTurnChrome();
  if (g.end !== null && g.end !== undefined) showResult();
}
function onFx(e) {
  if (e.t === 'cmove') { /* sound already from onGs */ }
  if (e.t === 'chessend') { SFX.play(e.w === me ? 'win' : e.w < 0 ? 'ding' : 'lose'); }
  if (e.t === 'drawoffer' && e.i !== me) { $('#drawask').classList.remove('hidden'); SFX.play('ding'); }
  if (e.t === 'drawdeclined') { $('#drawask').classList.add('hidden'); toast('Draw declined'); }
  if (e.t === 'joined') SFX.play('join');
}

function syncFromServer() {
  if (!gs) return;
  const moves = gs.moves || [];
  chess = new Chess();
  hist = [{ fen: chess.fen(), from: null, to: null, san: null }];
  for (const m of moves) {
    try { const mv = chess.move({ from: m.from, to: m.to, promotion: m.promo || m.promotion || 'q' }); if (mv) hist.push({ fen: chess.fen(), from: mv.from, to: mv.to, san: mv.san }); } catch (_) {}
  }
  if (room && room.players) {
    const w = gs.white, b = 1 - w;
    names.w = (room.players[w] && room.players[w].name) || 'White';
    names.b = (room.players[b] && room.players[b].name) || 'Black';
    myColor = (me === w) ? 'w' : 'b';
  }
  if (view !== null && view >= hist.length - 1) view = null;
}

/* ---------- start games ---------- */
function enterGame() {
  if (!hist.length) hist = [{ fen: (chess || new Chess()).fen(), from: null, to: null, san: null }];
  ended = false;
  view = null;
  newMoveWhileReview = false;
  $('#result').classList.add('hidden');
  $('#drawask').classList.add('hidden');
  $('#promo').classList.add('hidden');
  show('s-game');
  ensureBoard();
  board.clearAnnotations();
  applyPosition();
  renderMoves();
  renderNav();
  renderClocks();
  updateTurnChrome();
  const analysis = mode === 'analysis';
  const onLi = mode === 'lichess';
  $('#b-resign').style.display = analysis ? 'none' : '';
  $('#b-drawoffer').style.display = (mode === 'online' || onLi) ? '' : 'none';
  $('#m-new').style.display = analysis || mode === 'bot' ? '' : 'none';
  $('#m-hint').style.display = analysis || mode === 'bot' ? '' : 'none';
  $('#m-loadfen').style.display = analysis ? '' : 'none';
  $$('#b-abort,#b-takeback,#b-ligame,#m-chat,#m-ligame').forEach(el => el && el.classList.toggle('hidden', !onLi));
  if (onLi && liGameId) {
    const href = HOST + '/' + liGameId;
    $('#b-ligame').onclick = () => window.open(href, '_blank');
    $('#m-ligame').href = href;
  }
}

function startAnalysis() {
  mode = 'analysis';
  chess = new Chess();
  hist = [{ fen: chess.fen(), from: null, to: null, san: null }];
  myColor = 'w';
  names = { w: 'White', b: 'Black' };
  unlimited = true;
  localClk = [0, 0];
  ended = false;
  view = null;
  enterGame();
  toast('Free board — both sides can move. Draw arrows anytime.');
}

function startBotGame(fromFen) {
  mode = 'bot';
  if (!bot) bot = new Bot();
  let col = botColorSel;
  if (col === 'r') col = Math.random() < 0.5 ? 'w' : 'b';
  myColor = col;
  chess = fromFen ? new Chess(fromFen) : new Chess();
  hist = [{ fen: chess.fen(), from: null, to: null, san: null }];
  if (fromFen && chess.history({ verbose: true }).length) {
    // start from a mid-game fen only (no history)
  }
  names = { w: myColor === 'w' ? 'You' : 'Hazel Bot', b: myColor === 'b' ? 'You' : 'Hazel Bot' };
  unlimited = true;
  localClk = [0, 0];
  ended = false;
  view = null;
  enterGame();
  if (chess.turn() !== myColor) botMove();
}

/* ---------- board ---------- */
function ensureBoard() {
  if (board) return board;
  const cv = $('#board');
  board = new Board(cv, {
    onMove: (from, to) => tryMove(from, to),
    canMoveFrom: (sq, piece) => {
      if (ended || view !== null) return false;
      if (mode === 'analysis') return true;
      const turn = chess.turn();
      const isWhite = piece === piece.toUpperCase();
      if ((turn === 'w') !== isWhite) return false;
      if (mode === 'bot' && botThinking) return false;
      return (turn === myColor);
    },
    onAnno: () => {},
  });
  window.__hc = api();
  return board;
}

function legalMap(ch) {
  const legal = {};
  if (ch.isGameOver()) return legal;
  for (const m of ch.moves({ verbose: true })) (legal[m.from] = legal[m.from] || []).push(m.to);
  return legal;
}

function displayed() {
  if (!hist.length) return { fen: (chess || new Chess()).fen(), from: null, to: null, san: null };
  const i = view === null ? hist.length - 1 : view;
  return hist[Math.max(0, Math.min(hist.length - 1, i))] || hist[0];
}

function applyPosition() {
  if (!board) return;
  const d = displayed();
  const reviewing = view !== null;
  const ch = new Chess(d.fen);
  const legal = (!reviewing && !ended) ? legalMap(ch) : {};
  // For analysis, legal for whichever side is to move
  const flip = flipForced != null ? flipForced : (myColor === 'b');
  board.setTurn(ch.turn());
  board.setPosition({
    fen: d.fen, last: d.from ? [d.from, d.to] : null, legal, chk: ch.inCheck(),
    flip, viewOnly: reviewing || ended || (mode !== 'analysis' && ch.turn() !== myColor) || botThinking,
    n: view === null ? hist.length : view,
  });
  // viewOnly should only block moves, not when it's our turn. Fix:
  const canPlay = !reviewing && !ended && (mode === 'analysis' || (ch.turn() === myColor && !botThinking));
  board.viewOnly = !canPlay;
  renderReviewBanner();
}

function renderReviewBanner() {
  const el = $('#review-banner');
  if (view === null) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.classList.toggle('new', newMoveWhileReview);
  const d = hist[view];
  const label = view === 0 ? 'Start position' : `Viewing move ${view}/${hist.length - 1} · ${d.san || ''}`;
  const sub = newMoveWhileReview
    ? 'New move played — tap ⏭ LIVE to return'
    : 'Read-only · tap ⏭ LIVE to return';
  el.innerHTML = `${esc(label)}<small>${sub}</small>`;
}

async function tryMove(from, to) {
  if (ended || view !== null) return;
  const ch = chess;
  const legal = ch.moves({ verbose: true }).filter(m => m.from === from && m.to === to);
  if (!legal.length) { SFX.play('bad'); return; }
  let promo = undefined;
  if (legal.some(m => m.promotion)) {
    const opts = [...new Set(legal.map(m => m.promotion))];
    promo = await pickPromo(opts, ch.get(from).color);
    if (!promo) return; // cancelled
  } else promo = legal[0].promotion;
  if (mode === 'online') {
    sock.emit('move', { from, to, promo });
    return;
  }
  if (mode === 'lichess') {
    const uci = moveToUci({ from, to, promotion: promo });
    const mv = ch.move({ from, to, promotion: promo });
    if (mv) {
      hist.push({ fen: ch.fen(), from: mv.from, to: mv.to, san: mv.san, promo: mv.promotion, uci });
      view = null;
      playMoveSound(mv);
      board.afterMoveClears();
      applyPosition(); renderMoves(); renderNav(); updateTurnChrome();
    }
    try { await li.move(liGameId, uci); }
    catch (e) {
      if (liState) applyLiState(liState);
      SFX.play('bad'); toast(e.message || 'Move failed');
    }
    return;
  }
  const mv = ch.move({ from, to, promotion: promo });
  if (!mv) return;
  hist = hist.slice(0, (view === null ? hist.length : view + 1));
  // if we were reviewing in analysis, truncate already handled — we only allow moves at live
  hist.push({ fen: ch.fen(), from: mv.from, to: mv.to, san: mv.san });
  view = null;
  playMoveSound(mv);
  board.afterMoveClears();
  applyPosition();
  renderMoves();
  renderNav();
  updateTurnChrome();
  if (ch.isGameOver()) { ended = true; showResult(); return; }
  if (mode === 'bot' && ch.turn() !== myColor) botMove();
}

function playMoveSound(mv) {
  if (mv.captured || mv.flags && String(mv.flags).includes('c')) SFX.play('capture');
  else if (mv.flags && (mv.flags.includes('k') || mv.flags.includes('q'))) SFX.play('castle');
  else SFX.play('move');
  const tmp = new Chess((hist[hist.length - 1] && hist[hist.length - 1].fen) || chess.fen());
  if (tmp.inCheck()) setTimeout(() => SFX.play('check'), 140);
  buzz(mv.captured ? 40 : 12);
}

async function botMove() {
  if (ended || mode !== 'bot') return;
  botThinking = true;
  updateTurnChrome();
  applyPosition();
  const sk = SKILL[botSkill] || SKILL.medium;
  try {
    const mv = await bot.think(chess.fen(), sk);
    if (!mv || ended) { botThinking = false; applyPosition(); return; }
    const played = chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
    if (played) {
      hist.push({ fen: chess.fen(), from: played.from, to: played.to, san: played.san });
      if (view !== null) newMoveWhileReview = true;
      else board.afterMoveClears();
      playMoveSound(played);
    }
  } catch (e) { console.warn(e); }
  botThinking = false;
  applyPosition();
  renderMoves();
  renderNav();
  updateTurnChrome();
  if (chess.isGameOver()) { ended = true; showResult(); }
}

function pickPromo(opts, color) {
  return new Promise(resolve => {
    const el = $('#promo');
    const pieces = { q: 'Q', r: 'R', b: 'B', n: 'N' };
    el.innerHTML = opts.map(p => {
      const n = (color === 'w' ? 'w' : 'b') + pieces[p];
      return `<button data-p="${p}"><img src="../art/chess/${n}.svg" alt="${p}"></button>`;
    }).join('');
    el.classList.remove('hidden');
    promoResolver = (v) => { el.classList.add('hidden'); promoResolver = null; resolve(v); };
    el.onclick = e => { const b = e.target.closest('button'); if (b) promoResolver(b.dataset.p); };
  });
}

/* ---------- clocks / chrome ---------- */
function fmtClk(s) {
  if (unlimited || s == null) return '∞';
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
function renderClocks() {
  const turn = (view === null ? chess : new Chess(displayed().fen)).turn();
  // clocks [white, black]
  let cw = localClk[0], cb = localClk[1];
  if (mode === 'lichess' && liState) {
    const c = clocksFromState(liState, liStateAt);
    unlimited = c.unlimited || !!(liFull && liFull.daysPerTurn);
    cw = c.w; cb = c.b;
    localClk = [cw, cb];
    if (liFull && liFull.daysPerTurn) { cw = null; cb = null; }
  }
  if (mode === 'online' && gs && gs.end == null && !unlimited && room && room.phase === 'play') {
    const bothOn = !room.players || room.players.every(p => p && p.on);
    if (bothOn) {
      const elapsed = (performance.now() - clkAt) / 1000;
      if (gs.turn === 'w') cw = Math.max(0, (gs.clk[0] || 0) - elapsed);
      else cb = Math.max(0, (gs.clk[1] || 0) - elapsed);
    }
  }
  const oppC = myColor === 'w' ? 'b' : 'w';
  $('#n-me').textContent = names[myColor] + (mode !== 'analysis' ? '' : '');
  $('#n-opp').textContent = names[oppC] + (botThinking && chess.turn() !== myColor ? ' · thinking' : '');
  const corr = mode === 'lichess' && liFull && liFull.daysPerTurn;
  $('#c-me').textContent = corr ? (liFull.daysPerTurn + 'd') : fmtClk(myColor === 'w' ? cw : cb);
  $('#c-opp').textContent = corr ? (liFull.daysPerTurn + 'd') : fmtClk(oppC === 'w' ? cw : cb);
  const hot = v => !unlimited && v < 20 && v > 0;
  $('#c-me').classList.toggle('hot', hot(myColor === 'w' ? cw : cb));
  $('#c-opp').classList.toggle('hot', hot(oppC === 'w' ? cw : cb));
  $('#pl-me').classList.toggle('turn', !ended && turn === myColor);
  $('#pl-opp').classList.toggle('turn', !ended && turn !== myColor);
}
function updateTurnChrome() {
  const turn = chess.turn();
  const review = view !== null;
  let st = '';
  if (ended) st = 'Game over';
  else if (review) st = 'Review';
  else if (mode === 'analysis') st = turn === 'w' ? 'White' : 'Black';
  else if (botThinking) st = 'Thinking';
  else st = turn === myColor ? 'Your move' : 'Waiting';
  $('#gstatus').textContent = st;
  renderClocks();
}
setInterval(() => { if ((mode === 'online' && gs && gs.end == null) || (mode === 'lichess' && liState && !ended)) renderClocks(); }, 200);

/* ---------- move list + nav ---------- */
function renderMoves() {
  const el = $('#movelist');
  const cur = view === null ? hist.length - 1 : view;
  let html = '';
  for (let i = 1; i < hist.length; i++) {
    if (i % 2 === 1) html += `<span class="mn">${Math.ceil(i / 2)}.</span>`;
    html += `<span class="mv${i === cur ? ' cur' : ''}" data-i="${i}">${esc(hist[i].san)}</span>`;
  }
  el.innerHTML = html || '<span style="opacity:.5">No moves yet</span>';
  const curEl = el.querySelector('.mv.cur');
  if (curEl) curEl.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}
$('#movelist').onclick = e => {
  const b = e.target.closest('.mv'); if (!b) return;
  SFX.play('tap'); goView(+b.dataset.i);
};

function goView(v) {
  const live = hist.length - 1;
  if (v === 'live' || v >= live) { view = null; newMoveWhileReview = false; }
  else if (v === 'first') view = 0;
  else view = Math.max(0, Math.min(live, v));
  if (view === live) { view = null; newMoveWhileReview = false; }
  board.sel = null;
  applyPosition();
  renderMoves();
  renderNav();
  updateTurnChrome();
}
function renderNav() {
  const live = Math.max(0, hist.length - 1);
  const v = view === null ? live : view;
  const set = (id, dis) => { const b = $(id); b.disabled = dis; };
  set('#c-first', v <= 0); set('#c-prev', v <= 0);
  set('#c-next', v >= live); set('#c-live', v >= live);
  const lb = $('#c-live');
  lb.classList.toggle('alert', view !== null);
  lb.textContent = view !== null ? (newMoveWhileReview ? 'LIVE' : '⏭') : '⏭';
}
$('#c-first').onclick = () => { SFX.play('tap'); goView('first'); };
$('#c-prev').onclick = () => { SFX.play('tap'); goView((view === null ? hist.length - 1 : view) - 1); };
$('#c-next').onclick = () => { SFX.play('tap'); goView((view === null ? hist.length - 1 : view) + 1); };
$('#c-live').onclick = () => { SFX.play('tap'); goView('live'); };
addEventListener('keydown', e => {
  if (!$('#s-game').classList.contains('on')) return;
  if (e.target.matches('input,textarea')) return;
  if (e.code === 'ArrowLeft') goView((view === null ? hist.length - 1 : view) - 1);
  if (e.code === 'ArrowRight') goView((view === null ? hist.length - 1 : view) + 1);
  if (e.code === 'Home') goView('first');
  if (e.code === 'End') goView('live');
  if (e.code === 'KeyD') toggleDraw();
  if (e.code === 'Escape' && board && board.drawMode) { board.setDrawMode(false); syncDrawBtn(); }
});

/* ---------- annotations UI ---------- */
function toggleDraw() {
  board.setDrawMode(!board.drawMode);
  syncDrawBtn();
  SFX.play('tap'); buzz(8);
  if (board.drawMode) toast('Draw mode — drag to arrow, tap to highlight');
}
function syncDrawBtn() {
  $('#b-draw').classList.toggle('on', board.drawMode);
  $('#b-draw').setAttribute('aria-pressed', board.drawMode ? 'true' : 'false');
}
$('#b-draw').onclick = () => { SFX.init(); toggleDraw(); };
$('#b-clear').onclick = () => { SFX.play('tap'); board.clearAnnotations(); };
$('#c-clearmove').onchange = e => board.setClearOnMove(e.target.checked);
$('#swatches').onclick = e => {
  const b = e.target.closest('.sw'); if (!b) return;
  SFX.play('tap');
  board.setColor(b.dataset.c);
  $$('.sw').forEach(x => x.classList.toggle('sel', x === b));
};

/* ---------- actions ---------- */
$('#b-flip').onclick = () => {
  SFX.play('tap');
  const cur = flipForced != null ? flipForced : (myColor === 'b');
  flipForced = !cur;
  applyPosition();
};
$('#b-resign').onclick = () => {
  if (ended || mode === 'analysis') return;
  if (!confirm('Resign this game?')) return;
  if (mode === 'online') sock.emit('resign');
  else if (mode === 'lichess') li.resign(liGameId).catch(e => toast(e.message));
  else { ended = true; chess._hcResign = myColor; showResult('resign'); }
};
$('#b-drawoffer').onclick = () => {
  SFX.play('tap');
  if (mode === 'online' && sock) { sock.emit('offerdraw'); toast('Draw offered'); }
  else if (mode === 'lichess') { li.draw(liGameId, true).catch(e => toast(e.message)); toast('Draw offered'); }
};
$('#b-drawyes').onclick = () => {
  if (mode === 'lichess') li.draw(liGameId, true).catch(e => toast(e.message));
  else sock && sock.emit('offerdraw');
  $('#drawask').classList.add('hidden');
};
$('#b-drawno').onclick = () => {
  if (mode === 'lichess') li.draw(liGameId, false).catch(e => toast(e.message));
  else sock && sock.emit('declinedraw');
  $('#drawask').classList.add('hidden');
};
$('#b-pgn').onclick = async () => {
  SFX.play('tap');
  const pgn = toPGN();
  try { await navigator.clipboard.writeText(pgn); toast('PGN copied'); }
  catch { prompt('Copy PGN:', pgn); }
};

$('#b-menu').onclick = () => $('#menu').classList.remove('hidden');
$('#m-close').onclick = () => $('#menu').classList.add('hidden');
$('#menu').onclick = e => { if (e.target.id === 'menu') $('#menu').classList.add('hidden'); };
$('#m-leave').onclick = leave;
$('#b-home').onclick = leave;
$('#m-fen').onclick = async () => {
  const fen = (view === null ? chess : new Chess(displayed().fen)).fen();
  try { await navigator.clipboard.writeText(fen); toast('FEN copied'); } catch { prompt('FEN', fen); }
  $('#menu').classList.add('hidden');
};
$('#m-loadfen').onclick = () => {
  const f = prompt('Paste a FEN:');
  $('#menu').classList.add('hidden');
  if (!f) return;
  try {
    chess = new Chess(f);
    hist = [{ fen: chess.fen(), from: null, to: null, san: null }];
    view = null; ended = false;
    applyPosition(); renderMoves(); renderNav(); updateTurnChrome();
  } catch { toast('Invalid FEN'); SFX.play('bad'); }
};
$('#m-new').onclick = () => {
  $('#menu').classList.add('hidden');
  if (mode === 'analysis') startAnalysis();
  else if (mode === 'bot') startBotGame();
};
$('#m-hint').onclick = async () => {
  $('#menu').classList.add('hidden');
  if (mode === 'lichess') { toast('Hints are off in Lichess games (fair play)'); return; }
  if (!bot) bot = new Bot();
  toast('Thinking of a hint…');
  const fen = (view === null ? chess : new Chess(displayed().fen)).fen();
  const mv = await bot.think(fen, SKILL.hard);
  if (mv) {
    board._toggleArrow(mv.from, mv.to, 'green');
    board.render();
    toast(`Hint: ${mv.san}`);
  } else toast('No hint');
};
$('#b-rematch').onclick = () => {
  SFX.play('pop');
  if (mode === 'online' && sock) sock.emit('rematch');
  else if (mode === 'bot') { myColor = myColor === 'w' ? 'b' : 'w'; startBotGame(); }
  else if (mode === 'lichess') liRematch();
  else startAnalysis();
};

function leave() {
  $('#menu').classList.add('hidden');
  $('#result').classList.add('hidden');
  $('#lichat').classList.add('hidden');
  $('#claimask').classList.add('hidden');
  $('#takebackask').classList.add('hidden');
  if (mode === 'online' && sock) sock.emit('leave');
  const wasLi = mode === 'lichess';
  if (wasLi) { li.closeGame(); liGameId = null; liFull = null; liState = null; }
  mode = null; room = null; gs = null; ended = false;
  if (wasLi && li.loggedIn) showLichess();
  else show('s-home');
}

function showResult(why) {
  if (!$('#result').classList.contains('hidden')) return;
  const ch = chess;
  let title = 'Game over', sub = '', iWon = false, draw = false;
  const reason = why || (gs && gs.res) || (ch.isCheckmate() ? 'checkmate' : ch.isStalemate() ? 'stalemate' : ch.isDraw() ? 'draw' : (ch._hcResign ? 'resign' : ''));
  if (reason === 'checkmate') {
    const winner = ch.turn() === 'w' ? 'b' : 'w';
    iWon = mode === 'analysis' ? false : winner === myColor;
    title = iWon ? 'Checkmate — you win!' : (mode === 'analysis' ? (winner === 'w' ? 'White wins' : 'Black wins') : 'Checkmate — you lose');
    sub = 'By checkmate';
  } else if (reason === 'resign') {
    const loser = ch._hcResign || (gs && gs.end === me ? myColor : (myColor === 'w' ? 'b' : 'w'));
    // gs.end is winner player index
    if (gs && gs.end !== null && gs.end !== undefined && gs.end >= 0) iWon = gs.end === me;
    else iWon = loser !== myColor;
    title = iWon ? 'Opponent resigned' : 'You resigned';
    sub = 'Resignation';
  } else if (reason === 'timeout') {
    iWon = gs && gs.end === me;
    title = iWon ? 'You win on time' : 'Out of time';
    sub = 'Flag fell';
  } else if (reason === 'agree' || reason === 'draw' || reason === 'stalemate' || reason === 'threefold' || reason === 'fifty' || reason === 'material') {
    draw = true;
    title = reason === 'stalemate' ? 'Stalemate' : 'Draw';
    sub = ({ agree: 'By agreement', stalemate: 'Stalemate', threefold: 'Threefold repetition', fifty: 'Fifty-move rule', material: 'Insufficient material', draw: 'Draw' })[reason] || 'Draw';
  } else {
    if (ch.isCheckmate()) return showResult('checkmate');
    if (ch.isDraw()) return showResult(ch.isStalemate() ? 'stalemate' : 'draw');
    title = 'Game over';
  }
  if (!why && mode !== 'online') { if (iWon) SFX.play('win'); else if (draw) SFX.play('ding'); else SFX.play('lose'); }
  $('#r-title').textContent = title;
  $('#r-sub').textContent = sub;
  $('#b-rematch').style.display = mode === 'analysis' ? 'none' : '';
  const a = $('#b-li-openresult');
  if (a) {
    if (mode === 'lichess' && liGameId) { a.style.display = ''; a.href = HOST + '/' + liGameId; }
    else a.style.display = 'none';
  }
  $('#result').classList.remove('hidden');
  applyPosition();
  ended = true;
}

function toPGN() {
  const res = ended ? (chess.isCheckmate() ? (chess.turn() === 'b' ? '1-0' : '0-1') : '1/2-1/2') : '*';
  const ev = mode === 'bot' ? 'Hazel Chess vs Bot' : mode === 'online' ? `Hazel Chess ${room && room.code || ''}` : 'Hazel Chess Analysis';
  let s = `[Event "${ev}"]\n[White "${names.w}"]\n[Black "${names.b}"]\n[Result "${res}"]\n\n`;
  for (let i = 1; i < hist.length; i++) {
    if (i % 2 === 1) s += `${Math.ceil(i / 2)}. `;
    s += hist[i].san + ' ';
  }
  return s.trim() + ' ' + res + '\n';
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(m) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);background:#000c;color:#fff;padding:10px 16px;border-radius:14px;z-index:20;font:16px Fredoka,sans-serif;font-weight:700;text-align:center;pointer-events:none;transition:opacity .3s'; document.getElementById('app').appendChild(t); }
  t.textContent = m; t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.opacity = '0'; }, 1800);
}

function api() {
  return {
    get board() { return board; },
    get chess() { return chess; },
    get hist() { return hist; },
    get view() { return view; },
    get mode() { return mode; },
    get room() { return room; },
    get gs() { return gs; },
    get myColor() { return myColor; },
    sqClient(sq) { return board.sqClient(sq); },
    goView,
    get lichess() { return li; },
    get liGame() { return liFull; },
    get liState() { return liState; },
  };
}
window.__hc = api();

/* ---------- Lichess ---------- */
const li = new LichessClient();
let liGameId = null, liFull = null, liState = null, liStateAt = 0;
let liIncoming = {}, liOutgoing = {}, liGames = {}, liSeekRated = false, liSeekColor = 'random';
let liChalRated = false, liChalColor = 'random', liChalTc = SEEK_CONTROLS[2]; // 15+10
let liWaitKind = null, liWaitId = null;

function liErr(m) {
  const a = $('#t-lierr'), b = $('#t-lierr2');
  if (a) a.textContent = m || '';
  if (b) b.textContent = m || '';
  if (m) SFX.play('bad');
}
function liPlayerName(p) {
  if (!p) return 'Opponent';
  const t = p.title ? p.title + ' ' : '';
  const r = p.rating ? ` (${p.rating}${p.provisional ? '?' : ''})` : '';
  return t + (p.name || p.id || 'Anonymous') + r;
}
function liRatingLine(me) {
  if (!me || !me.perfs) return '';
  const keys = [['rapid', 'Rapid'], ['classical', 'Classical'], ['correspondence', 'Corr'], ['blitz', 'Blitz']];
  return keys.map(([k, lab]) => {
    const p = me.perfs[k];
    return p && p.rating ? `${lab} ${p.rating}${p.prov ? '?' : ''}` : null;
  }).filter(Boolean).join(' · ');
}

function fillTcGrid(el, list, onPick, selectedId) {
  el.innerHTML = list.map((t) =>
    `<button type="button" data-id="${t.id}" class="${t.id === selectedId ? 'sel' : ''}"><b>${t.label}</b><small>${t.speed}</small></button>`
  ).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const t = list.find((x) => x.id === b.dataset.id); if (!t) return;
    SFX.play('tap');
    $$('button', el).forEach((x) => x.classList.toggle('sel', x === b));
    onPick(t);
  };
}

function showWaiting(title, sub, kind) {
  liWaitKind = kind;
  $('#li-wait-title').textContent = title;
  $('#li-wait-sub').textContent = sub || '';
  $('#li-waiting').classList.remove('hidden');
}
function hideWaiting({ cancel = false } = {}) {
  const kind = liWaitKind, id = liWaitId;
  liWaitKind = null;
  liWaitId = null;
  $('#li-waiting').classList.add('hidden');
  li.cancelSeek();
  li.cancelChallenge();
  if (cancel && kind === 'challenge' && id) {
    li.cancelChallengeId(id).then(() => { delete liOutgoing[id]; renderLiLists(); }).catch(() => {});
  }
}
$('#b-li-cancelwait').onclick = () => { SFX.play('tap'); hideWaiting({ cancel: true }); };

$('#b-lichess').onclick = () => { SFX.init(); SFX.play('tap'); showLichess(); };

async function showLichess() {
  show('s-lichess');
  liErr('');
  const on = li.loggedIn;
  $('#li-loggedout').classList.toggle('hidden', on);
  $('#li-loggedin').classList.toggle('hidden', !on);
  if (!on) return;
  try {
    if (!li.me) await li.account();
    const me = li.me;
    $('#li-user').textContent = '@' + (me.username || me.id);
    $('#li-ratings').textContent = liRatingLine(me);
    startEventStream();
    refreshLiLists();
  } catch (e) {
    if (e.status === 401) { await li.logout(); showLichess(); liErr('Session expired — please sign in again.'); return; }
    liErr(e.message || 'Could not reach Lichess');
  }
}

$('#b-lilogin').onclick = async () => {
  SFX.init(); SFX.play('tap');
  try { location.href = await li.login(); }
  catch (e) { liErr(e.message); }
};
$('#b-lilogout').onclick = async () => {
  SFX.play('tap');
  await li.logout();
  showLichess();
};

function startEventStream() {
  if (li._eventAbort) return;
  (async function loop() {
    while (li.loggedIn) {
      try {
        const { done } = await li.openEventStream(onLiEvent);
        await done;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.warn('event stream', e);
      }
      if (!li.loggedIn) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();
}

function onLiEvent(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'gameStart') {
    const id = (msg.game && (msg.game.gameId || msg.game.id));
    hideWaiting();
    if (id && (mode !== 'lichess' || liGameId !== id)) startLichessGame(id);
  }
  if (msg.type === 'gameFinish') {
    const id = msg.game && (msg.game.gameId || msg.game.id);
    delete liGames[id];
    renderLiLists();
  }
  if (msg.type === 'challenge') {
    const c = msg.challenge; if (!c) return;
    const mine = li.me && (c.challenger && c.challenger.id === li.me.id);
    const dir = c.direction || (mine ? 'out' : 'in');
    if (dir === 'in') liIncoming[c.id] = c; else liOutgoing[c.id] = c;
    renderLiLists();
  }
  if (msg.type === 'challengeCanceled' || msg.type === 'challengeDeclined') {
    const c = msg.challenge; if (c) { delete liIncoming[c.id]; delete liOutgoing[c.id]; }
    if (msg.type === 'challengeDeclined' && liWaitKind === 'challenge') { hideWaiting(); toast('Challenge declined'); }
    if (msg.type === 'challengeCanceled') { /* no-op */ }
    renderLiLists();
  }
}

async function refreshLiLists() {
  try {
    const og = await li.ongoing();
    liGames = {};
    (og.nowPlaying || []).forEach((g) => { liGames[g.gameId] = g; });
  } catch (_) {}
  renderLiLists();
}

function renderLiLists() {
  const cardCh = (c, incoming) => {
    const who = incoming ? (c.challenger || {}) : (c.destUser || {});
    const tc = c.timeControl || {};
    let time = c.perf && c.perf.name || c.speed || '';
    if (tc.type === 'clock') time = `${Math.round((tc.limit || 0) / 60)}+${tc.increment || 0}`;
    else if (tc.type === 'correspondence') time = (tc.daysPerTurn || '') + ' day';
    else if (tc.type === 'unlimited') time = 'Unlimited';
    const rated = c.rated ? 'Rated' : 'Casual';
    const btns = incoming
      ? `<button class="mid green" data-act="accept" data-id="${esc(c.id)}">Accept</button><button class="mid" data-act="decline" data-id="${esc(c.id)}">Decline</button>`
      : `<button class="mid" data-act="cancel" data-id="${esc(c.id)}">Cancel</button>`;
    return `<div class="li-card"><div class="who">${esc(who.name || who.id || 'Player')}</div>${btns}<div class="meta">${esc(time)} · ${rated}${who.rating ? ' · ' + who.rating : ''}</div></div>`;
  };
  const ins = Object.values(liIncoming);
  const outs = Object.values(liOutgoing);
  const games = Object.values(liGames);
  $('#li-incoming').innerHTML = ins.length ? ins.map((c) => cardCh(c, true)).join('') : '<div class="li-empty">None right now</div>';
  $('#li-outgoing').innerHTML = outs.length ? outs.map((c) => cardCh(c, false)).join('') : '<div class="li-empty">None right now</div>';
  $('#li-games').innerHTML = games.length ? games.map((g) => {
    const opp = (g.opponent && (g.opponent.username || g.opponent.id)) || 'Opponent';
    const turn = g.isMyTurn ? 'Your turn' : 'Their turn';
    return `<div class="li-card"><div class="who">${esc(opp)}</div><button class="mid green" data-act="resume" data-id="${esc(g.gameId)}">Resume</button><div class="meta">${esc(g.perf || g.speed || '')} · ${turn}${g.rated ? ' · Rated' : ''}</div></div>`;
  }).join('') : '<div class="li-empty">None</div>';
}

$('#li-incoming').onclick = $('#li-outgoing').onclick = $('#li-games').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  SFX.play('tap');
  try {
    if (act === 'accept') { await li.acceptChallenge(id); delete liIncoming[id]; }
    else if (act === 'decline') { await li.declineChallenge(id); delete liIncoming[id]; }
    else if (act === 'cancel') { await li.cancelChallengeId(id); delete liOutgoing[id]; hideWaiting(); }
    else if (act === 'resume') startLichessGame(id);
    renderLiLists();
  } catch (err) { liErr(err.message); }
};

// seek / challenge setup
(function setupLiControls() {
  fillTcGrid($('#li-seek-tc'), SEEK_CONTROLS, (t) => startSeek(t), null);
  $('#li-seek-corr').innerHTML = CORR_DAYS.map((d) => `<button data-days="${d}">${d} day${d > 1 ? 's' : ''}</button>`).join('');
  $('#li-seek-corr').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    SFX.play('tap');
    startSeek({ days: +b.dataset.days, label: b.dataset.days + ' day correspondence', speed: 'correspondence' });
  };
  $('#li-seek-rated').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; SFX.play('tap'); liSeekRated = b.dataset.v === '1'; $$('#li-seek-rated button').forEach((x) => x.classList.toggle('sel', x === b)); };
  $('#li-seek-color').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; SFX.play('tap'); liSeekColor = b.dataset.v; $$('#li-seek-color button').forEach((x) => x.classList.toggle('sel', x === b)); };

  const chalList = SEEK_CONTROLS.concat(CHALLENGE_EXTRA);
  fillTcGrid($('#li-chal-tc'), chalList, (t) => { liChalTc = t; }, '15+10');
  $('#li-chal-rated').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; SFX.play('tap'); liChalRated = b.dataset.v === '1'; $$('#li-chal-rated button').forEach((x) => x.classList.toggle('sel', x === b)); };
  $('#li-chal-color').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; SFX.play('tap'); liChalColor = b.dataset.v; $$('#li-chal-color button').forEach((x) => x.classList.toggle('sel', x === b)); };
})();

async function startSeek(t) {
  liErr('');
  const rated = liSeekRated, color = liSeekColor;
  const label = t.days ? t.label : `${t.label} ${t.speed}`;
  showWaiting('Looking for an opponent…', `${rated ? 'Rated' : 'Casual'} ${label}`, 'seek');
  try {
    await li.seek({
      time: t.time, increment: t.inc, days: t.days,
      rated, color: t.days ? undefined : color,
    });
    // connection will stay open until gameStart or cancel; correspondence returns immediately
    if (t.days) {
      $('#li-wait-sub').textContent = 'Correspondence seek is up on Lichess. We’ll open the game when someone accepts.';
    }
  } catch (e) {
    hideWaiting();
    liErr(e.message || 'Seek failed');
  }
}

$('#b-li-challenge').onclick = async () => {
  SFX.play('tap'); liErr('');
  const name = ($('#i-li-friend').value || '').trim();
  if (!name) return liErr('Enter a Lichess username');
  const t = liChalTc;
  showWaiting('Challenge sent', `Waiting for ${name} to accept — ${t.label}`, 'challenge');
  try {
    const r = await li.challenge(name, {
      limit: t.time * 60, increment: t.inc, rated: liChalRated, color: liChalColor,
    });
    let c = r.challenge;
    if (c && c.challenge) c = c.challenge;
    if (c && c.id) { liOutgoing[c.id] = c; liWaitId = c.id; }
    renderLiLists();
  } catch (e) {
    hideWaiting();
    liErr(e.message || 'Challenge failed');
  }
};

$('#b-li-open').onclick = async () => {
  SFX.play('tap'); liErr('');
  try {
    const r = await li.openChallenge({ limit: 15 * 60, increment: 10, rated: liChalRated, name: 'Hazel Chess' });
    const url = r.url || r.challenge && r.challenge.url || (r.id && (HOST + '/' + r.id));
    const el = $('#li-open-url');
    el.classList.remove('hidden');
    const w = r.urlWhite || r.whiteUrl, b = r.urlBlack || r.blackUrl;
    el.innerHTML = `<div>Share this link:</div><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`
      + (w ? `<div style="margin-top:6px">White: <a href="${esc(w)}" target="_blank" rel="noopener">${esc(w)}</a></div>` : '')
      + (b ? `<div>Black: <a href="${esc(b)}" target="_blank" rel="noopener">${esc(b)}</a></div>` : '')
      + `<button class="mid" id="b-li-copylink" style="margin-top:8px">Copy link</button>`;
    const copy = $('#b-li-copylink');
    if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy:', url); } };
    try { if (navigator.share) { /* leave share to the user via copy */ } } catch (_) {}
  } catch (e) { liErr(e.message || 'Could not create link'); }
};

async function startLichessGame(id) {
  mode = 'lichess';
  liGameId = id;
  ended = false;
  view = null;
  newMoveWhileReview = false;
  liFull = null;
  liState = null;
  hideWaiting();
  li.cancelSeek();
  li.cancelChallenge();
  $('#lichat-log').innerHTML = '';
  const go = async () => {
    try {
      const { done } = await li.streamGame(id, onLiGameMsg);
      await done;
      if (mode === 'lichess' && liGameId === id && !ended) {
        await new Promise((r) => setTimeout(r, 1000));
        if (mode === 'lichess' && liGameId === id && !ended) return go();
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (mode === 'lichess' && liGameId === id && !ended) {
        await new Promise((r) => setTimeout(r, 1000));
        if (mode === 'lichess' && liGameId === id && !ended) return go();
      }
      toast(e.message || 'Could not open the game');
      if (mode === 'lichess' && !liFull) showLichess();
    }
  };
  go();
}

function applyLiState(state) {
  const fen0 = (liFull && liFull.initialFen) || 'startpos';
  const r = applyUciMoves(Chess, state.moves, fen0);
  chess = r.chess;
  hist = r.hist;
  if (view !== null && view >= hist.length - 1) { view = null; newMoveWhileReview = false; }
  if (!board) return;
  applyPosition();
  renderMoves();
  renderNav();
  updateTurnChrome();
  renderClocks();
}

function onLiGameMsg(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'gameFull') {
    liFull = msg;
    liState = msg.state;
    liStateAt = Date.now();
    const myId = li.me && li.me.id;
    myColor = (msg.white && msg.white.id === myId) ? 'w' : 'b';
    names = { w: liPlayerName(msg.white), b: liPlayerName(msg.black) };
    unlimited = !msg.clock;
    applyLiState(msg.state);
    enterGame();
    updateLiOffers();
    $('#gstatus').textContent = (chess.turn() === myColor ? 'Your move' : 'Waiting');
  } else if (msg.type === 'gameState') {
    const prevN = liState ? parseUciList(liState.moves).length : 0;
    liState = msg;
    liStateAt = Date.now();
    const n = parseUciList(msg.moves).length;
    const grew = n > prevN;
    if (grew && view !== null) newMoveWhileReview = true;
    const prevFen = hist.length ? hist[hist.length - 1].fen : null;
    applyLiState(msg);
    if (grew) {
      const last = hist[hist.length - 1];
      // skip sound if we already played it optimistically (same last fen)
      if (last && last.fen !== prevFen) {
        const san = last.san || '';
        playMoveSound({
          ...last,
          captured: san.includes('x'),
          flags: san.startsWith('O-O-O') ? 'q' : san.startsWith('O-O') ? 'k' : (san.includes('x') ? 'c' : ''),
        });
      }
      if (view === null && board) board.afterMoveClears();
    }
    updateLiOffers();
    const r = resultFromState(msg, myColor);
    if (r.over) {
      ended = true;
      applyPosition();
      showLiResult(r);
    }
  } else if (msg.type === 'chatLine') {
    appendLiChat(msg);
  } else if (msg.type === 'opponentGone') {
    if (msg.gone && (msg.claimWinInSeconds == null || msg.claimWinInSeconds <= 0)) {
      $('#claimtxt').textContent = 'Opponent has left the game';
      $('#claimask').classList.remove('hidden');
    } else if (msg.gone) {
      toast(`Opponent left — you can claim in ${msg.claimWinInSeconds}s`);
    } else {
      $('#claimask').classList.add('hidden');
    }
  }
}

function updateLiOffers() {
  if (!liState || mode !== 'lichess') return;
  const f = offerFlags(liState, myColor);
  if (f.oppDraw) $('#drawask').classList.remove('hidden');
  else $('#drawask').classList.add('hidden');
  if (f.oppTakeback) $('#takebackask').classList.remove('hidden');
  else $('#takebackask').classList.add('hidden');
  // abort allowed roughly in the opening (no/few moves)
  const n = parseUciList(liState.moves).length;
  $('#b-abort').classList.toggle('hidden', n >= 2 || ended);
}

function showLiResult(r) {
  if (!$('#result').classList.contains('hidden')) return;
  SFX.play(r.iWon ? 'win' : (r.draw || r.why === 'abort' ? 'ding' : 'lose'));
  $('#r-title').textContent = r.title;
  $('#r-sub').textContent = r.sub;
  $('#b-rematch').style.display = '';
  const a = $('#b-li-openresult');
  if (a) { a.style.display = ''; a.href = HOST + '/' + liGameId; }
  $('#result').classList.remove('hidden');
  $('#claimask').classList.add('hidden');
  ended = true;
  applyPosition();
}

async function liRematch() {
  if (!liFull) return;
  const opp = myColor === 'w' ? liFull.black : liFull.white;
  if (!opp || !opp.id) { toast('No opponent to rematch'); return; }
  const clk = liFull.clock;
  show('s-lichess');
  showLichess();
  showWaiting('Rematch sent', 'Waiting for ' + (opp.name || opp.id), 'challenge');
  try {
    const opts = liFull.daysPerTurn
      ? { days: liFull.daysPerTurn, rated: !!liFull.rated, color: 'random' }
      : { limit: clk ? clk.initial / 1000 : 900, increment: clk ? clk.increment / 1000 : 0, rated: !!liFull.rated, color: 'random' };
    const r = await li.challenge(opp.name || opp.id, opts);
    let c = r.challenge;
    if (c && c.challenge) c = c.challenge;
    if (c && c.id) { liOutgoing[c.id] = c; liWaitId = c.id; }
  } catch (e) { hideWaiting(); toast(e.message || 'Rematch failed'); }
}

$('#b-abort').onclick = () => {
  if (mode !== 'lichess' || !liGameId) return;
  if (!confirm('Abort this game?')) return;
  li.abort(liGameId).catch((e) => toast(e.message));
};
$('#b-takeback').onclick = () => {
  if (mode !== 'lichess' || !liGameId) return;
  SFX.play('tap');
  li.takeback(liGameId, true).catch((e) => toast(e.message));
  toast('Takeback requested');
};
$('#b-tbyes').onclick = () => { li.takeback(liGameId, true).catch((e) => toast(e.message)); $('#takebackask').classList.add('hidden'); };
$('#b-tbno').onclick = () => { li.takeback(liGameId, false).catch((e) => toast(e.message)); $('#takebackask').classList.add('hidden'); };
$('#b-claimwin').onclick = () => { li.claimVictory(liGameId).catch((e) => toast(e.message)); $('#claimask').classList.add('hidden'); };
$('#b-claimdraw').onclick = () => { li.claimDraw(liGameId).catch((e) => toast(e.message)); $('#claimask').classList.add('hidden'); };

$('#m-chat').onclick = () => {
  $('#menu').classList.add('hidden');
  $('#lichat').classList.toggle('hidden');
};
function appendLiChat(msg) {
  const log = $('#lichat-log');
  const who = msg.username || msg.user || '';
  const mine = li.me && who && who.toLowerCase() === (li.me.username || li.me.id || '').toLowerCase();
  const d = document.createElement('div');
  d.className = mine ? 'me' : '';
  d.textContent = (mine ? '' : who + ': ') + (msg.text || '');
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  if ($('#lichat').classList.contains('hidden') && !mine) toast((who || 'Chat') + ': ' + (msg.text || ''));
}
$('#lichat-form').onsubmit = (e) => {
  e.preventDefault();
  const t = ($('#lichat-in').value || '').trim();
  if (!t || !liGameId) return;
  $('#lichat-in').value = '';
  li.chat(liGameId, t).catch((err) => toast(err.message));
};

window.__hcLi = {
  client: li,
  login: (loc) => li.login(loc),
  handleRedirect: (loc, st) => li.handleRedirect(loc, st),
  startGame: (id) => startLichessGame(id),
  redirectUri,
  HOST,
  SEEK_CONTROLS,
  CHALLENGE_EXTRA,
  CORR_DAYS,
};

// OAuth return + silent session restore
(async function initLichess() {
  try {
    const r = await li.handleRedirect();
    if (r !== 'none') {
      try { history.replaceState(null, '', redirectUri()); } catch (_) {}
      if (r === 'ok') { SFX.init(); toast('Signed in with Lichess'); await showLichess(); return; }
      show('s-lichess');
      liErr(r === 'denied' ? 'Login cancelled.' : ('Login failed: ' + r));
      return;
    }
  } catch (e) {
    try { history.replaceState(null, '', redirectUri()); } catch (_) {}
    show('s-lichess');
    liErr(e.message || 'Login failed');
    return;
  }
  if (li.loggedIn) {
    try { await li.account(); startEventStream(); }
    catch (e) { if (e.status === 401) await li.logout(); }
  }
})();
