/* board.js — the seating board, DOM-only.
 *
 * Ported from the standalone B100-seating-board.html with the geometry and
 * interaction model intact. Two deliberate changes:
 *   1. It mounts into a container instead of owning <body>, so a React host can
 *      wrap it.
 *   2. Every mutation still funnels through render(), but render() now also
 *      notifies the host (hooks.onMutate) so persistence has exactly one
 *      hook point — see the handoff's "single mutation sink".
 *
 * The board never talks to Supabase itself. The host owns all I/O.
 */

import { BASIS_LABEL, LAYOUT_VERSION, buildGroups } from "./basis.js";

var MARKUP = [
  '<header class="titleblock">',
  '  <div>',
  '    <div class="eyebrow" data-el="eyebrow"></div>',
  '    <h1 data-el="title">B100 Office Infill &mdash; Seating</h1>',
  '    <div class="sub">Drawn to scale from the plan set. Drag a name into a room, or click a name then click a room.</div>',
  '  </div>',
  '  <div class="tally" data-el="tally"></div>',
  '  <div class="toolbar">',
  '    <div class="sync" data-el="sync" data-state="idle" role="status" aria-live="polite"><i class="dot"></i><span data-el="sync-text">Starting</span></div>',
  '    <div class="zoom">',
  '      <span class="eyebrow">Scale</span>',
  '      <input type="range" data-el="ppf" min="7" max="20" step="1" value="11" aria-label="Drawing scale, pixels per foot">',
  '      <span class="eyebrow" data-el="ppf-out">11 px/ft</span>',
  '    </div>',
  '    <button class="primary" data-el="btn-names">Add names</button>',
  '    <button data-el="btn-space">Add space</button>',
  '    <button data-el="btn-reload">Reload</button>',
  '    <button data-el="btn-hide">Hide roster</button>',
  '    <button data-el="btn-csv">Export CSV</button>',
  '    <button data-el="btn-json">Save file</button>',
  '    <button data-el="btn-load">Open file</button>',
  '    <button data-el="btn-print">Print</button>',
  '    <button data-el="btn-whoami" title="Used to label who changed what. Not a login.">Who am I?</button>',
  '    <input type="file" data-el="file-in" accept=".json" hidden>',
  '  </div>',
  '</header>',
  '<div class="shell" data-el="shell">',
  '  <aside class="roster">',
  '    <h2>Roster</h2>',
  '    <div class="tabs" role="tablist">',
  '      <button role="tab" data-el="tab-unplaced" aria-selected="true">Unplaced</button>',
  '      <button role="tab" data-el="tab-all" aria-selected="false">Everyone</button>',
  '    </div>',
  '    <input type="text" data-el="search" placeholder="Find a name">',
  '    <div class="pool" data-el="pool" aria-label="Unplaced names — drop here to take someone out of a room"></div>',
  '  </aside>',
  '  <main class="plan" data-el="plan"></main>',
  '</div>',
  '<dialog data-el="dlg-names">',
  '  <form method="dialog" class="dlg-body">',
  '    <h4>Add names</h4>',
  '    <p>One per line, or separated by commas. Add a department after a comma or tab &mdash; <em>Casey Tingley, Maintenance</em> &mdash; and it shows on the chip. Names already on the roster are skipped.</p>',
  '    <textarea data-el="names-in" rows="9" placeholder="Casey Tingley, Maintenance&#10;Travis Spooner, Flight Ops&#10;Ted Rawlings"></textarea>',
  '  </form>',
  '  <div class="dlg-foot">',
  '    <button value="cancel" data-close="dlg-names">Cancel</button>',
  '    <button class="primary" data-el="names-save">Add to roster</button>',
  '  </div>',
  '</dialog>',
  '<dialog data-el="dlg-space">',
  '  <form method="dialog" class="dlg-body">',
  '    <h4>Add a space</h4>',
  '    <p>Stands up a building or floor before its plans are loaded. Area sets the drawn width against the depth below.</p>',
  '    <div class="dlg-row">',
  '      <label>Site<input type="text" data-el="sp-site" placeholder="903 Langley Rd, Red Bluff"></label>',
  '    </div>',
  '    <div class="dlg-row">',
  '      <label>Building<input type="text" data-el="sp-bldg" value="B100"></label>',
  '      <label>Floor<input type="text" data-el="sp-floor" value="1st Floor"></label>',
  '    </div>',
  '    <div class="dlg-row">',
  '      <label>Room no.<input type="text" data-el="sp-code" placeholder="112"></label>',
  '      <label>Name<input type="text" data-el="sp-name" placeholder="Office"></label>',
  '    </div>',
  '    <div class="dlg-row">',
  '      <label>Area (sf)<input type="text" data-el="sp-sf" placeholder="117"></label>',
  '      <label>Seats<input type="text" data-el="sp-cap" value="2"></label>',
  '    </div>',
  '    <div class="dlg-row">',
  '      <label>Depth (ft)<input type="text" data-el="sp-depth" placeholder="14"></label>',
  '      <label>Overall (ft)<input type="text" data-el="sp-overall" placeholder="145"></label>',
  '    </div>',
  '  </form>',
  '  <div class="dlg-foot">',
  '    <button value="cancel" data-close="dlg-space">Cancel</button>',
  '    <button class="primary" data-el="space-save">Add space</button>',
  '  </div>',
  '</dialog>',
].join("\n");

