/*
 * story.js — EVENTS, ANOMALIES, THE CHRONICLE, GOLDEN AND DARK AGES. No DOM.
 * Event texts live in storydata.js (PlanetStoryData.EVENTS); this file is the engine.
 *
 * game.story = {
 *   anomalies: [{ id, q, r, kind, done, by }]   seeded, about 1 per 300 land tiles
 *   flags: { cid: { name: turn } }               chain flags
 *   fired: { cid: { eventId: turn } }, last: { cid: turn }, count: { cid: n }
 *   queue: [{ cid, id, at, ctx }]                chained follow-ups
 *   pending: [{ uid, id, cid, ctx, turn }]       cards waiting for the player
 *   mods: [{ cid, k, v, until, label }]          temporary modifiers (k: food|prod|gold|sci per city, happy)
 *   ages: { cid: { kind, until, start, why } }, mood: { cid: [samples] }
 *   signals: [{ cid, kind, ctx }]                pushed by other modules (expedition, launch)
 *   chronicle: [{ turn, year, era, text }]       the player's history
 *   seen: { cities, met, wars, wonders, capital } (what the chronicle has already told)
 * }
 *
 * Triggers (event.trigger): "turn" (any quiet turn), "famine", "unrest", "contact",
 * "wonder_own", "wonder_rival", "war_start", "war_end", "capital_lost",
 * "river_city", "city_size", "anomaly:<kind>", "expedition", "launch",
 * "golden", "dark", "chain" (only through a queued follow-up).
 * Selection: per civ, at most one event a turn and a quiet gap of 7-11 turns
 * between "turn" events; signal events (anything but "turn") skip the gap.
 * Candidates are weighted and picked with a seeded hash, so a seed always
 * tells the same story for the same choices.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Diplo = root.PlanetDiplomacy, Tech = root.PlanetTech, Happy = root.PlanetHappiness;

  var ANOMALY_KINDS = {
    ruins:    { name: "Ancient ruins", turns: 2 },
    crater:   { name: "Meteor crater", turns: 1 },
    monolith: { name: "Monolith", turns: 3 },
    spring:   { name: "Strange spring", turns: 1 },
    wreck:    { name: "Stranded wreck", turns: 2 }
  };
  var AK = Object.keys(ANOMALY_KINDS);

  function hs(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rnd(game, tag) { return hs(game.seed + "|story|" + tag) / 4294967296; }
  function D() { return root.PlanetStoryData; }
  function E() { return root.PlanetEras; }

  function state(game) {
    var s = game.story || (game.story = {});
    ["flags", "fired", "last", "count", "ages", "mood", "seen"].forEach(function (k) { if (!s[k]) s[k] = {}; });
    ["queue", "pending", "mods", "signals", "chronicle"].forEach(function (k) { if (!s[k]) s[k] = []; });
    if (!s.anomalies) s.anomalies = makeAnomalies(game);
    if (!s.nextUid) s.nextUid = 1;
    return s;
  }

  // ------------------------------------------------------------ anomalies
  function makeAnomalies(game) {
    var land = game.tiles.filter(function (t) { return !Rules.isWater(t) && Rules.moveCost(t) !== Infinity; });
    var n = Math.max(3, Math.round(land.length / 300));
    var near = (game.units || []).map(function (u) { return [u.q, u.r]; }).concat((game.cities || []).map(function (c) { return [c.q, c.r]; }));
    var ranked = land.map(function (t) { return { t: t, h: hs(game.seed + "|anomaly|" + t.q + "," + t.r) }; }).sort(function (a, b) { return a.h - b.h; });
    var out = [];
    for (var i = 0; i < ranked.length && out.length < n; i++) {
      var t = ranked[i].t;
      if (near.some(function (p) { return Rules.hexDistance(p[0], p[1], t.q, t.r) < 5; })) continue;
      if (out.some(function (a) { return Rules.hexDistance(a.q, a.r, t.q, t.r) < 8; })) continue;
      var coast = Rules.neighbours(game, t).some(function (x) { return Rules.isWater(x); });
      // Kinds rotate from a seeded offset, so every map has a mix.
      var kind = AK[(out.length + hs(game.seed + "|akind") % AK.length) % AK.length];
      if (kind === "wreck" && !coast) kind = "crater";
      out.push({ id: out.length + 1, q: t.q, r: t.r, kind: kind, done: false, by: null });
    }
    return out;
  }
  function anomalyAt(game, q, r) {
    return state(game).anomalies.filter(function (a) { return a.q === q && a.r === r && !a.done; })[0] || null;
  }
  function canInvestigate(game, u) {
    if (!u || u.investigate) return null;
    var t = Rules.UNIT_TYPES[u.type];
    if (!t || t.naval || t.canFound || t.caravan) return null;
    return anomalyAt(game, u.q, u.r);
  }
  function investigate(game, unitId) {
    var u = Rules.unitById(game, unitId), a = canInvestigate(game, u);
    if (!a) return { ok: false, reason: "Nothing to investigate here" };
    var turns = ANOMALY_KINDS[a.kind].turns;
    u.investigate = { a: a.id, left: turns };
    u.moves = 0;
    return { ok: true, text: "Investigating the " + ANOMALY_KINDS[a.kind].name.toLowerCase() + " (" + turns + (turns === 1 ? " turn)" : " turns)") };
  }

  // AI explorers and idle units: walk to a nearby anomaly and investigate it.
  function aiAnomaly(game, u, stepToward) {
    if (u.investigate) return true;
    if (canInvestigate(game, u)) { investigate(game, u.id); return true; }
    var rev = game.civs[u.owner].revealed, best = null, bd = 7;
    state(game).anomalies.forEach(function (a) {
      if (a.done || !rev.has(Rules.key(a.q, a.r))) return;
      var d = Rules.hexDistance(u.q, u.r, a.q, a.r);
      if (d < bd && !game.units.some(function (o) { return o !== u && o.investigate && o.investigate.a === a.id; })) { bd = d; best = a; }
    });
    if (!best) return false;
    stepToward(game, u, best.q, best.r);
    if (canInvestigate(game, u)) investigate(game, u.id);
    return true;
  }

  // ----------------------------------------------------------------- text
  function nearestCity(game, cid, q, r) {
    return Rules.citiesOf(game, cid).slice().sort(function (a, b) { return Rules.hexDistance(q, r, a.q, a.r) - Rules.hexDistance(q, r, b.q, b.r) || a.id - b.id; })[0] || null;
  }
  function capitalOf(game, cid) { return Rules.citiesOf(game, cid).filter(function (c) { return c.capital; })[0] || Rules.citiesOf(game, cid)[0] || null; }
  function fill(game, cid, ctx, text) {
    var d = game.civs[cid].design || {}, city = ctx.city != null ? Rules.cityById(game, ctx.city) : null, cap = capitalOf(game, cid);
    var rv = ctx.rival != null ? game.civs[ctx.rival] : null, rd = rv ? rv.design || {} : {};
    var map = {
      civ: d.name || Rules.civName(game, cid), leader: d.leaderName || "the ruler", title: d.leaderTitle || "Ruler",
      people: d.people || "people", adj: d.adjective || d.name, city: city ? city.name : cap ? cap.name : "the capital",
      capital: cap ? cap.name : "the capital", rival: rv ? rd.name : "a distant people", rivalLeader: rv ? (rd.leaderTitle + " " + rd.leaderName) : "their ruler",
      rivalPeople: rv ? rd.people : "strangers", trait: ((d.traits || [])[0] || "proud"), year: Rules.yearLabel(game.turn),
      era: E() ? E().eraName(E().eraOf(game, cid)) : "Ancient", wonder: ctx.wonder ? (root.PlanetWonders.WONDERS[ctx.wonder] || {}).name : "the wonder"
    };
    return String(text).replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; });
  }

  // ------------------------------------------------------------- effects
  function addMod(game, cid, k, v, turns, label) {
    state(game).mods.push({ cid: cid, k: k, v: v, until: game.turn + turns, label: label });
  }
  function bestUnit(game, cid, kind) {
    var line = (E() && E().LINES[kind === "ship" ? 4 : kind === "ranged" ? 2 : 0]) || ["warrior"];
    var pick = line[0];
    line.forEach(function (u) { var b = Rules.BUILDS[u]; if (!b.tech || Tech.has(game, b.tech, cid)) pick = u; });
    return pick;
  }
  function describe(eff) {
    var out = [];
    if (eff.gold) out.push((eff.gold > 0 ? "+" : "\u2212") + Math.abs(eff.gold) + " gold");
    if (eff.food) out.push("+" + eff.food + " food in the city");
    if (eff.prod) out.push((eff.prod > 0 ? "+" : "\u2212") + Math.abs(eff.prod) + " production in the city");
    if (eff.science) out.push("+" + eff.science + " science");
    if (eff.boost) out.push("+" + Math.round(eff.boost * 100) + "% of the current research");
    if (eff.happy) out.push((eff.happy[0] > 0 ? "+" : "\u2212") + Math.abs(eff.happy[0]) + " happiness for " + eff.happy[1] + " turns");
    if (eff.mod) out.push((eff.mod[1] > 0 ? "+" : "\u2212") + Math.abs(eff.mod[1]) + " " + ({ food: "food", prod: "production", gold: "gold", sci: "science" })[eff.mod[0]] + " per city for " + eff.mod[2] + " turns");
    if (eff.att) out.push("attitude of {rival} " + (eff.att > 0 ? "+" : "\u2212") + Math.abs(eff.att));
    if (eff.unit) out.push("a veteran " + (eff.unit === "ship" ? "ship" : eff.unit === "ranged" ? "ranged unit" : "soldier"));
    if (eff.pop) out.push((eff.pop > 0 ? "+" : "\u2212") + Math.abs(eff.pop) + " pop in the city");
    if (eff.reveal) out.push("maps the land around");
    if (eff.faith) out.push((eff.faith > 0 ? "+" : "\u2212") + Math.abs(eff.faith) + " faith");
    if (eff.pressure) out.push("+" + eff.pressure + " religious pressure in the city");
    if (eff.age) out.push(eff.age === "golden" ? "begins a golden age" : "a dark age falls");
    return out.join(", ");
  }
  function apply(game, cid, ctx, eff, label) {
    var cv = game.civs[cid], city = ctx.city != null ? Rules.cityById(game, ctx.city) : null;
    if (!city || city.owner !== cid) city = capitalOf(game, cid);
    if (eff.gold) cv.gold = Math.max(0, cv.gold + eff.gold);
    if (eff.food && city) city.food = Math.max(0, city.food + eff.food);
    if (eff.prod && city) city.prod = Math.max(0, city.prod + eff.prod);
    if (eff.science && cv.tech) cv.tech.progress += eff.science;
    if (eff.boost && cv.tech) cv.tech.progress += Math.round((cv.tech.current ? Tech.TECHS[cv.tech.current].cost : 60) * eff.boost);
    if (eff.happy) addMod(game, cid, "happy", eff.happy[0], eff.happy[1], label);
    if (eff.mod) addMod(game, cid, eff.mod[0], eff.mod[1], eff.mod[2], label);
    if (eff.att && ctx.rival != null && Diplo.rel(game, cid, ctx.rival)) Diplo.remember(game, cid, ctx.rival, "story-" + label, eff.att, label);
    if (eff.attAll) Diplo.metCivs(game, cid).forEach(function (o) { Diplo.remember(game, cid, o, "story-" + label, eff.attAll, label); });
    if (eff.unit && city) { var u = Rules.addUnit(game, bestUnit(game, cid, eff.unit), city.q, city.r, cid); u.xp = 10; u.home = city.id; }
    if (eff.pop && city) city.pop = Math.max(1, city.pop + eff.pop);
    if (eff.reveal) {
      var at = ctx.q != null ? { q: ctx.q, r: ctx.r } : city;
      if (at) Rules.tilesInRadius(game, at.q, at.r, eff.reveal).forEach(function (t) { cv.revealed.add(Rules.key(t.q, t.r)); });
    }
    if (eff.faith && root.PlanetReligion) root.PlanetReligion.addFaith(game, cid, eff.faith);
    if (eff.pressure && city && root.PlanetReligion) root.PlanetReligion.pushPressure(game, city, cid, eff.pressure);
    if (eff.flag) (state(game).flags[cid] || (state(game).flags[cid] = {}))[eff.flag] = game.turn;
    if (eff.unflag && state(game).flags[cid]) delete state(game).flags[cid][eff.unflag];
    if (eff.chain) state(game).queue.push({ cid: cid, id: eff.chain[0], at: game.turn + eff.chain[1], ctx: ctx });
    if (eff.age) startAge(game, cid, eff.age, eff.ageTurns || 10, label);
    if (eff.mood) (state(game).mood[cid] || (state(game).mood[cid] = [])).push(eff.mood * 5);
  }

  // ------------------------------------------------------------- ages
  function inAge(game, cid) { var a = state(game).ages[cid]; return a && a.until > game.turn ? a : null; }
  function startAge(game, cid, kind, turns, why) {
    var st = state(game);
    st.ages[cid] = { kind: kind, start: game.turn, until: game.turn + turns, why: why || "" };
    st.mood[cid] = [];
    var name = Rules.civName(game, cid);
    if (cid === 0) chron(game, kind === "golden" ? pick(game, "golden", [
      "A golden age dawned over {civ}" + (why ? ", kindled by " + why : "") + ". Markets overflowed and the poets ran out of praise.",
      "These were the bright years: {civ} built, sang and traded as never before" + (why ? ", and many said it began with " + why : "") + ".",
      "Under {title} {leader} the realm entered an age of plenty; even the old complained only out of habit.",
      "Granaries full, roads safe, theatres crowded: the {adj} golden age had begun" + (why ? ", thanks, people said, to " + why : "") + ".",
      "It was a time when every town in {civ} seemed to be building something, and nobody could remember being afraid."
    ]) : pick(game, "dark", [
      "A dark age settled over {civ}" + (why ? " after " + why : "") + ". Fields went untended and the roads grew quiet.",
      "These were lean, bitter years for the {people}" + (why ? ", and they blamed " + why : "") + ".",
      "Hope thinned in {capital}; the chroniclers of the time wrote little, and none of it kind."
    ]));
    else if (Diplo.met(game, 0, cid)) Rules.logEvent(game, "info", name + (kind === "golden" ? " enters a golden age" : " falls into a dark age"), 0);
    signal(game, cid, kind, {});
  }
  // A sample per turn: happiness, wars and event mood; checked every 10 turns.
  function moodTick(game, cid) {
    var st = state(game), m = st.mood[cid] || (st.mood[cid] = []);
    var wars = Diplo.metCivs(game, cid).filter(function (o) { return Diplo.atWar(game, cid, o); }).length;
    m.push(Happy.total(game, cid) - 3 * wars);
    if (m.length > 20) m.splice(0, m.length - 20);
    if ((game.turn + cid) % 10 || m.length < 10 || inAge(game, cid)) return;
    // At most one age in 40 turns.
    var last = st.ages[cid];
    if (last && game.turn - last.until < 30) return;
    var avg = m.reduce(function (s, x) { return s + x; }, 0) / m.length;
    if (avg >= 8) startAge(game, cid, "golden", 10, "years of contentment");
    else if (avg <= -4) startAge(game, cid, "dark", 8, wars ? "long wars" : "discontent");
  }
  function ageBonus(game, cid) {
    var a = inAge(game, cid);
    if (!a) return null;
    var dbl = root.PlanetWonders && root.PlanetWonders.owned(game, cid, "sistine_chapel") ? 2 : 1;
    return a.kind === "golden" ? { prod: dbl, gold: dbl, happy: 0 } : { prod: -1, gold: 0, happy: -2 };
  }

  // ------------------------------------------------------------- chronicle
  // A seeded variant, never the same one twice in a row for a tag.
  function pick(game, tag, list) {
    var st = state(game), lp = st.seen.lastPick || (st.seen.lastPick = {});
    var i = hs(game.seed + "|" + tag + "|" + game.turn + "|" + st.chronicle.length) % list.length;
    if (list.length > 1 && lp[tag] === i) i = (i + 1) % list.length;
    lp[tag] = i;
    return list[i];
  }
  function chron(game, text, ctx) {
    var st = state(game);
    st.chronicle.push({ turn: game.turn, year: Rules.yearLabel(game.turn), era: E() ? E().eraOf(game, 0) : 0, text: fill(game, 0, ctx || {}, text) });
    if (st.chronicle.length > 600) st.chronicle.splice(0, st.chronicle.length - 600);
  }
  // Compare the world to what the chronicle has told and write the news.
  function chronicleTick(game) {
    var st = state(game), seen = st.seen;
    var mine = Rules.citiesOf(game, 0);
    if (!seen.cities) {
      seen.cities = mine.map(function (c) { return c.id; });
      if (mine.length) chron(game, pick(game, "found", [
        "The {people} raised their first hearth at {capital}, and called the land around it their own.",
        "Here the story of {civ} begins: a handful of families, a river's bend, and the town of {capital}.",
        "{title} {leader} drove a stake into the earth at {capital}. Everything that followed grew from that spot."
      ]));
      seen.met = Diplo.metCivs(game, 0); seen.wars = []; seen.wonders = Object.keys(game.wonders || {}); seen.capital = (capitalOf(game, 0) || {}).id; seen.era = E() ? E().eraOf(game, 0) : 0;
      return;
    }
    mine.forEach(function (c) {
      if (seen.cities.indexOf(c.id) !== -1) return;
      seen.cities.push(c.id);
      var n = seen.cities.length;
      chron(game, c.founder === 0 || c.founder == null ? pick(game, "city", [
        "Settlers founded " + c.name + ", the " + ordinal(n) + " city of the realm.",
        c.name + " was founded, and the map makers of {capital} drew a new dot with some pride.",
        "Pioneers crossed the hills and built " + c.name + "."
      ]) : "The {people} took " + c.name + " by force of arms.");
    });
    seen.cities = seen.cities.filter(function (id) {
      var c = Rules.cityById(game, id);
      if (c && c.owner === 0) return true;
      if (c) chron(game, pick(game, "lost", ["{civ} lost " + c.name + " to " + Rules.civName(game, c.owner) + ". The refugees never stopped talking about home.",
        "The fall of " + c.name + " to " + Rules.civName(game, c.owner) + " was mourned for a generation."]));
      return false;
    });
    Diplo.metCivs(game, 0).forEach(function (o) {
      if (seen.met.indexOf(o) !== -1) return;
      seen.met.push(o);
      chron(game, pick(game, "met", ["Our scouts met the {rivalPeople} of {rival}, led by {rivalLeader}.",
        "Strangers came out of the wilds: {rival}. Nobody yet knew whether to fear them.",
        "The first envoy of {rival} arrived at {capital}, dusty and suspicious."]), { rival: o });
    });
    var wars = Diplo.metCivs(game, 0).filter(function (o) { return Diplo.atWar(game, 0, o); });
    wars.forEach(function (o) {
      if (seen.wars.indexOf(o) !== -1) return;
      chron(game, pick(game, "war", ["War broke out between {civ} and {rival}.", "The war drums sounded: {civ} and {rival} took up arms against each other.",
        "Envoys were recalled and the border forts lit their beacons. {rival} and {civ} were at war."]), { rival: o });
    });
    seen.wars.forEach(function (o) {
      if (wars.indexOf(o) !== -1 || game.civs[o].eliminated) return;
      chron(game, pick(game, "peace", ["Peace was made with {rival}; both sides claimed they had won.", "The war with {rival} ended, and the veterans came home to fields gone to seed."]), { rival: o });
    });
    seen.wars = wars;
    Object.keys(game.wonders || {}).forEach(function (w) {
      if (seen.wonders.indexOf(w) !== -1) return;
      seen.wonders.push(w);
      var rec = game.wonders[w], W = root.PlanetWonders.WONDERS[w], c = Rules.cityById(game, rec.city);
      if (rec.civ === 0) chron(game, pick(game, "wonder", ["The " + W.name + " was completed in " + (c ? c.name : "{capital}") + ". " + W.flavor,
        "After years of labour, " + (c ? c.name : "{capital}") + " unveiled the " + W.name + ". " + W.flavor]));
      else if (Diplo.met(game, 0, rec.civ)) chron(game, "News came that " + Rules.civName(game, rec.civ) + " had finished the " + W.name + ".");
    });
    var cap = capitalOf(game, 0);
    if (cap && seen.capital != null && cap.id !== seen.capital) chron(game, "The court moved to " + cap.name + ", which became the new capital of {civ}.");
    seen.capital = cap ? cap.id : null;
    var era = E() ? E().eraOf(game, 0) : 0;
    if (era > (seen.era || 0)) {
      var tch = (Tech.techOf(game, 0).done.slice(-1)[0]);
      chron(game, pick(game, "era", ["With " + (tch ? Tech.TECHS[tch].name : "new learning") + ", {civ} entered the {era} Era. " + (Tech.ERAS[era].line || ""),
        "The {era} Era began for the {people} in {year}. " + (Tech.ERAS[era].line || "")]));
      seen.era = era;
    }
  }
  function ordinal(n) { return ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n - 1] || n + "th"; }

  // ---------------------------------------------------------- the engine
  function signal(game, cid, kind, ctx) { state(game).signals.push({ cid: cid, kind: kind, ctx: ctx || {} }); }

  // Current triggers for a civ: [{ kind, ctx }], "turn" last.
  function triggers(game, cid) {
    var st = state(game), out = [], cs = Rules.citiesOf(game, cid);
    cs.forEach(function (c) {
      var y = Rules.cityYield(game, c);
      if (y.surplus < 0) out.push({ kind: "famine", ctx: { city: c.id } });
      if (c.unrest) out.push({ kind: "unrest", ctx: { city: c.id } });
      var t = game.index.get(Rules.key(c.q, c.r));
      if (c.pop >= 8 && t.river >= 10) out.push({ kind: "river_city", ctx: { city: c.id } });
      if (c.pop >= 12) out.push({ kind: "city_size", ctx: { city: c.id } });
    });
    Diplo.metCivs(game, cid).forEach(function (o) {
      var r = Diplo.rel(game, cid, o);
      if (r.metTurn >= game.turn - 1) out.push({ kind: "contact", ctx: { rival: o } });
    });
    Object.keys(game.wonders || {}).forEach(function (w) {
      var rec = game.wonders[w];
      if (rec.turn < game.turn - 1) return;
      if (rec.civ === cid) out.push({ kind: "wonder_own", ctx: { wonder: w, city: rec.city } });
      else if (Diplo.met(game, cid, rec.civ)) out.push({ kind: "wonder_rival", ctx: { wonder: w, rival: rec.civ } });
    });
    var key = "w" + cid, prev = st.seen[key] || [];
    var wars = Diplo.metCivs(game, cid).filter(function (o) { return Diplo.atWar(game, cid, o); });
    wars.forEach(function (o) { if (prev.indexOf(o) === -1) out.push({ kind: "war_start", ctx: { rival: o } }); });
    prev.forEach(function (o) { if (wars.indexOf(o) === -1 && !game.civs[o].eliminated) out.push({ kind: "war_end", ctx: { rival: o } }); });
    st.seen[key] = wars;
    var capKey = "cap" + cid, cap = capitalOf(game, cid);
    if (st.seen[capKey] != null && cap && st.seen[capKey] !== cap.id) {
      var old = Rules.cityById(game, st.seen[capKey]);
      if (old && old.owner !== cid) out.push({ kind: "capital_lost", ctx: { city: cap.id, rival: old.owner } });
    }
    st.seen[capKey] = cap ? cap.id : null;
    var met = Diplo.metCivs(game, cid).filter(function (o) { return !game.civs[o].eliminated; });
    var any = cs.length ? cs[hs(game.seed + "|c|" + game.turn + "|" + cid) % cs.length] : null;
    out.push({ kind: "turn", ctx: { city: any ? any.id : null, rival: met.length ? met[hs(game.seed + "|r|" + game.turn + "|" + cid) % met.length] : null } });
    return out;
  }

  function flagged(game, cid, f) { var fl = state(game).flags[cid]; return !!(fl && fl[f] != null); }
  function eligible(game, cid, ev, ctx) {
    var st = state(game), era = E() ? E().eraOf(game, cid) : 0, cv = game.civs[cid];
    if (ev.era && (era < ev.era[0] || era > ev.era[1])) return false;
    if (ev.turns && (game.turn < ev.turns[0] || game.turn > ev.turns[1])) return false;
    var last = (st.fired[cid] || {})[ev.id];
    if (last != null && (ev.cooldown == null || game.turn - last < ev.cooldown)) return false;
    if (ev.needs && !flagged(game, cid, ev.needs)) return false;
    if (ev.not && flagged(game, cid, ev.not)) return false;
    if (ev.rival && ctx.rival == null) return false;
    if (ev.trait && ((cv.design && cv.design.traits) || []).indexOf(ev.trait) === -1) return false;
    if (ev.cond && !ev.cond(game, cid, ctx)) return false;
    return true;
  }

  function fire(game, cid, ev, ctx) {
    var st = state(game);
    (st.fired[cid] || (st.fired[cid] = {}))[ev.id] = game.turn;
    st.last[cid] = game.turn;
    st.count[cid] = (st.count[cid] || 0) + 1;
    if (cid === 0 && !game._autoPlayer) {
      var p = { uid: st.nextUid++, id: ev.id, cid: 0, ctx: ctx, turn: game.turn };
      st.pending.push(p);
      return p;
    }
    var idx = aiChoice(game, cid, ev);
    resolve(game, cid, ev, ctx, idx);
    return null;
  }

  // AI picks: trait choices first (if allowed), then a seeded weighted pick.
  function aiChoice(game, cid, ev) {
    var traits = (game.civs[cid].design && game.civs[cid].design.traits) || [], best = 0, bs = -1;
    ev.choices.forEach(function (c, i) {
      if (c.trait && traits.indexOf(c.trait) === -1) return;
      var e = c.effects || {};
      var s = 1 + (c.trait ? 3 : 0) + (e.gold > 0 ? e.gold / 60 : e.gold < 0 && game.civs[cid].gold < -e.gold * 2 ? -3 : 0) + (e.chain ? 0.6 : 0) + rnd(game, ev.id + cid + i + game.turn) * 1.5;
      if (s > bs) { bs = s; best = i; }
    });
    return best;
  }
  function choicesFor(game, cid, ev) {
    var traits = (game.civs[cid].design && game.civs[cid].design.traits) || [];
    return ev.choices.map(function (c, i) { return { i: i, c: c, ok: !c.trait || traits.indexOf(c.trait) !== -1 }; });
  }

  function resolve(game, cid, ev, ctx, idx) {
    var ch = ev.choices[idx] || ev.choices[0];
    apply(game, cid, ctx, ch.effects || {}, ev.title);
    var title = fill(game, cid, ctx, ev.title);
    // Chronicle: the title, the words of the choice, and what came of it.
    if (cid === 0) chron(game, fill(game, 0, ctx, ev.chronicle || (title + " \u2014 \u201c" + ch.label + "\u201d " + (ch.result || ""))).trim(), ctx);
    else if (ev.notable && Diplo.met(game, 0, cid)) Rules.logEvent(game, "info", Rules.civName(game, cid) + ": " + title, 0);
    return { title: title, result: fill(game, cid, ctx, ch.result || ""), effects: fill(game, cid, ctx, describe(ch.effects || {})) };
  }

  // The player answers a pending card.
  function choose(game, uid, idx) {
    var st = state(game), p = st.pending.filter(function (x) { return x.uid === uid; })[0];
    if (!p) return { ok: false };
    var ev = byId(p.id), traits = (game.civs[0].design && game.civs[0].design.traits) || [];
    if (ev.choices[idx] && ev.choices[idx].trait && traits.indexOf(ev.choices[idx].trait) === -1) return { ok: false, reason: "Needs the " + ev.choices[idx].trait + " trait" };
    st.pending = st.pending.filter(function (x) { return x !== p; });
    var r = resolve(game, 0, ev, p.ctx, idx);
    r.ok = true;
    return r;
  }
  function byId(id) { return D().EVENTS.filter(function (e) { return e.id === id; })[0]; }

  function weightOf(game, cid, ev) {
    var w = ev.weight || 10;
    var traits = (game.civs[cid].design && game.civs[cid].design.traits) || [];
    if (ev.likes && ev.likes.some(function (t) { return traits.indexOf(t) !== -1; })) w *= 2;
    return w;
  }

  function runEvents(game, cid) {
    var st = state(game);
    if (cid === 0 && st.pending.length) return;   // one card at a time
    // Follow-ups first.
    for (var i = 0; i < st.queue.length; i++) {
      var q = st.queue[i];
      if (q.cid !== cid || q.at > game.turn) continue;
      st.queue.splice(i, 1);
      var ev = byId(q.id);
      if (ev && (!ev.needs || flagged(game, cid, ev.needs))) { fire(game, cid, ev, q.ctx || {}); return; }
      i--;
    }
    // Explicit signals (an anomaly solved, a launch, an expedition) wait their
    // turn and are never lost; the first one with an eligible event fires.
    while (true) {
      var si = -1;
      for (var k = 0; k < st.signals.length; k++) if (st.signals[k].cid === cid) { si = k; break; }
      if (si < 0) break;
      var sg = st.signals.splice(si, 1)[0];
      var sc = D().EVENTS.filter(function (ev) { return ev.trigger === sg.kind && eligible(game, cid, ev, sg.ctx); });
      if (!sc.length) continue;
      var tw = sc.reduce(function (s, e) { return s + weightOf(game, cid, e); }, 0), rr = rnd(game, "sig|" + cid + "|" + game.turn) * tw;
      for (var m = 0; m < sc.length; m++) { rr -= weightOf(game, cid, sc[m]); if (rr <= 0 || m === sc.length - 1) { fire(game, cid, sc[m], sg.ctx); return; } }
    }
    var trig = triggers(game, cid);
    var gap = 7 + hs(game.seed + "|gap|" + cid + "|" + (st.count[cid] || 0)) % 5;
    var quiet = st.last[cid] == null ? game.turn >= 8 + hs(game.seed + "|first|" + cid) % 10 : game.turn - st.last[cid] >= gap;
    var cands = [];
    trig.forEach(function (t) {
      if (t.kind === "turn" && !quiet) return;
      if (t.kind !== "turn" && st.last[cid] === game.turn) return;
      D().EVENTS.forEach(function (ev) {
        if ((ev.trigger || "turn") !== t.kind) return;
        if (!eligible(game, cid, ev, t.ctx)) return;
        cands.push({ ev: ev, ctx: t.ctx, w: weightOf(game, cid, ev) * (t.kind === "turn" ? 1 : 4) });
      });
    });
    // Signal events (anything but "turn") don't wait for the gap but are rarer
    // per kind: famine and unrest at most every 15 turns.
    if (!cands.length) return;
    var tot = cands.reduce(function (s, c) { return s + c.w; }, 0);
    var roll = rnd(game, "pick|" + cid + "|" + game.turn) * tot;
    for (var j = 0; j < cands.length; j++) { roll -= cands[j].w; if (roll <= 0) { fire(game, cid, cands[j].ev, cands[j].ctx); return; } }
  }

  function makeModifiers(game, cid) {
    function modsOf(k) {
      var s = 0;
      state(game).mods.forEach(function (m) { if (m.cid === cid && m.k === k && m.until > game.turn) s += m.v; });
      return s;
    }
    return {
      cityYield: function (c, y) {
        y.food += modsOf("food"); y.prod += modsOf("prod"); y.gold += modsOf("gold");
        var a = ageBonus(game, cid);
        if (a) { y.prod += a.prod; y.gold += a.gold; }
        return y;
      },
      cityScience: function () { return modsOf("sci"); },
      onMove: function (g, u) {
        if (u.investigate) {
          var a = state(g).anomalies.filter(function (x) { return x.id === u.investigate.a; })[0];
          if (!a || a.q !== u.q || a.r !== u.r) u.investigate = null;
        }
      },
      onEndTurn: function (g, events, sci, c) {
        var st = state(g);
        g.units.forEach(function (u) {
          if (u.owner !== c || !u.investigate) return;
          var a = st.anomalies.filter(function (x) { return x.id === u.investigate.a; })[0];
          if (!a || a.done || a.q !== u.q || a.r !== u.r) { u.investigate = null; return; }
          if (--u.investigate.left > 0) { u.moves = 0; return; }
          u.investigate = null; a.done = true; a.by = c;
          var city = nearestCity(g, c, a.q, a.r);
          signal(g, c, "anomaly:" + a.kind, { q: a.q, r: a.r, anomaly: a.id, city: city ? city.id : null });
          if (c === 0) events.push({ kind: "info", text: "Investigation of the " + ANOMALY_KINDS[a.kind].name.toLowerCase() + " complete", cid: 0 });
        });
        st.mods = st.mods.filter(function (m) { return m.until > g.turn; });
        moodTick(g, c);
        runEvents(g, c);
        if (c === 0) chronicleTick(g);
      }
    };
  }

  Happy.addSource(function (game, cid) {
    var out = [], s = 0;
    state(game).mods.forEach(function (m) { if (m.cid === cid && m.k === "happy" && m.until > game.turn) s += m.v; });
    if (s) out.push({ key: "events", name: "Events (temporary)", n: 1, v: s });
    var a = ageBonus(game, cid);
    if (a && a.happy) out.push({ key: "age", name: "Dark age", n: 1, v: a.happy });
    return out;
  });

  function exportText(game) {
    var st = state(game), d = game.civs[0].design || {}, lines = ["# The Chronicle of " + (d.name || "Asteria"), "", "*As kept by the scribes of " + ((capitalOf(game, 0) || {}).name || "the capital") + ", " + Rules.yearLabel(game.turn) + "*", ""];
    var era = -1;
    st.chronicle.forEach(function (e) {
      if (e.era !== era) { era = e.era; lines.push("", "## The " + (Tech.ERAS[era] || Tech.ERAS[0]).name + " Era", ""); }
      lines.push("- **" + e.year + "** (turn " + e.turn + "). " + e.text);
    });
    return lines.join("\n") + "\n";
  }

  // World hook: anomalies are placed once the start units exist.
  var WORLD = { init: function (game) { state(game); } };

  root.PlanetStory = {
    WORLD: WORLD,
    ANOMALY_KINDS: ANOMALY_KINDS, state: state, anomalyAt: anomalyAt, canInvestigate: canInvestigate, investigate: investigate, aiAnomaly: aiAnomaly,
    signal: signal, triggers: triggers, eligible: eligible, fire: fire, choose: choose, resolve: resolve, choicesFor: choicesFor, byId: byId,
    describe: describe, fill: fill, startAge: startAge, inAge: inAge, ageBonus: ageBonus, chron: chron, pick: pick, exportText: exportText,
    aiChoice: aiChoice, runEvents: runEvents, makeModifiers: makeModifiers, makeAnomalies: makeAnomalies, flagged: flagged
  };
})(typeof window !== "undefined" ? window : globalThis);
