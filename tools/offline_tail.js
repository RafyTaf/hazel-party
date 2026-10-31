// ---------------- bot brains ----------------
const PV = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };
function material(c, side) {
  let v = 0; for (const row of c.board()) for (const sq of row) if (sq) v += (sq.color === side ? 1 : -1) * PV[sq.type];
  return v;
}
function chessPick(c) {
  const side = c.turn(), moves = c.moves({ verbose: true }); let best = null, bv = -1e9;
  for (const m of moves) {
    c.move(m); let v;
    if (c.isCheckmate()) v = 1000;
    else if (c.isDraw() || c.isStalemate()) v = -0.5;
    else {
      let worst = 1e9; // opponent's best reply (2-ply)
      for (const r of c.moves({ verbose: true })) {
        c.move(r); const rv = c.isCheckmate() ? -1000 : material(c, side); c.undo();
        if (rv < worst) worst = rv; if (worst <= -1000) break;
      }
      v = worst;
      if (c.inCheck()) v += 0.15;
    }
    c.undo();
    // centre / development flavour + noise so it isn't robotic (and stays beatable)
    const f = m.to.charCodeAt(0) - 100.5, r = +m.to[1] - 4.5; v += 0.12 - 0.03 * (Math.abs(f) + Math.abs(r)) + Math.random() * 0.6;
    if (v > bv) { bv = v; best = m; }
  }
  if (Math.random() < 0.08 && moves.length) best = moves[Math.floor(Math.random() * moves.length)]; // occasional blunder
  return best;
}
function makeBot(key) {
  const b = { t: rnd(0.4, 0.9) };
  return function (s, dt, send) {
    b.t -= dt;
    if (key === 'dash') {
      if (b.t <= 0) { b.t = rnd(0.55, 1.25); const e = Math.random() < 0.3 ? 16 : 6; send({ t: 'tap', x: s.h.x + rnd(-e, e), y: s.h.y + rnd(-e, e) }); }
    } else if (key === 'treat') {
      if (b.t <= 0) {
        b.t = rnd(0.18, 0.4); const me = s.p[1]; let best = null, bs = -1e9;
        for (const it of s.it) {
          if (it.dead || it.y > 132) continue; const tl = (135 - it.y) / it.vy, ax = clamp(it.x + it.vx * tl, 5, 95);
          const val = it.ty === 'bone' ? 1 : it.ty === 'cookie' ? 3 : 0; if (!val) continue;
          if (Math.abs(ax - me.x) > 110 * tl + 8) continue;
          const sc = val * 2 - tl - Math.abs(ax - me.x) / 40; if (sc > bs) { bs = sc; best = ax; }
        }
        if (best === null) best = me.x + rnd(-8, 8);
        // dodge broccoli about to land on us
        for (const it of s.it) if (it.ty === 'broccoli' && !it.dead && it.y > 105 && it.y < 132 && Math.abs(it.x - best) < 10) best += best > it.x ? 12 : -12;
        send({ t: 'x', x: best + rnd(-4, 4) });
      }
    } else if (key === 'fetch') {
      if (s.ph !== 'aim' || s.th[1]) { b.thr = rnd(6, 16); b.wait = rnd(0.6, 1.4); return; }
      b.wait -= dt; if (b.wait > 0) return;
      const p = G.fetch.ret(s, 1, s.t);
      if (dist(p.x, p.y, s.h.x, s.h.y) < b.thr || s.rt < rnd(0.3, 1.2)) send({ t: 'throw', x: p.x, y: p.y });
    } else if (key === 'snack') {
      if (b.t <= 0) {
        b.t = rnd(0.25, 0.45); const me = s.p[1], op = s.p[0]; let tg = null, bd = 1e9;
        for (const n of s.sn) { const d = dist(me.x, me.y, n.x, n.y) - 0.4 * dist(op.x, op.y, n.x, n.y); if (d < bd) { bd = d; tg = n; } }
        if (!tg) return send({ t: 'dir', dx: 0, dy: 0 });
        const a = Math.atan2(tg.y - me.y, tg.x - me.x) + rnd(-0.35, 0.35);
        send({ t: 'dir', dx: Math.cos(a), dy: Math.sin(a) });
      }
    } else if (key === 'zoomies') {
      const p = s.p[1]; if (p.fin) return;
      if (b.t <= 0) { b.t = rnd(0.11, 0.17); send({ t: 'run' }); }
      const nx = s.ob.find(([x]) => x - 4 > p.x); if (!nx) return;
      if (b.ob !== nx[0]) { b.ob = nx[0]; b.lead = Math.random() < 0.82 ? rnd(0.22, 0.42) : rnd(0.0, 0.75); }
      if (p.j <= 0 && p.v > 1 && (nx[0] - 4 - p.x) / p.v < b.lead) { send({ t: 'jump' }); b.ob = -1; b.lead = -1; }
    } else if (key === 'snow') {
      if (b.t > 0) return; b.t = rnd(0.12, 0.22);
      if (s.ph !== 'play') return send({ t: 'dir', dx: 0, dy: 0 });
      const me = s.p[1], op = s.p[0], C = G.snow, dc = dist(me.x, me.y, C.CX, C.CY);
      let tx = op.x + op.vx * 0.25, ty = op.y + op.vy * 0.25;
      // aim to hit the opponent from the centre side, so they go outward
      const ox = op.x - C.CX, oy = op.y - C.CY, ol = Math.hypot(ox, oy) || 1;
      tx -= ox / ol * (me.r + op.r) * 0.6; ty -= oy / ol * (me.r + op.r) * 0.6;
      if (dc > s.ar - me.r - 4) { tx = C.CX; ty = C.CY; } // too close to the edge: get back
      const a = Math.atan2(ty - me.y, tx - me.x) + rnd(-0.3, 0.3);
      send({ t: 'dir', dx: Math.cos(a), dy: Math.sin(a) });
      const d = dist(me.x, me.y, op.x, op.y);
      if (me.cd <= 0 && d < me.r + op.r + 14 && dc < s.ar - 6 && Math.random() < 0.35) send({ t: 'dash' });
    } else if (key === 'chess') {
      if (s.end !== null || !Chess) return;
      if (s.c.turn() !== G.chess.side(s, 1)) { b.think = null; return; }
      if (b.think === null || b.think === undefined) b.think = rnd(1.2, 3.5);
      b.think -= dt; if (b.think > 0) return; b.think = null;
      const m = chessPick(s.c); if (m) send({ t: 'move', from: m.from, to: m.to, promo: 'q' });
    }
  };
}

