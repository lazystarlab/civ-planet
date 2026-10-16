/*
 * roads.js — WORKERS, ROADS, FARMS, MINES, CAPITAL CONNECTION. No DOM.
 * Worker (available from the start; cost 18, 2 moves, can't fight and is
 * captured like a Settler):
 *   road  — on its tile, 2 turns (3 in hills, forest, jungle)
 *   farm  — +1 food on flat land (plains, grassland, desert, tundra), 3 turns
 *   mine  — +1 production on hills, 3 turns
 * Work advances at the end of each turn the worker stays put. Working does
 * not use moves: Cancel (or moving off the tile) stops the job and the worker
 * keeps whatever moves it had. Progress stays on the tile (game.jobs), so a
 * worker that resumes the same job there continues where it left off.
 * State: game.roads { "q,r": 1 }, game.improvements { "q,r": "farm"|"mine" },
 *        game.jobs { "q,r|kind": turns done } for paused work.
 * AI roads: roadPlan() routes each city to the capital with A* (road tiles
 * cost 1/3), and workers only build on tiles of those planned routes.
 * Movement between two road tiles costs 1/3 (cities count as road tiles).
 * Capital connection: a city linked to its capital by a chain of road tiles
 * (or, with Sailing, a harbor link — both ports on the same sea) earns
 * +max(1, floor(pop / 2)) gold. Caravans are not implemented.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;

  var ROAD_COST = 1 / 3;
  var ROUGH = { hills: true, forest: true, jungle: true };
  var FLAT = { plains: true, grassland: true, desert: true, tundra: true };

  Rules.UNIT_TYPES.worker = { name: "Worker", moves: 2, canFound: false, strength: 0, worker: true };
  Rules.BUILDS.worker = { name: "Worker", cost: 18, unit: "worker", minPop: 1, popCost: 0, note: "roads · farms · mines" };

  function k(q, r) { return Rules.key(q, r); }
  function roads(game) { return game.roads || (game.roads = {}); }
  function improvements(game) { return game.improvements || (game.improvements = {}); }
  function isRoad(game, q, r) { return !!roads(game)[k(q, r)] || game.cityAt.has(k(q, r)); }

  // Which jobs a worker could start on its tile, with turns needed.
  function jobs(game, u) {
    var t = game.index.get(k(u.q, u.r)), out = [];
    if (!t || Rules.isWater(t) || Rules.moveCost(t) === Infinity || u.aboard != null) return out;
    var own = game.owner.get(k(t.q, t.r));
    var mine = own == null || (Rules.cityById(game, own) || {}).owner === u.owner;
    if (!roads(game)[k(t.q, t.r)] && !game.cityAt.has(k(t.q, t.r))) out.push({ kind: "road", name: "Road", turns: ROUGH[t.biome] ? 3 : 2 });
    var imp = improvements(game)[k(t.q, t.r)];
    if (mine && own != null && !imp && !game.cityAt.has(k(t.q, t.r))) {
      if (FLAT[t.biome]) out.push({ kind: "farm", name: "Farm", turns: 3, note: "+1 food" });
      if (t.biome === "hills") out.push({ kind: "mine", name: "Mine", turns: 3, note: "+1 production" });
    }
    JOB_EXT.forEach(function (f) { f(game, u, t, out, mine); });
    return out;
  }
  // Other modules add jobs (pillage.js: "repair") and finish them.
  var JOB_EXT = [], JOB_DONE = {};
  function addJobs(f, kind, done) { JOB_EXT.push(f); if (kind) JOB_DONE[kind] = done; }

  function jobsDone(game) { return game.jobs || (game.jobs = {}); }
  function jobKey(q, r, kind) { return k(q, r) + "|" + kind; }

  function startWork(game, unitId, kind) {
    var u = Rules.unitById(game, unitId);
    if (!u || !Rules.UNIT_TYPES[u.type].worker) return { ok: false, reason: "Only Workers build" };
    var job = jobs(game, u).filter(function (j) { return j.kind === kind; })[0];
    if (!job) return { ok: false, reason: "Can't build a " + kind + " here" };
    var done = jobsDone(game)[jobKey(u.q, u.r, kind)] || 0;
    u.work = { kind: kind, q: u.q, r: u.r, left: Math.max(1, job.turns - done), total: job.turns };
    return { ok: true, text: (done ? "Resuming" : "Building") + " a " + job.name.toLowerCase() + " (" + u.work.left + (u.work.left === 1 ? " turn" : " turns") + " left)" };
  }

  // Stop the job; progress stays on the tile and the worker keeps its moves.
  function cancelWork(game, unitId) {
    var u = Rules.unitById(game, unitId);
    if (!u || !u.work) return { ok: false, reason: "Not working" };
    var w = u.work, done = (w.total || w.left) - w.left;
    if (done > 0) jobsDone(game)[jobKey(w.q, w.r, w.kind)] = done;
    u.work = null;
    return { ok: true, text: "Stopped the " + w.kind + (done ? " (" + done + " of " + (w.total || done) + " turns kept on the tile)" : "") };
  }

  function finish(game, u, events) {
    var w = u.work, key = k(w.q, w.r);
    delete jobsDone(game)[jobKey(w.q, w.r, w.kind)];
    if (JOB_DONE[w.kind]) JOB_DONE[w.kind](game, key, u);
    else if (w.kind === "road") roads(game)[key] = 1;
    else improvements(game)[key] = w.kind;
    u.work = null;
    if (game.cities.length) game._connVer = (game._connVer || 0) + 1;
    events.push({ cid: u.owner, kind: "work", text: "A Worker finished a " + w.kind, q: w.q, r: w.r });
  }

  // ---------------------------------------------------------- connection
  function connected(game, cid) {
    var cache = game._conn || (Object.defineProperty(game, "_conn", { value: {}, writable: true, enumerable: false }), game._conn);
    var cs = Rules.citiesOf(game, cid);
    var sig = game.turn + "|" + Object.keys(roads(game)).length + "|" + cs.map(function (c) { return c.id + (c.capital ? "*" : ""); }).join(",");
    if (cache[cid] && cache[cid].sig === sig) return cache[cid].v;
    var cap = cs.filter(function (c) { return c.capital; })[0], out = {};
    if (cap) {
      // Road chain from the capital (own cities and any road tile).
      var seen = new Set([k(cap.q, cap.r)]), stack = [game.index.get(k(cap.q, cap.r))];
      while (stack.length) {
        var t = stack.pop();
        var c = game.cityAt.get(k(t.q, t.r));
        if (c && c.owner === cid) out[c.id] = "road";
        if (c && c.owner !== cid) continue;
        Rules.neighbours(game, t).forEach(function (n) {
          var nk = k(n.q, n.r);
          if (seen.has(nk) || !isRoad(game, n.q, n.r)) return;
          seen.add(nk); stack.push(n);
        });
      }
      // Harbor links with Sailing: ports on the same sea as a coastal capital.
      var Naval = root.PlanetNaval;
      if (Naval && Rules.hasTech(game, "sailing", cid) && Naval.coastal(game, cap)) {
        var seas = Naval.seasOf(game, cap);
        cs.forEach(function (c2) {
          if (out[c2.id] || !Naval.coastal(game, c2)) return;
          if (Naval.seasOf(game, c2).some(function (s) { return seas.indexOf(s) !== -1; })) out[c2.id] = "harbor";
        });
      }
      delete out[cap.id];
    }
    cache[cid] = { sig: sig, v: out };
    return out;
  }

  // ---------------------------------------------------------- AI road planning
  // A* from a city to the capital: road tiles cost 1/3, others their terrain
  // cost; water, mountains and other civs' land are out. Returns tiles.
  function roadPath(game, cid, from, to) {
    var start = game.index.get(k(from.q, from.r)), goal = k(to.q, to.r);
    var open = [{ t: start, f: 0 }], g = new Map([[k(start.q, start.r), 0]]), prev = new Map(), closed = new Set();
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0].t, ck = k(cur.q, cur.r);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (ck === goal) {
        var path = [cur];
        while (prev.has(k(path[0].q, path[0].r))) path.unshift(prev.get(k(path[0].q, path[0].r)));
        return path;
      }
      var ns = Rules.neighbours(game, cur);
      for (var j = 0; j < ns.length; j++) {
        var n = ns[j], nk = k(n.q, n.r);
        if (closed.has(nk) || Rules.isWater(n)) continue;
        var base = Rules.moveCost(n);
        if (base === Infinity) continue;
        var own = game.owner.get(nk), oc = own != null ? (Rules.cityById(game, own) || {}).owner : null;
        if (oc != null && oc !== cid) continue;
        var c = isRoad(game, n.q, n.r) ? ROAD_COST : base;
        var ng = g.get(ck) + c;
        if (g.has(nk) && g.get(nk) <= ng) continue;
        g.set(nk, ng); prev.set(nk, cur);
        if (Rules.hexDistance(n.q, n.r, to.q, to.r) > 40) continue;
        open.push({ t: n, f: ng + Rules.hexDistance(n.q, n.r, to.q, to.r) * ROAD_COST });
      }
    }
    return null;
  }

  // Planned road tiles for a civ (cached per turn and road count): the union
  // of the shortest road paths from each city to the capital.
  function roadPlan(game, cid) {
    var cache = game._roadPlan || (Object.defineProperty(game, "_roadPlan", { value: {}, writable: true, enumerable: false }), game._roadPlan);
    var cs = Rules.citiesOf(game, cid), cap = cs.filter(function (c) { return c.capital; })[0];
    var sig = game.turn + "|" + Object.keys(roads(game)).length + "|" + cs.length;
    if (cache[cid] && cache[cid].sig === sig) return cache[cid].v;
    var plan = { tiles: [], set: {} };
    if (cap) cs.forEach(function (c) {
      if (c === cap) return;
      var p = roadPath(game, cid, c, cap);
      if (!p) return;
      p.forEach(function (t) {
        var tk = k(t.q, t.r);
        if (plan.set[tk] || game.cityAt.has(tk)) return;
        plan.set[tk] = true;
        plan.tiles.push(t);
      });
    });
    cache[cid] = { sig: sig, v: plan };
    return plan;
  }

  // Planned tiles still without a road.
  function roadGaps(game, cid) {
    return roadPlan(game, cid).tiles.filter(function (t) { return !roads(game)[k(t.q, t.r)]; });
  }

  function tradeGold(city) { return Math.max(1, Math.floor(city.pop / 2)); }

  function makeModifiers(game, cid) {
    return {
      moveCost: function (tile, cost, info) {
        var f = info && info.from;
        if (cost === Infinity || !f || !info.unit || (Rules.UNIT_TYPES[info.unit.type] || {}).naval) return cost;
        return isRoad(game, f.q, f.r) && isRoad(game, tile.q, tile.r) ? Math.min(cost, ROAD_COST) : cost;
      },
      tileYield: function (tile, y) {
        var imp = game.improvements && game.improvements[k(tile.q, tile.r)];
        if (imp === "farm") y.food += 1;
        else if (imp === "mine") y.prod += 1;
        return y;
      },
      cityYield: function (city, y) {
        if (connected(game, cid)[city.id]) y.gold += tradeGold(city);
        return y;
      },
      // Moving off the job's tile cancels it (the UI toasts game._workNotice).
      onMove: function (g, u) {
        if (u.work && (u.q !== u.work.q || u.r !== u.work.r)) {
          var res = cancelWork(g, u.id);
          Object.defineProperty(g, "_workNotice", { value: res.text, writable: true, configurable: true, enumerable: false });
        }
      },
      onEndTurn: function (g, events, sci, c) {
        g.units.forEach(function (u) {
          if (u.owner !== c || !u.work) return;
          if (u.q !== u.work.q || u.r !== u.work.r) { cancelWork(g, u.id); return; }
          if (--u.work.left <= 0) finish(g, u, events);
        });
      }
    };
  }

  root.PlanetRoads = {
    addJobs: addJobs,
    ROAD_COST: ROAD_COST, jobs: jobs, startWork: startWork, cancelWork: cancelWork, roadPath: roadPath, roadPlan: roadPlan, roadGaps: roadGaps, isRoad: isRoad, connected: connected,
    tradeGold: tradeGold, makeModifiers: makeModifiers
  };
})(typeof window !== "undefined" ? window : globalThis);
