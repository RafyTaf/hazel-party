'use strict';

export const ANNO = {
  green:  { arrow: '#15781B', hl: 'rgba(21,120,27,.55)' },
  red:    { arrow: '#C8342F', hl: 'rgba(200,52,47,.55)' },
  blue:   { arrow: '#1B73C4', hl: 'rgba(27,115,196,.55)' },
  orange: { arrow: '#E68A00', hl: 'rgba(230,138,0,.58)' },
};
export const COLOR_KEYS = ['green', 'red', 'blue', 'orange'];
const FILES = 'abcdefgh';

export function sqFR(sq) { return { f: sq.charCodeAt(0) - 97, r: +sq[1] - 1 }; }
export function frSq(f, r) { return FILES[f] + (r + 1); }
export function isKnightMove(a, b) {
  const A = sqFR(a), B = sqFR(b);
  const dx = Math.abs(A.f - B.f), dy = Math.abs(A.r - B.r);
  return (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
}

export class Board {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.imgs = {};
    this.ready = Promise.all(['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'].map(n => new Promise(res => {
      const im = new Image();
      im.onload = () => res(); im.onerror = () => res();
      im.src = new URL(`../art/chess/${n}.svg`, import.meta.url).href;
      this.imgs[n] = im;
    })));

    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    this.last = null;
    this.legal = {};
    this.chk = false;
    this.flip = false;
    this.viewOnly = false;
    this.sel = null;

    this.arrows = [];
    this.marks = {};
    this.drawMode = false;
    this.color = 'green';
    this.clearOnMove = true;

    this.onMove = opts.onMove || (() => {});
    this.onAnno = opts.onAnno || (() => {});
    this.canMoveFrom = opts.canMoveFrom || (() => true);

    this.anim = null;
    this.ghost = null;
    this.preview = null;
    this._animKey = '';
    this._T = 0;
    this._lastT = 0;

    this._ptrs = new Map();
    this._lp = 0;
    this._lpFired = false;
    this._annoSess = null;
    this._pieceSess = null;

    this.geom = { x0: 0, y0: 0, sz: 0, c: 0, fw: 16 };

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onCtx = e => e.preventDefault();
    this._loop = this._loop.bind(this);
    this.cv.addEventListener('pointerdown', this._onDown);
    this.cv.addEventListener('pointermove', this._onMove);
    this.cv.addEventListener('pointerup', this._onUp);
    this.cv.addEventListener('pointercancel', this._onUp);
    this.cv.addEventListener('pointerleave', e => { if (this._ptrs.has(e.pointerId) && e.pointerType === 'mouse') this._onUp(e); });
    this.cv.addEventListener('contextmenu', this._onCtx);
    this.cv.addEventListener('lostpointercapture', this._onUp);
    this.cv.style.touchAction = 'none';
    this.cv.style.userSelect = 'none';
    this.cv.style.webkitUserSelect = 'none';

    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.cv.parentElement || this.cv);
    this._raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.cv.removeEventListener('pointerdown', this._onDown);
    this.cv.removeEventListener('pointermove', this._onMove);
    this.cv.removeEventListener('pointerup', this._onUp);
    this.cv.removeEventListener('pointercancel', this._onUp);
    this.cv.removeEventListener('contextmenu', this._onCtx);
  }

  setPosition({ fen, last, legal, chk, flip, viewOnly, n }) {
    if (fen) { const parts = fen.split(' '); this.fen = parts[0]; if (parts[1]) this._turn = parts[1]; }
    if (last !== undefined) this.last = last;
    if (legal !== undefined) this.legal = legal || {};
    if (chk !== undefined) this.chk = !!chk;
    if (flip !== undefined) this.flip = !!flip;
    if (viewOnly !== undefined) this.viewOnly = !!viewOnly;
    const key = (last ? last.join('') : '-') + (n ?? this.fen);
    if (key !== this._animKey) {
      if (this._animKey && last && last[0] && last[1]) this.anim = { from: last[0], to: last[1], t: 0 };
      else this.anim = null;
      this._animKey = key;
    }
    this.render();
  }

  setDrawMode(on) { this.drawMode = !!on; if (!on && this._annoSess && !this._annoSess.sticky) this._cancelAnno(); this.render(); }
  setColor(c) { if (ANNO[c]) this.color = c; }
  setClearOnMove(v) { this.clearOnMove = !!v; }
  clearAnnotations() { this.arrows = []; this.marks = {}; this.preview = null; this.onAnno(); this.render(); }
  afterMoveClears() { if (this.clearOnMove) this.clearAnnotations(); this.sel = null; this.ghost = null; }

  // client-pixel center of a square — used by tests
  sqClient(sq) {
    const p = this._scr(sq);
    const r = this.cv.getBoundingClientRect();
    const css = this.geom.css || r.width;
    return { x: r.left + (p.x + this.geom.c / 2) * (r.width / css), y: r.top + (p.y + this.geom.c / 2) * (r.height / css) };
  }

  resize() {
    const wrap = this.cv.parentElement || this.cv;
    const pad = 4;
    const w = Math.max(120, wrap.clientWidth - pad);
    const h = Math.max(120, wrap.clientHeight - pad);
    const css = Math.floor(Math.min(w, h));
    const dpr = this._dpr();
    if (this.cv.width !== Math.round(css * dpr) || this.cv.height !== Math.round(css * dpr)) {
      this.cv.width = Math.round(css * dpr);
      this.cv.height = Math.round(css * dpr);
      this.cv.style.width = css + 'px';
      this.cv.style.height = css + 'px';
    }
    const fw = Math.max(12, Math.round(css * 0.048));
    const sz = css - fw * 2;
    const cell = sz / 8;
    this.geom = { x0: fw, y0: fw, sz, c: cell, fw, css };
    this.render();
  }

  _dpr() { return Math.min(3, window.devicePixelRatio || 1); }

  _loop(t) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = this._lastT ? Math.min(0.05, (t - this._lastT) / 1000) : 0.016;
    this._lastT = t; this._T += dt;
    let dirty = false;
    if (this.anim) { this.anim.t += dt / 0.18; if (this.anim.t >= 1) this.anim = null; dirty = true; }
    if (this.sel || this.ghost || this.preview || this.drawMode) dirty = true;
    if (dirty) this.render();
  }

  _board() {
    const bd = {}, rows = this.fen.split('/');
    rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { bd[FILES[f] + (8 - r)] = ch; f++; } } });
    return bd;
  }

  _scr(sq) {
    let f = sq.charCodeAt(0) - 97, r = 8 - +sq[1];
    if (this.flip) { f = 7 - f; r = 7 - r; }
    return { x: this.geom.x0 + f * this.geom.c, y: this.geom.y0 + r * this.geom.c };
  }

  _sqAt(clientX, clientY) {
    const r = this.cv.getBoundingClientRect();
    const css = this.geom.css || r.width;
    const x = (clientX - r.left) * (css / r.width);
    const y = (clientY - r.top) * (css / r.height);
    let f = Math.floor((x - this.geom.x0) / this.geom.c);
    let rr = Math.floor((y - this.geom.y0) / this.geom.c);
    if (f < 0 || f > 7 || rr < 0 || rr > 7) return null;
    if (this.flip) { f = 7 - f; rr = 7 - rr; }
    return FILES[f] + (8 - rr);
  }

  /* ---------- input ---------- */
  _colorForEvent(e) {
    if (e.shiftKey) return 'red';
    if (e.altKey) return 'blue';
    if (e.ctrlKey || e.metaKey) return 'orange';
    return this.color;
  }
  _cancelLP() { if (this._lp) { clearTimeout(this._lp); this._lp = 0; } }

  _onDown(e) {
    if (e.button === 1) return; // middle
    try { this.cv.setPointerCapture(e.pointerId); } catch (_) {}
    const sq = this._sqAt(e.clientX, e.clientY);
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sq, t: performance.now(), button: e.button });

    // two-finger: treat as annotation from first pointer's square to this one
    if (this._ptrs.size >= 2 && e.button !== 2) {
      this._cancelLP();
      this._pieceSess = null;
      this.ghost = null;
      this.sel = null;
      const pts = [...this._ptrs.values()];
      const a = pts[0].sq, b = sq;
      if (a) {
        this._annoSess = { from: a, color: this.color, sticky: true, two: true };
        this.preview = a && b && a !== b ? { type: 'arrow', from: a, to: b, color: this.color } : (a ? { type: 'mark', sq: a, color: this.color } : null);
        this.render();
      }
      e.preventDefault();
      return;
    }

    // right-click (desktop chess.com style) — always annotation
    if (e.button === 2) {
      this._cancelLP();
      this._pieceSess = null;
      if (sq) {
        this._annoSess = { from: sq, color: this._colorForEvent(e), sticky: true };
        this.preview = { type: 'mark', sq, color: this._annoSess.color };
      }
      e.preventDefault();
      this.render();
      return;
    }

    if (this.drawMode && sq) {
      this._annoSess = { from: sq, color: this._colorForEvent(e), sticky: true };
      this.preview = { type: 'mark', sq, color: this._annoSess.color };
      e.preventDefault();
      this.render();
      return;
    }

    // long-press starts annotation without draw-mode (mobile alternative)
    this._lpFired = false;
    this._cancelLP();
    const startSq = sq;
    const startX = e.clientX, startY = e.clientY, pid = e.pointerId;
    this._lp = setTimeout(() => {
      this._lp = 0;
      const p = this._ptrs.get(pid);
      if (!p || !startSq) return;
      // still roughly on the same square
      this._lpFired = true;
      this._pieceSess = null;
      this.ghost = null;
      this.sel = null;
      this._annoSess = { from: startSq, color: this.color, sticky: false };
      this.preview = { type: 'mark', sq: startSq, color: this.color };
      try { navigator.vibrate && navigator.vibrate(18); } catch (_) {}
      this.render();
    }, 420);

    // piece interaction (tap-tap or drag), unless view-only / can't move
    if (sq && !this.viewOnly) {
      const bd = this._board();
      const piece = bd[sq];
      const mine = piece && this.canMoveFrom(sq, piece);
      if (this.sel && this.legal[this.sel] && this.legal[this.sel].includes(sq)) {
        this._pieceSess = { from: this.sel, startSq: this.sel, x: startX, y: startY, moved: false, pendingMoveTo: sq };
        return;
      }
      if (mine && this.legal[sq]) {
        this.sel = sq;
        this._pieceSess = { from: sq, startSq: sq, x: startX, y: startY, moved: false };
        this.render();
        return;
      }
      if (this.sel) { this.sel = null; this.render(); }
      this._pieceSess = null;
    }
  }

  _onMove(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const sq = this._sqAt(e.clientX, e.clientY);
    p.sq = sq ?? p.sq;
    const dist = Math.hypot(e.clientX - (p._sx ?? p.x), e.clientY - (p._sy ?? p.y));
    if (p._sx == null) { p._sx = e.clientX; p._sy = e.clientY; }

    const movedPx = Math.hypot(e.clientX - (this._pieceSess ? this._pieceSess.x : p._sx), e.clientY - (this._pieceSess ? this._pieceSess.y : p._sy));
    if (movedPx > 12) this._cancelLP();

    // two-finger preview
    if (this._annoSess && this._annoSess.two && this._ptrs.size >= 2) {
      const pts = [...this._ptrs.values()];
      const a = this._annoSess.from, b = pts[1].sq || sq;
      this.preview = a && b && a !== b ? { type: 'arrow', from: a, to: b, color: this._annoSess.color } : (a ? { type: 'mark', sq: a, color: this._annoSess.color } : null);
      this.render();
      return;
    }

    if (this._annoSess) {
      const a = this._annoSess.from, b = sq;
      this.preview = a && b && a !== b ? { type: 'arrow', from: a, to: b, color: this._annoSess.color } : (a ? { type: 'mark', sq: a, color: this._annoSess.color } : null);
      this.render();
      return;
    }

    if (this._pieceSess && !this._lpFired) {
      if (movedPx > 14) {
        this._pieceSess.moved = true;
        const r = this.cv.getBoundingClientRect();
        const css = this.geom.css || r.width;
        const x = (e.clientX - r.left) * (css / r.width);
        const y = (e.clientY - r.top) * (css / r.height);
        this.ghost = { sq: this._pieceSess.from, x, y };
        this.render();
      }
    }
  }

  _onUp(e) {
    if (!this._ptrs.has(e.pointerId)) return;
    const p = this._ptrs.get(e.pointerId);
    this._ptrs.delete(e.pointerId);
    this._cancelLP();
    const sq = this._sqAt(e.clientX, e.clientY) || p.sq;

    // If other pointers remain for a two-finger session, wait for the last one
    if (this._annoSess && this._annoSess.two && this._ptrs.size > 0) {
      if (sq) this._annoSess._to = sq;
      return;
    }

    if (this._annoSess) {
      const from = this._annoSess.from;
      const to = this._annoSess.two ? (this._annoSess._to || sq) : sq;
      const col = this._annoSess.color;
      this._annoSess = null;
      this.preview = null;
      if (from && to && from !== to) this._toggleArrow(from, to, col);
      else if (from) this._toggleMark(from, col);
      try { this.cv.releasePointerCapture(e.pointerId); } catch (_) {}
      this.render();
      return;
    }

    if (this._lpFired) {
      this._lpFired = false;
      this.preview = null;
      this.render();
      return;
    }

    if (this._pieceSess) {
      const sess = this._pieceSess;
      this._pieceSess = null;
      this.ghost = null;
      const dest = sq;
      if (dest && this.legal[sess.from] && this.legal[sess.from].includes(dest)) {
        // drag-drop or already-pending tap-tap
        this._commitMove(sess.from, dest);
      } else if (!sess.moved && dest === sess.from) {
        // tap on same square keeps selection
      } else if (!sess.moved && dest && this.legal[dest] && this.canMoveFrom(dest, this._board()[dest])) {
        this.sel = dest;
      } else if (!sess.moved) {
        // tapped elsewhere, already handled in down for pendingMoveTo
        if (sess.pendingMoveTo && dest === sess.pendingMoveTo) this._commitMove(sess.from, dest);
        else this.sel = null;
      } else {
        // dragged to illegal — snap back, keep sel
      }
      this.render();
    }
    try { this.cv.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  _commitMove(from, to) {
    this.sel = null;
    this.ghost = null;
    this.onMove(from, to);
  }

  _toggleArrow(from, to, color) {
    const i = this.arrows.findIndex(a => a.from === from && a.to === to);
    if (i >= 0) {
      if (this.arrows[i].color === color) this.arrows.splice(i, 1);
      else this.arrows[i].color = color;
    } else this.arrows.push({ from, to, color });
    this.onAnno();
  }
  _toggleMark(sq, color) {
    if (this.marks[sq] === color) delete this.marks[sq];
    else this.marks[sq] = color;
    this.onAnno();
  }

  /* ---------- drawing ---------- */
  render() {
    const cx = this.cx, g = this.geom, dpr = this._dpr();
    if (!g.css) return;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, g.css, g.css);
    const { x0, y0, sz, c, fw } = g;

    // wood frame + gold trim
    cx.save();
    cx.shadowColor = 'rgba(0,0,0,.45)'; cx.shadowBlur = 22; cx.shadowOffsetY = 8;
    const wg = cx.createLinearGradient(0, 0, 0, g.css);
    wg.addColorStop(0, '#8b4a1f'); wg.addColorStop(.5, '#6b3413'); wg.addColorStop(1, '#4a220a');
    cx.fillStyle = wg;
    this._rr(0, 0, g.css, g.css, fw * 0.9); cx.fill();
    cx.restore();
    cx.lineWidth = 3; cx.strokeStyle = '#ffcc33';
    this._rr(4, 4, g.css - 8, g.css - 8, fw * 0.7); cx.stroke();
    cx.fillStyle = '#2a1206'; cx.fillRect(x0 - 2, y0 - 2, sz + 4, sz + 4);

    const bd = this._board();
    const kingSq = this.chk ? Object.keys(bd).find(s => bd[s] === (this._turnFromFen() === 'w' ? 'K' : 'k')) : null;
    const legal = (!this.viewOnly && this.sel && this.legal[this.sel]) ? this.legal[this.sel] : [];

    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const ff = this.flip ? 7 - f : f, rr2 = this.flip ? 7 - r : r;
      const sq = FILES[ff] + (8 - rr2), x = x0 + f * c, y = y0 + r * c, dark = (f + r) % 2;
      const sg = cx.createLinearGradient(x, y, x + c, y + c);
      if (dark) { sg.addColorStop(0, '#c98a4f'); sg.addColorStop(1, '#b0733c'); }
      else { sg.addColorStop(0, '#fff1d2'); sg.addColorStop(1, '#f5deb0'); }
      cx.fillStyle = sg; cx.fillRect(x, y, c + 0.5, c + 0.5);
      if (this.last && this.last.includes(sq)) { cx.fillStyle = 'rgba(255,214,0,.48)'; cx.fillRect(x, y, c + 0.5, c + 0.5); }
      if (this.marks[sq]) { cx.fillStyle = ANNO[this.marks[sq]].hl; cx.fillRect(x, y, c + 0.5, c + 0.5); }
      if (sq === this.sel) { cx.fillStyle = 'rgba(60,200,120,.55)'; cx.fillRect(x, y, c + 0.5, c + 0.5); }
      if (sq === kingSq) {
        const rg = cx.createRadialGradient(x + c / 2, y + c / 2, c * .1, x + c / 2, y + c / 2, c * .7);
        rg.addColorStop(0, 'rgba(255,40,40,.95)'); rg.addColorStop(1, 'rgba(255,40,40,0)');
        cx.fillStyle = rg; cx.fillRect(x, y, c, c);
      }
      // coordinates
      cx.font = `bold ${Math.round(c * 0.2)}px "Lilita One","Fredoka",sans-serif`;
      cx.fillStyle = dark ? '#fff1d2' : '#b0733c';
      if (f === 0) { cx.textAlign = 'left'; cx.textBaseline = 'top'; cx.fillText(8 - rr2, x + 3, y + 2); }
      if (r === 7) { cx.textAlign = 'right'; cx.textBaseline = 'bottom'; cx.fillText(FILES[ff], x + c - 3, y + c - 1); }
    }
    cx.textBaseline = 'alphabetic';

    // pieces
    const drawPiece = (p, x, y, lift = 0, sc = 1) => {
      const im = this.imgs[(p === p.toUpperCase() ? 'w' : 'b') + p.toUpperCase()];
      if (!im || !im.complete || !im.naturalWidth) return;
      const s = c * 0.92 * sc, px = x + (c - s) / 2, py = y + (c - s) / 2 - lift;
      cx.save();
      cx.fillStyle = 'rgba(0,0,0,.22)';
      cx.beginPath(); cx.ellipse(x + c / 2, y + c * 0.86, c * 0.3, c * 0.08, 0, 0, 7); cx.fill();
      cx.shadowColor = 'rgba(0,0,0,.35)'; cx.shadowBlur = c * 0.06; cx.shadowOffsetY = c * 0.03;
      cx.drawImage(im, px, py, s, s);
      cx.restore();
    };
    const hide = {};
    if (this.anim && bd[this.anim.to]) hide[this.anim.to] = 1;
    if (this.ghost) hide[this.ghost.sq] = 1;
    for (const sq in bd) {
      if (hide[sq]) continue;
      const p = this._scr(sq);
      const lift = sq === this.sel ? 4 + Math.sin(this._T * 8) * 2 : 0;
      drawPiece(bd[sq], p.x, p.y, lift, sq === this.sel ? 1.08 : 1);
    }
    if (this.anim && bd[this.anim.to] && !this.ghost) {
      const a = this._scr(this.anim.from), b = this._scr(this.anim.to);
      const k = 1 - Math.pow(1 - Math.min(1, this.anim.t), 3);
      drawPiece(bd[this.anim.to], a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, Math.sin(k * Math.PI) * c * 0.25, 1.06);
    }

    // legal dots
    for (const sq of legal) {
      const p = this._scr(sq), occ = !!bd[sq];
      cx.beginPath();
      if (occ) { cx.lineWidth = c * 0.08; cx.strokeStyle = 'rgba(30,140,80,.85)'; cx.arc(p.x + c / 2, p.y + c / 2, c * 0.44, 0, 7); cx.stroke(); }
      else { cx.fillStyle = 'rgba(30,140,80,.7)'; cx.arc(p.x + c / 2, p.y + c / 2, c * (0.14 + Math.sin(this._T * 6) * 0.01), 0, 7); cx.fill(); }
    }

    // arrows (over pieces, chess.com style)
    for (const a of this.arrows) this._drawArrow(a.from, a.to, ANNO[a.color].arrow, 0.86);
    if (this.preview && this.preview.type === 'arrow') this._drawArrow(this.preview.from, this.preview.to, ANNO[this.preview.color].arrow, 0.55);
    if (this.preview && this.preview.type === 'mark' && !this.marks[this.preview.sq]) {
      const p = this._scr(this.preview.sq);
      cx.fillStyle = ANNO[this.preview.color].hl;
      cx.globalAlpha = 0.7; cx.fillRect(p.x, p.y, c + 0.5, c + 0.5); cx.globalAlpha = 1;
    }

    // ghost piece on top
    if (this.ghost && bd[this.ghost.sq]) {
      drawPiece(bd[this.ghost.sq], this.ghost.x - c / 2, this.ghost.y - c / 2, c * 0.18, 1.12);
    }

    // draw-mode frame cue
    if (this.drawMode) {
      cx.lineWidth = 4; cx.strokeStyle = 'rgba(255,204,51,.85)';
      this._rr(2, 2, g.css - 4, g.css - 4, fw * 0.7); cx.stroke();
    }
  }

  _turnFromFen() {
    // fen stored as placement only; chk uses explicit flag, king color from... we don't have full fen here.
    // The caller sets chk for the side to move; we need turn. Store it.
    return this._turn || 'w';
  }
  setTurn(t) { this._turn = t; }

  _rr(x, y, w, h, r) {
    const cx = this.cx, rr = Math.min(r, w / 2, h / 2);
    cx.beginPath();
    cx.moveTo(x + rr, y);
    cx.arcTo(x + w, y, x + w, y + h, rr);
    cx.arcTo(x + w, y + h, x, y + h, rr);
    cx.arcTo(x, y + h, x, y, rr);
    cx.arcTo(x, y, x + w, y, rr);
    cx.closePath();
  }

  _center(sq) {
    const p = this._scr(sq);
    return { x: p.x + this.geom.c / 2, y: p.y + this.geom.c / 2 };
  }

  _knightCorner(from, to) {
    const A = sqFR(from), B = sqFR(to);
    const dx = B.f - A.f, dy = B.r - A.r;
    // longer (2-square) leg first
    let cf, cr;
    if (Math.abs(dx) === 2) { cf = A.f + dx; cr = A.r; }
    else { cf = A.f; cr = A.r + dy; }
    return frSq(cf, cr);
  }

  _drawArrow(from, to, color, alpha) {
    if (!from || !to || from === to) return;
    const pts = [this._center(from)];
    if (isKnightMove(from, to)) pts.push(this._center(this._knightCorner(from, to)));
    pts.push(this._center(to));
    drawArrowShape(this.cx, pts, color, this.geom.c, alpha);
  }
}

