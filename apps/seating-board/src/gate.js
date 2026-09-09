/* gate.js — one shared password, no accounts.
 *
 * This is NOT a security boundary, and it must not be described as one. The
 * password is compiled into the published bundle, so anyone who opens the page
 * can read it; and the board's data sits behind the same anonymous Postgres
 * policies it always did, reachable with the publishable key whether or not
 * anyone got past this screen. Alex chose that trade deliberately: the board
 * holds names and office numbers, which is wall-map information, and the cost
 * of real accounts was people unable to see the current status.
 *
 * What it IS: one word between a stray visitor and a board they'd be confused
 * by, and — more to the point — the thing that replaced sign-in. No email, no
 * magic link, no per-user rows, nothing to administer. Everyone who gets in
 * has the same full access, which is what makes the board shared.
 *
 * Kept per browser in localStorage, so it is asked once per device.
 */

import React, { useState } from "react";

const PASS = "PJH903";
const KEY = "seating-board:pass";

/* Case and stray whitespace are not the point — someone typing it off a text
   message shouldn't be turned away over a capital letter. */
function matches(v) {
  return String(v || "").trim().toLowerCase() === PASS.toLowerCase();
}

function remembered() {
  try {
    return matches(window.localStorage.getItem(KEY));
  } catch (e) {
    return false; // private mode, or storage blocked
  }
}

export function PassGate({ children }) {
  const [open, setOpen] = useState(remembered);
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);

  if (open) return children;

  function submit(ev) {
    ev.preventDefault();
    if (!matches(typed)) { setWrong(true); return; }
    /* A blocked write must not stop entry — it only means this device asks
       again next visit. */
    try { window.localStorage.setItem(KEY, typed.trim()); } catch (e) { /* ignore */ }
    setOpen(true);
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="eyebrow">PJ Helicopters</div>
        <h1>Seating Board</h1>
        <p>
          Shared board — whoever has the word has the same full access, and
          changes save for everyone as they&rsquo;re made. Ask Alex if you
          don&rsquo;t have it.
        </p>
        <label>
          Password
          <input
            type="password"
            value={typed}
            autoFocus
            autoComplete="current-password"
            aria-invalid={wrong ? "true" : undefined}
            onChange={(e) => { setTyped(e.target.value); setWrong(false); }}
          />
        </label>
        {wrong && <p className="gate-msg" role="alert">That isn&rsquo;t it. Check for a stray space.</p>}
        <button className="primary" type="submit">Open the board</button>
      </form>
    </div>
  );
}
