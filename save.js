/*
 * save.js — SAVE AND CONTINUE.
 * No DOM except the optional file download/upload helpers at the bottom.
 * A save is plain JSON:
 *   { version, savedAt, seed, mapHash, civ, camera, game: PlanetGame.exportState(game) }
 * The map is never stored: load() regenerates it from the seed and compares
 * mapHash, so a changed generator is detected (warning, not a hard failure).
 * The game holds no RNG state: generation, starts and the AI use seeded
 * hashes and the rules are deterministic, so the seed plus this state is
 * everything (all civs, AI plans on units, diplomacy, memory, event log).
 *
 * Versions: 1 = single civ (slice 5). 2 = civs[] with owners, AI, diplomacy.
 *           3 = combat (unit/city hp, fortify, capitals, eliminations), unit memory.
 *           4 = ships (unit.aboard, ship missions), capitals relocate instead of eliminating.
 *           5 = map size, roads, farms/mines, worker jobs, unrest, city strikes, save slots.
 */
(function (root) {
  "use strict";

  var VERSION = 12;
  var KEY = "civPlanet.save";

  // FNV-1a over the parts of each tile the rules depend on.
  // The map size is part of the fingerprint (left out for Standard, so v1-v4 hashes still match).
  var LATE = { coal: 1, aluminum: 1, uranium: 1 };
  function mapHash(tiles, size) {
    var h = 2166136261;
    function mix(str) {
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    }
    if (size && size !== "standard") mix("size:" + size + ";");
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      // Late strategic deposits (slice 15) are left out so older saves keep their hash.
      var res = t.resource && !(LATE[t.resource]) ? t.resource : "";
      mix(t.q + "," + t.r + t.biome + (t.river > 0 ? Math.round(t.river) : 0) + res + ";");
    }
    return ("0000000" + (h >>> 0).toString(16)).slice(-8);
  }

  // v1 -> v2: the single civ becomes civs[0]; everything it owned gets owner 0.
  // A v1 game has no rivals, so it continues as a solo game.
  function v1to2(data) {
    var g = data.game || {};
    var civ0 = {
      id: 0, design: data.civ || null, ai: false,
      gold: g.gold || 0, science: g.science || 0, tech: g.tech || null,
      cityNames: g.cityNames || (data.civ && data.civ.cityNames) || null,
      memory: null, ai_state: null, revealed: g.revealed || []
    };
    data.game = {
      seed: g.seed != null ? g.seed : data.seed, turn: g.turn || 0, nextId: g.nextId || 1,
      suggested: g.suggested || null, diplo: { pairs: {} }, log: [],
      civs: [civ0],
      cities: (g.cities || []).map(function (c) {
        c.owner = 0;
        if (c.repeat == null) c.repeat = true;     // v1 cities always repeated their build
        return c;
      }),
      units: (g.units || []).map(function (u) { u.owner = 0; return u; }),
      owner: g.owner || []
    };
    data.version = 2;
    return data;
  }

  // v2 -> v3: full health, nobody fortified, each civ's first city is its capital.
  function v2to3(data) {
    var g = data.game || {};
    (g.units || []).forEach(function (u) {
      if (u.hp == null) u.hp = 100;
      u.fort = !!u.fort; u.fortifying = !!u.fortifying; u.moved = !!u.moved;
    });
    var firstCity = {};
    (g.cities || []).slice().sort(function (a, b) { return (a.founded - b.founded) || (a.id - b.id); }).forEach(function (c) {
      if (firstCity[c.owner] == null) firstCity[c.owner] = c.id;
    });
    (g.cities || []).forEach(function (c) {
      if (c.hp == null) c.hp = 100;
      if (c.capital == null) c.capital = firstCity[c.owner] === c.id;
    });
    (g.civs || []).forEach(function (cv) {
      if (cv.eliminated == null) cv.eliminated = false;
      if (cv.lostCapital == null) cv.lostCapital = false;
      if (cv.memory && !cv.memory.units) cv.memory.units = {};
    });
    if (g.combatSeq == null) g.combatSeq = 0;
    if (g.startInfo === undefined) g.startInfo = null;
    data.version = 3;
    return data;
  }

  // v3 -> v4: nobody aboard a ship; every surviving civ with cities has exactly
  // one capital (its biggest city if it somehow had none). Civs eliminated
  // under the old capital rule stay eliminated.
  function v3to4(data) {
    var g = data.game || {};
    (g.units || []).forEach(function (u) { if (u.aboard === undefined) u.aboard = null; });
    (g.civs || []).forEach(function (cv, cid) {
      if (cv.eliminated) return;
      var cs = (g.cities || []).filter(function (c) { return c.owner === cid; });
      if (!cs.length || cs.some(function (c) { return c.capital; })) return;
      cs.sort(function (a, b) { return (b.pop - a.pop) || (a.founded - b.founded) || (a.id - b.id); });
      cs[0].capital = true;
    });
    data.version = 4;
    return data;
  }

  // v4 -> v5: Standard map (the only size before), no roads or improvements,
  // no unrest, no city strike used; a v4 save loads into the autosave slot.
  function v4to5(data) {
    var g = data.game || {};
    data.size = data.size || g.size || "standard";
    g.size = g.size || data.size;
    if (!g.roads) g.roads = {};
    if (!g.improvements) g.improvements = {};
    (g.cities || []).forEach(function (c) { if (c.unrest == null) c.unrest = false; if (c.struck == null) c.struck = -1; });
    (g.units || []).forEach(function (u) { if (u.work === undefined) u.work = null; });
    if (data.slot == null) data.slot = 0;
    data.version = 5;
    return data;
  }

  // v5 -> v6: no paused worker jobs, no trade routes, units without a home
  // city (caravans built before v6 fall back to the nearest city).
  function v5to6(data) {
    var g = data.game || {};
    if (!g.jobs) g.jobs = {};
    if (!g.trade) g.trade = { routes: [], nextId: 1 };
    (g.units || []).forEach(function (u) {
      if (u.home === undefined) u.home = null;
      if (u.work && u.work.total == null) u.work.total = u.work.left;
    });
    data.version = 6;
    return data;
  }

  // v6 -> v7: no deals, pacts, memories or wonders yet; existing units aren't veterans.
  function v6to7(data) {
    var g = data.game || {};
    if (!g.deals) g.deals = { active: [], pending: [], nextId: 1, stats: { deals: 0, gifts: 0, demands: 0, tribute: 0, refused: 0, techSales: 0, luxDeals: 0, offers: 0, helpAsked: 0, helpJoined: 0 }, last: {}, ver: 0 };
    if (!g.wonders) g.wonders = {};
    if (g.diplo) {
      if (!g.diplo.asks) g.diplo.asks = [];
      Object.keys(g.diplo.pairs || {}).forEach(function (k) { var r = g.diplo.pairs[k]; if (!r.mem) r.mem = []; if (!r.pact) r.pact = {}; });
    }
    (g.units || []).forEach(function (u) { if (u.vet === undefined) u.vet = false; });
    data.version = 7;
    return data;
  }

  // Upgrade older saves step by step to VERSION.
  // v7 -> v8: eras, story and galaxy state are new. They stay empty here and are
  // built on load: eras from known techs (no era cards for the past), the
  // story with freshly seeded anomalies away from cities and units.
  function v7to8(data) {
    var g = data.game || {};
    if (g.eras === undefined) g.eras = null;
    if (g.story === undefined) g.story = null;
    if (g.galaxy === undefined) g.galaxy = null;
    data.version = 8;
    return data;
  }

  // v8 -> v9: war score, treaties and truces (peace.js). Ongoing wars get a
  // fresh tally on load (score starts from relative strength only).
  function v8to9(data) {
    var g = data.game || {};
    if (g.peace === undefined) g.peace = null;
    data.version = 9;
    return data;
  }
  // v9 -> v10 (slice 15, pass A): strategic resources, air power, XP and
  // promotions, orders and naval AI state. The old veteran flag becomes 10 XP
  // (one promotion's worth); units get no orders.
  function v9to10(data) {
    var g = data.game || {};
    ["strategic", "air", "promo", "navalai"].forEach(function (k) { if (g[k] === undefined) g[k] = null; });
    (g.units || []).forEach(function (u) {
      if (u.xp === undefined) u.xp = u.vet ? 10 : 0;
      delete u.vet;
      if (u.promos === undefined) u.promos = [];
      if (u.goto === undefined) u.goto = null;
      if (u.order === undefined) u.order = null;
    });
    data.version = 10;
    return data;
  }
  // v10 -> v11 (slice 15, pass B): governments (everyone starts in Despotism,
  // no anarchy, no policies), faith, religions and ideologies (none yet).
  function v10to11(data) {
    var g = data.game || {};
    if (g.gov === undefined) g.gov = null;
    if (g.religion === undefined) g.religion = null;
    (g.cities || []).forEach(function (c) { if (c.rel === undefined) c.rel = null; if (c.relp === undefined) c.relp = {}; });
    data.version = 11;
    return data;
  }
  // v12 (slice 16): pillaged tiles and pillage/plunder stats.
  function v11to12(data) {
    var g = data.game || {};
    if (g.pillage === undefined) g.pillage = null;
    if (g.aitune === undefined) g.aitune = null;
    data.version = 12;
    return data;
  }
  function migrate(data) {
    if (!data || typeof data !== "object") throw new Error("Not a save file");
    if (data.version == null) data.version = 1;
    if (data.version > VERSION) throw new Error("Save is from a newer version (" + data.version + ")");
    if (data.version === 1) data = v1to2(data);
    if (data.version === 2) data = v2to3(data);
    if (data.version === 3) data = v3to4(data);
    if (data.version === 4) data = v4to5(data);
    if (data.version === 5) data = v5to6(data);
    if (data.version === 6) data = v6to7(data);
    if (data.version === 7) data = v7to8(data);
    if (data.version === 8) data = v8to9(data);
    if (data.version === 9) data = v9to10(data);
    if (data.version === 10) data = v10to11(data);
    if (data.version === 11) data = v11to12(data);
    return data;
  }

  function build(game, civ, camera) {
    return {
      version: VERSION,
      savedAt: new Date().toISOString(),
      seed: game.seed,
      size: game.size || "standard",
      mapHash: mapHash(game.tiles, game.size),
      civ: civ,
      camera: camera || null,
      game: root.PlanetGame.exportState(game)
    };
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  /*
   * Slots: 0 is the autosave (the original key, so old saves show up there),
   * 1..MANUAL_SLOTS are named manual saves.
   */
  var MANUAL_SLOTS = 5;
  var SLOT_PREFIX = "civPlanet.slot.";
  function slotKey(n) { return n ? SLOT_PREFIX + n : KEY; }

  function write(game, civ, camera, slot, name) {
    var ls = storage();
    if (!ls) return { ok: false, reason: "Storage unavailable" };
    slot = slot || 0;
    var data = build(game, civ, camera);
    data.slot = slot;
    data.name = String(name || (slot ? "Slot " + slot : "Autosave")).slice(0, 40);
    try { ls.setItem(slotKey(slot), JSON.stringify(data)); } catch (e) { return { ok: false, reason: "Storage full or blocked" }; }
    return { ok: true, data: data };
  }

  function readSlot(slot) {
    var ls = storage();
    if (!ls) return null;
    try {
      var raw = ls.getItem(slotKey(slot || 0));
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }

  // Every slot with its summary (null for empty slots), autosave first.
  function listSlots() {
    var out = [];
    for (var n = 0; n <= MANUAL_SLOTS; n++) {
      var d = readSlot(n);
      out.push({ slot: n, data: d, summary: d ? summary(d) : null });
    }
    return out;
  }

  // The most recently saved slot (what Continue loads).
  function latestSlot() {
    var best = null;
    listSlots().forEach(function (s) {
      if (s.data && (!best || String(s.data.savedAt || "") > String(best.data.savedAt || ""))) best = s;
    });
    return best ? best.slot : null;
  }

  function read() {
    var n = latestSlot();
    return n == null ? null : readSlot(n);
  }

  function deleteSlot(slot) { var ls = storage(); if (ls) ls.removeItem(slotKey(slot || 0)); }
  function clear() { deleteSlot(0); }

  // Short description for the welcome card.
  function summary(data) {
    if (!data) return null;
    var g = data.game;
    return {
      civ: data.civ, seed: data.seed, turn: g.turn,
      year: root.PlanetGame.yearLabel(g.turn),
      cities: g.cities.filter(function (c) { return (c.owner || 0) === 0; }).length,
      units: g.units.filter(function (u) { return (u.owner || 0) === 0; }).length,
      rivals: (g.civs || []).length - 1, savedAt: data.savedAt,
      size: data.size || g.size || "standard", name: data.name || (data.slot ? "Slot " + data.slot : "Autosave"), slot: data.slot || 0
    };
  }

  /*
   * Rebuild a game from a save. generate(seed) gives the world; setup is the
   * same { modifiers, cityNames } newGame takes. Returns { game, world, warning }.
   */
  function load(data, generate, setup) {
    data = migrate(data);
    var world = generate(data.seed, data.size || (data.game && data.game.size) || "standard");
    var hash = mapHash(world.tiles, world.size);
    var warning = hash === data.mapHash ? null :
      "Map hash mismatch (" + hash + " vs saved " + data.mapHash + "): the generator changed, so the map may differ.";
    var game = root.PlanetGame.importState(world, setup, data.game);
    return { game: game, world: world, warning: warning };
  }

  // ---- Optional file export/import (browser only).
  function download(data) {
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "planet-" + (data.civ && data.civ.name || "save").replace(/[^\w-]+/g, "_") + "-t" + data.game.turn + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function parseFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      try { cb(null, migrate(JSON.parse(fr.result))); } catch (e) { cb(e); }
    };
    fr.onerror = function () { cb(fr.error || new Error("Could not read file")); };
    fr.readAsText(file);
  }

  root.PlanetSave = {
    VERSION: VERSION, KEY: KEY, MANUAL_SLOTS: MANUAL_SLOTS, readSlot: readSlot, listSlots: listSlots,
    latestSlot: latestSlot, deleteSlot: deleteSlot,
    mapHash: mapHash, migrate: migrate, build: build,
    write: write, read: read, clear: clear, summary: summary, load: load,
    download: download, parseFile: parseFile
  };
})(typeof window !== "undefined" ? window : globalThis);
