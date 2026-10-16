/*
 * civ.js — CIVILIZATION DEFINITION AND TRAIT RULES.
 * No DOM. A civ is a plain object (see DEFAULT_CIV). makeModifiers(civ)
 * turns its traits and start preference into the small hook object that
 * game.js calls (tileYield, buildCost, unitMoves, growthNeed, cityScience,
 * startUnits, siteScore). Add a trait by adding an entry to TRAITS.
 * Emblems are canvas draw functions in a unit box, usable anywhere.
 */
(function (root) {
  "use strict";

  var PALETTE = [
    { id: "crimson",  hex: "#a8322b", name: "Crimson" },
    { id: "cobalt",   hex: "#2f5fa8", name: "Cobalt" },
    { id: "emerald",  hex: "#2e8a57", name: "Emerald" },
    { id: "saffron",  hex: "#d9a520", name: "Saffron" },
    { id: "teal",     hex: "#1f8a8a", name: "Teal" },
    { id: "ember",    hex: "#d2672e", name: "Ember" },
    { id: "plum",     hex: "#6e3b8f", name: "Plum" },
    { id: "rose",     hex: "#c45c86", name: "Rose" },
    { id: "ivory",    hex: "#efe6cf", name: "Ivory" },
    { id: "basalt",   hex: "#262b31", name: "Basalt" }
  ];

  // Emblems draw centred at (x, y) inside a circle of radius s, filled with `color`.
  function star(ctx, x, y, s, points, inner) {
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var r = i % 2 ? s * inner : s;
      var a = -Math.PI / 2 + i * Math.PI / points;
      if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  }

  var EMBLEMS = {
    sun: { name: "Sun", draw: function (ctx, x, y, s, c) {
      ctx.fillStyle = c;
      star(ctx, x, y, s * 0.95, 12, 0.66);
      ctx.fill();
    } },
    moon: { name: "Crescent", draw: function (ctx, x, y, s, c) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.8, Math.PI * 0.3, Math.PI * 1.7, false);
      ctx.arc(x + s * 0.34, y - s * 0.06, s * 0.62, Math.PI * 1.62, Math.PI * 0.38, true);
      ctx.closePath();
      ctx.fill();
    } },
    star: { name: "Star", draw: function (ctx, x, y, s, c) {
      ctx.fillStyle = c;
      star(ctx, x, y + s * 0.06, s * 0.95, 5, 0.42);
      ctx.fill();
    } },
    tower: { name: "Tower", draw: function (ctx, x, y, s, c) {
      ctx.fillStyle = c;
      var w = s * 0.9, h = s * 1.5, top = y - h / 2, l = x - w / 2;
      ctx.beginPath();
      ctx.moveTo(l, y + h / 2);
      ctx.lineTo(l, top);
      var m = w / 5;
      for (var i = 0; i < 5; i++) {
        ctx.lineTo(l + m * i, top + (i % 2 ? s * 0.22 : 0));
        ctx.lineTo(l + m * (i + 1), top + (i % 2 ? s * 0.22 : 0));
      }
      ctx.lineTo(l + w, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y + h / 2 - s * 0.05, s * 0.2, Math.PI, 0);
      ctx.lineTo(x + s * 0.2, y + h / 2);
      ctx.lineTo(x - s * 0.2, y + h / 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    } },
    tree: { name: "Tree", draw: function (ctx, x, y, s, c) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.95);
      ctx.lineTo(x + s * 0.55, y - s * 0.2);
      ctx.lineTo(x + s * 0.3, y - s * 0.2);
      ctx.lineTo(x + s * 0.75, y + s * 0.45);
      ctx.lineTo(x - s * 0.75, y + s * 0.45);
      ctx.lineTo(x - s * 0.3, y - s * 0.2);
      ctx.lineTo(x - s * 0.55, y - s * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - s * 0.13, y + s * 0.4, s * 0.26, s * 0.5);
    } },
    wave: { name: "Wave", draw: function (ctx, x, y, s, c) {
      ctx.strokeStyle = c;
      ctx.lineWidth = s * 0.24;
      ctx.lineCap = "round";
      for (var row = -1; row <= 1; row += 2) {
        var yy = y + row * s * 0.32;
        ctx.beginPath();
        ctx.moveTo(x - s * 0.8, yy);
        ctx.bezierCurveTo(x - s * 0.5, yy - s * 0.4, x - s * 0.2, yy - s * 0.4, x, yy);
        ctx.bezierCurveTo(x + s * 0.2, yy + s * 0.4, x + s * 0.5, yy + s * 0.4, x + s * 0.8, yy);
        ctx.stroke();
      }
    } },
    peaks: { name: "Peaks", draw: function (ctx, x, y, s, c) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.95, y + s * 0.6);
      ctx.lineTo(x - s * 0.3, y - s * 0.75);
      ctx.lineTo(x + s * 0.05, y - s * 0.05);
      ctx.lineTo(x + s * 0.35, y - s * 0.45);
      ctx.lineTo(x + s * 0.95, y + s * 0.6);
      ctx.closePath();
      ctx.fill();
    } },
    crown: { name: "Crown", draw: function (ctx, x, y, s, c) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.8, y + s * 0.5);
      ctx.lineTo(x - s * 0.85, y - s * 0.5);
      ctx.lineTo(x - s * 0.42, y - s * 0.05);
      ctx.lineTo(x, y - s * 0.7);
      ctx.lineTo(x + s * 0.42, y - s * 0.05);
      ctx.lineTo(x + s * 0.85, y - s * 0.5);
      ctx.lineTo(x + s * 0.8, y + s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - s * 0.8, y + s * 0.6, s * 1.6, s * 0.22);
    } }
  };
  var EMBLEM_ORDER = ["sun", "moon", "star", "tower", "tree", "wave", "peaks", "crown"];

  /*
   * TRAITS. Each hook is optional:
   *   tileYield(tile, y, info) -> mutates/returns y   (info: { onRiver, nearRiver })
   *   buildCost(key, cost) -> cost
   *   unitMoves(type, moves) -> moves
   *   cityScience(city) -> extra science per turn
   *   startUnits() -> extra unit types at the start
   */
  var TRAITS = {
    agrarian: {
      name: "Agrarian", effect: "+1 food on grassland and plains",
      flavor: "Granaries before temples.",
      tileYield: function (t, y) { if (t.biome === "grassland" || t.biome === "plains") y.food += 1; return y; }
    },
    industrious: {
      name: "Industrious", effect: "+1 production on hills",
      flavor: "The hills ring with hammers.",
      tileYield: function (t, y) { if (t.biome === "hills") y.prod += 1; return y; }
    },
    seafaring: {
      name: "Seafaring", effect: "+1 food on coast · embark with Sailing · ships +1 move",
      flavor: "Nets out at first light.",
      tileYield: function (t, y) { if (t.biome === "coast") y.food += 1; return y; },
      unitMoves: function (type, moves) {
        var u = root.PlanetGame && root.PlanetGame.UNIT_TYPES[type];
        return u && u.naval ? moves + 1 : moves;
      },
      // With Sailing, land units may enter coast (not deep ocean) at cost 1.
      moveCost: function (t, cost, info) {
        return t.biome === "coast" && info && info.hasTech && info.hasTech("sailing") ? 1 : cost;
      }
    },
    expansionist: {
      name: "Expansionist", effect: "Settlers cost 20 instead of 30",
      flavor: "Over the next ridge, always.",
      buildCost: function (key, cost) { return key === "settler" ? Math.min(cost, 20) : cost; }
    },
    militaristic: {
      name: "Militaristic", effect: "Warriors cost 6 · start with a Warrior",
      flavor: "Every child learns the spear.",
      buildCost: function (key, cost) { return key === "warrior" ? Math.min(cost, 6) : cost; },
      startUnits: function () { return ["warrior"]; }
    },
    mercantile: {
      name: "Mercantile", effect: "+1 gold on river tiles",
      flavor: "Barges, tolls, and ledgers.",
      tileYield: function (t, y, info) { if (info.onRiver) y.gold += 1; return y; }
    },
    nomadic: {
      name: "Nomadic", effect: "+1 movement for all units",
      flavor: "Home is wherever the herd is.",
      unitMoves: function (type, m) { return m + 1; }
    },
    scholarly: {
      name: "Scholarly", effect: "+2 science per city each turn",
      flavor: "Star charts in every courtyard.",
      cityScience: function () { return 2; }
    }
  };
  var TRAIT_ORDER = ["agrarian", "industrious", "seafaring", "expansionist", "militaristic", "mercantile", "nomadic", "scholarly"];
  var TRAIT_COUNT = 2;

  var START_PREFS = {
    any:       { name: "Anywhere",  effect: "Best overall land" },
    temperate: { name: "Temperate", effect: "Grassland and plains heartland" },
    coastal:   { name: "Coastal",   effect: "On the sea" },
    river:     { name: "River",     effect: "On a river" },
    hills:     { name: "Hills",     effect: "On high ground" }
  };
  var START_PREF_ORDER = ["any", "temperate", "coastal", "river", "hills"];

  var DEFAULT_CITY_NAMES = [
    "Aster", "Brannock", "Calder", "Dunmere", "Elloran", "Fenwick",
    "Galeth", "Harrowgate", "Istrel", "Jorvane", "Kestrel", "Lornhal"
  ];

  var DEFAULT_CIV = {
    name: "Asteria",
    people: "Asterians",
    adjective: "Asterian",
    leaderTitle: "Queen",
    leaderName: "Ilsa",
    primary: "#a8322b",
    secondary: "#e3c06a",
    emblem: "sun",
    traits: ["agrarian", "mercantile"],
    startPref: "river",
    cityNames: DEFAULT_CITY_NAMES.slice()
  };

  // ------------------------------------------------------------ names

  var SYL_START = ["Ae", "Bel", "Cal", "Dor", "El", "Fen", "Gal", "Har", "Ith", "Jor", "Kae", "Lor", "Mar",
    "Nor", "Or", "Pel", "Quel", "Rhy", "Sar", "Tal", "Ul", "Val", "Wyn", "Xan", "Yr", "Zel", "Ost", "Myr", "Thal", "Ash"];
  var SYL_MID = ["a", "e", "i", "o", "ar", "en", "is", "or", "ul", "ae", "an", "el", "im", "on", "er"];
  var SYL_END = ["dor", "ra", "mir", "th", "vel", "nis", "gard", "lon", "ria", "the", "mos", "dun", "ven", "ath", "ora", "ys", "wen", "ost"];
  var LEADER_NAMES_A = ["Ilsa", "Oren", "Maelis", "Tavor", "Seren", "Corwin", "Ysolde", "Bram", "Nerys", "Eamon",
    "Liora", "Daven", "Ottilie", "Rurik", "Saphra", "Theon", "Velka", "Idris"];
  var TITLES = ["Queen", "King", "Chancellor", "Overseer", "High Priestess", "Consul", "Matriarch", "Archon", "Warden", "Khan", "First Speaker"];

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  function makeName(rng, minSyl) {
    var n = pick(rng, SYL_START);
    var mids = (minSyl || 0) + Math.floor(rng() * 2);
    for (var i = 0; i < mids; i++) n += pick(rng, SYL_MID);
    n += pick(rng, SYL_END);
    return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  }

  // Derive "Asterians" / "Asterian" from "Asteria", "Velmorans" from "Velmora", "Kaedorians" from "Kaedor".
  function deriveDemonyms(name) {
    var base = String(name || "").trim();
    if (!base) return { people: "", adjective: "" };
    var adj;
    if (/ia$/i.test(base)) adj = base + "n";
    else if (/[aeiouy]$/i.test(base)) adj = base.replace(/[aeiouy]$/i, "") + "an";
    else adj = base + "ian";
    return { people: adj + "s", adjective: adj };
  }

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomCiv(rngOrSeed) {
    var rng = typeof rngOrSeed === "function" ? rngOrSeed
      : mulberry(rngOrSeed == null ? (Math.random() * 4294967296) >>> 0 : rngOrSeed);
    var name = makeName(rng, 0);
    var d = deriveDemonyms(name);
    var p = Math.floor(rng() * PALETTE.length);
    var sOpts = PALETTE.filter(function (c, i) { return i !== p && contrast(PALETTE[p].hex, c.hex) > 2.2; });
    var traits = TRAIT_ORDER.slice();
    var chosen = [];
    while (chosen.length < TRAIT_COUNT) chosen.push(traits.splice(Math.floor(rng() * traits.length), 1)[0]);
    var cities = [];
    var guard = 0;
    while (cities.length < 12 && guard++ < 200) {
      var cn = makeName(rng, rng() < 0.5 ? 0 : 1);
      if (cn !== name && cities.indexOf(cn) === -1) cities.push(cn);
    }
    return {
      name: name,
      people: d.people,
      adjective: d.adjective,
      leaderTitle: pick(rng, TITLES),
      leaderName: pick(rng, LEADER_NAMES_A),
      primary: PALETTE[p].hex,
      secondary: pick(rng, sOpts).hex,
      emblem: pick(rng, EMBLEM_ORDER),
      traits: chosen,
      startPref: pick(rng, START_PREF_ORDER),
      cityNames: cities
    };
  }

  // ------------------------------------------------------------ colour helpers

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex) {
    var c = hexToRgb(hex) || [0, 0, 0];
    var l = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function shade(hex, f) {
    var c = hexToRgb(hex) || [128, 128, 128];
    return "#" + c.map(function (v) {
      var x = Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f);
      return ("0" + Math.max(0, Math.min(255, x)).toString(16)).slice(-2);
    }).join("");
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex) || [128, 128, 128];
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }
  // Text colour that reads on `bg`.
  function inkFor(bg) { return luminance(bg) > 0.35 ? "#1a1d21" : "#fbf3df"; }

  // ------------------------------------------------------------ validation

  function clean(str, max, fallback) {
    var s = String(str == null ? "" : str).replace(/\s+/g, " ").trim().slice(0, max);
    return s || fallback;
  }

  // Returns a complete, safe civ object (missing or bad fields fall back to defaults).
  function normalize(input) {
    var c = input || {};
    var d = DEFAULT_CIV;
    var name = clean(c.name, 28, d.name);
    var dem = deriveDemonyms(name);
    var traits = (Array.isArray(c.traits) ? c.traits : []).filter(function (t, i, arr) {
      return TRAITS[t] && arr.indexOf(t) === i;
    }).slice(0, TRAIT_COUNT);
    var names = (Array.isArray(c.cityNames) ? c.cityNames : String(c.cityNames || "").split(/\n|,/))
      .map(function (s) { return clean(s, 24, ""); })
      .filter(function (s, i, arr) { return s && arr.indexOf(s) === i; })
      .slice(0, 60);
    return {
      name: name,
      people: clean(c.people, 32, dem.people),
      adjective: clean(c.adjective, 28, dem.adjective),
      leaderTitle: clean(c.leaderTitle, 24, d.leaderTitle),
      leaderName: clean(c.leaderName, 28, d.leaderName),
      primary: hexToRgb(c.primary) ? String(c.primary).toLowerCase() : d.primary,
      secondary: hexToRgb(c.secondary) ? String(c.secondary).toLowerCase() : d.secondary,
      emblem: EMBLEMS[c.emblem] ? c.emblem : d.emblem,
      traits: traits,
      startPref: START_PREFS[c.startPref] ? c.startPref : "any",
      cityNames: names.length ? names : DEFAULT_CITY_NAMES.slice()
    };
  }

  function validate(civ) {
    var problems = [];
    if (!civ.traits || civ.traits.length !== TRAIT_COUNT) problems.push("Pick exactly " + TRAIT_COUNT + " traits");
    return problems;
  }

  // ------------------------------------------------------------ hooks for game.js

  function makeModifiers(input) {
    var civ = normalize(input);
    var list = civ.traits.map(function (k) { return TRAITS[k]; });
    var pref = civ.startPref;
    return {
      tileYield: function (tile, y, info) {
        for (var i = 0; i < list.length; i++) if (list[i].tileYield) y = list[i].tileYield(tile, y, info) || y;
        return y;
      },
      buildCost: function (key, cost) {
        for (var i = 0; i < list.length; i++) if (list[i].buildCost) cost = list[i].buildCost(key, cost);
        return cost;
      },
      unitMoves: function (type, moves) {
        for (var i = 0; i < list.length; i++) if (list[i].unitMoves) moves = list[i].unitMoves(type, moves);
        return moves;
      },
      growthNeed: function (pop, need) { return need; },
      moveCost: function (tile, cost, info) {
        for (var i = 0; i < list.length; i++) if (list[i].moveCost) cost = list[i].moveCost(tile, cost, info);
        return cost;
      },
      cityScience: function (city) {
        var s = 0;
        for (var i = 0; i < list.length; i++) if (list[i].cityScience) s += list[i].cityScience(city);
        return s;
      },
      startUnits: function () {
        var out = [];
        for (var i = 0; i < list.length; i++) if (list[i].startUnits) out = out.concat(list[i].startUnits());
        return out;
      },
      // info: { coastal, onRiver, nearRiver }
      siteScore: function (tile, score, info) {
        // Strong enough to win on most maps, but a poor site can still lose.
        if (pref === "temperate" && (tile.biome === "grassland" || tile.biome === "plains")) score += 10;
        if (pref === "coastal" && info.coastal) score += 30;
        if (pref === "river" && info.onRiver) score += 20;
        if (pref === "hills" && tile.biome === "hills") score += 36;
        return score;
      }
    };
  }

  /*
   * n rival designs for a game, deterministic per seed. Each gets a primary
   * colour no other civ uses (the player's included) and a distinct name.
   */
  function rivals(n, seed, player) {
    var out = [], used = [player ? String(player.primary).toLowerCase() : ""], names = [player ? player.name : ""];
    function h(s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
    for (var i = 0; i < n; i++) {
      var d = null;
      for (var k = 0; k < 60 && !d; k++) {
        var c = normalize(randomCiv(h(String(seed) + ":rival:" + i + ":" + k)));
        if (used.indexOf(c.primary.toLowerCase()) === -1 && names.indexOf(c.name) === -1) d = c;
      }
      d = d || normalize(randomCiv(h(String(seed) + ":rival:" + i)));
      used.push(d.primary.toLowerCase()); names.push(d.name);
      out.push(d);
    }
    return out;
  }

  // Badge: primary fill, secondary rim, emblem in secondary. shape: "hex" | "circle".
  function drawBadge(ctx, x, y, r, civ, shape) {
    var em = EMBLEMS[civ.emblem] || EMBLEMS.sun;
    ctx.save();
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else {
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 180 * (60 * i - 30);
        if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
        else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
    }
    ctx.fillStyle = civ.primary;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.11);
    ctx.strokeStyle = civ.secondary;
    ctx.stroke();
    em.draw(ctx, x, y, r * 0.56, civ.secondary);
    ctx.restore();
  }

  root.PlanetCiv = {
    drawBadge: drawBadge,
    PALETTE: PALETTE,
    EMBLEMS: EMBLEMS,
    EMBLEM_ORDER: EMBLEM_ORDER,
    TRAITS: TRAITS,
    TRAIT_ORDER: TRAIT_ORDER,
    TRAIT_COUNT: TRAIT_COUNT,
    START_PREFS: START_PREFS,
    START_PREF_ORDER: START_PREF_ORDER,
    TITLES: TITLES,
    DEFAULT_CIV: DEFAULT_CIV,
    DEFAULT_CITY_NAMES: DEFAULT_CITY_NAMES,
    normalize: normalize,
    validate: validate,
    makeModifiers: makeModifiers,
    randomCiv: randomCiv,
    rivals: rivals,
    deriveDemonyms: deriveDemonyms,
    makeName: makeName,
    mulberry: mulberry,
    contrast: contrast,
    shade: shade,
    rgba: rgba,
    inkFor: inkFor
  };
})(typeof window !== "undefined" ? window : globalThis);
