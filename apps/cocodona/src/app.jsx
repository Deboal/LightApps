import React, { useState, useMemo, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  RACE, STATIONS, SEGMENTS, PROFILE, CHECKSUM,
  CREW_STATIONS, SWAP_STATIONS, SLEEP_STATIONS, VERIFY_FLAGS, SOLO_MANDATED,
  SOLO_MANDATED_MILES, PACER_LEGAL_MILES,
} from "./course.js";
import {
  BLOCKS, SCENARIOS, buildScenario, PACERS, PACER_RULES,
  SINGLE_PACER_FALLBACK, GATES, GATE_RATIONALE, OPEN_ITEMS,
} from "./plan.js";

// Cocodona 250 — crew and pacer briefing.
//
// Deliberately self-contained: no auth, no network, no Supabase. Pacers and crew
// will open this in Arizona backcountry with one bar of signal, or from a file
// saved to the home screen with the radio off. localStorage holds the few things
// they change (drive times measured during recon, pacer names, checked items).
//
// Course data is official 2026 Aravaipa. The 2027 manual has not published.

const C = {
  bg: "#0f1318", panel: "#161c23", panel2: "#1b232b", line: "#2a333d",
  text: "#e7edf2", dim: "#8b97a3", faint: "#5c6670",
  accent: "#33c2b0", warm: "#e0a94d", danger: "#e5604d", good: "#4caf7d",
  A: "#4d8fe5", B: "#c07de0",
};

const LS = "cocodona.crew.v1";
const loadState = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
const saveState = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} };

