/*
 * promo.js — EXPERIENCE AND PROMOTIONS (slice 15). No DOM.
 * u.xp grows in combat: +5 for attacking (+3 for ranged/air shots), +5 more
 * for a kill, +4 for surviving an attack. A unit with xp >= LEVELS[n] (n =
 * promotions held) may pick one promotion from its class tree (canPick);
 * u.promos = [ids]. Promotions survive upgrades (Econ.upgrade keeps fields).
 * Barracks give 10 XP (wonders.js); the old veteran flag migrates to 10 XP.
 * Classes: melee, ranged, naval, air. Effects are strength modifiers through
 * Combat.addStrengthMod, plus: medic (+10 heal to itself and neighbours),
 * blitz/logistics (a second attack a turn), range (+1, ranged.js), range_air
 * (+2, air.js), interception and evasion (air.js), navigation (+1 move).
 * game.promo = { stats: { earned, byClass } }.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Combat = root.PlanetCombat;

  var LEVELS = [10, 30, 60, 100, 150, 220];
  var OPEN = { plains: 1, grassland: 1, desert: 1, tundra: 1, snow: 1 };
  var ROUGH = { hills: 1, forest: 1, jungle: 1 };
  // id: { cls, name, text, needs: [any of] }
  var PROMOS = {
    shock:    { cls: "melee", name: "Shock", text: "+25% in open terrain" },
    drill:    { cls: "melee", name: "Drill", text: "+25% in rough terrain" },
    cover:    { cls: "melee", name: "Cover", text: "+33% defending vs ranged and air" },
    medic:    { cls: "melee", name: "Medic", text: "+10 healing for itself and neighbours", needs: ["shock", "drill", "cover"] },
    blitz:    { cls: "melee", name: "Blitz", text: "A second attack each turn", needs: ["shock", "drill"] },
    accuracy: { cls: "ranged", name: "Accuracy", text: "+25% vs units" },
    barrage:  { cls: "ranged", name: "Barrage", text: "+33% vs cities" },
    range:    { cls: "ranged", name: "Range", text: "+1 range", needs: ["accuracy", "barrage"] },
    logistics:{ cls: "ranged", name: "Logistics", text: "A second shot each turn", needs: ["range"] },
    boarding: { cls: "naval", name: "Boarding", text: "+33% vs ships" },
    coastal_raider: { cls: "naval", name: "Coastal Raider", text: "+33% vs cities; plunders 10 gold a hit" },
    navigation: { cls: "naval", name: "Navigation", text: "+1 movement", needs: ["boarding", "coastal_raider"] },
    interception: { cls: "air", name: "Interception", text: "+33% when intercepting" },
    siege:    { cls: "air", name: "Siege", text: "+33% vs cities" },
    evasion:  { cls: "air", name: "Evasion", text: "-50% damage from interceptors" },
    range_air:{ cls: "air", name: "Air Range", text: "+2 operational range", needs: ["interception", "siege", "evasion"] }
  };
  var ORDER = Object.keys(PROMOS);

  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function classOf(type) {
    var t = T(type);
    if (t.air) return "air";
    if (t.naval) return "naval";
    if (t.ranged) return "ranged";
    return t.strength > 0 ? "melee" : null;
  }
  function state(game) {
    var s = game.promo || (game.promo = {});
    if (!s.stats) s.stats = { earned: 0, byClass: {}, byId: {} };
    return s;
  }
  function has(u, id) { return !!(u && u.promos && u.promos.indexOf(id) !== -1); }
  function level(u) { return (u.promos || []).length; }
  function nextAt(u) { return LEVELS[Math.min(LEVELS.length - 1, level(u))]; }
  function ready(u) { return !!classOf(u.type) && level(u) < LEVELS.length && (u.xp || 0) >= LEVELS[level(u)]; }
  function options(u) {
    var cls = classOf(u.type);
    if (!cls) return [];
    return ORDER.filter(function (id) {
      var p = PROMOS[id];
      if (p.cls !== cls || has(u, id)) return false;
      return !p.needs || p.needs.some(function (n) { return has(u, n); });
    });
  }
  function pick(game, unitId, id) {
    var u = Rules.unitById(game, unitId);
    if (!u || !ready(u)) return { ok: false, reason: "Not enough experience" };
    if (options(u).indexOf(id) === -1) return { ok: false, reason: "Promotion not available" };
    u.promos = (u.promos || []).concat([id]);
    u.hp = Math.min(Combat.MAX_HP, u.hp + 10);      // a promotion steadies the ranks
    var st = state(game); st.stats.earned++;
    var cls = classOf(u.type);
    st.stats.byClass[cls] = (st.stats.byClass[cls] || 0) + 1;
    st.stats.byId[id] = (st.stats.byId[id] || 0) + 1;
    if (id === "navigation") u.moves += 1;
    return { ok: true, text: T(u.type).name + " promoted: " + PROMOS[id].name };
  }

  // AI (and autoplay): sensible picks by situation and class.
  function aiChoice(game, u) {
    var opts = options(u);
    if (!opts.length) return null;
    var tile = game.index.get(Rules.key(u.q, u.r));
    var roughNear = Rules.tilesInRadius(game, u.q, u.r, 2).filter(function (t) { return ROUGH[t.biome]; }).length;
    var pref = {
      shock: roughNear < 6 ? 3 : 1, drill: roughNear >= 6 ? 3 : 1, cover: u.role === "garrison" ? 3.5 : 1.5,
      medic: 2, blitz: u.role === "garrison" ? 1 : 3,
      accuracy: 3, barrage: 2.5, range: 4, logistics: 3.5,
      boarding: 3, coastal_raider: 2.5, navigation: 2,
      interception: T(u.type).dogfight >= T(u.type).strike ? 4 : 1, siege: T(u.type).strike > T(u.type).dogfight ? 4 : 1, evasion: 2.5, range_air: 3
    };
    if (tile && game.cityAt.has(Rules.key(tile.q, tile.r))) pref.cover += 0.5;
    opts.sort(function (a, b) { return (pref[b] || 0) - (pref[a] || 0) || ORDER.indexOf(a) - ORDER.indexOf(b); });
    return opts[0];
  }
  function aiPromote(game, cid) {
    var auto = game.civs[cid].ai || game._autoPlayer;
    if (!auto) return 0;
    var n = 0;
    game.units.forEach(function (u) {
      if (u.owner !== cid) return;
      var guard = 0;
      while (ready(u) && guard++ < 6) { var id = aiChoice(game, u); if (!id || !pick(game, u.id, id).ok) break; n++; }
    });
    return n;
  }

  // ---- strength effects
  Combat.addStrengthMod(function (game, u, role, ctx) {
    if (!u.promos || !u.promos.length) return null;
    var out = [], tile = role === "def" ? ctx.tile : ctx.tile || (ctx.target && ctx.target.tile);
    var here = role === "def" ? game.index.get(Rules.key(u.q, u.r)) : tile;
    if (has(u, "shock") && here && OPEN[here.biome]) out.push({ label: "Shock", v: 0.25 });
    if (has(u, "drill") && here && ROUGH[here.biome]) out.push({ label: "Drill", v: 0.25 });
    if (role === "def" && has(u, "cover") && ctx.attacker && (T(ctx.attacker.type).ranged || T(ctx.attacker.type).air || (T(ctx.attacker.type).naval && !Rules.isWater(game.index.get(Rules.key(u.q, u.r))))))
      out.push({ label: "Cover", v: 0.33 });
    var t = ctx.target;
    if (role !== "def" && t) {
      if (has(u, "accuracy") && t.kind === "unit") out.push({ label: "Accuracy", v: 0.25 });
      if (has(u, "barrage") && t.kind === "city") out.push({ label: "Barrage", v: 0.33 });
      if (has(u, "boarding") && t.kind === "unit" && T(t.defender.type).naval) out.push({ label: "Boarding", v: 0.33 });
      if (has(u, "coastal_raider") && t.kind === "city") out.push({ label: "Coastal Raider", v: 0.33 });
      if (has(u, "siege") && t.kind === "city") out.push({ label: "Siege", v: 0.33 });
    }
    if (role === "def" && has(u, "boarding") && ctx.attacker && T(ctx.attacker.type).naval) out.push({ label: "Boarding", v: 0.33 });
    return out;
  });

  // ---- XP from combat (wrap Combat.attack, which also routes ranged shots, and air strikes)
  function award(game, u, n) { if (u && Rules.unitById(game, u.id)) u.xp = (u.xp || 0) + n; }
  function afterCombat(game, attacker, defender, res, shot) {
    if (!res || !res.ok) return;
    var st = state(game);
    st.stats.xpEvents = (st.stats.xpEvents || 0) + 1;
    if (!res.died) award(game, attacker, (shot ? 3 : 5) + (res.killed ? 5 : 0));
    if (defender && !res.killed) award(game, defender, 4);
    if (res.died && defender) award(game, defender, 5);
    // Blitz / Logistics: one more attack this turn.
    if (attacker && !res.died && Rules.unitById(game, attacker.id) && (has(attacker, "blitz") || has(attacker, "logistics")) && attacker.blitzTurn !== game.turn) {
      attacker.blitzTurn = game.turn; attacker.moves = Math.max(attacker.moves, 1);
    }
    if (attacker && has(attacker, "coastal_raider") && res.kind === "city" && res.dealt) game.civs[attacker.owner].gold += 10;
  }
  var origAttack = Combat.attack;
  Combat.attack = function (game, unitId, q, r) {
    var u = Rules.unitById(game, unitId);
    var t = u && Combat.targetOn(game, u, q, r);
    var d = t && t.kind === "unit" ? t.defender : null;
    var shot = !!(u && (T(u.type).ranged || (T(u.type).naval && !Rules.isWater(game.index.get(Rules.key(q, r)) || {}))));
    var res = origAttack.apply(this, arguments);
    if (u) afterCombat(game, u, d, res, shot);
    return res;
  };
  if (root.PlanetAir) {
    var origStrike = root.PlanetAir.strike;
    root.PlanetAir.strike = function (game, unitId, q, r) {
      var u = Rules.unitById(game, unitId);
      var res = origStrike.apply(this, arguments);
      if (res && res.ok) {
        var d = res.defender != null ? Rules.unitById(game, res.defender) : null;
        afterCombat(game, u, d, res, true);
        if (res.intercepted) award(game, Rules.unitById(game, res.intercepted.by), 4);
      }
      return res;
    };
  }

  var MODS = function (game, cid) {
    return {
      unitMoves: function (type, moves) { return moves; },
      init: function (g) {
        g.units.forEach(function (u) { if (u.vet !== undefined) { if (u.vet && u.xp == null) u.xp = 10; delete u.vet; } });
      },
      onEndTurn: function (g, events, sci, c) {
        // Medics heal themselves and neighbours a little more.
        g.units.forEach(function (m) {
          if (m.owner !== c || !has(m, "medic")) return;
          g.units.forEach(function (o) {
            if (o.owner === c && Rules.hexDistance(o.q, o.r, m.q, m.r) <= 1) o.hp = Math.min(Combat.MAX_HP, o.hp + 10);
          });
        });
        g.units.forEach(function (u) { if (u.owner === c && has(u, "navigation") && u.moves > 0) u.moves += 1; });
        aiPromote(g, c);
      }
    };
  };
  Rules.registerPlugin({ mods: MODS, world: { init: function (g) { state(g); } } });

  root.PlanetPromo = {
    LEVELS: LEVELS, PROMOS: PROMOS, ORDER: ORDER, classOf: classOf, state: state, has: has, level: level, nextAt: nextAt,
    ready: ready, options: options, pick: pick, aiChoice: aiChoice, aiPromote: aiPromote
  };
})(typeof window !== "undefined" ? window : globalThis);