// ---------------- offline room + fake socket ----------------
function createSocket() {
  const L = {}; const out = (e, d) => setTimeout(() => (L[e] || []).forEach(f => f(d)), 0);
  const room = { code: 'BOT', players: [null, null], settings: { target: 7, chess: true }, phase: 'lobby', ready: new Set(), playlist: [], round: 0, history: [] };
  const Rr = { fx: e => out('fx', e) };
  const pub = () => ({
    code: room.code, phase: room.phase, host: 0, settings: room.settings, game: room.gameKey, round: room.round, bot: true,
    players: room.players.map(p => p && { char: p.char, name: NAMES[p.char] + (p.bot ? ' 🤖' : ''), score: p.score, on: true, ready: room.ready.has(p.token) }),
    lastWin: room.lastWin, champ: room.champ, phaseEnd: room.phaseEnd ? room.phaseEnd - Date.now() : 0, history: room.history,
  });
  const bcast = () => out('room', JSON.parse(JSON.stringify(pub())));
  const timers = [];
  const later = (ms, f) => timers.push(setTimeout(f, ms));
  function setPhase(ph, ms) {
    room.phase = ph; room.phaseEnd = ms ? Date.now() + ms : 0; room.ready.clear(); bcast();
    if (ph === 'tutorial') later(rnd(1500, 3200), () => { if (room.phase === 'tutorial') botReady(); });
  }
  function botReady() { room.ready.add('bot'); bcast(); if (room.ready.size === 2) setPhase('countdown', 3400); }
  function nextGame() {
    if (!room.playlist.length) { room.playlist = shuffle(GAMES.filter(g => g !== 'chess' || room.settings.chess)); if (room.playlist[0] === room.gameKey && room.playlist.length > 1) room.playlist.push(room.playlist.shift()); }
    return room.playlist.shift();
  }
  function startPick() { room.round++; room.gameKey = nextGame(); setPhase('pick', 3200); }
  function endRound(w) {
    room.game = null; room.lastWin = w; if (w >= 0) room.players[w].score++;
    room.history.push({ g: room.gameKey, w });
    const champ = room.players.findIndex(p => p.score >= room.settings.target);
    room.after = champ >= 0 ? 'final' : 'pick'; if (champ >= 0) room.champ = champ;
    setPhase('result', 4500);
  }
  let last = performance.now(), sendAcc = 0, bot = null;
  const botSend = m => { if (room.phase === 'play' && room.game) G[room.gameKey].input(room.game, 1, m, Rr); };
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (room.phase === 'play' && room.game) {
      const g = G[room.gameKey];
      if (bot) bot(room.game, dt, botSend);
      if (!room.game) return;
      const r = g.tick(room.game, dt, Rr);
      if (r !== undefined) { out('gs', g.view(room.game)); return endRound(r); }
      sendAcc += dt; if (sendAcc >= 0.033) { sendAcc = 0; out('gs', g.view(room.game)); }
      return;
    }
    if (room.phaseEnd && Date.now() >= room.phaseEnd) {
      room.phaseEnd = 0;
      if (room.phase === 'intro') startPick();
      else if (room.phase === 'pick') setPhase('tutorial');
      else if (room.phase === 'countdown') {
        const go = () => { room.game = G[room.gameKey].init(); bot = makeBot(room.gameKey); setPhase('play'); out('gs', G[room.gameKey].view(room.game)); };
        if (room.gameKey === 'chess' && !Chess) chessReady.then(() => Chess ? go() : endRound(-1)); else go();
      }
      else if (room.phase === 'result') { if (room.after === 'final') setPhase('final'); else startPick(); }
    }
  }, 1000 / 60);
  const H = {
    create({ char, token }) {
      char = char === 'jordan' ? 'jordan' : 'ralph';
      room.players = [{ token, char, score: 0 }, { token: 'bot', char: char === 'ralph' ? 'jordan' : 'ralph', score: 0, bot: true }];
      out('you', { i: 0, token, code: room.code, bot: true }); bcast(); later(400, () => out('fx', { t: 'joined' }));
    },
    settings(s) {
      if (room.phase !== 'lobby') return;
      if ([3, 5, 7, 10].includes(s.target)) room.settings.target = s.target;
      if (typeof s.chess === 'boolean') room.settings.chess = s.chess;
      if (s.swap) { const a = room.players[0].char; room.players[0].char = room.players[1].char; room.players[1].char = a; }
      bcast();
    },
    start() { if (room.phase === 'lobby') setPhase('intro', 4200); },
    ready() { if (room.phase !== 'tutorial') return; room.ready.add(room.players[0].token); bcast(); if (room.ready.size === 2) setPhase('countdown', 3400); },
    skip() { if (room.phase !== 'tutorial') return; room.round--; startPick(); },
    in(m) { if (room.phase === 'play' && room.game && m) G[room.gameKey].input(room.game, 0, m, Rr); },
    rematch() {
      if (room.phase !== 'final') return; room.ready.add(room.players[0].token); bcast();
      later(900, () => { if (room.phase !== 'final') return; room.ready.add('bot'); room.players.forEach(p => p.score = 0); room.round = 0; room.history = []; room.champ = null; room.lastWin = null; room.playlist = []; setPhase('lobby'); });
    },
    emote(e) { out('fx', { t: 'emote', i: 0, e: String(e).slice(0, 4) }); },
  };
  return {
    offline: true, connected: true,
    on(e, f) { (L[e] = L[e] || []).push(f); },
    off() { },
    emit(e, d) { if (H[e]) setTimeout(() => H[e](d || {}), 0); },
    disconnect() { },
    _room: room,
  };
}
window.HazelOffline = { createSocket, chessReady };
})();
