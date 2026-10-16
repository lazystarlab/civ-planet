/*
 * mapgen.js — MAP GENERATOR (planet).
 * Pure functions of the seed; no DOM, no game rules. Exposes PlanetGen.
 * A galaxy generator can later live beside this file and expose the same
 * generate(seed, size) -> { tiles, seed, size, cols, rows } contract.
 */
(function (root) {
  "use strict";

  // Map sizes. Standard is the original 72x50 grid, so old seeds and saves are unchanged.
  var SIZES = {
    small:    { name: "Small",    cols: 48,  rows: 32 },
    standard: { name: "Standard", cols: 72,  rows: 50 },
    large:    { name: "Large",    cols: 100, rows: 64 },
    huge:     { name: "Huge",     cols: 128, rows: 84 }
  };
  var SIZE_ORDER = ["small", "standard", "large", "huge"];
  var DEFAULT_SIZE = "standard";
  var COLS = 72;
  var ROWS = 50;
  var SEA_LEVEL = 0.40;
  var DEFAULT_SEED = "marco";
  var RIVER_PCT = 0.92;
  var RIVER_MIN_FLOW = 6;
  var RIVER_MIN_LEN = 4;
  var RIVER_MAX_SYSTEMS = 20;

  var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  var BIOMES = {
    deep_ocean: "Deep Ocean",
    coast: "Coast",
    plains: "Plains",
    grassland: "Grassland",
    forest: "Forest",
    jungle: "Jungle",
    desert: "Desert",
    hills: "Hills",
    mountain: "Mountain",
    tundra: "Tundra",
    snow: "Snow"
  };

  // Resource catalogue: biome weights are per-tile spawn chances before spacing.
  var RESOURCES = {
    wheat:  { name: "Wheat",  glyph: "W", color: "#e2c14a", ink: "#3a2e08", biomes: { plains: 0.04, grassland: 0.045 } },
    horses: { name: "Horses", glyph: "H", color: "#9a6a3c", ink: "#fff6e6", biomes: { plains: 0.045, grassland: 0.02 } },
    fish:   { name: "Fish",   glyph: "F", color: "#7fd0e6", ink: "#0d3445", biomes: { coast: 0.035 } },
    iron:   { name: "Iron",   glyph: "I", color: "#8e9aa6", ink: "#13181d", biomes: { hills: 0.065, mountain: 0.04 } },
    gold:   { name: "Gold",   glyph: "G", color: "#f2cf3a", ink: "#5a4300", biomes: { hills: 0.03, mountain: 0.05 } },
    gems:   { name: "Gems",   glyph: "\u25C6", color: "#c0458a", ink: "#ffe6f4", biomes: { jungle: 0.05, mountain: 0.015 } },
    spices: { name: "Spices", glyph: "S", color: "#d2672e", ink: "#fff1e4", biomes: { jungle: 0.05, grassland: 0.006 } },
    oil:    { name: "Oil",    glyph: "O", color: "#262a2e", ink: "#f2efe6", biomes: { desert: 0.045, tundra: 0.025 } },
    timber: { name: "Timber", glyph: "T", color: "#3e7a3a", ink: "#ecf6e2", biomes: { forest: 0.045 } },
    deer:   { name: "Deer",   glyph: "D", color: "#b98a5a", ink: "#2c1c0c", biomes: { tundra: 0.035, forest: 0.015 } },
    // Slice 15: late strategic deposits, placed in a second pass (see placeStrategic).
    coal:     { name: "Coal",     glyph: "C", color: "#3a3d42", ink: "#f2efe6", biomes: { hills: 0.05, forest: 0.012, plains: 0.008 }, late: true },
    aluminum: { name: "Aluminum", glyph: "A", color: "#c7ced6", ink: "#20262c", biomes: { desert: 0.035, plains: 0.01, hills: 0.015 }, late: true },
    uranium:  { name: "Uranium",  glyph: "U", color: "#7ad04a", ink: "#14240c", biomes: { tundra: 0.03, desert: 0.012, jungle: 0.012, hills: 0.008 }, late: true }
  };
  var LATE_ORDER = ["coal", "aluminum", "uranium"];
  var RESOURCE_ORDER = ["wheat", "horses", "fish", "iron", "gold", "gems", "spices", "oil", "timber", "deer"];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hash32(x, y, seed) {
    var n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function smooth(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function valueNoise(x, y, seed) {
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var tx = smooth(x - x0);
    var ty = smooth(y - y0);
    var v00 = hash32(x0, y0, seed);
    var v10 = hash32(x0 + 1, y0, seed);
    var v01 = hash32(x0, y0 + 1, seed);
    var v11 = hash32(x0 + 1, y0 + 1, seed);
    var a = v00 + (v10 - v00) * tx;
    var b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  }

  function fbm(x, y, seed) {
    var amp = 0.5;
    var freq = 1;
    var sum = 0;
    var norm = 0;
    for (var i = 0; i < 5; i++) {
      sum += amp * valueNoise(x * freq, y * freq, (seed + i * 1013) >>> 0);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /*
   * GENERATOR BOUNDARY
   * generate(seed) is the only map source. It returns
   *   { tiles, seed, cols, rows }
   * and each tile is { q, r, biome, elevation, river, riverDir, resource }
   * in axial coords. river is accumulated flow (0 = no river), riverDir is
   * the DIRS index the water leaves toward (-1 = none), resource is a key
   * of RESOURCES or null.
   * elevation is normalized 0..1, sea level near 0.40 (below = depth,
   * above = height). draw(tiles) does not know how the field was built.
   * A galaxy generator can later return this same tile shape for one
   * world and be handed to draw() without changing the renderer.
   */
  function generate(seed, size) {
    var text = String(seed == null || seed === "" ? DEFAULT_SEED : seed);
    var S = hashString(text);
    var sizeKey = SIZES[size] ? size : DEFAULT_SIZE;
    var COLS = SIZES[sizeKey].cols, ROWS = SIZES[sizeKey].rows;
    // Noise is sampled in "standard" coordinates scaled by f: bigger maps get
    // partly bigger continents and partly more of them (f = 1 on Standard).
    var f = Math.pow(72 / COLS, 0.6);
    var cells = [];
    var r, q, x, y, warpX, warpY, sx, sy, base, broad, ridge, elev;
    var moistN, tempN, lat, temp;

    var col;
    for (r = 0; r < ROWS; r++) {
      for (col = 0; col < COLS; col++) {
        // Odd-r rectangle, stored as axial so the renderer stays shape-agnostic.
        q = col - (r >> 1);
        x = (col + (r & 1) * 0.5) * f;
        y = r * 0.8660254037844386 * f;
        warpX = fbm(x * 0.045, y * 0.045, S + 11) - 0.5;
        warpY = fbm(x * 0.045 + 19.2, y * 0.045, S + 29) - 0.5;
        sx = x * 0.05 + warpX * 1.15;
        sy = y * 0.05 + warpY * 1.15;
        broad = fbm(x * 0.034 + 3.0, y * 0.038, S + 8);
        base = fbm(sx, sy, S + 3);
        ridge = 1 - Math.abs(fbm(x * 0.09 + 7.0, y * 0.09, S + 41) * 2 - 1);
        elev = broad * 0.48 + base * 0.52;
        elev = elev * 0.74 + ridge * elev * 0.42;
        moistN = fbm(x * 0.055 + 40.0, y * 0.055, S + 99);
        tempN = fbm(x * 0.03, y * 0.03 + 80.0, S + 53);
        lat = Math.abs((r + 0.5) / ROWS - 0.5) * 2;
        temp = clamp((1 - Math.pow(lat, 1.08)) * 0.94 + (tempN - 0.5) * 0.16, 0, 1);
        cells.push({
          q: q,
          r: r,
          raw: elev,
          moisture: moistN,
          temp: temp,
          lat: lat
        });
      }
    }

    var sorted = cells.map(function (t) { return t.raw; }).sort(function (a, b) { return a - b; });
    var sea = sorted[Math.floor(sorted.length * 0.57)];
    var emin = sorted[0];
    var emax = sorted[sorted.length - 1];
    var index = new Map();

    for (var i = 0; i < cells.length; i++) {
      var t = cells[i];
      if (t.raw <= sea) {
        t.elevation = SEA_LEVEL * (t.raw - emin) / Math.max(1e-6, sea - emin);
        t.water = true;
      } else {
        t.elevation = SEA_LEVEL + (1 - SEA_LEVEL) * (t.raw - sea) / Math.max(1e-6, emax - sea);
        t.water = false;
      }
      t.distLand = t.water ? 99 : 0;
      t.distWater = t.water ? 0 : 99;
      index.set(t.q + "," + t.r, t);
    }

    var landQ = [];
    var waterQ = [];
    for (i = 0; i < cells.length; i++) {
      if (cells[i].water) waterQ.push(cells[i]);
      else landQ.push(cells[i]);
    }

    var qi, cur, nbi, dq, dr, nb;
    for (qi = 0; qi < landQ.length; qi++) {
      cur = landQ[qi];
      if (cur.distLand >= 3) continue;
      for (nbi = 0; nbi < 6; nbi++) {
        dq = DIRS[nbi][0];
        dr = DIRS[nbi][1];
        nb = index.get((cur.q + dq) + "," + (cur.r + dr));
        if (nb && nb.distLand > cur.distLand + 1) {
          nb.distLand = cur.distLand + 1;
          landQ.push(nb);
        }
      }
    }
    for (qi = 0; qi < waterQ.length; qi++) {
      cur = waterQ[qi];
      if (cur.distWater >= 9) continue;
      for (nbi = 0; nbi < 6; nbi++) {
        dq = DIRS[nbi][0];
        dr = DIRS[nbi][1];
        nb = index.get((cur.q + dq) + "," + (cur.r + dr));
        if (nb && nb.distWater > cur.distWater + 1) {
          nb.distWater = cur.distWater + 1;
          waterQ.push(nb);
        }
      }
    }

    var landElev = [];
    for (i = 0; i < cells.length; i++) {
      t = cells[i];
      if (t.water) continue;
      var equatorial = Math.exp(-(t.lat * t.lat) / (2 * 0.22 * 0.22));
      var subtropical = Math.exp(-Math.pow(t.lat - 0.46, 2) / (2 * 0.13 * 0.13));
      var coastal = 1 - Math.min(t.distWater, 8) / 8;
      var m = t.moisture * 0.70 + coastal * 0.22 + equatorial * 0.14 - subtropical * 0.22;
      t.moisture = clamp(m, 0, 1);
      landElev.push(t.elevation);
    }
    landElev.sort(function (a, b) { return a - b; });
    var hillAt = landElev.length ? landElev[Math.floor(landElev.length * 0.84)] : 1;
    var mountAt = landElev.length ? landElev[Math.floor(landElev.length * 0.94)] : 1;

    var tiles = cells.map(function (c) {
      var biome;
      if (c.water) {
        biome = c.distLand === 1 ? "coast" : "deep_ocean";
      } else if (c.elevation >= mountAt) {
        biome = "mountain";
      } else if (c.elevation >= hillAt) {
        biome = "hills";
      } else if (c.temp < 0.18) {
        biome = "snow";
      } else if (c.temp < 0.33) {
        biome = "tundra";
      } else if (c.moisture < 0.36 && c.temp > 0.46) {
        biome = "desert";
      } else if (c.moisture > 0.66 && c.temp > 0.56) {
        biome = "jungle";
      } else if (c.moisture > 0.52) {
        biome = "forest";
      } else if (c.moisture > 0.40) {
        biome = "grassland";
      } else {
        biome = "plains";
      }
      return {
        q: c.q,
        r: c.r,
        biome: biome,
        elevation: c.elevation,
        river: 0,
        riverDir: -1,
        resource: null
      };
    });

    carveRivers(cells, tiles, S, Math.round(RIVER_MAX_SYSTEMS * (COLS * ROWS) / (72 * 50)));
    placeResources(tiles, S); placeStrategic(tiles, S);

    return { tiles: tiles, seed: text, size: sizeKey, cols: COLS, rows: ROWS };
  }

  // Priority-flood from every water tile: each land tile gets one downstream
  // neighbour along a monotone path to the sea (or an inland lake), which also
  // routes water out of pits. Rain is then accumulated downstream; tiles whose
  // flow clears a seed-relative threshold become river.
  function carveRivers(cells, tiles, S, maxSystems) {
    var n = cells.length;
    var id = new Map();
    var i, k, c;
    for (i = 0; i < n; i++) id.set(cells[i].q + "," + cells[i].r, i);
    var nbr = new Array(n);
    for (i = 0; i < n; i++) {
      var list = [];
      for (k = 0; k < 6; k++) {
        var j = id.get((cells[i].q + DIRS[k][0]) + "," + (cells[i].r + DIRS[k][1]));
        if (j !== undefined) list.push(j, k);
      }
      nbr[i] = list;
    }

    var filled = new Float64Array(n);
    var down = new Int32Array(n).fill(-1);
    var downDir = new Int8Array(n).fill(-1);
    var seen = new Uint8Array(n);
    var order = [];
    var heap = [];

    function less(a, b) {
      return filled[a] < filled[b] || (filled[a] === filled[b] && a < b);
    }
    function push(v) {
      heap.push(v);
      var a = heap.length - 1;
      while (a > 0) {
        var p = (a - 1) >> 1;
        if (!less(heap[a], heap[p])) break;
        var tmp = heap[p]; heap[p] = heap[a]; heap[a] = tmp;
        a = p;
      }
    }
    function pop() {
      var top = heap[0];
      var last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var a = 0;
        for (;;) {
          var l = a * 2 + 1, r = l + 1, m = a;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === a) break;
          var tmp = heap[m]; heap[m] = heap[a]; heap[a] = tmp;
          a = m;
        }
      }
      return top;
    }

    for (i = 0; i < n; i++) {
      if (cells[i].water) {
        seen[i] = 1;
        filled[i] = cells[i].elevation;
        push(i);
      }
    }
    while (heap.length) {
      c = pop();
      if (!cells[c].water) order.push(c);
      var nb = nbr[c];
      for (k = 0; k < nb.length; k += 2) {
        var m2 = nb[k];
        if (seen[m2]) continue;
        seen[m2] = 1;
        down[m2] = c;
        downDir[m2] = (nb[k + 1] + 3) % 6;
        var jitter = hash32(cells[m2].q, cells[m2].r, S + 313) * 0.004;
        filled[m2] = Math.max(cells[m2].elevation + jitter, filled[c] + 1e-5);
        push(m2);
      }
    }
    if (!order.length) return;

    // Rain: wetter and higher tiles feed more water.
    var flow = new Float64Array(n);
    for (i = 0; i < order.length; i++) {
      c = cells[order[i]];
      var hi = Math.max(0, c.elevation - SEA_LEVEL) / (1 - SEA_LEVEL);
      flow[order[i]] = (0.15 + c.moisture) * (0.55 + hi * 1.6) * (c.temp < 0.12 ? 0.4 : 1);
    }
    for (i = order.length - 1; i >= 0; i--) {
      c = order[i];
      if (!cells[down[c]].water) flow[down[c]] += flow[c];
    }
    var landFlows = [];
    for (i = 0; i < order.length; i++) landFlows.push(flow[order[i]]);
    landFlows.sort(function (a, b) { return a - b; });
    var threshold = Math.max(RIVER_MIN_FLOW, landFlows[Math.floor(landFlows.length * RIVER_PCT)]);

    // Group river tiles by mouth, measure longest channel, keep meaningful ones.
    var isRiver = new Uint8Array(n);
    var mouth = new Int32Array(n).fill(-1);
    var len = new Int32Array(n);
    for (i = 0; i < order.length; i++) {
      c = order[i];
      if (flow[c] < threshold) continue;
      isRiver[c] = 1;
      mouth[c] = cells[down[c]].water ? c : mouth[down[c]];
    }
    for (i = order.length - 1; i >= 0; i--) {
      c = order[i];
      if (!isRiver[c]) continue;
      len[c] += 1;
      if (!cells[down[c]].water && len[down[c]] < len[c]) len[down[c]] = len[c];
    }
    var systems = [];
    for (i = 0; i < order.length; i++) {
      c = order[i];
      if (isRiver[c] && mouth[c] === c && len[c] >= RIVER_MIN_LEN) systems.push(c);
    }
    systems.sort(function (a, b) { return flow[b] - flow[a] || a - b; });
    var keep = new Set(systems.slice(0, maxSystems || RIVER_MAX_SYSTEMS));

    for (i = 0; i < n; i++) {
      if (!isRiver[i] || !keep.has(mouth[i])) continue;
      tiles[i].river = Math.round(flow[i] * 10) / 10;
      tiles[i].riverDir = downDir[i];
    }

    // Carve valleys: walking from sources toward the mouth (reverse flood
    // order), a river tile may not sit higher than the tile feeding it, so
    // stored elevation decreases monotonically along every channel.
    for (i = order.length - 1; i >= 0; i--) {
      c = order[i];
      if (!(tiles[c].river > 0)) continue;
      var d2 = down[c];
      if (cells[d2].water) continue;
      var cap = Math.max(SEA_LEVEL + 0.002, tiles[c].elevation - 0.0005);
      if (tiles[d2].elevation > cap) tiles[d2].elevation = cap;
    }
  }

  // Sparse, biome-weighted resources; no two resources on adjacent tiles.
  function placeResources(tiles, S) {
    var byKey = new Map();
    var i, k;
    for (i = 0; i < tiles.length; i++) byKey.set(tiles[i].q + "," + tiles[i].r, tiles[i]);
    var order = tiles.slice().sort(function (a, b) {
      return hash32(a.q, a.r, S + 701) - hash32(b.q, b.r, S + 701) || a.q - b.q || a.r - b.r;
    });
    for (i = 0; i < order.length; i++) {
      var t = order[i];
      var roll = hash32(t.q, t.r, S + 977);
      var pick = null;
      var acc = 0;
      for (k = 0; k < RESOURCE_ORDER.length; k++) {
        var key = RESOURCE_ORDER[k];
        var w = RESOURCES[key].biomes[t.biome] || 0;
        if (key === "wheat" && t.river > 0) w *= 1.6;
        acc += w;
        if (roll < acc) { pick = key; break; }
      }
      if (!pick) continue;
      var crowded = false;
      for (k = 0; k < 6 && !crowded; k++) {
        var nb = byKey.get((t.q + DIRS[k][0]) + "," + (t.r + DIRS[k][1]));
        if (nb && nb.resource) crowded = true;
      }
      if (!crowded) t.resource = pick;
    }
  }

  // Coal, aluminum and uranium go on empty, uncrowded tiles after the
  // classic resources, so older resources keep their places for a seed.
  function placeStrategic(tiles, S) {
    var byKey = new Map(), i, k;
    for (i = 0; i < tiles.length; i++) byKey.set(tiles[i].q + "," + tiles[i].r, tiles[i]);
    var order = tiles.slice().sort(function (a, b) { return hash32(a.q, a.r, S + 1303) - hash32(b.q, b.r, S + 1303) || a.q - b.q || a.r - b.r; });
    for (i = 0; i < order.length; i++) {
      var t = order[i];
      if (t.resource) continue;
      var roll = hash32(t.q, t.r, S + 1307), acc = 0, pick = null;
      for (k = 0; k < LATE_ORDER.length; k++) { acc += RESOURCES[LATE_ORDER[k]].biomes[t.biome] || 0; if (roll < acc) { pick = LATE_ORDER[k]; break; } }
      if (!pick) continue;
      var crowded = false;
      for (k = 0; k < 6 && !crowded; k++) { var nb = byKey.get((t.q + DIRS[k][0]) + "," + (t.r + DIRS[k][1])); if (nb && nb.resource) crowded = true; }
      if (!crowded) t.resource = pick;
    }
  }

  root.PlanetGen = {
    generate: generate,
    SIZES: SIZES,
    SIZE_ORDER: SIZE_ORDER,
    DEFAULT_SIZE: DEFAULT_SIZE,
    hash32: hash32,
    hashString: hashString,
    COLS: COLS,
    ROWS: ROWS,
    SEA_LEVEL: SEA_LEVEL,
    DEFAULT_SEED: DEFAULT_SEED,
    DIRS: DIRS,
    BIOMES: BIOMES,
    RESOURCES: RESOURCES, LATE_ORDER: LATE_ORDER,
    RESOURCE_ORDER: RESOURCE_ORDER
  };
})(typeof window !== "undefined" ? window : globalThis);
