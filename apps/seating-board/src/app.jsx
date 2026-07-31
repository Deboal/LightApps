/* Seating Board — hub app entry.
 *
 * The board itself is ~600 lines of vanilla DOM that draws the plan to scale.
 * That code is deliberately NOT ported to React: the geometry and drag-drop
 * are the whole value and a rewrite would risk them for no user-visible gain.
 * So React's only jobs here are the shared AuthGate and mounting the board.
 */

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../../../shared/store.js";
import { AuthGate, signOut } from "../../../shared/auth.js";
import { mountBoard } from "./board.js";
import { createSync } from "./persist.js";
import { BASIS_LABEL } from "./basis.js";

/* Shared, not per-user: a board where each person sees only their own
   assignments would be useless. */
const db = store("b100-seating", { shared: true });

const HEADER = "PJ Helicopters &middot; 903 Langley Rd, Red Bluff &middot; Basis: Rev1 full status set 4-9-26";

function Board({ user }) {
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

    try {
      board = mountBoard(hostRef.current, {
        onMutate: (ev) => sync && sync.onMutate(ev),
        onReload: () => { if (sync) sync.load(); },
        onSignOut: () => signOut(),
      });
    } catch (e) {
      console.error("[seating] board failed to mount:", e);
      setFatal(e.message || "The board failed to draw.");
      return;
    }

    board.setHeader(HEADER + " &middot; " + (user.email || "signed in"));

    sync = createSync({
      db,
      board,
      whoami: user.email || user.id,
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
  }, [user]);

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
  <AuthGate>{(user) => <Board user={user} />}</AuthGate>
);
