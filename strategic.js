/*
 * strategic.js — STRATEGIC RESOURCES (slice 15). No DOM.
 * Iron, Horses, Coal, Aluminum and Uranium gate units and a few buildings.
 * Model: every source tile inside a civ's borders supplies PER_SOURCE units
 * (PER_UNIMPROVED if it has no improvement yet), plus 4 per traded copy.
 * Units that need a resource count against it; those over the limit fight at
 * -50% (newest first). A unit or building needs at least one free slot (or
 * one source, for buildings) to be started.
 * Coal, Aluminum and Uranium are placed at mapgen (mapgen.js placeStrategic)
 * and only become visible with their tech. Trades: deal item
 * { t: "strat", res, turns } lives in game.strategic.trades.
 * game.strategic = { trades: [{ id, from, to, res, turns }], nextId, stats }.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Gen = root.PlanetGen;

  var PER_SOURCE = 4, PER_UNIMPROVED = 2, TRADE_TURNS = 30;
  var STRATEGIC = ["iron", "horses", "coal", "aluminum", "uranium"];
  var REVEAL = { coal: "steam_power", aluminum: "electricity", uranium: "nuclear_fission" };
  Rules.RESOURCE_YIELD.coal = { food: 0, prod: 2, gold: 0 };
  Rules.RESOURCE_YIELD.aluminum = { food: 0, prod: 1, gold: 1 };
  Rules.RESOURCE_YIELD.uranium = { food: 0, prod: 1, gold: 2 };

  // Units: which resource they need.
  var NEEDS = {
    horseman: "horses", knight: "horses", swordsman: "iron", frigate: "iron",
    ironclad: "coal", battleship: "coal", destroyer: "coal",
    fighter: "aluminum", bomber: "aluminum", jet_fighter: "aluminum", stealth_bomber: "aluminum", helicopter: "aluminum",
    rocket_artillery: "aluminum", modern_armor: "aluminum", missile_cruiser: "uranium", carrier: "coal"
  };
  // Buildings that need one source.
  var BUILD_NEEDS = { factory: "coal", nuclear_plant: "uranium" };

  function state(game) {
    var s = game.strategic || (game.strategic = {});
    if (!s.trades) s.trades = [];
    if (!s.nextId) s.nextId = 1;
    if (!s.stats) s.stats = { trades: 0, overPeak: 0 };
    return s;
  }
  function visible(game, res, cid) { return !REVEAL[res] || Rules.hasTech(game, REVEAL[res], cid); }

  // Sources inside cid's borders: { res: { tiles, improved } }.
  function sources(game, cid) {
    var out = {};
    STRATEGIC.forEach(function (r) { out[r] = { tiles: 0, improved: 0 }; });
    game.owner.forEach(function (cityId, k) {
      var c = Rules.cityById(game, cityId);
      if (!c || c.owner !== cid) return;
      var t = game.index.get(k);
      if (!t || !t.resource || !out[t.resource] || !visible(game, t.resource, cid)) return;
      out[t.resource].tiles++;
      if ((game.improvements && game.improvements[k]) || game.cityAt.has(k)) out[t.resource].improved++;
    });
    return out;
  }
  function supply(game, cid) {
    var src = sources(game, cid), out = {};
    STRATEGIC.forEach(function (r) {
      out[r] = src[r].improved * PER_SOURCE + (src[r].tiles - src[r].improved) * PER_UNIMPROVED;
    });
    state(game).trades.forEach(function (x) {
      if (x.to === cid) out[x.res] += PER_SOURCE;
      if (x.from === cid) out[x.res] = Math.max(0, out[x.res] - PER_SOURCE);
    });
    return out;
  }
  function usersOf(game, cid, res) {
    return game.units.filter(function (u) { return u.owner === cid && NEEDS[u.type] === res; }).sort(function (a, b) { return a.id - b.id; });
  }
  // Cached per game state: { cid: { res: { supply, used, over: Set(ids) } } }.
  function ledger(game) {
    var stamp = game.turn + ":" + game.units.length + ":" + game.nextId + ":" + state(game).trades.length + ":" + game.owner.size;
    if (game._stratLedger && game._stratLedger.stamp === stamp) return game._stratLedger;
    var L = { stamp: stamp, civ: {} };
    game.civs.forEach(function (cv, cid) {
      if (cv.eliminated) return;
      var sp = supply(game, cid), row = {};
      STRATEGIC.forEach(function (r) {
        var us = usersOf(game, cid, r), over = new Set();
        for (var i = sp[r]; i < us.length; i++) over.add(us[i].id);
        row[r] = { supply: sp[r], used: us.length, over: over };
      });
      L.civ[cid] = row;
    });
    Object.defineProperty(game, "_stratLedger", { value: L, writable: true, configurable: true, enumerable: false });
    return L;
  }
  function report(game, cid) {
    var row = ledger(game).civ[cid] || {};
    return STRATEGIC.filter(function (r) { return visible(game, r, cid); }).map(function (r) {
      var x = row[r] || { supply: 0, used: 0, over: new Set() };
      return { res: r, name: Gen.RESOURCES[r].name, supply: x.supply, used: x.used, over: x.over.size };
    });
  }
  function free(game, cid, res) { var x = (ledger(game).civ[cid] || {})[res]; return x ? x.supply - x.used : 0; }
  function overLimit(game, u) { var r = NEEDS[u.type]; if (!r) return false; var x = (ledger(game).civ[u.owner] || {})[r]; return !!(x && x.over.has(u.id)); }
  function totalOver(game, cid) { return report(game, cid).reduce(function (s, x) { return s + x.over; }, 0); }

  // Upgrades need a free slot of the new unit's resource too (unless the old one used the same).
  var Econ = root.PlanetEconomy;
  if (Econ && Econ.GATE) Econ.GATE.fn = function (game, u, to) {
    return !NEEDS[to] || NEEDS[to] === NEEDS[u.type] || free(game, u.owner, NEEDS[to]) > 0;
  };

  root.PlanetCombat.addStrengthMod(function (game, u) {
    if (!overLimit(game, u)) return null;
    return [{ label: "No " + Gen.RESOURCES[NEEDS[u.type]].name + " (over limit)", v: -0.5 }];
  });

  // ---- deals: { t: "strat", res, turns }
  function tradedOut(game, cid, res) { return state(game).trades.filter(function (x) { return x.from === cid && x.res === res; }).length; }
  function spare(game, cid, res) { return free(game, cid, res) >= PER_SOURCE; }
  function demand(game, cid, res) {
    // How much cid wants one more copy: short now, or a unit it can't build.
    var x = (ledger(game).civ[cid] || {})[res]; if (!x) return 0;
    if (!visible(game, res, cid)) return 0;
    var short = Math.max(0, x.used - x.supply);
    var unlock = Object.keys(NEEDS).some(function (k) { return NEEDS[k] === res && Rules.BUILDS[k] && (!Rules.BUILDS[k].tech || Rules.hasTech(game, Rules.BUILDS[k].tech, cid)); });
    return short * 30 + (unlock && x.supply === 0 ? 90 : unlock && x.supply - x.used < 2 ? 40 : 10);
  }
  if (root.PlanetDeals) root.PlanetDeals.addItemType("strat", {
    value: function (game, it, recv) { return demand(game, recv, it.res); },
    cost: function (game, it, giver) { var f = free(game, giver, it.res); return f >= PER_SOURCE * 2 ? 20 : f >= PER_SOURCE ? 45 : 200; },
    invalid: function (game, it, giver) {
      if (STRATEGIC.indexOf(it.res) === -1) return "Unknown resource";
      if (!spare(game, giver, it.res)) return (giver === 0 ? "You have" : Rules.civName(game, giver) + " has") + " no spare " + Gen.RESOURCES[it.res].name;
      return null;
    },
    execute: function (game, it, giver, recv) {
      var st = state(game);
      st.trades.push({ id: st.nextId++, from: giver, to: recv, res: it.res, turns: it.turns || TRADE_TURNS });
      st.stats.trades++;
    },
    describe: function (game, it) { return Gen.RESOURCES[it.res].name + " (+" + PER_SOURCE + " units) for " + (it.turns || TRADE_TURNS) + " turns"; }
  });
  function tradable(game, cid) { return STRATEGIC.filter(function (r) { return visible(game, r, cid) && spare(game, cid, r); }); }

  // AI: buy a missing resource from a friendly neighbour now and then.
  function aiTrade(game, cid) {
    var D = root.PlanetDiplomacy, DL = root.PlanetDeals;
    if (!D || !DL || cid === 0 || game.turn % 5 !== cid % 5) return;
    var want = STRATEGIC.map(function (r) { return { r: r, d: demand(game, cid, r) }; }).filter(function (x) { return x.d >= 40; }).sort(function (a, b) { return b.d - a.d; })[0];
    if (!want) return;
    var cv = game.civs[cid];
    D.metCivs(game, cid).some(function (o) {
      var rel = D.rel(game, cid, o);
      if (!rel || rel.war || o === 0 || !spare(game, o, want.r)) return false;
      var price = Math.min(cv.gold - 30, 40 + Math.round(want.d * 0.6));
      if (price < 30) return false;
      var deal = { from: cid, to: o, give: [{ t: "gold", n: price }], ask: [{ t: "strat", res: want.r, turns: TRADE_TURNS }], pacts: [] };
      if (DL.evaluate(game, deal).verdict !== "accept") return false;
      DL.execute(game, deal);
      return true;
    });
  }

  function tick(game) {
    var st = state(game), keep = [];
    st.trades.forEach(function (x) {
      var dead = game.civs[x.from].eliminated || game.civs[x.to].eliminated;
      var D = root.PlanetDiplomacy, r = D && D.rel(game, x.from, x.to);
      if (r && r.war) dead = true;
      if (!dead && --x.turns > 0) keep.push(x);
      else if (x.from === 0 || x.to === 0) Rules.logEvent(game, "diplo", Gen.RESOURCES[x.res].name + " supply between " + Rules.civName(game, x.from) + " and " + Rules.civName(game, x.to) + " ended", 0);
    });
    st.trades = keep;
    var over = 0;
    game.civs.forEach(function (c, i) { if (!c.eliminated) over += totalOver(game, i); });
    st.stats.overPeak = Math.max(st.stats.overPeak, over);
  }

  var MODS = function (game, cid) {
    return {
      resourceVisible: function (res) { return visible(game, res, cid); },
      canBuild: function (build, city) {
        var b = Rules.BUILDS[build];
        if (!b) return true;
        if (b.unit && NEEDS[b.unit]) return free(game, cid, NEEDS[b.unit]) > 0;
        if (b.building && BUILD_NEEDS[b.building]) return supply(game, cid)[BUILD_NEEDS[b.building]] > 0;
        return true;
      },
      init: function (g) { state(g); },
      onEndTurn: function (g, events, sci, c) { if (g.civs[c].ai || g._autoPlayer) aiTrade(g, c); }
    };
  };
  var WORLD = { init: function (game) { state(game); }, onEndTurn: function (game) { tick(game); } };
  Rules.registerPlugin({ mods: MODS, world: WORLD });

  root.PlanetStrategic = {
    STRATEGIC: STRATEGIC, NEEDS: NEEDS, BUILD_NEEDS: BUILD_NEEDS, REVEAL: REVEAL, PER_SOURCE: PER_SOURCE, PER_UNIMPROVED: PER_UNIMPROVED,
    state: state, sources: sources, supply: supply, report: report, free: free, overLimit: overLimit, totalOver: totalOver,
    tradable: tradable, demand: demand, aiTrade: aiTrade, ledger: ledger, visible: visible
  };
})(typeof window !== "undefined" ? window : globalThis);
