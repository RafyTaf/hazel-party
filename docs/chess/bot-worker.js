'use strict';
import { Chess } from '../vendor/chess.js';

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// PST indexed 0=a8 ... 63=h1 (same as fen row-major from rank 8), for WHITE. Black uses mirrored.
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    80, 80, 80, 80, 80, 80, 80, 80,
    14, 16, 24, 32, 32, 24, 16, 14,
     6,  8, 14, 24, 24, 14,  8,  6,
     2,  4,  8, 20, 20,  8,  4,  2,
     4, -2, -8,  6,  6, -8, -2,  4,
     6, 10, 10,-16,-16, 10, 10,  6,
     0,  0,  0,  0,  0,  0,  0,  0
  ],
  n: [
   -50,-38,-28,-28,-28,-28,-38,-50,
   -38,-16,  0,  4,  4,  0,-16,-38,
   -28,  4, 14, 18, 18, 14,  4,-28,
   -28,  6, 18, 22, 22, 18,  6,-28,
   -28,  4, 18, 22, 22, 18,  4,-28,
   -28,  6, 14, 18, 18, 14,  6,-28,
   -38,-16,  2,  6,  6,  2,-16,-38,
   -50,-38,-28,-28,-28,-28,-38,-50
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  8, 10, 10,  8,  0,-10,
   -10,  4, 10, 14, 14, 10,  4,-10,
   -10,  0, 10, 14, 14, 10,  0,-10,
   -10,  6,  8, 10, 10,  8,  6,-10,
   -10,  8,  0,  0,  0,  0,  8,-10,
   -20,-10,-12,-10,-10,-12,-10,-20
  ],
  r: [
     0,  0,  4,  8,  8,  4,  0,  0,
     8, 12, 12, 12, 12, 12, 12,  8,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
     0,  0,  4,  8,  8,  4,  0,  0
  ],
  q: [
   -20,-10,-10, -4, -4,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  6,  6,  6,  6,  0,-10,
    -4,  0,  6,  8,  8,  6,  0, -4,
     0,  0,  6,  8,  8,  6,  0, -4,
   -10,  6,  6,  6,  6,  6,  0,-10,
   -10,  0,  6,  0,  0,  0,  0,-10,
   -20,-10,-10, -4, -4,-10,-10,-20
  ],
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20
  ],
  ke: [ // king endgame
   -50,-40,-30,-20,-20,-30,-40,-50,
   -30,-20,-10,  0,  0,-10,-20,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-30,  0,  0,  0,  0,-30,-30,
   -50,-30,-30,-30,-30,-30,-30,-50
  ],
};

function idx(sq) { return (8 - +sq[1]) * 8 + (sq.charCodeAt(0) - 97); }
function mirror(i) { return (7 - (i >> 3)) * 8 + (i & 7); }

function evaluate(ch) {
  const board = ch.board();
  let mg = 0, eg = 0, mat = 0, wb = 0, bb = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f]; if (!p) continue;
    const i = r * 8 + f;
    const v = VAL[p.type];
    const s = p.color === 'w' ? 1 : -1;
    const pi = p.color === 'w' ? i : mirror(i);
    mg += s * (v + PST[p.type][pi]);
    eg += s * (v + (p.type === 'k' ? PST.ke[pi] : PST[p.type][pi]));
    if (p.type !== 'k' && p.type !== 'p') mat += v;
    if (p.type === 'b') { if (p.color === 'w') wb++; else bb++; }
  }
  if (wb >= 2) { mg += 30; eg += 40; }
  if (bb >= 2) { mg -= 30; eg -= 40; }
  // phase: 0 endgame, 1 opening (2Q+4R+4B+4N ≈ 2*900+4*500+4*330+4*320 = 6200)
  const ph = Math.min(1, mat / 4200);
  const sc = mg * ph + eg * (1 - ph);
  return ch.turn() === 'w' ? sc : -sc;
}

const MATE = 30000;
let nodes = 0, deadline = 0, aborted = false;
const TT = new Map();
const TTMAX = 200000;

function abortable() {
  if ((nodes & 2047) === 0 && deadline && performance.now() > deadline) aborted = true;
  return aborted;
}

