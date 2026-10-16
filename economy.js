/*
 * economy.js — WHAT GOLD BUYS. No DOM.
 *  - Buy the current build: 2.5 × remaining production (min 5). The build is
 *    finished at the end of the turn.
 *  - Unit upkeep: 1 gold per unit beyond 2 per city, paid at end of turn
 *    (per-civ onEndTurn hook). If gold goes negative a unit is disbanded
 *    (weakest military first, settlers last) and gold resets to 0.
 *  - Buy a tile for a city: unowned, within 3 of the city, touching its
 *    territory; cost 8 × distance + 1 per tile the city already owns.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;

  var BUY_FACTOR = 2.5, FREE_UNITS_PER_CITY = 2, TILE_RANGE = 3;

  function buyCost(game, city) {
    if (!city || city.build == null) return null;
    var cost = Rules.buildCost(game, city.build, city.owner);
    var remaining = cost - city.prod;
    if (remaining <= 0) return 0;
    // Wonders can be rushed, at double the price (5 gold per production).
    return Math.max(5, Math.ceil(remaining * BUY_FACTOR * (Rules.BUILDS[city.build].wonder || Rules.BUILDS[city.build].project ? 2 : 1)));
  }

  function buyBuild(game, cityId) {
    var c = Rules.cityById(game, cityId);
    var price = buyCost(game, c);
    if (price == null) return { ok: false, reason: "Nothing to buy" };
    if (price === 0) return { ok: false, reason: "Already paid for" };
    var cv = game.civs[c.owner];
    if (cv.gold < price) return { ok: false, reason: "Need " + price + " gold" };
    cv.gold -= price;
    c.prod = Rules.buildCost(game, c.build, c.owner);
    return { ok: true, price: price, text: "Bought " + Rules.BUILDS[c.build].name + " in " + c.name + " (" + price + " gold) · ready next turn" };
  }

  function upkeep(game, cid) {
    var units = 0, cities = 0;
    game.units.forEach(function (u) { if (u.owner === cid) units++; });
    game.cities.forEach(function (c) { if (c.owner === cid) cities++; });
    return Math.max(0, units - FREE_UNITS_PER_CITY * cities);
  }

  // Net gold per turn: city income minus unit upkeep.
  function netGold(game, cid) { return Rules.goldRate(game, cid) - upkeep(game, cid); }

  function disbandOne(game, cid) {
    var mine = game.units.filter(function (u) { return u.owner === cid; });
    if (!mine.length) return null;
    mine.sort(function (a, b) {
      var sa = Rules.UNIT_TYPES[a.type].strength || 99, sb = Rules.UNIT_TYPES[b.type].strength || 99;
      return sa - sb || a.hp - b.hp || a.id - b.id;
    });
    var u = mine[0];
    Rules.removeUnit(game, u);
    return u;
  }

  function ownedBy(game, city) {
    var n = 0;
    game.owner.forEach(function (id) { if (id === city.id) n++; });
    return n;
  }

  function tileCost(game, city, tile) {
    return 8 * Rules.hexDistance(city.q, city.r, tile.q, tile.r) + ownedBy(game, city);
  }

  // Tiles this city could buy now, with prices.
  function buyableTiles(game, city) {
    var out = [];
    Rules.tilesInRadius(game, city.q, city.r, TILE_RANGE).forEach(function (t) {
      var k = Rules.key(t.q, t.r);
      if (game.owner.has(k)) return;
      var touches = Rules.neighbours(game, t).some(function (n) { return game.owner.get(Rules.key(n.q, n.r)) === city.id; });
      if (touches) out.push({ tile: t, cost: tileCost(game, city, t) });
    });
    return out;
  }

  function buyTile(game, cityId, q, r) {
    var c = Rules.cityById(game, cityId);
    if (!c) return { ok: false, reason: "No city" };
    var opt = buyableTiles(game, c).filter(function (o) { return o.tile.q === q && o.tile.r === r; })[0];
    if (!opt) return { ok: false, reason: "That tile cannot be bought" };
    var cv = game.civs[c.owner];
    if (cv.gold < opt.cost) return { ok: false, reason: "Need " + opt.cost + " gold" };
    cv.gold -= opt.cost;
    game.owner.set(Rules.key(q, r), c.id);
    Rules.reveal(game, q, r, 1, c.owner);
    return { ok: true, cost: opt.cost, text: c.name + " bought a tile (" + opt.cost + " gold)" };
  }

  function makeModifiers(game, cid) {
    return {
      onEndTurn: function (g, events, sci, c) {
        var cv = g.civs[c];
        cv.gold -= upkeep(g, c);
        if (cv.gold < 0) {
          var u = disbandOne(g, c);
          cv.gold = 0;
          if (u) events.push({ kind: "info", text: "Unpaid upkeep: a " + Rules.UNIT_TYPES[u.type].name + " was disbanded" });
        }
      }
    };
  }

  // Upgrades: Warrior -> Swordsman (or Spearman), Archer -> Composite Bowman,
  // when the tech is known. Cost: 2 gold per production point of difference,
  // at least 10. The unit keeps its HP ratio and loses its remaining moves.
  var UPGRADES = { warrior: ["swordsman", "spearman"], archer: ["composite_bowman"] };   // eras.js extends this
  // Optional extra condition on upgrade targets (strategic.js: resources).
  var GATE = { fn: null };
  function upgradeTarget(game, u) {
    var opts = UPGRADES[u.type] || [];
    for (var i = 0; i < opts.length; i++) {
      var b = Rules.BUILDS[opts[i]];
      if (b && (!b.tech || Rules.hasTech(game, b.tech, u.owner)) && (!GATE.fn || GATE.fn(game, u, opts[i]))) return opts[i];
    }
    return null;
  }
  function upgradeCost(game, u) {
    var to = upgradeTarget(game, u);
    if (!to) return null;
    var c = Math.max(10, 2 * (Rules.buildCost(game, to, u.owner) - Rules.BUILDS[u.type].cost));
    // Leonardo's Workshop (eras.js): upgrades cost 75% less.
    if (root.PlanetWonders && root.PlanetWonders.owned(game, u.owner, "leonardos_workshop")) c = Math.max(5, Math.round(c / 4));
    return c;
  }
  function upgrade(game, unitId) {
    var u = Rules.unitById(game, unitId);
    var to = u && upgradeTarget(game, u), cost = u && upgradeCost(game, u);
    if (!to) return { ok: false, reason: "No upgrade available" };
    var cv = game.civs[u.owner];
    if (cv.gold < cost) return { ok: false, reason: "Needs " + cost + " gold" };
    var city = game.cityAt.get(Rules.key(u.q, u.r));
    var own = game.owner.get(Rules.key(u.q, u.r));
    var inLand = own != null && (Rules.cityById(game, own) || {}).owner === u.owner;
    if (!inLand && !(city && city.owner === u.owner)) return { ok: false, reason: "Upgrade inside your territory" };
    cv.gold -= cost;
    var from = Rules.UNIT_TYPES[u.type].name;
    u.type = to; u.moves = 0; u.fort = false; u.fortifying = false;
    return { ok: true, text: from + " upgraded to " + Rules.UNIT_TYPES[to].name + " (\u2212" + cost + " gold)" };
  }

  root.PlanetEconomy = {
    UPGRADES: UPGRADES, GATE: GATE, upgradeTarget: upgradeTarget, upgradeCost: upgradeCost, upgrade: upgrade,
    BUY_FACTOR: BUY_FACTOR, FREE_UNITS_PER_CITY: FREE_UNITS_PER_CITY,
    buyCost: buyCost, buyBuild: buyBuild, upkeep: upkeep, netGold: netGold,
    buyableTiles: buyableTiles, buyTile: buyTile, tileCost: tileCost, makeModifiers: makeModifiers
  };
})(typeof window !== "undefined" ? window : globalThis);
