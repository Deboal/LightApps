import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { store } from "../../../shared/store.js";
import { AuthGate, signOut } from "../../../shared/auth.js";

// Endure — a lab of mental-endurance tests inspired by Alex Hutchinson's book
// "Endure: Mind, Body, and the Curiously Elastic Limits of Human Performance."
//
// The book's thesis is that the limits we hit are as much in the brain as in the
// body. These four tests each probe a different face of that: raw vigilance under
// waiting (PVT), cognitive control under interference (Stroop), the conscious
// override of a hard-wired reflex (breath hold), and the gap between when the
// mind quits and the body actually fails (an isometric hold).
//
// Per-user PRIVATE data: each signed-in user sees only their own results.
const db = store("endure");
const COLLECTION = "sessions";

// ---------------------------------------------------------------------------
// Palette (matches the hub) + a warm "effort" accent.
// ---------------------------------------------------------------------------
const C = {
  bg: "#0f1318", panel: "#161c23", line: "#2a333d", text: "#e7edf2",
  dim: "#8b97a3", faint: "#5c6670", accent: "#33c2b0", warm: "#e0a94d",
  danger: "#e5604d", good: "#4caf7d",
};

// ---------------------------------------------------------------------------
// Test catalogue. `score` pulls the headline number out of a saved session;
// `better` says which direction is a personal best; `fmt` renders a score.
// ---------------------------------------------------------------------------
const TESTS = {
  pvt: {
    name: "Reaction Time",
    tag: "Psychomotor Vigilance",
    icon: "⚡",
    color: C.accent,
    blurb:
      "The gold-standard lab test for alertness and mental fatigue. Wait for the screen to light up, then tap as fast as you can. Sleep loss and mental fatigue don't slow your average much — they make you lapse.",
    unit: "ms",
    better: "lower",
    score: (s) => s.mean,
    fmt: (v) => `${Math.round(v)} ms`,
  },
  stroop: {
    name: "Stroop Test",
    tag: "Cognitive Control",
    icon: "\u{1F9E0}",
    color: "#4d8fe5",
    blurb:
      "Name the ink colour, not the word. The reflex to read fights the task, and holding the line takes effort — the same executive control that drains as you push through a hard effort.",
    unit: "correct",
    better: "higher",
    score: (s) => s.correct,
    fmt: (v) => `${v} correct`,
  },
  gng: {
    name: "Go / No-Go",
    tag: "Response Inhibition",
    icon: "\u{1F6A6}",
    color: "#5cbf6b",
    blurb:
      "Tap fast on green, hold back on red. The tapping is easy — stopping yourself is the work, and sustaining that restraint is draining. This response-inhibition task is essentially the one Samuele Marcora used in Endure to mentally fatigue athletes before they even started exercising.",
    unit: "%",
    better: "higher",
    score: (s) => s.accuracy,
    fmt: (v) => `${v}%`,
  },
  nback: {
    name: "N-Back",
    tag: "Working Memory",
    icon: "\u{1F9E9}",
    color: "#dd7fb0",
    blurb:
      "Letters stream past; flag when the current one matches the one N steps back. It's the classic working-memory stress test — holding and constantly updating a mental buffer under time pressure, the kind of executive load that frays as fatigue builds.",
    unit: "%",
    better: "higher",
    score: (s) => s.accuracy,
    fmt: (v) => `${v}%`,
  },
  breath: {
    name: "Breath Hold",
    tag: "The Central Governor",
    icon: "\u{1FAC1}",
    color: "#b07de0",
    blurb:
      "Hold your breath and the urge to breathe long precedes any real need for oxygen. It's a protective alarm you can consciously override — Hutchinson's clearest example of a limit set by the brain, not the body.",
    unit: "time",
    better: "higher",
    score: (s) => s.seconds,
    fmt: (v) => fmtDur(v),
  },
  hold: {
    name: "Endurance Hold",
    tag: "Mind vs. Body",
    icon: "\u{1F525}",
    color: C.warm,
    blurb:
      "A wall sit or plank held to failure. The moment you quit is a negotiation between effort and will, not the instant your muscles give out — the central puzzle of the whole book.",
    unit: "time",
    better: "higher",
    score: (s) => s.seconds,
    fmt: (v) => fmtDur(v),
  },
};
const ORDER = ["pvt", "stroop", "gng", "nback", "breath", "hold"];
// Home groups the mental tasks first — the heart of the book — then the two
// "your body could go further than your brain lets it" holds.
const CATEGORIES = [
  { title: "MENTAL ENDURANCE", note: "Cognitive tasks — vigilance, control, memory.", tests: ["pvt", "stroop", "gng", "nback"] },
  { title: "BODY VS. MIND", note: "Where the quitting happens in your head, not your muscles.", tests: ["breath", "hold"] },
];

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}
function bestOf(list, test) {
  if (!list.length) return null;
  const def = TESTS[test];
  return list.reduce((b, s) =>
    def.better === "lower"
      ? (def.score(s) < def.score(b) ? s : b)
      : (def.score(s) > def.score(b) ? s : b), list[0]);
}

