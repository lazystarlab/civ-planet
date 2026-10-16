/*
 * pillage.js — pillage and plunder (slice 16), rules only, no DOM.
 *
 * Pillage: a land military unit at war, on an enemy-owned road or improvement
 * (not a city), spends 1 move to wreck it: the improvement (or, if none, the
 * road) is removed and the tile is marked pillaged, the unit gains gold and
 * heals 10. A Worker on the tile repairs everything in 1 turn (2 on rough
 * ground) instead of rebuilding. Pillaged roads cut the capital connection.
 * Plunder: a military unit at war that ends a move on a tile of an enemy trade
 * route's path (land units on land, ships on water) or next to an enemy
 * Caravan destroys the route (or the caravan) and takes gold.
 * State: game.pillage = { tiles: { "q,r": { road, imp, by, turn } }, stats }.
 * fx: { kind: "pillage", q, r } and { kind: "plunder", q, r } (smoke and flame).
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Combat = root.PlanetCombat, Roads = root.PlanetRoads, Trade = root.PlanetTrade;
  var ROUGH = { hills: 1, forest: 1, jungle: 1, marsh: 1 };
  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function key(q, r) { return Rules.key(q, r); }
  function state(game) {
    var s = game.pillage || (game.pillage = { tiles: {}, stats: { pillages: 0, plunders: 0, repairs: 0, gold: 0, caravans: 0 } });
    if (!s.tiles) s.tiles = {};
    return s;
  }
  function era(game, cid) { return root.PlanetEras ? root.PlanetEras.eraOf(game, cid) : 0; }
  function ownerOf(game, k) { var id = game.owner.get(k); var c = id != null ? Rules.cityById(game, id) : null; return c ? c.owner : -1; }
  function military(u) { var t = T(u.type); return Combat.strengthOf(u.type) > 0 && !t.air && !t.worker && !t.caravan; }
  function known(game, cid) { return cid === 0; }
  function fx(game, f) { if (Combat._internals && Combat._internals.fx) Combat._internals.fx(game, f); }
  function chron(game, text) { var S = root.PlanetStory; if (S && S.chron) S.chron(game, text); }

  // ---------------------------------------------------------- pillage
  function canPillage(game, u) {
    if (!u || !military(u) || u.aboard != null || T(u.type).naval) return { ok: false, reason: "Only land military units pillage" };
    if (u.moves <= 0) return { ok: false, reason: "No moves left" };
    var k = key(u.q, u.r), own = ownerOf(game, k);
    if (game.cityAt.has(k)) return { ok: false, reason: "Cities can't be pillaged" };
    if (own < 0 || own === u.owner) return { ok: false, reason: "Nothing of the enemy's here" };
    if (!Combat.atWar(game, u.owner, own)) return { ok: false, reason: "Not at war with " + Rules.civName(game, own) };
    var imp = game.improvements && game.improvements[k], road = game.roads && game.roads[k];
    if (!imp && !road) return { ok: false, reason: "No road or improvement here" };
    return { ok: true, owner: own, imp: imp || null, road: !!road };
  }
  function pillage(game, unitId) {
    var u = Rules.unitById(game, unitId), c = canPillage(game, u);
    if (!c.ok) return c;
    var k = key(u.q, u.r), st = state(game), e = era(game, u.owner);
    var rec = st.tiles[k] || (st.tiles[k] = { road: 0, imp: null, by: u.owner, turn: game.turn, owner: c.owner });
    var what, gold;
    if (c.imp) { rec.imp = c.imp; delete game.improvements[k]; what = c.imp; gold = 15 + 5 * e; }
    else { rec.road = 1; delete game.roads[k]; what = "road"; gold = 6 + 2 * e; }
    rec.by = u.owner; rec.turn = game.turn;
    delete (game.jobs || {})[k + "|" + what];
    game._connVer = (game._connVer || 0) + 1; game._stratLedger = null;
    game.civs[u.owner].gold += gold;
    u.moves = Math.max(0, u.moves - 1); u.fort = false; u.fortifying = false;
    u.hp = Math.min(Combat.MAX_HP, u.hp + 10);
    st.stats.pillages++; st.stats.gold += gold;
    fx(game, { kind: "pillage", q: u.q, r: u.r, owner: u.owner });
    var text = Rules.civName(game, u.owner) + "'s " + T(u.type).name + " pillaged a " + what + " of " + Rules.civName(game, c.owner) + " (+" + gold + " gold)";
    if (u.owner === 0 || c.owner === 0) {
      Rules.logEvent(game, "pillage", text, 0, { q: u.q, r: u.r });
      if (st.stats.pillages === 1 || (game.turn % 7 === 0)) chron(game, u.owner === 0
        ? "In {year} the soldiers of {civ} put the " + what + "s of " + Rules.civName(game, c.owner) + " to the torch."
        : "In {year} raiders of " + Rules.civName(game, c.owner === 0 ? u.owner : c.owner) + " burned our " + what + "s; the smoke was seen from {capital}.");
    }
    if (root.PlanetPeace && root.PlanetPeace.record) root.PlanetPeace.record(game, u.owner, c.owner, "hit");
    return { ok: true, gold: gold, what: what, text: "Pillaged the " + what + " (+" + gold + " gold, +10 HP)" };
  }
  function isPillaged(game, q, r) { return !!state(game).tiles[key(q, r)]; }
  function repair(game, k, u) {
    var st = state(game), rec = st.tiles[k];
    if (!rec) return;
    if (rec.road) { game.roads = game.roads || {}; game.roads[k] = 1; }
    if (rec.imp) { game.improvements = game.improvements || {}; game.improvements[k] = rec.imp; }
    delete st.tiles[k];
    st.stats.repairs++;
    game._connVer = (game._connVer || 0) + 1; game._stratLedger = null;
  }
  if (Roads && Roads.addJobs) Roads.addJobs(function (game, u, t, out, mine) {
    var rec = state(game).tiles[key(t.q, t.r)];
    if (!rec || !mine || ownerOf(game, key(t.q, t.r)) !== u.owner) return;
    var parts = [rec.imp, rec.road ? "road" : null].filter(Boolean).join(" and ");
    // Repair replaces the slower rebuild jobs on a pillaged tile.
    for (var i = out.length - 1; i >= 0; i--) if (out[i].kind === "road" && rec.road || (out[i].kind === rec.imp)) out.splice(i, 1);
    out.unshift({ kind: "repair", name: "Repair", turns: ROUGH[t.biome] ? 2 : 1, note: parts });
  }, "repair", repair);

  // ---------------------------------------------------------- plunder
  function hexLine(a, b) {
    var n = Rules.hexDistance(a.q, a.r, b.q, b.r), out = [];
    for (var i = 0; i <= n; i++) {
      var t = n ? i / n : 0, q = a.q + (b.q - a.q) * t + 1e-6, r = a.r + (b.r - a.r) * t + 1e-6, s = -q - r;
      var rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
      var dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
      if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
      out.push(key(rq, rr));
    }
    return out;
  }
  // Route path tiles (cached by route id, not saved).
  function pathOf(game, r) {
    var cache = game._routePaths || (Object.defineProperty(game, "_routePaths", { value: {}, writable: true, enumerable: false }), game._routePaths);
    if (cache[r.id]) return cache[r.id];
    var a = Rules.cityById(game, r.from), b = Rules.cityById(game, r.to);
    var p = a && b ? hexLine(a, b).filter(function (k) { return !game.cityAt.has(k); }) : [];
    cache[r.id] = p;
    return p;
  }
  function routeVictim(game, u, r) {
    var a = Rules.cityById(game, r.from), b = Rules.cityById(game, r.to);
    if (!a || !b || a.owner === u.owner || b.owner === u.owner) return -1;
    if (Combat.atWar(game, u.owner, a.owner)) return a.owner;
    if (Combat.atWar(game, u.owner, b.owner)) return b.owner;
    return -1;
  }
  function plunderAt(game, u) {
    if (!military(u) || u.aboard != null || u.plunderTurn === game.turn) return null;
    var k = key(u.q, u.r), tile = game.index.get(k), water = Rules.isWater(tile), st = state(game), e = era(game, u.owner);
    // Enemy caravans next to (or on) the unit.
    var cv = game.units.filter(function (o) {
      return T(o.type).caravan && o.owner !== u.owner && Combat.atWar(game, u.owner, o.owner) && Rules.hexDistance(o.q, o.r, u.q, u.r) <= 1 && o.aboard == null;
    })[0];
    if (cv) {
      var g1 = 30 + 5 * e;
      Rules.removeUnit(game, cv);
      game.civs[u.owner].gold += g1; st.stats.plunders++; st.stats.caravans++; st.stats.gold += g1; u.plunderTurn = game.turn;
      fx(game, { kind: "plunder", q: cv.q, r: cv.r, owner: u.owner });
      notice(game, u, cv.owner, "a Caravan", g1, cv);
      return { ok: true, gold: g1, caravan: true };
    }
    var rs = Trade.routes(game);
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i], victim = routeVictim(game, u, r);
      if (victim < 0) continue;
      if (pathOf(game, r).indexOf(k) === -1) continue;
      if (water !== !!T(u.type).naval) continue;
      var y = Trade.yieldOf(game, r) || {}, g2 = 20 + 4 * e + 2 * ((y.home || 0) + (y.dest || 0));
      Trade.state ? null : null;
      game.trade.routes = rs.filter(function (x) { return x !== r; });
      game.civs[u.owner].gold += g2; st.stats.plunders++; st.stats.gold += g2; u.plunderTurn = game.turn;
      fx(game, { kind: "plunder", q: u.q, r: u.r, owner: u.owner });
      var a = Rules.cityById(game, r.from), b = Rules.cityById(game, r.to);
      notice(game, u, victim, "the trade route " + a.name + "–" + b.name, g2, u);
      return { ok: true, gold: g2, route: r.id };
    }
    return null;
  }
  function notice(game, u, victim, what, gold, at) {
    var text = Rules.civName(game, u.owner) + "'s " + T(u.type).name + " plundered " + what + " of " + Rules.civName(game, victim) + " (+" + gold + " gold)";
    if (u.owner === 0 || victim === 0) {
      Rules.logEvent(game, "plunder", text, 0, { q: at.q, r: at.r });
      chron(game, u.owner === 0 ? "In {year} our troops fell upon " + what + " of " + Rules.civName(game, victim) + " and carried off " + gold + " gold."
        : "In {year} " + Rules.civName(game, u.owner) + " plundered " + what + "; the merchants of {capital} cursed their name.");
    }
    if (root.PlanetPeace && root.PlanetPeace.record) root.PlanetPeace.record(game, u.owner, victim, "hit");
  }

  // ---------------------------------------------------------- AI
  function enemiesOf(game, cid) { return game.civs.map(function (c, i) { return i; }).filter(function (i) { return i !== cid && !game.civs[i].eliminated && Combat.atWar(game, cid, i); }); }
  // Military AI: pillage the enemy tile it stands on; raiders step onto an
  // adjacent undefended enemy improvement. Returns true if the unit is done.
  function aiUnit(game, u) {
    if (!military(u) || u.role === "garrison" || T(u.type).naval) return false;
    var foes = enemiesOf(game, u.owner);
    if (!foes.length) return false;
    if (canPillage(game, u).ok) { pillage(game, u.id); return false; }
    if (u.hp < 60 || u.moves < 1 || (game.turn + u.id) % 3) return false;
    var here = ownerOf(game, key(u.q, u.r));
    var tile = game.index.get(key(u.q, u.r));
    var opts = Rules.neighbours(game, tile).filter(function (n) {
      var k = key(n.q, n.r), o = ownerOf(game, k);
      if (foes.indexOf(o) === -1 || game.cityAt.has(k)) return false;
      if (!((game.improvements || {})[k] || (game.roads || {})[k])) return false;
      if (game.units.some(function (x) { return x.q === n.q && x.r === n.r; })) return false;
      return Rules.unitMoveCost(game, u, n, tile) <= u.moves;
    });
    if (!opts.length || (foes.indexOf(here) === -1 && here !== u.owner && here !== -1)) return false;
    opts.sort(function (a, b) { return ((game.improvements || {})[key(b.q, b.r)] ? 1 : 0) - ((game.improvements || {})[key(a.q, a.r)] ? 1 : 0) || a.q - b.q || a.r - b.r; });
    if (!Rules.moveUnit(game, u.id, opts[0].q, opts[0].r).ok) return false;
    if (Rules.unitById(game, u.id) && canPillage(game, u).ok) pillage(game, u.id);
    return true;
  }
  // Worker AI: repair the nearest safe pillaged tile at home.
  function repairGoal(game, u) {
    var st = state(game), best = null, bd = 9;
    Object.keys(st.tiles).sort().forEach(function (k) {
      if (ownerOf(game, k) !== u.owner) return;
      var t = game.index.get(k), d = Rules.hexDistance(u.q, u.r, t.q, t.r);
      if (d >= bd) return;
      if (game.units.some(function (o) { return o.owner !== u.owner && Combat.strengthOf(o.type) > 0 && Combat.atWar(game, u.owner, o.owner) && Rules.hexDistance(o.q, o.r, t.q, t.r) <= 2; })) return;
      bd = d; best = { q: t.q, r: t.r, job: "repair" };
    });
    return best;
  }
  // Caravans wait at home rather than walk a route through a war zone.
  function unsafeRoute(game, cid, from, to) {
    var foes = enemiesOf(game, cid);
    if (!foes.length) return false;
    var line = hexLine(from, to);
    return line.some(function (k) {
      if (foes.indexOf(ownerOf(game, k)) !== -1) return true;
      var t = game.index.get(k);
      return game.units.some(function (o) { return foes.indexOf(o.owner) !== -1 && Combat.strengthOf(o.type) > 0 && Rules.hexDistance(o.q, o.r, t.q, t.r) <= 2; });
    });
  }
  if (Trade && Trade.aiCaravan) {
    var origCaravan = Trade.aiCaravan;
    Trade.aiCaravan = function (game, u, stepToward) {
      var t = Trade.aiTarget(game, u);
      if (t && unsafeRoute(game, u.owner, u, t)) { state(game).stats.held = (state(game).stats.held || 0) + 1; return; }
      return origCaravan(game, u, stepToward);
    };
  }

  var MODS = {
    onMove: function (g, u) { if (u && (g.trade && g.trade.routes.length || g.units.some(function (o) { return T(o.type).caravan; }))) plunderAt(g, u); }
  };
  Rules.registerPlugin({ mods: MODS, world: { init: function (g) { state(g); } } });

  root.PlanetPillage = {
    state: state, canPillage: canPillage, pillage: pillage, isPillaged: isPillaged, repair: repair, plunderAt: plunderAt,
    pathOf: pathOf, hexLine: hexLine, aiUnit: aiUnit, repairGoal: repairGoal, unsafeRoute: unsafeRoute
  };
})(typeof window !== "undefined" ? window : globalThis);
