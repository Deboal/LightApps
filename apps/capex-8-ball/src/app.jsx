import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { TONES, rollAnswer, SAMPLE_QUESTIONS } from "./answers.js";

// CAPEX 8-Ball — ask a capital-spending question, shake the phone (or tap the
// ball), get a verdict. Fully offline: no sign-in, no network, no backend.

// ----------------------------------------------------------------------------
// Style
// ----------------------------------------------------------------------------
const C = {
  bg: "#0b0f14", panel: "#151b23", panel2: "#1c242e", line: "#2a3441",
  text: "#eaf1f7", dim: "#93a2b2", faint: "#66757f", accent: "#4bb3fd",
};

const shell = {
  maxWidth: 540, margin: "0 auto", padding: "24px 16px 40px",
  minHeight: "100dvh", display: "flex", flexDirection: "column", gap: 18,
};
const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 };
const label = {
  fontSize: 11, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: C.faint,
};

// ----------------------------------------------------------------------------
// Persistence — the ledger of past verdicts survives a reload.
// ----------------------------------------------------------------------------
const LS = "capex-8-ball/v1";

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch { return null; }
}

function saveState(s) {
  try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* private mode */ }
}

function buzz(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* unsupported */ }
}

function clockOf(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

// ----------------------------------------------------------------------------
// Shake detection
//
// Two wrinkles worth knowing: iOS 13+ hides the accelerometer behind
// DeviceMotionEvent.requestPermission(), which only resolves when called from a
// real user gesture — so we ask on the first tap of the ball rather than on
// load, where it would silently fail. And a single shake fires dozens of
// devicemotion events, so we rate-limit to one verdict per second and a bit.
// ----------------------------------------------------------------------------
const MOTION_SUPPORTED = typeof window !== "undefined" && typeof window.DeviceMotionEvent !== "undefined";
const NEEDS_PERMISSION = MOTION_SUPPORTED && typeof window.DeviceMotionEvent.requestPermission === "function";
const SHAKE_FORCE = 26;   // summed |Δaccel| across axes, m/s² — a deliberate shake, not a pocket jostle
const SHAKE_GAP = 1300;   // ms between accepted shakes

function useShake(active, onShake, onLive) {
  const cb = useRef(onShake);
  const live = useRef(onLive);
  cb.current = onShake;
  live.current = onLive;

  useEffect(() => {
    if (!active) return;
    let prev = null;
    let lastFired = 0;

    const handle = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      // A real phone streams gravity readings continuously; a desktop with the
      // API defined but no sensor never gets here. That's our "is there
      // actually an accelerometer" signal, so we don't promise shake support
      // the hardware can't deliver.
      live.current();
      if (prev) {
        const force = Math.abs(a.x - prev.x) + Math.abs(a.y - prev.y) + Math.abs(a.z - prev.z);
        const now = Date.now();
        if (force > SHAKE_FORCE && now - lastFired > SHAKE_GAP) {
          lastFired = now;
          cb.current();
        }
      }
      prev = { x: a.x, y: a.y, z: a.z };
    };

    window.addEventListener("devicemotion", handle);
    return () => window.removeEventListener("devicemotion", handle);
  }, [active]);
}

