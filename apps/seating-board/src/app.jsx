/* Seating Board — hub app entry.
 *
 * The board itself is ~600 lines of vanilla DOM that draws the plan to scale.
 * That code is deliberately NOT ported to React: the geometry and drag-drop
 * are the whole value and a rewrite would risk them for no user-visible gain.
 * So React's only job here is mounting the board.
 *
 * NO SIGN-IN. This board is open to anyone with the URL, by decision: it holds
 * names and office numbers, which is wall-map information. The consequence is
 * that the URL permits writing as well as reading, so keep `schema-auth-
 * enforce.sql` UNRUN — it would drop the anonymous access this depends on.
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

/* Shared, not per-user: a board where each person saw only their own
   assignments would be useless. */
const db = store("b100-seating", { shared: true });

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

    sync.load();

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

createRoot(document.getElementById("root")).render(<Board />);