export function mountBoard(container, hooks) {
  hooks = hooks || {};
  var notify = hooks.onMutate || function () {};

  container.classList.add("board-root");
  container.innerHTML = MARKUP;
  function $(name) { return container.querySelector('[data-el="' + name + '"]'); }

  var uid = 0;
  function nextId(p) { uid += 1; return p + uid; }

  var state = {
    ppf: 11,
    groups: buildGroups(nextId),
    people: [],
    view: "unplaced",
    filter: "",
    selected: null,
    rev: 0,
  };

  /* ===================== HELPERS ===================== */
  function allRooms() {
    var out = [];
    state.groups.forEach(function (g) {
      g.items.forEach(function (it) { if (it.kind === "room") out.push({ room: it, group: g }); });
    });
    return out;
  }
  function occupants(id) { return state.people.filter(function (p) { return p.roomId === id; }); }
  function labelFor(id) {
    var hit = null;
    allRooms().forEach(function (x) { if (x.room.id === id) hit = x.room; });
    if (!hit) return "";
    return hit.code !== "—" ? hit.code : hit.name;
  }
  function px(ft) { return Math.round(ft * state.ppf); }

  /* Feet as feet-and-inches, for the tie-out readouts. */
  function ftIn(v) {
    var whole = Math.floor(v);
    var inches = Math.round((v - whole) * 12);
    if (inches === 12) { whole += 1; inches = 0; }
    return whole + "'-" + inches + '"';
  }

  /* "Casey Tingley, Maintenance" -> {name, dept}. Department is optional and
     stays optional: no roster has arrived yet, so nothing depends on it. */
  function parseEntry(chunk) {
    var parts = chunk.split(/\t|,/);
    var name = (parts.shift() || "").trim().replace(/\s+/g, " ");
    var dept = parts.join(" ").trim().replace(/\s+/g, " ");
    return { name: name, dept: dept };
  }

  function addPeople(raw) {
    var added = [];
    raw.split(/[\n;]+/).forEach(function (line) {
      if (!line.trim()) return;
      var e = parseEntry(line);
      if (!e.name) return;
      var dup = state.people.some(function (p) { return p.name.toLowerCase() === e.name.toLowerCase(); });
      if (dup) return;
      var person = { id: nextId("p"), name: e.name, dept: e.dept || "", roomId: null };
      state.people.push(person);
      added.push(person);
    });
    return added;
  }

  /* A stable-ish hue per department, so chips read as groups at a glance. */
  function deptColor(dept) {
    if (!dept) return "";
    var h = 0;
    for (var i = 0; i < dept.length; i++) h = (h * 31 + dept.charCodeAt(i)) % 360;
    return "hsl(" + h + ",52%,42%)";
  }

  function place(personId, roomId) {
    var hit = null;
    state.people.forEach(function (p) { if (p.id === personId) { p.roomId = roomId; hit = p; } });
    state.selected = null;
    render();
    if (hit) notify({ kind: "assignment", person: hit });
  }

  /* ===================== RENDER ===================== */
  function render() { renderTally(); renderPool(); renderPlan(); }

  function renderTally() {
    var placed = state.people.filter(function (p) { return p.roomId; }).length;
    var unplaced = state.people.length - placed;
    var seats = 0, over = 0;
    allRooms().forEach(function (x) {
      seats += x.room.cap;
      if (occupants(x.room.id).length > x.room.cap) over += 1;
    });
    var cells = [
      ["On roster", state.people.length, false],
      ["Placed", placed, false],
      ["Unplaced", unplaced, unplaced > 0],
      ["Seats", seats, false],
      ["Over seats", over, over > 0],
    ];
    $("tally").innerHTML = cells.map(function (c) {
      return '<div class="' + (c[2] ? "flagged" : "") + '"><span class="n">' + c[1] +
             '</span><span class="eyebrow">' + c[0] + "</span></div>";
    }).join("");
  }

  function personChip(p, opts) {
    var el = document.createElement("div");
    el.className = "chip" + (state.selected === p.id ? " is-selected" : "");
    el.draggable = true; el.tabIndex = 0;
    el.dataset.person = p.id;
    el.dataset.placed = p.roomId ? "yes" : "no";
    el.title = p.name + (p.dept ? " · " + p.dept : "");
    if (p.dept) el.style.borderLeftColor = deptColor(p.dept);

    var nm = document.createElement("span");
    nm.className = "nm"; nm.textContent = p.name;
    el.appendChild(nm);

    if (p.dept && opts.showDept) {
      var d = document.createElement("span");
      d.className = "dept"; d.textContent = p.dept;
      el.appendChild(d);
    }
    if (opts.showWhere && p.roomId) {
      var w = document.createElement("span");
      w.className = "where"; w.textContent = labelFor(p.roomId);
      el.appendChild(w);
    }
    if (opts.removable) {
      var x = document.createElement("button");
      x.className = "drop-x"; x.type = "button";
      x.setAttribute("aria-label", "Take " + p.name + " out of this room");
      x.textContent = "×";
      x.addEventListener("click", function (ev) { ev.stopPropagation(); place(p.id, null); });
      el.appendChild(x);
    }
    el.addEventListener("dragstart", function (ev) {
      ev.dataTransfer.setData("text/plain", p.id);
      ev.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("click", function () {
      state.selected = state.selected === p.id ? null : p.id;
      render();
    });
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); el.click(); }
    });
    return el;
  }

  function renderPool() {
    var pool = $("pool");
    pool.innerHTML = "";
    $("tab-unplaced").setAttribute("aria-selected", state.view === "unplaced");
    $("tab-all").setAttribute("aria-selected", state.view === "all");

    var list = state.people.filter(function (p) {
      if (state.view === "unplaced" && p.roomId) return false;
      if (state.filter) {
        var hay = (p.name + " " + (p.dept || "")).toLowerCase();
        if (hay.indexOf(state.filter) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    if (state.people.length === 0) {
      pool.innerHTML = '<div class="empty">No names yet. Choose <strong>Add names</strong> to paste the list.</div>';
      return;
    }
    if (list.length === 0) {
      pool.innerHTML = '<div class="empty">' + (state.filter ? "No match for that name." : "Everyone has a room.") + "</div>";
      return;
    }
    list.forEach(function (p) {
      pool.appendChild(personChip(p, { showWhere: state.view === "all", showDept: true, removable: false }));
    });
  }

  /* Groups are drawn per building so a second building brings its own
     footprint, ruler and overall dimension rather than borrowing B100's. */
  function buildingsOf(groups) {
    var order = [], byKey = {};
    groups.forEach(function (g) {
      var key = (g.site || "") + "|" + g.building;
      if (!byKey[key]) { byKey[key] = { site: g.site || "", building: g.building, groups: [] }; order.push(byKey[key]); }
      byKey[key].groups.push(g);
    });
    return order;
  }

  function renderPlan() {
    var plan = $("plan");
    plan.innerHTML = "";

    var widest = 0;
    state.groups.forEach(function (g) { widest = Math.max(widest, g.overallFt || 145); });

    var canvas = document.createElement("div");
    canvas.className = "canvas";
    canvas.style.width = px(widest) + 160 + "px";

    buildingsOf(state.groups).forEach(function (b) {
      var bOverall = 0, hangarLabel = "";
      b.groups.forEach(function (g) {
        bOverall = Math.max(bOverall, g.overallFt || 145);
        if (!hangarLabel && g.hangarLabel) hangarLabel = g.hangarLabel;
      });

      b.groups.forEach(function (g) {
        var depth = g.depthFt || 14;
        var stairFt = g.stairFt || 7.67;
        var overall = g.overallFt || 145;
        var seats = 0, filled = 0, rooms = 0, ft = 0;
        g.items.forEach(function (it) {
          if (it.kind === "room") { seats += it.cap; filled += occupants(it.id).length; rooms += 1; ft += it.widthFt; }
          if (it.kind === "stair") { ft += stairFt; }
        });
        var short = overall - ft;

        var head = document.createElement("div");
        head.className = "band-label";
        var drawn = '<span class="eyebrow' + (short > 0.5 ? " short" : "") + '">' +
          g.note + " · " + rooms + " spaces · " + ftIn(ft) + " of " + ftIn(overall) +
          (short > 0.5 ? " · " + ftIn(short) + " undrawn" : "") + "</span>";
        head.innerHTML = "<h3>" + g.building + " · " + g.floor + "</h3>" + drawn +
          '<span class="eyebrow meta">' + filled + " of " + seats + " seats filled</span>";
        canvas.appendChild(head);

        var row = document.createElement("div");
        row.className = "row";
        g.items.forEach(function (it) {
          if (it.kind === "room") { row.appendChild(roomCard(it, depth)); }
          else if (it.kind === "stair") {
            var s = document.createElement("div");
            s.className = "stair";
            s.style.width = px(stairFt) + "px";
            s.style.height = px(depth) + "px";
            s.innerHTML = "<span>" + it.label + "</span>";
            row.appendChild(s);
          } else {
            var e = document.createElement("div");
            e.className = "existing";
            e.style.height = px(depth) + "px";
            e.innerHTML = "<span>" + it.label + "</span>";
            row.appendChild(e);
          }
        });
        canvas.appendChild(row);

        var corr = document.createElement("div");
        corr.className = "corridor";
        corr.style.width = px(overall) + "px";
        corr.style.height = Math.max(18, px(4)) + "px";
        corr.innerHTML = "<span>CORRIDOR / CATWALK — open side to hangar (indicative)</span>";
        canvas.appendChild(corr);
      });

      if (hangarLabel) {
        var hangar = document.createElement("div");
        hangar.className = "hangar";
        hangar.style.width = px(bOverall) + "px";
        hangar.innerHTML = "<span>" + hangarLabel + "</span>";
        canvas.appendChild(hangar);
      }

      var ruler = document.createElement("div");
      ruler.className = "ruler";
      ruler.style.width = px(bOverall) + "px";
      for (var f = 0; f <= bOverall; f += 5) {
        var t = document.createElement("div");
        t.className = "tick" + (f % 20 === 0 ? " major" : "");
        t.style.left = px(f) + "px";
        ruler.appendChild(t);
        if (f % 20 === 0) {
          var l = document.createElement("div");
          l.className = "tick-lbl";
          l.style.left = px(f) + "px";
          l.textContent = f + "'";
          ruler.appendChild(l);
        }
      }
      canvas.appendChild(ruler);

      var depth0 = b.groups[0].depthFt || 14;
      var ov = document.createElement("div");
      ov.className = "overall";
      ov.style.width = px(bOverall) + "px";
      ov.textContent = "←  " + ftIn(bOverall) + " OVERALL  ·  " + ftIn(depth0) + " DEEP  →";
      canvas.appendChild(ov);
    });

    plan.appendChild(canvas);

    var legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML =
      '<span class="key"><i class="sw"></i>Empty office</span>' +
      '<span class="key"><i class="sw part"></i>Partly filled</span>' +
      '<span class="key"><i class="sw full"></i>Seats full</span>' +
      '<span class="key"><i class="sw over"></i>Over seats</span>' +
      '<span class="key"><i class="sw sup"></i>Support / shared</span>' +
      '<span class="key"><i class="sw dash"></i>Area not scheduled — width estimated</span>';
    plan.appendChild(legend);

    plan.appendChild(basisNote());
  }

  /* The tie-out is computed per floor rather than quoted, so it stays honest
     if the room table is edited. */
  function basisNote() {
    var rows = state.groups.map(function (g) {
      var stairFt = g.stairFt || 7.67;
      var overall = g.overallFt || 145;
      var sched = 0, stairs = 0, est = 0;
      g.items.forEach(function (it) {
        if (it.kind === "room") { sched += it.widthFt; if (it.est) est += it.widthFt; }
        if (it.kind === "stair") stairs += stairFt;
      });
      var total = sched + stairs;
      return "<li><strong>" + g.building + " " + g.floor + "</strong> — rooms " + ftIn(sched) +
        " + stairs " + ftIn(stairs) + " = " + ftIn(total) + " against a " + ftIn(overall) + " overall" +
        (Math.abs(overall - total) > 0.5
          ? ' <span style="color:var(--flag)">(' + ftIn(Math.abs(overall - total)) +
            (total < overall ? " undrawn" : " over") + ")</span>"
          : " (closes)") +
        (est > 0 ? ", of which " + ftIn(est) + " is estimated, not scheduled" : "") + "</li>";
    }).join("");

    var note = document.createElement("div");
    note.className = "note";
    note.innerHTML = "<strong>How this is drawn.</strong>" +
      "<ul>" +
      "<li>Room widths are area &divide; the floor depth, using the M0.1 schedule. Order is drawn left to right per A2.</li>" +
      rows +
      "<li>Corridor band and stair positions are <strong>indicative, not dimensioned</strong>. Pilot Lockers has no scheduled area, so its width is an estimate and it is drawn dashed.</li>" +
      "<li>Changes save to the shared backend as you make them. <strong>Save file</strong> still writes a local copy for offline use.</li>" +
      "</ul>";
    return note;
  }

  function roomCard(r, depth) {
    var card = document.createElement("div");
    var occ = occupants(r.id);
    var cls = "room";
    if (r.type === "support") cls += " support";
    if (r.est) cls += " est";
    if (occ.length > r.cap) cls += " over-cap";
    else if (r.cap > 0 && occ.length === r.cap) cls += " fill-full";
    else if (occ.length > 0) cls += " fill-part";
    card.className = cls;
    card.dataset.room = r.id;
    card.style.width = px(r.widthFt) + "px";
    card.style.height = px(depth) + "px";
    card.title = (r.code !== "—" ? r.code + " " : "") + r.name +
                 (r.sf ? " · " + r.sf + " sf" : "") + (r.sub ? " · " + r.sub : "");

    var head = document.createElement("div");
    head.className = "room-head";
    head.innerHTML =
      '<div class="tag">' + (r.code !== "—" ? "-" + r.code + "-" : "&mdash;") + "</div>" +
      '<div class="room-name">' + r.name + "</div>" +
      '<div class="room-sf">' + (r.sf ? r.sf + " SF" : "AREA N/S") + "</div>";
    card.appendChild(head);

    var seats = document.createElement("div");
    seats.className = "seats";
    occ.forEach(function (p) { seats.appendChild(personChip(p, { showWhere: false, showDept: false, removable: true })); });
    var open = Math.max(0, r.cap - occ.length);
    for (var i = 0; i < open; i++) {
      var slot = document.createElement("div");
      slot.className = "slot";
      slot.textContent = "SEAT " + ("0" + (occ.length + i + 1)).slice(-2);
      seats.appendChild(slot);
    }
    if (r.cap === 0 && occ.length === 0) {
      var s0 = document.createElement("div");
      s0.className = "slot";
      s0.textContent = "NO SEATS";
      seats.appendChild(s0);
    }
    card.appendChild(seats);

    var foot = document.createElement("div");
    foot.className = "room-foot";
    var minus = document.createElement("button");
    minus.type = "button"; minus.textContent = "−";
    minus.setAttribute("aria-label", "Fewer seats in " + r.name);
    minus.addEventListener("click", function () {
      r.cap = Math.max(0, r.cap - 1); render(); notify({ kind: "layout" });
    });
    var n = document.createElement("span");
    n.className = "cap-n"; n.textContent = r.cap;
    var plus = document.createElement("button");
    plus.type = "button"; plus.textContent = "+";
    plus.setAttribute("aria-label", "More seats in " + r.name);
    plus.addEventListener("click", function () {
      r.cap += 1; render(); notify({ kind: "layout" });
    });
    foot.appendChild(minus); foot.appendChild(n); foot.appendChild(plus);
    card.appendChild(foot);

    card.addEventListener("dragover", function (ev) { ev.preventDefault(); card.classList.add("is-over"); });
    card.addEventListener("dragleave", function () { card.classList.remove("is-over"); });
    card.addEventListener("drop", function (ev) {
      ev.preventDefault(); card.classList.remove("is-over");
      var id = ev.dataTransfer.getData("text/plain");
      if (id) place(id, r.id);
    });
    card.addEventListener("click", function (ev) {
      if (ev.target.closest(".chip") || ev.target.closest("button")) return;
      if (state.selected) place(state.selected, r.id);
    });
    return card;
  }

  /* ===================== POOL DROP TARGET ===================== */
  var pool = $("pool");
  pool.addEventListener("dragover", function (ev) { ev.preventDefault(); pool.classList.add("is-over"); });
  pool.addEventListener("dragleave", function () { pool.classList.remove("is-over"); });
  pool.addEventListener("drop", function (ev) {
    ev.preventDefault(); pool.classList.remove("is-over");
    var id = ev.dataTransfer.getData("text/plain");
    if (id) place(id, null);
  });
  pool.addEventListener("click", function (ev) {
    if (ev.target.closest(".chip")) return;
    if (state.selected) place(state.selected, null);
  });

  /* ===================== CONTROLS ===================== */
  $("tab-unplaced").addEventListener("click", function () { state.view = "unplaced"; renderPool(); });
  $("tab-all").addEventListener("click", function () { state.view = "all"; renderPool(); });
  $("search").addEventListener("input", function (e) { state.filter = e.target.value.trim().toLowerCase(); renderPool(); });

  function onKeydown(ev) {
    if (ev.key === "Escape" && state.selected) { state.selected = null; render(); }
  }
  document.addEventListener("keydown", onKeydown);

  $("ppf").addEventListener("input", function (e) {
    state.ppf = parseInt(e.target.value, 10);
    $("ppf-out").textContent = state.ppf + " px/ft";
    renderPlan();
  });
  $("btn-hide").addEventListener("click", function () {
    var sh = $("shell");
    sh.classList.toggle("collapsed");
    this.textContent = sh.classList.contains("collapsed") ? "Show roster" : "Hide roster";
  });

  container.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", function () { $(b.dataset.close).close(); });
  });
  $("btn-names").addEventListener("click", function () { $("dlg-names").showModal(); $("names-in").focus(); });
  $("names-save").addEventListener("click", function () {
    var added = addPeople($("names-in").value);
    $("names-in").value = "";
    $("dlg-names").close();
    render();
    if (added.length) notify({ kind: "people", people: added });
  });
  $("btn-space").addEventListener("click", function () { $("dlg-space").showModal(); });
  $("space-save").addEventListener("click", function () {
    var site = $("sp-site").value.trim();
    var bldg = $("sp-bldg").value.trim() || "Building";
    var floor = $("sp-floor").value.trim() || "Floor";
    var code = $("sp-code").value.trim() || "—";
    var name = $("sp-name").value.trim() || "Office";
    var sf = parseInt($("sp-sf").value, 10);
    var cap = parseInt($("sp-cap").value, 10);
    var depth = parseFloat($("sp-depth").value);
    var overall = parseFloat($("sp-overall").value);
    var gid = (bldg + "-" + floor).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    var group = null;
    state.groups.forEach(function (g) { if (g.id === gid) group = g; });
    if (!group) {
      group = {
        id: gid, site: site, building: bldg, floor: floor, note: "Added by hand",
        depthFt: !isNaN(depth) && depth > 0 ? depth : 14,
        overallFt: !isNaN(overall) && overall > 0 ? overall : 145,
        stairFt: 7.67, hangarLabel: "", items: [],
      };
      state.groups.push(group);
    }
    var okSf = !isNaN(sf) && sf > 0;
    group.items.push({
      kind: "room", id: nextId("r"), code: code, name: name, sub: "",
      sf: okSf ? sf : null,
      widthFt: okSf ? sf / group.depthFt : group.depthFt,
      est: !okSf, type: "office",
      cap: isNaN(cap) ? 2 : cap,
    });
    $("sp-code").value = ""; $("sp-name").value = ""; $("sp-sf").value = "";
    $("dlg-space").close();
    render();
    notify({ kind: "layout" });
  });

  function download(text, filename, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  $("btn-csv").addEventListener("click", function () {
    var rows = [["Site", "Building", "Floor", "Room", "Space", "Type", "Area SF", "Width ft", "Seats", "Assigned", "Departments"]];
    allRooms().forEach(function (x) {
      var occ = occupants(x.room.id);
      rows.push([x.group.site || "", x.group.building, x.group.floor, x.room.code, x.room.name, x.room.type,
        x.room.sf === null ? "" : x.room.sf, Math.round(x.room.widthFt * 100) / 100,
        x.room.cap,
        occ.map(function (p) { return p.name; }).join(" | "),
        /* Positional, not compacted, so a blank department still lines up with
           the name it belongs to in the Assigned column. */
        occ.map(function (p) { return p.dept || ""; }).join(" | ")]);
    });
    state.people.filter(function (p) { return !p.roomId; }).forEach(function (p) {
      rows.push(["", "", "", "UNPLACED", "", "", "", "", "", p.name, p.dept || ""]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        c = String(c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(",");
    }).join("\n");
    download(csv, "seating-" + stamp() + ".csv", "text/csv");
  });

  function snapshot() {
    return {
      version: LAYOUT_VERSION, saved: new Date().toISOString(), basis: BASIS_LABEL,
      rev: state.rev, groups: state.groups, people: state.people,
    };
  }

  $("btn-json").addEventListener("click", function () {
    download(JSON.stringify(snapshot(), null, 2), "seating-" + stamp() + ".json", "application/json");
  });
  $("btn-load").addEventListener("click", function () { $("file-in").click(); });
  $("file-in").addEventListener("change", function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.groups || !data.people) throw new Error("shape");
        applyState(data);
        notify({ kind: "import" });
      } catch (e) {
        alert("That file isn't a seating board save file. Use one created by Save file.");
      }
    };
    reader.readAsText(f);
    ev.target.value = "";
  });
  $("btn-print").addEventListener("click", function () { window.print(); });
  $("btn-reload").addEventListener("click", function () { if (hooks.onReload) hooks.onReload(); });

  /* There is no sign-in, so edits would otherwise be unattributed. This is a
     label the user sets for themselves — it proves nothing, it just makes the
     "by" field on an assignment readable later. */
  function currentWho() {
    return typeof hooks.whoami === "function" ? hooks.whoami() || "" : "";
  }
  function paintWho() {
    var who = currentWho();
    $("btn-whoami").textContent = who ? "You: " + who : "Who am I?";
  }
  $("btn-whoami").addEventListener("click", function () {
    var next = window.prompt("Your name — labels the changes you make. Not a login.", currentWho());
    if (next === null) return;
    next = next.trim().replace(/\s+/g, " ");
    if (hooks.onWhoami) hooks.onWhoami(next);
    paintWho();
  });
  paintWho();

  /* ===================== HOST API ===================== */

  /* Replace board state from a save file or the server. Ids arriving from
     outside must not collide with locally minted ones, so the counter is
     pushed past anything we just adopted. */
  function applyState(data) {
    if (data.groups) state.groups = normalizeGroups(data.groups);
    if (data.people) {
      state.people = data.people.map(function (p) {
        return { id: p.id, name: p.name, dept: p.dept || "", roomId: p.roomId || null };
      });
    }
    if (typeof data.rev === "number") state.rev = data.rev;
    state.selected = null;
    bumpUid();
    render();
  }

  /* Older saves predate per-group dimensions; fill them in so the renderer
     never divides by undefined. */
  function normalizeGroups(groups) {
    return groups.map(function (g) {
      var depth = g.depthFt || 14;
      return {
        id: g.id, site: g.site || "", building: g.building, floor: g.floor, note: g.note || "",
        depthFt: depth, overallFt: g.overallFt || 145, stairFt: g.stairFt || 7.67,
        hangarLabel: g.hangarLabel || "",
        items: (g.items || []).map(function (it) {
          if (it.kind !== "room") return it;
          return {
            kind: "room", id: it.id, code: it.code, name: it.name, sub: it.sub || "",
            sf: it.sf === undefined ? null : it.sf,
            widthFt: it.widthFt || (it.sf ? it.sf / depth : depth),
            est: !!it.est, type: it.type || "office", cap: typeof it.cap === "number" ? it.cap : 2,
          };
        }),
      };
    });
  }

  function bumpUid() {
    var max = 0;
    function scan(id) {
      var m = /^[rp](\d+)$/.exec(id || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    state.groups.forEach(function (g) { g.items.forEach(function (it) { if (it.kind === "room") scan(it.id); }); });
    state.people.forEach(function (p) { scan(p.id); });
    if (max > uid) uid = max;
  }

  function setSync(stateName, text) {
    var el = $("sync");
    if (!el) return;
    el.dataset.state = stateName;
    $("sync-text").textContent = text;
  }

  function setHeader(text) {
    var el = $("eyebrow");
    if (el) el.innerHTML = text;
  }

  render();

  return {
    state: state,
    applyState: applyState,
    normalizeGroups: normalizeGroups,
    snapshot: snapshot,
    render: render,
    setSync: setSync,
    setHeader: setHeader,
    defaultGroups: function () { return buildGroups(nextId); },
    destroy: function () {
      document.removeEventListener("keydown", onKeydown);
      container.innerHTML = "";
    },
  };
}