// ----------------------------------------------------------------------------
// The ball
// ----------------------------------------------------------------------------
function Ball({ phase, verdict, onTap }) {
  const tone = verdict ? TONES[verdict.tone] : null;
  const showDie = phase !== "shaking";
  const dieText = phase === "answer" && tone ? tone.label : "ASK";

  return (
    <button
      onClick={onTap}
      aria-label="Shake the CAPEX 8-Ball"
      style={{
        border: 0, padding: 0, background: "transparent", cursor: "pointer",
        alignSelf: "center", display: "block",
        width: "min(74vw, 290px)", height: "min(74vw, 290px)",
        borderRadius: "50%", position: "relative",
        animation: phase === "shaking" ? "ball-shake .78s ease-in-out" : "none",
      }}
    >
      {/* body */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "radial-gradient(circle at 34% 26%, #4a515f 0%, #1b202a 38%, #05070a 100%)",
        boxShadow: "0 26px 50px -18px rgba(0,0,0,.9), inset -16px -22px 46px rgba(0,0,0,.85), inset 10px 12px 28px rgba(255,255,255,.05)",
      }} />
      {/* specular highlight */}
      <div style={{
        position: "absolute", top: "11%", left: "19%", width: "27%", height: "17%",
        borderRadius: "50%", filter: "blur(5px)",
        background: "radial-gradient(circle, rgba(255,255,255,.5), rgba(255,255,255,0) 70%)",
      }} />
      {/* answer window */}
      <div style={{
        position: "absolute", left: "24%", top: "26%", width: "52%", height: "52%",
        borderRadius: "50%", overflow: "hidden",
        background: "radial-gradient(circle at 50% 32%, #1d3d8d 0%, #0a1330 72%, #060b1c 100%)",
        boxShadow: "inset 0 8px 20px rgba(0,0,0,.85), inset 0 -4px 12px rgba(80,130,255,.18)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {/* the liquid, stirred */}
        <div style={{
          position: "absolute", inset: "-25%",
          background: "conic-gradient(from 0deg, rgba(90,150,255,0), rgba(90,150,255,.55), rgba(90,150,255,0) 60%)",
          animation: phase === "shaking" ? "swirl .78s linear infinite" : "none",
          opacity: phase === "shaking" ? 1 : .12,
        }} />
        {showDie && (
          <div key={dieText} style={{
            position: "relative", width: "80%", height: "72%",
            animation: "die-rise .45s cubic-bezier(.2,1.3,.4,1) both",
            opacity: phase === "answer" ? 1 : .5,
          }}>
            <div style={{
              position: "absolute", inset: 0,
              clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
              background: phase === "answer"
                ? "linear-gradient(180deg, #4468e8 0%, #16256e 100%)"
                : "linear-gradient(180deg, #2c3f7e 0%, #121c46 100%)",
            }} />
            <div style={{
              position: "absolute", left: 0, right: 0, bottom: "11%", textAlign: "center",
              fontSize: "clamp(10px, 3.4vw, 13px)", fontWeight: 900, letterSpacing: ".11em",
              color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,.6)",
            }}>{dieText}</div>
          </div>
        )}
      </div>
    </button>
  );
}

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------
function App() {
  const saved = loadState();
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState("idle");        // idle | shaking | answer
  const [verdict, setVerdict] = useState(null);
  const [history, setHistory] = useState(() => (Array.isArray(saved?.history) ? saved.history : []));
  const [motionOn, setMotionOn] = useState(false);
  const [motionLive, setMotionLive] = useState(false);
  const [motionNote, setMotionNote] = useState("");

  const timer = useRef(null);
  const lastLine = useRef(null);
  const questionRef = useRef("");
  questionRef.current = question;

  useEffect(() => saveState({ history }), [history]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const shake = useCallback(() => {
    setPhase((p) => {
      if (p === "shaking") return p;   // already rattling; ignore
      buzz([26, 50, 26, 50, 40]);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const result = rollAnswer(lastLine.current);
        lastLine.current = result.line;
        const asked = questionRef.current.trim();
        const entry = { ...result, q: asked, at: Date.now() };
        setVerdict(entry);
        setPhase("answer");
        setHistory((h) => [entry, ...h].slice(0, 40));
        buzz(18);
      }, 780);
      return "shaking";
    });
  }, []);

  const markLive = useCallback(() => setMotionLive(true), []);
  useShake(motionOn, shake, markLive);

  // Ask iOS for the accelerometer. Must run inside a user gesture, so this is
  // wired to taps rather than to mount.
  const enableMotion = useCallback(async () => {
    if (!MOTION_SUPPORTED) { setMotionNote("This device has no motion sensor — use the button."); return; }
    if (!NEEDS_PERMISSION) { setMotionOn(true); return; }
    try {
      const res = await window.DeviceMotionEvent.requestPermission();
      if (res === "granted") { setMotionOn(true); setMotionNote(""); }
      else setMotionNote("Motion access declined — tap the ball instead.");
    } catch {
      setMotionNote("Motion access unavailable — tap the ball instead.");
    }
  }, []);

  const onBallTap = useCallback(() => {
    if (!motionOn) enableMotion();   // fire-and-forget; the tap still rolls
    shake();
  }, [motionOn, enableMotion, shake]);

  const tone = verdict ? TONES[verdict.tone] : null;

  return (
    <div style={shell}>
      <header>
        <div style={{ ...label, color: C.accent }}>Capital Allocation Oracle</div>
        <h1 style={{ margin: "6px 0 4px", fontSize: 30, letterSpacing: "-.02em" }}>CAPEX 8-Ball</h1>
        <p style={{ margin: 0, color: C.dim, fontSize: 14.5, lineHeight: 1.45 }}>
          Ask it whether to spend the money. Shake your phone or tap the ball.
        </p>
      </header>

      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Your question</div>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Should we buy the second aircraft?"
          enterKeyHint="go"
          onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); onBallTap(); } }}
          style={{
            width: "100%", background: C.panel2, color: C.text,
            border: `1px solid ${C.line}`, borderRadius: 12,
            padding: "13px 14px", fontSize: 16, outline: "none",
          }}
        />
        <button
          onClick={() => setQuestion(SAMPLE_QUESTIONS[Math.floor(Math.random() * SAMPLE_QUESTIONS.length)])}
          style={{
            marginTop: 10, border: `1px solid ${C.line}`, background: "transparent",
            color: C.dim, borderRadius: 999, padding: "7px 13px", fontSize: 13, cursor: "pointer",
          }}
        >Suggest one</button>
      </div>

      <Ball phase={phase} verdict={verdict} onTap={onBallTap} />

      <button
        onClick={onBallTap}
        disabled={phase === "shaking"}
        style={{
          alignSelf: "center", border: 0, borderRadius: 999,
          background: phase === "shaking" ? C.panel2 : C.accent,
          color: phase === "shaking" ? C.faint : "#06121e",
          fontWeight: 800, fontSize: 15.5, letterSpacing: ".01em",
          padding: "14px 30px", minWidth: 200, cursor: phase === "shaking" ? "default" : "pointer",
        }}
      >{phase === "shaking" ? "Shaking…" : phase === "answer" ? "Ask again" : "Shake it"}</button>

      <div style={{ textAlign: "center", fontSize: 12.5, color: C.faint, marginTop: -8 }}>
        {motionNote
          ? motionNote
          : motionLive
            ? "Shake detection on — give the phone a rattle."
            : motionOn
              ? "Listening for a shake. No sensor here? The button works."
              : MOTION_SUPPORTED
                ? "Tap once to turn on shake-to-ask."
                : "No motion sensor — use the button."}
      </div>

      {phase === "answer" && verdict && (
        <div key={verdict.at} style={{
          ...card, borderColor: `${tone.color}55`, background: `linear-gradient(180deg, ${tone.color}12, ${C.panel} 60%)`,
          animation: "fade-up .35s ease both",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...label, color: tone.color }}>{tone.label}</span>
            <span style={{ fontSize: 12.5, color: C.faint }}>{tone.note}</span>
          </div>
          {verdict.q && (
            <div style={{ marginTop: 10, fontSize: 13.5, color: C.dim, fontStyle: "italic" }}>“{verdict.q}”</div>
          )}
          <div style={{ marginTop: 8, fontSize: 21, fontWeight: 700, lineHeight: 1.3 }}>{verdict.line}</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 14 }}>
            {verdict.metrics.map((m) => (
              <div key={m.k} style={{
                background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12,
                padding: "10px 8px", textAlign: "center",
              }}>
                <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: C.faint }}>{m.k}</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3, color: tone.color }}>{m.v}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, fontSize: 11.5, color: C.faint }}>{verdict.print}</div>
        </div>
      )}

      {history.length > 0 && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={label}>Decision ledger</div>
            <button
              onClick={() => { setHistory([]); }}
              style={{ border: 0, background: "transparent", color: C.faint, fontSize: 12.5, cursor: "pointer", padding: 0 }}
            >Clear</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history.slice(0, 12).map((h) => {
              const t = TONES[h.tone];
              return (
                <div key={h.at} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{
                    marginTop: 4, width: 8, height: 8, borderRadius: "50%",
                    background: t.color, flex: "0 0 auto",
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, lineHeight: 1.35 }}>{h.line}</div>
                    <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                      {h.q ? `${h.q} · ` : ""}{clockOf(h.at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 14, textAlign: "center", fontSize: 11.5, color: C.faint }}>
        Works offline. Nothing leaves your phone.
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
