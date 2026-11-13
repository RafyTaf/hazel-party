'use strict';

/** Client-side Lichess Board API + OAuth2 PKCE. The access token never leaves the device. */

export const HOST = 'https://lichess.org';
export const CLIENT_ID = 'hazel-chess';
export const SCOPES = ['board:play', 'challenge:read', 'challenge:write'];
export const TOKEN_KEY = 'hc_lichess_token';
export const PKCE_KEY = 'hc_lichess_pkce';

/* ---------- time controls (Board API seek: rapid / classical / correspondence only) ---------- */
/** Lichess estimated minutes = initial + 40*increment/60. Rapid 8–25, Classical ≥25, Blitz 3–8. */
export function estimatedMinutes(timeMin, incrementSec) {
  return timeMin + (40 * (incrementSec || 0)) / 60;
}
export function classifySpeed(timeMin, incrementSec) {
  const e = estimatedMinutes(timeMin, incrementSec);
  if (e < 3) return 'bullet';
  if (e < 8) return 'blitz';
  if (e < 25) return 'rapid';
  return 'classical';
}
/** Public real-time seeks may only be rapid or classical. */
export function seekAllowed(timeMin, incrementSec) {
  const s = classifySpeed(timeMin, incrementSec);
  return s === 'rapid' || s === 'classical';
}

export const SEEK_CONTROLS = [
  { id: '10+0', time: 10, inc: 0, label: '10+0', speed: 'rapid' },
  { id: '10+5', time: 10, inc: 5, label: '10+5', speed: 'rapid' },
  { id: '15+10', time: 15, inc: 10, label: '15+10', speed: 'rapid' },
  { id: '20+0', time: 20, inc: 0, label: '20+0', speed: 'rapid' },
  { id: '30+0', time: 30, inc: 0, label: '30+0', speed: 'classical' },
  { id: '30+20', time: 30, inc: 20, label: '30+20', speed: 'classical' },
];
/** Direct challenges may also be blitz (not allowed for public seeks). */
export const CHALLENGE_EXTRA = [
  { id: '5+0', time: 5, inc: 0, label: '5+0', speed: 'blitz' },
  { id: '5+3', time: 5, inc: 3, label: '5+3', speed: 'blitz' },
  { id: '3+2', time: 3, inc: 2, label: '3+2', speed: 'blitz' },
];
export const CORR_DAYS = [1, 2, 3, 5, 7, 10, 14];

/* ---------- UCI / game-state helpers (pure, unit-tested) ---------- */
export function uciToMove(uci) {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ? uci[4].toLowerCase() : undefined };
}
export function moveToUci(m) {
  return m.from + m.to + (m.promotion || '');
}
export function parseUciList(movesStr) {
  return String(movesStr || '').trim().split(/\s+/).filter(Boolean);
}

/** Apply a space-separated UCI move list onto a chess.js constructor. Returns {chess, hist, last}. */
export function applyUciMoves(Chess, movesStr, initialFen = 'startpos') {
  const fen = !initialFen || initialFen === 'startpos' ? undefined : initialFen;
  const chess = fen ? new Chess(fen) : new Chess();
  const hist = [{ fen: chess.fen(), from: null, to: null, san: null }];
  for (const uci of parseUciList(movesStr)) {
    const mv = uciToMove(uci);
    if (!mv) continue;
    let played;
    try { played = chess.move(mv); } catch (_) { played = null; }
    if (!played) break;
    hist.push({ fen: chess.fen(), from: played.from, to: played.to, san: played.san, promo: played.promotion, uci });
  }
  const last = hist.length > 1 ? hist[hist.length - 1] : null;
  return { chess, hist, last };
}

