import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useAuth, signInWithEmail, signOut } from "../../../shared/auth.js";
import * as cloud from "./cloud.js";

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

const KEYBOARD = {
  KeyZ: BTN.A,
  KeyX: BTN.B,
  Enter: BTN.START,
  ShiftRight: BTN.SELECT,
  ShiftLeft: BTN.SELECT,
  Backspace: BTN.SELECT,
  ArrowUp: BTN.UP,
  ArrowDown: BTN.DOWN,
  ArrowLeft: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  KeyA: BTN.L,
  KeyS: BTN.R,
};

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

// A control that reports press and release rather than click, so holding a
// direction actually holds it.
function Pad({ mask, label, onDown, onUp, style, round }) {
  const press = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onDown(mask);
  };
  const release = (event) => {
    event.preventDefault();
    onUp(mask);
  };
  return (
    <div
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: round ? "50%" : 10,
        color: "var(--dim)",
        fontSize: 15,
        fontWeight: 700,
        userSelect: "none",
        touchAction: "none",
        ...style,
      }}
    >
      {label}
    </div>
  );
}

function Controls({ onDown, onUp }) {
  const cell = { width: 52, height: 52 };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "8px 16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 52px)", gridTemplateRows: "repeat(3, 52px)", gap: 4 }}>
        <div />
        <Pad mask={BTN.UP} label="▲" onDown={onDown} onUp={onUp} style={cell} />
        <div />
        <Pad mask={BTN.LEFT} label="◀" onDown={onDown} onUp={onUp} style={cell} />
        <div />
        <Pad mask={BTN.RIGHT} label="▶" onDown={onDown} onUp={onUp} style={cell} />
        <div />
        <Pad mask={BTN.DOWN} label="▼" onDown={onDown} onUp={onUp} style={cell} />
        <div />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Pad mask={BTN.L} label="L" onDown={onDown} onUp={onUp} style={{ width: 56, height: 34 }} />
          <Pad mask={BTN.R} label="R" onDown={onDown} onUp={onUp} style={{ width: 56, height: 34 }} />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Pad mask={BTN.B} label="B" onDown={onDown} onUp={onUp} round style={{ width: 58, height: 58, color: "var(--accent2)" }} />
          <Pad mask={BTN.A} label="A" onDown={onDown} onUp={onUp} round style={{ width: 58, height: 58, color: "var(--accent)", marginBottom: 18 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Pad mask={BTN.SELECT} label="SELECT" onDown={onDown} onUp={onUp} style={{ width: 74, height: 30, fontSize: 11 }} />
          <Pad mask={BTN.START} label="START" onDown={onDown} onUp={onUp} style={{ width: 74, height: 30, fontSize: 11 }} />
        </div>
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

function Picker({ onPick, error, busy, user, library, backupError, onPlayCloud, onForgetCloud, onSignOut }) {
  return (
    <div style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, margin: "8px 0 4px" }}>Game Boy Advance</h1>
      <p style={{ color: "var(--dim)", fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        A Rust emulator core compiled to WebAssembly. Pick a <code>.gba</code> file
        from this device — it stays on this device unless you sign in.
      </p>

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

      {cloud.configured && !user && <div style={{ marginTop: 14 }}><SignIn /></div>}
      {backupError && <p style={{ color: "var(--accent2)", fontSize: 13, lineHeight: 1.5 }}>{backupError}</p>}
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
        Z and X for A and B, Enter for Start, Shift for Select, A and S for the
        shoulders.
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

// The point of keeping ten versions is being able to go back to one. Without
// this the retention is invisible and might as well not exist.
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

function Player({ core, rom, romSha, user, backup, backupError, onBackup, onEject }) {
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
  const saveTimer = useRef(null);
  const keyRef = useRef("");

  const flash = useCallback((message) => {
    setNote(message);
    setTimeout(() => setNote(""), 2200);
  }, []);

  const readSave = useCallback(() => readTransfer(core, core.gba_read_save()), [core]);

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
      core.gba_clear_save_dirty();

      const meta = await localMeta(key);
      if (!user || !cloud.configured) {
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
    [core, user, readSave, flash]
  );

  // Boot, then reconcile with the server before the game gets far.
  useEffect(() => {
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

      if (user && cloud.configured) {
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
      if (!cancelled) setCode(gameCode);
    })();
    return () => {
      cancelled = true;
    };
  }, [core, rom, romSha, user]);

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
      // Cap the catch-up so a backgrounded tab does not return and try to
      // simulate a minute of gameplay in one frame.
      while (owed >= period && ran < 16) {
        core.gba_run_frame(keysRef.current);
        owed -= period;
        ran += 1;
      }
      if (ran === 0) return;

      const ptr = core.gba_pixels();
      image.data.set(new Uint8Array(core.memory.buffer, ptr, WIDTH * HEIGHT * 4));
      ctx.putImageData(image, 0, 0);

      drawn += ran;
      if (now - counted >= 500) {
        setFps(Math.round((drawn * 1000) / (now - counted)));
        drawn = 0;
        counted = now;
      }

      // Persist a few seconds after the cartridge stops being written, which
      // is when the game has finished its save rather than mid-erase.
      if (core.gba_save_dirty() && !saveTimer.current) {
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
      const mask = KEYBOARD[event.code];
      if (mask) {
        event.preventDefault();
        keysRef.current |= mask;
      }
    };
    const up = (event) => {
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
  }, []);

  const press = useCallback((mask) => {
    keysRef.current |= mask;
  }, []);
  const release = useCallback((mask) => {
    keysRef.current &= ~mask;
  }, []);

  const cycleSpeed = () => {
    const next = speedRef.current >= 8 ? 1 : speedRef.current * 2;
    speedRef.current = next;
    setSpeed(next);
  };

  const saveState = async () => {
    const state = readTransfer(core, core.gba_read_state());
    if (state && (await dbPut(`state:${keyRef.current}`, state))) flash("State saved");
  };

  const loadState = async () => {
    const state = await dbGet(`state:${keyRef.current}`);
    if (!state) return flash("No saved state");
    const ptr = intoWasm(core, state);
    const ok = core.gba_write_state(ptr, state.length);
    core.gba_free(ptr, state.length);
    flash(ok ? "State loaded" : "State is from a different build");
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
        <button onClick={onEject} style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", fontSize: 13 }}>
          Eject
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{
          width: "100%",
          maxWidth: 720,
          margin: "0 auto",
          aspectRatio: `${WIDTH} / ${HEIGHT}`,
          display: "block",
          background: "#000",
        }}
      />

      <div style={{ display: "flex", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
        <Button onClick={cycleSpeed} tone={speed > 1 ? "accent" : undefined}>
          {speed}× speed
        </Button>
        <Button onClick={saveState}>Save state</Button>
        <Button onClick={loadState}>Load state</Button>
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

      <Controls onDown={press} onUp={release} />

      {backupError && (
        <p style={{ color: "var(--accent2)", fontSize: 13, padding: "0 16px", lineHeight: 1.5 }}>{backupError}</p>
      )}

      <p style={{ color: "var(--dim)", fontSize: 12, padding: "0 16px 20px", lineHeight: 1.5 }}>
        {user
          ? "The cartridge save is written locally a few seconds after the game finishes saving, then pushed to your account. Conflicts are always shown to you, never resolved silently."
          : "The cartridge save is written to this browser a few seconds after the game finishes saving, and again whenever you leave the page. Sign in to keep a copy that survives a cleared browser."}
      </p>

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
  const [core, setCore] = useState(null);
  const [rom, setRom] = useState(null);
  const [romSha, setRomSha] = useState("");
  const [library, setLibrary] = useState({ loaded: false, roms: [] });
  const [backup, setBackup] = useState("unknown");
  const [backupError, setBackupError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

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
  }, [user]);

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
  }, [user, rom, romSha, library.loaded, library.roms]);

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

  const load = async (bytes) => {
    const sha = await cloud.sha256Hex(bytes);
    await dbPut("rom", bytes);
    await dbPut("romSha", sha);
    setRom(bytes);
    setRomSha(sha);
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

  const eject = () => {
    setRom(null);
    setRomSha("");
    dbPut("rom", null);
  };

  if (error && !core) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Could not start</h1>
        <p style={{ color: "var(--dim)" }}>{error}</p>
      </div>
    );
  }
  if (!core || !rom) {
    return (
      <Picker
        onPick={pick}
        error={error}
        busy={busy}
        user={user || null}
        library={library}
        backupError={backupError}
        onPlayCloud={playCloud}
        onForgetCloud={forgetCloud}
        onSignOut={signOut}
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
      onEject={eject}
    />
  );
}

createRoot(document.getElementById("root")).render(<App />);
