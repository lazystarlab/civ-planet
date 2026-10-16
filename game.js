/*
 * game.js — GAME STATE AND RULES.
 * No DOM and no drawing. A game is a plain object:
 *   game = { seed, turn, civs[], cities[], units[], owner, tiles, index, diplo, log, ... }
 * Every city and unit has an `owner` (index into game.civs). Each civ entry
 * holds its own design, gold, science, tech, explored tiles and hooks:
 *   civs[i] = { id, design, ai, gold, science, tech, revealed:Set, cityNames, memory, mods }
 * civs[0] is the human player; game.gold / science / tech / revealed are
 * read-only-ish aliases for civs[0] so single-player UI code stays simple.
 *
 * Traits and technologies plug in through per-civ hooks (NO_MODS lists them),
 * composed per hook kind (HOOK_KIND). A modifier list entry may be a
 * function(game, cid) returning a hook object (tech.js and diplomacy.js need
 * the game). World-level modules (diplomacy, vision) add setup.world hooks:
 * { onEndTurn(game, events) }. This file never names a specific trait or tech.
 *
 * newGame(world, setup):  setup = { civs: [{ design, modifiers, cityNames, ai }], world: [...] }
 *   (the old { modifiers, cityNames } single-civ form still works).
 * exportState(game) / importState(world, setup, state): plain-JSON state for
 *   save.js; import takes setup = { modsFor(design, cid), world: [...] }.
 */