// ---------------------------------------------------------------------------
// Shared UI bits.
// ---------------------------------------------------------------------------
const btnPrimary = (color = C.accent) => ({
  background: color, color: "#06231f", border: "none", borderRadius: 12,
  padding: "15px 20px", fontWeight: 700, fontSize: 16, cursor: "pointer", width: "100%",
});
const btnGhost = {
  background: "none", border: `1px solid ${C.line}`, color: C.dim,
  borderRadius: 10, padding: "9px 14px", fontSize: 14, cursor: "pointer",
};

function Screen({ children, pad = true }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: pad ? "28px 20px 48px" : 0, minHeight: "100dvh" }}>
      {children}
    </div>
  );
}

function TopBar({ onBack, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
      {onBack
        ? <button onClick={onBack} style={btnGhost}>{"← Back"}</button>
        : <div style={{ fontSize: 11, letterSpacing: ".22em", color: C.dim, fontWeight: 600 }}>ENDURE · PRIVATE</div>}
      {right}
    </div>
  );
}

// ===========================================================================
// Home / dashboard
// ===========================================================================
function Home({ user, sessions, ready, err, onOpen }) {
  const byTest = {};
  for (const s of sessions) (byTest[s.test] ||= []).push(s);
  const recent = [...sessions].slice(-6).reverse();

  return (
    <Screen>
      <TopBar right={<button onClick={signOut} style={btnGhost}>Sign out</button>} />
      <h1 style={{ letterSpacing: "-.03em", margin: "2px 0 2px", fontSize: 34 }}>Endure</h1>
      <div style={{ color: C.dim, fontSize: 15, lineHeight: 1.5, margin: "0 0 4px" }}>
        Mental-endurance tests from Alex Hutchinson's <i>Endure</i>. Where's your limit really set?
      </div>
      <div style={{ color: C.faint, fontSize: 12, marginBottom: 22 }}>{user.email}</div>

      {err && <div style={{ color: C.danger, marginBottom: 14, fontSize: 13 }}>{err}</div>}

      {CATEGORIES.map((cat) => (
        <div key={cat.title} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: C.dim, fontWeight: 700, marginBottom: 2 }}>{cat.title}</div>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>{cat.note}</div>
          <div style={{ display: "grid", gap: 12 }}>
            {cat.tests.map((key) => {
              const def = TESTS[key];
              const list = byTest[key] || [];
              const best = bestOf(list, key);
              return (
                <button key={key} onClick={() => onOpen(key)} style={{
                  textAlign: "left", background: C.panel, border: `1px solid ${C.line}`,
                  borderRadius: 16, padding: "16px 18px", cursor: "pointer", color: C.text,
                  display: "flex", alignItems: "center", gap: 16,
                }}>
                  <div style={{ fontSize: 30, lineHeight: 1, width: 40, textAlign: "center" }}>{def.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.15 }}>{def.name}</div>
                    <div style={{ fontSize: 11, color: def.color, letterSpacing: ".05em", textTransform: "uppercase", fontWeight: 600, marginTop: 2 }}>{def.tag}</div>
                    <div style={{ fontSize: 13, color: C.dim, marginTop: 5 }}>
                      {best
                        ? <>Best <b style={{ color: C.text }}>{def.fmt(def.score(best))}</b> · {list.length} session{list.length > 1 ? "s" : ""}</>
                        : (ready ? "Not attempted yet" : "…")}
                    </div>
                  </div>
                  <div style={{ color: C.faint, fontSize: 22 }}>{"›"}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {recent.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: C.dim, fontWeight: 600, marginBottom: 10 }}>RECENT</div>
          {recent.map((s) => {
            const def = TESTS[s.test];
            if (!def) return null;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 2px", borderBottom: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{def.icon}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{def.name}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{def.fmt(def.score(s))}</span>
                <span style={{ fontSize: 12, color: C.faint, width: 92, textAlign: "right" }}>{fmtDate(s.ts)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

// ===========================================================================
// Reaction Time (Psychomotor Vigilance Task)
// ===========================================================================
const PVT_TRIALS = 5;
const PVT_LAPSE = 500; // ms; a "lapse" of attention

function PVTTest({ onDone, onBack }) {
  // phase: intro | waiting | ready | tooearly | between | result
  const [phase, setPhase] = useState("intro");
  const [times, setTimes] = useState([]);
  const [rt, setRt] = useState(0);
  const timer = useRef(null);
  const shownAt = useRef(0);

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);

  const arm = useCallback(() => {
    setPhase("waiting");
    const delay = 1500 + Math.random() * 3500; // 1.5–5s unpredictable wait
    timer.current = setTimeout(() => {
      shownAt.current = performance.now();
      setPhase("ready");
    }, delay);
  }, []);

  const tap = () => {
    if (phase === "intro" || phase === "between") { arm(); return; }
    if (phase === "waiting") { clear(); setPhase("tooearly"); return; }
    if (phase === "ready") {
      const t = performance.now() - shownAt.current;
      setRt(t);
      const next = [...times, t];
      setTimes(next);
      if (next.length >= PVT_TRIALS) {
        const mean = next.reduce((a, b) => a + b, 0) / next.length;
        const lapses = next.filter((x) => x > PVT_LAPSE).length;
        onDone({
          mean, best: Math.min(...next), lapses, trials: next.length,
          times: next.map((x) => Math.round(x)),
        });
      } else {
        setPhase("between");
      }
    }
  };

  const bg = phase === "ready" ? C.accent : phase === "tooearly" ? C.danger : C.bg;
  const trialNo = Math.min(times.length + 1, PVT_TRIALS);

  let head, sub;
  if (phase === "intro") { head = "Tap when it turns green"; sub = "Wait for the whole screen to light up, then tap as fast as you can. Don't jump the gun."; }
  else if (phase === "waiting") { head = "Wait…"; sub = " "; }
  else if (phase === "ready") { head = "TAP!"; sub = " "; }
  else if (phase === "tooearly") { head = "Too soon!"; sub = "You tapped before it lit up. Tap to retry this trial."; }
  else if (phase === "between") { head = `${Math.round(rt)} ms`; sub = `Trial ${times.length} of ${PVT_TRIALS} done. Tap to continue.`; }

  return (
    <div onClick={phase !== "ready" ? tap : undefined} onPointerDown={phase === "ready" ? tap : undefined}
      style={{
        position: "fixed", inset: 0, background: bg, color: phase === "ready" ? "#06231f" : C.text,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24, textAlign: "center", cursor: "pointer", transition: "background .05s", userSelect: "none",
      }}>
      {phase === "intro" && (
        <button onClick={(e) => { e.stopPropagation(); onBack(); }}
          style={{ ...btnGhost, position: "absolute", top: 20, left: 20 }}>{"← Back"}</button>
      )}
      <div style={{ position: "absolute", top: 22, fontSize: 12, letterSpacing: ".2em", color: phase === "ready" ? "#06231f" : C.dim, fontWeight: 600 }}>
        {phase === "tooearly" || phase === "intro" ? "REACTION TIME" : `TRIAL ${trialNo} / ${PVT_TRIALS}`}
      </div>
      <div style={{ fontSize: phase === "between" ? 56 : 34, fontWeight: 800, letterSpacing: "-.02em" }}>{head}</div>
      <div style={{ fontSize: 15, color: phase === "ready" ? "#06231f" : C.dim, maxWidth: 320, marginTop: 12, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

// ===========================================================================
// Stroop Test
// ===========================================================================
const STROOP_COLORS = [
  { name: "RED", hex: "#e5604d" },
  { name: "GREEN", hex: "#4caf7d" },
  { name: "BLUE", hex: "#4d8fe5" },
  { name: "YELLOW", hex: "#e0b64d" },
];
const STROOP_SECONDS = 45;

function randStroop() {
  const word = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
  const ink = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
  return { word, ink };
}

function StroopTest({ onDone, onBack }) {
  const [phase, setPhase] = useState("intro"); // intro | run
  const [prompt, setPrompt] = useState(randStroop);
  const [left, setLeft] = useState(STROOP_SECONDS);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [flash, setFlash] = useState(null); // 'good' | 'bad'
  const scoreRef = useRef({ correct: 0, wrong: 0 });
  const tick = useRef(null);

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); }, []);

  const start = () => {
    setCorrect(0); setWrong(0); scoreRef.current = { correct: 0, wrong: 0 };
    setLeft(STROOP_SECONDS); setPrompt(randStroop()); setPhase("run");
    tick.current = setInterval(() => {
      setLeft((t) => {
        if (t <= 1) {
          clearInterval(tick.current); tick.current = null;
          const { correct: c, wrong: w } = scoreRef.current;
          const total = c + w;
          onDone({ correct: c, wrong: w, accuracy: total ? Math.round((c / total) * 100) : 0, seconds: STROOP_SECONDS });
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  };

  const answer = (choice) => {
    if (phase !== "run" || left <= 0) return;
    const ok = choice.name === prompt.ink.name;
    if (ok) { scoreRef.current.correct++; setCorrect((c) => c + 1); }
    else { scoreRef.current.wrong++; setWrong((w) => w + 1); }
    setFlash(ok ? "good" : "bad");
    setTimeout(() => setFlash(null), 140);
    setPrompt(randStroop());
  };

  if (phase === "intro") {
    return (
      <Screen>
        <TopBar onBack={onBack} />
        <TestIntro test="stroop" />
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, margin: "18px 0 22px" }}>
          <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6 }}>
            A colour word appears in a coloured ink. Tap the button matching the <b style={{ color: C.text }}>ink colour</b>,
            not what the word says. You get {STROOP_SECONDS} seconds — go fast, stay accurate.
          </div>
        </div>
        <button style={btnPrimary(TESTS.stroop.color)} onClick={start}>Start {STROOP_SECONDS}s sprint</button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 15, color: C.dim }}>{"✓ "}<b style={{ color: C.good }}>{correct}</b>{"  ✗ "}<b style={{ color: C.danger }}>{wrong}</b></div>
        <div style={{ fontSize: 22, fontWeight: 800, color: left <= 10 ? C.danger : C.text }}>{left}s</div>
      </div>

      <div style={{
        height: 180, borderRadius: 16, marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "center",
        background: flash === "good" ? "rgba(76,175,125,.14)" : flash === "bad" ? "rgba(229,96,77,.14)" : C.panel,
        border: `1px solid ${flash === "good" ? C.good : flash === "bad" ? C.danger : C.line}`, transition: "all .1s",
      }}>
        <span style={{ fontSize: 60, fontWeight: 800, color: prompt.ink.hex, letterSpacing: ".02em" }}>{prompt.word.name}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {STROOP_COLORS.map((c) => (
          <button key={c.name} onClick={() => answer(c)} style={{
            background: c.hex, color: "#0f1318", border: "none", borderRadius: 14,
            padding: "22px 0", fontSize: 17, fontWeight: 800, cursor: "pointer",
          }}>{c.name}</button>
        ))}
      </div>
    </Screen>
  );
}

// ===========================================================================
// Go / No-Go (response inhibition)
// ===========================================================================
const GNG_TRIALS = 30;
const GNG_GO_PROB = 0.72; // frequent "go" builds a reflex that "no-go" must fight
const GNG_STIM = 850;     // ms a stimulus is on screen
const GNG_ITI = 400;      // ms blank between stimuli

function GoNoGoTest({ onDone, onBack }) {
  const [phase, setPhase] = useState("intro"); // intro | stim | iti
  const [isGo, setIsGo] = useState(true);
  const [n, setN] = useState(0);               // trial index shown (1-based for display)
  const [flash, setFlash] = useState(null);    // 'hit' | 'false' brief tap feedback

  const seq = useRef([]);
  const idx = useRef(0);
  const responded = useRef(false);
  const stimAt = useRef(0);
  const res = useRef({ hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, rts: [] });
  const t1 = useRef(null), t2 = useRef(null), t3 = useRef(null);

  const clearAll = () => [t1, t2, t3].forEach((t) => { if (t.current) { clearTimeout(t.current); t.current = null; } });
  useEffect(() => clearAll, []);

  const finish = () => {
    const r = res.current;
    const total = GNG_TRIALS;
    const correct = r.hits + r.correctRejections;
    const accuracy = Math.round((correct / total) * 100);
    const meanRt = r.rts.length ? Math.round(r.rts.reduce((a, b) => a + b, 0) / r.rts.length) : 0;
    onDone({
      accuracy, hits: r.hits, misses: r.misses,
      falseAlarms: r.falseAlarms, correctRejections: r.correctRejections,
      meanRt, trials: total,
    });
  };

  const runTrial = (i) => {
    if (i >= GNG_TRIALS) { finish(); return; }
    idx.current = i;
    responded.current = false;
    const go = seq.current[i];
    setIsGo(go); setN(i + 1); setPhase("stim");
    stimAt.current = performance.now();
    t1.current = setTimeout(() => {
      // Stimulus window closed with no response → resolve the omission case.
      if (!responded.current) {
        if (go) res.current.misses++; else res.current.correctRejections++;
      }
      setPhase("iti");
      t2.current = setTimeout(() => runTrial(i + 1), GNG_ITI);
    }, GNG_STIM);
  };

  const start = () => {
    res.current = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, rts: [] };
    seq.current = Array.from({ length: GNG_TRIALS }, () => Math.random() < GNG_GO_PROB);
    runTrial(0);
  };

  const tap = () => {
    if (phase !== "stim" || responded.current) return;
    responded.current = true;
    if (isGo) { res.current.hits++; res.current.rts.push(performance.now() - stimAt.current); setFlash("hit"); }
    else { res.current.falseAlarms++; setFlash("false"); }
    t3.current = setTimeout(() => setFlash(null), 160);
  };

  if (phase === "intro") {
    return (
      <Screen>
        <TopBar onBack={onBack} />
        <TestIntro test="gng" />
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, margin: "18px 0 22px" }}>
          <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.65 }}>
            A circle flashes. <b style={{ color: "#5cbf6b" }}>Green</b> — tap anywhere, fast.
            <b style={{ color: C.danger }}> Red</b> — do nothing. Most are green, so the urge to tap builds; the whole test is whether you can stop yourself on the red ones. {GNG_TRIALS} rounds, about 40 seconds.
          </div>
        </div>
        <button style={btnPrimary(TESTS.gng.color)} onClick={start}>Start</button>
      </Screen>
    );
  }

  const showStim = phase === "stim";
  const dotColor = isGo ? "#5cbf6b" : C.danger;
  return (
    <div onClick={tap} style={{
      position: "fixed", inset: 0, background: flash === "false" ? "rgba(229,96,77,.16)" : C.bg,
      color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      cursor: "pointer", userSelect: "none", transition: "background .08s",
    }}>
      <div style={{ position: "absolute", top: 22, fontSize: 12, letterSpacing: ".2em", color: C.dim, fontWeight: 600 }}>{n} / {GNG_TRIALS}</div>
      {showStim ? (
        <div style={{
          width: 190, height: 190, borderRadius: "50%", background: dotColor,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#0f1318", fontSize: 34, fontWeight: 800, letterSpacing: ".05em",
          boxShadow: `0 0 70px -12px ${dotColor}`, transform: flash === "hit" ? "scale(0.94)" : "scale(1)", transition: "transform .08s",
        }}>{isGo ? "GO" : "STOP"}</div>
      ) : (
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.line }} />
      )}
      <div style={{ position: "absolute", bottom: 40, color: C.faint, fontSize: 13 }}>Tap for green. Hold back on red.</div>
    </div>
  );
}

// ===========================================================================
// N-Back (working memory)
// ===========================================================================
const NBACK_LEN = 24;
const NBACK_STIM = 2200;  // ms each letter is visible
const NBACK_MATCH = 0.3;  // target rate of matches
const NBACK_LETTERS = "BCDFGHJKLMNPQRSTVWXYZ".split(""); // consonants, no easy words

function NBackTest({ onDone, onBack }) {
  const [phase, setPhase] = useState("intro"); // intro | run
  const [level, setLevel] = useState(2);
  const [letter, setLetter] = useState("");
  const [pos, setPos] = useState(0);           // 1-based position for display
  const [flash, setFlash] = useState(null);    // 'good' | 'bad'

  const seq = useRef([]);
  const responded = useRef(false);
  const res = useRef({ hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 });
  const nRef = useRef(2);
  const t1 = useRef(null), t2 = useRef(null);

  const clearAll = () => [t1, t2].forEach((t) => { if (t.current) { clearTimeout(t.current); t.current = null; } });
  useEffect(() => clearAll, []);

  const buildSeq = (n) => {
    const s = [];
    for (let i = 0; i < NBACK_LEN; i++) {
      if (i >= n && Math.random() < NBACK_MATCH) {
        s.push(s[i - n]); // deliberate match
      } else {
        let c;
        do { c = NBACK_LETTERS[Math.floor(Math.random() * NBACK_LETTERS.length)]; }
        while (i >= n && c === s[i - n]); // avoid an accidental match
        s.push(c);
      }
    }
    return s;
  };

  const finish = () => {
    const r = res.current;
    const scored = NBACK_LEN - nRef.current; // positions where a match is possible
    const correct = r.hits + r.correctRejections;
    const accuracy = Math.round((correct / scored) * 100);
    onDone({ n: nRef.current, accuracy, hits: r.hits, misses: r.misses, falseAlarms: r.falseAlarms, scored });
  };

  const runPos = (i) => {
    if (i >= NBACK_LEN) { finish(); return; }
    responded.current = false;
    setLetter(seq.current[i]); setPos(i + 1);
    t1.current = setTimeout(() => {
      const n = nRef.current;
      if (i >= n) {
        const isMatch = seq.current[i] === seq.current[i - n];
        if (!responded.current) {
          if (isMatch) res.current.misses++; else res.current.correctRejections++;
        }
      }
      setLetter(""); // brief gap
      t2.current = setTimeout(() => runPos(i + 1), 300);
    }, NBACK_STIM);
  };

  const start = () => {
    nRef.current = level;
    res.current = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 };
    seq.current = buildSeq(level);
    setPhase("run");
    runPos(0);
  };

  const tapMatch = () => {
    if (phase !== "run" || !letter || responded.current) return;
    const i = pos - 1, n = nRef.current;
    if (i < n) return; // no possible match yet
    responded.current = true;
    const isMatch = seq.current[i] === seq.current[i - n];
    if (isMatch) { res.current.hits++; setFlash("good"); }
    else { res.current.falseAlarms++; setFlash("bad"); }
    setTimeout(() => setFlash(null), 150);
  };

  if (phase === "intro") {
    return (
      <Screen>
        <TopBar onBack={onBack} />
        <TestIntro test="nback" />
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, margin: "18px 0 18px" }}>
          <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.65 }}>
            Letters appear one at a time. Tap <b style={{ color: C.text }}>Match</b> whenever the current letter is the same as the one <b style={{ color: TESTS.nback.color }}>{level}</b> place{level > 1 ? "s" : ""} back. {NBACK_LEN} letters, no going back — you have to hold the recent ones in your head.
          </div>
        </div>
        <div style={{ fontSize: 12, letterSpacing: ".14em", color: C.dim, fontWeight: 600, marginBottom: 10 }}>DIFFICULTY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
          {[{ v: 1, label: "1-back", hint: "Easier" }, { v: 2, label: "2-back", hint: "Classic" }].map((o) => (
            <button key={o.v} onClick={() => setLevel(o.v)} style={{
              background: level === o.v ? TESTS.nback.color : C.panel, color: level === o.v ? "#2a0f20" : C.text,
              border: `1px solid ${level === o.v ? TESTS.nback.color : C.line}`, borderRadius: 12, padding: "14px 0",
              fontSize: 15, fontWeight: 700, cursor: "pointer", lineHeight: 1.3,
            }}>{o.label}<div style={{ fontSize: 11, fontWeight: 600, opacity: .8 }}>{o.hint}</div></button>
          ))}
        </div>
        <button style={btnPrimary(TESTS.nback.color)} onClick={start}>Start {level}-back</button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 12, letterSpacing: ".2em", color: TESTS.nback.color, fontWeight: 600 }}>{nRef.current}-BACK</div>
        <div style={{ fontSize: 15, color: C.dim }}>{pos} / {NBACK_LEN}</div>
      </div>
      <div style={{
        height: 220, borderRadius: 16, marginBottom: 26, display: "flex", alignItems: "center", justifyContent: "center",
        background: flash === "good" ? "rgba(76,175,125,.14)" : flash === "bad" ? "rgba(229,96,77,.14)" : C.panel,
        border: `1px solid ${flash === "good" ? C.good : flash === "bad" ? C.danger : C.line}`, transition: "all .1s",
      }}>
        <span style={{ fontSize: 96, fontWeight: 800, letterSpacing: ".02em" }}>{letter || ""}</span>
      </div>
      <button onClick={tapMatch} style={{ ...btnPrimary(TESTS.nback.color), padding: "20px", fontSize: 18 }}>Match</button>
      <div style={{ textAlign: "center", color: C.faint, fontSize: 13, marginTop: 14 }}>
        Tap only when this letter matches the one {nRef.current} back.
      </div>
    </Screen>
  );
}

