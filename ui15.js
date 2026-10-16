/*
 * ui15.js — UI for slice 15: Government panel (G), Religion panel (L) with the
 * founding card and ideology choice, unit panel extras (XP and promotion
 * picker, goto/sentry/explore, air missions, missionaries), map badges (star
 * pips, order glyphs), the goto path preview, the strategic resources tooltip
 * and the city religion icon. app.js calls these through window.PlanetUI15.
 * DOM is created here (styles injected once), so index.html only loads the file.
 */
(function (root) {
  "use strict";
  var Rules = root.PlanetGame, Gov = root.PlanetGov, Rel = root.PlanetReligion, Promo = root.PlanetPromo,
    Orders = root.PlanetOrders, Air = root.PlanetAir, Strat = root.PlanetStrategic, Icons = root.PlanetIcons;
  var API = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function T(type) { return Rules.UNIT_TYPES[type] || {}; }
  function g() { return API && API.game(); }

  var CSS = [
    "#govPanel,#relPanel{position:fixed;top:64px;left:50%;transform:translateX(-50%);width:860px;max-height:calc(100vh - 84px);overflow:auto;z-index:23;background:rgba(14,18,22,0.97);border:1px solid #3c4652;border-radius:8px;box-shadow:0 14px 36px rgba(0,0,0,0.55);padding:12px 16px 14px;color:#e9e1cf;font-size:13px}",
    "#govPanel:not(.hidden),#relPanel:not(.hidden){animation:pnl-in .2s ease-out}",
    ".u15-head{display:flex;align-items:baseline;gap:14px;margin-bottom:8px}.u15-head h2{margin:0;font-family:Georgia,Palatino,serif;font-weight:500;font-size:22px;color:#f3ead6}.u15-help{flex:1;font-size:11.5px;color:#77818a}",
    ".u15-sec{margin:12px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8fa0ae}",
    ".gv-cur{display:flex;gap:14px;align-items:center;padding:10px 12px;border-radius:7px;background:linear-gradient(90deg,#2b2414,#151a1f 60%);border:1px solid #6a5a30}",
    ".gv-cur .nm{font-family:Georgia,serif;font-size:20px;color:#f6e7bd}.gv-cur .tx{color:#c9bfa8;font-size:12.5px}.gv-an{color:#f0a070;font-weight:700}",
    ".gv-list{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}",
    ".gv-g{padding:7px 9px;border-radius:6px;background:#171d23;border:1px solid #2c343d;display:flex;flex-direction:column;gap:3px;min-height:74px}",
    ".gv-g b{color:#f3ead6;font-size:13px}.gv-g small{color:#9aa4ad;font-size:11px;line-height:1.3;flex:1}.gv-g.cur{border-color:#b8984e;background:#231f14}.gv-g.locked{opacity:.5}",
    ".gv-g button,.u15 button,#govPanel button,#relPanel button{font:inherit;font-size:11.5px;padding:3px 8px;border-radius:5px;border:1px solid #4a5560;background:#222a31;color:#e6dcc6;cursor:pointer}",
    ".gv-g button:disabled,.u15 button:disabled,.gv-foot button:disabled,.rl-faith button:disabled,.rl-i button:disabled{opacity:.45;cursor:default}",
    ".gv-slots{display:flex;gap:8px;flex-wrap:wrap}",
    ".gv-slot{width:150px;min-height:58px;border-radius:7px;border:1px dashed #4a5560;padding:6px 8px;display:flex;flex-direction:column;gap:3px;background:#12171c}",
    ".gv-slot .k{font-size:10px;letter-spacing:.08em;text-transform:uppercase}.gv-slot.filled{border-style:solid;cursor:pointer}",
    ".gv-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}",
    ".gv-card{border-radius:6px;padding:6px 8px;border:1px solid #2c343d;background:#171d23;cursor:pointer;display:flex;flex-direction:column;gap:2px}",
    ".gv-card b{font-size:12.5px;color:#f3ead6}.gv-card small{font-size:11px;color:#9aa4ad}.gv-card.on{outline:2px solid #e8c45a}.gv-card.locked{opacity:.38;cursor:default}",
    ".cat-military{border-left:4px solid #c0583a}.cat-economic{border-left:4px solid #d9b040}.cat-diplomatic{border-left:4px solid #4a9ad0}.cat-wild{border-left:4px solid #9a6ad0}",
    ".k.military{color:#e08a6a}.k.economic{color:#e8c45a}.k.diplomatic{color:#7ab8e6}.k.wild{color:#b892ff}",
    ".gv-foot{display:flex;gap:10px;align-items:center;margin-top:10px}.gv-foot .primary{border-color:#b8984e;color:#f6e7bd;background:#2b2414;font-size:13px;padding:5px 14px}",
    ".rl-faith{display:flex;gap:12px;align-items:center;padding:8px 12px;border-radius:7px;background:#1a1626;border:1px solid #4a3a6a}",
    ".rl-bar{flex:1;height:8px;border-radius:4px;background:#2a2438;overflow:hidden}.rl-bar i{display:block;height:100%;background:linear-gradient(90deg,#8a5ad0,#e6d6f2)}",
    ".rl-found{padding:12px 14px;border-radius:8px;background:linear-gradient(160deg,#2a2040,#141a20 70%);border:1px solid #8a6ad0;margin-top:10px}",
    ".rl-found h3{margin:0 0 8px;font-family:Georgia,serif;font-weight:500;font-size:19px;color:#f3e6ff}",
    ".rl-name{display:flex;gap:8px;align-items:center;margin-bottom:8px}.rl-name input{flex:1;font:inherit;font-size:15px;padding:5px 8px;border-radius:5px;border:1px solid #6a5a8a;background:#100c18;color:#f3e6ff;font-family:Georgia,serif}",
    ".rl-sw{display:flex;gap:6px}.rl-sw span{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid #222}.rl-sw span.on{border-color:#fff}",
    ".rl-beliefs{display:grid;grid-template-columns:1fr 1fr;gap:12px}.rl-bl{display:flex;flex-direction:column;gap:4px}",
    ".rl-b{padding:5px 8px;border-radius:5px;border:1px solid #3a3450;background:#16131f;cursor:pointer}.rl-b.on{border-color:#e6d6f2;background:#2c2244}.rl-b.taken{opacity:.35;cursor:default}",
    ".rl-b b{font-size:12.5px;color:#f3e6ff}.rl-b small{display:block;color:#a99cc0;font-size:11px}",
    ".rl-list{display:flex;flex-direction:column;gap:6px}.rl-row{display:flex;gap:10px;align-items:center;padding:7px 10px;border-radius:6px;background:#161a20;border:1px solid #2c343d}",
    ".rl-row .chip{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center}.rl-row .nm{font-family:Georgia,serif;font-size:15px;color:#f3ead6}",
    ".rl-row .mt{flex:1;color:#9aa4ad;font-size:11.5px}.rl-civs{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:3px;font-size:11px;color:#c9d2dc}.rl-civ{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.rl-civ i{display:inline-block;width:9px;height:9px;border-radius:2px;border:1px solid rgba(0,0,0,.5)}.rl-pct{font-weight:700;color:#e6d6f2;font-size:14px}",
    ".rl-ideo{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rl-i{padding:8px 10px;border-radius:7px;border:1px solid #2c343d;background:#151a1f}.rl-i h4{margin:0 0 4px;font-family:Georgia,serif;font-weight:500;font-size:16px}",
    ".rl-i li{font-size:11.5px;color:#9aa4ad}.rl-i li.on{color:#e9e1cf}.rl-i ul{margin:0;padding-left:16px}",
    ".u15{display:contents}.u15 .xp{font-size:11.5px;color:#d9c48a}.u15 .promo{border-color:#b8984e;background:#2b2414;color:#f6e7bd}",
    ".u15 .stars{color:#f2cf3a;letter-spacing:1px}","#unitPanel .up-cargo{white-space:nowrap}",
    ".u15 .promo-row{flex-basis:100%;display:flex;gap:6px;justify-content:center;align-items:stretch;flex-wrap:wrap}.u15 .pr-h{align-self:center;color:#e8c45a;font-size:12px}",
    ".u15 .promo{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:4px 9px !important;max-width:200px;text-align:left}.u15 .promo small{color:#d9c48a;font-size:10.5px;line-height:1.25}",
    "#stratTip{position:fixed;z-index:40;background:rgba(14,18,22,0.97);border:1px solid #3c4652;border-radius:6px;padding:8px 10px;font-size:12px;color:#e9e1cf;pointer-events:none;min-width:220px;max-width:330px}",
    "#stratTip table{border-collapse:collapse;width:100%}#stratTip td{padding:2px 6px}#stratTip td.n{text-align:right;font-variant-numeric:tabular-nums}#stratTip .over{color:#f09a8a;font-weight:700}#stratTip .hd{color:#8fa0ae;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}"
  ].join("\n");

  function ensureDom() {
    if (document.getElementById("govPanel")) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    ["govPanel", "relPanel"].forEach(function (id) { var d = document.createElement("div"); d.id = id; d.className = "hidden"; document.body.appendChild(d); });
    var tip = document.createElement("div"); tip.id = "stratTip"; tip.className = "hidden"; document.body.appendChild(tip);
    document.getElementById("govPanel").addEventListener("click", govClick);
    document.getElementById("relPanel").addEventListener("click", relClick);
    document.getElementById("relPanel").addEventListener("input", function (ev) { if (ev.target.id === "rlName") relDraft.name = ev.target.value; });
  }

  // ------------------------------------------------------------ government
  var govDraft = null;
  function govOpen() { var e = document.getElementById("govPanel"); return !!(e && !e.classList.contains("hidden")); }
  function openGov() { ensureDom(); closeRel(); govDraft = Gov.civ(g(), 0).policies.slice(); document.getElementById("govPanel").classList.remove("hidden"); renderGov(); }
  function closeGov() { var e = document.getElementById("govPanel"); if (e) e.classList.add("hidden"); }
  function toggleGov() { if (govOpen()) closeGov(); else openGov(); }
  function cardHtml(p, on, locked) {
    var P = Gov.POLICIES[p];
    return '<div class="gv-card cat-' + P.cat + (on ? " on" : "") + (locked ? " locked" : "") + '" data-card="' + p + '"><b>' + esc(P.name) + "</b><small>" + esc(P.text) +
      (locked && P.tech ? " · needs " + esc(root.PlanetTech.TECHS[P.tech].name) : "") + "</small></div>";
  }
  function renderGov() {
    var G = g(), c = Gov.civ(G, 0), cur = Gov.GOVS[c.gov], el = document.getElementById("govPanel");
    var avail = Gov.available(G, 0), cards = Gov.cardsAvailable(G, 0);
    var h = '<div class="u15-head"><h2>Government</h2><span class="u15-help">Switching causes ' + Gov.ANARCHY + " turns of anarchy (no gold or science) · cards swap free after " + Gov.SWAP_COOLDOWN + " turns, else for gold · G or Esc closes</span><button type=\"button\" data-x=\"close\">Close</button></div>";
    h += '<div class="gv-cur"><span>' + Icons.svg("ui_government", 40) + '</span><div><div class="nm">' + esc(cur.name) + (c.anarchy > 0 ? ' <span class="gv-an">· Anarchy, ' + c.anarchy + (c.anarchy === 1 ? " turn" : " turns") + " left</span>" : "") + '</div><div class="tx">' + esc(cur.text) + " · war weariness ×" + cur.weary + " · since " + Rules.yearLabel(c.since) + "</div></div></div>";
    h += '<div class="u15-sec">Policy slots</div><div class="gv-slots">';
    var lay = layoutDraft(G, c.gov, govDraft);
    lay.forEach(function (o) {
      h += '<div class="gv-slot cat-' + o.slot + (o.card ? " filled" : "") + '"' + (o.card ? ' data-unslot="' + o.card + '" title="Click to remove"' : "") + '><span class="k ' + o.slot + '">' + Gov.SLOT_NAMES[o.slot] + "</span>" +
        (o.card ? "<b>" + esc(Gov.POLICIES[o.card].name) + "</b><small>" + esc(Gov.POLICIES[o.card].text) + "</small>" : '<small style="color:#5c6670">empty · pick a card below</small>') + "</div>";
    });
    h += "</div>";
    var dry = Gov.setPolicies(G, 0, govDraft, { dry: true });
    var changed = govDraft.join() !== c.policies.join();
    h += '<div class="gv-foot"><button type="button" class="primary" data-x="apply"' + (changed && dry.ok && c.anarchy <= 0 ? "" : " disabled") + ">Apply policies" + (dry.ok && dry.cost ? " (" + dry.cost + " gold)" : changed ? " (free)" : "") + "</button>" +
      (changed ? '<button type="button" data-x="reset">Undo changes</button>' : "") + '<span style="color:#9aa4ad;font-size:11.5px">' + (dry.ok ? "" : esc(dry.reason)) + "</span></div>";
    h += '<div class="u15-sec">Governments</div><div class="gv-list">';
    Gov.GOV_ORDER.forEach(function (id) {
      var gv = Gov.GOVS[id], ok = avail.indexOf(id) !== -1, isCur = id === c.gov;
      var slots = Object.keys(gv.slots).map(function (k) { return gv.slots[k] + " " + Gov.SLOT_NAMES[k].toLowerCase(); }).join(", ");
      h += '<div class="gv-g' + (isCur ? " cur" : "") + (ok ? "" : " locked") + '"><b>' + esc(gv.name) + "</b><small>" + esc(gv.text) + "<br>Slots: " + slots + "</small>" +
        (isCur ? "<small style=\"color:#e8c45a\">Current</small>" : ok ? '<button type="button" data-gov="' + id + '"' + (c.anarchy > 0 ? " disabled" : "") + ">Adopt (" + Gov.ANARCHY + " turns anarchy)</button>" : "<small>Needs " + esc(root.PlanetTech.TECHS[gv.tech].name) + "</small>") + "</div>";
    });
    h += "</div>";
    ["military", "economic", "diplomatic", "wild"].forEach(function (cat) {
      var list = Gov.POLICY_ORDER.filter(function (p) { return Gov.POLICIES[p].cat === cat; });
      h += '<div class="u15-sec">' + Gov.SLOT_NAMES[cat] + ' cards</div><div class="gv-cards">' + list.map(function (p) { return cardHtml(p, govDraft.indexOf(p) !== -1, cards.indexOf(p) === -1); }).join("") + "</div>";
    });
    el.innerHTML = h;
  }
  function layoutDraft(G, gov, list) {
    var out = Gov.slotsOf(gov).map(function (s) { return { slot: s, card: null }; });
    list.forEach(function (p) {
      var i = out.findIndex(function (o) { return !o.card && o.slot === Gov.POLICIES[p].cat; });
      if (i < 0) i = out.findIndex(function (o) { return !o.card && o.slot === "wild"; });
      if (i >= 0) out[i].card = p;
    });
    return out;
  }
  function govClick(ev) {
    var G = g(), c = Gov.civ(G, 0), t;
    if (ev.target.closest("[data-x=close]")) { closeGov(); return; }
    if (ev.target.closest("[data-x=reset]")) { govDraft = c.policies.slice(); renderGov(); return; }
    if (ev.target.closest("[data-x=apply]")) {
      var res = Gov.setPolicies(G, 0, govDraft);
      API.toast(res.ok ? res.text : res.reason);
      if (res.ok) API.changed();
      renderGov(); return;
    }
    if ((t = ev.target.closest("[data-unslot]"))) { var p0 = t.getAttribute("data-unslot"); govDraft = govDraft.filter(function (x) { return x !== p0; }); renderGov(); return; }
    if ((t = ev.target.closest("[data-card]")) && !t.classList.contains("locked")) {
      var p = t.getAttribute("data-card");
      if (govDraft.indexOf(p) !== -1) govDraft = govDraft.filter(function (x) { return x !== p; });
      else {
        var lay = layoutDraft(G, c.gov, govDraft.concat([p]));
        if (lay.some(function (o) { return o.card === p; })) govDraft = govDraft.concat([p]);
        else API.toast("No free " + Gov.SLOT_NAMES[Gov.POLICIES[p].cat].toLowerCase() + " or wildcard slot: remove a card first");
      }
      renderGov(); return;
    }
    if ((t = ev.target.closest("[data-gov]"))) {
      var res2 = Gov.switchGov(G, 0, t.getAttribute("data-gov"));
      API.toast(res2.ok ? res2.text : res2.reason);
      if (res2.ok) { govDraft = c.policies.slice(); API.changed(); }
      renderGov();
    }
  }

  // ------------------------------------------------------------ religion
  var relDraft = { name: null, founder: null, follower: null, color: 0, salt: 0 };
  function relOpen() { var e = document.getElementById("relPanel"); return !!(e && !e.classList.contains("hidden")); }
  function openRel() {
    ensureDom(); closeGov();
    var G = g();
    if (relDraft.name == null) relDraft.name = Rel.suggestName(G, 0, 0);
    if (relDraft.color == null || relDraft.color === 0) relDraft.color = Rel.state(G).list.length % Rel.COLORS.length;
    document.getElementById("relPanel").classList.remove("hidden"); renderRel();
  }
  function closeRel() { var e = document.getElementById("relPanel"); if (e) e.classList.add("hidden"); }
  function toggleRel() { if (relOpen()) closeRel(); else openRel(); }
  function relChip(r, px) { return '<span class="chip" style="background:' + r.color + '33;border:2px solid ' + r.color + '">' + Icons.svg("s_faith", px || 18, { base: "#fff", accent: r.color }) + "</span>"; }
  function renderRel() {
    var G = g(), st = Rel.state(G), me = st.civ[0], el = document.getElementById("relPanel");
    var mine = Rel.founded(G, 0), pending = st.pendingFound.indexOf(0) !== -1;
    var h = '<div class="u15-head"><h2>Faith &amp; Ideology</h2><span class="u15-help">Shrines, Temples, faith wonders and holy sites (next to mountains or anomalies) make faith · L or Esc closes</span><button type="button" data-x="close">Close</button></div>';
    var target = Rel.FOUND_AT, pct = Math.min(100, Math.round(100 * me.faith / target));
    h += '<div class="rl-faith">' + Icons.svg("s_faith", 30) + "<div><b>" + Math.floor(me.faith) + " faith</b> <span style=\"color:#a99cc0\">(+" + me.perTurn + " a turn)</span></div>" +
      (mine ? '<span style="flex:1;color:#c9bfa8">You founded <b>' + esc(mine.name) + "</b></span>" + '<button type="button" data-x="buymis"' + (me.faith >= Rel.BUY_FAITH ? "" : " disabled") + ">Buy a Missionary (" + Rel.BUY_FAITH + " faith)</button>"
        : Rel.slotsLeft(G) > 0 || pending ? '<div class="rl-bar" title="' + me.faith + " / " + target + '"><i style="width:' + pct + '%"></i></div><span style="color:#a99cc0">' + (pending ? "Ready to found!" : Math.floor(me.faith) + " / " + target + " to found a religion") + "</span>"
          : '<span style="flex:1;color:#9aa4ad">All ' + Rel.cap(G) + " religions of this world have been founded</span>") + "</div>";
    if (pending) {
      var fb = Rel.freeBeliefs(G, "founder"), wb = Rel.freeBeliefs(G, "follower");
      if (!relDraft.founder || fb.indexOf(relDraft.founder) === -1) relDraft.founder = fb[0];
      if (!relDraft.follower || wb.indexOf(relDraft.follower) === -1) relDraft.follower = wb[0];
      h += '<div class="rl-found"><h3>A faith is born in ' + esc((Rules.citiesOf(G, 0).filter(function (c) { return c.capital; })[0] || {}).name || "your capital") + "</h3>" +
        '<div class="rl-name"><input id="rlName" maxlength="40" value="' + esc(relDraft.name) + '" aria-label="Religion name"><button type="button" data-x="reroll" title="Another name">↻</button><div class="rl-sw">' +
        Rel.COLORS.map(function (col, i) { return '<span data-col="' + i + '" class="' + (relDraft.color === i ? "on" : "") + '" style="background:' + col + '"></span>'; }).join("") + "</div></div>" +
        '<div class="rl-beliefs"><div class="rl-bl"><div class="u15-sec" style="margin-top:0">Founder belief (yours alone)</div>' +
        Rel.BELIEF_ORDER.filter(function (b) { return Rel.BELIEFS[b].kind === "founder"; }).map(function (b) {
          var tk = fb.indexOf(b) === -1;
          return '<div class="rl-b' + (relDraft.founder === b ? " on" : "") + (tk ? " taken" : "") + '" data-fb="' + b + '"><b>' + esc(Rel.BELIEFS[b].name) + "</b><small>" + esc(Rel.BELIEFS[b].text) + (tk ? " · taken" : "") + "</small></div>";
        }).join("") + '</div><div class="rl-bl"><div class="u15-sec" style="margin-top:0">Follower belief (every city that follows)</div>' +
        Rel.BELIEF_ORDER.filter(function (b) { return Rel.BELIEFS[b].kind === "follower"; }).map(function (b) {
          var tk = wb.indexOf(b) === -1;
          return '<div class="rl-b' + (relDraft.follower === b ? " on" : "") + (tk ? " taken" : "") + '" data-wb="' + b + '"><b>' + esc(Rel.BELIEFS[b].name) + "</b><small>" + esc(Rel.BELIEFS[b].text) + (tk ? " · taken" : "") + "</small></div>";
        }).join("") + '</div></div><div class="gv-foot"><button type="button" class="primary" data-x="found">Found the religion</button></div></div>';
    }
    h += '<div class="u15-sec">Religions of the world (' + st.list.length + " of " + Rel.cap(G) + ")</div>";
    if (!st.list.length) h += '<div style="color:#77818a">No faith has yet been given a name.</div>';
    h += '<div class="rl-list">';
    var known = function (cid) { return cid === 0 || root.PlanetDiplomacy.met(G, 0, cid); };
    st.list.forEach(function (r) {
      var f = Rel.followers(G, r.id), pctR = G.cities.length ? Math.round(100 * f.length / G.cities.length) : 0;
      var holy = Rules.cityById(G, r.holyCity);
      h += '<div class="rl-row">' + relChip(r, 18) + '<div style="display:flex;flex-direction:column;gap:2px;flex:1"><span class="nm">' + esc(r.name) + '</span><span class="mt">Founded ' + Rules.yearLabel(r.turn) + " by " + (known(r.founder) ? esc(Rules.civName(G, r.founder)) : "an unknown people") +
        (holy ? " · holy city " + esc(holy.name) : "") + " · " + esc(Rel.BELIEFS[r.founderBelief].name) + " + " + esc(Rel.BELIEFS[r.followerBelief].name) + " · " + f.length + (f.length === 1 ? " city (" : " cities (") + f.filter(function (c) { return c.owner === 0; }).length + " yours)</span>" + relCivBar(g(), f) + "</div><span class=\"rl-pct\">" + pctR + "%</span></div>";
    });
    h += "</div>";
    var maj = Rel.majority(G, 0);
    if (maj) h += '<div style="margin-top:6px;color:#c9bfa8;font-size:12px">Your empire\'s faith: <b>' + esc(Rel.byId(G, maj.id).name) + "</b> (" + maj.n + " of " + Rules.citiesOf(G, 0).length + " cities" + (maj.weak ? ", not a majority" : "") + ")</div>";
    h += '<div class="u15-sec">Ideology</div>';
    if (me.pendingIdeology || me.ideology) {
      h += '<div class="rl-ideo">' + Rel.IDEO_ORDER.map(function (id) {
        var I = Rel.IDEOLOGIES[id], mineI = me.ideology === id;
        return '<div class="rl-i" style="border-color:' + (mineI ? I.color : "#2c343d") + '"><h4 style="color:' + I.color + '">' + I.name + "</h4><ul>" +
          I.tenets.map(function (t, i) { return '<li class="' + (mineI && i < me.tenets ? "on" : "") + '"><b>' + esc(t[0]) + "</b> " + esc(t[1]) + "</li>"; }).join("") + "</ul>" +
          (me.pendingIdeology ? '<button type="button" data-ideo="' + id + '" style="margin-top:6px">Embrace ' + I.name + "</button>" : "") +
          '<div style="font-size:11px;color:#77818a;margin-top:4px">' + G.civs.map(function (c, i) { return i && known(i) && st.civ[i] && st.civ[i].ideology === id ? esc(Rules.civName(G, i)) : null; }).filter(Boolean).join(", ") + "</div></div>";
      }).join("") + "</div>";
    } else h += '<div style="color:#77818a">Chosen on entering the Industrial era: Freedom, Order or Autonomy (same ideology +2 attitude, rival ideologies −2).</div>';
    el.innerHTML = h;
  }
  function relClick(ev) {
    var G = g(), t;
    if (ev.target.closest("[data-x=close]")) { closeRel(); return; }
    if (ev.target.closest("[data-x=reroll]")) { relDraft.salt++; relDraft.name = Rel.suggestName(G, 0, relDraft.salt); renderRel(); return; }
    if ((t = ev.target.closest("[data-col]"))) { relDraft.color = +t.getAttribute("data-col"); renderRel(); return; }
    if ((t = ev.target.closest("[data-fb]")) && !t.classList.contains("taken")) { relDraft.founder = t.getAttribute("data-fb"); renderRel(); return; }
    if ((t = ev.target.closest("[data-wb]")) && !t.classList.contains("taken")) { relDraft.follower = t.getAttribute("data-wb"); renderRel(); return; }
    if (ev.target.closest("[data-x=found]")) {
      var res = Rel.found(G, 0, { name: relDraft.name, founder: relDraft.founder, follower: relDraft.follower, color: relDraft.color });
      API.toast(res.ok ? res.text : res.reason);
      if (res.ok) API.changed();
      renderRel(); return;
    }
    if (ev.target.closest("[data-x=buymis]")) {
      var r = Rel.founded(G, 0), c = Rules.citiesOf(G, 0).filter(function (x) { return r && x.rel === r.id; })[0];
      var res2 = c ? Rel.buyMissionary(G, c.id) : { ok: false, reason: "No city follows your religion" };
      API.toast(res2.ok ? res2.text : res2.reason);
      if (res2.ok) API.changed();
      renderRel(); return;
    }
    if ((t = ev.target.closest("[data-ideo]"))) {
      var res3 = Rel.chooseIdeology(G, 0, t.getAttribute("data-ideo"));
      API.toast(res3.ok ? res3.text : res3.reason);
      if (res3.ok) API.changed();
      renderRel();
    }
  }

  // ------------------------------------------------------------ unit panel
  function stars(n) { var s = ""; for (var i = 0; i < n; i++) s += "★"; return s; }
  function unitHtml(G, u) {
    var h = '<span class="u15">', t = T(u.type);
    if (Promo.classOf(u.type)) {
      var lvl = Promo.level(u);
      h += '<span class="xp">' + (lvl ? '<span class="stars">' + stars(lvl) + "</span> " : "") + "XP " + (u.xp || 0) + (lvl < Promo.LEVELS.length ? " / " + Promo.nextAt(u) : "") +
        (lvl ? " · " + u.promos.map(function (p) { return Promo.PROMOS[p].name; }).join(", ") : "") + "</span>";
      if (Promo.ready(u)) {
        h += '<div class="promo-row"><span class="pr-h">Promotion ready · choose one:</span>';
        Promo.options(u).forEach(function (p) {
          h += '<button type="button" class="promo" data-promo="' + p + '" title="' + esc(Promo.PROMOS[p].text) + '"><b>★ ' + esc(Promo.PROMOS[p].name) + "</b><small>" + esc(Promo.PROMOS[p].text) + "</small></button>";
        });
        h += "</div>";
      }
    }
    if (Strat && Strat.overLimit(G, u)) h += '<span class="up-note" style="color:#f09a8a">No ' + esc(root.PlanetGen.RESOURCES[Strat.NEEDS[u.type]].name) + " to supply it: −50% strength</span>";
    if (t.air) {
      h += '<span class="up-moves">strike ' + t.strike + " · air " + t.dogfight + " · range " + Air.rangeOf(u) + (u.patrol ? " · on patrol" : "") + "</span>" +
        '<button type="button" data-air="strike"' + (u.moves > 0 ? "" : " disabled") + ">Strike <kbd>A</kbd></button>" +
        '<button type="button" data-air="rebase"' + (u.moves > 0 ? "" : " disabled") + ">Rebase <kbd>Q</kbd></button>" +
        '<button type="button" data-air="patrol"' + (u.patrol || u.moves <= 0 ? " disabled" : "") + ">Intercept patrol <kbd>P</kbd></button>";
    } else if (u.type === "missionary") {
      var tg = Rel.missionaryTargets(G, u);
      h += '<span class="up-cargo">' + (u.charges == null ? 2 : u.charges) + " charges" + (u.relId ? " · " + esc((Rel.byId(G, u.relId) || {}).name || "") : "") + "</span>";
      tg.forEach(function (c) { h += '<button type="button" data-spread="' + c.id + '"' + (u.moves > 0 ? "" : " disabled") + ">Spread in " + esc(c.name) + "</button>"; });
      if (!tg.length) h += '<span class="up-note">Move next to a city that doesn\'t follow your faith</span>';
    }
    var PL = root.PlanetPillage, cp = PL && u.owner === 0 ? PL.canPillage(G, u) : null;
    if (cp && cp.ok) h += '<button type="button" data-pill="1" class="promo">Pillage ' + (cp.imp || "road") + ' <kbd>P</kbd></button>';
    if (!t.air) {
      if (u.goto) h += '<span class="up-cargo">Moving to ' + u.goto.q + "," + u.goto.r + ((u.goto.queue || []).length ? " (+" + u.goto.queue.length + " waypoints)" : "") + '</span><button type="button" data-ord="cancel">Stop <kbd>X</kbd></button>';
      else {
        if (u.order === "sentry") h += '<button type="button" data-ord="cancel">Wake</button>';
        else h += '<button type="button" data-ord="sentry" title="Sleep until an enemy comes near · click a far tile for a multi-turn move (Shift+click adds waypoints)">Sentry <kbd>S</kbd></button>';
        if (u.order === "explore") h += '<button type="button" data-ord="cancel">Stop exploring</button>';
        else if (!t.worker && !t.caravan && !t.canFound) h += '<button type="button" data-ord="explore">Explore <kbd>E</kbd></button>';
      }
    }
    return h + "</span>";
  }
  function unitClick(ev, u) {
    var G = g(), t;
    if (!u) return false;
    if ((t = ev.target.closest("[data-promo]"))) { var r = Promo.pick(G, u.id, t.getAttribute("data-promo")); API.toast(r.ok ? r.text : r.reason); API.changed(); return true; }
    if ((t = ev.target.closest("[data-air]"))) { airAction(t.getAttribute("data-air"), u); return true; }
    if ((t = ev.target.closest("[data-spread]"))) { var r2 = Rel.spreadWith(G, u.id, +t.getAttribute("data-spread")); API.toast(r2.ok ? r2.text : r2.reason); API.changed(); return true; }
    if (ev.target.closest("[data-pill]")) { pillageAction(u); return true; }
    if ((t = ev.target.closest("[data-ord]"))) { order(t.getAttribute("data-ord"), u); return true; }
    return false;
  }
  function order(kind, u) {
    var G = g();
    if (kind === "cancel") { Orders.cancel(G, u.id); API.toast("Orders cancelled"); }
    else { Orders.setOrder(G, u.id, kind); API.toast(kind === "sentry" ? "Sentry: wakes when an enemy comes near" : "Exploring"); }
    API.changed();
  }
  function pillageAction(u) {
    var r = root.PlanetPillage.pillage(g(), u.id);
    API.toast(r.ok ? r.text : r.reason); API.changed(true);
    return r.ok;
  }
  // Scorched tiles: ash patch with a broken-cross mark.
  function drawPillaged(ctx, hexToPixel, zoom, HEX, game, known) {
    var PL = root.PlanetPillage;
    if (!PL || !game.pillage) return;
    Object.keys(game.pillage.tiles).forEach(function (k) {
      if (!known(k)) return;
      var t = game.index.get(k); if (!t) return;
      var p = hexToPixel(t.q, t.r);
      ctx.save();
      var gr = ctx.createRadialGradient(p[0], p[1] + HEX * 0.25, 0, p[0], p[1] + HEX * 0.25, HEX * 0.62);
      gr.addColorStop(0, "rgba(20, 14, 10, 0.62)"); gr.addColorStop(1, "rgba(20, 14, 10, 0)");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p[0], p[1] + HEX * 0.25, HEX * 0.62, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(240, 120, 60, 0.9)"; ctx.lineWidth = Math.max(1.4 / zoom, HEX * 0.06); ctx.lineCap = "round";
      var x = p[0] + HEX * 0.36, y = p[1] + HEX * 0.42, a = HEX * 0.13;
      ctx.beginPath(); ctx.moveTo(x - a, y - a); ctx.lineTo(x + a, y + a); ctx.moveTo(x + a, y - a); ctx.lineTo(x - a * 0.2, y + a * 0.2); ctx.stroke();
      ctx.restore();
    });
  }
  // Smoke column with flickering flames (pillage) or a burst of coins (plunder).
  function drawPillageFx(ctx, f, t, hexToPixel, zoom, HEX) {
    var p = hexToPixel(f.q, f.r);
    ctx.save();
    for (var i = 0; i < 7; i++) {
      var k = (t * 1.3 + i / 7) % 1, a = (1 - k) * 0.55 * Math.min(1, (1 - t) * 3);
      var x = p[0] - HEX * 0.3 + Math.sin(i * 2.1 + t * 4) * HEX * 0.22 * k + k * HEX * 0.25, y = p[1] - HEX * 0.35 - k * HEX * 1.4;
      ctx.fillStyle = "rgba(52, 46, 42," + Math.min(0.8, a * 1.4) + ")";
      ctx.beginPath(); ctx.arc(x, y, HEX * (0.2 + k * 0.42), 0, Math.PI * 2); ctx.fill();
    }
    var fl = Math.max(0, 1 - t * 1.4);
    if (fl > 0) {
      for (var j = 0; j < 4; j++) {
        var fx = p[0] - HEX * 0.42 + j * HEX * 0.13, h = HEX * (0.4 + 0.2 * Math.sin(t * 30 + j * 1.7)) * fl, by = p[1] + HEX * 0.05;
        ctx.fillStyle = j % 2 ? "rgba(255, 204, 80, 0.95)" : "rgba(238, 96, 38, 0.95)";
        ctx.beginPath(); ctx.moveTo(fx - HEX * 0.11, by); ctx.quadraticCurveTo(fx - HEX * 0.02, by - h * 1.7, fx + HEX * 0.11, by); ctx.fill();
      }
    }
    if (f.kind === "plunder") {
      for (var c = 0; c < 6; c++) {
        var ang = c * 1.05 + 0.3, d = t * HEX * 0.9;
        ctx.fillStyle = "rgba(242, 207, 58," + (1 - t) + ")"; ctx.strokeStyle = "rgba(90, 60, 10," + (1 - t) + ")"; ctx.lineWidth = HEX * 0.02;
        ctx.beginPath(); ctx.arc(p[0] + Math.cos(ang) * d, p[1] - HEX * 0.3 + Math.sin(ang) * d - t * HEX * 0.4, HEX * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // Followers per civ: a coloured chip for each civ with its city count.
  function relCivBar(game, f) {
    var by = {};
    f.forEach(function (c) { by[c.owner] = (by[c.owner] || 0) + 1; });
    var ids = Object.keys(by).map(Number).sort(function (a, b) { return by[b] - by[a] || a - b; });
    if (!ids.length) return "";
    return '<span class="rl-civs">' + ids.map(function (id) {
      var d = game.civs[id].design || {}, col = d.primary || "#999";
      return '<span class="rl-civ"><i style="background:' + esc(String(col)) + '"></i>' + esc(Rules.civName(game, id)) + " " + by[id] + "</span>";
    }).join("") + "</span>";
  }
  var mode = { air: null };
  function airAction(kind, u) {
    var G = g();
    if (kind === "patrol") { var r = Air.patrol(G, u.id); API.toast(r.ok ? r.text : r.reason); API.changed(); return; }
    mode.air = { kind: kind, unit: u.id };
    API.setTargets(kind === "strike" ? Air.strikeTargets(G, u) : Air.baseTargets(G, u));
    API.toast(kind === "strike" ? "Strike: click a highlighted target (Esc cancels)" : "Rebase: click a highlighted city or carrier");
  }
  // A map click while an air mode is on. Returns true if handled.
  function mapClick(tile) {
    if (!mode.air) return false;
    var G = g(), m = mode.air; mode.air = null;
    API.setTargets([]);
    var r = m.kind === "strike" ? Air.strike(G, m.unit, tile.q, tile.r) : Air.rebase(G, m.unit, tile.q, tile.r);
    API.toast(r.ok ? (r.events ? r.events.map(function (e) { return e.text; }).join(" · ") : r.text) : r.reason);
    API.changed(true);
    return true;
  }
  function cancelMode() { if (!mode.air) return false; mode.air = null; API.setTargets([]); return true; }

  // ------------------------------------------------------------ map drawing
  // Star pips (promotions), a ready glow, and order glyphs on a unit token.
  function badge(ctx, u, x, y, rad, zoom) {
    var lvl = u.promos ? u.promos.length : 0;
    if (lvl) {
      var s = Math.max(rad * 0.46, 5.5 / zoom);
      for (var i = 0; i < lvl; i++) {
        var sx = x - (lvl - 1) * s * 0.55 + i * s * 1.1, sy = y - rad - s * 0.3;
        star(ctx, sx, sy, s * 0.62, "#f2cf3a", Math.max(0.8 / zoom, s * 0.12));
      }
    }
    if (u.owner === 0 && Promo.ready(u)) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x + rad * 0.78, y - rad * 0.72, Math.max(rad * 0.32, 4 / zoom), 0, Math.PI * 2);
      ctx.fillStyle = "#f2cf3a"; ctx.fill(); ctx.lineWidth = Math.max(1 / zoom, rad * 0.06); ctx.strokeStyle = "#3a2a00"; ctx.stroke();
      ctx.fillStyle = "#3a2a00"; ctx.font = "800 " + Math.max(rad * 0.5, 6 / zoom) + "px Helvetica,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("+", x + rad * 0.78, y - rad * 0.7);
      ctx.restore();
    }
    var glyph = u.goto ? "\u2192" : u.order === "sentry" ? "z" : u.order === "explore" ? "?" : u.patrol ? "\u21BA" : null;
    if (glyph && u.owner === 0) {
      ctx.save();
      var gx = x + rad * 0.85, gy = y + rad * 0.62, gr = Math.max(rad * 0.3, 4 / zoom);
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fillStyle = "rgba(20,24,30,0.9)"; ctx.fill();
      ctx.fillStyle = "#cfe6f0"; ctx.font = "800 " + gr * 1.5 + "px Helvetica,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(glyph, gx, gy + gr * 0.05);
      ctx.restore();
    }
  }
  function star(ctx, x, y, r, fill, lw) {
    ctx.save(); ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = "#2a1e00"; ctx.stroke(); ctx.restore();
  }
  // Goto path with turn numbers where each turn ends.
  var planCache = { key: null, plan: null };
  function planFor(G, u, q, r) {
    var k = u.id + ":" + u.q + "," + u.r + ":" + u.moves + "->" + q + "," + r + ":" + G.turn;
    if (planCache.key !== k) { planCache.key = k; planCache.plan = Orders.plan(G, u, q, r); }
    return planCache.plan;
  }
  function drawPath(ctx, hexToPixel, plan, zoom, color, HEX) {
    if (!plan || plan.path.length < 2) return;
    ctx.save();
    ctx.lineWidth = Math.max(2.5 / zoom, HEX * 0.08); ctx.strokeStyle = color; ctx.setLineDash([HEX * 0.25, HEX * 0.15]); ctx.lineCap = "round";
    ctx.beginPath();
    plan.path.forEach(function (p, i) { var px = hexToPixel(p.q, p.r); if (i) ctx.lineTo(px[0], px[1]); else ctx.moveTo(px[0], px[1]); });
    ctx.stroke(); ctx.setLineDash([]);
    for (var i = 1; i < plan.path.length; i++) {
      var p = plan.path[i], nx = plan.path[i + 1];
      if (nx && nx.turn === p.turn) continue;
      var px = hexToPixel(p.q, p.r), rr = Math.max(HEX * 0.24, 7 / zoom);
      ctx.beginPath(); ctx.arc(px[0], px[1], rr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(16,20,26,0.92)"; ctx.fill(); ctx.lineWidth = Math.max(1.4 / zoom, HEX * 0.04); ctx.strokeStyle = color; ctx.stroke();
      ctx.fillStyle = "#fff8e6"; ctx.font = "800 " + rr * 1.15 + "px Helvetica,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(p.turn + 1), px[0], px[1] + rr * 0.06);
    }
    ctx.restore();
  }
  function drawGoto(ctx, hexToPixel, zoom, sel, hover, reach, HEX) {
    var G = g();
    if (!G || !sel || sel.owner !== 0 || T(sel.type).air) return;
    if (sel.goto) drawPath(ctx, hexToPixel, planFor(G, sel, sel.goto.q, sel.goto.r), zoom, "rgba(140, 200, 255, 0.95)", HEX);
    if (hover && !(hover.q === sel.q && hover.r === sel.r) && !(reach && reach.has(Rules.key(hover.q, hover.r))) && G.civs[0].revealed.has(Rules.key(hover.q, hover.r))) {
      var pl = planFor(G, sel, hover.q, hover.r);
      if (pl) drawPath(ctx, hexToPixel, pl, zoom, "rgba(255, 236, 170, 0.95)", HEX);
    }
  }
  // Click on a far tile with a unit selected: multi-turn goto.
  function gotoClick(sel, tile, shift) {
    var G = g();
    if (!sel || sel.owner !== 0 || T(sel.type).air) return false;
    if (!G.civs[0].revealed.has(Rules.key(tile.q, tile.r))) return false;
    var r = Orders.setGoto(G, sel.id, tile.q, tile.r, shift);
    if (!r.ok) return false;
    API.toast(r.queued ? "Waypoint added" : r.text);
    API.changed();
    return true;
  }

  // Air flyover: the plane crosses from base to target with a ground shadow.
  function drawAirFx(ctx, f, t, hexToPixel, zoom, HEX, colorsFor) {
    var a = hexToPixel(f.from.q, f.from.r), b = hexToPixel(f.to.q, f.to.r);
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    // Out and back for strikes; one way for a rebase. Shot down: falls after the target.
    var s = f.rebase ? t : (t < 0.55 ? t / 0.55 : 1 - (t - 0.55) / 0.45);
    if (f.shot && t > 0.5) s = 1;
    var x = a[0] + dx * s, y = a[1] + dy * s;
    var alt = HEX * (0.9 + 0.5 * Math.sin(Math.PI * s));
    var dir = f.rebase || t < 0.55 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);
    var size = Math.max(HEX * 1.5, 26 / zoom);
    var C = colorsFor(f.owner || 0);
    ctx.save();
    // Shadow on the ground, offset by altitude.
    ctx.globalAlpha = 0.38;
    ctx.translate(x + alt * 0.55, y + alt * 0.35); ctx.rotate(dir + Math.PI / 2);
    Icons.draw(ctx, Icons.unitIcon(f.type), 0, 0, size * 0.85, zoom, { base: "#000", accent: "#000", dark: "#000", light: "#000" });
    ctx.restore();
    ctx.save();
    if (f.shot && t > 0.5) { ctx.globalAlpha = Math.max(0, 1 - (t - 0.5) * 2); y += (t - 0.5) * HEX * 2; }
    ctx.translate(x, y - alt * 0.4); ctx.rotate(dir + Math.PI / 2);
    // Dark outline pass, then the civ-coloured plane.
    var ol = Math.max(1.2 / zoom, size * 0.05);
    [[-ol, 0], [ol, 0], [0, -ol], [0, ol]].forEach(function (o) {
      Icons.draw(ctx, Icons.unitIcon(f.type), o[0], o[1], size, zoom, { base: C.dark, accent: C.dark, dark: C.dark, light: C.dark });
    });
    Icons.draw(ctx, Icons.unitIcon(f.type), 0, 0, size, zoom, { base: C.fill, accent: C.ring, dark: C.dark, light: C.ring });
    ctx.restore();
    // Contrail.
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = Math.max(1.5 / zoom, HEX * 0.05); ctx.setLineDash([HEX * 0.12, HEX * 0.1]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1] - HEX * 0.36); ctx.lineTo(x, y - alt * 0.4); ctx.stroke();
    ctx.restore();
    if (f.intercepted && t > 0.3 && t < 0.55) {
      ctx.save(); ctx.fillStyle = "rgba(255,200,90," + (0.8 - (t - 0.3) * 3) + ")";
      for (var i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 1.3) * HEX * 0.4, y - alt * 0.4 + Math.sin(i * 1.7) * HEX * 0.3, HEX * 0.08, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }

  // Religion icon next to a city plate (screen space).
  function cityRelIcon(ctx, G, city, x, y, s) {
    if (!city.rel || !G.religion) return;
    var r = Rel.byId(G, city.rel);
    if (!r) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, s * 0.62, 0, Math.PI * 2); ctx.fillStyle = "rgba(16,14,22,0.9)"; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = r.color; ctx.stroke();
    Icons.draw(ctx, "s_faith", x, y, s * 0.95, 1, { base: "#fff", accent: r.color });
    ctx.restore();
  }

  // Strategic resources tooltip (top bar).
  function stratHtml(G) {
    var rows = Strat.report(G, 0);
    var h = '<div class="hd">Strategic resources · used / supply</div><table>';
    rows.forEach(function (x) {
      h += "<tr><td>" + Icons.svg(x.res, 16) + "</td><td>" + esc(x.name) + '</td><td class="n' + (x.over ? " over" : "") + '">' + x.used + " / " + x.supply + "</td><td>" + (x.over ? '<span class="over">' + x.over + " over (−50%)</span>" : x.supply - x.used > 0 ? "<small>" + (x.supply - x.used) + " free</small>" : "") + "</td></tr>";
    });
    var hidden = Strat.STRATEGIC.filter(function (r) { return !Strat.visible(G, r, 0); }).map(function (r) { return root.PlanetGen.RESOURCES[r].name + " (" + root.PlanetTech.TECHS[Strat.REVEAL[r]].name + ")"; });
    h += "</table>";
    if (hidden.length) h += '<div style="color:#77818a;font-size:11px;margin-top:4px">Not yet revealed: ' + esc(hidden.join(", ")) + "</div>";
    h += '<div style="color:#77818a;font-size:11px;margin-top:4px">Each improved source in your borders supplies ' + Strat.PER_SOURCE + " units (" + Strat.PER_UNIMPROVED + " unimproved); trade spares in Diplomacy.</div>";
    return h;
  }
  function showStrat(anchor) {
    ensureDom();
    var el = document.getElementById("stratTip"), r = anchor.getBoundingClientRect();
    el.innerHTML = stratHtml(g());
    el.classList.remove("hidden");
    el.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.left - 80)) + "px";
    el.style.top = (r.bottom + 6) + "px";
  }
  function hideStrat() { var el = document.getElementById("stratTip"); if (el) el.classList.add("hidden"); }

  function init(api) { API = api; ensureDom(); }
  function anyOpen() { return govOpen() || relOpen(); }
  function closeAll() { var o = anyOpen(); closeGov(); closeRel(); return o; }
  function refresh() { if (govOpen()) renderGov(); if (relOpen()) renderRel(); }

  root.PlanetUI15 = {
    init: init, toggleGov: toggleGov, openGov: openGov, closeGov: closeGov, govOpen: govOpen, toggleRel: toggleRel, openRel: openRel, closeRel: closeRel, relOpen: relOpen,
    anyOpen: anyOpen, closeAll: closeAll, refresh: refresh, unitHtml: unitHtml, unitClick: unitClick, airAction: airAction, order: order, mapClick: mapClick,
    cancelMode: cancelMode, mode: mode, badge: badge, drawGoto: drawGoto, gotoClick: gotoClick, drawAirFx: drawAirFx, cityRelIcon: cityRelIcon,
    showStrat: showStrat, pillageAction: pillageAction, drawPillaged: drawPillaged, drawPillageFx: drawPillageFx, hideStrat: hideStrat, stratHtml: stratHtml, relDraft: relDraft
  };
})(typeof window !== "undefined" ? window : globalThis);
