import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";

// Ultra Pace — how you're doing, and what you have to hold to finish.
//
// Deliberately self-contained: no auth, no network, no Supabase. This gets
// opened at an aid station at 3am with the phone in airplane mode to save
// battery, so everything is baked into the bundle and state lives in
// localStorage. `bash make-offline.sh ultra-pace` packages it as one file.
//
// The whole app is three numbers you set once (distance, start, cutoff), one
// number you update as you go (miles done), and the arithmetic that turns them
// into the only question that matters late in a race: can I still make it, and
// how fast do I have to move from here?

const C = {
  bg: "#0f1318", panel: "#161c23", panel2: "#1b232b", line: "#2a333d",
  text: "#e7edf2", dim: "#8b97a3", faint: "#5c6670",
  accent: "#33c2b0", warm: "#e0a94d", danger: "#e5604d", good: "#4caf7d",
  climb: "#c07de0",
};

const mono = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

const LS = "ultra-pace/v1";
const loadState = () => { try { return JSON.parse(localStorage.getItem(LS)) || null; } catch { return null; } };
const saveState = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* private mode */ } };

// ---------------------------------------------------------------------------
// Formatting. Everything degrades to an em dash rather than NaN — a runner
// squinting at this in the dark should never see "NaN:undefined".
// ---------------------------------------------------------------------------

const DASH = "—";
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const ok = (n) => Number.isFinite(n);

