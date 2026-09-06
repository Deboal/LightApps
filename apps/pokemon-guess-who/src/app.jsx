// Who's That Pokémon? — Guess Who for two phones, played over a five-character
// room code.
//
// How it holds together: both players draw the same 24 Pokémon (the host picks
// them and sends the list), each secretly claims one of the 24, and then they
// take turns asking yes/no questions about the other's. The answer to a canned
// question is computed on the answering device from the baked-in data, so it is
// always right and never leaks the secret; a typed question is answered by a
// human tapping Yes or No, which is the part of the board game worth keeping.
//
// There is no server-side game state. The room is one realtime broadcast
// channel, and each phone keeps its own copy of the game, rebuilt from the same
// stream of messages. A refresh restores from localStorage and re-syncs.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { POKEMON } from "./pokemon.js";
import { buildQuestions } from "./questions.js";
import { room, newCode, cleanCode, available, local } from "./net.js";

const BOARD_SIZE = 24;
const SAVE_KEY = "pgw:game";
const PREF_KEY = "pgw:prefs";

const C = {
  bg: "#0e1220", panel: "#181e2e", panel2: "#212840", line: "#2e3855", text: "#eef2f8",
  dim: "#93a0bd", accent: "#ffcb05", accent2: "#4d7cff", good: "#3ddc97", bad: "#ff6b5b",
};

const byId = new Map(POKEMON.map((p) => [p.id, p]));
const art = (id) => `assets/art/${id}.webp`;

/** 24 distinct Pokémon, in the order they sit on the board. */
function drawBoard() {
  const pool = POKEMON.map((p) => p.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, BOARD_SIZE);
}

const load = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const clear = (key) => { try { localStorage.removeItem(key); } catch {} };

// ---------------------------------------------------------------- small parts

function Btn({ kind = "plain", small, style, ...rest }) {
  const kinds = {
    plain: { background: C.panel2, color: C.text, border: `1px solid ${C.line}` },
    go: { background: C.accent, color: "#231c00", border: "none", fontWeight: 800 },
    blue: { background: C.accent2, color: "#fff", border: "none", fontWeight: 700 },
    ghost: { background: "transparent", color: C.dim, border: `1px solid ${C.line}` },
    danger: { background: "transparent", color: C.bad, border: `1px solid ${C.bad}55` },
  };
  return (
    <button
      {...rest}
      style={{
        borderRadius: 12, padding: small ? "8px 12px" : "13px 16px", fontSize: small ? 13 : 15,
        fontWeight: 600, cursor: "pointer", ...kinds[kind], ...style,
      }}
    />
  );
}

function Sprite({ id, size = 64, dim, style }) {
  return (
    <img
      src={art(id)} alt={byId.get(id)?.name || ""} width={size} height={size} loading="lazy"
      style={{ width: size, height: size, objectFit: "contain", display: "block",
               filter: dim ? "grayscale(1)" : "none", opacity: dim ? 0.3 : 1, ...style }}
    />
  );
}

function Sheet({ title, onClose, children, foot }) {
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "#04060cd0", zIndex: 40, display: "flex",
               alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, maxHeight: "88dvh", background: C.panel,
                 borderTop: `1px solid ${C.line}`, borderRadius: "18px 18px 0 0",
                 display: "flex", flexDirection: "column",
                 paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
                      borderBottom: `1px solid ${C.line}` }}>
          <b style={{ flex: 1, fontSize: 16 }}>{title}</b>
          <Btn kind="ghost" small onClick={onClose}>Close</Btn>
        </div>
        <div style={{ overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 14 }}>{children}</div>
        {foot}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- lobby

