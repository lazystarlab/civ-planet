/*
 * app.js — RENDERING AND UI.
 * Reads tiles from PlanetGen (map generator) and game state from PlanetGame
 * (rules). draw(tiles) paints terrain from the tile shape alone; the game
 * layer (territory, fog, cities, units) is painted on top from `game`.
 */
(function () {
  "use strict";

  var Gen = window.PlanetGen;
  var Rules = window.PlanetGame;
  var Civ = window.PlanetCiv;
  var Creator = window.PlanetCreator;
  var Tech = window.PlanetTech;
  var Save = window.PlanetSave;
  var TreeUI = window.PlanetTechTree;
  var Vision = window.PlanetVision;
  var Diplo = window.PlanetDiplomacy;
  var AI = window.PlanetAI;
  var Panels = window.PlanetPanels;
  var Combat = window.PlanetCombat;
  var Econ = window.PlanetEconomy;
  var Naval = window.PlanetNaval;
  var Ranged = window.PlanetRanged;
  var Happy = window.PlanetHappiness;
  var Roads = window.PlanetRoads;
  var Trade = window.PlanetTrade;
  var Deals = window.PlanetDeals;
  var Wonders = window.PlanetWonders;
  var DealUI = window.PlanetDealUI;
  var Eras = window.PlanetEras;
  var Story = window.PlanetStory;
  var StoryUI = window.PlanetStoryUI;
  var Icons = window.PlanetIcons;
  var Anim = window.PlanetAnim;
  var Orders = window.PlanetOrders, Promo = window.PlanetPromo, Air = window.PlanetAir, Strat = window.PlanetStrategic, Gov = window.PlanetGov, Rel = window.PlanetReligion;

  // Per-civ rules: traits, tech tree, diplomacy's border rule, combat (healing,
  // fortify) and economy (unit upkeep).
  function modsFor(design) {
    // Naval goes first: later hooks (Seafaring, closed borders) adjust its water costs.
    return [Naval.makeModifiers, Civ.makeModifiers(design), Tech.makeModifiers, Diplo.makeModifiers, Combat.makeModifiers, Econ.makeModifiers,
      Ranged.makeModifiers, Happy.makeModifiers, Roads.makeModifiers, Trade.makeModifiers, Wonders.makeModifiers, Eras.makeModifiers, Story.makeModifiers];
  }

  // New game setup: the player plus n AI rivals generated from the seed.
  function newSetup(civ, seed, rivals) {
    var designs = [civ].concat(Civ.rivals(rivals, seed, civ));
    return {
      civs: designs.map(function (d, i) { return { design: d, modifiers: modsFor(d), cityNames: d.cityNames, ai: i > 0 }; }),
      world: [Diplo.WORLD, Deals.WORLD, Story.WORLD, window.PlanetPeace.WORLD]
    };
  }
  function loadSetup() { return { modsFor: modsFor, world: [Diplo.WORLD, Deals.WORLD, Story.WORLD, window.PlanetPeace.WORLD] }; }

  // Colours for any civ, cached per design.
  var colorCache = {};
  function colorsFor(cid) {
    var g = state.game;
    var d = g && g.civs[cid] ? g.civs[cid].design : PLAYER.civ;
    if (!d) return PLAYER;
    var k = d.primary + d.secondary + d.emblem;
    if (!colorCache[k]) colorCache[k] = { fill: d.primary, dark: Civ.shade(d.primary, -0.45), ring: d.secondary, civ: d };
    return colorCache[k];
  }

  var HEX = 18;
  var SEA_LEVEL = Gen.SEA_LEVEL;
  var DEFAULT_SEED = Gen.DEFAULT_SEED;
  var DIRS = Gen.DIRS;
  var BIOMES = Gen.BIOMES;
  var RESOURCES = Gen.RESOURCES;
  var RESOURCE_ORDER = Gen.RESOURCE_ORDER;
  var hash32 = Gen.hash32;
  var generate = Gen.generate;

  // Player colours, derived from the civ (see applyCiv).
  var PLAYER = { fill: "#a8322b", dark: "#5e1712", ring: "#e3c06a", text: "#fbf3df", civ: null };

  function applyCiv(civ) {
    PLAYER = {
      fill: civ.primary,
      dark: Civ.shade(civ.primary, -0.45),
      ring: civ.secondary,
      text: "#fbf3df",
      civ: civ
    };
    var rootStyle = document.documentElement.style;
    rootStyle.setProperty("--civ-primary", civ.primary);
    rootStyle.setProperty("--civ-secondary", civ.secondary);
    rootStyle.setProperty("--civ-head-ink", Civ.inkFor(civ.primary));
    document.getElementById("civChipName").textContent = civ.name;
    Creator.paintBadge(document.getElementById("civChipBadge"), civ, "hex");
  }
  // Edge i of a pointy-top hex (corner i -> i+1) faces this DIRS index.
  var EDGE_DIR = [0, 5, 4, 3, 2, 1];

  var FILL = {
    coast: [72, 158, 176],
    plains: [206, 184, 104],
    grassland: [116, 168, 74],
    forest: [38, 108, 58],
    jungle: [18, 90, 64],
    desert: [212, 164, 84],
    hills: [142, 126, 74],
    mountain: [118, 112, 106],
    tundra: [168, 176, 158],
    snow: [228, 233, 234]
  };

  var DIR_NAMES = ["east", "northeast", "northwest", "west", "southwest", "southeast"];

  function lerp(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var canvas = document.getElementById("map");
  var ctx = canvas.getContext("2d");
  var mainCtx = ctx;
  var hud = document.getElementById("hud");
  var seedLabel = document.getElementById("seedLabel");
  var seedInput = document.getElementById("seedInput");

  var state = {
    seed: DEFAULT_SEED,
    tiles: [],
    index: new Map(),
    cam: { x: 0, y: 0, zoom: 1 },
    fitZoom: 1,
    hover: null,
    selected: null,
    showRivers: true,
    art: "classic",   // "classic" | "diorama" (art test)
    showResources: true,
    showFog: true,
    game: null,
    selUnit: null,      // unit id
    selCity: null,      // city id
    reach: null,        // Map from PlanetGame.reachable
    attack: [],         // tiles the selected unit can attack
    buyTile: null,      // city id while choosing a tile to buy
    fx: [],             // running animations { kind, t0, dur, ... }
    freezeFx: false
  };

  function hexToPixel(q, r) {
    return [
      HEX * Math.sqrt(3) * (q + r / 2),
      HEX * 1.5 * r
    ];
  }

  function pixelToAxial(x, y) {
    var q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / HEX;
    var r = (2 / 3 * y) / HEX;
    return hexRound(q, r);
  }

  function hexRound(qf, rf) {
    var sf = -qf - rf;
    var q = Math.round(qf);
    var r = Math.round(rf);
    var s = Math.round(sf);
    var dq = Math.abs(q - qf);
    var dr = Math.abs(r - rf);
    var ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return { q: q, r: r };
  }

  function tileFill(tile) {
    var j = hash32(tile.q, tile.r, 7) - 0.5;
    var rgb;
    var e = clamp(tile.elevation, 0, 1);
    if (tile.biome === "deep_ocean") {
      var depthT = clamp(e / SEA_LEVEL, 0, 1);
      rgb = lerp([7, 32, 54], [32, 104, 136], depthT);
      rgb = rgb.map(function (c) { return clamp(c + j * 10, 0, 255); });
    } else if (tile.biome === "coast") {
      rgb = FILL.coast.map(function (c) { return clamp(c + j * 12, 0, 255); });
    } else if (tile.biome === "mountain") {
      var cap = clamp((e - 0.86) / 0.14, 0, 1);
      rgb = lerp(FILL.mountain, [232, 236, 238], cap * cap);
      rgb = rgb.map(function (c) { return clamp(c + j * 12, 0, 255); });
    } else {
      var base = FILL[tile.biome] || [120, 120, 120];
      var shade = 1 + (e - 0.6) * -0.12;
      rgb = base.map(function (c) { return clamp(c * shade + j * 16, 0, 255); });
    }
    return "rgb(" + (rgb[0] | 0) + "," + (rgb[1] | 0) + "," + (rgb[2] | 0) + ")";
  }

  function traceHex(x, y, size) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var ang = Math.PI / 180 * (60 * i - 30);
      var px = x + size * Math.cos(ang);
      var py = y + size * Math.sin(ang);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function resizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fit(tiles) {
    if (!tiles.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < tiles.length; i++) {
      var p = hexToPixel(tiles[i].q, tiles[i].r);
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    var pad = HEX * 2.2;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var vw = canvas.clientWidth || 1;
    var vh = canvas.clientHeight || 1;
    var z = Math.min(vw / (maxX - minX), vh / (maxY - minY));
    state.cam.zoom = z;
    state.cam.x = (vw - (minX + maxX) * z) / 2;
    state.cam.y = (vh - (minY + maxY) * z) / 2;
  }

  // River geometry is derived purely from tile fields and cached per tile array.
  var riverCache = new WeakMap();

  function riverGeometry(tiles) {
    if (riverCache.has(tiles)) return riverCache.get(tiles);
    var byKey = new Map();
    var maxFlow = 0, minFlow = Infinity;
    var i, t;
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      byKey.set(t.q + "," + t.r, t);
      if (t.river > 0) {
        if (t.river > maxFlow) maxFlow = t.river;
        if (t.river < minFlow) minFlow = t.river;
      }
    }
    var chains = [];
    if (!maxFlow) { riverCache.set(tiles, chains); return chains; }
    function downstream(tile) {
      if (tile.riverDir < 0) return null;
      return byKey.get((tile.q + DIRS[tile.riverDir][0]) + "," + (tile.r + DIRS[tile.riverDir][1])) || null;
    }
    var hasInflow = new Set();
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.river > 0) {
        var d = downstream(t);
        if (d && d.river > 0) hasInflow.add(d);
      }
    }
    function centre(tile) {
      var p = hexToPixel(tile.q, tile.r);
      var jx = (hash32(tile.q, tile.r, 4242) - 0.5) * HEX * 0.42;
      var jy = (hash32(tile.q, tile.r, 4243) - 0.5) * HEX * 0.42;
      return [p[0] + jx, p[1] + jy];
    }
    var span = Math.log(maxFlow / minFlow) || 1;
    function width(f) {
      return HEX * (0.13 + 0.30 * clamp(Math.log(f / minFlow) / span, 0, 1));
    }
    // Walk from every source; a tributary stops at the tile where it joins.
    var walked = new Set();
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!(t.river > 0) || hasInflow.has(t)) continue;
      var stack = [t];
      while (stack.length) {
        var cur = stack.pop();
        var pts = [];
        while (cur && cur.river > 0) {
          var c = centre(cur);
          pts.push([c[0], c[1], width(cur.river)]);
          if (walked.has(cur)) break;
          walked.add(cur);
          var nx = downstream(cur);
          if (!nx) break;
          if (!(nx.river > 0)) {
            var a = hexToPixel(cur.q, cur.r);
            var b = hexToPixel(nx.q, nx.r);
            pts.push([a[0] + (b[0] - a[0]) * 0.72, a[1] + (b[1] - a[1]) * 0.72, width(cur.river)]);
            break;
          }
          cur = nx;
        }
        if (pts.length >= 2) chains.push(chaikin(chaikin(pts)));
      }
    }
    riverCache.set(tiles, chains);
    return chains;
  }

  function chaikin(pts) {
    if (pts.length < 3) return pts;
    var out = [pts[0]];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function drawRivers(tiles, zoom) {
    var chains = riverGeometry(tiles);
    var minW = 2.2 / zoom;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (var pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = diorama() ? (pass === 0 ? "rgba(52, 96, 92, 0.75)" : "#7fdce6") : pass === 0 ? "rgba(10, 30, 46, 0.7)" : "#74c8f2";
      for (var c = 0; c < chains.length; c++) {
        var pts = chains[c];
        for (var i = 0; i < pts.length - 1; i++) {
          var w = Math.max(minW, pts[i][2]);
          ctx.lineWidth = pass === 0 ? w + 2.2 / zoom : w;
          ctx.beginPath();
          ctx.moveTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
          ctx.stroke();
        }
      }
    }
    if (diorama()) {
      // Faceted ribbon highlight: a thin light streak offset to the lit side.
      ctx.strokeStyle = "rgba(235, 252, 255, 0.55)";
      for (var c2 = 0; c2 < chains.length; c2++) {
        var p2 = chains[c2];
        for (var j = 0; j < p2.length - 1; j++) {
          var w2 = Math.max(minW, p2[j][2]);
          ctx.lineWidth = Math.max(0.8 / zoom, w2 * 0.28);
          ctx.beginPath(); ctx.moveTo(p2[j][0] - w2 * 0.18, p2[j][1] - w2 * 0.18); ctx.lineTo(p2[j + 1][0] - w2 * 0.18, p2[j + 1][1] - w2 * 0.18); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function DPR() { return Math.min(window.devicePixelRatio || 1, 2); }
  // Resource icons (icons.js) on a small dark disc, top-right of the hex.
  function drawResources(tiles, zoom, view) {
    var rad = Math.max(HEX * 0.34, 6 / zoom), k = zoom * DPR();
    ctx.save();
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t.resource) continue;
      if (state.game && !Rules.resourceVisible(state.game, t.resource)) continue;
      var p = hexToPixel(t.q, t.r);
      if (p[0] < view[0] || p[0] > view[2] || p[1] < view[1] || p[1] > view[3]) continue;
      var x = p[0] + HEX * 0.3;
      var y = p[1] - HEX * 0.3;
      ctx.beginPath();
      ctx.arc(x, y + 0.6 / zoom, rad, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(14, 12, 10, 0.55)";
      ctx.fill();
      ctx.lineWidth = Math.max(0.8 / zoom, rad * 0.1);
      ctx.strokeStyle = "rgba(250, 244, 230, 0.55)";
      ctx.stroke();
      Icons.draw(ctx, t.resource, x, y, rad * 1.85, k);
    }
    ctx.restore();
  }

  function outlineTile(tile, color, width) {
    var p = hexToPixel(tile.q, tile.r);
    traceHex(p[0], p[1], HEX * 0.94);
    ctx.save();
    ctx.lineWidth = width / state.cam.zoom;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  function tileAtEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left;
    var my = ev.clientY - rect.top;
    var wx = (mx - state.cam.x) / state.cam.zoom;
    var wy = (my - state.cam.y) / state.cam.zoom;
    var axial = pixelToAxial(wx, wy);
    return state.index.get(axial.q + "," + axial.r) || null;
  }


  // ---------------------------------------------------------------- drawing

  function hexCorner(x, y, size, i) {
    var ang = Math.PI / 180 * (60 * i - 30);
    return [x + size * Math.cos(ang), y + size * Math.sin(ang)];
  }

  function viewRect(w, h) {
    var cam = state.cam;
    return [
      (0 - cam.x) / cam.zoom - HEX * 2,
      (0 - cam.y) / cam.zoom - HEX * 2,
      (w - cam.x) / cam.zoom + HEX * 2,
      (h - cam.y) / cam.zoom + HEX * 2
    ];
  }

  function inView(p, v) { return !v || p[0] >= v[0] && p[0] <= v[2] && p[1] >= v[1] && p[1] <= v[3]; }

  function isRevealed(tile) {
    var g = state.game;
    return !state.showFog || !g || g.revealed.has(Rules.key(tile.q, tile.r));
  }

  // Terrain only: depends on the tile shape, nothing from the game.
  function diorama() { return state.art === "diorama" && window.PlanetDiorama; }
  function drawTerrainHexes(tiles, zoom, v) {
    if (diorama()) { window.PlanetDiorama.drawTiles(ctx, tiles, zoom, v, hexToPixel, HEX, inView, ctx === mainCtx ? DPR() : 1); return; }
    ctx.lineJoin = "round";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = "rgba(8, 12, 16, 0.38)";
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var p = hexToPixel(tile.q, tile.r);
      if (v && !inView(p, v)) continue;
      traceHex(p[0], p[1], HEX + 0.6 / zoom);
      ctx.fillStyle = tileFill(tile);
      ctx.fill();
      ctx.stroke();
    }
  }

  /*
   * Static terrain (and rivers) pre-rendered once per map into an offscreen
   * canvas of at most 4096 px a side. Used whenever the view is zoomed out
   * far enough that the cache is not visibly upscaled; closer in, the
   * culled per-hex path draws crisp hexes.
   */
  function terrainCache(tiles) {
    var key = (state.seed || "") + "|" + tiles.length + "|" + !!state.showRivers + "|" + state.art;
    if (state.tcache && state.tcache.key === key && state.tcache.tiles === tiles) return state.tcache;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < tiles.length; i++) {
      var p = hexToPixel(tiles[i].q, tiles[i].r);
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    minX -= HEX * 1.2; minY -= HEX * 1.2; maxX += HEX * 1.2; maxY += HEX * 1.2;
    var scale = Math.min(1.6, 4096 / (maxX - minX), 4096 / (maxY - minY));
    var oc = document.createElement("canvas");
    oc.width = Math.ceil((maxX - minX) * scale);
    oc.height = Math.ceil((maxY - minY) * scale);
    var saved = ctx;
    ctx = oc.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
    drawTerrainHexes(tiles, scale, null);
    if (state.showRivers) drawRivers(tiles, scale);
    ctx = saved;
    state.tcache = { key: key, tiles: tiles, canvas: oc, x: minX, y: minY, scale: scale };
    return state.tcache;
  }

  // Draw a world-space layer once into a canvas matching the terrain cache,
  // then blit it while its signature holds. Returns false if no cache exists.
  var LAYER_SCALE = 0.5;   // fog/territory layers: half the terrain cache resolution
  function cachedLayer(name, sig, paint) {
    var tc0 = state.tcache;
    if (!tc0) return false;
    var tc = { x: tc0.x, y: tc0.y, scale: tc0.scale * LAYER_SCALE, canvas: { width: Math.ceil(tc0.canvas.width * LAYER_SCALE), height: Math.ceil(tc0.canvas.height * LAYER_SCALE) }, src: tc0 };
    state.layers = state.layers || {};
    var L = state.layers[name];
    if (!L || L.sig !== sig || L.src !== tc0) {
      var oc = L && L.src === tc0 ? L.canvas : document.createElement("canvas");
      oc.width = tc.canvas.width; oc.height = tc.canvas.height;
      var saved = ctx;
      ctx = oc.getContext("2d");
      ctx.setTransform(tc.scale, 0, 0, tc.scale, -tc.x * tc.scale, -tc.y * tc.scale);
      paint(tc.scale);
      ctx = saved;
      L = state.layers[name] = { sig: sig, src: tc0, canvas: oc };
    }
    ctx.drawImage(L.canvas, tc.x, tc.y, L.canvas.width / tc.scale, L.canvas.height / tc.scale);
    return true;
  }

  function draw(tiles) {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    ctx.fillStyle = "#10161c";
    ctx.fillRect(0, 0, w, h);

    var cam = state.cam;
    var v = viewRect(w, h);
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);
    var tc = terrainCache(tiles);
    if (tc && cam.zoom <= tc.scale * 1.15) {
      // Zoomed out: one blit of the cached terrain + rivers instead of every hex.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tc.canvas, tc.x, tc.y, tc.canvas.width / tc.scale, tc.canvas.height / tc.scale);
    } else {
      drawTerrainHexes(tiles, cam.zoom, v);
      if (state.showRivers) drawRivers(tiles, cam.zoom);
    }
    if (state.showResources) drawResources(tiles, cam.zoom, v);
    ctx.restore();
  }

  // What the player knows: real state on visible tiles, memory on explored ones.
  function fogOn() { return state.showFog && state.game; }
  function tileVisible(k) { return !fogOn() || (state.vis && state.vis.has(k)); }
  function displayOwner(game, k) {
    var t = game.index.get(k);
    if (!fogOn()) return Rules.tileCiv(game, t);
    if (!game.revealed.has(k)) return -1;
    var real = Rules.tileCiv(game, t);
    if (real === 0 || tileVisible(k)) return real;
    var mem = game.civs[0].memory;
    var m = mem && mem.owner ? mem.owner[k] : undefined;
    return m == null ? -1 : m;
  }

  function drawTerritory(game, zoom, v) {
    if (!game.owner.size && !(game.civs[0].memory && Object.keys(game.civs[0].memory.owner || {}).length)) return;
    var own = new Map();
    game.tiles.forEach(function (t) {
      var k = Rules.key(t.q, t.r);
      var o = displayOwner(game, k);
      if (o >= 0) own.set(k, o);
    });
    ctx.save();
    own.forEach(function (cid, k) {
      var t = game.index.get(k);
      var p = hexToPixel(t.q, t.r);
      if (!inView(p, v)) return;
      traceHex(p[0], p[1], HEX);
      ctx.fillStyle = Civ.rgba(colorsFor(cid).fill, diorama() ? 0.1 : 0.16);
      ctx.fill();
    });
    // Border: edges whose neighbour belongs to another civ (or no one).
    ctx.lineCap = "round";
    for (var pass = 0; pass < 2; pass++) {
      var byCiv = {};
      own.forEach(function (cid, k) { (byCiv[cid] = byCiv[cid] || []).push(k); });
      Object.keys(byCiv).forEach(function (cidS) {
        var cid = +cidS, col = colorsFor(cid);
        ctx.strokeStyle = pass === 0 ? col.fill : Civ.rgba(col.ring, 0.8);
        ctx.lineWidth = (pass === 0 ? 3.2 : 1.1) / zoom;
        ctx.beginPath();
        byCiv[cidS].forEach(function (k) {
          var t = game.index.get(k);
          var p = hexToPixel(t.q, t.r);
          if (!inView(p, v)) return;
          var inset = pass === 0 ? HEX - 1.6 / zoom : HEX - 3.6 / zoom;
          for (var e = 0; e < 6; e++) {
            var d = DIRS[EDGE_DIR[e]];
            if (own.get(Rules.key(t.q + d[0], t.r + d[1])) === cid) continue;
            var a = hexCorner(p[0], p[1], inset, e);
            var b = hexCorner(p[0], p[1], inset, e + 1);
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
          }
        });
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  // Unexplored: solid dark. Explored but not in sight: dimmed (last seen state).
  function drawFog(game, zoom, v) {
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    for (var i = 0; i < game.tiles.length; i++) {
      var t = game.tiles[i];
      var k = Rules.key(t.q, t.r);
      var p = hexToPixel(t.q, t.r);
      if (!inView(p, v)) continue;
      if (game.revealed.has(k)) {
        if (state.vis && !state.vis.has(k)) {
          traceHex(p[0], p[1], HEX + 0.5 / zoom);
          ctx.fillStyle = "rgba(10, 14, 19, 0.38)";
          ctx.fill();
        }
        continue;
      }
      var j = hash32(t.q, t.r, 99) * 6;
      traceHex(p[0], p[1], HEX + 0.7 / zoom);
      ctx.fillStyle = "rgb(" + (21 + j | 0) + "," + (26 + j | 0) + "," + (32 + j | 0) + ")";
      // Soft fog edge: hexes bordering the explored world spill a blurred shadow onto it.
      var edge = Rules.neighbours(game, t).some(function (nb) { return game.revealed.has(Rules.key(nb.q, nb.r)); });
      if (edge) { ctx.shadowColor = "rgba(18, 22, 28, 0.85)"; ctx.shadowBlur = Math.min(28, HEX * zoom * 0.45 * (v ? 1 : 2)); }
      ctx.fill();
      if (edge) { ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
      ctx.stroke();
    }
    ctx.restore();
  }

  // Cities the player knows about: { city-like, owner, stale }.
  function knownCities(game) {
    var out = [], seen = {};
    for (var i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (c.owner === 0 || tileVisible(Rules.key(c.q, c.r))) { out.push({ c: c, stale: false }); seen[c.id] = true; }
    }
    if (fogOn()) {
      var mem = game.civs[0].memory;
      if (mem && mem.cities) for (var id in mem.cities) if (!seen[id]) out.push({ c: mem.cities[id], stale: true });
    }
    return out;
  }

  function drawReach(zoom) {
    if (!state.reach) return;
    var u = Rules.unitById(state.game, state.selUnit);
    ctx.save();
    state.reach.forEach(function (node, k) {
      if (!u || (node.tile.q === u.q && node.tile.r === u.r)) return;
      var p = hexToPixel(node.tile.q, node.tile.r);
      traceHex(p[0], p[1], HEX * 0.9);
      ctx.fillStyle = "rgba(255, 238, 190, 0.26)";
      ctx.fill();
      ctx.lineWidth = 1.4 / zoom;
      ctx.strokeStyle = "rgba(255, 238, 190, 0.85)";
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawWorked(game, zoom) {
    var city = state.selCity != null ? Rules.cityById(game, state.selCity) : null;
    if (!city) return;
    ctx.save();
    for (var i = 1; i < city.worked.length; i++) {
      var t = game.index.get(city.worked[i]);
      var p = hexToPixel(t.q, t.r);
      ctx.beginPath();
      ctx.arc(p[0] - HEX * 0.32, p[1] + HEX * 0.34, Math.max(HEX * 0.17, 3.5 / zoom), 0, Math.PI * 2);
      ctx.fillStyle = "#fbf3df";
      ctx.fill();
      ctx.lineWidth = 1.4 / zoom;
      ctx.strokeStyle = PLAYER.fill;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSuggested(game, zoom) {
    if (Rules.citiesOf(game, 0).length || !game.suggested) return;
    var p = hexToPixel(game.suggested.q, game.suggested.r);
    ctx.save();
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.lineWidth = 2 / zoom;
    ctx.strokeStyle = "rgba(255, 226, 140, 0.95)";
    traceHex(p[0], p[1], HEX * 0.78);
    ctx.stroke();
    ctx.restore();
  }

  function drawCityHex(city, zoom, stale) {
    var p = hexToPixel(city.q, city.r);
    ctx.save();
    if (stale) ctx.globalAlpha = 0.6;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 4 / zoom;
    ctx.shadowOffsetY = 1 / zoom;
    if (diorama() && HEX * zoom >= 9) {
      ctx.shadowColor = "transparent";
      window.PlanetDiorama.city(ctx, p[0], p[1], HEX, colorsFor(city.owner), city.pop || 1, zoom, DPR());
      // Small emblem badge so ownership stays readable.
      Civ.drawBadge(ctx, p[0] - HEX * 0.62, p[1] + HEX * 0.42, HEX * 0.26, colorsFor(city.owner).civ, "circle");
    } else Civ.drawBadge(ctx, p[0], p[1], HEX * 0.74, colorsFor(city.owner).civ, "hex");
    ctx.restore();
  }

  function fxProgress(f) {
    if (f.frozen != null) return f.frozen;
    return clamp((Anim.now() - f.t0) / f.dur, 0, 1);
  }

  // Attack lunge: the attacker slides a third of the way toward its target and back.
  function lungeOffset(unit) {
    for (var i = 0; i < state.fx.length; i++) {
      var f = state.fx[i];
      if (f.kind !== "lunge" || f.unit !== unit.id || unit.q !== f.from.q || unit.r !== f.from.r) continue;
      var a = hexToPixel(f.from.q, f.from.r), b = hexToPixel(f.to.q, f.to.r), k = Math.sin(Math.PI * fxProgress(f)) * 0.38;
      return [(b[0] - a[0]) * k, (b[1] - a[1]) * k];
    }
    return [0, 0];
  }

  function hpBar(x, y, w, hp, zoom) {
    var h = Math.max(3.2 / zoom, w * 0.17);
    ctx.fillStyle = "rgba(10, 12, 16, 0.85)";
    ctx.fillRect(x - w / 2 - 0.8 / zoom, y - 0.8 / zoom, w + 1.6 / zoom, h + 1.6 / zoom);
    var f = clamp(hp / 100, 0, 1);
    ctx.fillStyle = f > 0.6 ? "#7fd36b" : f > 0.3 ? "#e8c34f" : "#e0533f";
    ctx.fillRect(x - w / 2, y, w * f, h);
  }

  // Carried units: small badges along the ship's top edge, with a type letter.
  function drawCargo(ship, x, y, rad, zoom, C) {
    var cargo = Rules.cargoOf(state.game, ship);
    if (!cargo.length) return;
    var r = Math.max(rad * 0.5, 7.5 / zoom);
    ctx.save();
    ctx.globalAlpha = 1;
    cargo.forEach(function (c, i) {
      var cx = x + rad * 0.55 + i * r * 2.15, cy = y + rad * 0.95;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 3 / zoom;
      ctx.fillStyle = C.fill; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1.2 / zoom, r * 0.2); ctx.strokeStyle = C.ring; ctx.stroke();
      ctx.fillStyle = C.ring;
      ctx.font = "700 " + (r * 1.15) + "px 'Segoe UI', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(Rules.UNIT_TYPES[c.type].name.charAt(0), cx, cy + r * 0.06);
    });
    ctx.restore();
  }

  function drawUnit(unit, zoom, selected, stackIndex, ghost) {
    var PLAYER = colorsFor(unit.owner || 0);
    var ap = ghost || unit._fx ? null : Anim.pos(unit);
    var p = ap ? hexToPixel(ap.q, ap.r) : hexToPixel(unit.q, unit.r);
    var lo = ghost ? [0, 0] : lungeOffset(unit);
    p = [p[0] + lo[0], p[1] + lo[1]];
    if (ap) stackIndex = 0;
    var inCity = !ap && state.game.cityAt.has(Rules.key(unit.q, unit.r));
    var rad = Math.max(HEX * (inCity ? 0.36 : 0.48), (inCity ? 8 : 10) / zoom);
    var x = p[0] + stackIndex * rad * 0.55 + (inCity ? HEX * 0.5 : 0);
    var y = p[1] + HEX * 0.05 - stackIndex * rad * 0.35 + (inCity ? HEX * 0.42 : 0);
    ctx.save();
    ctx.globalAlpha = (ghost ? 0.42 : unit.owner !== 0 || unit.moves > 0 || unit._fx ? 1 : 0.7) * (unit._alpha != null ? unit._alpha : 1);
    if (unit._sink) y += unit._sink;
    var fig = diorama() && window.PlanetDiorama.FIGURINES[unit.type] && HEX * zoom >= 10;
    if (fig) {
      if (unit.owner === 0 && unit.moves <= 0) ctx.globalAlpha *= 0.85;
      ctx.shadowColor = "rgba(0, 0, 0, 0.75)"; ctx.shadowBlur = 3 / zoom;
      window.PlanetDiorama.figurine(ctx, unit.type, x, y, rad, PLAYER, zoom, DPR());
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
    } else {
    ctx.beginPath();
    ctx.arc(x, y + 1.2 / zoom, rad, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = unit.owner !== 0 || unit.moves > 0 ? PLAYER.fill : PLAYER.dark;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5 / zoom, rad * 0.16);
    ctx.strokeStyle = PLAYER.ring;
    ctx.stroke();
    ctx.strokeStyle = PLAYER.ring;
    ctx.fillStyle = PLAYER.ring;
    ctx.lineWidth = rad * 0.15;
    ctx.lineCap = "round";
    // Silhouette from the icon sprite: civ ring colour, era tint accent.
    Icons.draw(ctx, Icons.unitIcon(unit.type), x, y, rad * 1.5, zoom * DPR(), { base: PLAYER.ring, accent: Icons.eraTint(Icons.unitEra(unit.type)) });
    }
    // Emblem pip on the token's shoulder.
    var pip = rad * 0.5;
    if (!fig) Civ.drawBadge(ctx, x - rad * 0.78, y - rad * 0.72, pip, {
      primary: PLAYER.ring, secondary: PLAYER.fill, emblem: PLAYER.civ.emblem
    }, "circle");
    if (unit.fort && !ghost) {
      // Fortified: a small shield under the token.
      var sx = x + rad * 0.72, sy = y + rad * 0.55, sw = rad * 0.42;
      ctx.beginPath();
      ctx.moveTo(sx - sw, sy - sw * 0.9); ctx.lineTo(sx + sw, sy - sw * 0.9);
      ctx.lineTo(sx + sw, sy); ctx.quadraticCurveTo(sx + sw * 0.8, sy + sw, sx, sy + sw * 1.3);
      ctx.quadraticCurveTo(sx - sw * 0.8, sy + sw, sx - sw, sy);
      ctx.closePath();
      ctx.fillStyle = "#d9d2bf"; ctx.fill();
      ctx.lineWidth = Math.max(1 / zoom, rad * 0.08); ctx.strokeStyle = "#2a2a2a"; ctx.stroke();
    }
    if (unit.hp != null && unit.hp < 100 && !ghost) hpBar(x, y + rad + 2.2 / zoom, rad * 1.7, unit.hp, zoom);
    if (!ghost && !unit._fx && window.PlanetUI15) window.PlanetUI15.badge(ctx, unit, x, y, rad, zoom);
    if (!ghost && Naval.isNaval(unit.type)) drawCargo(unit, x, y, rad, zoom, PLAYER);
    if (selected) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, rad + 3.2 / zoom, 0, Math.PI * 2);
      ctx.lineWidth = 2.2 / zoom;
      ctx.strokeStyle = "#fff8e6";
      ctx.stroke();
    }
    ctx.restore();
  }

  // City name plates are drawn in screen space so text stays crisp at any zoom.
  // A small gold temple glyph (with a count) above the city for its wonders.
  function drawWonderMarks(game) {
    knownCities(game).forEach(function (kc) {
      var c = kc.c, real = Rules.cityById(game, c.id);
      var ws = real ? Wonders.wondersIn(real) : [];
      if (!ws.length) return;
      var pp = hexToPixel(c.q, c.r), z = state.cam.zoom;
      var x = state.cam.x + (pp[0] + HEX * 0.62) * z, y = state.cam.y + (pp[1] + HEX * 0.35) * z;
      var s = Math.max(7, Math.min(13, 9 * z));
      ctx.save();
      ctx.fillStyle = "rgba(20,16,8,0.85)"; ctx.strokeStyle = "#e8c66a"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, s * 1.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f3d27a";
      ctx.beginPath(); ctx.moveTo(x - s * 0.75, y - s * 0.25); ctx.lineTo(x, y - s * 0.75); ctx.lineTo(x + s * 0.75, y - s * 0.25); ctx.closePath(); ctx.fill();
      for (var i = -1; i <= 1; i++) ctx.fillRect(x + i * s * 0.45 - s * 0.1, y - s * 0.2, s * 0.2, s * 0.65);
      ctx.fillRect(x - s * 0.75, y + s * 0.48, s * 1.5, s * 0.16);
      if (ws.length > 1) {
        ctx.font = "700 " + Math.round(s * 0.9) + "px Helvetica, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#1a140a"; ctx.beginPath(); ctx.arc(x + s, y - s * 0.9, s * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f3d27a"; ctx.fillText(String(ws.length), x + s, y - s * 0.88);
      }
      ctx.restore();
    });
  }

  // Anomalies (story.js): a violet rune-stone on explored tiles; dimmed when
  // only remembered (not in sight); gone once investigated.
  function drawAnomalies(game) {
    if (!Story || !game.story) return;
    var z = state.cam.zoom;
    Story.state(game).anomalies.forEach(function (a) {
      if (a.done) return;
      var k = Rules.key(a.q, a.r);
      if (fogOn() && !game.revealed.has(k)) return;
      var pp = hexToPixel(a.q, a.r), x = state.cam.x + pp[0] * z, y = state.cam.y + pp[1] * z, s = Math.max(8, Math.min(17, 12 * z));
      var seen = tileVisible(k), t = Date.now() / 600;
      ctx.save();
      // Violet dashed rim on the hex itself.
      ctx.globalAlpha = seen ? 0.95 : 0.5;
      ctx.strokeStyle = "#b892ff"; ctx.lineWidth = Math.max(1.5, 2.2 * z); ctx.setLineDash([5 * z, 3 * z]);
      traceHex(x, y, HEX * z * 0.9); ctx.stroke(); ctx.setLineDash([]);
      // A unit standing on it: move the marker to the hex's upper-left so both show.
      if (game.units.some(function (u) { return u.q === a.q && u.r === a.r && (!fogOn() || tileVisible(k)); })) { x -= HEX * 0.62 * z; y -= HEX * 0.55 * z; }
      ctx.globalAlpha = seen ? 1 : 0.6;
      if (seen) {
        var gl = ctx.createRadialGradient(x, y, 1, x, y, s * 2.2);
        gl.addColorStop(0, "rgba(190,140,255," + (0.45 + 0.1 * Math.sin(t)).toFixed(2) + ")"); gl.addColorStop(1, "rgba(190,140,255,0)");
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, 7); ctx.fill();
      }
      Icons.draw(ctx, "m_anomaly", x, y, s * 2.3, DPR());
      var inv = game.units.some(function (u) { return u.owner === 0 && u.investigate && u.investigate.a === a.id; });
      if (inv) { ctx.strokeStyle = "#f3d27a"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, s * 1.6, 0, 7); ctx.stroke(); }
      ctx.restore();
    });
  }

  // ---- Story: event cards, era card, chronicle (storyui.js)
  function showStory() {
    var g = state.game;
    if (!g || !Story || StoryUI.eventOpen() || StoryUI.eraOpen()) return;
    var p = Story.state(g).pending[0];
    if (!p) return;
    StoryUI.showEvent({
      game: g,
      onChoose: function (uid, i) { var r = Story.choose(g, uid, i); refreshUi(); saveNow(); return r; },
      after: function () { refreshUi(); showStory(); }
    }, p);
  }
  function treeDone(g) { return Tech.TECH_ORDER.every(function (id) { return Tech.has(g, id, 0); }); }
  function toggleChronicle() { if (StoryUI.chronOpen()) StoryUI.closeChronicle(); else StoryUI.openChronicle(state.game); }
  document.getElementById("chronBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); if (state.game) toggleChronicle(); });

  // ---- Wonders panel (W) and the wonder-complete card
  function openWonders() {
    if (!state.game) return;
    state.wondersOpen = true;
    document.getElementById("wondersOverlay").classList.remove("hidden");
    renderWonders();
  }
  function closeWonders() { state.wondersOpen = false; document.getElementById("wondersOverlay").classList.add("hidden"); }
  function renderWonders() {
    var g = state.game, reg = Wonders.registry(g), prog = Wonders.inProgress(g), html = "";
    var known = function (cid) { return cid === 0 || Diplo.met(g, 0, cid); };
    Wonders.ORDER.forEach(function (id) {
      var w = Wonders.WONDERS[id], done = reg[id], line;
      if (done) {
        var c = Rules.cityById(g, done.city);
        line = known(done.civ) ? "Built by <b>" + escHtml(Rules.civName(g, done.civ)) + "</b> in " + escHtml(c ? c.name : "a lost city") + " · turn " + done.turn + " (" + escHtml(Rules.yearLabel(done.turn)) + ")"
          : "Built by a distant civilization · turn " + done.turn;
      } else {
        var mine = prog.filter(function (p) { return p.id === id && p.civ === 0; })[0];
        var rivals = prog.filter(function (p) { return p.id === id && p.civ !== 0 && known(p.civ); });
        line = mine ? "You: " + escHtml(mine.city.name) + " · " + Math.floor(mine.prod) + "/" + mine.cost : (Tech.has(g, w.tech, 0) ? "Available to build" : "Needs " + escHtml(Tech.TECHS[w.tech].name));
        if (rivals.length) line += ' · <span class="wn-race">also building: ' + rivals.map(function (p) { return escHtml(Rules.civName(g, p.civ)); }).join(", ") + "</span>";
      }
      html += '<div class="wn-row' + (done ? (done.civ === 0 ? " mine" : " taken") : "") + '"><div class="wn-icon">' + Icons.svg("w_" + id, 34) + '</div><div class="wn-main"><div class="wn-name">' + escHtml(w.name) +
        ' <small>' + w.cost + " production</small></div><div class=\"wn-eff\">" + escHtml(w.effect) + '</div><div class="wn-st">' + line + "</div></div></div>";
    });
    var n = Object.keys(reg).length;
    document.getElementById("wondersCount").textContent = n + " of " + Wonders.ORDER.length + " built";
    document.getElementById("wondersList").innerHTML = html;
  }
  function showWonderCard(id) {
    var g = state.game, w = Wonders.WONDERS[id], done = Wonders.registry(g)[id];
    var c = done ? Rules.cityById(g, done.city) : null;
    var card = document.getElementById("wonderCard");
    card.querySelector(".wc-name").textContent = w.name;
    card.querySelector(".wc-flavor").textContent = "\u201c" + w.flavor + "\u201d";
    card.querySelector(".wc-effect").textContent = w.effect;
    card.querySelector(".wc-where").textContent = (c ? c.name + " · " : "") + Rules.civName(g, done ? done.civ : 0) + " · " + Rules.yearLabel(g.turn);
    card.classList.remove("hidden");
  }
  function hideWonderCard() { document.getElementById("wonderCard").classList.add("hidden"); }
  document.getElementById("wonderCard").addEventListener("click", function (ev) { if (ev.target.closest("#wcOk") || ev.target.id === "wonderCard") hideWonderCard(); });
  document.getElementById("wondersOverlay").addEventListener("click", function (ev) { if (ev.target.id === "wondersOverlay" || ev.target.closest("#wondersClose")) closeWonders(); });
  document.getElementById("wondersBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); if (state.wondersOpen) closeWonders(); else openWonders(); });

  function drawCityPlates(game) {
    ctx.save();
    ctx.font = "600 13px Georgia, Palatino, serif";
    ctx.textBaseline = "middle";
    // Bigger cities first; a plate that would overlap one already drawn is
    // skipped (the city badge still shows) so zoomed-out views stay legible.
    var known = knownCities(game).slice().sort(function (a, b) { return b.c.pop - a.c.pop || a.c.id - b.c.id; });
    var placed = [];
    for (var i = 0; i < known.length; i++) {
      var c = known[i].c;
      var PLAYER = colorsFor(c.owner);
      var pp = hexToPixel(c.q, c.r);
      var px = state.cam.x + pp[0] * state.cam.zoom, py = state.cam.y + (pp[1] - HEX * 0.95) * state.cam.zoom - 14;
      var pw = ctx.measureText(c.name).width + 38;
      var clash = placed.some(function (r) { return Math.abs(r[0] - px) < (r[2] + pw) / 2 + 2 && Math.abs(r[1] - py) < 24; });
      if (clash) continue;
      placed.push([px, py, pw]);
      ctx.globalAlpha = known[i].stale ? 0.65 : 1;
      var p = hexToPixel(c.q, c.r);
      var sx = state.cam.x + p[0] * state.cam.zoom;
      var sy = state.cam.y + (p[1] - HEX * 0.95) * state.cam.zoom - 14;
      var nameW = ctx.measureText(c.name).width;
      var popW = 22;
      var total = popW + nameW + 16;
      var x0 = Math.round(sx - total / 2);
      var y0 = Math.round(sy - 11);
      roundRect(x0, y0, total, 22, 5);
      ctx.fillStyle = "rgba(18, 22, 27, 0.92)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.id === state.selCity ? "#fff1cf" : PLAYER.ring;
      ctx.stroke();
      roundRect(x0 + 2, y0 + 2, popW, 18, 4);
      ctx.fillStyle = PLAYER.fill;
      ctx.fill();
      ctx.fillStyle = Civ.inkFor(PLAYER.fill);
      ctx.textAlign = "center";
      ctx.font = "700 12px 'Segoe UI', Helvetica, sans-serif";
      ctx.fillText(String(c.pop), x0 + 2 + popW / 2, y0 + 11.5);
      ctx.textAlign = "left";
      ctx.font = "600 13px Georgia, Palatino, serif";
      ctx.fillStyle = "#f3ead6";
      ctx.fillText(c.name, x0 + popW + 9, y0 + 11.5);
      if (c.hp != null && c.hp < 100) {
        ctx.fillStyle = "rgba(10, 12, 16, 0.9)";
        ctx.fillRect(x0 + 3, y0 + 22, total - 6, 5);
        var hf = clamp(c.hp / 100, 0, 1);
        ctx.fillStyle = hf > 0.6 ? "#7fd36b" : hf > 0.3 ? "#e8c34f" : "#e0533f";
        ctx.fillRect(x0 + 4, y0 + 23, (total - 8) * hf, 3);
      }
      if (c.capital) {
        ctx.fillStyle = PLAYER.ring;
        ctx.font = "700 11px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText("\u2605", x0 + total - 1, y0 + 1);
      }
      if (c.owner === 0 && !c.capital && Roads.connected(game, 0)[c.id]) drawLink(x0 + total + 1, y0 + 17);
      var rc = Rules.cityById(game, c.id);
      if (rc && window.PlanetUI15) window.PlanetUI15.cityRelIcon(ctx, game, rc, x0 - 8, y0 + 11, 16);
    }
    ctx.restore();
  }

  // Trade badge: a gold coin with a chain link, at the plate's corner.
  function drawLink(x, y) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "#e8c560"; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = "#3a2a08"; ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(x - 1.6, y + 1.1, 2.4, 1.5, -0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x + 1.6, y - 1.1, 2.4, 1.5, -0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function linkSvg() {
    return '<svg class="link" viewBox="0 0 14 14" width="13" height="13"><circle cx="7" cy="7" r="6.3" fill="#e8c560" stroke="#3a2a08"/>' +
      '<ellipse cx="5.4" cy="8.1" rx="2.4" ry="1.5" transform="rotate(-40 5.4 8.1)" fill="none" stroke="#3a2a08" stroke-width="1.2"/>' +
      '<ellipse cx="8.6" cy="5.9" rx="2.4" ry="1.5" transform="rotate(-40 8.6 5.9)" fill="none" stroke="#3a2a08" stroke-width="1.2"/></svg>';
  }

  // Rival units last seen in tiles that are now in fog, dimmed where they were.
  function drawGhosts(game, zoom, stacks) {
    if (!fogOn()) return;
    var mem = game.civs[0].memory;
    if (!mem || !mem.units) return;
    for (var id in mem.units) {
      var m = mem.units[id], k = Rules.key(m.q, m.r);
      if (tileVisible(k)) continue;
      var n = stacks.get(k) || 0;
      stacks.set(k, n + 1);
      drawUnit(m, zoom, false, Math.min(n, 2), true);
    }
  }

  function drawAttack(zoom) {
    if (!state.attack || !state.attack.length) return;
    ctx.save();
    state.attack.forEach(function (t) {
      var p = hexToPixel(t.q, t.r);
      traceHex(p[0], p[1], HEX * 0.9);
      ctx.fillStyle = "rgba(224, 72, 52, 0.22)";
      ctx.fill();
      ctx.lineWidth = 2.2 / zoom;
      ctx.strokeStyle = "rgba(255, 110, 84, 0.95)";
      ctx.stroke();
    });
    ctx.restore();
  }

  // Ranged shots and ship bombards: arrows, cannonballs, shells and rockets.
  function ammoOf(type, city) {
    if (city) return "arrow";
    var t = Rules.UNIT_TYPES[type] || {}, era = Icons.unitEra(type);
    if (type === "rocket_artillery" || type === "missile_cruiser") return "rocket";
    if (t.naval) return era >= 4 ? "shell" : "ball";
    if (type === "catapult" || type === "cannon") return "ball";
    if (type === "artillery") return "shell";
    return "arrow";
  }
  function drawShots(zoom) {
    state.fx.forEach(function (f) {
      if (f.kind !== "shot") return;
      var t = fxProgress(f);
      if (t <= 0 || t >= 1) return;
      var ammo = f.ammo || ammoOf(f.type, f.city);
      var a = hexToPixel(f.from.q, f.from.r), b = hexToPixel(f.to.q, f.to.r);
      var lift = Math.hypot(b[0] - a[0], b[1] - a[1]) * (ammo === "rocket" ? 0.18 : ammo === "arrow" ? 0.35 : 0.45);
      var pt = function (s) { return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s - Math.sin(Math.PI * s) * lift]; };
      var p1 = pt(t);
      ctx.save();
      ctx.lineCap = "round";
      if (ammo === "arrow") {
        var p0 = pt(Math.max(0, t - 0.12));
        ctx.strokeStyle = "#fff1c8"; ctx.lineWidth = Math.max(2.4 / zoom, HEX * 0.05);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        ctx.fillStyle = "#ffd36e"; ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(2.6 / zoom, HEX * 0.07), 0, Math.PI * 2); ctx.fill();
      } else {
        // Smoke trail: fading puffs behind the projectile.
        for (var i = 1; i <= 5; i++) {
          var q = pt(Math.max(0, t - i * 0.05));
          ctx.fillStyle = ammo === "rocket" ? "rgba(255, 190, 110," + (0.5 - i * 0.08) + ")" : "rgba(210, 205, 195," + (0.42 - i * 0.07) + ")";
          ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(2 / zoom, HEX * 0.07) * (1 + i * 0.25), 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = ammo === "ball" ? "#2a2622" : ammo === "rocket" ? "#fff3d6" : "#ffe9a8";
        ctx.strokeStyle = "rgba(255, 240, 200, 0.9)"; ctx.lineWidth = 1 / zoom;
        ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(3 / zoom, HEX * (ammo === "ball" ? 0.13 : 0.1)), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    });
  }

  // Fallen units fade and sink where they died.
  function drawDeaths(zoom) {
    state.fx.forEach(function (f) {
      if (f.kind !== "death") return;
      var t = fxProgress(f);
      if (t <= 0 || t >= 1) return;
      drawUnit({ id: -1, _fx: true, type: f.type, owner: f.owner, q: f.q, r: f.r, hp: 100, moves: 1, _alpha: 1 - t, _sink: t * HEX * 0.35 }, zoom, false, 0, false);
      // A puff of dust.
      var p = hexToPixel(f.q, f.r);
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.fillStyle = "#d8cfbe";
      for (var i = 0; i < 6; i++) {
        var ang = i / 6 * Math.PI * 2 + 0.4, r = HEX * (0.2 + t * 0.55);
        ctx.beginPath(); ctx.arc(p[0] + Math.cos(ang) * r, p[1] + Math.sin(ang) * r * 0.6, HEX * 0.1 * (1 + t), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });
  }

  // City effects (anim.js diff): growth pulse, build sparkle, border fade, capture flag.
  function drawCityFx(game, zoom) {
    var list = Anim.activeEffects();
    if (!list.length) return;
    ctx.save();
    list.forEach(function (e) {
      var t = Anim.progress(e);
      if (t <= 0) return;
      if (e.kind === "border") {
        e.tiles.forEach(function (o) {
          var tile = game.index.get(o.k);
          if (!tile) return;
          var p = hexToPixel(tile.q, tile.r);
          traceHex(p[0], p[1], HEX * 0.96);
          ctx.globalAlpha = 0.55 * (1 - t);
          ctx.fillStyle = colorsFor(o.owner).fill;
          ctx.fill();
        });
        return;
      }
      var p = hexToPixel(e.q, e.r), C = colorsFor(e.owner);
      if (e.kind === "grow") {
        ctx.globalAlpha = 0.9 * (1 - t);
        ctx.strokeStyle = "#bff0a0"; ctx.lineWidth = (3 * (1 - t) + 1) / zoom + HEX * 0.04;
        ctx.beginPath(); ctx.arc(p[0], p[1], HEX * (0.5 + t * 0.9), 0, Math.PI * 2); ctx.stroke();
      } else if (e.kind === "built") {
        for (var i = 0; i < 8; i++) {
          var ang = i / 8 * Math.PI * 2 + t * 1.6, r = HEX * (0.35 + t * 0.85), sz = HEX * 0.13 * (1 - t * 0.6);
          var x = p[0] + Math.cos(ang) * r, y = p[1] + Math.sin(ang) * r * 0.8 - t * HEX * 0.3;
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = i % 2 ? "#ffe9a0" : "#fff8e6";
          ctx.beginPath();
          for (var j = 0; j < 8; j++) { var a2 = j / 8 * Math.PI * 2, rr = j % 2 ? sz * 0.35 : sz; ctx[j ? "lineTo" : "moveTo"](x + Math.cos(a2) * rr, y + Math.sin(a2) * rr); }
          ctx.closePath(); ctx.fill();
        }
      } else if (e.kind === "capture") {
        // The old flag drops, the new one rises with a bounce.
        var k = Math.min(1, t * 2), up = t < 0.5 ? 0 : Math.min(1, (t - 0.5) * 3), bounce = up < 1 ? Math.sin(up * Math.PI) * 0.15 : 0;
        var px = p[0] + HEX * 0.05, base = p[1] - HEX * 0.55;
        ctx.globalAlpha = 1 - k;
        Icons.draw(ctx, "m_capture", px, base + k * HEX * 0.5, HEX * 0.9, zoom * DPR(), { accent: colorsFor(e.prev).fill, base: "#e8e0cc" });
        ctx.globalAlpha = up * (t > 0.85 ? (1 - t) / 0.15 : 1);
        Icons.draw(ctx, "m_capture", px, base - (up + bounce) * HEX * 0.25, HEX * (0.9 + bounce), zoom * DPR(), { accent: C.fill, base: "#e8e0cc" });
      }
    });
    ctx.restore();
  }

  /*
   * Ambient world (anim on, water on, close enough): a slow shimmer on visible
   * water hexes and a flow hint along rivers. Drawn over the cached terrain.
   */
  function drawWaterFx(game, zoom, v) {
    if (!Anim.settings.on || !Anim.settings.water || zoom < state.fitZoom * 1.6 || !v) return;
    var t = Anim.now() / 1000, tiles = state.tiles, n = 0;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#e8f6ff";
    ctx.lineWidth = Math.max(0.9 / zoom, HEX * 0.05);
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      if (!Rules.isWater(tile)) continue;
      var p = hexToPixel(tile.q, tile.r);
      if (!inView(p, v)) continue;
      if (fogOn() && !game.revealed.has(Rules.key(tile.q, tile.r))) continue;
      var ph = t * 0.9 + tile.q * 0.73 + tile.r * 1.31, w = Math.sin(ph);
      ctx.globalAlpha = 0.07 + 0.07 * (w * 0.5 + 0.5);
      var ox = Math.sin(ph * 0.7) * HEX * 0.12, y0 = p[1] - HEX * 0.18 + Math.cos(ph) * HEX * 0.05;
      ctx.beginPath();
      ctx.moveTo(p[0] - HEX * 0.38 + ox, y0); ctx.quadraticCurveTo(p[0] - HEX * 0.18 + ox, y0 - HEX * 0.08, p[0] + ox, y0);
      ctx.moveTo(p[0] - HEX * 0.02 - ox, y0 + HEX * 0.34); ctx.quadraticCurveTo(p[0] + HEX * 0.18 - ox, y0 + HEX * 0.26, p[0] + HEX * 0.38 - ox, y0 + HEX * 0.34);
      ctx.stroke();
      n++;
    }
    // Rivers: light dashes drifting downstream.
    if (state.showRivers !== false) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = "#e6f6ff";
      ctx.setLineDash([HEX * 0.22, HEX * 0.7]);
      ctx.lineDashOffset = -t * HEX * 0.8;
      riverGeometry(tiles).forEach(function (pts) {
        if (!pts.some(function (q) { return inView(q, v); })) return;
        ctx.lineWidth = Math.max(0.8 / zoom, pts[0][2] * 0.35);
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    ctx.restore();
    state.waterTiles = n;
  }

  /*
   * Roads: thin tan lines between neighbouring road tiles (cities count),
   * on explored tiles. Farms and mines: small marks on the tile.
   */
  // Trade routes: faint dashed lines between the two cities (only when both are known).
  function drawTradeRoutes(game, zoom) {
    var rs = Trade.routes(game);
    if (!rs.length) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash([HEX * 0.35, HEX * 0.3]);
    rs.forEach(function (r) {
      var a = Rules.cityById(game, r.from), b = Rules.cityById(game, r.to);
      if (!a || !b) return;
      if (fogOn() && !(game.revealed.has(Rules.key(a.q, a.r)) && game.revealed.has(Rules.key(b.q, b.r)))) return;
      var p = hexToPixel(a.q, a.r), q = hexToPixel(b.q, b.r);
      var mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
      var bend = Math.min(len * 0.12, HEX * 2), cx = mx - dy / len * bend, cy = my + dx / len * bend;
      var foreign = a.owner !== b.owner;
      ctx.strokeStyle = foreign ? "rgba(240, 214, 150, 0.6)" : "rgba(160, 210, 240, 0.55)";
      ctx.lineWidth = 1.6 / zoom + HEX * 0.05;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(cx, cy, q[0], q[1]); ctx.stroke();
    });
    ctx.restore();
  }

  function drawRoads(game, zoom, v) {
    var rs = game.roads || {}, imps = game.improvements || {};
    var keys = Object.keys(rs);
    game.cities.forEach(function (c) { keys.push(Rules.key(c.q, c.r)); });
    var seen = {};
    ctx.save();
    ctx.lineCap = "round";
    var known = function (k) { return !fogOn() || game.revealed.has(k); };
    ctx.strokeStyle = "rgba(60, 40, 18, 0.55)"; ctx.lineWidth = 4.2 / zoom + HEX * 0.06;
    var pass = function () {
      keys.forEach(function (k) {
        if (seen[k] === pass.n || !known(k)) return;
        seen[k] = pass.n;
        var t = game.index.get(k), p = hexToPixel(t.q, t.r);
        if (!inView(p, v)) return;
        Rules.neighbours(game, t).forEach(function (n) {
          var nk = Rules.key(n.q, n.r);
          if (nk < k || !known(nk) || !Roads.isRoad(game, n.q, n.r)) return;
          if (!rs[k] && !rs[nk]) return;   // two cities side by side: no road drawn
          var q = hexToPixel(n.q, n.r);
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        });
      });
    };
    pass.n = 1; pass();
    ctx.strokeStyle = "#d9b77a"; ctx.lineWidth = 2.2 / zoom + HEX * 0.03;
    pass.n = 2; pass();
    // A lone road tile (no road neighbour) gets a small tan dot.
    ctx.fillStyle = "#d9b77a";
    Object.keys(rs).forEach(function (k) {
      if (!known(k)) return;
      var t = game.index.get(k), p = hexToPixel(t.q, t.r);
      if (inView(p, v) && !Rules.neighbours(game, t).some(function (n) { return Roads.isRoad(game, n.q, n.r); })) {
        ctx.beginPath(); ctx.arc(p[0], p[1], HEX * 0.12, 0, Math.PI * 2); ctx.fill();
      }
    });
    Object.keys(imps).forEach(function (k) {
      if (!known(k)) return;
      var t = game.index.get(k), p = hexToPixel(t.q, t.r);
      if (!inView(p, v)) return;
      ctx.strokeStyle = imps[k] === "farm" ? "rgba(246, 226, 140, 0.85)" : "rgba(40, 30, 22, 0.8)";
      ctx.lineWidth = Math.max(1.2 / zoom, HEX * 0.05);
      if (imps[k] === "farm") {
        for (var i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(p[0] - HEX * 0.42, p[1] + HEX * (0.36 + i * 0.13)); ctx.lineTo(p[0] + HEX * 0.1, p[1] + HEX * (0.36 + i * 0.13)); ctx.stroke(); }
      } else {
        ctx.beginPath(); ctx.moveTo(p[0] - HEX * 0.38, p[1] + HEX * 0.56); ctx.lineTo(p[0] - HEX * 0.16, p[1] + HEX * 0.24); ctx.lineTo(p[0] + HEX * 0.06, p[1] + HEX * 0.56); ctx.stroke();
      }
    });
    ctx.restore();
  }

  function drawFlashes(zoom) {
    ctx.save();
    state.fx.forEach(function (f) {
      if (f.kind !== "hit" && f.kind !== "capture") return;
      var t = fxProgress(f);
      if (t > 0.45) return;
      var p = hexToPixel(f.q, f.r);
      traceHex(p[0], p[1], HEX * 0.96);
      ctx.fillStyle = f.kind === "capture" ? "rgba(255, 226, 140," + (0.6 * (1 - t / 0.45)) + ")" : "rgba(255, 245, 225," + (0.55 * (1 - t / 0.45)) + ")";
      ctx.fill();
    });
    ctx.restore();
  }

  // Floating damage numbers, in screen space so they stay crisp.
  function drawNumbers() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 17px 'Segoe UI', Helvetica, sans-serif";
    state.fx.forEach(function (f) {
      if (f.kind !== "hit" && f.kind !== "capture") return;
      var t = fxProgress(f);
      var p = hexToPixel(f.q, f.r);
      var x = state.cam.x + p[0] * state.cam.zoom, y = state.cam.y + p[1] * state.cam.zoom - 14 - t * 34;
      ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      var text = f.kind === "capture" ? f.text : "\u2212" + f.amount;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(12, 10, 8, 0.9)";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = f.kind === "capture" ? "#ffe08a" : f.owner === 0 ? "#ff7a62" : "#fff3d6";
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  }

  function drawBuyTiles(game) {
    var city = state.buyTile != null ? Rules.cityById(game, state.buyTile) : null;
    if (!city) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 12px 'Segoe UI', Helvetica, sans-serif";
    Econ.buyableTiles(game, city).forEach(function (o) {
      var p = hexToPixel(o.tile.q, o.tile.r);
      ctx.save();
      ctx.translate(state.cam.x, state.cam.y);
      ctx.scale(state.cam.zoom, state.cam.zoom);
      traceHex(p[0], p[1], HEX * 0.86);
      ctx.setLineDash([4 / state.cam.zoom, 3 / state.cam.zoom]);
      ctx.lineWidth = 1.8 / state.cam.zoom;
      ctx.strokeStyle = game.gold >= o.cost ? "rgba(255, 216, 110, 0.95)" : "rgba(190, 170, 140, 0.7)";
      ctx.stroke();
      ctx.restore();
      var x = state.cam.x + p[0] * state.cam.zoom, y = state.cam.y + p[1] * state.cam.zoom;
      roundRect(x - 17, y - 9, 34, 18, 4);
      ctx.fillStyle = "rgba(18, 22, 27, 0.88)";
      ctx.fill();
      ctx.fillStyle = game.gold >= o.cost ? "#ffd86e" : "#9c8f78";
      ctx.fillText(o.cost + "g", x, y + 0.5);
    });
    ctx.restore();
  }

  // Turn game.fx records (from combat.js) into animations the player can see.
  // During an AI turn each effect waits for the move just before it (anim.js).
  var FX_DUR = { lunge: 320, shot: 420, hit: 1100, capture: 1100, death: 900, air: 1500, landing: 900, pillage: 1400, plunder: 1400 };
  var FX_LAG = { lunge: 0, shot: 0, hit: 260, capture: 140, death: 300, air: 0, landing: 0, pillage: 0, plunder: 0 };
  function consumeFx() {
    var g = state.game;
    if (!g || !g.fx || !g.fx.length) return;
    if (!Anim.settings.on) { g.fx = []; return; }
    var now = Anim.now(), sp = Math.max(0.25, Anim.settings.speed || 1);
    g.fx.forEach(function (r, i) {
      var k = Rules.key((r.to || r).q, (r.to || r).r);
      if (!tileVisible(k) && !(r.from && tileVisible(Rules.key(r.from.q, r.from.r)))) return;
      var lag = Anim.fxDelay(i);
      var f = { kind: r.kind, t0: now + lag + (FX_LAG[r.kind] || 0) / sp, dur: (FX_DUR[r.kind] || 900) / sp };
      if (r.kind !== "air" && g.fx.some(function (o) { return o.kind === "air" && !o.rebase; })) f.t0 += 650 / sp;
      for (var x in r) if (x !== "kind") f[x] = r[x];
      if (r.kind === "capture") f.text = "Captured!";
      if (r.kind === "hit" || r.kind === "capture") f.shake = true;
      // Ships bombard: a shell flies before the lunge lands.
      if (r.kind === "lunge" && Naval.isNaval(r.type)) {
        state.fx.push({ kind: "shot", from: r.from, to: r.to, owner: r.owner, type: r.type, t0: f.t0, dur: 360 / sp });
        f.t0 += 120 / sp;
      }
      state.fx.push(f);
    });
    g.fx = [];
    state.lastFx = state.fx.slice();
    animate();
  }

  /*
   * One loop for everything that moves: effects, tweens, camera, and the
   * ambient water (throttled to ~30 fps when nothing else is playing).
   */
  var animating = false, lastAmbient = 0;
  function ambientOn() {
    return Anim.settings.on && Anim.settings.water && state.game && !document.hidden && state.cam.zoom >= state.fitZoom * 1.6 && !state.freezeFx;
  }
  function animate() {
    if (animating) return;
    animating = true;
    (function frame() {
      var now = Anim.now();
      if (!state.freezeFx) state.fx = state.fx.filter(function (f) { return f.frozen != null || now - f.t0 < f.dur; });
      state.fx.forEach(function (f) { if (f.shake && now >= f.t0 && f.frozen == null) { f.shake = false; Anim.shake(f.city ? 5 : 3); } });
      var active = (state.fx.length && !state.freezeFx) || Anim.busy();
      if (active || now - lastAmbient > 33) { render(); lastAmbient = now; }
      updateSkip();
      if (active || ambientOn()) requestAnimationFrame(frame);
      else animating = false;
    })();
  }
  // "Skip" while the AI's moves are playing.
  function updateSkip() {
    var el = document.getElementById("skipAnim");
    if (el) el.classList.toggle("hidden", !Anim.aiBusy());
  }
  function skipAnimations() {
    Anim.skip();
    state.fx = [];
    updateSkip();
    render();
  }
  // Smooth camera move to a hex (instant with animations off).
  function panTo(q, r, zoom) {
    var p = hexToPixel(q, r), z = zoom || state.cam.zoom;
    var to = { x: canvas.clientWidth / 2 - p[0] * z, y: canvas.clientHeight / 2 - p[1] * z, zoom: z };
    if (!Anim.camTo(state.cam, to, 450)) { state.cam.x = to.x; state.cam.y = to.y; state.cam.zoom = z; }
  }
  function onScreen(q, r) {
    var p = hexToPixel(q, r), x = state.cam.x + p[0] * state.cam.zoom, y = state.cam.y + p[1] * state.cam.zoom;
    return x > 60 && y > 60 && x < canvas.clientWidth - 60 && y < canvas.clientHeight - 60;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Camera tween and shake wrap every frame (anim.js).
  function render() {
    Anim.camStep(state.cam);
    var sh = Anim.shakeOffset();
    if (sh) { state.cam.x += sh[0]; state.cam.y += sh[1]; }
    try { renderFrame(); } finally { if (sh) { state.cam.x -= sh[0]; state.cam.y -= sh[1]; } }
  }
  function renderFrame() {
    var game = state.game;
    draw(state.tiles);
    if (!game) return;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var cam = state.cam;
    var v = viewRect(w, h);
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);
    drawWaterFx(game, cam.zoom, v);
    drawRoads(game, cam.zoom, v);
    drawTradeRoutes(game, cam.zoom);
    // Zoomed out, territory and fog come from world-sized offscreen layers too.
    var far = state.tcache && cam.zoom <= state.tcache.scale * LAYER_SCALE * 1.2;
    var visId = state.visVer || 0;
    var tSig = visId + "|" + game.owner.size + "|" + game.turn + "|" + (game.combatSeq || 0) + "|" + game.cities.length + "|" + !!state.showFog;
    if (!(far && cachedLayer("territory", tSig, function (z) { drawTerritory(game, z, null); }))) drawTerritory(game, cam.zoom, v);
    if (state.showFog) {
      var fSig = visId + "|" + game.revealed.size;
      if (!(far && cachedLayer("fog", fSig, function (z) { drawFog(game, z, null); }))) drawFog(game, cam.zoom, v);
    }
    drawSuggested(game, cam.zoom);
    drawWorked(game, cam.zoom);
    drawReach(cam.zoom);
    if (window.PlanetUI15) window.PlanetUI15.drawPillaged(ctx, hexToPixel, cam.zoom, HEX, game, function (k) { return !fogOn() || game.revealed.has(k); });
    if (window.PlanetUI15) window.PlanetUI15.drawGoto(ctx, hexToPixel, cam.zoom, state.selUnit != null ? Rules.unitById(game, state.selUnit) : null, state.hover, state.reach, HEX);
    var known = knownCities(game);
    for (var i = 0; i < known.length; i++) drawCityHex(known[i].c, cam.zoom, known[i].stale);
    var stacks = new Map();
    for (i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      var k = Rules.key(u.q, u.r);
      if (u.owner !== 0 && !tileVisible(k)) {
        // Walking out of sight: drawn until the tween leaves the visible hexes.
        var ap = Anim.pos(u);
        if (!ap || !tileVisible(Rules.key(Math.round(ap.q), Math.round(ap.r)))) continue;
      }
      if (u.aboard != null) continue;   // drawn as a badge on its ship
      var n = stacks.get(k) || 0;
      stacks.set(k, n + 1);
      if (u.id !== state.selUnit) drawUnit(u, cam.zoom, false, Math.min(n, 2));
    }
    var su = state.selUnit != null ? Rules.unitById(game, state.selUnit) : null;
    if (su && su.aboard == null) drawUnit(su, cam.zoom, true, 0);
    else if (su) { var sp = hexToPixel(su.q, su.r); ctx.save(); ctx.lineWidth = 2.4 / cam.zoom; ctx.strokeStyle = "#fff8e6"; traceHex(sp[0], sp[1], HEX * 0.8); ctx.stroke(); ctx.restore(); }
    drawGhosts(game, cam.zoom, stacks);
    drawAttack(cam.zoom);
    drawFlashes(cam.zoom);
    drawDeaths(cam.zoom);
    drawCityFx(game, cam.zoom);
    drawShots(cam.zoom);
    state.fx.forEach(function (f) {
      if (!window.PlanetUI15) return;
      var t = fxProgress(f);
      if ((f.kind === "pillage" || f.kind === "plunder") && t > 0 && t < 1) { window.PlanetUI15.drawPillageFx(ctx, f, t, hexToPixel, cam.zoom, HEX); return; }
      if (f.kind !== "air") return;
      if (t > 0 && t < 1) window.PlanetUI15.drawAirFx(ctx, f, t, hexToPixel, cam.zoom, HEX, colorsFor);
    });
    if (state.hover) outlineTile(state.hover, "rgba(255, 248, 230, 0.95)", 2.1);
    ctx.restore();
    drawCityPlates(game);
    drawWonderMarks(game);
    drawAnomalies(game);
    drawBuyTiles(game);
    drawNumbers();

    var g = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.28, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(1, "rgba(6, 8, 12, 0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // --------------------------------------------------------------- UI panels

  function yieldHtml(y) {
    return '<span class="y food">' + y.food + " food</span> " +
      '<span class="y prod">' + y.prod + " prod</span> " +
      '<span class="y gold">' + y.gold + " gold</span>";
  }

  function foreignUnitsLine(game, tile) {
    if (!game || !tile) return "";
    var k = Rules.key(tile.q, tile.r);
    if (!tileVisible(k)) return "";
    var us = game.units.filter(function (u) { return u.owner !== 0 && u.q === tile.q && u.r === tile.r; });
    if (!us.length) return "";
    return '<div class="meta hud-foe">' + us.map(function (u) {
      return escHtml(Rules.civName(game, u.owner)) + " " + Rules.UNIT_TYPES[u.type].name + " · str " + Combat.strengthOf(u.type) + " · " + u.hp + " HP" + (u.fort ? " · fortified" : "");
    }).join("<br>") + "</div>";
  }

  function showHud(tile) {
    var game = state.game;
    if (!tile) {
      hud.innerHTML = '<div class="name">—</div><div class="meta">drag to pan · wheel to zoom · Enter ends turn</div>';
      return;
    }
    if (!isRevealed(tile)) {
      hud.innerHTML = '<div class="name">Unexplored</div><div class="meta">q ' + tile.q + " · r " + tile.r + "</div>";
      return;
    }
    var name = BIOMES[tile.biome] || tile.biome;
    var extra = '<div class="extra">' + yieldHtml(Rules.tileYield(game, tile)) + "</div>";
    if (tile.river > 0) {
      var size = tile.river >= 40 ? "Great river" : tile.river >= 16 ? "River" : "Stream";
      extra += '<div class="extra"><b>' + size + "</b> · flow " + tile.river.toFixed(0) +
        " · runs " + (DIR_NAMES[tile.riverDir] || "?") + "</div>";
    }
    if (tile.resource && Rules.resourceVisible(game, tile.resource)) {
      extra += '<div class="extra">Resource: <b>' + RESOURCES[tile.resource].name + "</b></div>";
    }
    var k = Rules.key(tile.q, tile.r);
    var city = game.cityAt.get(k);
    if (city && city.owner !== 0) { foreign = null; }
    if (city && city.owner === 0) extra += '<div class="extra">City: <b>' + escHtml(city.name) + "</b></div>";
    var foreign = null;
    if (!city || city.owner !== 0) {
      var known = knownCities(game);
      for (var ki = 0; ki < known.length; ki++) if (known[ki].c.q === tile.q && known[ki].c.r === tile.r) foreign = known[ki];
    }
    if (city && city.owner !== 0 && !tileVisible(k)) city = null;
    if (foreign) {
      extra += '<div class="extra">City: <b>' + escHtml(foreign.c.name) + "</b> · " + escHtml(Rules.civName(game, foreign.c.owner)) +
        " · pop " + foreign.c.pop + (foreign.c.hp != null && foreign.c.hp < 100 ? " · " + foreign.c.hp + " HP" : "") +
        (foreign.c.capital ? " · capital" : "") + (foreign.stale ? " (last seen)" : "") + "</div>";
    } else if (!city) {
      var oc = displayOwner(game, k);
      if (oc === 0 && game.owner.has(k)) extra += '<div class="extra">Territory of ' + escHtml(Rules.cityById(game, game.owner.get(k)).name) + "</div>";
      else if (oc > 0) extra += '<div class="extra">Territory of <b>' + escHtml(Rules.civName(game, oc)) + "</b>" +
        (Diplo.canEnter(game, 0, oc) ? "" : " · closed borders") + "</div>";
    }
    if (!Rules.citiesOf(game, 0).length && game.suggested && game.suggested.q === tile.q && game.suggested.r === tile.r) {
      extra += '<div class="extra">Suggested city site</div>';
    }
    var cost = Rules.moveCost(tile);
    extra += foreignUnitsLine(game, tile);
    hud.innerHTML =
      '<div class="name">' + name + "</div>" + extra +
      '<div class="meta">q ' + tile.q + " · r " + tile.r + " · move " + (cost === Infinity ? "impassable" : cost) + "</div>";
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!msg) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  function updateTopBar() {
    var g = state.game;
    document.getElementById("turnLabel").textContent = "Turn " + g.turn;
    var age = Story ? Story.inAge(g, 0) : null;
    var yl = document.getElementById("yearLabel");
    yl.textContent = Rules.yearLabel(g.turn) + " · " + Eras.eraName(Eras.eraOf(g, 0)) + (age ? (age.kind === "golden" ? " \u2600" : " \u263E") : "");
    yl.title = Eras.eraName(Eras.eraOf(g, 0)) + " Era" + (age ? " · " + (age.kind === "golden" ? "golden age" : "dark age") + " until turn " + age.until : "");
    var income = Rules.goldRate(g, 0), up = Econ.upkeep(g, 0), net = income - up;
    var gl = document.getElementById("goldLabel");
    Anim.tickNumber(gl, g.gold, function (v) { return v + " (" + (net >= 0 ? "+" : "") + net + ")"; });
    gl.classList.toggle("neg", net < 0);
    var tinc = Trade.incomeOf(g, 0);
    gl.title = "Income +" + income + (tinc.gold ? " (incl. trade routes +" + tinc.gold + ")" : "") + " · unit upkeep −" + up + " (" + Econ.FREE_UNITS_PER_CITY + " free units per city)";
    updateHappiness();
    updateResearchButton();
    if (window.PlanetReligion) {
      var rs = window.PlanetReligion.state(g).civ[0], fl = document.getElementById("faithLabel");
      if (fl && rs) { fl.textContent = Math.floor(rs.faith) + " (+" + rs.perTurn + ")"; }
      var pend = window.PlanetReligion.state(g).pendingFound.indexOf(0) !== -1 || (rs && rs.pendingIdeology);
      var rb = document.getElementById("relBtn");
      if (rb) { rb.innerHTML = Icons.svg("ui_religion", 20) + (pend ? '<span class="req-badge">!</span>' : ""); rb.title = "Faith " + Math.floor(rs.faith) + " (+" + rs.perTurn + " a turn) · religion and ideology (L)"; }
      var gb = document.getElementById("govBtn"), gc = window.PlanetGov.civ(g, 0);
      if (gb) { gb.innerHTML = Icons.svg("ui_government", 20) + (gc.anarchy > 0 ? '<span class="req-badge">A</span>' : ""); gb.title = "Government: " + window.PlanetGov.GOVS[gc.gov].name + (gc.anarchy > 0 ? " (anarchy " + gc.anarchy + ")" : "") + " · policies (G)"; }
      var sb = document.getElementById("stratBtn"), over = window.PlanetStrategic.totalOver(g, 0);
      if (sb) sb.innerHTML = Icons.svg("ui_resources", 20) + (over ? '<span class="req-badge">' + over + "</span>" : "");
    }
  }

  function fmtMoves(m) { return Math.abs(m - Math.round(m)) < 0.01 ? String(Math.round(m)) : (Math.round(m * 3) + "/3"); }

  // Smile / flat / frown face for a happiness value.
  function faceSvg(h) {
    if (Icons) return Icons.svg(h < 0 ? "s_unhappy" : "s_happy", 16, h < Happy.VERY_UNHAPPY ? { base: "#e0604c" } : null);
    var col = h < Happy.VERY_UNHAPPY ? "#e0604c" : h < 0 ? "#e8a24a" : "#9fd27a";
    var mouth = h < 0 ? "M6 13.2 Q9 10.6 12 13.2" : h === 0 ? "M6 12 L12 12" : "M6 11.2 Q9 14.2 12 11.2";
    return '<svg class="face" viewBox="0 0 18 18" width="16" height="16"><circle cx="9" cy="9" r="7.6" fill="none" stroke="' + col +
      '" stroke-width="1.7"/><circle cx="6.6" cy="7.2" r="1.1" fill="' + col + '"/><circle cx="11.4" cy="7.2" r="1.1" fill="' + col +
      '"/><path d="' + mouth + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }

  function updateHappiness() {
    var g = state.game, h = Happy.compute(g, 0);
    var el = document.getElementById("happyStat");
    el.innerHTML = faceSvg(h.total) + "<b>" + (h.total > 0 ? "+" : "") + h.total + "</b>";
    el.className = "stat happy " + h.state;
    var row = function (label, v, cls) { return '<div class="ht-row ' + (cls || "") + '"><span>' + label + "</span><b>" + (v > 0 ? "+" : v < 0 ? "\u2212" : "") + Math.abs(v) + "</b></div>"; };
    var html = '<div class="ht-head">' + faceSvg(h.total) + " Happiness " + (h.total > 0 ? "+" : "") + h.total +
      ' <small>' + (h.state === "very" ? "very unhappy" : h.state === "unhappy" ? "unhappy" : "content") + "</small></div>" + row("Base", h.base);
    if (h.palace) html += row("Palace (capital)", h.palace, "up");
    h.luxuries.forEach(function (l) {
      html += row("Luxury: " + l.name + (l.n > 1 ? " × " + l.n + " <small>(+" + Happy.LUX_FIRST + " first" + (l.extra ? ", +" + l.extra + " connected extra" : ", extras need a road to the capital") + ")</small>" : ""), l.v, "up");
    });
    if (!h.luxuries.length) html += '<div class="ht-row dim"><span>No luxuries (Gems, Spices, Gold) in your land</span></div>';
    h.buildings.forEach(function (b) { html += row(b.name + (b.n > 1 ? " × " + b.n : ""), b.v, "up"); });
    html += row("Cities (" + (-h.cities / Happy.CITY_COST) + " × −" + Happy.CITY_COST + ")", h.cities, "down") + row("Population (1 per 2 pop above 2, per city)", h.pop, "down");
    html += '<div class="ht-note">' + (h.state === "very" ? "Below \u22125: no growth, no Settlers, " + Math.round(Happy.unrestChance(h.total) * 100) + "% unrest chance per city"
      : h.state === "unhappy" ? "Below 0: \u221225% growth, \u22121 production per city" : "Below 0: \u221225% growth and \u22121 production per city") + "</div>";
    document.getElementById("happyTip").innerHTML = html;
  }

  function updateResearchButton() {
    var g = state.game;
    var btn = document.getElementById("researchBtn");
    var sci = Rules.scienceRate(g);
    var cur = g.tech && g.tech.current;
    var name = document.getElementById("researchName");
    var meta = document.getElementById("researchMeta");
    var fill = document.getElementById("researchFill");
    if (cur) {
      var t = Tech.TECHS[cur], tl = Tech.turnsLeft(g, sci);
      name.textContent = t.name;
      fill.style.width = Math.min(100, g.tech.progress / t.cost * 100).toFixed(1) + "%";
      meta.textContent = Math.min(g.tech.progress, t.cost) + "/" + t.cost + " · " + (tl === Infinity ? "–" : tl + "t");
      btn.title = "Researching " + t.name + " (+" + sci + " science/turn) · Technology tree (T)";
    } else {
      name.textContent = Tech.TECH_ORDER.every(function (id) { return Tech.has(g, id, 0); }) ? "Tree complete" : "Choose research";
      fill.style.width = "0";
      meta.textContent = "+" + sci;
      btn.title = "Pick a technology (T)";
    }
    btn.classList.toggle("prompt", !cur && g.cities.length > 0);
  }

  function bar(value, max, cls) {
    var pct = clamp(max > 0 ? value / max : 0, 0, 1) * 100;
    return '<div class="bar ' + cls + '"><span style="width:' + pct.toFixed(1) + '%"></span></div>';
  }

  function updateCityPanel() {
    var el = document.getElementById("cityPanel");
    var g = state.game;
    var city = state.selCity != null ? Rules.cityById(g, state.selCity) : null;
    if (!city) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    var y = Rules.cityYield(g, city);
    var need = Rules.growthNeed(city.pop, g, 0, city);
    var b = city.build ? Rules.BUILDS[city.build] : null;
    var cost = b ? Rules.buildCost(g, city.build) : 0;
    var cap = Wonders.popCap(g, city);
    var capWhy = cap === 16 ? "Aqueduct" : cap === 12 ? "fresh water; an Aqueduct raises it to 16" : "no fresh water; an Aqueduct raises it to 16";
    var growIn = city.pop >= cap ? "never: pop cap " + cap + " (" + capWhy + ")" : need === Infinity ? "never (very unhappy)" : y.surplus > 0 ? Math.ceil((need - city.food) / y.surplus) + " turns" : (y.surplus === 0 ? "stalled" : "starving");
    var conn = Roads.connected(g, 0)[city.id];
    var strikes = Ranged.cityTargets(g, city);
    var buildIn = !b ? "" : y.prod > 0 ? Math.max(1, Math.ceil((cost - city.prod) / y.prod)) + " turns" : "never";
    var html =
      '<div class="cp-head"><span class="cp-pop">' + city.pop + '</span><canvas id="cpBadge"></canvas>' +
      '<span class="cp-name">' + escHtml(city.name) + "</span></div>" +
      (city.unrest ? '<div class="cp-unrest">Unrest: no production or gold this turn</div>' : "") +
      '<div class="cp-row"><span>Food</span><span>' + city.food + " / " + (need === Infinity ? "\u221e" : need) +
        ' <em>(' + (y.surplus >= 0 ? "+" : "") + y.surplus + ")</em></span></div>" + bar(city.food, need, "food") +
      '<div class="cp-sub">grows in ' + growIn + "</div>" +
      (b
        ? '<div class="cp-row"><span>Production</span><span>' + Math.min(city.prod, cost) + " / " + cost +
          " <em>(+" + y.prod + ")</em></span></div>" + bar(city.prod, cost, "prod") +
          '<div class="cp-sub">' + b.name + " in " + buildIn + "</div>"
        : '<div class="cp-row"><span>Production</span><span>' + city.prod + " stored <em>(+" + y.prod + ")</em></span></div>" +
          '<div class="cp-choose">Choose what ' + escHtml(city.name) + " builds next</div>") +
      buyHtml(g, city) +
      '<div class="cp-row"><span>Gold</span><span>+' + y.gold + " / turn</span></div>" +
      '<div class="cp-row"><span>Trade</span><span class="' + (conn || city.capital ? "cp-conn" : "cp-noconn") + '">' +
        (city.capital ? "capital" : conn ? linkSvg() + (conn === "harbor" ? "harbor link" : "road to capital") + " +" + Roads.tradeGold(city) + " gold" : "not connected") + "</span></div>" +
      '<div class="cp-row"><span>Defense</span><span>' + Combat.cityDefense(g, city).value.toFixed(1) + " · " + city.hp + " HP" +
        (city.capital ? " · capital" : "") + "</span></div>" +
      (city.hp < 100 ? bar(city.hp, 100, "hp") : "") +
      (Ranged.cityCanStrike(g, city) && strikes.length ? '<button type="button" id="cpStrike" class="cp-tilebtn' + (state.cityStrike === city.id ? " on" : "") + '">' +
        (state.cityStrike === city.id ? "Click a target · Esc to cancel" : "City strike (" + strikes.length + (strikes.length === 1 ? " target)" : " targets)")) + "</button>" : "") +
      '<button type="button" id="cpBuyTile" class="cp-tilebtn' + (state.buyTile === city.id ? " on" : "") + '">' +
        (state.buyTile === city.id ? "Click a highlighted tile · Esc to stop" : "Buy a tile…") + "</button>" +
      '<div class="cp-row"><span>Worked tiles</span><span>' + city.worked.length + " · radius " + Rules.workRadius(city) + "</span></div>" +
      '<div class="cp-build">';
    for (var key in Rules.BUILDS) {
      if (!Rules.canBuild(g, city, key)) continue;
      var opt = Rules.BUILDS[key];
      var note = opt.note ? " · " + opt.note : opt.minPop > 1 ? " · pop " + opt.minPop + ", −" + opt.popCost : "";
      html += '<button type="button" data-build="' + key + '" class="' + (city.build === key ? "on" : "") + '">' + buildIconSvg(key, 16) +
        opt.name + " <small>" + Rules.buildCost(g, key) + note + "</small></button>";
    }
    html += "</div>";
    html += '<label class="cp-repeat"><input type="checkbox" id="cpRepeat"' + (city.repeat ? " checked" : "") + "> Repeat unit builds</label>";
    var blds = (city.buildings || []).filter(function (b) { return Rules.BUILDS[b]; });
    if (blds.length) html += '<div class="cp-bld">Buildings: ' + blds.map(function (b) { return '<span class="cp-bchip" title="' + escHtml(Rules.BUILDS[b].name) + '">' + buildIconSvg(b, 18) + escHtml(Rules.BUILDS[b].name) + "</span>"; }).join("") + "</div>";
    el.innerHTML = html;
    Creator.paintBadge(document.getElementById("cpBadge"), PLAYER.civ, "hex");
  }

  // Icon for any build key: unit, building, wonder (w_*) or project (p_*).
  function buildIconSvg(key, px) {
    var b = Rules.BUILDS[key];
    if (!b) return "";
    var name = b.wonder ? "w_" + b.wonder : Icons.has(key) ? key : Rules.UNIT_TYPES[key] ? Icons.unitIcon(key) : null;
    if (!name || !Icons.has(name)) return "";
    var unit = name.indexOf("u_") === 0;
    return Icons.svg(name, px, unit ? { base: "#f6efe0", accent: Icons.eraTint(Icons.unitEra(key)) } : null);
  }
  function buyHtml(g, city) {
    var price = Econ.buyCost(g, city);
    if (!price) return "";
    var ok = g.gold >= price;
    return '<button type="button" id="cpBuy" class="cp-buy"' + (ok ? "" : " disabled") + ">Buy " +
      Rules.BUILDS[city.build].name + " · <b>" + price + " gold</b>" + (ok ? "" : " <small>(have " + g.gold + ")</small>") + "</button>";
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function updateUnitPanel() {
    var el = document.getElementById("unitPanel");
    var g = state.game;
    var u = state.selUnit != null ? Rules.unitById(g, state.selUnit) : null;
    if (!u || u.owner !== 0) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    var type = Rules.UNIT_TYPES[u.type];
    var html = '<span class="up-name">' + escHtml(PLAYER.civ.adjective) + " " + type.name +
      '</span><span class="up-moves">moves ' + fmtMoves(u.moves) + " / " + Rules.maxMoves(g, u.type) + "</span>";
    if (type.worker) {
      if (u.work) {
        var wt = u.work.total || u.work.left;
        html += '<span class="up-cargo">Building a ' + u.work.kind + " · " + (wt - u.work.left) + "/" + wt + " done · " + u.work.left + (u.work.left === 1 ? " turn" : " turns") + " left</span>" +
          '<button type="button" id="cancelJobBtn" title="Progress stays on the tile; you keep your moves">Cancel job <kbd>X</kbd></button>';
      } else {
        var jobs = Roads.jobs(g, u);
        jobs.forEach(function (j) {
          var done = (g.jobs || {})[Rules.key(u.q, u.r) + "|" + j.kind] || 0;
          html += '<button type="button" data-job="' + j.kind + '">' + (done ? "Resume " + j.name.toLowerCase() : j.name) + " <small>" + (done ? (j.turns - done) + " of " + j.turns + "t left" : j.turns + "t") + (j.note ? " · " + j.note : "") + "</small></button>";
        });
        if (!jobs.length) html += '<span class="up-note">Nothing to build here</span>';
      }
    }
    if (type.caravan) {
      var tgts = Trade.targetsNear(g, u);
      tgts.forEach(function (c) {
        var y = Trade.yieldOf(g, { from: (Trade.check(g, u, c).home || {}).id, to: c.id, kind: "gold" });
        if (!y) return;
        var renew = Trade.check(g, u, c).renew ? "Renew" : "Trade";
        if (c.owner === 0) {
          [["gold", "gold"], ["food", "food"], ["prod", "production"]].forEach(function (kd) {
            html += '<button type="button" data-trade="' + c.id + '" data-kind="' + kd[0] + '">' + renew + " with " + escHtml(c.name) + " <small>+" + y.home + " gold · " + escHtml(c.name) + " +" + y.dest + " " + kd[1] + "</small></button>";
          });
        } else {
          html += '<button type="button" data-trade="' + c.id + '" data-kind="gold">' + renew + " with " + escHtml(c.name) + " <small>+" + y.home + " gold · they +" + y.dest + " · +1 science each</small></button>";
        }
      });
      if (!tgts.length) {
        var near = g.cities.filter(function (c) { return Rules.hexDistance(u.q, u.r, c.q, c.r) <= 1; })[0];
        html += '<span class="up-note">' + (near ? escHtml(Trade.check(g, u, near).reason || "") : "Move next to a city of yours, or of a civ at peace, to open a trade route") + "</span>";
      }
    }
    if (u.investigate) {
      html += '<span class="up-cargo">Investigating the anomaly · ' + u.investigate.left + (u.investigate.left === 1 ? " turn" : " turns") + " left</span>";
    } else if (Story && Story.canInvestigate(g, u)) {
      var an = Story.canInvestigate(g, u);
      html += '<button type="button" data-investigate="1"' + (u.moves > 0 ? "" : " disabled") + ">Investigate " + escHtml(Story.ANOMALY_KINDS[an.kind].name.toLowerCase()) + " <small>" + Story.ANOMALY_KINDS[an.kind].turns + "t</small></button>";
    }
    var upTo = Econ.upgradeTarget(g, u);
    if (upTo) {
      var upCost = Econ.upgradeCost(g, u);
      html += '<button type="button" data-upgrade="1"' + (g.gold >= upCost && u.moves > 0 ? "" : " disabled") + ">Upgrade to " + Rules.UNIT_TYPES[upTo].name + " <small>" + upCost + " gold</small></button>";
    }
    if (Naval.isNaval(u.type)) {
      var cargo = Rules.cargoOf(g, u);
      html += '<span class="up-cargo">Aboard ' + cargo.length + "/" + Naval.capacity(u.type) + (cargo.length ? ": " +
        cargo.map(function (c) { return Rules.UNIT_TYPES[c.type].name; }).join(", ") : "") + "</span>" +
        '<button type="button" id="unloadBtn"' + (cargo.length ? "" : " disabled") + ">Unload <kbd>U</kbd></button>";
    } else if (u.aboard != null) {
      var ship = Rules.unitById(g, u.aboard);
      html += '<span class="up-cargo">Aboard ' + (ship ? Rules.UNIT_TYPES[ship.type].name : "ship") + " · move onto land to disembark</span>";
    } else {
      var dock = Naval.transportAt(g, 0, u.q, u.r, u);
      if (dock && g.cityAt.has(Rules.key(u.q, u.r))) html += '<button type="button" id="boardBtn"' + (u.moves > 0 ? "" : " disabled") + ">Board " + Rules.UNIT_TYPES[dock.type].name + "</button>";
    }
    if (Combat.strengthOf(u.type) > 0) {
      html += '<span class="up-moves">' + (type.ranged ? "ranged " + type.ranged + " · range " + type.range + " · def " : "str ") + Combat.strengthOf(u.type) + " · " + u.hp + " HP" + (u.fort ? " · fortified" : u.fortifying ? " · fortifying" : "") + "</span>" +
        '<button type="button" id="fortBtn"' + (u.fort || u.fortifying ? " disabled" : "") + ">Fortify <kbd>F</kbd></button>";
    }
    if (type.canFound) {
      var check = Rules.canFoundCity(g, u.id);
      var fd = Happy.foundDelta(g, 0, state.index.get(Rules.key(u.q, u.r))), hNow = Happy.total(g, 0);
      html += '<button type="button" id="foundBtn"' + (check.ok ? "" : " disabled") + ">Found city <kbd>B</kbd></button>" +
        '<span class="up-happy ' + (hNow + fd < 0 ? "bad" : "") + '" title="Happiness now ' + hNow + ", after founding " + (hNow + fd) + '">' +
        faceSvg(hNow + fd) + (fd >= 0 ? "+" : "\u2212") + Math.abs(fd) + " happiness \u2192 " + (hNow + fd) + "</span>";
      if (!check.ok) html += '<span class="up-note">' + check.reason + "</span>";
    }
    if (window.PlanetUI15) html += window.PlanetUI15.unitHtml(g, u);
    el.innerHTML = html;
  }

  // Recompute what the player sees, remember foreign cities/borders, and
  // raise first-contact cards for anyone newly in sight.
  function updateVision() {
    var g = state.game;
    if (!g) return;
    state.vis = Vision.remember(g, 0);
    state.visVer = (state.visVer || 0) + 1;
    Diplo.checkContacts(g).forEach(function (c) {
      var ev = Diplo.contactEvent(g, c);
      if (ev.log) Rules.logEvent(g, ev.kind, ev.text, ev.cid);
      if (c.a === 0) showContact(c.b);
    });
  }

  function showContact(cid) {
    Panels.showContact(state.game, cid);
    document.body.setAttribute("data-contact", (document.body.getAttribute("data-contact") || "") + Rules.civName(state.game, cid) + ";");
  }

  function refreshUi() {
    if (state.game && state.game._workNotice) { toast(state.game._workNotice + " · moved off the tile"); state.game._workNotice = null; }
    updateVision();
    if (state.tradeOpen) renderTrade();
    Panels.renderFeed(state.game);
    if (Panels.diplomacyOpen()) Panels.renderDiplomacy();
    updateTopBar();
    var nReq = Deals.state(state.game).pending.filter(function (p) { return p.deal.to === 0; }).length + ((state.game.diplo && state.game.diplo.asks) || []).length;
    document.getElementById("diploBtn").innerHTML = Icons.svg("ui_diplomacy", 20) + (nReq ? '<span class="req-badge">' + nReq + "</span>" : "");
    if (state.wondersOpen) renderWonders();
    if (window.PlanetUI15) window.PlanetUI15.refresh();
    updateCityPanel();
    updateUnitPanel();
    showHud(state.hover);
    render();
    if (ambientOn() || Anim.busy()) animate();
  }

  // ---------------------------------------------------------------- actions

  function selectUnit(id) {
    state.selUnit = id;
    var u = id != null ? Rules.unitById(state.game, id) : null;
    state.reach = u && u.moves > 0 ? Rules.reachable(state.game, u) : null;
    state.attack = [];
    if (u) state.cityStrike = null;
    if (u && u.moves > 0 && (Combat.strengthOf(u.type) > 0 || Ranged.isRanged(u.type))) {
      var rng = Math.max(1, Ranged.rangeOf(u.type));
      Rules.tilesInRadius(state.game, u.q, u.r, rng).forEach(function (t) {
        if (!(t.q === u.q && t.r === u.r) && Combat.canAttack(state.game, u, t.q, t.r).ok) state.attack.push(t);
      });
    }
    updateTip();
  }

  // ------------------------------------------------- combat preview tooltip
  var tip = document.getElementById("combatTip");
  function pct(v) { return (v > 0 ? "+" : "\u2212") + Math.round(Math.abs(v) * 100) + "%"; }
  function modList(mods) {
    return mods.map(function (m) {
      return '<li class="' + (m.hp ? "hp" : m.v >= 0 ? "up" : "down") + '">' + escHtml(m.label) + (m.hp ? "" : " <b>" + pct(m.v) + "</b>") + "</li>";
    }).join("");
  }
  function updateTip(sx, sy) {
    var g = state.game, u = g && state.selUnit != null ? Rules.unitById(g, state.selUnit) : null, t = state.hover;
    var pv = u && t && u.owner === 0 ? Combat.preview(g, u, t.q, t.r) : null;
    if (g && t && state.cityStrike != null) pv = Ranged.cityPreview(g, Rules.cityById(g, state.cityStrike), t.q, t.r);
    if (!pv || !pv.ok) { tip.classList.add("hidden"); return; }
    var a = pv.attacker, d = pv.defender, cls = /victory|Favourable|falls|Capture|Raze|kill|strong/i.test(pv.outcome) ? "good" : /defeat|Costly|weak/.test(pv.outcome) ? "bad" : "even";
    var body;
    if (pv.kind === "capture" || pv.kind === "settler") {
      body = '<div class="ct-out good">' + escHtml(pv.outcome) + "</div>";
    } else {
      body = '<div class="ct-cols"><div class="ct-side"><div class="ct-who">' + escHtml(a.name) + '</div><div class="ct-str">' + a.value.toFixed(1) +
        '</div><div class="ct-base">base ' + a.base + " · " + a.hp + " HP</div><ul>" + modList(a.mods) + "</ul></div>" +
        '<div class="ct-vs">vs</div><div class="ct-side"><div class="ct-who">' + escHtml(d.name) + '</div><div class="ct-str">' + d.value.toFixed(1) +
        '</div><div class="ct-base">base ' + (+d.base).toFixed(d.base % 1 ? 1 : 0) + " · " + d.hp + " HP</div><ul>" + modList(d.mods) + "</ul></div></div>" +
        '<div class="ct-exp"><span>Deals <b>~' + pv.expDealt + "</b></span><span>Takes <b>~" + pv.expTaken + "</b></span></div>" +
        '<div class="ct-out ' + cls + '">' + escHtml(pv.outcome) + "</div>";
    }
    if (pv.ranged) body = body.replace(/<span>Takes <b>~0<\/b><\/span>/, '<span class="ct-safe">No retaliation</span>');
    tip.innerHTML = '<div class="ct-head">' + (pv.ranged ? "Ranged attack · range " + pv.range : "Attack") + "</div>" + body;
    tip.classList.remove("hidden");
    if (sx == null) {
      var p = hexToPixel(t.q, t.r);
      sx = state.cam.x + p[0] * state.cam.zoom; sy = state.cam.y + p[1] * state.cam.zoom;
    }
    var w = tip.offsetWidth, h = tip.offsetHeight, W = canvas.clientWidth, H = canvas.clientHeight;
    var off = Math.max(26, HEX * state.cam.zoom * 1.05);   // clear the hovered hex
    var x = sx + off, y = sy - h / 2;
    if (x + w > W - 8) x = sx - w - off;
    tip.style.left = Math.round(clamp(x, 8, W - w - 8)) + "px";
    tip.style.top = Math.round(clamp(y, 56, H - h - 8)) + "px";
  }

  function doAttack(u, tile) {
    var g = state.game;
    var res = Combat.attack(g, u.id, tile.q, tile.r);
    if (!res.ok) { toast(res.reason); return; }
    var msg = res.events.map(function (e) { return e.text; }).join(" · ");
    if (msg) toast(msg);
    checkEliminations();
    consumeFx();
    selectUnit(Rules.unitById(g, u.id) ? u.id : null);
    refreshUi();
  }

  // Toast when a civ's capital moves (combat.js relocates it after a capture).
  function checkCapitals() {
    var g = state.game;
    var now = {};
    g.cities.forEach(function (c) { if (c.capital) now[c.owner] = c; });
    if (state.capitals) {
      g.civs.forEach(function (cv, i) {
        var was = state.capitals[i], c = now[i];
        if (was != null && c && c.id !== was && !cv.eliminated) {
          var text = Rules.civName(g, i) + " moves its capital to " + c.name;
          toast(text);
          showNotice(text, i);
        }
      });
    }
    state.capitals = {};
    for (var k in now) state.capitals[k] = now[k].id;
  }

  // A small banner under the top bar for big events (capital moved).
  function showNotice(text, cid) {
    var el = document.getElementById("notice");
    var C = colorsFor(cid);
    el.innerHTML = '<span class="nt-star">\u2605</span>' + escHtml(text);
    el.style.borderColor = C.ring;
    el.style.setProperty("--nt-fill", C.fill);
    el.classList.remove("hidden");
    clearTimeout(state.noticeTimer);
    if (!params.shot && !params.capdemo) state.noticeTimer = setTimeout(function () { el.classList.add("hidden"); }, 6000);
  }

  function checkEliminations() {
    var g = state.game;
    checkCapitals();
    state.elimSeen = state.elimSeen || {};
    g.civs.forEach(function (cv, i) {
      if (cv.eliminated && !state.elimSeen[i]) {
        state.elimSeen[i] = true;
        toast(i === 0 ? "Your civilization has been eliminated. You may keep watching." : "The " + cv.design.people + " of " + cv.design.name + " have been eliminated!");
      }
    });
  }

  function unitsAt(tile) {
    return state.game.units.filter(function (u) { return u.owner === 0 && u.q === tile.q && u.r === tile.r; });
  }

  function handleTileClick(tile) {
    var g = state.game;
    if (!tile || !g) return;
    var k = Rules.key(tile.q, tile.r);
    var sel = state.selUnit != null ? Rules.unitById(g, state.selUnit) : null;
    if (state.buyTile != null) {
      var bres = Econ.buyTile(g, state.buyTile, tile.q, tile.r);
      if (bres.ok) { toast(bres.text); refreshUi(); return; }
      if (!g.owner.has(k) || g.owner.get(k) !== state.buyTile) toast(bres.reason);
      state.buyTile = null;
    }
    if (state.cityStrike != null) {
      var cres = Ranged.cityStrike(g, state.cityStrike, tile.q, tile.r);
      if (cres.ok) {
        toast(cres.events.map(function (e) { return e.text; }).join(" · ") || "Struck");
        state.cityStrike = null; state.attack = [];
        consumeFx(); refreshUi(); return;
      }
      state.cityStrike = null; state.attack = [];
      toast(cres.reason);
      refreshUi();
    }
    if (sel && sel.owner === 0 && Ranged.isRanged(sel.type) && Rules.hexDistance(sel.q, sel.r, tile.q, tile.r) === 2) {
      var rca = Combat.canAttack(g, sel, tile.q, tile.r);
      if (rca.ok) { doAttack(sel, tile); return; }
      var rfoe = g.units.some(function (o) { return o.owner !== 0 && o.q === tile.q && o.r === tile.r; }) || (g.cityAt.has(k) && g.cityAt.get(k).owner !== 0);
      if (rfoe && tileVisible(k)) { toast(rca.reason); return; }
    }
    if (sel && sel.owner === 0 && Rules.hexDistance(sel.q, sel.r, tile.q, tile.r) === 1) {
      var ca = Combat.canAttack(g, sel, tile.q, tile.r);
      if (ca.ok) { doAttack(sel, tile); return; }
      var foe = g.units.filter(function (o) { return o.owner !== 0 && o.q === tile.q && o.r === tile.r; })[0];
      var fc = g.cityAt.get(k);
      var other = foe ? foe.owner : fc && fc.owner !== 0 ? fc.owner : -1;
      if (other > 0 && tileVisible(k)) {
        toast(Combat.atWar(g, 0, other) ? ca.reason : "At peace with " + Rules.civName(g, other) + " · declare war in Diplomacy (D) to attack");
        return;
      }
    }
    if (window.PlanetUI15 && window.PlanetUI15.mapClick(tile)) return;
    if (sel && sel.owner === 0 && state.reach && state.reach.has(k) && !(tile.q === sel.q && tile.r === sel.r) && state.shiftClick && sel.goto) {
      window.PlanetUI15.gotoClick(sel, tile, true); return;
    }
    if (sel && sel.owner === 0 && !(state.reach && state.reach.has(k)) && !(tile.q === sel.q && tile.r === sel.r) && !unitsAt(tile).length &&
        window.PlanetUI15 && window.PlanetUI15.gotoClick(sel, tile, !!state.shiftClick)) return;
    if (sel && state.reach && state.reach.has(k) && !(tile.q === sel.q && tile.r === sel.r)) {
      if (sel.goto || sel.order) { sel.goto = null; sel.order = null; }
      var res = Rules.moveUnit(g, sel.id, tile.q, tile.r);
      if (!res.ok) toast(res.reason);
      selectUnit(sel.id);
      refreshUi();
      return;
    }
    var here = unitsAt(tile);
    if (here.length) {
      // Clicking a stack cycles through it. Clicking an already selected lone
      // unit keeps it, unless a city stands there, in which case open the city.
      var idx = sel ? here.indexOf(sel) : -1;
      if (idx === -1 || here.length > 1 || !(g.cityAt.has(k) && g.cityAt.get(k).owner === 0)) {
        selectUnit(here[(idx + 1) % here.length].id);
        if (g.cityAt.has(k) && g.cityAt.get(k).owner === 0) state.selCity = g.cityAt.get(k).id;
        refreshUi();
        return;
      }
    }
    var city = g.cityAt.get(k);
    selectUnit(null);
    state.selCity = city && city.owner === 0 ? city.id : null;
    refreshUi();
  }

  function nextUnit() {
    var g = state.game;
    for (var i = 0; i < g.units.length; i++) {
      var u = g.units[i];
      if (u.owner === 0 && u.moves > 0 && !u.work && !u.fortifying && !(u.fort && Combat.strengthOf(u.type) > 0) && (!window.PlanetOrders || window.PlanetOrders.needsOrders(g, u))) return u;
    }
    return null;
  }

  function cancelSelectedJob() {
    var u = state.selUnit != null ? Rules.unitById(state.game, state.selUnit) : null;
    if (!u || u.owner !== 0 || !u.work) return false;
    var res = Roads.cancelWork(state.game, u.id);
    toast(res.ok ? res.text + " · " + fmtMoves(u.moves) + " moves left" : res.reason);
    selectUnit(u.id);
    refreshUi();
    return true;
  }

  // ---- Trade panel (R)
  var tradeOverlay = document.getElementById("tradeOverlay");
  function openTrade() { state.tradeOpen = true; tradeOverlay.classList.remove("hidden"); renderTrade(); }
  function closeTrade() { state.tradeOpen = false; tradeOverlay.classList.add("hidden"); }
  function toggleTrade() { if (state.tradeOpen) closeTrade(); else if (state.game) openTrade(); }
  function renderTrade() {
    var g = state.game, html = "", mine = [], incoming = [];
    Trade.routes(g).forEach(function (r) {
      var a = Rules.cityById(g, r.from), b = Rules.cityById(g, r.to);
      if (!a || !b) return;
      if (a.owner === 0) mine.push(r); else if (b.owner === 0) incoming.push(r);
    });
    var row = function (r, side) {
      var a = Rules.cityById(g, r.from), b = Rules.cityById(g, r.to), y = Trade.yieldOf(g, r);
      var who = function (c) { return escHtml(c.name) + (c.owner !== 0 ? ' <small style="color:#9fb0bd">(' + escHtml(Rules.civName(g, c.owner)) + ")</small>" : ""); };
      var yields = side === "out"
        ? "+" + y.home + " gold in " + escHtml(a.name) + " · " + escHtml(b.name) + " +" + y.dest + " " + (y.destKind === "prod" ? "production" : y.destKind)
        : "+" + y.dest + " gold in " + escHtml(b.name) + " (their " + escHtml(a.name) + " +" + y.home + ")";
      if (y.science) yields += " · +1 science each";
      return '<div class="tr-row ' + (y.foreign ? "foreign" : "domestic") + '"><span>' + who(a) + " → " + who(b) + '</span><span class="tr-y">' + yields +
        '</span><span class="tr-t' + (r.turns <= 5 ? " low" : "") + '">' + r.turns + (r.turns === 1 ? " turn" : " turns") + "</span></div>";
    };
    html += '<div class="tr-sec">Your routes</div>';
    html += mine.length ? mine.map(function (r) { return row(r, "out"); }).join("") :
      '<div class="tr-empty">No routes yet. Build a Caravan (Currency), move it next to another of your cities or a city of a civ you are at peace with, and choose Trade.</div>';
    if (incoming.length) html += '<div class="tr-sec">Routes into your cities</div>' + incoming.map(function (r) { return row(r, "in"); }).join("");
    var inc = Trade.incomeOf(g, 0);
    var slots = Rules.citiesOf(g, 0).map(function (c) { return escHtml(c.name) + " " + Trade.routesFrom(g, c.id).length + "/" + Trade.slots(c); });
    html += '<div class="tr-tot">Route income per turn: <b>+' + inc.gold + " gold</b>" + (inc.food ? " · +" + inc.food + " food" : "") + (inc.prod ? " · +" + inc.prod + " production" : "") +
      (inc.science ? " · +" + inc.science + " science" : "") + "</div>";
    if (slots.length) html += '<div class="tr-empty">Route slots (1, +1 Market, +1 per 8 pop): ' + slots.join(" · ") + ". Routes last " + Trade.ROUTE_TURNS + " turns; a new Caravan renews one. War cancels routes with that civ.</div>";
    document.getElementById("tradeList").innerHTML = html;
  }
  tradeOverlay.addEventListener("click", function (ev) {
    if (ev.target === tradeOverlay || ev.target.closest("#tradeClose")) closeTrade();
  });
  document.getElementById("tradeBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); toggleTrade(); });

  function unloadSelected() {
    var u = state.selUnit != null ? Rules.unitById(state.game, state.selUnit) : null;
    if (!u || !Naval.isNaval(u.type)) return;
    var res = Naval.unload(state.game, u.id);
    toast(res.ok ? res.text : res.reason);
    selectUnit(u.id);
    refreshUi();
  }

  function boardSelected() {
    var g = state.game, u = state.selUnit != null ? Rules.unitById(g, state.selUnit) : null;
    var ship = u && Naval.transportAt(g, 0, u.q, u.r, u);
    if (!ship) return;
    var res = Naval.board(g, u.id, ship.id);
    toast(res.ok ? res.text : res.reason);
    selectUnit(ship.id);
    refreshUi();
  }

  function fortifySelected() {
    if (state.selUnit == null) return;
    var res = Combat.fortify(state.game, state.selUnit);
    if (!res.ok) { toast(res.reason); return; }
    toast("Fortifying: +25% defense from next turn");
    var n = nextUnit();
    selectUnit(n ? n.id : null);
    refreshUi();
  }

  function foundSelected() {
    var g = state.game;
    if (state.selUnit == null) return;
    var res = Rules.foundCity(g, state.selUnit);
    if (!res.ok) { toast(res.reason); return; }
    selectUnit(null);
    state.selCity = res.city.id;
    toast(res.city.name + " founded by the " + PLAYER.civ.people);
    refreshUi();
  }

  function endTurnAction() {
    var g = state.game;
    if (Story && Story.state(g).pending.length && !g._autoPlayer) { showStory(); return; }
    if (!g._autoPlayer && window.PlanetOrders && state.idleWarned !== g.turn) {
      var idle = window.PlanetOrders.idleUnits(g, 0).filter(function (u) { return Combat.strengthOf(u.type) > 0 || Rules.UNIT_TYPES[u.type].canFound || u.type === "missionary"; });
      if (idle.length) {
        state.idleWarned = g.turn;
        selectUnit(idle[0].id);
        if (!onScreen(idle[0].q, idle[0].r)) panTo(idle[0].q, idle[0].r);
        toast(idle.length + (idle.length === 1 ? " unit still needs" : " units still need") + " orders (N cycles) · press End Turn again to skip them");
        refreshUi();
        return;
      }
    }
    state.buyTile = null;
    state.cityStrike = null;
    hideSummary();
    var logMark = g.log[g.log.length - 1] || null, logLen = g.log.length;
    var snap = Anim.settings.on && !g._autoPlayer ? Anim.snapshot(g) : null;
    Anim.beginCapture();
    var aiEvents;
    try { aiEvents = AI.takeTurns(g); } finally { Anim.endCapture(); }
    var res = Rules.endTurn(g);
    var hits = (g.fx || []).filter(function (f) { return f.kind === "lunge" && f.target === 0; }).length;
    res.events = aiEvents.filter(function (e) { return e.cid === 0; }).concat(res.events);
    if (hits) res.events.unshift({ cid: 0, kind: "combat", text: hits + (hits === 1 ? " attack" : " attacks") + " on your forces" });
    var mine = res.events.filter(function (e) { return e.cid === 0 || (e.kind === "war"); });
    var msgs = mine.filter(function (e) { return e.kind !== "choose" && e.kind !== "contact"; }).map(function (e) { return e.text; });
    var choose = mine.filter(function (e) { return e.kind === "choose"; });
    if (choose.length) msgs.push(choose.map(function (e) { return e.text.replace(" needs a production choice", ""); }).join(", ") + " needs a production choice");
    if (Rules.citiesOf(g, 0).length && !g.tech.current && !treeDone(g)) msgs.push("Choose a technology to research (T)");
    // Everything logged since End Turn (AI moves, battles, contacts, end-of-turn
    // results) plus this turn's production choices.
    var mi = logMark ? g.log.lastIndexOf(logMark) : -1;
    var since = mi >= 0 ? g.log.slice(mi + 1) : g.log.slice(Math.max(0, g.log.length - (g.log.length - logLen)));
    var sumEvents = since.map(function (e) { return { kind: e.kind, text: e.text, q: e.q, r: e.r }; })
      .concat(mine.filter(function (e) { return e.kind === "choose"; }));
    var shown = showSummary(buildSummary(sumEvents, g), g.turn);
    if (msgs.length && !shown) toast(msgs.join(" · "));
    res.events.forEach(function (e) { if (e.kind === "contact" && e.contact && e.contact.a === 0) showContact(e.contact.b); });
    res.events.forEach(function (e) { if (e.kind === "wonder" && e.wonder && e.cid === 0) showWonderCard(e.wonder); });
    var eraEv = res.events.filter(function (e) { return e.kind === "era" && e.cid === 0; }).pop();
    if (eraEv && !g._autoPlayer) StoryUI.showEra(g, Eras.eraOf(g, 0), showStory); else showStory();
    if (g._wonderLost && g._wonderLost.length) {
      g._wonderLost.forEach(function (l) { showNotice(Rules.civName(g, l.by) + " completed the " + Wonders.WONDERS[l.id].name + " first · " + l.gold + " production became gold"); });
      g._wonderLost = [];
    }
    // Select the first unit that can still move, else a city that needs orders.
    var next = nextUnit();
    selectUnit(next ? next.id : null);
    if (!next && choose.length) state.selCity = choose[0].city;
    if (state.selCity != null && !Rules.cityById(g, state.selCity)) state.selCity = null;
    if (state.selCity != null && Rules.cityById(g, state.selCity).owner !== 0) state.selCity = null;
    checkEliminations();
    refreshUi();
    if (snap) Anim.diff(g, snap, tileVisible);
    // The camera glides to the next unit that needs orders if it is off-screen.
    if (next && !g._autoPlayer && !onScreen(next.q, next.r)) panTo(next.q, next.r);
    consumeFx();
    animate();
    saveNow();
  }

  function centerOn(q, r, zoom) {
    Anim.stopCam();
    var p = hexToPixel(q, r);
    state.cam.zoom = zoom;
    state.cam.x = canvas.clientWidth / 2 - p[0] * zoom;
    state.cam.y = canvas.clientHeight / 2 - p[1] * zoom;
  }

  function setWorld(world) {
    state.seed = world.seed;
    state.tiles = world.tiles;
    state.index = new Map();
    for (var i = 0; i < world.tiles.length; i++) {
      var t = world.tiles[i];
      state.index.set(t.q + "," + t.r, t);
    }
  }

  // Map only, no game: the backdrop behind the creator screen.
  function previewWorld(seed) {
    var world = generate(seed || DEFAULT_SEED, state.size);
    setWorld(world);
    state.game = null;
    resizeCanvas();
    fit(world.tiles);
    state.fitZoom = state.cam.zoom;
    render();
  }

  function startGame(world, civ) {
    state.capitals = null; state.elimSeen = null;
    if (civ) state.civ = Civ.normalize(civ);
    if (!state.civ) state.civ = Civ.normalize(Civ.DEFAULT_CIV);
    applyCiv(state.civ);
    state.seed = world.seed;
    state.tiles = world.tiles;
    state.index = new Map();
    for (var i = 0; i < world.tiles.length; i++) {
      var t = world.tiles[i];
      state.index.set(t.q + "," + t.r, t);
    }
    colorCache = {};
    state.game = Rules.newGame(world, newSetup(state.civ, world.seed, state.rivals));
    state.hover = null;
    state.selCity = null;
    seedLabel.textContent = world.seed;
    seedInput.value = world.seed;
    document.title = "Planet " + world.seed;
    fit(world.tiles);
    state.fitZoom = state.cam.zoom;
    var settler = firstSettler();
    selectUnit(settler.id);
    centerOn(settler.q, settler.r, state.fitZoom * 2.6);
    refreshUi();
    saveNow();
  }

  // ---------------------------------------------------------------- save
  // Camera is saved resolution-independently: world point at screen centre
  // plus zoom relative to the fit-to-screen zoom.
  function cameraState() {
    var z = state.cam.zoom;
    return {
      cx: (canvas.clientWidth / 2 - state.cam.x) / z,
      cy: (canvas.clientHeight / 2 - state.cam.y) / z,
      zr: z / (state.fitZoom || z)
    };
  }

  function applyCamera(c) {
    if (!c || !isFinite(c.cx) || !isFinite(c.cy)) return false;
    var z = clamp((c.zr || 2.6) * state.fitZoom, state.fitZoom * 0.6, 8);
    state.cam.zoom = z;
    state.cam.x = canvas.clientWidth / 2 - c.cx * z;
    state.cam.y = canvas.clientHeight / 2 - c.cy * z;
    return true;
  }

  // ------------------------------------------------------------ save slots
  var savesOverlay = document.getElementById("savesOverlay");
  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  // mode: "load" (from the welcome card or the panel) or "save" (Save button).
  function openSaves(mode) {
    state.savesMode = mode;
    state.savesConfirm = null;
    renderSaves();
    savesOverlay.classList.remove("hidden");
  }
  function closeSaves() { savesOverlay.classList.add("hidden"); state.savesMode = null; }
  function renderSaves() {
    var mode = state.savesMode, list = Save.listSlots(), html = "";
    document.getElementById("savesTitle").textContent = mode === "save" ? "Save game" : "Load game";
    list.forEach(function (s) {
      var sm = s.summary, auto = s.slot === 0;
      if (mode === "save" && auto) return;
      if (mode === "load" && !sm) return;
      var meta = sm ? escHtml(sm.civ && sm.civ.name || "?") + " · Turn " + sm.turn + " · " + escHtml(sm.year) + " · " +
        escHtml((Gen.SIZES[sm.size] || Gen.SIZES.standard).name) + " map · " + sm.cities + (sm.cities === 1 ? " city" : " cities") + " · " + when(sm.savedAt) : "Empty slot";
      var acts = "";
      if (state.savesConfirm === s.slot) {
        acts = '<span class="sv-q">Delete?</span><button type="button" class="danger" data-sv="del-yes" data-slot="' + s.slot + '">Delete</button><button type="button" data-sv="del-no">Keep</button>';
      } else if (mode === "save") {
        var def = state.game ? (state.civ.name + " · T" + state.game.turn) : "";
        acts = '<input type="text" maxlength="40" id="svName' + s.slot + '" value="' + escHtml(sm ? sm.name : def) + '"><button type="button" data-sv="save" data-slot="' + s.slot + '">' + (sm ? "Overwrite" : "Save here") + "</button>";
      } else {
        acts = '<button type="button" data-sv="load" data-slot="' + s.slot + '">Load</button>' +
          '<button type="button" class="danger" data-sv="del" data-slot="' + s.slot + '">Delete</button>';
      }
      html += '<div class="sv-row' + (sm ? "" : " empty") + (state.slot === s.slot && state.game ? " current" : "") + '">' +
        '<canvas data-badge="' + s.slot + '" width="80" height="80"></canvas><div><div class="sv-name">' + escHtml(sm ? sm.name : (auto ? "Autosave" : "Slot " + s.slot)) +
        "<small>" + (auto ? "autosave" : "slot " + s.slot) + '</small></div><div class="sv-meta">' + meta + '</div></div><div class="sv-acts">' + acts + "</div></div>";
    });
    if (!html) html = '<div class="sv-meta">No saved games yet.</div>';
    document.getElementById("savesList").innerHTML = html;
    list.forEach(function (s) {
      var cv = document.querySelector('canvas[data-badge="' + s.slot + '"]');
      if (!cv || !s.summary || !s.summary.civ) return;
      var c2 = cv.getContext("2d");
      Civ.drawBadge(c2, 40, 40, 34, Civ.normalize(s.summary.civ), "hex");
    });
  }
  savesOverlay.addEventListener("click", function (ev) {
    if (ev.target === savesOverlay || ev.target.closest("#savesClose")) { closeSaves(); return; }
    var b = ev.target.closest("[data-sv]");
    if (!b) return;
    var act = b.getAttribute("data-sv"), slot = +b.getAttribute("data-slot");
    if (act === "save") {
      var nm = document.getElementById("svName" + slot).value.trim();
      var res = Save.write(state.game, state.civ, cameraState(), slot, nm || (state.civ.name + " · T" + state.game.turn));
      if (res.ok) state.slot = slot;
      toast(res.ok ? "Saved to slot " + slot + " · " + res.data.name : "Save failed: " + res.reason);
      renderSaves();
    } else if (act === "load") {
      var data = Save.readSlot(slot);
      if (!data) return;
      closeSaves();
      if (Creator.isOpen && Creator.isOpen()) Creator.close();
      resumeGame(data);
      state.slot = slot;
      toast("Loaded " + (data.name || "save") + " · Turn " + data.game.turn);
      stateProbe("slot" + slot);
    } else if (act === "del") { state.savesConfirm = slot; renderSaves(); }
    else if (act === "del-no") { state.savesConfirm = null; renderSaves(); }
    else if (act === "del-yes") { Save.deleteSlot(slot); state.savesConfirm = null; if (state.slot === slot) state.slot = null; renderSaves(); }
  });
  document.getElementById("savesExport").addEventListener("click", function () {
    var d = state.game ? Save.build(state.game, state.civ, cameraState()) : Save.read();
    if (d) Save.download(d);
  });
  document.getElementById("savesImport").addEventListener("click", function () { document.getElementById("savesImportFile").click(); });
  document.getElementById("savesImportFile").addEventListener("change", function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    Save.parseFile(f, function (err, data) {
      if (err) { toast("Import failed: " + (err.message || err)); return; }
      closeSaves();
      if (Creator.isOpen && Creator.isOpen()) Creator.close();
      resumeGame(data); saveNow();
      toast("Imported save · Turn " + state.game.turn);
    });
    ev.target.value = "";
  });

  // ------------------------------------------------------- turn summary
  var LS_SUMMARY = "civPlanet.summary";
  state.showSummary = (function () { try { return localStorage.getItem(LS_SUMMARY) !== "0"; } catch (e) { return true; } })();
  var summaryEl = document.getElementById("turnSummary");

  // Where a summary line points: its city, else a known city named in the text.
  function locateLine(e) {
    var g = state.game;
    if (e.q != null) return { q: e.q, r: e.r };
    if (e.ref) return locateLine({ kind: e.kind, text: e.ref });
    var c = e.city != null ? Rules.cityById(g, e.city) : null;
    if (c) return { q: c.q, r: c.r };
    var best = null;
    knownCities(g).forEach(function (kc) { if (!best && e.text.indexOf(kc.c.name) !== -1) best = kc.c; });
    if (best) return { q: best.q, r: best.r };
    if (e.kind === "contact" || e.kind === "war") {
      for (var i = 1; i < g.civs.length; i++) {
        if (e.text.indexOf(g.civs[i].design.name) === -1) continue;
        var kc2 = knownCities(g).filter(function (x) { return x.c.owner === i; })[0];
        if (kc2) return { q: kc2.c.q, r: kc2.c.r };
        var u = g.units.filter(function (x) { return x.owner === i && tileVisible(Rules.key(x.q, x.r)); })[0];
        if (u) return { q: u.q, r: u.r };
      }
    }
    return null;
  }

  var SUMMARY_TAG = { growth: "Growth", built: "Built", tech: "Tech", combat: "Battle", war: "War", contact: "Contact", unrest: "Unrest",
    trade: "Trade", choose: "Orders", research: "Research", capital: "Capital", elim: "War", work: "Worker", info: "Note", pillage: "Pillage", plunder: "Plunder", gov: "Govt", religion: "Faith", orders: "Orders" };
  function showSummary(lines, turn) {
    state.summary = lines;
    if (!state.showSummary || !lines.length) { summaryEl.classList.add("hidden"); return false; }
    summaryEl.innerHTML = '<div class="ts-head">Turn ' + turn + " <small>since your last turn · Esc to close</small></div>" +
      lines.map(function (l, i) {
        var go = l.action || locateLine(l);
        l.go = go;
        return '<div class="ts-line' + (go ? "" : " nogo") + '" data-ts="' + i + '"><span class="ts-tag ' + l.kind + '">' + (SUMMARY_TAG[l.kind] || l.kind) +
          "</span><span>" + escHtml(l.text) + "</span></div>";
      }).join("");
    summaryEl.classList.remove("hidden");
    return true;
  }
  function hideSummary() { summaryEl.classList.add("hidden"); }
  summaryEl.addEventListener("click", function (ev) {
    var row = ev.target.closest("[data-ts]");
    if (!row) return;
    var l = state.summary[+row.getAttribute("data-ts")];
    if (!l || !l.go) return;
    if (l.go === "tree") { toggleTree(); return; }
    panTo(l.go.q, l.go.r, Math.max(state.cam.zoom, state.fitZoom * 2.6));
    var c = state.game.cityAt.get(Rules.key(l.go.q, l.go.r));
    if (c && c.owner === 0) state.selCity = c.id;
    refreshUi();
  });
  // Clicking the map (anywhere outside the card) dismisses it.
  canvas.addEventListener("pointerdown", function () { hideSummary(); Anim.stopCam(); });

  // Build the card from this turn's events plus research and trade lines.
  function buildSummary(events, g) {
    var lines = [], seen = {};
    events.forEach(function (e) {
      if (e.kind === "choose") return;
      var key = e.kind + "|" + e.text;
      if (seen[key]) return;
      seen[key] = true;
      lines.push({ kind: e.kind === "elim" ? "war" : e.kind === "info" && /disband/i.test(e.text) ? "info" : e.kind, text: e.text, city: e.city, q: e.q, r: e.r });
    });
    // Keep it compact: up to 3 losses/kills spelled out, other battles folded
    // into one line; at most 4 growth and 4 build lines.
    var fights = lines.filter(function (l) { return l.kind === "combat"; });
    if (fights.length > 3) {
      var big = fights.filter(function (l) { return /destroyed|captured|razed|took/i.test(l.text); });
      var keep = big.slice(0, 3), rest = fights.length - keep.length;
      lines = lines.filter(function (l) { return l.kind !== "combat"; });
      keep.forEach(function (l) { lines.push(l); });
      if (rest) lines.push({ kind: "combat", text: rest + " more " + (rest === 1 ? "clash" : "clashes") + (keep.length ? "" : " involving your units"), city: null,
        q: null, r: null, ref: (fights.filter(function (l) { return keep.indexOf(l) === -1; })[0] || {}).text });
    }
    ["growth", "built"].forEach(function (kind) {
      var ls = lines.filter(function (l) { return l.kind === kind; });
      if (ls.length <= 4) return;
      var extra = ls.slice(3);
      lines = lines.filter(function (l) { return extra.indexOf(l) === -1; });
      lines.push({ kind: kind, text: "+" + extra.length + " more: " + extra.map(function (l) { return l.text; }).join(" · ") });
    });
    var choose = events.filter(function (e) { return e.kind === "choose"; });
    if (choose.length) lines.push({ kind: "choose", text: choose.map(function (e) { return e.text.replace(" needs a production choice", ""); }).join(", ") + (choose.length === 1 ? " needs" : " need") + " a production choice", city: choose[0].city });
    if (Rules.citiesOf(g, 0).length && !g.tech.current && !treeDone(g)) lines.push({ kind: "research", text: "Choose a technology to research (T)", action: "tree" });
    var conn = Roads.connected(g, 0), ids = Object.keys(conn);
    if (ids.length) {
      var gold = ids.reduce(function (s, id) { var c = Rules.cityById(g, +id); return s + (c ? Roads.tradeGold(c) : 0); }, 0);
      lines.push({ kind: "trade", text: ids.length + (ids.length === 1 ? " city" : " cities") + " connected to the capital: +" + gold + " gold" });
    }
    var ti = Trade.incomeOf(g, 0);
    if (ti.n) lines.push({ kind: "trade", text: ti.n + (ti.n === 1 ? " trade route" : " trade routes") + ": +" + ti.gold + " gold" + (ti.food ? ", +" + ti.food + " food" : "") + (ti.prod ? ", +" + ti.prod + " production" : "") + (ti.science ? ", +" + ti.science + " science" : "") + " (R)" });
    var order = { combat: 0, war: 0, pillage: 0, plunder: 0, capital: 0, unrest: 1, contact: 2, tech: 3, research: 3, built: 4, choose: 5, growth: 6, work: 7, trade: 8 };
    lines.sort(function (a, b) { return (order[a.kind] != null ? order[a.kind] : 6) - (order[b.kind] != null ? order[b.kind] : 6); });
    return lines;
  }

  function saveNow(manual) {
    if (!state.game) return null;
    if (manual) { openSaves("save"); return null; }
    var res = Save.write(state.game, state.civ, cameraState());
    if (manual) toast(res.ok ? "Game saved · Turn " + state.game.turn + " · " + Rules.yearLabel(state.game.turn) : "Save failed: " + res.reason);
    return res;
  }

  function resumeGame(data) {
    state.capitals = null; state.elimSeen = null;
    var civ = Civ.normalize(data.civ || Civ.DEFAULT_CIV);
    var res = Save.load(data, generate, loadSetup());
    colorCache = {};
    state.civ = civ;
    applyCiv(civ);
    setWorld(res.world);
    state.game = res.game;
    state.hover = null;
    state.selCity = null;
    selectUnit(null);
    seedLabel.textContent = res.world.seed;
    seedInput.value = res.world.seed;
    document.title = "Planet " + res.world.seed;
    resizeCanvas();
    fit(res.world.tiles);
    state.fitZoom = state.cam.zoom;
    if (!applyCamera(data.camera)) {
      var focus = state.game.cities[0] || state.game.units[0];
      if (focus) centerOn(focus.q, focus.r, state.fitZoom * 2.4);
    }
    Creator.rememberLast(civ, res.world.seed);
    refreshUi();
    toast(res.warning || ("Welcome back · Turn " + state.game.turn + " · " + Rules.yearLabel(state.game.turn)));
    return res;
  }

  // ---------------------------------------------------------------- tech tree
  function openTree() {
    if (!state.game) return;
    TreeUI.open({
      game: state.game,
      scienceRate: function () { return Rules.scienceRate(state.game); },
      onPick: function (id) {
        var r = Tech.setResearch(state.game, id);
        if (!r.ok) { toast(Tech.TECHS[id].name + " is already known"); return; }
        updateTopBar();
      }
    });
  }
  function toggleTree() { if (TreeUI.isOpen()) TreeUI.close(); else openTree(); }

  function firstSettler() {
    var us = Rules.unitsOf(state.game, 0);
    for (var i = 0; i < us.length; i++) if (us[i].type === "settler") return us[i];
    return us[0];
  }

  // ---------------------------------------------------------------- input

  var drag = null;

  canvas.addEventListener("pointerdown", function (ev) {
    canvas.setPointerCapture(ev.pointerId);
    drag = { x: ev.clientX, y: ev.clientY, moved: false };
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (drag) {
      var dx = ev.clientX - drag.x;
      var dy = ev.clientY - drag.y;
      if (!drag.moved && dx * dx + dy * dy > 16) {
        drag.moved = true;
        canvas.classList.add("dragging");
      }
      if (drag.moved) {
        state.cam.x += dx;
        state.cam.y += dy;
        drag.x = ev.clientX;
        drag.y = ev.clientY;
        render();
      }
      return;
    }
    var tile = tileAtEvent(ev);
    if (tile !== state.hover) {
      state.hover = tile;
      showHud(tile);
      render();
    }
    var rect = canvas.getBoundingClientRect();
    updateTip(ev.clientX - rect.left, ev.clientY - rect.top);
  });

  canvas.addEventListener("pointerup", function (ev) {
    if (!drag) return;
    var wasClick = !drag.moved;
    drag = null;
    canvas.classList.remove("dragging");
    state.shiftClick = !!ev.shiftKey;
    if (wasClick) handleTileClick(tileAtEvent(ev));
    state.shiftClick = false;
  });
  canvas.addEventListener("pointercancel", function () {
    drag = null;
    canvas.classList.remove("dragging");
  });

  canvas.addEventListener("wheel", function (ev) {
    Anim.stopCam();
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = ev.clientX - rect.left;
    var my = ev.clientY - rect.top;
    var factor = ev.deltaY < 0 ? 1.09 : 1 / 1.09;
    var next = clamp(state.cam.zoom * factor, state.fitZoom * 0.6, 8);
    var wx = (mx - state.cam.x) / state.cam.zoom;
    var wy = (my - state.cam.y) / state.cam.zoom;
    state.cam.zoom = next;
    state.cam.x = mx - wx * next;
    state.cam.y = my - wy * next;
    state.hover = tileAtEvent(ev);
    showHud(state.hover);
    render();
  }, { passive: false });

  window.addEventListener("keydown", function (ev) {
    var tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (Creator.isOpen()) {
      if (ev.key === "Escape") document.getElementById("civSummary").classList.add("hidden");
      return;
    }
    if (!state.game) return;
    if (Panels.contactOpen()) {
      if (ev.key === "Enter" || ev.key === "Escape") { ev.preventDefault(); Panels.closeContact(state.game); }
      return;
    }
    if (DealUI.isOpen()) { if (ev.key === "Escape") DealUI.close(); return; }
    if (StoryUI.eventOpen()) { if (ev.key === "Enter" && StoryUI.resultShown()) { ev.preventDefault(); StoryUI.closeEvent(); } return; }
    if (StoryUI.eraOpen()) { if (ev.key === "Enter" || ev.key === "Escape") { ev.preventDefault(); StoryUI.closeEra(); } return; }
    if (StoryUI.chronOpen()) { if (ev.key === "Escape" || ev.key === "c" || ev.key === "C") StoryUI.closeChronicle(); return; }
    if (ev.key === "c" || ev.key === "C") { toggleChronicle(); return; }
    var U15 = window.PlanetUI15;
    if (U15 && U15.anyOpen()) {
      if (ev.key === "Escape" || ((ev.key === "g" || ev.key === "G") && U15.govOpen()) || ((ev.key === "l" || ev.key === "L") && U15.relOpen())) { U15.closeAll(); return; }
    }
    if (U15 && (ev.key === "g" || ev.key === "G")) { U15.toggleGov(); return; }
    if (U15 && (ev.key === "l" || ev.key === "L")) { U15.toggleRel(); return; }
    if (U15 && ev.key === "Escape" && U15.cancelMode()) { refreshUi(); return; }
    var su15 = state.selUnit != null ? Rules.unitById(state.game, state.selUnit) : null;
    if (ev.key === "n" || ev.key === "N" || ev.key === ".") {
      var nx = window.PlanetOrders.nextIdle(state.game, 0, state.selUnit);
      if (nx) { selectUnit(nx.id); if (!onScreen(nx.q, nx.r)) panTo(nx.q, nx.r); } else toast("No units need orders");
      refreshUi(); return;
    }
    if (su15 && su15.owner === 0 && U15) {
      var air15 = Rules.UNIT_TYPES[su15.type].air;
      if (!air15 && (ev.key === "s" || ev.key === "S")) { U15.order("sentry", su15); return; }
      if (!air15 && (ev.key === "e" || ev.key === "E")) { U15.order("explore", su15); return; }
      if (air15 && (ev.key === "a" || ev.key === "A")) { U15.airAction("strike", su15); refreshUi(); return; }
      if (air15 && (ev.key === "q" || ev.key === "Q")) { U15.airAction("rebase", su15); refreshUi(); return; }
      if (air15 && (ev.key === "p" || ev.key === "P")) { U15.airAction("patrol", su15); return; }
      if (!air15 && (ev.key === "p" || ev.key === "P") && window.PlanetPillage) { U15.pillageAction(su15); return; }
      if ((ev.key === "x" || ev.key === "X") && (su15.goto || su15.order)) { U15.order("cancel", su15); return; }
    }
    if (state.wondersOpen && (ev.key === "Escape" || ev.key === "w" || ev.key === "W")) { closeWonders(); return; }
    if (!document.getElementById("wonderCard").classList.contains("hidden") && (ev.key === "Escape" || ev.key === "Enter")) { ev.preventDefault(); hideWonderCard(); return; }
    if (ev.key === "w" || ev.key === "W") { openWonders(); return; }
    if (ev.key === "d" || ev.key === "D") { toggleDiplomacy(); return; }
    if (Panels.diplomacyOpen() && ev.key === "Escape") { Panels.closeDiplomacy(); return; }
    if (ev.key === "t" || ev.key === "T") { toggleTree(); return; }
    if (TreeUI.isOpen()) { if (ev.key === "Escape") TreeUI.close(); return; }
    if (ev.key === " " && Anim.aiBusy()) { ev.preventDefault(); skipAnimations(); return; }
    if (ev.key === "Enter") { ev.preventDefault(); if (Anim.aiBusy()) skipAnimations(); endTurnAction(); }
    else if (ev.key === "b" || ev.key === "B") { foundSelected(); }
    else if (ev.key === "f" || ev.key === "F") { fortifySelected(); }
    else if (ev.key === "u" || ev.key === "U") { unloadSelected(); }
    else if (ev.key === "x" || ev.key === "X" || ev.key === "Backspace") { if (cancelSelectedJob()) ev.preventDefault(); }
    else if (ev.key === "r" || ev.key === "R") { toggleTrade(); }
    else if (ev.key === "Escape") {
      if (state.savesMode) { closeSaves(); return; }
      if (state.tradeOpen) { closeTrade(); return; }
      if (!summaryEl.classList.contains("hidden")) { hideSummary(); return; }
      if (state.cityStrike != null) { state.cityStrike = null; state.attack = []; refreshUi(); return; }
      if (state.buyTile != null) { state.buyTile = null; refreshUi(); return; }
      selectUnit(null); state.selCity = null; refreshUi();
    }
  });

  document.getElementById("endTurn").addEventListener("click", endTurnAction);
  var dealOpts = {
    game: function () { return state.game; },
    onChange: function (res) { if (res && res.text) toast(res.text); refreshUi(); if (Panels.diplomacyOpen()) Panels.renderDiplomacy(); saveNow(); }
  };
  DealUI.bind();
  function openDeal(cid, prefill, note) { DealUI.open(dealOpts, cid, prefill, note); }
  function openDiplomacy() {
    if (!state.game) return;
    Panels.openDiplomacy({
      game: function () { return state.game; },
      onDeal: openDeal,
      onChange: function (res) { if (res && res.text) toast(res.text); refreshUi(); saveNow(); }
    });
  }
  function toggleDiplomacy() { if (Panels.diplomacyOpen()) Panels.closeDiplomacy(); else openDiplomacy(); }
  document.getElementById("diploBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); toggleDiplomacy(); });
  if (window.PlanetUI15) {
    window.PlanetUI15.init({
      game: function () { return state.game; },
      toast: function (m) { toast(m); },
      changed: function () { consumeFx(); animate(); if (state.selUnit != null) selectUnit(Rules.unitById(state.game, state.selUnit) ? state.selUnit : null); refreshUi(); saveNow(); },
      setTargets: function (tiles) { state.attack = tiles || []; render(); }
    });
    document.getElementById("govBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); window.PlanetUI15.toggleGov(); });
    document.getElementById("relBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); window.PlanetUI15.toggleRel(); });
    var stb = document.getElementById("stratBtn");
    stb.addEventListener("mouseenter", function () { if (state.game) window.PlanetUI15.showStrat(stb); });
    stb.addEventListener("mouseleave", function () { window.PlanetUI15.hideStrat(); });
    stb.addEventListener("click", function (ev) { ev.currentTarget.blur(); if (state.game) window.PlanetUI15.showStrat(stb); });
  }
  document.getElementById("ccOk").addEventListener("click", function () { Panels.closeContact(state.game); });
  document.getElementById("ccDiplo").addEventListener("click", function () { Panels.closeAllContacts(); openDiplomacy(); });
  Panels.bindDiplomacy();
  Panels.bindFeed(function () { return state.game; });
  document.getElementById("researchBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); toggleTree(); });
  document.getElementById("saveBtn").addEventListener("click", function (ev) { ev.currentTarget.blur(); saveNow(true); });
  document.getElementById("viewBtn").addEventListener("click", function (ev) {
    ev.stopPropagation();
    document.getElementById("viewPop").classList.toggle("hidden");
  });
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest(".viewmenu")) document.getElementById("viewPop").classList.add("hidden");
  });
  document.getElementById("sumExport").addEventListener("click", function () {
    var res = saveNow();
    if (res && res.ok) Save.download(res.data);
  });
  document.getElementById("civChip").addEventListener("click", function () {
    var g = state.game;
    if (!g) return;
    var cities = Rules.citiesOf(g, 0).map(function (c) { return c.name + " (" + c.pop + ")"; });
    Creator.showSummary(state.civ, {
      seed: state.seed,
      lines: [
        "Turn " + g.turn + " · " + Rules.yearLabel(g.turn) + " · " + g.gold + " gold" + (g.science ? " · " + g.science + " science" : ""),
        cities.length ? "Cities: " + cities.join(", ") : "No cities yet",
        "Units: " + Rules.unitsOf(g, 0).length + " · Rivals: " + (g.civs.length - 1) + " (" + Diplo.metCivs(g, 0).length + " met)",
        "Technologies: " + (g.tech.done.length ? g.tech.done.map(function (id) { return Tech.TECHS[id].name; }).join(", ") : "none yet")
      ]
    });
  });
  document.getElementById("unitPanel").addEventListener("click", function (ev) {
    if (window.PlanetUI15 && window.PlanetUI15.unitClick(ev, state.selUnit != null ? Rules.unitById(state.game, state.selUnit) : null)) return;
    if (ev.target.closest("#foundBtn")) foundSelected();
    if (ev.target.closest("#fortBtn")) fortifySelected();
    var jb = ev.target.closest("[data-job]");
    if (jb) {
      var wres = Roads.startWork(state.game, state.selUnit, jb.getAttribute("data-job"));
      toast(wres.ok ? wres.text : wres.reason);
      selectUnit(state.selUnit);
      refreshUi();
    }
    if (ev.target.closest("#unloadBtn")) unloadSelected();
    if (ev.target.closest("#boardBtn")) boardSelected();
    if (ev.target.closest("#cancelJobBtn")) cancelSelectedJob();
    var tb = ev.target.closest("[data-trade]");
    if (tb) {
      var tres = Trade.establish(state.game, state.selUnit, +tb.getAttribute("data-trade"), tb.getAttribute("data-kind"));
      toast(tres.ok ? tres.text : tres.reason);
      if (tres.ok) { selectUnit(null); saveNow(); }
      refreshUi();
    }
    if (ev.target.closest("[data-investigate]")) {
      var ires = Story.investigate(state.game, state.selUnit);
      toast(ires.ok ? ires.text : ires.reason);
      selectUnit(null); saveNow(); refreshUi();
    }
    if (ev.target.closest("[data-upgrade]")) {
      var ures = Econ.upgrade(state.game, state.selUnit);
      toast(ures.ok ? ures.text : ures.reason);
      selectUnit(state.selUnit);
      refreshUi();
    }
  });
  document.getElementById("cityPanel").addEventListener("click", function (ev) {
    if (ev.target.closest("#cpBuy")) {
      var br = Econ.buyBuild(state.game, state.selCity);
      toast(br.ok ? br.text : br.reason);
      refreshUi();
      return;
    }
    if (ev.target.closest("#cpStrike")) {
      var sc = Rules.cityById(state.game, state.selCity);
      if (state.cityStrike === sc.id) { state.cityStrike = null; state.attack = []; }
      else {
        selectUnit(null);
        state.cityStrike = sc.id;
        state.attack = Ranged.cityTargets(state.game, sc).map(function (x) { return x.tile; });
      }
      refreshUi();
      return;
    }
    if (ev.target.closest("#cpBuyTile")) {
      state.buyTile = state.buyTile === state.selCity ? null : state.selCity;
      selectUnit(null);
      refreshUi();
      return;
    }
    if (ev.target.id === "cpRepeat") {
      Rules.setRepeat(state.game, state.selCity, ev.target.checked);
      return;
    }
    var btn = ev.target.closest("button[data-build]");
    if (!btn || state.selCity == null) return;
    Rules.setBuild(state.game, state.selCity, btn.getAttribute("data-build"));
    refreshUi();
  });

  document.getElementById("seedForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    startGame(generate(seedInput.value.trim(), state.size));
    Creator.rememberLast(state.civ, state.seed);
    seedInput.blur();
  });

  document.getElementById("reroll").addEventListener("click", function () {
    var alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    var s = "";
    for (var i = 0; i < 6; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
    startGame(generate(s, state.size));
    Creator.rememberLast(state.civ, state.seed);
  });

  function buildLegend() {
    var el = document.getElementById("legend");
    var html = '<div class="row"><span class="river-swatch"></span>River</div>';
    for (var i = 0; i < RESOURCE_ORDER.length; i++) {
      var r = RESOURCES[RESOURCE_ORDER[i]];
      html += '<div class="row"><span class="badge ic-badge">' + Icons.svg(RESOURCE_ORDER[i], 15) + "</span>" + r.name + "</div>";
    }
    html += '<div class="row"><span class="badge ic-badge">' + Icons.svg("m_anomaly", 15) + "</span>Anomaly</div>";
    el.innerHTML = html;
  }

  function bindToggle(idName, apply) {
    var box = document.getElementById(idName);
    box.addEventListener("change", function () {
      apply(box.checked);
      box.blur();
      refreshUi();
    });
  }
  bindToggle("showRivers", function (on) { state.showRivers = on; });
  document.getElementById("showSummary").checked = state.showSummary;
  bindToggle("showSummary", function (on) {
    state.showSummary = on;
    try { localStorage.setItem(LS_SUMMARY, on ? "1" : "0"); } catch (e) { /* storage blocked */ }
    if (!on) hideSummary();
  });
  bindToggle("showResources", function (on) { state.showResources = on; });
  bindToggle("showFog", function (on) { state.showFog = on; });
  bindToggle("showLegend", function (on) {
    document.getElementById("legend").classList.toggle("hidden", !on);
  });
  buildLegend();

  window.addEventListener("resize", function () {
    resizeCanvas();
    render();
  });

  // --------------------------------------------------------------- autoplay
  // ?autoplay=N drives the real UI paths: click settler, click a destination,
  // press B, then press Enter N times (warriors wander toward the frontier).
  function key(ev) { window.dispatchEvent(new KeyboardEvent("keydown", { key: ev, bubbles: true })); }

  function autoplay(turns) {
    var g = state.game;
    // The autoplayed player answers proposals like an AI (deals.js).
    Object.defineProperty(g, "_autoPlayer", { value: true, writable: true, configurable: true, enumerable: false });
    var log = [], turnMs = [];
    var settler = firstSettler();
    key("Escape");
    handleTileClick(state.index.get(Rules.key(settler.q, settler.r)));
    log.push("selected=" + (state.selUnit === settler.id));
    var target = g.suggested;
    if (!state.reach || !state.reach.has(Rules.key(target.q, target.r))) {
      var best = null;
      state.reach.forEach(function (n) {
        if (!best || Rules.siteScore(g, n.tile) > Rules.siteScore(g, best)) best = n.tile;
      });
      target = best;
    }
    handleTileClick(state.index.get(Rules.key(target.q, target.r)));
    log.push("moved=" + (settler.q === target.q && settler.r === target.r));
    key("b");
    log.push("cities=" + g.cities.length);
    // Pick research through the real tree UI: open with T, click a locked tech (queues its path), close.
    key("t");
    var card = document.querySelector('#ttBoard .tt-card[data-tech="' + (params.research || "currency") + '"]');
    if (card) card.click();
    key("Escape");
    log.push("research=" + g.tech.current + ">" + g.tech.queue.join(">"));
    // Each turn the player's side is played by the same AI (research when empty,
    // builds when a city asks, settlers and explorers), then Enter ends the turn
    // and every rival plays through Rules.endTurn as usual.
    var contacts = 0;
    for (var t = 0; t < turns; t++) {
      AI.takeTurn(g, 0);
      refreshUi();
      if (Panels.contactOpen()) {
        contacts++;
        if (params.stopAtContact) break;
        Panels.closeAllContacts();
      }
      var te0 = performance.now();
      key("Enter");
      turnMs.push(performance.now() - te0);
      if (Panels.contactOpen()) {
        contacts++;
        if (params.stopAtContact) break;
        Panels.closeAllContacts();
      }
    }
    log.push("contacts=" + contacts);
    // Staged scenes after autoplay may want the player's cards to wait for a click.
    g._autoPlayer = !params.stage || ["wonder", "chronicle", "late"].indexOf(params.stage) !== -1;
    log.push("eras=" + Eras.state(g).civ.map(function (e) { return Eras.eraName(e); }).join("/"), "year=" + Rules.yearLabel(g.turn).replace(" ", ""),
      "events=" + JSON.stringify(Story.state(g).count).replace(/"/g, ""), "chronicle=" + Story.state(g).chronicle.length, "launched=" + Eras.state(g).launched.length,
      "wars=" + Diplo.stats(g).wars, "wonders=" + Object.keys(g.wonders || {}).length);
    turnMs.sort(function (a, b) { return a - b; });
    log.push("turnMs=avg" + (turnMs.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, turnMs.length)).toFixed(1) +
      ":p95_" + (turnMs[Math.floor(turnMs.length * 0.95)] || 0).toFixed(1) + ":max" + (turnMs[turnMs.length - 1] || 0).toFixed(1));
    log.push("size=" + g.size + ":" + state.tiles.length + "tiles:rivals" + (g.civs.length - 1));
    var mineCities = Rules.citiesOf(g, 0);
    if (mineCities.length && !Panels.contactOpen()) {
      var c = mineCities[0];
      handleTileClick(null);
      selectUnit(null);
      state.selCity = c.id;
      centerOn(c.q, c.r, state.fitZoom * 2.4);
      state.cam.x -= 60;
      state.hover = state.index.get(Rules.key(c.q, c.r));
      refreshUi();
      log.push("pop=" + c.pop, "units=" + Rules.unitsOf(g, 0).length, "turn=" + g.turn, "gold=" + g.gold,
        "science=" + g.science, "civ=" + state.civ.name, "traits=" + state.civ.traits.join("+"),
        "techs=" + g.tech.done.join("+"));
    }
    g.civs.forEach(function (cv, i) {
      log.push("civ" + i + "=" + cv.design.name + ":cities" + Rules.citiesOf(g, i).length + ":units" + Rules.unitsOf(g, i).length +
        ":techs" + cv.tech.done.length + (i ? ":" + Diplo.word(Diplo.rel(g, 0, i)) : ""));
    });
    var lm = Rules.landmasses(g);
    g.civs.forEach(function (cv, i) {
      var cs = Rules.citiesOf(g, i), cap = cs.filter(function (c) { return c.capital; })[0] || cs[0];
      var home = cap ? lm.id.get(Rules.key(cap.q, cap.r)) : null;
      var overseas = cs.filter(function (c) { return lm.id.get(Rules.key(c.q, c.r)) !== home; }).map(function (c) { return c.name + "@T" + c.founded; });
      var ships = Rules.unitsOf(g, i).filter(function (u) { return Naval.isNaval(u.type); }).map(function (u) { return u.type; });
      log.push("sea" + i + "=ships:" + ships.join("+") + ":overseas:" + overseas.join("+"));
    });
    var pairs = (g.diplo && g.diplo.pairs) || {};
    log.push("met=" + Object.keys(pairs).filter(function (k) { return pairs[k].met; }).map(function (k) { return k + "@T" + pairs[k].metTurn; }).join(","));
    if (params.war) runWar(Math.min(80, parseInt(params.war, 10) || 20), log);
    if (params.perf) log.push(perfFrames());
    document.body.setAttribute("data-autoplay", log.join(";"));
  }

  /*
   * Screenshot staging for slice 9 (?stage=ranged|happy|roads|saves|summary),
   * run after ?autoplay. Each sets up one view and leaves it open.
   */
  // Slice 15 screenshot stages (?s15=goto|promotion|air|res|gov|rel|naval).
  function closeAllPanelsForStage() {
    ["storyOverlay", "eraOverlay", "contactOverlay", "wonderOverlay"].forEach(function (id) { var e = document.getElementById(id); if (e) e.classList.add("hidden"); });
    if (Panels.diplomacyOpen()) Panels.closeDiplomacy();
  }
  function stage15(kind) {
    Anim.skip();
    var g = state.game, cap = Rules.citiesOf(g, 0).filter(function (c) { return c.capital; })[0], log = [];
    var U15 = window.PlanetUI15;
    if (g._autoPlayer) g._autoPlayer = false;
    hideSummary(); state.selCity = null; closeAllPanelsForStage();
    var occupied = function (t) { return g.units.some(function (u) { return u.q === t.q && u.r === t.r; }) || g.cityAt.has(Rules.key(t.q, t.r)); };
    var land = function (t) { return t && !Rules.isWater(t) && t.biome !== "mountain" && t.biome !== "ice"; };
    var techUpTo = function (era) { Tech.TECH_ORDER.forEach(function (id) { if ((Tech.TECHS[id].era || 0) <= era && !Tech.has(g, id, 0)) g.tech.done.push(id); }); };
    var focus = function (q, r, z, fy) { var p = hexToPixel(q, r); state.cam.zoom = state.fitZoom * z; state.cam.x = canvas.clientWidth * 0.5 - p[0] * state.cam.zoom; state.cam.y = canvas.clientHeight * (fy || 0.5) - p[1] * state.cam.zoom; };
    var revealAround = function (q, r, n) { Rules.tilesInRadius(g, q, r, n).forEach(function (t) { g.revealed.add(Rules.key(t.q, t.r)); }); Vision.remember(g, 0); updateVision(); };
    var near = function (q, r, min, max, pred) {
      return Rules.tilesInRadius(g, q, r, max).filter(function (t) { return Rules.hexDistance(q, r, t.q, t.r) >= min && pred(t); })
        .sort(function (a, b) { return Rules.hexDistance(q, r, a.q, a.r) - Rules.hexDistance(q, r, b.q, b.r) || a.q - b.q || a.r - b.r; });
    };
    document.getElementById("feedHead") && document.getElementById("feedHead").click();
    if (kind === "goto") {
      revealAround(cap.q, cap.r, 12);
      var w = g.units.filter(function (u) { return u.owner === 0 && Combat.strengthOf(u.type) > 0; })[0] || Rules.addUnit(g, "warrior", cap.q, cap.r, 0);
      var far = near(w.q, w.r, 6, 11, function (t) { var pp = land(t) && !occupied(t) && Orders.plan(g, w, t.q, t.r); return pp && pp.turns >= 3; }).pop();
      log.push("w=" + w.type + "@" + w.q + "," + w.r + " far=" + !!far);
      var sc = near(cap.q, cap.r, 2, 4, function (t) { return land(t) && !occupied(t); });
      var s1 = Rules.addUnit(g, "horseman", sc[0].q, sc[0].r, 0); Orders.setOrder(g, s1.id, "sentry");
      var a1 = Rules.addUnit(g, "archer", sc[1].q, sc[1].r, 0);
      var far2 = near(a1.q, a1.r, 6, 9, function (t) { return land(t) && !occupied(t) && t !== far; }).filter(function (t) { return Rules.hexDistance(t.q, t.r, far.q, far.r) > 4; })[0];
      if (far2) { a1.goto = { q: far2.q, r: far2.r, queue: [] }; }
      selectUnit(w.id);
      state.hover = state.index.get(Rules.key(far.q, far.r));
      var pl = Orders.plan(g, w, far.q, far.r);
      log.push("turns=" + pl.turns, "len=" + pl.path.length);
      focus((w.q + far.q) / 2, (w.r + far.r) / 2, 3.6, 0.5);
      refreshUi(); render();
    } else if (kind === "promotion") {
      techUpTo(1);
      revealAround(cap.q, cap.r, 6);
      var sp = near(cap.q, cap.r, 1, 3, function (t) { return land(t) && !occupied(t); });
      var sw = Rules.addUnit(g, "swordsman", sp[0].q, sp[0].r, 0); sw.xp = 32; sw.promos = ["shock"]; sw.hp = 74;
      var ar = Rules.addUnit(g, "archer", sp[1].q, sp[1].r, 0); ar.xp = 70; ar.promos = ["accuracy", "barrage"];
      var sw2 = Rules.addUnit(g, "spearman", sp[2].q, sp[2].r, 0); sw2.xp = 12;
      selectUnit(sw.id);
      log.push("ready=" + Promo.ready(sw), "opts=" + Promo.options(sw).join("+"));
      focus(sw.q, sw.r, 6.5, 0.45);
      refreshUi(); render();
    } else if (kind === "air") {
      techUpTo(5);
      var foeA = 1; Diplo.meet(g, 0, foeA); if (!Combat.atWar(g, 0, foeA)) Diplo.declareWar(g, 0, foeA);
      var bm = Rules.addUnit(g, "bomber", cap.q, cap.r, 0);
      var ft = Rules.addUnit(g, "fighter", cap.q, cap.r, 0); ft.patrol = true;
      var tg = near(cap.q, cap.r, 4, 5, function (t) { return land(t) && !occupied(t); })[0];
      var tank = Rules.addUnit(g, "artillery", tg.q, tg.r, foeA);
      revealAround(cap.q, cap.r, 7);
      bm.moves = 1;
      var rs = Air.strike(g, bm.id, tg.q, tg.r);
      log.push("strike=" + rs.ok + ":" + (rs.reason || (rs.events || []).map(function (e) { return e.text; }).join("/")));
      selectUnit(ft.id);
      refreshUi();
      consumeFx();
      state.fx = state.fx.filter(function (f) { return f.kind === "air" || f.kind === "hit"; });
      state.fx.forEach(function (f) { f.frozen = f.kind === "air" ? 0.3 : 0.15; });
      state.freezeFx = true;
      focus((cap.q + tg.q) / 2, (cap.r + tg.r) / 2, 4.6, 0.55);
      render();
      log.push("fx=" + state.fx.map(function (f) { return f.kind; }).join("+"));
    } else if (kind === "res") {
      techUpTo(4);
      var mine = [];
      g.owner.forEach(function (cid, k) { if (Rules.cityById(g, cid).owner === 0 && !g.cityAt.has(k)) mine.push(k); });
      mine.sort();
      var setRes = function (k, r, imp) { var t = state.index.get(k); t.resource = r; if (imp) { g.improvements = g.improvements || {}; g.improvements[k] = imp; } };
      setRes(mine[0], "horses", "pasture"); setRes(mine[1], "iron", "mine"); setRes(mine[2], "coal", null);
      for (var hi = 0; hi < 6; hi++) Rules.addUnit(g, hi < 5 ? "knight" : "horseman", cap.q, cap.r, 0);
      Rules.addUnit(g, "swordsman", cap.q, cap.r, 0);
      g._stratLedger = null;
      refreshUi(); render();
      U15.showStrat(document.getElementById("stratBtn"));
      log.push("rows=" + Strat.report(g, 0).map(function (x) { return x.res + ":" + x.used + "/" + x.supply; }).join(","));
    } else if (kind === "gov") {
      techUpTo(3);
      g.gold = Math.max(g.gold, 300);
      Gov.switchGov(g, 0, "monarchy");
      var gc = Gov.civ(g, 0); gc.anarchy = 0; gc.since = Math.max(0, g.turn - 4);
      var cards = Gov.cardsAvailable(g, 0);
      Gov.setPolicies(g, 0, Gov.bestCards ? Gov.bestCards(g, 0, "monarchy") : cards.slice(0, 2));
      refreshUi();
      U15.openGov();
      log.push("gov=" + gc.gov, "pol=" + gc.policies.join("+"));
    } else if (kind === "rel") {
      for (var ci = 1; ci < g.civs.length; ci++) Diplo.meet(g, 0, ci);
      if (g.civs[1]) { var b1 = Rel.aiBeliefs(g, 1); Rel.found(g, 1, b1); }
      if (g.civs[2]) { var b2 = Rel.aiBeliefs(g, 2); Rel.found(g, 2, b2); }
      var rs0 = Rel.state(g);
      rs0.civ[0].faith = Rel.FOUND_AT + 6; rs0.civ[0].perTurn = 4;
      if (rs0.pendingFound.indexOf(0) === -1) rs0.pendingFound.push(0);
      Rel.spread(g);
      refreshUi();
      U15.openRel();
      log.push("rels=" + rs0.list.length);
    } else if (kind === "naval") {
      techUpTo(4);
      var foeN = null, tc = null, seaT = null;
      g.cities.filter(function (c) { return c.owner !== 0; }).some(function (c) {
        var ws = Rules.neighbours(g, c).filter(function (t) { return Rules.isWater(t) && !occupied(t); });
        var ls = Rules.neighbours(g, c).filter(function (t) { return land(t) && !occupied(t); });
        if (ws.length >= 2 && ls.length >= 1) { tc = c; seaT = ws; foeN = c.owner; return true; }
        return false;
      });
      Diplo.meet(g, 0, foeN); if (!Combat.atWar(g, 0, foeN)) Diplo.declareWar(g, 0, foeN);
      var tr = Rules.addUnit(g, "transport", seaT[0].q, seaT[0].r, 0);
      var dd = Rules.addUnit(g, "ironclad", seaT[1].q, seaT[1].r, 0);
      var out = Rules.tilesInRadius(g, tc.q, tc.r, 3).filter(function (t) { return Rules.isWater(t) && !occupied(t) && Rules.hexDistance(t.q, t.r, tc.q, tc.r) >= 2; });
      if (out[0]) Rules.addUnit(g, "frigate", out[0].q, out[0].r, 0);
      ["rifleman", "cannon"].forEach(function (ty) { var x = Rules.addUnit(g, ty, tr.q, tr.r, 0); x.aboard = tr.id; });
      var lt = Rules.neighbours(g, tc).filter(function (t) { return land(t) && !occupied(t); })[0];
      var lu = Rules.addUnit(g, "musketman", lt.q, lt.r, 0); lu.moves = 0; lu.hp = 88;
      revealAround(tc.q, tc.r, 5);
      dd.moves = 2;
      var ra = Combat.attack(g, dd.id, tc.q, tc.r);
      log.push("bombard=" + ra.ok + ":" + (ra.reason || ra.dealt), "city=" + tc.name);
      selectUnit(tr.id);
      refreshUi();
      consumeFx();
      state.fx.forEach(function (f) { f.frozen = f.kind === "shot" ? 0.6 : f.kind === "lunge" ? 0.5 : 0.3; });
      state.freezeFx = true;
      focus(tc.q, tc.r, 5.5, 0.55);
      render();
    }
    document.body.setAttribute("data-stage", kind + ";" + log.join(";"));
  }

  // ?artshot=play|close|world (after ?autoplay): art-test views around the
  // player city with the most varied surroundings, a Spearman beside it.
  function stageArt(kind) {
    Anim.skip();
    var g = state.game, log = [];
    if (g._autoPlayer) g._autoPlayer = false;
    hideSummary(); state.selCity = null; closeAllPanelsForStage();
    var score = function (c) {
      var seen = {}, n = 0;
      Rules.tilesInRadius(g, c.q, c.r, 3).forEach(function (t) { if (!seen[t.biome]) { seen[t.biome] = 1; n++; } if (t.river > 0) n += 0.15; });
      return n;
    };
    var c = Rules.citiesOf(g, 0).slice().sort(function (a, b) { return score(b) - score(a) || a.id - b.id; })[0];
    Rules.tilesInRadius(g, c.q, c.r, 9).forEach(function (t) { g.revealed.add(Rules.key(t.q, t.r)); });
    Vision.remember(g, 0); updateVision();
    var spot = Rules.tilesInRadius(g, c.q, c.r, 2).filter(function (t) {
      return Rules.hexDistance(c.q, c.r, t.q, t.r) >= 1 && !Rules.isWater(t) && t.biome !== "mountain" && !g.units.some(function (u) { return u.q === t.q && u.r === t.r; }) && !g.cityAt.has(Rules.key(t.q, t.r));
    }).sort(function (a, b) { return b.r - a.r || a.q - b.q; })[0];
    if (spot) { var sp = Rules.addUnit(g, "spearman", spot.q, spot.r, 0); selectUnit(sp.id); }
    var zoom = kind === "close" ? 11 : kind === "world" ? 1 : 5.5;
    if (kind === "world") { state.tiles.forEach(function (t) { g.revealed.add(Rules.key(t.q, t.r)); }); Vision.remember(g, 0); updateVision(); fit(state.tiles); } else if (kind === "close" && spot) centerOn(Math.round((c.q + spot.q) / 2), Math.round((c.r + spot.r) / 2), state.fitZoom * zoom); else centerOn(c.q, c.r, state.fitZoom * zoom);
    refreshUi(); render();
    log.push("city=" + c.name, "pop=" + c.pop, "score=" + score(c).toFixed(1), "art=" + state.art);
    if (params.perf) log.push(perfFrames());
    document.body.setAttribute("data-stage", "art;" + log.join(";"));
  }

  // ?s16=pillage | relspread (after ?autoplay): slice 16 screenshot scenes.
  function stage16(kind) {
    Anim.skip();
    var g = state.game, log = [], PL = window.PlanetPillage, U15 = window.PlanetUI15;
    if (g._autoPlayer) g._autoPlayer = false;
    hideSummary(); state.selCity = null; closeAllPanelsForStage();
    var focus = function (q, r, z, fy) { var p = hexToPixel(q, r); state.cam.zoom = state.fitZoom * z; state.cam.x = canvas.clientWidth * 0.5 - p[0] * state.cam.zoom; state.cam.y = canvas.clientHeight * (fy || 0.5) - p[1] * state.cam.zoom; };
    var revealAround = function (q, r, n) { Rules.tilesInRadius(g, q, r, n).forEach(function (t) { g.revealed.add(Rules.key(t.q, t.r)); }); Vision.remember(g, 0); updateVision(); };
    if (kind === "pillage") {
      var foe = 1; Diplo.meet(g, 0, foe); if (!Combat.atWar(g, 0, foe)) Diplo.declareWar(g, 0, foe);
      var ec = Rules.citiesOf(g, foe).filter(function (c) { return c.capital; })[0];
      var flat = function (t) { return t && (t.biome === "plains" || t.biome === "grassland") && !g.cityAt.has(Rules.key(t.q, t.r)) && (g.cityAt.get ? true : true) &&
        (function () { var o = g.owner.get(Rules.key(t.q, t.r)); var oc = o != null && Rules.cityById(g, o); return oc && oc.owner === foe; })() &&
        !g.units.some(function (u) { return u.q === t.q && u.r === t.r; }); };
      var cand = Rules.tilesInRadius(g, ec.q, ec.r, 3).filter(flat).sort(function (a, b) { return Rules.hexDistance(a.q, a.r, ec.q, ec.r) - Rules.hexDistance(b.q, b.r, ec.q, ec.r) || a.q - b.q || a.r - b.r; });
      g.improvements = g.improvements || {}; g.roads = g.roads || {};
      cand.slice(0, 5).forEach(function (t) { var k = Rules.key(t.q, t.r); if (!g.improvements[k]) g.improvements[k] = "farm"; g.roads[k] = 1; });
      // Two tiles already burned this turn, one being pillaged now.
      var burned = cand.slice(1, 3);
      burned.forEach(function (t) { var u0 = Rules.addUnit(g, "horseman", t.q, t.r, 0); PL.pillage(g, u0.id); Rules.removeUnit(g, u0); });
      var t0 = cand[0], sw = Rules.addUnit(g, Tech.has(g, "feudalism", 0) ? "pikeman" : "spearman", t0.q, t0.r, 0); sw.hp = 74;
      revealAround(ec.q, ec.r, 5);
      consumeFx(); state.fx = [];
      var r = PL.pillage(g, sw.id);
      log.push("pillage=" + r.ok + ":" + (r.text || r.reason), "city=" + ec.name);
      selectUnit(sw.id);
      refreshUi();
      if (r.ok) toast(r.text);
      consumeFx();
      state.fx.forEach(function (f) { f.frozen = 0.32; });
      state.freezeFx = true;
      focus(t0.q, t0.r, 7, 0.45);
      render();
    } else if (kind === "relspread") {
      for (var ci = 1; ci < g.civs.length; ci++) Diplo.meet(g, 0, ci);
      g.cities.forEach(function (c) { revealAround(c.q, c.r, 2); });
      refreshUi();
      U15.openRel();
      var rs = Rel.state(g);
      log.push("rels=" + rs.list.map(function (x) { return x.name + ":" + Rel.followers(g, x.id).length + "/" + g.cities.length; }).join(","));
      state.cam.zoom = state.fitZoom * 1.0;
      render();
    }
    document.body.setAttribute("data-stage", kind + ";" + log.join(";"));
  }

  function stage9(kind) {
    Anim.skip();
    var g = state.game, cap = Rules.citiesOf(g, 0).filter(function (c) { return c.capital; })[0];
    var log = [];
    if (kind === "ranged") {
      // An archer two hexes from a rival warrior, with a forest between the
      // archer and another target (blocked), at war, hovering the open shot.
      var foe = 1; Diplo.meet(g, 0, foe); if (!Combat.atWar(g, 0, foe)) Diplo.declareWar(g, 0, foe);
      var flat = function (t) {
        return t && (t.biome === "plains" || t.biome === "grassland") &&
          !g.cities.some(function (c) { return Rules.hexDistance(c.q, c.r, t.q, t.r) < 2; });
      };
      var spot = null, tgt = null;
      Rules.tilesInRadius(g, cap.q, cap.r, 6).some(function (t) {
        if (!flat(t) || Rules.hexDistance(t.q, t.r, cap.q, cap.r) < 2) return false;
        return DIRS.some(function (d) {
          var m = state.index.get(Rules.key(t.q + d[0], t.r + d[1])), e = state.index.get(Rules.key(t.q + 2 * d[0], t.r + 2 * d[1]));
          if (flat(m) && flat(e) && !g.units.some(function (u) { return (u.q === t.q && u.r === t.r) || (u.q === e.q && u.r === e.r) || (u.q === m.q && u.r === m.r); })) { spot = t; tgt = e; return true; }
          return false;
        });
      });
      var a = Rules.addUnit(g, params.unit || "archer", spot.q, spot.r, 0);
      var w = Rules.addUnit(g, "spearman", tgt.q, tgt.r, foe);
      w.hp = 82;
      Vision.remember(g, 0);
      Rules.reveal(g, tgt.q, tgt.r, 1, 0);
      updateVision();
      selectUnit(a.id);
      state.selCity = null;
      hideSummary();
      var mid = hexToPixel((spot.q + tgt.q) / 2, (spot.r + tgt.r) / 2);
      state.cam.zoom = 2.3;
      state.cam.x = canvas.clientWidth / 2 - mid[0] * state.cam.zoom - 140;
      state.cam.y = canvas.clientHeight / 2 - mid[1] * state.cam.zoom + 40;
      state.hover = state.index.get(Rules.key(tgt.q, tgt.r));
      refreshUi();
      var pp = hexToPixel(tgt.q, tgt.r);
      updateTip(state.cam.x + pp[0] * state.cam.zoom, state.cam.y + pp[1] * state.cam.zoom);
      log.push("targets=" + state.attack.length);
    } else if (kind === "happy" || kind === "happy2") {
      selectUnit(null); state.selCity = null;
      hideSummary();
      document.getElementById("happyTip").classList.add("show");
      refreshUi();
      log.push("happy=" + Happy.total(g, 0));
    } else if (kind === "roads") {
      hideSummary();
      // Frame the capital and its road-connected cities with a city panel open.
      var conn = Roads.connected(g, 0), ids = Object.keys(conn).map(Number);
      var cs = [cap].concat(ids.map(function (id) { return Rules.cityById(g, id); }));
      var mq = 0, mr = 0;
      cs.forEach(function (c) { var p = hexToPixel(c.q, c.r); mq += p[0] / cs.length; mr += p[1] / cs.length; });
      selectUnit(null);
      state.selCity = ids.length ? ids[0] : cap.id;
      state.cam.zoom = params.zoom ? +params.zoom : 1.5;
      state.cam.x = canvas.clientWidth / 2 - mq * state.cam.zoom + 150;
      state.cam.y = canvas.clientHeight / 2 - mr * state.cam.zoom;
      state.hover = null;
      refreshUi();
      log.push("connected=" + ids.length, "roads=" + Object.keys(g.roads).length);
    } else if (kind === "saves") {
      Save.write(g, state.civ, cameraState(), 1, "Before the river war");
      Save.write(g, state.civ, cameraState(), 2, state.civ.name + " · T" + g.turn);
      var other = JSON.parse(JSON.stringify(Save.readSlot(2)));
      other.name = "Huge map test"; other.size = "huge"; other.game.turn = 12; other.savedAt = new Date(Date.now() - 86400000 * 2).toISOString();
      try { localStorage.setItem("civPlanet.slot.4", JSON.stringify(other)); } catch (e) { /* ignore */ }
      state.slot = 2;
      openSaves("load");
      if (params.confirm) { state.savesConfirm = 4; renderSaves(); }
      log.push("slots=" + Save.listSlots().filter(function (s) { return s.data; }).length);
    } else if (kind === "summary") {
      selectUnit(null); state.selCity = null;
      AI.takeTurn(g, 0);
      endTurnAction();
      if (Panels.contactOpen()) Panels.closeAllContacts();
      selectUnit(null); state.selCity = null;
      refreshUi();
      log.push("lines=" + (state.summary || []).length);
    } else if (kind === "workercancel") {
      // A worker one turn into a 2-3 turn road, selected: panel shows progress and Cancel.
      hideSummary();
      var wt = Rules.tilesInRadius(g, cap.q, cap.r, 3).filter(function (t) {
        return !Rules.isWater(t) && Rules.moveCost(t) !== Infinity && !g.cityAt.has(Rules.key(t.q, t.r)) && !Roads.isRoad(g, t.q, t.r) &&
          Rules.hexDistance(t.q, t.r, cap.q, cap.r) >= 2 && !g.units.some(function (u) { return u.q === t.q && u.r === t.r; });
      }).sort(function (x, y) { return (Rules.moveCost(y) - Rules.moveCost(x)) || (x.q - y.q); })[0];
      var wk = Rules.addUnit(g, "worker", wt.q, wt.r, 0);
      Roads.startWork(g, wk.id, "road");
      wk.work.left = wk.work.total - 1;
      selectUnit(wk.id); state.selCity = null;
      var wp = hexToPixel(wt.q, wt.r);
      state.cam.zoom = 2.2;
      state.cam.x = canvas.clientWidth / 2 - wp[0] * state.cam.zoom;
      state.cam.y = canvas.clientHeight / 2 - wp[1] * state.cam.zoom - 40;
      state.hover = null;
      refreshUi();
      if (params.cancel) { cancelSelectedJob(); Roads.startWork(g, wk.id, "road"); selectUnit(wk.id); refreshUi(); }
      log.push("work=" + wk.work.left + "/" + wk.work.total);
    } else if (kind === "trade") {
      // A domestic route and a foreign one (meet + peace with the nearest rival), panel open.
      hideSummary();
      var own = Rules.citiesOf(g, 0);
      var addRoute = function (from, to, kd) {
        var nb = Rules.neighbours(g, state.index.get(Rules.key(to.q, to.r))).filter(function (n) { return !Rules.isWater(n) && !g.cityAt.has(Rules.key(n.q, n.r)); })[0];
        var cv = Rules.addUnit(g, "caravan", nb.q, nb.r, 0); cv.home = from.id;
        var res = Trade.establish(g, cv.id, to.id, kd);
        if (!res.ok) Rules.removeUnit(g, cv);
        return res;
      };
      var dom = own.filter(function (c) { return c !== cap; }).sort(function (x, y) { return Rules.hexDistance(cap.q, cap.r, y.q, y.r) - Rules.hexDistance(cap.q, cap.r, x.q, x.r); });
      if (dom[0]) log.push("dom=" + addRoute(cap, dom[0], "food").ok);
      var fc = g.cities.filter(function (c) { return c.owner !== 0; }).sort(function (x, y) { return Rules.hexDistance(cap.q, cap.r, x.q, x.r) - Rules.hexDistance(cap.q, cap.r, y.q, y.r); })[0];
      var home2 = dom[1] || dom[0];
      if (fc && home2) {
        Diplo.meet(g, 0, fc.owner); var rl = Diplo.rel(g, 0, fc.owner); rl.war = false; rl.att = Math.max(rl.att, 2);
        Rules.reveal(g, fc.q, fc.r, 2, 0);
        log.push("foreign=" + addRoute(home2, fc, "gold").ok);
      }
      if (dom[2]) log.push("dom2=" + addRoute(dom[2], dom[1] || cap, "prod").ok);
      Trade.routes(g).forEach(function (r, i) { r.turns = [30, 18, 4][i] || 12; });
      updateVision();
      var pts = own.map(function (c) { return hexToPixel(c.q, c.r); });
      document.getElementById("feedHead").click();   // collapse the feed so the routes show
      var minx = Math.min.apply(null, pts.map(function (p) { return p[0]; })), maxx = Math.max.apply(null, pts.map(function (p) { return p[0]; }));
      var miny = Math.min.apply(null, pts.map(function (p) { return p[1]; })), maxy = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
      state.cam.zoom = Math.min(2, Math.max(1.1, Math.min(560 / Math.max(1, maxx - minx), 560 / Math.max(1, maxy - miny))));
      state.cam.x = (canvas.clientWidth - 540) / 2 + 50 - (minx + maxx) / 2 * state.cam.zoom;
      state.cam.y = canvas.clientHeight / 2 + 30 - (miny + maxy) / 2 * state.cam.zoom;
      selectUnit(null); state.selCity = null; state.hover = null;
      openTrade();
      refreshUi();
      log.push("routes=" + Trade.routes(g).length);
    } else if (kind === "deal" || kind === "diplo2") {
      hideSummary(); selectUnit(null); state.selCity = null;
      // Meet everyone (so relations show), with a few remembered events and pacts.
      for (var ci = 1; ci < g.civs.length; ci++) for (var cj = 0; cj < ci; cj++) Diplo.meet(g, cj, ci);
      var rv = g.cities.filter(function (c) { return c.owner !== 0; }).sort(function (x, y) { return Rules.hexDistance(cap.q, cap.r, x.q, x.r) - Rules.hexDistance(cap.q, cap.r, y.q, y.r); })[0].owner;
      var other = rv === 1 ? 2 : 1;
      var rr = Diplo.rel(g, 0, rv); rr.war = false; rr.att = 3;
      Diplo.remember(g, 0, rv, "deals", 2, "Trades with us");
      Diplo.remember(g, 0, rv, "gifts", 3, "Gave us gifts");
      if (g.civs[other]) {
        var ro = Diplo.rel(g, 0, other); ro.war = false; ro.att = -3;
        Diplo.remember(g, 0, other, "refused-tribute", -3, "Refused our demand");
        Diplo.signPact(g, rv, other, "nap");
        if (kind === "diplo2") {
          Deals.state(g).pending.push({ id: 900, kind: "demand", from: other, turn: g.turn, deal: { from: other, to: 0, give: [], ask: [{ t: "gold", n: 60 }], pacts: [] } });
        }
      }
      Diplo.signPact(g, 0, rv, "nap");
      g.gold = Math.max(g.gold, 240);
      if (kind === "deal") {
        var want = Deals.techsToOffer(g, rv, 0)[0];
        if (!want) { var tt = Tech.TECH_ORDER.filter(function (id) { return !Tech.has(g, id, 0); })[0] || "literature"; if (!Tech.has(g, tt, rv)) g.civs[rv].tech.done.push(tt); want = tt; }
        var pre = { from: 0, to: rv, give: [{ t: "gold", n: 40 }, { t: "map" }], ask: [{ t: "tech", id: want }], pacts: [] };
        if (params.counter) pre = Deals.counter(g, pre).deal;
        DealUI.open(dealOpts, rv, null);
        DealUI.open(dealOpts, rv, pre);
        log.push("verdict=" + Deals.evaluate(g, pre).verdict);
      } else {
        openDiplomacy();
        log.push("reasons=" + Diplo.reasons(g, 0, rv).length);
      }
      refreshUi();
    } else if (kind === "wonder" || kind === "wonders") {
      hideSummary(); selectUnit(null); state.selCity = null;
      var wid = Wonders.ORDER.filter(function (id) { return !Wonders.registry(g)[id] && !Wonders.WONDERS[id].coastal; })[0];
      if (wid) {
        var wt2 = Wonders.WONDERS[wid].tech;
        Tech.pathTo ? null : null;
        if (!Tech.has(g, wt2, 0)) g.tech.done.push(wt2);
        cap.build = "w_" + wid;
        cap.prod = kind === "wonder" ? Rules.buildCost(g, cap.build, 0) - 1 : Math.floor(Rules.buildCost(g, cap.build, 0) * 0.4);
      }
      if (kind === "wonder") {
        endTurnAction();
        if (Panels.contactOpen()) Panels.closeAllContacts();
        hideSummary();
        var cp2 = hexToPixel(cap.q, cap.r);
        state.cam.zoom = 1.6;
        state.cam.x = canvas.clientWidth / 2 - cp2[0] * state.cam.zoom;
        state.cam.y = canvas.clientHeight * 0.83 - cp2[1] * state.cam.zoom;
        state.cam.x = canvas.clientWidth * 0.5 - cp2[0] * state.cam.zoom;
        if (wid) showWonderCard(wid);
      } else {
        for (var oi = 1; oi < g.civs.length; oi++) Diplo.meet(g, 0, oi);
        openWonders();
      }
      refreshUi();
      log.push("wonder=" + wid, "built=" + Object.keys(Wonders.registry(g)).length);
    } else if (kind === "techtree" || kind === "era") {
      // Know everything up to the Medieval era plus some of the Renaissance; research Physics.
      hideSummary(); selectUnit(null); state.selCity = null;
      Tech.TECH_ORDER.forEach(function (id) { if ((Tech.TECHS[id].era || 0) <= (kind === "era" ? 2 : 2) && !Tech.has(g, id, 0)) g.tech.done.push(id); });
      if (kind === "techtree") {
        ["astronomy", "printing_press", "banking"].forEach(function (id) { if (!Tech.has(g, id, 0)) g.tech.done.push(id); });
        Tech.setResearch(g, "steam_power", 0);
        g.tech.progress = 140;
        openTree();
      } else {
        Eras.state(g).civ[0] = 1;
        g.tech.queue = []; Tech.setResearch(g, "astronomy", 0);
        StoryUI.showEra(g, Eras.eraOf(g, 0));
      }
      refreshUi();
      log.push("era=" + Eras.eraOf(g, 0), "techs=" + g.tech.done.length);
    } else if (kind === "event") {
      hideSummary(); selectUnit(null); state.selCity = null;
      for (var ei = 1; ei < g.civs.length; ei++) Diplo.meet(g, 0, ei);
      var evId = params.ev || "prophet_1";
      Story.state(g).pending.push({ uid: 99, id: evId, cid: 0, ctx: { city: cap.id, rival: 1 }, turn: g.turn });
      refreshUi();
      showStory();
      log.push("event=" + evId);
    } else if (kind === "anomaly") {
      hideSummary(); state.selCity = null;
      var an = Story.state(g).anomalies.slice().sort(function (a, b) { return Rules.hexDistance(cap.q, cap.r, a.q, a.r) - Rules.hexDistance(cap.q, cap.r, b.q, b.r); })[0];
      Rules.tilesInRadius(g, an.q, an.r, 4).forEach(function (t) { g.revealed.add(Rules.key(t.q, t.r)); });
      var wu = Rules.unitsOf(g, 0).filter(function (u) { return Rules.UNIT_TYPES[u.type].strength > 0 && !Rules.UNIT_TYPES[u.type].naval; })[0] || Rules.addUnit(g, "warrior", cap.q, cap.r, 0);
      wu.q = an.q; wu.r = an.r; wu.moves = 1;
      // A second anomaly in view, remembered only (dimmed), if one is near.
      updateVision();
      selectUnit(wu.id);
      var ap = hexToPixel(an.q, an.r);
      state.cam.zoom = 2.6;
      state.cam.x = canvas.clientWidth * 0.5 - ap[0] * state.cam.zoom;
      state.cam.y = canvas.clientHeight * 0.55 - ap[1] * state.cam.zoom;
      refreshUi();
      log.push("anomaly=" + an.kind + "@" + an.q + "," + an.r, "can=" + !!Story.canInvestigate(g, wu));
    } else if (kind === "icons" || kind === "combat") {
      // STAGED: a mixed muster of units around the capital (the player's and a
      // rival's) to show the icon set; for "combat", a real cannon shot and a
      // real knight charge through Combat.attack, frozen mid-animation.
      hideSummary(); selectUnit(null); state.selCity = null; state.hover = null;
      if (Panels.contactOpen()) Panels.closeAllContacts();
      var foe2 = 1; Diplo.meet(g, 0, foe2);
      var free = function (t) { return t && !g.units.some(function (u) { return u.q === t.q && u.r === t.r; }) && !g.cityAt.has(Rules.key(t.q, t.r)) && Rules.moveCost(t) !== Infinity; };
      var ring = Rules.tilesInRadius(g, cap.q, cap.r, 3).filter(free).sort(function (x, y) { return Rules.hexDistance(cap.q, cap.r, x.q, x.r) - Rules.hexDistance(cap.q, cap.r, y.q, y.r) || x.q - y.q || x.r - y.r; });
      var land = ring.filter(function (t) { return !Rules.isWater(t); }), sea = ring.filter(function (t) { return Rules.isWater(t); });
      var placed = [];
      var put = function (type, list, owner) { var t = list.shift(); if (!t) return null; var u = Rules.addUnit(g, type, t.q, t.r, owner); placed.push(type); return u; };
      if (kind === "icons") {
        ["knight", "musketman", "cannon", "rifleman", "tank", "artillery", "crossbowman", "caravan"].forEach(function (ty, i) { put(ty, land, i % 3 === 2 ? foe2 : 0); });
        ["frigate", "battleship", "ironclad"].forEach(function (ty, i) { put(ty, sea, i === 1 ? foe2 : 0); });
        Rules.tilesInRadius(g, cap.q, cap.r, 5).forEach(function (t) { g.revealed.add(Rules.key(t.q, t.r)); });
        updateVision();
        document.getElementById("feedHead").click();
        var ip = hexToPixel(cap.q, cap.r);
        state.cam.zoom = state.fitZoom * 4.6;
        state.cam.x = canvas.clientWidth * 0.5 - ip[0] * state.cam.zoom;
        state.cam.y = canvas.clientHeight * 0.52 - ip[1] * state.cam.zoom;
        refreshUi();
        log.push("placed=" + placed.join("+"));
      } else {
        if (!Combat.atWar(g, 0, foe2)) { var dw = Diplo.declareWar(g, 0, foe2); log.push("war=" + dw.ok); }
        // Cannon two hexes from a rival pikeman; a knight next to a wounded spearman.
        var spot = null, tgt = null, mid = null;
        land.some(function (t) {
          return DIRS.some(function (d) {
            var m = state.index.get(Rules.key(t.q + d[0], t.r + d[1])), e = state.index.get(Rules.key(t.q + 2 * d[0], t.r + 2 * d[1]));
            if (free(m) && free(e) && !Rules.isWater(m) && !Rules.isWater(e) && m.biome !== "forest" && m.biome !== "jungle" && m.biome !== "hills") { spot = t; mid = m; tgt = e; return true; }
            return false;
          });
        });
        var can = Rules.addUnit(g, "cannon", spot.q, spot.r, 0);
        var pk = Rules.addUnit(g, "pikeman", tgt.q, tgt.r, foe2);
        var kn = null, sp2 = null;
        var kspot = land.filter(function (t) { return free(t) && Rules.hexDistance(t.q, t.r, spot.q, spot.r) >= 2 && t !== mid && t !== tgt; })[0];
        if (kspot) {
          kn = Rules.addUnit(g, "knight", kspot.q, kspot.r, 0);
          var nb = Rules.neighbours(g, kspot).filter(function (t) { return free(t) && !Rules.isWater(t) && t !== mid && t !== tgt; })[0];
          if (nb) { sp2 = Rules.addUnit(g, "spearman", nb.q, nb.r, foe2); sp2.hp = 12; }
        }
        Rules.tilesInRadius(g, spot.q, spot.r, 4).forEach(function (t) { g.revealed.add(Rules.key(t.q, t.r)); });
        Vision.remember(g, 0); updateVision();
        var r1 = Combat.attack(g, can.id, tgt.q, tgt.r);
        var r2 = kn && sp2 ? Combat.attack(g, kn.id, sp2.q, sp2.r) : null;
        log.push("shot=" + r1.ok + ":" + (r1.dealt || 0), "charge=" + (r2 ? r2.ok + ":" + (r2.killed ? "killed" : r2.dealt) : "none"));
        state.selCity = null; selectUnit(null);
        refreshUi();
        consumeFx();
        // Freeze: the shell mid-arc, the knight mid-lunge, the spearman fading, numbers rising.
        state.fx.forEach(function (f) { f.frozen = f.kind === "shot" ? 0.55 : f.kind === "lunge" ? 0.5 : f.kind === "death" ? 0.35 : 0.3; });
        state.freezeFx = true;
        document.getElementById("feedHead").click();
        var cp = hexToPixel((spot.q + tgt.q) / 2, (spot.r + tgt.r) / 2);
        state.cam.zoom = state.fitZoom * 7;
        state.cam.x = canvas.clientWidth * 0.5 - cp[0] * state.cam.zoom;
        state.cam.y = canvas.clientHeight * 0.55 - cp[1] * state.cam.zoom;
        render();
        log.push("fx=" + state.fx.map(function (f) { return f.kind; }).join("+"));
      }
    } else if (kind === "peace") {
      // STAGED: a war with the first rival, ten turns old, with real battle
      // tallies recorded through Peace.record; the deal screen opens on a
      // treaty asking them for gold and a tech.
      hideSummary(); selectUnit(null); state.selCity = null;
      if (Panels.contactOpen()) Panels.closeAllContacts();
      var PZ = window.PlanetPeace, fo = 1;
      Diplo.meet(g, 0, fo);
      if (!Combat.atWar(g, 0, fo)) Diplo.declareWar(g, 0, fo);
      var rr = Diplo.rel(g, 0, fo); rr.warTurn = g.turn - 12;
      PZ.state(g).wars[Math.min(0, fo) + "-" + Math.max(0, fo)].start = g.turn - 12;
      for (var bi = 0; bi < 5; bi++) PZ.record(g, 0, fo, "kill");
      PZ.record(g, fo, 0, "kill");
      for (bi = 0; bi < 4; bi++) PZ.record(g, 0, fo, "hit");
      g.civs[fo].gold = Math.max(g.civs[fo].gold, 180);
      var tk = Deals.techsToOffer(g, fo, 0)[0];
      var ask = [{ t: "gold", n: 120 }];
      if (tk) ask.push({ t: "tech", id: tk });
      refreshUi();
      openDeal(fo, { from: 0, to: fo, give: [], ask: ask, pacts: ["peace"] });
      var ev = Deals.evaluate(g, { from: 0, to: fo, give: [], ask: ask, pacts: ["peace"] });
      log.push("score=" + PZ.score(g, 0, fo), "verdict=" + ev.verdict, "need=" + ev.need, "net=" + ev.net);
      if (params.diplo) { DealUI.close(); openDiplomacy(); }
    } else if (kind === "chronicle") {
      hideSummary(); selectUnit(null); state.selCity = null;
      if (Panels.contactOpen()) Panels.closeAllContacts();
      refreshUi();
      StoryUI.openChronicle(g);
      log.push("entries=" + Story.state(g).chronicle.length);
    } else if (kind === "late") {
      hideSummary(); selectUnit(null); state.selCity = null; state.hover = null;
      if (Panels.contactOpen()) Panels.closeAllContacts();
      if (StoryUI.eraOpen()) StoryUI.closeEra();
      var lp = hexToPixel(cap.q, cap.r);
      state.cam.zoom = +(params.zoom || 1.05);
      state.cam.x = canvas.clientWidth * 0.45 - lp[0] * state.cam.zoom;
      state.cam.y = canvas.clientHeight * 0.5 - lp[1] * state.cam.zoom;
      refreshUi();
      log.push("era=" + Eras.eraName(Eras.eraOf(g, 0)), "year=" + Rules.yearLabel(g.turn), "units=" + Rules.unitsOf(g, 0).map(function (u) { return u.type; }).join("+"));
    } else if (kind === "airoads") {
      // The rival with the most road tiles, framed on its own land.
      hideSummary();
      var best = null, bn = -1;
      g.civs.forEach(function (cv, i) {
        if (!i) return;
        var n = Object.keys(g.roads).filter(function (k) { var o = g.owner.get(k); return o != null && (Rules.cityById(g, o) || {}).owner === i; }).length;
        if (n > bn) { bn = n; best = i; }
      });
      var rc = Rules.citiesOf(g, best);
      var cx2 = 0, cy2 = 0;
      rc.forEach(function (c) { var p = hexToPixel(c.q, c.r); cx2 += p[0] / rc.length; cy2 += p[1] / rc.length; });
      state.showFog = false; document.getElementById("showFog").checked = false;
      state.cam.zoom = params.zoom ? +params.zoom : 1.3;
      // Keep the map edge out of frame when the civ sits near it.
      var wpx = hexToPixel(Math.max.apply(null, g.tiles.map(function (t) { return t.q + t.r / 2; })), 0)[0];
      var cxv = Math.min(cx2, wpx - (canvas.clientWidth / 2 - 40) / state.cam.zoom);
      state.cam.x = canvas.clientWidth / 2 - 40 - cxv * state.cam.zoom;
      state.cam.y = canvas.clientHeight / 2 - cy2 * state.cam.zoom;
      document.getElementById("feedHead").click();
      selectUnit(null); state.selCity = null; state.hover = null;
      refreshUi();
      log.push("civ=" + best, "roads=" + bn, "plan=" + Roads.roadPlan(g, best).tiles.length, "gaps=" + Roads.roadGaps(g, best).length);
    }
    document.body.setAttribute("data-stage", kind + ";" + log.join(";"));
  }

  // Average render time over 30 frames at world zoom (cached terrain) and play zoom.
  /*
   * ?animperf=1: render cost while animating. Close zoom on the capital (water
   * shimmer and river flow on), every visible player unit walks up to 3 hexes
   * (real moves, recorded as tweens) and a burst of combat effects plays; 60
   * frames are rendered across the tweens' timeline (clock stepped), timed.
   */
  function animPerf() {
    var g = state.game, cap = Rules.citiesOf(g, 0)[0];
    Anim.settings.on = true; Anim.settings.water = true; g._noAnim = false;
    var wasAuto = g._autoPlayer; g._autoPlayer = false;
    centerOn(cap.q, cap.r, state.fitZoom * 3.2);
    var moved = 0;
    Rules.unitsOf(g, 0).forEach(function (u) {
      if (u.aboard != null) return;
      u.moves = Math.max(u.moves, 3);
      var reach = Rules.reachable(g, u), best = null;
      reach.forEach(function (n) { if (!best || n.used > best.used) best = n; });
      if (best && best.tile && Rules.moveUnit(g, u.id, best.tile.q, best.tile.r).ok) moved++;
    });
    var t0 = Anim.now();
    for (var i = 0; i < 24; i++) state.fx.push({ kind: i % 3 ? "hit" : "shot", q: cap.q, r: cap.r, from: { q: cap.q, r: cap.r }, to: { q: cap.q + 1, r: cap.r }, amount: 10, owner: 1, type: "cannon", t0: t0, dur: 2000 });
    var times = [], stat = [];
    for (var f = 0; f < 60; f++) {
      Anim.freeze(t0 + f * 25);
      var a = performance.now(); render(); times.push(performance.now() - a);
    }
    Anim.freeze(null); Anim.skip(); state.fx = [];
    for (f = 0; f < 30; f++) { var b = performance.now(); render(); stat.push(performance.now() - b); }
    g._autoPlayer = wasAuto;
    var q = function (xs) { xs = xs.slice().sort(function (x, y) { return x - y; }); return "avg" + (xs.reduce(function (s, x) { return s + x; }, 0) / xs.length).toFixed(1) + ":p95_" + xs[Math.floor(xs.length * 0.95)].toFixed(1) + ":max" + xs[xs.length - 1].toFixed(1); };
    return "animperf=size_" + (g.size || state.size) + ":tiles" + state.tiles.length + ":movers" + moved + ":waterHexes" + (state.waterTiles || 0) + ":zoom" + state.cam.zoom.toFixed(2) +
      ";animatingMs=" + q(times) + ";staticMs=" + q(stat) + ";iconCache=" + JSON.stringify(Icons.stats());
  }

  function perfFrames() {
    var save = { x: state.cam.x, y: state.cam.y, zoom: state.cam.zoom }, out = [];
    [["world", state.fitZoom], ["play", state.fitZoom * 2.4], ["close", 1.6], ["closeup", 4.5]].forEach(function (z) {
      var c = Rules.citiesOf(state.game, 0)[0] || state.tiles[(state.tiles.length / 2) | 0];
      centerOn(c.q, c.r, z[1]);
      if (z[0] === "world") fit(state.tiles);
      render();
      var t0 = performance.now();
      for (var i = 0; i < 30; i++) render();
      out.push(z[0] + "_" + ((performance.now() - t0) / 30).toFixed(2) + "ms@z" + state.cam.zoom.toFixed(2));
    });
    state.cam.x = save.x; state.cam.y = save.y; state.cam.zoom = save.zoom;
    render();
    return "frameMs=" + out.join(":");
  }

  /*
   * Scripted war (?war=N after ?autoplay): declare war on the first met rival
   * through the diplomacy panel, then let the AI play our side for N turns
   * (it attacks when the preview looks good). ?shot=preview stops at the first
   * possible attack with the preview tooltip open; ?shot=battle stops right
   * after one of our attacks near an enemy city with the effects frozen.
   */
  function runWar(turns, log) {
    var g = state.game;
    var met = Diplo.metCivs(g, 0).filter(function (c) { return !g.civs[c].eliminated; });
    if (!met.length) { log.push("war=nobody-met"); return; }
    var foe = met[0];
    Panels.closeAllContacts();
    openDiplomacy();
    var btn = document.querySelector('#dpList button[data-act=war][data-civ="' + foe + '"]');
    if (btn) { btn.click(); btn = document.querySelector('#dpList button[data-act=war][data-civ="' + foe + '"]'); if (btn) btn.click(); }
    Panels.closeDiplomacy();
    log.push("war=" + (Combat.atWar(g, 0, foe) ? "declared" : "FAILED") + ":" + Rules.civName(g, foe) + "@T" + g.turn);
    var citiesBefore = Rules.citiesOf(g, foe).map(function (c) { return c.name; });
    var st = { attacks: 0, dealt: 0, taken: 0, cityHits: 0, minCityHp: 100, captured: [], razed: [], lost: 0, died: 0 };
    var realAttack = Combat.attack;
    var lastPlayerHit = null;
    Combat.attack = function (game, id, q, r) {
      var u = Rules.unitById(game, id), mine = u && u.owner === 0;
      var c = game.cityAt.get(Rules.key(q, r));
      var res = realAttack.apply(this, arguments);
      if (res.ok && mine) {
        st.attacks++; st.dealt += res.dealt || 0; st.taken += res.taken || 0;
        if (res.died) st.died++;
        if (c && res.kind === "city") { st.cityHits++; st.minCityHp = Math.min(st.minCityHp, c.hp); }
        if (res.kind === "capture") (res.razed ? st.razed : st.captured).push(res.razed || res.captured);
        lastPlayerHit = { q: q, r: r, from: res.from, kind: res.kind, city: !!c };
      }
      return res;
    };
    var stopped = "";
    try {
      for (var t = 0; t < turns && !stopped; t++) {
        if (params.shot === "preview") {
          var pick = findAttack(g);
          if (pick && pick.mods < 1 && t < turns - 1) pick = null;   // wait for a fight with modifiers to show
          if (pick) {
            selectUnit(pick.u.id); state.selCity = null;
            centerOn(pick.u.q, pick.u.r, state.fitZoom * 3.2);
            state.cam.x -= 90;
            state.hover = pick.t;
            refreshUi();
            updateTip();
            stopped = "preview:" + pick.u.type + "->" + pick.kind;
            break;
          }
        }
        lastPlayerHit = null;
        AI.takeTurn(g, 0);
        var hitNow = lastPlayerHit;
        consumeFx();
        if (params.shot === "battle" && hitNow && nearFoeCity(g, hitNow, foe) && st.attacks >= 3) {
          freezeOn(hitNow);
          stopped = "battle:" + hitNow.kind;
          break;
        }
        refreshUi();
        key("Enter");
        if (Panels.contactOpen()) Panels.closeAllContacts();
        state.fx = [];
      }
    } finally {
      Combat.attack = realAttack;
    }
    var after = Rules.citiesOf(g, foe).map(function (c) { return c.name + ":" + c.hp + "hp"; });
    log.push("warTurns=" + t, "attacks=" + st.attacks, "dealt=" + st.dealt, "taken=" + st.taken, "unitsLost=" + st.died,
      "cityHits=" + st.cityHits, "minCityHp=" + st.minCityHp, "captured=" + st.captured.join("+"), "razed=" + st.razed.join("+"),
      "foeCitiesBefore=" + citiesBefore.join("+"), "foeCitiesAfter=" + after.join("+"),
      "foeEliminated=" + !!g.civs[foe].eliminated, "stillAtWar=" + Combat.atWar(g, 0, foe), "stop=" + stopped);
  }

  function findAttack(g) {
    var best = null;
    Rules.unitsOf(g, 0).forEach(function (u) {
      if (u.moves <= 0 || Combat.strengthOf(u.type) <= 0) return;
      Rules.neighbours(g, state.index.get(Rules.key(u.q, u.r))).forEach(function (t) {
        var pv = Combat.preview(g, u, t.q, t.r);
        if (!pv.ok) return;
        var mods = pv.defender.mods.concat(pv.attacker.mods).filter(function (m) { return !m.hp; }).length;
        var score = (pv.kind === "unit" ? 3 : pv.kind === "city" ? 2 : 1) + mods * 2;
        if (!best || score > best.score) best = { u: u, t: t, kind: pv.kind, score: score, mods: mods };
      });
    });
    return best;
  }

  function nearFoeCity(g, hit, foe) {
    return Rules.citiesOf(g, foe).some(function (c) { return Rules.hexDistance(c.q, c.r, hit.q, hit.r) <= 2; }) &&
      tileVisible(Rules.key(hit.q, hit.r));
  }

  /*
   * ?shipdemo=1 (after autoplay): STAGED for a screenshot. The player's first
   * ship and two land units are placed in a port, the units board through the
   * real Naval.board rule, and the ship then sails up to 3 real moves along the coast.
   */
  function shipDemo() {
    var g = state.game, log = [];
    var ship = Rules.unitsOf(g, 0).filter(function (u) { return u.type === "trireme"; })[0] ||
      Rules.unitsOf(g, 0).filter(function (u) { return Naval.isNaval(u.type); })[0];
    var port = Rules.citiesOf(g, 0).filter(function (c) { return Naval.coastal(g, c); })[0];
    if (!ship || !port) { document.body.setAttribute("data-shipdemo", "no ship or port"); return; }
    Rules.placeUnit(g, ship, port.q, port.r);
    var land = Rules.unitsOf(g, 0).filter(function (u) { return !Naval.isNaval(u.type) && u.aboard == null && Combat.strengthOf(u.type) > 0; }).slice(0, 2);
    land.forEach(function (u) { Rules.placeUnit(g, u, port.q, port.r); u.moves = 1; log.push("board " + u.type + "=" + Naval.board(g, u.id, ship.id).ok); });
    ship.moves = Rules.maxMoves(g, ship.type);
    // Sail: the reachable coast tile 3 moves out that stays next to land.
    var reach = Rules.reachable(g, ship), best = null;
    reach.forEach(function (n) {
      if (!Rules.isWater(n.tile)) return;
      var nearLand = Rules.neighbours(g, n.tile).some(function (t) { return !Rules.isWater(t); });
      if (nearLand && (!best || n.used > best.used || (n.used === best.used && n.tile.q + n.tile.r < best.tile.q + best.tile.r))) best = n;
    });
    if (best) log.push("sail=" + Rules.moveUnit(g, ship.id, best.tile.q, best.tile.r).ok);
    log.push("aboard=" + Rules.cargoOf(g, ship).map(function (c) { return c.type + "@" + c.q + "," + c.r; }).join("+"), "ship=" + ship.q + "," + ship.r);
    state.selCity = null;
    selectUnit(ship.id);
    centerOn(ship.q, ship.r, state.fitZoom * 6);
    state.cam.x -= 60;
    state.hover = null;
    document.getElementById("feedHead").click();
    refreshUi();
    document.body.setAttribute("data-shipdemo", log.join(";"));
    saveNow();
  }

  /*
   * ?capdemo=1 (after autoplay): STAGED for a screenshot. War on the first met
   * rival with 2+ cities; a player Swordsman is placed next to its capital, the
   * capital's HP is set to 0, and the capture runs through the real
   * Combat.attack, so the capital relocation, event and notice are genuine.
   */
  function capDemo() {
    var g = state.game, log = [];
    var foe = Diplo.metCivs(g, 0).filter(function (c) { return Rules.citiesOf(g, c).length >= 2; })[0];
    if (foe == null) { document.body.setAttribute("data-capdemo", "no rival with 2+ cities met"); return; }
    if (!Combat.atWar(g, 0, foe)) Diplo.declareWar(g, 0, foe);
    var cap = Rules.citiesOf(g, foe).filter(function (c) { return c.capital; })[0];
    var spot = Rules.neighbours(g, state.index.get(Rules.key(cap.q, cap.r))).filter(function (t) {
      return !Rules.isWater(t) && Rules.moveCost(t) !== Infinity && !g.units.some(function (u) { return u.q === t.q && u.r === t.r; }) && !g.cityAt.has(Rules.key(t.q, t.r));
    })[0];
    var u = Rules.unitsOf(g, 0).filter(function (x) { return Combat.strengthOf(x.type) > 0 && !Naval.isNaval(x.type) && x.aboard == null; })[0];
    g.units = g.units.filter(function (x) { return !(x.q === cap.q && x.r === cap.r); });   // garrison already beaten
    Rules.placeUnit(g, u, spot.q, spot.r);
    u.moves = 1; cap.hp = 0;
    Rules.reveal(g, cap.q, cap.r, 3, 0);
    checkCapitals();
    log.push("foe=" + Rules.civName(g, foe), "capital=" + cap.name + ":pop" + cap.pop);
    state.selCity = null;
    selectUnit(u.id);
    centerOn(cap.q, cap.r, state.fitZoom * 3.4);
    doAttack(u, state.index.get(Rules.key(cap.q, cap.r)));
    var nc = Rules.citiesOf(g, foe).filter(function (c) { return c.capital; })[0];
    log.push("newCapital=" + (nc ? nc.name + ":pop" + nc.pop : "none"), "eliminated=" + !!g.civs[foe].eliminated);
    state.freezeFx = true;
    state.fx.forEach(function (f) { f.frozen = 0.25; });
    render();
    document.body.setAttribute("data-capdemo", log.join(";"));
  }

  // Freeze the latest effects mid-flight for a still screenshot.
  function freezeOn(hit) {
    state.fx.forEach(function (f) { f.frozen = f.kind === "lunge" ? 0.5 : 0.22; });
    state.freezeFx = true;
    selectUnit(null); state.selCity = null; state.hover = null;
    centerOn(hit.q, hit.r, state.fitZoom * 3.4);
    refreshUi();
  }

  // ---------------------------------------------------------------- boot
  // ?civ=default        skip the creator, play the default civ
  // ?autoplay=N         (implies ?civ=default unless a demo is running) script N turns
  // ?demo=creator       open the creator, randomize (rseed) and pick traits, then stop
  // ?demo=play          as above, press Start game, then run ?autoplay
  // ?seed=xyz           map seed for direct starts
  var params = {};
  location.search.replace(/[?&]([^=&]+)=?([^&]*)/g, function (m, k, v) { params[k] = decodeURIComponent(v); });
  if (params.art) state.art = params.art === "diorama" ? "diorama" : "classic";
  var autoTurns = params.autoplay ? Math.min(400, parseInt(params.autoplay, 10) || 0) : 0;
  state.size = Gen.SIZES[params.size] ? params.size : Creator.size();
  state.rivals = Math.max(1, Math.min(Creator.maxRivals(state.size), parseInt(params.rivals, 10) || Creator.rivals()));

  function startAndMaybeAutoplay(civ, seed) {
    resizeCanvas();
    startGame(generate(seed || DEFAULT_SEED, state.size), civ);
    if (autoTurns) autoplay(autoTurns);
  }

  // Compact fingerprint of the full game state, for the headless save test.
  function stateProbe(label) {
    if (params.probe == null || !state.game) return;
    var json = JSON.stringify(Rules.exportState(state.game));
    var h = 2166136261;
    for (var i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 16777619); }
    var g = state.game, cam = cameraState();
    document.body.setAttribute("data-state", [
      label, "hash=" + (h >>> 0).toString(16), "len=" + json.length, "turn=" + g.turn,
      "cities=" + g.cities.map(function (c) { return c.name + ":" + c.pop + "@" + c.q + "," + c.r; }).join("|"),
      "units=" + g.units.map(function (u) { return u.type + "@" + u.q + "," + u.r + ":" + u.hp + (u.fort ? "F" : "") + (u.fortifying ? "f" : ""); }).join("|"),
      "cityHp=" + g.cities.map(function (c) { return c.hp; }).join(","),
      "gold=" + g.gold, "science=" + g.science, "tech=" + g.tech.done.join("+") + ">" + g.tech.current + ":" + g.tech.progress,
      "revealed=" + g.revealed.size, "cam=" + cam.cx.toFixed(0) + "," + cam.cy.toFixed(0) + "x" + cam.zr.toFixed(2)
    ].join(";"));
  }

  function openCreator(forceForm) {
    if (!params.size) state.size = Creator.size();
    previewWorld(params.seed || "");
    var saved = Save.read();
    Creator.open({
      seed: params.seed,
      forceForm: forceForm,
      save: Save.summary(saved),
      onContinue: function () {
        var n = Save.latestSlot();
        var data = n == null ? null : Save.readSlot(n);
        if (data) { resumeGame(data); state.slot = n; stateProbe("resumed"); }
      },
      onExport: function () { var d = Save.read(); if (d) Save.download(d); },
      onLoadGame: function () { openSaves("load"); },
      onImport: function (file, cb) {
        Save.parseFile(file, function (err, data) {
          if (err) { cb(err); return; }
          try { Creator.close(); resumeGame(data); saveNow(); cb(null); } catch (e) { cb(e); }
        });
      },
      onSeed: function (seed) { previewWorld(seed); },
      onSize: function (sz, seed) { state.size = sz; previewWorld(seed); },
      onStart: function (civ, seed) { state.size = Creator.size(); state.rivals = Creator.rivals(); startAndMaybeAutoplay(civ, seed); }
    });
  }

  // ?icons=1: the whole icon sprite in a grid (debug sheet), at map and panel sizes.
  function showIconSheet() {
    var I = window.PlanetIcons, el = document.createElement("div");
    el.id = "iconSheet";
    var html = '<h2>Icon sprite · ' + I.names().length + ' icons · 24×24 grid, flat fill + one accent + dark outline</h2>';
    I.GROUPS.forEach(function (gname) {
      html += '<div class="is-group"><div class="is-title">' + gname + "</div>";
      I.names(gname).forEach(function (n) {
        var unit = n.indexOf("u_") === 0, era = unit ? I.unitEra(n.slice(2)) : 0;
        html += '<div class="is-cell"><canvas data-icon="' + n + '"></canvas><span class="is-svg">' +
          I.svg(n, 24, unit ? { base: "#f6efe0", accent: I.eraTint(era) } : null) + I.svg(n, 16, unit ? { base: "#f6efe0", accent: I.eraTint(era) } : null) +
          '</span><span class="is-name">' + n.replace(/^(u|w|s|m|ui|p)_/, "") + "</span></div>";
      });
      html += "</div>";
    });
    el.innerHTML = html;
    document.body.appendChild(el);
    var dpr = window.devicePixelRatio || 1;
    Array.prototype.forEach.call(el.querySelectorAll("canvas[data-icon]"), function (cv) {
      var n = cv.getAttribute("data-icon"), g = cv.getContext("2d"), unit = n.indexOf("u_") === 0;
      cv.width = cv.height = 34 * dpr; cv.style.width = cv.style.height = "34px";
      g.scale(dpr, dpr);
      if (unit) {
        // As on the map: a civ-coloured token with the silhouette in light ink and an era tint.
        g.beginPath(); g.arc(17, 17, 15.5, 0, Math.PI * 2); g.fillStyle = "#8a2a24"; g.fill();
        g.lineWidth = 2; g.strokeStyle = "#f0d8a0"; g.stroke();
        I.draw(g, n, 17, 17, 22, dpr, { base: "#f6efe0", accent: I.eraTint(I.unitEra(n.slice(2))) });
      } else I.draw(g, n, 17, 17, 28, dpr);
    });
    document.body.setAttribute("data-icons", I.names().length + ";cache=" + JSON.stringify(I.stats()));
  }

  // Art style (art test): Classic flat hexes or the low-poly Diorama (diorama.js).
  function setArt(v) {
    v = v === "diorama" && window.PlanetDiorama ? "diorama" : "classic";
    if (state.art === v) return;
    state.art = v; state.tcache = null; state.layers = null;
    try { localStorage.setItem("civPlanet.art", v); } catch (e) { /* storage blocked */ }
    render();
  }
  try { if (localStorage.getItem("civPlanet.art") === "diorama") state.art = "diorama"; } catch (e) { /* ignore */ }
  Anim.init({ kick: function () { animate(); }, visible: function (k) { return !state.game || tileVisible(k); } });
  // Settings popover: animations on/off, speed, AI moves, ambient water.
  (function () {
    var pop = document.getElementById("settingsPop"), btn = document.getElementById("settingsBtn");
    function sync() {
      document.getElementById("setAnim").checked = !!Anim.settings.on;
      document.getElementById("setSpeed").value = String(Anim.settings.speed);
      document.getElementById("setAi").checked = !!Anim.settings.ai;
      document.getElementById("setWater").checked = !!Anim.settings.water;
      document.getElementById("setArt").value = state.art;
      document.body.classList.toggle("no-anim", !Anim.settings.on);
    }
    btn.addEventListener("click", function (ev) { ev.stopPropagation(); ev.currentTarget.blur(); pop.classList.toggle("hidden"); sync(); });
    document.addEventListener("click", function (ev) { if (!ev.target.closest("#settingsPop") && !ev.target.closest("#settingsBtn")) pop.classList.add("hidden"); });
    pop.addEventListener("change", function () {
      Anim.set("on", document.getElementById("setAnim").checked);
      Anim.set("speed", parseFloat(document.getElementById("setSpeed").value) || 1);
      Anim.set("ai", document.getElementById("setAi").checked);
      Anim.set("water", document.getElementById("setWater").checked);
      setArt(document.getElementById("setArt").value);
      if (!Anim.settings.on) skipAnimations();
      sync(); render(); animate();
    });
    document.getElementById("skipAnim").addEventListener("click", function () { skipAnimations(); });
    if (params.anim === "0" || params.anim === "1") Anim.settings.on = params.anim === "1";
    // Scripted runs (screenshots): CSS transitions off so toasts and panels are not caught mid-fade.
    if (params.autoplay || params.stage || params.s15 || params.icons) document.body.classList.add("shot");
    sync();
  })();

  // Icon slots in the static HTML (top bar buttons and stats).
  Array.prototype.forEach.call(document.querySelectorAll("[data-icon]"), function (el) {
    el.insertAdjacentHTML("afterbegin", Icons.svg(el.getAttribute("data-icon"), +(el.getAttribute("data-px") || 18)));
  });

  resizeCanvas();
  requestAnimationFrame(function () {
    resizeCanvas();
    if (params.icons) { showIconSheet(); return; }
    if (params.demo === "creator" || params.demo === "play") {
      openCreator(true);
      Creator.demo(parseInt(params.rseed || "27", 10), (params.traits || "industrious,scholarly").split(","));
      if (params.size) Creator.setSize(params.size);
      if (params.rivals) Creator.setRivals(+params.rivals);
      if (params.demo === "play") document.getElementById("cr-start").click();
      document.body.setAttribute("data-demo", params.demo + ":" + (state.civ ? state.civ.name : "creator-open"));
    } else if (params.civ === "default" || autoTurns) {
      startAndMaybeAutoplay(Civ.DEFAULT_CIV, params.seed);
    } else {
      openCreator(false);
      if (params.probe === "continue") document.getElementById("cr-continue").click();
    }
    if (params.shipdemo && state.game) shipDemo();
    if (params.capdemo && state.game) capDemo();
    if (params.fortify && state.game) {
      // Save test: leave one unit mid-fortify so the flag goes through the save.
      var fu = Rules.unitsOf(state.game, 0).filter(function (u) { return u.moves > 0 && Combat.strengthOf(u.type) > 0; })[0];
      if (fu) { selectUnit(fu.id); key("f"); }
      saveNow();
    }
    if (params.probe === "end") stateProbe("live");
    if (params.more && state.game) {
      for (var mt = 0; mt < (parseInt(params.more, 10) || 0); mt++) {
        AI.takeTurn(state.game, 0);
        key("Enter");
        if (Panels.contactOpen()) Panels.closeAllContacts();
      }
      state.fx = [];
      stateProbe("more");
    }
    if (params.fog === "0") {
      state.showFog = false;
      document.getElementById("showFog").checked = false;
    }
    if (params.view === "world" && state.game) {
      selectUnit(null); state.selCity = null; state.hover = null;
      document.getElementById("feedHead").click();      // collapse the feed so the map shows
      fit(state.tiles);
      refreshUi();
    }
    if (params.panel === "diplo" && state.game) openDiplomacy();
    if (params.buytile && state.game && state.selCity != null) { var bt = document.getElementById("cpBuyTile"); if (bt) bt.click(); }
    if (params.stage && state.game) stage9(params.stage);
    if (params.s15 && state.game) stage15(params.s15);
    if (params.s16 && state.game) stage16(params.s16);
    if (params.artshot && state.game) stageArt(params.artshot);
    if (params.animperf && state.game) document.body.setAttribute("data-animperf", animPerf());
    if (params.tree && state.game) {
      openTree();
      document.body.setAttribute("data-tree", "open");
    }
  });
})();