// 4.216 -> "4:13" (minutes -> mm:ss). Used for pace.
function fmtPace(minPer) {
  if (!ok(minPer) || minPer <= 0 || minPer > 600) return DASH;
  const total = Math.round(minPer * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 13.4 hours -> "13h 24m". Sub-hour drops to "24m".
function fmtDur(hours) {
  if (!ok(hours)) return DASH;
  const neg = hours < 0;
  const totalMin = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const body = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  return (neg ? "−" : "") + body;
}

// Same, but always carries a sign. For margins and buffers.
function fmtSigned(hours) {
  if (!ok(hours)) return DASH;
  const s = fmtDur(hours);
  return hours >= 0 ? `+${s}` : s;
}

// Clock time on the phone's own timezone, which is the race's timezone if the
// runner flew in with the phone. 12-hour with a day tag when it isn't today.
function fmtClock(d, refNow) {
  if (!(d instanceof Date) || isNaN(d)) return DASH;
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!refNow) return t;
  const dayDiff = Math.round((startOfDay(d) - startOfDay(refNow)) / 86400000);
  if (dayDiff === 0) return t;
  if (dayDiff === 1) return `${t} +1d`;
  if (dayDiff === -1) return `${t} −1d`;
  return `${t} ${dayDiff > 0 ? "+" : "−"}${Math.abs(dayDiff)}d`;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// "next day" reads better under a big clock time than a cramped "+1d" beside it.
function dayLabel(d, refNow) {
  if (!(d instanceof Date) || isNaN(d)) return "";
  const diff = Math.round((startOfDay(d) - startOfDay(refNow)) / 86400000);
  if (diff === 0) return "same day";
  if (diff === 1) return "next day";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} days`;
}

const fmt1 = (n) => (ok(n) ? n.toFixed(1) : DASH);
const pct = (n) => (ok(n) ? Math.round(n * 100) : 0);

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const UNITS = {
  mi: { d: "mi", e: "ft", perD: "/mi", climbStep: 100 },
  km: { d: "km", e: "m", perD: "/km", climbStep: 50 },
};

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function Card({ children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, ...style }}>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: ".13em", color: C.faint, fontWeight: 700, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, color, mono: isMono = true }) {
  return (
    <div style={{ flex: "1 1 84px", minWidth: 84 }}>
      <Label>{label}</Label>
      <div style={{
        fontSize: 21, fontWeight: 700, color: color || C.text, lineHeight: 1.3,
        fontVariantNumeric: "tabular-nums", fontFamily: isMono ? mono : "inherit",
        letterSpacing: "-.02em",
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

const inputStyle = {
  width: "100%", background: C.bg, border: `1px solid ${C.line}`, color: C.text,
  borderRadius: 10, padding: "11px 12px", fontSize: 16, outline: "none",
  fontVariantNumeric: "tabular-nums",
};

const btn = {
  border: "none", borderRadius: 11, padding: "13px 16px", fontWeight: 700,
  fontSize: 15, cursor: "pointer", color: "#06231f", background: C.accent,
};

const ghost = {
  background: "transparent", border: `1px solid ${C.line}`, color: C.dim,
  borderRadius: 9, padding: "7px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer",
};

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <Label>{label}</Label>
        {hint && <span style={{ fontSize: 11, color: C.faint }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts. Inline SVG, no library — a chart library would be most of the
// bundle for four shapes.
// ---------------------------------------------------------------------------

// The headline: distance completed as an arc, with a tick where the cutoff
// clock currently sits. Fill past the tick means you're ahead of the line.
function ProgressRing({ done, clock, color, centerTop, centerMain, centerSub }) {
  const size = 188, sw = 15, r = (size - sw) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const d = Math.max(0, Math.min(1, done || 0));
  const t = Math.max(0, Math.min(1, clock || 0));
  const ang = (t * 360 - 90) * (Math.PI / 180);
  const tick = (rr) => [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)];
  const [x1, y1] = tick(r - sw / 2 - 4);
  const [x2, y2] = tick(r + sw / 2 + 4);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }} role="img"
      aria-label={`${pct(d)} percent of the distance done, cutoff clock at ${pct(t)} percent`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.panel2} strokeWidth={sw} />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${circ * d} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Cutoff clock marker */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.text} strokeWidth={2.5} strokeLinecap="round" opacity={0.85} />
      <text x={cx} y={cy - 30} textAnchor="middle" fill={C.faint} fontSize={10} fontWeight={700} letterSpacing="1.4">
        {centerTop}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill={C.text} fontSize={40} fontWeight={700}
        fontFamily={mono} letterSpacing="-1.5">{centerMain}</text>
      <text x={cx} y={cy + 32} textAnchor="middle" fill={C.dim} fontSize={12}>{centerSub}</text>
    </svg>
  );
}

// A completion bar. `marker` drops a reference line (the cutoff clock) so each
// bar answers "am I ahead of or behind the clock on this axis?".
function Bar({ label, value, right, frac, color, marker }) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const m = ok(marker) ? Math.max(0, Math.min(1, marker)) : null;
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, color: C.dim, fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>
          {value}{right ? <span style={{ color: C.faint }}> · {right}</span> : null}
        </span>
      </div>
      <div style={{ position: "relative", height: 10, background: C.panel2, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${f * 100}%`, background: color, borderRadius: 999 }} />
        {m !== null && (
          <div style={{
            position: "absolute", top: -2, bottom: -2, left: `calc(${m * 100}% - 1px)`,
            width: 2, background: C.text, opacity: 0.75, borderRadius: 2,
          }} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup — the three things the race tells you, plus optional total climb.
// ---------------------------------------------------------------------------

const emptyRace = () => {
  const d = new Date();
  d.setHours(6, 0, 0, 0);
  return { name: "", distance: "100", unit: "mi", start: toLocalInput(d), cutoffHours: "30", gain: "" };
};

function Setup({ initial, onSave, onCancel }) {
  const [f, setF] = useState(() => initial || emptyRace());
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const U = UNITS[f.unit] || UNITS.mi;

  const distance = num(f.distance);
  const cutoff = num(f.cutoffHours);
  const startValid = !isNaN(Date.parse(f.start));
  const valid = distance > 0 && cutoff > 0 && startValid;

  // The even-split pace the cutoff implies. Seeing it here is the sanity check
  // on whether you typed 30 hours or 300.
  const cutoffPace = valid ? (cutoff * 60) / distance : NaN;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 16px 40px" }}>
      <h1 style={{ fontSize: 25, margin: "0 0 4px", letterSpacing: "-.02em" }}>
        {initial ? "Edit race" : "Ultra Pace"}
      </h1>
      <p style={{ color: C.dim, fontSize: 13, margin: "0 0 22px", lineHeight: 1.55 }}>
        {initial
          ? "Change the race parameters. Your logged progress is kept."
          : "Set the race up once. Then it's one number to update as you go."}
      </p>

      <Card>
        <Field label="Race name" hint="optional">
          <input style={inputStyle} value={f.name} onChange={set("name")} placeholder="Cocodona 250" />
        </Field>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 2 }}>
            <Field label="Distance">
              <input style={inputStyle} value={f.distance} onChange={set("distance")}
                inputMode="decimal" placeholder="100" />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Units">
              <select style={{ ...inputStyle, padding: "11px 8px" }} value={f.unit} onChange={set("unit")}>
                <option value="mi">miles</option>
                <option value="km">km</option>
              </select>
            </Field>
          </div>
        </div>

        <Field label="Start time" hint={<button style={{ ...ghost, padding: "2px 8px" }}
          onClick={() => setF((p) => ({ ...p, start: toLocalInput(new Date()) }))}>now</button>}>
          <input style={inputStyle} type="datetime-local" value={f.start} onChange={set("start")} />
        </Field>

        <Field label="Cutoff" hint="hours from the start">
          <input style={inputStyle} value={f.cutoffHours} onChange={set("cutoffHours")}
            inputMode="decimal" placeholder="30" />
        </Field>

        <Field label={`Total climb (${U.e})`} hint="optional">
          <input style={inputStyle} value={f.gain} onChange={set("gain")}
            inputMode="numeric" placeholder="e.g. 18000" />
        </Field>

        {valid && (
          <div style={{ fontSize: 12, color: C.dim, background: C.bg, border: `1px solid ${C.line}`,
            borderRadius: 9, padding: "9px 11px", lineHeight: 1.5 }}>
            Cutoff pace is <b style={{ color: C.accent, fontFamily: mono }}>{fmtPace(cutoffPace)}{U.perD}</b> for
            the full {fmt1(distance)} {U.d} — that's the average you must beat, aid stations and sleep included.
          </div>
        )}
      </Card>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {onCancel && (
          <button style={{ ...btn, flex: 1, background: C.panel2, color: C.text }} onClick={onCancel}>Cancel</button>
        )}
        <button style={{ ...btn, flex: 2, opacity: valid ? 1 : 0.4 }} disabled={!valid}
          onClick={() => valid && onSave({ ...f, distance: String(distance), cutoffHours: String(cutoff) })}>
          {initial ? "Save" : "Start tracking"}
        </button>
      </div>

      {!valid && (
        <div style={{ fontSize: 12, color: C.warm, marginTop: 10, textAlign: "center" }}>
          Distance, start time and cutoff are all required.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The math. One pure function so the display layer stays dumb.
// ---------------------------------------------------------------------------

function compute(race, progress, nowMs, finishedAt) {
  const distance = num(race.distance);
  const cutoffH = num(race.cutoffHours);
  const totalGain = num(race.gain);
  const startMs = Date.parse(race.start);
  const cutoffMs = startMs + cutoffH * 3600000;

  const doneD = Math.max(0, Math.min(distance, num(progress.distance)));
  const doneG = Math.max(0, num(progress.gain));

  const leftD = Math.max(0, distance - doneD);
  const finished = doneD >= distance && distance > 0;

  // Once you're in, the clock stops. Everything downstream reads `refMs` so a
  // finished race keeps reporting the finishing time instead of drifting.
  const refMs = finished && finishedAt ? finishedAt : nowMs;

  const rawElapsedH = (refMs - startMs) / 3600000;
  const started = rawElapsedH >= 0;
  const elapsedH = Math.max(0, rawElapsedH);
  const toCutoffH = (cutoffMs - refMs) / 3600000;
  const expired = toCutoffH <= 0;

  const fracD = distance > 0 ? doneD / distance : 0;
  const fracT = cutoffH > 0 ? Math.min(1, elapsedH / cutoffH) : 0;
  const fracG = totalGain > 0 ? Math.min(1, doneG / totalGain) : null;

  // Pace so far, over everything: moving time, aid stations, naps, the lot.
  const avgPace = doneD > 0 && elapsedH > 0 ? (elapsedH * 60) / doneD : NaN;
  // What the remaining distance has to be covered at to beat the cutoff.
  const reqPace = leftD > 0 ? (toCutoffH > 0 ? (toCutoffH * 60) / leftD : 0) : NaN;
  // The whole-race even split. The reference line everything is judged against.
  const cutoffPace = distance > 0 ? (cutoffH * 60) / distance : NaN;

  // Hold the current average all the way in and you finish here.
  const projTotalH = fracD > 0 ? elapsedH / fracD : NaN;
  const projFinishMs = ok(projTotalH) ? startMs + projTotalH * 3600000 : NaN;
  const marginH = ok(projTotalH) ? cutoffH - projTotalH : NaN;

  // Time buffer: at the cutoff's even split, this much elapsed time "buys" the
  // distance you've done. Positive means you're that far ahead of the sweeper.
  const bufferH = ok(cutoffPace) ? (doneD * cutoffPace) / 60 - elapsedH : NaN;
  // Same idea expressed as ground: where the cutoff line is right now.
  const clockD = cutoffH > 0 ? (elapsedH / cutoffH) * distance : 0;
  const aheadD = doneD - clockD;

  const gainLeft = totalGain > 0 ? Math.max(0, totalGain - doneG) : NaN;
  const gainRate = doneD > 0 && doneG > 0 ? doneG / doneD : NaN;

  let status = "ok";                       // green: comfortable
  if (!started) status = "pre";
  else if (finished) status = "done";
  else if (expired) status = "expired";
  else if (!ok(marginH)) status = "start";  // running, nothing logged yet
  else if (marginH < 0) status = "behind";
  else if (marginH < 1) status = "tight";

  return {
    distance, cutoffH, totalGain, startMs, cutoffMs, doneD, doneG, leftD, refMs,
    started, finished, expired, elapsedH, toCutoffH, rawElapsedH,
    fracD, fracT, fracG, avgPace, reqPace, cutoffPace,
    projTotalH, projFinishMs, marginH, bufferH, aheadD, gainLeft, gainRate, status,
  };
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

const STATUS = {
  pre:     { color: C.accent, title: "Not started yet" },
  start:   { color: C.accent, title: "Log your mileage" },
  ok:      { color: C.good,   title: "On pace" },
  tight:   { color: C.warm,   title: "Cutting it close" },
  behind:  { color: C.danger, title: "Behind the cutoff" },
  expired: { color: C.danger, title: "Past the cutoff" },
  done:    { color: C.good,   title: "Finished" },
};

function Tracker({ race, progress, finishedAt, setProgress, splits, onLogSplit, onDeleteSplit, onEdit, onReset }) {
  const [now, setNow] = useState(() => Date.now());
  const [showSplits, setShowSplits] = useState(false);

  // A minute is plenty: nothing on screen moves faster than that, and a 1s
  // interval is a pointless wakeup on a phone that has to last 30 hours. The
  // extra tick right after mount keeps it from feeling stale on open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    const onVis = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const U = UNITS[race.unit] || UNITS.mi;
  const r = useMemo(() => compute(race, progress, now, finishedAt), [race, progress, now, finishedAt]);
  const S = STATUS[r.status];

  const bump = useCallback((delta) => {
    setProgress((p) => {
      const next = Math.max(0, Math.round((num(p.distance) + delta) * 100) / 100);
      return { ...p, distance: String(next) };
    });
  }, [setProgress]);

  // The last leg, from the most recent split to right now. Overall average
  // hides a fade; this is the number that tells you the wheels are coming off.
  const legPace = useMemo(() => {
    if (!splits.length) return null;
    const last = splits[splits.length - 1];
    const dd = r.doneD - num(last.d);
    const hh = (r.refMs - last.t) / 3600000;
    if (dd <= 0.05 || hh <= 0.002) return null;
    return { pace: (hh * 60) / dd, dist: dd, hours: hh };
  }, [splits, r.doneD, r.refMs]);

  const headline = (() => {
    if (r.status === "done") return { big: fmtDur(r.elapsedH), sub: "elapsed at your finish" };
    if (r.status === "pre") return { big: fmtDur(-r.rawElapsedH), sub: "until the gun" };
    if (r.status === "expired") return { big: fmtDur(-r.toCutoffH), sub: "past the cutoff" };
    return { big: `${fmtPace(r.reqPace)}${U.perD}`, sub: `required for the last ${fmt1(r.leftD)} ${U.d}` };
  })();

  const verdict = (() => {
    if (r.status === "pre") return `Starts ${fmtClock(new Date(r.startMs), new Date(now))}. Cutoff pace is ${fmtPace(r.cutoffPace)}${U.perD}.`;
    if (r.status === "start") return `Clock is running. Enter the miles you've covered to see where you stand.`;
    if (r.status === "done") return `${fmt1(r.distance)} ${U.d} at ${fmtPace(r.avgPace)}${U.perD}, ${r.toCutoffH >= 0 ? `with ${fmtDur(r.toCutoffH)} to spare` : `${fmtDur(-r.toCutoffH)} past the cutoff`}.`;
    if (r.status === "expired") return `The cutoff has passed. You were ${fmt1(r.leftD)} ${U.d} out.`;
    if (r.status === "behind") return `Holding ${fmtPace(r.avgPace)}${U.perD} finishes ${fmtDur(-r.marginH)} late. You need ${fmtPace(r.reqPace)}${U.perD} from here.`;
    if (r.status === "tight") return `Only ${fmtDur(r.marginH)} of margin at your current average. Required pace is ${fmtPace(r.reqPace)}${U.perD}.`;
    return `${fmtDur(r.marginH)} in hand at your current average. You can afford to slow to ${fmtPace(r.reqPace)}${U.perD}.`;
  })();

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "18px 16px 44px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, margin: 0, letterSpacing: "-.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {race.name || "Ultra Pace"}
          </h1>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
            {fmt1(r.distance)} {U.d} · {fmtDur(r.cutoffH)} cutoff · off at {fmtClock(new Date(r.startMs))}
          </div>
        </div>
        <button style={ghost} onClick={onEdit}>Edit</button>
      </div>

      {/* Progress entry, first thing on screen — this is what you came to do. */}
      <Card style={{ marginBottom: 14 }}>
        <Field label={`Distance completed (${U.d})`} hint={`of ${fmt1(r.distance)}`}>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...btn, background: C.panel2, color: C.text, padding: "11px 0", width: 52, fontSize: 19 }}
              onClick={() => bump(-1)} aria-label={`minus one ${U.d}`}>−</button>
            <input style={{ ...inputStyle, textAlign: "center", fontSize: 19, fontWeight: 700, fontFamily: mono }}
              value={progress.distance} inputMode="decimal" placeholder="0"
              onChange={(e) => setProgress((p) => ({ ...p, distance: e.target.value }))} />
            <button style={{ ...btn, background: C.panel2, color: C.text, padding: "11px 0", width: 52, fontSize: 19 }}
              onClick={() => bump(1)} aria-label={`plus one ${U.d}`}>+</button>
          </div>
        </Field>

        <Field label={`Climb so far (${U.e})`} hint="optional">
          <input style={{ ...inputStyle, fontFamily: mono }} value={progress.gain} inputMode="numeric"
            placeholder={r.totalGain > 0 ? `of ${Math.round(r.totalGain).toLocaleString()}` : "optional"}
            onChange={(e) => setProgress((p) => ({ ...p, gain: e.target.value }))} />
        </Field>

        <button style={{ ...btn, width: "100%", background: C.panel2, color: C.accent, opacity: r.started ? 1 : 0.4 }}
          onClick={onLogSplit} disabled={!r.started}>
          Log this as a split
        </button>
      </Card>

      {/* Verdict */}
      <Card style={{
        marginBottom: 14, borderColor: `${S.color}66`, background: `${S.color}12`,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: S.color, display: "inline-block" }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: S.color, letterSpacing: ".02em" }}>{S.title}</span>
        </div>
        <div style={{ fontSize: 34, fontWeight: 700, fontFamily: mono, letterSpacing: "-.03em", lineHeight: 1.1 }}>
          {headline.big}
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{headline.sub}</div>
        <div style={{ fontSize: 13, color: C.text, marginTop: 10, lineHeight: 1.55, opacity: 0.92 }}>{verdict}</div>
      </Card>

      {/* Ring */}
      <Card style={{ marginBottom: 14, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <ProgressRing
          done={r.fracD} clock={r.fracT} color={S.color}
          centerTop="COMPLETE"
          centerMain={`${pct(r.fracD)}%`}
          centerSub={`${fmt1(r.doneD)} of ${fmt1(r.distance)} ${U.d}`}
        />
        <div style={{ fontSize: 11.5, color: C.dim, textAlign: "center", marginTop: 6, lineHeight: 1.5, maxWidth: 300 }}>
          The tick is where the cutoff clock sits ({pct(r.fracT)}% of the time used).
          {r.started && !r.finished && (
            <> You are <b style={{ color: r.aheadD >= 0 ? C.good : C.danger }}>
              {fmt1(Math.abs(r.aheadD))} {U.d} {r.aheadD >= 0 ? "ahead of" : "behind"}
            </b> it.</>
          )}
        </div>
      </Card>

      {/* Clock */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <Stat label="Elapsed" value={fmtDur(r.elapsedH)} />
          <Stat label="To cutoff" value={fmtDur(Math.max(0, r.toCutoffH))}
            color={r.toCutoffH < 2 && !r.finished ? C.warm : C.text}
            sub={fmtClock(new Date(r.cutoffMs), new Date(now))} />
          <Stat label={`${U.d} left`} value={fmt1(r.leftD)} />
        </div>
      </Card>

      {/* Pace */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <Stat label="Pace so far" value={fmtPace(r.avgPace)} sub={U.perD + " overall"} />
          <Stat label="Required now" value={fmtPace(r.reqPace)} sub={`${U.perD} to the cutoff`}
            color={ok(r.reqPace) && ok(r.avgPace) ? (r.reqPace >= r.avgPace ? C.good : C.danger) : C.text} />
          <Stat label="Cutoff avg" value={fmtPace(r.cutoffPace)} sub={U.perD + " even split"} color={C.dim} />
        </div>
        {legPace && (
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 11, display: "flex", flexWrap: "wrap", gap: 14 }}>
            <Stat label="Last leg" value={fmtPace(legPace.pace)}
              sub={`${U.perD} over ${fmt1(legPace.dist)} ${U.d}`}
              color={ok(r.reqPace) && legPace.pace > r.reqPace ? C.warm : C.text} />
            <Stat label="Since split" value={fmtDur(legPace.hours)} sub="of running" />
          </div>
        )}
      </Card>

      {/* Projection */}
      {r.started && r.fracD > 0 && !r.finished && (
        <Card style={{ marginBottom: 14 }}>
          <Label>If you hold your current average</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
            <Stat label="Finish at" value={fmtClock(new Date(r.projFinishMs))} mono={false}
              sub={dayLabel(new Date(r.projFinishMs), new Date(now))} />
            <Stat label="Total time" value={fmtDur(r.projTotalH)} />
            <Stat label="vs cutoff" value={fmtSigned(r.marginH)} color={r.marginH >= 0 ? C.good : C.danger} />
          </div>
        </Card>
      )}

      {/* Completion bars */}
      <Card style={{ marginBottom: 14 }}>
        <Label>Percent complete</Label>
        <div style={{ marginTop: 12 }}>
          <Bar label="Distance" color={S.color} frac={r.fracD} marker={r.fracT}
            value={`${pct(r.fracD)}%`} right={`${fmt1(r.doneD)}/${fmt1(r.distance)} ${U.d}`} />
          <Bar label="Cutoff clock" color={C.dim} frac={r.fracT}
            value={`${pct(r.fracT)}%`} right={`${fmtDur(r.elapsedH)}/${fmtDur(r.cutoffH)}`} />
          {r.totalGain > 0 && (
            <Bar label="Climb" color={C.climb} frac={r.fracG || 0} marker={r.fracD}
              value={`${pct(r.fracG || 0)}%`}
              right={`${Math.round(r.doneG).toLocaleString()}/${Math.round(r.totalGain).toLocaleString()} ${U.e}`} />
          )}
        </div>
        {r.totalGain > 0 && (
          <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5, marginTop: 2 }}>
            {Math.round(r.gainLeft).toLocaleString()} {U.e} of climb left
            {ok(r.gainRate) && <> · you've averaged {Math.round(r.gainRate).toLocaleString()} {U.e}{U.perD}</>}
            . The tick on the climb bar is your distance — fill past it means the
            hard climbing is behind you.
          </div>
        )}
        {!r.totalGain && (
          <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5 }}>
            Add the race's total climb under Edit to track elevation too.
          </div>
        )}
      </Card>

      {/* Splits */}
      <Card>
        <button onClick={() => setShowSplits((s) => !s)}
          style={{ background: "none", border: "none", padding: 0, width: "100%", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center", color: C.text }}>
          <Label>Splits {splits.length ? `(${splits.length})` : ""}</Label>
          <span style={{ color: C.dim, fontSize: 12 }}>{showSplits ? "hide" : "show"}</span>
        </button>
        {showSplits && (
          <div style={{ marginTop: 12 }}>
            {splits.length === 0 && (
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.55 }}>
                No splits yet. Tap “Log this as a split” at an aid station and each
                leg's pace shows up here.
              </div>
            )}
            {splits.slice().reverse().map((s, i, arr) => {
              const prev = arr[i + 1];
              const prevD = prev ? num(prev.d) : 0;
              const prevT = prev ? prev.t : r.startMs;
              const legD = num(s.d) - prevD;
              const legH = (s.t - prevT) / 3600000;
              const p = legD > 0 && legH > 0 ? (legH * 60) / legD : NaN;
              return (
                <div key={s.t} style={{ display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                  <div style={{ width: 62, fontFamily: mono, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                    {fmt1(num(s.d))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontFamily: mono }}>
                      {fmtPace(p)}<span style={{ color: C.faint }}>{U.perD}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim }}>
                      {fmtClock(new Date(s.t))} · {fmt1(legD)} {U.d} in {fmtDur(legH)}
                      {ok(num(s.g)) && num(s.g) > 0 ? ` · ${Math.round(num(s.g)).toLocaleString()} ${U.e}` : ""}
                    </div>
                  </div>
                  <button style={{ ...ghost, padding: "4px 9px", borderColor: "transparent", color: C.faint }}
                    onClick={() => onDeleteSplit(s.t)} aria-label="delete split">✕</button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div style={{ textAlign: "center", marginTop: 22 }}>
        <button style={{ ...ghost, borderColor: "transparent", color: C.faint }} onClick={onReset}>
          Reset everything
        </button>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
          Works offline · nothing leaves your phone
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

// Stamp (or clear) the moment the runner first reached the full distance, so a
// finished race can stop its clock. Re-run whenever progress or the race change,
// because bumping the distance up in Edit un-finishes a race.
function stampFinish(s) {
  const full = num(s.race.distance) > 0 && num(s.progress.distance) >= num(s.race.distance);
  if (full) return s.finishedAt ? s : { ...s, finishedAt: Date.now() };
  return s.finishedAt ? { ...s, finishedAt: null } : s;
}

function App() {
  const [state, setState] = useState(() => loadState());
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (state) saveState(state); }, [state]);

  const setProgress = useCallback((fn) => {
    setState((s) => stampFinish({ ...s, progress: typeof fn === "function" ? fn(s.progress) : fn }));
  }, []);

  const logSplit = useCallback(() => {
    setState((s) => {
      const splits = s.splits || [];
      const entry = { t: Date.now(), d: num(s.progress.distance), g: num(s.progress.gain) };
      // Two taps in the same minute at the same mileage is a fat finger, not a leg.
      const last = splits[splits.length - 1];
      if (last && last.d === entry.d && entry.t - last.t < 60000) return s;
      return { ...s, splits: [...splits, entry] };
    });
  }, []);

  const deleteSplit = useCallback((t) => {
    setState((s) => ({ ...s, splits: (s.splits || []).filter((x) => x.t !== t) }));
  }, []);

  const reset = useCallback(() => {
    if (!window.confirm("Clear the race, your progress and all splits?")) return;
    try { localStorage.removeItem(LS); } catch { /* ignore */ }
    setState(null);
    setEditing(false);
  }, []);

  if (!state) {
    return <Setup onSave={(race) => setState({ race, progress: { distance: "", gain: "" }, splits: [], finishedAt: null })} />;
  }

  if (editing) {
    return (
      <Setup
        initial={state.race}
        onCancel={() => setEditing(false)}
        onSave={(race) => { setState((s) => stampFinish({ ...s, race })); setEditing(false); }}
      />
    );
  }

  return (
    <Tracker
      race={state.race}
      progress={state.progress}
      finishedAt={state.finishedAt}
      setProgress={setProgress}
      splits={state.splits || []}
      onLogSplit={logSplit}
      onDeleteSplit={deleteSplit}
      onEdit={() => setEditing(true)}
      onReset={reset}
    />
  );
}

createRoot(document.getElementById("root")).render(<App />);
