import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

// Concert Line — a pass-the-phone party game for two, built for killing time
// while waiting in line for a show. Fully offline: no sign-in, no network, all
// content baked in so it works with one bar of signal (or none).

// ----------------------------------------------------------------------------
// Content
// ----------------------------------------------------------------------------

// Trivia: mix of Hilary Duff, Lizzie McGuire, and 2000s pop. answer = index.
const TRIVIA = [
  { q: "What is the name of Hilary Duff's Disney Channel breakout character?", choices: ["Lizzie McGuire", "Raven Baxter", "Kim Possible", "London Tipton"], answer: 0 },
  { q: "Which Hilary Duff single opens with \"Let the rain fall down\"?", choices: ["So Yesterday", "Come Clean", "Wake Up", "Fly"], answer: 1 },
  { q: "Hilary Duff starred in which 2004 teen movie as an aspiring singer?", choices: ["A Cinderella Story", "13 Going on 30", "Mean Girls", "Freaky Friday"], answer: 0 },
  { q: "What was the title of Hilary Duff's 2003 debut studio album?", choices: ["Metamorphosis", "Hilary Duff", "Dignity", "Most Wanted"], answer: 0 },
  { q: "In \"A Cinderella Story,\" what does Sam lose instead of a glass slipper?", choices: ["Her scarf", "Her phone", "Her diary", "Her shoe"], answer: 1 },
  { q: "Which animated character did Hilary Duff voice in a Disney film?", choices: ["Elsa", "Kairi (Kingdom Hearts)", "Jasmine", "Ariel"], answer: 1 },
  { q: "Hilary Duff's 2015 comeback album was titled…", choices: ["Breathe In. Breathe Out.", "Dignity", "Metamorphosis", "Fly"], answer: 0 },
  { q: "What sitcom did Hilary Duff join as Sonny in 2021?", choices: ["How I Met Your Father", "Younger", "New Girl", "The Goldbergs"], answer: 0 },
  { q: "The Lizzie McGuire Movie is set in which country?", choices: ["France", "Italy", "Spain", "Greece"], answer: 1 },
  { q: "Which pop star released \"...Baby One More Time\" in 1998?", choices: ["Christina Aguilera", "Britney Spears", "Mandy Moore", "Jessica Simpson"], answer: 1 },
  { q: "\"So Yesterday\" tells you to do what with old regrets?", choices: ["Keep them close", "Let them go", "Write them down", "Sing about them"], answer: 1 },
  { q: "Hilary Duff played Kelsey in which streaming comedy series?", choices: ["Younger", "Gossip Girl", "The Bold Type", "Girls"], answer: 0 },
  { q: "Which of these is NOT a Hilary Duff song?", choices: ["Fly", "With Love", "Sparks", "Since U Been Gone"], answer: 3 },
  { q: "What year did the original Lizzie McGuire series first air?", choices: ["1998", "2001", "2004", "2006"], answer: 1 },
  { q: "\"Come Clean\" was famously the theme song for which reality show?", choices: ["The Hills", "Laguna Beach", "The O.C. cast", "Newlyweds"], answer: 1 },
];

// Would You Rather — concert & pop themed. Pure discussion, no scoring.
const WYR = [
  ["get front-row seats but no phone allowed", "film the whole show from the back row"],
  ["have Hilary sing one song directly to you", "get to sing one song on stage with her"],
  ["only ever listen to 2000s pop again", "only ever listen to music released this year"],
  ["meet Lizzie McGuire", "meet animated-cartoon Lizzie McGuire"],
  ["arrive 5 hours early for the perfect spot", "arrive right as the doors close but skip the line"],
  ["the opener plays for 3 hours", "there's no opener but the main set is 30 min"],
  ["know every lyric but sing off-key", "have a great voice but forget every word"],
  ["the merch is amazing but sold out", "the merch is in stock but kind of ugly"],
  ["dance the whole show", "sit the whole show"],
  ["get the setlist afterward", "get a used guitar pick"],
];

