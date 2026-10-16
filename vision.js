/*
 * vision.js — WHAT A CIV CAN SEE. No DOM.
 * explored = civs[cid].revealed (kept by game.js as units move).
 * visible(game, cid): tiles seen right now (units' sight, cities' area + 1).
 * civs[cid].memory = { cities: {id: snapshot}, owner: {tileKey: civ} } is the
 * last seen state of foreign cities and borders, updated by remember().
 * The renderer draws real state on visible tiles and memory on explored ones.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;

  // Allies share vision (diplomacy.js pacts).
  function visible(game, cid) {
    var set = visibleOwn(game, cid), D = root.PlanetDiplomacy;
    if (D && game.diplo && D.allies) D.allies(game, cid).forEach(function (a) { visibleOwn(game, a).forEach(function (k) { set.add(k); }); });
    return set;
  }

  function visibleOwn(game, cid) {
    var set = new Set();
    function add(q, r, rad) {
      var ts = Rules.tilesInRadius(game, q, r, rad);
      for (var i = 0; i < ts.length; i++) set.add(Rules.key(ts[i].q, ts[i].r));
    }
    for (var i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (u.owner === cid) add(u.q, u.r, Rules.sightOf(u.type));
    }
    for (i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (c.owner === cid) add(c.q, c.r, Rules.workRadius(c) + 1);
    }
    return set;
  }

  function ensure(game, cid) {
    var cv = game.civs[cid];
    if (!cv.memory || !cv.memory.cities) cv.memory = { cities: {}, owner: {}, units: {} };
    if (!cv.memory.units) cv.memory.units = {};
    return cv.memory;
  }

  // Refresh civ cid's memory from what it sees now. Returns the visible set.
  function remember(game, cid, vis) {
    vis = vis || visible(game, cid);
    var mem = ensure(game, cid);
    vis.forEach(function (k) {
      var t = game.index.get(k);
      var oc = Rules.tileCiv(game, t);
      if (oc >= 0 && oc !== cid) mem.owner[k] = oc; else delete mem.owner[k];
    });
    for (var id in mem.cities) {
      var m = mem.cities[id];
      if (vis.has(Rules.key(m.q, m.r)) && !Rules.cityById(game, +id)) delete mem.cities[id];
    }
    // Rival units: forget those whose last-seen tile is in sight now, then
    // record everything visible (so a unit that walked off stays dimmed where seen).
    for (var uid in mem.units) {
      var mu = mem.units[uid];
      if (vis.has(Rules.key(mu.q, mu.r)) || (game.civs[mu.owner] && game.civs[mu.owner].eliminated)) delete mem.units[uid];
    }
    for (var j = 0; j < game.units.length; j++) {
      var u = game.units[j];
      if (u.owner === cid || !vis.has(Rules.key(u.q, u.r))) continue;
      mem.units[u.id] = { id: u.id, type: u.type, owner: u.owner, q: u.q, r: u.r, hp: u.hp, seen: game.turn };
    }
    for (var i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (c.owner === cid || !vis.has(Rules.key(c.q, c.r))) continue;
      mem.cities[c.id] = { id: c.id, name: c.name, owner: c.owner, q: c.q, r: c.r, pop: c.pop, hp: c.hp, seen: game.turn };
    }
    return vis;
  }

  // Which other civs' units or cities civ cid can see right now.
  function seenCivs(game, cid, vis) {
    vis = vis || visible(game, cid);
    var out = {};
    for (var i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (u.owner !== cid && vis.has(Rules.key(u.q, u.r))) out[u.owner] = true;
    }
    for (i = 0; i < game.cities.length; i++) {
      var c = game.cities[i];
      if (c.owner !== cid && vis.has(Rules.key(c.q, c.r))) out[c.owner] = true;
    }
    return Object.keys(out).map(Number);
  }

  root.PlanetVision = { visible: visible, remember: remember, seenCivs: seenCivs, ensure: ensure };
})(typeof window !== "undefined" ? window : globalThis);
