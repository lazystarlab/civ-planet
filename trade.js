/*
 * trade.js — CARAVANS AND TRADE ROUTES. No DOM.
 * Caravan (Currency; cost 30, 3 moves, can't fight, captured like a Settler)
 * remembers the city that built it (unit.home). Standing in or next to a
 * target city — another city of yours, or a met civ's city while at peace —
 * it can establish a route: the caravan is consumed and the route runs for
 * ROUTE_TURNS turns. A new caravan on the same pair renews it.
 *
 * Yield per turn, base = 1 + min(distance, 15) / 7.5 + (pop of both cities) / 10, x1.5 if foreign:
 *   home city:        +round(base) gold
 *   destination:      +round(base * 0.6) gold, or (domestic only) food or production
 *   foreign routes:   +1 science in both cities, and attitude target +1 per route (max +2)
 * Routes per home city: 1, +1 with a Market, +1 per 8 pop.
 * War between the two owners cancels their routes; so does losing either city.
 * State: game.trade = { routes: [{ id, from, to, kind, turns }], nextId }.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Diplo = root.PlanetDiplomacy;

  var ROUTE_TURNS = 30;
  Rules.UNIT_TYPES.caravan = { name: "Caravan", moves: 3, canFound: false, strength: 0, caravan: true };
  Rules.BUILDS.caravan = { name: "Caravan", cost: 30, unit: "caravan", minPop: 1, popCost: 0, tech: "currency", note: "trade route" };

  function state(game) { return game.trade || (game.trade = { routes: [], nextId: 1 }); }
  function routes(game) { return state(game).routes; }
  function city(game, id) { return Rules.cityById(game, id); }

  function slots(c) {
    var b = c.buildings || [];
    return 1 + (b.indexOf("market") !== -1 ? 1 : 0) + (b.indexOf("harbor") !== -1 ? 1 : 0) + Math.floor(c.pop / 8);
  }
  function routesFrom(game, cityId) { return routes(game).filter(function (r) { return r.from === cityId; }); }

  function foreign(game, r) { var a = city(game, r.from), b = city(game, r.to); return !!(a && b && a.owner !== b.owner); }

  // Per-turn yield of a route: { home: gold, dest: n, destKind, science, base }.
  function yieldOf(game, r) {
    var a = city(game, r.from), b = city(game, r.to);
    if (!a || !b) return null;
    var f = a.owner !== b.owner;
    var base = (1 + Math.min(15, Rules.hexDistance(a.q, a.r, b.q, b.r)) / 7.5 + (a.pop + b.pop) / 10) * (f ? 1.5 : 1);
    return { base: base, home: Math.round(base), dest: Math.max(1, Math.round(base * 0.6)), destKind: f ? "gold" : (r.kind || "gold"), science: f ? 1 : 0, foreign: f };
  }

  // Can this caravan open a route to city `to` now? Returns { ok, reason, home, renew }.
  function check(game, u, to) {
    if (!u || !Rules.UNIT_TYPES[u.type].caravan) return { ok: false, reason: "Only a Caravan can trade" };
    var home = city(game, u.home);
    if (!home || home.owner !== u.owner) {
      // Home lost: the nearest city of ours stands in.
      home = Rules.citiesOf(game, u.owner).sort(function (a, b) { return Rules.hexDistance(u.q, u.r, a.q, a.r) - Rules.hexDistance(u.q, u.r, b.q, b.r); })[0];
    }
    if (!home) return { ok: false, reason: "No home city" };
    if (!to || to.id === home.id) return { ok: false, reason: "Pick another city than its home" };
    if (Rules.hexDistance(u.q, u.r, to.q, to.r) > 1) return { ok: false, reason: "Move next to the city first" };
    if (to.owner !== u.owner) {
      if (!Diplo.met(game, u.owner, to.owner)) return { ok: false, reason: "You have not met them" };
      var rel = Diplo.rel(game, u.owner, to.owner);
      if (rel && rel.war) return { ok: false, reason: "At war" };
    }
    var renew = routes(game).filter(function (r) { return r.from === home.id && r.to === to.id; })[0] || null;
    if (!renew && routesFrom(game, home.id).length >= slots(home)) return { ok: false, reason: home.name + " has no free route (" + slots(home) + " max)" };
    return { ok: true, home: home, renew: renew };
  }

  // Cities (own or foreign) next to the caravan it could trade with.
  function targetsNear(game, u) {
    var out = [];
    Rules.tilesInRadius(game, u.q, u.r, 1).forEach(function (t) {
      var c = game.cityAt.get(Rules.key(t.q, t.r));
      if (c && check(game, u, c).ok) out.push(c);
    });
    return out;
  }

  function establish(game, unitId, toId, kind) {
    var u = Rules.unitById(game, unitId), to = city(game, toId);
    var c = check(game, u, to);
    if (!c.ok) return c;
    var st = state(game), r = c.renew;
    if (r) { r.turns = ROUTE_TURNS; if (to.owner === u.owner && kind) r.kind = kind; }
    else {
      r = { id: st.nextId++, from: c.home.id, to: to.id, kind: to.owner === u.owner ? (kind || "gold") : "gold", turns: ROUTE_TURNS, start: game.turn };
      st.routes.push(r);
    }
    Rules.removeUnit(game, u);
    var y = yieldOf(game, r);
    var text = (c.renew ? "Renewed" : "New") + " trade route " + c.home.name + " \u2192 " + to.name + ": +" + y.home + " gold, " + to.name + " +" + y.dest + " " + y.destKind + (y.science ? ", +1 science each" : "") + " for " + ROUTE_TURNS + " turns";
    Rules.logEvent(game, "trade", text, u.owner === 0 || to.owner === 0 ? 0 : null);
    return { ok: true, route: r, text: text };
  }

  function cancelBetween(game, a, b, why, events) {
    state(game).routes = routes(game).filter(function (r) {
      var x = city(game, r.from), y = city(game, r.to);
      if (!x || !y) return false;
      var hit = (x.owner === a && y.owner === b) || (x.owner === b && y.owner === a);
      if (hit) {
        var text = "Trade route " + x.name + " \u2192 " + y.name + " cancelled (" + why + ")";
        if (events) events.push({ cid: 0, kind: "trade", text: text });
        if (x.owner === 0 || y.owner === 0) Rules.logEvent(game, "trade", text, 0);
      }
      return !hit;
    });
  }

  // Sum of route income for a civ: { gold, food, prod, science, n }.
  function incomeOf(game, cid) {
    var out = { gold: 0, food: 0, prod: 0, science: 0, n: 0 };
    routes(game).forEach(function (r) {
      var a = city(game, r.from), b = city(game, r.to), y = yieldOf(game, r);
      if (!y) return;
      if (a.owner === cid) { out.gold += y.home; out.science += y.science; out.n++; }
      if (b.owner === cid) { out[y.destKind === "gold" ? "gold" : y.destKind] += y.dest; out.science += y.science; if (a.owner !== cid) out.n++; }
    });
    return out;
  }

  function foreignRoutesBetween(game, a, b) {
    return routes(game).filter(function (r) {
      var x = city(game, r.from), y = city(game, r.to);
      return x && y && ((x.owner === a && y.owner === b) || (x.owner === b && y.owner === a));
    }).length;
  }

  function makeModifiers(game, cid) {
    return {
      cityYield: function (c, y) {
        var rs = routes(game);
        for (var i = 0; i < rs.length; i++) {
          var r = rs[i];
          if (r.from !== c.id && r.to !== c.id) continue;
          var ry = yieldOf(game, r);
          if (!ry) continue;
          if (r.from === c.id) y.gold += ry.home;
          if (r.to === c.id) y[ry.destKind === "gold" ? "gold" : ry.destKind] += ry.dest;
        }
        return y;
      },
      cityScience: function (c) {
        var n = 0;
        routes(game).forEach(function (r) { if ((r.from === c.id || r.to === c.id) && foreign(game, r)) n++; });
        return n;
      },
      // The home civ ages its routes and drops invalid ones.
      onEndTurn: function (g, events, sci, c) {
        state(g).routes = routes(g).filter(function (r) {
          var a = city(g, r.from), b = city(g, r.to);
          if (!a || !b) return false;
          if (a.owner !== c) return true;
          if (a.owner !== b.owner) {
            var rel = Diplo.rel(g, a.owner, b.owner);
            if (rel && rel.war) { events.push({ kind: "trade", text: "Trade route " + a.name + " \u2192 " + b.name + " cancelled by war" }); return false; }
          }
          if (--r.turns <= 0) { events.push({ kind: "trade", text: "Trade route " + a.name + " \u2192 " + b.name + " expired: send a Caravan to renew it" }); return false; }
          return true;
        });
      }
    };
  }

  // ---------------------------------------------------------- AI
  // Best target for a caravan: value per turn minus travel time.
  function aiTarget(game, u) {
    var cid = u.owner, best = null, bs = -Infinity;
    var home = city(game, u.home) || Rules.citiesOf(game, cid)[0];
    if (!home) return null;
    if (routesFrom(game, home.id).length >= slots(home)) return null;
    game.cities.forEach(function (c) {
      if (c.id === home.id) return;
      if (c.owner !== cid) {
        if (!Diplo.met(game, cid, c.owner)) return;
        var rel = Diplo.rel(game, cid, c.owner);
        if (!rel || rel.war || (rel.att || 0) < 0) return;   // only friendly-ish partners
      }
      if (routes(game).some(function (r) { return r.from === home.id && r.to === c.id && r.turns > 5; })) return;
      var d = Rules.hexDistance(u.q, u.r, c.q, c.r);
      if (d > 24) return;
      var y = yieldOf(game, { from: home.id, to: c.id, kind: "gold" });
      var s = y.home + y.dest * 0.5 + y.science * 2 - d / 4;
      if (s > bs) { bs = s; best = c; }
    });
    return best;
  }

  function wantCaravan(game, cid) {
    var cs = Rules.citiesOf(game, cid);
    var free = cs.some(function (c) { return routesFrom(game, c.id).length < slots(c); });
    var have = game.units.some(function (x) { return x.owner === cid && x.type === "caravan"; }) ||
      cs.some(function (c) { return c.build === "caravan"; });
    return free && !have && cs.length >= 2;
  }

  function aiCaravan(game, u, stepToward) {
    var t = aiTarget(game, u);
    if (!t) return;
    if (Rules.hexDistance(u.q, u.r, t.q, t.r) > 1) {
      var adj = Rules.neighbours(game, game.index.get(Rules.key(t.q, t.r))).filter(function (n) { return Rules.unitMoveCost(game, u, n) !== Infinity; })
        .sort(function (a, b) { return Rules.hexDistance(u.q, u.r, a.q, a.r) - Rules.hexDistance(u.q, u.r, b.q, b.r); })[0];
      if (adj) stepToward(game, u, adj.q, adj.r);
    }
    if (Rules.unitById(game, u.id) && Rules.hexDistance(u.q, u.r, t.q, t.r) <= 1) {
      var own = t.owner === u.owner;
      establish(game, u.id, t.id, own && t.pop < 4 ? "food" : own ? "prod" : "gold");
    }
  }

  root.PlanetTrade = {
    ROUTE_TURNS: ROUTE_TURNS, routes: routes, slots: slots, routesFrom: routesFrom, yieldOf: yieldOf, check: check,
    targetsNear: targetsNear, establish: establish, cancelBetween: cancelBetween, incomeOf: incomeOf,
    foreignRoutesBetween: foreignRoutesBetween, makeModifiers: makeModifiers,
    aiTarget: aiTarget, wantCaravan: wantCaravan, aiCaravan: aiCaravan
  };
})(typeof window !== "undefined" ? window : globalThis);