const font = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
const mono = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function Pill({ children, color = C.dim, bg, title }) {
  return (
    <span title={title} style={{
      display: "inline-block", fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
      color, background: bg || "transparent", border: `1px solid ${color}55`,
      borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ flex: "1 1 90px", minWidth: 90 }}>
      <div style={{ fontSize: 10, letterSpacing: ".12em", color: C.faint, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || C.text, lineHeight: 1.25, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, note }) {
  return (
    <div style={{ margin: "26px 0 12px" }}>
      <h2 style={{ margin: 0, fontSize: 16, letterSpacing: "-.01em" }}>{children}</h2>
      {note && <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>{note}</div>}
    </div>
  );
}

// A standing caveat. The whole app rests on 2026 data.
function DataWarning({ compact }) {
  return (
    <div style={{
      background: "#2a1f12", border: `1px solid ${C.warm}55`, borderRadius: 10,
      padding: compact ? "8px 11px" : "11px 13px", fontSize: 12, color: "#f0d9a8", lineHeight: 1.55,
    }}>
      <b style={{ color: C.warm }}>2026 data.</b> The 2027 runner manual has not published. Aid stations,
      cutoffs, crew access and the three owl-habitat pacer closures must be re-verified before
      any of this is treated as settled. A closure that moves shifts the entire hand-off grid.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elevation profile. Station nodes only — see the caveat in course.js.
// ---------------------------------------------------------------------------
function Profile({ highlightMile, onPick }) {
  const W = 1000, H = 200, PAD = { l: 38, r: 10, t: 14, b: 22 };
  const elevs = PROFILE.map((p) => p.elev);
  const lo = Math.floor(Math.min(...elevs) / 500) * 500;
  const hi = Math.ceil(Math.max(...elevs) / 500) * 500;
  const x = (m) => PAD.l + (m / RACE.miles) * (W - PAD.l - PAD.r);
  const y = (e) => PAD.t + (1 - (e - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  const line = PROFILE.map((p, i) => `${i ? "L" : "M"}${x(p.mile).toFixed(1)},${y(p.elev).toFixed(1)}`).join(" ");
  const area = `${line} L${x(RACE.miles).toFixed(1)},${y(lo)} L${x(0)},${y(lo)} Z`;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 460, display: "block" }}
           role="img" aria-label="Course elevation profile by aid station">
        <defs>
          <linearGradient id="profFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.accent} stopOpacity="0.32" />
            <stop offset="100%" stopColor={C.accent} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[lo, (lo + hi) / 2, hi].map((e) => (
          <g key={e}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(e)} y2={y(e)} stroke={C.line} strokeWidth="1" />
            <text x={PAD.l - 6} y={y(e) + 3.5} textAnchor="end" fill={C.faint} fontSize="10" fontFamily={mono}>
              {(e / 1000).toFixed(1)}k
            </text>
          </g>
        ))}
        {/* Mandatory-solo stretches shaded behind the profile. */}
        {SOLO_MANDATED.map((s) => (
          <rect key={s.fromMile} x={x(s.fromMile)} y={PAD.t} width={x(s.toMile) - x(s.fromMile)}
                height={H - PAD.t - PAD.b} fill={C.danger} opacity="0.10" />
        ))}
        <path d={area} fill="url(#profFill)" />
        <path d={line} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" />
        {PROFILE.slice(1).map((p) => {
          const st = STATIONS.find((s) => s.name === p.name);
          const on = highlightMile === p.mile;
          return (
            <circle key={p.name} cx={x(p.mile)} cy={y(p.elev)} r={on ? 5 : 2.6}
                    fill={on ? C.text : st && st.crew ? C.accent : C.faint}
                    stroke={on ? C.accent : "none"} strokeWidth="2"
                    style={{ cursor: onPick ? "pointer" : "default" }}
                    onClick={() => onPick && onPick(p.mile)} />
          );
        })}
        {/* Mt. Elden peaks near 9,000 ft between Wildcat Hill and Trinity Heights.
            Trinity Heights is recorded AFTER the descent, so the summit is not a
            node and the line above does not show it. Called out explicitly. */}
        <g>
          <line x1={x(241)} x2={x(241)} y1={PAD.t} y2={y(6727)} stroke={C.danger} strokeWidth="1" strokeDasharray="3 3" />
          <text x={x(241)} y={PAD.t - 3} textAnchor="middle" fill={C.danger} fontSize="9.5" fontFamily={mono}>
            Elden ~9,000 (not a node)
          </text>
        </g>
        {[0, 50, 100, 150, 200, 250].map((m) => (
          <text key={m} x={x(m)} y={H - 6} textAnchor="middle" fill={C.faint} fontSize="10" fontFamily={mono}>{m}</text>
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The single graphic that answers "where can pacers fit in".
// ---------------------------------------------------------------------------
function PacerStrip({ splits }) {
  const W = 1000, H = 60;
  const x = (m) => (m / RACE.miles) * W;
  const bands = splits.map((s) => {
    const prev = s.mile - s.segMiles;
    const color = s.mandated ? C.danger : s.pacer === "A" ? C.A : s.pacer === "B" ? C.B : C.warm;
    return { ...s, x0: x(prev), x1: x(s.mile), color };
  });

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 460, display: "block" }}
             role="img" aria-label="Pacer coverage across the course">
          {bands.map((b) => (
            <rect key={b.mile} x={b.x0} y={10} width={Math.max(b.x1 - b.x0, 0.8)} height={26}
                  fill={b.color} opacity={b.mandated ? 0.5 : 0.85} />
          ))}
          {bands.filter((b) => b.mandated).map((b) => (
            <rect key={"h" + b.mile} x={b.x0} y={10} width={Math.max(b.x1 - b.x0, 0.8)} height={26}
                  fill="none" stroke={C.danger} strokeWidth="1.5" strokeDasharray="4 3" />
          ))}
          {STATIONS.filter((s) => s.swap).map((s) => (
            <g key={s.name}>
              <line x1={x(s.mile)} x2={x(s.mile)} y1={4} y2={42} stroke={C.text} strokeWidth="1.4" />
              <circle cx={x(s.mile)} cy={4} r="2.4" fill={C.text} />
            </g>
          ))}
          {[0, 50, 100, 150, 200, 250].map((m) => (
            <text key={m} x={x(m)} y={H - 4} textAnchor="middle" fill={C.faint} fontSize="10" fontFamily={mono}>{m}</text>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11, color: C.dim }}>
        <Legend color={C.danger} label="Solo — required by rule" />
        <Legend color={C.warm} label="Solo by choice (pacer legal)" />
        <Legend color={C.A} label="Pacer A" />
        <Legend color={C.B} label="Pacer B" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 1.5, height: 12, background: C.text, display: "inline-block" }} /> swap point
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 12, height: 10, background: color, borderRadius: 2, display: "inline-block" }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview — "what we are getting into"
// ---------------------------------------------------------------------------
function Overview({ built, setTab }) {
  const { totals } = built;
  const daysOut = Math.max(0, Math.round((new Date(RACE.start) - new Date()) / 86400e3));
  const bigClimb = [...SEGMENTS].sort((a, b) => b.gain - a.gain).slice(0, 3);
  const bigDrop = [...SEGMENTS].sort((a, b) => b.loss - a.loss).slice(0, 3);

  return (
    <div>
      <Card style={{ background: `linear-gradient(160deg,#17222a,${C.panel})` }}>
        <div style={{ fontSize: 11, letterSpacing: ".18em", color: C.accent, fontWeight: 700 }}>
          MONDAY MAY 3, 2027 · 5:00 AM
        </div>
        <h1 style={{ margin: "6px 0 2px", fontSize: 25, letterSpacing: "-.02em" }}>{RACE.name}</h1>
        <div style={{ color: C.dim, fontSize: 13.5 }}>{RACE.from} → {RACE.to}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 18 }}>
          <Stat label="Distance" value={`${RACE.miles}`} sub="miles" />
          <Stat label="Climbing" value={`${(RACE.gain / 1000).toFixed(1)}k`} sub="feet up" color={C.warm} />
          <Stat label="Descent" value={`${(RACE.loss / 1000).toFixed(1)}k`} sub="feet down" color={C.warm} />
          <Stat label="Cutoff" value={RACE.cutoffHours} sub="hours" />
          <Stat label="Days out" value={daysOut} sub="from today" color={C.accent} />
        </div>
      </Card>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <Card style={{ flex: "1 1 240px" }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: C.faint, fontWeight: 700 }}>THE PLAN</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, color: built.scenario.color }}>
            {built.scenario.label}
          </div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>
            Finish <b style={{ color: C.text }}>{totals.finishClock}</b> at {totals.elapsed} hours.
            That leaves <b style={{ color: C.good }}>{totals.cutoffMargin} hours</b> of buffer
            against the {RACE.cutoffHours}-hour cutoff.
          </div>
        </Card>
        <Card style={{ flex: "1 1 240px" }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: C.faint, fontWeight: 700 }}>SLEEP, TOTAL</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{totals.sleepHrs} hr</div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>
            Across {built.blocks.filter((b) => b.type === "SLEEP").length} planned stops
            in {totals.restHrs} hours of horizontal time. Over four days and nights.
          </div>
        </Card>
      </div>

      <SectionTitle note="Station-node profile: start elevation plus the running sum of each segment's gain and loss. It cross-foots to the published totals exactly, and lands Flagstaff at 6,857 ft against a real ~6,900. But a straight line between two stations hides every climb in between — read the segment bars for actual vertical work.">
        The shape of it
      </SectionTitle>
      <Card><Profile /></Card>

      <SectionTitle note={`${RACE.miles} miles of trail, and a pacer is legal on only ${PACER_LEGAL_MILES} of them. Of those, ${(PACERS.A.totalMiles + PACERS.B.totalMiles).toFixed(1)} are actually covered. This is the whole logistics problem in one picture.`}>
        Where pacers can and cannot go
      </SectionTitle>
      <Card>
        <PacerStrip splits={built.splits} />
        <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Stat label="Solo, required" value={SOLO_MANDATED_MILES} sub="miles by rule" color={C.danger} />
          <Stat label="Pacer A" value={PACERS.A.totalMiles} sub="miles, 2 pulls" color={C.A} />
          <Stat label="Pacer B" value={PACERS.B.totalMiles} sub="miles, 4 shifts" color={C.B} />
          <Stat label="Solo by choice" value="26.3" sub="Dead Horse → Sedona" color={C.warm} />
        </div>
      </Card>

      <SectionTitle>The four hardest things about this race</SectionTitle>
      <div style={{ display: "grid", gap: 10 }}>
        <Hard n="1" title="Day 1 asks for the fastest pace against 44% of the total climbing"
              body="Start to Whiskey Row is 75.7 miles with +17,215 ft, and the plan wants 3.6 mph through it — the quickest average of the whole race. It only works because the Bradshaw climbing is front-loaded into the first 33 miles and the back half is far more runnable than the gain total suggests. The failure mode is treating that permission as a licence to race the first 40." />
        <Hard n="2" title="The first 83 miles are solo, and so are the last 19"
              body="No pacer is legal until Watson Lake at mile 82.8 — a third of the race, alone. Then, on the fourth night, Wildcat Hill to the finish is closed again — which means Mt. Elden, +3,386 ft to 9,000 ft then 2,000 ft down over ~40 switchbacks, is climbed alone at the deepest point of sleep deprivation." color={C.danger} />
        <Hard n="3" title="Descent, not climbing, is what ends 250s"
              body="33,884 ft of it. Jerome alone drops 4,428 ft in 17 miles. Quad damage accumulates and does not recover mid-race, and it is the mechanical limiter the training plan spends a whole block arming against." />
        <Hard n="4" title="Desert heat for 36 hours, then 25°F on a 9,000 ft peak"
              body="Exposed low-desert start near Black Canyon City in early May, a 7,000 ft finish, and Munds Park's unheated tents at upper-30s in between. The kit has to cover both ends and the drop bags have to be right, because the layers you need on Elden are packed 40 hours earlier." />
      </div>

      <SectionTitle>Standing caveat</SectionTitle>
      <DataWarning />
      {!CHECKSUM.ok && (
        <div style={{ marginTop: 10, background: "#2b1614", border: `1px solid ${C.danger}`, borderRadius: 10, padding: 12, fontSize: 12.5, color: "#f4bdb4" }}>
          <b>Course table does not cross-foot.</b> Transcribed totals ({CHECKSUM.gain} up / {CHECKSUM.loss} down /
          {" "}{CHECKSUM.miles} mi) disagree with the published figures. Fix the station table before trusting any split.
        </div>
      )}
    </div>
  );
}