// ===========================================================================
// Breath Hold
// ===========================================================================
function BreathTest({ onDone, onBack }) {
  const [phase, setPhase] = useState("intro"); // intro | holding
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const raf = useRef(null);

  const loop = useCallback(() => {
    setElapsed((performance.now() - startRef.current) / 1000);
    raf.current = requestAnimationFrame(loop);
  }, []);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const start = () => { startRef.current = performance.now(); setElapsed(0); setPhase("holding"); raf.current = requestAnimationFrame(loop); };
  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const secs = (performance.now() - startRef.current) / 1000;
    onDone({ seconds: Math.round(secs) });
  };

  if (phase === "intro") {
    return (
      <Screen>
        <TopBar onBack={onBack} />
        <TestIntro test="breath" />
        <div style={{ background: "rgba(229,96,77,.08)", border: `1px solid ${C.danger}`, borderRadius: 14, padding: 16, margin: "18px 0 8px" }}>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
            <b style={{ color: C.danger }}>Safety first.</b> Sit or lie down somewhere safe, on dry land — never in or near water.
            Stop the moment you feel dizzy or lightheaded. Skip this if you're pregnant or have heart or respiratory conditions.
          </div>
        </div>
        <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, margin: "14px 0 22px" }}>
          Take a couple of normal breaths, then a comfortable breath in. Tap <b style={{ color: C.text }}>Start</b>, hold,
          and tap <b style={{ color: C.text }}>Release</b> the instant you breathe. Don't push to blackout — the goal is to feel the urge, not to set a record.
        </div>
        <button style={btnPrimary(TESTS.breath.color)} onClick={start}>Start hold</button>
      </Screen>
    );
  }

  return (
    <div onClick={stop} style={{
      position: "fixed", inset: 0, background: C.bg, color: C.text, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none",
    }}>
      <div style={{ position: "absolute", top: 22, fontSize: 12, letterSpacing: ".2em", color: C.dim, fontWeight: 600 }}>HOLDING</div>
      <div style={{
        width: 150, height: 150, borderRadius: "50%", border: `3px solid ${TESTS.breath.color}`,
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 26,
        animation: "none", boxShadow: `0 0 60px -10px ${TESTS.breath.color}`,
      }}>
        <span style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtDur(elapsed)}</span>
      </div>
      <button style={{ ...btnPrimary(C.danger), width: "auto", padding: "16px 46px", color: "#fff" }}>Release</button>
      <div style={{ color: C.dim, fontSize: 13, marginTop: 18 }}>Tap anywhere the instant you breathe.</div>
    </div>
  );
}

