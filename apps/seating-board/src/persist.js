/* persist.js — Supabase sync for the seating board.
 *
 * Writes are SPLIT, not one blob. A single document holding the whole board
 * means last-write-wins: two people placing different staff would erase each
 * other. One row per person means they never collide.
 *
 *   collection     doc_id        data                        written
 *   layout         <LAYOUT_DOC>  {groups, basis, version, rev} rooms/seat changes (rare)
 *   people         <person_id>   {name, dept}                  roster add
 *   assignments    <person_id>   {roomId, at, by}              every placement
 *
 * Two guards that matter:
 *   - `ready`: nothing is written until the initial load resolves. Without it
 *     the first render would push local defaults over shared server state.
 *   - `rev`: the layout doc carries a revision. A write that finds a newer rev
 *     on the server stops and asks the host to reload instead of clobbering.
 */

import { LAYOUT_VERSION, BASIS_LABEL } from "./basis.js";

export var LAYOUT_DOC = "b100";

export function createSync(opts) {
  var db = opts.db;
  var board = opts.board;
  var onStatus = opts.onStatus || function () {};
  var onConflict = opts.onConflict || function () {};
  /* Resolved at write time, not construction: with no sign-in the user can set
     or change their name at any point during the session. */
  var whoami = typeof opts.whoami === "function"
    ? opts.whoami
    : function () { return opts.whoami || ""; };

  var ready = false;          // gate: no writes before the first load lands
  var chain = Promise.resolve(); // serialize writes so they can't interleave
  var inflight = 0;

  function status(state, text) { onStatus(state, text); }
  function clockTime() {
    var d = new Date();
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  /* Run a write on the queue, with status bookkeeping around it. */
  function enqueue(label, fn) {
    if (!ready) return chain;
    inflight += 1;
    status("saving", "Saving");
    chain = chain.then(fn).then(
      function () {
        inflight -= 1;
        if (inflight === 0) status("saved", "Saved " + clockTime());
      },
      function (err) {
        inflight -= 1;
        status("error", "Not saved");
        console.error("[seating] " + label + " failed:", err);
      }
    );
    return chain;
  }

  /* ---------------- load ---------------- */

  async function load() {
    status("saving", "Loading");
    var layout, people, assigns;
    try {
      var results = await Promise.all([
        db.get("layout", LAYOUT_DOC),
        db.list("people"),
        db.list("assignments"),
      ]);
      layout = results[0]; people = results[1]; assigns = results[2];
    } catch (err) {
      // The board still works offline; Save file is the fallback.
      status("offline", "Offline — not saved");
      console.error("[seating] load failed:", err);
      ready = false;
      return { ok: false, error: err };
    }

    var where = {};
    (assigns || []).forEach(function (a) { where[a.id] = a.roomId || null; });

    /* The stored layout wins, because it carries edits (seat counts, hand-added
       spaces) the code defaults don't know about. But a NEW floor shipped in
       basis.js would then never appear. So fold in any default group whose id
       isn't already stored, and persist that once. This is the upgrade path for
       every floor added from here on. */
    var stored = layout && layout.groups ? layout.groups : null;
    var groups, migrated = [];
    if (!stored) {
      groups = board.defaultGroups();
    } else {
      var have = {};
      stored.forEach(function (g) { have[g.id] = true; });
      migrated = board.defaultGroups().filter(function (g) { return !have[g.id]; });
      groups = migrated.length ? stored.concat(migrated) : stored;
    }

    var data = {
      groups: groups,
      rev: layout && typeof layout.rev === "number" ? layout.rev : 0,
      people: (people || []).map(function (p) {
        return { id: p.id, name: p.name, dept: p.dept || "", roomId: where[p.id] || null };
      }),
    };

    board.applyState(data);
    ready = true;

    // First run against an empty backend: seed the layout so the room table and
    // seat counts are shared rather than re-derived per browser.
    if (!layout) {
      await enqueue("seed layout", function () { return writeLayout(); });
      status("saved", "Saved " + clockTime());
    } else if (migrated.length) {
      await enqueue("add new floors", function () { return writeLayout(); });
      console.info("[seating] added " + migrated.length + " new floor(s): " +
        migrated.map(function (g) { return g.building + " " + g.floor; }).join(", "));
      status("saved", "Saved " + clockTime());
    } else {
      status("saved", "Loaded " + clockTime());
    }
    return { ok: true, seeded: !layout, added: migrated.length };
  }

  /* ---------------- writes ---------------- */

  function writeLayout() {
    var s = board.state;
    s.rev = (s.rev || 0) + 1;
    return db.set("layout", {
      groups: s.groups, basis: BASIS_LABEL, version: LAYOUT_VERSION, rev: s.rev,
      at: new Date().toISOString(), by: whoami(),
    }, LAYOUT_DOC);
  }

  /* Seat counts and room edits are rare, so an optimistic rev check plus a
     "reload" prompt is the right amount of machinery here. */
  function pushLayout() {
    return enqueue("layout", async function () {
      var server = await db.get("layout", LAYOUT_DOC);
      var localRev = board.state.rev || 0;
      if (server && typeof server.rev === "number" && server.rev > localRev) {
        onConflict(server.rev, localRev);
        throw new Error("layout rev " + server.rev + " on server is newer than local " + localRev);
      }
      return writeLayout();
    });
  }

  function pushAssignment(person) {
    return enqueue("assignment", function () {
      return db.set("assignments", {
        roomId: person.roomId || null, at: new Date().toISOString(), by: whoami(),
      }, person.id);
    });
  }

  function pushPeople(people) {
    return enqueue("people", async function () {
      for (var i = 0; i < people.length; i++) {
        var p = people[i];
        await db.set("people", { name: p.name, dept: p.dept || "" }, p.id);
      }
    });
  }

  /* An imported save file replaces everything, so push the lot. */
  function pushAll() {
    return enqueue("import", async function () {
      var s = board.state;
      await writeLayout();
      for (var i = 0; i < s.people.length; i++) {
        var p = s.people[i];
        await db.set("people", { name: p.name, dept: p.dept || "" }, p.id);
        await db.set("assignments", { roomId: p.roomId || null, at: new Date().toISOString(), by: whoami() }, p.id);
      }
    });
  }

  /* Route the board's single mutation signal to the narrowest write. */
  function onMutate(ev) {
    if (!ready) return;
    if (ev.kind === "assignment") return pushAssignment(ev.person);
    if (ev.kind === "people") return pushPeople(ev.people);
    if (ev.kind === "layout") return pushLayout();
    if (ev.kind === "import") return pushAll();
  }

  return {
    load: load,
    onMutate: onMutate,
    isReady: function () { return ready; },
    isBusy: function () { return inflight > 0; },
    afterWrites: function () { return chain; },
  };
}