export function resultFromState(state, myColor) {
  const st = state && state.status;
  const winner = state && state.winner; // 'white' | 'black'
  const winColor = winner === 'white' ? 'w' : winner === 'black' ? 'b' : null;
  const iWon = winColor && winColor === myColor;
  const draw = !winColor && st && st !== 'started' && st !== 'created';
  const map = {
    mate: 'checkmate',
    resign: 'resign',
    stalemate: 'stalemate',
    timeout: 'timeout',
    outoftime: 'timeout',
    draw: 'draw',
    aborted: 'abort',
    noStart: 'abort',
    cheat: 'cheat',
    unknownFinish: 'draw',
    insufficientMaterialClaim: 'material',
    variantEnd: 'variant',
  };
  const why = map[st] || (st && st !== 'started' ? st : null);
  let title = 'Game over', sub = why || '';
  if (st === 'mate') { title = iWon ? 'Checkmate — you win!' : 'Checkmate — you lose'; sub = 'By checkmate'; }
  else if (st === 'resign') { title = iWon ? 'Opponent resigned' : 'You resigned'; sub = 'Resignation'; }
  else if (st === 'outoftime' || st === 'timeout') { title = iWon ? 'You win on time' : 'Out of time'; sub = 'Flag fell'; }
  else if (st === 'stalemate') { title = 'Stalemate'; sub = 'Stalemate'; }
  else if (st === 'draw' || st === 'insufficientMaterialClaim') { title = 'Draw'; sub = 'Draw'; }
  else if (st === 'aborted' || st === 'noStart') { title = 'Game aborted'; sub = 'Aborted'; }
  else if (draw) { title = 'Draw'; sub = 'Draw'; }
  else if (winColor) { title = iWon ? 'You win!' : 'You lose'; }
  return { why, title, sub, iWon, draw: !!draw, winner: winColor, status: st, over: !!(st && st !== 'started' && st !== 'created') };
}

export function clocksFromState(state, lastAt, now = Date.now()) {
  if (!state) return { w: 0, b: 0, unlimited: true };
  const w = state.wtime, b = state.btime;
  const unlimited = !(w > 0 || b > 0) && !(state.winc || state.binc);
  if (state.status !== 'started' || unlimited) return { w: (w || 0) / 1000, b: (b || 0) / 1000, unlimited };
  const elapsed = Math.max(0, now - (lastAt || now));
  const moves = parseUciList(state.moves);
  const turn = moves.length % 2 === 0 ? 'w' : 'b';
  let ww = w || 0, bb = b || 0;
  if (turn === 'w') ww = Math.max(0, ww - elapsed);
  else bb = Math.max(0, bb - elapsed);
  return { w: ww / 1000, b: bb / 1000, unlimited: false, turn };
}

export function offerFlags(state, myColor) {
  if (!state) return {};
  const myDraw = myColor === 'w' ? state.wdraw : state.bdraw;
  const oppDraw = myColor === 'w' ? state.bdraw : state.wdraw;
  const myTb = myColor === 'w' ? state.wtakeback : state.btakeback;
  const oppTb = myColor === 'w' ? state.btakeback : state.wtakeback;
  return { myDraw: !!myDraw, oppDraw: !!oppDraw, myTakeback: !!myTb, oppTakeback: !!oppTb };
}

/* ---------- NDJSON stream reader (unit-tested) ---------- */
export async function readNdjson(response, onMsg, { signal, onClose } = {}) {
  if (!response || !response.body) throw new Error('No stream body');
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const abort = () => { try { reader.cancel(); } catch (_) {} };
  if (signal) {
    if (signal.aborted) { abort(); if (onClose) onClose(); return; }
    signal.addEventListener('abort', abort, { once: true });
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = buf.trim();
        if (tail) {
          try { const o = JSON.parse(tail); try { onMsg(o); } catch (e) { console.warn('ndjson handler', e); } } catch (_) {}
        }
        break;
      }
      buf += dec.decode(value, { stream: true });
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() || '';
      for (const line of parts) {
        const t = line.trim();
        if (!t) continue; // keepalive empty line
        let obj;
        try { obj = JSON.parse(t); } catch (e) { console.warn('ndjson parse', e, t); continue; }
        try { onMsg(obj); } catch (e) { console.warn('ndjson handler', e); }
      }
    }
  } finally {
    if (onClose) onClose();
  }
}

