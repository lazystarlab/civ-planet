/*
 * gov.js — GOVERNMENTS AND POLICIES (slice 15). No DOM.
 * game.gov = { civ: [{ gov, policies: [ids], anarchy: turns, since, changed, cooldown: { slot: turn } }], ver }
 * Every civ starts in Despotism. A government is unlocked by a tech; switching
 * costs ANARCHY turns of anarchy (no gold or science, -25% production);
 * then the new government's slots (military, economic, diplomatic, wildcard)
 * take policy cards (any card fits a wildcard slot). Swapping a card is free
 * once its slot has been untouched for SWAP_COOLDOWN turns, otherwise it costs gold.
 * Effects go through the per-civ hooks (tileYield, cityYield, cityScience,
 * unitMoves, buildCost), Happy.addSource (garrisons, war weariness), combat
 * strength mods and diplomacy reasons (similar governments +1, very different -1).
 * The AI picks a government and cards by traits (aiTurn).
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Happy = root.PlanetHappiness, Combat = root.PlanetCombat, Diplo = root.PlanetDiplomacy;

  var ANARCHY = 2, SWAP_COOLDOWN = 10;
  var SLOT_NAMES = { military: "Military", economic: "Economic", diplomatic: "Diplomatic", wild: "Wildcard" };
  // family: for diplomacy (same family +1, opposed families -1).
  var GOVS = {
    despotism:  { name: "Despotism", tech: null, family: "auto", slots: { military: 1, economic: 1 }, weary: 0.5,
      text: "-1 on any tile yield above 2 · +1 production in the capital" },
    monarchy:   { name: "Monarchy", tech: "currency", family: "auto", slots: { military: 1, economic: 1, wild: 1 }, weary: 1,
      text: "+1 happiness per garrisoned city (max 4) · +2 gold in the capital · 1 more free unit per city" },
    theocracy:  { name: "Theocracy", tech: "theology", family: "faith", slots: { military: 1, economic: 1, diplomatic: 1 }, weary: 0.75,
      text: "+2 faith per city · Temples +1 happiness · -10% science" },
    republic:   { name: "Republic", tech: "philosophy", family: "free", slots: { economic: 2, diplomatic: 1 }, weary: 1.5,
      text: "+1 gold on tiles that already yield gold · +10% science · war weariness x1.5" },
    autocracy:  { name: "Autocracy", tech: "rifling", family: "order", slots: { military: 3, economic: 1 }, weary: 0.5,
      text: "Units cost -20% · +10% combat strength · -1 happiness per 4 cities" },
    communism:  { name: "Communism", tech: "industrialization", family: "order", slots: { military: 1, economic: 2, wild: 1 }, weary: 0.5,
      text: "+2 production in every non-capital city · -1 gold per city" },
    democracy:  { name: "Democracy", tech: "economics", family: "free", slots: { economic: 2, diplomatic: 1, wild: 1 }, weary: 2,
      text: "+15% science and gold · +1 happiness per 2 cities · war weariness x2" },
    technocracy:{ name: "Technocracy", tech: "computers", family: "free", slots: { economic: 2, wild: 2 }, weary: 1.5,
      text: "+30% science · -10% gold" }
  };
  var GOV_ORDER = Object.keys(GOVS);
  var OPPOSED = { free: "order", order: "free", faith: "free" };

  var POLICIES = {
    // military
    conscription:   { cat: "military", name: "Conscription", tech: "bronze_working", text: "Land units cost -20%" },
    garrison_duty:  { cat: "military", name: "Garrison Duty", tech: "masonry", text: "+1 happiness per garrisoned city (max 3)" },
    veteran_corps:  { cat: "military", name: "Veteran Corps", tech: "iron_working", text: "New units start with +10 XP" },
    drill_manuals:  { cat: "military", name: "Drill Manuals", tech: "feudalism", text: "+10% defense for land units" },
    logistics_corps:{ cat: "military", name: "Logistics Corps", tech: "railroad", text: "+1 movement for land units" },
    total_war:      { cat: "military", name: "Total War", tech: "rifling", text: "+15% attack · -2 happiness" },
    // economic
    god_king:       { cat: "economic", name: "God King", tech: null, text: "+1 gold, +1 production in the capital" },
    agrarian_reform:{ cat: "economic", name: "Agrarian Reform", tech: "pottery", text: "+1 food in every city" },
    craftsmen:      { cat: "economic", name: "Craftsmen", tech: "masonry", text: "+10% production" },
    caravan_tolls:  { cat: "economic", name: "Caravan Tolls", tech: "currency", text: "+1 gold per city" },
    scholasticism:  { cat: "economic", name: "Scholasticism", tech: "literature", text: "+1 science per city" },
    free_market:    { cat: "economic", name: "Free Market", tech: "banking", text: "+15% gold" },
    five_year_plan: { cat: "economic", name: "Five-Year Plan", tech: "industrialization", text: "+2 production in cities of size 6+" },
    research_grants:{ cat: "economic", name: "Research Grants", tech: "scientific_theory", text: "+15% science" },
    // diplomatic
    diplomatic_league: { cat: "diplomatic", name: "Diplomatic League", tech: "writing", text: "+1 attitude with every civ you know" },
    merchant_confederacy: { cat: "diplomatic", name: "Merchant Confederacy", tech: "currency", text: "+2 gold per civ you are at peace with" },
    cultural_exchange: { cat: "diplomatic", name: "Cultural Exchange", tech: "printing_press", text: "+1 science per civ you know" },
    peaceful_coexistence: { cat: "diplomatic", name: "Peaceful Coexistence", tech: "philosophy", text: "-50% war weariness" },
    propaganda:     { cat: "diplomatic", name: "Propaganda", tech: "mass_media", text: "-50% war weariness · +1 happiness per 4 cities" },
    // wildcard only
    inspiration:    { cat: "wild", name: "Inspiration", tech: "mysticism", text: "+1 faith per city" },
    patronage:      { cat: "wild", name: "Patronage", tech: "acoustics", text: "+10% production toward wonders" }
  };
  var POLICY_ORDER = Object.keys(POLICIES);

  function state(game) {
    var s = game.gov || (game.gov = {});
    if (!s.civ) s.civ = [];
    while (s.civ.length < game.civs.length) s.civ.push({ gov: "despotism", policies: [], anarchy: 0, since: game.turn || 0, changed: 0, cooldown: {} });
    if (!s.stats) s.stats = { switches: 0, history: [] };
    if (!s.ver) s.ver = 1;
    return s;
  }
  function civ(game, cid) { return state(game).civ[cid]; }
  function govOf(game, cid) { var c = civ(game, cid); return c && c.anarchy > 0 ? null : GOVS[c ? c.gov : "despotism"]; }
  function govId(game, cid) { return civ(game, cid).gov; }
  function inAnarchy(game, cid) { return civ(game, cid).anarchy > 0; }
  function hasPolicy(game, cid, id) { var c = civ(game, cid); return !!(c && !(c.anarchy > 0) && c.policies.indexOf(id) !== -1); }
  function bump(game) { state(game).ver++; game._happyVer = (game._happyVer || 0) + 1; }
  function available(game, cid) { return GOV_ORDER.filter(function (g) { return !GOVS[g].tech || Rules.hasTech(game, GOVS[g].tech, cid); }); }
  function cardsAvailable(game, cid) { return POLICY_ORDER.filter(function (p) { return !POLICIES[p].tech || Rules.hasTech(game, POLICIES[p].tech, cid); }); }

  // Slot list for a government: [{ slot, i }] in display order.
  function slotsOf(govIdV) {
    var g = GOVS[govIdV], out = [];
    ["military", "economic", "diplomatic", "wild"].forEach(function (k) { for (var i = 0; i < (g.slots[k] || 0); i++) out.push(k); });
    return out;
  }
  function fits(card, slot) { return slot === "wild" || POLICIES[card].cat === slot; }
  // Policies laid out into the slots: returns [{ slot, card }].
  function layout(game, cid) {
    var c = civ(game, cid), slots = slotsOf(c.gov), used = {}, out = slots.map(function (s) { return { slot: s, card: null }; });
    // Exact-category slots first, then wildcards.
    c.policies.forEach(function (p) {
      var i = out.findIndex(function (o) { return !o.card && o.slot === POLICIES[p].cat; });
      if (i < 0) i = out.findIndex(function (o) { return !o.card && o.slot === "wild"; });
      if (i >= 0) { out[i].card = p; used[p] = 1; }
    });
    return out;
  }
  function validPolicies(gov, list) {
    var slots = slotsOf(gov).map(function (s) { return { slot: s, card: null }; });
    return list.filter(function (p) {
      if (!POLICIES[p]) return false;
      var i = slots.findIndex(function (o) { return !o.card && o.slot === POLICIES[p].cat; });
      if (i < 0) i = slots.findIndex(function (o) { return !o.card && o.slot === "wild"; });
      if (i < 0) return false;
      slots[i].card = p; return true;
    });
  }

  function swapCost(game, cid) { return 20 + 10 * Rules.citiesOf(game, cid).length; }
  // Set the policy list (UI applies a whole layout). Free if every changed
  // card's category hasn't changed for SWAP_COOLDOWN turns, else gold.
  function setPolicies(game, cid, list, opts) {
    var c = civ(game, cid);
    if (c.anarchy > 0) return { ok: false, reason: "No policies during anarchy" };
    var avail = cardsAvailable(game, cid);
    if (list.some(function (p) { return avail.indexOf(p) === -1; })) return { ok: false, reason: "Card not unlocked" };
    var v = validPolicies(c.gov, list);
    if (v.length !== list.length) return { ok: false, reason: "Not enough slots for those cards" };
    var removed = c.policies.filter(function (p) { return list.indexOf(p) === -1; });
    var added = list.filter(function (p) { return c.policies.indexOf(p) === -1; });
    if (!removed.length && !added.length) return { ok: true, cost: 0 };
    var hot = removed.concat(added).some(function (p) { return game.turn - (c.cooldown[POLICIES[p].cat] || -99) < SWAP_COOLDOWN; });
    var cost = hot && removed.length ? swapCost(game, cid) : 0;
    if (opts && opts.dry) return { ok: true, cost: cost };
    if (cost > game.civs[cid].gold) return { ok: false, reason: "Swapping now costs " + cost + " gold (cooldown)" };
    game.civs[cid].gold -= cost;
    removed.concat(added).forEach(function (p) { c.cooldown[POLICIES[p].cat] = game.turn; });
    c.policies = list.slice();
    bump(game);
    return { ok: true, cost: cost, text: "Policies set" + (cost ? " (-" + cost + " gold)" : "") };
  }

  function switchGov(game, cid, g, events) {
    var c = civ(game, cid);
    if (!GOVS[g]) return { ok: false, reason: "Unknown government" };
    if (available(game, cid).indexOf(g) === -1) return { ok: false, reason: "Needs " + root.PlanetTech.TECHS[GOVS[g].tech].name };
    if (c.gov === g && !c.anarchy) return { ok: false, reason: "Already your government" };
    if (c.anarchy > 0) return { ok: false, reason: "Already in anarchy" };
    var from = c.gov;
    c.gov = g; c.anarchy = ANARCHY; c.since = game.turn; c.changed++;
    c.policies = validPolicies(g, c.policies);
    var st = state(game); st.stats.switches++;
    st.stats.history.push({ civ: cid, from: from, to: g, turn: game.turn });
    bump(game);
    var text = Rules.civName(game, cid) + " overthrows " + GOVS[from].name + " for " + GOVS[g].name + ": " + ANARCHY + " turns of anarchy";
    Rules.logEvent(game, "gov", text, cid === 0 || (Diplo && Diplo.met(game, 0, cid)) ? (cid === 0 ? 0 : null) : null);
    var S = root.PlanetStory;
    if (cid === 0 && S && S.chron) S.chron(game, S.pick(game, "gov", [
      "The old order of " + GOVS[from].name + " fell in {year}; after " + ANARCHY + " turns of shouting in the streets of {capital}, the {people} declared " + GOVS[g].name + ".",
      "In {year} the {people} tore down " + GOVS[from].name + ". What rose from the rubble called itself " + GOVS[g].name + ", and promised to do better.",
      "{capital} burned for a season. When the smoke cleared, {civ} was a " + GOVS[g].name + "."
    ]));
    return { ok: true, text: "Revolution! " + ANARCHY + " turns of anarchy, then " + GOVS[g].name };
  }

  // ---- effects helpers
  function atWarTurns(game, cid) {
    var n = 0, d = Diplo && Diplo.ensure(game);
    if (!d) return 0;
    game.civs.forEach(function (o, i) {
      if (i === cid) return;
      var r = Diplo.rel(game, cid, i);
      if (r && r.war) n = Math.max(n, game.turn - (r.warTurn || game.turn));
    });
    return n;
  }
  function atWar(game, cid) { return game.civs.some(function (o, i) { var r = i !== cid && Diplo.rel(game, cid, i); return r && r.war; }); }
  function weariness(game, cid) {
    if (!atWar(game, cid)) return 0;
    var g = govOf(game, cid), w = g ? g.weary : 1;
    if (hasPolicy(game, cid, "peaceful_coexistence")) w *= 0.5;
    if (hasPolicy(game, cid, "propaganda")) w *= 0.5;
    var t = atWarTurns(game, cid);
    return Math.min(Math.round(6 * w), Math.round(w * (1 + t / 12)));
  }
  function garrisoned(game, cid) {
    return Rules.citiesOf(game, cid).filter(function (c) {
      return game.units.some(function (u) { return u.owner === cid && u.q === c.q && u.r === c.r && Combat.strengthOf(u.type) > 0 && !Rules.UNIT_TYPES[u.type].air; });
    }).length;
  }
  function metPeace(game, cid) {
    return game.civs.filter(function (o, i) { var r = i !== cid && Diplo.rel(game, cid, i); return r && r.met && !r.war && !o.eliminated; }).length;
  }
  function metCount(game, cid) {
    return game.civs.filter(function (o, i) { var r = i !== cid && Diplo.rel(game, cid, i); return r && r.met && !o.eliminated; }).length;
  }

  Happy.addSource(function (game, cid) {
    var out = [], c = state(game).civ[cid];
    if (!c) return out;
    var g = govOf(game, cid), n = Rules.citiesOf(game, cid).length;
    if (g && c.gov === "monarchy") { var v = Math.min(4, garrisoned(game, cid)); if (v) out.push({ key: "gov", name: "Monarchy: garrisons", n: 1, v: v }); }
    if (g && c.gov === "democracy" && n >= 2) out.push({ key: "gov", name: "Democracy", n: 1, v: Math.floor(n / 2) });
    if (g && c.gov === "autocracy" && n >= 4) out.push({ key: "gov", name: "Autocracy", n: 1, v: -Math.floor(n / 4) });
    if (g && c.gov === "theocracy") { var t = Rules.citiesOf(game, cid).filter(function (x) { return (x.buildings || []).indexOf("temple") !== -1; }).length; if (t) out.push({ key: "gov", name: "Theocracy: temples", n: t, v: t }); }
    if (hasPolicy(game, cid, "garrison_duty")) { var gv = Math.min(3, garrisoned(game, cid)); if (gv) out.push({ key: "policy", name: "Garrison Duty", n: 1, v: gv }); }
    if (hasPolicy(game, cid, "total_war")) out.push({ key: "policy", name: "Total War", n: 1, v: -2 });
    if (hasPolicy(game, cid, "propaganda") && n >= 4) out.push({ key: "policy", name: "Propaganda", n: 1, v: Math.floor(n / 4) });
    var w = weariness(game, cid);
    if (w) out.push({ key: "weary", name: "War weariness", n: 1, v: -w });
    if (c.anarchy > 0) out.push({ key: "anarchy", name: "Anarchy", n: 1, v: -2 });
    return out;
  });

  Combat.addStrengthMod(function (game, u, role) {
    var out = [];
    if (role !== "def" && inGov(game, u.owner, "autocracy")) out.push({ label: "Autocracy", v: 0.1 });
    if (role === "def" && inGov(game, u.owner, "autocracy")) out.push({ label: "Autocracy", v: 0.1 });
    if (role !== "def" && hasPolicy(game, u.owner, "total_war")) out.push({ label: "Total War", v: 0.15 });
    if (role === "def" && hasPolicy(game, u.owner, "drill_manuals") && !Rules.UNIT_TYPES[u.type].naval) out.push({ label: "Drill Manuals", v: 0.1 });
    return out;
  });
  function inGov(game, cid, g) { var c = state(game).civ[cid]; return !!(c && c.gov === g && !(c.anarchy > 0)); }

  if (Diplo && Diplo.addReason) Diplo.addReason(function (game, a, b) {
    var s = game.gov && game.gov.civ;
    if (!s || !s[a] || !s[b]) return [];
    var out = [];
    var ga = GOVS[s[a].gov], gb = GOVS[s[b].gov];
    if (s[a].anarchy > 0 || s[b].anarchy > 0) return out;
    if (s[a].gov === s[b].gov && s[a].gov !== "despotism") out.push({ label: "Fellow " + ga.name, v: 1 });
    else if (OPPOSED[ga.family] === gb.family) out.push({ label: ga.name + " vs " + gb.name, v: -1 });
    if (hasPolicy(game, a, "diplomatic_league")) out.push({ label: "Diplomatic League", v: 1 });
    return out;
  });

  function faithBonus(game, cid) {
    var f = 0;
    if (inGov(game, cid, "theocracy")) f += 2;
    if (hasPolicy(game, cid, "inspiration")) f += 1;
    return f;
  }
  function scienceMult(game, cid) {
    var m = 0, c = civ(game, cid);
    if (c.anarchy > 0) return -1;
    if (inGov(game, cid, "republic")) m += 0.10;
    if (inGov(game, cid, "democracy")) m += 0.15;
    if (inGov(game, cid, "technocracy")) m += 0.30;
    if (inGov(game, cid, "theocracy")) m -= 0.10;
    if (hasPolicy(game, cid, "research_grants")) m += 0.15;
    return m;
  }

  var MODS = function (game, cid) {
    return {
      init: function (g) { state(g); },
      tileYield: function (tile, y, info) {
        var c = game.gov && game.gov.civ[cid];
        if (!c || c.anarchy > 0) return y;
        if (c.gov === "despotism") { if (y.food > 2) y.food -= 1; if (y.prod > 2) y.prod -= 1; if (y.gold > 2) y.gold -= 1; }
        if (c.gov === "republic" && y.gold >= 1) y.gold += 1;
        return y;
      },
      cityYield: function (city, y) {
        var c = game.gov && game.gov.civ[cid];
        if (!c) return y;
        if (c.anarchy > 0) { y.gold = Math.min(y.gold, 0); y.prod = Math.floor(y.prod * 0.75); return y; }
        var cap = city.capital;
        if (c.gov === "despotism" && cap) y.prod += 1;
        if (c.gov === "monarchy" && cap) y.gold += 2;
        if (c.gov === "communism") { if (!cap) y.prod += 2; y.gold -= 1; }
        if (c.gov === "democracy") y.gold += Math.floor(Math.max(0, y.gold) * 0.15);
        if (c.gov === "technocracy") y.gold -= Math.floor(Math.max(0, y.gold) * 0.1);
        var has = function (p) { return c.policies.indexOf(p) !== -1; };
        if (has("god_king") && cap) { y.gold += 1; y.prod += 1; }
        if (has("agrarian_reform")) { y.food += 1; if (y.surplus != null) y.surplus += 1; }
        if (has("craftsmen")) y.prod += Math.floor(y.prod * 0.1);
        if (has("caravan_tolls")) y.gold += 1;
        if (has("free_market")) y.gold += Math.floor(Math.max(0, y.gold) * 0.15);
        if (has("five_year_plan") && city.pop >= 6) y.prod += 2;
        if (has("merchant_confederacy") && cap) y.gold += 2 * metPeace(game, cid);
        if (has("patronage") && city.build && Rules.BUILDS[city.build] && Rules.BUILDS[city.build].wonder) y.prod += Math.floor(y.prod * 0.1);
        return y;
      },
      cityScience: function (city) {
        var c = game.gov && game.gov.civ[cid];
        if (!c) return 0;
        var base = 1 + Math.floor(city.pop / 3);
        if (c.anarchy > 0) return -base;
        var s = Math.round(base * scienceMult(game, cid));
        if (c.policies.indexOf("scholasticism") !== -1) s += 1;
        if (c.policies.indexOf("cultural_exchange") !== -1 && city.capital) s += metCount(game, cid);
        return s;
      },
      unitMoves: function (type, moves) {
        var t = Rules.UNIT_TYPES[type];
        if (t && !t.naval && !t.air && t.strength > 0 && hasPolicy(game, cid, "logistics_corps")) return moves + 1;
        return moves;
      },
      buildCost: function (build, cost) {
        var b = Rules.BUILDS[build];
        if (!b || !b.unit) return cost;
        var t = Rules.UNIT_TYPES[b.unit], m = 1;
        if (inGov(game, cid, "autocracy")) m -= 0.2;
        if (hasPolicy(game, cid, "conscription") && t && !t.naval && !t.air && t.strength > 0) m -= 0.2;
        return Math.max(1, Math.round(cost * m));
      },
      onEndTurn: function (g, events, sci, c) {
        var cs = civ(g, c);
        if (cs.anarchy > 0) {
          cs.anarchy--;
          if (!cs.anarchy) {
            bump(g);
            if (c === 0) events.push({ kind: "gov", text: "Anarchy ends: " + GOVS[cs.gov].name + " takes hold" });
          }
        }
        // Veteran Corps: new units get +10 XP once.
        if (hasPolicy(g, c, "veteran_corps")) g.units.forEach(function (u) { if (u.owner === c && !u.vc && Combat.strengthOf(u.type) > 0) { u.vc = 1; u.xp = (u.xp || 0) + 10; } });
        if (g.civs[c].ai || g._autoPlayer) aiTurn(g, c);
      }
    };
  };

  // ---- AI
  var TRAIT_GOV = {
    militaristic: { autocracy: 3, monarchy: 1 }, scholarly: { technocracy: 3, republic: 2, democracy: 1 },
    mercantile: { republic: 2, democracy: 2 }, industrious: { communism: 3, autocracy: 1 },
    agrarian: { monarchy: 2, theocracy: 1, communism: 1 }, expansionist: { monarchy: 2, autocracy: 1 },
    nomadic: { theocracy: 2, monarchy: 1 }, seafaring: { republic: 2, democracy: 1 }
  };
  var TRAIT_CARD = {
    militaristic: { conscription: 2, total_war: 2, veteran_corps: 2, drill_manuals: 1 }, scholarly: { scholasticism: 2, research_grants: 2, cultural_exchange: 2 },
    mercantile: { caravan_tolls: 2, free_market: 2, merchant_confederacy: 2 }, industrious: { craftsmen: 2, five_year_plan: 2, patronage: 1 },
    agrarian: { agrarian_reform: 2 }, expansionist: { agrarian_reform: 1, god_king: 1 }, nomadic: { logistics_corps: 2, inspiration: 1 }, seafaring: { merchant_confederacy: 1 }
  };
  var GOV_RANK = { despotism: 0, monarchy: 1, theocracy: 1.5, republic: 2, autocracy: 3, communism: 3, democracy: 3.5, technocracy: 4.5 };
  function traitsOf(game, cid) { var d = game.civs[cid].design; return (d && d.traits) || []; }
  function govScore(game, cid, g) {
    var s = GOV_RANK[g];
    traitsOf(game, cid).forEach(function (t) { s += ((TRAIT_GOV[t] || {})[g] || 0); });
    if (atWar(game, cid) && GOVS[g].weary >= 1.5) s -= 2;
    if (g === "theocracy" && root.PlanetReligion && root.PlanetReligion.founded(game, cid)) s += 1.5;
    return s;
  }
  function cardScore(game, cid, p) {
    var s = 1 + (POLICIES[p].tech ? (root.PlanetTech.TECHS[POLICIES[p].tech].era || 0) * 0.2 : 0);
    traitsOf(game, cid).forEach(function (t) { s += ((TRAIT_CARD[t] || {})[p] || 0); });
    var war = atWar(game, cid);
    if (war && POLICIES[p].cat === "military") s += 1.5;
    if (war && (p === "peaceful_coexistence" || p === "propaganda")) s += 1;
    if (!war && p === "total_war") s -= 3;
    return s;
  }
  function bestCards(game, cid) {
    var c = civ(game, cid), slots = slotsOf(c.gov), cards = cardsAvailable(game, cid).slice();
    cards.sort(function (a, b) { return cardScore(game, cid, b) - cardScore(game, cid, a) || POLICY_ORDER.indexOf(a) - POLICY_ORDER.indexOf(b); });
    var pickL = [];
    slots.filter(function (s) { return s !== "wild"; }).forEach(function (s) {
      var p = cards.filter(function (x) { return POLICIES[x].cat === s && pickL.indexOf(x) === -1; })[0];
      if (p) pickL.push(p);
    });
    slots.filter(function (s) { return s === "wild"; }).forEach(function () {
      var p = cards.filter(function (x) { return pickL.indexOf(x) === -1; })[0];
      if (p) pickL.push(p);
    });
    return pickL;
  }
  function aiTurn(game, cid) {
    var c = civ(game, cid);
    if (c.anarchy > 0) return;
    // Government: switch when a clearly better one is available (rarely).
    if (game.turn - c.since >= 25 && (game.turn + cid * 7) % 5 === 0) {
      var cur = govScore(game, cid, c.gov), best = c.gov, bs = cur;
      available(game, cid).forEach(function (g) { var s = govScore(game, cid, g); if (s > bs + 1.4) { bs = s; best = g; } });
      if (best !== c.gov) { switchGov(game, cid, best); return; }
    }
    // Cards: fill empty slots now, re-plan every 15 turns.
    var want = bestCards(game, cid);
    var empty = layout(game, cid).some(function (o) { return !o.card; }) && want.length > c.policies.length;
    if (empty || (game.turn % 15 === cid % 15)) {
      var same = want.length === c.policies.length && want.every(function (p) { return c.policies.indexOf(p) !== -1; });
      if (!same) {
        var dry = setPolicies(game, cid, want, { dry: true });
        if (dry.ok && (!dry.cost || game.civs[cid].gold > dry.cost + 150)) setPolicies(game, cid, want);
      }
    }
  }

  Rules.registerPlugin({ mods: MODS, world: { init: function (g) { state(g); } } });

  root.PlanetGov = {
    GOVS: GOVS, GOV_ORDER: GOV_ORDER, POLICIES: POLICIES, POLICY_ORDER: POLICY_ORDER, SLOT_NAMES: SLOT_NAMES, ANARCHY: ANARCHY, SWAP_COOLDOWN: SWAP_COOLDOWN,
    state: state, civ: civ, govOf: govOf, govId: govId, inAnarchy: inAnarchy, hasPolicy: hasPolicy, available: available, cardsAvailable: cardsAvailable,
    slotsOf: slotsOf, layout: layout, fits: fits, setPolicies: setPolicies, switchGov: switchGov, swapCost: swapCost, weariness: weariness,
    faithBonus: faithBonus, scienceMult: scienceMult, aiTurn: aiTurn, govScore: govScore, bestCards: bestCards
  };
})(typeof window !== "undefined" ? window : globalThis);