// ===========================================================================
// Endurance Hold (isometric to failure) + RPE
// ===========================================================================
const HOLD_KINDS = ["Wall sit", "Plank", "Dead hang", "Other"];

function HoldTest({ onDone, onBack }) {
  const [phase, setPhase] = useState("intro"); // intro | prep | run | rate
  const [kind, setKind] = useState(HOLD_KINDS[0]);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [rpe, setRpe] = useState(8);
  const startRef = useRef(0);
  const raf = useRef(null);
  const prepTimer = useRef(null);
  const finalSecs = useRef(0);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (prepTimer.current) clearInterval(prepTimer.current);
  }, []);

  const loop = useCallback(() => {
    setElapsed((performance.now() - startRef.current) / 1000);
    raf.current = requestAnimationFrame(loop);
  }, []);

  const beginPrep = () => {
    setPhase("prep"); setCount(3);
    prepTimer.current = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          clearInterval(prepTimer.current); prepTimer.current = null;
          startRef.current = performance.now(); setElapsed(0);
          setPhase("run"); raf.current = requestAnimationFrame(loop);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    finalSecs.current = Math.round((performance.now() - startRef.current) / 1000);
    setPhase("rate");
  };

  if (phase === "intro") {
    return (
      <Screen>
        <TopBar onBack={onBack} />
        <TestIntro test="hold" />
        <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, margin: "18px 0 16px" }}>
          Pick a hold, get into position, and go to failure — the point where you genuinely can't hold form, not the point where it merely burns.
          Afterwards you'll log how hard it felt.
        </div>
        <div style={{ fontSize: 12, letterSpacing: ".14em", color: C.dim, fontWeight: 600, marginBottom: 10 }}>EXERCISE</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
          {HOLD_KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} style={{
              background: kind === k ? C.warm : C.panel, color: kind === k ? "#241a06" : C.text,
              border: `1px solid ${kind === k ? C.warm : C.line}`, borderRadius: 12, padding: "14px 0",
              fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}>{k}</button>
          ))}
        </div>
        <button style={btnPrimary(C.warm)} onClick={beginPrep}>Get ready</button>
      </Screen>
    );
  }

  if (phase === "prep") {
    return (
      <div style={{ position: "fixed", inset: 0, background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.dim, fontSize: 16, marginBottom: 10 }}>Get into position…</div>
        <div style={{ fontSize: 120, fontWeight: 800, color: C.warm }}>{count}</div>
      </div>
    );
  }

  if (phase === "run") {
    return (
      <div onClick={stop} style={{
        position: "fixed", inset: 0, background: C.bg, color: C.text, display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none",
      }}>
        <div style={{ position: "absolute", top: 22, fontSize: 12, letterSpacing: ".2em", color: C.warm, fontWeight: 600 }}>{kind.toUpperCase()}</div>
        <div style={{ fontSize: 72, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtDur(elapsed)}</div>
        <button style={{ ...btnPrimary(C.warm), width: "auto", padding: "16px 46px", marginTop: 30 }}>I'm done</button>
        <div style={{ color: C.dim, fontSize: 13, marginTop: 18 }}>Hold form. Tap when you can't.</div>
      </div>
    );
  }

  // rate
  return (
    <Screen>
      <TopBar />
      <div style={{ textAlign: "center", margin: "10px 0 8px" }}>
        <div style={{ color: C.dim, fontSize: 14 }}>{kind}</div>
        <div style={{ fontSize: 56, fontWeight: 800, color: C.warm }}>{fmtDur(finalSecs.current)}</div>
      </div>
      <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, textAlign: "center", margin: "6px 0 24px" }}>
        How hard did that feel at the end? <br />(Rate of perceived exertion, 1–10)
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", marginBottom: 28 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button key={n} onClick={() => setRpe(n)} style={{
            width: 40, height: 44, borderRadius: 10, fontWeight: 700, fontSize: 16, cursor: "pointer",
            background: rpe === n ? C.warm : C.panel, color: rpe === n ? "#241a06" : C.text,
            border: `1px solid ${rpe === n ? C.warm : C.line}`,
          }}>{n}</button>
        ))}
      </div>
      <button style={btnPrimary(C.warm)} onClick={() => onDone({ seconds: finalSecs.current, kind, rpe })}>Save result</button>
    </Screen>
  );
}

