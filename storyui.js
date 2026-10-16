/*
 * storyui.js — EVENT CARDS, THE ERA CARD AND THE CHRONICLE (DOM). Reads
 * PlanetStory; choices go back through the callbacks given by app.js.
 * Each event card has a procedural vignette: a sky and ground tinted by the
 * event's art.tint, a seeded starfield or hills, and a motif drawn on canvas.
 */
(function (root) {
  "use strict";
  var Story = root.PlanetStory, Rules = root.PlanetGame, Tech = root.PlanetTech;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function hs(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mix(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function c(v) { return Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)))); }
    return "rgb(" + c(r) + "," + c(g) + "," + c(b) + ")";
  }

  // ------------------------------------------------------------ vignette
  function vignette(cv, art, seed) {
    var ctx = cv.getContext("2d"), W = cv.width, H = cv.height, tint = (art && art.tint) || "#3a4a5a", motif = (art && art.motif) || "star";
    var rand = (function () { var s = hs(seed) || 1; return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; })();
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mix(tint, -0.65)); sky.addColorStop(0.62, mix(tint, -0.1)); sky.addColorStop(1, mix(tint, 0.15));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < 70; i++) { ctx.fillStyle = "rgba(255,248,230," + (0.2 + rand() * 0.6).toFixed(2) + ")"; ctx.fillRect(rand() * W, rand() * H * 0.55, rand() < 0.15 ? 2 : 1, rand() < 0.15 ? 2 : 1); }
    // Two ranges of hills.
    [[0.66, -0.55], [0.8, -0.75]].forEach(function (layer) {
      ctx.fillStyle = mix(tint, layer[1]);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (var x = 0; x <= W; x += 16) ctx.lineTo(x, H * layer[0] + Math.sin(x / (40 + rand() * 30) + rand()) * 10 - rand() * 8);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    });
    var cx = W / 2, gy = H * 0.74, lit = mix(tint, 0.7), dark = mix(tint, -0.85);
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    var glow = ctx.createRadialGradient(cx, H * 0.4, 4, cx, H * 0.4, H * 0.6);
    glow.addColorStop(0, "rgba(255,240,200,0.28)"); glow.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = dark; ctx.strokeStyle = lit;
    if (motif === "ruin") {
      for (var c = -2; c <= 2; c++) { var hgt = (c === 1 ? 0.45 : 1) * H * 0.42; ctx.fillRect(cx + c * 34 - 8, gy - hgt, 16, hgt); }
      ctx.fillRect(cx - 82, gy - H * 0.42 - 10, 100, 10);
      ctx.beginPath(); ctx.moveTo(cx + 40, gy); ctx.lineTo(cx + 60, gy + 14); ctx.lineTo(cx + 20, gy + 14); ctx.fill();
    } else if (motif === "comet") {
      var g2 = ctx.createLinearGradient(cx - 150, H * 0.1, cx + 40, H * 0.38);
      g2.addColorStop(0, "rgba(255,255,255,0)"); g2.addColorStop(1, "rgba(255,236,190,0.9)");
      ctx.strokeStyle = g2; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(cx - 150, H * 0.1); ctx.lineTo(cx + 40, H * 0.38); ctx.stroke();
      ctx.fillStyle = "#fff6dc"; ctx.beginPath(); ctx.arc(cx + 42, H * 0.39, 7, 0, 7); ctx.fill();
    } else if (motif === "monolith") {
      ctx.fillRect(cx - 14, gy - H * 0.5, 28, H * 0.5);
      ctx.strokeStyle = "rgba(160,220,255,0.5)"; ctx.lineWidth = 1.5;
      for (var k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(cx, gy - H * 0.3, 18 + k * 14, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, gy - H * 0.3, 18 + k * 14, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke(); }
    } else if (motif === "wave") {
      ctx.strokeStyle = lit; ctx.lineWidth = 3;
      for (var w = 0; w < 4; w++) { ctx.beginPath(); for (var x2 = 0; x2 <= W; x2 += 8) ctx.lineTo(x2, gy - 30 + w * 12 + Math.sin(x2 / 22 + w) * 6); ctx.stroke(); }
    } else if (motif === "ship") {
      ctx.beginPath(); ctx.moveTo(cx - 60, gy - 24); ctx.lineTo(cx + 60, gy - 24); ctx.lineTo(cx + 44, gy - 4); ctx.lineTo(cx - 48, gy - 4); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - 3, gy - 100, 5, 78);
      ctx.fillStyle = lit; ctx.beginPath(); ctx.moveTo(cx + 4, gy - 96); ctx.quadraticCurveTo(cx + 46, gy - 66, cx + 4, gy - 32); ctx.fill();
    } else if (motif === "plague") {
      for (var p = 0; p < 5; p++) { ctx.fillRect(cx - 90 + p * 38, gy - 30 - (p % 2) * 18, 26, 30 + (p % 2) * 18); }
      ctx.fillStyle = "rgba(200,210,190,0.18)";
      for (var m = 0; m < 6; m++) { ctx.beginPath(); ctx.ellipse(cx - 120 + m * 50, gy - 60 - (m % 3) * 12, 50, 14, 0, 0, 7); ctx.fill(); }
    } else if (motif === "flame") {
      var fg = ctx.createRadialGradient(cx, gy - 40, 2, cx, gy - 40, 46);
      fg.addColorStop(0, "#fff2c0"); fg.addColorStop(0.5, "rgba(255,150,60,0.9)"); fg.addColorStop(1, "rgba(255,90,30,0)");
      ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(cx, gy - 100); ctx.quadraticCurveTo(cx + 36, gy - 40, cx, gy - 6); ctx.quadraticCurveTo(cx - 36, gy - 40, cx, gy - 100); ctx.fill();
      ctx.fillStyle = dark; ctx.fillRect(cx - 30, gy - 8, 60, 8);
    } else if (motif === "sword") {
      ctx.save(); ctx.translate(cx, gy - 50); ctx.rotate(-0.6);
      ctx.fillStyle = lit; ctx.fillRect(-4, -60, 8, 92); ctx.fillStyle = dark; ctx.fillRect(-18, 30, 36, 6); ctx.fillRect(-3, 34, 6, 20);
      ctx.rotate(1.2); ctx.fillStyle = lit; ctx.fillRect(-4, -60, 8, 92); ctx.fillStyle = dark; ctx.fillRect(-18, 30, 36, 6); ctx.restore();
    } else if (motif === "crown") {
      ctx.fillStyle = "#e8c66a";
      ctx.beginPath(); ctx.moveTo(cx - 44, gy - 30); ctx.lineTo(cx - 44, gy - 78); ctx.lineTo(cx - 22, gy - 54); ctx.lineTo(cx, gy - 88); ctx.lineTo(cx + 22, gy - 54); ctx.lineTo(cx + 44, gy - 78); ctx.lineTo(cx + 44, gy - 30); ctx.closePath(); ctx.fill();
    } else if (motif === "tree") {
      ctx.fillRect(cx - 5, gy - 60, 10, 60);
      ctx.fillStyle = mix(tint, -0.4);
      [[0, -80, 34], [-26, -64, 24], [26, -64, 24]].forEach(function (b) { ctx.beginPath(); ctx.arc(cx + b[0], gy + b[1], b[2], 0, 7); ctx.fill(); });
    } else if (motif === "scroll") {
      ctx.fillStyle = "#e6d6ae"; ctx.fillRect(cx - 60, gy - 84, 120, 70);
      ctx.fillStyle = "#b8a378"; ctx.fillRect(cx - 66, gy - 90, 132, 10); ctx.fillRect(cx - 66, gy - 20, 132, 10);
      ctx.fillStyle = "rgba(60,40,20,0.55)"; for (var l = 0; l < 5; l++) ctx.fillRect(cx - 48, gy - 72 + l * 11, 70 + (l * 17) % 26, 3);
    } else if (motif === "eye") {
      ctx.fillStyle = lit; ctx.beginPath(); ctx.ellipse(cx, gy - 60, 58, 26, 0, 0, 7); ctx.fill();
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(cx, gy - 60, 18, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx + 6, gy - 66, 4, 0, 7); ctx.fill();
    } else {
      // star: a bright point with rays
      ctx.strokeStyle = "rgba(255,244,210,0.85)"; ctx.lineWidth = 2;
      for (var a = 0; a < 8; a++) { var an = a * Math.PI / 4, rr = a % 2 ? 26 : 52; ctx.beginPath(); ctx.moveTo(cx, H * 0.36); ctx.lineTo(cx + Math.cos(an) * rr, H * 0.36 + Math.sin(an) * rr); ctx.stroke(); }
      ctx.fillStyle = "#fffbe8"; ctx.beginPath(); ctx.arc(cx, H * 0.36, 6, 0, 7); ctx.fill();
    }
    ctx.restore();
    // Frame vignette.
    var v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------- event card
  var cur = null;
  function showEvent(o, p) {
    cur = { o: o, p: p };
    var g = o.game, ev = Story.byId(p.id), box = $("eventCard");
    box.querySelector(".ev-kicker").textContent = (Rules.yearLabel(p.turn)) + " · " + (root.PlanetEras ? root.PlanetEras.eraName(root.PlanetEras.eraOf(g, 0)) + " Era" : "");
    box.querySelector(".ev-title").textContent = Story.fill(g, 0, p.ctx, ev.title);
    box.querySelector(".ev-text").textContent = Story.fill(g, 0, p.ctx, ev.text);
    vignette(box.querySelector("canvas"), ev.art, g.seed + "|" + p.id + "|" + p.uid);
    var html = "";
    Story.choicesFor(g, 0, ev).forEach(function (x) {
      var eff = Story.fill(g, 0, p.ctx, Story.describe(x.c.effects || {}));
      html += '<button type="button" class="ev-choice' + (x.ok ? "" : " locked") + '" data-i="' + x.i + '"' + (x.ok ? "" : " disabled") + ">" +
        (x.c.trait ? '<span class="ev-trait">' + esc(x.c.trait) + "</span>" : "") + '<span class="ev-label">' + esc(Story.fill(g, 0, p.ctx, x.c.label)) + "</span>" +
        '<span class="ev-eff">' + esc(eff || "no immediate effect") + (x.c.effects && x.c.effects.chain ? " · the story continues" : "") + "</span></button>";
    });
    box.querySelector(".ev-choices").innerHTML = html;
    box.querySelector(".ev-result").textContent = "";
    box.querySelector(".ev-result").classList.add("hidden");
    box.querySelector(".ev-ok").classList.add("hidden");
    box.classList.remove("hidden");
  }
  function eventOpen() { return !$("eventCard").classList.contains("hidden"); }
  function closeEvent() { $("eventCard").classList.add("hidden"); var o = cur && cur.o; cur = null; if (o && o.after) o.after(); }

  // ------------------------------------------------------------ era card
  function showEra(g, era) {
    var box = $("eraCard"), e = Tech.ERAS[era];
    box.querySelector(".er-name").textContent = "The " + e.name + " Era";
    box.querySelector(".er-line").textContent = e.line || "";
    box.querySelector(".er-when").textContent = Rules.civName(g, 0) + " · " + Rules.yearLabel(g.turn) + " · turn " + g.turn;
    var dots = Tech.ERAS.map(function (x, i) { return '<span class="er-dot' + (i < era ? " past" : i === era ? " now" : "") + '" title="' + esc(x.name) + '"></span>'; }).join('<span class="er-bar"></span>');
    box.querySelector(".er-track").innerHTML = dots;
    vignette(box.querySelector("canvas"), { motif: era >= 7 ? "star" : era >= 4 ? "flame" : era >= 2 ? "crown" : "ruin", tint: ["#6a5a3a", "#5a4a3a", "#4a3a4a", "#3a4a5a", "#4a3a2a", "#2a3a5a", "#203048", "#0a1030"][era] || "#3a4a5a" }, g.seed + "|era|" + era);
    box.classList.remove("hidden");
  }
  function eraOpen() { return !$("eraCard").classList.contains("hidden"); }
  function closeEra() { $("eraCard").classList.add("hidden"); if (eraAfter) { var f = eraAfter; eraAfter = null; f(); } }
  var eraAfter = null;

  // ------------------------------------------------------------ chronicle
  var chronGame = null;
  function openChronicle(g) {
    chronGame = g;
    var st = Story.state(g), d = g.civs[0].design || {}, html = "", era = -1;
    $("chronTitle").textContent = "The Chronicle of " + (d.name || "Asteria");
    $("chronSub").textContent = st.chronicle.length + " entries · " + Rules.yearLabel(g.turn);
    st.chronicle.forEach(function (e, i) {
      if (e.era !== era) { era = e.era; html += '<h4 class="ch-era"><span>The ' + esc((Tech.ERAS[era] || Tech.ERAS[0]).name) + " Era</span></h4>"; }
      html += '<p class="ch-entry"><span class="ch-year">' + esc(e.year) + "</span>" + (i && st.chronicle[i - 1].era === e.era ? "" : '<span class="ch-drop"></span>') + esc(e.text) + "</p>";
    });
    if (!st.chronicle.length) html = '<p class="ch-entry">The scribes have nothing to write yet.</p>';
    $("chronBody").innerHTML = html;
    $("chronicleOverlay").classList.remove("hidden");
    var b = $("chronBody"); b.scrollTop = b.scrollHeight;
  }
  function chronOpen() { return !$("chronicleOverlay").classList.contains("hidden"); }
  function closeChronicle() { $("chronicleOverlay").classList.add("hidden"); }
  function exportChronicle() {
    if (!chronGame) return;
    var text = Story.exportText(chronGame);
    var blob = new Blob([text], { type: "text/markdown" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "chronicle-" + ((chronGame.civs[0].design || {}).name || "civ").toLowerCase().replace(/\W+/g, "-") + ".md";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function bind() {
    $("eventCard").addEventListener("click", function (ev) {
      var b = ev.target.closest(".ev-choice");
      if (b && cur && !b.disabled && $("eventCard").querySelector(".ev-ok").classList.contains("hidden")) {
        var r = cur.o.onChoose(cur.p.uid, +b.getAttribute("data-i"));
        if (!r || !r.ok) return;
        Array.prototype.forEach.call($("eventCard").querySelectorAll(".ev-choice"), function (x) { x.disabled = true; x.classList.toggle("picked", x === b); });
        var res = $("eventCard").querySelector(".ev-result");
        res.textContent = (r.result || "") + (r.effects ? "  (" + r.effects + ")" : "");
        res.classList.remove("hidden");
        $("eventCard").querySelector(".ev-ok").classList.remove("hidden");
        return;
      }
      if (ev.target.closest(".ev-ok")) closeEvent();
    });
    $("eraCard").addEventListener("click", function (ev) { if (ev.target.closest("button") || ev.target.id === "eraCard") closeEra(); });
    $("chronicleOverlay").addEventListener("click", function (ev) {
      if (ev.target.id === "chronicleOverlay" || ev.target.closest("#chronClose")) closeChronicle();
      if (ev.target.closest("#chronExport")) exportChronicle();
    });
  }
  bind();

  root.PlanetStoryUI = {
    vignette: vignette, showEvent: showEvent, eventOpen: eventOpen, closeEvent: closeEvent,
    showEra: function (g, era, after) { eraAfter = after || null; showEra(g, era); }, eraOpen: eraOpen, closeEra: closeEra,
    openChronicle: openChronicle, chronOpen: chronOpen, closeChronicle: closeChronicle, exportChronicle: exportChronicle,
    resultShown: function () { return !$("eventCard").querySelector(".ev-ok").classList.contains("hidden"); }
  };
})(window);
