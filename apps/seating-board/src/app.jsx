/* Seating Board — hub app entry.
 *
 * The board itself is ~600 lines of vanilla DOM that draws the plan to scale.
 * That code is deliberately NOT ported to React: the geometry and drag-drop
 * are the whole value and a rewrite would risk them for no user-visible gain.
 * So React's only job here is mounting the board.
 *
 * NO SIGN-IN, and now not even the option of one. Accounts were the problem
 * rather than the protection: people were being asked to sign in and still not
 * seeing the current status. The board holds names and office numbers, which is
 * wall-map information, so it takes one shared password instead — see gate.js,
 * which is honest about not being a security boundary.
 *
 * That means `schema-auth-enforce.sql` must stay UNRUN, and if it was ever run,
 * `schema-anon-restore.sql` puts back the anonymous access this depends on.
 * Without those policies the board loads, shows the empty default layout, and
 * reports "Offline — not saved" — which looks exactly like losing the roster.
 *
 * Because there's no signed-in identity, "who changed this" comes from a name
 * the user sets once, kept in localStorage. It's a courtesy label for the `by`
 * field, not a credential, and nothing verifies it.
 */

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../../../shared/store.js";
import { mountBoard } from "./board.js";
import { createSync } from "./persist.js";
import { BASIS_LABEL } from "./basis.js";
import { PassGate } from "./gate.js";

/* Shared, not per-user: a board where each person saw only their own
   assignments would be useless.
 *
 * anon:true is load-bearing, not tidiness. This board has no sign-in, but the
 * hub's Supabase session is shared across the origin, so a visitor who signed
 * in to another app here arrived as the `authenticated` role instead of `anon`
 * -- a different role, a different set of policies, and an empty board. Ted saw
 * exactly that: "I refreshed, signed in and no names still," while an unsigned
 * browser showed the full roster. The board now always reads and writes as
 * anon, so every visitor gets the same board whatever they are signed in to. */
const db = store("b100-seating", { shared: true, anon: true });

const HEADER = "PJ Helicopters &middot; 903 Langley Rd, Red Bluff &middot; Basis: Rev1 full status set 4-9-26";
const WHO_KEY = "seating-board:whoami";

function readWho() {
  try { return window.localStorage.getItem(WHO_KEY) || ""; } catch (e) { return ""; }
}
function writeWho(v) {
  try { window.localStorage.setItem(WHO_KEY, v); } catch (e) { /* private mode */ }
}

function Board() {
  const hostRef = useRef(null);
  const bornRef = useRef(false);
  const [fatal, setFatal] = useState(null);

  useEffect(() => {
    if (bornRef.current || !hostRef.current) return;
    bornRef.current = true;

    let board = null;
    let sync = null;
    let channel = null;
    let reloadTimer = null;
    let dead = false;
    let who = readWho();

    try {
      board = mountBoard(hostRef.current, {
        onMutate: (ev) => sync && sync.onMutate(ev),
        onReload: () => { if (sync) sync.load(); },
        onWhoami: (name) => { who = name; writeWho(name); },
        whoami: () => who,
      });
    } catch (e) {
      console.error("[seating] board failed to mount:", e);
      setFatal(e.message || "The board failed to draw.");
      return;
    }

    board.setHeader(HEADER);

    sync = createSync({
      db,
      board,
      whoami: () => who,
      onStatus: (state, text) => board.setSync(state, text),
      onConflict: (serverRev, localRev) => {
        board.setSync("error", "Reload needed");
        window.alert(
          "Someone else changed the room layout (server revision " + serverRev +
          ", yours " + localRev + ").\n\nYour seat-count change was not saved. " +
          "Choose Reload to pull their version, then redo it."
        );
      },
    });

    /* Say out loud which of the three states this is, because the board cannot
       show the difference by drawing itself: an empty roster, a roster nobody
       is allowed to read, and a backend that isn't answering all render as the
       same empty board. Guessing between them by hand cost days. */
    sync.load().then(function (res) {
      if (dead || !res) return;
      if (!res.ok) {
        board.setNotice("error",
          "<strong>Can't reach the shared board.</strong> Nothing here is saved, and " +
          "this is not the current seating &mdash; it's the blank starting layout. " +
          "Check the connection and use <strong>Reload</strong>.");
      } else if (res.denied) {
        board.setNotice("error",
          "<strong>The database is refusing this board.</strong> It answered, but it " +
          "returned nothing and won't accept a write &mdash; so this is the blank " +
          "starting layout, not your seating, and the roster is not gone. " +
          "Anonymous access needs restoring: run <code>schema-anon-restore.sql</code> " +
          "in the Supabase SQL editor, then <strong>Reload</strong>.");
      } else if (res.seeded && !res.people) {
        board.setNotice("error",
          "<strong>The shared board is empty.</strong> The database is reachable and " +
          "writable, but it holds no rooms and no names &mdash; so this is a fresh " +
          "board rather than a hidden one. If there was a roster, restore it with " +
          "<strong>Open file</strong> from a <strong>Save file</strong> export.");
      } else if (!res.people) {
        board.setNotice("",
          "No names on the roster yet. Choose <strong>Add names</strong> to paste the list.");
      } else {
        board.setNotice("");
      }
    });

    /* Live updates so a board open on two screens stays in step. Our own
       writes echo back through this channel, so skip while a write is in
       flight and debounce the rest. */
    channel = db.subscribe(() => {
      if (dead) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (dead || sync.isBusy() || !sync.isReady()) return;
        sync.load();
      }, 900);
    });

    return () => {
      dead = true;
      clearTimeout(reloadTimer);
      if (channel && channel.unsubscribe) channel.unsubscribe();
      if (board) board.destroy();
      bornRef.current = false;
    };
  }, []);

  if (fatal) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h2 style={{ margin: "0 0 6px" }}>The board didn&rsquo;t draw</h2>
        <p style={{ color: "#6B7480" }}>{fatal}</p>
        <p style={{ color: "#6B7480", fontSize: 13 }}>Basis: {BASIS_LABEL}</p>
      </div>
    );
  }

  return <div ref={hostRef} />;
}

createRoot(document.getElementById("root")).render(
  <PassGate><Board /></PassGate>
);