function Hard({ n, title, body, color }) {
  return (
    <Card style={{ borderLeft: `3px solid ${color || C.accent}` }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: color || C.accent, opacity: 0.5, lineHeight: 1 }}>{n}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 5 }}>{title}</div>
          <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.65 }}>{body}</div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tab: Splits — the three-scenario table. Open item #2, offered twice, never built.
// ---------------------------------------------------------------------------
function Splits({ scenarioId, setScenarioId, built }) {
  const all = useMemo(() => SCENARIOS.map((s) => buildScenario(s.id)), []);
  // On a phone the three comparison columns push the arrival times off-screen
  // entirely, which hides the one number the table exists to show. Start in
  // single-scenario mode on narrow viewports and let the user opt into compare.
  const wide = typeof window !== "undefined" && window.innerWidth >= 700;
  const [compare, setCompare] = useState(wide);

  const th = { textAlign: "right", padding: "7px 8px", fontSize: 10, letterSpacing: ".07em",
               color: C.faint, fontWeight: 700, borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "7px 8px", fontSize: 12.5, borderBottom: `1px solid ${C.line}22`,
               fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  // The station column pins to the left edge so a horizontal scroll never leaves
  // you looking at times with no idea which station they belong to.
  const stickyCell = { position: "sticky", left: 0, zIndex: 1, background: C.panel,
                       boxShadow: `1px 0 0 ${C.line}` };

  return (
    <div>
      <SectionTitle note="Arrival time at every aid station, under all three scenarios, with pacer state and crew access. This is the exhibit the race plan was missing.">
        Three-scenario split table
      </SectionTitle>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => setScenarioId(s.id)} style={{
            background: scenarioId === s.id ? s.color + "22" : C.panel,
            border: `1px solid ${scenarioId === s.id ? s.color : C.line}`,
            color: scenarioId === s.id ? s.color : C.dim,
            borderRadius: 9, padding: "9px 13px", cursor: "pointer", fontSize: 13, fontWeight: 700, textAlign: "left",
          }}>
            {s.label}
            <div style={{ fontSize: 9.5, letterSpacing: ".1em", opacity: 0.75, marginTop: 2 }}>{s.tag}</div>
          </button>
        ))}
      </div>

      <Card style={{ borderLeft: `3px solid ${built.scenario.color}` }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: C.dim }}>{built.scenario.blurb}</div>
        {built.scenario.note && (
          <div style={{ fontSize: 12, lineHeight: 1.6, color: C.faint, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
            {built.scenario.note}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 14 }}>
          <Stat label="Finish" value={built.totals.finishClock} color={built.scenario.color} />
          <Stat label="Elapsed" value={`${built.totals.elapsed}h`} />
          <Stat label="Buffer" value={`${built.totals.cutoffMargin}h`} sub="to cutoff" color={C.good} />
          <Stat label="Moving" value={`${built.totals.moveHrs}h`} />
          <Stat label="Sleep" value={`${built.totals.sleepHrs}h`} />
          <Stat label="Avg" value={built.totals.avgMph} sub="mph all-in" />
        </div>
      </Card>

      <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0 8px", fontSize: 13, color: C.dim, cursor: "pointer" }}>
        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
        Show all three scenarios side by side
      </label>

      <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 12, background: C.panel }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: compare ? 720 : 560 }}>
          <thead>
            <tr>
              <th style={{ ...th, ...stickyCell, textAlign: "left" }}>Aid station</th>
              <th style={th}>Mile</th>
              <th style={th}>Vert</th>
              {compare
                ? all.map((b) => <th key={b.scenario.id} style={{ ...th, color: b.scenario.color }}>{b.scenario.id}h</th>)
                : <th style={th}>Arrive</th>}
              <th style={{ ...th, textAlign: "center" }}>Pacer</th>
              <th style={{ ...th, textAlign: "center" }}>Crew</th>
            </tr>
          </thead>
          <tbody>
            {built.splits.map((s, i) => {
              const st = STATIONS.find((x) => x.name === s.station);
              return (
                <tr key={s.station} style={{ background: i % 2 ? "transparent" : "#ffffff04" }}>
                  <td style={{ ...td, ...stickyCell, textAlign: "left", maxWidth: 168, whiteSpace: "normal",
                               background: i % 2 ? C.panel : "#1a2027" }}>
                    <div style={{ fontWeight: 600 }}>{s.station}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                      {s.sleep && <Pill color={C.accent}>SLEEP</Pill>}
                      {s.drop && <Pill color={C.dim}>DROP</Pill>}
                      {st && st.gearCheck && <Pill color={C.warm}>GEAR</Pill>}
                      {s.verify && <Pill color={C.danger}>VERIFY 2027</Pill>}
                    </div>
                  </td>
                  <td style={td}>{s.mile.toFixed(1)}</td>
                  <td style={{ ...td, color: C.dim, fontSize: 11.5 }}>
                    <span style={{ color: s.gain >= 3000 ? C.warm : C.dim }}>+{s.gain.toLocaleString()}</span>
                    {" / "}<span style={{ color: s.loss >= 3000 ? C.warm : C.dim }}>-{s.loss.toLocaleString()}</span>
                  </td>
                  {compare
                    ? all.map((b) => {
                        const row = b.splits.find((r) => r.station === s.station);
                        return (
                          <td key={b.scenario.id} style={{ ...td, color: b.scenario.id === scenarioId ? C.text : C.dim,
                                                            fontWeight: b.scenario.id === scenarioId ? 700 : 400 }}>
                            {row ? row.clock : "—"}
                          </td>
                        );
                      })
                    : <td style={{ ...td, fontWeight: 700 }}>{s.clock}</td>}
                  <td style={{ ...td, textAlign: "center" }}>
                    {s.mandated ? <Pill color={C.danger}>SOLO</Pill>
                      : s.pacer === "A" ? <Pill color={C.A}>A</Pill>
                      : s.pacer === "B" ? <Pill color={C.B}>B</Pill>
                      : <Pill color={C.warm}>solo</Pill>}
                  </td>
                  <td style={{ ...td, textAlign: "center", color: s.crew ? C.accent : C.faint }}>
                    {s.crew ? (s.swap ? "swap" : "yes") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.6 }}>
        <b style={{ color: C.dim }}>How these times are derived.</b> Block boundaries, block durations and the
        96-hour clock come from the race execution plan. Where one block spans several aid stations, its hours are
        distributed across them by an effort score — flat miles plus 2.0 per 1,000 ft climbed and 0.5 per 1,000 ft
        descended. Block totals and the finish time are therefore exact; the intermediate station times are modelled.
        The 110-hour column is modelled end to end and exists here for the first time.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Pacers
// ---------------------------------------------------------------------------
function PacerView({ built, state, setState }) {
  const names = state.pacerNames || {};
  const setName = (k, v) => setState({ ...state, pacerNames: { ...names, [k]: v } });

  return (
    <div>
      <SectionTitle note="Two pacers, 110.7 of the 253 miles between them. Nobody covers more than about 35 miles in a calendar day, and each gets a full rest cycle between shifts.">
        Pacer assignments
      </SectionTitle>

      <Card style={{ marginBottom: 12 }}>
        <PacerStrip splits={built.splits} />
      </Card>

      {["A", "B"].map((k) => {
        const p = PACERS[k];
        return (
          <Card key={k} style={{ marginBottom: 12, borderLeft: `3px solid ${p.color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: p.color }}>{p.label}</div>
                <div style={{ fontSize: 12.5, color: C.dim }}>{p.role} · {p.totalMiles} miles total</div>
              </div>
              <input value={names[k] || ""} onChange={(e) => setName(k, e.target.value)}
                     placeholder={`Who is ${p.label}?`}
                     style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8,
                              padding: "8px 11px", fontSize: 13, width: 180, outline: "none" }} />
            </div>
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {p.shifts.map((sh) => {
                const rows = built.splits.filter((r) => r.pacer === k);
                const startRow = built.splits.find((r) => r.station === sh.from);
                const endRow = rows.find((r) => r.station === sh.to);
                return (
                  <div key={sh.from} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 650, fontSize: 14 }}>{sh.from} → {sh.to}</div>
                      <div style={{ fontSize: 12.5, color: p.color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {sh.miles} mi
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4, fontFamily: mono }}>
                      on {startRow ? startRow.clock : "—"} → off {endRow ? endRow.clock : "—"}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.dim, marginTop: 7, lineHeight: 1.6 }}>{sh.why}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      <SectionTitle note="These are legality boundaries, not preferences. A pacer on a closed section is a disqualification.">
        Where a pacer is not allowed
      </SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {SOLO_MANDATED.map((s) => (
          <Card key={s.fromMile} style={{ borderLeft: `3px solid ${C.danger}`, padding: 13 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Mile {s.fromMile} → {s.toMile}
              <span style={{ color: C.dim, fontWeight: 400 }}> · {(s.toMile - s.fromMile).toFixed(1)} mi</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4 }}>{s.reason}</div>
          </Card>
        ))}
        <Card style={{ borderLeft: `3px solid ${C.warm}`, padding: 13 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Mile 132.5 → 158.8 · 26.3 mi</div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4 }}>
            <b style={{ color: C.warm }}>Pacers are legal here.</b> Run solo by choice: Deer Pass at mile 146.5 has
            no crew access in 2026, so there is nowhere to swap and a pacer would be committed to the whole 26.3 miles.
            If 2027 restores crew at Deer Pass, this splits into two shifts and the grid changes.
          </div>
        </Card>
      </div>

      <SectionTitle>If only one pacer materialises</SectionTitle>
      <Card>
        <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 10 }}>Cover in this order:</div>
        {SINGLE_PACER_FALLBACK.map((f, i) => (
          <div key={f} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0",
                                borderBottom: i < 2 ? `1px solid ${C.line}` : "none" }}>
            <span style={{ width: 20, height: 20, borderRadius: 10, background: C.accent + "22", color: C.accent,
                           display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ fontSize: 13.5 }}>{f}</span>
          </div>
        ))}
      </Card>

      <SectionTitle>Rules that protect everyone</SectionTitle>
      <Card>
        {PACER_RULES.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 9, padding: "7px 0", fontSize: 13, lineHeight: 1.6,
                                borderBottom: i < PACER_RULES.length - 1 ? `1px solid ${C.line}` : "none" }}>
            <span style={{ color: C.accent }}>→</span><span style={{ color: C.dim }}>{r}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Crew — Jackie's view
// ---------------------------------------------------------------------------
function CrewView({ built, state, setState }) {
  const drives = state.driveMin || {};
  const setDrive = (key, v) => setState({ ...state, driveMin: { ...drives, [key]: v } });

  const crewStops = built.splits.filter((s) => s.crew);
  const windows = crewStops.map((s, i) => {
    const next = crewStops[i + 1];
    if (!next) return { from: s, to: null, windowHrs: null };
    return { from: s, to: next, windowHrs: +(next.elapsed - s.elapsed).toFixed(2) };
  });

  return (
    <div>
      <SectionTitle note="Jackie's sequence. Eleven crew-accessible stations across four days, one crew vehicle per station.">
        Crew stops and drive windows
      </SectionTitle>

      <Card style={{ marginBottom: 12, borderLeft: `3px solid ${C.warm}` }}>
        <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.65 }}>
          <b style={{ color: C.warm }}>Drive times are not in the source data and are not guessed here.</b> The
          window column is real — it comes straight from the split table and tells you how much time exists between
          the runner leaving one crew point and reaching the next. Measure the actual drives during recon and type
          them in; anything you enter is saved on this device and turns the margin column live.
        </div>
      </Card>

      <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 12, background: C.panel }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
          <thead>
            <tr>
              {["Crew stop", "Mile", "Runner in", "Window", "Drive (min)", "Margin"].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 9px", fontSize: 10,
                                     letterSpacing: ".07em", color: C.faint, fontWeight: 700,
                                     borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {windows.map((w, i) => {
              const key = w.from.station;
              const dm = drives[key];
              const driveHrs = dm ? Number(dm) / 60 : null;
              const margin = w.windowHrs != null && driveHrs != null ? +(w.windowHrs - driveHrs).toFixed(2) : null;
              const tight = margin != null && margin < 1;
              return (
                <tr key={key} style={{ background: i % 2 ? "transparent" : "#ffffff04" }}>
                  <td style={{ padding: "8px 9px", fontSize: 13, borderBottom: `1px solid ${C.line}22` }}>
                    <div style={{ fontWeight: 600 }}>{w.from.station}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                      {w.from.sleep && <Pill color={C.accent}>{w.from.sleep}</Pill>}
                      {w.from.verify && <Pill color={C.danger}>VERIFY</Pill>}
                    </div>
                  </td>
                  {[w.from.mile.toFixed(1), w.from.clock].map((v, j) => (
                    <td key={j} style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right",
                                         borderBottom: `1px solid ${C.line}22`, fontVariantNumeric: "tabular-nums",
                                         whiteSpace: "nowrap" }}>{v}</td>
                  ))}
                  <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right", borderBottom: `1px solid ${C.line}22`,
                               fontVariantNumeric: "tabular-nums" }}>
                    {w.windowHrs != null ? `${w.windowHrs} h` : <span style={{ color: C.faint }}>last</span>}
                  </td>
                  <td style={{ padding: "6px 9px", textAlign: "right", borderBottom: `1px solid ${C.line}22` }}>
                    {w.to ? (
                      <input value={dm || ""} onChange={(e) => setDrive(key, e.target.value.replace(/[^\d]/g, ""))}
                             placeholder="—" inputMode="numeric"
                             style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 7,
                                      padding: "5px 7px", fontSize: 12.5, width: 58, textAlign: "right", outline: "none",
                                      fontFamily: mono }} />
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right", borderBottom: `1px solid ${C.line}22`,
                               fontVariantNumeric: "tabular-nums", color: margin == null ? C.faint : tight ? C.danger : C.good,
                               fontWeight: margin == null ? 400 : 700 }}>
                    {margin == null ? "—" : `${margin} h`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SectionTitle note={GATE_RATIONALE}>Decision gates</SectionTitle>
      <div style={{ display: "grid", gap: 10 }}>
        {GATES.map((g) => {
          const row = built.splits.find((s) => s.station === g.station);
          return (
            <Card key={g.station} style={{ borderLeft: `3px solid ${g.external ? C.danger : C.warm}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{g.station}<span style={{ color: C.dim, fontWeight: 400 }}> · mile {g.mile}</span></div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {row && <span style={{ fontSize: 12, color: C.dim, fontFamily: mono }}>target {row.clock}</span>}
                  <Pill color={g.external ? C.danger : C.warm}>{g.owner} decides</Pill>
                </div>
              </div>
              <div style={{ fontSize: 13.5, marginTop: 9, lineHeight: 1.6 }}>{g.rule}</div>
              <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>{g.why}</div>
            </Card>
          );
        })}
      </div>

      <SectionTitle>Sleep plan</SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {built.blocks.filter((b) => b.type === "SLEEP").map((b) => (
          <Card key={b.n} style={{ padding: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{b.at}</div>
              <div style={{ fontSize: 12.5, fontFamily: mono, color: C.accent }}>
                {b.startClock} → {b.endClock} · {b.sleepHrs} hr sleep
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5 }}>
              {b.facility}{b.detail ? ` — ${b.detail}` : ""}
            </div>
          </Card>
        ))}
        <Card style={{ padding: 13, borderLeft: `3px solid ${C.danger}` }}>
          <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>
            <b style={{ color: C.danger }}>Treat hallucinations and microsleeps as safety alerts, not toughness moments.</b>
            {" "}Sleep by design, not by collapse. When the runner cannot make that call, Jackie makes it.
          </div>
        </Card>
      </div>

      <SectionTitle note="Required and cold-weather gear is checked at these stations. Missing kit is a stop, not a warning.">
        Gear checks
      </SectionTitle>
      <Card>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATIONS.filter((s) => s.gearCheck).map((s) => (
            <div key={s.name} style={{ background: C.panel2, border: `1px solid ${C.warm}44`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>
              <b>{s.name}</b> <span style={{ color: C.dim }}>· {s.mile}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 11, lineHeight: 1.6 }}>
          Fort Tuthill at mile 210.6 adds a <b style={{ color: C.text }}>mental status evaluation</b> on top of the
          gear check. That is the input to Jackie's Elden go/no-go.
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Blocks — the 24-block timeline
// ---------------------------------------------------------------------------
function Timeline({ built }) {
  return (
    <div>
      <SectionTitle note="The plan as the runner and crew will actually reference it. Block numbers are stable across all three scenarios, so 'we're behind on Block 19' means the same thing whichever table is live.">
        24-block timeline
      </SectionTitle>
      <div style={{ display: "grid", gap: 7 }}>
        {built.blocks.map((b) => {
          const isRun = b.type === "RUN";
          const isSleep = b.type === "SLEEP";
          const accent = isSleep ? C.accent : b.type === "HANDOFF" ? C.dim
            : b.mandated ? C.danger : b.pacer === "A" ? C.A : b.pacer === "B" ? C.B : C.warm;
          return (
            <div key={b.n} style={{
              background: isRun ? C.panel : C.panel2, border: `1px solid ${C.line}`,
              borderLeft: `3px solid ${accent}`, borderRadius: 9, padding: "11px 13px",
              opacity: b.type === "HANDOFF" ? 0.85 : 1,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontFamily: mono, color: C.faint, minWidth: 22 }}>{b.n}</span>
                <span style={{ fontWeight: 650, fontSize: 13.5, flex: "1 1 200px" }}>{b.label}</span>
                {isRun && <Pill color={accent}>{b.mandated ? "SOLO — REQUIRED" : b.pacer === "solo" ? "solo by choice" : `Pacer ${b.pacer}`}</Pill>}
                {isSleep && <Pill color={C.accent}>{b.sleepHrs} hr sleep</Pill>}
                {b.changed && b.type !== "HANDOFF" && <Pill color={built.scenario.color}>adjusted</Pill>}
              </div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 5, fontFamily: mono }}>
                {b.startClock} → {b.endClock} · {b.hrs} h
                {isRun && ` · ${b.miles} mi · ${b.mph} mph`}
              </div>
              {b.detail && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>{b.detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Verify — what must be re-checked against the 2027 manual
// ---------------------------------------------------------------------------
function Verify() {
  return (
    <div>
      <SectionTitle note="Everything in this app is 2026 official Aravaipa data. Here is what changes the plan if it moves.">
        Before this reaches anyone
      </SectionTitle>
      <DataWarning />

      <SectionTitle>Flagged in the station table</SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {VERIFY_FLAGS.map((s) => (
          <Card key={s.name} style={{ borderLeft: `3px solid ${C.danger}`, padding: 13 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name} <span style={{ color: C.dim, fontWeight: 400 }}>· mile {s.mile}</span></div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5, lineHeight: 1.6 }}>
              Unverified for 2027: <b style={{ color: C.text }}>{s.verify.join(", ")}</b>.
              {" "}Because the Walnut Canyon swap cannot be relied on, Block 22 is planned as one unbroken 23.1-mile
              shift for Pacer B. If 2027 confirms crew access, that splits in two and B's longest shift drops to 16.2 miles.
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Open items carried from the handoff</SectionTitle>
      <div style={{ display: "grid", gap: 7 }}>
        {OPEN_ITEMS.map((o, i) => (
          <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`,
                                borderLeft: `3px solid ${o.critical ? C.danger : C.line}`,
                                borderRadius: 9, padding: "11px 13px", display: "flex", gap: 10,
                                justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, lineHeight: 1.55, flex: "1 1 240px" }}>{o.item}</span>
            <Pill color={o.critical ? C.danger : C.dim}>{o.critical ? "BLOCKS CREW HANDOFF" : o.owner === "—" ? "to build" : o.owner}</Pill>
          </div>
        ))}
      </div>

      <SectionTitle>Course table checksum</SectionTitle>
      <Card>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: C.dim, fontFamily: mono }}>
          <div>segments summed: +{CHECKSUM.gain.toLocaleString()} / -{CHECKSUM.loss.toLocaleString()} / {CHECKSUM.miles} mi</div>
          <div>published:       +{RACE.gain.toLocaleString()} / -{RACE.loss.toLocaleString()} / {RACE.miles} mi</div>
          <div style={{ color: CHECKSUM.ok ? C.good : C.danger, fontWeight: 700, marginTop: 6 }}>
            {CHECKSUM.ok ? "✓ cross-foots exactly" : "✗ MISMATCH — fix the station table"}
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 10, lineHeight: 1.6 }}>
          Runs on every load. If someone edits the station table and fats a digit, this catches it before a
          wrong split reaches a pacer.
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "splits", label: "Splits" },
  { id: "pacers", label: "Pacers" },
  { id: "crew", label: "Crew" },
  { id: "blocks", label: "Blocks" },
  { id: "verify", label: "Verify" },
];

function App() {
  const [tab, setTab] = useState("overview");
  const [scenarioId, setScenarioId] = useState("100");
  const [state, setState] = useState(loadState);
  useEffect(() => saveState(state), [state]);

  const built = useMemo(() => buildScenario(scenarioId), [scenarioId]);

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: font }}>
      <div style={{
        position: "sticky", top: 0, zIndex: 10, background: C.bg + "f2",
        backdropFilter: "blur(8px)", borderBottom: `1px solid ${C.line}`,
        paddingTop: "env(safe-area-inset-top)",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "10px 16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: ".2em", color: C.accent, fontWeight: 700 }}>COCODONA 250</div>
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}
                    style={{ background: C.panel, color: built.scenario.color, border: `1px solid ${C.line}`,
                             borderRadius: 8, padding: "5px 8px", fontSize: 12, fontWeight: 700, outline: "none" }}>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id} style={{ color: C.text }}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 3, overflowX: "auto", marginTop: 8, paddingBottom: 1 }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: "none", border: "none", cursor: "pointer",
                color: tab === t.id ? C.accent : C.dim, fontSize: 13.5,
                fontWeight: tab === t.id ? 700 : 500, padding: "8px 11px",
                borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`, whiteSpace: "nowrap",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 16px calc(48px + env(safe-area-inset-bottom))" }}>
        {tab === "overview" && <Overview built={built} setTab={setTab} />}
        {tab === "splits" && <Splits scenarioId={scenarioId} setScenarioId={setScenarioId} built={built} />}
        {tab === "pacers" && <PacerView built={built} state={state} setState={setState} />}
        {tab === "crew" && <CrewView built={built} state={state} setState={setState} />}
        {tab === "blocks" && <Timeline built={built} />}
        {tab === "verify" && <Verify />}

        <div style={{ marginTop: 34, paddingTop: 14, borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: C.faint, lineHeight: 1.7 }}>
          Runner Alex · crew chief Jackie · 2 pacers. Works offline; nothing here is sent anywhere.
          Names, measured drive times and notes stay on this device.
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
