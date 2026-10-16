/*
 * diplomacy.js — CONTACT, ATTITUDE, BORDERS, WAR. No DOM.
 * State: game.diplo = { pairs: { "a-b": { met, metTurn, war, warTurn, open, att } } } (a < b).
 * att is one shared attitude score (-10..10) between two civs, shown as a word.
 * Hooks into game.js:
 *   - per civ (makeModifiers): moveCost closes foreign territory unless open borders or war
 *   - world (WORLD): init, onEndTurn -> first contacts (all pairs) and attitude drift
 * No combat: war is a status with an attitude and border effect.
 *
 * Attitude target = the sum of reasons(): traits, border tension, open borders,
 * trade routes, war, a shared enemy, pacts, and remembered events (r.mem:
 * gifts, deals, broken promises, tribute...) that fade by 0.1 a turn.
 * Pacts (r.pact): nap (until turn), def (defensive pact), ally (alliance:
 * defensive + shared vision), research (until turn; both get science at the end).
 * Declaring war on a pact partner breaks it: -8 with them, -3 with everyone
 * else who knows you. When b is attacked, AI partners with a defensive pact or
 * alliance join at once; the player is asked (game.diplo.asks).
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Vision = root.PlanetVision;

  // Traits that rub each other the wrong way (each shared trait is +2, each clash -2).
  var OPPOSED = [
    ["militaristic", "mercantile"], ["militaristic", "scholarly"],
    ["agrarian", "nomadic"], ["expansionist", "seafaring"], ["industrious", "nomadic"]
  ];

  function pk(a, b) { return a < b ? a + "-" + b : b + "-" + a; }
  function ensure(game) {
    if (!game.diplo || !game.diplo.pairs) game.diplo = { pairs: {} };
    if (!game.diplo.asks) game.diplo.asks = [];
    return game.diplo;
  }
  function rel(game, a, b) { return ensure(game).pairs[pk(a, b)] || null; }
  function met(game, a, b) { var r = rel(game, a, b); return !!(r && r.met); }
  function metCivs(game, cid) {
    var out = [];
    for (var i = 0; i < game.civs.length; i++) if (i !== cid && met(game, cid, i)) out.push(i);
    return out;
  }

  function traitsOf(game, cid) { var d = game.civs[cid].design; return (d && d.traits) || []; }

  function affinity(game, a, b) {
    var ta = traitsOf(game, a), tb = traitsOf(game, b), s = 0;
    ta.forEach(function (t) { if (tb.indexOf(t) !== -1) s += 2; });
    OPPOSED.forEach(function (p) {
      if ((ta.indexOf(p[0]) !== -1 && tb.indexOf(p[1]) !== -1) || (ta.indexOf(p[1]) !== -1 && tb.indexOf(p[0]) !== -1)) s -= 2;
    });
    return s;
  }

  // Close city pairs make neighbours nervous (max -3).
  function borderTension(game, a, b) {
    var n = 0;
    var ca = Rules.citiesOf(game, a), cb = Rules.citiesOf(game, b);
    for (var i = 0; i < ca.length; i++) for (var j = 0; j < cb.length; j++) {
      if (Rules.hexDistance(ca[i].q, ca[i].r, cb[j].q, cb[j].r) <= 8) n++;
    }
    return -Math.min(3, n);
  }

  // ---- memory: remembered events with fading values
  var MEM_FADE = 0.1;   // per turn
  var MEM_CAP = { deals: 3, gifts: 4, tribute: 2 };
  function remember(game, a, b, kind, v, label) {
    var r = rel(game, a, b);
    if (!r) return;
    var mem = r.mem || (r.mem = []);
    var m = mem.filter(function (x) { return x.k === kind; })[0];
    // Good memories stack to a smaller cap than bad ones (+4 vs -8).
    var lo = -8, hi = MEM_CAP[kind] || 4;
    if (m) { m.v = Math.max(lo, Math.min(hi, m.v + v)); m.t = game.turn; m.label = label || m.label; }
    else mem.push({ k: kind, v: Math.max(lo, Math.min(hi, v)), label: label || kind, t: game.turn });
  }
  function fade(r) {
    if (!r.mem) return;
    r.mem.forEach(function (m) { m.v = m.v > 0 ? Math.max(0, m.v - MEM_FADE) : Math.min(0, m.v + MEM_FADE); m.v = Math.round(m.v * 100) / 100; });
    r.mem = r.mem.filter(function (m) { return Math.abs(m.v) >= 0.5; });
  }

  function pactOf(game, a, b) { var r = rel(game, a, b); return (r && r.pact) || {}; }
  function napActive(game, a, b) { var p = pactOf(game, a, b); return !!(p.nap && p.nap > game.turn); }
  function allies(game, cid) {
    var out = [];
    for (var i = 0; i < game.civs.length; i++) if (i !== cid && pactOf(game, cid, i).ally && !game.civs[i].eliminated) out.push(i);
    return out;
  }
  function atWar(game, a, b) { var r = rel(game, a, b); return !!(r && r.war); }
  function sharedEnemy(game, a, b) {
    for (var c = 0; c < game.civs.length; c++) {
      if (c === a || c === b || game.civs[c].eliminated) continue;
      if (atWar(game, a, c) && atWar(game, b, c)) return c;
    }
    return -1;
  }

  // Why a and b feel the way they do: [{ label, v }]; the target is their sum.
  function reasons(game, a, b) {
    var r = rel(game, a, b), out = [];
    var aff = affinity(game, a, b), bt = borderTension(game, a, b);
    if (aff) out.push({ label: aff > 0 ? "Shared ways" : "Clashing ways", v: aff });
    if (bt) out.push({ label: "Border tension", v: bt });
    if (r && r.open) out.push({ label: "Open borders", v: 1 });
    var tr = root.PlanetTrade ? Math.min(2, root.PlanetTrade.foreignRoutesBetween(game, a, b)) : 0;
    if (tr) out.push({ label: "Trade partner", v: tr });
    if (r && r.war) out.push({ label: "At war", v: -6 });
    var se = sharedEnemy(game, a, b);
    if (se >= 0) out.push({ label: "Shared enemy: " + Rules.civName(game, se), v: 2 });
    var p = (r && r.pact) || {};
    if (p.ally) out.push({ label: "Allies", v: 2 });
    else if (p.def) out.push({ label: "Defensive pact", v: 1 });
    if (p.nap && p.nap > game.turn) out.push({ label: "Non-aggression pact", v: 1 });
    if (p.research && p.research > game.turn) out.push({ label: "Research agreement", v: 1 });
    ((r && r.mem) || []).forEach(function (m) { out.push({ label: m.label, v: m.v, mem: true }); });
    // Extra reasons from other modules (governments, religion, ideology).
    REASONS.forEach(function (f) { (f(game, a, b) || []).forEach(function (x) { out.push(x); }); });
    return out;
  }
  var REASONS = [];
  function addReason(f) { REASONS.push(f); }

  function targetAttitude(game, a, b) {
    return reasons(game, a, b).reduce(function (s, x) { return s + x.v; }, 0);
  }

  // ---- pacts
  var PACT_NAMES = { nap: "Non-aggression pact", def: "Defensive pact", ally: "Alliance", research: "Research agreement" };
  var NAP_TURNS = 20, RESEARCH_TURNS = 20;
  function canPact(game, a, b, kind) {
    var r = rel(game, a, b);
    if (!r || !r.met) return "You have not met them";
    if (r.war) return "Not while at war";
    var p = r.pact || {};
    if (kind === "nap" && p.nap > game.turn) return "Already have one";
    if (kind === "def" && (p.def || p.ally)) return "Already have one";
    var cool = root.PlanetAIWar && root.PlanetAIWar.pactCooldown(game, a, b, kind);
    if (cool) return cool;
    if (kind === "ally" && p.ally) return "Already allies";
    if (kind === "research" && p.research > game.turn) return "Already researching together";
    return null;
  }
  function signPact(game, a, b, kind, turns) {
    var why = canPact(game, a, b, kind);
    if (why) return { ok: false, text: why };
    var r = rel(game, a, b), p = r.pact || (r.pact = {});
    if (kind === "nap") p.nap = game.turn + (turns || NAP_TURNS);
    else if (kind === "def") p.def = true;
    else if (kind === "ally") { p.ally = true; p.def = true; r.open = true; }
    else if (kind === "research") p.research = game.turn + (turns || RESEARCH_TURNS);
    var text = PACT_NAMES[kind] + ": " + Rules.civName(game, a) + " and " + Rules.civName(game, b);
    Rules.logEvent(game, "diplo", text, a === 0 || b === 0 ? 0 : null);
    var st = stats(game); st.pacts[kind] = (st.pacts[kind] || 0) + 1;
    return { ok: true, text: text };
  }
  function endPact(game, a, b, kind, why) {
    var r = rel(game, a, b);
    if (!r || !r.pact) return;
    var had = kind === "nap" ? r.pact.nap > game.turn : !!r.pact[kind];
    if (kind === "nap") r.pact.nap = 0; else if (kind === "research") r.pact.research = 0; else r.pact[kind] = false;
    if (kind === "ally") r.pact.def = false;
    if (had && why) Rules.logEvent(game, "diplo", PACT_NAMES[kind] + " between " + Rules.civName(game, a) + " and " + Rules.civName(game, b) + " ended (" + why + ")", a === 0 || b === 0 ? 0 : null);
  }
  function stats(game) {
    var d = ensure(game);
    return d.stats || (d.stats = { pacts: {}, wars: 0, broken: 0, joined: 0 });
  }

  function word(r) {
    if (!r) return "Unknown";
    if (r.war) return "At war";
    var a = r.att;
    return a <= -6 ? "Hostile" : a <= -2 ? "Wary" : a < 2 ? "Neutral" : a < 6 ? "Friendly" : "Cordial";
  }

  function canEnter(game, mover, owner) {
    if (owner < 0 || owner === mover) return true;
    var r = rel(game, mover, owner);
    return !!(r && (r.open || r.war));
  }

  function meet(game, a, b) {
    var d = ensure(game), k = pk(a, b);
    if (d.pairs[k] && d.pairs[k].met) return false;
    d.pairs[k] = { met: true, metTurn: game.turn, war: false, warTurn: null, open: false, att: Math.max(-4, Math.min(4, affinity(game, a, b))) };
    return true;
  }

  /*
   * First contacts for every pair, from what each civ sees now.
   * Returns [{ a, b }] for new meetings; pairs with the player come first.
   */
  function checkContacts(game) {
    var out = [];
    for (var a = 0; a < game.civs.length; a++) {
      var seen = Vision.seenCivs(game, a);
      for (var i = 0; i < seen.length; i++) {
        if (meet(game, a, seen[i])) out.push({ a: Math.min(a, seen[i]), b: Math.max(a, seen[i]) });
      }
    }
    out.sort(function (x, y) { return x.a - y.a; });
    return out;
  }

  function contactEvent(game, c) {
    var text = c.a === 0
      ? "First contact: the " + game.civs[c.b].design.people + " of " + Rules.civName(game, c.b)
      : Rules.civName(game, c.a) + " met " + Rules.civName(game, c.b);
    return { kind: "contact", text: text, cid: c.a === 0 ? 0 : null, contact: c, log: c.a === 0 };
  }

  function setOpenBorders(game, a, b, on) {
    var r = rel(game, a, b);
    if (!r || !r.met) return { ok: false, text: "You have not met them" };
    if (r.war) return { ok: false, text: "Not while at war" };
    var name = Rules.civName(game, b);
    if (!on) {
      r.open = false;
      Rules.logEvent(game, "diplo", "Borders with " + name + " closed", 0);
      return { ok: true, text: "Borders with " + name + " are closed" };
    }
    if (r.att <= -2) return { ok: false, text: name + " refuses: they are " + word(r).toLowerCase() };
    r.open = true;
    Rules.logEvent(game, "diplo", "Open borders with " + name, 0);
    return { ok: true, text: name + " agrees to open borders" };
  }

  function declareWar(game, a, b, opts) {
    var r = rel(game, a, b);
    if (!r || !r.met || r.war || game.civs[a].eliminated || game.civs[b].eliminated) return { ok: false, text: "Cannot declare war" };
    var truce = root.PlanetPeace && root.PlanetPeace.truceBlocks(game, a, b);
    if (truce) return { ok: false, text: truce, truce: true };
    opts = opts || {};
    var p = r.pact || {};
    var broke = (p.nap && p.nap > game.turn) || p.def || p.ally;
    r.war = true; r.warTurn = game.turn; r.open = false;
    r.att = Math.max(-10, r.att - 8);
    r.pact = {};
    if (root.PlanetTrade) root.PlanetTrade.cancelBetween(game, a, b, "war");
    if (root.PlanetDeals) root.PlanetDeals.cancelBetween(game, a, b, "war");
    stats(game).wars++;
    if (root.PlanetPeace) root.PlanetPeace.onWar(game, a, b);
    var text = Rules.civName(game, a) + (opts.joining ? " joined the war against " : " declared war on ") + Rules.civName(game, b);
    if (broke) {
      // Breaking a pact: a big hit with the victim and everyone who knows a.
      stats(game).broken++;
      remember(game, a, b, "broke-pact", -8, "Broke a pact with us");
      metCivs(game, a).forEach(function (c) { if (c !== b) remember(game, a, c, "untrustworthy", -3, "Broke a pact with " + Rules.civName(game, b)); });
      text += ", breaking their pact";
    }
    Rules.logEvent(game, "war", text, null);
    if (!opts.joining) callToArms(game, a, b);
    return { ok: true, text: text, broke: !!broke };
  }

  // b was attacked by a: defensive partners and allies of b come in.
  function callToArms(game, a, b) {
    for (var c = 0; c < game.civs.length; c++) {
      if (c === a || c === b || game.civs[c].eliminated) continue;
      var p = pactOf(game, b, c);
      if (!p.def && !p.ally) continue;
      if (atWar(game, c, a)) continue;
      if (!met(game, c, a)) meet(game, c, a);
      if (game.civs[c].ai) {
        var res = declareWar(game, c, a, { joining: true });
        if (res.ok) { stats(game).joined++; remember(game, b, c, "honoured", 3, "Honoured our pact"); }
      } else {
        ensure(game).asks.push({ kind: "pact", from: b, against: a, turn: game.turn });
        Rules.logEvent(game, "diplo", Rules.civName(game, b) + " was attacked by " + Rules.civName(game, a) + " and calls on your pact", 0);
      }
    }
  }

  // The player answers a call (pact or help request). yes: join the war.
  function answerAsk(game, idx, yes) {
    var asks = ensure(game).asks, q = asks[idx];
    if (!q) return { ok: false, text: "Nothing to answer" };
    asks.splice(idx, 1);
    var friend = Rules.civName(game, q.from), foe = Rules.civName(game, q.against);
    if (yes) {
      var res = declareWar(game, 0, q.against, { joining: true });
      remember(game, 0, q.from, q.kind === "pact" ? "honoured" : "helped", 3, q.kind === "pact" ? "Honoured our pact" : "Joined our war");
      return { ok: true, text: res.ok ? "You joined " + friend + " against " + foe : "Already at war with " + foe };
    }
    if (q.kind === "pact") {
      remember(game, 0, q.from, "abandoned", -5, "Abandoned us when attacked");
      endPact(game, 0, q.from, "ally", "you declined"); endPact(game, 0, q.from, "def", "you declined");
      return { ok: true, text: "You stayed out; " + friend + " won't forget" };
    }
    remember(game, 0, q.from, "refused-help", -1, "Refused to help in a war");
    return { ok: true, text: "You declined " + friend + "'s request" };
  }

  function makePeace(game, a, b) {
    var r = rel(game, a, b);
    if (!r || !r.war) return { ok: false, text: "Not at war" };
    var name = Rules.civName(game, b);
    if (game.turn - r.warTurn < 5) return { ok: false, text: name + " will not talk peace yet (" + (5 - (game.turn - r.warTurn)) + " more turns)" };
    // An AI accepts only if it is not winning (ai.js decides).
    if (game.civs[b].ai && root.PlanetAI && !root.PlanetAI.willPeace(game, b, a) && r.offer !== b) {
      return { ok: false, text: name + " smells victory and refuses peace" };
    }
    r.war = false; r.offer = null; r.att = Math.min(r.att, -3);
    if (root.PlanetPeace) root.PlanetPeace.onPeace(game, a, b, null);
    Rules.logEvent(game, "diplo", "Peace: " + Rules.civName(game, a) + " and " + name, null);
    return { ok: true, text: "Peace with " + name };
  }

  // An AI at war offers peace to b (the player answers in the diplomacy panel).
  function offerPeace(game, from, to) {
    var r = rel(game, from, to);
    if (!r || !r.war || r.offer === from) return false;
    r.offer = from;
    return true;
  }

  function acceptPeace(game, a, b) {
    var r = rel(game, a, b);
    if (!r || !r.war || r.offer !== b) return { ok: false, text: "No offer to accept" };
    r.war = false; r.offer = null; r.att = Math.min(r.att, -3);
    if (root.PlanetPeace) root.PlanetPeace.onPeace(game, a, b, null);
    Rules.logEvent(game, "diplo", "Peace with " + Rules.civName(game, b), null);
    return { ok: true, text: "Peace with " + Rules.civName(game, b) };
  }

  // Each turn attitude moves one step toward its target; hostile AIs close borders.
  function drift(game, events) {
    var d = ensure(game);
    // Calls to arms the player didn't answer in time lapse (as declined).
    d.asks = d.asks.filter(function (q) { return game.turn - q.turn <= 3 || !(answerLapse(game, q)); });
    for (var k in d.pairs) {
      var r = d.pairs[k];
      if (!r.met) continue;
      var ab = k.split("-").map(Number);
      fade(r);
      var p = r.pact || {};
      if (p.nap && p.nap <= game.turn) { p.nap = 0; Rules.logEvent(game, "diplo", "Non-aggression pact between " + Rules.civName(game, ab[0]) + " and " + Rules.civName(game, ab[1]) + " expired", ab[0] === 0 ? 0 : null); }
      if (p.research && p.research <= game.turn) { p.research = 0; researchPayoff(game, ab[0], ab[1], events); }
      // Pacts don't survive a souring mood.
      if (p.ally && r.att < 2) endPact(game, ab[0], ab[1], "ally", "relations soured");
      else if (p.def && !p.ally && r.att < 0) endPact(game, ab[0], ab[1], "def", "relations soured");
      var target = Math.max(-10, Math.min(10, targetAttitude(game, ab[0], ab[1])));
      if (r.att < target) r.att += 1; else if (r.att > target) r.att -= 1;
      if (r.open && r.att <= -4) {
        r.open = false;
        if (ab[0] === 0) events.push({ kind: "diplo", text: Rules.civName(game, ab[1]) + " closed their borders to you", cid: 0 });
      }
    }
  }

  function answerLapse(game, q) {
    if (q.kind === "pact") { remember(game, 0, q.from, "abandoned", -5, "Abandoned us when attacked"); endPact(game, 0, q.from, "ally", "no answer"); endPact(game, 0, q.from, "def", "no answer"); }
    return true;
  }

  // Research agreement payoff: each side gets 60% of its cheapest unknown tech's cost.
  function researchPayoff(game, a, b, events) {
    [a, b].forEach(function (c) {
      var T = root.PlanetTech, cv = game.civs[c];
      if (!T || !cv.tech) return;
      var left = Object.keys(T.TECHS).filter(function (id) { return cv.tech.done.indexOf(id) === -1; });
      if (!left.length) return;
      var cost = Math.min.apply(null, left.map(function (id) { return T.TECHS[id].cost; }));
      var gain = Math.round(cost * 0.6);
      cv.tech.progress = (cv.tech.progress || 0) + gain;
      if (c === 0) events.push({ kind: "tech", text: "Research agreement with " + Rules.civName(game, c === a ? b : a) + " ended: +" + gain + " science", cid: 0 });
    });
  }

  var WORLD = {
    init: function (game) { ensure(game); },
    onEndTurn: function (game, events) {
      drift(game, events);
      checkContacts(game).forEach(function (c) { events.push(contactEvent(game, c)); });
    }
  };

  function makeModifiers(game, cid) {
    return {
      moveCost: function (tile, cost, info) {
        // Missionaries may walk into any land not at war (they preach, not trespass).
        if (info.unit && info.unit.type === "missionary") return cost;
        return canEnter(game, cid, info.tileCiv) ? cost : Infinity;
      }
    };
  }

  // ---- Greeting: assembled from the speaker's traits, tone from attitude.
  var LINES = {
    agrarian: ["Come, share bread from our fields", "Our granaries are full and our hearths are warm", "The harvest was kind to us this year"],
    industrious: ["Our forges have not cooled in a generation", "We build, and what we build stands", "Stone and bronze answer to our hands"],
    seafaring: ["The tides told us you were coming", "Our sails have seen many shores, but not yours", "The sea is wide, and it brings us friends and fools"],
    expansionist: ["The land is wide, though not endless", "Our people need room to grow", "Every ridge hides a valley we have yet to name"],
    militaristic: ["Our spears are many and our captains restless", "Strength is the only language we trust", "We greet you with open hands, for now"],
    mercantile: ["Our caravans would welcome your coin", "Everything has a price, even friendship", "Trade with us and both our purses grow"],
    nomadic: ["We have ridden far and seen many like you", "Our tents move with the herds, and our eyes miss nothing", "The steppe is our home, and the road our hearth"],
    scholarly: ["Our scribes will want to record your coming", "Tell us of your stars; we will tell you of ours", "Knowledge shared is knowledge doubled"]
  };
  var OPENERS = ["Greetings, stranger.", "So, you are real.", "Well met.", "Hail, travellers."];
  var CLOSERS = {
    good: ["May our roads run side by side.", "Let us be good neighbours.", "Our doors are open to you."],
    mid: ["We will be watching how you walk.", "Time will tell what you are.", "Mind our borders, and we will mind yours."],
    bad: ["Do not test our patience.", "Keep your distance.", "We have buried bolder people than you."]
  };
  function hs(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pick(list, seed) { return list[seed % list.length]; }

  function greeting(design, att) {
    var seed = hs(design.name + design.leaderName);
    var lines = (design.traits || []).map(function (t, i) { return LINES[t] ? pick(LINES[t], seed >>> (i * 3)) : null; }).filter(Boolean);
    var tone = att >= 2 ? "good" : att <= -2 ? "bad" : "mid";
    return pick(OPENERS, seed >>> 7) + " " + lines.map(function (l) { return l + "."; }).join(" ") + " " + pick(CLOSERS[tone], seed >>> 11);
  }

  root.PlanetDiplomacy = {
    addReason: addReason,
    WORLD: WORLD, OPPOSED: OPPOSED,
    ensure: ensure, rel: rel, met: met, metCivs: metCivs, meet: meet, word: word,
    affinity: affinity, borderTension: borderTension, targetAttitude: targetAttitude,
    canEnter: canEnter, checkContacts: checkContacts, contactEvent: contactEvent,
    setOpenBorders: setOpenBorders, declareWar: declareWar, makePeace: makePeace,
    remember: remember, reasons: reasons, pactOf: pactOf, napActive: napActive, allies: allies, sharedEnemy: sharedEnemy,
    PACT_NAMES: PACT_NAMES, NAP_TURNS: NAP_TURNS, RESEARCH_TURNS: RESEARCH_TURNS, canPact: canPact, signPact: signPact, endPact: endPact,
    callToArms: callToArms, answerAsk: answerAsk, stats: stats, atWar: atWar,
    offerPeace: offerPeace, acceptPeace: acceptPeace,
    makeModifiers: makeModifiers, greeting: greeting
  };
})(typeof window !== "undefined" ? window : globalThis);