// ===========================================================================
// Shared intro header for the panel-based tests.
// ===========================================================================
function TestIntro({ test }) {
  const def = TESTS[test];
  return (
    <div>
      <div style={{ fontSize: 40, marginBottom: 4 }}>{def.icon}</div>
      <h1 style={{ margin: "0 0 2px", letterSpacing: "-.02em", fontSize: 28 }}>{def.name}</h1>
      <div style={{ fontSize: 12, color: def.color, letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>{def.tag}</div>
      <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.65 }}>{def.blurb}</div>
    </div>
  );
}

// ===========================================================================
// Result summary shown after a completed test.
// ===========================================================================
function Result({ test, result, prevBest, onAgain, onHome }) {
  const def = TESTS[test];
  const score = def.score(result);
  const isPB = prevBest == null ||
    (def.better === "lower" ? score < prevBest : score > prevBest);

  const stats = [];
  if (test === "pvt") {
    stats.push(["Average", def.fmt(result.mean)]);
    stats.push(["Fastest", `${Math.round(result.best)} ms`]);
    stats.push(["Lapses (>500ms)", `${result.lapses}`]);
  } else if (test === "stroop") {
    stats.push(["Correct", `${result.correct}`]);
    stats.push(["Errors", `${result.wrong}`]);
    stats.push(["Accuracy", `${result.accuracy}%`]);
  } else if (test === "gng") {
    stats.push(["Accuracy", `${result.accuracy}%`]);
    stats.push(["Correct stops (red)", `${result.correctRejections}`]);
    stats.push(["False taps (red)", `${result.falseAlarms}`]);
    stats.push(["Missed greens", `${result.misses}`]);
    if (result.meanRt) stats.push(["Avg tap speed", `${result.meanRt} ms`]);
  } else if (test === "nback") {
    stats.push(["Accuracy", `${result.accuracy}%`]);
    stats.push(["Level", `${result.n}-back`]);
    stats.push(["Matches caught", `${result.hits}`]);
    stats.push(["Missed matches", `${result.misses}`]);
    stats.push(["False alarms", `${result.falseAlarms}`]);
  } else if (test === "breath") {
    stats.push(["Hold", fmtDur(result.seconds)]);
  } else if (test === "hold") {
    stats.push(["Held", fmtDur(result.seconds)]);
    stats.push(["Exercise", result.kind]);
    stats.push(["Perceived effort", `${result.rpe}/10`]);
  }

  return (
    <Screen>
      <TopBar />
      <div style={{ textAlign: "center", padding: "16px 0 6px" }}>
        <div style={{ fontSize: 44 }}>{def.icon}</div>
        {isPB
          ? <div style={{ color: C.warm, fontWeight: 800, letterSpacing: ".14em", fontSize: 13, marginTop: 8 }}>{"★ NEW PERSONAL BEST"}</div>
          : <div style={{ color: C.dim, fontWeight: 600, letterSpacing: ".14em", fontSize: 12, marginTop: 8 }}>SESSION COMPLETE</div>}
        <div style={{ fontSize: 52, fontWeight: 800, color: def.color, margin: "6px 0 2px" }}>{def.fmt(score)}</div>
        {prevBest != null && !isPB && (
          <div style={{ color: C.faint, fontSize: 13 }}>Your best: {def.fmt(prevBest)}</div>
        )}
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "6px 18px", margin: "22px 0" }}>
        {stats.map(([k, v], i) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: i < stats.length - 1 ? `1px solid ${C.line}` : "none" }}>
            <span style={{ color: C.dim, fontSize: 14 }}>{k}</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <button style={btnPrimary(def.color)} onClick={onAgain}>Go again</button>
        <button style={{ ...btnGhost, padding: "13px", fontSize: 15 }} onClick={onHome}>Back to tests</button>
      </div>
    </Screen>
  );
}

