/*
 * aitune.js — slice 16 AI tuning, rules only, no DOM.
 *  - builds: AA guns when enemy bombers are near, faith buildings for faiths
 *    that can still found or spread, no resource-hungry unit a civ can't feed;
 *  - fighters rebase to the most threatened city and fly intercept patrols;
 *  - resource compliance: after every turn an AI civ over a strategic limit
 *    first tries to buy the resource, then disbands its newest unsupported units.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Combat = root.PlanetCombat, SR = root.PlanetStrategic, Air = root.PlanetAir, AI = root.PlanetAI, RL = root.PlanetReligion;
  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function foes(game, cid) { return game.civs.map(function (c, i) { return i; }).filter(function (i) { return i !== cid && !game.civs[i].eliminated && Combat.atWar(game, cid, i); }); }
  function state(game) { return game.aitune || (game.aitune = { disbanded: 0, bought: 0, aa: 0 }); }

  if (AI && AI.addBuildAdjust) AI.addBuildAdjust(function (game, city, key, s, war) {
    var b = Rules.BUILDS[key], cid = city.owner;
    if (b.unit && SR) {
      var need = SR.NEEDS[b.unit];
      if (need) {
        var queued = Rules.citiesOf(game, cid).filter(function (c) { return c !== city && c.build && Rules.BUILDS[c.build] && SR.NEEDS[Rules.BUILDS[c.build].unit] === need; }).length;
        if (SR.free(game, cid, need) - queued <= 0) return 0;
      }
    }
    // An overseas war needs an ocean-going transport (a Trireme can't cross).
    var NA = root.PlanetNavalAI, ut = b.unit ? T(b.unit) : null;
    if (ut && ut.naval && ut.ocean && (ut.cargo || 0) >= 2 && NA && NA.wantsInvasion(game, cid)) {
      var haveOcean = game.units.some(function (u) { return u.owner === cid && T(u.type).ocean && (T(u.type).cargo || 0) >= 2; }) ||
        Rules.citiesOf(game, cid).some(function (c) { return c !== city && c.build && Rules.BUILDS[c.build] && T(Rules.BUILDS[c.build].unit).ocean && (T(Rules.BUILDS[c.build].unit).cargo || 0) >= 2; });
      if (!haveOcean) return Math.max(s, 8);
    }
    if (key === "anti_aircraft") {
      var fs = foes(game, cid);
      var bombers = game.units.filter(function (u) { return fs.indexOf(u.owner) !== -1 && T(u.type).air && T(u.type).strike > T(u.type).dogfight && Rules.hexDistance(u.q, u.r, city.q, city.r) <= 12; }).length;
      var have = game.units.filter(function (u) { return u.owner === cid && u.type === "anti_aircraft" && Rules.hexDistance(u.q, u.r, city.q, city.r) <= 2; }).length;
      return bombers && !have ? Math.max(s, 6 + bombers) : have ? 0 : Math.min(s, 1);
    }
    if (RL && (key === "shrine" || key === "temple")) {
      var st = RL.state(game).civ[cid], mine = RL.founded(game, cid);
      if ((mine || RL.slotsLeft(game) > 0) && st && !war) return s + (mine ? 1.2 : 1.8);
    }
    return s;
  });

  // Fighters guard the most threatened city.
  if (Air && Air.aiUnit) {
    var origAir = Air.aiUnit;
    Air.aiUnit = function (game, u) {
      var t = T(u.type);
      var fs = foes(game, u.owner);
      if (u.moves > 0 && fs.length && t.dogfight >= t.strike) {
        var best = null, bt = 0;
        Rules.citiesOf(game, u.owner).forEach(function (c) {
          if (Rules.hexDistance(u.q, u.r, c.q, c.r) > Air.rangeOf(u) || !(c.q === u.q && c.r === u.r) && !Air.canBaseAt(game, u, c.q, c.r)) return;
          var threat = 0;
          game.units.forEach(function (o) {
            if (fs.indexOf(o.owner) === -1) return;
            var d = Rules.hexDistance(o.q, o.r, c.q, c.r);
            if (T(o.type).air && d <= 10) threat += 3; else if (Combat.strengthOf(o.type) > 0 && d <= 5) threat += 1;
          });
          if (threat > bt || threat === bt && best && c.q === u.q && c.r === u.r) { bt = threat; best = c; }
        });
        if (best && bt >= 2) {
          if (!(best.q === u.q && best.r === u.r)) Air.rebase(game, u.id, best.q, best.r);
          var u2 = Rules.unitById(game, u.id);
          if (u2 && !u2.patrol) { u2.moves = 1; Air.patrol(game, u2.id); }
          return;
        }
      }
      return origAir(game, u);
    };
  }

  // Strategic compliance after the turn (production and expiring deals done).
  function comply(game, cid) {
    if (!SR) return;
    game._stratLedger = null;
    SR.STRATEGIC.forEach(function (r) {
      var row = SR.ledger(game).civ[cid];
      if (!row || !row[r] || !row[r].over.size) return;
      // Try to buy the missing supply from a friendly civ.
      var D = root.PlanetDiplomacy, DL = root.PlanetDeals, cv = game.civs[cid], bought = false;
      if (D && DL) D.metCivs(game, cid).some(function (o) {
        var rel = D.rel(game, cid, o);
        if (!rel || rel.war || o === 0 || (SR.tradable(game, o).indexOf(r) === -1)) return false;
        var price = Math.min(cv.gold - 20, 60);
        if (price < 25) return false;
        var deal = { from: cid, to: o, give: [{ t: "gold", n: price }], ask: [{ t: "strat", res: r, turns: 30 }], pacts: [] };
        if (DL.evaluate(game, deal).verdict !== "accept") return false;
        DL.execute(game, deal); bought = true; state(game).bought++;
        return true;
      });
      game._stratLedger = null;
      var over = SR.ledger(game).civ[cid][r].over;
      if (!over.size) return;
      // Disband the newest unsupported units.
      Array.from(over).sort(function (a, b) { return b - a; }).forEach(function (id) {
        var u = Rules.unitById(game, id);
        if (!u) return;
        Rules.removeUnit(game, u); state(game).disbanded++;
        if (cid === 0) Rules.logEvent(game, "info", "Disbanded a " + T(u.type).name + ": no " + root.PlanetGen.RESOURCES[r].name + " to supply it", 0);
      });
      game._stratLedger = null;
    });
  }

  // Overseas ambition: a quiet world where civs sit on separate shores never
  // fights. After turn 100 a strong, seafaring AI at peace with everyone may
  // pick a war with a cool, weaker rival (rival faith or bad blood); the war
  // aims at an overseas city (navalai.js plans the landing).
  function hsh(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function power(game, cid) { return game.units.filter(function (u) { return u.owner === cid && Combat.strengthOf(u.type) > 0; }).reduce(function (s, u) { return s + Combat.strengthOf(u.type); }, 0); }
  function anyWar(game) { return game.civs.some(function (c, i) { return !c.eliminated && foes(game, i).length; }); }
  function ambition(game, events) {
    var D = root.PlanetDiplomacy, PZ = root.PlanetPeace;
    if (!D || game.turn < 100 || anyWar(game)) return;
    game.civs.forEach(function (c, a) {
      if (c.eliminated || !c.ai || anyWar(game)) return;
      if (!Rules.hasTech(game, "navigation", a) || Rules.citiesOf(game, a).length < 3) return;
      D.metCivs(game, a).forEach(function (b) {
        if (game.civs[b].eliminated || anyWar(game)) return;
        if (hsh(game.seed + "|amb|" + game.turn + "|" + a + "|" + b) % 30) return;
        var r = D.rel(game, a, b);
        if (!r || r.war || r.att > 3) return;
        if (PZ && PZ.sincePeace && PZ.sincePeace(game, a, b) < 40) return;
        if (D.napActive && D.napActive(game, a, b)) return;
        var pact = D.pactOf ? D.pactOf(game, a, b) : {};
        if (pact.ally || pact.def && r.att > 1) return;
        if (power(game, a) < power(game, b) * 1.1) return;
        var res = D.declareWar(game, a, b);
        if (res.ok) { state(game).wars = (state(game).wars || 0) + 1; events.push({ kind: "war", text: res.text, cid: b === 0 ? 0 : null }); }
      });
    });
  }

  Rules.registerPlugin({ world: {
    init: function (g) { state(g); },
    onEndTurn: function (g, events) {
      if (!root.PlanetAIWar) ambition(g, events || []);   // slice 17: aiwar.js drives wars
      g.civs.forEach(function (c, i) { if (!c.eliminated && (c.ai || g._autoPlayer)) comply(g, i); });
    }
  } });

  root.PlanetAITune = { state: state, comply: comply };
})(typeof window !== "undefined" ? window : globalThis);