function order(ch, moves, ttMove, ply, killers) {
  const kv = (m) => {
    if (ttMove && m.from === ttMove.from && m.to === ttMove.to && m.promotion === ttMove.promotion) return 1e6;
    if (m.captured) return 9000 + (VAL[m.captured] || 0) * 10 - (VAL[m.piece] || 0);
    if (m.promotion) return 8000 + (VAL[m.promotion] || 0);
    if (killers[ply] && killers[ply].some(k => k && k.from === m.from && k.to === m.to)) return 7000;
    return 0;
  };
  return moves.sort((a, b) => kv(b) - kv(a));
}

function quiesce(ch, alpha, beta) {
  if (abortable()) return 0;
  nodes++;
  let stand = evaluate(ch);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const caps = ch.moves({ verbose: true }).filter(m => m.captured || m.promotion);
  order(ch, caps, null, 0, []);
  for (const m of caps) {
    // delta prune
    if (stand + (VAL[m.captured] || 0) + 200 < alpha) continue;
    ch.move(m);
    const sc = -quiesce(ch, -beta, -alpha);
    ch.undo();
    if (aborted) return 0;
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function search(ch, depth, alpha, beta, ply, killers) {
  if (abortable()) return 0;
  nodes++;
  if (ch.isDraw() && ply > 0) return 0;
  if (ch.isCheckmate()) return -MATE + ply;
  if (depth <= 0) return quiesce(ch, alpha, beta);

  const key = ch.fen().split(' ').slice(0, 4).join(' ');
  const tt = TT.get(key);
  if (tt && tt.depth >= depth) {
    if (tt.flag === 0) return tt.sc;
    if (tt.flag === 1 && tt.sc >= beta) return tt.sc;
    if (tt.flag === -1 && tt.sc <= alpha) return tt.sc;
  }

  const moves = ch.moves({ verbose: true });
  if (!moves.length) return ch.inCheck() ? -MATE + ply : 0;
  order(ch, moves, tt && tt.move, ply, killers);

  let best = -MATE, bestMove = moves[0], flag = -1, legal = 0;
  for (const m of moves) {
    ch.move(m);
    const ext = ch.inCheck() ? 1 : 0;
    let sc;
    if (legal === 0) sc = -search(ch, depth - 1 + ext, -beta, -alpha, ply + 1, killers);
    else {
      sc = -search(ch, depth - 1 + ext, -alpha - 1, -alpha, ply + 1, killers);
      if (sc > alpha && sc < beta) sc = -search(ch, depth - 1 + ext, -beta, -alpha, ply + 1, killers);
    }
    ch.undo();
    legal++;
    if (aborted) return 0;
    if (sc > best) { best = sc; bestMove = m; }
    if (sc > alpha) { alpha = sc; flag = 0; }
    if (sc >= beta) {
      flag = 1;
      if (!m.captured) {
        killers[ply] = killers[ply] || [];
        killers[ply][1] = killers[ply][0];
        killers[ply][0] = { from: m.from, to: m.to };
      }
      break;
    }
  }
  if (TT.size > TTMAX) TT.clear();
  TT.set(key, { depth, sc: best, flag, move: { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion } });
  return best;
}

const BOOK = {
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': ['e2e4', 'd2d4', 'g1f3', 'c2c4'],
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': ['e7e5', 'c7c5', 'e7e6', 'c7c6', 'd7d5', 'g8f6'],
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': ['d7d5', 'g8f6', 'e7e6', 'c7c5', 'f7f5'],
  'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b': ['d7d5', 'g8f6', 'c7c5'],
  'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b': ['e7e5', 'g8f6', 'c7c5', 'e7e6'],
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w': ['g1f3', 'b1c3', 'f1c4', 'f1b5'],
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w': ['g1f3', 'b1c3', 'c2c3', 'd2d4'],
  'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w': ['d2d4', 'g1f3', 'b1c3'],
  'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w': ['b1c3', 'e4d5', 'e4e5'],
  'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w': ['e4d5'],
  'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w': ['e4e5', 'b1c3'],
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w': ['f1b5', 'f1c4', 'd2d4', 'b1c3'],
  'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b': ['a7a6', 'g8f6', 'd7d6', 'f8c5'],
  'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b': ['g8f6', 'f8c5', 'f8e7'],
  'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w': ['d2d4', 'f1b5', 'c2c3'],
  'rnbqkbnr/pp1p1ppp/4p3/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w': ['d2d4', 'c2c3', 'b1c3'],
  'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w': ['d2d3', 'g1f3', 'd2d4'],
  'rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w': ['b1c3', 'g1f3'],
  'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR w': ['g1f3', 'b1c3'],
  'rnbqkb1r/ppp1pppp/5n2/3p4/2PP4/8/PP2PPPP/RNBQKBNR w': ['b1c3', 'g1f3', 'c4d5'],
  'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b': ['e7e6', 'c7c6', 'g8f6', 'd5c4', 'e7e5'],
  'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w': ['b1c3', 'g1f3'],
  'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w': ['c2c4', 'g1f3', 'c1f4', 'c1g5'],
  'rnbqkbnr/pppp1ppp/8/4p3/3PP3/8/PPP2PPP/RNBQKBNR b': ['e5d4'],
  'rnbqkbnr/pppp1ppp/8/8/3pP3/8/PPP2PPP/RNBQKBNR w': ['g1f3', 'd1d4'],
};

function bookMove(ch) {
  const k = ch.fen().split(' ').slice(0, 2).join(' ');
  const opts = BOOK[k];
  if (!opts || !opts.length) return null;
  const uci = opts[Math.floor(Math.random() * opts.length)];
  const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
  const legal = ch.moves({ verbose: true }).find(m => m.from === from && m.to === to && (!promo || m.promotion === promo));
  return legal || null;
}

function pickSoft(cands, skill) {
  // skill 0: wide window, 1: medium, 2: almost always best
  if (!cands.length) return null;
  const best = cands[0].sc;
  const window = skill === 0 ? 180 : skill === 1 ? 50 : 8;
  const pool = cands.filter(c => best - c.sc <= window);
  // weighted toward better
  let w = pool.map(c => Math.exp((c.sc - best) / (window || 1) * 2));
  const sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i].m; }
  return pool[0].m;
}

