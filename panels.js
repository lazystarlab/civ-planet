/*
 * panels.js — CONTACT CARD, DIPLOMACY PANEL, EVENT FEED (DOM only).
 * Reads game state and PlanetDiplomacy; actions go through callbacks/rules
 * functions, and the caller (app.js) refreshes and saves.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame;
  var Diplo = root.PlanetDiplomacy;
  var Civ = root.PlanetCiv;
  var Creator = root.PlanetCreator;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------- first contact
  var contactQueue = [], contactOpts = null;

  function showContact(game, cid, opts) {
    contactQueue.push(cid);
    contactOpts = opts || contactOpts || {};
    if (contactQueue.length === 1) renderContact(game);
  }

  function renderContact(game) {
    var cid = contactQueue[0];
    var cv = game.civs[cid], d = cv.design, r = Diplo.rel(game, 0, cid);
    var box = $("contactCard");
    box.style.setProperty("--cc-primary", d.primary);
    box.style.setProperty("--cc-secondary", d.secondary);
    $("ccBody").innerHTML =
      '<div class="cc-kicker">First contact</div>' +
      '<canvas id="ccBadge"></canvas>' +
      '<div class="cc-name">' + esc(d.name) + "</div>" +
      '<div class="cc-people">The ' + esc(d.adjective) + " people · " + esc(d.people) + "</div>" +
      '<div class="cc-leader">' + esc(d.leaderTitle) + " <b>" + esc(d.leaderName) + "</b></div>" +
      '<blockquote class="cc-quote">“' + esc(Diplo.greeting(d, r ? r.att : 0)) + "”</blockquote>" +
      '<div class="cc-traits">' + d.traits.map(function (t) {
        var tr = Civ.TRAITS[t];
        return '<span class="cc-trait"><b>' + esc(tr.name) + "</b>" + esc(tr.effect) + "</span>";
      }).join("") + "</div>" +
      '<div class="cc-mood">They seem <b>' + esc(Diplo.word(r)) + "</b>" +
        (contactQueue.length > 1 ? " · " + (contactQueue.length - 1) + " more to meet" : "") + "</div>";
    $("contactOverlay").classList.remove("hidden");
    Creator.paintBadge($("ccBadge"), d, "hex");
  }

  function closeContact(game) {
    contactQueue.shift();
    if (contactQueue.length && game) renderContact(game);
    else $("contactOverlay").classList.add("hidden");
  }
  function contactOpen() { return !$("contactOverlay").classList.contains("hidden"); }
  function closeAllContacts() { contactQueue = []; $("contactOverlay").classList.add("hidden"); }

  // -------------------------------------------------------------- diplomacy
  var diploOpts = null;

  function openDiplomacy(o) { diploOpts = o; $("diploPanel").classList.remove("hidden"); renderDiplomacy(); }
  function closeDiplomacy() { $("diploPanel").classList.add("hidden"); }
  function diplomacyOpen() { return !$("diploPanel").classList.contains("hidden"); }

  function attBar(att) {
    var pct = (att + 10) / 20 * 100;
    return '<span class="dp-att"><span style="left:' + pct.toFixed(1) + '%"></span></span>';
  }

  function renderDiplomacy() {
    if (!diploOpts) return;
    var game = diploOpts.game();
    var met = Diplo.metCivs(game, 0);
    var html = requestsHtml(game);
    if (!met.length) html = '<div class="dp-empty">You have not met another civilization yet. Explore with your warriors.</div>';
    met.forEach(function (cid) {
      var d = game.civs[cid].design, r = Diplo.rel(game, 0, cid);
      if (game.civs[cid].eliminated) {
        html += '<div class="dp-row dp-gone" style="--dp-primary:' + d.primary + ";--dp-secondary:" + d.secondary + '">' +
          '<canvas class="dp-badge" data-civ="' + cid + '"></canvas><div class="dp-main"><div class="dp-name">' + esc(d.name) +
          '</div><div class="dp-sub">Eliminated</div></div></div>';
        return;
      }
      var cities = Rules.citiesOf(game, cid).length;
      var PZ = root.PlanetPeace, truce = PZ ? PZ.truceUntil(game, 0, cid) : 0;
      var wsb = r.war && PZ ? PZ.breakdown(game, 0, cid) : null;
      var reasons = Diplo.reasons(game, 0, cid);
      var p = r.pact || {}, pacts = [];
      if (p.ally) pacts.push("Alliance"); else if (p.def) pacts.push("Defensive pact");
      if (p.nap > game.turn) pacts.push("Non-aggression · " + (p.nap - game.turn) + "t");
      if (p.research > game.turn) pacts.push("Research · " + (p.research - game.turn) + "t");
      var running = root.PlanetDeals ? root.PlanetDeals.state(game).active.filter(function (a) { return (a.from === 0 && a.to === cid) || (a.from === cid && a.to === 0); }).length : 0;
      if (running) pacts.push(running + (running === 1 ? " deal" : " deals"));
      html += '<div class="dp-row" style="--dp-primary:' + d.primary + ";--dp-secondary:" + d.secondary + '">' +
        '<canvas class="dp-badge" data-civ="' + cid + '"></canvas>' +
        '<div class="dp-main"><div class="dp-name">' + esc(d.name) + ' <span class="dp-leader">' + esc(d.leaderTitle) + " " + esc(d.leaderName) + "</span></div>" +
        '<div class="dp-sub">' + d.traits.map(function (t) { return esc(Civ.TRAITS[t].name); }).join(" · ") +
          " · " + cities + (cities === 1 ? " city" : " cities") + " · met turn " + r.metTurn + "</div>" +
        '<div class="dp-mood"><span class="dp-status ' + (r.war ? "war" : "peace") + '">' + (r.war ? "War" : "Peace") + "</span>" +
          '<span class="dp-word w-' + Diplo.word(r).toLowerCase().replace(/\s+/g, "") + '">' + esc(Diplo.word(r)) + "</span>" + attBar(r.att) +
          pacts.map(function (x) { return '<span class="dp-pact">' + esc(x) + "</span>"; }).join("") +
          (wsb ? '<span class="dp-ws ' + (wsb.score >= 0 ? "up" : "down") + '" title="War score: kills, cities taken, recent battles and relative strength. Weariness you ' + wsb.weary + " / them " + wsb.theirWeary + '">War score ' + (wsb.score > 0 ? "+" : wsb.score < 0 ? "\u2212" : "") + Math.abs(wsb.score) + " · " + wsb.turns + "t</span>" : "") + "</div>" +
        '<div class="dp-reasons">' + (reasons.length ? reasons.map(function (x) {
          var v = Math.round(x.v);
          return '<span class="dp-reason ' + (v > 0 ? "up" : v < 0 ? "down" : "") + (x.mem ? " mem" : "") + '"' + (x.mem ? ' title="Remembered: fades over time"' : "") + ">" + esc(x.label) + " <b>" + (v > 0 ? "+" : v < 0 ? "\u2212" : "") + Math.abs(v) + "</b></span>";
        }).join("") : '<span class="dp-reason">No strong feelings yet</span>') + "</div></div>" +
        '<div class="dp-actions">' +
          '<button type="button" class="primary" data-act="deal" data-civ="' + cid + '">' + (r.war ? "Peace talks…" : "Trade…") + "</button>" +
          '<label class="dp-toggle' + (r.war ? " off" : "") + '"><input type="checkbox" data-act="borders" data-civ="' + cid + '"' + (r.open ? " checked" : "") + (r.war ? " disabled" : "") + "> Open borders</label>" +
          (r.war
            ? (r.offer === cid
              ? '<button type="button" class="accept" data-act="accept" data-civ="' + cid + '">Accept peace offer</button>'
              : '<button type="button" data-act="white" data-civ="' + cid + '" title="Peace with nothing changing hands">White peace</button>')
            : truce ? '<span class="dp-truce">Truce · ' + (truce - game.turn) + "t</span>" : '<button type="button" class="danger" data-act="war" data-civ="' + cid + '"' + ((p.nap > game.turn || p.def || p.ally) ? ' data-pact="1"' : "") + ">Declare war</button>") +
        "</div></div>";
    });
    var unmet = game.civs.length - 1 - met.length;
    if (unmet > 0) html += '<div class="dp-unmet">' + unmet + (unmet === 1 ? " civilization" : " civilizations") + " not yet met</div>";
    html += relationsHtml(game, met);
    $("dpList").innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll(".dp-badge"), function (cv) {
      Creator.paintBadge(cv, game.civs[+cv.getAttribute("data-civ")].design, "hex");
    });
  }

  // Pending proposals, demands and calls for help aimed at the player.
  function requestsHtml(game) {
    var D = root.PlanetDeals, html = "";
    var pend = D ? D.state(game).pending.filter(function (p) { return p.deal.to === 0; }) : [];
    var asks = (game.diplo && game.diplo.asks) || [];
    if (!pend.length && !asks.length) return "";
    html += '<div class="dp-req-head">Waiting for your answer</div>';
    pend.forEach(function (p) {
      var name = Rules.civName(game, p.from);
      var title = p.kind === "demand" ? name + " demands tribute" : p.kind === "pact" ? name + " proposes an agreement" : p.kind === "peace" ? name + " offers peace terms" : name + " proposes a trade";
      html += '<div class="dp-req ' + p.kind + '"><div><b>' + esc(title) + "</b><span>" + esc(D.describe(game, p.deal)) +
        (p.kind === "demand" ? " · refusing may mean war" : "") + "</span></div>" +
        '<button type="button" class="accept" data-act="prop" data-how="yes" data-pid="' + p.id + '">' + (p.kind === "demand" ? "Pay" : "Accept") + "</button>" +
        (p.kind === "offer" || p.kind === "peace" ? '<button type="button" data-act="prop" data-how="counter" data-pid="' + p.id + '">Counter…</button>' : "") +
        '<button type="button" data-act="prop" data-how="no" data-pid="' + p.id + '">' + (p.kind === "demand" ? "Refuse" : "Decline") + "</button></div>";
    });
    asks.forEach(function (q, i) {
      var t = q.kind === "pact" ? Rules.civName(game, q.from) + " was attacked by " + Rules.civName(game, q.against) + " and calls on your pact"
        : Rules.civName(game, q.from) + " asks you to join its war against " + Rules.civName(game, q.against);
      html += '<div class="dp-req help"><div><b>' + esc(t) + "</b><span>" + (q.kind === "pact" ? "Staying out ends the pact and hurts relations badly" : "Declining costs a little goodwill") + "</span></div>" +
        '<button type="button" class="accept" data-act="ask" data-yes="1" data-i="' + i + '">Join the war</button>' +
        '<button type="button" data-act="ask" data-yes="0" data-i="' + i + '">Stay out</button></div>';
    });
    return html;
  }

  // What you know of how the civs you have met get along with each other.
  function relationsHtml(game, met) {
    var ids = [0].concat(met.filter(function (c) { return !game.civs[c].eliminated; }));
    if (ids.length < 3) return "";
    var cell = function (a, b) {
      if (a === b) return '<td class="self"></td>';
      var r = Diplo.rel(game, a, b);
      if (!r || !r.met) return '<td class="unk" title="They have not met">·</td>';
      var p = r.pact || {};
      var txt = r.war ? "War" : p.ally ? "Allied" : p.def ? "Pact" : Diplo.word(r);
      var tags = [];
      if (p.nap > game.turn) tags.push("NAP");
      if (p.research > game.turn) tags.push("Res");
      if (r.open) tags.push("Open");
      return '<td class="rel w-' + (r.war ? "atwar" : p.ally || p.def ? "allied" : Diplo.word(r).toLowerCase()) + '" title="' + esc(Rules.civName(game, a) + " – " + Rules.civName(game, b) + ": " + txt + " (" + r.att + ")") + '">' +
        esc(txt) + (tags.length ? "<small>" + tags.join(" · ") + "</small>" : "") + "</td>";
    };
    var head = "<tr><th></th>" + ids.map(function (c) { return '<th><span class="dp-dot" style="background:' + game.civs[c].design.primary + '"></span>' + esc(c === 0 ? "You" : game.civs[c].design.name) + "</th>"; }).join("") + "</tr>";
    var rows = ids.map(function (a) {
      return '<tr><th><span class="dp-dot" style="background:' + game.civs[a].design.primary + '"></span>' + esc(a === 0 ? "You" : game.civs[a].design.name) + "</th>" + ids.map(function (b) { return cell(a, b); }).join("") + "</tr>";
    }).join("");
    return '<div class="dp-req-head">Known relations</div><table class="dp-rel">' + head + rows + "</table>";
  }

  function bindDiplomacy() {
    $("dpClose").addEventListener("click", closeDiplomacy);
    $("dpList").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-act]");
      if (!b || !diploOpts) return;
      var game = diploOpts.game(), cid = +b.getAttribute("data-civ"), act = b.getAttribute("data-act");
      if (act === "deal") { if (diploOpts.onDeal) diploOpts.onDeal(cid); return; }
      if (act === "ask") {
        diploOpts.onChange(Diplo.answerAsk(game, +b.getAttribute("data-i"), b.getAttribute("data-yes") === "1"));
        renderDiplomacy(); return;
      }
      if (act === "prop") {
        var pid = +b.getAttribute("data-pid"), how = b.getAttribute("data-how");
        if (how === "counter") {
          var pp = root.PlanetDeals.state(game).pending.filter(function (x) { return x.id === pid; })[0];
          if (pp && diploOpts.onDeal) {
            // Open it as our own proposal back to them (sides swapped).
            root.PlanetDeals.state(game).pending = root.PlanetDeals.state(game).pending.filter(function (x) { return x !== pp; });
            diploOpts.onDeal(pp.deal.from, { from: 0, to: pp.deal.from, give: pp.deal.ask, ask: pp.deal.give, pacts: pp.deal.pacts || [] }, "Their proposal: change it and propose your version");
          }
          return;
        }
        diploOpts.onChange(root.PlanetDeals.answer(game, pid, how === "yes"));
        renderDiplomacy(); return;
      }
      if (act === "war" && !b.classList.contains("confirm")) {
        b.classList.add("confirm"); b.textContent = b.getAttribute("data-pact") ? "Break your pact? Everyone will remember" : "Really declare war?"; return;
      }
      var res = act === "war" ? Diplo.declareWar(game, 0, cid) : act === "accept" ? Diplo.acceptPeace(game, 0, cid) :
        act === "white" && root.PlanetPeace ? root.PlanetPeace.whitePeace(game, 0, cid) : Diplo.makePeace(game, 0, cid);
      diploOpts.onChange(res);
      renderDiplomacy();
    });
    $("dpList").addEventListener("change", function (ev) {
      var cb = ev.target.closest("input[data-act=borders]");
      if (!cb || !diploOpts) return;
      var res = Diplo.setOpenBorders(diploOpts.game(), 0, +cb.getAttribute("data-civ"), cb.checked);
      diploOpts.onChange(res);
      renderDiplomacy();
    });
  }

  // ------------------------------------------------------------------ feed
  var KIND_LABEL = { growth: "Growth", built: "Built", tech: "Tech", contact: "Contact", war: "War", diplo: "Diplomacy", combat: "Battle", capital: "Capital", info: "" };
  var feedCollapsed = false;

  function renderFeed(game) {
    var box = $("feed");
    if (!game) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.classList.toggle("collapsed", feedCollapsed);
    var items = game.log.filter(function (e) { return e.cid === 0 || e.cid == null; }).slice(-7).reverse();
    $("feedList").innerHTML = items.length ? items.map(function (e) {
      return '<li class="k-' + e.kind + '"><span class="ft">T' + e.turn + "</span>" +
        (KIND_LABEL[e.kind] ? '<span class="fk">' + KIND_LABEL[e.kind] + "</span>" : "") + esc(e.text) + "</li>";
    }).join("") : '<li class="empty">Nothing yet. End a turn.</li>';
    $("feedCount").textContent = items.length ? "· last " + items.length : "";
  }

  function bindFeed(getGame) {
    $("feedHead").addEventListener("click", function () {
      feedCollapsed = !feedCollapsed;
      renderFeed(getGame());
    });
  }

  root.PlanetPanels = {
    showContact: showContact, closeContact: closeContact, contactOpen: contactOpen, closeAllContacts: closeAllContacts,
    openDiplomacy: openDiplomacy, closeDiplomacy: closeDiplomacy, diplomacyOpen: diplomacyOpen,
    renderDiplomacy: renderDiplomacy, bindDiplomacy: bindDiplomacy,
    renderFeed: renderFeed, bindFeed: bindFeed
  };
})(window);
