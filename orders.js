/*
 * orders.js — MOVEMENT ORDERS AND STACKING (slice 15). No DOM.
 * Stacking: at most one military unit per tile per domain (land, sea) plus
 * one civilian (worker, settler, caravan, missionary). Own cities may hold
 * CITY_LAND land military units; aircraft are based by air.js. Units aboard
 * a ship don't count. Moving onto an adjacent own unit that blocks the tile
 * swaps the two when the other one can step back.
 * Orders on units (saved with the unit):
 *   u.goto = { q, r, queue: [{q,r}] }   multi-turn move, continued each turn,
 *                                     stopping when an enemy is within 2.
 *   u.order = "explore" | "sentry"    auto-explore; sleep until an enemy is near.
 * runOrders(game, cid) continues them (world onEndTurn for the human player,
 * after moves are restored). Notices go to game._orderNotices (not saved).
 * plan(game, u, q, r) -> { path: [{q, r, turn}], turns } for drawing.
 * nextIdle(game, cid, afterId) is the unit-cycle key; idleUnits for End Turn.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var CITY_LAND = 2, THREAT = 2;

  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function domain(u) {
    var t = T(u.type);
    if (t.air) return "air";
    if (t.naval) return "sea";
    return (t.strength || 0) > 0 ? "land" : "civ";
  }
  function stackBlock(game, u, q, r) {
    var d = domain(u);
    if (d === "air") return null;
    var tile = game.index.get(Rules.key(q, r));
    if (d !== "sea" && tile && Rules.isWater(tile)) return null;      // boarding a transport
    var city = game.cityAt.get(Rules.key(q, r));
    var own = city && city.owner === u.owner;
    var same = game.units.filter(function (o) { return o !== u && o.owner === u.owner && o.q === q && o.r === r && o.aboard == null && o.base == null && domain(o) === d; });
    if (d === "civ") return same.length && !own ? same[0] : null;
    if (own && u.ferry != null) return null;        // troops mustering at a port to embark
    var limit = own && d === "land" ? CITY_LAND : own && d === "sea" ? 3 : 1;
    return same.length >= limit ? same[0] : null;
  }

  var origMove = Rules.moveUnit;
  Rules.moveUnit = function (game, unitId, q, r) {
    var u = Rules.unitById(game, unitId);
    if (u && !game._noStack) {
      var b = stackBlock(game, u, q, r);
      if (b) {
        if (Rules.hexDistance(u.q, u.r, q, r) === 1 && u.moves > 0 && !game.civs[u.owner].ai && !game._autoPlayer) return swap(game, u, b);
        return { ok: false, reason: "Tile occupied by your " + T(b.type).name + " (one military unit per tile)" };
      }
    }
    return origMove.apply(this, arguments);
  };
  // Swap u with own unit o on an adjacent tile.
  function swap(game, u, o) {
    if (o.moves <= 0) return { ok: false, reason: "Your " + T(o.type).name + " is in the way and can't move" };
    var from = { q: u.q, r: u.r }, to = { q: o.q, r: o.r };
    var tu = game.index.get(Rules.key(to.q, to.r)), tf = game.index.get(Rules.key(from.q, from.r));
    if (Rules.unitMoveCost(game, u, tu, tf) === Infinity || Rules.unitMoveCost(game, o, tf, tu) === Infinity) return { ok: false, reason: "Can't swap there" };
    if (o.aboard != null || u.aboard != null) return { ok: false, reason: "Can't swap with units aboard ships" };
    game._noStack = true;
    Rules.placeUnit(game, o, -9999, -9999);           // step aside while u moves
    var r1 = Rules.moveUnit(game, u.id, to.q, to.r);
    Rules.placeUnit(game, o, to.q, to.r);
    var r2 = r1.ok ? Rules.moveUnit(game, o.id, from.q, from.r) : { ok: false };
    game._noStack = false;
    if (!r1.ok) return r1;
    if (!r2.ok) { Rules.placeUnit(game, o, from.q, from.r); }
    return { ok: true, path: r1.path, swapped: o.id, text: "Swapped places with the " + T(o.type).name };
  }

  // ---- threats
  function atWar(game, a, b) { var D = root.PlanetDiplomacy, r = D && D.rel(game, a, b); return !!(r && r.war); }
  function threatNear(game, u, rad) {
    var vis = game.civs[u.owner].revealed;
    return game.units.filter(function (o) {
      return o.owner !== u.owner && (T(o.type).strength || 0) > 0 && !T(o.type).air && atWar(game, u.owner, o.owner) &&
        Rules.hexDistance(o.q, o.r, u.q, u.r) <= (rad || THREAT) && vis.has(Rules.key(o.q, o.r));
    })[0] || null;
  }

  // ---- goto
  function plan(game, u, q, r) {
    var path = Rules.longPath(game, u, q, r, 120);
    if (!path) return null;
    var max = Rules.maxMoves(game, u.type, u.owner), left = u.moves, turn = 0, out = [{ q: path[0].q, r: path[0].r, turn: 0 }];
    if (left <= 0) { turn = 1; left = max; }
    for (var i = 1; i < path.length; i++) {
      var c = Rules.unitMoveCost(game, u, path[i], path[i - 1]);
      if (left <= 0) { turn++; left = max; }
      left = Math.max(0, left - c);
      out.push({ q: path[i].q, r: path[i].r, turn: turn });
    }
    return { path: out, turns: turn + 1 };
  }
  function notice(game, u, text) {
    var n = game._orderNotices || [];
    n.push({ unit: u.id, q: u.q, r: u.r, text: text, owner: u.owner });
    Object.defineProperty(game, "_orderNotices", { value: n, writable: true, configurable: true, enumerable: false });
    if (u.owner === 0) Rules.logEvent(game, "orders", text, 0);
  }
  // Step as far along a long path as this turn's reach allows (stacking aware).
  function advance(game, u, tq, tr) {
    var path = Rules.longPath(game, u, tq, tr, 120);
    if (!path || path.length < 2) return false;
    var reach = Rules.reachable(game, u);
    for (var i = path.length - 1; i >= 1; i--) {
      if (!reach.has(Rules.key(path[i].q, path[i].r))) continue;
      if (Rules.moveUnit(game, u.id, path[i].q, path[i].r).ok) return true;
    }
    return false;
  }
  function setGoto(game, unitId, q, r, append) {
    var u = Rules.unitById(game, unitId);
    if (!u) return { ok: false, reason: "No unit" };
    if (T(u.type).air) return { ok: false, reason: "Aircraft fly missions instead" };
    if (append && u.goto) { u.goto.queue = (u.goto.queue || []).concat([{ q: q, r: r }]); return { ok: true, queued: true }; }
    var p = plan(game, u, q, r);
    if (!p) return { ok: false, reason: "No path there" };
    u.goto = { q: q, r: r, queue: [] };
    u.order = null; u.fortifying = false;
    stepGoto(game, u);
    return { ok: true, turns: p.turns, text: "Moving: " + p.turns + (p.turns === 1 ? " turn" : " turns") };
  }
  function stepGoto(game, u) {
    var g = u.goto;
    if (!g) return;
    if (u.q === g.q && u.r === g.r) {
      var nx = (g.queue || []).shift();
      if (nx) { g.q = nx.q; g.r = nx.r; } else { u.goto = null; return; }
    }
    if (u.moves <= 0) return;
    var before = u.q + "," + u.r;
    if (!advance(game, u, g.q, g.r)) {
      g.stuck = (g.stuck || 0) + 1;
      if (g.stuck >= 3) { u.goto = null; notice(game, u, T(u.type).name + " can't reach its destination; orders cancelled"); }
      return;
    }
    g.stuck = 0;
    if (u.q === g.q && u.r === g.r && !(g.queue || []).length) { u.goto = null; return; }
    if (u.q === g.q && u.r === g.r) { stepGoto(game, u); return; }
    if (before !== u.q + "," + u.r) {
      var th = threatNear(game, u);
      if (th) { u.goto = null; notice(game, u, T(u.type).name + " stopped: enemy " + T(th.type).name + " sighted"); }
    }
  }
  function cancel(game, unitId) { var u = Rules.unitById(game, unitId); if (u) { u.goto = null; u.order = null; } }

  // ---- explore / sentry
  function exploreTarget(game, u) {
    var rev = game.civs[u.owner].revealed, start = Rules.key(u.q, u.r);
    var seen = new Set([start]), queue = [game.index.get(start)], depth = new Map([[start, 0]]);
    for (var i = 0; i < queue.length; i++) {
      var t = queue[i], d = depth.get(Rules.key(t.q, t.r));
      if (d > 0 && !stackBlock(game, u, t.q, t.r) && Rules.neighbours(game, t).some(function (n) { return !rev.has(Rules.key(n.q, n.r)); })) return t;
      if (d >= 25) continue;
      Rules.neighbours(game, t).forEach(function (n) {
        var k = Rules.key(n.q, n.r);
        if (seen.has(k) || !rev.has(k) || Rules.unitMoveCost(game, u, n, t) === Infinity) return;
        seen.add(k); depth.set(k, d + 1); queue.push(n);
      });
    }
    return null;
  }
  function setOrder(game, unitId, order) {
    var u = Rules.unitById(game, unitId);
    if (!u) return { ok: false };
    u.order = order; u.goto = null;
    if (order === "explore") stepExplore(game, u);
    if (order === "sentry") u.moves = 0;
    return { ok: true };
  }
  function stepExplore(game, u) {
    if (u.moves <= 0) return;
    var t = exploreTarget(game, u);
    if (!t) { u.order = null; notice(game, u, T(u.type).name + " has nothing left to explore"); return; }
    advance(game, u, t.q, t.r);
    var th = threatNear(game, u);
    if (th) { u.order = null; notice(game, u, T(u.type).name + " stopped exploring: enemy " + T(th.type).name + " near"); }
  }

  function runOrders(game, cid) {
    game.units.slice().forEach(function (u) {
      if (u.owner !== cid || !Rules.unitById(game, u.id)) return;
      if (u.order === "sentry") {
        var th = threatNear(game, u);
        if (th) { u.order = null; notice(game, u, T(u.type).name + " woke: enemy " + T(th.type).name + " near"); }
        else u.moves = 0;
        return;
      }
      if (u.goto) {
        if (threatNear(game, u)) { u.goto = null; notice(game, u, T(u.type).name + " holds: enemy within " + THREAT + " tiles"); return; }
        stepGoto(game, u);
      } else if (u.order === "explore") stepExplore(game, u);
    });
  }

  // ---- cycle / idle
  function needsOrders(game, u) {
    if (u.moves <= 0 || u.goto || u.order || u.fortifying || u.fort || u.aboard != null) return false;
    if (T(u.type).air && u.patrol) return false;
    if (u.job || u.mission || u.trade) return false;
    return true;
  }
  function idleUnits(game, cid) { return game.units.filter(function (u) { return u.owner === cid && needsOrders(game, u); }); }
  function nextIdle(game, cid, afterId) {
    var list = idleUnits(game, cid).sort(function (a, b) { return a.id - b.id; });
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id > (afterId || 0)) return list[i];
    return list[0];
  }

  var WORLD = {
    onEndTurn: function (game) {
      // Moves are restored by now; continue the human player's standing orders.
      game.civs.forEach(function (c, cid) { if (!c.eliminated && !c.ai && !game._autoPlayer) runOrders(game, cid); });
    }
  };
  Rules.registerPlugin({ world: WORLD });

  root.PlanetOrders = {
    CITY_LAND: CITY_LAND, domain: domain, stackBlock: stackBlock, swap: swap, plan: plan, setGoto: setGoto, stepGoto: stepGoto,
    cancel: cancel, setOrder: setOrder, runOrders: runOrders, threatNear: threatNear, needsOrders: needsOrders, idleUnits: idleUnits,
    nextIdle: nextIdle, advance: advance, exploreTarget: exploreTarget
  };
})(typeof window !== "undefined" ? window : globalThis);
