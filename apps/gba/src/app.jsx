import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useAuth, signInWithEmail, signOut } from "../../../shared/auth.js";
import * as netplay from "./netplay.js";
import * as cloud from "./cloud.js";
import { makeStates } from "./states.js";

// GBA — a Game Boy Advance emulator. The core is Rust compiled to WebAssembly
// (see gba/ in this repo); this file is only the shell.
//
// Storage is local-first with an optional account. The emulator always reads
// and writes this browser's IndexedDB, so the app works signed out and with no
// network. Signing in adds a durable copy: ROMs are uploaded once and keyed by
// content hash, saves are versioned and synced across devices.
//
// This deliberately does not use AuthGate. An emulator that demands an account
// before it will play a cartridge you already own is worse, and the account is
// only needed for the part that spans devices.

const WIDTH = 240;
const HEIGHT = 160;
const FPS = 59.7275;

// Must match KeyState in gba-core.
const BTN = {
  A: 1 << 0,
  B: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  RIGHT: 1 << 4,
  LEFT: 1 << 5,
  UP: 1 << 6,
  DOWN: 1 << 7,
  R: 1 << 8,
  L: 1 << 9,
};

// Any direction. The run latch keys off this: B is only held while the
// character is actually moving, so a latched run never leaks into a menu,
// where a held B would back straight out of it.
const DPAD = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT;

const KEYBOARD = {
  KeyZ: BTN.A,
  KeyX: BTN.B,
  Enter: BTN.START,
  // Shift is deliberately not a game button: it is the modifier that latches
  // fast-forward, and having it also press Select would open a menu every time
  // you changed speed.
  Backspace: BTN.SELECT,
  ArrowUp: BTN.UP,
  ArrowDown: BTN.DOWN,
  ArrowLeft: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  KeyA: BTN.L,
  KeyS: BTN.R,
};

/** Whether a key event belongs to something being typed into.
 *
 *  The game listens on the window and swallows the keys it uses, which is
 *  right while you are playing and wrong the instant a text field has focus:
 *  A, S, X and Z are buttons, Backspace is Select, and Enter is Start -- so
 *  typing a link code meant no letters, no deleting, and no submitting. This
 *  guards every field in the app, not just that one. */
function typing(event) {
  const target = event.target;
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable === true
  );
}

// ----------------------------------------------------------------------------
// Local storage
// ----------------------------------------------------------------------------

// A single object store keyed by strings. Saves are small; a cartridge is not,
// and localStorage cannot hold 16 MB.
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gba", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("blobs");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("blobs").objectStore("blobs").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