(function (root) {
  "use strict";

  var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  var START_YEAR = -4000;
  var YEARS_PER_TURN = 40;
  var FOOD_PER_POP = 2;
  var BASE_SCIENCE_PER_CITY = 1;   // plus 1 per 3 pop (see scienceRate)
  var LOG_KEEP = 60;
  var MAX_HP = 100;
  var IDLE_PROD_CAP = 30;          // production banked while a city has no build
  var MIN_CITY_DISTANCE = 2;     // "not adjacent to another city"
  var SIGHT = 2;

  // Base yields per biome: food, production (prod), gold.
  var BIOME_YIELD = {
    deep_ocean: { food: 1, prod: 0, gold: 0 },
    coast:      { food: 1, prod: 0, gold: 1 },
    plains:     { food: 1, prod: 1, gold: 0 },
    grassland:  { food: 2, prod: 0, gold: 0 },
    forest:     { food: 1, prod: 2, gold: 0 },
    jungle:     { food: 1, prod: 1, gold: 0 },
    desert:     { food: 0, prod: 1, gold: 0 },
    hills:      { food: 1, prod: 2, gold: 0 },
    mountain:   { food: 0, prod: 1, gold: 0 },
    tundra:     { food: 1, prod: 0, gold: 0 },
    snow:       { food: 0, prod: 0, gold: 0 }
  };

  var RESOURCE_YIELD = {
    wheat:  { food: 2, prod: 0, gold: 0 },
    horses: { food: 0, prod: 1, gold: 1 },
    fish:   { food: 2, prod: 0, gold: 0 },
    iron:   { food: 0, prod: 2, gold: 0 },
    gold:   { food: 0, prod: 0, gold: 3 },
    gems:   { food: 0, prod: 0, gold: 3 },
    spices: { food: 1, prod: 0, gold: 2 },
    oil:    { food: 0, prod: 2, gold: 0 },
    timber: { food: 0, prod: 1, gold: 0 },
    deer:   { food: 1, prod: 0, gold: 0 }
  };

  // Movement cost per biome; Infinity = impassable for land units.
  var MOVE_COST = {
    deep_ocean: Infinity, coast: Infinity, mountain: Infinity,
    plains: 1, grassland: 1, desert: 1, tundra: 1, snow: 1,
    hills: 2, forest: 2, jungle: 2
  };

  var UNIT_TYPES = {
    settler: { name: "Settler", moves: 2, canFound: true, strength: 0 },
    warrior: { name: "Warrior", moves: 1, canFound: false, strength: 6 }
  };

  var BUILDS = {
    warrior: { name: "Warrior", cost: 10, unit: "warrior", minPop: 1, popCost: 0 },
    settler: { name: "Settler", cost: 30, unit: "settler", minPop: 2, popCost: 1 }
  };

  // Preference for the tile the city itself sits on (open or defensible ground).
  var SITE_CENTRE_BONUS = { grassland: 6, plains: 6, hills: 4, forest: -3, jungle: -4 };

  var CITY_NAMES = [
    "Aster", "Brannock", "Calder", "Dunmere", "Elloran", "Fenwick",
    "Galeth", "Harrowgate", "Istrel", "Jorvane", "Kestrel", "Lornhal"
  ];

  // Identity hooks. civ.js and tech.js supply their own versions.
  var NO_MODS = {
    tileYield: function (tile, y, info) { return y; },          // info { onRiver, nearRiver, isCity }
    buildCost: function (build, cost) { return cost; },
    unitMoves: function (type, moves) { return moves; },
    growthNeed: function (pop, need) { return need; },
    cityScience: function (city) { return 0; },                 // added to the base 1 per city
    cityYield: function (city, y, info) { return y; },         // after tiles, before upkeep
    moveCost: function (tile, cost, info) { return cost; },    // info { unit, game, hasTech }
    canBuild: function (build, city) { return true; },
    resourceVisible: function (res) { return true; },
    startUnits: function () { return []; },
    siteScore: function (tile, score, info) { return score; },
    init: function (game, cid) {},                              // new or restored game
    onEndTurn: function (game, events, science, cid) {},
    onMove: function (game, unit, from) {}                      // after a unit moved (naval boarding)
  };

  // How a list of modifier objects combines, per hook.
  var HOOK_KIND = {
    tileYield: "chain", buildCost: "chain", unitMoves: "chain", growthNeed: "chain",
    cityYield: "chain", moveCost: "chain", siteScore: "chain",
    cityScience: "sum", startUnits: "concat",
    canBuild: "and", resourceVisible: "and",
    init: "each", onEndTurn: "each", onMove: "each"
  };

  function composeMods(list) {
    var out = {};
    Object.keys(NO_MODS).forEach(function (name) {
      var fns = list.filter(function (m) { return m && typeof m[name] === "function"; })
        .map(function (m) { return m[name]; });
      if (!fns.length) { out[name] = NO_MODS[name]; return; }
      var kind = HOOK_KIND[name];
      if (kind === "chain") out[name] = function (a, v, info) {
        for (var i = 0; i < fns.length; i++) { var r = fns[i](a, v, info); if (r !== undefined) v = r; }
        return v;
      };
      else if (kind === "sum") out[name] = function (a) {
        var s = 0; for (var i = 0; i < fns.length; i++) s += fns[i](a) || 0; return s;
      };
      else if (kind === "concat") out[name] = function () {
        var o = []; for (var i = 0; i < fns.length; i++) o = o.concat(fns[i]() || []); return o;
      };
      else if (kind === "and") out[name] = function (a, b) {
        for (var i = 0; i < fns.length; i++) if (fns[i](a, b) === false) return false; return true;
      };
      else out[name] = function (a, b, c, d) { for (var i = 0; i < fns.length; i++) fns[i](a, b, c, d); };
    });
    return out;
  }


  // ------------------------------------------------------------ civs & hooks

  function civOf(game, cid) { return game.civs[cid == null ? 0 : cid]; }
  function hook(game, name, cid) {
    var c = game && game.civs ? game.civs[cid == null ? 0 : cid] : null;
    var m = (c && c.mods) || NO_MODS;
    return m[name] || NO_MODS[name];
  }
  // Plugins (slice 15+): modules that register themselves once loaded, so
  // every setup (app, saves, test harnesses) picks them up automatically.
  var PLUGINS = { mods: [], world: [] };
  function registerPlugin(p) {
    if (p.mods && PLUGINS.mods.indexOf(p.mods) === -1) PLUGINS.mods.push(p.mods);
    if (p.world && PLUGINS.world.indexOf(p.world) === -1) PLUGINS.world.push(p.world);
  }
  function installMods(game, cid, modifiers) {
    var list = Array.isArray(modifiers) ? modifiers : (modifiers ? [modifiers] : []);
    list = list.concat(PLUGINS.mods.filter(function (m) { return list.indexOf(m) === -1; }));
    game.civs[cid].mods = composeMods(list.map(function (m) { return typeof m === "function" ? m(game, cid) : m; }));
  }

  // Researched techs live in civ.tech (owned by tech.js); this is the one read-only peek.
  function hasTech(game, id, cid) {
    var c = game && game.civs ? civOf(game, cid) : null;
    return !!(c && c.tech && c.tech.done.indexOf(id) !== -1);
  }
  function resourceVisible(game, res, cid) { return !!res && hook(game, "resourceVisible", cid)(res); }

  function citiesOf(game, cid) { return game.cities.filter(function (c) { return c.owner === cid; }); }
  function unitsOf(game, cid) { return game.units.filter(function (u) { return u.owner === cid; }); }
  function civName(game, cid) { var c = civOf(game, cid); return c && c.design ? c.design.name : "Civ " + cid; }

  function logEvent(game, kind, text, cid, at) {
    var e = { turn: game.turn, kind: kind, text: text, cid: cid == null ? null : cid };
    if (at && at.q != null) { e.q = at.q; e.r = at.r; }
    game.log.push(e);
    if (game.log.length > LOG_KEEP) game.log.splice(0, game.log.length - LOG_KEEP);
  }

  // --------------------------------------------------------------- geometry

  function key(q, r) { return q + "," + r; }

  function hexDistance(aq, ar, bq, br) {
    var dq = aq - bq, dr = ar - br;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  function neighbours(game, tile) {
    var out = [];
    for (var k = 0; k < 6; k++) {
      var n = game.index.get(key(tile.q + DIRS[k][0], tile.r + DIRS[k][1]));
      if (n) out.push(n);
    }
    return out;
  }

  function tilesInRadius(game, q, r, rad) {
    var out = [];
    for (var dq = -rad; dq <= rad; dq++) {
      for (var dr = Math.max(-rad, -dq - rad); dr <= Math.min(rad, -dq + rad); dr++) {
        var t = game.index.get(key(q + dq, r + dr));
        if (t) out.push(t);
      }
    }
    return out;
  }

  function isWater(tile) { return tile.biome === "deep_ocean" || tile.biome === "coast"; }

  function nearRiver(game, tile) {
    if (tile.river > 0) return true;
    if (isWater(tile)) return false;
    var ns = neighbours(game, tile);
    for (var i = 0; i < ns.length; i++) if (ns[i].river > 0) return true;
    return false;
  }

  // Which civ owns this tile's territory (-1 for none).
  function tileCiv(game, tile) {
    var id = game.owner.get(key(tile.q, tile.r));
    if (id == null) return -1;
    var c = cityById(game, id);
    return c ? c.owner : -1;
  }

  // ----------------------------------------------------------------- yields

  // Yield of one tile for civ cid (default: whoever owns the tile, else the player).
  function tileYield(game, tile, cid) {
    if (cid == null) { cid = tileCiv(game, tile); if (cid < 0) cid = 0; }
    var b = BIOME_YIELD[tile.biome] || { food: 0, prod: 0, gold: 0 };
    var y = { food: b.food, prod: b.prod, gold: b.gold };
    if (tile.resource && RESOURCE_YIELD[tile.resource] && resourceVisible(game, tile.resource, cid)) {
      var ry = RESOURCE_YIELD[tile.resource];
      y.food += ry.food; y.prod += ry.prod; y.gold += ry.gold;
    }
    var near = nearRiver(game, tile);
    if (tile.river > 0) y.food += 1;
    if (near) y.gold += 1;
    var city = game.cityAt ? game.cityAt.get(key(tile.q, tile.r)) : null;
    if (city) {
      y.food = Math.max(y.food, 2);
      y.prod = Math.max(y.prod, 1);
      y.gold = Math.max(y.gold, 1);
    }
    return hook(game, "tileYield", cid)(tile, y, { onRiver: tile.river > 0, nearRiver: near, isCity: !!city });
  }

  function maxMoves(game, type, cid) { return hook(game, "unitMoves", cid)(type, UNIT_TYPES[type].moves); }
  function buildCost(game, build, cid) { return hook(game, "buildCost", cid)(build, BUILDS[build].cost); }

  // Can this city start this build now (tech known, building not already there)?
  function canBuild(game, city, build) {
    var b = BUILDS[build];
    if (!b) return false;
    if (b.building && city && (city.buildings || []).indexOf(b.building) !== -1) return false;
    return hook(game, "canBuild", city ? city.owner : 0)(build, city);
  }

  function moveCost(tile) {
    var c = MOVE_COST[tile.biome];
    return c === undefined ? Infinity : c;
  }

  // Movement cost of a tile for one unit. Hooks may open water (embarking) or
  // close foreign territory (diplomacy).
  function unitMoveCost(game, unit, tile, from) {
    var cid = unit.owner || 0;
    return hook(game, "moveCost", cid)(tile, moveCost(tile), {
      unit: unit, game: game, cid: cid, tileCiv: tileCiv(game, tile), from: from || null,
      hasTech: function (id) { return hasTech(game, id, cid); }
    });
  }

  // Tiles a unit may not enter at all: foreign units and foreign cities.
  function blockedFor(game, cid) {
    var s = new Set();
    for (var i = 0; i < game.units.length; i++) if (game.units[i].owner !== cid) s.add(key(game.units[i].q, game.units[i].r));
    for (i = 0; i < game.cities.length; i++) if (game.cities[i].owner !== cid) s.add(key(game.cities[i].q, game.cities[i].r));
    return s;
  }

  /*
   * Dijkstra over movement points. A unit may always step while it has any
   * movement left (the step then uses whatever remains), so a 1-move warrior
   * can still enter forest. Returns Map key -> { tile, used, prev }.
   */
  function reachable(game, unit) {
    var blocked = blockedFor(game, unit.owner || 0);
    var start = game.index.get(key(unit.q, unit.r));
    var best = new Map();
    best.set(key(start.q, start.r), { tile: start, used: 0, prev: null });
    var open = [best.get(key(start.q, start.r))];
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].used < open[bi].used) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cur.used >= unit.moves) continue;
      var ns = neighbours(game, cur.tile);
      for (var k = 0; k < ns.length; k++) {
        var n = ns[k];
        var nk = key(n.q, n.r);
        if (blocked.has(nk)) continue;
        var c = unitMoveCost(game, unit, n, cur.tile);
        if (c === Infinity) continue;
        var used = Math.min(unit.moves, cur.used + c);
        var prevBest = best.get(nk);
        if (prevBest && prevBest.used <= used) continue;
        var node = { tile: n, used: used, prev: cur };
        best.set(nk, node);
        open.push(node);
      }
    }
    return best;
  }

  /*
   * Whole-map shortest path for multi-turn travel (AI). Ignores foreign units
   * (they move) but respects terrain, embarking and border rules. Costs are
   * small integers, so a bucket queue keeps it fast. Returns [tiles] or null.
   */
  function longPath(game, unit, tq, tr, maxCost) {
    var target = key(tq, tr);
    var startK = key(unit.q, unit.r);
    var dist = new Map([[startK, 0]]), prev = new Map();
    var buckets = [[game.index.get(startK)]];
    var limit = (maxCost || 80) * 3;
    var cityBlock = new Set();
    for (var i = 0; i < game.cities.length; i++) if (game.cities[i].owner !== unit.owner) cityBlock.add(key(game.cities[i].q, game.cities[i].r));
    for (var d = 0; d < buckets.length && d <= limit; d++) {
      var b = buckets[d];
      if (!b) continue;
      for (var j = 0; j < b.length; j++) {
        var t = b[j], tk = key(t.q, t.r);
        if (dist.get(tk) !== d) continue;
        if (tk === target) {
          var path = [t];
          while (prev.has(key(path[0].q, path[0].r))) path.unshift(prev.get(key(path[0].q, path[0].r)));
          return path;
        }
        var ns = neighbours(game, t);
        for (var k = 0; k < ns.length; k++) {
          var n = ns[k], nk = key(n.q, n.r);
          if (cityBlock.has(nk)) continue;
          // Costs in thirds of a move (roads cost 1/3), so buckets stay integers.
          var c = unitMoveCost(game, unit, n, t);
          if (c === Infinity) continue;
          var nd = d + Math.max(1, Math.round(c * 3));
          if (dist.has(nk) && dist.get(nk) <= nd) continue;
          dist.set(nk, nd); prev.set(nk, t);
          (buckets[nd] = buckets[nd] || []).push(n);
        }
      }
    }
    return null;
  }

  function findPath(game, unit, q, r) {
    var reach = reachable(game, unit);
    var node = reach.get(key(q, r));
    if (!node) return null;
    var path = [];
    while (node) { path.unshift(node.tile); node = node.prev; }
    return { path: path, used: reach.get(key(q, r)).used };
  }

  function reveal(game, q, r, rad, cid) {
    var set = civOf(game, cid).revealed;
    var ts = tilesInRadius(game, q, r, rad);
    for (var i = 0; i < ts.length; i++) set.add(key(ts[i].q, ts[i].r));
  }

  function unitById(game, id) {
    for (var i = 0; i < game.units.length; i++) if (game.units[i].id === id) return game.units[i];
    return null;
  }

  function cityById(game, id) {
    for (var i = 0; i < game.cities.length; i++) if (game.cities[i].id === id) return game.cities[i];
    return null;
  }

  function addUnit(game, type, q, r, cid) {
    cid = cid || 0;
    var u = { id: game.nextId++, owner: cid, type: type, q: q, r: r, moves: maxMoves(game, type, cid),
      hp: MAX_HP, fort: false, fortifying: false, moved: false };
    game.units.push(u);
    reveal(game, q, r, SIGHT, cid);
    return u;
  }

  function sightOf(type) { var t = UNIT_TYPES[type]; return (t && t.sight) || SIGHT; }

  // Units carried by a ship (unit.aboard === ship id).
  function cargoOf(game, ship) {
    return game.units.filter(function (o) { return o.aboard === ship.id; });
  }

  // Move a unit and anything it carries.
  function placeUnit(game, u, q, r) {
    u.q = q; u.r = r;
    for (var i = 0; i < game.units.length; i++) if (game.units[i].aboard === u.id) { game.units[i].q = q; game.units[i].r = r; }
  }

  // Remove a unit; its cargo goes down with it.
  function removeUnit(game, u) {
    game.units = game.units.filter(function (o) { return o !== u && o.aboard !== u.id; });
  }

  function moveUnit(game, unitId, q, r) {
    var u = unitById(game, unitId);
    if (!u) return { ok: false, reason: "No such unit" };
    if (u.q === q && u.r === r) return { ok: false, reason: "Already there" };
    var found = findPath(game, u, q, r);
    if (!found) return { ok: false, reason: "Out of reach" };
    for (var i = 0; i < found.path.length; i++) reveal(game, found.path[i].q, found.path[i].r, sightOf(u.type), u.owner);
    var from = { q: u.q, r: u.r };
    placeUnit(game, u, q, r);
    u.moves = Math.max(0, Math.round((u.moves - found.used) * 1000) / 1000);
    u.moved = true; u.fort = false; u.fortifying = false;
    hook(game, "onMove", u.owner)(game, u, from);
    return { ok: true, path: found.path };
  }

  // Could civ cid found a city on this tile? (Shared by canFoundCity and the AI.)
  function canFoundAt(game, cid, tile) {
    if (!tile || isWater(tile) || moveCost(tile) === Infinity) return { ok: false, reason: "Must be on passable land" };
    var tc = tileCiv(game, tile);
    if (tc >= 0 && tc !== cid) return { ok: false, reason: "Inside " + civName(game, tc) + " territory" };
    for (var i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (hexDistance(c.q, c.r, tile.q, tile.r) < MIN_CITY_DISTANCE) return { ok: false, reason: "Too close to " + c.name };
    }
    return { ok: true };
  }

  function canFoundCity(game, unitId) {
    var u = unitById(game, unitId);
    if (!u || !UNIT_TYPES[u.type].canFound) return { ok: false, reason: "Only a settler can found a city" };
    return canFoundAt(game, u.owner, game.index.get(key(u.q, u.r)));
  }

  function workRadius(city) { return city.pop >= 3 ? 2 : 1; }

  // Claim territory (tiles not owned by another city) and pick worked tiles.
  function refreshCity(game, city) {
    var rad = workRadius(city);
    var area = tilesInRadius(game, city.q, city.r, rad);
    for (var i = 0; i < area.length; i++) {
      var k = key(area[i].q, area[i].r);
      if (!game.owner.has(k)) game.owner.set(k, city.id);
    }
    reveal(game, city.q, city.r, rad + 1, city.owner);
    // Tiles bought further out (economy.js) are workable too.
    var outer = tilesInRadius(game, city.q, city.r, 3);
    for (i = 0; i < outer.length; i++) {
      if (hexDistance(outer[i].q, outer[i].r, city.q, city.r) > rad && game.owner.get(key(outer[i].q, outer[i].r)) === city.id) area.push(outer[i]);
    }
    var centre = key(city.q, city.r);
    var options = [];
    for (i = 0; i < area.length; i++) {
      var t = area[i];
      var tk = key(t.q, t.r);
      if (tk === centre || game.owner.get(tk) !== city.id) continue;
      var y = tileYield(game, t, city.owner);
      options.push({ k: tk, score: y.food * 4 + y.prod * 2 + y.gold, idx: i });
    }
    options.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
    city.worked = [centre].concat(options.slice(0, city.pop).map(function (o) { return o.k; }));
  }

  function cityYield(game, city) {
    var y = { food: 0, prod: 0, gold: 0 };
    for (var i = 0; i < city.worked.length; i++) {
      var ty = tileYield(game, game.index.get(city.worked[i]), city.owner);
      y.food += ty.food; y.prod += ty.prod; y.gold += ty.gold;
    }
    y = hook(game, "cityYield", city.owner)(city, y, { buildings: city.buildings || [] });
    y.upkeep = city.pop * FOOD_PER_POP;
    y.surplus = y.food - y.upkeep;
    return y;
  }

  function growthNeed(pop, game, cid, city) {
    var base = 15 + 8 * (pop - 1) + Math.floor(Math.pow(pop - 1, 1.5));
    return hook(game, "growthNeed", cid)(pop, base, { city: city || null });
  }

  // Science per city: 1, plus 1 per 3 pop, plus trait/building/tech bonuses.
  function cityScienceOf(game, city) {
    return BASE_SCIENCE_PER_CITY + Math.floor(city.pop / 3) + hook(game, "cityScience", city.owner)(city);
  }
  function scienceRate(game, cid) {
    cid = cid || 0;
    var s = 0;
    for (var i = 0; i < game.cities.length; i++) if (game.cities[i].owner === cid) s += cityScienceOf(game, game.cities[i]);
    return s;
  }

  function goldRate(game, cid) {
    var s = 0;
    for (var i = 0; i < game.cities.length; i++) if (game.cities[i].owner === cid) s += cityYield(game, game.cities[i]).gold;
    return s;
  }

  function foundCity(game, unitId) {
    var check = canFoundCity(game, unitId);
    if (!check.ok) return check;
    var u = unitById(game, unitId);
    var cv = civOf(game, u.owner);
    var names = cv.cityNames && cv.cityNames.length ? cv.cityNames : CITY_NAMES;
    var n = citiesOf(game, u.owner).length;
    var hadCapital = game.cities.some(function (c) { return c.owner === u.owner && c.capital; });
    // First name not already on the map (lost or captured cities keep theirs).
    var taken = {}; game.cities.forEach(function (c) { taken[c.name] = true; });
    var name;
    for (var i = n; ; i++) {
      name = names[i % names.length] + (i >= names.length ? " " + (Math.floor(i / names.length) + 1) : "");
      if (!taken[name]) break;
    }
    var city = {
      id: game.nextId++, owner: u.owner, name: name, q: u.q, r: u.r,
      pop: 1, food: 0, prod: 0, build: "warrior", repeat: false, worked: [], buildings: [], founded: game.turn,
      hp: MAX_HP, capital: !hadCapital
    };
    game.cities.push(city);
    game.cityAt.set(key(city.q, city.r), city);
    game.units.splice(game.units.indexOf(u), 1);
    refreshCity(game, city);
    return { ok: true, city: city };
  }

  // build may be null (nothing queued: production is stored until a choice is made).
  function setBuild(game, cityId, build) {
    var c = cityById(game, cityId);
    if (!c) return { ok: false };
    if (build != null && !canBuild(game, c, build)) return { ok: false };
    c.build = build;
    return { ok: true };
  }

  function setRepeat(game, cityId, on) {
    var c = cityById(game, cityId);
    if (c) c.repeat = !!on;
  }

  // eras.js installs a calendar that slows down with time (setCalendar).
  var CALENDAR_FN = null;
  function setCalendar(fn) { CALENDAR_FN = fn; }
  function yearLabel(turn) {
    if (CALENDAR_FN) return CALENDAR_FN(turn);
    var y = START_YEAR + turn * YEARS_PER_TURN;
    return y < 0 ? (-y) + " BC" : (y === 0 ? 1 : y) + " AD";
  }

  /*
   * One civ's end of turn: cities grow and build, gold and science come in,
   * units refresh. Events are { cid, kind, text, city? }.
   */
  function endCivTurn(game, cid, events) {
    var cv = civOf(game, cid);
    function ev(kind, text, extra) {
      var e = { cid: cid, kind: kind, text: text };
      if (extra) for (var k in extra) e[k] = extra[k];
      events.push(e);
    }
    for (var i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (c.owner !== cid) continue;
      refreshCity(game, c);
      var y = cityYield(game, c);
      c.food += y.surplus;
      var need = growthNeed(c.pop, game, cid, c);
      if (c.food >= need) {
        c.food -= need;
        c.pop += 1;
        ev("growth", c.name + " grew to " + c.pop);
      } else if (c.food < 0) {
        if (c.pop > 1) { c.pop -= 1; ev("growth", c.name + " is starving"); }
        c.food = 0;
      }
      c.prod += y.prod;
      if (c.build != null && !canBuild(game, c, c.build)) c.build = null;
      if (c.build != null) {
        var b = BUILDS[c.build];
        var cost = buildCost(game, c.build, cid);
        if (c.prod >= cost) {
          if (c.pop >= b.minPop) {
            c.prod -= cost;
            c.pop -= b.popCost;
            if (b.building) {
              c.buildings = (c.buildings || []).concat([b.building]);
              c.build = null;
              ev("built", c.name + " built a " + b.name, { city: c.id });
            } else {
              addUnit(game, b.unit, c.q, c.r, cid).home = c.id;
              if (!c.repeat) c.build = null;
              ev("built", c.name + " trained a " + b.name, { city: c.id });
            }
          } else {
            c.prod = cost;
            ev("built", c.name + ": " + b.name + " waits for pop " + b.minPop, { city: c.id });
          }
        }
      }
      if (c.build == null) {
        c.prod = Math.min(c.prod, IDLE_PROD_CAP);
        ev("choose", c.name + " needs a production choice", { city: c.id });
      }
      cv.gold += y.gold;
      refreshCity(game, c);
    }
    for (i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (u.owner === cid) u.moves = maxMoves(game, u.type, cid);
    }
    var sci = scienceRate(game, cid);
    cv.science += sci;
    var local = [];
    hook(game, "onEndTurn", cid)(game, local, sci, cid);
    for (i = 0; i < local.length; i++) {
      var le = local[i];
      if (typeof le === "string") ev("info", le);
      else ev(le.kind || "info", le.text);
    }
  }

  // End the turn for every civ, run world hooks (diplomacy, contact), advance.
  // Returns { events } for all civs; the player's own events are also logged.
  function endTurn(game) {
    var events = [];
    for (var cid = 0; cid < game.civs.length; cid++) if (!game.civs[cid].eliminated) endCivTurn(game, cid, events);
    var worldEvents = [];
    for (var w = 0; w < game.world.length; w++) if (game.world[w].onEndTurn) game.world[w].onEndTurn(game, worldEvents);
    for (var i = 0; i < events.length; i++) {
      if (events[i].cid === 0 && events[i].kind !== "choose") logEvent(game, events[i].kind, events[i].text, 0);
    }
    for (i = 0; i < worldEvents.length; i++) {
      var we = worldEvents[i];
      if (we.log !== false) logEvent(game, we.kind, we.text, we.cid);
    }
    game.turn += 1;
    return { events: events.concat(worldEvents) };
  }

  // Score a potential city site for civ cid from the yields of its radius-2 area.
  function siteScore(game, tile, cid, raw) {
    if (isWater(tile) || moveCost(tile) === Infinity) return -Infinity;
    if (tile.biome === "snow" || tile.biome === "desert" || tile.biome === "tundra") return -Infinity;
    cid = cid || 0;
    var s = 0, coastal = false;
    var area = tilesInRadius(game, tile.q, tile.r, 2);
    for (var i = 0; i < area.length; i++) {
      var t = area[i];
      var y = tileYield(game, t, cid);
      var w = hexDistance(t.q, t.r, tile.q, tile.r) <= 1 ? 1.4 : 0.7;
      s += w * (y.food * 2 + y.prod * 1.2 + y.gold * 0.6);
      if (hexDistance(t.q, t.r, tile.q, tile.r) === 1 && isWater(t)) coastal = true;
    }
    if (coastal) s += 4;
    if (tile.river > 0) s += 4;
    s += SITE_CENTRE_BONUS[tile.biome] || 0;
    if (raw) return s;
    return hook(game, "siteScore", cid)(tile, s, { coastal: coastal, onRiver: tile.river > 0, nearRiver: nearRiver(game, tile) });
  }

  // Land tiles in one connected landmass, for rejecting tiny islands.
  function landmassSize(game, tile, cap) {
    var seen = new Set([key(tile.q, tile.r)]);
    var stack = [tile];
    while (stack.length && seen.size < cap) {
      var t = stack.pop();
      var ns = neighbours(game, t);
      for (var i = 0; i < ns.length; i++) {
        var k = key(ns[i].q, ns[i].r);
        if (!seen.has(k) && moveCost(ns[i]) !== Infinity) { seen.add(k); stack.push(ns[i]); }
      }
    }
    return seen.size;
  }

  // Connected land regions: tile key -> landmass id, plus sizes.
  function landmasses(game) {
    var id = new Map(), sizes = [];
    for (var i = 0; i < game.tiles.length; i++) {
      var t0 = game.tiles[i], k0 = key(t0.q, t0.r);
      if (id.has(k0) || moveCost(t0) === Infinity) continue;
      var n = sizes.length, count = 0, stack = [t0];
      id.set(k0, n);
      while (stack.length) {
        var t = stack.pop(); count++;
        var ns = neighbours(game, t);
        for (var j = 0; j < ns.length; j++) {
          var k = key(ns[j].q, ns[j].r);
          if (!id.has(k) && moveCost(ns[j]) !== Infinity) { id.set(k, n); stack.push(ns[j]); }
        }
      }
      sizes.push(count);
    }
    return { id: id, sizes: sizes };
  }

  // Spawn a settler 2 (else 1) hexes from the site, on a tile from which the
  // site is reachable this turn, so the first move is meaningful.
  function spawnNear(game, cid, site) {
    function canReach(from) {
      var probe = { q: from.q, r: from.r, moves: maxMoves(game, "settler", cid), owner: cid };
      return reachable(game, probe).has(key(site.q, site.r));
    }
    for (var d = 2; d >= 1; d--) {
      var ring = tilesInRadius(game, site.q, site.r, d).filter(function (t) {
        return hexDistance(t.q, t.r, site.q, site.r) === d && moveCost(t) !== Infinity && canReach(t);
      });
      ring.sort(function (a, b) {
        return (moveCost(a) - moveCost(b)) || (PlanetGenHash(a, game.seed) - PlanetGenHash(b, game.seed));
      });
      if (ring[0]) return ring[0];
    }
    return site;
  }

  /*
   * Starts for every civ at once.
   *  - The player takes the best site (its own start preference applies) on a
   *    landmass of 60+ tiles.
   *  - Fairness: rivals only consider sites whose raw quality (yields, no
   *    preference) is at least 78% of the player's (relaxed to 65%, 50% if
   *    none), and lose 0.6 "hexes" per point below 92% of it.
   *  - Spread: each rival takes the candidate that maximizes the minimum
   *    distance to the starts already chosen; an unused landmass counts as
   *    +40 hexes when enough landmasses have good sites, +8 otherwise.
   *  - The civ's own preference breaks near-ties.
   * Returns [{ site, spawn, quality, landmass }].
   */
  function chooseStarts(game) {
    var lm = landmasses(game);
    var land = [];
    for (var i = 0; i < game.tiles.length; i++) {
      var t = game.tiles[i];
      var raw = siteScore(game, t, 0, true);
      if (raw === -Infinity) continue;
      var L = lm.id.get(key(t.q, t.r));
      if (L == null || lm.sizes[L] < 60) continue;
      land.push({ t: t, raw: raw, lm: L, i: i });
    }
    if (!land.length) {
      for (i = 0; i < game.tiles.length; i++) if (moveCost(game.tiles[i]) !== Infinity) { land.push({ t: game.tiles[i], raw: 0, lm: 0, i: i }); break; }
    }
    var out = [];
    // Player.
    var best = null, bestScore = -Infinity;
    land.forEach(function (c) {
      var s = siteScore(game, c.t, 0);
      if (s > bestScore) { bestScore = s; best = c; }
    });
    out.push({ site: best.t, quality: best.raw, landmass: best.lm });
    var refQ = best.raw;
    for (var cid = 1; cid < game.civs.length; cid++) {
      var pick = null;
      for (var f = 0; f < 3 && !pick; f++) {
        var floor = refQ * [0.78, 0.65, 0.5][f];
        var cands = land.filter(function (c) { return c.raw >= floor; });
        var used = {}; out.forEach(function (o) { used[o.landmass] = true; });
        var freeLm = {}; cands.forEach(function (c) { if (!used[c.lm]) freeLm[c.lm] = true; });
        var enoughLm = Object.keys(freeLm).length >= game.civs.length - cid;
        var bestV = -Infinity;
        for (var j = 0; j < cands.length; j++) {
          var c = cands[j], minD = 999;
          for (var o = 0; o < out.length; o++) minD = Math.min(minD, hexDistance(c.t.q, c.t.r, out[o].site.q, out[o].site.r));
          if (minD < 8) continue;
          var v = Math.min(minD, 40) + (used[c.lm] ? 0 : (enoughLm ? 40 : 8)) -
            Math.max(0, refQ * 0.92 - c.raw) * 0.6 + siteScore(game, c.t, cid) * 0.04;
          if (v > bestV) { bestV = v; pick = c; }
        }
      }
      pick = pick || land[0];
      out.push({ site: pick.t, quality: pick.raw, landmass: pick.lm });
    }
    out.forEach(function (o, cid) { o.spawn = spawnNear(game, cid, o.site); });
    return out;
  }

  // Back-compat single start (player only).
  function pickStart(game) { var s = chooseStarts(game)[0]; return { site: s.site, spawn: s.spawn }; }

  function PlanetGenHash(t, seed) {
    var h = 2166136261;
    var s = String(seed) + ":" + t.q + "," + t.r;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function makeCiv(id, entry) {
    return {
      id: id, design: entry.design || null, ai: !!entry.ai,
      gold: 0, science: 0, tech: null, revealed: new Set(),
      cityNames: entry.cityNames || CITY_NAMES, memory: null, ai_state: null, mods: NO_MODS
    };
  }

  // Player-facing aliases: game.gold / science / tech / revealed / cityNames -> civs[0].
  function addAliases(game) {
    ["gold", "science", "tech", "revealed", "cityNames"].forEach(function (f) {
      Object.defineProperty(game, f, {
        enumerable: false, configurable: true,
        get: function () { return game.civs[0][f]; },
        set: function (v) { game.civs[0][f] = v; }
      });
    });
    Object.defineProperty(game, "mods", {
      enumerable: false, configurable: true, get: function () { return game.civs[0].mods; }
    });
  }

  function baseGame(world, setup) {
    var game = {
      seed: world.seed,
      size: world.size || "standard",
      roads: {},
      improvements: {},
      tiles: world.tiles,
      index: new Map(),
      turn: 0,
      civs: [],
      cities: [],
      units: [],
      nextId: 1,
      owner: new Map(),
      cityAt: new Map(),
      suggested: null,
      startInfo: null,
      combatSeq: 0,
      diplo: null,
      log: [],
      world: (setup.world || []).concat(PLUGINS.world.filter(function (w) { return (setup.world || []).indexOf(w) === -1; }))
    };
    addAliases(game);
    for (var i = 0; i < world.tiles.length; i++) {
      game.index.set(key(world.tiles[i].q, world.tiles[i].r), world.tiles[i]);
    }
    return game;
  }

  function newGame(world, setup) {
    setup = setup || {};
    var entries = setup.civs || [{ modifiers: setup.modifiers, cityNames: setup.cityNames, design: setup.design || null }];
    var game = baseGame(world, setup);
    entries.forEach(function (e, cid) { game.civs.push(makeCiv(cid, e)); });
    entries.forEach(function (e, cid) { installMods(game, cid, e.modifiers); hook(game, "init", cid)(game, cid); });
    var starts = chooseStarts(game);
    game.startInfo = starts.map(function (s) { return { q: s.site.q, r: s.site.r, quality: Math.round(s.quality * 10) / 10, landmass: s.landmass }; });
    for (var cid = 0; cid < game.civs.length; cid++) {
      var start = starts[cid];
      if (cid === 0) game.suggested = { q: start.site.q, r: start.site.r };
      else game.civs[cid].ai_state = { site: { q: start.site.q, r: start.site.r } };
      addUnit(game, "settler", start.spawn.q, start.spawn.r, cid);
      var extra = hook(game, "startUnits", cid)();
      for (var e = 0; e < extra.length; e++) {
        if (UNIT_TYPES[extra[e]]) addUnit(game, extra[e], start.spawn.q, start.spawn.r, cid);
      }
      reveal(game, start.spawn.q, start.spawn.r, 3, cid);
    }
    for (var w = 0; w < game.world.length; w++) if (game.world[w].init) game.world[w].init(game);
    return game;
  }

  // ---- Save support: everything that is not derivable from the seed.
  var STATE_FIELDS = ["seed", "size", "roads", "improvements", "jobs", "trade", "deals", "wonders", "eras", "story", "galaxy", "peace", "strategic", "air", "promo", "navalai", "gov", "religion", "pillage", "aitune", "turn", "nextId", "suggested", "diplo", "log", "combatSeq", "startInfo"];
  var CIV_FIELDS = ["id", "design", "ai", "gold", "science", "tech", "cityNames", "memory", "ai_state", "eliminated", "lostCapital"];

  function exportState(game) {
    var st = {};
    STATE_FIELDS.forEach(function (f) { st[f] = game[f] === undefined ? null : game[f]; });
    st.civs = game.civs.map(function (c) {
      var o = {};
      CIV_FIELDS.forEach(function (f) { o[f] = c[f] === undefined ? null : c[f]; });
      o.revealed = Array.from(c.revealed);
      return o;
    });
    st.cities = game.cities;
    st.units = game.units;
    st.owner = Array.from(game.owner.entries());
    return JSON.parse(JSON.stringify(st));        // deep, plain copy
  }

  function importState(world, setup, state) {
    setup = setup || {};
    var st = JSON.parse(JSON.stringify(state));
    var game = baseGame(world, setup);
    STATE_FIELDS.forEach(function (f) { if (st[f] !== undefined) game[f] = st[f]; });
    if (!game.log) game.log = [];
    game.seed = world.seed;
    game.civs = (st.civs || []).map(function (c, i) {
      var cv = makeCiv(i, c);
      CIV_FIELDS.forEach(function (f) { if (c[f] !== undefined) cv[f] = c[f]; });
      cv.id = i;
      cv.revealed = new Set(c.revealed || []);
      return cv;
    });
    game.cities = st.cities || [];
    game.units = st.units || [];
    game.owner = new Map(st.owner || []);
    for (var i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (!c.buildings) c.buildings = [];
      if (c.owner == null) c.owner = 0;
      game.cityAt.set(key(c.q, c.r), c);
    }
    for (i = 0; i < game.units.length; i++) if (game.units[i].owner == null) game.units[i].owner = 0;
    game.civs.forEach(function (cv, cid) {
      installMods(game, cid, setup.modsFor ? setup.modsFor(cv.design, cid) : []);
      hook(game, "init", cid)(game, cid);        // modules fill in missing state
    });
    for (var w = 0; w < game.world.length; w++) if (game.world[w].init) game.world[w].init(game);
    return game;
  }

  root.PlanetGame = {
    newGame: newGame,
    registerPlugin: registerPlugin, PLUGINS: PLUGINS,
    tileYield: tileYield,
    moveCost: moveCost,
    reachable: reachable,
    longPath: longPath,
    findPath: findPath,
    moveUnit: moveUnit,
    canFoundCity: canFoundCity,
    canFoundAt: canFoundAt,
    foundCity: foundCity,
    setBuild: setBuild,
    setRepeat: setRepeat,
    endTurn: endTurn,
    endCivTurn: endCivTurn,
    cityYield: cityYield,
    growthNeed: growthNeed,
    scienceRate: scienceRate,
    cityScience: cityScienceOf,
    goldRate: goldRate,
    maxMoves: maxMoves,
    buildCost: buildCost,
    canBuild: canBuild,
    unitMoveCost: unitMoveCost,
    hasTech: hasTech,
    resourceVisible: resourceVisible,
    exportState: exportState,
    importState: importState,
    composeMods: composeMods,
    citiesOf: citiesOf,
    unitsOf: unitsOf,
    civName: civName,
    tileCiv: tileCiv,
    tilesInRadius: tilesInRadius,
    neighbours: neighbours,
    isWater: isWater,
    logEvent: logEvent,
    reveal: reveal,
    sightOf: sightOf,
    cargoOf: cargoOf,
    placeUnit: placeUnit,
    addUnit: addUnit,
    removeUnit: removeUnit,
    landmasses: landmasses,
    chooseStarts: chooseStarts,
    MAX_HP: MAX_HP,
    NO_MODS: NO_MODS,
    workRadius: workRadius,
    siteScore: siteScore,
    yearLabel: yearLabel, setCalendar: setCalendar,
    unitById: unitById,
    cityById: cityById,
    hexDistance: hexDistance,
    key: key,
    SIGHT: SIGHT,
    UNIT_TYPES: UNIT_TYPES,
    BUILDS: BUILDS,
    BIOME_YIELD: BIOME_YIELD,
    RESOURCE_YIELD: RESOURCE_YIELD
  };
})(typeof window !== "undefined" ? window : globalThis);
