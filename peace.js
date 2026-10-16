/*
 * peace.js — WAR SCORE, PEACE TREATIES AND TRUCES. No DOM.
 *
 * War score (per war, from one side's view, -100..100):
 *   kills 4 each, cities taken 15 each, recent battles (last 10 turns, 1.5
 *   each) and relative strength (up to ±20). game.peace.wars["a-b"] keeps the
 *   tallies; combat.js reports through Peace.record (wrapped Combat.attack).
 * Weariness (0..60): turns at war plus units and cities lost.
 * A peace treaty is a deal with pacts: ["peace"] (deals.js routes it here).
 *   evaluate(game, deal) answers for deal.to:
 *     need = 3 x score - 2 x weariness (+10 militaristic); accept if net >= need.
 *   A winner wants terms; a loser pays for peace; cities can change hands.
 * Peace (treaty, white peace or the old makePeace) starts a TRUCE_TURNS truce:
 * declareWar is refused until it ends.
 * aiWar(game, cid, b, events): the AI's weekly thought about an ongoing war:
 *   offer terms (to the player as a pending proposal, to an AI directly).
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Diplo = root.PlanetDiplomacy, Combat = root.PlanetCombat;
  var TRUCE_TURNS = 10, MIN_TURNS = 3;

  function pk(a, b) { return a < b ? a + "-" + b : b + "-" + a; }
  function hs(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function state(game) {
    var s = game.peace || (game.peace = {});
    s.wars = s.wars || {}; s.truces = s.truces || {}; s.history = s.history || []; s.tension = s.tension || {};
    s.stats = s.stats || { treaties: 0, white: 0, terms: 0, cities: 0, offers: 0, refused: 0 };
    return s;
  }
  function power(game, cid) { return Combat.militaryPower(game, cid) + 2 * Rules.citiesOf(game, cid).length; }
  function hasTrait(game, cid, t) { var d = game.civs[cid].design; return !!(d && d.traits && d.traits.indexOf(t) !== -1); }

  // ---------------------------------------------------------------- tallies
  function onWar(game, a, b) {
    var w = { start: game.turn, kills: {}, cities: {}, lost: {}, battles: [] };
    w.kills[a] = w.kills[b] = 0; w.cities[a] = w.cities[b] = 0; w.lost[a] = w.lost[b] = 0;
    state(game).wars[pk(a, b)] = w;
    delete state(game).truces[pk(a, b)];
  }
  function war(game, a, b) {
    var w = state(game).wars[pk(a, b)];
    if (!w && Diplo.atWar(game, a, b)) { onWar(game, a, b); w = state(game).wars[pk(a, b)]; w.start = (Diplo.rel(game, a, b).warTurn || game.turn); }
    return w || null;
  }
  // winner beat loser: kind "kill" | "city" | "hit".
  function record(game, winner, loser, kind) {
    if (winner == null || loser == null || winner === loser || !Diplo.atWar(game, winner, loser)) return;
    var w = war(game, winner, loser);
    if (!w) return;
    if (kind === "kill") { w.kills[winner]++; w.lost[loser]++; }
    if (kind === "city") { w.cities[winner]++; w.lost[loser] += 3; }
    w.battles.push([game.turn, winner, kind === "hit" ? 0.5 : 1]);
    if (w.battles.length > 24) w.battles.shift();
  }

  // From a's view, -100..100.
  function score(game, a, b) {
    var w = war(game, a, b);
    if (!w) return 0;
    var s = (w.kills[a] - w.kills[b]) * 4 + (w.cities[a] - w.cities[b]) * 15;
    w.battles.forEach(function (x) { if (game.turn - x[0] <= 10) s += (x[1] === a ? 1.5 : -1.5) * x[2]; });
    var pa = power(game, a), pb = power(game, b);
    s += Math.max(-20, Math.min(20, (pa / Math.max(1, pb) - 1) * 20));
    return Math.round(Math.max(-100, Math.min(100, s)));
  }
  function weariness(game, cid, other) {
    var w = war(game, cid, other);
    if (!w) return 0;
    return Math.round(Math.min(60, (game.turn - w.start) * 1.2 + w.lost[cid] * 3));
  }
  function breakdown(game, a, b) {
    var w = war(game, a, b);
    if (!w) return null;
    return { score: score(game, a, b), turns: game.turn - w.start, kills: w.kills[a], lost: w.kills[b], took: w.cities[a], gave: w.cities[b], weary: weariness(game, a, b), theirWeary: weariness(game, b, a) };
  }

  // ---------------------------------------------------------------- truces
  function truceUntil(game, a, b) { var t = state(game).truces[pk(a, b)]; return t && t > game.turn ? t : 0; }
  // Turns since a and b last made peace (999: never).
  function sincePeace(game, a, b) {
    var h = state(game).history, k = pk(a, b);
    for (var i = h.length - 1; i >= 0; i--) if (pk(h[i].a, h[i].b) === k) return game.turn - h[i].end;
    return 999;
  }
  function truceBlocks(game, a, b) {
    var t = truceUntil(game, a, b);
    return t ? "Truce with " + Rules.civName(game, b) + " until turn " + t : null;
  }
  // Called by diplomacy.js whenever a war ends (any path).
  function onPeace(game, a, b, info) {
    var st = state(game), w = st.wars[pk(a, b)];
    st.truces[pk(a, b)] = game.turn + TRUCE_TURNS;
    var h = { a: a, b: b, start: w ? w.start : null, end: game.turn, score: w ? score(game, a, b) : 0, terms: info && info.terms || "", white: !(info && info.terms) };
    st.history.push(h);
    if (st.history.length > 60) st.history.shift();
    if (h.white) st.stats.white++; else st.stats.terms++;
    st.stats.treaties++;
    delete st.wars[pk(a, b)];
    st.tension[a + ">" + b] = st.tension[b + ">" + a] = 0;
  }

  // ---------------------------------------------------------------- evaluator
  function itemWorth(game, it, recv, giver) {
    var D = root.PlanetDeals;
    if (it.t === "city") { var c = Rules.cityById(game, it.id); return c ? c.pop * 40 + 80 + (c.buildings || []).length * 15 : 0; }
    return D.itemValue(game, it, recv, giver);
  }
  function itemPain(game, it, giver, recv) {
    var D = root.PlanetDeals;
    if (it.t === "city") return itemWorth(game, it, recv, giver) * 1.25;
    if (it.t === "tech") return D.techValue(it.id) * 0.8;
    return D.itemCost(game, it, giver, recv);
  }
  function evaluate(game, deal) {
    var self = deal.to, other = deal.from, r = Diplo.rel(game, self, other);
    var bad = root.PlanetDeals.invalid(game, deal);
    if (bad) return { verdict: "refuse", reason: bad, net: 0, need: 0, blocked: true, peace: true };
    if ((deal.pacts || []).length > 1) return { verdict: "refuse", reason: "A treaty ends the war; other agreements come later", net: 0, need: 0, blocked: true, peace: true };
    if (game.turn - (r.warTurn || 0) < MIN_TURNS) return { verdict: "refuse", reason: "Too soon: the war is " + (game.turn - r.warTurn) + " turns old", net: 0, need: 0, blocked: true, peace: true };
    var gets = 0, costs = 0;
    (deal.give || []).forEach(function (it) { gets += itemWorth(game, it, self, other); });
    (deal.ask || []).forEach(function (it) { costs += itemPain(game, it, self, other); });
    var s = score(game, self, other), wy = weariness(game, self, other);
    var need = 3 * s - 2 * wy + (hasTrait(game, self, "militaristic") ? 10 : 0);
    // An invasion fleet under way: not ready to talk yet.
    // (slice 16: the fleet is at sea, so the AI won't sign until it lands, unless losing badly.)
    var inv = root.PlanetNavalAI && root.PlanetNavalAI.invading(game, self, other);
    if (inv && s > -40 && (game.civs[self].ai || game._autoPlayer)) return { verdict: "refuse", reason: "Their invasion fleet is under way", net: 0, need: 0, blocked: true, peace: true };
    if (inv) need += 35;
    // Their capital in danger, or nothing left to fight with: almost anything goes.
    if (s <= -60) need -= 60;
    var net = gets - costs, white = !(deal.give || []).length && !(deal.ask || []).length;
    var out = { net: Math.round(net), need: Math.round(need), score: s, weary: wy, peace: true, white: white };
    if (net >= need) { out.verdict = "accept"; out.reason = white ? "They will sign a white peace" : "They will sign"; return out; }
    out.want = Math.ceil(need - net);
    if (out.want <= 250) { out.verdict = "more"; out.reason = "They want more (about " + out.want + " gold's worth)"; return out; }
    out.verdict = "refuse"; out.reason = s > 20 ? "They smell victory" : "Not worth it to them"; return out;
  }

  /*
   * Terms an AI (cid) would offer to b now: a winner demands, a loser pays.
   * Returns a deal from cid to b, or null when it would rather fight on.
   */
  function aiTerms(game, cid, b) {
    var s = score(game, cid, b), wy = weariness(game, cid, b);
    var deal = { from: cid, to: b, give: [], ask: [], pacts: ["peace"] };
    var them = game.civs[b], me = game.civs[cid], D = root.PlanetDeals;
    if (s >= 8) {
      // Winning: tribute, a tech, and a border city if crushing.
      var g = Math.min(Math.floor(them.gold * 0.6), Math.round(s * 4 + 20));
      if (g >= 15) deal.ask.push({ t: "gold", n: g });
      var tk = D.techsToOffer(game, b, cid)[0];
      if (tk && s >= 30) deal.ask.push({ t: "tech", id: tk });
      if (s >= 45) {
        var mine = Rules.citiesOf(game, cid), best = null, bd = 1e9;
        Rules.citiesOf(game, b).forEach(function (c) {
          if (c.capital) return;
          mine.forEach(function (m) { var d = Rules.hexDistance(c.q, c.r, m.q, m.r); if (d < bd) { bd = d; best = c; } });
        });
        if (best && bd <= 8) deal.ask.push({ t: "city", id: best.id });
      }
    } else if (s <= -8) {
      var pay = Math.min(Math.floor(me.gold * 0.5), Math.round(-s * 3));
      if (pay >= 10) deal.give.push({ t: "gold", n: pay });
      var lux = D.luxCopies(game, cid), out = D.luxOut(game, cid);
      var l = Object.keys(lux).filter(function (x) { return out.indexOf(x) === -1 && !(D.luxCopies(game, b)[x]); })[0];
      if (l && s <= -35) deal.give.push({ t: "lux", res: l, turns: D.LUX_TURNS });
    }
    // A winner names its price once the war has dragged on (or it holds a city
    // hostage); it keeps fighting while fresh and merely ahead.
    if (s >= 8) return wy >= 12 || s >= 45 ? (deal.ask.length ? deal : null) : null;
    // Otherwise: only what we would sign ourselves (mirror: as if they proposed it).
    var mine2 = function () { return evaluate(game, { from: b, to: cid, give: deal.ask, ask: deal.give, pacts: ["peace"] }).verdict === "accept"; };
    while (!mine2() && deal.give.length) deal.give.pop();
    if (!mine2()) return null;
    return deal;
  }

  // The AI's thought about an ongoing war with b (every few turns).
  function aiWar(game, cid, b, events) {
    var r = Diplo.rel(game, cid, b), D = root.PlanetDeals, st = state(game);
    if (!r || !r.war || game.turn - r.warTurn < MIN_TURNS + 1) return;
    if (hs(game.seed + "|peace|" + game.turn + "|" + cid + "|" + b) % 3) return;
    if (root.PlanetNavalAI && root.PlanetNavalAI.invading(game, cid, b)) return;
    // An overseas war gives the fleet time to sail (slice 16).
    if (root.PlanetNavalAI && game.turn - r.warTurn < 18 && root.PlanetNavalAI.wantsInvasion(game, cid) && game.civs[cid].ai) return;
    var deal = aiTerms(game, cid, b);
    if (!deal) return;
    st.stats.offers++;
    if (!game.civs[b].ai) {
      if (D.state(game).pending.some(function (p) { return p.from === cid && p.kind === "peace"; })) return;
      var p = D.propose(game, "peace", deal);
      if (p && !game._autoPlayer) events.push({ kind: "diplo", text: Rules.civName(game, cid) + " offers peace terms (see Diplomacy)", cid: 0 });
      return;
    }
    var ev = evaluate(game, deal);
    if (ev.verdict === "accept") {
      var res = D.execute(game, deal);
      if (res.ok) events.push({ kind: "diplo", text: "Peace treaty: " + Rules.civName(game, cid) + " and " + Rules.civName(game, b) + (deal.give.length || deal.ask.length ? " (" + D.describe(game, deal) + ")" : " (white peace)"), cid: null });
    } else st.stats.refused++;
  }

  // White peace: an empty treaty.
  function whitePeace(game, a, b) {
    var deal = { from: a, to: b, give: [], ask: [], pacts: ["peace"] };
    var ev = game.civs[b].ai ? evaluate(game, deal) : { verdict: "accept" };
    if (ev.verdict !== "accept") return { ok: false, text: Rules.civName(game, b) + " refuses a white peace: " + (ev.reason || "") + (ev.want ? "" : ""), eval: ev };
    return root.PlanetDeals.execute(game, deal);
  }

  /*
   * Combat reporting: wrap Combat.attack (melee, ranged and ships all go
   * through it) and city strikes.
   */
  function wrapCombat() {
    var orig = Combat.attack;
    Combat.attack = function (game, unitId, q, r) {
      var u = Rules.unitById(game, unitId), me = u ? u.owner : null;
      var t = u && Combat.targetOn ? Combat.targetOn(game, u, q, r) : null;
      var foe = t && t.owner != null && t.owner >= 0 ? t.owner : null;
      if (foe == null) { var c0 = game.cityAt.get(Rules.key(q, r)); if (c0 != null) foe = (Rules.cityById(game, c0) || {}).owner; }
      if (foe == null) { var o = game.units.filter(function (x) { return x.q === q && x.r === r && x.owner !== me; })[0]; if (o) foe = o.owner; }
      var res = orig.apply(this, arguments);
      if (res && res.ok && foe != null) {
        if (res.captured && res.captured !== "settler" || res.razed) { record(game, me, foe, "city"); state(game).stats.cities++; }
        else if (res.killed) record(game, me, foe, "kill");
        else if (res.died) record(game, foe, me, "kill");
        else if (res.dealt != null) record(game, (res.dealt || 0) >= (res.taken || 0) ? me : foe, (res.dealt || 0) >= (res.taken || 0) ? foe : me, "hit");
      }
      return res;
    };
    var R = root.PlanetRanged;
    if (R && R.cityStrike) {
      var cs = R.cityStrike;
      R.cityStrike = function (game, cityId, q, r) {
        var c = Rules.cityById(game, cityId), o = game.units.filter(function (x) { return x.q === q && x.r === r && c && x.owner !== c.owner; })[0];
        var res = cs.apply(this, arguments);
        if (res && res.ok && c && o) record(game, c.owner, o.owner, res.killed ? "kill" : "hit");
        return res;
      };
    }
  }
  wrapCombat();

  var WORLD = { init: function (game) { state(game); } };

  root.PlanetPeace = {
    TRUCE_TURNS: TRUCE_TURNS, MIN_TURNS: MIN_TURNS, WORLD: WORLD, state: state,
    onWar: onWar, onPeace: onPeace, record: record, score: score, weariness: weariness, breakdown: breakdown,
    truceUntil: truceUntil, truceBlocks: truceBlocks, sincePeace: sincePeace, evaluate: evaluate, aiTerms: aiTerms, aiWar: aiWar, whitePeace: whitePeace
  };
})(typeof window !== "undefined" ? window : globalThis);
