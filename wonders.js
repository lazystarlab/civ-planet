/*
 * wonders.js — WORLD WONDERS, NEW BUILDINGS, POP CAP, VETERANS. No DOM.
 *
 * Buildings (tech-gated, registered into PlanetGame.BUILDS):
 *   Barracks (Bronze Working, 35): land units trained here are veterans (+20% strength)
 *   Harbor (Sailing, 45, coastal): +1 food per worked water tile, +1 trade route slot
 *   Forge (Iron Working, 50): +15% production (at least +1)
 *   Aqueduct (Engineering, 60): raises the pop cap to 16
 *   Amphitheater (Literature, 45): +2 happiness
 * Pop cap: a city stops growing at 8 pop, 12 with fresh water (a river on or
 * next to the city tile), 16 with an Aqueduct. Food still piles up (to the
 * growth threshold); cities above the cap (old saves) don't shrink.
 *
 * Wonders: one per world. game.wonders = { id: { civ, city, turn } }.
 * A civ can build each in one city at a time. When a civ completes one, every
 * other city building it converts its stored production into gold, with an event.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Tech = root.PlanetTech;
  var Happy = root.PlanetHappiness;

  var BUILDINGS = {
    barracks:    { name: "Barracks",    cost: 35, building: "barracks",    minPop: 1, popCost: 0, tech: "bronze_working", note: "land units start with 10 XP (a promotion)" },
    harbor:      { name: "Harbor",      cost: 45, building: "harbor",      minPop: 1, popCost: 0, tech: "sailing",        note: "+1 food on water tiles, +1 route", coastal: true },
    forge:       { name: "Forge",       cost: 50, building: "forge",       minPop: 2, popCost: 0, tech: "iron_working",   note: "+15% production" },
    aqueduct:    { name: "Aqueduct",    cost: 60, building: "aqueduct",    minPop: 4, popCost: 0, tech: "engineering",    note: "pop cap 16" },
    amphitheater:{ name: "Amphitheater", cost: 45, building: "amphitheater", minPop: 2, popCost: 0, tech: "literature",   note: "+2 happiness" }
  };
  Object.keys(BUILDINGS).forEach(function (k) { Rules.BUILDS[k] = BUILDINGS[k]; });
  Happy.BUILDING_HAPPY.amphitheater = 2;

  var WONDERS = {
    pyramids:          { name: "Pyramids",          cost: 140, tech: "masonry",        effect: "Buildings cost 25% less in all your cities",
      flavor: "Raised stone by stone over a generation, they will outlast the names of those who raised them." },
    stonehenge:        { name: "Stonehenge",        cost: 110, tech: "mysticism",      effect: "+1 happiness per city",
      flavor: "The stones count the seasons, and the people gather to watch the sun return." },
    oracle:            { name: "Oracle",            cost: 130, tech: "mysticism",      effect: "A free technology (your current research)",
      flavor: "In the smoke of the sanctum, the priestess speaks of things not yet discovered." },
    colossus:          { name: "Colossus",          cost: 130, tech: "bronze_working", effect: "+1 gold per worked water tile in its city", coastal: true,
      flavor: "A bronze giant astride the harbour; every ship that passes beneath it pays its respects." },
    great_lighthouse:  { name: "Great Lighthouse",  cost: 120, tech: "sailing",        effect: "+1 move for your ships", coastal: true,
      flavor: "Its fire is seen from a day's sail away, and no captain fears the night." },
    hanging_gardens:   { name: "Hanging Gardens",   cost: 150, tech: "mathematics",    effect: "+1 food in every city",
      flavor: "Terraces of green climb toward the sky, watered by a hundred hidden channels." },
    temple_of_artemis: { name: "Temple of Artemis", cost: 160, tech: "philosophy",     effect: "Each Temple gives +2 more happiness",
      flavor: "Marble columns rise like a forest, and pilgrims come from every shore." },
    great_library:     { name: "Great Library",     cost: 190, tech: "literature",     effect: "Gain any tech known by 2 civs you have met (one a turn)",
      flavor: "Every scroll that enters the harbour is copied before it may leave." },
    terracotta_army:   { name: "Terracotta Army",   cost: 180, tech: "engineering",    effect: "A free veteran melee unit in every city",
      flavor: "Thousands of clay soldiers stand in silent ranks, each face unlike the next." }
  };
  var ORDER = Object.keys(WONDERS);
  ORDER.forEach(function (id) {
    var w = WONDERS[id];
    Rules.BUILDS["w_" + id] = { name: w.name, cost: w.cost, building: "w_" + id, minPop: 1, popCost: 0, tech: w.tech, note: "Wonder: " + w.effect, wonder: id, coastal: !!w.coastal };
    var t = Tech.TECHS[w.tech];
    if (t && t.effect.indexOf(w.name) === -1 && w.tech !== "mysticism" && w.tech !== "literature" && w.tech !== "engineering") t.effect += " · " + w.name;
  });
  Object.keys(BUILDINGS).forEach(function (k) {
    var t = Tech.TECHS[BUILDINGS[k].tech];
    if (t && t.effect.indexOf(BUILDINGS[k].name) === -1) t.effect += " · " + BUILDINGS[k].name;
  });

  function wonderOf(build) { var b = Rules.BUILDS[build]; return b && b.wonder ? b.wonder : null; }
  function registry(game) { return game.wonders || (game.wonders = {}); }
  function owned(game, cid, id) { var w = registry(game)[id]; return !!(w && w.civ === cid); }
  function has(c, b) { return (c.buildings || []).indexOf(b) !== -1; }
  function wondersIn(c) { return (c.buildings || []).filter(function (b) { return b.indexOf("w_") === 0; }).map(function (b) { return b.slice(2); }); }

  function freshWater(game, c) {
    var t = game.index.get(Rules.key(c.q, c.r));
    if (t.river > 0) return true;
    return Rules.neighbours(game, t).some(function (n) { return n.river > 0; });
  }
  function popCap(game, c) {
    var hosp = has(c, "hospital") ? 8 : 0;   // eras.js
    if (has(c, "aqueduct")) return 16 + hosp;
    return (freshWater(game, c) ? 12 : 8) + hosp;
  }
  // Later wonders (eras.js): registered the same way; their effects live where they are defined.
  function addWonder(id, w) {
    WONDERS[id] = w; ORDER.push(id);
    Rules.BUILDS["w_" + id] = { name: w.name, cost: w.cost, building: "w_" + id, minPop: 1, popCost: 0, tech: w.tech, note: "Wonder: " + w.effect, wonder: id, coastal: !!w.coastal };
  }
  function coastal(game, c) { return root.PlanetNaval ? root.PlanetNaval.coastal(game, c) : false; }
  function workedWater(game, c) {
    return (c.worked || []).filter(function (k) { var t = game.index.get(k); return t && Rules.isWater(t); }).length;
  }

  // Wonders being built, by civ: [{ id, city, civ, prod, cost }].
  function inProgress(game) {
    var out = [];
    game.cities.forEach(function (c) {
      var id = wonderOf(c.build);
      if (id) out.push({ id: id, city: c, civ: c.owner, prod: c.prod, cost: Rules.buildCost(game, c.build, c.owner) });
    });
    return out;
  }

  // Register a completed wonder; convert everyone else's production on it.
  function complete(game, c, id, events) {
    var w = WONDERS[id];
    registry(game)[id] = { civ: c.owner, city: c.id, turn: game.turn };
    var who = Rules.civName(game, c.owner);
    var text = w.name + " completed in " + c.name;
    if (c.owner === 0) events.push({ kind: "wonder", text: text + "! " + w.effect, city: c.id, wonder: id, cid: 0 });
    else {
      var known = root.PlanetDiplomacy && root.PlanetDiplomacy.met(game, 0, c.owner);
      Rules.logEvent(game, "wonder", w.name + " was completed by " + (known ? who : "a distant civilization"), 0);
    }
    game.cities.forEach(function (o) {
      if (o === c || wonderOf(o.build) !== id) return;
      var gold = Math.floor(o.prod);
      game.civs[o.owner].gold += gold;
      o.prod = 0; o.build = null; stats(game).lost++;
      var lost = who + " completed the " + w.name + " first: " + o.name + "'s " + gold + " production became " + gold + " gold";
      Rules.logEvent(game, "wonder", lost, o.owner === 0 ? 0 : null);
      if (o.owner === 0) { var gs = game._wonderLost || []; gs.push({ id: id, city: o.id, gold: gold, by: c.owner }); Object.defineProperty(game, "_wonderLost", { value: gs, writable: true, configurable: true, enumerable: false }); }
    });
    // On-completion effects.
    if (id === "oracle") {
      var t = Tech.ensure(game, c.owner);
      var pick = t.current || Tech.available(game, c.owner).sort(function (a, b) { return Tech.TECHS[b].cost - Tech.TECHS[a].cost; })[0];
      if (pick) Tech.grant(game, c.owner, pick, c.owner === 0 ? events : null);
    }
    if (id === "terracotta_army") {
      var best = ["swordsman", "spearman", "warrior"].filter(function (u) { var b = Rules.BUILDS[u]; return !b || !b.tech || Rules.hasTech(game, b.tech, c.owner); })[0] || "warrior";
      Rules.citiesOf(game, c.owner).forEach(function (cc) { var u = Rules.addUnit(game, best, cc.q, cc.r, c.owner); u.xp = 10; u.home = cc.id; });
    }
  }

  // ---- AI wonder policy (slice 14)
  // Affinity tags: a civ strongly prefers wonders that match its traits and
  // mostly ignores the rest unless they are cheap for it.
  var AFFINITY = {
    pyramids: ["industrious", "expansionist"], stonehenge: ["agrarian", "nomadic"], oracle: ["scholarly", "nomadic"],
    colossus: ["seafaring", "mercantile"], great_lighthouse: ["seafaring"], hanging_gardens: ["agrarian"],
    temple_of_artemis: ["nomadic", "agrarian"], great_library: ["scholarly"], terracotta_army: ["militaristic"],
    notre_dame: ["agrarian", "expansionist"], sistine_chapel: ["mercantile", "scholarly"], leonardos_workshop: ["industrious", "militaristic"],
    eiffel_tower: ["mercantile", "expansionist"], hoover_dam: ["industrious"], internet: ["scholarly"],
    apollo_program: ["scholarly", "industrious", "seafaring"]
  };
  function traitsOf(game, cid) { var c = game.civs[cid]; return (c && c.design && c.design.traits) || []; }
  function affinity(game, cid, id) {
    var tags = AFFINITY[id] || [];
    return traitsOf(game, cid).filter(function (t) { return tags.indexOf(t) !== -1; }).length;
  }
  function ownedCount(game, cid) {
    var r = registry(game);
    return Object.keys(r).filter(function (k) { return r[k].civ === cid; }).length;
  }
  // Wonders held relative to a fair share among living civs.
  function excess(game, cid) {
    var alive = game.civs.filter(function (c, i) { return Rules.citiesOf(game, i).length > 0; }).length || 1;
    var total = Object.keys(registry(game)).length;
    return ownedCount(game, cid) - total / alive;
  }
  function cityProd(game, c) { return Math.max(1, Rules.cityYield(game, c).prod || 1); }
  function knows(game, cid, other) {
    if (cid === other) return true;
    var D = root.PlanetDiplomacy;
    return !D || D.met(game, cid, other);
  }
  // Turns for each known racer to finish wonder `id`; returns {mine, rival}.
  function race(game, city, key) {
    var id = wonderOf(key), cid = city.owner;
    var cost = Rules.buildCost(game, key, cid);
    var mine = Math.max(0, cost - (city.prod || 0)) / cityProd(game, city);
    var rival = Infinity, who = null;
    inProgress(game).forEach(function (p) {
      if (p.id !== id || p.civ === cid || !knows(game, cid, p.civ)) return;
      var t = Math.max(0, p.cost - p.prod) / cityProd(game, p.city);
      if (t < rival) { rival = t; who = p.civ; }
    });
    return { mine: mine, rival: rival, who: who };
  }
  function losing(r) { return r.rival < Infinity && r.rival + 2 < r.mine * 0.85; }

  function aiScore(game, city, key) {
    var id = wonderOf(key);
    if (!id || city._noWonder === key) return 0;
    var cid = city.owner, cs = Rules.citiesOf(game, cid);
    if (game.turn < 15 || cs.length < 2) return 0;
    var mineIP = inProgress(game).filter(function (p) { return p.civ === cid && p.city !== city; });
    // Best producer builds wonders; a big empire may run a second one in its
    // next-best city, but only for an affinity wonder.
    var byProd = cs.slice().sort(function (a, b) { return cityProd(game, b) - cityProd(game, a) || a.id - b.id; });
    var rank = byProd.indexOf(city);
    var aff = affinity(game, cid, id);
    if (rank > 1 || mineIP.length > 1) return 0;
    if (rank === 1 && (mineIP.length === 0 || cs.length < 5 || !aff)) return 0;
    if (rank === 0 && mineIP.length && mineIP[0].city !== byProd[1]) return 0;
    var cost = Rules.buildCost(game, key, cid);
    var turns = Math.max(0, cost - (city.prod || 0)) / cityProd(game, city);
    var s;
    if (aff) s = 4.2 + 1.2 * (aff - 1);
    else if (turns <= 12) s = 2.2; // cheap for us: worth a look
    else if (turns <= 22) s = 0.9;
    else return 0;
    // Steep diminishing interest per wonder owned, harsher above fair share.
    var have = ownedCount(game, cid), ex = excess(game, cid);
    s -= 0.7 * have + Math.max(0, ex) * 1.4;
    if (!have) s += 0.8; // a first wonder is a point of national pride
    s += Math.min(1.5, (Tech.TECHS[Rules.BUILDS[key].tech].era || 0) * 0.3);
    // Race awareness: don't start races we expect to lose.
    if (losing(race(game, city, key))) return 0;
    return s;
  }

  // Each AI turn: abandon races it is likely to lose. Production stays in the
  // city (city.prod is untouched) and carries into whatever is picked next.
  function aiReview(game, cid, rechoose) {
    Rules.citiesOf(game, cid).forEach(function (c) {
      if (!wonderOf(c.build)) return;
      var r = race(game, c, c.build);
      if (!losing(r)) return;
      var from = c.build;
      c.build = null;
      var st = stats(game);
      st.conversions = (st.conversions || 0) + 1;
      st.byCiv[cid] = (st.byCiv[cid] || 0) + 1;
      // Don't immediately re-pick the same wonder.
      c._noWonder = from;
      rechoose(c);
      delete c._noWonder;
      if (cid === 0 || (root.PlanetDiplomacy && root.PlanetDiplomacy.met(game, 0, cid)))
        Rules.logEvent(game, "wonder", c.name + " abandoned the race for the " + WONDERS[wonderOf(from)].name + "; its " + Math.floor(c.prod) + " production goes to " + (c.build ? (Rules.BUILDS[c.build].name || c.build) : "reserves"), cid === 0 ? 0 : null);
    });
  }
  // Session-only metrics (not saved).
  function stats(game) {
    if (!game._wonderStats) Object.defineProperty(game, "_wonderStats", { value: { conversions: 0, byCiv: {}, lost: 0 }, writable: true, configurable: true, enumerable: false });
    return game._wonderStats;
  }
  // Should the AI spend gold on finishing this wonder?
  function aiMayBuy(game, city) {
    var id = wonderOf(city.build);
    if (!id) return false;
    return affinity(game, city.owner, id) > 0 && excess(game, city.owner) < 1 && !losing(race(game, city, city.build)) ? true : false;
  }

  function makeModifiers(game, cid) {
    return {
      canBuild: function (build, city) {
        var b = Rules.BUILDS[build];
        if (!b || !city) return true;
        if (b.coastal && !coastal(game, city)) return false;
        var id = b.wonder;
        if (!id) return true;
        if (registry(game)[id]) return false;
        // One city per civ on each wonder.
        return !game.cities.some(function (o) { return o !== city && o.owner === city.owner && o.build === build; });
      },
      buildCost: function (build, cost) {
        var b = Rules.BUILDS[build];
        if (b && b.building && !b.wonder && owned(game, cid, "pyramids")) return Math.round(cost * 0.75);
        return cost;
      },
      unitMoves: function (type, moves) {
        return root.PlanetNaval && root.PlanetNaval.isNaval(type) && owned(game, cid, "great_lighthouse") ? moves + 1 : moves;
      },
      growthNeed: function (pop, need, info) {
        if (info && info.city && pop >= popCap(game, info.city)) return Infinity;
        return need;
      },
      cityYield: function (c, y) {
        if (has(c, "harbor")) y.food += workedWater(game, c);
        if (has(c, "forge")) y.prod += Math.max(1, Math.floor(y.prod * 0.15));
        if (owned(game, cid, "hanging_gardens")) y.food += 1;
        if (has(c, "w_colossus")) y.gold += workedWater(game, c);
        return y;
      },
      onEndTurn: function (g, events, sci, c) {
        Rules.citiesOf(g, c).forEach(function (city) {
          wondersIn(city).forEach(function (id) {
            var w = registry(g)[id];
            if (!w) complete(g, city, id, events);
            else if (w.city !== city.id) {
              // Completed the same turn as someone earlier in the turn order.
              city.buildings = city.buildings.filter(function (b) { return b !== "w_" + id; });
              g.civs[c].gold += WONDERS[id].cost;
            }
          });
        });
        // Veterans: land military units trained in a city with Barracks.
        g.units.forEach(function (u) {
          if (u.owner !== c || u.xp !== undefined) return;
          var home = u.home != null ? Rules.cityById(g, u.home) : null;
          var ut = Rules.UNIT_TYPES[u.type];
          // Slice 15: Barracks give starting XP (enough for one promotion) instead of the old veteran flag.
          u.xp = home && has(home, "barracks") && ut.strength > 0 && !ut.air && !(root.PlanetNaval && root.PlanetNaval.isNaval(u.type)) ? 10 : 0;
        });
        // Great Library: one tech a turn that 2+ met civs know.
        if (owned(g, c, "great_library") && root.PlanetDiplomacy) {
          var metc = root.PlanetDiplomacy.metCivs(g, c);
          var cand = Tech.TECH_ORDER.filter(function (id) {
            if (Tech.has(g, id, c)) return false;
            return metc.filter(function (o) { return Tech.has(g, id, o); }).length >= 2;
          })[0];
          if (cand) { Tech.grant(g, c, cand, events); if (c !== 0) events.pop(); }
        }
      }
    };
  }

  // Happiness rows: Stonehenge, Temple of Artemis.
  Happy.addSource(function (game, cid) {
    var out = [], cs = Rules.citiesOf(game, cid);
    if (owned(game, cid, "stonehenge")) out.push({ key: "stonehenge", name: "Stonehenge (+1 per city)", n: 1, v: cs.length });
    if (owned(game, cid, "temple_of_artemis")) {
      var temples = cs.filter(function (c) { return has(c, "temple"); }).length;
      if (temples) out.push({ key: "artemis", name: "Temple of Artemis (+2 per Temple)", n: 1, v: 2 * temples });
    }
    return out;
  });

  root.PlanetWonders = {
    WONDERS: WONDERS, ORDER: ORDER, addWonder: addWonder, BUILDINGS: BUILDINGS, wonderOf: wonderOf, registry: registry, owned: owned,
    wondersIn: wondersIn, inProgress: inProgress, popCap: popCap, freshWater: freshWater, aiScore: aiScore, aiReview: aiReview, aiMayBuy: aiMayBuy, race: race, affinity: affinity, AFFINITY: AFFINITY, stats: stats, complete: complete,
    makeModifiers: makeModifiers
  };
})(typeof window !== "undefined" ? window : globalThis);
