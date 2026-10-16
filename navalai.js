/*
 * navalai.js — SMARTER NAVAL AI AND UPGRADES (slice 15). No DOM.
 * Wraps PlanetNaval.buildScore and PlanetNaval.aiTurn:
 *  - fleet: warships wanted in proportion to coastal cities and enemy ships seen;
 *    a transport when an invasion needs one.
 *  - hunt: at war, idle warships chase visible enemy ships (transports first).
 *  - escort: a warship follows each transport on a mission while at war.
 *  - invasion (ship.inv on a transport): when the nearest enemy city is on
 *    another landmass, gather 2+ land units at a port, sail (escorted) to a
 *    drop tile next to the city, let warships bombard it, then land and attack.
 *    Phases: gather -> sail -> bombard -> land. Army units carry u.ferry.
 * Upgrades (aiUpgrades): systematically when gold allows (garrison and
 * front-line units first); when broke, disband hopelessly outdated units.
 * game.navalai = { stats: { invasions, landed, bombards, navalBattles, hunts, escorts, upgrades, disbanded } }.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Naval = root.PlanetNaval, Combat = root.PlanetCombat, Econ = root.PlanetEconomy;

  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function state(game) {
    var s = game.navalai || (game.navalai = {});
    if (!s.stats) s.stats = { invasions: 0, landed: 0, bombards: 0, navalBattles: 0, hunts: 0, escorts: 0, upgrades: 0, disbanded: 0 };
    return s;
  }
  function isWarship(type) { var t = T(type); return !!(t.naval && t.strength >= 10 && (t.cargo || 0) <= 2 && !t.airCap); }
  function isTransport(type) { var t = T(type); return !!(t.naval && (t.cargo || 0) >= 2); }
  function enemies(game, cid) {
    var D = root.PlanetDiplomacy;
    return game.civs.map(function (c, i) { return i; }).filter(function (i) { var r = D.rel(game, cid, i); return i !== cid && r && r.war && !game.civs[i].eliminated; });
  }
  function seen(game, cid, u) { return game.civs[cid].revealed.has(Rules.key(u.q, u.r)); }

  // ---- building
  var origScore = Naval.buildScore;
  Naval.buildScore = function (game, city, key) {
    var base = origScore.apply(this, arguments);
    var b = Rules.BUILDS[key], cid = city.owner;
    if (!b || !b.unit || !Naval.coastal(game, city)) return base;
    var ships = Naval.shipsOf(game, cid);
    var queued = Rules.citiesOf(game, cid).filter(function (c) { return c.build && Rules.BUILDS[c.build] && T(Rules.BUILDS[c.build].unit).naval; }).length;
    if (queued) return base;
    var war = enemies(game, cid);
    if (isWarship(b.unit)) {
      var coastal = Naval.ports(game, cid).length;
      var foeShips = game.units.filter(function (o) { return o.owner !== cid && T(o.type).naval && seen(game, cid, o) && war.indexOf(o.owner) !== -1; }).length;
      var want = Math.round(coastal * 0.6 + foeShips * 0.5 + (war.length ? 1 : 0));
      var have = ships.filter(function (s) { return isWarship(s.type); }).length;
      if (have >= want) return base;
      // Prefer the strongest warship available: score scales with strength.
      return Math.max(base, (war.length ? 4.2 : 3) + Math.min(1.5, T(b.unit).strength / 60));
    }
    if (isTransport(b.unit) && war.length && wantsInvasion(game, cid) && !ships.some(function (s) { return isTransport(s.type) && !s.mission && !s.inv; }))
      return Math.max(base, 4.5 + (T(b.unit).cargo || 0) / 10);
    return base;
  };

  // ---- invasion planning
  function homeLandmasses(game, cid) {
    var s = {};
    Rules.citiesOf(game, cid).forEach(function (c) { s[Naval.landmassOf(game, c.q, c.r)] = 1; });
    return s;
  }
  function overseasTarget(game, cid) {
    var home = homeLandmasses(game, cid), cap = Rules.citiesOf(game, cid).filter(function (c) { return c.capital; })[0] || Rules.citiesOf(game, cid)[0];
    if (!cap) return null;
    var best = null, bd = 99;
    enemies(game, cid).forEach(function (e) {
      Rules.citiesOf(game, e).forEach(function (c) {
        if (!game.civs[cid].revealed.has(Rules.key(c.q, c.r))) return;
        if (home[Naval.landmassOf(game, c.q, c.r)]) return;
        var d = Rules.hexDistance(cap.q, cap.r, c.q, c.r) + c.pop * 0.5;
        var lt = state(game).lastTarget; if (lt && lt[cid] === c.id) d -= 20;
        // Slice 17: soft targets first (no walls or capital guns, small garrison).
        if (root.PlanetRanged && root.PlanetRanged.cityCanStrike(game, c)) d += 10;
        d += 4 * game.units.filter(function (o) { return o.owner === c.owner && Combat.strengthOf(o.type) > 0 && !T(o.type).naval && Rules.hexDistance(o.q, o.r, c.q, c.r) <= 1; }).length;
        if (d < bd && d < 45 + 8 * Math.max(0, (root.PlanetEras ? root.PlanetEras.eraOf(game, cid) : 0) - 2)) { bd = d; best = c; }
      });
    });
    return best;
  }
  function wantsInvasion(game, cid) {
    // Overseas enemy city and no land-reachable enemy city.
    var t = overseasTarget(game, cid);
    if (!t) return false;
    // Go by sea unless an enemy city on our own landmass is clearly closer.
    var home = homeLandmasses(game, cid), cap = Rules.citiesOf(game, cid).filter(function (c) { return c.capital; })[0] || Rules.citiesOf(game, cid)[0];
    var landD = 99;
    enemies(game, cid).forEach(function (e) { Rules.citiesOf(game, e).forEach(function (c) { if (home[Naval.landmassOf(game, c.q, c.r)]) landD = Math.min(landD, Rules.hexDistance(cap.q, cap.r, c.q, c.r)); }); });
    return landD > 14 || landD > Rules.hexDistance(cap.q, cap.r, t.q, t.r) + 6;
  }
  function dropFor(game, ship, city, port) {
    var cands = [];
    // Slice 17: a city with guns (walls or capital) shoots 2 tiles: landing or
    // parking a transport inside that ring costs; a beach 3 out is preferred.
    var guns = root.PlanetRanged && root.PlanetRanged.cityCanStrike(game, city);
    var hot = function (t) { return guns && Rules.hexDistance(t.q, t.r, city.q, city.r) <= 2 ? 6 : 0; };
    Rules.neighbours(game, game.index.get(Rules.key(city.q, city.r))).forEach(function (land) {
      if (Rules.isWater(land) || Rules.moveCost(land) === Infinity) return;
      // Slice 17: never land onto enemy troops; prefer hills, forest, jungle beside the walls.
      if (game.units.some(function (o) { return o.q === land.q && o.r === land.r && o.owner !== ship.owner; })) return;
      var cover = land.biome === "hills" || land.biome === "forest" || land.biome === "jungle" ? 4 : 0;
      Rules.neighbours(game, land).forEach(function (w) {
        if (!Naval.canSail(ship.type, w)) return;
        cands.push({ w: w, land: land, d: Rules.hexDistance(w.q, w.r, port.q, port.r) - cover + hot(land) + hot(w) });
      });
    });
    // Also water right next to the city (bombard and land beside it).
    Rules.neighbours(game, game.index.get(Rules.key(city.q, city.r))).forEach(function (w) {
      // (slice 16: a weak transport parked next to the city gets sunk; only as a last resort.)
      if (Naval.canSail(ship.type, w)) cands.push({ w: w, land: null, d: Rules.hexDistance(w.q, w.r, port.q, port.r) + 6 });
    });
    // Slice 17: inland targets (diagnosed on marco: no sea tile within 2 of the
    // city, so no plan at all) - land on a beach within 4 tiles of it and march.
    if (!cands.length || guns) {
      var lm = Naval.landmassOf(game, city.q, city.r);
      Rules.tilesInRadius(game, city.q, city.r, 4).forEach(function (land) {
        if (Rules.hexDistance(land.q, land.r, city.q, city.r) <= 1) return;
        if (Rules.isWater(land) || Rules.moveCost(land) === Infinity || Naval.landmassOf(game, land.q, land.r) !== lm) return;
        if (game.cityAt.has(Rules.key(land.q, land.r)) || game.units.some(function (o) { return o.q === land.q && o.r === land.r && o.owner !== ship.owner; })) return;
        var cover = land.biome === "hills" || land.biome === "forest" || land.biome === "jungle" ? 2 : 0;
        Rules.neighbours(game, land).forEach(function (w) {
          if (!Naval.canSail(ship.type, w)) return;
          cands.push({ w: w, land: land, d: Rules.hexDistance(w.q, w.r, port.q, port.r) + 3 * (Rules.hexDistance(land.q, land.r, city.q, city.r) - 1) - cover + hot(land) + hot(w) });
        });
      });
    }
    // Slice 17: landing frontage - one military unit per land tile, so a
    // drop next to a single beach tile puts one unit ashore per turn (seen on
    // marco: waves trickled in one by one and were picked off).
    var lmC = Naval.landmassOf(game, city.q, city.r);
    cands.forEach(function (c) {
      var free = Rules.neighbours(game, c.w).filter(function (t) {
        return !Rules.isWater(t) && Rules.moveCost(t) !== Infinity && Naval.landmassOf(game, t.q, t.r) === lmC && !game.cityAt.has(Rules.key(t.q, t.r)) &&
          !game.units.some(function (o) { return o.q === t.q && o.r === t.r && o.aboard == null && Combat.strengthOf(o.type) > 0; });
      }).length;
      c.d -= 3 * Math.min(3, free);
    });
    cands.sort(function (a, b) { return a.d - b.d || a.w.q - b.w.q || a.w.r - b.w.r; });
    for (var i = 0; i < Math.min(5, cands.length); i++) {
      var probe = { q: port.q, r: port.r, owner: ship.owner, type: ship.type, moves: 1 };
      if (Rules.longPath(game, probe, cands[i].w.q, cands[i].w.r, 140)) return cands[i].w;
    }
    return null;
  }
  function planInvasion(game, cid, h) {
    if (game.turn % 3 !== cid % 3) return;
    var ships = Naval.shipsOf(game, cid);
    // Slice 17: up to two waves at sea at once.
    if (ships.filter(function (s) { return s.inv; }).length >= 2) return;
    if (!wantsInvasion(game, cid)) return;
    var target = overseasTarget(game, cid);
    // Transport + port: the port is reachable by the ship within ~50 tiles,
    // and close to the target.
    var trs = ships.filter(function (s) { return isTransport(s.type) && !s.mission && !s.inv && Rules.cargoOf(game, s).length === 0 && (!root.PlanetAIWar || root.PlanetAIWar.liftOK(game, s)); });
    // Slice 17: no unescorted landings into a fleet: wait for a warship.
    var foeFleet = enemies(game, cid).some(function (e) { return game.units.some(function (o) { return o.owner === e && isWarship(o.type); }); });
    if (foeFleet && !ships.some(function (s) { return isWarship(s.type) && !s.escortOf && !s.inv; })) { state(game).stats.noEscort = (state(game).stats.noEscort || 0) + 1; return; }
    var tr = null, port = null, drop = null;
    var ports = Naval.ports(game, cid).slice().sort(function (a, b) {
      return Rules.hexDistance(a.q, a.r, target.q, target.r) - Rules.hexDistance(b.q, b.r, target.q, target.r) || a.id - b.id;
    }).slice(0, 6);
    // Slice 17: stage at the port nearest the target that has a sea lane to a
    // landing site (diagnosed: the old 3-port/50-tile rule picked far ports and
    // the long voyage got the transport sunk); then the nearest transport that
    // can sail there, wherever it is.
    for (var pi = 0; pi < ports.length && !drop && trs.length; pi++) {
      // Drop sites depend on the hull: a trireme can't cross open ocean.
      var pp = ports[pi], best = null, bl = 999, bd = null, dropBy = {};
      trs.forEach(function (t) {
        var dk = dropBy[t.type] !== undefined ? dropBy[t.type] : (dropBy[t.type] = dropFor(game, t, target, pp));
        if (!dk) return;
        var here = t.q === pp.q && t.r === pp.r, path = here ? [pp] : Rules.longPath(game, t, pp.q, pp.r, 140);
        if (path && path.length < bl) { bl = path.length; best = t; bd = dk; }
      });
      if (best && bl <= 90) { tr = best; port = pp; drop = bd; }
    }
    if (!port) { state(game).stats.noStaging = (state(game).stats.noStaging || 0) + 1; return; }
    var cap = Math.min(Naval.capacity(tr.type), 6);
    var army = Rules.unitsOf(game, cid).filter(function (u) {
      return Combat.strengthOf(u.type) > 0 && !T(u.type).naval && !T(u.type).air && u.aboard == null && u.ferry == null && u.hp >= 70 &&
        u.role !== "garrison" && u.role !== "invade" && Naval.landmassOf(game, u.q, u.r) === Naval.landmassOf(game, port.q, port.r) && Rules.hexDistance(u.q, u.r, port.q, port.r) <= 20;
    }).sort(function (a, b) { return Combat.strengthOf(b.type) - Combat.strengthOf(a.type) || a.id - b.id; }).slice(0, cap);
    // Borrow one garrison if the army is too small and the city keeps another.
    if (army.length < Math.min(4, cap)) return;
    tr.inv = { phase: "gather", t: game.turn, city: target.id, port: { q: port.q, r: port.r }, drop: { q: drop.q, r: drop.r }, army: army.map(function (u) { return u.id; }), escort: null, bomb: 0 };
    army.forEach(function (u) { u.ferry = tr.id; u.role = "invade"; });
    var esc = ships.filter(function (s) { return isWarship(s.type) && !s.escortOf && !s.inv; }).sort(function (a, b) { return Rules.hexDistance(a.q, a.r, port.q, port.r) - Rules.hexDistance(b.q, b.r, port.q, port.r); })[0];
    if (esc) { esc.escortOf = tr.id; tr.inv.escort = esc.id; state(game).stats.escorts++; }
    state(game).stats.invasions++;
    // Slice 17: the next wave goes to the same city (two fleets can be at sea).
    var st0 = state(game); st0.lastTarget = st0.lastTarget || {}; st0.lastTarget[cid] = target.id;
    Rules.logEvent(game, "war", Rules.civName(game, cid) + " is preparing an invasion fleet against " + target.name, cid === 0 || target.owner === 0 ? 0 : null);
  }
  function release(game, tr) {
    var m = tr.inv, st = state(game);
    st.aborts = st.aborts || {};
    st.aborts[m.why || "landed"] = (st.aborts[m.why || "landed"] || 0) + 1;
    (m.army || []).forEach(function (id) { var u = Rules.unitById(game, id); if (u) { u.ferry = null; if (u.role === "invade") u.role = null; } });
    var e = m.escort != null ? Rules.unitById(game, m.escort) : null;
    if (e) e.escortOf = null;
    tr.inv = null;
  }
  function runInvasion(game, tr, h) {
    var m = tr.inv, st = state(game);
    var city = Rules.cityById(game, m.city);
    var army = m.army.map(function (id) { return Rules.unitById(game, id); }).filter(Boolean);
    if (!city || city.owner === tr.owner || !army.length || game.turn - m.t > 50 || !Combat.atWar(game, tr.owner, city.owner)) {
      m.why = !city ? "city gone" : city.owner === tr.owner ? "taken" : !army.length ? "army lost" : game.turn - m.t > 50 ? "timeout" : "peace";
      // Unload anyone still aboard at a port before releasing.
      if (Rules.cargoOf(game, tr).length) { var p = Naval.nearestPort(game, tr); if (p) h.stepToward(game, tr, p.q, p.r); }
      if (!Rules.cargoOf(game, tr).length) release(game, tr);
      return;
    }
    if (m.phase === "gather" && game.turn - m.t > 24 && !Rules.cargoOf(game, tr).length) { m.why = "gather"; m.t = -999; return; }
    if (m.phase === "gather") {
      if (!(tr.q === m.port.q && tr.r === m.port.r) && !(root.PlanetOrders && root.PlanetOrders.advance(game, tr, m.port.q, m.port.r))) h.stepToward(game, tr, m.port.q, m.port.r);
      army.forEach(function (u) { if (u.aboard == null && u.moves > 0 && !(u.q === m.port.q && u.r === m.port.r)) h.stepToward(game, u, m.port.q, m.port.r); });
      if (tr.q === m.port.q && tr.r === m.port.r) {
        army.forEach(function (u) { if (u.aboard !== tr.id && u.q === tr.q && u.r === tr.r) { u.moves = Math.max(u.moves, 1); Naval.board(game, u.id, tr.id); } });
        var aboard = army.filter(function (u) { return u.aboard === tr.id; });
        if (aboard.length === army.length || (aboard.length >= 2 && game.turn - m.t > 6) || (aboard.length >= 1 && game.turn - m.t > 12)) {
          army.forEach(function (u) { if (u.aboard !== tr.id) { u.ferry = null; u.role = null; } });
          m.army = aboard.map(function (u) { return u.id; });
          m.phase = "sail";
        }
      }
      return;
    }
    if (m.phase === "sail") {
      var before = tr.q + "," + tr.r;
      // Long voyages: the multi-turn pathfinder (orders.js), then the old step.
      var O = root.PlanetOrders;
      if (!(tr.q === m.drop.q && tr.r === m.drop.r) && !(O && O.advance(game, tr, m.drop.q, m.drop.r))) h.stepToward(game, tr, m.drop.q, m.drop.r);
      var arrived = tr.q === m.drop.q && tr.r === m.drop.r || Rules.hexDistance(tr.q, tr.r, m.drop.q, m.drop.r) <= 1 && before === tr.q + "," + tr.r;
      if (arrived) { m.phase = "bombard"; m.bomb = 0; }
      else if (before === tr.q + "," + tr.r) { m.stuck = (m.stuck || 0) + 1; if (m.stuck > 3) m.t = -999; }
      // Land on arrival: waiting under the walls gets the transport sunk by
      // the city strike (escorts keep bombarding meanwhile).
      if (!arrived) return;
      m.phase = "land";
    }
    if (m.phase === "bombard") {
      // Warships near the city shell it; the landing waits up to 2 turns or until HP <= 60.
      m.bomb++;
      if (city.hp <= 60 || m.bomb > 2 || !game.units.some(function (s) { return s.owner === tr.owner && isWarship(s.type) && Rules.hexDistance(s.q, s.r, city.q, city.r) <= 3; })) m.phase = "land";
      else return;
    }
    if (m.phase === "land") {
      army.forEach(function (u) { if (u.aboard === tr.id && u.moves <= 0) u.moves = 1; });
      Naval.unload(game, tr.id, { q: city.q, r: city.r });
      var ashore = army.filter(function (u) { return u.aboard == null && Rules.unitById(game, u.id); });
      if (ashore.length) {
        st.stats.landed++;
        Rules.logEvent(game, "war", Rules.civName(game, tr.owner) + " landed troops near " + city.name, tr.owner === 0 || city.owner === 0 ? 0 : null);
        Combat._internals.fx(game, { kind: "landing", q: tr.q, r: tr.r, owner: tr.owner });
        ashore.forEach(function (u) { u.ferry = null; u.role = null; u.target = null; u.siege = city.id; });
        st.lastTarget = st.lastTarget || {}; st.lastTarget[tr.owner] = city.id;
      }
      m.landTries = (m.landTries || 0) + 1;
      if (!Rules.cargoOf(game, tr).length || m.landTries > 3) {
        m.army = m.army.filter(function (id) { var u = Rules.unitById(game, id); return u && u.aboard === tr.id; });
        if (!m.army.length) release(game, tr);
      }
    }
  }

  // Warships: escort, bombard invasion targets, hunt enemy ships.
  // A free sea tile next to a city, nearest to the ship (ships can't path onto land).
  function shoreOf(game, s, city) {
    var ct = game.index.get(Rules.key(city.q, city.r));
    var w = Rules.neighbours(game, ct).filter(function (t) {
      return Rules.isWater(t) && !game.units.some(function (o) { return o !== s && o.q === t.q && o.r === t.r && o.aboard == null && T(o.type).naval; });
    }).sort(function (a, b) { return Rules.hexDistance(s.q, s.r, a.q, a.r) - Rules.hexDistance(s.q, s.r, b.q, b.r) || a.q - b.q || a.r - b.r; });
    return w[0] || city;
  }
  function runWarship(game, s, h) {
    var st = state(game);
    if (s.escortOf != null) {
      var tr = Rules.unitById(game, s.escortOf);
      if (!tr || !(tr.inv || tr.mission)) { s.escortOf = null; }
      else {
        var city = tr.inv ? Rules.cityById(game, tr.inv.city) : null;
        if (tr.inv && (tr.inv.phase === "bombard" || tr.inv.phase === "land") && city) {
          var pv = Combat.preview(game, s, city.q, city.r);
          if (pv.ok) { Combat.attack(game, s.id, city.q, city.r); st.stats.bombards++; return true; }
          var sh = shoreOf(game, s, city);
          h.stepToward(game, s, sh.q, sh.r);
          if (s.moves > 0 && Combat.preview(game, s, city.q, city.r).ok) { Combat.attack(game, s.id, city.q, city.r); st.stats.bombards++; }
          return true;
        }
        var hit0 = h.bestAttack(game, s, false);
        if (hit0) { Combat.attack(game, s.id, hit0.q, hit0.r); return true; }
        if (Rules.hexDistance(s.q, s.r, tr.q, tr.r) > 1) h.stepToward(game, s, tr.q, tr.r);
        return true;
      }
    }
    var war = enemies(game, s.owner);
    if (!war.length) return false;
    var hit = h.bestAttack(game, s, false);
    if (hit) { Combat.attack(game, s.id, hit.q, hit.r); return true; }
    var prey = null, pd = 15;
    game.units.forEach(function (o) {
      if (!T(o.type).naval || war.indexOf(o.owner) === -1 || !seen(game, s.owner, o)) return;
      var d = Rules.hexDistance(s.q, s.r, o.q, o.r) - (isTransport(o.type) ? 3 : 0) - (Rules.cargoOf(game, o).length ? 3 : 0);
      if (d < pd && Combat.strengthOf(s.type) * s.hp >= Combat.strengthOf(o.type) * o.hp * 0.8) { pd = d; prey = o; }
    });
    if (prey) {
      st.stats.hunts++;
      h.stepToward(game, s, prey.q, prey.r);
      if (s.moves > 0) { var h2 = h.bestAttack(game, s, false); if (h2) Combat.attack(game, s.id, h2.q, h2.r); }
      return true;
    }
    // Slice 17: support our sieges (troops landed by sea) by shelling that city.
    if (s.hp >= 50) {
      var sg = null, sd = 26;
      game.units.forEach(function (o) {
        if (o.owner !== s.owner || o.siege == null) return;
        var c = Rules.cityById(game, o.siege);
        if (!c || war.indexOf(c.owner) === -1 || !Naval.coastal(game, c)) return;
        var d = Rules.hexDistance(s.q, s.r, c.q, c.r);
        if (d < sd) { sd = d; sg = c; }
      });
      if (sg) {
        if (Combat.preview(game, s, sg.q, sg.r).ok) { Combat.attack(game, s.id, sg.q, sg.r); st.stats.bombards++; st.stats.siegeShell = (st.stats.siegeShell || 0) + 1; return true; }
        var sh3 = shoreOf(game, s, sg);
        h.stepToward(game, s, sh3.q, sh3.r);
        if (s.moves > 0 && Combat.preview(game, s, sg.q, sg.r).ok) { Combat.attack(game, s.id, sg.q, sg.r); st.stats.bombards++; st.stats.siegeShell = (st.stats.siegeShell || 0) + 1; }
        return true;
      }
    }
    // Bombard an enemy coastal city in reach when healthy.
    if (s.hp >= 70) {
      var tgt = null, td = 10;
      game.cities.forEach(function (c) {
        if (war.indexOf(c.owner) === -1 || !Naval.coastal(game, c) || !game.civs[s.owner].revealed.has(Rules.key(c.q, c.r))) return;
        var d = Rules.hexDistance(s.q, s.r, c.q, c.r);
        if (d < td) { td = d; tgt = c; }
      });
      if (tgt) {
        var sh2 = shoreOf(game, s, tgt);
        h.stepToward(game, s, sh2.q, sh2.r);
        if (s.moves > 0 && Combat.preview(game, s, tgt.q, tgt.r).ok) { Combat.attack(game, s.id, tgt.q, tgt.r); st.stats.bombards++; }
        return true;
      }
    }
    return false;
  }

  var origTurn = Naval.aiTurn;
  Naval.aiTurn = function (game, cid, h) {
    planInvasion(game, cid, h);
    var war = enemies(game, cid).length > 0;
    Naval.shipsOf(game, cid).forEach(function (s) {
      if (!Rules.unitById(game, s.id) || s.moves <= 0) return;
      if (s.inv) { runInvasion(game, s, h); s.moves = 0; return; }
      if (isWarship(s.type) && !s.mission && Rules.cargoOf(game, s).length === 0 && war) {
        // Escort settler ferries in wartime too.
        if (s.escortOf == null) {
          var ferry = Naval.shipsOf(game, cid).filter(function (t) { return t.mission && !Naval.shipsOf(game, cid).some(function (e) { return e.escortOf === t.id; }); })[0];
          if (ferry) { s.escortOf = ferry.id; state(game).stats.escorts++; }
        }
        if (runWarship(game, s, h)) s.moves = 0;
      }
    });
    // Army units waiting for an invasion transport are driven by runInvasion.
    return origTurn.apply(this, arguments);
  };

  // Count ship-vs-ship battles.
  var origAttack = Combat.attack;
  Combat.attack = function (game, unitId, q, r) {
    var u = Rules.unitById(game, unitId);
    var naval = u && T(u.type).naval && game.units.some(function (o) { return o.q === q && o.r === r && o.owner !== u.owner && T(o.type).naval; });
    var res = origAttack.apply(this, arguments);
    if (naval && res && res.ok) state(game).stats.navalBattles++;
    return res;
  };

  // ---- upgrades and disbanding
  function frontline(game, u) {
    return game.units.some(function (o) { return o.owner !== u.owner && Combat.atWar(game, u.owner, o.owner) && Rules.hexDistance(o.q, o.r, u.q, u.r) <= 6; });
  }
  function aiUpgrades(game, cid) {
    var cv = game.civs[cid], st = state(game), cs = Rules.citiesOf(game, cid).length;
    var reserve = 30 + 5 * cs;
    var list = Rules.unitsOf(game, cid).filter(function (x) {
      var o = game.owner.get(Rules.key(x.q, x.r));
      var up = Econ.upgradeTarget(game, x);
      if (!up || x.inv || x.escortOf != null || x.aboard != null) return false;
      // Never upgrade the last transports into warships without cargo room.
      if (isTransport(x.type) && !isTransport(typeof up === "string" ? up : up.type || up.id)) return false;
      return o != null && (Rules.cityById(game, o) || {}).owner === cid;
    }).sort(function (a, b) {
      var pa = (a.role === "garrison" ? 0 : frontline(game, a) ? 1 : 2), pb = (b.role === "garrison" ? 0 : frontline(game, b) ? 1 : 2);
      return pa - pb || Combat.strengthOf(a.type) - Combat.strengthOf(b.type) || a.id - b.id;
    });
    for (var i = 0; i < list.length && i < 6; i++) {
      var cost = Econ.upgradeCost(game, list[i]);
      if (cost == null || cv.gold < cost + reserve) break;
      if (Econ.upgrade(game, list[i].id).ok) st.stats.upgrades++;
    }
    // Broke: disband the most outdated unit (under a third of the best we can build).
    if (cv.gold < 15 && Econ.netGold(game, cid) < 0) {
      var best = 0;
      Object.keys(Rules.BUILDS).forEach(function (k) {
        var b = Rules.BUILDS[k];
        if (b.unit && (!b.tech || Rules.hasTech(game, b.tech, cid)) && !T(b.unit).naval && !T(b.unit).air) best = Math.max(best, Combat.strengthOf(b.unit));
      });
      var junk = Rules.unitsOf(game, cid).filter(function (x) { return Combat.strengthOf(x.type) > 0 && Combat.strengthOf(x.type) < best / 3 && x.aboard == null && x.role !== "garrison"; })
        .sort(function (a, b) { return Combat.strengthOf(a.type) - Combat.strengthOf(b.type) || a.id - b.id; })[0];
      if (junk) {
        Rules.removeUnit(game, junk); st.stats.disbanded++;
        if (cid === 0) Rules.logEvent(game, "info", "Disbanded an outdated " + T(junk.type).name + " to save upkeep", 0);
      }
    }
  }

  function invading(game, cid, foe) {
    return game.units.some(function (s) {
      if (s.owner !== cid) return false;
      // Slice 17: troops ashore laying siege count too (no peace with the walls cracking).
      if (s.siege != null && !s.inv) { var sc = Rules.cityById(game, s.siege); return !!(sc && sc.owner === foe && sc.hp < 70); }
      if (!s.inv) return false;
      var c = Rules.cityById(game, s.inv.city);
      return c && c.owner === foe && game.turn - s.inv.t < 50;
    });
  }

  Rules.registerPlugin({ world: { init: function (g) { state(g); } } });

  root.PlanetNavalAI = {
    state: state, invading: invading, isWarship: isWarship, isTransport: isTransport, overseasTarget: overseasTarget, wantsInvasion: wantsInvasion, dropFor: dropFor,
    planInvasion: planInvasion, runInvasion: runInvasion, runWarship: runWarship, aiUpgrades: aiUpgrades, dropFor: dropFor
  };
})(typeof window !== "undefined" ? window : globalThis);