// ===========================================================================
// Root: routes between home, a test, and its result.
// ===========================================================================
function App({ user }) {
  const [sessions, setSessions] = useState([]);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  const [view, setView] = useState({ name: "home" }); // {name:'home'} | {name:'test',test} | {name:'result',test,result}

  const load = useCallback(async () => {
    try { setSessions(await db.list(COLLECTION)); setReady(true); }
    catch (e) { setErr(e.message || "Couldn't load your results."); setReady(true); }
  }, []);
  useEffect(() => { load(); const ch = db.subscribe(load); return () => ch.unsubscribe(); }, [load]);

  const prevBestScore = (test) => {
    const list = sessions.filter((s) => s.test === test);
    const b = bestOf(list, test);
    return b ? TESTS[test].score(b) : null;
  };

  const finish = async (test, result) => {
    const prevBest = prevBestScore(test);
    const doc = { test, ts: new Date().toISOString(), ...result };
    try { await db.set(COLLECTION, doc); }
    catch (e) { setErr(e.message || "Couldn't save that result."); }
    load();
    setView({ name: "result", test, result, prevBest });
  };

  if (view.name === "test") {
    const props = { onBack: () => setView({ name: "home" }), onDone: (r) => finish(view.test, r) };
    if (view.test === "pvt") return <PVTTest {...props} />;
    if (view.test === "stroop") return <StroopTest {...props} />;
    if (view.test === "gng") return <GoNoGoTest {...props} />;
    if (view.test === "nback") return <NBackTest {...props} />;
    if (view.test === "breath") return <BreathTest {...props} />;
    if (view.test === "hold") return <HoldTest {...props} />;
  }

  if (view.name === "result") {
    return <Result test={view.test} result={view.result} prevBest={view.prevBest}
      onAgain={() => setView({ name: "test", test: view.test })}
      onHome={() => setView({ name: "home" })} />;
  }

  return <Home user={user} sessions={sessions} ready={ready} err={err} onOpen={(t) => setView({ name: "test", test: t })} />;
}

createRoot(document.getElementById("root")).render(
  <AuthGate>{(user) => <App user={user} />}</AuthGate>
);
