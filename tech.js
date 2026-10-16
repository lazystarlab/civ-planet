/*
 * tech.js — TECHNOLOGY TREE.
 * No DOM. Owns civs[cid].tech = { done: [ids], current: id|null, progress, queue: [ids] }
 * (game.tech is the player's). Every function takes an optional cid (default 0).
 * Effects reach the rules only through game.js hooks: makeModifiers(game)
 * returns tileYield / resourceVisible / canBuild / unitMoves / cityYield /
 * cityScience / init / onEndTurn. New units and buildings are registered into
 * PlanetGame.UNIT_TYPES and PlanetGame.BUILDS with a `tech` gate.
 * Add a tech: an entry in TECHS (col/row = position in the tree), plus any effect
 * in makeModifiers or a build with `tech: "<id>"`.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;

  var ERAS = [
    { name: "Ancient", cols: [0, 1, 2] },
    { name: "Classical", cols: [3, 4] }
  ];

  var TECHS = {
    agriculture:      { name: "Agriculture",      col: 0, row: 0.3, cost: 15,  requires: [], effect: "+1 food on Wheat" },
    ceremonial_burial:{ name: "Ceremonial Burial", col: 0, row: 1.4, cost: 15,  requires: [], effect: "Temple: +2 happiness" },
    mining:           { name: "Mining",           col: 0, row: 2.5, cost: 15,  requires: [], effect: "+1 production on Iron and Gold" },
    archery:          { name: "Archery",          col: 0, row: 3.6, cost: 15,  requires: [], effect: "Archer (ranged 6, range 2)" },
    pottery:          { name: "Pottery",          col: 1, row: 0, cost: 28,  requires: ["agriculture"], effect: "Granary: +2 food in the city" },
    animal_husbandry: { name: "Animal Husbandry", col: 1, row: 1, cost: 28,  requires: ["agriculture"], effect: "Reveals Horses · Horseman (10, 2 moves)" },
    bronze_working:   { name: "Bronze Working",   col: 1, row: 2, cost: 28,  requires: ["mining"], effect: "Spearman (10, +50% vs Horseman)" },
    masonry:          { name: "Masonry",          col: 1, row: 3, cost: 28,  requires: ["mining"], effect: "Monument (+1 prod, +1 gold, +1 happiness) · Walls" },
    sailing:          { name: "Sailing",          col: 2, row: 0, cost: 42,  requires: ["pottery"], effect: "+1 food on Fish · Trireme · Seafaring embarks" },
    writing:          { name: "Writing",          col: 2, row: 1, cost: 42,  requires: ["pottery"], effect: "Library: +2 science" },
    the_wheel:        { name: "The Wheel",        col: 2, row: 2, cost: 42,  requires: ["animal_husbandry"], effect: "Settlers +1 movement" },
    iron_working:     { name: "Iron Working",     col: 2, row: 3, cost: 42,  requires: ["bronze_working"], effect: "Swordsman (14)" },
    mathematics:      { name: "Mathematics",      col: 3, row: 2.5, cost: 60,  requires: ["the_wheel", "masonry"], effect: "+1 production in every city · Catapult" },
    currency:         { name: "Currency",         col: 3, row: 1, cost: 60,  requires: ["writing", "bronze_working"], effect: "Market: +25% gold, +1 trade route · Caravan: trade routes" },
    philosophy:       { name: "Philosophy",       col: 4, row: 1.75, cost: 85,  requires: ["writing", "mathematics"], effect: "+1 science in every city" },
    construction:     { name: "Construction",     col: 4, row: 3.4, cost: 80,  requires: ["masonry", "mathematics"], effect: "Colosseum (+3 happiness) · Composite Bowman" },
    navigation:       { name: "Navigation",       col: 4, row: 0, cost: 80,  requires: ["sailing", "mathematics"], effect: "Caravel (10, 4 moves, ocean, carries 3)" },
    // Slice 11: classical techs for the new buildings and wonders.
    mysticism:        { name: "Mysticism",        col: 1, row: 4.2, cost: 30,  requires: ["ceremonial_burial"], effect: "Wonders: Stonehenge, Oracle" },
    literature:       { name: "Literature",       col: 5, row: 1.2, cost: 115, requires: ["philosophy"], effect: "Amphitheater (+2 happiness) · Great Library" },
    engineering:      { name: "Engineering",      col: 5, row: 3, cost: 120, requires: ["construction"], effect: "Aqueduct (pop cap 16) · Terracotta Army" }
  };
  var TECH_ORDER = Object.keys(TECHS);

  // Units and buildings unlocked by techs (no combat yet: units just exist and move).
  var NEW_UNITS = {
    horseman:  { name: "Horseman",  moves: 2, canFound: false, strength: 10 },
    spearman:  { name: "Spearman",  moves: 1, canFound: false, strength: 10, bonusVs: { horseman: 0.5 } },
    swordsman: { name: "Swordsman", moves: 1, canFound: false, strength: 14 }
  };
  var NEW_BUILDS = {
    horseman:  { name: "Horseman",  cost: 16, unit: "horseman",  minPop: 1, popCost: 0, tech: "animal_husbandry" },
    spearman:  { name: "Spearman",  cost: 15, unit: "spearman",  minPop: 1, popCost: 0, tech: "bronze_working" },
    swordsman: { name: "Swordsman", cost: 28, unit: "swordsman", minPop: 1, popCost: 0, tech: "iron_working" },
    granary:   { name: "Granary",   cost: 40, building: "granary",  minPop: 1, popCost: 0, tech: "pottery",  note: "+2 food" },
    monument:  { name: "Monument",  cost: 30, building: "monument", minPop: 1, popCost: 0, tech: "masonry",  note: "+1 prod +1 gold +1 happy" },
    walls:     { name: "Walls",     cost: 30, building: "walls",    minPop: 1, popCost: 0, tech: "masonry",  note: "+100% defense" },
    library:   { name: "Library",   cost: 42, building: "library",  minPop: 1, popCost: 0, tech: "writing",  note: "+2 science" },
    market:    { name: "Market",    cost: 60, building: "market",   minPop: 1, popCost: 0, tech: "currency", note: "+25% gold, +1 trade route" }
  };
  Object.keys(NEW_UNITS).forEach(function (k) { Rules.UNIT_TYPES[k] = NEW_UNITS[k]; });
  Object.keys(NEW_BUILDS).forEach(function (k) { Rules.BUILDS[k] = NEW_BUILDS[k]; });

  function techOf(game, cid) { return game.civs ? game.civs[cid || 0].tech : game.tech; }

  function ensure(game, cid) {
    var holder = game.civs ? game.civs[cid || 0] : game;
    var t = holder.tech || {};
    holder.tech = {
      done: (t.done || []).filter(function (id) { return TECHS[id]; }),
      current: TECHS[t.current] ? t.current : null,
      progress: t.progress || 0,
      queue: (t.queue || []).filter(function (id) { return TECHS[id]; })
    };
    return holder.tech;
  }

  function has(game, id, cid) { var t = techOf(game, cid); return !!t && t.done.indexOf(id) !== -1; }

  function prereqsMet(game, id, cid) {
    return TECHS[id].requires.every(function (r) { return has(game, r, cid); });
  }

  // "done" | "researching" | "queued" | "available" | "locked"
  function status(game, id, cid) {
    var t = techOf(game, cid);
    if (has(game, id, cid)) return "done";
    if (t.current === id) return "researching";
    if (t.queue.indexOf(id) !== -1) return "queued";
    return prereqsMet(game, id, cid) ? "available" : "locked";
  }

  // Unresearched techs needed for id, prerequisites first (id last).
  function pathTo(game, id, cid) {
    var out = [];
    (function visit(t) {
      if (has(game, t, cid) || out.indexOf(t) !== -1) return;
      TECHS[t].requires.forEach(visit);
      out.push(t);
    })(id);
    return out;
  }

  // Research id now if possible; for a locked tech, queue the whole path to it.
  function setResearch(game, id, cid) {
    if (!TECHS[id] || has(game, id, cid)) return { ok: false, reason: "Already known" };
    var t = techOf(game, cid);
    var path = pathTo(game, id, cid);
    t.current = path[0];
    t.queue = path.slice(1);
    return { ok: true, path: path };
  }

  function turnsLeft(game, sciRate, cid) {
    var t = techOf(game, cid);
    if (!t.current) return null;
    if (!(sciRate > 0)) return Infinity;
    return Math.max(1, Math.ceil((TECHS[t.current].cost - t.progress) / sciRate));
  }

  function available(game, cid) {
    return TECH_ORDER.filter(function (id) { return status(game, id, cid) === "available"; });
  }

  function collect(game, events, sci, cid) {
    var t = ensure(game, cid);
    t.progress += sci;
    while (t.current && t.progress >= TECHS[t.current].cost) {
      t.progress -= TECHS[t.current].cost;
      t.done.push(t.current);
      events.push({ kind: "tech", text: "Researched " + TECHS[t.current].name });
      t.current = null;
      while (t.queue.length && !t.current) {
        var next = t.queue.shift();
        if (!has(game, next, cid) && prereqsMet(game, next, cid)) t.current = next;
      }
    }
  }

  // Give a tech outright (deals, wonders). Progress on it is kept for the next one.
  function grant(game, cid, id, events) {
    var t = ensure(game, cid);
    if (!TECHS[id] || t.done.indexOf(id) !== -1) return false;
    t.done.push(id);
    if (t.current === id) {
      t.current = null;
      while (t.queue.length && !t.current) {
        var next = t.queue.shift();
        if (!has(game, next, cid) && prereqsMet(game, next, cid)) t.current = next;
      }
    }
    t.queue = t.queue.filter(function (q) { return q !== id; });
    if (events) events.push({ kind: "tech", text: "Gained " + TECHS[id].name, cid: cid });
    return true;
  }

  function makeModifiers(game, cid) {
    cid = cid || 0;
    function h(id) { return has(game, id, cid); }
    return {
      init: function (g, c) { ensure(g, c); },
      onEndTurn: collect,
      tileYield: function (tile, y) {
        if (tile.resource === "wheat" && h("agriculture")) y.food += 1;
        if ((tile.resource === "iron" || tile.resource === "gold") && h("mining")) y.prod += 1;
        if (tile.resource === "fish" && h("sailing")) y.food += 1;
        return y;
      },
      resourceVisible: function (res) { return res !== "horses" || h("animal_husbandry"); },
      canBuild: function (key) {
        var b = Rules.BUILDS[key];
        return !(b && b.tech) || h(b.tech);
      },
      unitMoves: function (type, moves) { return type === "settler" && h("the_wheel") ? moves + 1 : moves; },
      cityYield: function (city, y, info) {
        var bs = info.buildings;
        if (bs.indexOf("granary") !== -1) y.food += 2;
        if (bs.indexOf("monument") !== -1) { y.prod += 1; y.gold += 1; }
        if (h("mathematics")) y.prod += 1;
        if (bs.indexOf("market") !== -1) y.gold += Math.max(1, Math.floor(y.gold * 0.25));
        return y;
      },
      cityScience: function (city) {
        var s = 0;
        if ((city.buildings || []).indexOf("library") !== -1) s += 2;
        if (h("philosophy")) s += 1;
        return s;
      }
    };
  }

  root.PlanetTech = {
    TECHS: TECHS, TECH_ORDER: TECH_ORDER, ERAS: ERAS,
    ensure: ensure, has: has, status: status, pathTo: pathTo,
    setResearch: setResearch, turnsLeft: turnsLeft, makeModifiers: makeModifiers,
    available: available, techOf: techOf, grant: grant
  };
})(typeof window !== "undefined" ? window : globalThis);
