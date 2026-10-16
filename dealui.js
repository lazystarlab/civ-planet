/*
 * dealui.js — THE DEAL SCREEN (DOM only).
 * Two columns (you give / they give) with an "Add…" menu each, a row of
 * agreements, and a live reaction from deals.js evaluate() as you edit.
 * "What would they want?" asks deals.js counter() and shows their counter-proposal.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Diplo = root.PlanetDiplomacy, Deals = root.PlanetDeals, Tech = root.PlanetTech;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var cur = null, opts = null;

  function open(o, cid, prefill, note) {
    opts = o;
    cur = { cid: cid, deal: prefill || { from: 0, to: cid, give: [], ask: [], pacts: [] }, note: note || "" };
    $("dealOverlay").classList.remove("hidden");
    render();
  }
  function close() { $("dealOverlay").classList.add("hidden"); cur = null; }
  function isOpen() { return !!cur; }

  function resName(r) { return root.PlanetGen.RESOURCES[r].name; }
  function itemLabel(game, it) {
    if (it.t === "gold") return "Gold";
    if (it.t === "gpt") return "Gold per turn";
    if (it.t === "tech") return Tech.TECHS[it.id].name;
    if (it.t === "lux") return resName(it.res) + " (" + it.turns + " turns)";
    if (it.t === "map") return "World map";
    if (Deals.EXT && Deals.EXT[it.t]) return Deals.EXT[it.t].describe(game, it);
    if (it.t === "city") { var c = Rules.cityById(game, it.id); return c ? c.name + " (pop " + c.pop + ")" : "City"; }
    return it.t;
  }

  // Options for the "Add…" menu of one side (giver -> receiver).
  function addOptions(game, giver, recv, list) {
    var o = [];
    var has = function (t, k, v) { return list.some(function (x) { return x.t === t && (k ? x[k] === v : true); }); };
    if (!has("gold")) o.push(["gold", "Gold (lump sum, " + game.civs[giver].gold + " available)"]);
    if (!has("gpt")) o.push(["gpt", "Gold per turn, " + Deals.GPT_TURNS + " turns"]);
    Deals.techsToOffer(game, giver, recv).forEach(function (id) { if (!has("tech", "id", id)) o.push(["tech:" + id, "Tech: " + Tech.TECHS[id].name]); });
    var lc = Deals.luxCopies(game, giver), out = Deals.luxOut(game, giver);
    Object.keys(lc).forEach(function (r) { if (!has("lux", "res", r) && out.indexOf(r) === -1) o.push(["lux:" + r, "Luxury: " + resName(r) + " (" + lc[r] + (lc[r] === 1 ? " copy" : " copies") + ", " + Deals.LUX_TURNS + " turns)"]); });
    if (root.PlanetStrategic) root.PlanetStrategic.tradable(game, giver).forEach(function (r) { if (!has("strat", "res", r)) o.push(["strat:" + r, "Strategic: " + resName(r) + " (+" + root.PlanetStrategic.PER_SOURCE + " units, 30 turns)"]); });
    if (!has("map")) o.push(["map", "World map (" + Deals.revealedGain(game, giver, recv) + " new tiles)"]);
    Rules.citiesOf(game, giver).forEach(function (c) { if (!c.capital && !has("city", "id", c.id)) o.push(["city:" + c.id, "City: " + c.name + " (pop " + c.pop + ")"]); });
    return o;
  }

  function side(game, title, key, giver, recv) {
    var list = cur.deal[key];
    var html = '<div class="dl-side"><div class="dl-title">' + title + "</div>";
    if (!list.length) html += '<div class="dl-empty">Nothing yet</div>';
    list.forEach(function (it, i) {
      html += '<div class="dl-item"><span>' + esc(itemLabel(game, it)) + "</span>";
      if (it.t === "gold" || it.t === "gpt") html += '<input type="number" min="1" step="5" value="' + it.n + '" data-side="' + key + '" data-i="' + i + '">' + (it.t === "gpt" ? "<small>/turn × " + it.turns + "</small>" : "<small>gold</small>");
      html += '<button type="button" class="dl-x" data-rm="' + key + ":" + i + '" title="Remove">×</button></div>';
    });
    var o = addOptions(game, giver, recv, list);
    html += '<select data-add="' + key + '"><option value="">+ Add…</option>' + o.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + "</option>"; }).join("") + "</select></div>";
    return html;
  }

  var PACTS = [["open", "Open borders"], ["nap", "Non-aggression pact · " + Diplo.NAP_TURNS + "t"], ["def", "Defensive pact"], ["ally", "Alliance"], ["research", "Research agreement · " + Deals.RESEARCH_COST + " gold each"]];

  function render() {
    if (!cur) return;
    var game = opts.game(), cid = cur.cid, d = game.civs[cid].design, r = Diplo.rel(game, 0, cid);
    var box = $("dealBody");
    box.style.setProperty("--dp-primary", d.primary);
    box.style.setProperty("--dp-secondary", d.secondary);
    // At war: the only agreement is a peace treaty (always on), with the war score.
    var Peace = root.PlanetPeace, atWar = !!r.war;
    if (atWar && cur.deal.pacts.indexOf("peace") === -1) cur.deal.pacts = ["peace"];
    if (!atWar) cur.deal.pacts = cur.deal.pacts.filter(function (k) { return k !== "peace"; });
    var ev = Deals.evaluate(game, cur.deal);
    var p = r.pact || {};
    var pactHtml = atWar ? warHtml(game, cid) : PACTS.map(function (x) {
      var on = cur.deal.pacts.indexOf(x[0]) !== -1;
      var have = x[0] === "open" ? r.open : x[0] === "nap" ? p.nap > game.turn : x[0] === "research" ? p.research > game.turn : p[x[0]];
      return '<label class="dl-pact' + (on ? " on" : "") + (have ? " have" : "") + '"><input type="checkbox" data-pact="' + x[0] + '"' + (on ? " checked" : "") + (have ? " disabled" : "") + "> " + esc(x[1]) + (have ? " <small>(active)</small>" : "") + "</label>";
    }).join("");
    var active = Deals.state(game).active.filter(function (a) { return (a.from === 0 && a.to === cid) || (a.from === cid && a.to === 0); });
    var cls = ev.verdict === "accept" ? "ok" : ev.verdict === "more" ? "more" : "no";
    var word = ev.verdict === "accept" ? (ev.gift ? "Gladly accepted" : "Acceptable") : ev.verdict === "more" ? "They want more" : "Refuse";
    var detail = ev.verdict === "more" ? "About " + ev.want + " gold's worth short" : ev.verdict === "refuse" && ev.reason !== "Refuse" ? ev.reason : ev.gift ? "A gift: they will remember it" : "";
    box.innerHTML =
      '<div class="dl-head"><canvas id="dlBadge"></canvas><div><h2>' + (atWar ? "Peace talks with " : "Trade with ") + esc(d.name) + '</h2><div class="dl-sub">' + esc(d.leaderTitle + " " + d.leaderName) +
        " · " + esc(Diplo.word(r)) + " (" + (r.att > 0 ? "+" : "") + r.att + ")" + " · they have " + game.civs[cid].gold + " gold · you have " + game.gold + " gold</div></div>" +
        '<button type="button" class="dl-close" id="dlClose" title="Close (Esc)">×</button></div>' +
      (cur.note ? '<div class="dl-note">' + esc(cur.note) + "</div>" : "") +
      '<div class="dl-cols">' + side(game, "You give", "give", 0, cid) + side(game, esc(d.name) + " gives", "ask", cid, 0) + "</div>" +
      '<div class="dl-title">' + (atWar ? "Peace treaty" : "Agreements (both sides)") + '</div><div class="dl-pacts">' + pactHtml + "</div>" +
      '<div class="dl-react ' + cls + '"><span class="dl-word">' + word + '</span><span class="dl-why">' + esc(detail) + "</span></div>" +
      '<div class="dl-buttons"><button type="button" id="dlClear">Clear</button>' + (atWar ? '<button type="button" id="dlWhite" title="Peace with nothing changing hands">White peace</button>' : "") + '<button type="button" id="dlCounter"' + (ev.blocked ? " disabled" : "") + '>What would they want?</button>' +
        '<button type="button" class="primary" id="dlPropose"' + (ev.verdict === "accept" ? "" : " disabled") + ">" + (atWar ? "Sign treaty" : "Propose deal") + "</button></div>" +
      (active.length ? '<div class="dl-title">Running deals</div>' + active.map(function (a) {
        return '<div class="dl-run">' + esc(a.from === 0 ? "You give" : d.name + " gives") + " " + (a.t === "gpt" ? a.n + " gold/turn" : esc(resName(a.res)) + " access") + " · " + a.turns + " turns left</div>";
      }).join("") : "");
    root.PlanetCreator.paintBadge($("dlBadge"), d, "hex");
  }

  // War score meter: -100 (losing badly) .. +100 (winning), plus the tallies.
  function scoreBar(s) {
    var pct = (s + 100) / 2;
    return '<span class="ws-bar"><span class="ws-fill ' + (s >= 0 ? "up" : "down") + '" style="left:' + Math.min(50, pct) + "%;width:" + Math.abs(pct - 50) + '%"></span><span class="ws-mid"></span></span>';
  }
  function warHtml(game, cid) {
    var b = root.PlanetPeace.breakdown(game, 0, cid) || { score: 0, turns: 0, kills: 0, lost: 0, took: 0, gave: 0, weary: 0, theirWeary: 0 };
    var s = b.score, word = s >= 40 ? "Decisive advantage" : s >= 12 ? "Winning" : s > -12 ? "Stalemate" : s > -40 ? "Losing" : "Crushing defeat";
    return '<div class="ws-box"><div class="ws-top"><span class="ws-label">War score</span><b class="ws-num ' + (s >= 0 ? "up" : "down") + '">' + (s > 0 ? "+" : s < 0 ? "\u2212" : "") + Math.abs(s) + "</b><span class=\"ws-word\">" + word + "</span>" + scoreBar(s) + "</div>" +
      '<div class="ws-tally">' + b.turns + " turns · units destroyed " + b.kills + " / lost " + b.lost + " · cities taken " + b.took + " / lost " + b.gave +
      " · weariness you " + b.weary + " / them " + b.theirWeary + " · a treaty starts a " + root.PlanetPeace.TRUCE_TURNS + "-turn truce</div></div>";
  }
  function bind() {
    var box = $("dealOverlay");
    box.addEventListener("click", function (ev) {
      if (!cur) return;
      var game = opts.game();
      if (ev.target === box || ev.target.closest("#dlClose")) { close(); return; }
      var rm = ev.target.closest("[data-rm]");
      if (rm) { var pr = rm.getAttribute("data-rm").split(":"); cur.deal[pr[0]].splice(+pr[1], 1); cur.note = ""; render(); return; }
      if (ev.target.closest("#dlClear")) { cur.deal = { from: 0, to: cur.cid, give: [], ask: [], pacts: [] }; cur.note = ""; render(); return; }
      if (ev.target.closest("#dlWhite")) {
        var wp = root.PlanetPeace.whitePeace(game, 0, cur.cid);
        if (wp.ok) { opts.onChange({ ok: true, text: "White peace with " + Rules.civName(game, cur.cid) }); close(); }
        else { cur.note = wp.text; render(); }
        return;
      }
      if (ev.target.closest("#dlCounter")) {
        var c = Deals.counter(game, cur.deal);
        cur.deal = c.deal;
        cur.note = c.ok ? "Their counter-proposal: this would work for them" : "They could not find a deal that works: " + (c.eval.reason || "");
        render(); return;
      }
      if (ev.target.closest("#dlPropose")) {
        var res = Deals.execute(game, cur.deal);
        if (res.ok) { opts.onChange({ ok: true, text: (cur.deal.pacts.indexOf("peace") !== -1 ? "Peace treaty signed with " : "Deal agreed with ") + Rules.civName(game, cur.cid) }); close(); }
        else { cur.note = res.text; render(); }
      }
    });
    box.addEventListener("change", function (ev) {
      if (!cur) return;
      var game = opts.game();
      var sel = ev.target.closest("select[data-add]");
      if (sel && sel.value) {
        var key = sel.getAttribute("data-add"), v = sel.value, giver = key === "give" ? 0 : cur.cid;
        var it = v === "gold" ? { t: "gold", n: Math.max(1, Math.min(50, game.civs[giver].gold)) } : v === "gpt" ? { t: "gpt", n: 3, turns: Deals.GPT_TURNS } : v === "map" ? { t: "map" } :
          v.indexOf("tech:") === 0 ? { t: "tech", id: v.slice(5) } : v.indexOf("lux:") === 0 ? { t: "lux", res: v.slice(4), turns: Deals.LUX_TURNS } : v.indexOf("strat:") === 0 ? { t: "strat", res: v.slice(6), turns: 30 } : { t: "city", id: +v.slice(5) };
        cur.deal[key].push(it); cur.note = ""; render(); return;
      }
      var cb = ev.target.closest("input[data-pact]");
      if (cb) {
        var k = cb.getAttribute("data-pact"), ps = cur.deal.pacts;
        if (cb.checked && ps.indexOf(k) === -1) ps.push(k); else if (!cb.checked) cur.deal.pacts = ps.filter(function (x) { return x !== k; });
        cur.note = ""; render();
      }
    });
    // Live: numbers re-evaluate as you type.
    box.addEventListener("input", function (ev) {
      var inp = ev.target.closest("input[data-side]");
      if (!inp || !cur) return;
      var it = cur.deal[inp.getAttribute("data-side")][+inp.getAttribute("data-i")];
      it.n = Math.max(0, Math.floor(+inp.value || 0));
      var pos = inp.selectionStart, id = inp.getAttribute("data-side") + inp.getAttribute("data-i");
      render();
      var again = box.querySelector('input[data-side="' + id.slice(0, -String(+inp.getAttribute("data-i")).length) + '"][data-i="' + inp.getAttribute("data-i") + '"]');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* number inputs */ } }
    });
  }

  root.PlanetDealUI = { open: open, close: close, isOpen: isOpen, render: render, bind: bind };
})(window);