function Lobby({ onStart }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const joinFromUrl = new URLSearchParams(location.search).get("room");

  useEffect(() => { if (joinFromUrl) setCode(cleanCode(joinFromUrl)); }, []);

  const join = () => {
    const c = cleanCode(code);
    if (c.length < 5) return setErr("A room code is five characters.");
    onStart({ code: c, seat: 1 });
  };

  const wrap = { minHeight: "100dvh", display: "flex", flexDirection: "column",
                 justifyContent: "center", padding: "28px 20px", maxWidth: 480, margin: "0 auto" };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[25, 6, 143, 94].map((id) => <Sprite key={id} id={id} size={54} />)}
      </div>
      <h1 style={{ margin: "0 0 6px", fontSize: 30, letterSpacing: "-.02em" }}>Who's That Pokémon?</h1>
      <p style={{ color: C.dim, margin: "0 0 26px", lineHeight: 1.55 }}>
        Guess Who with the original 151. Two players, twenty-four faces, one secret each —
        ask yes/no questions until you can name theirs.
      </p>

      {!available && (
        <div style={{ background: "#3a1d1d", border: `1px solid ${C.bad}55`, color: C.text,
                      borderRadius: 12, padding: 14, marginBottom: 18, fontSize: 14, lineHeight: 1.5 }}>
          The realtime backend isn't configured for this build, so rooms can't connect.
          Add <code>?link=local</code> to the URL to play across two tabs on this device.
        </div>
      )}

      <Btn kind="go" style={{ width: "100%", padding: "16px", fontSize: 17 }}
        onClick={() => onStart({ code: newCode(), seat: 0 })}>
        Start a room
      </Btn>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0 16px", color: C.dim, fontSize: 12 }}>
        <div style={{ flex: 1, height: 1, background: C.line }} /> OR <div style={{ flex: 1, height: 1, background: C.line }} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={code} onChange={(e) => { setCode(cleanCode(e.target.value)); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && join()}
          placeholder="CODE" inputMode="text" autoCapitalize="characters" autoComplete="off"
          style={{ flex: 1, minWidth: 0, background: C.panel, border: `1px solid ${C.line}`, color: C.text,
                   borderRadius: 12, padding: "13px 15px", fontSize: 21, letterSpacing: ".28em",
                   fontWeight: 700, textAlign: "center", outline: "none" }} />
        <Btn kind="blue" onClick={join} style={{ padding: "13px 20px" }}>Join</Btn>
      </div>
      {err && <div style={{ color: C.bad, fontSize: 13, marginTop: 10 }}>{err}</div>}
      <p style={{ color: C.dim, fontSize: 12, marginTop: 22, lineHeight: 1.5 }}>
        No sign-in, nothing saved. The person who starts the room reads the code out;
        the other one types it in{local ? " — this tab is in two-tab local mode." : "."}
      </p>
    </div>
  );
}

// --------------------------------------------------------------------- board