// Line-friendly Truth-or-Dare cards. Safe, low-key, doable standing in a line.
const CARDS = [
  { type: "truth", text: "What's the first concert you ever went to?" },
  { type: "truth", text: "Which song are you most hoping she plays tonight?" },
  { type: "dare", text: "Do your best 2 seconds of choreography, right here." },
  { type: "truth", text: "What's a lyric you've definitely been singing wrong for years?" },
  { type: "dare", text: "Hum a song and let the other person guess it." },
  { type: "truth", text: "If you could add one song to the setlist, what is it?" },
  { type: "dare", text: "Give the person behind you in line a genuine compliment." },
  { type: "truth", text: "What's the most you'd ever wait in line for?" },
  { type: "dare", text: "Strike a dramatic album-cover pose for a photo." },
  { type: "truth", text: "What's your karaoke go-to when you want to win the room?" },
  { type: "dare", text: "Whisper-sing the chorus of your favorite song of hers." },
  { type: "truth", text: "Who would you most want to be at this concert with (besides who's here)?" },
];

// ----------------------------------------------------------------------------
// Style helpers
// ----------------------------------------------------------------------------
const C = { bg: "#12071f", panel: "#1e1030", panel2: "#291641", line: "#3a2350", text: "#f4ecff", dim: "#b39fd0", accent: "#ff5db1", accent2: "#7c5cff", good: "#5be3a7", bad: "#ff6b6b", gold: "#ffcf5c" };

const shell = { maxWidth: 520, margin: "0 auto", padding: "22px 18px 40px", minHeight: "100dvh", display: "flex", flexDirection: "column" };
const bigBtn = { width: "100%", border: "none", borderRadius: 14, padding: "16px 18px", fontWeight: 800, fontSize: 17, cursor: "pointer", color: "#fff" };
const ghost = { background: "transparent", border: `1px solid ${C.line}`, color: C.dim, borderRadius: 10, padding: "8px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 };
const grad = `linear-gradient(135deg, ${C.accent}, ${C.accent2})`;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ----------------------------------------------------------------------------
// Persistent player names + all-time series score
// ----------------------------------------------------------------------------
const LS = "concert-line/v1";
function loadState() {
  try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; }
}
function saveState(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ } }

