'use strict';
import * as THREE from '../vendor/three/three.module.min.js';
import { ANNO, COLOR_KEYS, sqFR, frSq, isKnightMove } from './board.js';

const FILES = 'abcdefgh';
const DEG = Math.PI / 180;
const SQ = 1; // square size
const PIECE_H = { P: 1.22, N: 1.58, B: 1.72, R: 1.58, Q: 1.92, K: 2.08 };
const BASE_R = { P: 0.20, N: 0.22, B: 0.20, R: 0.23, Q: 0.22, K: 0.24 };

/** Camera presets. `polar` is radians from vertical (0 = straight down). */
const VIEW_ORDER = ['top', 'tilt', 'flat'];
const VIEW_PRESET = {
  // Default: ~22° from vertical, player's side, board fills portrait width.
  top:  { polar: 22 * DEG, azim: 0, dist: 13.6, targetY: 0.04 },
  // Original cinematic angle.
  tilt: { polar: 47 * DEG, azim: 0, dist: 14.8, targetY: 0.18 },
  // Near-orthographic 2D.
  flat: { polar: 8 * DEG,  azim: 0, dist: 14.2, targetY: 0 },
};
function camPreset(mode) {
  const p = VIEW_PRESET[mode] || VIEW_PRESET.top;
  return { polar: p.polar, azim: p.azim, dist: p.dist, targetY: p.targetY };
}

