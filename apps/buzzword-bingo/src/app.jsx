import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { store, configured } from "../../../shared/store.js";
import { sb } from "../../../shared/client.js";

// Corporate Buzzword Bingo.
//
//  - Play with NO account (guest): a solid built-in word list works fully offline.
//  - Sign in with EMAIL + PASSWORD (with password reset) to unlock the community
//    word repository: signed-in players can add new buzzwords for future games,
//    and everyone signed in draws from the shared pool.
//  - Play up to 3 cards at once. Each card is a classic 5x5 grid with a FREE
//    center. Mark squares as the buzzwords get said; any full row, column, or
//    diagonal is a BINGO.
//
// The shared shared/auth.js is magic-link only and mandatory, which doesn't fit
// (we need passwords + optional guest play), so auth here talks to the shared
// Supabase client directly. It still reuses the one hub backend + session.

const db = store("buzzword-bingo", { shared: true }); // community word pool, shared across signed-in users
const WORDS_COLLECTION = "words";

// ----------------------------------------------------------------------------
// Built-in buzzwords — the default deck. Works offline, no account needed.
// ----------------------------------------------------------------------------
const BUILTIN_WORDS = [
  "Synergy", "Circle back", "Low-hanging fruit", "Move the needle", "Deep dive",
  "Bandwidth", "Touch base", "Take this offline", "Leverage", "Paradigm shift",
  "Think outside the box", "Boil the ocean", "Drink the Kool-Aid", "Ping me",
  "Ducks in a row", "Best practice", "Core competency", "Value-add", "Deliverable",
  "Actionable", "Scalable", "Streamline", "Optimize", "Pivot", "Disrupt",
  "Ecosystem", "Holistic", "Ideate", "Double-click", "Drill down",
  "Run it up the flagpole", "Open the kimono", "Table stakes", "North Star",
  "Quick win", "Game changer", "Win-win", "Value proposition", "Wheelhouse",
  "In the weeds", "Herding cats", "Buy-in", "Alignment", "Cadence",
  "Level set", "Sync up", "Loop in", "Circle of trust", "Boots on the ground",
  "Move fast and break things", "Growth hacking", "Thought leadership",
  "Digital transformation", "Agile", "Blue-sky thinking", "Peel the onion",
  "Elephant in the room", "Push the envelope", "Secret sauce", "Give 110%",
  "At the end of the day", "It is what it is", "Per my last email",
  "Let's take it to the next level", "Boil it down", "Right-size",
  "Mission-critical", "Bleeding edge", "Cross-functional", "Empower", "Robust", "Seamless",
  "Turnkey", "Best-in-class", "Frictionless", "Unpack that", "Sea change",
  "New normal", "Pain point", "Stakeholder", "Deep bench", "Onboarding",
];

