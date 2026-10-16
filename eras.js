/*
 * eras.js — MEDIEVAL TO SPACE AGE: techs, units, buildings, wonders, projects,
 * upgrade chains, eras and the calendar. No DOM.
 *
 * Data-driven: each era is a list of tech rows
 *   [id, name, cost, [requires], { units, buildings, wonders, projects, bonus, note }]
 * and the tree position is computed: an era's columns start after the previous
 * era's, a tech's column is its depth among same-era prerequisites, and rows
 * are handed out in order within each column. Adding an era is adding data.
 * `bonus` is a per-city yield { food, prod, gold, sci } every city gets.
 *
 * Eras: a civ's era is the latest era in which it knows 2+ techs (Ancient at
 * least). game.eras = { civ: [index per civ], projects: { cid: { id: turn } },
 * launched: [{ civ, turn, year }] }.
 * Calendar: 40 years a turn to T75, then 25, 20, 10, 5, 2 and finally 1.
 * Advanced buildings cost gold upkeep (maint), taken from the city's gold.
 * Projects (BUILDS with project: id) are one-off city builds with an effect:
 * Grand Expedition and World's Fair repeat after a cooldown; the space
 * projects are once per civ. The Colony Ship sets a launched flag and calls
 * PlanetGalaxy.onLaunch (galaxy.js) — it does not end the game.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Tech = root.PlanetTech, Wonders = root.PlanetWonders, Happy = root.PlanetHappiness, Econ = root.PlanetEconomy;

  // ---------------------------------------------------------------- units
  var UNITS = {
    pikeman:          ["Pikeman", 40, "feudalism", { strength: 16, bonusVs: { horseman: 0.5, knight: 0.5 } }],
    knight:           ["Knight", 50, "chivalry", { strength: 20, moves: 2 }],
    crossbowman:      ["Crossbowman", 42, "machinery", { strength: 8, ranged: 15, range: 2 }],
    musketman:        ["Musketman", 60, "gunpowder", { strength: 24 }],
    cannon:           ["Cannon", 65, "metallurgy", { strength: 9, ranged: 26, range: 2, vsCity: 0.5, rough: 1 }],
    frigate:          ["Frigate", 60, "astronomy", { strength: 22, moves: 5, naval: true, ocean: true, cargo: 2, sight: 3 }],
    rifleman:         ["Rifleman", 85, "rifling", { strength: 34, bonusVs: { knight: 0.5 } }],
    ironclad:         ["Ironclad", 90, "steam_power", { strength: 36, moves: 4, naval: true, ocean: true, cargo: 0, sight: 3 }],
    infantry:         ["Infantry", 115, "replaceable_parts", { strength: 50, bonusVs: { tank: 0.33 } }],
    transport:        ["Transport", 80, "replaceable_parts", { strength: 12, moves: 5, naval: true, ocean: true, cargo: 6, sight: 2 }],
    artillery:        ["Artillery", 120, "ballistics", { strength: 14, ranged: 48, range: 3, vsCity: 0.5, rough: 1 }],
    destroyer:        ["Destroyer", 120, "combustion", { strength: 50, moves: 7, naval: true, ocean: true, cargo: 0, sight: 4 }],
    battleship:       ["Battleship", 160, "steel", { strength: 68, moves: 5, naval: true, ocean: true, cargo: 0, sight: 3 }],
    tank:             ["Tank", 160, "motorized", { strength: 72, moves: 3 }],
    rocket_artillery: ["Rocket Artillery", 180, "rocketry", { strength: 20, ranged: 80, range: 3, moves: 2, vsCity: 0.5 }],
    modern_armor:     ["Modern Armor", 210, "robotics", { strength: 100, moves: 3 }],
    missile_cruiser:  ["Missile Cruiser", 210, "guided_missiles", { strength: 100, moves: 6, naval: true, ocean: true, cargo: 0, sight: 4 }]
  };
  Object.keys(UNITS).forEach(function (k) {
    var d = UNITS[k], t = { name: d[0], moves: 1, canFound: false };
    Object.keys(d[3]).forEach(function (f) { t[f] = d[3][f]; });
    Rules.UNIT_TYPES[k] = t;
    var note = t.ranged ? "ranged " + t.ranged + " · range " + t.range : t.naval ? "strength " + t.strength + (t.cargo ? " · carries " + t.cargo : "") : "strength " + t.strength;
    Rules.BUILDS[k] = { name: d[0], cost: d[1], unit: k, minPop: 1, popCost: 0, tech: d[2], note: note };
  });

  // Upgrade lines (best last) and when the old unit stops being buildable.
  var LINES = [
    ["warrior", "spearman", "swordsman", "pikeman", "musketman", "rifleman", "infantry"],
    ["horseman", "knight", "tank", "modern_armor"],
    ["archer", "composite_bowman", "crossbowman", "cannon", "artillery", "rocket_artillery"],
    ["catapult", "cannon"],
    ["trireme", "caravel", "frigate", "ironclad", "destroyer", "missile_cruiser"],
    ["battleship", "missile_cruiser"]
  ];
  var OBSOLETE = { warrior: "feudalism", spearman: "feudalism", swordsman: "gunpowder", pikeman: "gunpowder", musketman: "rifling",
    rifleman: "replaceable_parts", horseman: "chivalry", knight: "motorized", tank: "robotics", archer: "machinery", composite_bowman: "machinery",
    crossbowman: "rifling", catapult: "metallurgy", cannon: "ballistics", artillery: "rocketry", trireme: "astronomy", caravel: "steam_power",
    frigate: "combustion", ironclad: "combustion", destroyer: "guided_missiles", battleship: "guided_missiles" };
  LINES.forEach(function (line) {
    line.forEach(function (u, i) {
      var later = line.slice(i + 1).reverse();
      Econ.UPGRADES[u] = (later.concat(Econ.UPGRADES[u] || [])).filter(function (x, j, a) { return a.indexOf(x) === j; });
    });
  });
  // Old entries listed swordsman before spearman; keep the stronger first.
  Econ.UPGRADES.warrior = ["infantry", "rifleman", "musketman", "pikeman", "swordsman", "spearman"];

  // ------------------------------------------------------------ buildings
  var BUILDINGS = {
    university:     ["University", 110, "education", "+3 science, +1 per 4 pop", 1],
    bank:           ["Bank", 120, "banking", "+25% gold", 0],
    factory:        ["Factory", 180, "industrialization", "+25% production", 3],
    hospital:       ["Hospital", 150, "medicine", "+2 food, pop cap +8", 2],
    stock_exchange: ["Stock Exchange", 200, "economics", "+25% gold", 2],
    research_lab:   ["Research Lab", 260, "computers", "+5 science, +1 per 3 pop", 3],
    stadium:        ["Stadium", 220, "mass_media", "+3 happiness", 3],
    spaceport:      ["Spaceport", 400, "space_flight", "space projects", 5],
    nuclear_plant:  ["Nuclear Plant", 300, "nuclear_fission", "+25% production (needs Uranium)", 3]
  };
  var MAINT = {};
  Object.keys(BUILDINGS).forEach(function (k) {
    var d = BUILDINGS[k];
    MAINT[k] = d[4];
    Rules.BUILDS[k] = { name: d[0], cost: d[1], building: k, minPop: k === "spaceport" ? 6 : 2, popCost: 0, tech: d[2], note: d[3] + (d[4] ? " · upkeep " + d[4] + " gold" : ""), maint: d[4] };
  });
  Happy.BUILDING_HAPPY.stadium = 3;

  // -------------------------------------------------------------- wonders
  var LATE_WONDERS = {
    notre_dame:         { name: "Notre Dame", cost: 280, tech: "theology", effect: "+4 happiness",
      flavor: "Light falls through a rose of coloured glass, and the whole city goes quiet beneath it." },
    sistine_chapel:     { name: "Sistine Chapel", cost: 360, tech: "acoustics", effect: "+2 happiness · golden ages give double",
      flavor: "Craning their necks, the faithful see the beginning of the world painted above them." },
    leonardos_workshop: { name: "Leonardo's Workshop", cost: 420, tech: "physics", effect: "Unit upgrades cost 75% less",
      flavor: "Notebooks of flying screws and walking bridges; a few of them even work." },
    eiffel_tower:       { name: "Eiffel Tower", cost: 560, tech: "industrialization", effect: "+3 happiness, +1 gold per city",
      flavor: "Critics called it a scandal of iron. Their grandchildren call it home." },
    hoover_dam:         { name: "Hoover Dam", cost: 760, tech: "electronics", effect: "+15% production in every city",
      flavor: "A wall of concrete holds back a river and sends its strength down the wires." },
    internet:           { name: "Internet", cost: 1000, tech: "computers", effect: "+3 science per city",
      flavor: "Every library in the world, in every home, arguing with itself at the speed of light." },
    apollo_program:     { name: "Apollo Program", cost: 1150, tech: "satellites", effect: "Space projects cost 25% less · reveals the world",
      flavor: "For a few minutes, everyone on the planet looks up at the same small shape." }
  };
  Object.keys(LATE_WONDERS).forEach(function (id) { Wonders.addWonder(id, LATE_WONDERS[id]); });

  // ------------------------------------------------------------- projects
  var PROJECTS = {
    expedition:       { name: "Grand Expedition", cost: 180, tech: "astronomy", effect: "Maps a far region and may find something", repeat: 30 },
    worlds_fair:      { name: "World's Fair", cost: 320, tech: "economics", effect: "Starts a golden age", repeat: 40 },
    orbital_satellite:{ name: "Orbital Satellite", cost: 450, tech: "satellites", effect: "Reveals the world, +2 science per city", space: true },
    lunar_base:       { name: "Lunar Base", cost: 700, tech: "lunar_colonization", effect: "+12 science", space: true, needs: ["spaceport"] },
    colony_ship:      { name: "Colony Ship", cost: 1200, tech: "interstellar_navigation", effect: "Launches a colony to the stars", space: true, needs: ["spaceport"], after: "lunar_base" }
  };
  Object.keys(PROJECTS).forEach(function (id) {
    var p = PROJECTS[id];
    Rules.BUILDS["p_" + id] = { name: p.name, cost: p.cost, building: "p_" + id, minPop: 1, popCost: 0, tech: p.tech, note: "Project: " + p.effect, project: id };
  });

  // ---------------------------------------------------------------- techs
  var ERA_DATA = [
    { name: "Medieval", cost: 150, techs: [
      ["theology", "Theology", 150, ["philosophy", "mysticism"], { wonders: ["notre_dame"] }],
      ["civil_service", "Civil Service", 150, ["literature", "currency"], { bonus: { gold: 1 } }],
      ["feudalism", "Feudalism", 150, ["construction", "bronze_working"], { units: ["pikeman"] }],
      ["machinery", "Machinery", 160, ["engineering"], { units: ["crossbowman"] }],
      ["chivalry", "Chivalry", 170, ["feudalism", "animal_husbandry"], { units: ["knight"] }],
      ["education", "Education", 180, ["theology", "civil_service"], { buildings: ["university"] }],
      ["guilds", "Guilds", 175, ["currency", "machinery"], { bonus: { prod: 1 } }]
    ] },
    { name: "Renaissance", techs: [
      ["astronomy", "Astronomy", 240, ["education", "navigation"], { units: ["frigate"], projects: ["expedition"] }],
      ["banking", "Banking", 240, ["guilds", "education"], { buildings: ["bank"] }],
      ["printing_press", "Printing Press", 250, ["education", "machinery"], { bonus: { sci: 1 } }],
      ["gunpowder", "Gunpowder", 260, ["machinery", "chivalry"], { units: ["musketman"] }],
      ["acoustics", "Acoustics", 270, ["printing_press", "theology"], { wonders: ["sistine_chapel"] }],
      ["metallurgy", "Metallurgy", 280, ["gunpowder"], { units: ["cannon"] }],
      ["physics", "Physics", 290, ["astronomy", "printing_press"], { wonders: ["leonardos_workshop"] }]
    ] },
    { name: "Industrial", techs: [
      ["steam_power", "Steam Power", 380, ["physics", "metallurgy"], { units: ["ironclad"] }],
      ["rifling", "Rifling", 380, ["gunpowder", "metallurgy"], { units: ["rifleman"] }],
      ["economics", "Economics", 390, ["banking", "printing_press"], { buildings: ["stock_exchange"], projects: ["worlds_fair"] }],
      ["scientific_theory", "Scientific Theory", 400, ["physics", "acoustics"], { bonus: { sci: 2 } }],
      ["industrialization", "Industrialization", 430, ["steam_power", "economics"], { buildings: ["factory"], wonders: ["eiffel_tower"] }],
      ["railroad", "Railroad", 420, ["steam_power"], { bonus: { prod: 1 }, note: "Railways: +1 production per city" }],
      ["medicine", "Medicine", 440, ["scientific_theory"], { buildings: ["hospital"] }]
    ] },
    { name: "Modern", techs: [
      ["electricity", "Electricity", 580, ["scientific_theory", "industrialization"], { bonus: { sci: 1, prod: 1 } }],
      ["replaceable_parts", "Replaceable Parts", 600, ["industrialization", "rifling"], { units: ["infantry", "transport"] }],
      ["ballistics", "Ballistics", 600, ["replaceable_parts", "metallurgy"], { units: ["artillery"] }],
      ["combustion", "Combustion", 620, ["railroad", "electricity"], { units: ["destroyer"] }],
      ["steel", "Steel", 640, ["railroad", "electricity"], { units: ["battleship"] }],
      ["electronics", "Electronics", 660, ["electricity"], { wonders: ["hoover_dam"] }],
      ["refrigeration", "Refrigeration", 680, ["electricity", "medicine"], { bonus: { food: 2 } }],
      ["mass_media", "Mass Media", 700, ["electronics", "economics"], { buildings: ["stadium"] }],
      ["radio", "Radio", 650, ["electricity"], { note: "Anti-Aircraft Gun · cities +25% vs air" }],
      ["flight", "Flight", 680, ["combustion", "scientific_theory"], { note: "Fighter · Bomber (air units)" }]
    ] },
    { name: "Information", techs: [
      ["computers", "Computers", 850, ["electronics", "mass_media"], { buildings: ["research_lab"], wonders: ["internet"] }],
      ["motorized", "Motorized Warfare", 860, ["combustion", "replaceable_parts"], { units: ["tank"] }],
      ["rocketry", "Rocketry", 880, ["ballistics", "electronics"], { units: ["rocket_artillery"] }],
      ["nuclear_fission", "Nuclear Fission", 920, ["electricity", "rocketry"], { buildings: ["nuclear_plant"], bonus: { prod: 2 }, note: "Nuclear power" }],
      ["telecommunications", "Telecommunications", 940, ["computers"], { bonus: { sci: 2 } }],
      ["robotics", "Robotics", 980, ["computers", "motorized"], { units: ["modern_armor"] }],
      ["guided_missiles", "Guided Missiles", 1000, ["rocketry", "steel"], { units: ["missile_cruiser"] }],
      ["radar", "Radar", 900, ["flight", "radio"], { note: "Jet Fighter · Carrier" }],
      ["combined_arms", "Combined Arms", 960, ["radar", "motorized"], { note: "Helicopter Gunship" }]
    ] },
    { name: "Space", techs: [
      ["satellites", "Satellites", 1200, ["rocketry", "computers"], { projects: ["orbital_satellite"], wonders: ["apollo_program"] }],
      ["space_flight", "Space Flight", 1260, ["satellites", "robotics"], { buildings: ["spaceport"] }],
      ["advanced_materials", "Advanced Materials", 1300, ["space_flight", "nuclear_fission"], { bonus: { prod: 2 } }],
      ["lunar_colonization", "Lunar Colonization", 1360, ["space_flight"], { projects: ["lunar_base"] }],
      ["fusion", "Fusion Power", 1420, ["advanced_materials", "telecommunications"], { bonus: { sci: 3 } }],
      ["cryogenics", "Cryogenics", 1480, ["lunar_colonization", "fusion"], { bonus: { food: 1 } }],
      ["stealth", "Stealth", 1340, ["radar", "advanced_materials"], { note: "Stealth Bomber" }],
      ["interstellar_navigation", "Interstellar Navigation", 1600, ["cryogenics"], { projects: ["colony_ship"], note: "The end of the tree: the stars (galaxy.js)" }]
    ] }
  ];

  // The two original eras keep their authored positions; mark their techs.
  Tech.ERAS[1].cols = [3, 4, 5];
  Tech.TECH_ORDER.forEach(function (id) { Tech.TECHS[id].era = Tech.TECHS[id].col <= 2 ? 0 : 1; });
  var BONUS = {};
  var nextCol = 6;
  ERA_DATA.forEach(function (era, ei) {
    var idx = ei + 2, depth = {}, perCol = {};
    era.techs.forEach(function (row) {
      var d = 0;
      row[3].forEach(function (r) { if (depth[r] != null) d = Math.max(d, depth[r] + 1); });
      depth[row[0]] = d;
    });
    var cols = 0;
    era.techs.forEach(function (row) { cols = Math.max(cols, depth[row[0]] + 1); });
    era.techs.forEach(function (row) {
      var c = depth[row[0]], n = (perCol[c] = (perCol[c] || 0) + 1) - 1;
      var count = era.techs.filter(function (x) { return depth[x[0]] === c; }).length;
      var u = row[4] || {};
      var bits = [];
      (u.units || []).forEach(function (k) { bits.push(Rules.UNIT_TYPES[k].name); });
      (u.buildings || []).forEach(function (k) { bits.push(BUILDINGS[k][0] + " (" + BUILDINGS[k][3] + ")"); });
      (u.wonders || []).forEach(function (k) { bits.push(LATE_WONDERS[k].name); });
      (u.projects || []).forEach(function (k) { bits.push(PROJECTS[k].name); });
      if (u.bonus) bits.push(Object.keys(u.bonus).map(function (y) { return "+" + u.bonus[y] + " " + (y === "sci" ? "science" : y === "prod" ? "production" : y); }).join(", ") + " per city");
      if (u.note && !u.bonus) bits.push(u.note);
      Tech.TECHS[row[0]] = { name: row[1], col: nextCol + c, row: (n + (4 - count) / 2) * 1.05, cost: row[2], requires: row[3], effect: bits.join(" · "), era: idx };
      Tech.TECH_ORDER.push(row[0]);
      if (u.bonus) BONUS[row[0]] = u.bonus;
    });
    var colList = [];
    for (var i = 0; i < cols; i++) colList.push(nextCol + i);
    Tech.ERAS.push({ name: era.name, cols: colList });
    nextCol += cols;
  });
  // Era flavour for the era card.
  var ERA_LINES = [
    "Fire, clay and the first stories told around them.",
    "Roads of stone, laws carved on pillars, and the first philosophers asking why.",
    "Castles rise on the hills; bells mark the hours and the faithful count the days.",
    "Ink and lenses: the world is measured, printed and argued over.",
    "Smoke over the cities and iron on the rails; the old pace of life is gone for good.",
    "Wires hum under every street. Distances shrink and wars grow vast.",
    "Thinking machines and a world that never sleeps or forgets.",
    "The sky is no longer a ceiling. Somewhere out there, the next chapter waits."
  ];
  Tech.ERAS.forEach(function (e, i) { e.line = ERA_LINES[i] || ""; });

  // ------------------------------------------------------------- state
  function state(game) {
    var s = game.eras || (game.eras = {});
    // Start from what each civ already knows (an old save gets no era cards for its past).
    if (!s.civ) s.civ = game.civs.map(function (c, i) { return eraOf(game, i); });
    while (s.civ.length < game.civs.length) s.civ.push(eraOf(game, s.civ.length));
    if (!s.projects) s.projects = {};
    if (!s.launched) s.launched = [];
    return s;
  }
  function eraOf(game, cid) {
    var t = Tech.techOf(game, cid);
    if (!t) return 0;
    var counts = {};
    t.done.forEach(function (id) { var e = Tech.TECHS[id].era || 0; counts[e] = (counts[e] || 0) + 1; });
    var best = 0;
    Object.keys(counts).forEach(function (e) { if (counts[e] >= 2 && +e > best) best = +e; });
    return best;
  }
  function eraName(i) { return (Tech.ERAS[i] || Tech.ERAS[0]).name; }

  // Calendar: [turns, years per turn]; the last rate runs forever.
  var CALENDAR = [[75, 40], [60, 25], [50, 20], [50, 10], [40, 5], [50, 2], [Infinity, 1]];
  function yearOf(turn) {
    var y = -4000, t = turn;
    for (var i = 0; i < CALENDAR.length && t > 0; i++) {
      var n = Math.min(t, CALENDAR[i][0]);
      y += n * CALENDAR[i][1]; t -= n;
    }
    return y;
  }
  function yearsPerTurn(turn) {
    var t = turn;
    for (var i = 0; i < CALENDAR.length; i++) { if (t < CALENDAR[i][0]) return CALENDAR[i][1]; t -= CALENDAR[i][0]; }
    return 1;
  }
  Rules.setCalendar(function (turn) { var y = yearOf(turn); return y < 0 ? (-y) + " BC" : (y === 0 ? 1 : y) + " AD"; });

  function has(c, b) { return (c.buildings || []).indexOf(b) !== -1; }
  function owned(game, cid, w) { return Wonders.owned(game, cid, w); }
  function projectDone(game, cid, id) { var p = state(game).projects[cid]; return p && p[id] != null ? p[id] : null; }

  function revealAll(game, cid) { game.tiles.forEach(function (t) { game.civs[cid].revealed.add(Rules.key(t.q, t.r)); }); }
  function hs(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function completeProject(game, city, id, events) {
    var cid = city.owner, st = state(game), p = PROJECTS[id];
    (st.projects[cid] || (st.projects[cid] = {}))[id] = game.turn;
    var who = Rules.civName(game, cid);
    var text = who + " completed the " + p.name + " in " + city.name;
    if (id === "expedition") {
      // A far region: the land tile furthest from the capital among a seeded sample.
      var best = null, bd = -1;
      for (var i = 0; i < 40; i++) {
        var t = game.tiles[hs(game.seed + "|exp|" + cid + "|" + game.turn + "|" + i) % game.tiles.length];
        if (Rules.isWater(t)) continue;
        var d = Rules.hexDistance(t.q, t.r, city.q, city.r);
        if (d > bd && !game.civs[cid].revealed.has(Rules.key(t.q, t.r))) { bd = d; best = t; }
      }
      if (best) Rules.tilesInRadius(game, best.q, best.r, 8).forEach(function (t) { game.civs[cid].revealed.add(Rules.key(t.q, t.r)); });
      game.civs[cid].gold += 40;
      text += ": a far coast is mapped and 40 gold of curiosities brought home";
      if (root.PlanetStory) root.PlanetStory.signal(game, cid, "expedition", { city: city.id });
    }
    if (id === "worlds_fair" && root.PlanetStory) root.PlanetStory.startAge(game, cid, "golden", 10, "the World's Fair");
    if (id === "orbital_satellite") revealAll(game, cid);
    if (id === "colony_ship") {
      var rec = { civ: cid, turn: game.turn, year: yearOf(game.turn), city: city.id, cityName: city.name, civName: who };
      st.launched.push(rec);
      text = "The Colony Ship lifts off from " + city.name + ". " + who + " has opened the road to the stars";
      if (root.PlanetGalaxy) root.PlanetGalaxy.onLaunch(game, cid, rec);
      if (root.PlanetStory) root.PlanetStory.signal(game, cid, "launch", { city: city.id });
    }
    events.push({ kind: "project", text: text, cid: cid, project: id, city: city.id });
    if (cid !== 0) Rules.logEvent(game, "wonder", text, root.PlanetDiplomacy && root.PlanetDiplomacy.met(game, 0, cid) ? 0 : null);
  }

  function aiProjectScore(game, city, key) {
    var b = Rules.BUILDS[key], cs = Rules.citiesOf(game, city.owner);
    // Space projects go wherever the Spaceport is (canBuild checks it).
    if (PROJECTS[b.project].space) return 6;
    var top = cs.slice().sort(function (a, c) { return c.pop - a.pop || a.id - c.id; })[0];
    if (top !== city) return 0;
    return game.civs[city.owner].gold > 300 ? 2.5 : 1.2;
  }

  function maintenance(game, cid) {
    var n = 0;
    Rules.citiesOf(game, cid).forEach(function (c) { (c.buildings || []).forEach(function (b) { n += MAINT[b] || 0; }); });
    return n;
  }

  function makeModifiers(game, cid) {
    return {
      canBuild: function (key, city) {
        var b = Rules.BUILDS[key];
        if (!b || !city) return true;
        if (b.unit && OBSOLETE[b.unit] && Tech.has(game, OBSOLETE[b.unit], city.owner)) return false;
        // One Spaceport per civ is enough.
        if (key === "spaceport" && game.cities.some(function (o) { return o.owner === city.owner && o !== city && (has(o, "spaceport") || o.build === "spaceport"); })) return false;
        if (b.project) {
          var p = PROJECTS[b.project];
          var done = projectDone(game, city.owner, b.project);
          if (p.space && done != null) return false;
          if (p.repeat && done != null && game.turn - done < p.repeat) return false;
          if ((p.needs || []).some(function (n) { return !has(city, n); })) return false;
          if (p.after && projectDone(game, city.owner, p.after) == null) return false;
          // One city at a time per project.
          if (game.cities.some(function (o) { return o !== city && o.owner === city.owner && o.build === key; })) return false;
        }
        return true;
      },
      buildCost: function (build, cost) {
        var b = Rules.BUILDS[build];
        if (b && b.project && PROJECTS[b.project].space && owned(game, cid, "apollo_program")) return Math.round(cost * 0.75);
        return cost;
      },
      cityYield: function (c, y) {
        Tech.techOf(game, cid).done.forEach(function (id) {
          var bo = BONUS[id];
          if (bo) { y.food += bo.food || 0; y.prod += bo.prod || 0; y.gold += bo.gold || 0; }
        });
        if (has(c, "factory")) y.prod += Math.max(1, Math.floor(y.prod * 0.25));
        if (has(c, "nuclear_plant")) y.prod += Math.max(1, Math.floor(y.prod * 0.25));
        if (owned(game, cid, "hoover_dam")) y.prod += Math.max(1, Math.floor(y.prod * 0.15));
        if (has(c, "bank")) y.gold += Math.max(1, Math.floor(y.gold * 0.25));
        if (has(c, "stock_exchange")) y.gold += Math.max(1, Math.floor(y.gold * 0.25));
        if (has(c, "hospital")) y.food += 2;
        if (owned(game, cid, "eiffel_tower")) y.gold += 1;
        (c.buildings || []).forEach(function (b) { y.gold -= MAINT[b] || 0; });
        return y;
      },
      cityScience: function (c) {
        var s = 0;
        Tech.techOf(game, cid).done.forEach(function (id) { if (BONUS[id]) s += BONUS[id].sci || 0; });
        if (has(c, "university")) s += 3 + Math.floor(c.pop / 4);
        if (has(c, "research_lab")) s += 5 + Math.floor(c.pop / 3);
        if (owned(game, cid, "internet")) s += 3;
        if (projectDone(game, cid, "orbital_satellite") != null) s += 2;
        if (projectDone(game, cid, "lunar_base") != null && c.capital) s += 12;
        return s;
      },
      onEndTurn: function (g, events, sci, c) {
        Rules.citiesOf(g, c).forEach(function (city) {
          (city.buildings || []).filter(function (b) { return b.indexOf("p_") === 0; }).forEach(function (b) {
            city.buildings = city.buildings.filter(function (x) { return x !== b; });
            completeProject(g, city, b.slice(2), events);
          });
        });
        var st = state(g), now = eraOf(g, c);
        if (now > st.civ[c]) {
          var from = st.civ[c];
          st.civ[c] = now;
          events.push({ kind: "era", text: Rules.civName(g, c) + " enters the " + eraName(now) + " Era", cid: c, era: now, from: from });
          if (c !== 0 && root.PlanetDiplomacy && root.PlanetDiplomacy.met(g, 0, c)) Rules.logEvent(g, "info", Rules.civName(g, c) + " has entered the " + eraName(now) + " Era", 0);
        }
        if (owned(g, c, "apollo_program") && !st.apolloSeen) { st.apolloSeen = true; revealAll(g, c); }
      }
    };
  }

  Happy.addSource(function (game, cid) {
    var out = [];
    if (owned(game, cid, "notre_dame")) out.push({ key: "notre_dame", name: "Notre Dame", n: 1, v: 4 });
    if (owned(game, cid, "sistine_chapel")) out.push({ key: "sistine", name: "Sistine Chapel", n: 1, v: 2 });
    if (owned(game, cid, "eiffel_tower")) out.push({ key: "eiffel", name: "Eiffel Tower", n: 1, v: 3 });
    return out;
  });

  root.PlanetEras = {
    ERA_DATA: ERA_DATA, UNITS: UNITS, BUILDINGS: BUILDINGS, PROJECTS: PROJECTS, LATE_WONDERS: LATE_WONDERS, LINES: LINES, OBSOLETE: OBSOLETE,
    MAINT: MAINT, BONUS: BONUS, CALENDAR: CALENDAR, state: state, eraOf: eraOf, eraName: eraName, yearOf: yearOf, yearsPerTurn: yearsPerTurn,
    projectDone: projectDone, maintenance: maintenance, aiProjectScore: aiProjectScore, completeProject: completeProject, makeModifiers: makeModifiers
  };
})(typeof window !== "undefined" ? window : globalThis);
