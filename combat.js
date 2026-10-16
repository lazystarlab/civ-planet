/*
 * combat.js — COMBAT. No DOM.
 * Units have strength (UNIT_TYPES[type].strength) and hp (0-100). Moving into
 * an enemy unit or city while at war attacks it (one exchange per attack,
 * Civ V style). Damage depends on the effective strength ratio:
 *   effective = base × (1 + modifiers) × (0.5 + 0.5 × hp/100)
 *   damage to defender = 30 × ratio^0.9 × roll,  to attacker = 30 / ratio^0.9 × roll
 *   roll in [0.75, 1.25] from a seeded hash of (seed, game.combatSeq, ids),
 *   so results are deterministic per seed and replay identically after a load.
 * Modifiers: defender on hills/forest/jungle +25%, fortified +25%, unit in a
 * city +25%; attacker onto a river tile -25% (river crossing); Spearman +50%
 * vs Horseman. Cities defend with 4 + 0.75 × pop (×2 with Walls, plus half the
 * best garrison unit's strength) and have hp; attacks on a city tile hit the city;
 * at 0 hp a melee unit moving in captures (pop-1 cities are razed). Losing the
 * capital moves the capital to the civ's biggest remaining city; losing the
 * last city eliminates the civ.
 * Hooks: per-civ onEndTurn heals (+10, +20 in a friendly city; cities +10;
 * nothing on a turn the unit fought or the city was hit)
 * and turns "did not move" or F (fortify) into the fortified bonus.
 * game.fx (not saved) collects { kind, ... } records for the renderer.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Diplo = root.PlanetDiplomacy;

  var MAX_HP = 100;
  var BASE_DAMAGE = 30;
  var DEFENSIVE_TERRAIN = { hills: 0.25, forest: 0.25, jungle: 0.25 };

  function strengthOf(type) { var t = Rules.UNIT_TYPES[type]; return (t && t.strength) || 0; }
  function isNaval(type) { var t = Rules.UNIT_TYPES[type]; return !!(t && t.naval); }
  function isAir(type) { var t = Rules.UNIT_TYPES[type]; return !!(t && t.air); }
  function atWar(game, a, b) { var r = Diplo.rel(game, a, b); return !!(r && r.war); }
  function tileAt(game, q, r) { return game.index.get(Rules.key(q, r)); }
  function unitsOn(game, q, r) { return game.units.filter(function (u) { return u.q === q && u.r === r; }); }
  function hpFactor(hp) { return 0.5 + 0.5 * Math.max(0, hp) / MAX_HP; }

  function cityBase(city) {
    var walls = (city.buildings || []).indexOf("walls") !== -1;
    return { base: 4 + 0.75 * city.pop, walls: walls };
  }

  function roll(game, a, b, salt) {
    var h = 2166136261, s = String(game.seed) + ":" + (game.combatSeq || 0) + ":" + a + ":" + b + ":" + salt;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 0.75 + 0.5 * ((h >>> 0) / 4294967296);
  }

  /*
   * What is on a target tile for attacker u: { kind, defender, city }.
   * kind: "unit" (best defender), "city" (empty city with hp), "capture"
   * (empty city at 0 hp), "settler" (only settlers), or null (nothing to attack).
   */
  function targetOn(game, u, q, r) {
    // Cargo is not a target: it sinks with its ship.
    // Aircraft based on the tile are not ground targets (air.js handles them).
    var foes = unitsOn(game, q, r).filter(function (o) { return o.owner !== u.owner && o.aboard == null && !isAir(o.type); });
    var city = game.cityAt.get(Rules.key(q, r));
    if (city && city.owner === u.owner) city = null;
    var owner = foes.length ? foes[0].owner : city ? city.owner : -1;
    if (owner < 0 || !atWar(game, u.owner, owner)) return { kind: null };
    var fighters = foes.filter(function (o) { return strengthOf(o.type) > 0; });
    // A city is always fought as a city; its garrison only adds strength.
    if (city) return { kind: city.hp > 0 ? "city" : "capture", city: city, settlers: foes, owner: owner };
    if (fighters.length) {
      var best = null, bestS = -1;
      fighters.forEach(function (o) {
        var s = defenseOf(game, u, o).value;
        if (s > bestS) { bestS = s; best = o; }
      });
      return { kind: "unit", defender: best, city: city, owner: owner };
    }
    return { kind: "settler", settlers: foes, owner: owner };
  }

  // Extra strength modifiers from other modules (promotions, resources, air):
  // fn(game, unit, role, ctx) -> [{ label, v }]; role "att" | "def" | "ranged".
  var EXTRA = [];
  function addStrengthMod(fn) { EXTRA.push(fn); }
  function extra(game, u, role, ctx, list) {
    for (var i = 0; i < EXTRA.length; i++) { var r = EXTRA[i](game, u, role, ctx || {}); if (r) for (var j = 0; j < r.length; j++) list.push(r[j]); }
  }
  function mods(list) { return list.reduce(function (s, m) { return s + m.v; }, 0); }

  function attackOf(game, u, target) {
    var list = [];
    var tt = target.kind === "unit" ? Rules.UNIT_TYPES[target.defender.type] : null;
    var bonus = Rules.UNIT_TYPES[u.type].bonusVs;
    if (bonus && tt && target.defender && bonus[target.defender.type]) list.push({ label: "vs " + tt.name, v: bonus[target.defender.type] });
    var dt = target.tile;
    if (dt && dt.river > 0) list.push({ label: "River crossing", v: -0.25 });
    if (u.vet) list.push({ label: "Veteran", v: 0.2 });
    extra(game, u, "att", { target: target, tile: dt }, list);
    if (u.hp < MAX_HP) list.push({ label: "Wounded (" + u.hp + " HP)", v: 0, hp: true });
    var base = strengthOf(u.type);
    return { base: base, mods: list, value: base * (1 + mods(list)) * hpFactor(u.hp) };
  }

  function defenseOf(game, attacker, d) {
    var list = [];
    var t = tileAt(game, d.q, d.r);
    if (DEFENSIVE_TERRAIN[t.biome]) list.push({ label: (t.biome[0].toUpperCase() + t.biome.slice(1)), v: DEFENSIVE_TERRAIN[t.biome] });
    if (d.fort) list.push({ label: "Fortified", v: 0.25 });
    if (d.vet) list.push({ label: "Veteran", v: 0.2 });
    var c = game.cityAt.get(Rules.key(d.q, d.r));
    if (c && c.owner === d.owner) list.push({ label: "In city", v: 0.25 });
    var bonus = Rules.UNIT_TYPES[d.type].bonusVs;
    if (attacker && bonus && bonus[attacker.type]) list.push({ label: "vs " + Rules.UNIT_TYPES[attacker.type].name, v: bonus[attacker.type] });
    extra(game, d, "def", { attacker: attacker, tile: t }, list);
    if (d.hp < MAX_HP) list.push({ label: "Wounded (" + d.hp + " HP)", v: 0, hp: true });
    var base = strengthOf(d.type);
    return { base: base, mods: list, value: base * (1 + mods(list)) * hpFactor(d.hp) };
  }

  function cityDefense(game, city) {
    var cb = cityBase(city), list = [];
    if (cb.walls) list.push({ label: "Walls", v: 1 });
    var g = garrisonOf(game, city);
    if (g) list.push({ label: "Garrison (" + Rules.UNIT_TYPES[g.type].name + ")", v: 0.5 * strengthOf(g.type) * hpFactor(g.hp) / cb.base });
    var t = tileAt(game, city.q, city.r);
    if (DEFENSIVE_TERRAIN[t.biome]) list.push({ label: "Hills/forest", v: DEFENSIVE_TERRAIN[t.biome] });
    if (city.hp < MAX_HP) list.push({ label: "Damaged (" + city.hp + " HP)", v: 0, hp: true });
    return { base: cb.base, mods: list, value: cb.base * (1 + mods(list)) * hpFactor(city.hp) };
  }

  function garrisonOf(game, city) {
    var best = null;
    unitsOn(game, city.q, city.r).forEach(function (u) {
      if (u.owner === city.owner && strengthOf(u.type) > 0 && !isAir(u.type) && (!best || strengthOf(u.type) > strengthOf(best.type))) best = u;
    });
    return best;
  }

  function damage(ratio, r) { return Math.max(1, Math.round(BASE_DAMAGE * Math.pow(ratio, 0.9) * r)); }

  // Can unit u attack tile (q, r) right now? Returns the target or a reason.
  // Ranged attacks (ranged units, ship bombard) are handled by ranged.js.
  var RANGED = null;
  function setRanged(handler) { RANGED = handler; }

  function canAttack(game, u, q, r) {
    if (u && isAir(u.type)) return { ok: false, reason: "Aircraft fly missions (Strike)" };
    if (RANGED && RANGED.claims(game, u, q, r)) return RANGED.canAttack(game, u, q, r);
    if (!u || strengthOf(u.type) <= 0) return { ok: false, reason: "This unit cannot fight" };
    if (u.moves <= 0) return { ok: false, reason: "No moves left" };
    if (Rules.hexDistance(u.q, u.r, q, r) !== 1) return { ok: false, reason: "Must be adjacent" };
    var tile = tileAt(game, q, r);
    var naval = isNaval(u.type);
    if (!tile) return { ok: false, reason: "Cannot attack there" };
    if (Rules.isWater(tile)) {
      if (!naval) return { ok: false, reason: "Land units can't attack ships at sea" };
      if (tile.biome === "deep_ocean" && !Rules.UNIT_TYPES[u.type].ocean) return { ok: false, reason: "A Trireme can't reach deep ocean" };
    } else if (Rules.moveCost(tile) === Infinity) return { ok: false, reason: "Cannot attack there" };
    if (u.aboard != null) return { ok: false, reason: "Land the unit first" };
    var t = targetOn(game, u, q, r);
    if (!t.kind) return { ok: false, reason: "No enemy there" };
    if (naval && (t.kind === "capture" || t.kind === "settler")) return { ok: false, reason: "Ships can bombard but not capture" };
    t.tile = tile;
    return { ok: true, target: t };
  }

  // Combat preview: strengths, modifiers and expected result (average roll).
  function preview(game, u, q, r) {
    if (RANGED && RANGED.claims(game, u, q, r)) return RANGED.preview(game, u, q, r);
    var c = canAttack(game, u, q, r);
    if (!c.ok) return c;
    var t = c.target, out = { ok: true, kind: t.kind, attacker: attackOf(game, u, t) };
    out.attacker.name = Rules.UNIT_TYPES[u.type].name; out.attacker.hp = u.hp;
    if (t.kind === "capture" || t.kind === "settler") {
      out.outcome = t.kind === "capture" ? (t.city.pop <= 1 ? "Raze " : "Capture ") + t.city.name : "Capture the settler" + (t.settlers.length > 1 ? "s" : "");
      out.defender = { name: t.kind === "capture" ? t.city.name : "Settler", value: 0, base: 0, mods: [], hp: t.city ? t.city.hp : 100 };
      return out;
    }
    var def = t.kind === "unit" ? defenseOf(game, u, t.defender) : cityDefense(game, t.city);
    def.name = t.kind === "unit" ? Rules.UNIT_TYPES[t.defender.type].name : t.city.name + " (city)";
    def.hp = t.kind === "unit" ? t.defender.hp : t.city.hp;
    out.defender = def;
    var ratio = out.attacker.value / Math.max(0.1, def.value);
    out.expDealt = Math.min(def.hp, damage(ratio, 1));
    out.expTaken = Math.min(u.hp, damage(1 / ratio, 1));
    out.ratio = ratio;
    var defLeft = def.hp - out.expDealt, attLeft = u.hp - out.expTaken;
    out.outcome = defLeft <= 0 ? (t.kind === "city" ? "City falls to 0 HP: move in to take it" : "Likely victory")
      : attLeft <= 0 ? "Likely defeat"
      : ratio >= 1.3 ? "Favourable" : ratio <= 0.77 ? "Costly" : "Even fight";
    return out;
  }

  function fx(game, rec) { (game.fx = game.fx || []).push(rec); }

  function moveIn(game, u, q, r) {
    Rules.placeUnit(game, u, q, r);
    Rules.reveal(game, q, r, Rules.sightOf(u.type), u.owner);
  }

  function event(game, events, kind, text, involve) {
    var e = { kind: kind, text: text, cid: involve.indexOf(0) !== -1 ? 0 : null };
    if (events) events.push(e);
    if (e.cid === 0 || kind === "elim") Rules.logEvent(game, kind === "elim" ? "war" : "combat", text, e.cid);
    return e;
  }

  function name(game, cid) { return Rules.civName(game, cid); }

  /*
   * Attack (q, r) with unit id. Mutates the game; returns
   * { ok, kind, dealt, taken, killed, died, captured, razed, events }.
   */
  function attack(game, unitId, q, r) {
    var u = Rules.unitById(game, unitId);
    if (RANGED && RANGED.claims(game, u, q, r)) return RANGED.attack(game, unitId, q, r);
    var c = canAttack(game, u, q, r);
    if (!c.ok) return c;
    var t = c.target, events = [], res = { ok: true, kind: t.kind, events: events, from: { q: u.q, r: u.r }, to: { q: q, r: r } };
    var involve = [u.owner, t.owner];
    game.combatSeq = (game.combatSeq || 0) + 1;
    u.moves = 0; u.moved = true; u.fort = false; u.fortifying = false; u.fought = true;
    fx(game, { kind: "lunge", unit: u.id, from: res.from, to: res.to, owner: u.owner, target: t.owner, type: u.type });

    if (t.kind === "settler") {
      t.settlers.forEach(function (s) { s.owner = u.owner; s.target = null; s.role = null; s.fort = false; });
      moveIn(game, u, q, r);
      res.captured = "settler";
      event(game, events, "combat", name(game, u.owner) + " captured a " + name(game, t.owner) + " settler", involve);
      return res;
    }
    if (t.kind === "capture") {
      captureCity(game, u, t.city, events, res);
      return res;
    }
    var att = attackOf(game, u, t);
    var def = t.kind === "unit" ? defenseOf(game, u, t.defender) : cityDefense(game, t.city);
    var ratio = att.value / Math.max(0.1, def.value);
    var dealt = damage(ratio, roll(game, u.id, t.kind === "unit" ? t.defender.id : "c" + t.city.id, 1));
    var taken = damage(1 / ratio, roll(game, u.id, t.kind === "unit" ? t.defender.id : "c" + t.city.id, 2));
    res.dealt = dealt; res.taken = taken;
    if (t.kind === "unit") {
      var d = t.defender;
      d.hp -= dealt; u.hp -= taken; d.fought = true;
      if (d.hp <= 0 && u.hp <= 0) u.hp = 1;
      fx(game, { kind: "hit", q: q, r: r, amount: dealt, owner: d.owner });
      fx(game, { kind: "hit", q: res.from.q, r: res.from.r, amount: taken, owner: u.owner });
      var dName = Rules.UNIT_TYPES[d.type].name, aName = Rules.UNIT_TYPES[u.type].name;
      if (d.hp <= 0) {
        fx(game, { kind: "death", q: d.q, r: d.r, type: d.type, owner: d.owner });
        Rules.removeUnit(game, d);
        res.killed = true;
        event(game, events, "combat", name(game, u.owner) + " " + aName + " destroyed a " + name(game, d.owner) + " " + dName, involve);
        // Advance if the tile is now clear of enemies and is not a city.
        var left = unitsOn(game, q, r).filter(function (o) { return o.owner !== u.owner; });
        // Ships advance only onto water, land units only onto land.
        var canAdvance = isNaval(u.type) === Rules.isWater(t.tile);
        if (!canAdvance) { /* stay put */ }
        else if (!left.length && !game.cityAt.has(Rules.key(q, r))) moveIn(game, u, q, r);
        else if (!left.some(function (o) { return strengthOf(o.type) > 0; }) && !game.cityAt.has(Rules.key(q, r))) {
          left.forEach(function (s) { s.owner = u.owner; s.target = null; });
          moveIn(game, u, q, r);
        }
      } else if (u.hp <= 0) {
        fx(game, { kind: "death", q: u.q, r: u.r, type: u.type, owner: u.owner });
        Rules.removeUnit(game, u);
        res.died = true;
        event(game, events, "combat", name(game, u.owner) + " " + aName + " fell attacking a " + name(game, d.owner) + " " + dName, involve);
      } else {
        event(game, events, "combat", name(game, u.owner) + " " + aName + " hit a " + name(game, d.owner) + " " + dName + " (−" + dealt + " / −" + taken + ")", involve);
      }
    } else {
      var city = t.city;
      city.hp = Math.max(0, city.hp - dealt); city.hitTurn = game.turn;
      u.hp -= taken;
      if (u.hp <= 0) { if (city.hp === 0) u.hp = 1; }
      fx(game, { kind: "hit", q: q, r: r, amount: dealt, owner: city.owner, city: true });
      fx(game, { kind: "hit", q: res.from.q, r: res.from.r, amount: taken, owner: u.owner });
      if (u.hp <= 0) {
        fx(game, { kind: "death", q: u.q, r: u.r, type: u.type, owner: u.owner });
        Rules.removeUnit(game, u);
        res.died = true;
        event(game, events, "combat", name(game, u.owner) + " lost a unit assaulting " + city.name, involve);
      } else {
        event(game, events, "combat", name(game, u.owner) + " assaulted " + city.name + " (city HP " + city.hp + ")", involve);
      }
    }
    return res;
  }

  function captureCity(game, u, city, events, res) {
    var prev = city.owner, wasCapital = city.capital;
    var involve = [u.owner, prev];
    // The garrison falls with the city.
    game.units = game.units.filter(function (o) { return !(o.q === city.q && o.r === city.r && o.owner !== u.owner); });
    moveIn(game, u, city.q, city.r);
    if (city.pop <= 1) {
      // Raze: the city and its territory vanish.
      game.cities.splice(game.cities.indexOf(city), 1);
      game.cityAt.delete(Rules.key(city.q, city.r));
      game.owner.forEach(function (cid, k) { if (cid === city.id) game.owner.delete(k); });
      res.razed = city.name;
      event(game, events, "combat", name(game, u.owner) + " razed " + city.name, involve);
    } else {
      city.owner = u.owner; city.pop -= 1; city.hp = 50; city.build = null; city.prod = 0;
      city.capital = false; city.food = 0;
      res.captured = city.name;
      event(game, events, "combat", name(game, u.owner) + " captured " + city.name + " from " + name(game, prev), involve);
    }
    fx(game, { kind: "capture", q: city.q, r: city.r, owner: u.owner });
    if (!Rules.citiesOf(game, prev).length) eliminate(game, prev, u.owner, events);
    else if (wasCapital) relocateCapital(game, prev, events);
  }

  /*
   * After a capital falls, the civ's biggest remaining city becomes its
   * capital (ties: highest production, then oldest, then lowest id).
   */
  function relocateCapital(game, cid, events) {
    var cs = Rules.citiesOf(game, cid);
    if (!cs.length || cs.some(function (c) { return c.capital; })) return null;
    cs.sort(function (a, b) {
      return (b.pop - a.pop) || (Rules.cityYield(game, b).prod - Rules.cityYield(game, a).prod) ||
        (a.founded - b.founded) || (a.id - b.id);
    });
    var nc = cs[0];
    nc.capital = true;
    var text = name(game, cid) + " moves its capital to " + nc.name;
    var e = { kind: "capital", text: text, cid: null, city: nc.id };
    if (events) events.push(e);
    Rules.logEvent(game, "capital", text, null);
    fx(game, { kind: "capital", q: nc.q, r: nc.r, owner: cid });
    return nc;
  }

  // A civ with no cities left is out (settlers alone do not keep it alive):
  // its units disband and its wars end.
  function eliminate(game, cid, by, events) {
    var cv = game.civs[cid];
    if (cv.eliminated) return;
    cv.eliminated = true;
    game.units = game.units.filter(function (u) { return u.owner !== cid; });
    var d = Diplo.ensure(game);
    for (var k in d.pairs) {
      var ab = k.split("-").map(Number);
      if (ab[0] === cid || ab[1] === cid) { d.pairs[k].war = false; d.pairs[k].open = false; d.pairs[k].offer = null; }
    }
    event(game, events, "elim", "The " + cv.design.people + " of " + cv.design.name + " have been eliminated by " + name(game, by), [0]);
  }

  // F: skip this unit; it is fortified from the next turn.
  function fortify(game, unitId) {
    var u = Rules.unitById(game, unitId);
    if (!u || strengthOf(u.type) <= 0) return { ok: false, reason: "Only military units fortify" };
    u.fortifying = true; u.moves = 0;
    return { ok: true };
  }

  function militaryPower(game, cid) {
    var s = 0;
    game.units.forEach(function (u) { if (u.owner === cid) s += strengthOf(u.type) * (isAir(u.type) ? 0.6 : 1) * u.hp / MAX_HP; });
    return s;
  }

  function makeModifiers(game, cid) {
    return {
      init: function (g) {
        g.units.forEach(function (u) { if (u.hp == null) u.hp = MAX_HP; });
        g.cities.forEach(function (c) { if (c.hp == null) c.hp = MAX_HP; });
      },
      onEndTurn: function (g, events, sci, c) {
        g.units.forEach(function (u) {
          if (u.owner !== c) return;
          var city = g.cityAt.get(Rules.key(u.q, u.r));
          var heal = city && city.owner === c ? 20 : 10;
          if (!u.fought) u.hp = Math.min(MAX_HP, u.hp + heal);   // no healing on a turn spent fighting
          u.fought = false;
          u.fort = strengthOf(u.type) > 0 && (u.fortifying || u.fort || !u.moved);
          u.moved = false;
        });
        g.cities.forEach(function (city) {
          if (city.owner === c && city.hitTurn !== g.turn) city.hp = Math.min(MAX_HP, city.hp + 10);
        });
      }
    };
  }

  root.PlanetCombat = {
    MAX_HP: MAX_HP, relocateCapital: relocateCapital, strengthOf: strengthOf, atWar: atWar, targetOn: targetOn,
    canAttack: canAttack, preview: preview, attack: attack, fortify: fortify,
    cityDefense: cityDefense, militaryPower: militaryPower, eliminate: eliminate, makeModifiers: makeModifiers,
    setRanged: setRanged, addStrengthMod: addStrengthMod, extraMods: extra,
    _internals: { MAX_HP: MAX_HP, hpFactor: hpFactor, defenseOf: defenseOf, damage: damage, roll: roll, fx: fx, event: event, name: name }
  };
})(typeof window !== "undefined" ? window : globalThis);