// ----------------------------------------------------------------------------
// Theme + shared style bits
// ----------------------------------------------------------------------------
const C = {
  bg: "#0e1526", panel: "#16203a", panel2: "#1e2b4d", line: "#2c3a5e",
  text: "#eaf0fb", dim: "#8695b3", accent: "#4c8dff", accent2: "#22b8a6",
  gold: "#ffce54", good: "#43d19e", bad: "#ff6b6b",
};
const shell = { maxWidth: 640, margin: "0 auto", padding: "20px 16px 48px", minHeight: "100dvh" };
const bigBtn = { width: "100%", border: "none", borderRadius: 14, padding: "15px 18px", fontWeight: 800, fontSize: 16, cursor: "pointer", color: "#fff", background: C.accent };
const ghost = { background: "transparent", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 9, padding: "8px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 };
const input = { width: "100%", background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "12px 13px", fontSize: 15, outline: "none" };
const label = { fontSize: 11, letterSpacing: ".2em", color: C.dim, fontWeight: 700 };

function normWord(w) { return (w || "").trim().replace(/\s+/g, " "); }
function keyOf(w) { return normWord(w).toLowerCase(); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// A card: 25 cells (index 12 is the FREE center). Returns {cells, marks}.
function makeCard(pool) {
  const picks = shuffle(pool).slice(0, 24);
  // If the pool is short, pad by allowing repeats so a card is always full.
  while (picks.length < 24) picks.push(pool[Math.floor(Math.random() * pool.length)] || "TBD");
  const cells = [];
  let p = 0;
  for (let i = 0; i < 25; i++) {
    if (i === 12) cells.push({ word: "FREE", free: true });
    else cells.push({ word: picks[p++], free: false });
  }
  const marks = cells.map((c) => !!c.free); // free space starts marked
  return { cells, marks };
}

const LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

// Returns the set of cell indices that belong to a completed line (for highlight),
// and whether there is any bingo at all.
function winningCells(marks) {
  const win = new Set();
  let bingo = false;
  for (const ln of LINES) {
    if (ln.every((i) => marks[i])) { bingo = true; ln.forEach((i) => win.add(i)); }
  }
  return { bingo, win };
}

// ----------------------------------------------------------------------------
// Local persistence (survives a refresh mid-meeting; guest-friendly)
// ----------------------------------------------------------------------------
const LS = "buzzword-bingo/v1";
function loadLocal() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function saveLocal(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ } }

// ----------------------------------------------------------------------------
// Auth (email + password, with reset) against the shared Supabase client
// ----------------------------------------------------------------------------
function useAuth() {
  // undefined = loading, null = signed out, object = signed in
  const [user, setUser] = useState(undefined);
  const [recovery, setRecovery] = useState(false); // arrived via password-reset link
  useEffect(() => {
    if (!sb) { setUser(null); return; }
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { user, recovery, clearRecovery: () => setRecovery(false) };
}

function AuthModal({ onClose, startMode = "signin", recovery = false, onDoneRecovery }) {
  const [mode, setMode] = useState(recovery ? "reset" : startMode); // signin | signup | forgot | reset
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  const redirectTo = window.location.origin + window.location.pathname;

  const run = async (fn, ok) => {
    setErr(null); setMsg(null); setBusy(true);
    try { await fn(); if (ok) ok(); }
    catch (e) { setErr(e.message || "Something went wrong."); }
    setBusy(false);
  };

  const validEmail = /.+@.+\..+/.test(email.trim());

  const doSignIn = () => {
    if (!validEmail || !pw) return setErr("Enter your email and password.");
    run(async () => { const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw }); if (error) throw error; }, onClose);
  };
  const doSignUp = () => {
    if (!validEmail) return setErr("Enter a valid email.");
    if (pw.length < 6) return setErr("Password must be at least 6 characters.");
    if (pw !== pw2) return setErr("Passwords don't match.");
    run(async () => {
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password: pw, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
      if (data.session) { onClose(); }             // email confirmation off -> signed in now
      else setMsg("Account created. Check your email to confirm, then sign in."); // confirmation on
    });
  };
  const doForgot = () => {
    if (!validEmail) return setErr("Enter your email.");
    run(async () => { const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo }); if (error) throw error; },
      () => setMsg("If that email has an account, a reset link is on its way. Open it on this device."));
  };
  const doReset = () => {
    if (pw.length < 6) return setErr("Password must be at least 6 characters.");
    if (pw !== pw2) return setErr("Passwords don't match.");
    run(async () => { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; },
      () => { if (onDoneRecovery) onDoneRecovery(); onClose(); });
  };

  const titles = { signin: "Sign in", signup: "Create account", forgot: "Reset password", reset: "Set a new password" };
  const link = (m, txt) => <button style={{ ...ghost, border: "none", color: C.accent, padding: 4 }} onClick={() => { setErr(null); setMsg(null); setMode(m); }}>{txt}</button>;

  return (
    <div onClick={mode === "reset" ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(4,8,18,.72)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 18, paddingTop: "12vh", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 400, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 21 }}>{titles[mode]}</h2>
          {mode !== "reset" && <button style={{ ...ghost, border: "none", fontSize: 22, padding: "0 6px" }} onClick={onClose}>×</button>}
        </div>

        {mode === "reset" ? (
          <div style={{ color: C.dim, fontSize: 13, marginBottom: 12 }}>You followed a reset link. Choose a new password.</div>
        ) : null}

        <div style={{ display: "grid", gap: 10 }}>
          {mode !== "reset" && (
            <input style={input} type="email" placeholder="you@email.com" value={email} autoFocus
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (mode === "forgot" ? doForgot() : null)} />
          )}
          {(mode === "signin" || mode === "signup" || mode === "reset") && (
            <input style={input} type="password" placeholder={mode === "signin" ? "Password" : "New password"} value={pw}
              onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && mode === "signin" && doSignIn()} />
          )}
          {(mode === "signup" || mode === "reset") && (
            <input style={input} type="password" placeholder="Confirm password" value={pw2}
              onChange={(e) => setPw2(e.target.value)} />
          )}
        </div>

        {err && <div style={{ color: C.bad, fontSize: 13, marginTop: 10 }}>{err}</div>}
        {msg && <div style={{ color: C.good, fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>{msg}</div>}

        <button style={{ ...bigBtn, marginTop: 14, background: busy ? C.panel2 : C.accent }} disabled={busy}
          onClick={mode === "signin" ? doSignIn : mode === "signup" ? doSignUp : mode === "forgot" ? doForgot : doReset}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Update password"}
        </button>

        {mode !== "reset" && (
          <div style={{ marginTop: 14, fontSize: 13, color: C.dim, display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", alignItems: "center" }}>
            {mode === "signin" && <>New here? {link("signup", "Create an account")} · {link("forgot", "Forgot password?")}</>}
            {mode === "signup" && <>Already have an account? {link("signin", "Sign in")}</>}
            {mode === "forgot" && <>Remembered it? {link("signin", "Back to sign in")}</>}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Word repository panel (signed-in only): add community buzzwords
// ----------------------------------------------------------------------------
function WordManager({ user, words, community, onClose, onChanged }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  const existing = new Set(words.map(keyOf));

  const add = async () => {
    setErr(null); setNote(null);
    const candidates = text.split(/[\n,]/).map(normWord).filter(Boolean);
    const fresh = [];
    const seen = new Set();
    for (const w of candidates) {
      const k = keyOf(w);
      if (existing.has(k) || seen.has(k)) continue;
      seen.add(k); fresh.push(w);
    }
    if (!fresh.length) { setErr("Nothing new to add (already in the pool?)."); return; }
    setBusy(true);
    try {
      for (const w of fresh) await db.set(WORDS_COLLECTION, { word: w, by: user.email || "" });
      setText(""); setNote(`Added ${fresh.length} word${fresh.length > 1 ? "s" : ""} to the community pool.`);
      await onChanged();
    } catch (e) { setErr(e.message || "Could not save. Try again."); }
    setBusy(false);
  };

  const remove = async (item) => {
    setErr(null); setNote(null);
    try { await db.remove(WORDS_COLLECTION, item.id); await onChanged(); }
    catch (e) { setErr(e.message || "Could not remove."); }
  };

  const mine = community.filter((c) => c.by && c.by === user.email);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(4,8,18,.72)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 18, paddingTop: "8vh", zIndex: 50, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: 22, marginBottom: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 21 }}>Word repository</h2>
          <button style={{ ...ghost, border: "none", fontSize: 22, padding: "0 6px" }} onClick={onClose}>×</button>
        </div>
        <div style={{ color: C.dim, fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
          {words.length} buzzwords in play ({BUILTIN_WORDS.length} built-in + {community.length} community). New words show up in future games for everyone signed in.
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <textarea style={{ ...input, minHeight: 84, resize: "vertical", fontFamily: "inherit" }}
            placeholder={"Add buzzwords — one per line or comma-separated\ne.g. Synergy, Circle back, Move the needle"}
            value={text} onChange={(e) => setText(e.target.value)} />
          <button style={{ ...bigBtn, background: busy ? C.panel2 : C.accent2 }} disabled={busy} onClick={add}>
            {busy ? "Saving…" : "Add to repository"}
          </button>
        </div>
        {err && <div style={{ color: C.bad, fontSize: 13, marginTop: 10 }}>{err}</div>}
        {note && <div style={{ color: C.good, fontSize: 13, marginTop: 10 }}>{note}</div>}

        {mine.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ ...label, marginBottom: 8 }}>WORDS YOU ADDED</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {mine.map((c) => (
                <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 8px 6px 12px", fontSize: 13 }}>
                  {c.word}
                  <button onClick={() => remove(c)} title="Remove"
                    style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// A single bingo card
// ----------------------------------------------------------------------------
function Card({ index, total, card, onToggle }) {
  const { bingo, win } = winningCells(card.marks);
  return (
    <div style={{ background: C.panel, border: `1px solid ${bingo ? C.gold : C.line}`, borderRadius: 16, padding: 12, marginBottom: 16, boxShadow: bingo ? `0 0 0 2px ${C.gold}40` : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, padding: "0 2px" }}>
        <div style={label}>{total > 1 ? `CARD ${index + 1} / ${total}` : "YOUR CARD"}</div>
        {bingo
          ? <div style={{ color: C.gold, fontWeight: 900, letterSpacing: ".12em", fontSize: 14 }}>🎉 BINGO!</div>
          : <div style={{ color: C.dim, fontSize: 12 }}>{card.marks.filter(Boolean).length}/25</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
        {card.cells.map((cell, i) => {
          const marked = card.marks[i];
          const isWin = win.has(i);
          let bg = C.bg, bd = C.line, col = C.text;
          if (cell.free) { bg = "rgba(255,206,84,.14)"; bd = C.gold; col = C.gold; }
          if (marked && !cell.free) { bg = "rgba(76,141,255,.22)"; bd = C.accent; col = "#dbe6ff"; }
          if (isWin) { bg = "rgba(255,206,84,.28)"; bd = C.gold; }
          return (
            <button key={i} onClick={() => !cell.free && onToggle(i)}
              style={{
                aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center",
                textAlign: "center", padding: 3, borderRadius: 9, border: `1.5px solid ${bd}`,
                background: bg, color: col, cursor: cell.free ? "default" : "pointer",
                fontSize: "clamp(8px, 2.5vw, 12px)", fontWeight: marked ? 700 : 500, lineHeight: 1.12,
                overflow: "hidden", wordBreak: "break-word", hyphens: "auto",
              }}>
              {cell.word}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Game screen
// ----------------------------------------------------------------------------
function Game({ cards, setCards, onNewGame, onHome }) {
  const toggle = (ci, i) => {
    setCards((cs) => cs.map((c, k) => k !== ci ? c : { ...c, marks: c.marks.map((m, j) => j === i ? !m : m) }));
  };
  const anyBingo = cards.some((c) => winningCells(c.marks).bingo);
  return (
    <div style={shell}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button style={ghost} onClick={onHome}>‹ Home</button>
        <div style={{ ...label, fontSize: 12 }}>BUZZWORD BINGO</div>
        <button style={ghost} onClick={onNewGame}>New cards ↻</button>
      </div>

      {anyBingo && (
        <div style={{ background: "linear-gradient(135deg,#ffce54,#ff9e3d)", color: "#3a2600", borderRadius: 14, padding: "12px 16px", fontWeight: 900, textAlign: "center", marginBottom: 16, fontSize: 16 }}>
          🎉 BINGO! You called it. Try to keep a straight face.
        </div>
      )}

      {cards.map((c, ci) => (
        <Card key={ci} index={ci} total={cards.length} card={c} onToggle={(i) => toggle(ci, i)} />
      ))}

      <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
        <button style={bigBtn} onClick={onNewGame}>New cards</button>
        <button style={{ ...bigBtn, background: C.panel2 }} onClick={onHome}>Back to home</button>
      </div>
      <div style={{ textAlign: "center", color: C.dim, fontSize: 12, marginTop: 18 }}>
        Tap a square when someone says it. Free space is on the house.
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Home / setup screen
// ----------------------------------------------------------------------------
function Home({ user, wordCount, community, numCards, setNumCards, onStart, onSignIn, onSignOut, onManage, loadingWords, resumeExists, onResume }) {
  return (
    <div style={shell}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6, gap: 8 }}>
        {user ? (
          <>
            <button style={ghost} onClick={onManage}>＋ Words</button>
            <button style={ghost} onClick={onSignOut}>Sign out</button>
          </>
        ) : (
          <button style={ghost} onClick={onSignIn}>Sign in</button>
        )}
      </div>

      <div style={{ textAlign: "center", marginTop: 8 }}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>🅱️</div>
        <h1 style={{ fontSize: 38, margin: "8px 0 2px", letterSpacing: "-.03em" }}>Buzzword Bingo</h1>
        <div style={{ color: C.dim, fontSize: 14, maxWidth: 420, margin: "0 auto" }}>
          The corporate meeting survival game. Mark the jargon as it flies.
        </div>
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, margin: "26px 0 16px" }}>
        <div style={{ ...label, marginBottom: 12 }}>HOW MANY CARDS?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {[1, 2, 3].map((n) => (
            <button key={n} onClick={() => setNumCards(n)}
              style={{
                padding: "16px 0", borderRadius: 12, cursor: "pointer", fontWeight: 800, fontSize: 20,
                border: `1.5px solid ${numCards === n ? C.accent : C.line}`,
                background: numCards === n ? "rgba(76,141,255,.18)" : C.bg,
                color: numCards === n ? "#dbe6ff" : C.text,
              }}>
              {n}
              <div style={{ fontSize: 11, fontWeight: 600, color: C.dim, marginTop: 2 }}>{n === 1 ? "card" : "cards"}</div>
            </button>
          ))}
        </div>
        <button style={{ ...bigBtn, marginTop: 16 }} onClick={onStart}>
          Start game{numCards > 1 ? ` · ${numCards} cards` : ""}
        </button>
        {resumeExists && (
          <button style={{ ...ghost, width: "100%", marginTop: 10, padding: "11px" }} onClick={onResume}>
            Resume last game
          </button>
        )}
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ ...label, marginBottom: 4 }}>WORD POOL</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {loadingWords ? "Loading…" : `${wordCount} buzzwords`}
            </div>
          </div>
          {user ? (
            <button style={{ ...bigBtn, width: "auto", padding: "10px 16px", background: C.accent2 }} onClick={onManage}>
              Add words
            </button>
          ) : (
            <button style={{ ...bigBtn, width: "auto", padding: "10px 16px", background: C.panel2 }} onClick={onSignIn}>
              Sign in to add
            </button>
          )}
        </div>
        <div style={{ color: C.dim, fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
          {user
            ? `Signed in as ${user.email}. You're drawing from the built-in list plus ${community.length} community words — and you can add your own.`
            : "Playing as a guest with the built-in list. Sign in with an email + password to pull in community-added words and contribute your own."}
        </div>
        {!configured && (
          <div style={{ color: C.gold, fontSize: 12, marginTop: 10 }}>
            Backend not configured — accounts and the community pool are off, but guest play works fine.
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Root
// ----------------------------------------------------------------------------
function App() {
  const { user, recovery, clearRecovery } = useAuth();
  const local = loadLocal();

  const [numCards, setNumCards] = useState(local.numCards || 1);
  const [cards, setCards] = useState(local.cards || null); // null = not in a game
  const [view, setView] = useState("home"); // home | game
  const [authOpen, setAuthOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const [community, setCommunity] = useState([]); // [{id, word, by}]
  const [loadingWords, setLoadingWords] = useState(false);
  const savedGame = useRef(local.cards || null);

  // Merge built-in + community, deduped (case-insensitive), built-ins first.
  const pool = React.useMemo(() => {
    const seen = new Set(), out = [];
    for (const w of BUILTIN_WORDS) { const k = keyOf(w); if (w && !seen.has(k)) { seen.add(k); out.push(normWord(w)); } }
    for (const c of community) { const k = keyOf(c.word); if (c.word && !seen.has(k)) { seen.add(k); out.push(normWord(c.word)); } }
    return out;
  }, [community]);

  const loadWords = useCallback(async () => {
    if (!configured) return;
    setLoadingWords(true);
    try {
      // Race the fetch against a timeout so a slow/offline network can't leave
      // the pool stuck "loading" — built-in words keep the game playable anyway.
      const rows = await Promise.race([
        db.list(WORDS_COLLECTION),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
      ]);
      setCommunity(rows);
    }
    catch { /* guest / anon / offline may lack access — fall back to built-in silently */ }
    setLoadingWords(false);
  }, []);

  // (Re)load the community pool whenever auth state settles.
  useEffect(() => { if (user !== undefined) loadWords(); }, [user, loadWords]);

  // Live sync of the community pool while signed in.
  useEffect(() => {
    if (!configured || !user) return;
    const ch = db.subscribe(loadWords);
    return () => ch.unsubscribe();
  }, [user, loadWords]);

  // If a reset link brought us here, open the modal in recovery mode.
  useEffect(() => { if (recovery) setAuthOpen(true); }, [recovery]);

  // Persist game + choice locally.
  useEffect(() => { saveLocal({ numCards, cards }); }, [numCards, cards]);

  const start = () => {
    const fresh = Array.from({ length: numCards }, () => makeCard(pool));
    setCards(fresh); savedGame.current = fresh; setView("game");
  };
  const resume = () => { setCards(savedGame.current); setView("game"); };
  const home = () => setView("home");
  const signOut = async () => { if (sb) await sb.auth.signOut(); };

  if (view === "game" && cards) {
    return <Game cards={cards} setCards={setCards} onNewGame={start} onHome={home} />;
  }

  return (
    <>
      <Home
        user={user && user.id ? user : null}
        wordCount={pool.length}
        community={community}
        numCards={numCards}
        setNumCards={setNumCards}
        onStart={start}
        onSignIn={() => setAuthOpen(true)}
        onSignOut={signOut}
        onManage={() => setManageOpen(true)}
        loadingWords={loadingWords}
        resumeExists={!!savedGame.current && savedGame.current.length > 0}
        onResume={resume}
      />
      {authOpen && (
        <AuthModal
          recovery={recovery}
          onClose={() => { setAuthOpen(false); if (recovery) clearRecovery(); }}
          onDoneRecovery={clearRecovery}
        />
      )}
      {manageOpen && user && (
        <WordManager
          user={user}
          words={pool}
          community={community}
          onChanged={loadWords}
          onClose={() => setManageOpen(false)}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