/* ---------- PKCE ---------- */
export function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of arr) s += chars[b % chars.length];
  return s;
}

export async function sha256Base64Url(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function redirectUri(loc) {
  const l = loc || (typeof location !== 'undefined' ? location : null);
  if (!l) return 'https://hazel-party.onrender.com/chess/';
  let path = l.pathname || '/chess/';
  path = path.replace(/index\.html$/i, '');
  if (!path.endsWith('/')) path += '/';
  return (l.origin || '') + path;
}

export function formBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p;
}

/* ---------- storage (injectable for tests) ---------- */
function store(kind) {
  try {
    if (kind === 'session') return sessionStorage;
    return localStorage;
  } catch (_) {
    return { getItem() { return null; }, setItem() {}, removeItem() {} };
  }
}

export function saveToken(tok, storage) {
  const s = storage || store('local');
  s.setItem(TOKEN_KEY, JSON.stringify({
    access_token: tok.access_token,
    expires_at: Date.now() + (tok.expires_in || 31536000) * 1000,
    token_type: tok.token_type || 'Bearer',
  }));
}
export function loadToken(storage, now = Date.now()) {
  const s = storage || store('local');
  try {
    const t = JSON.parse(s.getItem(TOKEN_KEY) || 'null');
    if (!t || !t.access_token) return null;
    if (t.expires_at && t.expires_at < now + 60_000) { s.removeItem(TOKEN_KEY); return null; }
    return t;
  } catch (_) { return null; }
}
export function clearToken(storage) {
  (storage || store('local')).removeItem(TOKEN_KEY);
}

/* ---------- API client ---------- */
let _fetch = (...a) => fetch(...a);

export function setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

export class LichessClient {
  constructor({ fetchFn, storage } = {}) {
    this.fetchFn = fetchFn || ((...a) => _fetch(...a));
    this.storage = storage;
    this.me = null;
    this._eventAbort = null;
    this._seekAbort = null;
    this._gameAbort = null;
    this._chalAbort = null;
    this.onEvent = null;
    this.onEventError = null;
  }

  token() { return loadToken(this.storage); }
  get loggedIn() { return !!this.token(); }

  headers(extra = {}) {
    const t = this.token();
    const h = { ...extra };
    if (t) h.Authorization = `Bearer ${t.access_token}`;
    return h;
  }