// ----------------------------------------------------------------------------
// Home
// ----------------------------------------------------------------------------
function Home({ names, setNames, series, onPick, onResetSeries }) {
  const [editing, setEditing] = useState(false);
  const modes = [
    { key: "trivia", emoji: "🎤", title: "Trivia Duel", sub: "Take turns. Right answers win points." },
    { key: "wyr", emoji: "🤔", title: "Would You Rather", sub: "Impossible concert choices. Debate it out." },
    { key: "cards", emoji: "💫", title: "Truth or Dare", sub: "Line-friendly cards to pass the time." },
    { key: "reflex", emoji: "⚡", title: "Reaction Race", sub: "Fastest tap wins. Great tiebreaker." },
  ];
  return (
    <div style={shell}>
      <div style={{ textAlign: "center", marginTop: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: ".3em", color: C.accent, fontWeight: 800 }}>NOW ENTERING</div>
        <h1 style={{ fontSize: 42, margin: "6px 0 2px", letterSpacing: "-.03em", background: grad, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Concert Line</h1>
        <div style={{ color: C.dim, fontSize: 14 }}>Two-player games for the wait. Pass the phone. 🎶</div>
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 14, margin: "22px 0 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: ".2em", color: C.dim, fontWeight: 700 }}>SERIES SCORE</div>
          <button style={ghost} onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Edit names"}</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", marginTop: 10 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ textAlign: "center", flex: 1 }}>
              {editing ? (
                <input value={names[i]} maxLength={12} onChange={(e) => setNames(i, e.target.value)}
                  style={{ width: "90%", textAlign: "center", background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "8px", fontSize: 15, outline: "none" }} />
              ) : (
                <>
                  <div style={{ fontSize: 34, fontWeight: 900, color: i === 0 ? C.accent : C.accent2 }}>{series[i] || 0}</div>
                  <div style={{ color: C.dim, fontSize: 14, fontWeight: 600 }}>{names[i] || `Player ${i + 1}`}</div>
                </>
              )}
            </div>
          ))}
        </div>
        {!editing && (series[0] || series[1]) ? (
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <button style={{ ...ghost, borderColor: "transparent" }} onClick={onResetSeries}>Reset series</button>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {modes.map((m) => (
          <button key={m.key} onClick={() => onPick(m.key)}
            style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "left", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, cursor: "pointer", color: C.text }}>
            <div style={{ fontSize: 30 }}>{m.emoji}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{m.title}</div>
              <div style={{ color: C.dim, fontSize: 13, marginTop: 2 }}>{m.sub}</div>
            </div>
            <div style={{ color: C.dim, fontSize: 22 }}>›</div>
          </button>
        ))}
      </div>

      <div style={{ color: C.dim, opacity: .6, fontSize: 12, textAlign: "center", marginTop: "auto", paddingTop: 24 }}>
        Works offline · no sign-in · enjoy the show
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Header used inside a mode
// ----------------------------------------------------------------------------
function ModeHeader({ title, onBack, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <button style={ghost} onClick={onBack}>‹ Home</button>
      <div style={{ fontSize: 12, letterSpacing: ".18em", color: C.dim, fontWeight: 700 }}>{title}</div>
      <div style={{ minWidth: 62, textAlign: "right" }}>{right}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Trivia Duel — alternating turns, first to WIN_AT wins the round
// ----------------------------------------------------------------------------
const WIN_AT = 5;
function Trivia({ names, onBack, onWinner }) {
  const [deck, setDeck] = useState(() => shuffle(TRIVIA));
  const [idx, setIdx] = useState(0);
  const [turn, setTurn] = useState(0); // whose turn
  const [score, setScore] = useState([0, 0]);
  const [picked, setPicked] = useState(null);
  const [done, setDone] = useState(false);

  const q = deck[idx];

  const choose = (i) => {
    if (picked !== null) return;
    setPicked(i);
    if (i === q.answer) {
      const ns = score.slice(); ns[turn] += 1; setScore(ns);
      if (ns[turn] >= WIN_AT) { setDone(true); onWinner(turn); }
    }
  };

  const next = () => {
    setPicked(null);
    setTurn((t) => 1 - t);
    if (idx + 1 >= deck.length) { setDeck(shuffle(TRIVIA)); setIdx(0); }
    else setIdx(idx + 1);
  };

  const replay = () => { setDeck(shuffle(TRIVIA)); setIdx(0); setTurn(0); setScore([0, 0]); setPicked(null); setDone(false); };

  if (done) {
    const w = score[0] >= WIN_AT ? 0 : 1;
    return (
      <div style={shell}>
        <ModeHeader title="TRIVIA DUEL" onBack={onBack} />
        <div style={{ margin: "auto", textAlign: "center" }}>
          <div style={{ fontSize: 60 }}>🏆</div>
          <h2 style={{ fontSize: 30, margin: "8px 0" }}>{names[w] || `Player ${w + 1}`} wins!</h2>
          <div style={{ color: C.dim, fontSize: 16 }}>{score[0]} – {score[1]}</div>
          <div style={{ color: C.gold, fontSize: 13, marginTop: 6 }}>+1 to the series score</div>
          <div style={{ display: "grid", gap: 10, marginTop: 28, minWidth: 240 }}>
            <button style={{ ...bigBtn, background: grad }} onClick={replay}>Play again</button>
            <button style={{ ...bigBtn, background: C.panel2 }} onClick={onBack}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <ModeHeader title="TRIVIA DUEL" onBack={onBack}
        right={<span style={{ color: C.dim, fontSize: 13, fontWeight: 700 }}>{score[0]} – {score[1]}</span>} />

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ display: "inline-block", padding: "6px 16px", borderRadius: 999, background: turn === 0 ? "rgba(255,93,177,.16)" : "rgba(124,92,255,.16)", border: `1px solid ${turn === 0 ? C.accent : C.accent2}` }}>
          <span style={{ color: turn === 0 ? C.accent : C.accent2, fontWeight: 800 }}>{names[turn] || `Player ${turn + 1}`}'s turn</span>
        </div>
        <div style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>First to {WIN_AT} points</div>
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: "22px 18px", marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.35 }}>{q.q}</div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {q.choices.map((c, i) => {
          const isAns = i === q.answer;
          const reveal = picked !== null;
          let bg = C.panel, bd = C.line, col = C.text;
          if (reveal && isAns) { bg = "rgba(91,227,167,.15)"; bd = C.good; col = C.good; }
          else if (reveal && i === picked && !isAns) { bg = "rgba(255,107,107,.14)"; bd = C.bad; col = C.bad; }
          return (
            <button key={i} onClick={() => choose(i)} disabled={reveal}
              style={{ textAlign: "left", background: bg, border: `1.5px solid ${bd}`, color: col, borderRadius: 12, padding: "14px 16px", fontSize: 16, fontWeight: 600, cursor: reveal ? "default" : "pointer" }}>
              {c}{reveal && isAns ? "  ✓" : ""}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <button style={{ ...bigBtn, background: grad, marginTop: 18 }} onClick={next}>
          {picked === q.answer ? "Nice! Next turn →" : "Next turn →"}
        </button>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Would You Rather
// ----------------------------------------------------------------------------
function WouldYouRather({ onBack }) {
  const [deck, setDeck] = useState(() => shuffle(WYR));
  const [idx, setIdx] = useState(0);
  const pair = deck[idx];
  const next = () => {
    if (idx + 1 >= deck.length) { setDeck(shuffle(WYR)); setIdx(0); }
    else setIdx(idx + 1);
  };
  const Opt = ({ label, color }) => (
    <div style={{ background: C.panel, border: `1.5px solid ${color}`, borderRadius: 16, padding: "22px 18px", fontSize: 19, fontWeight: 700, lineHeight: 1.35, textAlign: "center" }}>{label}</div>
  );
  return (
    <div style={shell}>
      <ModeHeader title="WOULD YOU RATHER" onBack={onBack} />
      <div style={{ margin: "auto 0", display: "grid", gap: 12 }}>
        <div style={{ textAlign: "center", color: C.dim, fontWeight: 700, letterSpacing: ".1em" }}>WOULD YOU RATHER…</div>
        <Opt label={pair[0]} color={C.accent} />
        <div style={{ textAlign: "center", color: C.dim, fontWeight: 900, fontSize: 15 }}>— OR —</div>
        <Opt label={pair[1]} color={C.accent2} />
      </div>
      <button style={{ ...bigBtn, background: grad, marginTop: 24 }} onClick={next}>Next dilemma →</button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Truth or Dare cards
// ----------------------------------------------------------------------------
function Cards({ onBack }) {
  const [deck, setDeck] = useState(() => shuffle(CARDS));
  const [idx, setIdx] = useState(0);
  const card = deck[idx];
  const next = () => {
    if (idx + 1 >= deck.length) { setDeck(shuffle(CARDS)); setIdx(0); }
    else setIdx(idx + 1);
  };
  const isTruth = card.type === "truth";
  return (
    <div style={shell}>
      <ModeHeader title="TRUTH OR DARE" onBack={onBack} />
      <div style={{ margin: "auto 0" }}>
        <div style={{ background: C.panel, border: `1.5px solid ${isTruth ? C.accent2 : C.accent}`, borderRadius: 20, padding: "34px 22px", textAlign: "center", minHeight: 220, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: ".28em", fontWeight: 800, color: isTruth ? C.accent2 : C.accent }}>{isTruth ? "TRUTH" : "DARE"}</div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.4 }}>{card.text}</div>
        </div>
      </div>
      <button style={{ ...bigBtn, background: grad, marginTop: 24 }} onClick={next}>Draw next card →</button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Reaction Race — each player taps when the screen flashes; lower ms wins.
// ----------------------------------------------------------------------------
function Reflex({ names, onBack, onWinner }) {
  // phase: intro | waiting | go | result | tooSoon | summary
  const [player, setPlayer] = useState(0);
  const [phase, setPhase] = useState("intro");
  const [times, setTimes] = useState([null, null]);
  const [ms, setMs] = useState(null);
  const startRef = useRef(0);
  const timerRef = useRef(null);

  const arm = useCallback(() => {
    setPhase("waiting");
    const delay = 1200 + Math.random() * 2600;
    timerRef.current = setTimeout(() => { startRef.current = performance.now(); setPhase("go"); }, delay);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const tap = () => {
    if (phase === "intro") { arm(); return; }
    if (phase === "waiting") { clearTimeout(timerRef.current); setPhase("tooSoon"); return; }
    if (phase === "go") {
      const t = Math.round(performance.now() - startRef.current);
      setMs(t); setPhase("result");
      return;
    }
    if (phase === "tooSoon") { arm(); return; }
    if (phase === "result") {
      const nt = times.slice(); nt[player] = ms; setTimes(nt);
      if (player === 0) { setPlayer(1); setMs(null); setPhase("intro"); }
      else {
        setPhase("summary");
        if (nt[0] !== nt[1]) onWinner(nt[0] < nt[1] ? 0 : 1);
      }
    }
  };

  const replay = () => { setPlayer(0); setTimes([null, null]); setMs(null); setPhase("intro"); };

  let bg = C.panel2, title = "", sub = "", note = "";
  if (phase === "intro") { title = `${names[player] || `Player ${player + 1}`}, get ready`; sub = "Tap when the screen turns green."; note = "Tap to start"; }
  if (phase === "waiting") { bg = "#7a1f47"; title = "Wait for green…"; sub = "Don't jump the gun!"; }
  if (phase === "go") { bg = "#1f7a52"; title = "TAP!"; sub = ""; }
  if (phase === "tooSoon") { bg = "#7a1f1f"; title = "Too soon! 😅"; sub = "Tap to try again."; }
  if (phase === "result") { title = `${ms} ms`; sub = player === 0 ? "Tap to pass to next player" : "Tap to see the winner"; }

  if (phase === "summary") {
    const tie = times[0] === times[1];
    const w = times[0] < times[1] ? 0 : 1;
    return (
      <div style={shell}>
        <ModeHeader title="REACTION RACE" onBack={onBack} />
        <div style={{ margin: "auto", textAlign: "center" }}>
          <div style={{ fontSize: 60 }}>{tie ? "🤝" : "⚡"}</div>
          <h2 style={{ fontSize: 28, margin: "8px 0" }}>{tie ? "Dead heat!" : `${names[w] || `Player ${w + 1}`} wins!`}</h2>
          <div style={{ color: C.dim, fontSize: 16, marginTop: 6 }}>
            {names[0] || "P1"}: <b style={{ color: C.accent }}>{times[0]} ms</b> · {names[1] || "P2"}: <b style={{ color: C.accent2 }}>{times[1]} ms</b>
          </div>
          {!tie && <div style={{ color: C.gold, fontSize: 13, marginTop: 6 }}>+1 to the series score</div>}
          <div style={{ display: "grid", gap: 10, marginTop: 28, minWidth: 240 }}>
            <button style={{ ...bigBtn, background: grad }} onClick={replay}>Race again</button>
            <button style={{ ...bigBtn, background: C.panel2 }} onClick={onBack}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <ModeHeader title="REACTION RACE" onBack={onBack}
        right={<span style={{ color: C.dim, fontSize: 12, fontWeight: 700 }}>{player + 1}/2</span>} />
      <button onClick={tap}
        style={{ flex: 1, border: "none", borderRadius: 22, background: bg, color: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, transition: "background .12s", margin: "4px 0 8px" }}>
        <div style={{ fontSize: phase === "result" ? 52 : 30, fontWeight: 900, letterSpacing: "-.02em" }}>{title}</div>
        {sub && <div style={{ fontSize: 16, opacity: .9, maxWidth: 280 }}>{sub}</div>}
        {note && <div style={{ marginTop: 14, fontSize: 13, opacity: .7, letterSpacing: ".1em" }}>{note.toUpperCase()}</div>}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Root
// ----------------------------------------------------------------------------
function App() {
  const init = loadState();
  const [names, setNamesState] = useState(init.names || ["You", "Jackie"]);
  const [series, setSeries] = useState(init.series || [0, 0]);
  const [mode, setMode] = useState(null);

  useEffect(() => { saveState({ names, series }); }, [names, series]);

  const setName = (i, v) => setNamesState((n) => { const c = n.slice(); c[i] = v; return c; });
  const addWin = (i) => setSeries((s) => { const c = s.slice(); c[i] = (c[i] || 0) + 1; return c; });
  const resetSeries = () => setSeries([0, 0]);
  const home = () => setMode(null);

  if (mode === "trivia") return <Trivia names={names} onBack={home} onWinner={addWin} />;
  if (mode === "wyr") return <WouldYouRather onBack={home} />;
  if (mode === "cards") return <Cards onBack={home} />;
  if (mode === "reflex") return <Reflex names={names} onBack={home} onWinner={addWin} />;
  return <Home names={names} setNames={setName} series={series} onPick={setMode} onResetSeries={resetSeries} />;
}

createRoot(document.getElementById("root")).render(<App />);