function think(fen, depth, ms, skill) {
  const ch = new Chess(fen);
  if (ch.isGameOver()) return null;
  const bm = skill < 2 || Math.random() < 0.7 ? bookMove(ch) : null;
  if (bm) return { from: bm.from, to: bm.to, promotion: bm.promotion, san: bm.san, score: 15, book: true };

  nodes = 0; aborted = false; deadline = performance.now() + ms;
  const killers = [];
  let best = null, lastRoot = [];
  const maxD = Math.max(1, Math.min(5, depth));
  for (let d = 1; d <= maxD; d++) {
    const moves = ch.moves({ verbose: true });
    const tt = TT.get(ch.fen().split(' ').slice(0, 4).join(' '));
    order(ch, moves, tt && tt.move, 0, killers);
    const scored = [];
    let alpha = -MATE, beta = MATE;
    for (const m of moves) {
      ch.move(m);
      const sc = -search(ch, d - 1, -beta, -alpha, 1, killers);
      ch.undo();
      if (aborted) break;
      scored.push({ m, sc });
      if (sc > alpha) alpha = sc;
    }
    if (aborted && !scored.length) break;
    scored.sort((a, b) => b.sc - a.sc);
    lastRoot = scored;
    best = scored[0];
    if (aborted) break;
    if (best && Math.abs(best.sc) > MATE - 100) break; // found mate
  }
  if (!best && lastRoot.length) best = lastRoot[0];
  if (!best) {
    const ms2 = ch.moves({ verbose: true });
    if (!ms2.length) return null;
    const m = ms2[Math.floor(Math.random() * ms2.length)];
    return { from: m.from, to: m.to, promotion: m.promotion, san: m.san, score: 0 };
  }
  const picked = pickSoft(lastRoot.length ? lastRoot : [best], skill) || best.m;
  const pv = lastRoot[0];
  return { from: picked.from, to: picked.to, promotion: picked.promotion, san: picked.san, score: (pv && pv.sc) || best.sc, nodes };
}

self.onmessage = (e) => {
  const { id, fen, depth, ms, skill } = e.data;
  try {
    const move = think(fen, depth ?? 3, ms ?? 800, skill ?? 1);
    self.postMessage({ id, move });
  } catch (err) {
    self.postMessage({ id, err: String(err) });
  }
};