  async request(path, { method = 'GET', body, headers, raw, signal } = {}) {
    const opts = { method, headers: this.headers(headers), signal };
    if (body !== undefined) {
      if (body instanceof URLSearchParams) {
        opts.body = body;
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (typeof body === 'string') opts.body = body;
      else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    }
    const res = await this.fetchFn(HOST + path, opts);
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.error || data.error_description || data.message)) || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async login(loc) {
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    const state = randomString(32);
    const redir = redirectUri(loc);
    const pkce = { verifier, state, redirectUri: redir, at: Date.now() };
    const json = JSON.stringify(pkce);
    try { sessionStorage.setItem(PKCE_KEY, json); } catch (_) {}
    try { localStorage.setItem(PKCE_KEY, json); } catch (_) {}
    const url = new URL(HOST + '/oauth');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', redir);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Handle ?code=&state= on the chess page. Returns 'ok' | 'denied' | 'none' | throws. */
  async handleRedirect(loc, storage) {
    const l = loc || (typeof location !== 'undefined' ? location : null);
    if (!l) return 'none';
    const q = new URL(l.href).searchParams;
    const err = q.get('error');
    const code = q.get('code');
    const state = q.get('state');
    if (!err && !code) return 'none';
    let pkce = null;
    try { pkce = JSON.parse((sessionStorage.getItem(PKCE_KEY) || localStorage.getItem(PKCE_KEY) || 'null')); } catch (_) {}
    try { sessionStorage.removeItem(PKCE_KEY); localStorage.removeItem(PKCE_KEY); } catch (_) {}
    if (err) return err === 'access_denied' ? 'denied' : err;
    if (!pkce || pkce.state !== state) throw new Error('Login state mismatch — please try again.');
    if (Date.now() - (pkce.at || 0) > 15 * 60e3) throw new Error('Login expired — please try again.');
    const tok = await this.request('/api/token', {
      method: 'POST',
      body: formBody({
        grant_type: 'authorization_code',
        code,
        code_verifier: pkce.verifier,
        redirect_uri: pkce.redirectUri,
        client_id: CLIENT_ID,
      }),
    });
    saveToken(tok, storage || this.storage);
    return 'ok';
  }

  async logout() {
    this.closeAll();
    const t = this.token();
    if (t) {
      try {
        await this.fetchFn(HOST + '/api/token', { method: 'DELETE', headers: { Authorization: `Bearer ${t.access_token}` } });
      } catch (_) {}
    }
    clearToken(this.storage);
    this.me = null;
  }

  async account() {
    this.me = await this.request('/api/account');
    return this.me;
  }

  async ongoing() {
    return this.request('/api/account/playing?nb=50');
  }

  /* ---- streams ---- */
  async openEventStream(onMsg) {
    this.closeEvents();
    const ac = new AbortController();
    this._eventAbort = ac;
    const res = await this.fetchFn(HOST + '/api/stream/event', { headers: this.headers({ Accept: 'application/x-ndjson' }), signal: ac.signal });
    if (!res.ok) throw new Error('Could not open Lichess event stream (' + res.status + ')');
    const p = readNdjson(res, (m) => { if (onMsg) onMsg(m); if (this.onEvent) this.onEvent(m); }, {
      signal: ac.signal,
      onClose: () => { if (this._eventAbort === ac) this._eventAbort = null; },
    });
    p.catch((e) => { if (e && e.name !== 'AbortError' && this.onEventError) this.onEventError(e); });
    return { abort: () => ac.abort(), done: p };
  }

  closeEvents() { if (this._eventAbort) { this._eventAbort.abort(); this._eventAbort = null; } }

  async seek({ time, increment, rated = false, color, days }) {
    this.cancelSeek();
    const ac = new AbortController();
    this._seekAbort = ac;
    const body = days
      ? formBody({ days, rated, variant: 'standard' })
      : formBody({ time, increment, rated, color: color && color !== 'random' ? color : undefined, variant: 'standard' });
    const res = await this.fetchFn(HOST + '/api/board/seek', {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/x-ndjson' }),
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      let msg = 'Seek failed';
      try { const d = await res.json(); msg = d.error || d.message || msg; } catch (_) {}
      throw new Error(msg);
    }
    // correspondence returns JSON immediately; real-time is an empty NDJSON stream we must keep open
    const ct = (res.headers.get('content-type') || '');
    if (ct.includes('application/json') && !ct.includes('ndjson')) {
      const data = await res.json();
      this._seekAbort = null;
      return { kind: 'correspondence', data, abort: () => {} };
    }
    const done = readNdjson(res, () => {}, { signal: ac.signal, onClose: () => { if (this._seekAbort === ac) this._seekAbort = null; } });
    done.catch(() => {});
    return { kind: 'realtime', abort: () => ac.abort(), done };
  }
  cancelSeek() { if (this._seekAbort) { this._seekAbort.abort(); this._seekAbort = null; } }

  async challenge(username, { limit, increment, days, rated = false, color = 'random' } = {}) {
    this.cancelChallenge();
    const ac = new AbortController();
    this._chalAbort = ac;
    const body = days
      ? formBody({ days, rated, color, keepAliveStream: true })
      : formBody({ 'clock.limit': limit, 'clock.increment': increment, rated, color, keepAliveStream: true });
    const res = await this.fetchFn(HOST + '/api/challenge/' + encodeURIComponent(username), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/x-ndjson' }),
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      let msg = 'Challenge failed';
      try { const d = await res.json(); msg = d.error || d.message || msg; } catch (_) {}
      throw new Error(msg);
    }
    // First line of keepAliveStream is typically the challenge JSON, then later {"done":"accepted"}
    let first = null;
    const done = readNdjson(res, (m) => { if (!first) first = m; }, {
      signal: ac.signal,
      onClose: () => { if (this._chalAbort === ac) this._chalAbort = null; },
    });
    done.catch(() => {});
    // Wait briefly for the first object
    const start = Date.now();
    while (!first && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 50));
    return { challenge: first, abort: () => ac.abort(), done };
  }
  cancelChallenge() { if (this._chalAbort) { this._chalAbort.abort(); this._chalAbort = null; } }

  async cancelChallengeId(id) { return this.request(`/api/challenge/${id}/cancel`, { method: 'POST' }); }
  async acceptChallenge(id, color) {
    const q = color ? `?color=${encodeURIComponent(color)}` : '';
    return this.request(`/api/challenge/${id}/accept${q}`, { method: 'POST' });
  }
  async declineChallenge(id, reason = 'generic') {
    return this.request(`/api/challenge/${id}/decline`, { method: 'POST', body: formBody({ reason }) });
  }

  async openChallenge({ limit, increment, days, rated = false, name = 'Hazel Chess' } = {}) {
    const body = days
      ? formBody({ days, rated, name, variant: 'standard' })
      : formBody({ 'clock.limit': limit, 'clock.increment': increment, rated, name, variant: 'standard' });
    return this.request('/api/challenge/open', { method: 'POST', body });
  }

  async streamGame(gameId, onMsg) {
    this.closeGame();
    const ac = new AbortController();
    this._gameAbort = ac;
    const res = await this.fetchFn(HOST + `/api/board/game/stream/${gameId}`, {
      headers: this.headers({ Accept: 'application/x-ndjson' }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error('Could not open game stream (' + res.status + ')');
    const done = readNdjson(res, onMsg, { signal: ac.signal, onClose: () => { if (this._gameAbort === ac) this._gameAbort = null; } });
    done.catch(() => {});
    return { abort: () => ac.abort(), done };
  }
  closeGame() { if (this._gameAbort) { this._gameAbort.abort(); this._gameAbort = null; } }

  async move(gameId, uci, offeringDraw) {
    const q = offeringDraw ? '?offeringDraw=true' : '';
    return this.request(`/api/board/game/${gameId}/move/${uci}${q}`, { method: 'POST' });
  }
  async resign(gameId) { return this.request(`/api/board/game/${gameId}/resign`, { method: 'POST' }); }
  async abort(gameId) { return this.request(`/api/board/game/${gameId}/abort`, { method: 'POST' }); }
  async draw(gameId, yes = true) { return this.request(`/api/board/game/${gameId}/draw/${yes ? 'yes' : 'no'}`, { method: 'POST' }); }
  async takeback(gameId, yes = true) { return this.request(`/api/board/game/${gameId}/takeback/${yes ? 'yes' : 'no'}`, { method: 'POST' }); }
  async claimVictory(gameId) { return this.request(`/api/board/game/${gameId}/claim-victory`, { method: 'POST' }); }
  async claimDraw(gameId) { return this.request(`/api/board/game/${gameId}/claim-draw`, { method: 'POST' }); }
  async chat(gameId, text, room = 'player') {
    return this.request(`/api/board/game/${gameId}/chat`, { method: 'POST', body: formBody({ text, room }) });
  }

  closeAll() {
    this.closeEvents();
    this.cancelSeek();
    this.cancelChallenge();
    this.closeGame();
  }
}

export default LichessClient;
