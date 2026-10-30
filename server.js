const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('/health', (q, r) => r.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 5000, pingTimeout: 8000 });

const rooms = new Map();
const GAMES = ['dash', 'treat', 'fetch', 'snack', 'zoomies', 'chess'];
const CHARS = ['ralph', 'jordan'];
const NAMES = { ralph: 'Ralph', jordan: 'Jordan' };
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
function code() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s; do { s = ''; for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)]; } while (rooms.has(s)); return s; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------------- mini games (server authoritative) ----------------
const G = {};
G.dash = {
  dur: 45,
  init() { return { t: this.dur, sc: [0, 0], h: { x: 50, y: 80, tx: 30, ty: 60, sp: 32, cd: 0, retarget: 1 } }; },
  newT(h) { h.tx = rnd(12, 88); h.ty = rnd(22, 145); },
  tick(s, dt, R) {
    const h = s.h; s.t -= dt; h.cd -= dt; h.retarget -= dt;
    h.sp = 32 + (this.dur - s.t) * 0.9;
    const d = dist(h.x, h.y, h.tx, h.ty);
    if (d < 3 || h.retarget < 0) { this.newT(h); h.retarget = rnd(0.6, 1.8); }
    const k = Math.min(1, (h.sp * dt) / Math.max(d, 0.01)); h.x += (h.tx - h.x) * k; h.y += (h.ty - h.y) * k;
    if (Math.random() < dt * 0.25) R.fx({ t: 'bark', x: h.x, y: h.y });
    if (s.t <= 0) return s.sc[0] === s.sc[1] ? -1 : (s.sc[0] > s.sc[1] ? 0 : 1);
  },
  input(s, i, m, R) {
    const h = s.h; if (m.t !== 'tap' || h.cd > 0) return;
    if (dist(m.x, m.y, h.x, h.y) < 15) {
      s.sc[i]++; h.cd = 0.45; R.fx({ t: 'catch', i, x: h.x, y: h.y });
      this.newT(h); h.retarget = 2; h.sp += 10;
    } else R.fx({ t: 'miss', i, x: m.x, y: m.y, only: i });
  },
  view(s) { return { t: s.t, sc: s.sc, h: { x: s.h.x, y: s.h.y, tx: s.h.tx, cd: s.h.cd } }; }
};
G.treat = {
  dur: 40,
  init() { return { t: this.dur, sc: [0, 0], p: [{ x: 35, tx: 35 }, { x: 65, tx: 65 }], it: [], sp: 0.3, id: 1, hx: 50 }; },
  tick(s, dt, R) {
    s.t -= dt; s.sp -= dt;
    const el = this.dur - s.t;
    if (s.sp <= 0) {
      s.sp = Math.max(0.22, 0.5 - el * 0.006);
      const r = Math.random(); const ty = r < 0.1 ? 'cookie' : r < 0.42 ? 'broccoli' : 'bone';
      s.hx = rnd(10, 90);
      s.it.push({ id: s.id++, ty, x: s.hx, y: 18, vy: rnd(38, 52) + el * 0.9, vx: rnd(-6, 6), r: rnd(0, 6) });
    }
    for (const p of s.p) { const d = p.tx - p.x; p.x += clamp(d, -110 * dt, 110 * dt); }
    for (const it of s.it) {
      it.y += it.vy * dt; it.x = clamp(it.x + it.vx * dt, 5, 95);
      if (it.dead) continue;
      if (it.y > 128 && it.y < 146) {
        // closest player gets it
        let best = -1, bd = 11;
        s.p.forEach((p, i) => { const d = Math.abs(p.x - it.x); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) {
          it.dead = 1; const v = it.ty === 'bone' ? 1 : it.ty === 'cookie' ? 3 : -2;
          s.sc[best] = Math.max(0, s.sc[best] + v);
          R.fx({ t: v > 0 ? 'good' : 'bad', i: best, x: it.x, y: it.y, v, ty: it.ty });
        }
      }
    }
    s.it = s.it.filter(it => !it.dead && it.y < 170);
    if (s.t <= 0) return s.sc[0] === s.sc[1] ? -1 : (s.sc[0] > s.sc[1] ? 0 : 1);
  },
  input(s, i, m) { if (m.t === 'x') s.p[i].tx = clamp(+m.x || 50, 6, 94); },
  view(s) { return { t: s.t, sc: s.sc, p: s.p.map(p => p.x), it: s.it.map(o => [o.id, o.ty, +o.x.toFixed(1), +o.y.toFixed(1), o.r]), hx: s.hx }; }
};
G.fetch = {
  goal: 5,
  init() { const s = { sc: [0, 0], n: 0, t: 0 }; this.newRound(s); return s; },
  newRound(s) { s.n++; s.h = { x: rnd(20, 80), y: rnd(30, 95) }; s.th = [null, null]; s.ph = 'aim'; s.rt = 7; s.win = -1; s.spd = 1 + s.n * 0.12; s.seed = [rnd(0, 6), rnd(0, 6)]; },
  ret(s, i, T) { const sd = s.seed[i], sp = s.spd; return { x: 50 + 40 * Math.sin(T * 1.7 * sp + sd), y: 70 + 48 * Math.sin(T * 1.13 * sp + sd * 2.1) }; },
  tick(s, dt, R) {
    s.t += dt;
    if (s.ph === 'aim') {
      s.rt -= dt;
      if (s.rt <= 0) for (let i = 0; i < 2; i++) if (!s.th[i]) { const p = this.ret(s, i, s.t); this.input(s, i, { t: 'throw', x: p.x, y: p.y }, R); }
    } else if (s.ph === 'fly') {
      s.rt -= dt; if (s.rt <= 0) {
        const d0 = dist(s.th[0].x, s.th[0].y, s.h.x, s.h.y), d1 = dist(s.th[1].x, s.th[1].y, s.h.x, s.h.y);
        s.win = d0 < d1 ? 0 : 1; s.sc[s.win]++; s.ph = 'run'; s.rt = 2.2; R.fx({ t: 'fetch', i: s.win, x: s.th[s.win].x, y: s.th[s.win].y });
      }
    } else if (s.ph === 'run') {
      s.rt -= dt; const tg = s.th[s.win]; s.h.x += (tg.x - s.h.x) * Math.min(1, dt * 4); s.h.y += (tg.y - s.h.y) * Math.min(1, dt * 4);
      if (s.rt <= 0) { if (s.sc[s.win] >= this.goal) return s.win; this.newRound(s); }
    }
  },
  input(s, i, m, R) {
    if (m.t !== 'throw' || s.ph !== 'aim' || s.th[i]) return;
    s.th[i] = { x: clamp(+m.x, 4, 96), y: clamp(+m.y, 15, 125) }; R.fx({ t: 'throw', i });
    if (s.th[0] && s.th[1]) { s.ph = 'fly'; s.rt = 1.0; }
  },
  view(s) { return { sc: s.sc, h: s.h, th: s.th.map(t => t ? 1 : 0), land: s.ph === 'aim' ? null : s.th, ph: s.ph, win: s.win, T: s.t, spd: s.spd, seed: s.seed, rt: s.rt, n: s.n }; }
};
G.snack = {
  dur: 45,
  init() { return { t: this.dur, sc: [0, 0], p: [{ x: 30, y: 120, vx: 0, vy: 0, dx: 0, dy: 0, st: 0 }, { x: 70, y: 120, vx: 0, vy: 0, dx: 0, dy: 0, st: 0 }], h: { x: 50, y: 40 }, sn: [], sp: 0, id: 1 }; },
  tick(s, dt, R) {
    s.t -= dt; s.sp -= dt;
    if (s.sp <= 0 && s.sn.length < 6) { s.sp = rnd(0.7, 1.3); const ty = ['pizza', 'cookie', 'bone'][Math.floor(Math.random() * 3)]; s.sn.push({ id: s.id++, ty, x: rnd(14, 86), y: rnd(30, 140) }); }
    for (const p of s.p) {
      p.st -= dt; const acc = p.st > 0 ? 0 : 260;
      p.vx += p.dx * acc * dt; p.vy += p.dy * acc * dt;
      const f = Math.exp(-4 * dt); p.vx *= f; p.vy *= f;
      const sp = Math.hypot(p.vx, p.vy), mx = 55; if (sp > mx && p.st <= 0) { p.vx *= mx / sp; p.vy *= mx / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 12 || p.x > 88) { p.x = clamp(p.x, 12, 88); p.vx *= -0.6; }
      if (p.y < 22 || p.y > 146) { p.y = clamp(p.y, 22, 146); p.vy *= -0.6; }
    }
    const [a, b] = s.p; const d = dist(a.x, a.y, b.x, b.y);
    if (d < 13 && d > 0.01) {
      const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d, ov = 13 - d;
      a.x -= nx * ov / 2; a.y -= ny * ov / 2; b.x += nx * ov / 2; b.y += ny * ov / 2;
      const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rv > 0) {
        const imp = rv * 1.6 + 30;
        a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp;
        const hard = rv > 25; if (hard) { (Math.hypot(a.vx, a.vy) < Math.hypot(b.vx, b.vy) ? b : a).st = 0.35; }
        R.fx({ t: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, hard });
      }
    }
    // hazel chases nearest snack
    const h = s.h; let tgt = null, bd = 1e9;
    for (const n of s.sn) { const dd = dist(h.x, h.y, n.x, n.y); if (dd < bd) { bd = dd; tgt = n; } }
    const hs = 20 + (this.dur - s.t) * 0.55;
    if (tgt) { const k = Math.min(1, hs * dt / Math.max(bd, .01)); h.x += (tgt.x - h.x) * k; h.y += (tgt.y - h.y) * k; h.fl = tgt.x < h.x; }
    for (const n of s.sn) {
      if (n.dead) continue;
      for (let i = 0; i < 2; i++) if (dist(s.p[i].x, s.p[i].y, n.x, n.y) < 10) { n.dead = 1; s.sc[i]++; R.fx({ t: 'grab', i, x: n.x, y: n.y }); break; }
      if (!n.dead && dist(h.x, h.y, n.x, n.y) < 7) { n.dead = 1; R.fx({ t: 'munch', x: n.x, y: n.y }); }
    }
    s.sn = s.sn.filter(n => !n.dead);
    if (s.t <= 0) return s.sc[0] === s.sc[1] ? -1 : (s.sc[0] > s.sc[1] ? 0 : 1);
  },
  input(s, i, m) { if (m.t === 'dir') { let dx = +m.dx || 0, dy = +m.dy || 0; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } s.p[i].dx = dx; s.p[i].dy = dy; } },
  view(s) { return { t: s.t, sc: s.sc, p: s.p.map(p => [+p.x.toFixed(1), +p.y.toFixed(1), p.st > 0 ? 1 : 0, +p.vx.toFixed(0)]), h: [s.h.x, s.h.y, s.h.fl ? 1 : 0], sn: s.sn.map(n => [n.id, n.ty, n.x, n.y]) }; }
};
G.zoomies = {
  len: 1000, dur: 75,
  init() {
    const ob = []; let x = 110; while (x < this.len - 60) { ob.push([Math.round(x), Math.random() < 0.5 ? 'couch' : 'bowl']); x += rnd(70, 130); }
    return { t: this.dur, ob, p: [0, 1].map(() => ({ x: 0, v: 0, j: 0, st: 0, hit: -1, fin: 0 })), fin: [] };
  },
  tick(s, dt, R) {
    s.t -= dt;
    s.p.forEach((p, i) => {
      if (p.fin) return;
      p.st -= dt; p.j = Math.max(0, p.j - dt);
      p.v *= Math.exp(-1.0 * dt); if (p.st > 0) p.v = 0;
      const ox = p.x; p.x += p.v * dt;
      s.ob.forEach(([x], k) => {
        if (ox < x - 4 && p.x >= x - 4 && p.hit !== k) {
          if (p.j <= 0.08 || p.j > 0.62) { p.hit = k; p.st = 0.9; p.v = 0; p.x = x - 6; R.fx({ t: 'crash', i }); }
          else R.fx({ t: 'clear', i, only: i });
        }
      });
      if (p.x >= this.len) { p.fin = 1; p.x = this.len; s.fin.push(i); R.fx({ t: 'finish', i }); }
    });
    if (s.fin.length) return s.fin[0];
    if (s.t <= 0) { const a = s.p[0].x, b = s.p[1].x; return Math.abs(a - b) < 1 ? -1 : (a > b ? 0 : 1); }
  },
  input(s, i, m, R) {
    const p = s.p[i]; if (p.fin || p.st > 0) return;
    if (m.t === 'run') p.v = Math.min(95, p.v + 7);
    if (m.t === 'jump' && p.j <= 0) { p.j = 0.7; R.fx({ t: 'jump', i, only: i }); }
  },
  view(s) { return { t: s.t, ob: s.ob, len: this.len, p: s.p.map(p => [+p.x.toFixed(1), +p.v.toFixed(0), +p.j.toFixed(2), p.st > 0 ? 1 : 0]) }; }
};
G.chess = {
  init() { const white = Math.random() < 0.5 ? 0 : 1; return { c: new Chess(), white, clk: [300, 300], last: null, res: null, end: null }; },
  side(s, i) { return (i === s.white) ? 'w' : 'b'; },
  tick(s, dt, R) {
    if (s.end !== null) { s.endT -= dt; if (s.endT <= 0) return s.end; return; }
    const turnIdx = s.c.turn() === 'w' ? s.white : 1 - s.white;
    s.clk[turnIdx] -= dt;
    if (s.clk[turnIdx] <= 0) { s.clk[turnIdx] = 0; this.finish(s, 1 - turnIdx, 'timeout', R); }
  },
  finish(s, w, why, R) { s.end = w; s.res = why; s.endT = 3; R.fx({ t: 'chessend', w, why }); },
  input(s, i, m, R) {
    if (s.end !== null) return;
    if (m.t === 'resign') return this.finish(s, 1 - i, 'resign', R);
    if (m.t !== 'move' || s.c.turn() !== this.side(s, i)) return;
    let mv; try { mv = s.c.move({ from: m.from, to: m.to, promotion: m.promo || 'q' }); } catch (e) { return; }
    if (!mv) return;
    s.last = [mv.from, mv.to];
    R.fx({ t: 'cmove', cap: !!mv.captured, chk: s.c.inCheck(), san: mv.san });
    if (s.c.isCheckmate()) this.finish(s, i, 'checkmate', R);
    else if (s.c.isDraw() || s.c.isStalemate()) this.finish(s, -1, s.c.isStalemate() ? 'stalemate' : 'draw', R);
  },
  view(s) {
    const legal = {}; if (s.end === null) for (const m of s.c.moves({ verbose: true })) (legal[m.from] = legal[m.from] || []).push(m.to);
    return { fen: s.c.fen(), white: s.white, turn: s.c.turn(), clk: s.clk.map(c => Math.ceil(c)), last: s.last, legal, chk: s.c.inCheck(), end: s.end, res: s.res, n: s.c.history().length };
  }
};

