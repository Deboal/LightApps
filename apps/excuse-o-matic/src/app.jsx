import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { CATEGORIES, TEMPS, CIRCUMSTANCES, EXCUSES } from "./excuses.js";
import { generate, fill, pick, verdictFor } from "./generate.js";

// Excuse-O-Matic — a wacky-but-technically-possible excuse generator.
// Fully offline: no sign-in, no network, everything baked into the bundle.

// ----------------------------------------------------------------------------
// Style
// ----------------------------------------------------------------------------
const C = {
  bg: "#140f1c", panel: "#1f1830", panel2: "#2a2140", line: "#372a4d",
  text: "#f6f0ff", dim: "#a897c4", faint: "#7a6a94",
  accent: "#ff8a3d", accent2: "#ffd166", good: "#4ade80", bad: "#ff4d6d",
};

const shell = {
  maxWidth: 560, margin: "0 auto", padding: "20px 16px 40px",
  minHeight: "100dvh", display: "flex", flexDirection: "column",
};
const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 };
const label = { fontSize: 11, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: C.faint, marginBottom: 9 };

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------
const LS = "excuse-o-matic/v1";

function loadState() {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : null;
  } catch { return null; }
}

function saveState(s) {
  try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* private mode, whatever */ }
}

// ----------------------------------------------------------------------------
// Small components
// ----------------------------------------------------------------------------
function Chip({ active, onClick, children, accent }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${active ? (accent || C.accent) : C.line}`,
        background: active ? `${accent || C.accent}22` : "transparent",
        color: active ? C.text : C.dim,
        borderRadius: 999, padding: "8px 13px", fontSize: 13.5,
        fontWeight: active ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap",
        transition: "all .12s",
      }}
    >{children}</button>
  );
}

function TempPicker({ value, onChange }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
      {TEMPS.map((t) => {
        const on = value === t.t;
        return (
          <button
            key={t.t}
            onClick={() => onChange(t.t)}
            style={{
              border: `1px solid ${on ? t.color : C.line}`,
              background: on ? `${t.color}1f` : "transparent",
              borderRadius: 12, padding: "10px 4px", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              transition: "all .12s",
            }}
          >
            <div style={{ display: "flex", gap: 2 }}>
              {[1, 2, 3, 4].map((i) => (
                <span key={i} style={{
                  width: 5, height: 5, borderRadius: 999,
                  background: i <= t.t ? (on ? t.color : C.line) : "transparent",
                  border: `1px solid ${i <= t.t ? (on ? t.color : C.line) : C.line}`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: on ? t.color : C.dim, letterSpacing: "-.01em" }}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Meter({ score }) {
  const color = score >= 80 ? C.good : score >= 55 ? C.accent2 : score >= 25 ? C.accent : C.bad;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ ...label, marginBottom: 0 }}>Credibility</span>
        <span style={{ fontSize: 13, fontWeight: 900, color }}>{score}%</span>
      </div>
      <div style={{ height: 7, background: C.panel2, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 999, transition: "width .5s cubic-bezier(.2,.8,.2,1)" }} />
      </div>
      <div style={{ fontSize: 12.5, color: C.dim, marginTop: 7 }}>{verdictFor(score)}</div>
    </div>
  );
}

function Bubble({ text }) {
  return (
    <div style={{ background: "#0b0813", borderRadius: 14, padding: "14px 12px", border: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 10.5, color: C.faint, textAlign: "center", marginBottom: 10, fontWeight: 700, letterSpacing: ".05em" }}>SETH</div>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <div style={{
          background: "#2b2b30", color: "#fff", borderRadius: "18px 18px 18px 5px",
          padding: "10px 14px", fontSize: 15, lineHeight: 1.42, maxWidth: "88%",
        }}>{text}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <div style={{
          background: "#1f7aec", color: "#fff", borderRadius: "18px 18px 5px 18px",
          padding: "10px 14px", fontSize: 15, maxWidth: "70%",
        }}>...</div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------
function App() {
  const boot = useMemo(() => loadState() || {}, []);
  const [tab, setTab] = useState("gen");
  const [circumstance, setCircumstance] = useState(boot.circ || "guys");
  const [temp, setTemp] = useState(boot.temp || 3);
  const [cats, setCats] = useState(boot.cats && boot.cats.length ? boot.cats : CATEGORIES.map((c) => c.key));
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(boot.saved || []);
  const [history, setHistory] = useState([]);
  const [rolling, setRolling] = useState(false);
  const [rollText, setRollText] = useState("");
  const [texting, setTexting] = useState(false);
  const [toast, setToast] = useState("");
  const recent = useRef(new Set());
  const timers = useRef([]);

  useEffect(() => saveState({ circ: circumstance, temp, cats, saved }), [circumstance, temp, cats, saved]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const flash = useCallback((msg) => {
    setToast(msg);
    const id = setTimeout(() => setToast(""), 1600);
    timers.current.push(id);
  }, []);

  const roll = useCallback(() => {
    if (rolling) return;
    setRolling(true);
    setTexting(false);

    // Slot-machine tease: flick through candidate bodies before landing.
    const spin = setInterval(() => {
      setRollText(fill(pick(EXCUSES).x, {}));
    }, 55);

    const land = setTimeout(() => {
      clearInterval(spin);
      const r = generate({ circumstance, temp, cats, avoid: recent.current });
      recent.current.add(r.raw);
      if (recent.current.size > 40) recent.current = new Set([r.raw]);
      setResult(r);
      setHistory((h) => [r, ...h].slice(0, 12));
      setRolling(false);
    }, 620);

    timers.current.push(land);
  }, [rolling, circumstance, temp, cats]);

  // Generate one on first paint so the app never opens empty.
  useEffect(() => { roll(); /* eslint-disable-next-line */ }, []);

  const toggleCat = (key) => {
    setCats((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      return next.length ? next : prev; // never allow zero selected
    });
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); flash("Copied"); } catch { flash("Copy failed"); }
      document.body.removeChild(ta);
    }
  };

  const share = async (text) => {
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch { /* user cancelled */ }
    }
    copy(text);
  };

  const isSaved = result && saved.some((s) => s.text === result.text);
  const toggleSave = () => {
    if (!result) return;
    if (isSaved) {
      setSaved((s) => s.filter((x) => x.text !== result.text));
      flash("Removed");
    } else {
      setSaved((s) => [result, ...s].slice(0, 100));
      flash("Saved to Hall of Fame");
    }
  };

  const tempMeta = TEMPS.find((t) => t.t === temp);
  const catMeta = result && CATEGORIES.find((c) => c.key === result.cat);
  const circMeta = result && CIRCUMSTANCES.find((c) => c.key === result.circ);

  return (
    <div style={shell}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 27 }}>🎰</span>
          <h1 style={{
            margin: 0, fontSize: 25, letterSpacing: "-.03em", fontWeight: 900,
            background: `linear-gradient(100deg, ${C.accent2}, ${C.accent})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>Excuse-O-Matic</h1>
        </div>
        <p style={{ margin: "5px 0 0 37px", color: C.dim, fontSize: 13.5 }}>
          Wacky but technically possible. Powered by Lindsey, Gavin, Ruby &amp; Paisley.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, background: C.panel, padding: 4, borderRadius: 12, border: `1px solid ${C.line}` }}>
        {[["gen", "Generate"], ["saved", `Hall of Fame${saved.length ? ` (${saved.length})` : ""}`]].map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, border: "none", borderRadius: 9, padding: "9px 8px", cursor: "pointer",
            background: tab === k ? C.panel2 : "transparent",
            color: tab === k ? C.text : C.dim, fontWeight: 700, fontSize: 13.5,
          }}>{t}</button>
        ))}
      </div>

      {tab === "gen" && (
        <>
          {/* Circumstance */}
          <div style={{ marginBottom: 16 }}>
            <div style={label}>What's he getting out of?</div>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 4, margin: "0 -16px", padding: "0 16px 4px" }}>
              <Chip active={circumstance === "random"} onClick={() => setCircumstance("random")} accent={C.accent2}>🎲 Surprise me</Chip>
              {CIRCUMSTANCES.map((c) => (
                <Chip key={c.key} active={circumstance === c.key} onClick={() => setCircumstance(c.key)}>
                  {c.emoji} {c.label}
                </Chip>
              ))}
            </div>
          </div>

          {/* Temperature */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={label}>Temperature</div>
              <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 9 }}>{tempMeta.blurb}</div>
            </div>
            <TempPicker value={temp} onChange={setTemp} />
          </div>

          {/* Flavors */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={label}>Flavor</div>
              <button
                onClick={() => setCats(cats.length === CATEGORIES.length ? ["church"] : CATEGORIES.map((c) => c.key))}
                style={{ background: "none", border: "none", color: C.faint, fontSize: 11.5, cursor: "pointer", marginBottom: 9, fontWeight: 700 }}
              >{cats.length === CATEGORIES.length ? "clear" : "all"}</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {CATEGORIES.map((c) => (
                <Chip key={c.key} active={cats.includes(c.key)} onClick={() => toggleCat(c.key)}>
                  {c.emoji} {c.label}
                </Chip>
              ))}
            </div>
          </div>

          {/* Result */}
          <div style={{ ...card, marginBottom: 12, minHeight: 168, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {rolling ? (
              <div style={{ fontSize: 16, lineHeight: 1.5, color: C.faint, opacity: .55, fontStyle: "italic" }}>
                {rollText || "Consulting the family calendar…"}
              </div>
            ) : result ? (
              <>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
                  <Tag color={tempMeta.color}>{TEMPS.find((t) => t.t === result.temp).label}</Tag>
                  {catMeta && <Tag>{catMeta.emoji} {catMeta.label}</Tag>}
                  {circMeta && <Tag>{circMeta.emoji} {circMeta.label}</Tag>}
                </div>

                {texting
                  ? <Bubble text={result.text} />
                  : <div style={{ fontSize: 17.5, lineHeight: 1.48, fontWeight: 500, letterSpacing: "-.01em" }}>{result.text}</div>}

                <div style={{ height: 1, background: C.line, margin: "15px 0 13px" }} />
                <Meter score={result.score} />
                <div style={{ fontSize: 12, color: C.faint, marginTop: 9, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>💍</span><span>{result.corroboration}</span>
                </div>
              </>
            ) : null}
          </div>

          {/* Actions */}
          <button
            onClick={roll}
            disabled={rolling}
            style={{
              width: "100%", border: "none", borderRadius: 14, padding: "17px 18px",
              fontWeight: 900, fontSize: 17, cursor: rolling ? "default" : "pointer", color: "#22150a",
              background: `linear-gradient(135deg, ${C.accent2}, ${C.accent})`,
              opacity: rolling ? .6 : 1, letterSpacing: "-.01em", marginBottom: 9,
            }}
          >{rolling ? "Cooking one up…" : "Generate an excuse"}</button>

          <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
            <Ghost onClick={() => result && copy(result.text)} disabled={!result}>Copy</Ghost>
            <Ghost onClick={() => result && share(result.text)} disabled={!result}>Share</Ghost>
            <Ghost onClick={() => setTexting((v) => !v)} disabled={!result} active={texting}>Text view</Ghost>
            <Ghost onClick={toggleSave} disabled={!result} active={isSaved}>{isSaved ? "★ Saved" : "☆ Save"}</Ghost>
          </div>

          {/* Recent */}
          {history.length > 1 && (
            <div>
              <div style={label}>Recent</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {history.slice(1, 6).map((h) => (
                  <button key={h.id} onClick={() => { setResult(h); setTexting(false); }} style={{
                    textAlign: "left", background: C.panel, border: `1px solid ${C.line}`,
                    borderRadius: 11, padding: "10px 12px", color: C.dim, fontSize: 13,
                    lineHeight: 1.4, cursor: "pointer",
                  }}>
                    <span style={{ color: TEMPS.find((t) => t.t === h.temp).color, fontWeight: 800, fontSize: 11 }}>
                      {TEMPS.find((t) => t.t === h.temp).label.toUpperCase()}
                    </span>
                    {" — "}
                    {h.text.length > 96 ? `${h.text.slice(0, 96)}…` : h.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "saved" && (
        <div>
          {!saved.length ? (
            <div style={{ ...card, textAlign: "center", color: C.dim, padding: "44px 20px" }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🏆</div>
              <div style={{ fontWeight: 800, color: C.text, marginBottom: 5 }}>No legends yet</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                Hit ☆ Save on an excuse and it lands here — the ones worth bringing up at Thanksgiving.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {saved.map((s) => {
                const tm = TEMPS.find((t) => t.t === s.temp);
                return (
                  <div key={s.id} style={card}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 9, flexWrap: "wrap" }}>
                      <Tag color={tm.color}>{tm.label}</Tag>
                      <Tag>{s.score}% credible</Tag>
                    </div>
                    <div style={{ fontSize: 15.5, lineHeight: 1.46 }}>{s.text}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <Ghost onClick={() => copy(s.text)}>Copy</Ghost>
                      <Ghost onClick={() => share(s.text)}>Share</Ghost>
                      <Ghost onClick={() => setSaved((x) => x.filter((y) => y.id !== s.id))}>Delete</Ghost>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1 }} />
      <div style={{ textAlign: "center", color: C.faint, fontSize: 11.5, marginTop: 26, lineHeight: 1.6 }}>
        {EXCUSES.length} hand-written excuses · thousands of combinations<br />
        Works offline. No sign-in. Seth cannot see this app.
      </div>

      {toast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)",
          background: C.panel2, border: `1px solid ${C.line}`, color: C.text,
          padding: "10px 18px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
          boxShadow: "0 8px 28px rgba(0,0,0,.5)", zIndex: 50,
        }}>{toast}</div>
      )}
    </div>
  );
}

function Tag({ children, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, letterSpacing: ".02em",
      color: color || C.dim, background: color ? `${color}1c` : C.panel2,
      border: `1px solid ${color ? `${color}44` : C.line}`,
      padding: "4px 9px", borderRadius: 999,
    }}>{children}</span>
  );
}

function Ghost({ children, onClick, disabled, active }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, background: active ? `${C.accent}1f` : "transparent",
      border: `1px solid ${active ? C.accent : C.line}`,
      color: disabled ? C.faint : active ? C.accent : C.dim,
      borderRadius: 11, padding: "10px 6px", fontSize: 13, fontWeight: 700,
      cursor: disabled ? "default" : "pointer", opacity: disabled ? .45 : 1,
      whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

createRoot(document.getElementById("root")).render(<App />);
