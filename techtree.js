/*
 * techtree.js — TECH TREE OVERLAY (DOM). Reads PlanetTech; never changes rules
 * itself: clicking a card calls the onPick(id) callback given to open().
 * Columns are tree depth (grouped under era headers); SVG curves show prerequisites.
 */
(function (root) {
  "use strict";
  var Tech = root.PlanetTech;

  var CARD_W = 186, CARD_H = 86, COL_GAP = 58, ROW_H = 104, TOP = 44;
  var el = {}, opts = null, bound = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var PAD_X = 30;
  function pos(t) { return { x: PAD_X + t.col * (CARD_W + COL_GAP), y: TOP + t.row * ROW_H }; }
  function eraX(era) {
    var a = Math.min.apply(null, era.cols), b = Math.max.apply(null, era.cols);
    return { x: PAD_X + a * (CARD_W + COL_GAP), w: (b - a) * (CARD_W + COL_GAP) + CARD_W };
  }
  function civEra(game) { return root.PlanetEras ? root.PlanetEras.eraOf(game, 0) : 0; }
  function scrollToX(x) { el.scroll.scrollLeft = Math.max(0, x - 40); }
  // Show where the current research is (or the newest era reached).
  function focus(game) {
    var id = game.tech.current;
    if (id) { scrollToX(pos(Tech.TECHS[id]).x - el.scroll.clientWidth / 3); return; }
    scrollToX(eraX(Tech.ERAS[civEra(game)]).x);
  }
  function drawMini(game) {
    var cv = $("ttMini"), ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    var bw = el.board.offsetWidth || 1, bh = el.board.offsetHeight || 1, sx = W / bw, sy = H / bh;
    ctx.clearRect(0, 0, W, H);
    Tech.ERAS.forEach(function (e, i) { var r = eraX(e); ctx.fillStyle = i % 2 ? "#151b21" : "#10151a"; ctx.fillRect(r.x * sx, 0, (r.w + COL_GAP) * sx, H); });
    Tech.TECH_ORDER.forEach(function (id) {
      var p = pos(Tech.TECHS[id]), st = Tech.status(game, id);
      ctx.fillStyle = st === "done" ? "#b8954a" : st === "researching" ? "#8cc8ec" : st === "queued" ? "#4f7d99" : st === "available" ? "#9fd36c" : "#3a434c";
      ctx.fillRect(p.x * sx, p.y * sy, Math.max(2, CARD_W * sx), Math.max(2, CARD_H * sy));
    });
    ctx.strokeStyle = "#f3ead6"; ctx.lineWidth = 1.2;
    ctx.strokeRect(el.scroll.scrollLeft * sx + 0.5, 0.5, el.scroll.clientWidth * sx, H - 1);
  }

  function bind() {
    bound = true;
    el.root = $("techTree"); el.board = $("ttBoard"); el.lines = $("ttLines"); el.status = $("ttStatus"); el.scroll = $("ttScroll");
    $("ttClose").addEventListener("click", close);
    // Pan: the wheel scrolls sideways; drag the background to pan.
    el.scroll.addEventListener("wheel", function (ev) {
      if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { el.scroll.style.scrollBehavior = "auto"; el.scroll.scrollLeft += ev.deltaY; el.scroll.style.scrollBehavior = ""; ev.preventDefault(); }
    }, { passive: false });
    var drag = null;
    el.scroll.addEventListener("mousedown", function (ev) {
      if (ev.target.closest(".tt-card")) return;
      drag = { x: ev.clientX, y: ev.clientY, l: el.scroll.scrollLeft, t: el.scroll.scrollTop };
      el.scroll.classList.add("dragging");
    });
    window.addEventListener("mousemove", function (ev) {
      if (!drag) return;
      el.scroll.scrollLeft = drag.l - (ev.clientX - drag.x); el.scroll.scrollTop = drag.t - (ev.clientY - drag.y);
    });
    window.addEventListener("mouseup", function () { drag = null; if (el.scroll) el.scroll.classList.remove("dragging"); });
    el.scroll.addEventListener("scroll", function () { if (opts) drawMini(opts.game); });
    $("ttEras").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-era]");
      if (b) scrollToX(eraX(Tech.ERAS[+b.getAttribute("data-era")]).x);
    });
    $("ttMini").addEventListener("click", function (ev) {
      var cv = $("ttMini"), r = cv.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width * el.board.offsetWidth;
      el.scroll.scrollLeft = x - el.scroll.clientWidth / 2;
    });
    el.board.addEventListener("click", function (ev) {
      var card = ev.target.closest(".tt-card");
      if (card && opts && opts.onPick) { opts.onPick(card.getAttribute("data-tech")); render(); }
    });
  }

  /*
   * Adjacent columns: one S-curve. An edge that skips columns runs along a
   * horizontal lane that is clear of every card in the columns it crosses,
   * curving into and out of the lane inside the column gaps.
   */
  function edgePath(from, to, x1, y1, x2, y2) {
    if (to.col - from.col <= 1) {
      var mx = (x1 + x2) / 2;
      return "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2;
    }
    var boxes = [];
    Tech.TECH_ORDER.forEach(function (id) {
      var t = Tech.TECHS[id];
      if (t.col > from.col && t.col < to.col) { var p = pos(t); boxes.push([p.y, p.y + CARD_H]); }
    });
    var mid = (y1 + y2) / 2, PAD = 9;
    var cands = [mid];
    boxes.forEach(function (b) { cands.push(b[0] - PAD, b[1] + PAD); });
    function free(y) { return boxes.every(function (b) { return y < b[0] - PAD + 0.5 || y > b[1] + PAD - 0.5; }); }
    cands = cands.filter(free).sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid); });
    var ly = cands.length ? cands[0] : mid;
    var g = COL_GAP / 2;
    return "M" + x1 + "," + y1 +
      " C" + (x1 + g) + "," + y1 + " " + (x1 + g) + "," + ly + " " + (x1 + COL_GAP) + "," + ly +
      " L" + (x2 - COL_GAP) + "," + ly +
      " C" + (x2 - g) + "," + ly + " " + (x2 - g) + "," + y2 + " " + x2 + "," + y2;
  }

  function statusLabel(game, id, st, sciRate) {
    if (st === "done") return "Researched";
    if (st === "researching") {
      var tl = Tech.turnsLeft(game, sciRate);
      return "Researching · " + (tl === Infinity ? "no science" : tl + (tl === 1 ? " turn" : " turns"));
    }
    if (st === "queued") return "Queued #" + (game.tech.queue.indexOf(id) + 2);
    if (st === "available") return "Available";
    var missing = Tech.pathTo(game, id).length - 1;
    return "Locked · " + missing + " to go";
  }

  function render() {
    if (!opts) return;
    var game = opts.game, rate = opts.scienceRate();
    var maxCol = 0, maxRow = 0;
    Tech.TECH_ORDER.forEach(function (id) {
      maxCol = Math.max(maxCol, Tech.TECHS[id].col); maxRow = Math.max(maxRow, Tech.TECHS[id].row);
    });
    var W = 2 * PAD_X + (maxCol + 1) * CARD_W + maxCol * COL_GAP, H = TOP + maxRow * ROW_H + CARD_H + 8;
    el.board.style.width = W + "px";
    el.board.style.height = H + "px";

    var html = "";
    var now = civEra(game), eraBtns = "";
    Tech.ERAS.forEach(function (era, i) {
      var r = eraX(era);
      html += '<div class="tt-band' + (i % 2 ? " odd" : "") + '" style="left:' + (r.x - COL_GAP / 2) + "px;width:" + (r.w + COL_GAP) + 'px"></div>';
      html += '<div class="tt-era" style="left:' + r.x + "px;width:" + r.w + 'px">' + esc(era.name) + (i === now ? " · your era" : "") + "</div>";
      eraBtns += '<button type="button" data-era="' + i + '" class="' + (i === now ? "now" : i < now ? "reached" : "") + '">' + esc(era.name) + "</button>";
    });
    $("ttEras").innerHTML = eraBtns;
    Tech.TECH_ORDER.forEach(function (id) {
      var t = Tech.TECHS[id], p = pos(t), st = Tech.status(game, id);
      var bar = st === "researching"
        ? '<span class="tbar"><span style="width:' + Math.min(100, game.tech.progress / t.cost * 100).toFixed(1) + '%"></span></span>' : "";
      var prog = st === "researching" ? Math.min(game.tech.progress, t.cost) + "/" : "";
      html += '<button type="button" class="tt-card ' + st + '" data-tech="' + id + '" style="left:' + p.x + "px;top:" + p.y + 'px">' +
        '<span class="tn"><b>' + esc(t.name) + '</b><span class="tc">' + prog + t.cost + " sci</span></span>" +
        '<span class="te">' + esc(t.effect) + "</span>" +
        '<span class="ts">' + esc(statusLabel(game, id, st, rate)) + bar + "</span></button>";
    });
    // Rebuild cards but keep the SVG element.
    Array.prototype.slice.call(el.board.children).forEach(function (c) { if (c !== el.lines) c.remove(); });
    el.board.insertAdjacentHTML("beforeend", html);

    var path = game.tech.current ? [game.tech.current].concat(game.tech.queue) : [];
    var svg = "";
    Tech.TECH_ORDER.forEach(function (id) {
      var t = Tech.TECHS[id], to = pos(t);
      t.requires.forEach(function (r) {
        var from = pos(Tech.TECHS[r]);
        var x1 = from.x + CARD_W, y1 = from.y + CARD_H / 2, x2 = to.x, y2 = to.y + CARD_H / 2;
        var d = edgePath(Tech.TECHS[r], t, x1, y1, x2, y2);
        var done = Tech.has(game, r);
        var onPath = path.indexOf(id) !== -1 && (done || path.indexOf(r) !== -1);
        var color = onPath ? "#8cc8ec" : done ? "#b8954a" : "#46515c";
        svg += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (onPath ? 2.6 : 2) + '"' +
          (done || onPath ? "" : ' stroke-dasharray="5 4"') + ' stroke-linecap="round"/>' +
          '<circle cx="' + x2 + '" cy="' + y2 + '" r="3.2" fill="' + color + '"/>';
      });
    });
    el.lines.setAttribute("viewBox", "0 0 " + W + " " + H);
    el.lines.innerHTML = svg;

    drawMini(game);
    var cur = game.tech.current;
    el.status.textContent = cur
      ? "Researching " + Tech.TECHS[cur].name + " · " + game.tech.progress + "/" + Tech.TECHS[cur].cost +
        " · +" + rate + " per turn" + (game.tech.queue.length ? " · then " + game.tech.queue.map(function (q) { return Tech.TECHS[q].name; }).join(", ") : "")
      : "Nothing being researched · +" + rate + " science per turn";
  }

  // open({ game, scienceRate(), onPick(id) })
  function open(o) {
    if (!bound) bind();
    opts = o;
    el.root.classList.remove("hidden");
    render();
    el.scroll.style.scrollBehavior = "auto";
    focus(o.game);
    el.scroll.style.scrollBehavior = "";
    drawMini(o.game);
  }
  function close() { if (el.root) el.root.classList.add("hidden"); if (opts && opts.onClose) opts.onClose(); }
  function isOpen() { return !!el.root && !el.root.classList.contains("hidden"); }

  root.PlanetTechTree = { open: open, close: close, isOpen: isOpen, render: render };
})(window);
