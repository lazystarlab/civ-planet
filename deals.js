/*
 * deals.js — TRADE DEALS, AI OFFERS AND DEMANDS. No DOM.
 *
 * A deal: { from, to, give: [items from -> to], ask: [items to -> from], pacts: [kinds] }
 * Items: { t: "gold", n } lump sum · { t: "gpt", n, turns } gold per turn
 *        { t: "tech", id } · { t: "lux", res, turns } luxury access (counts for happiness)
 *        { t: "map" } explored tiles · { t: "city", id } (never a capital)
 * Pacts (mutual): "open" borders, "nap" (20 turns), "def" defensive pact,
 *        "ally" alliance, "research" (both pay 60 gold; science for both after 20 turns).
 *
 * evaluate(game, deal) answers for deal.to with a value model:
 *   net = value of what it gets - cost of what it gives + pact values
 *   need = 15 - 5 x attitude (friendlier civs accept less), -15 if much weaker
 *   traits weight items (mercantile gold, scholarly techs, militaristic pacts ...)
 *   verdict: "accept" (net >= need), "more" (within reach: they say how much), "refuse".
 * counter(game, deal) adds what they'd want (a tech, gold, gold per turn) or drops
 * what they give until it's acceptable.
 * Ongoing items live in game.deals.active and run each turn; failing to pay
 * cancels the deal and is remembered. Pending AI proposals to the player sit in
 * game.deals.pending until answered (2 turns).
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Diplo = root.PlanetDiplomacy;
  var Tech = root.PlanetTech;

  var GPT_TURNS = 20, LUX_TURNS = 30, RESEARCH_COST = 60;
  var LUXURIES = ["gems", "spices", "gold"];

  function state(game) {
    var d = game.deals || (game.deals = {});
    if (!d.active) d.active = [];
    if (!d.pending) d.pending = [];
    if (!d.nextId) d.nextId = 1;
    if (!d.stats) d.stats = { deals: 0, gifts: 0, demands: 0, tribute: 0, refused: 0, techSales: 0, luxDeals: 0, offers: 0, helpAsked: 0, helpJoined: 0 };
    if (!d.last) d.last = {};
    if (d.ver == null) d.ver = 0;
    return d;
  }
  function bump(game) { state(game).ver++; }

  function traits(game, cid) { var d = game.civs[cid].design; return (d && d.traits) || []; }
  function hasTrait(game, cid, t) { return traits(game, cid).indexOf(t) !== -1; }
  function power(game, cid) { return root.PlanetCombat.militaryPower(game, cid) + 2 * Rules.citiesOf(game, cid).length; }
  function att(game, a, b) { var r = Diplo.rel(game, a, b); return r ? r.att : 0; }
  function hs(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // Luxury copies a civ holds: { gems: 2, ... }
  function luxCopies(game, cid) {
    var out = {};
    game.owner.forEach(function (cityId, k) {
      var c = Rules.cityById(game, cityId);
      if (!c || c.owner !== cid) return;
      var t = game.index.get(k);
      if (t && t.resource && LUXURIES.indexOf(t.resource) !== -1) out[t.resource] = (out[t.resource] || 0) + 1;
    });
    return out;
  }
  function luxIn(game, cid) {
    return state(game).active.filter(function (a) { return a.t === "lux" && a.to === cid; }).map(function (a) { return { res: a.res, from: a.from, turns: a.turns }; });
  }
  function luxOut(game, cid) {
    return state(game).active.filter(function (a) { return a.t === "lux" && a.from === cid; }).map(function (a) { return a.res; });
  }
  function techsToOffer(game, from, to) {
    return Tech.TECH_ORDER.filter(function (id) { return Tech.has(game, id, from) && !Tech.has(game, id, to); });
  }
  function techValue(id) { return Tech.TECHS[id].cost * 2; }
  function revealedGain(game, from, to) {
    var a = game.civs[from].revealed, b = game.civs[to].revealed, n = 0;
    a.forEach(function (k) { if (!b.has(k)) n++; });
    return n;
  }
  function incomeOf(game, cid) {
    var g = 0;
    Rules.citiesOf(game, cid).forEach(function (c) { g += Rules.cityYield(game, c).gold; });
    return g;
  }

  // ---- values, from the point of view of `self` (the civ evaluating)
  // Item types added by other modules: EXT[t] = { value, cost, invalid, execute, describe }.
  var EXT = {};
  function addItemType(t, def) { EXT[t] = def; }
  function itemValue(game, it, recv, giver) {
    if (EXT[it.t]) return EXT[it.t].value(game, it, recv, giver);
    if (it.t === "gold") return it.n;
    if (it.t === "gpt") return it.n * (it.turns || GPT_TURNS) * 0.75;
    if (it.t === "tech") return Tech.has(game, it.id, recv) ? 0 : techValue(it.id);
    if (it.t === "lux") {
      var have = luxCopies(game, recv)[it.res] || luxIn(game, recv).some(function (l) { return l.res === it.res; });
      return have ? 10 : 80;
    }
    if (it.t === "map") return Math.min(150, 15 + revealedGain(game, giver, recv) * 0.15);
    if (it.t === "city") { var c = Rules.cityById(game, it.id); return c ? c.pop * 40 + 80 + (c.buildings || []).length * 15 : 0; }
    return 0;
  }
  function itemCost(game, it, giver, recv) {
    if (EXT[it.t]) return EXT[it.t].cost(game, it, giver, recv);
    var a = att(game, giver, recv);
    if (it.t === "gold") return it.n;
    if (it.t === "gpt") return it.n * (it.turns || GPT_TURNS);
    if (it.t === "tech") return techValue(it.id) * 0.7 + (a < 0 ? techValue(it.id) * 0.5 : 0) + (power(game, recv) > power(game, giver) * 1.3 ? techValue(it.id) * 0.3 : 0);
    if (it.t === "lux") return (luxCopies(game, giver)[it.res] || 0) <= 1 ? 100 : 15;
    if (it.t === "map") return 10 + (a < 0 ? 40 : 0);
    if (it.t === "city") return itemValue(game, it, recv, giver) * 1.5;
    return 0;
  }
  function weight(game, self, it, receiving) {
    var w = 1;
    if ((it.t === "gold" || it.t === "gpt") && hasTrait(game, self, "mercantile")) w = receiving ? 1.25 : 0.9;
    if (it.t === "tech" && hasTrait(game, self, "scholarly")) w = 1.4;
    if (it.t === "city" && hasTrait(game, self, "expansionist")) w = 1.3;
    if (it.t === "map" && hasTrait(game, self, "seafaring")) w = 1.3;
    if (it.t === "lux" && hasTrait(game, self, "agrarian")) w = 1.2;
    return w;
  }
  // Value of a pact to `self` with `other`, or a refusal reason.
  function pactValue(game, self, other, kind) {
    var a = att(game, self, other), mil = hasTrait(game, self, "militaristic");
    var why = Diplo.canPact(game, self, other, kind);
    if (why) return { block: why };
    if (kind === "open") return a >= 0 ? { v: 8 } : a >= -2 ? { v: -10 } : { block: "They don't trust you enough to open borders" };
    if (kind === "nap") {
      if (a < -3) return { block: "They are hostile" };
      // A much stronger civ keeps its options open (slice 12: wars happen).
      var amb = mil || hasTrait(game, self, "expansionist");
      if (power(game, self) > power(game, other) * (amb ? 1.4 : 1.8) && a < 6) return { block: "They would rather keep their options open" };
      return { v: 12 };
    }
    if (kind === "def") return a >= 3 ? { v: (mil ? 15 : 25) + (power(game, other) > power(game, self) ? 10 : 0) } : { block: "A defensive pact needs Friendly relations" };
    if (kind === "ally") return a >= 6 ? { v: mil ? 55 : 40 } : { block: "An alliance needs Cordial relations" };
    if (kind === "research") {
      if (a < 1) return { block: "They don't want to share research" };
      if (game.civs[self].gold < RESEARCH_COST) return { block: "They can't pay " + RESEARCH_COST + " gold" };
      if (game.civs[other].gold < RESEARCH_COST) return { block: "You need " + RESEARCH_COST + " gold" };
      if (!Tech.TECH_ORDER.some(function (id) { return !Tech.has(game, id, self); })) return { block: "They have nothing left to research" };
      return { v: hasTrait(game, self, "scholarly") ? 35 : 20 };
    }
    return { v: 0 };
  }

  // Is the deal possible at all? Returns a reason or null.
  function invalid(game, deal) {
    var r = Diplo.rel(game, deal.from, deal.to);
    if (!r || !r.met) return "You have not met them";
    var isPeace = (deal.pacts || []).indexOf("peace") !== -1;
    if (r.war && !isPeace) return "Not while at war (add a Peace treaty)";
    if (!r.war && isPeace) return "You are not at war";
    var sides = [[deal.give, deal.from, deal.to], [deal.ask, deal.to, deal.from]];
    for (var s = 0; s < 2; s++) {
      var items = sides[s][0] || [], giver = sides[s][1], recv = sides[s][2];
      var gold = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.t === "gold") gold += it.n;
        if (EXT[it.t]) { var why = EXT[it.t].invalid(game, it, giver, recv); if (why) return why; }
        if (it.t === "tech" && (!Tech.has(game, it.id, giver) || Tech.has(game, it.id, recv))) return "Tech not available";
        if (it.t === "lux" && !(luxCopies(game, giver)[it.res])) return "Luxury not available";
        if (it.t === "lux" && luxOut(game, giver).indexOf(it.res) !== -1) return "That luxury is already traded";
        if (it.t === "city") { var c = Rules.cityById(game, it.id); if (!c || c.owner !== giver || c.capital) return "City not available"; }
        if ((it.t === "gold" || it.t === "gpt") && !(it.n > 0)) return "Enter an amount";
      }
      if (gold > game.civs[giver].gold) return (giver === 0 ? "You don't" : Rules.civName(game, giver) + " doesn't") + " have " + gold + " gold";
    }
    return null;
  }

  function evaluate(game, deal) {
    // Peace treaties have their own evaluator (peace.js: war score and weariness).
    if ((deal.pacts || []).indexOf("peace") !== -1 && root.PlanetPeace) return root.PlanetPeace.evaluate(game, deal);
    var self = deal.to, other = deal.from;
    var bad = invalid(game, deal);
    if (bad) return { verdict: "refuse", reason: bad, net: 0, need: 0, blocked: true };
    var net = 0, gets = 0, costs = 0;
    (deal.give || []).forEach(function (it) { var v = itemValue(game, it, self, other) * weight(game, self, it, true); gets += v; });
    (deal.ask || []).forEach(function (it) {
      if (it.t === "city" && att(game, self, other) < 6) costs += 1e6;
      costs += itemCost(game, it, self, other) * weight(game, self, it, false);
    });
    net = gets - costs;
    for (var i = 0; i < (deal.pacts || []).length; i++) {
      var pv = pactValue(game, self, other, deal.pacts[i]);
      if (pv.block) return { verdict: "refuse", reason: pv.block, net: net, need: 0, blocked: true };
      net += pv.v;
    }
    if (costs >= 1e6) return { verdict: "refuse", reason: "They will not give up a city", net: net, need: 0, blocked: true };
    var a = att(game, self, other);
    var need = 15 - 5 * a;
    if (power(game, self) < power(game, other) * 0.5) need -= 15;
    var empty = !(deal.give || []).length && !(deal.ask || []).length && !(deal.pacts || []).length;
    if (empty) return { verdict: "refuse", reason: "Add something to the deal", net: 0, need: need, blocked: true };
    // Pure gifts are always welcome.
    if (!(deal.ask || []).length && !(deal.pacts || []).length) return { verdict: "accept", reason: "A gift! They are pleased", net: net, need: need, gift: true };
    if (net >= need) return { verdict: "accept", reason: "Acceptable", net: net, need: need };
    var want = Math.ceil(need - net);
    if (want <= Math.max(60, costs * 0.6)) return { verdict: "more", reason: "They want more (about " + want + " gold's worth)", net: net, need: need, want: want };
    return { verdict: "refuse", reason: "Not worth it to them", net: net, need: need, want: want };
  }

  function clone(deal) { return JSON.parse(JSON.stringify(deal)); }

  // What would make it acceptable? Returns { deal, ok }.
  function counter(game, deal) {
    var d = clone(deal);
    for (var step = 0; step < 8; step++) {
      var ev = evaluate(game, d);
      if (ev.verdict === "accept") return { deal: d, ok: true, eval: ev };
      if (ev.blocked) return { deal: d, ok: false, eval: ev };
      var want = ev.want || 1;
      var from = d.from, to = d.to;
      // A tech we lack, closest in value to what's missing.
      var techs = techsToOffer(game, from, to).filter(function (id) { return !d.give.some(function (x) { return x.t === "tech" && x.id === id; }); })
        .sort(function (x, y) { return Math.abs(techValue(x) - want) - Math.abs(techValue(y) - want); });
      var goldIn = d.give.filter(function (x) { return x.t === "gold"; })[0];
      var free = game.civs[from].gold - (goldIn ? goldIn.n : 0);
      if (free >= want) {
        if (goldIn) goldIn.n += want; else d.give.push({ t: "gold", n: want });
      } else if (techs.length) d.give.push({ t: "tech", id: techs[0] });
      else if (free > 0) { if (goldIn) goldIn.n += free; else d.give.push({ t: "gold", n: free }); }
      else if (Math.max(1, incomeOf(game, from)) >= Math.ceil(want / (GPT_TURNS * 0.75)) && !d.give.some(function (x) { return x.t === "gpt"; })) {
        d.give.push({ t: "gpt", n: Math.ceil(want / (GPT_TURNS * 0.75)), turns: GPT_TURNS });
      } else if (d.ask.length) {
        d.ask.sort(function (x, y) { return itemCost(game, y, to, from) - itemCost(game, x, to, from); });
        d.ask.shift();
      } else return { deal: d, ok: false, eval: ev };
    }
    var last = evaluate(game, d);
    return { deal: d, ok: last.verdict === "accept", eval: last };
  }

  function transferCity(game, c, to) {
    var from = c.owner;
    var home = Rules.citiesOf(game, from).filter(function (x) { return x.capital; })[0];
    game.units.filter(function (u) { return u.owner === from && u.q === c.q && u.r === c.r; }).forEach(function (u) {
      if (home) Rules.placeUnit ? Rules.placeUnit(game, u, home.q, home.r) : (u.q = home.q, u.r = home.r);
    });
    c.owner = to; c.capital = false; c.build = null; c.prod = 0; c.repeat = false;
  }

  function apply(game, items, giver, recv, deal) {
    var st = state(game);
    items.forEach(function (it) {
      if (EXT[it.t]) EXT[it.t].execute(game, it, giver, recv);
      else if (it.t === "gold") { game.civs[giver].gold -= it.n; game.civs[recv].gold += it.n; }
      else if (it.t === "gpt") st.active.push({ id: st.nextId++, t: "gpt", from: giver, to: recv, n: it.n, turns: it.turns || GPT_TURNS });
      else if (it.t === "tech") Tech.grant(game, recv, it.id);
      else if (it.t === "lux") { st.active.push({ id: st.nextId++, t: "lux", from: giver, to: recv, res: it.res, turns: it.turns || LUX_TURNS }); st.stats.luxDeals++; }
      else if (it.t === "map") game.civs[giver].revealed.forEach(function (k) { game.civs[recv].revealed.add(k); });
      else if (it.t === "city") transferCity(game, Rules.cityById(game, it.id), recv);
    });
  }

  function describe(game, deal) {
    var name = function (it) {
      if (EXT[it.t]) return EXT[it.t].describe(game, it);
      if (it.t === "gold") return it.n + " gold";
      if (it.t === "gpt") return it.n + " gold/turn for " + (it.turns || GPT_TURNS) + " turns";
      if (it.t === "tech") return Tech.TECHS[it.id].name;
      if (it.t === "lux") return root.PlanetGen.RESOURCES[it.res].name + " for " + (it.turns || LUX_TURNS) + " turns";
      if (it.t === "map") return "their map";
      if (it.t === "city") return (Rules.cityById(game, it.id) || {}).name;
      return it.t;
    };
    var parts = [];
    if (deal.give.length) parts.push(Rules.civName(game, deal.from) + " gives " + deal.give.map(name).join(", "));
    if (deal.ask.length) parts.push(Rules.civName(game, deal.to) + " gives " + deal.ask.map(name).join(", "));
    if ((deal.pacts || []).length) parts.push(deal.pacts.map(function (k) { return k === "open" ? "Open borders" : k === "peace" ? "Peace treaty" : Diplo.PACT_NAMES[k]; }).join(", "));
    return parts.join("; ");
  }

  // Carry out a deal (already agreed). Returns { ok, text }.
  function execute(game, deal) {
    var bad = invalid(game, deal);
    if (bad) return { ok: false, text: bad };
    var st = state(game);
    apply(game, deal.give || [], deal.from, deal.to, deal);
    apply(game, deal.ask || [], deal.to, deal.from, deal);
    (deal.pacts || []).forEach(function (k) {
      if (k === "peace") {
        var pr = Diplo.rel(game, deal.from, deal.to);
        pr.war = false; pr.offer = null; pr.att = Math.min(pr.att, -2);
        var white = !(deal.give || []).length && !(deal.ask || []).length;
        if (root.PlanetPeace) root.PlanetPeace.onPeace(game, deal.from, deal.to, { terms: white ? "" : describe(game, deal) });
        Rules.logEvent(game, "diplo", "Peace treaty between " + Rules.civName(game, deal.from) + " and " + Rules.civName(game, deal.to) + (white ? " (white peace)" : ""), deal.from === 0 || deal.to === 0 ? 0 : null);
      } else if (k === "open") { var r = Diplo.rel(game, deal.from, deal.to); r.open = true; }
      else {
        if (k === "research") { game.civs[deal.from].gold -= RESEARCH_COST; game.civs[deal.to].gold -= RESEARCH_COST; }
        Diplo.signPact(game, deal.from, deal.to, k);
      }
    });
    var gift = !(deal.ask || []).length && !(deal.pacts || []).length;
    if (gift) {
      var v = (deal.give || []).reduce(function (s, it) { return s + itemValue(game, it, deal.to, deal.from); }, 0);
      Diplo.remember(game, deal.from, deal.to, "gifts", Math.max(1, Math.min(5, v / 40)), "Gave us gifts");
      st.stats.gifts++;
    } else if ((deal.pacts || []).indexOf("peace") === -1) Diplo.remember(game, deal.from, deal.to, "deals", 1, "Trades with us");
    if ((deal.give || []).concat(deal.ask || []).some(function (it) { return it.t === "tech"; })) st.stats.techSales++;
    st.stats.deals++;
    bump(game);
    var text = "Deal: " + describe(game, deal);
    Rules.logEvent(game, "diplo", text, deal.from === 0 || deal.to === 0 ? 0 : null);
    return { ok: true, text: text };
  }

  function cancelBetween(game, a, b, why) {
    var st = state(game);
    var before = st.active.length;
    st.active = st.active.filter(function (x) { return !((x.from === a && x.to === b) || (x.from === b && x.to === a)); });
    if (st.active.length !== before) {
      bump(game);
      if (a === 0 || b === 0) Rules.logEvent(game, "diplo", "Deals with " + Rules.civName(game, a === 0 ? b : a) + " cancelled (" + why + ")", 0);
    }
  }

  // Ongoing items, once a turn (world hook).
  function tick(game, events) {
    var st = state(game), keep = [];
    st.active.forEach(function (x) {
      var drop = false;
      if (x.t === "gpt") {
        if (game.civs[x.from].gold >= x.n && !game.civs[x.from].eliminated) { game.civs[x.from].gold -= x.n; game.civs[x.to].gold += x.n; }
        else {
          drop = true;
          Diplo.remember(game, x.from, x.to, "broke-deal", -4, "Stopped paying what was promised");
          Rules.logEvent(game, "diplo", Rules.civName(game, x.from) + " could not pay " + Rules.civName(game, x.to) + " and broke the deal", x.from === 0 || x.to === 0 ? 0 : null);
        }
      }
      if (x.t === "lux" && !(luxCopies(game, x.from)[x.res])) {
        drop = true;
        Rules.logEvent(game, "diplo", root.PlanetGen.RESOURCES[x.res].name + " deal ended: " + Rules.civName(game, x.from) + " no longer has it", x.from === 0 || x.to === 0 ? 0 : null);
      }
      if (!drop && --x.turns <= 0) {
        drop = true;
        if (x.from === 0 || x.to === 0) Rules.logEvent(game, "diplo", (x.t === "gpt" ? "Gold payments" : root.PlanetGen.RESOURCES[x.res].name + " access") + " between " + Rules.civName(game, x.from) + " and " + Rules.civName(game, x.to) + " ended", 0);
      }
      if (drop) bump(game); else keep.push(x);
    });
    st.active = keep;
    // Unanswered proposals lapse after 2 turns (as a refusal).
    st.pending = st.pending.filter(function (p) {
      if (game.turn - p.turn < 2) return true;
      decline(game, p, true);
      return false;
    });
  }

  // ---- proposals between civs
  function propose(game, kind, deal, extra) {
    var st = state(game);
    var p = Object.assign({ id: st.nextId++, kind: kind, deal: deal, from: deal.from, turn: game.turn }, extra || {});
    st.last[deal.from + ">" + deal.to + ":" + kind] = game.turn;
    if (kind === "demand") st.stats.demands++; else st.stats.offers++;
    if (!game.civs[deal.to].ai && !game._autoPlayer) {
      if (st.pending.some(function (q) { return q.from === deal.from; })) return null;
      st.pending.push(p);
      Rules.logEvent(game, "diplo", Rules.civName(game, deal.from) + (kind === "demand" ? " demands tribute" : kind === "help" ? " asks for your help" : " has a proposal") + " (see Diplomacy)", 0);
      bump(game);
      return p;
    }
    respond(game, p, decide(game, p));
    return p;
  }

  // Would the receiving AI say yes?
  function decide(game, p) {
    var deal = p.deal, self = deal.to, other = deal.from;
    if (p.kind === "demand") {
      var ratio = power(game, other) / Math.max(1, power(game, self));
      var v = deal.ask.reduce(function (s, it) { return s + itemCost(game, it, self, other); }, 0);
      return ratio >= 2.5 || (ratio >= 2 && v <= 40) || (Diplo.allies(game, self).length === 0 && ratio >= 2.2 && v <= 80);
    }
    if (p.kind === "help") {
      var foe = p.against;
      return att(game, self, foe) <= -2 && power(game, self) >= power(game, foe) * 0.7 && !Diplo.napActive(game, self, foe);
    }
    return evaluate(game, deal).verdict === "accept";
  }

  function respond(game, p, yes) { if (yes) accept(game, p); else decline(game, p, false); }

  function accept(game, p) {
    var st = state(game), deal = p.deal;
    if (p.kind === "help") {
      var res = Diplo.declareWar(game, deal.to, p.against, { joining: true });
      if (res.ok) { Diplo.remember(game, deal.to, deal.from, "helped", 3, "Joined our war"); st.stats.helpJoined++; }
      return { ok: res.ok, text: res.ok ? "You joined " + Rules.civName(game, deal.from) + " against " + Rules.civName(game, p.against) : res.text };
    }
    var r = execute(game, deal);
    if (r.ok && p.kind === "demand") { st.stats.tribute++; Diplo.remember(game, deal.from, deal.to, "tribute", 1, "Paid us tribute"); }
    return r;
  }

  function decline(game, p, lapsed) {
    var st = state(game), deal = p.deal, from = deal.from, to = deal.to;
    if (p.kind === "demand") {
      st.stats.refused++;
      Diplo.remember(game, from, to, "refused-tribute", -3, "Refused our demand");
      var ratio = power(game, from) / Math.max(1, power(game, to));
      var napOn = Diplo.napActive(game, from, to);
      if (!napOn && (ratio >= 3 || (hasTrait(game, from, "militaristic") && ratio >= 2.2))) {
        var w = Diplo.declareWar(game, from, to);
        if (w.ok && to === 0) Rules.logEvent(game, "war", Rules.civName(game, from) + " answered your refusal with war", 0);
        return { ok: true, text: "Refused. " + Rules.civName(game, from) + " declares war!" };
      }
      return { ok: true, text: "Refused. " + Rules.civName(game, from) + " won't forget it" };
    }
    if (p.kind === "help") Diplo.remember(game, to, from, "refused-help", -1, "Refused to help in a war");
    return { ok: true, text: lapsed ? "Proposal lapsed" : "Declined" };
  }

  function answer(game, id, yes) {
    var st = state(game);
    var p = st.pending.filter(function (x) { return x.id === id; })[0];
    if (!p) return { ok: false, text: "No such proposal" };
    st.pending = st.pending.filter(function (x) { return x !== p; });
    bump(game);
    return yes ? accept(game, p) : decline(game, p, false);
  }

  // ---- AI: one diplomatic move per partner now and then.
  function since(game, a, b, kind) { var t = state(game).last[a + ">" + b + ":" + kind]; return t == null ? 999 : game.turn - t; }

  function aiTurn(game, cid) {
    if (game.civs[cid].eliminated || !Rules.citiesOf(game, cid).length) return;
    var st = state(game);
    // The autoplayed player answers its pending proposals like an AI would.
    if (!game.civs[cid].ai) {
      st.pending.filter(function (p) { return p.deal.to === cid; }).forEach(function (p) { answer(game, p.id, decide(game, p)); });
      var asks = (game.diplo && game.diplo.asks) || [];
      for (var i = asks.length - 1; i >= 0; i--) Diplo.answerAsk(game, i, asks[i].kind === "pact" && power(game, cid) >= power(game, asks[i].against) * 0.6);
    }
    Diplo.metCivs(game, cid).forEach(function (b) {
      if (game.civs[b].eliminated || !Rules.citiesOf(game, b).length) return;
      var r = Diplo.rel(game, cid, b);
      if (hs(game.seed + "|" + game.turn + "|" + cid + "|" + b) % 4) return;
      var a = r.att, me = game.civs[cid], them = game.civs[b];
      if (r.war) return;
      // 1. Tribute from the much weaker.
      if (game.turn >= 30 && a <= 1 && power(game, cid) > 2 * power(game, b) && since(game, cid, b, "demand") >= 25) {
        var amt = Math.min(Math.floor(them.gold * 0.4), 30 + Math.floor(game.turn / 2));
        var tk = techsToOffer(game, b, cid)[0];
        var ask = amt >= 20 ? [{ t: "gold", n: amt }] : tk ? [{ t: "tech", id: tk }] : null;
        if (ask) { propose(game, "demand", { from: cid, to: b, give: [], ask: ask, pacts: [] }); return; }
      }
      // 2. Help in a war.
      var foe = -1;
      for (var x = 0; x < game.civs.length; x++) if (x !== cid && x !== b && Diplo.atWar(game, cid, x) && Diplo.met(game, b, x) && !Diplo.atWar(game, b, x)) { foe = x; break; }
      if (foe >= 0 && a >= 4 && since(game, cid, b, "help") >= 15) {
        st.stats.helpAsked++;
        st.last[cid + ">" + b + ":help"] = game.turn;
        if (b === 0 && !game._autoPlayer) {
          game.diplo.asks.push({ kind: "help", from: cid, against: foe, turn: game.turn });
          Rules.logEvent(game, "diplo", Rules.civName(game, cid) + " asks you to join its war against " + Rules.civName(game, foe) + " (see Diplomacy)", 0);
        } else if (b !== 0 || game._autoPlayer) {
          var hp = { kind: "help", deal: { from: cid, to: b, give: [], ask: [], pacts: [] }, against: foe };
          respond(game, hp, decide(game, hp));
        }
        return;
      }
      // 3. Pacts by mood.
      var p = r.pact || {};
      // Alliances need a reason (a shared enemy) or deep friendship.
      var se = Diplo.sharedEnemy(game, cid, b) >= 0;
      var pk = ((a >= 8 && se) || a >= 10) && !p.ally ? "ally" : a >= 6 && !p.def && !p.ally ? "def" : a >= 3 && !(p.nap > game.turn) && !p.def ? "nap" :
        a >= 2 && !(p.research > game.turn) && me.gold >= RESEARCH_COST + 20 && them.gold >= RESEARCH_COST ? "research" : null;
      if (pk && since(game, cid, b, "pact") >= 8) {
        var pd = { from: cid, to: b, give: [], ask: [], pacts: [pk] };
        if (evaluate(game, { from: b, to: cid, give: [], ask: [], pacts: [pk] }).verdict === "accept") { propose(game, "pact", pd); st.last[cid + ">" + b + ":pact"] = game.turn; return; }
      }
      // 4. Techs: swap, sell or buy.
      var mine = techsToOffer(game, cid, b), theirs = techsToOffer(game, b, cid);
      if (since(game, cid, b, "tech") >= 6 && (mine.length || theirs.length)) {
        var deal = null;
        if (mine.length && theirs.length) deal = { from: cid, to: b, give: [{ t: "tech", id: mine[0] }], ask: [{ t: "tech", id: theirs[0] }], pacts: [] };
        else if (mine.length && them.gold >= techValue(mine[0]) * 0.8) deal = { from: cid, to: b, give: [{ t: "tech", id: mine[0] }], ask: [{ t: "gold", n: Math.round(techValue(mine[0]) * 0.8) }], pacts: [] };
        else if (theirs.length && me.gold >= techValue(theirs[0]) * 0.9 + 30) deal = { from: cid, to: b, give: [{ t: "gold", n: Math.round(techValue(theirs[0]) * 0.9) }], ask: [{ t: "tech", id: theirs[0] }], pacts: [] };
        if (deal) {
          st.last[cid + ">" + b + ":tech"] = game.turn;
          // Only offer what we'd accept ourselves (mirror check).
          var mirror = { from: b, to: cid, give: deal.ask, ask: deal.give, pacts: [] };
          if (evaluate(game, mirror).verdict === "accept") { propose(game, "offer", deal); return; }
        }
      }
      // 5. Luxuries: spare copies for gold, or a swap.
      var myLux = luxCopies(game, cid), theirLux = luxCopies(game, b);
      var spare = LUXURIES.filter(function (l) { return (myLux[l] || 0) >= 2 && !theirLux[l] && luxOut(game, cid).indexOf(l) === -1; })[0];
      if (spare && since(game, cid, b, "lux") >= 10) {
        st.last[cid + ">" + b + ":lux"] = game.turn;
        var swap = LUXURIES.filter(function (l) { return (theirLux[l] || 0) >= 2 && !myLux[l] && luxOut(game, b).indexOf(l) === -1; })[0];
        var ld = swap ? { from: cid, to: b, give: [{ t: "lux", res: spare, turns: LUX_TURNS }], ask: [{ t: "lux", res: swap, turns: LUX_TURNS }], pacts: [] }
          : them.gold >= 70 ? { from: cid, to: b, give: [{ t: "lux", res: spare, turns: LUX_TURNS }], ask: [{ t: "gold", n: 60 }], pacts: [] } : null;
        if (ld) propose(game, "offer", ld);
      }
    });
  }

  var WORLD = { init: function (game) { state(game); }, onEndTurn: function (game, events) { tick(game, events); } };

  root.PlanetDeals = {
    GPT_TURNS: GPT_TURNS, LUX_TURNS: LUX_TURNS, RESEARCH_COST: RESEARCH_COST, LUXURIES: LUXURIES, WORLD: WORLD,
    addItemType: addItemType, EXT: EXT,
    state: state, luxCopies: luxCopies, luxIn: luxIn, luxOut: luxOut, techsToOffer: techsToOffer, techValue: techValue,
    revealedGain: revealedGain, evaluate: evaluate, counter: counter, execute: execute, invalid: invalid, describe: describe,
    cancelBetween: cancelBetween, tick: tick, propose: propose, decide: decide, answer: answer, accept: accept, decline: decline,
    aiTurn: aiTurn, itemValue: itemValue, itemCost: itemCost, pactValue: pactValue, power: power
  };
})(typeof window !== "undefined" ? window : globalThis);