// ---------------- room flow ----------------
function pub(room) {
  return {
    code: room.code, phase: room.phase, host: 0, settings: room.settings, game: room.gameKey, round: room.round,
    players: room.players.map(p => p && { char: p.char, name: NAMES[p.char], score: p.score, on: !!p.sid, ready: room.ready.has(p.token) }),
    lastWin: room.lastWin, champ: room.champ, phaseEnd: room.phaseEnd ? room.phaseEnd - Date.now() : 0, history: room.history,
  };
}
function bcast(room) { io.to(room.code).emit('room', pub(room)); }
function setPhase(room, ph, ms) { room.phase = ph; room.phaseEnd = ms ? Date.now() + ms : 0; room.ready.clear(); bcast(room); }
function nextGame(room) {
  if (!room.playlist.length) { room.playlist = shuffle(GAMES.filter(g => g !== 'chess' || room.settings.chess)); if (room.playlist[0] === room.gameKey && room.playlist.length > 1) room.playlist.push(room.playlist.shift()); }
  return room.playlist.shift();
}
function startPick(room) { room.round++; room.gameKey = nextGame(room); setPhase(room, 'pick', 3200); }
function R(room) { return { fx: (e) => io.to(room.code).emit('fx', e) }; }
function endRound(room, w) {
  room.game = null; room.lastWin = w;
  if (w >= 0) room.players[w].score++;
  room.history.push({ g: room.gameKey, w });
  const champ = room.players.findIndex(p => p.score >= room.settings.target);
  if (champ >= 0) { room.champ = champ; setPhase(room, 'result', 4500); room.after = 'final'; }
  else { room.after = 'pick'; setPhase(room, 'result', 4500); }
}
function tickRoom(room, dt) {
  const away = room.players.some(p => !p || !p.sid);
  if (room.phase === 'play' && room.game) {
    if (away) return; // pause while someone reconnects
    const g = G[room.gameKey]; const r = g.tick(room.game, dt, R(room));
    if (r !== undefined) { io.to(room.code).emit('gs', g.view(room.game)); return endRound(room, r); }
    room.sendAcc = (room.sendAcc || 0) + dt;
    if (room.sendAcc >= 0.045) { room.sendAcc = 0; io.to(room.code).emit('gs', g.view(room.game)); }
    return;
  }
  if (room.phaseEnd && Date.now() >= room.phaseEnd) {
    if (away && room.phase !== 'result') { room.phaseEnd = Date.now() + 1000; return; }
    room.phaseEnd = 0;
    if (room.phase === 'intro') startPick(room);
    else if (room.phase === 'pick') setPhase(room, 'tutorial');
    else if (room.phase === 'countdown') { room.game = G[room.gameKey].init(); setPhase(room, 'play'); io.to(room.code).emit('gs', G[room.gameKey].view(room.game)); }
    else if (room.phase === 'result') { if (room.after === 'final') setPhase(room, 'final'); else startPick(room); }
  }
}
let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const room of rooms.values()) {
    tickRoom(room, dt);
    if (room.players.every(p => !p || !p.sid) && now - room.touched > 30 * 60e3) rooms.delete(room.code);
  }
}, 1000 / 30);

