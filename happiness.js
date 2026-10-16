/*
 * happiness.js — CIV-WIDE HAPPINESS. No DOM.
 * happiness = 4 (base) + 2 (palace: you hold a capital)
 *           + luxuries (Gems, Spices, Gold): +3 for the first copy of each type in your
 *             territory, +1 per extra copy on land of a city connected to the capital
 *           + buildings: Temple +2 (Ceremonial Burial), Monument +1, Colosseum +3
 *             (Construction)
 *           - 2 per city
 *           - 1 per 2 pop above 2 in each city (floor((pop - 2) / 2), summed)
 * Unhappy (< 0): growth needs 1/0.75 x the food (-25% growth), -1 production per city.
 * Very unhappy (< -5): no growth, no Settlers, and each city has a 15% chance
 * (+3% per point below -5, max 40%) per turn of unrest: it produces nothing
 * (no production, no gold) next turn, with an event.
 * Everything goes through per-civ hooks (growthNeed, cityYield, canBuild, onEndTurn).
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;

  var BASE = 4;
  var LUXURIES = ["gems", "spices", "gold"];
  var PALACE = 2;
  var LUX_FIRST = 3, LUX_EXTRA = 1;
  var BUILDING_HAPPY = { temple: 2, monument: 1, colosseum: 3 };
  var MARKET_WITH_LUX = 0;   // tried +1: pushed built-up empires too high
  var CITY_COST = 2;
  var SOURCES = [];
  function addSource(f) { SOURCES.push(f); }
  function popCost(pop) { return Math.floor(Math.max(0, pop - 2) / 2); }
  var VERY_UNHAPPY = -5;

  var BUILDS = {
    temple:    { name: "Temple",    cost: 30, building: "temple",    minPop: 1, popCost: 0, tech: "ceremonial_burial", note: "+2 happiness" },
    colosseum: { name: "Colosseum", cost: 50, building: "colosseum", minPop: 1, popCost: 0, tech: "construction",      note: "+3 happiness" }
  };
  Object.keys(BUILDS).forEach(function (k) { Rules.BUILDS[k] = BUILDS[k]; });

  // Cache per civ, invalidated by anything the formula reads.
  function sig(game, cid) {
    var s = game.turn + "|" + game.owner.size + "|" + (game.deals ? game.deals.ver || 0 : 0) + "|" + Object.keys(game.wonders || {}).length + "|" + (game._happyVer || 0);
    for (var i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (c.owner === cid) s += "|" + c.id + ":" + c.pop + ":" + (c.buildings || []).length;
    }
    return s;
  }

  /*
   * Breakdown: { total, base, luxuries: [{key, name, v}], buildings: [{name, v, n}],
   *              cities: -n, pop: -x, state: "happy" | "unhappy" | "very" }
   */
  function compute(game, cid) {
    var cache = game._happy || (Object.defineProperty(game, "_happy", { value: {}, writable: true, enumerable: false }), game._happy);
    var key = sig(game, cid);
    if (cache[cid] && cache[cid].sig === key) return cache[cid].v;
    var cities = Rules.citiesOf(game, cid), ids = {};
    cities.forEach(function (c) { ids[c.id] = true; });
    var conn = root.PlanetRoads ? root.PlanetRoads.connected(game, cid) : {};
    var cap = cities.filter(function (c) { return c.capital; })[0];
    var lux = {};   // type -> { n: copies, linked: copies on connected land }
    game.owner.forEach(function (cityId, k) {
      if (!ids[cityId]) return;
      var t = game.index.get(k);
      if (!t || !t.resource || LUXURIES.indexOf(t.resource) === -1) return;
      var e = lux[t.resource] || (lux[t.resource] = { n: 0, linked: 0 });
      e.n++;
      if ((cap && cityId === cap.id) || conn[cityId]) e.linked++;
    });
    var out = { base: BASE, palace: cap ? PALACE : 0, luxuries: [], buildings: [], cities: 0, pop: 0 };
    LUXURIES.forEach(function (r) {
      var e = lux[r];
      if (!e) return;
      var extra = Math.max(0, Math.min(e.n, e.linked + 1) - 1);   // copies beyond the first, on connected land
      out.luxuries.push({ key: r, name: root.PlanetGen.RESOURCES[r].name, n: e.n, extra: extra, v: LUX_FIRST + extra * LUX_EXTRA });
    });
    var bcount = {};
    cities.forEach(function (c) {
      (c.buildings || []).forEach(function (b) { if (BUILDING_HAPPY[b] || b === "market") bcount[b] = (bcount[b] || 0) + 1; });
      out.cities -= CITY_COST;
      out.pop -= popCost(c.pop);
    });
    Object.keys(BUILDING_HAPPY).forEach(function (b) {
      if (bcount[b]) out.buildings.push({ key: b, name: Rules.BUILDS[b].name, n: bcount[b], v: bcount[b] * BUILDING_HAPPY[b] });
    });
    if (MARKET_WITH_LUX && bcount.market && out.luxuries.length) out.buildings.push({ key: "market", name: "Market (with a luxury)", n: bcount.market, v: bcount.market * MARKET_WITH_LUX });
    // Luxuries through deals (deals.js): imported types count; a sole copy traded away doesn't.
    var Deals = root.PlanetDeals;
    if (Deals) {
      Deals.luxOut(game, cid).forEach(function (r) {
        var e = lux[r];
        if (e && e.n === 1) out.luxuries = out.luxuries.filter(function (l) { if (l.key === r) out.tradedAway = (out.tradedAway || []).concat([l.name]); return l.key !== r; });
      });
      Deals.luxIn(game, cid).forEach(function (d) {
        if (out.luxuries.some(function (l) { return l.key === d.res; })) return;
        out.luxuries.push({ key: d.res, name: root.PlanetGen.RESOURCES[d.res].name + " (from " + Rules.civName(game, d.from) + ", " + d.turns + "t)", n: 1, extra: 0, v: LUX_FIRST, deal: true });
      });
    }
    // Other sources (wonders.js): rows shown with the buildings.
    SOURCES.forEach(function (f) { (f(game, cid, out) || []).forEach(function (x) { out.buildings.push(x); }); });
    out.total = out.base + out.palace + out.cities + out.pop +
      out.luxuries.reduce(function (s, l) { return s + l.v; }, 0) +
      out.buildings.reduce(function (s, b) { return s + b.v; }, 0);
    out.state = out.total < VERY_UNHAPPY ? "very" : out.total < 0 ? "unhappy" : "happy";
    cache[cid] = { sig: key, v: out };
    return out;
  }

  function total(game, cid) { return compute(game, cid).total; }

  // Happiness change from founding a city on `tile`: -2 for the city plus any
  // new luxury inside its first ring.
  function foundDelta(game, cid, tile) {
    var have = {};
    compute(game, cid).luxuries.forEach(function (l) { have[l.key] = true; });
    var gain = 0, seen = {};
    Rules.tilesInRadius(game, tile.q, tile.r, 1).forEach(function (t) {
      var o = game.owner.get(Rules.key(t.q, t.r));
      if (o != null) return;
      if (t.resource && LUXURIES.indexOf(t.resource) !== -1 && !have[t.resource] && !seen[t.resource]) { seen[t.resource] = true; gain += LUX_FIRST; }
    });
    return -CITY_COST + gain;
  }

  function unrestChance(h) { return h >= VERY_UNHAPPY ? 0 : Math.min(0.4, 0.15 + 0.03 * (VERY_UNHAPPY - h)); }

  function rnd(game, a, b) {
    var h = 2166136261, s = String(game.seed) + ":unrest:" + a + ":" + b;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  function makeModifiers(game, cid) {
    return {
      growthNeed: function (pop, need) {
        var st = compute(game, cid).state;
        return st === "very" ? Infinity : st === "unhappy" ? Math.ceil(need / 0.75) : need;
      },
      cityYield: function (city, y) {
        if (city.unrest) { y.prod = 0; y.gold = 0; return y; }
        if (compute(game, cid).state !== "happy") y.prod = Math.max(0, y.prod - 1);
        return y;
      },
      canBuild: function (key) {
        return key !== "settler" || compute(game, cid).state !== "very";
      },
      onEndTurn: function (g, events, sci, c) {
        var h = compute(g, c);
        Rules.citiesOf(g, c).forEach(function (city) {
          city.unrest = false;
          // Starved of growth: keep the food store from growing without bound.
          if (h.state === "very") city.food = Math.min(city.food, 15 + 8 * (city.pop - 1));
          if (rnd(g, g.turn, city.id) < unrestChance(h.total)) {
            city.unrest = true;
            var e = { cid: c, kind: "unrest", text: "Unrest in " + city.name + ": it produces nothing next turn", city: city.id };
            events.push(e);
          }
        });
      }
    };
  }

  root.PlanetHappiness = {
    addSource: addSource, BASE: BASE, PALACE: PALACE, CITY_COST: CITY_COST, LUX_FIRST: LUX_FIRST, LUX_EXTRA: LUX_EXTRA, popCost: popCost, LUXURIES: LUXURIES, BUILDING_HAPPY: BUILDING_HAPPY, VERY_UNHAPPY: VERY_UNHAPPY,
    compute: compute, total: total, foundDelta: foundDelta, unrestChance: unrestChance, makeModifiers: makeModifiers
  };
})(typeof window !== "undefined" ? window : globalThis);