function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function perp(dx, dy) {
  const l = Math.hypot(dx, dy) || 1;
  return { x: -dy / l, y: dx / l };
}

export function drawArrowShape(ctx, pts, color, sq, alpha = 0.85) {
  if (pts.length < 2) return;
  const shaftW = sq * 0.205;
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const d = dist(prev, last);
  if (d < 6) return;
  const headL = Math.min(sq * 0.46, d * 0.62);
  const headW = sq * 0.38;
  const ux = (last.x - prev.x) / d, uy = (last.y - prev.y) / d;
  const base = { x: last.x - ux * headL, y: last.y - uy * headL };
  const p = pts.slice(0, -1).concat([base]);
  const half = shaftW / 2;
  const L = [], R = [];
  for (let i = 0; i < p.length; i++) {
    if (i === 0) {
      const n = perp(p[1].x - p[0].x, p[1].y - p[0].y);
      L.push({ x: p[0].x + n.x * half, y: p[0].y + n.y * half });
      R.push({ x: p[0].x - n.x * half, y: p[0].y - n.y * half });
    } else if (i === p.length - 1) {
      const n = perp(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
      L.push({ x: p[i].x + n.x * half, y: p[i].y + n.y * half });
      R.push({ x: p[i].x - n.x * half, y: p[i].y - n.y * half });
    } else {
      const n1 = perp(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
      const n2 = perp(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
      const mx = n1.x + n2.x, my = n1.y + n2.y;
      const ml = Math.hypot(mx, my) || 1;
      const cos = (n1.x * mx + n1.y * my) / ml;
      const k = half / Math.max(cos, 0.42);
      L.push({ x: p[i].x + (mx / ml) * k, y: p[i].y + (my / ml) * k });
      R.push({ x: p[i].x - (mx / ml) * k, y: p[i].y - (my / ml) * k });
    }
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L[0].x, L[0].y);
  for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
  ctx.lineTo(base.x - uy * headW, base.y + ux * headW);
  ctx.lineTo(last.x, last.y);
  ctx.lineTo(base.x + uy * headW, base.y - ux * headW);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p[0].x, p[0].y, half, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