function woodCanvas(w, h, c1, c2, seed = 1, vertical = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.fillStyle = c1;
  cx.fillRect(0, 0, w, h);
  // grain
  let s = seed;
  const rnd = () => { s = (s * 16807 + 13) % 2147483647; return (s % 10000) / 10000; };
  for (let i = 0; i < (vertical ? w : h) * 1.6; i++) {
    const t = rnd();
    const x = (vertical ? i / 1.6 : 0) + (rnd() - 0.5) * 2;
    cx.strokeStyle = t < 0.08 ? shade(c2, -20, 0.55) : (t < 0.5 ? shade(c2, 0, 0.18 + rnd() * 0.22) : shade(c1, 12, 0.12));
    cx.lineWidth = 0.6 + rnd() * 1.8;
    cx.beginPath();
    if (vertical) {
      const xx = x;
      cx.moveTo(xx, 0);
      for (let y = 0; y <= h; y += 8) cx.lineTo(xx + Math.sin(y * 0.04 + seed + i) * 1.6, y);
    } else {
      const yy = i / 1.6;
      cx.moveTo(0, yy);
      for (let x2 = 0; x2 <= w; x2 += 8) cx.lineTo(x2, yy + Math.sin(x2 * 0.04 + seed) * 1.6);
    }
    cx.stroke();
  }
  // pores
  cx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let i = 0; i < 400; i++) cx.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 2);
  return c;
}
function shade(hex, d, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  let r = Math.max(0, Math.min(255, ((n >> 16) & 255) + d));
  let g = Math.max(0, Math.min(255, ((n >> 8) & 255) + d));
  let b = Math.max(0, Math.min(255, (n & 255) + d));
  return `rgba(${r},${g},${b},${a})`;
}
function texFromCanvas(c, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function sqWorld(sq) {
  const { f, r } = sqFR(sq);
  return { x: (f - 3.5) * SQ, z: (3.5 - r) * SQ };
}

/* ---------- Board3D ---------- */
export class Board3D {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.flip = false;
    this.viewOnly = false;
    this.sel = null;
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    this.last = null;
    this.legal = {};
    this.chk = false;
    this.arrows = [];
    this.marks = {};
    this.drawMode = false;
    this.color = 'green';
    this.clearOnMove = true;
    this.onMove = opts.onMove || (() => {});
    this.onAnno = opts.onAnno || (() => {});
    this.canMoveFrom = opts.canMoveFrom || (() => true);
    this.anim = null;
    this.anims = [];
    this.falling = [];
    this.ghost = null;
    this.preview = null;
    this._animKey = '';
    this._T = 0;
    this._lastT = 0;
    this._turn = 'w';
    this.viewMode = VIEW_PRESET[opts.view] ? opts.view : 'top';
    this.topDown = this.viewMode !== 'tilt';
    this._userZoom = false;
    this._cam = camPreset(this.viewMode);
    this._camGoal = { ...this._cam };
    this._orbit = null;
    this.onViewChange = opts.onViewChange || (() => {});

    this._ptrs = new Map();
    this._lp = 0;
    this._lpFired = false;
    this._annoSess = null;
    this._pieceSess = null;

    this.pieces = new Map(); // sq -> { group, type, color, mesh, base }
    this._tex = {};
    this._hl = {};
    this._arrowG = null;
    this._legalG = null;
    this._markers = [];

    this._initRenderer();
    this._initScene();
    this._bind();

    this.ready = this._loadPieces().then(() => { this._syncPieces(true); this._render(); });
    this.resize();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  /* ----- renderer / scene ----- */
  _initRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.cv,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    r.setClearColor(0x14110e, 1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16120e);
    scene.fog = new THREE.Fog(0x16120e, 26, 52);
    this.scene = scene;

    const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera = cam;
    this._placeCam(1);

    // lights
    scene.add(new THREE.HemisphereLight(0xfff0dd, 0x2a241c, 0.88));
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.55);
    sun.position.set(4.5, 10, 7.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 28;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
    sun.shadow.camera.right = sun.shadow.camera.top = 8;
    sun.shadow.bias = -0.0006;
    sun.shadow.radius = 2.2;
    scene.add(sun);
    this._sun = sun;
    const fill = new THREE.DirectionalLight(0xc8d4e8, 0.42);
    fill.position.set(-6, 4, -3);
    scene.add(fill);
    const rim = new THREE.PointLight(0xffd9a0, 0.35, 18);
    rim.position.set(-3, 3.2, 5);
    scene.add(rim);

    // dark floor + compact wooden table just around the frame
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(32, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.92, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.40;
    floor.receiveShadow = true;
    scene.add(floor);
    const tableTex = texFromCanvas(woodCanvas(512, 512, '#3a2a1c', '#24180f', 9, false), 2, 2);
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(6.85, 7.05, 0.34, 64),
      new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.68, metalness: 0.05, color: 0xffffff })
    );
    table.position.y = -0.25;
    table.receiveShadow = true;
    table.castShadow = true;
    scene.add(table);

    this.boardG = new THREE.Group();
    scene.add(this.boardG);
    this._buildBoard();

    this._arrowG = new THREE.Group();
    this.boardG.add(this._arrowG);
    this._legalG = new THREE.Group();
    this.boardG.add(this._legalG);
    this._hlG = new THREE.Group();
    this.boardG.add(this._hlG);
    this._pieceG = new THREE.Group();
    this.boardG.add(this._pieceG);

    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
  }

  _buildBoard() {
    const lightTex = texFromCanvas(woodCanvas(256, 256, '#e6d2a8', '#cbb583', 3), 1, 1);
    const darkTex = texFromCanvas(woodCanvas(256, 256, '#8a5a32', '#5c3a1e', 7), 1, 1);
    const frameTex = texFromCanvas(woodCanvas(512, 256, '#5a3a22', '#3a2414', 11, false), 2, 1);
    const maple = new THREE.MeshStandardMaterial({ map: lightTex, roughness: 0.42, metalness: 0.04 });
    const walnut = new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.48, metalness: 0.05 });
    const sqGeo = new THREE.BoxGeometry(SQ * 0.992, 0.09, SQ * 0.992);

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const light = (f + r) % 2 === 1;
        const mesh = new THREE.Mesh(sqGeo, light ? maple : walnut);
        mesh.position.set((f - 3.5) * SQ, 0, (3.5 - r) * SQ);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData.sq = FILES[f] + (r + 1);
        this.boardG.add(mesh);
        // highlight overlay
        const hl = new THREE.Mesh(
          new THREE.PlaneGeometry(SQ * 0.992, SQ * 0.992),
          new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        );
        hl.rotation.x = -Math.PI / 2;
        hl.position.set((f - 3.5) * SQ, 0.051, (3.5 - r) * SQ);
        hl.renderOrder = 1;
        this._hl[FILES[f] + (r + 1)] = hl;
        // added later to _hlG
      }
    }

    // frame — thick walnut with gold inlay
    const fw = 0.72, fh = 0.28, outer = 8 * SQ + fw * 2;
    const frameMat = new THREE.MeshStandardMaterial({ map: frameTex, roughness: 0.5, metalness: 0.08, color: 0xffffff });
    const frame = new THREE.Group();
    const ring = (w, d, y, mat, h = fh) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = y;
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const long = 8 * SQ + fw * 2, thick = fw;
    // four sides
    const n = ring(long, thick, fh / 2 - 0.02, frameMat);
    n.position.z = (4 * SQ + fw / 2);
    const s = ring(long, thick, fh / 2 - 0.02, frameMat);
    s.position.z = -(4 * SQ + fw / 2);
    const e = ring(thick, 8 * SQ, fh / 2 - 0.02, frameMat);
    e.position.x = (4 * SQ + fw / 2);
    const w = ring(thick, 8 * SQ, fh / 2 - 0.02, frameMat);
    w.position.x = -(4 * SQ + fw / 2);
    frame.add(n, s, e, w);
    // lip
    const gold = new THREE.MeshStandardMaterial({ color: 0xc6a35d, roughness: 0.32, metalness: 0.72, emissive: 0x3a2a10, emissiveIntensity: 0.15 });
    const inlay = 8 * SQ + 0.06;
    const g1 = new THREE.Mesh(new THREE.BoxGeometry(inlay + 0.08, 0.03, 0.04), gold);
    g1.position.set(0, 0.15, 4 * SQ + 0.02);
    const g2 = g1.clone(); g2.position.z = -(4 * SQ + 0.02);
    const g3 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, inlay + 0.08), gold);
    g3.position.set(4 * SQ + 0.02, 0.15, 0);
    const g4 = g3.clone(); g4.position.x = -(4 * SQ + 0.02);
    frame.add(g1, g2, g3, g4);

    // corner ornaments
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 16), gold);
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([x, z]) => {
      const k = knob.clone();
      k.position.set(x * (4 * SQ + fw * 0.35), 0.2, z * (4 * SQ + fw * 0.35));
      k.castShadow = true;
      frame.add(k);
    });
    this.boardG.add(frame);
    this._frame = frame;

    // coordinates
    this._labels = new THREE.Group();
    const mkLbl = (text, x, z, rotY = 0) => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, 128, 128);
      cx.fillStyle = '#e8d5a3';
      cx.font = 'bold 80px Georgia, serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(text, 64, 68);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.42),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rotY;
      m.position.set(x, 0.152, z);
      return m;
    };
    for (let f = 0; f < 8; f++) {
      const ch = FILES[f];
      this._labels.add(mkLbl(ch, (f - 3.5) * SQ, 4 * SQ + fw * 0.28, 0));
      this._labels.add(mkLbl(ch, (f - 3.5) * SQ, -(4 * SQ + fw * 0.28), Math.PI));
    }
    for (let r = 0; r < 8; r++) {
      const ch = String(r + 1);
      this._labels.add(mkLbl(ch, -(4 * SQ + fw * 0.28), (3.5 - r) * SQ, Math.PI / 2));
      this._labels.add(mkLbl(ch, (4 * SQ + fw * 0.28), (3.5 - r) * SQ, -Math.PI / 2));
    }
    this.boardG.add(this._labels);

    // attach highlight planes
    for (const sq in this._hl) this.boardG.add(this._hl[sq]);
  }

  async _loadPieces() {
    const loader = new THREE.TextureLoader();
    const names = [];
    for (const c of ['w', 'b']) for (const p of 'KQRBNP') names.push(c + p);
    const base = new URL('./pieces/', import.meta.url).href;
    await Promise.all(names.map((n) => new Promise((res) => {
      loader.load(base + n + '.webp', (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        this._tex[n] = t;
        res();
      }, undefined, () => res());
    })));
  }

  /* ----- public API (Board-compatible) ----- */
  destroy() {
    cancelAnimationFrame(this._raf);
    this._ro && this._ro.disconnect();
    this.cv.removeEventListener('pointerdown', this._onDown);
    this.cv.removeEventListener('pointermove', this._onMove);
    this.cv.removeEventListener('pointerup', this._onUp);
    this.cv.removeEventListener('pointercancel', this._onUp);
    this.cv.removeEventListener('contextmenu', this._onCtx);
    this.cv.removeEventListener('wheel', this._onWheel);
    this.renderer.dispose();
  }

  setPosition({ fen, last, legal, chk, flip, viewOnly, n }) {
    const prevFen = this.fen;
    if (fen) { const parts = fen.split(' '); this.fen = parts[0]; if (parts[1]) this._turn = parts[1]; }
    if (last !== undefined) this.last = last;
    if (legal !== undefined) this.legal = legal || {};
    if (chk !== undefined) this.chk = !!chk;
    if (flip !== undefined) {
      const next = !!flip;
      if (next !== this.flip && this.boardG && !this._orientReady) {
        // first orientation (e.g. sitting as black): snap, don't spin the opening shot
        this.boardG.rotation.y = next ? Math.PI : 0;
      }
      this._orientReady = true;
      this.flip = next;
    }
    if (viewOnly !== undefined) this.viewOnly = !!viewOnly;
    const key = (last ? last.join('') : '-') + (n ?? this.fen);
    if (key !== this._animKey) {
      if (this._animKey && last && last[0] && last[1] && prevFen) this._startAnim(prevFen, last);
      else this.anim = null;
      this._animKey = key;
    }
    this._syncPieces(false);
    this._syncHighlights();
    this._syncArrows();
    this._syncLegal();
  }
  setDrawMode(on) { this.drawMode = !!on; if (!on && this._annoSess && !this._annoSess.sticky) this._cancelAnno(); this._syncArrows(); }
  setColor(c) { if (ANNO[c]) this.color = c; }
  setClearOnMove(v) { this.clearOnMove = !!v; }
  clearAnnotations() { this.arrows = []; this.marks = {}; this.preview = null; this.onAnno(); this._syncArrows(); this._syncHighlights(); }
  afterMoveClears() { if (this.clearOnMove) this.clearAnnotations(); this.sel = null; this.ghost = null; this._syncLegal(); this._syncHighlights(); }
  setTurn(t) { this._turn = t; }
  setView(mode, { immediate = false } = {}) {
    if (!VIEW_PRESET[mode]) mode = 'top';
    this.viewMode = mode;
    this.topDown = mode !== 'tilt';
    this._userZoom = false;
    this._camGoal = camPreset(mode);
    this._fitDist();
    if (immediate) {
      this._cam = { ...this._camGoal };
      this._placeCam(1);
    }
    this.onViewChange(mode);
  }
  cycleView() {
    const i = VIEW_ORDER.indexOf(this.viewMode);
    this.setView(VIEW_ORDER[(i + 1) % VIEW_ORDER.length]);
    return this.viewMode;
  }
  setTopDown(on) {
    // Compat: true → top-down 3D (the new default), false → cinematic tilt.
    this.setView(on ? 'top' : 'tilt');
  }
  resetCamera() {
    this._userZoom = false;
    this._camGoal = camPreset(this.viewMode);
    this._fitDist();
    this._cam = { ...this._camGoal };
    this._placeCam(1);
  }

  /** Frame the board (with a little margin) on the current aspect. */
  _fitDist() {
    if (!this.camera || !this.boardG) return;
    const ext = 4 * SQ + 0.78;
    const corners = [];
    for (const x of [-ext, ext]) for (const z of [-ext, ext]) corners.push(new THREE.Vector3(x, 0.05, z));
    const cam = this.camera;
    const g = this._camGoal;
    const save = cam.position.clone();
    const proj = (dist) => {
      cam.position.set(
        Math.sin(g.azim) * Math.sin(g.polar) * dist,
        Math.cos(g.polar) * dist,
        Math.cos(g.azim) * Math.sin(g.polar) * dist
      );
      cam.lookAt(0, g.targetY, 0);
      cam.updateMatrixWorld(true);
      if (cam.autoUpdate) cam.updateProjectionMatrix();
      let maxAbsX = 0, minY = 1, maxY = -1;
      const v = new THREE.Vector3();
      for (const p of corners) {
        v.copy(p);
        this.boardG.updateMatrixWorld(true);
        this.boardG.localToWorld(v);
        v.project(cam);
        maxAbsX = Math.max(maxAbsX, Math.abs(v.x));
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
      return { maxAbsX, minY, maxY };
    };
    // Fill more of the portrait width in top-down / 2D; leave a little more
    // margin in the tilted view so the near edge isn't clipped.
    const fill = this.viewMode === 'tilt' ? 0.82 : 0.90;
    let dist = g.dist;
    for (let i = 0; i < 8; i++) {
      const r = proj(dist);
      const sx = r.maxAbsX / fill;
      // also keep the near edge (smaller y, bottom of screen) above -0.78
      // so piece bases aren't clipped; if minY < -0.78, pull back
      const sy = r.minY < -0.78 ? (-r.minY / 0.78) : 1;
      const s = Math.max(sx, sy, 0.4);
      dist = Math.min(19, Math.max(9.5, dist * s));
      if (Math.abs(s - 1) < 0.025) break;
    }
    g.dist = dist;
    cam.position.copy(save);
  }

  _projectClient(v) {
    const p = v.clone().project(this.camera);
    const r = this.cv.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
  }
  sqClient(sq) {
    // Project the board-surface center so it round-trips with plane picking.
    const p = sqWorld(sq);
    const v = new THREE.Vector3(p.x, 0.051, p.z);
    this.boardG.localToWorld(v);
    return this._projectClient(v);
  }
  /** Screen position of a standee's mid-face — where a finger actually aims. */
  pieceClient(sq) {
    const piece = this.pieces.get(sq);
    if (!piece) return this.sqClient(sq);
    const h = PIECE_H[piece.type] || 1.4;
    const mid = new THREE.Vector3(0, (h / 2) * (piece.mesh.scale.y || 1) + 0.05, 0);
    piece.mesh.updateWorldMatrix(true, false);
    mid.applyMatrix4(piece.mesh.matrixWorld);
    return this._projectClient(mid);
  }

  resize() {
    const wrap = this.cv.parentElement || this.cv;
    const w = Math.max(120, wrap.clientWidth);
    const h = Math.max(120, wrap.clientHeight);
    const dpr = Math.min(1.85, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (!this._userZoom) this._fitDist();
    if (!this._ro) {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(wrap);
    }
  }

  render() {
    this._syncHighlights();
    this._syncArrows();
    this._syncLegal();
    this._render();
  }

  /* ----- pieces ----- */
  _board(fen = this.fen) {
    const bd = {}, rows = fen.split('/');
    rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { bd[FILES[f] + (8 - r)] = ch; f++; } } });
    return bd;
  }

  _syncPieces(instant) {
    const bd = this._board();
    const moving = new Set();
    if (this.anim) { moving.add(this.anim.from); moving.add(this.anim.to); }
    this.anims.forEach((a) => { moving.add(a.from); moving.add(a.to); });

    // remove pieces no longer present (unless animating/falling)
    for (const [sq, p] of [...this.pieces]) {
      if (!bd[sq] || bd[sq] !== p.code) {
        if (!p._falling && !p._moving) {
          this._pieceG.remove(p.group);
          this.pieces.delete(sq);
        }
      }
    }
    for (const sq of Object.keys(bd)) {
      const code = bd[sq];
      const cur = this.pieces.get(sq);
      if (cur && cur.code === code && !cur._moving && !cur._falling) {
        this._ensureTex(cur);
        this._placeGroup(cur.group, sq, instant);
        continue;
      }
      if (moving.has(sq)) continue;
      if (cur) { this._pieceG.remove(cur.group); this.pieces.delete(sq); }
      const p = this._makePiece(code);
      this._placeGroup(p.group, sq, true);
      this._pieceG.add(p.group);
      this.pieces.set(sq, p);
    }
    this._syncHighlights();
  }

  _makePiece(code) {
    const color = code === code.toUpperCase() ? 'w' : 'b';
    const type = code.toUpperCase();
    const key = color + type;
    const h = PIECE_H[type] || 1.4;
    const tex = this._tex[key];
    const aspect = tex && tex.image ? (tex.image.width / tex.image.height) : 0.55;
    const w = h * aspect;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2 + 0.05, 0);
    const mat = new THREE.MeshBasicMaterial({
      map: tex || null,
      transparent: true,
      alphaTest: 0.12,
      depthWrite: true,
      side: THREE.DoubleSide,
      color: 0xffffff,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.renderOrder = 3;

    const br = BASE_R[type] || 0.2;
    const baseCol = color === 'w' ? 0xe8dcc4 : 0x1a1614;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(br * 0.92, br, 0.07, 24),
      new THREE.MeshStandardMaterial({
        color: baseCol, roughness: color === 'w' ? 0.28 : 0.35, metalness: 0.12,
        emissive: color === 'w' ? 0x221800 : 0x000000, emissiveIntensity: 0.05,
      })
    );
    base.position.y = 0.055;
    base.castShadow = true;
    base.receiveShadow = true;

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(br * 1.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.053;
    shadow.renderOrder = 1;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(br * 1.15, 0.025, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xc6e86a, transparent: true, opacity: 0, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    ring.renderOrder = 2;

    const group = new THREE.Group();
    group.add(shadow, base, ring, mesh);
    return { group, mesh, base, ring, shadow, code, color, type, _moving: false, _falling: false };
  }

  _ensureTex(p) {
    const key = p.color + p.type;
    const tex = this._tex[key];
    if (!tex || p.mesh.material.map === tex) return;
    p.mesh.material.map = tex;
    p.mesh.material.needsUpdate = true;
    const h = PIECE_H[p.type] || 1.4;
    const aspect = tex.image ? (tex.image.width / tex.image.height) : 0.55;
    const w = h * aspect;
    p.mesh.geometry.dispose();
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2 + 0.05, 0);
    p.mesh.geometry = geo;
  }

  _placeGroup(g, sq, instant) {
    const p = sqWorld(sq);
    if (instant) g.position.set(p.x, 0, p.z);
    else { g.position.x = p.x; g.position.z = p.z; }
  }

  _startAnim(prevFen, last) {
    const [from, to] = last;
    const prev = this._board(prevFen);
    const next = this._board(this.fen);
    this.anims = [];
    // moving piece
    const mover = this.pieces.get(from) || this.pieces.get(to);
    if (mover) {
      this.pieces.delete(from);
      const a = { kind: 'move', from, to, t: 0, dur: 0.22, piece: mover, captured: null };
      mover._moving = true;
      // captured on destination?
      const cap = this.pieces.get(to);
      if (cap && cap !== mover) {
        a.captured = cap;
        cap._falling = true;
        this.pieces.delete(to);
        this.falling.push({ piece: cap, t: 0, dur: 0.38, from: sqWorld(to) });
      }
      this.anims.push(a);
    }
    // castle: rook jump
    const isK = (prev[from] === 'K' || prev[from] === 'k');
    if (isK && from[1] === to[1] && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
      const rank = from[1];
      const kingside = to[0] === 'g';
      const rf = kingside ? 'h' + rank : 'a' + rank;
      const rt = kingside ? 'f' + rank : 'd' + rank;
      const rook = this.pieces.get(rf);
      if (rook) {
        this.pieces.delete(rf);
        rook._moving = true;
        this.anims.push({ kind: 'move', from: rf, to: rt, t: 0, dur: 0.22, piece: rook, captured: null });
      }
    }
    // en passant
    const isP = prev[from] === 'P' || prev[from] === 'p';
    if (isP && from[0] !== to[0] && !prev[to]) {
      const capSq = to[0] + from[1];
      const cap = this.pieces.get(capSq);
      if (cap) {
        cap._falling = true;
        this.pieces.delete(capSq);
        this.falling.push({ piece: cap, t: 0, dur: 0.38, from: sqWorld(capSq) });
      }
    }
    this.anim = this.anims[0] || null;
  }

  _tickAnims(dt) {
    let dirty = false;
    for (const a of this.anims) {
      a.t += dt / a.dur;
      const k = Math.min(1, a.t);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      const A = sqWorld(a.from), B = sqWorld(a.to);
      const hop = Math.sin(Math.PI * Math.min(1, k)) * 0.42;
      a.piece.group.position.set(A.x + (B.x - A.x) * e, hop, A.z + (B.z - A.z) * e);
      dirty = true;
      if (k >= 1) {
        a.piece._moving = false;
        this._placeGroup(a.piece.group, a.to, true);
        this.pieces.set(a.to, a.piece);
      }
    }
    this.anims = this.anims.filter((a) => a.t < 1);
    this.anim = this.anims[0] || null;

    for (const f of this.falling) {
      f.t += dt / f.dur;
      const k = Math.min(1, f.t);
      const g = f.piece.group;
      g.position.y = f.from ? 0 : g.position.y;
      g.position.y = -k * 0.9;
      g.rotation.x = k * 1.15;
      g.position.z = (f.from ? f.from.z : g.position.z) + k * 0.35;
      const mats = [];
      g.traverse((o) => { if (o.material && o.material.opacity != null) mats.push(o.material); });
      mats.forEach((m) => { m.transparent = true; m.opacity = 1 - k; m.depthWrite = k < 0.7; });
      dirty = true;
      if (k >= 1) {
        this._pieceG.remove(g);
      }
    }
    this.falling = this.falling.filter((f) => f.t < 1);
    return dirty;
  }

  /* ----- highlights, arrows, legal ----- */
  _syncHighlights() {
    const last = this.last || [];
    for (const sq in this._hl) {
      const m = this._hl[sq].material;
      let col = null, op = 0;
      if (this.marks[sq]) { col = ANNO[this.marks[sq]].arrow; op = 0.48; }
      if (last[0] === sq || last[1] === sq) { col = '#e8c15a'; op = this.marks[sq] ? 0.55 : 0.40; }
      if (this.sel === sq) { col = '#7ad07a'; op = 0.48; }
      if (this.chk) {
        const bd = this._board();
        const king = this._turn === 'w' ? 'K' : 'k';
        if (bd[sq] === king) { col = '#e04a3a'; op = 0.52 + Math.sin(this._T * 6) * 0.1; }
      }
      if (this.preview && this.preview.type === 'mark' && this.preview.sq === sq) {
        col = ANNO[this.preview.color].arrow; op = 0.4;
      }
      if (col) { m.color.set(col); m.opacity = op; this._hl[sq].visible = true; }
      else { m.opacity = 0; this._hl[sq].visible = false; }
    }
    // selection rings
    for (const [sq, p] of this.pieces) {
      const on = this.sel === sq;
      p.ring.material.opacity = on ? 0.9 : 0;
      p.group.position.y = on && !p._moving ? 0.04 + Math.sin(this._T * 8) * 0.015 : (p._moving || p._falling ? p.group.position.y : 0);
    }
  }

  _syncLegal() {
    while (this._legalG.children.length) {
      const c = this._legalG.children[0];
      this._legalG.remove(c);
      c.geometry && c.geometry.dispose();
    }
    const dests = (!this.viewOnly && this.sel && this.legal[this.sel]) ? this.legal[this.sel] : [];
    const bd = this._board();
    for (const sq of dests) {
      const p = sqWorld(sq);
      const capture = !!bd[sq];
      let mesh;
      if (capture) {
        mesh = new THREE.Mesh(
          new THREE.RingGeometry(0.28, 0.40, 28),
          new THREE.MeshBasicMaterial({ color: 0x1a120c, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide })
        );
      } else {
        mesh = new THREE.Mesh(
          new THREE.CircleGeometry(0.155, 22),
          new THREE.MeshBasicMaterial({ color: 0x1a120c, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide })
        );
      }
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(p.x, 0.058, p.z);
      mesh.renderOrder = 2;
      this._legalG.add(mesh);
    }
  }

  _syncArrows() {
    while (this._arrowG.children.length) {
      const c = this._arrowG.children[0];
      this._arrowG.remove(c);
      c.geometry && c.geometry.dispose();
    }
    const list = this.arrows.slice();
    if (this.preview && this.preview.type === 'arrow') {
      list.push({ from: this.preview.from, to: this.preview.to, color: this.preview.color, preview: true });
    }
    for (const a of list) {
      const mesh = this._arrowMesh(a.from, a.to, ANNO[a.color]?.arrow || '#15781B', a.preview ? 0.55 : 0.84);
      if (mesh) this._arrowG.add(mesh);
    }
  }

  _arrowMesh(from, to, color, alpha) {
    if (!from || !to || from === to) return null;
    const pts = [sqWorld(from)];
    if (isKnightMove(from, to)) {
      const corner = this._knightCorner(from, to);
      pts.push(sqWorld(corner));
    }
    pts.push(sqWorld(to));
    // Convert to 2d x/z path and build a Shape
    const p2 = pts.map((p) => ({ x: p.x, y: p.z }));
    const shape = arrowShape(p2, SQ);
    if (!shape) return null;
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.07;
    mesh.renderOrder = 4;
    return mesh;
  }

  _knightCorner(from, to) {
    const A = sqFR(from), B = sqFR(to);
    const dx = B.f - A.f, dy = B.r - A.r;
    let cf, cr;
    if (Math.abs(dx) === 2) { cf = A.f + dx; cr = A.r; }
    else { cf = A.f; cr = A.r + dy; }
    return frSq(cf, cr);
  }

  /* ----- camera ----- */
  _placeCam(k = 1) {
    const g = this._camGoal, c = this._cam;
    c.polar += (g.polar - c.polar) * (1 - Math.pow(0.001, k));
    // unwrap azim
    let daz = g.azim - c.azim;
    while (daz > Math.PI) daz -= Math.PI * 2;
    while (daz < -Math.PI) daz += Math.PI * 2;
    c.azim += daz * (1 - Math.pow(0.001, k));
    c.dist += (g.dist - c.dist) * (1 - Math.pow(0.001, k));
    c.targetY += (g.targetY - c.targetY) * (1 - Math.pow(0.001, k));
    const az = c.azim;
    const x = Math.sin(az) * Math.sin(c.polar) * c.dist;
    const y = Math.cos(c.polar) * c.dist;
    const z = Math.cos(az) * Math.sin(c.polar) * c.dist;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, c.targetY, 0);
    if (!this.boardG) return;
    // Flip is a 180° yaw of the board so black sits at the near edge with h on the left.
    const goal = this.flip ? Math.PI : 0;
    let r = this.boardG.rotation.y;
    let d = goal - r;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const fk = k >= 1 ? 1 : (1 - Math.pow(0.0008, Math.max(k, 0.016)));
    this.boardG.rotation.y = r + d * fk;
  }

  _billboard() {
    const cam = this.camera;
    const polar = this._cam.polar;
    const polarDeg = polar / DEG;
    const lean = smoothstep(58, 10, polarDeg);
    const tmp = new THREE.Vector3();
    const look = new THREE.Vector3();
    const flat = this.viewMode === 'flat';
    if (!this._qDesired) {
      this._qDesired = new THREE.Quaternion();
      this._qParent = new THREE.Quaternion();
      this._mBasis = new THREE.Matrix4();
      this._off = new THREE.Vector3();
    }
    for (const p of this.pieces.values()) {
      p.group.getWorldPosition(tmp);
      const h = PIECE_H[p.type] || 1.4;
      if (flat) {
        // Photo tokens on the squares: face-up, image upright on screen.
        // Avoid Object3D.lookAt — it goes degenerate with an overhead camera
        // and collapses standees into slivers.
        // local +Z (plane normal) → world +Y; local +Y (image up) → world -Z (far).
        this._mBasis.makeBasis(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(0, 1, 0)
        );
        this._qDesired.setFromRotationMatrix(this._mBasis);
        p.group.getWorldQuaternion(this._qParent);
        p.mesh.quaternion.copy(this._qParent).invert().multiply(this._qDesired);
        const tex = p.mesh.material && p.mesh.material.map;
        const aspect = tex && tex.image ? (tex.image.width / tex.image.height) : 0.55;
        const s = 0.92 / Math.max(h, h * aspect);
        p.mesh.scale.setScalar(s);
        this._off.set(0, (h / 2 + 0.05) * s, 0).applyQuaternion(p.mesh.quaternion);
        p.mesh.position.set(-this._off.x, 0.08 - this._off.y, -this._off.z);
        if (p.base) p.base.visible = false;
        if (p.shadow) p.shadow.visible = false;
      } else {
        p.mesh.position.set(0, 0, 0);
        if (p.base) p.base.visible = true;
        if (p.shadow) p.shadow.visible = true;
        look.copy(cam.position);
        look.y = tmp.y + 0.55;
        if (lean > 0.01) look.lerp(cam.position, lean);
        p.mesh.lookAt(look);
        const pitch = lean * (Math.PI / 2 - polar);
        const foot = h * Math.sin(Math.max(0, pitch));
        let s = foot > 0.92 ? 0.92 / foot : 1;
        const apparent = Math.sin(Math.max(0.08, polar + pitch * 0.35));
        if (s === 1 && apparent < 0.42) s = Math.min(1.22, 0.42 / Math.max(0.2, apparent));
        p.mesh.scale.setScalar(s);
      }
    }
    for (const f of this.falling) {
      f.piece.group.getWorldPosition(tmp);
      look.copy(cam.position); look.y = tmp.y + 0.4;
      f.piece.mesh.lookAt(look);
    }
  }

  /* ----- input ----- */
  _bind() {
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onCtx = (e) => e.preventDefault();
    this._onWheel = this._onWheel.bind(this);
    this.cv.addEventListener('pointerdown', this._onDown);
    this.cv.addEventListener('pointermove', this._onMove);
    this.cv.addEventListener('pointerup', this._onUp);
    this.cv.addEventListener('pointercancel', this._onUp);
    this.cv.addEventListener('pointerleave', (e) => { if (this._ptrs.has(e.pointerId) && e.pointerType === 'mouse') this._onUp(e); });
    this.cv.addEventListener('contextmenu', this._onCtx);
    this.cv.addEventListener('wheel', this._onWheel, { passive: false });
    this.cv.style.touchAction = 'none';
    this.cv.style.userSelect = 'none';
    this.cv.style.webkitUserSelect = 'none';
  }

  _setRay(clientX, clientY) {
    const r = this.cv.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    return true;
  }
  _sqFromLocal(loc) {
    const f = Math.floor(loc.x / SQ + 4);
    const rr = Math.floor(4 - loc.z / SQ);
    if (f < 0 || f > 7 || rr < 0 || rr > 7) return null;
    return FILES[f] + (rr + 1);
  }
  _planeHit(clientX, clientY) {
    if (!this._setRay(clientX, clientY)) return null;
    // Invisible board plane only — ignore piece meshes, the table, and the frame.
    // Plane is world y=0; the board only yaws, so that is the board surface.
    if (!this._ray.ray.intersectPlane(this._plane, this._hit)) return null;
    const loc = this.boardG.worldToLocal(this._hit.clone());
    const sq = this._sqFromLocal(loc);
    const frame = !sq && Math.abs(loc.x) < 5.6 && Math.abs(loc.z) < 5.6;
    return { sq, frame, hit: this._hit.clone(), loc };
  }
  /**
   * Nearest standee to a screen point, measured at the mid-face — the spot
   * a finger actually aims at. Mesh raycasts are the wrong tool: a tall
   * front piece (the king on e1) sits in front of the pawn on e2 and would
   * steal the hit.
   */
  _nearestPieceScreen(clientX, clientY) {
    let best = null, bestD = Infinity;
    for (const [sq, p] of this.pieces) {
      if (p._falling) continue;
      const c = this.pieceClient(sq);
      const d = Math.hypot(c.x - clientX, c.y - clientY);
      if (d < bestD) { bestD = d; best = sq; }
    }
    if (!best) return null;
    const { f, r } = sqFR(best);
    const nb = frSq(f < 7 ? f + 1 : f - 1, r);
    const a = this.sqClient(best), b = this.sqClient(nb);
    const sqPx = Math.hypot(a.x - b.x, a.y - b.y) || 40;
    return { sq: best, d: bestD, sqPx };
  }
  /**
   * Map a pointer to a square.
   * Always intersects the invisible board plane (never the table or standee
   * meshes) for the ground square. When preferPieces is set, a standee whose
   * visual center is closer to the finger than the ground-square center
   * wins — that's how a tap on a pawn's face, which sits "above" the square
   * in perspective, stays on that pawn instead of a square ranks away.
   */
  _sqAt(clientX, clientY, { preferPieces = false } = {}) {
    const plane = this._planeHit(clientX, clientY) || { sq: null, frame: false, hit: null };
    if (!preferPieces) return plane;
    const near = this._nearestPieceScreen(clientX, clientY);
    if (!near) return plane;
    if (plane.sq) {
      const pc = this.sqClient(plane.sq);
      const dPlane = Math.hypot(pc.x - clientX, pc.y - clientY);
      // Only steal from the ground square when the finger is clearly closer
      // to the piece's face than to the square center. A tall king on e1
      // must not grab a tap on e2's square.
      if (near.d < dPlane * 0.75 && near.d < near.sqPx * 0.55) {
        return { sq: near.sq, frame: false, hit: plane.hit };
      }
      return plane;
    }
    if (near.d < near.sqPx * 0.55) {
      return { sq: near.sq, frame: false, hit: plane.hit };
    }
    return plane;
  }
  _clientXY(e) {
    const tracked = this._ptrs.get(e.pointerId);
    // Touch events (if any bubble here) stash coords on changedTouches, not clientX.
    if (e.changedTouches && e.changedTouches.length) {
      let t = e.changedTouches[0];
      for (const x of e.changedTouches) {
        if (tracked && Math.hypot(x.clientX - tracked.x, x.clientY - tracked.y) < Math.hypot(t.clientX - tracked.x, t.clientY - tracked.y)) t = x;
      }
      return { x: t.clientX, y: t.clientY };
    }
    const stale = (e.type === 'lostpointercapture' || e.type === 'pointercancel' || e.type === 'pointerleave'
      || (e.clientX === 0 && e.clientY === 0 && tracked));
    if (stale && tracked) return { x: tracked.x, y: tracked.y };
    return { x: e.clientX, y: e.clientY };
  }


  _colorForEvent(e) {
    if (e.shiftKey) return 'red';
    if (e.altKey) return 'blue';
    if (e.ctrlKey || e.metaKey) return 'orange';
    return this.color;
  }
  _cancelLP() { if (this._lp) { clearTimeout(this._lp); this._lp = 0; } }
  _cancelAnno() { this._annoSess = null; this.preview = null; this._syncArrows(); }

  _onWheel(e) {
    e.preventDefault();
    const g = this._camGoal;
    this._userZoom = true;
    g.dist = Math.max(8, Math.min(22, g.dist + e.deltaY * 0.012));
  }

  _onDown(e) {
    if (e.button === 1) return;
    try { this.cv.setPointerCapture(e.pointerId); } catch (_) {}
    const { x, y } = this._clientXY(e);
    // Prefer the piece under the finger so a drag starts on the square the
    // standee actually occupies, not the plane-hit several ranks behind it.
    const hit = this._sqAt(x, y, { preferPieces: true }) || {};
    const sq = hit.sq || null;
    this._ptrs.set(e.pointerId, { x, y, sq, t: performance.now(), button: e.button, _sx: x, _sy: y });

    // two-finger annotation
    if (this._ptrs.size >= 2 && e.button !== 2) {
      this._cancelLP();
      this._pieceSess = null;
      this.ghost = null;
      this.sel = null;
      this._orbit = null;
      const pts = [...this._ptrs.values()];
      const a = pts[0].sq, b = sq;
      if (a) {
        this._annoSess = { from: a, color: this.color, sticky: true, two: true };
        this.preview = a && b && a !== b ? { type: 'arrow', from: a, to: b, color: this.color } : (a ? { type: 'mark', sq: a, color: this.color } : null);
        this._syncArrows();
      }
      e.preventDefault();
      return;
    }

    // right-click annotation
    if (e.button === 2) {
      this._cancelLP();
      this._pieceSess = null;
      this._orbit = null;
      if (sq) {
        this._annoSess = { from: sq, color: this._colorForEvent(e), sticky: true };
        this.preview = { type: 'mark', sq, color: this._annoSess.color };
        this._syncHighlights();
      }
      e.preventDefault();
      return;
    }

    if (this.drawMode && sq) {
      this._orbit = null;
      this._annoSess = { from: sq, color: this._colorForEvent(e), sticky: true };
      this.preview = { type: 'mark', sq, color: this._annoSess.color };
      this._syncHighlights();
      e.preventDefault();
      return;
    }

    // Orbit is only allowed in the tilted cinematic view, and only when the
    // press starts off the squares — never starts an arrow.
    if (!sq && this.viewMode === 'tilt' && !this.drawMode) {
      this._orbit = { x, y, azim: this._camGoal.azim, polar: this._camGoal.polar, pid: e.pointerId, armed: false };
    }

    // long-press annotation
    this._lpFired = false;
    this._cancelLP();
    const startSq = sq;
    const startX = x, startY = y, pid = e.pointerId;
    this._lp = setTimeout(() => {
      this._lp = 0;
      const p = this._ptrs.get(pid);
      if (!p || !startSq) return;
      this._lpFired = true;
      this._pieceSess = null;
      this.ghost = null;
      this.sel = null;
      this._orbit = null;
      this._annoSess = { from: startSq, color: this.color, sticky: false };
      this.preview = { type: 'mark', sq: startSq, color: this.color };
      try { navigator.vibrate && navigator.vibrate(18); } catch (_) {}
      this._syncHighlights();
    }, 420);

    if (sq && !this.viewOnly) {
      const bd = this._board();
      const piece = bd[sq];
      const mine = piece && this.canMoveFrom(sq, piece);
      if (this.sel && this.legal[this.sel] && this.legal[this.sel].includes(sq)) {
        this._pieceSess = { from: this.sel, startSq: this.sel, x: startX, y: startY, moved: false, pendingMoveTo: sq };
        this._orbit = null;
        return;
      }
      if (mine && this.legal[sq]) {
        this.sel = sq;
        this._pieceSess = { from: sq, startSq: sq, x: startX, y: startY, moved: false };
        this._orbit = null;
        this._syncLegal();
        this._syncHighlights();
        return;
      }
      if (this.sel) { this.sel = null; this._syncLegal(); this._syncHighlights(); }
      this._pieceSess = null;
    }
  }

  _onMove(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    const { x, y } = this._clientXY(e);
    p.x = x; p.y = y;
    // End squares use the board plane only — the destination is a square,
    // and we must not let a tall standee steal a far empty square.
    const hit = this._sqAt(x, y, { preferPieces: false }) || {};
    const sq = hit.sq || null;
    p.sq = sq; // may be null when the finger leaves the board
    const movedPx = Math.hypot(x - (this._pieceSess ? this._pieceSess.x : (p._sx ?? p.x)), y - (this._pieceSess ? this._pieceSess.y : (p._sy ?? p.y)));
    if (movedPx > 12) this._cancelLP();

    if (this._annoSess && this._annoSess.two && this._ptrs.size >= 2) {
      const pts = [...this._ptrs.values()];
      const a = this._annoSess.from, b = pts[1].sq || sq;
      this.preview = a && b && a !== b ? { type: 'arrow', from: a, to: b, color: this._annoSess.color } : (a ? { type: 'mark', sq: a, color: this._annoSess.color } : null);
      this._syncArrows();
      return;
    }
    if (this._annoSess) {
      const a = this._annoSess.from, b = sq;
      this.preview = a && b && a !== b ? { type: 'arrow', from: a, to: b, color: this._annoSess.color } : (a ? { type: 'mark', sq: a, color: this._annoSess.color } : null);
      this._syncArrows();
      this._syncHighlights();
      return;
    }

    if (this._orbit && this._orbit.pid === e.pointerId && !this._pieceSess && !this._annoSess) {
      const dx = x - this._orbit.x;
      const dy = y - this._orbit.y;
      if (!this._orbit.armed) {
        if (Math.hypot(dx, dy) < 14) return;
        this._orbit.armed = true;
      }
      this._camGoal.azim = this._orbit.azim - dx * 0.005;
      this._camGoal.polar = Math.max(12 * DEG, Math.min(72 * DEG, this._orbit.polar - dy * 0.0045));
      return;
    }

    if (this._pieceSess && !this._lpFired) {
      if (movedPx > 14) {
        this._pieceSess.moved = true;
        const from = this._pieceSess.from;
        const piece = this.pieces.get(from);
        if (piece && hit.hit) {
          const loc = this.boardG.worldToLocal(hit.hit.clone());
          piece.group.position.set(loc.x, 0.22, loc.z);
          this.ghost = { sq: from };
        }
      }
    }
  }

  _onUp(e) {
    if (!this._ptrs.has(e.pointerId)) return;
    const p = this._ptrs.get(e.pointerId);
    const { x, y } = this._clientXY(e);
    this._ptrs.delete(e.pointerId);
    this._cancelLP();
    const movedPx = Math.hypot(x - (p._sx ?? p.x), y - (p._sy ?? p.y));
    // Destination: plane only. Do not fall back to a stale start square —
    // that was drawing arrows "across the board" when the release was off-board
    // or the event coords were stale.
    const hit = this._sqAt(x, y, { preferPieces: false }) || {};
    const sq = hit.sq || null;

    if (this._orbit && this._orbit.pid === e.pointerId) {
      this._orbit = null;
      // A frame-drag is never an arrow, even if it wandered onto the board.
      try { this.cv.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }

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
      // A tap (no meaningful drag) is a highlight, even if perspective
      // makes the plane-hit at pointer-up land on a neighbor square.
      // A drag that leaves the board creates nothing.
      if (from && to && from !== to && movedPx >= 16) this._toggleArrow(from, to, col);
      else if (from && movedPx < 16) this._toggleMark(from, col);
      // else: dragged off the board — drop the preview, create nothing
      try { this.cv.releasePointerCapture(e.pointerId); } catch (_) {}
      this._syncArrows();
      this._syncHighlights();
      return;
    }
    if (this._lpFired) { this._lpFired = false; this.preview = null; this._syncHighlights(); return; }

    if (this._pieceSess) {
      const sess = this._pieceSess;
      this._pieceSess = null;
      this.ghost = null;
      const mover = this.pieces.get(sess.from);
      if (mover && !mover._moving) this._placeGroup(mover.group, sess.from, true);
      // For a capture, the destination piece's face is a valid drop target.
      const destPiece = this._sqAt(x, y, { preferPieces: true }) || {};
      const dest = (destPiece.sq && this.legal[sess.from] && this.legal[sess.from].includes(destPiece.sq))
        ? destPiece.sq
        : sq;
      const legalDest = dest && this.legal[sess.from] && this.legal[sess.from].includes(dest);
      // A tap on a piece face can plane-hit a neighbor (e.g. e2 → e3). That
      // is a tap to select, not a one-square move. Only a real drag, or a
      // second tap on a legal destination, commits.
      if (legalDest && (sess.moved || movedPx >= 16)) {
        this._commitMove(sess.from, dest);
      } else if (legalDest && sess.pendingMoveTo && dest === sess.pendingMoveTo) {
        this._commitMove(sess.from, dest);
      } else if (!sess.moved && (dest === sess.from || movedPx < 16 || !dest)) {
        this.sel = sess.from;
      } else if (!sess.moved && dest && this.legal[dest] && this.canMoveFrom(dest, this._board()[dest])) {
        this.sel = dest;
      } else if (!sess.moved) {
        this.sel = null;
      }
      // dragged to an illegal / off-board square: keep selection
      this._syncLegal();
      this._syncHighlights();
    }
    try { this.cv.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  _commitMove(from, to) {
    this.sel = null;
    this.ghost = null;
    this.onMove(from, to);
  }
  _toggleArrow(from, to, color) {
    const i = this.arrows.findIndex((a) => a.from === from && a.to === to);
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

  /* ----- loop ----- */
  _loop(t) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = this._lastT ? Math.min(0.05, (t - this._lastT) / 1000) : 0.016;
    this._lastT = t; this._T += dt;
    this._placeCam(dt);
    this._tickAnims(dt);
    this._billboard();
    if (this.sel || this.chk) this._syncHighlights();
    this._render();
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
  }
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Build a THREE.Shape for an arrow through points {x,y} in board XZ (y is z). */
function arrowShape(pts, sq) {
  if (pts.length < 2) return null;
  const shaftW = sq * 0.22;
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const d = Math.hypot(last.x - prev.x, last.y - prev.y);
  if (d < 0.08) return null;
  const headL = Math.min(sq * 0.48, d * 0.62);
  const headW = sq * 0.38;
  const ux = (last.x - prev.x) / d, uy = (last.y - prev.y) / d;
  const base = { x: last.x - ux * headL, y: last.y - uy * headL };
  const p = pts.slice(0, -1).concat([base]);
  const half = shaftW / 2;
  const L = [], R = [];
  const perp = (dx, dy) => {
    const l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  };
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
  const s = new THREE.Shape();
  s.moveTo(L[0].x, L[0].y);
  for (let i = 1; i < L.length; i++) s.lineTo(L[i].x, L[i].y);
  s.lineTo(base.x - uy * headW, base.y + ux * headW);
  s.lineTo(last.x, last.y);
  s.lineTo(base.x + uy * headW, base.y - ux * headW);
  for (let i = R.length - 1; i >= 0; i--) s.lineTo(R[i].x, R[i].y);
  s.closePath();
  return s;
}

export { ANNO, COLOR_KEYS };