io.on('connection', (sock) => {
  let room = null, me = -1;
  const attach = (r, i) => { room = r; me = i; r.players[i].sid = sock.id; r.touched = Date.now(); sock.join(r.code); sock.emit('you', { i, token: r.players[i].token, code: r.code }); bcast(r); if (r.game) sock.emit('gs', G[r.gameKey].view(r.game)); };
  sock.on('create', ({ char, token }) => {
    char = CHARS.includes(char) ? char : 'ralph';
    const r = { code: code(), players: [{ token, char, score: 0 }, null], settings: { target: 5, chess: true }, phase: 'lobby', ready: new Set(), playlist: [], round: 0, history: [], touched: Date.now() };
    rooms.set(r.code, r); attach(r, 0);
  });
  sock.on('join', ({ code, token }) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return sock.emit('err', 'Room not found. Check the code!');
    const ex = r.players.findIndex(p => p && p.token === token);
    if (ex >= 0) return attach(r, ex);
    if (r.players[1]) return sock.emit('err', 'That room is full.');
    r.players[1] = { token, char: r.players[0].char === 'ralph' ? 'jordan' : 'ralph', score: 0 };
    attach(r, 1); io.to(r.code).emit('fx', { t: 'joined' });
  });
  sock.on('settings', (s) => {
    if (!room || me !== 0 || room.phase !== 'lobby') return;
    if ([3, 5, 7, 10].includes(s.target)) room.settings.target = s.target;
    if (typeof s.chess === 'boolean') room.settings.chess = s.chess;
    if (s.swap && room.players[1]) { const a = room.players[0].char; room.players[0].char = room.players[1].char; room.players[1].char = a; }
    else if (s.swap) room.players[0].char = room.players[0].char === 'ralph' ? 'jordan' : 'ralph';
    bcast(room);
  });
  sock.on('start', () => { if (room && me === 0 && room.phase === 'lobby' && room.players[1]) { setPhase(room, 'intro', 4200); } });
  sock.on('ready', () => {
    if (!room || room.phase !== 'tutorial') return;
    room.ready.add(room.players[me].token); bcast(room);
    if (room.ready.size === 2) setPhase(room, 'countdown', 3400);
  });
  sock.on('skip', () => { // reroll the current mini-game (host only, on tutorial)
    if (!room || room.phase !== 'tutorial') return;
    room.round--; startPick(room);
  });
  sock.on('in', (m) => { if (room && room.phase === 'play' && room.game && m) G[room.gameKey].input(room.game, me, m, R(room)); });
  sock.on('rematch', () => {
    if (!room || room.phase !== 'final') return;
    room.ready.add(room.players[me].token); bcast(room);
    if (room.ready.size === 2) { room.players.forEach(p => p.score = 0); room.round = 0; room.history = []; room.champ = null; room.lastWin = null; room.playlist = []; setPhase(room, 'lobby'); }
  });
  sock.on('emote', (e) => { if (room) io.to(room.code).emit('fx', { t: 'emote', i: me, e: String(e).slice(0, 4) }); });
  sock.on('disconnect', () => { if (room && room.players[me] && room.players[me].sid === sock.id) { room.players[me].sid = null; room.touched = Date.now(); bcast(room); } });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Hazel Party on', PORT));
