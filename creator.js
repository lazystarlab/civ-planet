/*
 * creator.js — CIVILIZATION CREATOR SCREEN (DOM only).
 * Edits a civ draft, previews it live, and saves designs to localStorage.
 * Data and rules come from civ.js; the game is started through the onStart
 * callback, so this file knows nothing about turns or maps beyond a seed.
 */
(function (root) {
  "use strict";

  var Civ = root.PlanetCiv;
  var LS_DESIGNS = "civPlanet.designs";
  var LS_LAST = "civPlanet.last";

  var els = {};
  var draft = null;
  var dirty = { people: false, adjective: false };
  var opts = {};
  var seedTimer = null;

  // ------------------------------------------------------------ storage

  function lsGet(k) {
    try { var v = root.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function designs() { return lsGet(LS_DESIGNS) || {}; }
  function lastPlayed() {
    var l = lsGet(LS_LAST);
    return l && l.civ ? { civ: Civ.normalize(l.civ), seed: l.seed || "" } : null;
  }
  function rememberLast(civ, seed) { lsSet(LS_LAST, { civ: civ, seed: seed }); }

  // ------------------------------------------------------------ helpers

  function $(id) { return document.getElementById(id); }
  function defaultSeed() { return (root.PlanetGen && root.PlanetGen.DEFAULT_SEED) || "default"; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function paintCanvas(canvas, fn) {
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || canvas.width;
    var h = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    fn(ctx, w, h);
  }

  function hexPath(ctx, x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i - 30);
      if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  }

  // A small map vignette: three terrain hexes, a city, a settler and a warrior in the civ's colours.
  function paintScene(canvas, civ) {
    paintCanvas(canvas, function (ctx, w, h) {
      var r = 26, cx = w / 2, cy = h / 2 + 4;
      var hx = r * Math.sqrt(3);
      var tiles = [[-1, "#74a84a"], [0, "#cfb868"], [1, "#8e7e4a"]];
      tiles.forEach(function (t) {
        hexPath(ctx, cx + t[0] * hx, cy, r);
        ctx.fillStyle = t[1];
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(8,12,16,0.4)";
        ctx.stroke();
      });
      // border segment around the city hex
      hexPath(ctx, cx, cy, r - 1.5);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = civ.primary;
      ctx.stroke();
      Civ.drawBadge(ctx, cx, cy, r * 0.66, civ, "hex");
      unit(ctx, cx - hx, cy, 12, civ, "settler");
      unit(ctx, cx + hx, cy, 12, civ, "warrior");
    });
  }

  function unit(ctx, x, y, rad, civ, type) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y + 1.2, rad, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = civ.primary;
    ctx.fill();
    ctx.lineWidth = rad * 0.16;
    ctx.strokeStyle = civ.secondary;
    ctx.stroke();
    ctx.strokeStyle = civ.secondary;
    ctx.fillStyle = civ.secondary;
    ctx.lineWidth = rad * 0.15;
    ctx.lineCap = "round";
    if (type === "settler") {
      ctx.beginPath(); ctx.moveTo(x - rad * 0.3, y + rad * 0.55); ctx.lineTo(x - rad * 0.3, y - rad * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - rad * 0.24, y - rad * 0.55); ctx.lineTo(x + rad * 0.5, y - rad * 0.3);
      ctx.lineTo(x - rad * 0.24, y - rad * 0.02); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(x + rad * 0.42, y - rad * 0.42); ctx.lineTo(x - rad * 0.22, y + rad * 0.22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - rad * 0.42, y); ctx.lineTo(x, y + rad * 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - rad * 0.2, y + rad * 0.2); ctx.lineTo(x - rad * 0.45, y + rad * 0.45); ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ preview card

  function previewHtml(civ, seed, idp) {
    var traits = civ.traits.map(function (k) {
      var t = Civ.TRAITS[k];
      return '<div class="pv-trait"><b>' + esc(t.name) + "</b><span>" + esc(t.effect) + "</span></div>";
    }).join("");
    var missing = Civ.TRAIT_COUNT - civ.traits.length;
    for (var i = 0; i < missing; i++) traits += '<div class="pv-trait empty"><b>Choose a trait</b><span>&nbsp;</span></div>';
    var pref = Civ.START_PREFS[civ.startPref];
    return '<canvas class="pv-badge" id="' + idp + 'Badge"></canvas>' +
      '<div class="pv-name" style="color:' + esc(civ.secondary) + '">' + esc(civ.name) + "</div>" +
      '<div class="pv-people">The ' + esc(civ.adjective) + " people · " + esc(civ.people) + "</div>" +
      '<div class="pv-leader">Led by <b>' + esc(civ.leaderTitle) + " " + esc(civ.leaderName) + "</b></div>" +
      '<div class="pv-traits">' + traits + "</div>" +
      '<canvas class="pv-scene" id="' + idp + 'Scene"></canvas>' +
      '<div class="pv-meta"><span>Homeland: <b>' + esc(pref.name) + "</b></span>" +
      (seed != null ? "<span>Planet: <b>" + esc(seed) + "</b></span>" : "") + "</div>" +
      '<div class="pv-meta"><span>Cities: ' + esc(civ.cityNames.slice(0, 4).join(", ")) +
      (civ.cityNames.length > 4 ? "…" : "") + "</span></div>";
  }

  function paintPreview(civ, idp) {
    var badge = $(idp + "Badge");
    if (badge) paintCanvas(badge, function (ctx, w, h) {
      // banner glow
      var g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
      g.addColorStop(0, Civ.rgba(civ.primary, 0.45));
      g.addColorStop(1, Civ.rgba(civ.primary, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      Civ.drawBadge(ctx, w / 2, h / 2, Math.min(w, h) * 0.38, civ, "hex");
    });
    var scene = $(idp + "Scene");
    if (scene) paintScene(scene, civ);
  }

  function renderPreview() {
    var civ = currentCiv();
    els.preview.innerHTML = previewHtml(civ, els.seed.value.trim() || defaultSeed(), "pv");
    els.preview.style.borderColor = Civ.rgba(civ.secondary, 0.55);
    els.preview.style.background =
      "linear-gradient(180deg, " + Civ.rgba(civ.primary, 0.28) + " 0%, rgba(16,20,24,0.94) 46%)";
    paintPreview(civ, "pv");
    var problems = Civ.validate(civ);
    els.start.disabled = problems.length > 0;
    els.startNote.textContent = problems.length ? problems[0] : "";
  }

  // ------------------------------------------------------------ form

  function currentCiv() {
    var c = Civ.normalize(draft);
    c.traits = draft.traits.slice();      // keep partial selection visible in preview
    return c;
  }

  function swatchRow(container, field) {
    var html = Civ.PALETTE.map(function (p) {
      return '<button type="button" class="swatch" title="' + p.name + '" data-field="' + field + '" data-hex="' + p.hex +
        '" style="background:' + p.hex + '"></button>';
    }).join("");
    html += '<label class="swatch custom" title="Custom colour"><input type="color" data-field="' + field + '"><span>+</span></label>';
    container.innerHTML = html;
  }

  function syncSwatches() {
    ["primary", "secondary"].forEach(function (field) {
      var row = field === "primary" ? els.primaryRow : els.secondaryRow;
      var inPalette = false;
      Array.prototype.forEach.call(row.querySelectorAll(".swatch[data-hex]"), function (b) {
        var on = b.getAttribute("data-hex").toLowerCase() === String(draft[field]).toLowerCase();
        if (on) inPalette = true;
        b.classList.toggle("on", on);
      });
      var custom = row.querySelector(".swatch.custom");
      var input = custom.querySelector("input");
      input.value = draft[field];
      custom.classList.toggle("on", !inPalette);
      custom.style.background = inPalette ? "" : draft[field];
    });
    var c = Civ.contrast(draft.primary, draft.secondary);
    els.contrastNote.textContent = c < 1.8 ? "Low contrast: emblems may be hard to read" : "";
  }

  function renderEmblems() {
    var civ = currentCiv();
    els.emblems.innerHTML = Civ.EMBLEM_ORDER.map(function (k) {
      return '<button type="button" class="emblem' + (draft.emblem === k ? " on" : "") + '" data-emblem="' + k +
        '" title="' + Civ.EMBLEMS[k].name + '"><canvas></canvas><span>' + Civ.EMBLEMS[k].name + "</span></button>";
    }).join("");
    Array.prototype.forEach.call(els.emblems.querySelectorAll(".emblem"), function (b) {
      var k = b.getAttribute("data-emblem");
      var c = { primary: civ.primary, secondary: civ.secondary, emblem: k };
      paintCanvas(b.querySelector("canvas"), function (ctx, w, h) {
        Civ.drawBadge(ctx, w / 2, h / 2, Math.min(w, h) * 0.44, c, "hex");
      });
    });
  }

  function renderTraits() {
    var n = draft.traits.length;
    els.traitCount.textContent = n + " of " + Civ.TRAIT_COUNT + " chosen";
    els.traitCount.classList.toggle("done", n === Civ.TRAIT_COUNT);
    els.traits.innerHTML = Civ.TRAIT_ORDER.map(function (k) {
      var t = Civ.TRAITS[k];
      var on = draft.traits.indexOf(k) !== -1;
      return '<button type="button" class="trait' + (on ? " on" : "") + '" data-trait="' + k + '">' +
        '<span class="t-name">' + esc(t.name) + '</span><span class="t-effect">' + esc(t.effect) + "</span>" +
        '<span class="t-flavor">' + esc(t.flavor) + "</span></button>";
    }).join("");
    Array.prototype.forEach.call(els.traits.querySelectorAll(".trait.on"), function (b) {
      b.style.borderColor = draft.secondary;
      b.style.background = "linear-gradient(180deg," + Civ.rgba(draft.primary, 0.42) + ", rgba(22,27,32,0.9))";
    });
  }

  function renderPrefs() {
    els.prefs.innerHTML = Civ.START_PREF_ORDER.map(function (k) {
      return '<button type="button" class="seg' + (draft.startPref === k ? " on" : "") + '" data-pref="' + k + '">' +
        Civ.START_PREFS[k].name + "</button>";
    }).join("");
    els.prefNote.textContent = Civ.START_PREFS[draft.startPref].effect;
  }

  function renderSaved() {
    var d = designs();
    var names = Object.keys(d).sort();
    els.load.innerHTML = '<option value="">' + (names.length ? "Saved designs…" : "No saved designs") + "</option>" +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    els.load.disabled = !names.length;
  }

  function fillFields() {
    els.name.value = draft.name;
    els.people.value = draft.people;
    els.adjective.value = draft.adjective;
    els.title.value = draft.leaderTitle;
    els.leader.value = draft.leaderName;
    els.cities.value = draft.cityNames.join("\n");
    updateCityCount();
  }

  function renderAll() {
    syncSwatches();
    renderEmblems();
    renderTraits();
    renderPrefs();
    renderPreview();
    applyAccent();
  }

  function applyAccent() {
    els.overlay.style.setProperty("--accent", draft.secondary);
    els.overlay.style.setProperty("--accent-bg", Civ.rgba(draft.primary, 0.9));
    els.start.style.background = draft.primary;
    els.start.style.borderColor = draft.secondary;
    els.start.style.color = Civ.inkFor(draft.primary);
  }

  function updateCityCount() {
    var n = els.cities.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean).length;
    els.cityCount.textContent = n + (n === 1 ? " name" : " names") + " · used in order";
  }

  function setDraft(civ) {
    var c = Civ.normalize(civ);
    draft = c;
    dirty.people = false;
    dirty.adjective = false;
    var d = Civ.deriveDemonyms(c.name);
    if (c.people !== d.people) dirty.people = true;
    if (c.adjective !== d.adjective) dirty.adjective = true;
    fillFields();
    renderAll();
  }

  function status(msg) {
    els.status.textContent = msg;
    clearTimeout(status.t);
    status.t = setTimeout(function () { els.status.textContent = ""; }, 2600);
  }

  function seedChanged() {
    clearTimeout(seedTimer);
    seedTimer = setTimeout(function () {
      if (opts.onSeed) opts.onSeed(els.seed.value.trim());
      renderPreview();
    }, 250);
  }

  // ------------------------------------------------------------ wiring

  function bind() {
    els.overlay = $("creator");
    ["name", "people", "adjective", "title", "leader", "cities", "seed", "preview", "start", "startNote",
      "traits", "traitCount", "emblems", "prefs", "prefNote", "load", "status", "cityCount", "contrastNote",
      "primaryRow", "secondaryRow", "welcome", "form"].forEach(function (k) {
      els[k] = $("cr-" + k);
    });
    els.titles = $("cr-titles");
    els.titles.innerHTML = Civ.TITLES.map(function (t) { return '<option value="' + esc(t) + '">'; }).join("");
    swatchRow(els.primaryRow, "primary");
    swatchRow(els.secondaryRow, "secondary");

    els.name.addEventListener("input", function () {
      draft.name = els.name.value;
      var d = Civ.deriveDemonyms(els.name.value.trim());
      if (!dirty.people) { draft.people = d.people; els.people.value = d.people; }
      if (!dirty.adjective) { draft.adjective = d.adjective; els.adjective.value = d.adjective; }
      renderPreview();
    });
    els.people.addEventListener("input", function () { dirty.people = true; draft.people = els.people.value; renderPreview(); });
    els.adjective.addEventListener("input", function () { dirty.adjective = true; draft.adjective = els.adjective.value; renderPreview(); });
    els.title.addEventListener("input", function () { draft.leaderTitle = els.title.value; renderPreview(); });
    els.leader.addEventListener("input", function () { draft.leaderName = els.leader.value; renderPreview(); });
    els.cities.addEventListener("input", function () {
      draft.cityNames = els.cities.value.split("\n");
      updateCityCount();
      renderPreview();
    });
    els.seed.addEventListener("input", seedChanged);
    $("cr-seedDice").addEventListener("click", function () {
      els.seed.value = Civ.makeName(Civ.mulberry((Math.random() * 1e9) >>> 0), 0).toLowerCase() + "-" + (1 + Math.floor(Math.random() * 99));
      seedChanged();
    });

    els.overlay.addEventListener("click", function (ev) {
      var t = ev.target;
      var sw = t.closest(".swatch[data-hex]");
      if (sw) { draft[sw.getAttribute("data-field")] = sw.getAttribute("data-hex"); renderAll(); return; }
      var em = t.closest(".emblem");
      if (em) { draft.emblem = em.getAttribute("data-emblem"); renderAll(); return; }
      var tr = t.closest(".trait");
      if (tr) { toggleTrait(tr.getAttribute("data-trait")); return; }
      var pf = t.closest(".seg[data-pref]");
      if (pf) { draft.startPref = pf.getAttribute("data-pref"); renderAll(); return; }
    });
    els.overlay.addEventListener("input", function (ev) {
      if (ev.target.type === "color") { draft[ev.target.getAttribute("data-field")] = ev.target.value; renderAll(); }
    });

    $("cr-randomize").addEventListener("click", function () { randomize(); });
    $("cr-size").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-size]");
      if (!b) return;
      setSize(b.getAttribute("data-size"));
    });
    $("cr-rivals").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-rivals]");
      if (!b) return;
      setRivals(+b.getAttribute("data-rivals"));
    });
    $("cr-save").addEventListener("click", function () {
      var civ = Civ.normalize(draft);
      var d = designs();
      d[civ.name] = civ;
      status(lsSet(LS_DESIGNS, d) ? "Saved " + civ.name : "Could not save (storage unavailable)");
      renderSaved();
    });
    els.load.addEventListener("change", function () {
      var civ = designs()[els.load.value];
      if (civ) { setDraft(civ); status("Loaded " + civ.name); }
      els.load.value = "";
    });
    els.start.addEventListener("click", start);
    $("cr-continue").addEventListener("click", function () {
      if (opts.save && opts.onContinue) { close(); opts.onContinue(); return; }
      var last = lastPlayed();
      if (!last) return;
      close();
      if (opts.onStart) opts.onStart(last.civ, last.seed);
    });
    $("cr-loadgame").addEventListener("click", function () { if (opts.onLoadGame) opts.onLoadGame(); });
    $("cr-newgame").addEventListener("click", function () {
      var w = welcomeCiv();
      if (!w) return;
      close();
      if (opts.onStart) opts.onStart(w.civ, w.seed);
    });
    // Editing or replacing the civ means a new game: confirm when a save exists.
    function guarded(action) {
      if (!opts.save) { action(); return; }
      pendingAction = action;
      $("cr-confirmText").innerHTML = "A different civ means a <b>new game</b>. Your saved game (" +
        esc(opts.save.civ.name) + ", Turn " + opts.save.turn + ") is kept until the new one starts.";
      $("cr-confirm").classList.remove("hidden");
    }
    $("cr-confirmYes").addEventListener("click", function () {
      $("cr-confirm").classList.add("hidden");
      var a = pendingAction; pendingAction = null;
      if (a) a();
    });
    $("cr-confirmNo").addEventListener("click", function () {
      pendingAction = null;
      $("cr-confirm").classList.add("hidden");
    });
    $("cr-edit").addEventListener("click", function () {
      guarded(function () { var w = welcomeCiv(); if (w) setDraft(w.civ); showForm(); });
    });
    $("cr-new").addEventListener("click", function () {
      guarded(function () { setDraft(Civ.randomCiv()); showForm(); });
    });
    $("cr-export").addEventListener("click", function () { if (opts.onExport) opts.onExport(); });
    $("cr-import").addEventListener("click", function () { $("cr-importFile").click(); });
    $("cr-importFile").addEventListener("change", function (ev) {
      var f = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (f && opts.onImport) opts.onImport(f, function (err) { if (err) status(String(err.message || err)); });
    });
    $("civSummaryClose").addEventListener("click", function () { $("civSummary").classList.add("hidden"); });
    $("civSummary").addEventListener("click", function (ev) {
      if (ev.target.id === "civSummary") $("civSummary").classList.add("hidden");
    });
  }

  function toggleTrait(k) {
    var i = draft.traits.indexOf(k);
    if (i !== -1) draft.traits.splice(i, 1);
    else {
      if (draft.traits.length >= Civ.TRAIT_COUNT) draft.traits.shift();
      draft.traits.push(k);
    }
    renderAll();
  }

  function randomize(seed) {
    var keepSeed = els.seed.value;
    setDraft(Civ.randomCiv(seed));
    els.seed.value = keepSeed;
    status("A new people, " + draft.people + ", rises");
  }

  function start() {
    var civ = Civ.normalize(draft);
    if (Civ.validate(civ).length) return;
    var seed = els.seed.value.trim();
    rememberLast(civ, seed);
    close();
    if (opts.onStart) opts.onStart(civ, seed);
  }

  var pendingAction = null;

  // Map size for new games (default Standard), remembered in localStorage.
  var LS_SIZE = "civPlanet.size";
  function size() {
    var s = lsGet(LS_SIZE);
    return root.PlanetGen.SIZES[s] ? s : "standard";
  }
  function setSize(s) {
    lsSet(LS_SIZE, s);
    if (opts && opts.onSize) opts.onSize(s, els.seed ? els.seed.value.trim() : "");
    if (rivals() > maxRivals(s)) lsSet(LS_RIVALS, String(maxRivals(s)));
    renderRivals();
  }
  // Up to 4 rivals, 6 on Large and Huge maps.
  function maxRivals(s) { return s === "large" || s === "huge" ? 6 : 4; }

  // Number of AI rivals for new games (default 2), remembered in localStorage.
  var LS_RIVALS = "civPlanet.rivals";
  function rivals() {
    var n = parseInt(lsGet(LS_RIVALS), 10);
    return n >= 1 && n <= maxRivals(size()) ? n : Math.min(2, maxRivals(size()));
  }
  function setRivals(n) {
    lsSet(LS_RIVALS, String(n));
    renderRivals();
  }
  function renderRivals() {
    var n = rivals(), s = size(), max = maxRivals(s);
    Array.prototype.forEach.call($("cr-rivals").children, function (b) {
      var v = +b.getAttribute("data-rivals");
      b.classList.toggle("on", v === n);
      b.disabled = v > max;
      b.title = v > max ? "5 and 6 rivals need a Large or Huge map" : "";
    });
    Array.prototype.forEach.call($("cr-size").children, function (b) {
      b.classList.toggle("on", b.getAttribute("data-size") === s);
    });
    var sz = root.PlanetGen.SIZES[s];
    $("cr-sizeNote").textContent = sz.cols + " × " + sz.rows + " hexes";
  }

  // The civ the welcome card is about: the saved game's, else the last one played.
  function welcomeCiv() {
    if (opts.save) return { civ: opts.save.civ, seed: opts.save.seed };
    return lastPlayed();
  }

  function showForm() {
    renderRivals();
    $("cr-confirm").classList.add("hidden");
    els.welcome.classList.add("hidden");
    els.form.classList.remove("hidden");
    renderAll();
  }

  function close() {
    els.overlay.classList.add("hidden");
    if (opts.onClose) opts.onClose();
  }

  /*
   * open({ seed, civ, save, onStart(civ, seed), onSeed(seed), onContinue(), onExport(), onImport(file, cb) })
   * save is PlanetSave.summary(...) or null. Shows the welcome card if there is a
   * save or a remembered civ, else the form.
   */
  function open(o) {
    opts = o || {};
    if (!els.overlay) bind();
    var last = lastPlayed();
    els.seed.value = opts.seed != null ? opts.seed : (last && last.seed) || "";
    setDraft(opts.civ || (last && last.civ) || Civ.DEFAULT_CIV);
    renderSaved();
    els.overlay.classList.remove("hidden");
    var w = welcomeCiv();
    if (w && !opts.forceForm) {
      var civ = Civ.normalize(w.civ);
      els.form.classList.add("hidden");
      els.welcome.classList.remove("hidden");
      $("cr-confirm").classList.add("hidden");
      var sv = opts.save;
      $("cr-saveInfo").innerHTML = sv
        ? "<b>Turn " + sv.turn + " · " + esc(sv.year) + "</b><span class=\"sub\">" +
          sv.cities + (sv.cities === 1 ? " city" : " cities") + " · " + sv.units + (sv.units === 1 ? " unit" : " units") +
          " · planet " + esc(sv.seed || defaultSeed()) + (sv.savedAt ? " · saved " + esc(when(sv.savedAt)) : "") + "</span>"
        : "<b>No saved game</b><span class=\"sub\">Continue starts a new game with this civ</span>";
      $("cr-export").parentNode.querySelector("#cr-export").style.display = sv ? "" : "none";
      var cont = $("cr-continue");
      cont.innerHTML = (sv ? "Continue with <b>" : "Play as <b>") + esc(civ.name) + "</b>";
      cont.style.background = civ.primary;
      cont.style.borderColor = civ.secondary;
      cont.style.color = Civ.inkFor(civ.primary);
      $("cr-welcomeCard").innerHTML = previewHtml(civ, w.seed || defaultSeed(), "wl");
      paintPreview(civ, "wl");
    } else {
      showForm();
    }
  }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function showSummary(civ, extra) {
    var box = $("civSummaryBody");
    box.innerHTML = previewHtml(civ, extra && extra.seed, "sm") +
      (extra && extra.lines ? '<div class="pv-extra">' + extra.lines.map(esc).join("<br>") + "</div>" : "");
    box.style.borderColor = Civ.rgba(civ.secondary, 0.55);
    box.style.background = "linear-gradient(180deg, " + Civ.rgba(civ.primary, 0.28) + " 0%, rgba(16,20,24,0.96) 46%)";
    $("civSummary").classList.remove("hidden");
    paintPreview(civ, "sm");
  }

  function isOpen() {
    return (els.overlay && !els.overlay.classList.contains("hidden")) ||
      !$("civSummary").classList.contains("hidden");
  }

  // Scripted runs for headless verification (?demo=creator|play).
  function demo(rseed, traits) {
    randomize(rseed);
    $("cr-randomize").click();          // exercise the real button once
    randomize(rseed);                    // then settle on the reproducible design
    draft.traits = [];
    renderAll();
    traits.forEach(function (k) {
      var b = els.traits.querySelector('.trait[data-trait="' + k + '"]');
      if (b) b.click();
    });
  }

  root.PlanetCreator = {
    open: open,
    close: close,
    isOpen: isOpen,
    showSummary: showSummary,
    lastPlayed: lastPlayed,
    rememberLast: rememberLast,
    rivals: rivals,
    size: size,
    maxRivals: maxRivals,
    setSize: function (sz) { setSize(sz); },
    setRivals: function (n) { setRivals(n); },
    setRivals: setRivals,
    demo: demo,
    start: start,
    paintBadge: function (canvas, civ, shape) {
      paintCanvas(canvas, function (ctx, w, h) { Civ.drawBadge(ctx, w / 2, h / 2, Math.min(w, h) * 0.45, civ, shape || "hex"); });
    }
  };
})(window);
