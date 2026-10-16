/*
 * air.js — AIR POWER (slice 15). No DOM.
 * Aircraft (UNIT_TYPES[t].air) are based in an own city (up to CITY_AIR per
 * city) or on a Carrier (u.base = carrier id, up to its airCap). They never
 * move normally; each turn they fly one mission:
 *   strike(game, id, q, r)  attack a unit or city within airRange; enemy
 *                           patrolling fighters in range and AA guns within 2
 *                           may intercept first (one interception per
 *                           interceptor per turn). Aircraft can't capture.
 *   rebase(game, id, q, r)  move to an own city or carrier within range.
 *   patrol(game, id)        stay on intercept patrol until the next order.
 * Anti-air: Anti-Aircraft Gun (land, +100% vs air, intercepts), and cities
 * get +25% defense vs air with Radio. Strike strength: UNIT_TYPES[t].strike;
 * dogfight strength: .dogfight. Helicopter Gunship is a land unit.
 * game.fx gets { kind: "air", from, to, type, owner, intercepted, shot } for
 * the flyover animation. game.air = { stats: { strikes, intercepts, lost, rebases, patrols } }.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Combat = root.PlanetCombat, I = Combat._internals;

  var CITY_AIR = 4, AA_RANGE = 2;
  var UNITS = {
    fighter:        ["Fighter", 120, "flight", { strength: 30, strike: 30, dogfight: 40, airRange: 8, air: true, moves: 1, sight: 2 }],
    bomber:         ["Bomber", 150, "flight", { strength: 40, strike: 55, dogfight: 14, airRange: 10, air: true, moves: 1, vsCity: 0.5, sight: 2 }],
    jet_fighter:    ["Jet Fighter", 190, "radar", { strength: 50, strike: 45, dogfight: 70, airRange: 10, air: true, moves: 1, sight: 3 }],
    stealth_bomber: ["Stealth Bomber", 240, "stealth", { strength: 70, strike: 95, dogfight: 30, airRange: 14, air: true, moves: 1, vsCity: 0.5, evasion: 0.5, sight: 2 }],
    anti_aircraft:  ["Anti-Aircraft Gun", 100, "radio", { strength: 36, antiAir: 1.0 }],
    helicopter:     ["Helicopter Gunship", 170, "combined_arms", { strength: 60, moves: 4, bonusVs: { tank: 0.5, modern_armor: 0.5 } }],
    carrier:        ["Carrier", 180, "radar", { strength: 34, moves: 5, naval: true, ocean: true, cargo: 0, airCap: 3, sight: 3 }]
  };
  Object.keys(UNITS).forEach(function (k) {
    var d = UNITS[k], t = { name: d[0], moves: 1, canFound: false };
    Object.keys(d[3]).forEach(function (f) { t[f] = d[3][f]; });
    Rules.UNIT_TYPES[k] = t;
    var note = t.air ? "aircraft · strike " + t.strike + " · air " + t.dogfight + " · range " + t.airRange
      : t.airCap ? "naval · strength " + t.strength + " · carries " + t.airCap + " aircraft" : t.antiAir ? "strength " + t.strength + " · +100% vs air, intercepts" : "strength " + t.strength;
    Rules.BUILDS[k] = { name: d[0], cost: d[1], unit: k, minPop: 1, popCost: 0, tech: d[2], note: note };
  });
  // Upgrades.
  var Econ = root.PlanetEconomy;
  if (Econ && Econ.UPGRADES) {
    Econ.UPGRADES.fighter = ["jet_fighter"];
    Econ.UPGRADES.bomber = ["stealth_bomber"];
  }
  if (root.PlanetEras && root.PlanetEras.OBSOLETE) { root.PlanetEras.OBSOLETE.fighter = "radar"; root.PlanetEras.OBSOLETE.bomber = "stealth"; }

  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function isAir(type) { return !!T(type).air; }
  function state(game) {
    var s = game.air || (game.air = {});
    if (!s.stats) s.stats = { strikes: 0, intercepts: 0, lost: 0, rebases: 0, patrols: 0, kills: 0 };
    return s;
  }
  function atWar(game, a, b) { return a !== b && Combat.atWar(game, a, b); }
  function rangeOf(u) { return (T(u.type).airRange || 0) + (u.promos && u.promos.indexOf("range_air") !== -1 ? 2 : 0); }
  function aircraftAt(game, cid, q, r) { return game.units.filter(function (o) { return o.owner === cid && isAir(o.type) && o.q === q && o.r === r && o.base == null; }); }
  function onCarrier(game, carrier) { return game.units.filter(function (o) { return o.base === carrier.id; }); }

  // Bases: own cities with room, own carriers with room.
  function canBaseAt(game, u, q, r) {
    var c = game.cityAt.get(Rules.key(q, r));
    if (c && c.owner === u.owner) return aircraftAt(game, u.owner, q, r).filter(function (o) { return o !== u; }).length < CITY_AIR ? { city: c } : null;
    var carrier = game.units.filter(function (o) { return o.owner === u.owner && o.q === q && o.r === r && T(o.type).airCap; })[0];
    if (carrier && onCarrier(game, carrier).filter(function (o) { return o !== u; }).length < T(carrier.type).airCap) return { carrier: carrier };
    return null;
  }

  // What a strike on (q, r) would hit: { kind: "unit"|"city", defender, city, owner }.
  function targetAt(game, u, q, r) {
    var tile = game.index.get(Rules.key(q, r));
    if (!tile) return null;
    var city = game.cityAt.get(Rules.key(q, r));
    var foes = game.units.filter(function (o) { return o.q === q && o.r === r && o.owner !== u.owner && o.aboard == null && !isAir(o.type) && atWar(game, u.owner, o.owner); });
    if (city && city.owner !== u.owner && atWar(game, u.owner, city.owner)) return { kind: "city", city: city, owner: city.owner, tile: tile };
    var fighters = foes.filter(function (o) { return Combat.strengthOf(o.type) > 0; });
    if (!fighters.length) return null;
    fighters.sort(function (a, b) { return I.defenseOf(game, u, b).value - I.defenseOf(game, u, a).value; });
    return { kind: "unit", defender: fighters[0], owner: fighters[0].owner, tile: tile };
  }

  function canStrike(game, u, q, r) {
    if (!u || !isAir(u.type)) return { ok: false, reason: "Not an aircraft" };
    if (u.moves <= 0) return { ok: false, reason: "Already flew this turn" };
    var d = Rules.hexDistance(u.q, u.r, q, r);
    if (d < 1 || d > rangeOf(u)) return { ok: false, reason: "Out of range (" + rangeOf(u) + ")" };
    var t = targetAt(game, u, q, r);
    if (!t) return { ok: false, reason: "No enemy there" };
    return { ok: true, target: t };
  }

  function strikeValue(game, u, t) {
    var list = [];
    if (t.kind === "city" && T(u.type).vsCity) list.push({ label: "vs city", v: T(u.type).vsCity });
    Combat.extraMods(game, u, "ranged", { target: t, air: true }, list);
    var sum = list.reduce(function (s, m) { return s + m.v; }, 0);
    return { base: T(u.type).strike, mods: list, value: T(u.type).strike * (1 + sum) * I.hpFactor(u.hp) };
  }
  function airDefense(game, attacker, t) {
    var def = t.kind === "unit" ? I.defenseOf(game, attacker, t.defender) : Combat.cityDefense(game, t.city);
    var bonus = 0, lbl = null;
    if (t.kind === "unit" && T(t.defender.type).antiAir) { bonus = T(t.defender.type).antiAir; lbl = "Anti-air"; }
    if (t.kind === "city" && Rules.hasTech(game, "radio", t.city.owner)) { bonus = 0.25; lbl = "Air defense (Radio)"; }
    if (bonus) { def.mods = def.mods.concat([{ label: lbl, v: bonus }]); def.value *= (1 + bonus); }
    return def;
  }

  // Who would intercept u flying to (q, r)? Strongest eligible interceptor.
  function interceptorFor(game, u, q, r, owner) {
    var best = null, bs = 0;
    game.units.forEach(function (o) {
      if (o.owner === u.owner || !atWar(game, u.owner, o.owner) || o.interceptTurn === game.turn) return;
      var t = T(o.type), s = 0;
      if (t.air && o.patrol && Rules.hexDistance(o.q, o.r, q, r) <= Math.ceil(rangeOf(o) / 2)) s = t.dogfight;
      else if (t.antiAir && o.aboard == null && Rules.hexDistance(o.q, o.r, q, r) <= AA_RANGE) s = t.strength * (1 + t.antiAir) * 0.6;
      if (o.promos && o.promos.indexOf("interception") !== -1) s *= 1.33;
      s *= I.hpFactor(o.hp);
      if (s > bs) { bs = s; best = o; }
    });
    return best ? { unit: best, value: bs } : null;
  }

  function preview(game, u, q, r) {
    var c = canStrike(game, u, q, r);
    if (!c.ok) return c;
    var att = strikeValue(game, u, c.target), def = airDefense(game, u, c.target);
    var ratio = att.value / Math.max(0.1, def.value);
    var ic = interceptorFor(game, u, q, r);
    var hp = c.target.kind === "unit" ? c.target.defender.hp : c.target.city.hp;
    return { ok: true, air: true, kind: c.target.kind, attacker: att, defender: def, ratio: ratio,
      expDealt: Math.min(hp, I.damage(ratio, 1)), expTaken: Math.round(I.damage(1 / ratio, 1) * 0.35),
      interceptor: ic ? T(ic.unit.type).name : null, outcome: ic ? "Interception likely" : ratio >= 1.3 ? "Favourable" : "Even" };
  }

  function evasion(u) { return (T(u.type).evasion || 0) + (u.promos && u.promos.indexOf("evasion") !== -1 ? 0.5 : 0); }

  function strike(game, unitId, q, r) {
    var u = Rules.unitById(game, unitId);
    var c = canStrike(game, u, q, r);
    if (!c.ok) return c;
    var st = state(game), t = c.target, events = [];
    var res = { ok: true, air: true, kind: t.kind, events: events, from: { q: u.q, r: u.r }, to: { q: q, r: r }, attacker: u.id };
    var involve = [u.owner, t.owner];
    game.combatSeq = (game.combatSeq || 0) + 1;
    u.moves = 0; u.patrol = false; u.fought = true; st.stats.strikes++;
    var label = Rules.civName(game, u.owner) + " " + T(u.type).name;
    // Interception.
    var ic = interceptorFor(game, u, q, r);
    if (ic) {
      ic.unit.interceptTurn = game.turn;
      var ratio0 = ic.value / Math.max(1, (T(u.type).dogfight || 10) * I.hpFactor(u.hp));
      var hurt = Math.round(I.damage(ratio0, I.roll(game, ic.unit.id, u.id, "intercept")) * (1 - evasion(u)));
      u.hp -= hurt; st.stats.intercepts++;
      res.intercepted = { by: ic.unit.id, type: ic.unit.type, owner: ic.unit.owner, dealt: hurt };
      I.fx(game, { kind: "hit", q: u.q, r: u.r, amount: hurt, owner: u.owner });
      if (u.hp <= 0) {
        I.fx(game, { kind: "air", from: res.from, to: res.to, type: u.type, owner: u.owner, intercepted: true, shot: true });
        Rules.removeUnit(game, u); st.stats.lost++; res.died = true;
        I.event(game, events, "combat", label + " was shot down by " + Rules.civName(game, ic.unit.owner) + "'s " + T(ic.unit.type).name, involve);
        return res;
      }
    }
    I.fx(game, { kind: "air", from: res.from, to: res.to, type: u.type, owner: u.owner, intercepted: !!ic });
    var att = strikeValue(game, u, t), def = airDefense(game, u, t);
    var ratio = att.value / Math.max(0.1, def.value);
    var dealt = I.damage(ratio, I.roll(game, u.id, t.kind === "unit" ? t.defender.id : "c" + t.city.id, "air"));
    var flak = Math.round(I.damage(1 / ratio, I.roll(game, u.id, "flak", 2)) * (t.kind === "unit" && T(t.defender.type).antiAir ? 1 : 0.35));
    res.dealt = dealt; res.taken = flak;
    u.hp = Math.max(1, u.hp - flak);
    if (t.kind === "unit") {
      var d = t.defender; res.defender = d.id;
      dealt = Math.min(d.hp, dealt); d.hp -= dealt; d.fought = true; res.dealt = dealt;
      I.fx(game, { kind: "hit", q: q, r: r, amount: dealt, owner: d.owner });
      if (d.hp <= 0) {
        I.fx(game, { kind: "death", q: d.q, r: d.r, type: d.type, owner: d.owner });
        Rules.removeUnit(game, d); res.killed = true; st.stats.kills++;
        I.event(game, events, "combat", label + " destroyed " + Rules.civName(game, d.owner) + "'s " + T(d.type).name + " from the air", involve);
      } else I.event(game, events, "combat", label + " struck " + Rules.civName(game, d.owner) + "'s " + T(d.type).name + " (−" + dealt + ")", involve);
    } else {
      var city = t.city;
      // Air power alone can't take a city: it stops at 1 HP.
      dealt = Math.min(Math.max(0, city.hp - 1), dealt); res.dealt = dealt;
      city.hp -= dealt; city.hitTurn = game.turn;
      I.fx(game, { kind: "hit", q: q, r: r, amount: dealt, owner: city.owner, city: true });
      I.event(game, events, "combat", label + " bombed " + city.name + " (city HP " + city.hp + ")", involve);
    }
    if (root.PlanetPeace && root.PlanetPeace.record) root.PlanetPeace.record(game, res.killed || dealt >= flak ? u.owner : t.owner, res.killed || dealt >= flak ? t.owner : u.owner, res.killed ? "kill" : "hit");
    return res;
  }

  function rebase(game, unitId, q, r) {
    var u = Rules.unitById(game, unitId);
    if (!u || !isAir(u.type)) return { ok: false, reason: "Not an aircraft" };
    if (u.moves <= 0) return { ok: false, reason: "Already flew this turn" };
    if (Rules.hexDistance(u.q, u.r, q, r) > rangeOf(u)) return { ok: false, reason: "Out of range" };
    var b = canBaseAt(game, u, q, r);
    if (!b) return { ok: false, reason: "No room: aircraft base in own cities (" + CITY_AIR + ") or carriers" };
    var from = { q: u.q, r: u.r };
    u.q = q; u.r = r; u.base = b.carrier ? b.carrier.id : null; u.moves = 0; u.patrol = false; u.moved = true;
    Rules.reveal(game, q, r, Rules.sightOf(u.type), u.owner);
    state(game).stats.rebases++;
    I.fx(game, { kind: "air", from: from, to: { q: q, r: r }, type: u.type, owner: u.owner, rebase: true });
    return { ok: true, text: T(u.type).name + " rebased" };
  }
  function patrol(game, unitId) {
    var u = Rules.unitById(game, unitId);
    if (!u || !isAir(u.type)) return { ok: false, reason: "Not an aircraft" };
    u.patrol = true; u.moves = 0; state(game).stats.patrols++;
    return { ok: true, text: T(u.type).name + " on intercept patrol" };
  }
  function strikeTargets(game, u) {
    var out = [];
    Rules.tilesInRadius(game, u.q, u.r, rangeOf(u)).forEach(function (t) { if (canStrike(game, u, t.q, t.r).ok) out.push(t); });
    return out;
  }
  function baseTargets(game, u) {
    return Rules.tilesInRadius(game, u.q, u.r, rangeOf(u)).filter(function (t) { return !(t.q === u.q && t.r === u.r) && canBaseAt(game, u, t.q, t.r); });
  }

  // ---- AI
  function aiUnit(game, u) {
    if (u.moves <= 0) return;
    var t = T(u.type), war = game.civs.some(function (c, i) { return !c.eliminated && atWar(game, u.owner, i); });
    if (war) {
      var best = null, bs = t.dogfight > t.strike ? 4 : -3;
      strikeTargets(game, u).forEach(function (tile) {
        var pv = preview(game, u, tile.q, tile.r);
        if (!pv.ok) return;
        var s = pv.expDealt - pv.expTaken - (pv.interceptor ? 25 : 0) + (pv.kind === "unit" && pv.expDealt >= pv.defender.value ? 10 : 0) + (pv.kind === "city" ? 4 : 0);
        if (u.hp < 50) s -= 20;
        if (s > bs) { bs = s; best = tile; }
      });
      if (best) { strike(game, u.id, best.q, best.r); return; }
      // Move toward the front: the own city nearest an enemy city.
      var front = null, fd = 99;
      Rules.citiesOf(game, u.owner).forEach(function (c) {
        game.cities.forEach(function (e) {
          if (!atWar(game, u.owner, e.owner)) return;
          var d = Rules.hexDistance(c.q, c.r, e.q, e.r);
          if (d < fd && Rules.hexDistance(u.q, u.r, c.q, c.r) <= rangeOf(u) && canBaseAt(game, u, c.q, c.r)) { fd = d; front = c; }
        });
      });
      var here = 99;
      game.cities.forEach(function (e) { if (atWar(game, u.owner, e.owner)) here = Math.min(here, Rules.hexDistance(u.q, u.r, e.q, e.r)); });
      if (front && fd + 1 < here && !(front.q === u.q && front.r === u.r)) { rebase(game, u.id, front.q, front.r); return; }
    }
    if (t.dogfight >= t.strike && !u.patrol) patrol(game, u.id);
    else if (t.dogfight >= t.strike) u.moves = 0;
  }
  function buildScore(game, city, key) {
    var cid = city.owner, t = T(Rules.BUILDS[key].unit);
    var mine = game.units.filter(function (o) { return o.owner === cid && isAir(o.type); }).length +
      Rules.citiesOf(game, cid).filter(function (c) { return c.build && Rules.BUILDS[c.build] && isAir(Rules.BUILDS[c.build].unit); }).length;
    var cs = Rules.citiesOf(game, cid).length;
    var war = game.civs.some(function (c, i) { return !c.eliminated && atWar(game, cid, i); });
    var want = Math.max(1, Math.floor(cs / 2)) + (war ? 2 : 0);
    if (mine >= want) return 0;
    var fighters = game.units.filter(function (o) { return o.owner === cid && isAir(o.type) && T(o.type).dogfight >= T(o.type).strike; }).length;
    var isF = t.dogfight >= t.strike;
    return (war ? 5 : 2.6) + (isF && fighters * 2 < mine + 1 ? 1 : 0) + (!isF && war ? 1 : 0);
  }

  var MODS = function (game, cid) {
    return {
      moveCost: function (tile, cost, info) { return info && info.unit && isAir(info.unit.type) ? Infinity : cost; },
      onMove: function (g, u) {
        if (T(u.type).airCap) onCarrier(g, u).forEach(function (p) { p.q = u.q; p.r = u.r; });
      },
      onEndTurn: function (g, events, sci, c) {
        // Planes whose carrier sank go down with it.
        g.units = g.units.filter(function (p) { return !(p.owner === c && p.base != null && !Rules.unitById(g, p.base)); });
      }
    };
  };
  Rules.registerPlugin({ mods: MODS, world: { init: function (g) { state(g); } } });

  root.PlanetAir = {
    UNITS: UNITS, CITY_AIR: CITY_AIR, isAir: isAir, state: state, rangeOf: rangeOf, canBaseAt: canBaseAt, canStrike: canStrike,
    preview: preview, strike: strike, rebase: rebase, patrol: patrol, strikeTargets: strikeTargets, baseTargets: baseTargets,
    interceptorFor: interceptorFor, aiUnit: aiUnit, buildScore: buildScore, onCarrier: onCarrier
  };
})(typeof window !== "undefined" ? window : globalThis);