function Board({ ids, out, secret, badge = "YOURS", mode, onTile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: "0 10px" }}>
      {ids.map((id) => {
        const p = byId.get(id);
        const gone = out.includes(id);
        const isSecret = secret === id;
        const picking = mode === "pick" || mode === "guess";
        return (
          <button key={id} onClick={() => onTile(id)}
            style={{
              position: "relative", background: gone ? "#12172480" : C.panel,
              border: `1px solid ${isSecret ? C.accent : mode === "guess" && !gone ? C.accent2 : C.line}`,
              borderRadius: 11, padding: "6px 2px 4px", cursor: "pointer", overflow: "hidden",
              opacity: gone && !picking ? 0.55 : 1,
            }}>
            <Sprite id={id} size="100%" dim={gone} style={{ aspectRatio: "1 / 1", height: "auto" }} />
            <div style={{ fontSize: 9.5, color: gone ? C.dim : C.text, fontWeight: 600,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          textDecoration: gone ? "line-through" : "none" }}>
              {p.name}
            </div>
            {gone && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                            color: C.bad, fontSize: 30, fontWeight: 300, pointerEvents: "none" }}>✕</div>
            )}
            {isSecret && (
              <div style={{ position: "absolute", top: 3, right: 3, background: C.accent, color: "#231c00",
                            borderRadius: 6, fontSize: 8, fontWeight: 800, padding: "2px 4px" }}>{badge}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ question

function AskSheet({ deck, alive, onAsk, onClose, onLeave }) {
  const groups = useMemo(() => [...new Set(deck.map((q) => q.group))], [deck]);
  const [group, setGroup] = useState(groups[0]);
  const [free, setFree] = useState("");

  const chip = (on) => ({
    background: on ? C.accent : C.panel2, color: on ? "#231c00" : C.dim,
    border: `1px solid ${on ? C.accent : C.line}`, borderRadius: 999, padding: "7px 12px",
    fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
  });

  return (
    <Sheet title="Ask a question" onClose={onClose}
      foot={<div style={{ padding: "10px 14px", borderTop: `1px solid ${C.line}` }}>
        <Btn kind="danger" small onClick={onLeave} style={{ width: "100%" }}>Leave the room</Btn>
      </div>}>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <input value={free} onChange={(e) => setFree(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && free.trim() && onAsk({ text: free.trim() })}
          placeholder="Ask anything — they'll tap Yes or No"
          style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, color: C.text,
                   borderRadius: 11, padding: "12px 13px", fontSize: 14, outline: "none" }} />
        <Btn kind="blue" small disabled={!free.trim()} onClick={() => onAsk({ text: free.trim() })}
          style={{ opacity: free.trim() ? 1 : 0.4 }}>Ask</Btn>
      </div>
      <p style={{ color: C.dim, fontSize: 12, margin: "8px 2px 14px" }}>
        Or pick one below — those answer themselves, correctly, without either of you having to judge it.
        The badge splits your remaining {alive.length}: how many yes, how many no.
      </p>

      <div style={{ display: "flex", gap: 7, overflowX: "auto", margin: "0 -14px", padding: "0 14px 10px" }}>
        {groups.map((g) => (
          <button key={g} style={chip(g === group)} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {deck.filter((q) => q.group === group).map((q) => {
          const yes = alive.filter((p) => q.test(p)).length;
          const split = Math.min(yes, alive.length - yes);
          return (
            <button key={q.id} onClick={() => onAsk({ qid: q.id })}
              style={{ display: "flex", alignItems: "center", gap: 10, background: C.panel2,
                       border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 13px",
                       color: C.text, fontSize: 14.5, textAlign: "left", cursor: "pointer" }}>
              <span style={{ flex: 1 }}>{q.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: split === 0 ? C.dim : C.accent,
                             background: C.bg, borderRadius: 8, padding: "4px 7px", minWidth: 34,
                             textAlign: "center" }}>
                {yes}/{alive.length - yes}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------- game

function Game({ code, seat, onLeave }) {
  const saved = load(SAVE_KEY, null);
  const resume = saved && saved.code === code && saved.seat === seat ? saved : null;

  const [link, setLink] = useState({ state: "connecting", peer: false });
  const [board, setBoard] = useState(resume?.board || (seat === 0 ? drawBoard() : null));
  const [starter, setStarter] = useState(resume?.starter ?? 0);
  const [secret, setSecret] = useState(resume?.secret ?? null);
  const [peerReady, setPeerReady] = useState(resume?.peerReady ?? false);
  const [out, setOut] = useState(resume?.out || []);
  const [log, setLog] = useState(resume?.log || []);
  const [outcome, setOutcome] = useState(resume?.outcome || null);
  const [reveal, setReveal] = useState(resume?.reveal ?? null);
  const [sheet, setSheet] = useState(null);        // "ask" | "guess-confirm" | "log"
  const [guessing, setGuessing] = useState(false);
  const [choice, setChoice] = useState(null);      // tentative pick, before locking it in
  const [pending, setPending] = useState(null);    // a typed question waiting on Yes/No
  const [prefs, setPrefs] = useState(() => load(PREF_KEY, { autoCross: true }));
  const [copied, setCopied] = useState(false);
  const [wantRematch, setWantRematch] = useState(false);

  const net = useRef(null);
  // The reducer-ish handlers below need today's values, not the ones captured
  // when the channel was opened, so state the handler reads lives in a ref too.
  const view = useRef({});
  view.current = { board, secret, log, out, starter, outcome };

  const deckRef = useRef(new Map());
  // The last question this side auto-crossed for, so it happens once per answer.
  const crossedFor = useRef(-1);
  const deck = useMemo(() => (board ? buildQuestions(board.map((id) => byId.get(id))) : []), [board]);
  const deckById = useMemo(() => new Map(deck.map((q) => [q.id, q])), [deck]);
  deckRef.current = deckById;

  const phase = outcome ? "over" : !board ? "sync" : secret === null ? "pick" : peerReady ? "play" : "wait";
  const answered = log.filter((e) => e.yes !== null).length;
  const turn = (starter + answered) % 2;
  const myTurn = turn === seat && phase === "play";
  const alive = board ? board.filter((id) => !out.includes(id)).map((id) => byId.get(id)) : [];

  // -- persistence: a refresh mid-game is a dropped controller, not a forfeit --
  useEffect(() => {
    save(SAVE_KEY, { code, seat, board, starter, secret, peerReady, out, log, outcome, reveal });
  }, [code, seat, board, starter, secret, peerReady, out, log, outcome, reveal]);
  useEffect(() => save(PREF_KEY, prefs), [prefs]);

  // -- the room -------------------------------------------------------------
  useEffect(() => {
    const r = room({
      code, seat,
      onLink: setLink,
      onMessage: (event, p) => {
        const v = view.current;
        if (event === "peer-joined") {
          // The host owns the board, so whoever holds one re-sends it to a
          // partner who has just appeared (or just come back from a refresh).
          if (seat === 0 && v.board) r.send("state", { board: v.board, starter: v.starter });
          if (v.secret !== null) r.send("ready", {});
          return;
        }
        if (event === "state") {
          setBoard(p.board); setStarter(p.starter ?? 0);
          if (p.fresh) {
            setSecret(null); setOut([]); setLog([]); setOutcome(null); setReveal(null);
            setPeerReady(false); setWantRematch(false); setChoice(null); crossedFor.current = -1;
          }
          return;
        }
        if (event === "ready") { setPeerReady(true); return; }
        if (event === "ask") {
          const q = p.qid ? deckRef.current.get(p.qid) : null;
          const entry = { n: p.n, by: p.seat, qid: p.qid || null, label: q ? q.label : p.text, yes: null };
          setLog((l) => (l.some((e) => e.n === entry.n) ? l : [...l, entry]));
          // A canned question is answered by the data; a typed one needs a human.
          if (q && v.secret !== null) {
            const yes = q.test(byId.get(v.secret));
            r.send("answer", { n: p.n, yes });
            setLog((l) => l.map((e) => (e.n === p.n ? { ...e, yes } : e)));
          } else if (!q) {
            setPending(entry);
          }
          return;
        }
        if (event === "answer") {
          setLog((l) => l.map((e) => (e.n === p.n ? { ...e, yes: p.yes } : e)));
          return;
        }
        if (event === "guess") {
          const right = p.id === v.secret;
          r.send("result", { n: p.n, right, secret: v.secret });
          setOutcome({ winner: right ? p.seat : seat, guess: p.id, mine: v.secret });
          return;
        }
        if (event === "reveal") { setReveal(p.secret); return; }
        if (event === "result") {
          setReveal(p.secret);
          setOutcome({ winner: p.right ? seat : p.seat, guess: null, mine: v.secret });
          return;
        }
        if (event === "rematch") {
          if (seat === 0) startFresh(r);
          else setWantRematch(true);
          return;
        }
        if (event === "quit") setLink((s) => ({ ...s, peer: false }));
      },
    });
    net.current = r;
    // The host's board exists before anyone joins; announce it on arrival too.
    return () => r.close();
  }, [code, seat]);

  const startFresh = (r) => {
    const b = drawBoard();
    const s = (view.current.starter + 1) % 2;
    setBoard(b); setStarter(s); setSecret(null); setOut([]); setLog([]);
    setOutcome(null); setReveal(null); setPeerReady(false); setWantRematch(false);
    setChoice(null); crossedFor.current = -1;
    (r || net.current).send("state", { board: b, starter: s, fresh: true });
  };

  // -- actions --------------------------------------------------------------
  const lockIn = (id) => {
    setSecret(id);
    setChoice(null);
    net.current.send("ready", {});
  };

  const ask = ({ qid, text }) => {
    const n = log.length;
    const q = qid ? deckById.get(qid) : null;
    setLog((l) => [...l, { n, by: seat, qid: qid || null, label: q ? q.label : text, yes: null }]);
    net.current.send("ask", { n, qid, text });
    setSheet(null);
  };

  const answerTyped = (yes) => {
    net.current.send("answer", { n: pending.n, yes });
    setLog((l) => l.map((e) => (e.n === pending.n ? { ...e, yes } : e)));
    setPending(null);
  };

  const cross = (entry) => {
    const q = deckById.get(entry.qid);
    if (!q) return;
    const doomed = board.filter((id) => !out.includes(id) && q.test(byId.get(id)) !== entry.yes);
    setOut((o) => [...o, ...doomed]);
  };

  const commitGuess = (id) => {
    net.current.send("guess", { n: log.length, id });
    net.current.send("reveal", { secret });
    setGuessing(false); setSheet(null);
    setOutcome({ winner: null, guess: id, mine: secret, waiting: true });
  };

  const tile = (id) => {
    if (phase === "pick") return setChoice(id);
    if (guessing) return setSheet({ kind: "guess-confirm", id });
    if (phase === "play" || phase === "wait") setOut((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  };

  const shareLink = `${location.origin}${location.pathname}?room=${code}`;
  const copy = async () => {
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: "Who's That Pokémon?", text: `Room code ${code}`, url: shareLink });
      else { await navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    } catch {}
  };

  // Auto-crossing is a convenience, not a rule: it only ever removes Pokémon the
  // answer has already ruled out, and it is off with one tap.
  const lastAnswered = [...log].reverse().find((e) => e.by === seat && e.yes !== null && e.qid);
  useEffect(() => {
    if (!prefs.autoCross || !lastAnswered || crossedFor.current >= lastAnswered.n || !board) return;
    crossedFor.current = lastAnswered.n;
    cross(lastAnswered);
  }, [lastAnswered && lastAnswered.n, prefs.autoCross, board]);

  // -- chrome ---------------------------------------------------------------
  const dot = link.peer ? C.good : link.state === "failed" ? C.bad : C.accent;
  const status =
    outcome ? "" :
    !board ? "Waiting for the board…" :
    phase === "pick" ? "Tap the one you'll keep secret" :
    !link.peer ? "Waiting for the other player…" :
    phase === "wait" ? "They're still choosing…" :
    myTurn ? "Your turn — ask or guess" : "Their turn…";

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", paddingBottom: 96 }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: `${C.bg}f2`,
                       backdropFilter: "blur(8px)", borderBottom: `1px solid ${C.line}`,
                       padding: "calc(env(safe-area-inset-top) + 10px) 12px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={copy}
            style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10,
                     padding: "6px 10px", cursor: "pointer", textAlign: "left" }}>
            <div style={{ fontSize: 8.5, color: C.dim, letterSpacing: ".18em", fontWeight: 700 }}>ROOM</div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".14em", color: C.accent }}>{code}</div>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.dim }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: dot, flex: "none" }} />
              {copied ? "Link copied" : link.peer ? "Both here" : link.state === "failed" ? "Can't reach the room" : "Waiting for a partner"}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap",
                          overflow: "hidden", textOverflow: "ellipsis",
                          color: myTurn ? C.accent : C.text }}>{status}</div>
          </div>
          {secret !== null && (
            <div style={{ textAlign: "center", flex: "none" }}>
              <Sprite id={secret} size={40} />
              <div style={{ fontSize: 8, color: C.dim, fontWeight: 700, letterSpacing: ".1em" }}>YOURS</div>
            </div>
          )}
        </div>
      </header>

      {/* The room code in the header is small on purpose; until someone else is
          actually in the room, it is the only thing that matters. */}
      {!link.peer && !outcome && (
        <div style={{ margin: "10px 10px 0", background: C.panel, border: `1px dashed ${C.line}`,
                      borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: C.dim }}>
              {link.state === "failed" ? "Can't reach the room — check the connection." : "Waiting for player 2. Give them this code:"}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: ".2em", color: C.accent }}>{code}</div>
          </div>
          <Btn kind="blue" small onClick={copy} style={{ flex: "none" }}>{copied ? "Copied" : "Share link"}</Btn>
        </div>
      )}

      {board ? (
        <>
          <div style={{ padding: "12px 0 10px" }}>
            <Board ids={board} out={out}
              secret={phase === "pick" ? choice : secret}
              badge={phase === "pick" ? "THIS?" : "YOURS"}
              mode={phase === "pick" ? "pick" : guessing ? "guess" : "play"} onTile={tile} />
          </div>

          {log.length > 0 && (
            <div style={{ padding: "4px 12px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <b style={{ fontSize: 12, color: C.dim, letterSpacing: ".1em" }}>QUESTIONS</b>
                <div style={{ flex: 1, height: 1, background: C.line }} />
                <label style={{ fontSize: 11, color: C.dim, display: "flex", alignItems: "center", gap: 5 }}>
                  <input type="checkbox" checked={prefs.autoCross}
                    onChange={(e) => setPrefs({ ...prefs, autoCross: e.target.checked })} />
                  cross out for me
                </label>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {[...log].reverse().slice(0, 6).map((e) => (
                  <div key={e.n} style={{ display: "flex", alignItems: "center", gap: 8,
                                          background: C.panel, border: `1px solid ${C.line}`,
                                          borderRadius: 10, padding: "9px 11px", fontSize: 13 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: e.by === seat ? C.accent2 : C.dim,
                                   flex: "none" }}>{e.by === seat ? "YOU" : "THEM"}</span>
                    <span style={{ flex: 1, minWidth: 0, color: C.text }}>{e.label}</span>
                    {e.yes === null
                      ? <span style={{ color: C.dim, fontSize: 12 }}>…</span>
                      : <span style={{ fontWeight: 800, color: e.yes ? C.good : C.bad }}>{e.yes ? "YES" : "NO"}</span>}
                    {e.by === seat && e.yes !== null && e.qid && (
                      <Btn kind="ghost" small style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => cross(e)}>cross</Btn>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: C.dim, padding: 30, textAlign: "center" }}>
          <div>
            <div style={{ fontSize: 15, marginBottom: 8 }}>Room <b style={{ color: C.accent }}>{code}</b></div>
            Read the code to the other player, or send them the link.<br />
            The board appears when they're in.
          </div>
        </div>
      )}

      {/* action bar */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 25,
                    background: `${C.bg}f5`, borderTop: `1px solid ${C.line}`, backdropFilter: "blur(8px)",
                    padding: "10px 12px calc(env(safe-area-inset-bottom) + 10px)" }}>
        {phase === "pick" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="plain" onClick={() => setChoice(board[Math.floor(Math.random() * board.length)])}>
              Surprise me
            </Btn>
            <Btn kind="go" style={{ flex: 1, opacity: choice === null ? 0.45 : 1 }} disabled={choice === null}
              onClick={() => lockIn(choice)}>
              {choice === null ? "Pick your secret Pokémon" : `Hide behind ${byId.get(choice).name}`}
            </Btn>
          </div>
        ) : guessing ? (
          <Btn kind="ghost" style={{ width: "100%" }} onClick={() => setGuessing(false)}>
            Tap the one you think is theirs — or cancel
          </Btn>
        ) : phase === "play" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="go" style={{ flex: 1, opacity: myTurn ? 1 : 0.45 }} disabled={!myTurn}
              onClick={() => setSheet({ kind: "ask" })}>Ask a question</Btn>
            <Btn kind="blue" style={{ opacity: myTurn ? 1 : 0.45 }} disabled={!myTurn}
              onClick={() => setGuessing(true)}>Guess</Btn>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, color: C.dim, fontSize: 13 }}>{status}</div>
            <Btn kind="ghost" small onClick={onLeave}>Leave</Btn>
          </div>
        )}
      </div>

      {sheet?.kind === "ask" && (
        <AskSheet deck={deck} alive={alive} onAsk={ask} onClose={() => setSheet(null)} onLeave={onLeave} />
      )}

      {sheet?.kind === "guess-confirm" && (
        <Sheet title="Final answer?" onClose={() => setSheet(null)}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <Sprite id={sheet.id} size={96} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{byId.get(sheet.id).name}</div>
              <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
                Say this is theirs and the game ends either way — right, you win; wrong, they do.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="ghost" style={{ flex: 1 }} onClick={() => setSheet(null)}>Not yet</Btn>
            <Btn kind="go" style={{ flex: 1 }} onClick={() => commitGuess(sheet.id)}>That's the one</Btn>
          </div>
        </Sheet>
      )}

      {pending && (
        <Sheet title="They asked you something" onClose={() => {}}>
          <div style={{ fontSize: 19, lineHeight: 1.45, margin: "4px 0 18px" }}>{pending.label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <Sprite id={secret} size={64} />
            <div style={{ color: C.dim, fontSize: 13 }}>
              About <b style={{ color: C.text }}>{byId.get(secret)?.name}</b> — only you can see this.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="go" style={{ flex: 1, background: C.good, color: "#032218" }} onClick={() => answerTyped(true)}>Yes</Btn>
            <Btn kind="go" style={{ flex: 1, background: C.bad, color: "#2b0a06" }} onClick={() => answerTyped(false)}>No</Btn>
          </div>
        </Sheet>
      )}

      {outcome && (
        <Over outcome={outcome} seat={seat} reveal={reveal} secret={secret} waiting={wantRematch}
          onAgain={() => (seat === 0 ? startFresh() : (net.current.send("rematch", {}), setWantRematch(true)))}
          onLeave={onLeave} />
      )}
    </div>
  );
}

