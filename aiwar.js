/*
 * aiwar.js (slice 17) — organic wars for an endless game, air doctrine, sieges.
 *
 * War drivers (AI only; the player is never made to declare):
 *  - Overseas competition: cities planted near each other away from home
 *    ("contested lands") and strategic resources one civ lacks and the other
 *    sits on sour relations and give a motive.
 *  - Era rivalry: from the Industrial era, great powers with different
 *    ideologies (or faiths) drift apart.
 *  - Opportunism: a rival already at war elsewhere, or clearly weaker.
 *  - Pacts age: a defensive pact or alliance comes up for renewal every 50
 *    turns and lapses unless relations are still warm.
 *  A slow moving average of the share of civ-turns at war throttles new
 *  wars, keeping the world in the 5–20% band.
 * Air: bombers and fighters strike units in the field, ships and besieged
 *  cities, rebase toward the fighting, and are built against threat and era.
 * Sieges: troops landed by sea (navalai.js sets u.siege) close on their
 *  target and hold beside it until the walls are down.
 * State lives in game.aitune.aw (saved with aitune; no save bump).
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Combat = root.PlanetCombat, D = root.PlanetDiplomacy, Air = root.PlanetAir, AI = root.PlanetAI;
  var Naval = root.PlanetNaval, SR = root.PlanetStrategic, Eras = root.PlanetEras, Rel = root.PlanetReligion;
  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function state(game) {
    var t = game.aitune || (game.aitune = { disbanded: 0, bought: 0, aa: 0 });
    var s = t.aw || (t.aw = { ema: 0.1, since: {}, stats: { opportunism: 0, competition: 0, rivalry: 0, grudge: 0, lapsed: 0, strikes: 0, rebases: 0, sieges: 0 } });
    return s;
  }
  function hsh(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function alive(game, i) { return game.civs[i] && !game.civs[i].eliminated; }
  function power(game, cid) { var s = 0; game.units.forEach(function (u) { if (u.owner === cid) s += Combat.strengthOf(u.type) || 0; }); return s; }
  function era(game, cid) { return Eras ? Eras.eraOf(game, cid) : 0; }
  function warsOf(game, cid) { return game.civs.map(function (c, i) { return i; }).filter(function (i) { return i !== cid && alive(game, i) && Combat.atWar(game, cid, i); }); }
  function capLand(game, cid) {
    var c = Rules.citiesOf(game, cid).filter(function (x) { return x.capital; })[0] || Rules.citiesOf(game, cid)[0];
    return c && Naval ? Naval.landmassOf(game, c.q, c.r) : null;
  }

  // ---- motives (cached per turn)
  function cache(game) {
    if (game._awTurn !== game.turn) { Object.defineProperty(game, "_awC", { value: {}, writable: true, configurable: true, enumerable: false }); Object.defineProperty(game, "_awTurn", { value: game.turn, writable: true, configurable: true, enumerable: false }); }
    return game._awC;
  }
  // Cities of a and b within 7 tiles of each other where at least one sits off its home landmass.
  function contested(game, a, b) {
    var c = cache(game), k = "c" + Math.min(a, b) + "-" + Math.max(a, b);
    if (c[k] != null) return c[k];
    var la = capLand(game, a), lb = capLand(game, b), n = 0;
    var ca = Rules.citiesOf(game, a), cb = Rules.citiesOf(game, b);
    ca.forEach(function (x) {
      var xa = Naval.landmassOf(game, x.q, x.r) !== la;
      cb.forEach(function (y) {
        if (Rules.hexDistance(x.q, x.r, y.q, y.r) > 7) return;
        if (xa || Naval.landmassOf(game, y.q, y.r) !== lb) n++;
      });
    });
    return (c[k] = n);
  }
  function resourceEnvy(game, a, b) {
    if (!SR) return null;
    var out = null;
    var c = cache(game), sa = c["s" + a] || (c["s" + a] = SR.supply(game, a)), sb = c["s" + b] || (c["s" + b] = SR.supply(game, b));
    SR.STRATEGIC.forEach(function (r) {
      if (!SR.visible(game, r, a)) return;
      if (!sa[r] && sb[r] >= 4) out = out ? out + "+" + r : r;
    });
    return out;
  }
  function greatPowers(game) {
    var c = cache(game);
    if (c.gp) return c.gp;
    var list = game.civs.map(function (x, i) { return i; }).filter(function (i) { return alive(game, i); })
      .sort(function (x, y) { return power(game, y) - power(game, x) || x - y; });
    return (c.gp = list.slice(0, Math.max(2, Math.ceil(list.length / 2))));
  }
  function eraRival(game, a, b) {
    if (era(game, a) < 4 || era(game, b) < 4) return 0;
    var gp = greatPowers(game);
    if (gp.indexOf(a) === -1 || gp.indexOf(b) === -1) return 0;
    var rs = Rel && Rel.state(game), sa = rs && rs.civ[a], sb = rs && rs.civ[b];
    if (sa && sb && sa.ideology && sb.ideology && sa.ideology !== sb.ideology) return 2;
    return 1;
  }
  if (D && D.addReason) D.addReason(function (game, a, b) {
    var out = [];
    if (!Naval) return out;
    var n = contested(game, a, b);
    if (n) out.push({ label: "Contested lands", v: -Math.min(3, n) });
    var r = resourceEnvy(game, a, b);
    if (r) out.push({ label: "They hold the " + r.split("+").map(function (x) { return root.PlanetGen.RESOURCES[x].name.toLowerCase(); }).join(" and ") + " we lack", v: -Math.min(2, r.split("+").length) });
    var er = eraRival(game, a, b);
    if (er) out.push({ label: er > 1 ? "Great-power rivalry (ideology)" : "Great-power rivalry", v: -er });
    return out;
  });

  // ---- pacts come up for renewal
  function agePacts(game) {
    var st = state(game), d = game.diplo && game.diplo.pairs;
    if (!d) return;
    Object.keys(d).forEach(function (k) {
      var r = d[k], p = r.pact || {};
      if (!(p.def || p.ally)) { delete st.since[k]; return; }
      if (st.since[k] == null) { st.since[k] = game.turn; return; }
      if (game.turn - st.since[k] < 50) return;
      var ab = k.split("-").map(Number);
      if (!game.civs[ab[0]].ai && !game.civs[ab[1]].ai) return;
      if (r.att >= (p.ally ? 7 : 6)) { st.since[k] = game.turn; return; }
      D.endPact(game, ab[0], ab[1], p.ally ? "ally" : "def", "lapsed at renewal");
      st.cool = st.cool || {}; st.cool[k] = game.turn + 40;
      st.stats.lapsed++;
      delete st.since[k];
    });
  }

  // ---- war drivers
  function reach(game, a, b) {
    var la = {}, near = 99;
    Rules.citiesOf(game, a).forEach(function (c) { la[Naval.landmassOf(game, c.q, c.r)] = 1; });
    Rules.citiesOf(game, a).forEach(function (x) { Rules.citiesOf(game, b).forEach(function (y) { if (la[Naval.landmassOf(game, y.q, y.r)]) near = Math.min(near, Rules.hexDistance(x.q, x.r, y.q, y.r)); }); });
    if (near <= 24) return true;
    return Rules.hasTech(game, "navigation", a) && Naval.ports(game, a).length > 0;
  }
  function liftShip(t) { return T(t).naval && T(t).ocean && (T(t).cargo || 0) >= 2; }
  // The strongest transport hull a civ can build now (diagnosed on river3:
  // invasions sailed in Ancient caravels into destroyers and jet fighters).
  function bestLift(game, a) {
    var c = cache(game), k = "L" + a;
    if (c[k] !== undefined) return c[k];
    var port = Naval.ports(game, a)[0], best = null;
    if (port) Object.keys(Rules.BUILDS).forEach(function (key) {
      var b = Rules.BUILDS[key];
      if (!b.unit || !liftShip(b.unit) || (b.tech && !Rules.hasTech(game, b.tech, a)) || !Rules.canBuild(game, port, key)) return;
      var sc = function (u) { return Combat.strengthOf(u) + 10 * (T(u).cargo || 0); };
      if (!best || sc(b.unit) > sc(Rules.BUILDS[best].unit)) best = key;
    });
    return (c[k] = best);
  }
  function liftOK(game, ship) {
    var b = bestLift(game, ship.owner);
    var bu = b && Rules.BUILDS[b].unit;
    return liftShip(ship.type) && (!bu || Combat.strengthOf(ship.type) >= 0.6 * Combat.strengthOf(bu) && (T(ship.type).cargo || 0) >= 0.6 * (T(bu).cargo || 0));
  }
  function hasLift(game, a) { return game.units.some(function (u) { return u.owner === a && liftOK(game, u) && !u.inv; }); }
  function overseas(game, a, b) {
    var la = {}; Rules.citiesOf(game, a).forEach(function (c) { la[Naval.landmassOf(game, c.q, c.r)] = 1; });
    return !Rules.citiesOf(game, b).some(function (c) { return la[Naval.landmassOf(game, c.q, c.r)]; });
  }
  function tally(k) { if (root.__awdbg) root.__awdbg[k] = (root.__awdbg[k] || 0) + 1; }
  function drivers(game, events) {
    var st = state(game), PZ = root.PlanetPeace;
    // Moving average of the share of civs at war (the throttle).
    var live = game.civs.map(function (c, i) { return i; }).filter(function (i) { return alive(game, i); });
    var at = live.filter(function (i) { return warsOf(game, i).length; }).length;
    st.ema = Math.round((st.ema * 0.97 + 0.03 * (live.length ? at / live.length : 0)) * 1e4) / 1e4;
    // A long quiet frays: the longer the world has been (almost) at peace, the less it takes.
    st.quiet = at ? 0 : (st.quiet || 0) + 1;
    if (game.turn < 60 || st.ema > 0.15) return;
    var bar = 4 + (st.ema > 0.12 ? 1.5 : 0) - (st.ema < 0.05 ? 1 : 0) - Math.min(2.2, st.quiet / 40);
    live.forEach(function (a) {
      var ca = game.civs[a];
      if (!ca.ai || warsOf(game, a).length || Rules.citiesOf(game, a).length < 2) return;
      var best = null;
      D.metCivs(game, a).forEach(function (b) {
        if (!alive(game, b) || hsh(game.seed + "|aw|" + game.turn + "|" + a + "|" + b) % 6) return;
        var r = D.rel(game, a, b);
        if (!r || r.war) return;
        if (PZ && (PZ.sincePeace(game, a, b) < 30 || PZ.truceBlocks(game, a, b))) return tally("peace");
        var p = D.pactOf(game, a, b), bound = p.ally || p.def || D.napActive(game, a, b);
        if (p.ally) return tally("ally");
        if (!reach(game, a, b)) return tally("reach");
        var mine = power(game, a), theirs = power(game, b);
        D.allies(game, b).forEach(function (x) { theirs += power(game, x) * 0.7; });
        if (mine < theirs * 0.9) return tally("weak");
        var m = { opportunism: 0, competition: 0, rivalry: 0, grudge: 0 };
        if (warsOf(game, b).length) m.opportunism += 2;
        if (mine >= theirs * 1.5) m.opportunism += 1.5;
        if (contested(game, a, b)) m.competition += 1.5 + Math.min(1, contested(game, a, b) * 0.25);
        var env = resourceEnvy(game, a, b);
        if (env) m.competition += Math.min(2, env.split("+").length) * (era(game, a) >= 4 ? 1 : 0.7);
        m.rivalry += eraRival(game, a, b) * 0.9;
        if (r.att <= 0) m.grudge += 1;
        if (r.att <= -4) m.grudge += 1;
        var score = m.opportunism + m.competition + m.rivalry + m.grudge - Math.max(0, r.att - 3) * 0.6;
        tally(score >= bar ? (bound ? "cancel" : "go") : "low");
        if (bound) {
          // A pact that no longer fits the mood is cancelled; war may follow later.
          if (score >= bar && r.att <= 5) {
            D.endPact(game, a, b, "def", "cancelled by " + Rules.civName(game, a));
            D.endPact(game, a, b, "nap", "cancelled by " + Rules.civName(game, a));
            var kk = a < b ? a + "-" + b : b + "-" + a; st.cool = st.cool || {}; st.cool[kk] = game.turn + 40;
            st.stats.cancelled = (st.stats.cancelled || 0) + 1;
          }
          return;
        }
        if (score >= bar && (!best || score > best.s)) {
          var why = Object.keys(m).sort(function (x, y) { return m[y] - m[x]; })[0];
          best = { b: b, s: score, why: why };
        }
      });
      // War plans: an overseas war waits (up to 30 turns) for an ocean transport.
      var prep = st.prep && st.prep[a];
      if (prep && (!alive(game, prep.b) || game.turn - prep.t > 30)) { delete st.prep[a]; prep = null; }
      if (!best && prep && hasLift(game, a)) best = { b: prep.b, why: prep.why };
      if (!best || warsOf(game, a).length) return;
      if (overseas(game, a, best.b) && !hasLift(game, a)) {
        st.prep = st.prep || {};
        if (!st.prep[a]) { st.prep[a] = { b: best.b, t: game.turn, why: best.why }; st.stats.plans = (st.stats.plans || 0) + 1; }
        if (game.turn - st.prep[a].t < 30) return;
      }
      if (st.prep) delete st.prep[a];
      var res = D.declareWar(game, a, best.b);
      if (!res.ok) return;
      st.stats[best.why]++;
      var WHY = { opportunism: "seizing the moment", competition: "over contested lands and resources", rivalry: "a great-power rivalry", grudge: "an old grudge" };
      var text = res.text + " (" + WHY[best.why] + ")";
      events.push({ kind: "war", text: text, cid: best.b === 0 ? 0 : null });
      if (root.PlanetStory && root.PlanetStory.chronicle) root.PlanetStory.chronicle(game, { kind: "war", text: text });
    });
  }

  // A civ that plans or fights an overseas war and has no seaworthy, modern
  // transport orders one in its port nearest the target (overrides the queue).
  function orderLift(game) {
    var st = state(game), NA = root.PlanetNavalAI;
    game.civs.forEach(function (c, a) {
      if (c.eliminated || !(c.ai || game._autoPlayer)) return;
      var need = st.prep && st.prep[a] || warsOf(game, a).length && NA && NA.wantsInvasion(game, a);
      if (!need || hasLift(game, a)) return;
      var key = bestLift(game, a);
      if (!key) return;
      var ports = Naval.ports(game, a);
      if (ports.some(function (p) { return p.build === key; })) return;
      var t = NA && NA.overseasTarget(game, a), ref = t || ports[0];
      var port = ports.filter(function (p) { return Rules.canBuild(game, p, key); }).sort(function (x, y) {
        return Rules.hexDistance(x.q, x.r, ref.q, ref.r) - Rules.hexDistance(y.q, y.r, ref.q, ref.r) || x.id - y.id;
      })[0];
      if (!port) return;
      Rules.setBuild(game, port.id, key);
      st.stats.lifts = (st.stats.lifts || 0) + 1;
    });
  }

  // War exhaustion (AI against AI only): a war that drags on past 35 turns
  // while the world is busy fighting, or past 60 turns regardless, ends in a
  // white peace. Keeps endless sieges from pinning the world at war.
  function exhaustion(game, events) {
    var st = state(game), d = game.diplo && game.diplo.pairs;
    if (!d) return;
    Object.keys(d).forEach(function (k) {
      var r = d[k];
      if (!r.war) return;
      var ab = k.split("-").map(Number);
      if (!game.civs[ab[0]].ai || !game.civs[ab[1]].ai) return;
      var len = game.turn - (r.warTurn || 0);
      if (!(len > 60 || len > 35 && st.ema > 0.12)) return;
      r.offer = ab[1];
      var res = D.makePeace(game, ab[0], ab[1]);
      if (res.ok) { st.stats.exhausted = (st.stats.exhausted || 0) + 1; events.push({ kind: "diplo", text: "War-weary, " + Rules.civName(game, ab[0]) + " and " + Rules.civName(game, ab[1]) + " made peace", cid: null }); }
      else r.offer = null;
    });
  }

  // ---- air doctrine
  function airTargetScore(game, u, tile, focus) {
    var pv = Air.preview(game, u, tile.q, tile.r);
    if (!pv.ok) return null;
    var s = pv.expDealt - pv.expTaken - (pv.interceptor ? 25 : 0);
    if (pv.kind === "unit") {
      var hp0 = Air.canStrike(game, u, tile.q, tile.r).target.defender.hp;
      if (pv.expDealt >= hp0) s += 10;
      var ct = Air.canStrike(game, u, tile.q, tile.r), d = ct.ok && ct.target.defender;
      if (d && T(d.type).naval) s += 6;                     // ships at sea
      if (d && Rules.citiesOf(game, u.owner).some(function (c) { return Rules.hexDistance(c.q, c.r, tile.q, tile.r) <= 4; })) s += 6;   // raiders near home
    } else s += 4;
    if (focus[Rules.key(tile.q, tile.r)]) s += 10;         // siege / invasion target
    if (u.hp < 50) s -= 20;
    return s;
  }
  function siegeFocus(game, cid) {
    var f = {};
    game.units.forEach(function (o) {
      if (o.owner !== cid) return;
      if (o.siege != null) { var c = Rules.cityById(game, o.siege); if (c) f[Rules.key(c.q, c.r)] = 1; }
      if (o.inv) { var c2 = Rules.cityById(game, o.inv.city); if (c2) f[Rules.key(c2.q, c2.r)] = 1; }
    });
    return f;
  }
  if (Air && Air.aiUnit) {
    var prevAir = Air.aiUnit;
    Air.aiUnit = function (game, u) {
      if (u.moves > 0 && warsOf(game, u.owner).length) {
        var t = T(u.type), fighter = t.dogfight > t.strike, focus = siegeFocus(game, u.owner);
        var best = null, bs = fighter ? 2 : -4;
        Air.strikeTargets(game, u).forEach(function (tile) {
          var s = airTargetScore(game, u, tile, focus);
          if (fighter && s != null && Air.preview(game, u, tile.q, tile.r).kind === "city") s -= 8;
          if (s != null && s > bs) { bs = s; best = tile; }
        });
        if (best) { var r = Air.strike(game, u.id, best.q, best.r); if (r && r.ok !== false) { state(game).stats.strikes++; return; } }
        // Rebase toward the fighting: the base nearest any visible enemy (units, ships, cities).
        if (!fighter || !u.patrol) {
          var foes = [];
          game.units.forEach(function (o) { if (o.owner !== u.owner && o.aboard == null && !T(o.type).air && Combat.atWar(game, u.owner, o.owner) && game.civs[u.owner].revealed.has(Rules.key(o.q, o.r)) && Combat.strengthOf(o.type) > 0) foes.push(o); });
          game.cities.forEach(function (c) { if (Combat.atWar(game, u.owner, c.owner)) foes.push(c); });
          Object.keys(focus).forEach(function (k) { var p = k.split(",").map(Number); foes.push({ q: p[0], r: p[1] }, { q: p[0], r: p[1] }); });
          var near = function (q, r) { var m = 99; foes.forEach(function (o) { m = Math.min(m, Rules.hexDistance(q, r, o.q, o.r)); }); return m; };
          var here = near(u.q, u.r), pick = null, pd = here;
          Air.baseTargets(game, u).forEach(function (b) { var d = near(b.q, b.r); if (d + 2 <= pd && d >= 2) { pd = d; pick = b; } });
          if (pick && here > Air.rangeOf(u) - 1) { var rb = Air.rebase(game, u.id, pick.q, pick.r); if (rb && rb.ok !== false) { state(game).stats.rebases++; return; } }
        }
      }
      return prevAir(game, u);
    };
  }
  if (AI && AI.addBuildAdjust) AI.addBuildAdjust(function (game, city, key, s) {
    var b = Rules.BUILDS[key], st = state(game), NA = root.PlanetNavalAI;
    var need = st.prep && st.prep[city.owner] || warsOf(game, city.owner).length && NA && NA.wantsInvasion(game, city.owner);
    if (!b || !b.unit || !liftShip(b.unit) || !need || !Naval.coastal(game, city) || key !== bestLift(game, city.owner)) return s;
    if (hasLift(game, city.owner) || Rules.citiesOf(game, city.owner).some(function (c) { return c.build && Rules.BUILDS[c.build] && liftShip(Rules.BUILDS[c.build].unit); })) return s;
    return s <= 0 ? s : Math.max(s, 6 + (T(b.unit).cargo || 0) / 10);
  });
  if (AI && AI.addBuildAdjust && Air) AI.addBuildAdjust(function (game, city, key, s, war) {
    var b = Rules.BUILDS[key];
    if (!b || !b.unit || !T(b.unit).air) return s;
    if (s <= 0) return s;                      // resource limits etc. said no
    var cid = city.owner, e = era(game, cid);
    var mine = game.units.filter(function (o) { return o.owner === cid && T(o.type).air; }).length +
      Rules.citiesOf(game, cid).filter(function (c) { return c.build && Rules.BUILDS[c.build] && T(Rules.BUILDS[c.build].unit).air; }).length;
    var threat = 0;
    game.units.forEach(function (o) {
      if (o.owner === cid || !Combat.atWar(game, cid, o.owner)) return;
      if (T(o.type).air) threat += 1;
      else if (Combat.strengthOf(o.type) > 0 && Rules.hexDistance(o.q, o.r, city.q, city.r) <= 8) threat += 0.5;
    });
    var want = Math.floor(Rules.citiesOf(game, cid).length / 2) + Math.max(0, e - 5) + (warsOf(game, cid).length ? 2 : 0) + Math.min(4, Math.floor(threat));
    if (mine >= want) return s;
    return Math.max(s, (warsOf(game, cid).length ? 5.4 : 3) + Math.min(1, threat * 0.2));
  });

  // ---- sieges: troops landed by sea close in and hold beside the walls
  if (AI && AI.addUnitHook) AI.addUnitHook(function (game, u) {
    if (u.siege == null) return false;
    var c = Rules.cityById(game, u.siege);
    if (!c || c.owner === u.owner || !Combat.atWar(game, u.owner, c.owner)) { u.siege = null; return false; }
    var hit = AI.bestAttack(game, u, false);
    if (hit) { Combat.attack(game, u.id, hit.q, hit.r); return true; }
    if (u.hp < 35) return false;                 // let the normal AI heal/fall back
    var d = Rules.hexDistance(u.q, u.r, c.q, c.r);
    // Mass before the assault: out of the city's guns, wait (fortified, healing)
    // for the next wave and for bombers/warships to batter the walls.
    var R = root.PlanetRanged, guns = R && R.cityCanStrike(game, c);
    var mates = game.units.filter(function (o) { return o.owner === u.owner && o.siege === c.id && Rules.hexDistance(o.q, o.r, c.q, c.r) <= 4; }).length;
    if (guns && c.hp > 50 && (mates < 4 || u.hp < 80) && d < 3 && (u.siegeWait || 0) < 20) {
      // Landed under the guns: pull back to a covered tile 3 out.
      var back = Rules.tilesInRadius(game, c.q, c.r, 3).filter(function (t) {
        return Rules.hexDistance(t.q, t.r, c.q, c.r) === 3 && !Rules.isWater(t) && Rules.moveCost(t) !== Infinity && Naval.landmassOf(game, t.q, t.r) === Naval.landmassOf(game, u.q, u.r) &&
          !game.units.some(function (o) { return o.q === t.q && o.r === t.r && o.owner !== u.owner; });
      }).sort(function (a, b) { return Rules.hexDistance(u.q, u.r, a.q, a.r) - Rules.hexDistance(u.q, u.r, b.q, b.r) || a.q - b.q || a.r - b.r; })[0];
      if (back) { AI.stepToward(game, u, back.q, back.r); u.siegeWait = (u.siegeWait || 0) + 1; return true; }
    }
    if (guns && c.hp > 50 && (mates < 3 || u.hp < 80) && d >= 3 && u.hp < 70) return false;   // being whittled down: heal / fall back normally
    if (guns && c.hp > 50 && (mates < 4 || u.hp < 80) && d >= 3) {
      u.siegeWait = (u.siegeWait || 0) + 1;
      if (u.siegeWait < 20) { if (!u.fort && Combat.fortify) Combat.fortify(game, u.id); else u.moves = 0; state(game).stats.sieges++; return true; }
    }
    if (d > 1) {
      // Close in on the best covered tile next to the walls.
      var ring = Rules.neighbours(game, game.index.get(Rules.key(c.q, c.r))).filter(function (t) {
        return !Rules.isWater(t) && Rules.moveCost(t) !== Infinity && !game.units.some(function (o) { return o.q === t.q && o.r === t.r && o.owner !== u.owner; });
      }).sort(function (a, b) {
        var ca = a.biome === "hills" || a.biome === "forest" || a.biome === "jungle" ? -2 : 0, cb = b.biome === "hills" || b.biome === "forest" || b.biome === "jungle" ? -2 : 0;
        return Rules.hexDistance(u.q, u.r, a.q, a.r) + ca - Rules.hexDistance(u.q, u.r, b.q, b.r) - cb || a.q - b.q || a.r - b.r;
      });
      var goal = ring[0] || c;
      AI.stepToward(game, u, goal.q, goal.r);
      if (u.moves > 0) { var h2 = AI.bestAttack(game, u, false); if (h2) Combat.attack(game, u.id, h2.q, h2.r); }
    } else if (!u.fort && Combat.fortify) { Combat.fortify(game, u.id); state(game).stats.sieges++; }
    else u.moves = 0;
    return true;
  });

  Rules.registerPlugin({ world: {
    init: function (g) { state(g); },
    onEndTurn: function (g, events) { agePacts(g); exhaustion(g, events || []); drivers(g, events || []); orderLift(g); }
  } });

  // A lapsed defensive pact or alliance can't be re-signed for 40 turns.
  function pactCooldown(game, a, b, kind) {
    if (kind !== "def" && kind !== "ally") return null;
    var c = state(game).cool, k = a < b ? a + "-" + b : b + "-" + a;
    return c && c[k] > game.turn ? "The old pact lapsed recently (until turn " + c[k] + ")" : null;
  }
  root.PlanetAIWar = { pactCooldown: pactCooldown, liftOK: liftOK, bestLift: bestLift, state: state, contested: contested, resourceEnvy: resourceEnvy, eraRival: eraRival, drivers: drivers, agePacts: agePacts };
})(typeof window !== "undefined" ? window : globalThis);
