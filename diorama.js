/*
 * diorama.js — "low-poly diorama" art mode (art test), canvas 2D only.
 *
 * Top-down on the existing pointy-top grid (so fog, borders, picking and
 * every overlay stay aligned), with each hex drawn as a raised block:
 * a faceted top (12 flat-shaded triangles, fixed top-left light), side walls
 * on the two lower edges, and per-biome props (cone pines, faceted mounds,
 * snow-capped peaks, dunes, rocks). Grass-level tops sit exactly on the grid;
 * water sits lower, hills and mountains higher, so walls only show where the
 * ground steps down. Tiles are drawn back to front (by screen y).
 *
 * Sprites are pre-rendered per biome x variant x size bucket into offscreen
 * canvases (a lazy atlas), so a frame is one drawImage per visible hex.
 * Units: Spearman and Warrior get a figurine on a hex base; cities get a
 * house-and-tower cluster by population tier (1-3, 4-7, 8+). Civ colours
 * tint shields, tunics and roofs.
 */
(function (root) {
  "use strict";
  var SQ3 = Math.sqrt(3);
  var L = norm([-0.55, -0.8, 1.0]);           // light from the top-left, above
  var BASE = -0.30;                            // block bottom, in hex radii below grass level
  var LIFT = { deep_ocean: -0.24, coast: -0.18, grassland: 0, plains: 0, desert: 0, tundra: 0.02, snow: 0.03,
    forest: 0.03, jungle: 0.03, hills: 0.13, mountain: 0.22 };
  var INSET = 0.93;                            // top face radius: a groove between blocks
  var TOP = {
    deep_ocean: [44, 120, 170], coast: [70, 196, 206], grassland: [140, 190, 74], plains: [196, 190, 98],
    forest: [104, 158, 70], jungle: [70, 140, 74], desert: [226, 190, 120], hills: [150, 170, 82],
    mountain: [150, 140, 128], tundra: [170, 180, 150], snow: [234, 240, 244]
  };
  var stats = { sprites: 0, draws: 0 };

  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function lightOf(n) { return Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]); }
  function rgb(c, k) { return "rgb(" + Math.round(Math.min(255, c[0] * k)) + "," + Math.round(Math.min(255, c[1] * k)) + "," + Math.round(Math.min(255, c[2] * k)) + ")"; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function hex2rgb(h) {
    if (!h || h[0] !== "#") return [160, 60, 50];
    if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function rnd(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }
  // Shade a 3D triangle (x right, y down, z up) by its facet normal.
  function tri(g, a, b, c, col, amb, gain) {
    var n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    var k = (amb == null ? 0.62 : amb) + (gain == null ? 0.52 : gain) * lightOf(n);
    g.beginPath(); g.moveTo(a[0], a[1] - a[2] * 0.35); g.lineTo(b[0], b[1] - b[2] * 0.35); g.lineTo(c[0], c[1] - c[2] * 0.35); g.closePath();
    g.fillStyle = rgb(col, k); g.fill();
    g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke();   // closes hairline seams
  }
  function corner(cx, cy, R, i) { var a = Math.PI / 180 * (60 * i - 30); return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; }

  // ---------------------------------------------------------------- tiles
  function sprite(cache, key, w, h, paint) {
    var s = cache[key];
    if (s) return s;
    var c = document.createElement("canvas");
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    paint(c.getContext("2d"), c.width, c.height);
    stats.sprites++;
    return (cache[key] = { c: c, w: c.width, h: c.height });
  }
  var TILE = {};
  // Sprite: R px hex radius; anchor = grid centre at grass level.
  function tileSprite(biome, variant, R) {
    var lift = LIFT[biome] != null ? LIFT[biome] : 0;
    var head = biome === "mountain" ? 1.25 : biome === "forest" || biome === "jungle" ? 0.75 : biome === "hills" ? 0.55 : 0.3;
    var W = SQ3 * R + 4, H = R * (2 + head + (lift - BASE) + 0.1) + 4;
    var s = sprite(TILE, biome + "|" + variant + "|" + R, W, H, function (g) {
      var cx = W / 2, gy = R * (1 + head) + 2, cy = gy - lift * R;
      var r = rnd(variant * 7919 + biome.length * 131 + 17);
      var base = TOP[biome] || [150, 150, 150];
      base = base.map(function (v) { return v * (0.95 + r() * 0.1); });
      var water = biome === "coast" || biome === "deep_ocean";
      // Walls: lower-left (lit a little) and lower-right (shade) edges, down to BASE.
      var drop = (lift - BASE) * R, Rt = R * INSET;
      // Block footprint at the bottom (dark), so grooves read as depth.
      g.beginPath(); for (var f = 0; f < 6; f++) { var fp = corner(cx, cy + drop, R * 0.99, f); if (f) g.lineTo(fp[0], fp[1]); else g.moveTo(fp[0], fp[1]); } g.closePath();
      g.fillStyle = water ? "rgba(16,40,60,0.9)" : "rgba(40,34,30,0.95)"; g.fill();
      var lip = water ? 0 : Math.min(drop, R * 0.07);
      var soil = water ? mix(base, [20, 60, 90], 0.45) : biome === "snow" ? [190, 200, 210] : biome === "desert" ? [196, 150, 96] : [128, 116, 104];
      [[0, 1, 0.5], [3, 4, 0.9], [1, 2, 0.55], [2, 3, 0.82]].forEach(function (e) {
        var a = corner(cx, cy, Rt, e[0]), b = corner(cx, cy, Rt, e[1]), a2 = corner(cx, cy + drop, R * 0.99, e[0]), b2 = corner(cx, cy + drop, R * 0.99, e[1]);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b2[0], b2[1]); g.lineTo(a2[0], a2[1]); g.closePath();
        g.fillStyle = rgb(soil, e[2]); g.fill();
        if (lip > 0) {
          g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0], b[1] + lip); g.lineTo(a[0], a[1] + lip); g.closePath();
          g.fillStyle = rgb(base, e[2] * 0.95); g.fill();
        }
        // Dark seam at the bottom of the wall.
        g.beginPath(); g.moveTo(a2[0], a2[1]); g.lineTo(b2[0], b2[1]);
        g.strokeStyle = "rgba(20,16,14,0.45)"; g.lineWidth = Math.max(1, R * 0.03); g.stroke();
      });
      // Faceted top: 12 triangles, a soft dome with jittered edge midpoints.
      var dome = water ? 0.05 : biome === "hills" ? 0.22 : 0.12;
      var C = [cx, cy, dome * R];
      for (var i = 0; i < 6; i++) {
        var a = corner(cx, cy, Rt, i), b = corner(cx, cy, Rt, i + 1);
        var mz = (r() - 0.4) * (water ? 0.12 : 0.1) * R;
        var m = [(a[0] + b[0]) / 2 + (r() - 0.5) * R * 0.08, (a[1] + b[1]) / 2 + (r() - 0.5) * R * 0.08, mz];
        var A = [a[0], a[1], 0], B = [b[0], b[1], 0];
        var tint = water ? base.map(function (v, j) { return v * (0.92 + r() * 0.16); }) : base;
        tri(g, C, A, m, tint, water ? 0.7 : 0.62, water ? 0.4 : 0.52);
        tri(g, C, m, B, tint, water ? 0.7 : 0.62, water ? 0.4 : 0.52);
      }
      // Bevel: light top-left edges, dark lower edges -> legible hex outlines.
      g.lineWidth = Math.max(1, R * 0.045); g.lineJoin = "round";
      for (var k = 0; k < 6; k++) {
        var p = corner(cx, cy, Rt * 0.985, k), q = corner(cx, cy, Rt * 0.985, k + 1);
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
        g.strokeStyle = k >= 3 ? "rgba(255,255,240,0.32)" : k === 0 ? "rgba(255,255,240,0.12)" : "rgba(20,30,20,0.32)";
        g.stroke();
      }
      props(g, biome, cx, cy, R, r, base);
    });
    s.ax = s.w / 2; s.ay = R * (1 + head) + 2;
    return s;
  }

  function pine(g, x, y, h, light) {
    var w = h * 0.42;
    g.beginPath(); g.ellipse(x + h * 0.16, y + h * 0.04, w * 0.95, w * 0.34, 0, 0, Math.PI * 2); g.fillStyle = "rgba(20,40,20,0.28)"; g.fill();
    g.fillStyle = "#6b4a2e"; g.fillRect(x - h * 0.04, y - h * 0.16, h * 0.08, h * 0.18);
    var dark = [34, 92, 52], lit = [72, 150, 78];
    [[0, 1, 0.62], [0.36, 0.72, 0.48]].forEach(function (t) {
      var by = y - h * (0.12 + t[0] * 0.55), ty = y - h * t[1] - h * 0.1, ww = w * t[2] / 0.62;
      g.beginPath(); g.moveTo(x, ty); g.lineTo(x - ww, by); g.lineTo(x - ww * 0.1, by + h * 0.05); g.closePath(); g.fillStyle = rgb(lit, light); g.fill();
      g.beginPath(); g.moveTo(x, ty); g.lineTo(x - ww * 0.1, by + h * 0.05); g.lineTo(x + ww, by); g.closePath(); g.fillStyle = rgb(dark, light); g.fill();
    });
  }
  function mound(g, x, y, w, h, col) {
    // Faceted dome: fan from an off-centre peak to an arc of base points.
    var px = x - w * 0.12, py = y - h, n = 6, pts = [];
    for (var i = 0; i <= n; i++) { var a = Math.PI * (1 - i / n); pts.push([x + Math.cos(a) * w, y - Math.sin(a) * h * 0.45 + (i % 2 ? h * 0.05 : 0)]); }
    g.beginPath(); g.ellipse(x + w * 0.15, y + h * 0.08, w * 1.02, h * 0.28, 0, 0, Math.PI * 2); g.fillStyle = "rgba(30,30,20,0.25)"; g.fill();
    for (var j = 0; j < n; j++) {
      var k = 1.08 - 0.5 * (j / (n - 1));
      g.beginPath(); g.moveTo(px, py); g.lineTo(pts[j][0], pts[j][1]); g.lineTo(pts[j + 1][0], pts[j + 1][1]); g.closePath();
      g.fillStyle = rgb(col, k); g.fill(); g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke();
    }
    // Front skirt.
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (var m = 1; m <= n; m++) g.lineTo(pts[m][0], pts[m][1]); g.lineTo(x + w * 0.9, y + h * 0.04); g.lineTo(x - w * 0.9, y + h * 0.04); g.closePath();
    g.fillStyle = rgb(col, 0.72); g.fill();
  }
  function peak(g, x, y, w, h, r) {
    var top = [x - w * 0.08, y - h], n = 5, base = [];
    for (var i = 0; i <= n; i++) base.push([x - w + 2 * w * i / n, y + (i % 2 ? -h * 0.12 : 0) + (r() - 0.5) * h * 0.06]);
    g.beginPath(); g.ellipse(x + w * 0.2, y + h * 0.05, w * 1.05, h * 0.16, 0, 0, Math.PI * 2); g.fillStyle = "rgba(20,20,30,0.3)"; g.fill();
    var rock = [138, 132, 128], snow = [244, 247, 250];
    for (var j = 0; j < n; j++) {
      var a = base[j], b = base[j + 1], k = 1.12 - 0.62 * (j / (n - 1)) + (r() - 0.5) * 0.08;
      g.beginPath(); g.moveTo(top[0], top[1]); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.closePath();
      g.fillStyle = rgb(rock, k); g.fill(); g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke();
      var s = 0.36 + r() * 0.08;
      g.beginPath(); g.moveTo(top[0], top[1]);
      g.lineTo(top[0] + (a[0] - top[0]) * s, top[1] + (a[1] - top[1]) * s);
      g.lineTo(top[0] + (b[0] - top[0]) * (s + 0.05), top[1] + (b[1] - top[1]) * (s + 0.05)); g.closePath();
      g.fillStyle = rgb(snow, 0.8 + 0.25 * (1 - j / (n - 1))); g.fill();
    }
  }
  function rock(g, x, y, s, col) {
    g.beginPath(); g.moveTo(x - s, y); g.lineTo(x - s * 0.4, y - s * 0.8); g.lineTo(x + s * 0.3, y - s * 0.9); g.lineTo(x + s, y); g.closePath(); g.fillStyle = rgb(col, 0.8); g.fill();
    g.beginPath(); g.moveTo(x - s, y); g.lineTo(x - s * 0.4, y - s * 0.8); g.lineTo(x, y - s * 0.2); g.closePath(); g.fillStyle = rgb(col, 1.08); g.fill();
  }
  function bush(g, x, y, s, col) {
    g.beginPath(); g.ellipse(x + s * 0.3, y + s * 0.2, s, s * 0.4, 0, 0, Math.PI * 2); g.fillStyle = "rgba(20,40,20,0.25)"; g.fill();
    for (var i = 0; i < 6; i++) {
      var a0 = Math.PI * 2 * i / 6, a1 = Math.PI * 2 * (i + 1) / 6;
      g.beginPath(); g.moveTo(x, y - s * 0.5); g.lineTo(x + Math.cos(a0) * s, y - s * 0.5 + Math.sin(a0) * s * 0.8); g.lineTo(x + Math.cos(a1) * s, y - s * 0.5 + Math.sin(a1) * s * 0.8); g.closePath();
      g.fillStyle = rgb(col, 0.75 + 0.45 * Math.max(0, -Math.cos(a0 + 0.5 - Math.PI * 0.25))); g.fill();
    }
  }
  function props(g, biome, cx, cy, R, r, base) {
    var spots = function (n, rad) {
      var out = [];
      for (var i = 0; i < n; i++) { var a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad; out.push([cx + Math.cos(a) * d * R, cy + Math.sin(a) * d * R * 0.9]); }
      return out.sort(function (a, b) { return a[1] - b[1]; });
    };
    if (biome === "forest") spots(4 + Math.floor(r() * 3), 0.55).forEach(function (p) { pine(g, p[0], p[1] + R * 0.18, R * (0.55 + r() * 0.25), 0.95 + r() * 0.15); });
    else if (biome === "jungle") spots(4, 0.5).forEach(function (p) { bush(g, p[0], p[1] + R * 0.1, R * (0.22 + r() * 0.08), [52, 128, 66]); });
    else if (biome === "hills") {
      var two = r() < 0.5;
      if (two) { mound(g, cx - R * 0.3, cy + R * 0.05, R * 0.38, R * 0.5, [190, 146, 96]); mound(g, cx + R * 0.28, cy + R * 0.32, R * 0.36, R * 0.45, [178, 136, 88]); }
      else mound(g, cx, cy + R * 0.25, R * 0.62, R * 0.72, [186, 142, 92]);
    } else if (biome === "mountain") peak(g, cx, cy + R * 0.42, R * 0.82, R * (1.35 + r() * 0.2), r);
    else if (biome === "desert") {
      for (var d = 0; d < 2; d++) { var y0 = cy - R * 0.2 + d * R * 0.45, x0 = cx + (r() - 0.5) * R * 0.4;
        g.beginPath(); g.moveTo(x0 - R * 0.42, y0 + R * 0.06); g.lineTo(x0 - R * 0.05, y0 - R * 0.12); g.lineTo(x0 + R * 0.4, y0 + R * 0.06); g.closePath(); g.fillStyle = rgb(base, 1.1); g.fill();
        g.beginPath(); g.moveTo(x0 - R * 0.05, y0 - R * 0.12); g.lineTo(x0 + R * 0.4, y0 + R * 0.06); g.lineTo(x0 + R * 0.05, y0 + R * 0.08); g.closePath(); g.fillStyle = rgb(base, 0.86); g.fill(); }
    } else if (biome === "snow" || biome === "tundra") spots(2, 0.45).forEach(function (p) { rock(g, p[0], p[1], R * 0.14, biome === "snow" ? [200, 210, 222] : [140, 140, 136]); });
    else if (biome === "grassland") { if (r() < 0.7) spots(1 + Math.floor(r() * 2), 0.5).forEach(function (p) { bush(g, p[0], p[1], R * 0.13, [86, 150, 62]); }); }
    else if (biome === "plains") spots(3, 0.5).forEach(function (p) { g.fillStyle = "rgba(150,120,50,0.6)"; for (var i = -1; i <= 1; i++) g.fillRect(p[0] + i * R * 0.05, p[1] - R * 0.12, R * 0.025, R * 0.12); });
  }

  // Back-to-front order (screen y, then x), cached per tile array.
  var ORDER = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function ordered(tiles, hexToPixel) {
    var o = ORDER && ORDER.get(tiles);
    if (o) return o;
    o = tiles.map(function (t) { var p = hexToPixel(t.q, t.r); return { t: t, x: p[0], y: p[1], v: ((t.q * 73856093) ^ (t.r * 19349663)) >>> 0 }; })
      .sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    if (ORDER) ORDER.set(tiles, o);
    return o;
  }
  function bucket(px) { return Math.max(6, Math.min(160, Math.round(Math.pow(2, Math.round(Math.log2(px) * 4) / 4)))); }

  function drawTiles(ctx, tiles, zoom, v, hexToPixel, HEX, inView, dpr) {
    var R = bucket(HEX * zoom * (dpr || 1)), k = HEX / R, list = ordered(tiles, hexToPixel);
    var pad = HEX * 1.6;
    // The list is sorted by y: binary-search the first row in view, stop past the last.
    var lo = 0, hi = list.length;
    if (v) { while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid].y < v[1] - pad) lo = mid + 1; else hi = mid; } }
    for (var i = lo; i < list.length; i++) {
      var e = list[i];
      if (v && e.y > v[3] + pad * 1.5) break;
      if (v && (e.x < v[0] - pad || e.x > v[2] + pad)) continue;
      var s = tileSprite(e.t.biome, e.v % 3, R);
      ctx.drawImage(s.c, e.x - s.ax * k, e.y - s.ay * k, s.w * k, s.h * k);
      stats.draws++;
    }
  }

  // ---------------------------------------------------------------- units
  var FIG = {};
  function figurine(ctx, type, x, y, rad, C, zoom, dpr) {
    var R = bucket(rad * zoom * (dpr || 1) * 1.35);
    var s = sprite(FIG, type + "|" + C.fill + "|" + C.ring + "|" + R, R * 2.4, R * 3.2, function (g, W, H) {
      var cx = W / 2, by = H - R * 0.55, fill = hex2rgb(C.fill), ring = hex2rgb(C.ring);
      // Hex base: squashed prism, top in moss green with a civ-coloured rim.
      var bw = R * 0.95, bh = R * 0.42, wall = R * 0.22;
      var pts = []; for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i; pts.push([cx + Math.cos(a) * bw, by + Math.sin(a) * bh]); }
      g.beginPath(); g.ellipse(cx + R * 0.15, by + wall + R * 0.06, bw * 1.05, bh * 0.9, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,0.35)"; g.fill();
      [[0, 1, 0.55], [1, 2, 0.7], [2, 3, 0.85]].forEach(function (e) {
        var a = pts[e[0]], b = pts[e[1]];
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0], b[1] + wall); g.lineTo(a[0], a[1] + wall); g.closePath(); g.fillStyle = rgb(fill, e[2]); g.fill();
      });
      g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath();
      g.fillStyle = rgb([120, 164, 84], 1); g.fill(); g.strokeStyle = rgb(ring, 1); g.lineWidth = Math.max(1, R * 0.07); g.stroke();
      // Figure: legs, tunic (civ colour, two facets), belt, head, helmet.
      var fy = by - R * 0.05, h = R * 1.75;
      g.fillStyle = "#4a3426"; g.fillRect(cx - R * 0.2, fy - h * 0.32, R * 0.14, h * 0.32); g.fillRect(cx + R * 0.06, fy - h * 0.32, R * 0.14, h * 0.32);
      var tl = [cx - R * 0.34, fy - h * 0.3], tr = [cx + R * 0.34, fy - h * 0.3], nl = [cx - R * 0.24, fy - h * 0.72], nr = [cx + R * 0.24, fy - h * 0.72];
      g.beginPath(); g.moveTo(tl[0], tl[1]); g.lineTo(cx, tl[1] + R * 0.04); g.lineTo(cx, nl[1]); g.lineTo(nl[0], nl[1]); g.closePath(); g.fillStyle = rgb(fill, 1.15); g.fill();
      g.beginPath(); g.moveTo(cx, tl[1] + R * 0.04); g.lineTo(tr[0], tr[1]); g.lineTo(nr[0], nr[1]); g.lineTo(cx, nl[1]); g.closePath(); g.fillStyle = rgb(fill, 0.78); g.fill();
      g.fillStyle = "#5a3e22"; g.fillRect(cx - R * 0.3, fy - h * 0.38, R * 0.6, R * 0.09);
      var hy = fy - h * 0.84, hr = R * 0.2;
      g.beginPath(); g.arc(cx, hy, hr, 0, Math.PI * 2); g.fillStyle = "#e2b48c"; g.fill();
      g.beginPath(); g.moveTo(cx - hr * 1.15, hy); g.lineTo(cx - hr * 0.7, hy - hr * 1.15); g.lineTo(cx + hr * 0.7, hy - hr * 1.15); g.lineTo(cx + hr * 1.15, hy); g.closePath(); g.fillStyle = "#c9a04a"; g.fill();
      g.beginPath(); g.moveTo(cx, hy - hr * 1.15); g.lineTo(cx + hr * 0.7, hy - hr * 1.15); g.lineTo(cx + hr * 1.15, hy); g.lineTo(cx, hy); g.closePath(); g.fillStyle = "#9b7832"; g.fill();
      // Weapon: spear (Spearman) or club (Warrior) on the right.
      if (type === "spearman") {
        g.strokeStyle = "#7a5530"; g.lineWidth = Math.max(1.2, R * 0.08); g.beginPath(); g.moveTo(cx + R * 0.5, fy - h * 0.12); g.lineTo(cx + R * 0.5, fy - h * 1.12); g.stroke();
        g.beginPath(); g.moveTo(cx + R * 0.5, fy - h * 1.3); g.lineTo(cx + R * 0.38, fy - h * 1.1); g.lineTo(cx + R * 0.62, fy - h * 1.1); g.closePath(); g.fillStyle = "#cfd4da"; g.fill();
      } else {
        g.strokeStyle = "#6a4528"; g.lineWidth = Math.max(1.5, R * 0.14); g.beginPath(); g.moveTo(cx + R * 0.42, fy - h * 0.45); g.lineTo(cx + R * 0.62, fy - h * 0.95); g.stroke();
      }
      // Round shield on the left: civ ring colour with a fill boss, faceted halves.
      var sx = cx - R * 0.42, sy = fy - h * 0.52, sr = R * 0.36;
      g.beginPath(); g.arc(sx, sy, sr, Math.PI * 0.5, Math.PI * 1.5); g.closePath(); g.fillStyle = rgb(ring, 1.08); g.fill();
      g.beginPath(); g.arc(sx, sy, sr, Math.PI * 1.5, Math.PI * 0.5); g.closePath(); g.fillStyle = rgb(ring, 0.8); g.fill();
      g.beginPath(); g.arc(sx, sy, sr * 0.38, 0, Math.PI * 2); g.fillStyle = rgb(fill, 1); g.fill();
      g.lineWidth = Math.max(1, R * 0.06); g.strokeStyle = "rgba(30,20,10,0.7)"; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.stroke();
    });
    var k = rad * 1.35 / R;
    ctx.drawImage(s.c, x - s.w / 2 * k, y + rad * 0.62 - (s.h - R * 0.55) * k, s.w * k, s.h * k);
  }

  // ---------------------------------------------------------------- cities
  var CITY = {};
  function house(g, x, y, s, wall, roof) {
    var w = s * 0.5, d = s * 0.32, hgt = s * 0.42;
    // Front face (lit), side face (shade), gabled roof.
    g.fillStyle = rgb(wall, 1.05); g.fillRect(x - w, y - hgt, w * 1.2, hgt);
    g.beginPath(); g.moveTo(x + w * 0.2, y); g.lineTo(x + w * 0.2 + d, y - d * 0.6); g.lineTo(x + w * 0.2 + d, y - d * 0.6 - hgt); g.lineTo(x + w * 0.2, y - hgt); g.closePath(); g.fillStyle = rgb(wall, 0.72); g.fill();
    g.fillStyle = "#4a3428"; g.fillRect(x - w * 0.55, y - hgt * 0.55, w * 0.3, hgt * 0.55);
    g.beginPath(); g.moveTo(x - w * 1.12, y - hgt); g.lineTo(x - w * 0.4, y - hgt - s * 0.32); g.lineTo(x + w * 0.32, y - hgt); g.closePath(); g.fillStyle = rgb(roof, 1.1); g.fill();
    g.beginPath(); g.moveTo(x - w * 0.4, y - hgt - s * 0.32); g.lineTo(x - w * 0.4 + d, y - hgt - s * 0.32 - d * 0.6); g.lineTo(x + w * 0.32 + d, y - hgt - d * 0.6); g.lineTo(x + w * 0.32, y - hgt); g.closePath(); g.fillStyle = rgb(roof, 0.78); g.fill();
  }
  function tower(g, x, y, s, wall, roof, ring) {
    var w = s * 0.3, h = s * 1.15;
    g.beginPath(); g.ellipse(x + w * 0.6, y + s * 0.04, w * 1.6, s * 0.12, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,0.25)"; g.fill();
    g.fillStyle = rgb(wall, 1.08); g.fillRect(x - w, y - h, w, h);
    g.fillStyle = rgb(wall, 0.74); g.fillRect(x, y - h, w, h);
    g.fillStyle = rgb(ring, 0.95); g.fillRect(x - w, y - h * 0.62, w * 2, s * 0.07);
    g.fillStyle = "#3a2c22"; g.fillRect(x - w * 0.45, y - h * 0.86, w * 0.35, s * 0.12);
    g.beginPath(); g.moveTo(x - w * 1.25, y - h); g.lineTo(x, y - h - s * 0.55); g.lineTo(x, y - h); g.closePath(); g.fillStyle = rgb(roof, 1.12); g.fill();
    g.beginPath(); g.moveTo(x, y - h - s * 0.55); g.lineTo(x + w * 1.25, y - h); g.lineTo(x, y - h); g.closePath(); g.fillStyle = rgb(roof, 0.75); g.fill();
  }
  function city(ctx, x, y, HEX, C, pop, zoom, dpr) {
    var tier = pop >= 8 ? 3 : pop >= 4 ? 2 : 1, R = bucket(HEX * zoom * (dpr || 1));
    var s = sprite(CITY, tier + "|" + C.fill + "|" + C.ring + "|" + R, R * 2.2, R * 2.6, function (g, W, H) {
      var cx = W / 2, cy = H - R * 0.9, wall = [236, 222, 196], roof = hex2rgb(C.fill), ring = hex2rgb(C.ring);
      // Cobbled plaza.
      g.beginPath(); for (var i = 0; i < 6; i++) { var p = corner(cx, cy, R * 0.72, i); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); } g.closePath();
      g.fillStyle = "rgba(196,186,166,0.85)"; g.fill(); g.strokeStyle = "rgba(90,80,70,0.6)"; g.lineWidth = Math.max(1, R * 0.03); g.stroke();
      var u = R * 0.62 * (0.85 + tier * 0.12);
      var spots = tier === 1 ? [[-0.35, -0.05], [0.3, 0.32]] : tier === 2 ? [[-0.45, -0.15], [0.42, -0.05], [-0.15, 0.38], [0.38, 0.42]] : [[-0.5, -0.2], [0.45, -0.18], [-0.55, 0.25], [-0.1, 0.45], [0.45, 0.4], [0.05, -0.38]];
      var items = spots.map(function (p) { return { x: cx + p[0] * R, y: cy + p[1] * R, t: "h" }; });
      items.push({ x: cx + R * 0.05, y: cy + R * 0.12, t: "t" });
      items.sort(function (a, b) { return a.y - b.y; }).forEach(function (it) {
        if (it.t === "t") tower(g, it.x, it.y, u * (0.9 + tier * 0.18), wall, ring, roof);
        else house(g, it.x, it.y, u * 0.72, wall, roof);
      });
    });
    var k = HEX / R;
    ctx.drawImage(s.c, x - s.w / 2 * k, y - (s.h - R * 0.9) * k, s.w * k, s.h * k);
  }

  root.PlanetDiorama = { LIFT: LIFT, drawTiles: drawTiles, figurine: figurine, city: city, stats: stats, FIGURINES: { spearman: 1, warrior: 1 } };
})(typeof window !== "undefined" ? window : globalThis);
