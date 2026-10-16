/*
 * galaxy.js — HOOK FOR THE FUTURE GALAXY LAYER. Nothing here draws or plays yet.
 *
 * The planet game ends its tech tree with Interstellar Navigation, which lets a
 * civ build a Colony Ship (eras.js). Completing it does not win anything:
 * eras.js records it in game.eras.launched and calls
 *
 *   PlanetGalaxy.onLaunch(game, cid, record)
 *     record = { civ, turn, year, city, cityName, civName }
 *
 * This stub stores each launch in game.galaxy.launches (saved with the game)
 * and remembers who left first. A galaxy layer can replace these functions:
 *   - onLaunch(game, cid, record): a colony ship has left the planet
 *   - launches(game): every launch so far, oldest first
 *   - ready(game, cid): true once civ cid has launched (the galaxy view could open)
 * Keep the planet game independent of it: the planet only calls onLaunch.
 */
(function (root) {
  "use strict";
  function state(game) { return game.galaxy || (game.galaxy = { launches: [], first: null }); }
  function onLaunch(game, cid, record) {
    var s = state(game);
    s.launches.push(record);
    if (s.first == null) s.first = cid;
  }
  function launches(game) { return state(game).launches.slice(); }
  function ready(game, cid) { return state(game).launches.some(function (l) { return l.civ === cid; }); }
  root.PlanetGalaxy = { state: state, onLaunch: onLaunch, launches: launches, ready: ready };
})(typeof window !== "undefined" ? window : globalThis);
