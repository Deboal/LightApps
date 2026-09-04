import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

// GBA — a Game Boy Advance emulator. The core is Rust compiled to WebAssembly
// (see gba/ in this repo); this file is only the shell: a canvas, touch
// controls, and storage.
//
// Nothing is uploaded. The ROM and the save both live in this browser's
// IndexedDB, which is also why the ROM survives a reload without re-picking.

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
// Storage
// ----------------------------------------------------------------------------

// A single object store keyed by strings. Saves are small; the ROM is not, and
// localStorage cannot hold 16 MB, which is why this is IndexedDB.
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

// Copy a byte array into the module's memory and hand back a pointer.
function intoWasm(core, bytes) {
  const ptr = core.gba_alloc(bytes.length);
  new Uint8Array(core.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function readTransfer(core, length) {
  if (!length) return null;
  const ptr = core.gba_transfer_ptr();
  // The view is taken fresh because growing the heap detaches the old buffer.
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

// ----------------------------------------------------------------------------
// UI pieces
// ----------------------------------------------------------------------------

const panel = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 12,
};

function Button({ children, onClick, tone, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...panel,
        background: tone === "accent" ? "var(--accent)" : "var(--panel)",
        borderColor: tone === "accent" ? "var(--accent)" : "var(--line)",
        padding: "10px 14px",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
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

function Picker({ onPick, error, busy }) {
  return (
    <div style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, margin: "8px 0 4px" }}>Game Boy Advance</h1>
      <p style={{ color: "var(--dim)", fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        A Rust emulator core compiled to WebAssembly. Pick a <code>.gba</code> file
        from this device — it is stored in this browser and never uploaded.
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
      {error && (
        <p style={{ color: "var(--accent2)", fontSize: 14 }}>{error}</p>
      )}
      <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.6, marginTop: 20 }}>
        No audio — that is deliberate, not missing. Keyboard: arrows to move,
        Z and X for A and B, Enter for Start, Shift for Select, A and S for the
        shoulders.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Player
// ----------------------------------------------------------------------------

function Player({ core, rom, onEject }) {
  const canvasRef = useRef(null);
  const keysRef = useRef(0);
  const speedRef = useRef(1);
  const [speed, setSpeed] = useState(1);
  const [fps, setFps] = useState(0);
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const saveTimer = useRef(null);

  const flash = useCallback((message) => {
    setNote(message);
    setTimeout(() => setNote(""), 1800);
  }, []);

  const persistSave = useCallback(async () => {
    const length = core.gba_read_save();
    const save = readTransfer(core, length);
    if (!save) return;
    const key = `sav:${gameCodeOf(core)}`;
    await dbPut(key, save);
    core.gba_clear_save_dirty();
  }, [core]);

  // Boot: load any existing save for this cartridge, then start the machine.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Boot once with no save so the header parses and the game code is
      // known, then again with whatever save belongs to that cartridge.
      const romPtr = intoWasm(core, rom);
      core.gba_init(romPtr, rom.length, 0, 0);
      const gameCode = gameCodeOf(core);
      const existing = await dbGet(`sav:${gameCode}`);
      if (!cancelled && existing) {
        const savePtr = intoWasm(core, existing);
        core.gba_init(romPtr, rom.length, savePtr, existing.length);
        core.gba_free(savePtr, existing.length);
      }
      // The core keeps its own copy, so the staging buffer is dead weight --
      // 16 MB of it, which matters on a phone.
      core.gba_free(romPtr, rom.length);
      if (!cancelled) setCode(gameCode);
    })();
    return () => {
      cancelled = true;
    };
  }, [core, rom]);

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
          persistSave().then(() => flash("Saved"));
        }, 3000);
      }
    };

    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [core, persistSave, flash]);

  // Flush on the way out. iOS can kill a backgrounded tab without warning, so
  // hiding the page is the last reliable moment to write.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && core.gba_save_dirty()) {
        persistSave();
      }
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [core, persistSave]);

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
    const length = core.gba_read_state();
    const state = readTransfer(core, length);
    if (state && (await dbPut(`state:${code}`, state))) flash("State saved");
  };

  const loadState = async () => {
    const state = await dbGet(`state:${code}`);
    if (!state) return flash("No saved state");
    const ptr = intoWasm(core, state);
    const ok = core.gba_write_state(ptr, state.length);
    core.gba_free(ptr, state.length);
    flash(ok ? "State loaded" : "State is from a different build");
  };

  // Re-seed the cartridge from a .sav file. Worth having even before cloud
  // sync exists: browser storage is evictable, and this is how a save moves
  // between two devices in the meantime.
  const importSave = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const romPtr = intoWasm(core, rom);
    const savePtr = intoWasm(core, bytes);
    const ok = core.gba_init(romPtr, rom.length, savePtr, bytes.length);
    core.gba_free(savePtr, bytes.length);
    core.gba_free(romPtr, rom.length);
    if (!ok) return flash("That file was refused");
    await dbPut(`sav:${gameCodeOf(core)}`, bytes);
    flash("Save imported");
  };

  const exportSave = async () => {
    const length = core.gba_read_save();
    const save = readTransfer(core, length);
    if (!save) return flash("This cartridge has no save");
    const url = URL.createObjectURL(new Blob([save], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${code}.sav`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", fontSize: 13, color: "var(--dim)" }}>
        <strong style={{ color: "var(--text)" }}>{code || "…"}</strong>
        <span>{fps} fps</span>
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

      <p style={{ color: "var(--dim)", fontSize: 12, padding: "0 16px 20px", lineHeight: 1.5 }}>
        The cartridge save is written to this browser a few seconds after the
        game finishes saving, and again whenever you leave the page. Export it
        if you want a copy you control.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------

function App() {
  const [core, setCore] = useState(null);
  const [rom, setRom] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const exports = await loadCore();
        setCore(exports);
        const stored = await dbGet("rom");
        if (stored) setRom(stored);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const pick = async (file) => {
    setBusy(true);
    setError("");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 0xc0) {
      setBusy(false);
      return setError("That file is too small to be a GBA ROM.");
    }
    await dbPut("rom", bytes);
    setRom(bytes);
    setBusy(false);
  };

  const eject = () => {
    setRom(null);
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
  if (!core || !rom) return <Picker onPick={pick} error={error} busy={busy} />;
  return <Player core={core} rom={rom} onEject={eject} />;
}

createRoot(document.getElementById("root")).render(<App />);
