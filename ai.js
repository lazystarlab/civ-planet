/*
 * ai.js — RIVAL CIVILIZATIONS. No DOM.
 * A deliberately simple but real AI that plays through the same rules as the
 * player: Tech.setResearch, Rules.setBuild, Rules.moveUnit, Rules.foundCity.
 * Rules.endTurn then resolves every civ the same way.
 *   - research and builds: weighted priorities shaped by the civ's traits
 *   - settlers: pick a decent site 3-7 hexes from home, travel, found
 *   - warriors: one garrison per city, the rest explore the nearest frontier
 * Per-unit plans (role, target, stuck) live on the unit, so they are saved.
 * Everything is deterministic (seeded hashes), so a reloaded game plays on
 * exactly as it would have.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Tech = root.PlanetTech;
  var Combat = root.PlanetCombat;
  var Diplo = root.PlanetDiplomacy;
  var Econ = root.PlanetEconomy;
  var Naval = root.PlanetNaval;
  var Ranged = root.PlanetRanged;
  var Happy = root.PlanetHappiness;
  var Roads = root.PlanetRoads;
  var Trade = root.PlanetTrade;
  var Deals = root.PlanetDeals;
  var Wonders = root.PlanetWonders;
  var Econ = root.PlanetEconomy;

  var TRAIT_TECH = {
    agrarian: { agriculture: 3, pottery: 2 },
    industrious: { mining: 3, masonry: 2, mathematics: 1 },
    seafaring: { sailing: 3, pottery: 1 },
    expansionist: { pottery: 2, the_wheel: 3 },
    militaristic: { bronze_working: 3, iron_working: 3, animal_husbandry: 1 },
    mercantile: { currency: 3, writing: 1 },
    nomadic: { animal_husbandry: 3, the_wheel: 2 },
    scholarly: { writing: 3, philosophy: 3 }
  };
  var TRAIT_BUILD = {
    agrarian: { granary: 2 }, industrious: { monument: 2 }, scholarly: { library: 3 },
    mercantile: { market: 3 }, militaristic: { warrior: 1, spearman: 2, swordsman: 2, horseman: 1 },
    expansionist: { settler: 3 }, nomadic: { horseman: 2 }, seafaring: {}
  };
  // Every land unit that can fight (eras.js adds many).
  var MILITARY = {};
  Object.keys(Rules.UNIT_TYPES).forEach(function (k) {
    var t = Rules.UNIT_TYPES[k];
    if (t.strength > 0 && !t.naval && !t.air && !t.caravan && !t.worker) MILITARY[k] = 1;
  });
  var Story = root.PlanetStory, Eras = root.PlanetEras;
  function hsh(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /*
   * Rivalry: reasons to want a war beyond plain attitude. Close borders, a
   * wonder both are building, a luxury they hold and we lack, clashing traits.
   */
  function rivalry(game, a, b) {
    var s = 0, why = [];
    if (Diplo.borderTension(game, a, b) <= -2) { s += 1; why.push("border"); }
    if (Diplo.affinity(game, a, b) < 0) { s += 1; why.push("ideology"); }
    if (power(game, a) >= power(game, b) * 1.8) { s += 1; why.push("weakness"); }
    if (Eras && Math.abs(Eras.eraOf(game, a) - Eras.eraOf(game, b)) >= 1) { s += 0.5; why.push("era gap"); }
    var mine = Rules.citiesOf(game, a).map(function (c) { return c.build; }).filter(function (x) { return x && Rules.BUILDS[x] && Rules.BUILDS[x].wonder; });
    if (Rules.citiesOf(game, b).some(function (c) { return mine.indexOf(c.build) !== -1; })) { s += 1; why.push("wonder"); }
    if (root.PlanetDeals) {
      var la = root.PlanetDeals.luxCopies(game, a), lb = root.PlanetDeals.luxCopies(game, b);
      if (Object.keys(lb).some(function (l) { return !la[l]; })) { s += 0.5; why.push("luxury"); }
    }
    return { s: s, why: why };
  }

  // ---- war helpers
  function enemies(game, cid) {
    var out = [];
    for (var i = 0; i < game.civs.length; i++) if (i !== cid && !game.civs[i].eliminated && Combat.atWar(game, cid, i)) out.push(i);
    return out;
  }
  function power(game, cid) { return Combat.militaryPower(game, cid) + 2 * Rules.citiesOf(game, cid).length; }
  function nearestCityDist(game, a, b) {
    var best = 99;
    Rules.citiesOf(game, a).forEach(function (x) {
      Rules.citiesOf(game, b).forEach(function (y) { best = Math.min(best, Rules.hexDistance(x.q, x.r, y.q, y.r)); });
    });
    return best;
  }
  function threatened(game, cid) {
    return enemies(game, cid).some(function (e) { return power(game, e) > power(game, cid) * 0.8; });
  }

  // Would AI civ `ai` accept peace with `other` now?
  function willPeace(game, ai, other) {
    var r = Diplo.rel(game, ai, other);
    if (!r || !r.war) return true;
    if (root.PlanetPeace) return root.PlanetPeace.evaluate(game, { from: other, to: ai, give: [], ask: [], pacts: ["peace"] }).verdict === "accept";
    return power(game, ai) <= power(game, other) * 1.2 || game.turn - r.warTurn >= 20;
  }

  /*
   * Declare war when clearly stronger, on bad terms and close enough; sue for
   * peace when clearly losing. Returns events for the player.
   */
  function warPolicy(game, cid, events) {
    var mine = power(game, cid);
    var militaristic = traits(game, cid).indexOf("militaristic") !== -1;
    var military = Rules.unitsOf(game, cid).filter(function (u) { return MILITARY[u.type]; }).length;
    Diplo.metCivs(game, cid).forEach(function (b) {
      if (game.civs[b].eliminated) return;
      var r = Diplo.rel(game, cid, b), theirs = power(game, b);
      if (!r.war) {
        // A recent peace holds for a generation (truce 10 turns, no new war for 30).
        if (root.PlanetPeace && root.PlanetPeace.sincePeace(game, cid, b) < 30) return;
        // Pacts hold unless relations are hostile and the odds overwhelming (then it breaks them).
        var pact = Diplo.pactOf(game, cid, b);
        if ((Diplo.napActive(game, cid, b) || pact.def || pact.ally) && !(r.att <= -6 && mine >= theirs * 2.5)) return;
        // Allies of the target count against us.
        Diplo.allies(game, b).forEach(function (x) { theirs += power(game, x) * 0.7; });
        // Ambition: a stronger civ with a rival grudge sometimes picks a fight even when relations look fine.
        var rv = rivalry(game, cid, b), ambitious = militaristic || traits(game, cid).indexOf("expansionist") !== -1;
        // Tension (slice 13): a standing rivalry with cool relations builds up
        // over the years; when it boils over and the odds look even, war.
        var PZ = root.PlanetPeace;
        if (PZ && game.turn >= 40 && military >= 4) {
          var ts = PZ.state(game).tension, tk = cid + ">" + b;
          ts[tk] = Math.max(0, (ts[tk] || 0) + (rv.s >= 0.5 && r.att <= 2 ? rv.s : -1));
          // Even odds after a long rivalry, or a grudge that outweighs the odds.
          var even = ts[tk] >= 30 && mine >= theirs * (ambitious ? 0.85 : 1);
          var grudge = ts[tk] >= 80 && r.att <= 0 && mine >= theirs * 0.45;
          if ((even || grudge) && !enemies(game, cid).length &&
              nearestCityDist(game, cid, b) <= 22 + 5 * (Eras ? Eras.eraOf(game, cid) : 0)) {
            var rt = Diplo.declareWar(game, cid, b);
            if (rt.ok) {
              ts[tk] = 0;
              Diplo.remember(game, cid, b, "rivalry", -2, "Rivalry (" + rv.why.join(", ") + ")");
              events.push({ kind: "war", text: rt.text + " (" + rv.why.join(", ") + ")", cid: b === 0 ? 0 : null });
              return;
            }
          }
        }
        if (game.turn >= 40 && military >= 4 && rv.s >= (ambitious ? 1 : 1.5) && mine >= theirs * (ambitious ? 1.2 : 1.35) + 2 && r.att <= (ambitious ? 5 : 3) &&
            nearestCityDist(game, cid, b) <= 16 + 4 * (Eras ? Eras.eraOf(game, cid) : 0) && !enemies(game, cid).length &&
            hsh(game.seed + "|war|" + game.turn + "|" + cid + "|" + b) % 6 === 0) {
          var rw = Diplo.declareWar(game, cid, b);
          if (rw.ok) {
            Diplo.remember(game, cid, b, "rivalry", -2, "Rivalry (" + rv.why.join(", ") + ")");
            events.push({ kind: "war", text: rw.text + " (" + rv.why.join(", ") + ")", cid: b === 0 ? 0 : null });
            return;
          }
        }
        if (game.turn >= 30 && military >= 3 && mine >= theirs * 1.5 + 3 && r.att <= (militaristic ? 1 : -2) &&
            nearestCityDist(game, cid, b) <= 18 && !enemies(game, cid).length) {
          var res = Diplo.declareWar(game, cid, b);
          if (res.ok) events.push({ kind: "war", text: res.text, cid: b === 0 ? 0 : null });
        }
      } else if (root.PlanetPeace) {
        // At war: peace through treaties (war score + weariness, peace.js).
        root.PlanetPeace.aiWar(game, cid, b, events);
      }
    });
  }

  // Best adjacent attack worth making, by previewed outcome.
  function bestAttack(game, u, cautious) {
    var best = null, bestScore = cautious ? 15 : 2;
    var rng = Ranged.isRanged(u.type) ? Ranged.rangeOf(u.type) + (u.promos && u.promos.indexOf("range") !== -1 ? 1 : 0) : 1;
    var cands = rng > 1 ? Rules.tilesInRadius(game, u.q, u.r, rng) : Rules.neighbours(game, game.index.get(Rules.key(u.q, u.r)));
    cands.forEach(function (t) {
      if (t.q === u.q && t.r === u.r) return;
      var pv = Combat.preview(game, u, t.q, t.r);
      if (!pv.ok) return;
      var s;
      if (pv.kind === "capture" || pv.kind === "settler") s = 100;
      else if (pv.kind === "unit") s = pv.expDealt - pv.expTaken * 0.8 + (pv.expDealt >= pv.defender.hp ? 30 : 0);
      else s = u.hp - pv.expTaken > 15 ? pv.expDealt - pv.expTaken * 0.35 + 8 + (pv.defender.hp <= 40 ? 15 : 0) : -1;
      s += jitter(game.turn, u.id, t.q * 100 + t.r) * 0.5;
      if (s > bestScore) { bestScore = s; best = t; }
    });
    return best;
  }

  // Head for the nearest enemy city: the tile next to it closest to us.
  function warTarget(game, u) {
    // Weakest reachable-looking city: distance plus defense (and damage counts).
    var best = null, bestS = Infinity, bestD = 99;
    enemies(game, u.owner).forEach(function (e) {
      Rules.citiesOf(game, e).forEach(function (c) {
        var d = Rules.hexDistance(u.q, u.r, c.q, c.r);
        if (d > 30) return;
        var sc = d + Combat.cityDefense(game, c).value * 0.8;
        if (sc < bestS) { bestS = sc; best = c; bestD = d; }
      });
    });
    if (!best) return null;
    if (bestD === 1) return { q: u.q, r: u.r, city: best.id };
    var adj = Rules.neighbours(game, game.index.get(Rules.key(best.q, best.r))).filter(function (t) {
      return Rules.unitMoveCost(game, u, t) !== Infinity && !game.cityAt.has(Rules.key(t.q, t.r));
    });
    adj.sort(function (a, b) { return Rules.hexDistance(u.q, u.r, a.q, a.r) - Rules.hexDistance(u.q, u.r, b.q, b.r) || a.q - b.q || a.r - b.r; });
    return adj[0] ? { q: adj[0].q, r: adj[0].r, city: best.id } : null;
  }

  function homeCity(game, u) {
    var best = null, bd = 99;
    Rules.citiesOf(game, u.owner).forEach(function (c) {
      var d = Rules.hexDistance(u.q, u.r, c.q, c.r);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }

  function actAtWar(game, u) {
    var hit = bestAttack(game, u, u.role === "garrison");
    if (hit) { Combat.attack(game, u.id, hit.q, hit.r); return true; }
    if (u.role === "garrison") return false;
    // Ranged units stay behind the melee line: hold when foes are within 2.
    if (Ranged.isRanged(u.type) && Ranged.enemyWithin(game, u, 2)) return true;
    if (u.hp < 40) {
      // Badly hurt: fall back to a nearby city, else hold still to heal (and fortify).
      var home = homeCity(game, u);
      if (home && Rules.hexDistance(u.q, u.r, home.q, home.r) <= 5 && !(u.q === home.q && u.r === home.r)) stepToward(game, u, home.q, home.r);
      return true;
    }
    var tgt = warTarget(game, u);
    if (!tgt) return false;
    if (Ranged.isRanged(u.type) && tgt.city != null) {
      var tc = Rules.cityById(game, tgt.city), so = tc && Ranged.standoff(game, u, tc);
      if (so) tgt = { q: so.q, r: so.r, city: tgt.city };
    }
    if (!(u.q === tgt.q && u.r === tgt.r)) stepToward(game, u, tgt.q, tgt.r);
    if (u.moves > 0) { var h2 = bestAttack(game, u, false); if (h2) Combat.attack(game, u.id, h2.q, h2.r); }
    return true;
  }
  var MAX_CITIES = 5;

  function jitter(a, b, c) {
    var h = 2166136261, s = a + ":" + b + ":" + c;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }
  function traits(game, cid) { var d = game.civs[cid].design; return (d && d.traits) || []; }
  function traitBonus(table, game, cid, key) {
    var s = 0;
    traits(game, cid).forEach(function (t) { s += (table[t] && table[t][key]) || 0; });
    return s;
  }

  // ---- research
  function chooseResearch(game, cid) {
    var best = null, bestScore = -1;
    Tech.available(game, cid).forEach(function (id) {
      var s = (1 + traitBonus(TRAIT_TECH, game, cid, id) + jitter(game.seed, cid, id) * 0.8) / Tech.TECHS[id].cost;
      if (s > bestScore) { bestScore = s; best = id; }
    });
    if (best) Tech.setResearch(game, best, cid);
    return best;
  }

  // ---- builds
  function chooseBuild(game, city) {
    var cid = city.owner;
    var cities = Rules.citiesOf(game, cid);
    var units = Rules.unitsOf(game, cid);
    var settlers = units.filter(function (u) { return u.type === "settler"; }).length +
      cities.filter(function (c) { return c.build === "settler"; }).length;
    var military = units.filter(function (u) { return MILITARY[u.type]; }).length;
    var war = threatened(game, cid) || enemies(game, cid).length > 0;
    var best = null, bestScore = 0;
    for (var key in Rules.BUILDS) {
      if (!Rules.canBuild(game, city, key)) continue;
      var b = Rules.BUILDS[key], s = 0;
      if (key === "worker") {
        var workers = units.filter(function (x) { return x.type === "worker"; }).length +
          cities.filter(function (c2) { return c2.build === "worker"; }).length;
        s = cities.length >= 2 && workers < Math.ceil(cities.length / 2) && !war ? 3.5 : 0;
      } else if (key === "temple" || key === "colosseum") {
        // Amenities only when needed: none at +4 or better.
        // Count amenities other cities are already building, so a dip doesn't
        // make every city start a Colosseum on the same turn.
        var hp = Happy.total(game, cid);
        cities.forEach(function (c2) { if (c2 !== city && Happy.BUILDING_HAPPY[c2.build]) hp += Happy.BUILDING_HAPPY[c2.build]; });
        s = hp <= 0 ? 7 : hp <= 2 ? 4 : 0;
      } else if (key === "missionary") {
        var RL = root.PlanetReligion, myRel = RL && RL.founded(game, cid);
        var targets = myRel ? game.cities.filter(function (x) { return x.rel !== myRel.id && Rules.hexDistance(x.q, x.r, city.q, city.r) <= 12; }).length : 0;
        var have = units.filter(function (x) { return x.type === "missionary"; }).length;
        s = !war && targets && have < 2 ? 4.2 + Math.min(2, targets / 3) : 0;
      } else if (key === "shrine") {
        s = root.PlanetReligion && root.PlanetReligion.slotsLeft(game) > 0 ? 3.2 : 1.5;
      } else if (key === "caravan") {
        s = !war && Trade.wantCaravan(game, cid) ? 3.2 : 0;
      } else if (b.unit && Rules.UNIT_TYPES[b.unit].air) {
        s = root.PlanetAir ? root.PlanetAir.buildScore(game, city, key) : 0;
      } else if (b.unit && Naval.isNaval(b.unit)) {
        s = war ? 0 : Naval.buildScore(game, city, key);
      } else if (key === "settler") {
        s = cities.length + settlers < MAX_CITIES && city.pop >= 2 ? 7 : 0;
        // Respect happiness: don't found a city that would make the civ unhappy.
        if (Happy.total(game, cid) - Happy.CITY_COST * (settlers + 1) < -1) s = 0;
      } else if (b.unit) {
        s = military < 1 + cities.length ? 4 : military < 2 * cities.length + 1 ? 1 : 0;
        if (war && military < 3 * cities.length + 2) s += 5;
        var ut = Rules.UNIT_TYPES[b.unit];
        s *= ((ut.ranged ? ut.ranged * 0.8 : ut.strength) || 1) / 8;
        if (ut.ranged) {
          // About one ranged unit per two melee.
          var nr = units.filter(function (x) { return Ranged.isRanged(x.type); }).length;
          if (nr * 2 >= military - nr) s *= 0.35;
        }
        // Peacetime garrison gaps (see defenseNeeds).
        var dg = defenseGap(game, cid);
        if (!war && ut.strength > 0 && !Naval.isNaval(b.unit) && (ut.ranged ? dg.ranged : dg.melee) > 0) s += 5;
      } else if (b.project) {
        s = war && !Eras.PROJECTS[b.project].space ? 0 : Eras.aiProjectScore(game, city, key);
      } else if (b.wonder) {
        s = war ? 0 : Wonders.aiScore(game, city, key);
      } else if (b.building) {
        s = 3;
        if (key === "walls") s = war ? 6 : 1;
      }
      if (s <= 0) continue;
      s += traitBonus(TRAIT_BUILD, game, cid, key) + jitter(game.turn, city.id, key);
      if (BUILD_ADJ.length) for (var ai2 = 0; ai2 < BUILD_ADJ.length; ai2++) s = BUILD_ADJ[ai2](game, city, key, s, war);
      if (s > bestScore) { bestScore = s; best = key; }
    }
    // Nothing worth building: stay idle (production is banked, up to a cap).
    Rules.setBuild(game, city.id, best);
    return best;
  }

  // ---- movement helpers
  // Step along a long path as far as this turn's reach allows.
  function stepToward(game, u, tq, tr) {
    if (u.q === tq && u.r === tr) return true;
    var path = Rules.longPath(game, u, tq, tr, 90);
    if (!path || path.length < 2) return false;
    var reach = Rules.reachable(game, u);
    for (var i = path.length - 1; i >= 1; i--) {
      var k = Rules.key(path[i].q, path[i].r);
      // Stacking (orders.js) may refuse a tile; try the next one back.
      if (reach.has(k) && Rules.moveUnit(game, u.id, path[i].q, path[i].r).ok) return true;
    }
    return false;
  }

  function moved(u, before) {
    if (u.q === before.q && u.r === before.r) u.stuck = (u.stuck || 0) + 1; else u.stuck = 0;
    if (u.stuck >= 3) { u.target = null; u.stuck = 0; }
  }

  // ---- settlers
  function pickSite(game, u) {
    var cid = u.owner, own = Rules.citiesOf(game, cid);
    var st = game.civs[cid].ai_state;
    if (!own.length && st && st.site) {
      var s0 = game.index.get(Rules.key(st.site.q, st.site.r));
      if (Rules.canFoundAt(game, cid, s0).ok) return { q: s0.q, r: s0.r };
    }
    var revealed = game.civs[cid].revealed, cands = [];
    // A civ without a port values a coastal site (ships need one).
    var wantPort = own.length >= 1 && !own.some(function (c) { return Naval.coastal(game, c); });
    var near = Rules.tilesInRadius(game, u.q, u.r, 9);
    for (var i = 0; i < near.length; i++) {
      var t = near[i];
      if (!revealed.has(Rules.key(t.q, t.r)) || !Rules.canFoundAt(game, cid, t).ok) continue;
      var dMin = 99, dAny = 99;
      for (var j = 0; j < game.cities.length; j++) {
        var c = game.cities[j], d = Rules.hexDistance(c.q, c.r, t.q, t.r);
        dAny = Math.min(dAny, d);
        if (c.owner === cid) dMin = Math.min(dMin, d);
      }
      if (dAny < 3 || (own.length && (dMin < 3 || dMin > 7))) continue;
      var score = Rules.siteScore(game, t, cid);
      if (score === -Infinity) continue;
      if (wantPort && Naval.coastal(game, t)) score += 15;
      cands.push({ t: t, s: score - 1.2 * Rules.hexDistance(u.q, u.r, t.q, t.r) + jitter(u.id, t.q, t.r) });
    }
    cands.sort(function (a, b) { return b.s - a.s; });
    for (i = 0; i < Math.min(5, cands.length); i++) {
      var tt = cands[i].t;
      if ((tt.q === u.q && tt.r === u.r) || Rules.longPath(game, u, tt.q, tt.r, 60)) return { q: tt.q, r: tt.r };
    }
    return null;
  }

  function actSettler(game, u) {
    if (u.target) {
      var tt = game.index.get(Rules.key(u.target.q, u.target.r));
      if (!Rules.canFoundAt(game, u.owner, tt).ok) u.target = null;
    }
    if (!u.target) u.target = pickSite(game, u);
    if (!u.target && Naval.canFerry(game, u.owner) && (u.ferryWait || 0) < 40 && Rules.citiesOf(game, u.owner).length) {
      // No land site left: wait at a port for a ship (naval.js picks it up).
      u.role = "ferry";   // ferryWait counts only failed searches by a ship (naval.js)
      var port = Naval.nearestPort(game, u);
      if (port && !(u.q === port.q && u.r === port.r)) stepToward(game, u, port.q, port.r);
      return;
    }
    if (u.role === "ferry") u.role = null;
    if (!u.target) {
      u.wait = (u.wait || 0) + 1;
      if (u.wait > 2 && Rules.canFoundCity(game, u.id).ok) Rules.foundCity(game, u.id);
      return;
    }
    var before = { q: u.q, r: u.r };
    stepToward(game, u, u.target.q, u.target.r);
    if (u.q === u.target.q && u.r === u.target.r) {
      if (Rules.canFoundCity(game, u.id).ok) { Rules.foundCity(game, u.id); return; }
      u.target = null;
    }
    moved(u, before);
  }

  // ---- workers: road to the nearest unconnected city, else farm/mine a worked tile.
  function workerGoal(game, u) {
    var cid = u.owner, cities = Rules.citiesOf(game, cid);
    var cap = cities.filter(function (c) { return c.capital; })[0];
    if (!cap) return null;
    // Roads only on planned routes (A* city -> capital), nearest gap first,
    // skipping gaps another worker already holds.
    var gaps = Roads.roadGaps(game, cid).filter(function (t) {
      return !game.units.some(function (o) { return o !== u && o.owner === cid && o.work && o.work.q === t.q && o.work.r === t.r; });
    }).sort(function (a, b) { return Rules.hexDistance(u.q, u.r, a.q, a.r) - Rules.hexDistance(u.q, u.r, b.q, b.r) || a.q - b.q || a.r - b.r; });
    if (gaps.length) return { q: gaps[0].q, r: gaps[0].r, job: "road" };
    var best = null, bd = 99;
    cities.forEach(function (c) {
      (c.worked || []).forEach(function (wk) {
        var t = game.index.get(wk);
        if (!t || (game.improvements || {})[wk] || game.cityAt.has(wk)) return;
        var job = t.biome === "hills" ? "mine" : (t.biome === "plains" || t.biome === "grassland" || t.biome === "desert" || t.biome === "tundra") ? "farm" : null;
        if (!job) return;
        var d = Rules.hexDistance(u.q, u.r, t.q, t.r);
        if (d < bd && !game.units.some(function (o) { return o !== u && o.work && o.work.q === t.q && o.work.r === t.r; })) { bd = d; best = { q: t.q, r: t.r, job: job }; }
      });
    });
    return best;
  }

  function workerThreat(game, u) {
    return game.units.some(function (o) {
      return o.owner !== u.owner && Combat.strengthOf(o.type) > 0 && Combat.atWar(game, u.owner, o.owner) && Rules.hexDistance(u.q, u.r, o.q, o.r) <= 2;
    });
  }
  function actWorker(game, u) {
    if (workerThreat(game, u)) {
      // Threatened: drop the job (progress stays on the tile) and run home.
      if (u.work) Roads.cancelWork(game, u.id);
      var home = homeCity(game, u);
      if (home) stepToward(game, u, home.q, home.r);
      return;
    }
    if (u.work) return;
    var g = (root.PlanetPillage && root.PlanetPillage.repairGoal(game, u)) || workerGoal(game, u);
    if (!g) return;
    if (!(u.q === g.q && u.r === g.r)) stepToward(game, u, g.q, g.r);
    if (u.q === g.q && u.r === g.r) Roads.startWork(game, u.id, g.job);
  }

  // ---- warriors
  /*
   * Peacetime defense: every city wants 1 melee garrison; border or coastal
   * cities also want 1 ranged. A threat adds 1 melee (and 1 ranged at the
   * border): a met rival with a bigger army whose city is within 12, or an
   * attitude of -3 or worse with a rival that close.
   */
  function defenseNeeds(game, cid) {
    var cache = game._defense || (Object.defineProperty(game, "_defense", { value: {}, writable: true, enumerable: false }), game._defense);
    var sig = game.turn + "|" + game.cities.length + "|" + game.units.length;
    if (cache[cid] && cache[cid].sig === sig) return cache[cid].v;
    var mine = power(game, cid), out = [];
    Rules.citiesOf(game, cid).forEach(function (c) {
      var border = false, threat = false;
      game.cities.forEach(function (o) {
        if (o.owner === cid) return;
        var d = Rules.hexDistance(c.q, c.r, o.q, o.r);
        if (d <= 10) border = true;
        if (d <= 12 && Diplo.met(game, cid, o.owner)) {
          var r = Diplo.rel(game, cid, o.owner);
          if (power(game, o.owner) > mine * 1.1 || (r && r.att <= -3)) threat = true;
        }
      });
      if (!border) border = Rules.tilesInRadius(game, c.q, c.r, 4).some(function (t) {
        var own = game.owner.get(Rules.key(t.q, t.r));
        return own != null && (Rules.cityById(game, own) || {}).owner !== cid;
      });
      var coastal = Naval.coastal(game, c);
      out.push({ city: c, melee: 1 + (threat ? 1 : 0), ranged: (border || coastal ? 1 : 0) + (threat && border ? 1 : 0), border: border, threat: threat });
    });
    cache[cid] = { sig: sig, v: out };
    return out;
  }
  function garrisonsAt(game, cid, c, except) {
    var n = { melee: 0, ranged: 0 };
    game.units.forEach(function (o) {
      if (o === except || o.owner !== cid || Combat.strengthOf(o.type) <= 0 || Naval.isNaval(o.type)) return;
      var assigned = o.role === "garrison" && o.target && o.target.q === c.q && o.target.r === c.r;
      var standing = o.role !== "explore" && o.q === c.q && o.r === c.r && !(o.role === "garrison" && o.target && (o.target.q !== c.q || o.target.r !== c.r));
      if (!assigned && !standing) return;
      n[Ranged.isRanged(o.type) ? "ranged" : "melee"]++;
    });
    return n;
  }
  // Missing garrisons across the empire: { melee, ranged }.
  function defenseGap(game, cid) {
    var gap = { melee: 0, ranged: 0 };
    defenseNeeds(game, cid).forEach(function (n) {
      var h = garrisonsAt(game, cid, n.city, null);
      gap.melee += Math.max(0, n.melee - h.melee);
      gap.ranged += Math.max(0, n.ranged - h.ranged);
    });
    return gap;
  }
  function garrisonNeed(game, u) {
    var cls = Ranged.isRanged(u.type) ? "ranged" : "melee";
    var needs = defenseNeeds(game, u.owner).slice().sort(function (a, b) {
      return Rules.hexDistance(u.q, u.r, a.city.q, a.city.r) - Rules.hexDistance(u.q, u.r, b.city.q, b.city.r);
    });
    for (var i = 0; i < needs.length; i++) {
      if (garrisonsAt(game, u.owner, needs[i].city, u)[cls] < needs[i][cls]) return needs[i].city;
    }
    return null;
  }

  function pickFrontier(game, u) {
    var cid = u.owner, revealed = game.civs[cid].revealed, cands = [];
    var home = Rules.citiesOf(game, cid)[0] || u;
    var area = Rules.tilesInRadius(game, u.q, u.r, 14);
    for (var i = 0; i < area.length; i++) {
      var t = area[i];
      if (!revealed.has(Rules.key(t.q, t.r)) || Rules.unitMoveCost(game, u, t) === Infinity) continue;
      var ns = Rules.neighbours(game, t), unknown = 0;
      for (var k = 0; k < ns.length; k++) if (!revealed.has(Rules.key(ns[k].q, ns[k].r))) unknown++;
      if (!unknown) continue;
      var d = Rules.hexDistance(u.q, u.r, t.q, t.r);
      if (d === 0) continue;
      cands.push({ t: t, s: -d + unknown * 0.5 + Rules.hexDistance(home.q, home.r, t.q, t.r) * 0.3 + jitter(u.id, t.q, t.r) * 4 });
    }
    cands.sort(function (a, b) { return b.s - a.s; });
    for (i = 0; i < Math.min(6, cands.length); i++) {
      if (Rules.longPath(game, u, cands[i].t.q, cands[i].t.r, 60)) return { q: cands[i].t.q, r: cands[i].t.r };
    }
    return null;
  }

  function actMilitary(game, u) {
    if (enemies(game, u.owner).length && actAtWar(game, u)) return;
    // Explorers are pulled back into empty garrison slots now and then.
    if (u.role === "explore" && game.turn % 8 === u.id % 8) {
      var gc = garrisonNeed(game, u);
      if (gc) { u.role = "garrison"; u.target = { q: gc.q, r: gc.r }; }
    }
    if (!u.role) {
      var c = garrisonNeed(game, u);
      if (c) { u.role = "garrison"; u.target = { q: c.q, r: c.r }; } else u.role = "explore";
    }
    if (u.role === "garrison") {
      if (u.target) stepToward(game, u, u.target.q, u.target.r);
      return;
    }
    if (Story && Story.aiAnomaly(game, u, stepToward)) return;
    if (u.target && u.q === u.target.q && u.r === u.target.r) u.target = null;
    if (u.target) {
      var t = game.index.get(Rules.key(u.target.q, u.target.r));
      if (game.civs[u.owner].revealed.has(Rules.key(t.q, t.r)) && !frontierStill(game, u, t)) u.target = null;
    }
    if (!u.target) u.target = pickFrontier(game, u);
    if (!u.target) { var g = garrisonNeed(game, u); if (g) { u.role = "garrison"; u.target = { q: g.q, r: g.r }; } return; }
    var before = { q: u.q, r: u.r };
    stepToward(game, u, u.target.q, u.target.r);
    moved(u, before);
  }

  function frontierStill(game, u, t) {
    var revealed = game.civs[u.owner].revealed, ns = Rules.neighbours(game, t);
    for (var i = 0; i < ns.length; i++) if (!revealed.has(Rules.key(ns[i].q, ns[i].r))) return true;
    return false;
  }

  /*
   * One civ's decisions for this turn. opts (all default true):
   * { research, builds, units }. The player's autoplay reuses this with cid 0.
   */
  function takeTurn(game, cid, opts) {
    // The autoplayed player takes peace when offered (a human would decide).
    if (game._autoPlayer && !game.civs[cid].ai) Diplo.metCivs(game, cid).forEach(function (o) {
      var r = Diplo.rel(game, cid, o);
      if (r && r.war && r.offer === o) Diplo.acceptPeace(game, cid, o);
    });
    opts = opts || {};
    var cv = game.civs[cid];
    var events = opts.events || [];
    if (cv.eliminated) return events;
    if (cv.ai) warPolicy(game, cid, events);
    if (Deals) Deals.aiTurn(game, cid);
    if (opts.research !== false && cv.tech && !cv.tech.current) chooseResearch(game, cid);
    if (opts.builds !== false) {
      if (Wonders.aiReview) Wonders.aiReview(game, cid, function (c) { chooseBuild(game, c); });
      Rules.citiesOf(game, cid).forEach(function (c) { if (c.build == null) chooseBuild(game, c); });
    }
    if (opts.units !== false) {
      Rules.unitsOf(game, cid).forEach(function (u) {
        if (!Rules.unitById(game, u.id) || u.moves <= 0) return;
        if (Rules.UNIT_TYPES[u.type].air) { if (root.PlanetAir) root.PlanetAir.aiUnit(game, u); return; }
        if (Naval.isNaval(u.type) || u.aboard != null || u.ferry != null) return;   // naval.js runs these
        if (u.type === "worker") { actWorker(game, u); return; }
        if (u.type === "missionary") return;   // religion.js walks missionaries
        if (u.type === "caravan") { Trade.aiCaravan(game, u, stepToward); return; }
        if (u.type === "settler") actSettler(game, u);
        else if (!UNIT_HOOKS.some(function (f) { return f(game, u); }) && !(root.PlanetPillage && root.PlanetPillage.aiUnit(game, u))) actMilitary(game, u);
      });
      Naval.aiTurn(game, cid, { stepToward: stepToward, bestAttack: bestAttack, jitter: jitter });
      // Upgrades and disbanding: navalai.js (garrison and front line first).
      if (root.PlanetNavalAI) root.PlanetNavalAI.aiUpgrades(game, cid);
      if (enemies(game, cid).length) Ranged.aiCityStrikes(game, cid);
    }
    if (opts.builds !== false) spendGold(game, cid);
    return events;
  }

  // Buy military at war, otherwise buy builds once comfortably rich.
  // Rich and nothing to rush: buy a tile (resources first), or court a neighbour with a gift.
  function spendSurplus(game, cid) {
    var cv = game.civs[cid], cs = Rules.citiesOf(game, cid);
    var reserve = 50 + 12 * cs.length;
    if (cv.gold >= 220 + reserve) {
      var best = null;
      cs.forEach(function (c) {
        Econ.buyableTiles(game, c).forEach(function (o) {
          var s = (o.tile.resource ? 30 : 0) + (Rules.isWater(o.tile) ? -5 : 0) - o.cost / 10;
          if (o.cost <= cv.gold - reserve && (!best || s > best.s)) best = { s: s, c: c, t: o.tile };
        });
      });
      if (best) Econ.buyTile(game, best.c.id, best.t.q, best.t.r);
    }
    if (cv.gold >= 400 && Deals) {
      var st = Deals.state(game);
      Diplo.metCivs(game, cid).forEach(function (b) {
        var r = Diplo.rel(game, cid, b);
        // Gifts appease: only to stronger neighbours we are not already friends with.
        if (r.war || r.att > 2 || r.att < -5 || game.civs[b].eliminated || game.civs[cid].gold < 400 || power(game, b) < power(game, cid)) return;
        if (game.turn - (st.last[cid + ">" + b + ":gift"] || -99) < 12) return;
        st.last[cid + ">" + b + ":gift"] = game.turn;
        Deals.execute(game, { from: cid, to: b, give: [{ t: "gold", n: Math.min(120, Math.floor(game.civs[cid].gold * 0.12)) }], ask: [], pacts: [] });
      });
    }
  }

  function spendGold(game, cid) {
    var war = enemies(game, cid).length > 0;
    spendSurplus(game, cid);
    Rules.citiesOf(game, cid).forEach(function (c) {
      if (c.build == null) return;
      var price = Econ.buyCost(game, c);
      if (!price) return;
      var b = Rules.BUILDS[c.build];
      var gold = game.civs[cid].gold;
      // Keep a reserve that grows with the empire; spend the rest on builds (not wonders).
      var reserve = 50 + 12 * Rules.citiesOf(game, cid).length;
      if (b.wonder) { if (!war && gold >= price + 3 * reserve && (!Wonders.aiMayBuy || Wonders.aiMayBuy(game, c))) Econ.buyBuild(game, c.id); return; }
      if ((war && b.unit && b.unit !== "settler" && gold >= price + 10) || (gold >= price + reserve && (b.building || !b.unit || war))) Econ.buyBuild(game, c.id);
    });
  }

  function takeTurns(game) {
    var events = [];
    for (var cid = 0; cid < game.civs.length; cid++) if (game.civs[cid].ai) takeTurn(game, cid, { events: events });
    return events;
  }

  // Build score adjusters from other modules: fn(game, city, key, score, war) -> score.
  var BUILD_ADJ = [];
  // Unit hooks from other modules: fn(game, u) -> true when it acted (slice 17: sieges).
  var UNIT_HOOKS = [];
  function addUnitHook(f) { UNIT_HOOKS.push(f); }
  function addBuildAdjust(f) { BUILD_ADJ.push(f); }
  root.PlanetAI = {
    addBuildAdjust: addBuildAdjust, addUnitHook: addUnitHook, bestAttack: bestAttack, stepToward: stepToward,
    takeTurn: takeTurn, takeTurns: takeTurns, defenseNeeds: defenseNeeds, defenseGap: defenseGap,
    chooseResearch: chooseResearch, chooseBuild: chooseBuild, willPeace: willPeace, power: power, rivalry: rivalry, nearestCityDist: nearestCityDist,
    TRAIT_TECH: TRAIT_TECH, TRAIT_BUILD: TRAIT_BUILD,
    helpers: function () { return { stepToward: stepToward, bestAttack: bestAttack, jitter: jitter }; }
  };
})(typeof window !== "undefined" ? window : globalThis);
