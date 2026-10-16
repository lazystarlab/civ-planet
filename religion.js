/*
 * religion.js — FAITH, RELIGIONS AND IDEOLOGIES (slice 15). No DOM.
 * Faith (per civ, per turn): Shrine +1, Temple +1, faith wonders, holy sites
 * (a city next to a mountain or within 2 tiles of an anomaly +1), government
 * and policies (gov.js), beliefs. The first civs whose faith reaches FOUND_AT
 * found a religion (cap: floor(civs/2) + 1). The founder names it (generated
 * name, editable) and picks 1 founder + 1 follower belief from BELIEFS.
 * A human player gets a pending founding card (pendingFound); AIs and the
 * autoplayed player choose at once.
 * Spread: each city holds pressure per religion (city.relp = { id: n });
 * every turn each city with a majority religion pushes pressure into cities
 * within SPREAD_RANGE (holy cities push twice as hard), trade routes carry
 * extra, Missionaries (built with faith) add a burst. A city's majority
 * (city.rel) is the religion with the most pressure above MIN_MAJORITY.
 * Effects: beliefs; your empire's majority religion gives +1 happiness per 3
 * following cities; same majority religion +1 attitude (+2 if either civ is
 * zealous: theocracy or the nomadic trait), different -1 for zealous civs.
 * Ideology: on reaching the Industrial era a civ picks Freedom, Order or
 * Autonomy (pendingIdeology for a human) and gains one tenet per later era
 * (max 4); same ideology +2 attitude, different -2.
 * game.religion = { list: [...], civ: [{ faith, perTurn, founded, ideology, tenets, pendingIdeology }], pendingFound, stats, ver }
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Happy = root.PlanetHappiness, Diplo = root.PlanetDiplomacy, Combat = root.PlanetCombat;

  var FOUND_AT = 70, SPREAD_RANGE = 14, MIN_MAJORITY = 30, MISSIONARY_FAITH = 60, MISSIONARY_PUSH = 160, PRESSURE_CAP = 600;
  var COLORS = ["#e8c45a", "#9a6ad0", "#4ab0a0", "#d0603a", "#5a8ad0", "#c8d0d8", "#d05a9a", "#7ab04a"];
  var SYMBOLS = ["sun", "moon", "eye", "tree", "flame", "wave", "star", "hand"];

  var BELIEFS = {
    // founder
    tithes:          { kind: "founder", name: "Tithes", text: "+1 gold per city following the religion (anywhere)" },
    pilgrimage:      { kind: "founder", name: "Pilgrimage", text: "+2 faith per foreign city following the religion" },
    holy_warriors:   { kind: "founder", name: "Holy Warriors", text: "+10% combat strength near following cities" },
    papal_primacy:   { kind: "founder", name: "Papal Primacy", text: "+2 attitude with civs whose cities follow it" },
    world_church:    { kind: "founder", name: "World Church", text: "+1 science per 3 following cities" },
    sacred_charter:  { kind: "founder", name: "Sacred Charter", text: "Holy city +3 production, +3 faith" },
    // follower
    monastic_science:{ kind: "follower", name: "Monastic Science", text: "+1 science in following cities with a Temple" },
    river_goddess:   { kind: "follower", name: "River Goddess", text: "+1 food in following river cities" },
    sacred_groves:   { kind: "follower", name: "Sacred Groves", text: "+1 production in following cities near forest" },
    feed_the_world:  { kind: "follower", name: "Feed the World", text: "+1 food in following cities with a Shrine" },
    religious_art:   { kind: "follower", name: "Religious Art", text: "+1 happiness per following city with a Temple (max 4)" },
    choral_music:    { kind: "follower", name: "Choral Music", text: "+1 gold in following cities with a Temple" }
  };
  var BELIEF_ORDER = Object.keys(BELIEFS);

  var IDEOLOGIES = {
    freedom:  { name: "Freedom", color: "#5a9ad0", tenets: [
      ["Free Press", "+10% science"], ["Civil Liberties", "+1 happiness per 3 cities"], ["Venture Capital", "+15% gold"], ["Universal Suffrage", "-50% war weariness"]] },
    order:    { name: "Order", color: "#d05a4a", tenets: [
      ["Heavy Industry", "+10% production"], ["Iron Curtain", "+10% defense"], ["Five-Year Mandate", "+1 production per city"], ["Party Discipline", "+1 happiness per 3 cities"]] },
    autonomy: { name: "Autonomy", color: "#5ab07a", tenets: [
      ["Mutual Aid", "+1 food per city"], ["Commune Faith", "+2 faith per city"], ["Militia", "+15% defense"], ["Free Assembly", "+1 happiness per 3 cities"]] }
  };
  var IDEO_ORDER = Object.keys(IDEOLOGIES);

  // Shrine: a new cheap faith building.
  Rules.BUILDS.shrine = { name: "Shrine", cost: 25, building: "shrine", minPop: 1, popCost: 0, tech: "ceremonial_burial", note: "+1 faith" };
  Rules.UNIT_TYPES.missionary = { name: "Missionary", moves: 3, canFound: false, strength: 0, missionary: true };
  Rules.BUILDS.missionary = { name: "Missionary", cost: 45, unit: "missionary", minPop: 2, popCost: 0, tech: "theology", note: "spreads your religion (2 charges) · also costs " + MISSIONARY_FAITH + " faith" };
  var WONDER_FAITH = { stonehenge: 2, oracle: 1, temple_of_artemis: 2, notre_dame: 3, sistine_chapel: 2 };

  var NAME_A = ["The Way of", "Children of", "The Order of", "Keepers of", "The Church of", "Followers of", "The Path of", "The Covenant of", "The Light of", "Seekers of"];
  var NAME_B = ["the Burning Star", "the Deep River", "the First Ones", "the Silent Mountain", "the Open Hand", "Seven Lamps", "the Turning Wheel", "the Green Flame", "the Long Night", "the Twin Moons", "the Sleeping God", "the Morning Bell"];

  function hs(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function state(game) {
    var s = game.religion || (game.religion = {});
    if (!s.list) s.list = [];
    if (!s.civ) s.civ = [];
    while (s.civ.length < game.civs.length) s.civ.push({ faith: 0, perTurn: 0, founded: null, ideology: null, tenets: 0, pendingIdeology: false });
    if (!s.pendingFound) s.pendingFound = [];
    if (!s.stats) s.stats = { missionaries: 0, conversions: 0 };
    if (!s.ver) s.ver = 1;
    return s;
  }
  function byId(game, id) { return state(game).list.filter(function (r) { return r.id === id; })[0] || null; }
  function founded(game, cid) { var c = state(game).civ[cid]; return c && c.founded != null ? byId(game, c.founded) : null; }
  function cap(game) { return Math.floor(game.civs.length / 2) + 1; }
  function slotsLeft(game) { return cap(game) - state(game).list.length - state(game).pendingFound.length; }
  function suggestName(game, cid, salt) {
    var h = hs(game.seed + "|relname|" + cid + "|" + (salt || 0));
    var taken = state(game).list.map(function (r) { return r.name; });
    for (var i = 0; i < 20; i++) {
      var n = NAME_A[(h + i * 7) % NAME_A.length] + " " + NAME_B[((h >>> 8) + i * 5) % NAME_B.length];
      if (taken.indexOf(n) === -1) return n;
    }
    return "Faith of " + Rules.civName(game, cid);
  }
  function addFaith(game, cid, n) { var c = state(game).civ[cid]; if (c) c.faith = Math.max(0, c.faith + n); }

  function hasB(c, b) { return (c.buildings || []).indexOf(b) !== -1; }
  function holySite(game, c) {
    var t = game.index.get(Rules.key(c.q, c.r));
    var mountain = Rules.neighbours(game, t).some(function (n) { return n.biome === "mountain"; });
    var S = root.PlanetStory, an = S && S.state(game).anomalies || [];
    var nearAnomaly = an.some(function (a) { return Rules.hexDistance(a.q, a.r, c.q, c.r) <= 2; });
    return mountain || nearAnomaly;
  }
  function followers(game, relId) { return game.cities.filter(function (c) { return c.rel === relId; }); }
  function beliefOf(game, relId, b) { var r = byId(game, relId); return !!(r && (r.founderBelief === b || r.followerBelief === b)); }

  function cityFaith(game, c) {
    var f = 0;
    if (hasB(c, "shrine")) f += 1;
    if (hasB(c, "temple")) f += 1;
    (c.buildings || []).forEach(function (b) { if (b.indexOf("w_") === 0 && WONDER_FAITH[b.slice(2)]) f += WONDER_FAITH[b.slice(2)]; });
    if (holySite(game, c)) f += 1;
    var G = root.PlanetGov;
    if (G) f += G.faithBonus(game, c.owner);
    var r = founded(game, c.owner);
    if (r && r.founderBelief === "sacred_charter" && r.holyCity === c.id) f += 3;
    var st = state(game).civ[c.owner];
    if (st && st.ideology === "autonomy" && st.tenets >= 2) f += 2;
    return f;
  }
  function faithRate(game, cid) {
    var f = 0;
    Rules.citiesOf(game, cid).forEach(function (c) { f += cityFaith(game, c); });
    var r = founded(game, cid);
    if (r && r.founderBelief === "pilgrimage") f += 2 * followers(game, r.id).filter(function (c) { return c.owner !== cid; }).length;
    return f;
  }

  // ---- founding
  function found(game, cid, opts) {
    var st = state(game);
    opts = opts || {};
    if (founded(game, cid)) return { ok: false, reason: "Already founded" };
    var pend = st.pendingFound.indexOf(cid);
    if (pend === -1 && slotsLeft(game) <= 0) return { ok: false, reason: "No religions left to found" };
    var fb = opts.founder, wb = opts.follower;
    if (!BELIEFS[fb] || BELIEFS[fb].kind !== "founder" || taken(game, fb)) return { ok: false, reason: "Pick a founder belief" };
    if (!BELIEFS[wb] || BELIEFS[wb].kind !== "follower" || taken(game, wb)) return { ok: false, reason: "Pick a follower belief" };
    var holy = Rules.citiesOf(game, cid).filter(function (c) { return c.capital; })[0] || Rules.citiesOf(game, cid)[0];
    if (!holy) return { ok: false, reason: "No city" };
    var id = "r" + (st.list.length + 1);
    var name = String(opts.name || suggestName(game, cid)).trim().slice(0, 40) || suggestName(game, cid);
    var rel = { id: id, name: name, founder: cid, holyCity: holy.id, turn: game.turn, color: COLORS[(opts.color != null ? opts.color : st.list.length) % COLORS.length],
      symbol: SYMBOLS[(opts.symbol != null ? opts.symbol : hs(game.seed + id) % SYMBOLS.length) % SYMBOLS.length], founderBelief: fb, followerBelief: wb };
    st.list.push(rel);
    if (pend !== -1) st.pendingFound.splice(pend, 1);
    st.civ[cid].founded = id;
    st.civ[cid].faith = 0;
    holy.relp = holy.relp || {}; holy.relp[id] = 150; holy.rel = id;
    bumpVer(game);
    var known = cid === 0 || (Diplo && Diplo.met(game, 0, cid));
    Rules.logEvent(game, "religion", (known ? Rules.civName(game, cid) : "A distant people") + " founded " + name + " in " + (known ? holy.name : "a far city"), known ? 0 : null);
    var S = root.PlanetStory;
    if (S) {
      if (cid === 0 && S.chron) S.chron(game, S.pick(game, "religion", [
        "In {year} the faithful of {capital} named their creed: " + name + ". Its first sermon spoke of " + BELIEFS[fb].name.toLowerCase() + ".",
        "A prophet walked into {capital} in {year} with nothing but a story. By spring the story had a name, " + name + ", and a temple.",
        "The {people} gave their faith a name in {year}: " + name + ". The holy city of {capital} would never again be only a city."
      ]));
      if (S.signal) S.signal(game, cid, "religion_founded", { city: holy.id });
    }
    return { ok: true, religion: rel, text: name + " is founded in " + holy.name };
  }
  function taken(game, b) { return state(game).list.some(function (r) { return r.founderBelief === b || r.followerBelief === b; }); }
  function freeBeliefs(game, kind) { return BELIEF_ORDER.filter(function (b) { return BELIEFS[b].kind === kind && !taken(game, b); }); }
  var TRAIT_BELIEF = { mercantile: { tithes: 3, choral_music: 3 }, scholarly: { world_church: 3, monastic_science: 3 }, militaristic: { holy_warriors: 3 },
    agrarian: { river_goddess: 3, feed_the_world: 2 }, industrious: { sacred_charter: 3, sacred_groves: 3 }, nomadic: { pilgrimage: 3, religious_art: 2 },
    seafaring: { pilgrimage: 2, papal_primacy: 2 }, expansionist: { papal_primacy: 3, feed_the_world: 2 } };
  function aiBeliefs(game, cid) {
    var tr = (game.civs[cid].design && game.civs[cid].design.traits) || [];
    var score = function (b) { var s = 1; tr.forEach(function (t) { s += ((TRAIT_BELIEF[t] || {})[b] || 0); }); return s + (hs(game.seed + b + cid) % 100) / 200; };
    var pickBest = function (kind) { return freeBeliefs(game, kind).sort(function (a, b) { return score(b) - score(a); })[0]; };
    return { founder: pickBest("founder"), follower: pickBest("follower") };
  }

  // ---- spread
  function pushPressure(game, city, cid, n) {
    var r = founded(game, cid) || (city.rel ? byId(game, city.rel) : null);
    if (!r) return;
    city.relp = city.relp || {};
    city.relp[r.id] = Math.min(PRESSURE_CAP, (city.relp[r.id] || 0) + n);
    settle(game, city);
  }
  function settle(game, c) {
    var p = c.relp || {}, best = null, bv = MIN_MAJORITY;
    Object.keys(p).sort().forEach(function (id) { if (p[id] > bv) { bv = p[id]; best = id; } });
    if (best !== (c.rel || null)) {
      if (best && c.rel) state(game).stats.conversions++;
      c.rel = best;
      bumpVer(game);
    }
  }
  function spread(game) {
    var src = game.cities.filter(function (c) { return c.rel; });
    var add = new Map();
    function give(c, id, n) { var m = add.get(c) || {}; m[id] = (m[id] || 0) + n; add.set(c, m); }
    src.forEach(function (s) {
      var r = byId(game, s.rel);
      if (!r) return;
      var push = (r.holyCity === s.id ? 14 : 7) * (1 + Math.min(1, s.pop / 10));
      // A city keeps some of its own faith; the holy city holds firm.
      give(s, s.rel, r.holyCity === s.id ? 40 : 3);
      game.cities.forEach(function (t) {
        if (t === s) return;
        var d = Rules.hexDistance(s.q, s.r, t.q, t.r);
        if (d > SPREAD_RANGE) return;
        give(t, s.rel, push * (1 - d / (SPREAD_RANGE + 1)));
      });
    });
    var TR = root.PlanetTrade;
    if (TR && TR.routes) TR.routes(game).forEach(function (rt) {
      var a = Rules.cityById(game, rt.from), b = Rules.cityById(game, rt.to);
      if (!a || !b) return;
      if (a.rel) give(b, a.rel, 9);
      if (b.rel) give(a, b.rel, 9);
    });
    // Pilgrims and merchants: every met civ at peace leaks a little of its
    // majority faith into your cities (more with open borders).
    var Dp = root.PlanetDiplomacy;
    if (Dp) game.civs.forEach(function (ca, a) {
      if (ca.eliminated) return;
      var mj = majority(game, a);
      if (!mj) return;
      game.civs.forEach(function (cb, b) {
        if (a === b || cb.eliminated || !Dp.met(game, a, b) || Combat.atWar(game, a, b)) return;
        var rl = Dp.rel(game, a, b), n = 1.5 + (rl && rl.open ? 1 : 0);
        Rules.citiesOf(game, b).forEach(function (c) { give(c, mj.id, n); });
      });
    });
    game.cities.forEach(function (c) { if (!add.has(c) && c.relp && Object.keys(c.relp).length) add.set(c, {}); });
    add.forEach(function (m, c) {
      c.relp = c.relp || {};
      // Pressure decays 4% a turn, so the stronger neighbour wins over time
      // instead of every faith sitting at the cap.
      Object.keys(c.relp).forEach(function (id) { c.relp[id] = c.relp[id] * 0.96; });
      Object.keys(m).forEach(function (id) { c.relp[id] = Math.min(PRESSURE_CAP, (c.relp[id] || 0) + m[id]); });
      Object.keys(c.relp).forEach(function (id) { if (!m[id]) c.relp[id] = Math.max(0, c.relp[id] - 1); });
      Object.keys(c.relp).forEach(function (id) { c.relp[id] = Math.round(c.relp[id] * 10) / 10; });
      settle(game, c);
    });
  }
  // Faith purchase: a Missionary in a city following your religion.
  var BUY_FAITH = 120;
  function buyMissionary(game, cityId) {
    var c = Rules.cityById(game, cityId);
    if (!c) return { ok: false, reason: "No city" };
    var cid = c.owner, st = state(game).civ[cid], r = founded(game, cid);
    if (!r) return { ok: false, reason: "Found a religion first" };
    if (c.rel !== r.id) return { ok: false, reason: "The city must follow " + r.name };
    if (st.faith < BUY_FAITH) return { ok: false, reason: "Needs " + BUY_FAITH + " faith" };
    st.faith -= BUY_FAITH;
    var u = Rules.addUnit(game, "missionary", c.q, c.r, cid);
    u.relId = r.id; u.charges = 2; u.home = c.id;
    return { ok: true, unit: u, text: "A Missionary of " + r.name + " sets out from " + c.name };
  }
  function missionaryTargets(game, u) {
    var r = missionaryRel(game, u);
    if (!r) return [];
    return game.cities.filter(function (c) { return c.rel !== r.id && Rules.hexDistance(c.q, c.r, u.q, u.r) <= 1; });
  }
  function missionaryRel(game, u) { return u.relId ? byId(game, u.relId) : founded(game, u.owner); }
  function spreadWith(game, unitId, cityId) {
    var u = Rules.unitById(game, unitId), c = Rules.cityById(game, cityId);
    if (!u || u.type !== "missionary" || !c) return { ok: false, reason: "Nothing to do" };
    if (u.moves <= 0) return { ok: false, reason: "No moves left" };
    if (Rules.hexDistance(u.q, u.r, c.q, c.r) > 1) return { ok: false, reason: "Move next to the city" };
    var r = missionaryRel(game, u);
    if (!r) return { ok: false, reason: "No religion to spread" };
    c.relp = c.relp || {};
    Object.keys(c.relp).forEach(function (id) { if (id !== r.id) c.relp[id] = Math.round(c.relp[id] * 0.5 * 10) / 10; });
    c.relp[r.id] = Math.min(PRESSURE_CAP, (c.relp[r.id] || 0) + MISSIONARY_PUSH);
    settle(game, c);
    state(game).stats.missionaries++;
    u.charges = (u.charges == null ? 2 : u.charges) - 1; u.moves = 0;
    if (u.charges <= 0) Rules.removeUnit(game, u);
    if (c.owner !== u.owner && Diplo && Diplo.rel(game, c.owner, u.owner)) Diplo.remember(game, c.owner, u.owner, "missionary", -1, "Missionaries in our cities");
    return { ok: true, text: r.name + " spreads in " + c.name };
  }

  // ---- majority & diplomacy
  function majority(game, cid) {
    var count = {}, cs = Rules.citiesOf(game, cid);
    cs.forEach(function (c) { if (c.rel) count[c.rel] = (count[c.rel] || 0) + 1; });
    var best = null, bv = 0;
    Object.keys(count).sort().forEach(function (id) { if (count[id] > bv) { bv = count[id]; best = id; } });
    return best && bv * 2 >= cs.length ? { id: best, n: bv } : (best ? { id: best, n: bv, weak: true } : null);
  }
  function zealous(game, cid) {
    var G = root.PlanetGov, tr = (game.civs[cid].design && game.civs[cid].design.traits) || [];
    return tr.indexOf("nomadic") !== -1 || !!(G && G.civ(game, cid).gov === "theocracy");
  }
  if (Diplo && Diplo.addReason) Diplo.addReason(function (game, a, b) {
    if (!game.religion) return [];
    var out = [], ma = majority(game, a), mb = majority(game, b);
    if (ma && mb && !ma.weak && !mb.weak) {
      if (ma.id === mb.id) out.push({ label: "Shared faith: " + byId(game, ma.id).name, v: zealous(game, a) || zealous(game, b) ? 2 : 1 });
      else out.push({ label: (zealous(game, a) ? "Heretics (" : "Rival faith (") + byId(game, mb.id).name + ")", v: zealous(game, a) ? -2 : -1 });
    }
    var r = founded(game, a);
    if (r && r.founderBelief === "papal_primacy" && Rules.citiesOf(game, b).some(function (c) { return c.rel === r.id; })) out.push({ label: "Papal Primacy", v: 2 });
    var sa = state(game).civ[a], sb = state(game).civ[b];
    if (sa && sb && sa.ideology && sb.ideology) {
      if (sa.ideology === sb.ideology) out.push({ label: "Shared ideology: " + IDEOLOGIES[sa.ideology].name, v: 2 });
      else out.push({ label: IDEOLOGIES[sa.ideology].name + " vs " + IDEOLOGIES[sb.ideology].name, v: -2 });
    }
    return out;
  });

  Happy.addSource(function (game, cid) {
    if (!game.religion) return [];
    var out = [], m = majority(game, cid), cs = Rules.citiesOf(game, cid);
    if (m && !m.weak) out.push({ key: "faith", name: "Faith: " + byId(game, m.id).name, n: m.n, v: Math.floor(m.n / 3) + 1 });
    if (m) {
      var r = byId(game, m.id);
      if (r && r.followerBelief === "religious_art") {
        var t = cs.filter(function (c) { return c.rel === r.id && hasB(c, "temple"); }).length;
        if (t) out.push({ key: "belief", name: "Religious Art", n: t, v: Math.min(4, t) });
      }
    }
    var st = state(game).civ[cid];
    if (st && st.ideology && st.tenets >= 2 && (st.ideology === "freedom" || st.ideology === "order") || st && st.ideology === "autonomy" && st.tenets >= 4)
      out.push({ key: "ideology", name: IDEOLOGIES[st.ideology].name, n: 1, v: Math.floor(cs.length / 3) });
    return out;
  });

  Combat.addStrengthMod(function (game, u, role) {
    var out = [], r = founded(game, u.owner);
    if (r && r.founderBelief === "holy_warriors" && game.cities.some(function (c) { return c.rel === r.id && Rules.hexDistance(c.q, c.r, u.q, u.r) <= 3; })) out.push({ label: "Holy Warriors", v: 0.1 });
    var st = game.religion && state(game).civ[u.owner];
    if (role === "def" && st && st.ideology === "order" && st.tenets >= 2) out.push({ label: "Iron Curtain", v: 0.1 });
    if (role === "def" && st && st.ideology === "autonomy" && st.tenets >= 3) out.push({ label: "Militia", v: 0.15 });
    return out;
  });

  // ---- ideology
  function chooseIdeology(game, cid, id) {
    var st = state(game).civ[cid];
    if (!IDEOLOGIES[id]) return { ok: false, reason: "Unknown ideology" };
    if (st.ideology) return { ok: false, reason: "Already chosen" };
    st.ideology = id; st.tenets = 1; st.pendingIdeology = false; st.ideoEra = era(game, cid);
    bumpVer(game);
    var known = cid === 0 || (Diplo && Diplo.met(game, 0, cid));
    Rules.logEvent(game, "religion", (known ? Rules.civName(game, cid) : "A distant power") + " embraces " + IDEOLOGIES[id].name, known ? 0 : null);
    var S = root.PlanetStory;
    if (S) {
      if (cid === 0 && S.chron) S.chron(game, S.pick(game, "ideology", [
        "The age of smoke demanded a creed for the machine. In {year} {civ} chose " + IDEOLOGIES[id].name + ", and the arguments in {capital}'s cafés never quite stopped.",
        "Posters went up overnight across {capital}: " + IDEOLOGIES[id].name + ". The {people} had picked a side in the century's great quarrel."
      ]));
      if (S.signal) S.signal(game, cid, "ideology", {});
    }
    return { ok: true, text: Rules.civName(game, cid) + " embraces " + IDEOLOGIES[id].name };
  }
  function era(game, cid) { var E = root.PlanetEras; return E ? E.eraOf(game, cid) : 0; }
  var TRAIT_IDEO = { mercantile: "freedom", scholarly: "freedom", seafaring: "freedom", militaristic: "order", industrious: "order", expansionist: "order", agrarian: "autonomy", nomadic: "autonomy" };
  function aiIdeology(game, cid) {
    var tr = (game.civs[cid].design && game.civs[cid].design.traits) || [], v = { freedom: 0, order: 0, autonomy: 0 };
    tr.forEach(function (t) { if (TRAIT_IDEO[t]) v[TRAIT_IDEO[t]] += 2; });
    var G = root.PlanetGov, g = G && G.civ(game, cid).gov;
    if (g === "democracy" || g === "republic" || g === "technocracy") v.freedom += 2;
    if (g === "autocracy" || g === "communism") v.order += 2;
    if (g === "theocracy") v.autonomy += 1;
    // Follow the strongest friend's ideology now and then.
    return IDEO_ORDER.slice().sort(function (a, b) { return v[b] - v[a] || IDEO_ORDER.indexOf(a) - IDEO_ORDER.indexOf(b); })[0];
  }
  function ideoYield(game, cid, c, y) {
    var st = game.religion && game.religion.civ[cid];
    if (!st || !st.ideology) return y;
    var n = st.tenets;
    if (st.ideology === "freedom" && n >= 3) y.gold += Math.floor(Math.max(0, y.gold) * 0.15);
    if (st.ideology === "order") { if (n >= 1) y.prod += Math.floor(y.prod * 0.1); if (n >= 3) y.prod += 1; }
    if (st.ideology === "autonomy" && n >= 1) { y.food += 1; if (y.surplus != null) y.surplus += 1; }
    return y;
  }

  function bumpVer(game) { state(game).ver++; game._happyVer = (game._happyVer || 0) + 1; }

  // ---- per civ turn
  function civTurn(game, cid, events) {
    var st = state(game), c = st.civ[cid];
    c.perTurn = faithRate(game, cid);
    c.faith += c.perTurn;
    var auto = game.civs[cid].ai || game._autoPlayer;
    if (!c.founded && c.faith >= FOUND_AT && st.pendingFound.indexOf(cid) === -1 && slotsLeft(game) > 0) {
      if (auto) { var b = aiBeliefs(game, cid); found(game, cid, { founder: b.founder, follower: b.follower }); }
      else { st.pendingFound.push(cid); events.push({ kind: "religion", text: "Your faithful are ready to found a religion (open the Religion panel)" }); }
    }
    // Ideology at the Industrial era (4); one more tenet per era after (max 4).
    var e = era(game, cid);
    if (e >= 4 && !c.ideology) {
      if (auto) chooseIdeology(game, cid, aiIdeology(game, cid));
      else if (!c.pendingIdeology) { c.pendingIdeology = true; events.push({ kind: "religion", text: "The Industrial age demands an ideology (open the Religion panel)" }); }
    }
    if (c.ideology) { var want = Math.min(4, 1 + Math.max(0, e - (c.ideoEra || 4))); if (want > c.tenets) { c.tenets = want; bumpVer(game); } }
    // AI: spend faith on missionaries while there are cities to convert.
    var maxMis = 2 + (zealous(game, cid) ? 2 : 0) + Math.floor(Rules.citiesOf(game, cid).length / 4);
    if (auto && c.founded && c.faith >= BUY_FAITH && game.units.filter(function (u) { return u.owner === cid && u.type === "missionary"; }).length < maxMis) {
      var r0 = founded(game, cid);
      var home = Rules.citiesOf(game, cid).filter(function (x) { return x.rel === r0.id; })[0];
      var probe = home && { q: home.q, r: home.r, owner: cid, type: "missionary", moves: 3 };
      if (home && game.cities.some(function (x) {
        return x.rel !== r0.id && Rules.hexDistance(x.q, x.r, home.q, home.r) <= 30 && !Combat.atWar(game, cid, x.owner) &&
          (x.owner === cid || Rules.longPath(game, probe, x.q, x.r, 90));
      })) buyMissionary(game, home.id);
    }
    // AI overseas mission: with faith to spare and no road to the heathen,
    // send envoys by ship (abstracted: faith becomes pressure in one city).
    if (auto && c.founded && c.faith >= 260 && game.turn % 4 === cid % 4) {
      var r1 = founded(game, cid), capc = Rules.citiesOf(game, cid).filter(function (x) { return x.capital; })[0], holy1 = {};
      state(game).list.forEach(function (x) { holy1[x.holyCity] = 1; });
      var Dp2 = root.PlanetDiplomacy;
      var far = capc && game.cities.filter(function (x) {
        return x.owner !== cid && x.rel !== r1.id && !holy1[x.id] && Dp2 && Dp2.met(game, cid, x.owner) && !Combat.atWar(game, cid, x.owner);
      }).sort(function (a, b) { return (a.rel ? 10 : 0) + Rules.hexDistance(capc.q, capc.r, a.q, a.r) - (b.rel ? 10 : 0) - Rules.hexDistance(capc.q, capc.r, b.q, b.r) || a.id - b.id; })[0];
      if (far) {
        c.faith -= 150;
        far.relp = far.relp || {};
        Object.keys(far.relp).forEach(function (id) { if (id !== r1.id) far.relp[id] = Math.round(far.relp[id] * 0.6 * 10) / 10; });
        far.relp[r1.id] = Math.min(PRESSURE_CAP, (far.relp[r1.id] || 0) + 120);
        settle(game, far);
        st.stats.missionaries++; st.stats.overseas = (st.stats.overseas || 0) + 1;
      }
    }
    // AI missionaries: aim at the nearest non-following city.
    if (auto) game.units.forEach(function (u) {
      if (u.owner !== cid || u.type !== "missionary" || u.moves <= 0) return;
      var r = missionaryRel(game, u);
      if (!r) { Rules.removeUnit(game, u); return; }
      var holy = {}; state(game).list.forEach(function (x) { holy[x.holyCity] = 1; });
      var score = function (x) {
        var d = Rules.hexDistance(u.q, u.r, x.q, x.r);
        return d - (x.owner === cid ? 3 : 0) - (!x.rel ? 4 : 0) + (holy[x.id] ? 30 : 0) - (zealous(game, cid) && x.owner !== cid ? 2 : 0);
      };
      var t = game.cities.filter(function (x) { return x.rel !== r.id && (x.owner === cid || !Combat.atWar(game, cid, x.owner)) && !(u.bad && u.bad[x.id]); })
        .sort(function (a, b) { return score(a) - score(b) || a.id - b.id; })[0];
      if (!t) return;
      if (Rules.hexDistance(u.q, u.r, t.q, t.r) > 1) {
        var O = root.PlanetOrders;
        if (O && !O.advance(game, u, t.q, t.r)) { u.bad = u.bad || {}; u.bad[t.id] = 1; }
      }
      if (Rules.hexDistance(u.q, u.r, t.q, t.r) <= 1) { u.moves = Math.max(u.moves, 1); spreadWith(game, u.id, t.id); }
    });
  }

  var MODS = function (game, cid) {
    return {
      init: function (g) { state(g); },
      canBuild: function (build, city) {
        if (build === "missionary") {
          var st = game.religion && game.religion.civ[cid];
          return !!(city && city.rel && st && st.faith >= MISSIONARY_FAITH && founded(game, cid) && city.rel === founded(game, cid).id);
        }
        return true;
      },
      cityYield: function (c, y) {
        if (!game.religion) return y;
        var r = c.rel ? byId(game, c.rel) : null;
        if (r) {
          var fb = r.followerBelief;
          var t = game.index.get(Rules.key(c.q, c.r));
          if (fb === "river_goddess" && (t.river > 0 || Rules.neighbours(game, t).some(function (n) { return n.river > 0; }))) { y.food += 1; if (y.surplus != null) y.surplus += 1; }
          if (fb === "sacred_groves" && Rules.tilesInRadius(game, c.q, c.r, 1).some(function (n) { return n.biome === "forest"; })) y.prod += 1;
          if (fb === "feed_the_world" && hasB(c, "shrine")) { y.food += 1; if (y.surplus != null) y.surplus += 1; }
          if (fb === "choral_music" && hasB(c, "temple")) y.gold += 1;
        }
        var mine = founded(game, cid);
        if (mine && mine.founderBelief === "tithes" && c.capital) y.gold += followers(game, mine.id).length;
        if (mine && mine.founderBelief === "sacred_charter" && mine.holyCity === c.id) y.prod += 3;
        return ideoYield(game, cid, c, y);
      },
      cityScience: function (c) {
        if (!game.religion) return 0;
        var s = 0, r = c.rel ? byId(game, c.rel) : null;
        if (r && r.followerBelief === "monastic_science" && hasB(c, "temple")) s += 1;
        var mine = founded(game, cid);
        if (mine && mine.founderBelief === "world_church" && c.capital) s += Math.floor(followers(game, mine.id).length / 3);
        var st = game.religion.civ[cid];
        if (st && st.ideology === "freedom" && st.tenets >= 1) s += Math.round((1 + Math.floor(c.pop / 3)) * 0.1);
        return s;
      },
      onEndTurn: function (g, events, sci, c) {
        civTurn(g, c, events);
        // A Missionary costs faith when trained.
        g.units.forEach(function (u) {
          if (u.owner === c && u.type === "missionary" && !u.relId) {
            var r = founded(g, c);
            u.relId = r ? r.id : null; u.charges = 2;
            state(g).civ[c].faith = Math.max(0, state(g).civ[c].faith - MISSIONARY_FAITH);
          }
        });
      }
    };
  };
  var WORLD = { init: function (g) { state(g); }, onEndTurn: function (g) { spread(g); } };
  Rules.registerPlugin({ mods: MODS, world: WORLD });

  root.PlanetReligion = {
    FOUND_AT: FOUND_AT, BELIEFS: BELIEFS, BELIEF_ORDER: BELIEF_ORDER, IDEOLOGIES: IDEOLOGIES, IDEO_ORDER: IDEO_ORDER, COLORS: COLORS, SYMBOLS: SYMBOLS,
    MISSIONARY_FAITH: MISSIONARY_FAITH, state: state, byId: byId, founded: founded, cap: cap, slotsLeft: slotsLeft, suggestName: suggestName,
    addFaith: addFaith, buyMissionary: buyMissionary, BUY_FAITH: BUY_FAITH, faithRate: faithRate, cityFaith: cityFaith, found: found, freeBeliefs: freeBeliefs, aiBeliefs: aiBeliefs,
    pushPressure: pushPressure, spread: spread, settle: settle, spreadWith: spreadWith, missionaryTargets: missionaryTargets, majority: majority,
    followers: followers, chooseIdeology: chooseIdeology, aiIdeology: aiIdeology, zealous: zealous, holySite: holySite
  };
})(typeof window !== "undefined" ? window : globalThis);
