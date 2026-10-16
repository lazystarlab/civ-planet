/*
 * naval.js — SHIPS. No DOM.
 * Units: Trireme (Sailing; strength 6, 3 moves, coast only, carries 2) and
 * Caravel (Navigation; strength 10, 4 moves, any water, carries 3, sight 3).
 * Both build only in coastal cities (next to a sea of 30+ water tiles).
 * Rules through hooks (put first in each civ's modifier list):
 *  - moveCost: ships move on water (Trireme: coast only) and into their own
 *    cities (ports). A land unit may step onto a water tile holding a friendly
 *    transport with room (boarding), and an aboard unit may step onto
 *    adjacent land (disembarking); both cost all remaining moves.
 *  - onMove: boarding / disembarking sets unit.aboard; a ship entering its
 *    own city unloads. Cargo follows its ship (game.js placeUnit) and sinks
 *    with it (game.js removeUnit).
 *  - canBuild: ships only in coastal cities.
 * board(): a land unit in a port boards a docked ship. unload(): every
 * carried unit with moves left steps onto adjacent land.
 * AI: buildScore() for ship builds, aiTurn() for exploration and ferrying a
 * settler (plus an escort) to a good site on another landmass.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Combat = root.PlanetCombat;

  var BOARD_COST = 99;   // more than any unit has: boarding ends the move

  var SHIPS = {
    trireme: { name: "Trireme", moves: 3, canFound: false, strength: 6, naval: true, ocean: false, cargo: 2, sight: 2 },
    caravel: { name: "Caravel", moves: 4, canFound: false, strength: 10, naval: true, ocean: true, cargo: 3, sight: 3 }
  };
  var SHIP_BUILDS = {
    trireme: { name: "Trireme", cost: 24, unit: "trireme", minPop: 1, popCost: 0, tech: "sailing", note: "coast · carries 2" },
    caravel: { name: "Caravel", cost: 40, unit: "caravel", minPop: 1, popCost: 0, tech: "navigation", note: "ocean · carries 3" }
  };
  Object.keys(SHIPS).forEach(function (k) { Rules.UNIT_TYPES[k] = SHIPS[k]; });
  Object.keys(SHIP_BUILDS).forEach(function (k) { Rules.BUILDS[k] = SHIP_BUILDS[k]; });

  function isNaval(type) { var t = Rules.UNIT_TYPES[type]; return !!(t && t.naval); }
  function capacity(type) { var t = Rules.UNIT_TYPES[type]; return (t && t.cargo) || 0; }
  function tileOf(game, q, r) { return game.index.get(Rules.key(q, r)); }

  // Connected water bodies (static per map), cached on the game, not saved.
  var MIN_SEA = 30;
  function waterBody(game, tile) {
    if (!game._water) {
      var id = new Map(), sizes = [];
      game.tiles.forEach(function (t0) {
        var k0 = Rules.key(t0.q, t0.r);
        if (id.has(k0) || !Rules.isWater(t0)) return;
        var n = sizes.length, stack = [t0], count = 0;
        id.set(k0, n);
        while (stack.length) {
          var t = stack.pop(); count++;
          Rules.neighbours(game, t).forEach(function (nb) {
            var k = Rules.key(nb.q, nb.r);
            if (!id.has(k) && Rules.isWater(nb)) { id.set(k, n); stack.push(nb); }
          });
        }
        sizes.push(count);
      });
      Object.defineProperty(game, "_water", { value: { id: id, sizes: sizes }, writable: true, configurable: true, enumerable: false });
    }
    var w = game._water.id.get(Rules.key(tile.q, tile.r));
    return w == null ? 0 : game._water.sizes[w];
  }

  // Ids of the seas (30+ water tiles) next to a city.
  function seasOf(game, city) {
    var out = [];
    Rules.neighbours(game, tileOf(game, city.q, city.r)).forEach(function (t) {
      if (!Rules.isWater(t) || waterBody(game, t) < MIN_SEA) return;
      var id = game._water.id.get(Rules.key(t.q, t.r));
      if (out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  // A port: a city next to a sea of 30+ water tiles (lakes don't count).
  function coastal(game, city) {
    return Rules.neighbours(game, tileOf(game, city.q, city.r)).some(function (t) {
      return Rules.isWater(t) && waterBody(game, t) >= MIN_SEA;
    });
  }

  function canSail(type, tile) {
    if (!Rules.isWater(tile)) return false;
    return tile.biome === "coast" || Rules.UNIT_TYPES[type].ocean;
  }

  // A friendly ship on the tile with room for one more unit.
  function transportAt(game, cid, q, r, except) {
    for (var i = 0; i < game.units.length; i++) {
      var s = game.units[i];
      if (s.owner === cid && s.q === q && s.r === r && s !== except && capacity(s.type) > 0 &&
          Rules.cargoOf(game, s).length < capacity(s.type)) return s;
    }
    return null;
  }

  function ownCityAt(game, cid, q, r) {
    var c = game.cityAt.get(Rules.key(q, r));
    return c && c.owner === cid ? c : null;
  }

  function makeModifiers(game, cid) {
    return {
      moveCost: function (tile, cost, info) {
        var u = info.unit;
        if (!u) return cost;
        if (isNaval(u.type)) {
          if (Rules.isWater(tile)) return canSail(u.type, tile) ? 1 : Infinity;
          return ownCityAt(game, u.owner, tile.q, tile.r) ? 1 : Infinity;
        }
        if (Rules.isWater(tile)) {
          return transportAt(game, u.owner, tile.q, tile.r) ? BOARD_COST : cost;
        }
        if (u.aboard != null && cost !== Infinity) return BOARD_COST;   // disembarking
        return cost;
      },
      canBuild: function (key, city) {
        var b = Rules.BUILDS[key];
        return !(b && b.unit && isNaval(b.unit)) || !city || coastal(game, city);
      },
      onMove: function (g, u, from) {
        var tile = tileOf(g, u.q, u.r);
        if (isNaval(u.type)) {
          if (ownCityAt(g, u.owner, u.q, u.r)) Rules.cargoOf(g, u).forEach(function (c) { c.aboard = null; });
          return;
        }
        if (Rules.isWater(tile)) {
          var ship = transportAt(g, u.owner, u.q, u.r);
          if (ship && u.aboard !== ship.id) { u.aboard = ship.id; u.moves = 0; u.fort = false; }
          else if (!ship) u.aboard = null;   // Seafaring units can stand on coast unaided
        } else if (u.aboard != null) {
          u.aboard = null; u.moves = 0;
        }
      }
    };
  }

  // A land unit in its own city boards a ship docked there.
  function board(game, unitId, shipId) {
    var u = Rules.unitById(game, unitId), s = Rules.unitById(game, shipId);
    if (!u || !s || isNaval(u.type) || !isNaval(s.type)) return { ok: false, reason: "Nothing to board" };
    if (u.q !== s.q || u.r !== s.r || !ownCityAt(game, u.owner, u.q, u.r)) return { ok: false, reason: "Board from a port, or move onto the ship" };
    if (u.moves <= 0) return { ok: false, reason: "No moves left" };
    if (Rules.cargoOf(game, s).length >= capacity(s.type)) return { ok: false, reason: "The ship is full" };
    u.aboard = s.id; u.moves = 0; u.fort = false; u.fortifying = false;
    return { ok: true, text: Rules.UNIT_TYPES[u.type].name + " boarded the " + Rules.UNIT_TYPES[s.type].name };
  }

  // Land every carried unit that can still move onto adjacent land.
  function unload(game, shipId, prefer) {
    var s = Rules.unitById(game, shipId);
    if (!s) return { ok: false, reason: "No ship" };
    var cargo = Rules.cargoOf(game, s), landed = 0;
    if (!cargo.length) return { ok: false, reason: "Nothing aboard" };
    cargo.forEach(function (c) {
      if (c.moves <= 0) return;
      var reach = Rules.reachable(game, c);
      var opts = Rules.neighbours(game, tileOf(game, s.q, s.r)).filter(function (t) {
        return !Rules.isWater(t) && reach.has(Rules.key(t.q, t.r));
      });
      if (prefer) opts.sort(function (a, b) { return Rules.hexDistance(a.q, a.r, prefer.q, prefer.r) - Rules.hexDistance(b.q, b.r, prefer.q, prefer.r); });
      if (opts.length && Rules.moveUnit(game, c.id, opts[0].q, opts[0].r).ok) landed++;
    });
    return landed ? { ok: true, landed: landed, text: landed + (landed === 1 ? " unit" : " units") + " went ashore" }
      : { ok: false, reason: "No free land next to the ship (or no moves left)" };
  }

  // ------------------------------------------------------------------ AI

  function ports(game, cid) { return Rules.citiesOf(game, cid).filter(function (c) { return coastal(game, c); }); }
  function shipsOf(game, cid) { return Rules.unitsOf(game, cid).filter(function (u) { return isNaval(u.type); }); }

  function landmassOf(game, q, r) {
    if (!game._lm || game._lmTurn !== game.turn) {
      Object.defineProperty(game, "_lm", { value: Rules.landmasses(game), writable: true, configurable: true, enumerable: false });
      Object.defineProperty(game, "_lmTurn", { value: game.turn, writable: true, configurable: true, enumerable: false });
    }
    return game._lm.id.get(Rules.key(q, r));
  }

  function canFerry(game, cid) {
    return Rules.hasTech(game, "sailing", cid) && ports(game, cid).length > 0;
  }

  // Weight for building a ship in this city (0 = not now).
  function buildScore(game, city, key) {
    var cid = city.owner;
    if (!coastal(game, city)) return 0;
    var ships = shipsOf(game, cid), building = Rules.citiesOf(game, cid).filter(function (c) { return c.build === key; }).length;
    var wantFerry = Rules.unitsOf(game, cid).some(function (u) { return u.role === "ferry" && u.ferry == null; });
    var idle = ships.some(function (s) { return !s.mission && capacity(s.type) > 0; });
    if (building) return 0;
    if (key === "trireme") {
      if (!ships.length) return 3.5;
      if (wantFerry && !idle && ships.length < 3) return 5;
      return 0;
    }
    if (key === "caravel") {
      if (!ships.some(function (s) { return s.type === "caravel"; })) return 4;
      if (wantFerry && !idle && ships.length < 3) return 5.5;
      return 0;
    }
    return 0;
  }

  function nearestPort(game, u) {
    var lm = landmassOf(game, u.q, u.r), best = null, bd = 99;
    ports(game, u.owner).forEach(function (c) {
      if (lm != null && landmassOf(game, c.q, c.r) !== lm) return;
      var d = Rules.hexDistance(u.q, u.r, c.q, c.r);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }

  // Best site on another landmass, next to water this ship can sail.
  function overseasSite(game, ship, settler, port, h) {
    var cid = ship.owner, cv = game.civs[cid];
    var home = landmassOf(game, settler.q, settler.r), bad = (cv.ai_state && cv.ai_state.badSites) || {};
    var cands = [];
    cv.revealed.forEach(function (k) {
      var t = game.index.get(k);
      if (!t || Rules.isWater(t) || bad[k] || Rules.hexDistance(t.q, t.r, port.q, port.r) > 40) return;
      var lm = landmassOf(game, t.q, t.r);
      if (lm == null || lm === home || !Rules.canFoundAt(game, cid, t).ok) return;
      var drop = Rules.neighbours(game, t).filter(function (w) { return canSail(ship.type, w); })[0];
      if (!drop) return;
      var s = Rules.siteScore(game, t, cid);
      if (s === -Infinity) return;
      cands.push({ t: t, drop: drop, s: s - 1.0 * Rules.hexDistance(t.q, t.r, port.q, port.r) + h.jitter(ship.id, t.q, t.r) });
    });
    cands.sort(function (a, b) { return b.s - a.s; });
    for (var i = 0; i < Math.min(4, cands.length); i++) {
      var probe = { q: port.q, r: port.r, owner: cid, type: ship.type, moves: 1 };
      if (Rules.longPath(game, probe, cands[i].drop.q, cands[i].drop.r, 120)) return cands[i];
    }
    return null;
  }

  function escortFor(game, cid, port) {
    var best = null, bd = 99;
    Rules.unitsOf(game, cid).forEach(function (u) {
      if (isNaval(u.type) || !Combat.strengthOf(u.type) || u.role === "garrison" || u.role === "escort" || u.aboard != null) return;
      var d = Rules.hexDistance(u.q, u.r, port.q, port.r);
      if (d < bd && d <= 12) { bd = d; best = u; }
    });
    return best;
  }

  function abort(game, ship, why) {
    var m = ship.mission;
    var cv = game.civs[ship.owner];
    cv.ai_state = cv.ai_state || {};
    cv.ai_state.badSites = cv.ai_state.badSites || {};
    if (m && m.site) cv.ai_state.badSites[Rules.key(m.site.q, m.site.r)] = game.turn;
    [m && m.settler, m && m.escort].forEach(function (id) {
      var u = id != null ? Rules.unitById(game, id) : null;
      if (u) { u.ferry = null; if (u.role === "escort") u.role = null; }
    });
    ship.mission = null;
    ship.target = null;
  }

  function runMission(game, ship, h) {
    var m = ship.mission;
    var settler = Rules.unitById(game, m.settler), escort = m.escort != null ? Rules.unitById(game, m.escort) : null;
    if (!settler || game.turn - m.t > 30) { abort(game, ship, "lost"); return; }
    if (m.phase === "gather") {
      if (!(ship.q === m.port.q && ship.r === m.port.r)) h.stepToward(game, ship, m.port.q, m.port.r);
      [settler, escort].forEach(function (u) {
        if (u && u.aboard == null && u.moves > 0 && !(u.q === m.port.q && u.r === m.port.r)) h.stepToward(game, u, m.port.q, m.port.r);
      });
      var atPort = function (u) { return u && u.q === m.port.q && u.r === m.port.r; };
      if (atPort(ship) && atPort(settler)) {
        if (settler.aboard !== ship.id) { settler.moves = Math.max(settler.moves, 1); board(game, settler.id, ship.id); }
        if (escort && atPort(escort) && escort.aboard !== ship.id) { escort.moves = Math.max(escort.moves, 1); board(game, escort.id, ship.id); }
        if (settler.aboard === ship.id && (!escort || escort.aboard === ship.id || game.turn - m.t > 8)) {
          if (escort && escort.aboard !== ship.id) { escort.ferry = null; escort.role = null; m.escort = null; }
          m.phase = "sail";
        }
      }
      return;
    }
    if (m.phase === "sail") {
      var before = ship.q + "," + ship.r;
      if (!(ship.q === m.drop.q && ship.r === m.drop.r)) h.stepToward(game, ship, m.drop.q, m.drop.r);
      if (ship.q + "," + ship.r === before && !(ship.q === m.drop.q && ship.r === m.drop.r)) m.stuck = (m.stuck || 0) + 1;
      if (m.stuck > 2) { abort(game, ship, "stuck"); return; }
      if (ship.q === m.drop.q && ship.r === m.drop.r) m.phase = "land";
      else return;
    }
    if (m.phase === "land") {
      // Units aboard keep their moves while sailing, so they can step ashore now.
      [settler, escort].forEach(function (u) { if (u && u.aboard === ship.id && u.moves <= 0) u.moves = 1; });
      unload(game, ship.id, m.site);
      if (settler.aboard == null) {
        settler.ferry = null; settler.role = null; settler.target = { q: m.site.q, r: m.site.r }; settler.wait = 0;
        if (escort) { escort.ferry = null; escort.role = null; }
        ship.mission = null;
      } else if (++m.landTries > 2) abort(game, ship, "no landing");
    }
  }

  function planMission(game, ship, h) {
    if (capacity(ship.type) <= 0) return false;
    var settler = Rules.unitsOf(game, ship.owner).filter(function (u) { return u.role === "ferry" && u.ferry == null; })[0];
    if (!settler) return false;
    var port = nearestPort(game, settler);
    if (!port) return false;
    var site = overseasSite(game, ship, settler, port, h);
    if (!site) {
      if (settler.ferryTurn !== game.turn) { settler.ferryWait = (settler.ferryWait || 0) + 1; settler.ferryTurn = game.turn; }
      return false;
    }
    var escort = escortFor(game, ship.owner, port);
    ship.mission = { phase: "gather", t: game.turn, settler: settler.id, escort: escort ? escort.id : null,
      port: { q: port.q, r: port.r }, drop: { q: site.drop.q, r: site.drop.r }, site: { q: site.t.q, r: site.t.r }, landTries: 0 };
    settler.ferry = ship.id;
    if (escort) { escort.ferry = ship.id; escort.role = "escort"; }
    return true;
  }

  // Sail toward the nearest water next to unexplored tiles.
  function explore(game, ship, h) {
    var rev = game.civs[ship.owner].revealed;
    var still = ship.target && (function () {
      var t = tileOf(game, ship.target.q, ship.target.r);
      return Rules.tilesInRadius(game, t.q, t.r, 2).some(function (n) { return !rev.has(Rules.key(n.q, n.r)); });
    })();
    if (!still) {
      // Breadth-first over water this ship can actually sail, so targets are reachable.
      ship.target = null;
      var start = Rules.key(ship.q, ship.r), dist = new Map([[start, 0]]), queue = [tileOf(game, ship.q, ship.r)];
      var best = null, bs = Infinity;
      for (var qi = 0; qi < queue.length; qi++) {
        var cur = queue[qi], d = dist.get(Rules.key(cur.q, cur.r));
        if (d > 0 && Rules.neighbours(game, cur).some(function (n) { return !rev.has(Rules.key(n.q, n.r)); })) {
          var sc = d + h.jitter(ship.id, cur.q, cur.r) * 4 + (ship.bad && ship.bad[Rules.key(cur.q, cur.r)] ? 99 : 0);
          if (sc < bs) { bs = sc; best = cur; }
        }
        if (d >= 40) continue;
        Rules.neighbours(game, cur).forEach(function (n) {
          var k = Rules.key(n.q, n.r);
          if (dist.has(k) || !rev.has(k) || Rules.unitMoveCost(game, ship, n) === Infinity) return;
          dist.set(k, d + 1); queue.push(n);
        });
      }
      if (best) ship.target = { q: best.q, r: best.r };
    }
    if (!ship.target) return;
    if (!h.stepToward(game, ship, ship.target.q, ship.target.r)) {
      ship.bad = ship.bad || {};
      ship.bad[Rules.key(ship.target.q, ship.target.r)] = 1;
      ship.target = null;
    }
  }

  /*
   * One civ's ships: attack if at war and the odds are good, run a ferry
   * mission, start one for a waiting settler, else explore.
   * h = { stepToward, bestAttack, jitter } from ai.js.
   */
  function aiTurn(game, cid, h) {
    shipsOf(game, cid).forEach(function (ship) {
      if (!Rules.unitById(game, ship.id) || ship.moves <= 0) return;
      if (!ship.mission && Rules.cargoOf(game, ship).length === 0) {
        var hit = h.bestAttack(game, ship, false);
        if (hit) { Combat.attack(game, ship.id, hit.q, hit.r); return; }
      }
      if (ship.mission) { runMission(game, ship, h); return; }
      if (planMission(game, ship, h)) { runMission(game, ship, h); return; }
      explore(game, ship, h);
    });
  }

  root.PlanetNaval = {
    SHIPS: SHIPS, BOARD_COST: BOARD_COST, seasOf: seasOf, isNaval: isNaval, capacity: capacity, coastal: coastal, canSail: canSail,
    transportAt: transportAt, board: board, unload: unload, makeModifiers: makeModifiers,
    canFerry: canFerry, nearestPort: nearestPort, buildScore: buildScore, aiTurn: aiTurn, landmassOf: landmassOf, ports: ports, shipsOf: shipsOf
  };
})(typeof window !== "undefined" ? window : globalThis);