async function dbPut(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

// One place opens the database, so the state store borrows these rather than
// duplicating them.
const states = makeStates({ dbGet: (k) => dbGet(k), dbPut: (k, v) => dbPut(k, v) });

// What this browser believes about a cartridge's save: the server version it
// was last in step with, and whether it has moved on since.
const localMeta = (key) => dbGet(`meta:${key}`).then((m) => m || { version: 0, dirty: false });
const setLocalMeta = (key, meta) => dbPut(`meta:${key}`, meta);

// ----------------------------------------------------------------------------
// Core
// ----------------------------------------------------------------------------

// The wasm module exports plain C-ABI functions plus its linear memory; there
// is no bindings glue to load.
async function loadCore() {
  const response = await fetch("assets/gba-core.wasm");
  if (!response.ok) throw new Error(`core not found (${response.status})`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  return instance.exports;
}

function intoWasm(core, bytes) {
  const ptr = core.gba_alloc(bytes.length);
  new Uint8Array(core.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function readTransfer(core, length) {
  if (!length) return null;
  const ptr = core.gba_transfer_ptr();
  // Taken fresh because growing the heap detaches the old buffer.
  return new Uint8Array(core.memory.buffer, ptr, length).slice();
}

function gameCodeOf(core) {
  const packed = core.gba_game_code();
  let code = "";
  for (let i = 0; i < 4; i++) {
    const byte = (packed >>> (8 * i)) & 0xff;
    if (byte >= 32 && byte < 127) code += String.fromCharCode(byte);
  }
  return code || "UNKNOWN";
}

/** Title and game code straight out of the cartridge header. */
function headerOf(bytes) {
  const text = (from, to) => new TextDecoder().decode(bytes.slice(from, to)).replace(/\0+$/, "").trim();
  return { title: text(0xa0, 0xac), gameCode: text(0xac, 0xb0) };
}

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----------------------------------------------------------------------------
// UI pieces
// ----------------------------------------------------------------------------

const panel = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 12,
};

function Button({ children, onClick, tone, disabled, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...panel,
        background: tone === "accent" ? "var(--accent)" : "var(--panel)",
        borderColor: tone === "accent" ? "var(--accent)" : "var(--line)",
        padding: "10px 14px",
        fontSize: 14,
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// Mix a hex colour towards black or white. The buttons' sides and highlights
// are derived from their face colour rather than hand-picked, so a new button
// only needs one value.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

// A short buzz on press.
//
// navigator.vibrate covers Android. iOS Safari does not implement it at all,
// and the only lever a web page has there is that toggling a switch control
// produces a system haptic -- so a hidden one gets clicked instead. It has to
// be a real click on the label; setting `checked` does nothing.
let hapticLabel = null;
let hapticsEnabled = true;
try {
  hapticsEnabled = localStorage.getItem("gba.haptics") !== "off";
} catch {
  // A browser that will not hand over storage still gets the default.
}
function setHaptics(on) {
  hapticsEnabled = on;
  try {
    localStorage.setItem("gba.haptics", on ? "on" : "off");
  } catch {
    // Not worth failing a button press over.
  }
}
function haptic() {
  if (!hapticsEnabled) return;
  try {
    if (navigator.vibrate) {
      navigator.vibrate(7);
      return;
    }
    if (!hapticLabel) {
      const hidden =
        "position:absolute;left:-9999px;width:0;height:0;opacity:0;pointer-events:none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.id = "gba-haptic";
      input.style.cssText = hidden;
      const label = document.createElement("label");
      label.htmlFor = input.id;
      label.style.cssText = hidden;
      document.body.append(input, label);
      hapticLabel = label;
    }
    hapticLabel.click();
  } catch {
    // A browser that refuses either mechanism is not a reason to drop input.
  }
}

// A button face. It reports nothing itself: the pad area below owns the
// pointer and tells it whether it is down, because a thumb that slides from
// one button to the next has to take the press with it.
function Pad({ mask, label, held, fill, ink, style, round }) {
  return (
    <div
      data-mask={mask}
      data-held={held ? "1" : "0"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // A face lit from above, so the cap reads as a solid thing with a top
        // and a side rather than a coloured rectangle.
        background: `linear-gradient(${shade(fill, 0.12)}, ${shade(fill, -0.1)})`,
        border: "1px solid rgba(255,255,255,.14)",
        borderRadius: round ? "50%" : 12,
        color: ink || "#fff",
        fontSize: 15,
        fontWeight: 700,
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "none",
        // Down: the cap sinks onto its own side wall and the highlight flips
        // to a shadow cast by the rim it just dropped below.
        boxShadow: held
          ? `inset 0 2px 5px rgba(0,0,0,.45), 0 0 0 ${shade(fill, -0.45)}`
          : `inset 0 1px 0 rgba(255,255,255,.22), 0 3px 0 ${shade(fill, -0.45)}, 0 5px 7px rgba(0,0,0,.4)`,
        transform: held ? "translateY(3px)" : "none",
        filter: held ? "brightness(1.1)" : "none",
        // Instant down, cushioned up with a little overshoot. The asymmetry is
        // most of what makes a flat button feel sprung.
        transition: held
          ? "transform .04s linear, box-shadow .04s linear, filter .04s linear"
          : "transform .14s cubic-bezier(.34,1.56,.64,1), box-shadow .14s ease-out, filter .14s ease-out",
        ...style,
      }}
    >
      {label}
    </div>
  );
}

// The pad area owns the pointer, not the buttons.
//
// A gamepad whose button only answers a press that begins and ends on the same
// spot is the one thing a real one never does: you roll from B to A, and from
// up to up-left, without lifting a thumb. So every move is hit-tested against
// whatever is under the finger now, and the difference between the buttons
// held a moment ago and the ones held now is what gets pressed and released.
// Tracking by pointer id means two thumbs work, and a button under both stays
// down until the second one leaves.
function usePads(press, release) {
  const [held, setHeld] = useState(0);
  const heldRef = useRef(0);
  const pointers = useRef(new Map());

  const maskAt = (x, y) => {
    const under = document.elementFromPoint(x, y);
    const pad = under && under.closest("[data-mask]");
    return pad ? Number(pad.dataset.mask) || 0 : 0;
  };

  const settle = useCallback(() => {
    let union = 0;
    for (const mask of pointers.current.values()) union |= mask;
    const was = heldRef.current;
    if (union === was) return;
    const pressed = union & ~was;
    const released = was & ~union;
    if (pressed) {
      press(pressed);
      haptic();
    }
    if (released) release(released);
    heldRef.current = union;
    setHeld(union);
  }, [press, release]);

  const track = useCallback(
    (event) => {
      pointers.current.set(event.pointerId, maskAt(event.clientX, event.clientY));
      settle();
    },
    [settle]
  );

  const handlers = {
    onPointerDown: (event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      track(event);
    },
    onPointerMove: (event) => {
      if (!pointers.current.has(event.pointerId)) return;
      track(event);
    },
    onPointerUp: (event) => {
      pointers.current.delete(event.pointerId);
      settle();
    },
    onPointerCancel: (event) => {
      pointers.current.delete(event.pointerId);
      settle();
    },
  };

  // Nothing may stay held across a hidden tab: the pointer-up never arrives.
  useEffect(() => {
    const drop = () => {
      pointers.current.clear();
      settle();
    };
    window.addEventListener("blur", drop);
    document.addEventListener("visibilitychange", drop);
    return () => {
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", drop);
    };
  }, [settle]);

  return { held, handlers };
}

// Face-button colours. Filled rather than outlined: against a dark panel an
// outlined control reads as decoration, not as something to press.
const PAD = {
  dpad: "#3b4a7a",
  a: "#7c5cff",
  b: "#ff5db1",
  system: "#4a5580",
  shoulder: "#2b3355",
};

// L and R live above the screen. They are barely used in these games, and
// putting them on the thumbs' path costs more than reaching for them does.
function Shoulders({ held, handlers }) {
  const shape = { width: 74, height: 30, fontSize: 13 };
  return (
    <div
      {...handlers}
      style={{ display: "flex", justifyContent: "space-between", padding: "2px 16px 8px", touchAction: "none" }}
    >
      <Pad mask={BTN.L} label="L" held={!!(held & BTN.L)} fill={PAD.shoulder} ink="#c3cdf5" style={shape} />
      <Pad mask={BTN.R} label="R" held={!!(held & BTN.R)} fill={PAD.shoulder} ink="#c3cdf5" style={shape} />
    </div>
  );
}

function Controls({ held, handlers, run, onRun }) {
  // Sized to fit a 375px phone without clipping: the pad and the face buttons
  // have to share that width.
  const cell = { width: 52, height: 52 };
  // The corners are hit targets with no face of their own. Drawn, they turn
  // the cross into a grid of nine tiles; invisible, they still press both
  // neighbouring directions -- and since each arm lights from its own bit,
  // a thumb on the corner lights both arms, which is what a real cross does.
  const nub = {
    background: "transparent",
    border: "none",
    boxShadow: "none",
    transform: "none",
  };
  const system = { width: 78, height: 26, fontSize: 10 };
  return (
    <div {...handlers} style={{ maxWidth: 520, margin: "0 auto", width: "100%", touchAction: "none" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 10px 0",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 52px)",
            gridTemplateRows: "repeat(3, 52px)",
            gap: 3,
          }}
        >
          {/* The corners press both neighbours, the way the corner of a real
              cross does. Unlabelled and dimmed so the plus shape still reads,
              but a thumb rolling from up to left passes through a diagonal
              instead of a hole. */}
          <Pad mask={BTN.UP | BTN.LEFT} fill={PAD.dpad} style={{ ...cell, ...nub }} />
          <Pad mask={BTN.UP} label="▲" held={!!(held & BTN.UP)} fill={PAD.dpad} style={cell} />
          <Pad mask={BTN.UP | BTN.RIGHT} fill={PAD.dpad} style={{ ...cell, ...nub }} />
          <Pad mask={BTN.LEFT} label="◀" held={!!(held & BTN.LEFT)} fill={PAD.dpad} style={cell} />
          <div
            style={{
              ...cell,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: shade(PAD.dpad, -0.25),
                boxShadow: "inset 0 1px 2px rgba(0,0,0,.5)",
              }}
            />
          </div>
          <Pad mask={BTN.RIGHT} label="▶" held={!!(held & BTN.RIGHT)} fill={PAD.dpad} style={cell} />
          <Pad mask={BTN.DOWN | BTN.LEFT} fill={PAD.dpad} style={{ ...cell, ...nub }} />
          <Pad mask={BTN.DOWN} label="▼" held={!!(held & BTN.DOWN)} fill={PAD.dpad} style={cell} />
          <Pad mask={BTN.DOWN | BTN.RIGHT} fill={PAD.dpad} style={{ ...cell, ...nub }} />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Pad mask={BTN.B} label="B" held={!!(held & BTN.B)} round fill={PAD.b} style={{ width: 60, height: 60, fontSize: 20 }} />
          <Pad mask={BTN.A} label="A" held={!!(held & BTN.A)} round fill={PAD.a} style={{ width: 60, height: 60, fontSize: 20, marginBottom: 22 }} />
        </div>
      </div>

      {/* Below everything, and small. Select and Start are pressed a handful
          of times an hour; a thumb travelling between the pad and the face
          buttons should never cross them. */}
      <div style={{ display: "flex", justifyContent: "center", gap: 18, padding: "14px 0 6px" }}>
        <div
          onPointerDown={(event) => {
            event.preventDefault();
            haptic();
            onRun();
          }}
          title="Hold B automatically while walking, so you run without pinning a thumb to B."
          style={{
            ...system,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: "pointer",
            userSelect: "none",
            touchAction: "none",
            background: run ? PAD.b : PAD.system,
            color: run ? "#1a0d15" : "#c3cdf5",
          }}
        >
          RUN {run ? "ON" : "OFF"}
        </div>
        <Pad mask={BTN.SELECT} label="SELECT" held={!!(held & BTN.SELECT)} fill={PAD.system} ink="#c3cdf5" style={system} />
        <Pad mask={BTN.START} label="START" held={!!(held & BTN.START)} fill={PAD.system} ink="#c3cdf5" style={system} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Account
// ----------------------------------------------------------------------------

function SignIn({ onDone }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (sent) {
    return (
      <div style={{ ...panel, padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Check your email</div>
        <div style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.5 }}>
          A sign-in link is on its way to {email}. Open it on this device.
        </div>
      </div>
    );
  }

  const send = async () => {
    setError("");
    if (!/.+@.+\..+/.test(email.trim())) return setError("Enter a valid email.");
    setBusy(true);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
      onDone?.();
    } catch (e) {
      setError(e.message || "Sign-in failed.");
    }
    setBusy(false);
  };

  return (
    <div style={{ ...panel, padding: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>Sync across devices</div>
      <div style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
        Optional. Signing in keeps your cartridges and saves on the server, so a
        cleared browser or a second device does not lose them.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          style={{
            flex: "1 1 200px",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            color: "var(--text)",
            borderRadius: 9,
            padding: "10px 12px",
            fontSize: 15,
            outline: "none",
          }}
        />
        <Button onClick={send} tone="accent" disabled={busy}>
          {busy ? "Sending…" : "Email a link"}
        </Button>
      </div>
      {error && <div style={{ color: "var(--accent2)", fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function Library({ roms, onPlay, onForget, busy }) {
  if (!roms.length) return null;
  return (
    <div style={{ ...panel, padding: 14, marginTop: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Your cartridges</div>
      {roms.map((rom) => (
        <div key={rom.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {rom.title || rom.gameCode || rom.id.slice(0, 12)}
            </div>
            <div style={{ color: "var(--dim)", fontSize: 12 }}>
              {rom.gameCode} · {(rom.bytes / 1048576).toFixed(0)} MB
            </div>
          </div>
          <Button onClick={() => onPlay(rom)} disabled={busy} style={{ padding: "7px 12px" }}>
            Play
          </Button>
          <button
            onClick={() => onForget(rom)}
            style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", fontSize: 13 }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function Home({
  onPick,
  error,
  busy,
  user,
  library,
  backupError,
  onPlayCloud,
  onForgetCloud,
  onSignOut,
  loaded,
  onResume,
  stateEntries,
  coreVersion,
  onResumeState,
  onRemoveState,
}) {
  return (
    <div style={{ padding: 24, maxWidth: 620, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, margin: "8px 0 4px" }}>Game Boy Advance</h1>
      <p style={{ color: "var(--dim)", fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        A Rust emulator core compiled to WebAssembly. Cartridges and saves stay
        on this device unless you sign in.
      </p>

      {loaded && (
        <Button tone="accent" onClick={onResume} style={{ width: "100%", padding: "16px", fontSize: 16, marginBottom: 14 }}>
          Resume {loaded}
        </Button>
      )}

      {stateEntries.length > 0 && (
        <div style={{ ...panel, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Pick up where you left off</div>
          <div style={{ color: "var(--dim)", fontSize: 12, marginBottom: 4 }}>
            Every state carries the frame that was on screen when it was taken.
          </div>
          {stateEntries.map((entry) => (
            <StateRow
              key={entry.id}
              entry={entry}
              coreVersion={coreVersion}
              showGame
              onLoad={onResumeState}
              onRemove={onRemoveState}
            />
          ))}
        </div>
      )}

      <label style={{ ...panel, display: "block", padding: 20, textAlign: "center", cursor: "pointer", borderStyle: "dashed" }}>
        <input
          type="file"
          accept=".gba,application/octet-stream"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(file);
          }}
        />
        <div style={{ fontWeight: 600 }}>{busy ? "Loading…" : "Choose a ROM"}</div>
        <div style={{ color: "var(--dim)", fontSize: 13, marginTop: 6 }}>.gba, up to 32 MB</div>
      </label>

      {error && <p style={{ color: "var(--accent2)", fontSize: 14 }}>{error}</p>}
      {backupError && <p style={{ color: "var(--accent2)", fontSize: 13, lineHeight: 1.5 }}>{backupError}</p>}

      {cloud.configured && !user && <div style={{ marginTop: 14 }}><SignIn /></div>}
      {user && (
        <>
          {!library.loaded && <p style={{ color: "var(--dim)", fontSize: 13 }}>Loading your cartridges…</p>}
          {library.loaded && library.roms.length === 0 && (
            <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.5 }}>
              No cartridges on the server yet. Choose one above and it uploads
              automatically — then it will be here on your other devices.
            </p>
          )}
          <Library roms={library.roms} onPlay={onPlayCloud} onForget={onForgetCloud} busy={busy} />
          <div style={{ color: "var(--dim)", fontSize: 12, marginTop: 12 }}>
            Signed in as {user.email}{" "}
            <button onClick={onSignOut} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12 }}>
              Sign out
            </button>
          </div>
        </>
      )}

      <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.6, marginTop: 20 }}>
        No audio — that is deliberate, not missing. Keyboard: arrows to move,
        Z and X for A and B, Enter for Start, Backspace for Select, A and S for
        the shoulders. Hold space for 8× while you hold it; shift+space latches
        4×.
      </p>
    </div>
  );
}

// Two saves have diverged. The user decides; nothing is discarded on their
// behalf. "Keep both" hands them the other side as a file first.
function Conflict({ mine, theirs, onKeepMine, onKeepTheirs, onKeepBoth }) {
  const line = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0" }}>
      <span style={{ color: "var(--dim)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }}>
      <div style={{ ...panel, padding: 20, maxWidth: 460, width: "100%" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Two saves have diverged</h2>
        <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.5, marginTop: 0 }}>
          This device and the server both moved on from the same point. Nothing
          is overwritten until you choose.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "14px 0" }}>
          <div style={{ ...panel, padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>This device</div>
            {line("version", mine.version)}
            {line("size", `${(mine.bytes / 1024) | 0} KB`)}
          </div>
          <div style={{ ...panel, padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Server</div>
            {line("version", theirs.version)}
            {line("device", theirs.device || "—")}
            {line("saved", new Date(theirs.updatedAt).toLocaleString())}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={onKeepMine} tone="accent">Keep this device's</Button>
          <Button onClick={onKeepTheirs}>Keep the server's</Button>
          <Button onClick={onKeepBoth}>Keep both</Button>
        </div>
        <p style={{ color: "var(--dim)", fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
          Whichever you pick, the last {10} versions stay on the server and can
          be recovered.
        </p>
      </div>
    </div>
  );
}

/** A state's screenshot, fetched from this browser or the account. */
function Thumb({ entry, width = 120 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let dead = false;
    let made = null;
    states.thumbnail(entry).then((u) => {
      if (dead) return URL.revokeObjectURL(u);
      made = u;
      setUrl(u);
    });
    return () => {
      dead = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [entry.id]);

  return (
    <div
      style={{
        width,
        aspectRatio: `${WIDTH} / ${HEIGHT}`,
        background: "#000",
        borderRadius: 6,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {url && <img src={url} alt="" style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />}
    </div>
  );
}

function stamp(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** One row in a state list: screenshot, name, where and when it came from. */
function StateRow({ entry, coreVersion, onLoad, onRemove, onRename, showGame }) {
  const stale = entry.coreVersion !== undefined && entry.coreVersion !== coreVersion;
  const here = entry.device && entry.device === cloud.deviceId();
  const where = entry.device ? (here ? "this device" : entry.device) : null;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        flexWrap: "wrap",
        padding: "10px 0",
        borderTop: "1px solid var(--line)",
      }}
    >
      <Thumb entry={entry} width={96} />
      <div style={{ flex: "1 1 150px", minWidth: 0 }}>
        {/* Wraps rather than truncating: the name is how you tell two states
            apart, so hiding it defeats the list. */}
        <div style={{ fontSize: 14, lineHeight: 1.35, overflowWrap: "anywhere" }}>{entry.name}</div>
        <div style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.5 }}>
          {[showGame && entry.gameCode, stamp(entry.createdAt), where, !entry.local && entry.remote ? "cloud" : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {stale && (
          <div style={{ color: "var(--accent2)", fontSize: 12 }}>
            From an older build of the emulator — cannot be loaded.
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
        <Button onClick={() => onLoad(entry)} disabled={stale} style={{ padding: "7px 12px" }}>
          Load
        </Button>
        {onRename && (
          <button
            onClick={() => onRename(entry)}
            style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", fontSize: 13 }}
          >
            Rename
          </button>
        )}
        <button
          onClick={() => {
            // A state is someone's afternoon; a mistap should not take it.
            if (window.confirm(`Delete "${entry.name}"?`)) onRemove(entry);
          }}
          style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", fontSize: 13 }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Save states for one cartridge: take a new one, or go back to an old one. */
function StatePanel({ entries, coreVersion, busy, onSave, onLoad, onRemove, onRename, onClose }) {
  const [name, setName] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }}>
      <div style={{ ...panel, padding: 20, maxWidth: 560, width: "100%", maxHeight: "86dvh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Save states</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            placeholder="Name this state (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (onSave(name), setName(""))}
            style={{
              flex: 1,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              color: "var(--text)",
              borderRadius: 9,
              padding: "10px 12px",
              fontSize: 15,
              outline: "none",
            }}
          />
          <Button
            tone="accent"
            disabled={busy}
            onClick={() => {
              onSave(name);
              setName("");
            }}
          >
            {busy ? "Saving…" : "Save state"}
          </Button>
        </div>
        {entries.length === 0 && (
          <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.5 }}>
            None yet. A state captures the exact moment you are at, screenshot
            and all — useful before a boss, or to hand a run to your other
            device mid-battle.
          </p>
        )}
        {entries.map((entry) => (
          <StateRow
            key={entry.id}
            entry={entry}
            coreVersion={coreVersion}
            onLoad={onLoad}
            onRemove={onRemove}
            onRename={onRename}
          />
        ))}
        <div style={{ marginTop: 14 }}>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// The point of keeping ten versions is being able to go back to one. Without
// this the retention is invisible and might as well not exist.
// What a phase means to the person waiting through it. The wording matters
// more than usual here: every one of these is a moment where nothing visible
// is happening and the natural read is that it has broken.
const LINK_PHASES = {
  connecting: "Connecting…",
  waiting: "Waiting for your friend to join",
  greeting: "Saying hello…",
  saves: "Swapping cartridge saves…",
  live: "Linked",
  over: "Session ended",
};

function LinkPanel({ link, onHost, onJoin, onLeave, onClose, error }) {
  const [entry, setEntry] = useState("");
  const [copied, setCopied] = useState(false);
  const live = link && link.phase === "live";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access is not worth an error message; the code is on screen.
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }}>
      <div style={{ ...panel, padding: 20, maxWidth: 420, width: "100%" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Link with a friend</h2>
        <p style={{ color: "var(--dim)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
          Trade or battle over an emulated link cable. Both of you need the same
          cartridge. Both consoles restart and load your saves — the same as
          plugging a real cable between two Game Boys — so walk to the Cable
          Club counter once you are in.
        </p>

        {error && (
          <p style={{ color: "var(--accent2)", fontSize: 13, marginTop: 0 }}>{error}</p>
        )}

        {!link && (
          <>
            <Button onClick={onHost} tone="accent" style={{ width: "100%", padding: "12px" }}>
              Start a session
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 10px" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span style={{ color: "var(--dim)", fontSize: 12 }}>or join one</span>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (entry.trim().length >= 4) onJoin(entry.trim().toUpperCase());
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                value={entry}
                onChange={(event) => {
                  // Codes are drawn from an alphabet with no O, I or L, so
                  // anything else is a typo or a stray game key rather than
                  // something worth keeping.
                  const next = event.target.value
                    .toUpperCase()
                    .replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, "")
                    .slice(0, 6);
                  setEntry(next);
                  if (next.length === 6) onJoin(next);
                }}
                placeholder="CODE"
                inputMode="text"
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1,
                  ...panel,
                  padding: "11px 14px",
                  fontSize: 18,
                  letterSpacing: 3,
                  fontFamily: "ui-monospace, monospace",
                  color: "var(--text)",
                  background: "#0d1220",
                }}
              />
              <Button style={{ padding: "11px 16px" }}>Join</Button>
            </form>
          </>
        )}

        {link && (
          <>
            <div
              onClick={copy}
              style={{
                ...panel,
                padding: "14px 16px",
                textAlign: "center",
                cursor: "pointer",
                background: "#0d1220",
              }}
            >
              <div style={{ color: "var(--dim)", fontSize: 11, letterSpacing: 1 }}>
                {copied ? "COPIED" : "SHARE THIS CODE"}
              </div>
              <div
                style={{
                  fontSize: 30,
                  letterSpacing: 7,
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 700,
                  marginTop: 2,
                }}
              >
                {link.code}
              </div>
            </div>
            <p style={{ fontSize: 13, color: live ? "var(--accent)" : "var(--dim)", marginBottom: 4 }}>
              {LINK_PHASES[link.phase] || link.phase}
              {link.phase === "live" && ` · you are player ${link.seat + 1}`}
            </p>
            {link.phase !== "live" && link.phase !== "over" && (
              <p style={{ fontSize: 12, color: "var(--dim)", marginTop: 0 }}>
                Keep this tab open. A phone that sleeps drops the connection.
              </p>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {link && <Button onClick={onLeave}>End session</Button>}
          <Button onClick={onClose}>{live ? "Back to the game" : "Close"}</Button>
        </div>
      </div>
    </div>
  );
}

function History({ versions, current, onRestore, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }}>
      <div style={{ ...panel, padding: 20, maxWidth: 420, width: "100%", maxHeight: "80dvh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Save history</h2>
        {versions.length === 0 && <p style={{ color: "var(--dim)", fontSize: 13 }}>Nothing on the server yet.</p>}
        {versions.map((entry) => (
          <div key={entry.version} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>
                v{entry.version}
                {entry.version === current && <span style={{ color: "var(--accent)" }}> · current</span>}
              </div>
              <div style={{ color: "var(--dim)", fontSize: 12 }}>
                {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : ""} · {(entry.bytes / 1024) | 0} KB
              </div>
            </div>
            <Button onClick={() => onRestore(entry)} style={{ padding: "7px 12px" }}>
              Restore
            </Button>
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Player
// ----------------------------------------------------------------------------

function Player({ core, rom, romSha, user, backup, backupError, onBackup, onEject, pendingState, onStateConsumed }) {
  const canvasRef = useRef(null);
  const keysRef = useRef(0);
  const speedRef = useRef(1);
  const [speed, setSpeed] = useState(1);
  const [fps, setFps] = useState(0);
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [history, setHistory] = useState(null);
  const [stateList, setStateList] = useState(null);
  const [savingState, setSavingState] = useState(false);

  // A link session. `sessionRef` is the transport; `liveRef` is the flag the
  // frame loop reads, kept separate so the loop never depends on React state
  // and so a re-render cannot restart a session.
  const sessionRef = useRef(null);
  const liveRef = useRef(null);
  const partnerRef = useRef(null);
  const [link, setLink] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [waiting, setWaiting] = useState(false);

  // Turbo walk: hold B for the player, but only while a direction is held.
  // In these games running is B plus a direction, and on a phone that means
  // pinning one thumb to B and steering with the other -- which is exactly the
  // thumb you also want on A. Latching it here costs nothing and, gated on the
  // d-pad, is invisible everywhere else: menus and battles never see the held
  // button, so RUN can stay on for a whole session.
  const runRef = useRef(false);
  const [run, setRun] = useState(false);
  const toggleRun = useCallback(() => {
    runRef.current = !runRef.current;
    setRun(runRef.current);
  }, []);

  // Fast-forward, with no timing heuristic on the keyboard.
  //
  // It used to guess tap from hold by how long the key was down, and guessed
  // wrong: a deliberate keypress easily outlasts the threshold, so an intended
  // tap read as a hold and dropped straight back to normal speed on release.
  // Each gesture now has its own key and exactly one meaning.
  //
  //   space         8x for as long as it is held, then back
  //   shift + space latch between normal and 4x
  //
  // The on-screen control has no modifier key available, so it keeps a
  // press-and-hold, with a threshold long enough to be deliberate.
  const HOLD_MS = 320;
  const baseSpeed = useRef(1);
  const turbo = useRef(false);
  const holdTimer = useRef(null);

  const applySpeed = useCallback(() => {
    const value = turbo.current ? 8 : baseSpeed.current;
    speedRef.current = value;
    setSpeed(value);
  }, []);

  const setTurbo = useCallback(
    (on) => {
      if (turbo.current === on) return;
      turbo.current = on;
      applySpeed();
    },
    [applySpeed]
  );

  const toggleBase = useCallback(() => {
    baseSpeed.current = baseSpeed.current === 1 ? 4 : 1;
    applySpeed();
  }, [applySpeed]);

  // Pointer input keeps the press-and-hold, since a touchscreen has no shift.
  const speedPressStart = useCallback(() => {
    if (holdTimer.current !== null || turbo.current) return;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setTurbo(true);
    }, HOLD_MS);
  }, [setTurbo]);

  const speedPressEnd = useCallback(() => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (turbo.current) setTurbo(false);
    else toggleBase();
  }, [setTurbo, toggleBase]);

  useEffect(() => () => clearTimeout(holdTimer.current), []);
  const saveTimer = useRef(null);
  const keyRef = useRef("");

  // The signed-in user is read through a ref, never a dependency.
  //
  // Supabase re-validates the session whenever the tab regains focus and
  // hands back a *new* user object each time. Depending on that object made
  // the boot effect re-run on every focus change, which called gba_init and
  // restarted the game: tabbing away and back looked like a crash. Nothing
  // about who is signed in should ever reset the machine.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Which cartridge is actually running, and whether it has finished booting.
  // Booting is guarded on this rather than on the effect's dependencies, so a
  // re-render for *any* reason cannot restart a game in progress. Depending on
  // the effect deps alone means every future edit to this component is one
  // stray dependency away from wiping someone's afternoon.
  const bootedRef = useRef("");
  const [booted, setBooted] = useState(false);

  const flash = useCallback((message) => {
    setNote(message);
    setTimeout(() => setNote(""), 2200);
  }, []);

  // While linked, the machine that matters is the one in the cable, not the
  // single-player instance sitting idle beside it.
  const readSave = useCallback(() => {
    const live = liveRef.current;
    return live
      ? readTransfer(core, core.gba_link_read_save(live.seat))
      : readTransfer(core, core.gba_read_save());
  }, [core]);

  const clearDirty = useCallback(() => {
    const live = liveRef.current;
    if (live) core.gba_link_clear_save_dirty(live.seat);
    else core.gba_clear_save_dirty();
  }, [core]);

  // Load a save into the running machine by rebooting with it.
  const adopt = useCallback(
    (save) => {
      const romPtr = intoWasm(core, rom);
      const savePtr = intoWasm(core, save);
      core.gba_init(romPtr, rom.length, savePtr, save.length);
      core.gba_free(savePtr, save.length);
      core.gba_free(romPtr, rom.length);
    },
    [core, rom]
  );

  // Persist locally, then push if there is somewhere to push to.
  const persist = useCallback(
    async ({ manual = false } = {}) => {
      const key = keyRef.current;
      if (!key) return;
      const save = readSave();
      if (!save) return;
      await dbPut(`sav:${key}`, save);
      clearDirty();

      const meta = await localMeta(key);
      const account = userRef.current;
      if (!account || !cloud.configured) {
        await setLocalMeta(key, { ...meta, dirty: true });
        if (manual) flash("Saved locally");
        return;
      }

      setSyncing(true);
      try {
        const result = await cloud.pushSave(key, save, meta.version);
        if (result.conflict && result.meta) {
          setConflict({
            mine: { version: meta.version + 1, bytes: save.length, save },
            theirs: result.meta,
          });
          await setLocalMeta(key, { ...meta, dirty: true });
        } else if (result.conflict) {
          await setLocalMeta(key, { ...meta, dirty: true });
          flash("Sync raced — try Sync now");
        } else {
          await setLocalMeta(key, { version: result.meta.version, dirty: false });
          flash(`Synced v${result.meta.version}`);
        }
      } catch (e) {
        // A failed push is not a failed save: the local copy already landed.
        await setLocalMeta(key, { ...meta, dirty: true });
        flash("Saved locally — sync failed");
        console.error(e);
      }
      setSyncing(false);
    },
    [core, readSave, clearDirty, flash]
  );

  // Boot, then reconcile with the server before the game gets far.
  useEffect(() => {
    if (bootedRef.current === romSha) return;
    bootedRef.current = romSha;
    setBooted(false);

    let cancelled = false;
    (async () => {
      const romPtr = intoWasm(core, rom);
      core.gba_init(romPtr, rom.length, 0, 0);
      const gameCode = gameCodeOf(core);
      const key = cloud.saveKey(gameCode, romSha);
      keyRef.current = key;

      // Saves used to be keyed on the game code alone; carry one forward
      // rather than stranding it.
      let local = (await dbGet(`sav:${key}`)) || (await dbGet(`sav:${gameCode}`));
      let meta = await localMeta(key);

      if (userRef.current && cloud.configured) {
        try {
          const remote = await cloud.pullSave(key);
          if (remote) {
            if (!local || (!meta.dirty && remote.meta.version > meta.version)) {
              // Nothing local worth keeping, or the server is simply ahead.
              local = remote.bytes;
              await dbPut(`sav:${key}`, local);
              meta = { version: remote.meta.version, dirty: false };
              await setLocalMeta(key, meta);
            } else if (meta.dirty && remote.meta.version > meta.version) {
              if (!cancelled) {
                setConflict({
                  mine: { version: meta.version + 1, bytes: local.length, save: local },
                  theirs: remote.meta,
                });
              }
            }
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (!cancelled && local) {
        const savePtr = intoWasm(core, local);
        core.gba_init(romPtr, rom.length, savePtr, local.length);
        core.gba_free(savePtr, local.length);
      }
      // The core keeps its own copy, so the staging buffer is dead weight --
      // 16 MB of it, which matters on a phone.
      core.gba_free(romPtr, rom.length);

      if (!cancelled) {
        setCode(gameCode);
        setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the cartridge alone: booting is about which ROM
    // is loaded, nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, rom, romSha]);

  // A state chosen on the library screen is applied once the machine is up.
  // It goes on last because it supersedes everything, cartridge save included.
  useEffect(() => {
    if (!booted || !pendingState) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await states.load(pendingState);
        if (cancelled) return;
        const ptr = intoWasm(core, bytes);
        core.gba_write_state(ptr, bytes.length);
        core.gba_free(ptr, bytes.length);
      } catch (e) {
        console.error(e);
      }
      onStateConsumed?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, pendingState?.id]);

  // Leaving a session hands the machine back to the single-player path exactly
  // where the cable left it -- otherwise a trade you just made would vanish
  // when you closed the panel.
  const endLink = useCallback(
    (reason) => {
      const live = liveRef.current;
      if (live) {
        const length = core.gba_link_read_state(live.seat);
        if (length) {
          const state = readTransfer(core, length);
          const ptr = intoWasm(core, state);
          core.gba_write_state(ptr, state.length);
          core.gba_free(ptr, state.length);
        }
        liveRef.current = null;
        core.gba_link_end();
        persist();
      }
      sessionRef.current = null;
      setLink(null);
      if (reason) setLinkError(reason);
    },
    [core, persist]
  );

  const startLink = useCallback(
    (code, host) => {
      if (sessionRef.current) return;
      setLinkError("");
      // The linked machines boot from the cartridge save, so a cartridge whose
      // flash has never been touched boots into a new game -- with none of the
      // party you were hoping to trade. This only catches the never-played
      // case: a game that has initialised its flash without the player ever
      // saving looks the same from here, and telling those apart would mean
      // knowing this particular game's save format.
      if (readSave().length === 0) {
        return setLinkError(
          "This cartridge has no save yet. Save in the game first, or the linked session will start a new one."
        );
      }
      let started;
      try {
        started = netplay.session({
          code,
          host,
          romSha,
          save: readSave(),
          local: netplay.loopback,
          onChange: (next) => {
            setLink(next);
            // The cable is wired the moment both saves are in hand. Unit 0 is
            // the parent, and which player that is has to be the same on both
            // devices or the two sides boot different machines.
            if (next.phase === "live" && !liveRef.current && next.partnerSave) {
              const mine = readSave();
              const [a, b] = next.seat === 0 ? [mine, next.partnerSave] : [next.partnerSave, mine];
              const romPtr = intoWasm(core, rom);
              const aPtr = intoWasm(core, a);
              const bPtr = intoWasm(core, b);
              core.gba_link_init(romPtr, rom.length, aPtr, a.length, bPtr, b.length);
              core.gba_free(bPtr, b.length);
              core.gba_free(aPtr, a.length);
              core.gba_free(romPtr, rom.length);
              liveRef.current = { seat: next.seat };
              // Fast-forward is meaningless in lockstep: you can only run as
              // fast as the other side sends input.
              baseSpeed.current = 1;
              turbo.current = false;
              applySpeed();
              setLinkOpen(false);
            }
          },
          onEnd: (reason) => endLink(reason || ""),
        });
      } catch (e) {
        return setLinkError(e.message || String(e));
      }
      sessionRef.current = started;
      setLink(started.state);
    },
    [core, rom, romSha, readSave, endLink, applySpeed]
  );

  // The transport announces phase changes, not every frame. The health
  // readout moves constantly, so it is polled -- twice a second is enough to
  // watch a connection degrade, and re-rendering the player sixty times a
  // second to show a number would cost more than the number is worth.
  useEffect(() => {
    if (!link || link.phase !== "live") return;
    let previous = -1;
    let still = 0;
    const tick = setInterval(() => {
      if (!sessionRef.current) return;
      const next = sessionRef.current.state;
      // A session that stops advancing is almost always the other person's
      // tab going to the background, where the browser cuts animation frames
      // to about one a second. Lockstep means their pause is your pause, so
      // say whose it is -- a frozen picture with no explanation reads as a
      // crash.
      still = next.frame === previous ? still + 1 : 0;
      previous = next.frame;
      setWaiting(still >= 2);
      setLink(next);
    }, 500);
    return () => {
      clearInterval(tick);
      setWaiting(false);
    };
  }, [link?.phase]);

  // A tab that closes mid-session should tell the other side rather than
  // leaving them staring at a stall.
  useEffect(() => {
    const bail = () => sessionRef.current && sessionRef.current.leave();
    window.addEventListener("pagehide", bail);
    return () => {
      window.removeEventListener("pagehide", bail);
      if (sessionRef.current) sessionRef.current.leave();
    };
  }, []);

  // The frame loop. Time is accumulated rather than assuming one animation
  // frame equals one GBA frame, so a 120 Hz display does not run the game at
  // double speed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = false;
    const image = ctx.createImageData(WIDTH, HEIGHT);

    let handle = 0;
    let last = performance.now();
    let owed = 0;
    let drawn = 0;
    let counted = last;

    const loop = (now) => {
      handle = requestAnimationFrame(loop);
      const period = 1000 / (FPS * speedRef.current);
      owed += Math.min(now - last, 250);
      last = now;

      let ran = 0;
      let stalled = false;
      const live = liveRef.current;
      // Cap the catch-up so a backgrounded tab does not return and try to
      // simulate a minute of gameplay in one frame.
      while (owed >= period && ran < 16) {
        let keys = keysRef.current;
        if (runRef.current && keys & DPAD) keys |= BTN.B;
        if (live) {
          // A frame cannot run until both players' inputs for it are known.
          // Waiting is the only correct answer: an invented input is a session
          // where the two sides are playing different games and neither knows.
          const pair = sessionRef.current && sessionRef.current.advance(keys);
          if (!pair) {
            stalled = true;
            break;
          }
          core.gba_link_run_frame(pair[0], pair[1]);
          if (sessionRef.current.needsHash()) {
            sessionRef.current.report(core.gba_link_hash());
          }
        } else {
          core.gba_run_frame(keys);
        }
        owed -= period;
        ran += 1;
      }
      // Stalling banks time so the session catches up once input arrives, but
      // only so much: a ten-second hiccup should not become a ten-second
      // fast-forward.
      if (stalled) owed = Math.min(owed, period * 30);
      if (ran === 0) return;

      const ptr = live ? core.gba_link_pixels(live.seat) : core.gba_pixels();
      image.data.set(new Uint8Array(core.memory.buffer, ptr, WIDTH * HEIGHT * 4));
      ctx.putImageData(image, 0, 0);

      // The partner's screen, which is free: this device is already simulating
      // their machine. Seeing whether they have reached the counter yet is
      // most of what the two of you would otherwise be typing to each other.
      if (live && partnerRef.current) {
        const other = core.gba_link_pixels_alt(live.seat ^ 1);
        const view = partnerRef.current.getContext("2d");
        const frame = view.createImageData(WIDTH, HEIGHT);
        frame.data.set(new Uint8Array(core.memory.buffer, other, WIDTH * HEIGHT * 4));
        view.putImageData(frame, 0, 0);
      }

      drawn += ran;
      if (now - counted >= 500) {
        setFps(Math.round((drawn * 1000) / (now - counted)));
        drawn = 0;
        counted = now;
      }

      // Persist a few seconds after the cartridge stops being written, which
      // is when the game has finished its save rather than mid-erase.
      const dirty = live ? core.gba_link_save_dirty(live.seat) : core.gba_save_dirty();
      if (dirty && !saveTimer.current) {
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          persist();
        }, 3000);
      }
    };

    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [core, persist]);

  // Flush on the way out. iOS can kill a backgrounded tab without warning, so
  // hiding the page is the last reliable moment to write.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && core.gba_save_dirty()) persist();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [core, persist]);

  useEffect(() => {
    const down = (event) => {
      if (typing(event)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (event.repeat) return;
        // Shift latches the speed; space alone is momentary turbo.
        if (event.shiftKey) toggleBase();
        else setTurbo(true);
        return;
      }
      const mask = KEYBOARD[event.code];
      if (mask) {
        event.preventDefault();
        keysRef.current |= mask;
      }
    };
    const up = (event) => {
      if (typing(event)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setTurbo(false);
        return;
      }
      const mask = KEYBOARD[event.code];
      if (mask) {
        event.preventDefault();
        keysRef.current &= ~mask;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setTurbo, toggleBase]);

  const press = useCallback((mask) => {
    keysRef.current |= mask;
  }, []);
  const release = useCallback((mask) => {
    keysRef.current &= ~mask;
  }, []);
  const { held: padHeld, handlers: padHandlers } = usePads(press, release);
  const [buzz, setBuzz] = useState(hapticsEnabled);


  // A state is only useful if you can tell which one it is, so every save
  // carries the frame that was on screen when it was taken.
  const screenshot = () =>
    new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas?.toBlob) return resolve(null);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
    });

  const refreshStates = useCallback(async () => {
    const all = await states.list(userRef.current);
    setStateList(all.filter((entry) => entry.key === keyRef.current));
  }, []);

  const openStates = async () => {
    setStateList([]);
    await refreshStates();
  };

  const saveState = async (name) => {
    setSavingState(true);
    try {
      const state = readTransfer(core, core.gba_read_state());
      if (!state) return flash("Nothing to save yet");
      const result = await states.save(userRef.current, {
        key: keyRef.current,
        romSha,
        gameCode: code,
        name: name?.trim(),
        device: cloud.deviceId(),
        coreVersion: core.gba_state_version(),
        state,
        thumbnail: await screenshot(),
      });
      await refreshStates();
      flash(result.error ? "Saved on this device only" : "State saved");
    } catch (e) {
      flash("Could not save the state");
      console.error(e);
    }
    setSavingState(false);
  };

  const loadState = async (entry) => {
    try {
      const bytes = await states.load(entry);
      const ptr = intoWasm(core, bytes);
      const ok = core.gba_write_state(ptr, bytes.length);
      core.gba_free(ptr, bytes.length);
      if (ok) {
        setStateList(null);
        flash(`Loaded "${entry.name}"`);
      } else {
        flash("That state is from a different build");
      }
    } catch (e) {
      flash("Could not load that state");
      console.error(e);
    }
  };

  const removeState = async (entry) => {
    await states.remove(userRef.current, entry);
    await refreshStates();
  };

  const renameState = async (entry) => {
    const name = window.prompt("Name this state", entry.name);
    if (name === null) return;
    await states.rename(userRef.current, entry, name.trim() || entry.name);
    await refreshStates();
  };

  const exportSave = () => {
    const save = readSave();
    if (!save) return flash("This cartridge has no save");
    download(save, `${code}.sav`);
  };

  // Re-seed the cartridge from a .sav file. Worth having even with sync:
  // it is how a save arrives from another emulator or a real cartridge dump.
  const importSave = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    adopt(bytes);
    await dbPut(`sav:${keyRef.current}`, bytes);
    const meta = await localMeta(keyRef.current);
    await setLocalMeta(keyRef.current, { ...meta, dirty: true });
    flash("Save imported");
  };

  const resolve = async (choice) => {
    const key = keyRef.current;
    const { mine, theirs } = conflict;
    setConflict(null);
    setSyncing(true);
    try {
      if (choice === "theirs" || choice === "both") {
        const bytes = await cloud.getBlob(theirs.path);
        if (choice === "both") {
          // Hand the losing side over as a file before it stops being the
          // live save; never discard either copy silently.
          download(bytes, `${code}-server-v${theirs.version}.sav`);
        }
        if (choice === "theirs") {
          adopt(bytes);
          await dbPut(`sav:${key}`, bytes);
          await setLocalMeta(key, { version: theirs.version, dirty: false });
          flash(`Using the server's v${theirs.version}`);
        }
      }
      if (choice === "mine" || choice === "both") {
        const result = await cloud.overwriteSave(key, mine.save, theirs.version);
        if (result.ok) {
          await setLocalMeta(key, { version: result.meta.version, dirty: false });
          flash(`Pushed v${result.meta.version}`);
        } else {
          flash("The server moved again — try Sync now");
        }
      }
    } catch (e) {
      flash("Could not resolve — nothing was changed");
      console.error(e);
    }
    setSyncing(false);
  };

  const openHistory = async () => {
    setSyncing(true);
    try {
      setHistory(await cloud.saveHistory(keyRef.current));
    } catch (e) {
      flash("Could not read history");
      console.error(e);
    }
    setSyncing(false);
  };

  // Restoring rolls forward rather than rewriting the past: the old blob is
  // pushed as a new version, so the history stays append-only and the restore
  // itself can be undone.
  const restore = async (entry) => {
    setHistory(null);
    setSyncing(true);
    try {
      const bytes = await cloud.getBlob(entry.path);
      adopt(bytes);
      const key = keyRef.current;
      await dbPut(`sav:${key}`, bytes);
      const meta = await cloud.saveMeta(key);
      const result = await cloud.pushSave(key, bytes, meta?.version || 0);
      if (result.ok) {
        await setLocalMeta(key, { version: result.meta.version, dirty: false });
        flash(`Restored v${entry.version} as v${result.meta.version}`);
      } else {
        await setLocalMeta(key, { version: meta?.version || 0, dirty: true });
        flash("The server moved — try again");
      }
    } catch (e) {
      flash("Could not restore");
      console.error(e);
    }
    setSyncing(false);
  };

  const status = syncing
    ? "syncing…"
    : !user
      ? "local only"
      : backup === "uploading"
        ? "uploading cartridge…"
        : backup === "saved"
          ? "backed up"
          : backup === "error"
            ? "not backed up"
            : "synced";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", fontSize: 13, color: "var(--dim)" }}>
        <strong style={{ color: "var(--text)" }}>{code || "…"}</strong>
        <span>{fps} fps</span>
        <span style={{ color: backup === "error" ? "var(--accent2)" : undefined }}>{status}</span>
        {note && <span style={{ color: "var(--accent)" }}>{note}</span>}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => {
            setHaptics(!buzz);
            setBuzz(!buzz);
            haptic();
          }}
          title="Vibrate on each button press"
          style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", fontSize: 13, opacity: buzz ? 1 : 0.55 }}
        >
          {buzz ? "Buzz on" : "Buzz off"}
        </button>
        <button onClick={onEject} style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", fontSize: 13 }}>
          Library
        </button>
      </div>

      <Shoulders held={padHeld} handlers={padHandlers} />

      <div style={{ position: "relative", maxWidth: 720, margin: "0 auto", width: "100%" }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          style={{
            width: "100%",
            aspectRatio: `${WIDTH} / ${HEIGHT}`,
            display: "block",
            background: "#000",
          }}
        />
        {waiting && link && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              background: "rgba(6,9,17,.72)",
              color: "var(--text)",
              textAlign: "center",
              padding: 16,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              Waiting for Player {(link.seat ^ 1) + 1}
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", maxWidth: 280, lineHeight: 1.5 }}>
              Both consoles run in step, so the game only moves as fast as the
              slower side. If they have switched tabs or their phone has slept,
              it will pick up the moment they come back.
            </div>
          </div>
        )}
      </div>

      {link && link.phase === "live" && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: "10px 14px 0",
            maxWidth: 720,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <canvas
            ref={partnerRef}
            width={WIDTH}
            height={HEIGHT}
            style={{
              width: 132,
              aspectRatio: `${WIDTH} / ${HEIGHT}`,
              background: "#000",
              borderRadius: 6,
              border: "1px solid var(--line)",
              imageRendering: "pixelated",
              flex: "0 0 auto",
            }}
          />
          <div data-role="link-status" style={{ fontSize: 12, lineHeight: 1.5, minWidth: 0 }}>
            <div style={{ color: "var(--accent)", fontWeight: 600 }}>
              Player {(link.seat ^ 1) + 1}
            </div>
            <div style={{ color: "var(--dim)" }}>
              {/* Lead is how many frames of their input are still in hand. It
                  is the one number that predicts a stutter before it happens,
                  so it is the one worth showing. */}
              {link.lead > 0 ? `${link.lead} frames of slack` : "waiting for input…"}
            </div>
            <div style={{ color: link.stalls > 0 ? "var(--accent2)" : "var(--dim)" }}>
              {link.stalls > 0 ? `${link.stalls} stalls` : "no stalls"}
            </div>
            <div style={{ color: "var(--dim)" }}>code {link.code}</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            haptic();
            speedPressStart();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            speedPressEnd();
          }}
          onPointerCancel={speedPressEnd}
          onLostPointerCapture={speedPressEnd}
          title="Tap for 4×, hold for 8×. Keyboard: shift+space to latch 4×, space held for 8×."
          style={{
            ...panel,
            background: speed > 1 ? "var(--accent)" : "var(--panel)",
            borderColor: speed > 1 ? "var(--accent)" : "var(--line)",
            color: speed > 1 ? "#fff" : "var(--text)",
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            touchAction: "none",
            userSelect: "none",
          }}
        >
          {speed}× {speed === 8 ? "turbo" : "speed"}
        </button>
        <Button onClick={openStates}>States</Button>
        <Button
          onClick={() => setLinkOpen(true)}
          tone={link && link.phase === "live" ? "accent" : undefined}
          disabled={!netplay.available}
        >
          {link && link.phase === "live" ? "Linked" : "Link"}
        </Button>
        {user && (
          <>
            <Button onClick={() => persist({ manual: true })} disabled={syncing}>
              Sync now
            </Button>
            <Button onClick={openHistory} disabled={syncing}>
              History
            </Button>
            {backup !== "saved" && (
              <Button onClick={onBackup} tone="accent" disabled={backup === "uploading"}>
                {backup === "uploading" ? "Uploading…" : "Back up cartridge"}
              </Button>
            )}
          </>
        )}
        <Button onClick={exportSave}>Export .sav</Button>
        <label style={{ ...panel, padding: "10px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          <input
            type="file"
            accept=".sav,application/octet-stream"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importSave(file);
              event.target.value = "";
            }}
          />
          Import .sav
        </label>
      </div>

      <Controls held={padHeld} handlers={padHandlers} run={run} onRun={toggleRun} />

      {backupError && (
        <p style={{ color: "var(--accent2)", fontSize: 13, padding: "0 16px", lineHeight: 1.5 }}>{backupError}</p>
      )}

      <p style={{ color: "var(--dim)", fontSize: 12, padding: "0 16px 20px", lineHeight: 1.5 }}>
        {user
          ? "The cartridge save is written locally a few seconds after the game finishes saving, then pushed to your account. Conflicts are always shown to you, never resolved silently."
          : "The cartridge save is written to this browser a few seconds after the game finishes saving, and again whenever you leave the page. Sign in to keep a copy that survives a cleared browser."}
      </p>

      {linkOpen && (
        <LinkPanel
          link={link}
          error={linkError}
          onHost={() => startLink(netplay.newCode(), true)}
          onJoin={(code) => startLink(code, false)}
          onLeave={() => {
            if (sessionRef.current) sessionRef.current.leave();
            else endLink("");
          }}
          onClose={() => setLinkOpen(false)}
        />
      )}

      {stateList && (
        <StatePanel
          entries={stateList}
          coreVersion={core.gba_state_version()}
          busy={savingState}
          onSave={saveState}
          onLoad={loadState}
          onRemove={removeState}
          onRename={renameState}
          onClose={() => setStateList(null)}
        />
      )}

      {history && (
        <History
          versions={history}
          current={history[0]?.version}
          onRestore={restore}
          onClose={() => setHistory(null)}
        />
      )}

      {conflict && (
        <Conflict
          mine={conflict.mine}
          theirs={conflict.theirs}
          onKeepMine={() => resolve("mine")}
          onKeepTheirs={() => resolve("theirs")}
          onKeepBoth={() => resolve("both")}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

function App() {
  const user = useAuth();
  // Effects key on the account id, never the user object: Supabase hands back
  // a fresh object every time it re-validates the session, which happens on
  // every tab focus.
  const accountId = user?.id ?? null;
  const [core, setCore] = useState(null);
  const [rom, setRom] = useState(null);
  const [romSha, setRomSha] = useState("");
  const [library, setLibrary] = useState({ loaded: false, roms: [] });
  const [backup, setBackup] = useState("unknown");
  const [backupError, setBackupError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  // The app opens to the library rather than dropping straight into the game,
  // so the save states are the first thing you see. Resuming is one tap.
  const [playing, setPlaying] = useState(false);
  const [stateEntries, setStateEntries] = useState([]);
  const [pendingState, setPendingState] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setCore(await loadCore());
        const stored = await dbGet("rom");
        const sha = await dbGet("romSha");
        if (stored) {
          setRom(stored);
          setRomSha(sha || (await cloud.sha256Hex(stored)));
        }
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  // The cartridge library follows the account, so it appears on sign-in and
  // clears on sign-out.
  useEffect(() => {
    if (!user || !cloud.configured) {
      setLibrary({ loaded: false, roms: [] });
      setBackup("unknown");
      return;
    }
    let cancelled = false;
    cloud
      .listRoms()
      .then((roms) => !cancelled && setLibrary({ loaded: true, roms }))
      .catch((e) => {
        if (cancelled) return;
        setLibrary({ loaded: true, roms: [] });
        setBackupError(e.message || String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Back-fill on sign-in. Uploading only at the moment a file is picked meant
  // a cartridge loaded before signing in was never sent anywhere, and the
  // second device found an empty library with nothing to explain why.
  useEffect(() => {
    if (!user || !cloud.configured || !rom || !romSha || !library.loaded) return;
    if (library.roms.some((entry) => entry.id === romSha)) {
      setBackup("saved");
      return;
    }
    let cancelled = false;
    (async () => {
      setBackup("uploading");
      setBackupError("");
      try {
        await cloud.putRom(rom, { sha: romSha, ...headerOf(rom) });
        if (cancelled) return;
        setLibrary({ loaded: true, roms: await cloud.listRoms() });
        setBackup("saved");
      } catch (e) {
        if (cancelled) return;
        setBackup("error");
        setBackupError(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, rom, romSha, library.loaded, library.roms]);

  const backUpNow = async () => {
    if (!rom || !romSha) return;
    setBackup("uploading");
    setBackupError("");
    try {
      await cloud.putRom(rom, { sha: romSha, force: true, ...headerOf(rom) });
      setLibrary({ loaded: true, roms: await cloud.listRoms() });
      setBackup("saved");
    } catch (e) {
      setBackup("error");
      setBackupError(e.message || String(e));
    }
  };

  // The library screen lists every state, so it refreshes whenever the
  // account changes or the player hands control back.
  const refreshStates = useCallback(async () => {
    try {
      setStateEntries(await states.list(user || null));
    } catch (e) {
      console.error(e);
    }
    // Keyed on the id: a refreshed session is the same account, and refetching
    // on every focus change is noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (!playing) refreshStates();
  }, [playing, refreshStates]);

  const load = async (bytes) => {
    const sha = await cloud.sha256Hex(bytes);
    await dbPut("rom", bytes);
    await dbPut("romSha", sha);
    setRom(bytes);
    setRomSha(sha);
    setPlaying(true);
    return sha;
  };

  const pick = async (file) => {
    setBusy(true);
    setError("");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 0xc0) {
      setBusy(false);
      return setError("That file is too small to be a GBA ROM.");
    }
    await load(bytes);
    // Uploading is handled by the back-fill effect, which covers this path and
    // the sign-in-afterwards path with one piece of logic.
    setBusy(false);
  };

  const playCloud = async (entry) => {
    setBusy(true);
    setError("");
    try {
      await load(await cloud.getRom(entry.path));
    } catch (e) {
      setError("Could not download that cartridge: " + (e.message || e));
    }
    setBusy(false);
  };

  const forgetCloud = async (entry) => {
    await cloud.forgetRom(entry.id, entry.path);
    setLibrary({ loaded: true, roms: await cloud.listRoms() });
    if (entry.id === romSha) setBackup("unknown");
  };

  // "Library" leaves the game running in memory and goes back to the shelf;
  // the cartridge is only unloaded by choosing a different one.
  const toLibrary = () => setPlaying(false);

  /** Resume a state from the library, fetching its cartridge if this device
   *  does not already have it loaded. */
  const resumeState = async (entry) => {
    setError("");
    if (entry.romSha && entry.romSha !== romSha) {
      const match = library.roms.find((r) => r.id === entry.romSha);
      if (!match) {
        return setError(
          "That state belongs to a cartridge this device does not have. Load its ROM first."
        );
      }
      setBusy(true);
      try {
        await load(await cloud.getRom(match.path));
      } catch (e) {
        setBusy(false);
        return setError("Could not fetch that cartridge: " + (e.message || e));
      }
      setBusy(false);
    }
    setPendingState(entry);
    setPlaying(true);
  };

  const removeStateEntry = async (entry) => {
    await states.remove(user || null, entry);
    refreshStates();
  };

  if (error && !core) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Could not start</h1>
        <p style={{ color: "var(--dim)" }}>{error}</p>
      </div>
    );
  }
  if (!core || !rom || !playing) {
    return (
      <Home
        onPick={pick}
        error={error}
        busy={busy}
        user={user || null}
        library={library}
        backupError={backupError}
        onPlayCloud={playCloud}
        onForgetCloud={forgetCloud}
        onSignOut={signOut}
        loaded={rom ? headerOf(rom).title || headerOf(rom).gameCode || "cartridge" : null}
        onResume={() => setPlaying(true)}
        stateEntries={stateEntries}
        coreVersion={core?.gba_state_version?.() ?? 0}
        onResumeState={resumeState}
        onRemoveState={removeStateEntry}
      />
    );
  }
  return (
    <Player
      core={core}
      rom={rom}
      romSha={romSha}
      user={user || null}
      backup={backup}
      backupError={backupError}
      onBackup={backUpNow}
      onEject={toLibrary}
      pendingState={pendingState}
      onStateConsumed={() => setPendingState(null)}
    />
  );
}

createRoot(document.getElementById("root")).render(<App />);