function Over({ outcome, seat, reveal, secret, waiting, onAgain, onLeave }) {
  if (outcome.waiting) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#04060cd8", zIndex: 45,
                    display: "grid", placeItems: "center", color: C.dim }}>
        Locking it in…
      </div>
    );
  }
  const won = outcome.winner === seat;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#04060ce8", zIndex: 45, display: "flex",
                  alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 380, width: "100%", background: C.panel,
                    border: `1px solid ${C.line}`, borderRadius: 20, padding: "26px 20px 20px" }}>
        <div style={{ fontSize: 13, letterSpacing: ".22em", color: C.dim, fontWeight: 700 }}>
          {won ? "YOU WIN" : "THEY WIN"}
        </div>
        <h2 style={{ margin: "8px 0 22px", fontSize: 26 }}>
          {won ? "Called it." : "Not this time."}
        </h2>
        <div style={{ display: "flex", gap: 18, justifyContent: "center" }}>
          {[[secret, "Yours"], [reveal, "Theirs"]].map(([id, label]) => (
            <div key={label}>
              {id != null && <Sprite id={id} size={110} />}
              <div style={{ fontSize: 11, color: C.dim, letterSpacing: ".1em", marginTop: 2 }}>{label.toUpperCase()}</div>
              <div style={{ fontWeight: 800 }}>{id != null ? byId.get(id).name : "—"}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          <Btn kind="go" style={{ flex: 1 }} onClick={onAgain}>
            {waiting ? "Waiting for them…" : "Play again"}
          </Btn>
          <Btn kind="ghost" onClick={onLeave}>Leave</Btn>
        </div>
        <p style={{ color: C.dim, fontSize: 12, marginTop: 12 }}>A new game deals a fresh twenty-four.</p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- app

function App() {
  const [game, setGame] = useState(() => {
    const resumable = load(SAVE_KEY, null);
    if (resumable && resumable.code) return { code: resumable.code, seat: resumable.seat };
    const invited = cleanCode(new URLSearchParams(location.search).get("room") || "");
    return invited.length === 5 ? { code: invited, seat: 1 } : null;
  });

  const leave = () => { clear(SAVE_KEY); setGame(null); history.replaceState(null, "", location.pathname); };

  if (!game) return <Lobby onStart={(g) => { clear(SAVE_KEY); setGame(g); }} />;
  return <Game key={game.code + game.seat} code={game.code} seat={game.seat} onLeave={leave} />;
}

createRoot(document.getElementById("root")).render(<App />);
