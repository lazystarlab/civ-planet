/*
 * anim.js — ANIMATION STATE: settings, unit move tweens, the AI-turn
 * timeline, camera pans, city effects, screen shake and number ticks.
 * Rules stay instant: this only records what happened (wrapping
 * PlanetGame.moveUnit) and answers "where should this be drawn now?".
 * app.js draws; nothing here is saved with the game (settings go to
 * localStorage under civPlanet.anim).
 *
 *   settings: { on, speed (0.5..4), ai (animate AI moves), water (ambient) }
 *   pos(unit)            -> fractional {q, r} while a move tween runs, else null
 *   beginCapture()/endCapture(game) wrap the AI turn: its visible moves play
 *                         one after another (overlapping, sped up), capped ~3 s
 *   fxDelay(i)            -> ms to hold combat effect i until its move has played
 *   snapshot(game)/diff(game, snap, visible) -> city effects (grow, built,
 *                         capture, border) for the renderer
 *   camTo / camStep, shake / shakeOffset, busy(), skip(), freeze(ms)
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var KEY = "civPlanet.anim";
  var settings = { on: true, speed: 1, ai: true, water: true };
  try { var saved = JSON.parse(root.localStorage.getItem(KEY) || "null"); if (saved) for (var k in saved) settings[k] = saved[k]; } catch (e) { /* no storage */ }
  function save() { try { root.localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }
  function set(k, v) { settings[k] = v; save(); }

  var frozen = null;
  function now() { return frozen != null ? frozen : root.performance.now(); }
  function freeze(t) { frozen = t == null ? null : t; }
  function sp() { return Math.max(0.25, settings.speed || 1); }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ------------------------------------------------------------ moves
  var moves = [], capture = null, hooks = { kick: function () {}, visible: function () { return true; } };
  function init(h) { for (var x in h) hooks[x] = h[x]; }
  var orig = Rules.moveUnit;
  Rules.moveUnit = function (game, unitId, q, r) {
    var u = Rules.unitById(game, unitId), from = u ? { q: u.q, r: u.r } : null;
    var res = orig.apply(this, arguments);
    if (res && res.ok && from && settings.on && !game._noAnim) record(game, u, from, res.path || [{ q: q, r: r }]);
    return res;
  };
  function record(game, u, from, path) {
    var pts = [from];
    path.forEach(function (p) { var l = pts[pts.length - 1]; if (p.q !== l.q || p.r !== l.r) pts.push({ q: p.q, r: p.r }); });
    if (pts.length < 2) return;
    if (!pts.some(function (p) { return hooks.visible(Rules.key(p.q, p.r)); })) return;
    var e = { id: u.id, owner: u.owner, pts: pts, fxAt: (game.fx || []).length };
    if (capture) { if (settings.ai) capture.list.push(e); return; }
    e.t0 = now(); e.dur = (pts.length - 1) * 120 / sp();
    moves = moves.filter(function (m) { return m.id !== u.id; });
    moves.push(e);
    hooks.kick();
  }
  function beginCapture() { capture = { list: [] }; }
  // Lay the captured AI moves on a timeline: each starts a little after the last.
  function endCapture() {
    var c = capture; capture = null;
    if (!c || !c.list.length) { lastTimeline = []; return 0; }
    var t = now() + 60, start = t, per = 70 / sp(), gap = 160 / sp(), cap = 3000 / sp();
    var total = c.list.reduce(function (s, e) { return s + Math.min(gap, (e.pts.length - 1) * per); }, 0);
    var squeeze = total > cap ? cap / total : 1;
    c.list.forEach(function (e) {
      e.dur = Math.max(80, (e.pts.length - 1) * per * squeeze);
      e.t0 = t;
      t += Math.min(gap, e.dur) * squeeze;
      moves = moves.filter(function (m) { return m.id !== e.id; });
      moves.push(e);
    });
    lastTimeline = c.list;
    hooks.kick();
    return t - start;
  }
  var lastTimeline = [];
  // Combat effect #i (game.fx order) waits for the move recorded just before it.
  function fxDelay(i) {
    var best = null;
    lastTimeline.forEach(function (e) { if (e.fxAt <= i && (!best || e.fxAt >= best.fxAt)) best = e; });
    return best ? Math.max(0, best.t0 + best.dur - now()) : 0;
  }
  function pos(u) {
    for (var i = moves.length - 1; i >= 0; i--) {
      var m = moves[i];
      if (m.id !== u.id) continue;
      var p = (now() - m.t0) / m.dur;
      if (p >= 1) return null;
      if (m.pts[m.pts.length - 1].q !== u.q || m.pts[m.pts.length - 1].r !== u.r) return null;   // moved again since
      var s = ease(Math.max(0, p)) * (m.pts.length - 1), j = Math.min(m.pts.length - 2, Math.floor(s)), f = s - j;
      var a = m.pts[j], b = m.pts[j + 1];
      return { q: a.q + (b.q - a.q) * f, r: a.r + (b.r - a.r) * f, path: m.pts };
    }
    return null;
  }

  // ------------------------------------------------------------ city effects
  var effects = [];
  function snapshot(game) {
    var s = { cities: {}, owned: {} };
    game.cities.forEach(function (c) { s.cities[c.id] = { pop: c.pop, nb: (c.buildings || []).length, owner: c.owner, build: c.build }; });
    game.owner.forEach(function (cid, k) { s.owned[k] = cid; });
    return s;
  }
  function diff(game, snap, visible) {
    if (!settings.on || !snap) return 0;
    var t = now(), n = 0;
    game.cities.forEach(function (c) {
      var o = snap.cities[c.id];
      if (!visible(Rules.key(c.q, c.r))) return;
      if (!o) { effects.push({ kind: "grow", q: c.q, r: c.r, owner: c.owner, t0: t, dur: 900 / sp() }); n++; return; }
      if (o.owner !== c.owner) { effects.push({ kind: "capture", q: c.q, r: c.r, owner: c.owner, prev: o.owner, t0: t, dur: 1400 / sp() }); n++; }
      if (c.pop > o.pop) { effects.push({ kind: "grow", q: c.q, r: c.r, owner: c.owner, t0: t + 80, dur: 900 / sp() }); n++; }
      if ((c.buildings || []).length > o.nb) { effects.push({ kind: "built", q: c.q, r: c.r, owner: c.owner, t0: t + 160, dur: 1100 / sp() }); n++; }
    });
    var fresh = [];
    game.owner.forEach(function (cid, k) {
      if (snap.owned[k] === cid) return;
      var c = Rules.cityById(game, cid);
      if (c && visible(k)) fresh.push({ k: k, owner: c.owner });
    });
    if (fresh.length) { effects.push({ kind: "border", tiles: fresh, t0: t, dur: 1200 / sp() }); n++; }
    if (n) hooks.kick();
    return n;
  }
  function activeEffects() {
    var t = now();
    effects = effects.filter(function (e) { return t - e.t0 < e.dur; });
    return effects;
  }
  function progress(e) { return Math.max(0, Math.min(1, (now() - e.t0) / e.dur)); }

  // ------------------------------------------------------------ camera, shake
  var cam = null;
  function camTo(from, to, dur) {
    if (!settings.on) return false;
    cam = { from: { x: from.x, y: from.y, zoom: from.zoom }, to: to, t0: now(), dur: (dur || 420) / sp() };
    hooks.kick();
    return true;
  }
  // Apply the camera tween to `c` (mutates). Returns true while moving.
  function camStep(c) {
    if (!cam) return false;
    var p = Math.min(1, (now() - cam.t0) / cam.dur), e = ease(p);
    // Zoom interpolates geometrically, the screen centre's world point linearly.
    c.zoom = cam.from.zoom * Math.pow(cam.to.zoom / cam.from.zoom, e);
    c.x = cam.from.x + (cam.to.x - cam.from.x) * e;
    c.y = cam.from.y + (cam.to.y - cam.from.y) * e;
    if (p >= 1) cam = null;
    return true;
  }
  var shakeT0 = -1e9, shakeAmp = 0;
  function shake(amp) { if (!settings.on) return; shakeT0 = now(); shakeAmp = amp || 4; hooks.kick(); }
  function shakeOffset() {
    var p = (now() - shakeT0) / 320;
    if (p >= 1 || p < 0) return null;
    var a = shakeAmp * (1 - p);
    return [Math.sin(p * 47) * a, Math.cos(p * 39) * a * 0.6];
  }

  // ------------------------------------------------------------ number ticks
  var ticks = {};
  function tickNumber(el, to, fmt) {
    var id = el.id, cur = ticks[id];
    var from = cur ? cur.value : (el._val != null ? el._val : to);
    el._val = to;
    if (!settings.on || from === to || typeof root.requestAnimationFrame !== "function") { el.textContent = fmt(to); delete ticks[id]; return; }
    var t0 = now(), dur = 380 / sp();
    ticks[id] = { value: from };
    (function step() {
      var p = Math.min(1, (now() - t0) / dur), v = Math.round(from + (to - from) * ease(p));
      ticks[id] = { value: v };
      el.textContent = fmt(v);
      if (p < 1 && el._val === to) root.requestAnimationFrame(step); else delete ticks[id];
    })();
  }

  function busy() {
    var t = now();
    moves = moves.filter(function (m) { return t - m.t0 < m.dur; });
    return moves.length > 0 || !!cam || effects.length > 0 || !!shakeOffset();
  }
  function aiBusy() { var t = now(); return lastTimeline.some(function (e) { return t - e.t0 < e.dur; }); }
  function skip() {
    moves = []; effects = []; cam = null; shakeT0 = -1e9;
    lastTimeline = [];
  }

  root.PlanetAnim = {
    settings: settings, set: set, init: init, now: now, freeze: freeze, ease: ease,
    pos: pos, beginCapture: beginCapture, endCapture: endCapture, fxDelay: fxDelay,
    snapshot: snapshot, diff: diff, activeEffects: activeEffects, progress: progress,
    camTo: camTo, camStep: camStep, shake: shake, shakeOffset: shakeOffset, tickNumber: tickNumber,
    busy: busy, aiBusy: aiBusy, skip: skip, stopCam: function () { cam = null; }
  };
})(window);
