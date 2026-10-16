/*
 * ranged.js — RANGED COMBAT. No DOM.
 * Units: Archer (Archery: ranged 6, defense 4, range 2), Catapult
 * (Mathematics: ranged 12, defense 4, range 2, +50% vs cities, 2 moves but
 * rough terrain costs +1), Composite Bowman (Construction: ranged 10,
 * defense 7, range 2). `strength` is their melee defense; `ranged` is attack.
 * A ranged attack hits a target within range and in line of sight, takes no
 * retaliation, and the attacker stays put (it uses all its moves). It can
 * bring a city to 0 HP but never captures. Ships bombarding land use the
 * same path (range 1, their strength as ranged strength).
 * Line of sight: mountains always block; hills, forest and jungle block
 * unless the shooter stands on hills (or is a city). Adjacent is always seen.
 * City strike: a city with Walls, or any capital, may shoot once per turn
 * (strength 60% of its defense, range 2).
 * combat.js hands ranged attacks to this module through Combat.setRanged().
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Combat = root.PlanetCombat;
  var I = Combat._internals;

  var UNITS = {
    archer:           { name: "Archer",           moves: 1, canFound: false, strength: 4, ranged: 6,  range: 2 },
    catapult:         { name: "Catapult",         moves: 2, canFound: false, strength: 4, ranged: 12, range: 2, vsCity: 0.5, rough: 1 },
    composite_bowman: { name: "Composite Bowman", moves: 1, canFound: false, strength: 7, ranged: 10, range: 2 }
  };
  var BUILDS = {
    archer:           { name: "Archer",           cost: 14, unit: "archer",           minPop: 1, popCost: 0, tech: "archery",      note: "ranged 6 · range 2" },
    catapult:         { name: "Catapult",         cost: 30, unit: "catapult",         minPop: 1, popCost: 0, tech: "mathematics",  note: "ranged 12 · +50% vs cities" },
    composite_bowman: { name: "Composite Bowman", cost: 26, unit: "composite_bowman", minPop: 1, popCost: 0, tech: "construction", note: "ranged 10 · range 2" }
  };
  Object.keys(UNITS).forEach(function (k) { Rules.UNIT_TYPES[k] = UNITS[k]; });
  Object.keys(BUILDS).forEach(function (k) { Rules.BUILDS[k] = BUILDS[k]; });

  var ROUGH = { hills: true, forest: true, jungle: true };
  var CITY_STRIKE_RANGE = 2, CITY_STRIKE_FACTOR = 0.6;

  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function isRanged(type) { return !!T(type).ranged; }
  function rangeOf(type) { return T(type).range || 0; }

  // ---------------------------------------------------------- line of sight
  // Axial hex line (cube lerp), nudged both ways; visible if either line is clear.
  function lineTiles(game, a, b, nudge) {
    var n = Rules.hexDistance(a.q, a.r, b.q, b.r), out = [];
    var ax = a.q + nudge, az = a.r + nudge, ay = -ax - az;
    var bx = b.q + nudge, bz = b.r + nudge, by = -bx - bz;
    for (var i = 1; i < n; i++) {
      var t = i / n;
      var x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      var rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
      var dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
      if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
      var tile = game.index.get(Rules.key(rx, rz));
      if (tile) out.push(tile);
    }
    return out;
  }

  function blocks(tile, high) {
    if (tile.biome === "mountain") return true;
    return !high && !!ROUGH[tile.biome];
  }

  // Can a shooter at `from` see `to`? high = shooter on hills (or a city).
  function lineOfSight(game, from, to, high) {
    if (Rules.hexDistance(from.q, from.r, to.q, to.r) <= 1) return true;
    var clear = function (eps) { return !lineTiles(game, from, to, eps).some(function (t) { return blocks(t, high); }); };
    return clear(1e-6) || clear(-1e-6);
  }

  function shooterHigh(game, q, r) {
    var t = game.index.get(Rules.key(q, r));
    return t.biome === "hills" || game.cityAt.has(Rules.key(q, r));
  }

  // ---------------------------------------------------------- unit attacks
  // Ranged path: ranged units always; ships only when bombarding land.
  function claims(game, u, q, r) {
    if (!u) return false;
    if (isRanged(u.type)) return true;
    var tile = game.index.get(Rules.key(q, r));
    return !!(T(u.type).naval && tile && !Rules.isWater(tile));
  }

  function shotOf(u) {
    var t = T(u.type);
    var extra = u.promos && u.promos.indexOf("range") !== -1 ? 1 : 0;
    return t.ranged ? { strength: t.ranged, range: t.range + extra } : { strength: t.strength || 0, range: 1 };
  }

  function canRanged(game, u, q, r) {
    var shot = shotOf(u);
    if (!u || shot.strength <= 0) return { ok: false, reason: "This unit cannot fight" };
    if (u.moves <= 0) return { ok: false, reason: "No moves left" };
    if (u.aboard != null) return { ok: false, reason: "Land the unit first" };
    var d = Rules.hexDistance(u.q, u.r, q, r);
    if (d < 1 || d > shot.range) return { ok: false, reason: "Out of range (" + shot.range + ")" };
    var tile = game.index.get(Rules.key(q, r));
    if (!tile) return { ok: false, reason: "Cannot attack there" };
    if (Rules.isWater(tile) && !T(u.type).naval) return { ok: false, reason: "Land units can't attack ships at sea" };
    if (!lineOfSight(game, u, tile, shooterHigh(game, u.q, u.r))) return { ok: false, reason: "No line of sight" };
    var t = Combat.targetOn(game, u, q, r);
    if (!t.kind) return { ok: false, reason: "No enemy there" };
    if (t.kind === "capture" || t.kind === "settler") return { ok: false, reason: t.kind === "capture" ? "City at 0 HP: a melee unit must take it" : "Ranged units can't capture" };
    t.tile = tile;
    return { ok: true, target: t, ranged: true };
  }

  function attackValue(game, u, t) {
    var shot = shotOf(u), list = [];
    if (t.kind === "city" && T(u.type).vsCity) list.push({ label: "vs city", v: T(u.type).vsCity });
    var bonus = T(u.type).bonusVs;
    if (bonus && t.kind === "unit" && bonus[t.defender.type]) list.push({ label: "vs " + T(t.defender.type).name, v: bonus[t.defender.type] });
    if (root.PlanetCombat.extraMods) root.PlanetCombat.extraMods(game, u, "ranged", { target: t }, list);
    if (u.hp < I.MAX_HP) list.push({ label: "Wounded (" + u.hp + " HP)", v: 0, hp: true });
    var sum = list.reduce(function (s, m) { return s + m.v; }, 0);
    return { base: shot.strength, mods: list, value: shot.strength * (1 + sum) * I.hpFactor(u.hp) };
  }

  function rangedPreview(game, u, q, r) {
    var c = canRanged(game, u, q, r);
    if (!c.ok) return c;
    var t = c.target, out = { ok: true, ranged: true, kind: t.kind, attacker: attackValue(game, u, t) };
    out.attacker.name = T(u.type).name + (T(u.type).ranged ? " (ranged)" : " (bombard)");
    out.attacker.hp = u.hp;
    var def = t.kind === "unit" ? I.defenseOf(game, u, t.defender) : Combat.cityDefense(game, t.city);
    def.name = t.kind === "unit" ? T(t.defender.type).name : t.city.name + " (city)";
    def.hp = t.kind === "unit" ? t.defender.hp : t.city.hp;
    out.defender = def;
    var ratio = out.attacker.value / Math.max(0.1, def.value);
    out.ratio = ratio;
    out.expDealt = Math.min(def.hp, I.damage(ratio, 1));
    out.expTaken = 0;
    out.range = shotOf(u).range;
    out.outcome = def.hp - out.expDealt <= 0 ? (t.kind === "city" ? "City falls to 0 HP (melee must take it)" : "Likely kill")
      : ratio >= 1.3 ? "Strong shot" : ratio <= 0.77 ? "Weak shot: chip damage" : "Fair shot";
    return out;
  }

  // Damage one target; no retaliation, the shooter stays.
  function strike(game, shooter, value, q, r, t, label, events) {
    game.combatSeq = (game.combatSeq || 0) + 1;
    var def = t.kind === "unit" ? I.defenseOf(game, shooter, t.defender) : Combat.cityDefense(game, t.city);
    var ratio = value / Math.max(0.1, def.value);
    var dealt = I.damage(ratio, I.roll(game, shooter.id, t.kind === "unit" ? t.defender.id : "c" + t.city.id, "ranged"));
    var res = { ok: true, ranged: true, kind: t.kind, events: events, from: { q: shooter.q, r: shooter.r }, to: { q: q, r: r }, taken: 0 };
    var involve = [shooter.owner, t.owner];
    I.fx(game, { kind: "shot", from: res.from, to: res.to, owner: shooter.owner, type: shooter.type, city: String(shooter.id).charAt(0) === "c" });
    if (t.kind === "unit") {
      var d = t.defender;
      dealt = Math.min(d.hp, dealt);
      d.hp -= dealt; res.dealt = dealt;
      I.fx(game, { kind: "hit", q: q, r: r, amount: dealt, owner: d.owner });
      if (d.hp <= 0) {
        I.fx(game, { kind: "death", q: d.q, r: d.r, type: d.type, owner: d.owner });
        Rules.removeUnit(game, d); res.killed = true;
        I.event(game, events, "combat", label + " destroyed " + I.name(game, d.owner) + "'s " + T(d.type).name, involve);
      } else I.event(game, events, "combat", label + " hit " + I.name(game, d.owner) + "'s " + T(d.type).name + " (−" + dealt + ")", involve);
    } else {
      var city = t.city;
      dealt = Math.min(city.hp, dealt);
      city.hp -= dealt; city.hitTurn = game.turn; res.dealt = dealt;
      I.fx(game, { kind: "hit", q: q, r: r, amount: dealt, owner: city.owner, city: true });
      I.event(game, events, "combat", label + " bombarded " + city.name + " (city HP " + city.hp + ")", involve);
    }
    return res;
  }

  function rangedAttack(game, unitId, q, r) {
    var u = Rules.unitById(game, unitId);
    var c = canRanged(game, u, q, r);
    if (!c.ok) return c;
    var v = attackValue(game, u, c.target).value;
    u.moves = 0; u.moved = true; u.fort = false; u.fortifying = false; u.fought = true;
    return strike(game, u, v, q, r, c.target, I.name(game, u.owner) + "'s " + T(u.type).name, []);
  }

  // ---------------------------------------------------------- city strike
  function cityCanStrike(game, city) {
    return (city.buildings || []).indexOf("walls") !== -1 || !!city.capital;
  }
  function cityStrikeValue(game, city) {
    return Combat.cityDefense(game, city).value * CITY_STRIKE_FACTOR;
  }

  // Enemy units a city could shoot this turn.
  function cityTargets(game, city) {
    if (!cityCanStrike(game, city) || city.struck === game.turn || city.hp <= 0) return [];
    var out = [];
    Rules.tilesInRadius(game, city.q, city.r, CITY_STRIKE_RANGE).forEach(function (tile) {
      if (tile.q === city.q && tile.r === city.r) return;
      var probe = { owner: city.owner, q: city.q, r: city.r, type: "warrior", id: "c" + city.id, hp: 100 };
      var t = Combat.targetOn(game, probe, tile.q, tile.r);
      if (t.kind !== "unit") return;
      if (!lineOfSight(game, city, tile, true)) return;
      out.push({ tile: tile, target: t });
    });
    return out;
  }

  function cityPreview(game, city, q, r) {
    var hit = cityTargets(game, city).filter(function (x) { return x.tile.q === q && x.tile.r === r; })[0];
    if (!hit) return { ok: false, reason: "No target for " + city.name };
    var v = cityStrikeValue(game, city), def = I.defenseOf(game, null, hit.target.defender);
    var ratio = v / Math.max(0.1, def.value);
    def.name = T(hit.target.defender.type).name; def.hp = hit.target.defender.hp;
    return { ok: true, ranged: true, kind: "unit", ratio: ratio, range: CITY_STRIKE_RANGE,
      attacker: { name: city.name + " (city strike)", base: Math.round(v * 10) / 10, mods: [], value: v, hp: city.hp },
      defender: def, expDealt: Math.min(def.hp, I.damage(ratio, 1)), expTaken: 0,
      outcome: def.hp - I.damage(ratio, 1) <= 0 ? "Likely kill" : "No retaliation" };
  }

  function cityStrike(game, cityId, q, r) {
    var city = Rules.cityById(game, cityId);
    if (!city) return { ok: false, reason: "No city" };
    var hit = cityTargets(game, city).filter(function (x) { return x.tile.q === q && x.tile.r === r; })[0];
    if (!hit) return { ok: false, reason: cityCanStrike(game, city) ? (city.struck === game.turn ? "Already struck this turn" : "No target in range") : "Needs Walls (or be the capital)" };
    city.struck = game.turn;
    var shooter = { id: "c" + city.id, owner: city.owner, q: city.q, r: city.r, type: "warrior", hp: 100 };
    return strike(game, shooter, cityStrikeValue(game, city), q, r, hit.target, city.name, []);
  }

  // AI: every city shoots its best target (most damage, kills first).
  function aiCityStrikes(game, cid) {
    var out = [];
    Rules.citiesOf(game, cid).forEach(function (c) {
      var best = null, bs = -1;
      cityTargets(game, c).forEach(function (x) {
        var pv = cityPreview(game, c, x.tile.q, x.tile.r);
        var s = pv.expDealt + (pv.expDealt >= pv.defender.hp ? 50 : 0);
        if (s > bs) { bs = s; best = x.tile; }
      });
      if (best) out.push(cityStrike(game, c.id, best.q, best.r));
    });
    return out;
  }

  // AI: tile two hexes from a city with a clear shot, nearest to the unit.
  function standoff(game, u, city) {
    var best = null, bd = Infinity;
    Rules.tilesInRadius(game, city.q, city.r, 2).forEach(function (t) {
      if (Rules.hexDistance(t.q, t.r, city.q, city.r) !== 2 || Rules.isWater(t) || Rules.moveCost(t) === Infinity) return;
      if (game.cityAt.has(Rules.key(t.q, t.r)) || !lineOfSight(game, t, city, t.biome === "hills")) return;
      var d = Rules.hexDistance(u.q, u.r, t.q, t.r);
      if (d < bd) { bd = d; best = t; }
    });
    return best;
  }

  function enemyWithin(game, u, n) {
    return game.units.some(function (o) {
      return o.owner !== u.owner && Combat.strengthOf(o.type) > 0 && Combat.atWar(game, u.owner, o.owner) &&
        Rules.hexDistance(u.q, u.r, o.q, o.r) <= n;
    });
  }

  function makeModifiers(game, cid) {
    return {
      // Catapults drag: rough terrain costs 1 more.
      moveCost: function (tile, cost, info) {
        var u = info && info.unit;
        return u && T(u.type).rough && ROUGH[tile.biome] && cost !== Infinity ? cost + T(u.type).rough : cost;
      }
    };
  }

  Combat.setRanged({ claims: claims, canAttack: canRanged, preview: rangedPreview, attack: rangedAttack });

  root.PlanetRanged = {
    UNITS: UNITS, isRanged: isRanged, rangeOf: rangeOf, lineOfSight: lineOfSight, lineTiles: lineTiles,
    canRanged: canRanged, preview: rangedPreview, attack: rangedAttack,
    cityCanStrike: cityCanStrike, cityTargets: cityTargets, cityPreview: cityPreview, cityStrike: cityStrike,
    aiCityStrikes: aiCityStrikes, standoff: standoff, enemyWithin: enemyWithin, makeModifiers: makeModifiers,
    CITY_STRIKE_RANGE: CITY_STRIKE_RANGE
  };
})(typeof window !== "undefined" ? window : globalThis);
