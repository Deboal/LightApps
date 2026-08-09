import React, { useState, useMemo, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  RACE, STATIONS, SEGMENTS, CHECKSUM, SOLO_MANDATED,
  SOLO_MANDATED_MILES, PACER_LEGAL_MILES,
} from "./course.js";
import {
  BLOCKS, SCENARIOS, buildScenario, PACERS, PACER_RULES,
  SINGLE_PACER_FALLBACK, GATES, GATE_RATIONALE, OPEN_ITEMS,
} from "./plan.js";
import {
  TRACE, TRACE_CAVEAT, CUTOFFS, cutoffFor, YEARS, FIELD_TOTALS,
  ALL_TIMES, percentileOf, timeAtPercentile,
} from "./field.js";
import { project, planMileAtElapsed, elapsedSinceStart, hm, driveLinks } from "./live.js";
import { C, display, font, mono, eyebrow, figures, marginColor } from "./theme.js";

// Cocodona 250 — crew and pacer brief.
//
// Self-contained on purpose: no auth, no network, no Supabase. Pacers open this
// on one bar of signal in Arizona backcountry, or from a file saved to the home
// screen with the radio off. localStorage holds the few things they change.
//
// The 3D terrain view is a separate app because it fetches terrain tiles and so
// needs a network — see the link on the Overview tab.

const LS = "cocodona.crew.v2";
const loadState = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
const saveState = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} };

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Pill({ children, color = C.dim, title }) {
  return (
    <span title={title} style={{
      display: "inline-block", fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em",
      textTransform: "uppercase", color, border: `1px solid ${color}66`,
      borderRadius: 2, padding: "2px 6px", whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Card({ children, style, edge }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.line}`, borderRadius: 3, padding: 16,
      borderLeft: edge ? `3px solid ${edge}` : `1px solid ${C.line}`, ...style,
    }}>{children}</div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ flex: "1 1 88px", minWidth: 88 }}>
      <div style={eyebrow}>{label}</div>
      <div style={{ fontFamily: display, fontSize: 23, fontWeight: 700, color: color || C.text,
                    lineHeight: 1.2, letterSpacing: "-.01em", ...figures }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim }}>{sub}</div>}
    </div>
  );
}

// Thick-over-thin, the handbill convention. Reads as a deliberate divider.
function Rule({ style }) {
  return (
    <div style={{ margin: "0 0 14px", ...style }}>
      <div style={{ borderTop: `2px solid ${C.rule}` }} />
      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 2 }} />
    </div>
  );
}

function SectionTitle({ children, note }) {
  return (
    <div style={{ margin: "28px 0 12px" }}>
      <Rule style={{ margin: "0 0 9px" }} />
      <h2 style={{ margin: 0, fontFamily: display, fontSize: 17, fontWeight: 700,
                   letterSpacing: "-.01em", color: C.text }}>{children}</h2>
      {note && <div style={{ fontSize: 12, color: C.dim, marginTop: 5, lineHeight: 1.6 }}>{note}</div>}
    </div>
  );
}

function DataWarning() {
  return (
    <div style={{ background: "#231a10", border: `1px solid ${C.warm}55`, borderRadius: 3,
                  padding: "11px 13px", fontSize: 12, color: "#efd9ab", lineHeight: 1.6 }}>
      <b style={{ color: C.warm }}>2026 data.</b> The 2027 runner manual has not published. Aid stations,
      cutoffs, crew access and the three owl-habitat pacer closures must be re-verified before any of this
      is treated as settled. A closure that moves shifts the entire hand-off grid.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elevation profile, drawn from the real GPX trace
// ---------------------------------------------------------------------------
function Profile() {
  const W = 1000, H = 210, PAD = { l: 40, r: 12, t: 18, b: 24 };
  const elevs = TRACE.map((p) => p[1]);
  const lo = Math.floor(Math.min(...elevs) / 1000) * 1000;
  const hi = Math.ceil(Math.max(...elevs) / 1000) * 1000;

  // The trace runs 248.5 mi against the official 252.9, so both axes are
  // normalised to a fraction of their own total. Station marks then land in the
  // right proportional place rather than drifting 4 miles adrift by the finish.
  const xf = (frac) => PAD.l + frac * (W - PAD.l - PAD.r);
  const xTrace = (mile) => xf(mile / TRACE_CAVEAT.traceMiles);
  const xOff = (mile) => xf(mile / RACE.miles);
  const y = (e) => PAD.t + (1 - (e - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  const line = TRACE.map((p, i) => `${i ? "L" : "M"}${xTrace(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const area = `${line} L${xTrace(TRACE_CAVEAT.traceMiles).toFixed(1)},${y(lo)} L${xf(0)},${y(lo)} Z`;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 520, display: "block" }}
           role="img" aria-label="Course elevation profile from the GPX trace">
        <defs>
          <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.accent} stopOpacity="0.38" />
            <stop offset="100%" stopColor={C.accent} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[lo, (lo + hi) / 2, hi].map((e) => (
          <g key={e}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(e)} y2={y(e)} stroke={C.line} />
            <text x={PAD.l - 6} y={y(e) + 3.5} textAnchor="end" fill={C.faint} fontSize="10" fontFamily={mono}>
              {(e / 1000).toFixed(0)}k
            </text>
          </g>
        ))}
        {SOLO_MANDATED.map((s) => (
          <rect key={s.fromMile} x={xOff(s.fromMile)} y={PAD.t}
                width={xOff(s.toMile) - xOff(s.fromMile)} height={H - PAD.t - PAD.b}
                fill={C.danger} opacity="0.13" />
        ))}
        <path d={area} fill="url(#prof)" />
        <path d={line} fill="none" stroke={C.accent} strokeWidth="1.6" strokeLinejoin="round" />
        {STATIONS.filter((s) => s.crew).map((s) => (
          <line key={s.name} x1={xOff(s.mile)} x2={xOff(s.mile)} y1={H - PAD.b} y2={H - PAD.b + 5}
                stroke={C.accent} strokeWidth="1.4" />
        ))}
        <g>
          <line x1={xOff(243)} x2={xOff(243)} y1={PAD.t} y2={y(9000)} stroke={C.danger}
                strokeWidth="1" strokeDasharray="3 3" />
          <text x={xOff(243)} y={PAD.t - 4} textAnchor="middle" fill={C.danger} fontSize="9.5" fontFamily={mono}>
            Mt. Elden 9,000
          </text>
        </g>
        {[0, 50, 100, 150, 200, 250].map((m) => (
          <text key={m} x={xOff(m)} y={H - 7} textAnchor="middle" fill={C.faint} fontSize="10" fontFamily={mono}>{m}</text>
        ))}
      </svg>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 7, lineHeight: 1.6 }}>
        Real GPX trace, {TRACE.length} points — shape only. Summed from this trace the climbing comes to{" "}
        {TRACE_CAVEAT.traceGain.toLocaleString()} ft over {TRACE_CAVEAT.traceMiles} mi, against the official{" "}
        {TRACE_CAVEAT.officialGain.toLocaleString()} ft over {TRACE_CAVEAT.officialMiles} mi. The gap is
        downsampling smoothing out the rollers, not a correction. Every planning number comes from the
        official table. Ticks below the axis are crew-accessible stations.
      </div>
    </div>
  );
}

function PacerStrip({ splits }) {
  const W = 1000, H = 54;
  const x = (m) => (m / RACE.miles) * W;
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 460, display: "block" }}
             role="img" aria-label="Pacer coverage across the course">
          {splits.map((s) => {
            const col = s.mandated ? C.danger : s.pacer === "A" ? C.A : s.pacer === "B" ? C.B : C.warm;
            const x0 = x(s.mile - s.segMiles);
            return (
              <g key={s.mile}>
                <rect x={x0} y={8} width={Math.max(x(s.mile) - x0, 0.8)} height={24}
                      fill={col} opacity={s.mandated ? 0.45 : 0.9} />
                {s.mandated && (
                  <rect x={x0} y={8} width={Math.max(x(s.mile) - x0, 0.8)} height={24}
                        fill="none" stroke={C.danger} strokeWidth="1.3" strokeDasharray="4 3" />
                )}
              </g>
            );
          })}
          {STATIONS.filter((s) => s.swap).map((s) => (
            <g key={s.name}>
              <line x1={x(s.mile)} x2={x(s.mile)} y1={3} y2={38} stroke={C.text} strokeWidth="1.3" />
              <circle cx={x(s.mile)} cy={3} r="2.2" fill={C.text} />
            </g>
          ))}
          {[0, 50, 100, 150, 200, 250].map((m) => (
            <text key={m} x={x(m)} y={H - 3} textAnchor="middle" fill={C.faint} fontSize="10" fontFamily={mono}>{m}</text>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11, color: C.dim }}>
        {[[C.danger, "Solo — required"], [C.warm, "Solo by choice"], [C.A, "Pacer A"], [C.B, "Pacer B"]].map(([c, l]) => (
          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 9, background: c, display: "inline-block" }} />{l}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 1.5, height: 12, background: C.text, display: "inline-block" }} /> swap point
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function Overview({ built }) {
  const { totals } = built;
  const daysOut = Math.max(0, Math.round((new Date(RACE.start) - new Date()) / 86400e3));
  const pct = percentileOf(totals.elapsed);

  return (
    <div>
      <Card style={{ background: `linear-gradient(165deg,#251c12,${C.panel})`, padding: 20 }}>
        <div style={{ ...eyebrow, color: C.accent }}>Monday May 3, 2027 · 5:00 AM</div>
        <h1 style={{ fontFamily: display, margin: "8px 0 3px", fontSize: 30, fontWeight: 700,
                     letterSpacing: "-.02em", lineHeight: 1.05 }}>Cocodona 250</h1>
        <div style={{ color: C.dim, fontSize: 13.5 }}>{RACE.from} → {RACE.to}</div>
        <Rule style={{ margin: "16px 0 14px" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
          <Stat label="Distance" value={RACE.miles} sub="miles" />
          <Stat label="Climbing" value={`${(RACE.gain / 1000).toFixed(1)}k`} sub="feet up" color={C.warm} />
          <Stat label="Descent" value={`${(RACE.loss / 1000).toFixed(1)}k`} sub="feet down" color={C.warm} />
          <Stat label="Cutoff" value={RACE.cutoffHours} sub="hours" />
          <Stat label="Days out" value={daysOut} sub="from today" color={C.accent} />
        </div>
      </Card>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <Card style={{ flex: "1 1 250px" }} edge={built.scenario.color}>
          <div style={eyebrow}>The plan</div>
          <div style={{ fontFamily: display, fontSize: 19, fontWeight: 700, marginTop: 4,
                        color: built.scenario.color }}>{built.scenario.label}</div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 7, lineHeight: 1.65 }}>
            Finish <b style={{ color: C.text }}>{totals.finishClock}</b> at {totals.elapsed} hours,
            leaving <b style={{ color: C.good }}>{totals.cutoffMargin} hours</b> against the {RACE.cutoffHours}-hour limit.
            {pct != null && <> That would be faster than <b style={{ color: C.text }}>{100 - pct}%</b> of the
            {" "}{FIELD_TOTALS.finishers} people who have finished this race.</>}
          </div>
        </Card>
        <Card style={{ flex: "1 1 250px" }} edge={C.accent}>
          <div style={eyebrow}>Sleep, total</div>
          <div style={{ fontFamily: display, fontSize: 19, fontWeight: 700, marginTop: 4 }}>{totals.sleepHrs} hr</div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 7, lineHeight: 1.65 }}>
            Across {built.blocks.filter((b) => b.type === "SLEEP").length} planned stops
            in {totals.restHrs} hours horizontal. Over four days and nights.
          </div>
        </Card>
      </div>

      <SectionTitle note="From the course GPX. Crew-accessible stations are ticked below the axis; the shaded bands are where a pacer is not permitted.">
        The shape of it
      </SectionTitle>
      <Card><Profile /></Card>

      <SectionTitle note={`${RACE.miles} miles of trail, and a pacer is legal on only ${PACER_LEGAL_MILES} of them. Of those, ${(PACERS.A.totalMiles + PACERS.B.totalMiles).toFixed(1)} are actually covered.`}>
        Where pacers can and cannot go
      </SectionTitle>
      <Card>
        <PacerStrip splits={built.splits} />
        <div style={{ marginTop: 15, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Stat label="Solo, required" value={SOLO_MANDATED_MILES} sub="miles by rule" color={C.danger} />
          <Stat label="Pacer A" value={PACERS.A.totalMiles} sub="miles, 2 pulls" color={C.A} />
          <Stat label="Pacer B" value={PACERS.B.totalMiles} sub="miles, 4 shifts" color={C.B} />
          <Stat label="Solo by choice" value="26.3" sub="Dead Horse → Sedona" color={C.warm} />
        </div>
      </Card>

      <SectionTitle>The 3D terrain view</SectionTitle>
      <Card edge={C.accent}>
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.7 }}>
          The terrain model and six-year analytics live in their own page, because it pulls satellite and
          elevation tiles as you fly the course and so <b style={{ color: C.text }}>needs a signal</b>. That is
          why it is not folded into this brief, which is built to work with the radio off.
        </div>
        <a href="../cocodona-3d/" style={{
          display: "inline-block", marginTop: 12, background: C.accent, color: "#1a1006",
          textDecoration: "none", padding: "10px 16px", borderRadius: 3, fontWeight: 700, fontSize: 13.5,
        }}>Open the 3D terrain →</a>
      </Card>

      <SectionTitle>The four hardest things about this race</SectionTitle>
      <div style={{ display: "grid", gap: 10 }}>
        <Hard n="1" title="Day 1 asks the fastest pace against 44% of the climbing"
              body="Start to Whiskey Row is 75.7 miles with +17,215 ft, and the plan wants 3.6 mph through it — the quickest average of the whole race. It works only because the Bradshaw climbing is front-loaded into the first 33 miles and the back half is more runnable than the totals suggest. The failure mode is treating that as licence to race the first 40." />
        <Hard n="2" title="The first 83 miles are solo, and so are the last 19" color={C.danger}
              body="No pacer is legal until Watson Lake at mile 82.8 — a third of the race, alone. Then on the fourth night Wildcat Hill to the finish closes again, which means Mt. Elden, +3,386 ft to 9,000 ft then 2,000 ft down over roughly 40 switchbacks, is climbed alone at the deepest point of sleep deprivation." />
        <Hard n="3" title="Descent, not climbing, is what ends 250s"
              body="33,884 ft of it. Jerome alone drops 4,428 ft in 17 miles. Quad damage accumulates and does not recover mid-race, and it is the mechanical limiter the training plan spends a whole block arming against." />
        <Hard n="4" title="Desert heat for 36 hours, then 25°F on a 9,000 ft peak"
              body="Exposed low-desert start in early May, a 7,000 ft finish, and Munds Park's unheated tents at upper-30s in between. The kit has to cover both ends and the drop bags have to be right, because the layers needed on Elden are packed 40 hours earlier." />
      </div>

      <SectionTitle>Standing caveat</SectionTitle>
      <DataWarning />
      {!CHECKSUM.ok && (
        <Card style={{ marginTop: 10, background: "#2a1512" }} edge={C.danger}>
          <b style={{ color: C.danger }}>Course table does not cross-foot.</b>
          <div style={{ fontSize: 12.5, color: "#f0bdb0", marginTop: 5 }}>
            Transcribed totals (+{CHECKSUM.gain} / -{CHECKSUM.loss} / {CHECKSUM.miles} mi) disagree with the
            published figures. Fix the station table before trusting any split.
          </div>
        </Card>
      )}
    </div>
  );
}

function Hard({ n, title, body, color }) {
  return (
    <Card edge={color || C.accent}>
      <div style={{ display: "flex", gap: 13 }}>
        <div style={{ fontFamily: display, fontSize: 26, fontWeight: 700, color: color || C.accent,
                      opacity: 0.55, lineHeight: 1 }}>{n}</div>
        <div>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>
          <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.7 }}>{body}</div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Splits, now with the official cutoffs and the margin against them
// ---------------------------------------------------------------------------
function Splits({ scenarioId, setScenarioId, built }) {
  const all = useMemo(() => SCENARIOS.map((s) => buildScenario(s.id)), []);
  const wide = typeof window !== "undefined" && window.innerWidth >= 760;
  const [compare, setCompare] = useState(wide);

  const th = { textAlign: "right", padding: "8px 8px", ...eyebrow, fontSize: 9.5,
               borderBottom: `2px solid ${C.rule}`, whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "8px 8px", fontSize: 12.5,
               borderBottom: `1px solid ${C.line}55`, ...figures, whiteSpace: "nowrap" };
  const sticky = { position: "sticky", left: 0, zIndex: 1, boxShadow: `1px 0 0 ${C.line}` };

  return (
    <div>
      <SectionTitle note="Arrival at every aid station under all three scenarios, against the official cutoff. The margin column is the number that decides whether a bad patch is survivable.">
        Split table and cutoffs
      </SectionTitle>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => setScenarioId(s.id)} style={{
            background: scenarioId === s.id ? s.color + "22" : C.panel,
            border: `1px solid ${scenarioId === s.id ? s.color : C.line}`,
            color: scenarioId === s.id ? s.color : C.dim, borderRadius: 3,
            padding: "9px 13px", cursor: "pointer", fontSize: 13, fontWeight: 700,
            textAlign: "left", fontFamily: display,
          }}>
            {s.label}
            <div style={{ ...eyebrow, fontSize: 9, marginTop: 2, color: "inherit", opacity: 0.75 }}>{s.tag}</div>
          </button>
        ))}
      </div>

      <Card edge={built.scenario.color}>
        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: C.dim }}>{built.scenario.blurb}</div>
        {built.scenario.note && (
          <div style={{ fontSize: 12, lineHeight: 1.65, color: C.faint, marginTop: 9, paddingTop: 9,
                        borderTop: `1px solid ${C.line}` }}>{built.scenario.note}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 15 }}>
          <Stat label="Finish" value={built.totals.finishClock} color={built.scenario.color} />
          <Stat label="Elapsed" value={`${built.totals.elapsed}h`} />
          <Stat label="Buffer" value={`${built.totals.cutoffMargin}h`} sub="to the limit" color={C.good} />
          <Stat label="Sleep" value={`${built.totals.sleepHrs}h`} />
          <Stat label="Field" value={`${100 - percentileOf(built.totals.elapsed)}%`} sub="finishers slower" />
        </div>
      </Card>

      <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0 8px",
                      fontSize: 13, color: C.dim, cursor: "pointer" }}>
        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
        Compare all three scenarios
      </label>

      <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 3, background: C.panel }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: compare ? 760 : 600 }}>
          <thead>
            <tr>
              <th style={{ ...th, ...sticky, background: C.panel, textAlign: "left" }}>Aid station</th>
              <th style={th}>Mile</th>
              {compare
                ? all.map((b) => <th key={b.scenario.id} style={{ ...th, color: b.scenario.color }}>{b.scenario.id}h</th>)
                : <th style={th}>Arrive</th>}
              <th style={th}>Cutoff</th>
              <th style={th}>Margin</th>
              <th style={{ ...th, textAlign: "center" }}>Pacer</th>
            </tr>
          </thead>
          <tbody>
            {built.splits.map((s, i) => {
              const st = STATIONS.find((x) => x.name === s.station);
              const c = cutoffFor(s.station);
              const margin = c ? +(c.cutoffElapsed - s.elapsed).toFixed(1) : null;
              const zebra = i % 2 ? C.panel : "#221a12";
              return (
                <tr key={s.station}>
                  <td style={{ ...td, ...sticky, background: zebra, textAlign: "left", maxWidth: 172,
                               whiteSpace: "normal", fontFamily: font }}>
                    <div style={{ fontWeight: 650 }}>{s.station}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                      {s.sleep && <Pill color={C.accent}>Sleep</Pill>}
                      {s.drop && <Pill color={C.dim}>Drop</Pill>}
                      {st && st.gearCheck && <Pill color={C.warm}>Gear</Pill>}
                      {s.verify && <Pill color={C.danger}>Verify 2027</Pill>}
                    </div>
                  </td>
                  <td style={{ ...td, background: zebra }}>{s.mile.toFixed(1)}</td>
                  {compare
                    ? all.map((b) => {
                        const r = b.splits.find((x) => x.station === s.station);
                        return (
                          <td key={b.scenario.id} style={{ ...td, background: zebra,
                                color: b.scenario.id === scenarioId ? C.text : C.dim,
                                fontWeight: b.scenario.id === scenarioId ? 700 : 400 }}>
                            {r ? r.clock : "—"}
                          </td>
                        );
                      })
                    : <td style={{ ...td, background: zebra, fontWeight: 700 }}>{s.clock}</td>}
                  <td style={{ ...td, background: zebra, color: C.dim, fontSize: 11.5 }}>{c ? c.cut : "—"}</td>
                  <td style={{ ...td, background: zebra, color: marginColor(margin), fontWeight: 700 }}>
                    {margin == null ? "—" : `+${margin}h`}
                  </td>
                  <td style={{ ...td, background: zebra, textAlign: "center" }}>
                    {s.mandated ? <Pill color={C.danger}>Solo</Pill>
                      : s.pacer === "A" ? <Pill color={C.A}>A</Pill>
                      : s.pacer === "B" ? <Pill color={C.B}>B</Pill>
                      : <Pill color={C.warm}>solo</Pill>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Card style={{ marginTop: 12 }} edge={C.warm}>
        <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.7 }}>
          <b style={{ color: C.warm }}>The tightest cutoff on the course is the first one.</b> Cottonwood Creek
          at mile 7.4 leaves under three hours of margin even on the primary plan, and margin only grows from
          there. The early cutoffs are the aggressive ones — a slow start is the thing that ends a race on the
          clock rather than on the legs.
        </div>
      </Card>

      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 12, lineHeight: 1.7 }}>
        <b style={{ color: C.dim }}>How these times are derived.</b> Block boundaries, block durations and the
        96-hour clock come from the race execution plan. Where a block spans several aid stations its hours are
        distributed by an effort score — flat miles plus 2.0 per 1,000 ft climbed and 0.5 per 1,000 ft descended
        — so block totals and the finish are exact while intermediate station times are modelled. The 110-hour
        column is modelled end to end. Cutoffs are official 2026.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live — where you are, and when you reach what's next
// ---------------------------------------------------------------------------
function Live({ built, state, setState }) {
  const [useClock, setUseClock] = useState(false);
  const [manualElapsed, setManualElapsed] = useState(state.liveElapsed ?? "");
  const [mile, setMile] = useState(state.liveMile ?? "");

  useEffect(() => { setState({ ...state, liveElapsed: manualElapsed, liveMile: mile }); },
            [manualElapsed, mile]);

  const clockElapsed = elapsedSinceStart();
  // Nothing typed and the clock off is a real state, not zero hours elapsed. Left
  // as 0 the panel below answered "plan expects you at mile 0" as though that
  // were a finding, which is the kind of confident nothing this app is meant to
  // avoid. The table still renders — as the plan, clearly labelled as such.
  const started = useClock || manualElapsed !== "";
  const elapsed = useClock ? Math.max(0, clockElapsed)
                           : (manualElapsed === "" ? 0 : Math.max(0, Number(manualElapsed) || 0));
  const actualMile = mile === "" ? null : Math.max(0, Math.min(RACE.miles, Number(mile) || 0));

  const p = useMemo(() => project({
    splits: built.splits, elapsedHrs: elapsed, actualMile, cutoffFor, gateHours: 3,
  }), [built, elapsed, actualMile]);

  const input = {
    background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 3,
    padding: "10px 12px", fontSize: 16, width: "100%", outline: "none", ...figures,
  };

  return (
    <div>
      <SectionTitle note="Enter hours since the gun and, if you know it, the current mile. Everything below reprojects from there.">
        Where are we
      </SectionTitle>

      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <label>
            <div style={{ ...eyebrow, marginBottom: 5 }}>Hours since 5:00 AM Monday</div>
            <input style={input} inputMode="decimal" placeholder="26.5" value={manualElapsed}
                   disabled={useClock} onChange={(e) => setManualElapsed(e.target.value)} />
          </label>
          <label>
            <div style={{ ...eyebrow, marginBottom: 5 }}>Current mile (optional)</div>
            <input style={input} inputMode="decimal" placeholder="—" value={mile}
                   onChange={(e) => setMile(e.target.value)} />
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12,
                        fontSize: 12.5, color: C.dim, cursor: "pointer" }}>
          <input type="checkbox" checked={useClock} onChange={(e) => setUseClock(e.target.checked)} />
          Use the real clock ({clockElapsed < 0
            ? `race starts in ${Math.abs(Math.round(clockElapsed))} h`
            : `${hm(clockElapsed)} elapsed`})
        </label>
      </Card>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <Card style={{ flex: "1 1 200px" }}>
          <div style={eyebrow}>Plan expects you at</div>
          {started ? (
            <>
              <div style={{ fontFamily: display, fontSize: 24, fontWeight: 700, marginTop: 3, ...figures }}>
                mile {p.planMileNow}
              </div>
              <div style={{ fontSize: 11.5, color: C.dim }}>after {hm(elapsed)}</div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: display, fontSize: 24, fontWeight: 700, marginTop: 3, color: C.faint }}>—</div>
              <div style={{ fontSize: 11.5, color: C.dim }}>enter hours since the gun</div>
            </>
          )}
        </Card>
        <Card style={{ flex: "1 1 200px" }}
              edge={p.delta == null ? C.line : p.pastGate ? C.danger : p.behind ? C.warm : C.good}>
          <div style={eyebrow}>Against plan</div>
          {p.delta == null ? (
            <>
              <div style={{ fontFamily: display, fontSize: 24, fontWeight: 700, marginTop: 3, color: C.faint }}>—</div>
              <div style={{ fontSize: 11.5, color: C.dim }}>enter a mile to measure</div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: display, fontSize: 24, fontWeight: 700, marginTop: 3,
                            color: p.pastGate ? C.danger : p.behind ? C.warm : C.good, ...figures }}>
                {p.delta > 0 ? `${hm(p.delta)} down` : p.delta < 0 ? `${hm(-p.delta)} up` : "on plan"}
              </div>
              <div style={{ fontSize: 11.5, color: C.dim }}>
                {p.pastGate ? `past the ${p.gateHours}-hour gate` : `gate at ${p.gateHours} h`}
              </div>
            </>
          )}
        </Card>
        <Card style={{ flex: "1 1 200px" }}>
          <div style={eyebrow}>{p.delta == null ? "Finish, on plan" : "Projected finish"}</div>
          <div style={{ fontFamily: display, fontSize: 24, fontWeight: 700, marginTop: 3, ...figures }}>
            {p.projectedFinish == null ? "—" : `${p.projectedFinish}h`}
          </div>
          <div style={{ fontSize: 11.5, color: marginColor(p.cutoffMargin) }}>
            {p.cutoffMargin == null ? "—" : `${p.cutoffMargin}h inside the limit`}
          </div>
        </Card>
      </div>

      {p.pastGate && (
        <Card style={{ marginTop: 12, background: "#2a1512" }} edge={C.danger}>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15, color: C.danger }}>
            Decision gate: shift to the 110-hour table
          </div>
          <div style={{ fontSize: 13, color: "#f0bdb0", marginTop: 6, lineHeight: 1.7 }}>
            You are {hm(p.delta)} behind, past the pre-committed {p.gateHours}-hour trigger. The plan's rule is
            explicit: do not chase. Drop to the 110-hour splits with full sleep blocks restored. The buffer
            exists to be spent on problems, not defended by cutting sleep.
          </div>
        </Card>
      )}

      {p.tightest && (
        <Card style={{ marginTop: 12 }} edge={marginColor(p.tightest.margin)}>
          <div style={eyebrow}>Tightest point ahead</div>
          <div style={{ fontFamily: display, fontSize: 16, fontWeight: 700, marginTop: 3 }}>
            {p.tightest.station} <span style={{ color: C.dim, fontWeight: 400 }}>· mile {p.tightest.mile}</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5 }}>
            projected {hm(p.tightest.projectedElapsed)} against a {p.tightest.cut} cutoff —{" "}
            <b style={{ color: marginColor(p.tightest.margin) }}>{p.tightest.margin}h of room</b>
          </div>
        </Card>
      )}

      <SectionTitle note={p.delta == null
        ? "Nothing to project from yet, so this is the plan itself against the official cutoffs. Enter a current mile and every row reprojects."
        : "Projected by carrying your current offset forward unchanged. It does not re-forecast pace from one observation: over 250 miles a deficit at mile 60 says very little about mile 200."}>
        What's ahead
      </SectionTitle>
      {/* Four columns, not six. The plan time and the cutoff string ride as second
          lines inside the cells they qualify, because at 390 px a six-column table
          pushed Projected and Margin — the only two columns anyone opens this tab
          for — off the right edge into a scroll nobody discovers at 3 AM. */}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 3, background: C.panel, overflow: "hidden" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col /><col style={{ width: "16%" }} /><col style={{ width: "23%" }} /><col style={{ width: "23%" }} />
          </colgroup>
          <thead>
            <tr>
              {["Station", "Mile", p.delta == null ? "Plan" : "Proj.", "Margin"].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 9px",
                      ...eyebrow, fontSize: 9.5, borderBottom: `2px solid ${C.rule}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, i) => (
              <tr key={r.station} style={{ background: i % 2 ? C.panel : "#221a12" }}>
                <td style={{ padding: "8px 9px", fontSize: 12.5, borderBottom: `1px solid ${C.line}55`,
                             verticalAlign: "top" }}>
                  <span style={{ fontWeight: 600 }}>{r.station}</span>
                  {r.crew && <span style={{ marginLeft: 6 }}><Pill color={C.accent}>Crew</Pill></span>}
                </td>
                <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right", color: C.dim,
                             borderBottom: `1px solid ${C.line}55`, verticalAlign: "top", ...figures }}>
                  {r.mile.toFixed(1)}
                </td>
                <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right", fontWeight: 700,
                             borderBottom: `1px solid ${C.line}55`, verticalAlign: "top", ...figures }}>
                  {r.projectedElapsed}h
                  {p.delta != null && (
                    <div style={{ fontSize: 10.5, color: C.faint, fontWeight: 400 }}>plan {r.planElapsed}h</div>
                  )}
                </td>
                <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right", fontWeight: 700,
                             borderBottom: `1px solid ${C.line}55`, verticalAlign: "top", ...figures,
                             color: marginColor(r.margin) }}>
                  {r.margin == null ? "—" : `${r.margin}h`}
                  {r.cut && <div style={{ fontSize: 10.5, color: C.faint, fontWeight: 400 }}>cut {r.cut}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!p.rows.length && (
        <Card style={{ marginTop: 12 }}><div style={{ fontSize: 13, color: C.dim }}>Past the finish.</div></Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field — six years of results
// ---------------------------------------------------------------------------
function Field({ built }) {
  const W = 1000, H = 200, PAD = { l: 42, r: 12, t: 14, b: 26 };
  const lo = 50, hi = 130;
  const x = (h) => PAD.l + ((h - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  // Histogram in 2-hour bins across the whole six-year finisher set.
  const bins = {};
  for (const t of ALL_TIMES) { const b = Math.floor(t / 2) * 2; bins[b] = (bins[b] || 0) + 1; }
  const maxBin = Math.max(...Object.values(bins));
  const y = (n) => PAD.t + (1 - n / maxBin) * (H - PAD.t - PAD.b);
  const planned = built.totals.elapsed;

  return (
    <div>
      <SectionTitle note={`${FIELD_TOTALS.starters} starters and ${FIELD_TOTALS.finishers} finishers across six runnings, 2021 to 2026. Complete fields, not leaderboard extracts.`}>
        What happens to the field
      </SectionTitle>

      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
          <Stat label="Finish rate" value={`${FIELD_TOTALS.finishRate}%`} sub="six-year" color={C.good} />
          <Stat label="Did not finish" value={`${(100 - FIELD_TOTALS.finishRate).toFixed(1)}%`} sub={`${FIELD_TOTALS.starters - FIELD_TOTALS.finishers} people`} color={C.danger} />
          <Stat label="Median finish" value={`${timeAtPercentile(50).toFixed(1)}h`} />
          <Stat label="Fastest ever" value={`${ALL_TIMES[0].toFixed(1)}h`} color={C.accent} />
        </div>
      </Card>

      <SectionTitle note="Two-hour bins. The marker is where the current plan would land.">
        Finish times, all six years
      </SectionTitle>
      <Card>
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 500, display: "block" }}
               role="img" aria-label="Distribution of finish times">
            {Object.entries(bins).map(([b, n]) => {
              const bx = x(Number(b)), bw = x(Number(b) + 2) - bx;
              return <rect key={b} x={bx} y={y(n)} width={Math.max(bw - 1, 1)} height={H - PAD.b - y(n)}
                           fill={C.accent} opacity="0.65" />;
            })}
            <line x1={x(planned)} x2={x(planned)} y1={PAD.t - 4} y2={H - PAD.b}
                  stroke={built.scenario.color} strokeWidth="2" />
            <text x={x(planned)} y={PAD.t - 7} textAnchor="middle" fill={built.scenario.color}
                  fontSize="10.5" fontFamily={mono} fontWeight="700">
              plan {planned}h
            </text>
            <line x1={x(125)} x2={x(125)} y1={PAD.t} y2={H - PAD.b} stroke={C.danger}
                  strokeWidth="1.5" strokeDasharray="4 3" />
            <text x={x(125) - 4} y={H - PAD.b - 5} textAnchor="end" fill={C.danger}
                  fontSize="10" fontFamily={mono}>125h limit</text>
            {[60, 80, 100, 120].map((h) => (
              <text key={h} x={x(h)} y={H - 8} textAnchor="middle" fill={C.faint}
                    fontSize="10" fontFamily={mono}>{h}h</text>
            ))}
          </svg>
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 10, lineHeight: 1.7 }}>
          The plan at <b style={{ color: C.text }}>{planned} hours</b> sits at the{" "}
          {percentileOf(planned)}th percentile — faster than {100 - percentileOf(planned)}% of everyone who has
          finished. Note how the distribution stacks against the 125-hour limit: a large share of finishers
          arrive in the last few hours available, which is what a 68% finish rate looks like from the inside.
        </div>
      </Card>

      <SectionTitle>Year by year</SectionTitle>
      {/* DNF is dropped rather than scrolled: it is starters minus finishers, the
          six-year total already has its own card above, and keeping it here pushed
          Rate off the right edge at phone width. */}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 3, background: C.panel, overflow: "hidden" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "17%" }} /><col style={{ width: "20%" }} />
            <col style={{ width: "20%" }} /><col style={{ width: "19%" }} /><col style={{ width: "24%" }} />
          </colgroup>
          <thead>
            <tr>
              {["Year", "Starters", "Finishers", "Rate", "Median"].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 9px",
                      ...eyebrow, fontSize: 9.5, borderBottom: `2px solid ${C.rule}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {YEARS.map((yr, i) => {
              const med = yr.times.length ? yr.times[Math.floor(yr.times.length / 2)] : null;
              return (
                <tr key={yr.year} style={{ background: i % 2 ? C.panel : "#221a12" }}>
                  <td style={{ padding: "8px 9px", fontSize: 13, fontWeight: 700, fontFamily: display,
                               borderBottom: `1px solid ${C.line}55` }}>{yr.year}</td>
                  {[yr.start, yr.fin].map((v, j) => (
                    <td key={j} style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right",
                          borderBottom: `1px solid ${C.line}55`, ...figures, color: C.dim }}>{v}</td>
                  ))}
                  <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right",
                        borderBottom: `1px solid ${C.line}55`, ...figures,
                        color: yr.finishRate >= 70 ? C.good : C.warm, fontWeight: 700 }}>{yr.finishRate}%</td>
                  <td style={{ padding: "8px 9px", fontSize: 12.5, textAlign: "right",
                        borderBottom: `1px solid ${C.line}55`, ...figures, color: C.dim }}>
                    {med ? `${med.toFixed(1)}h` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.7 }}>
        The field has more than doubled since 2021 while the finish rate has held between 62% and 73%, so the
        race is not getting easier as it gets bigger. 2025 was the hardest year in the set at 65.9%.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pacers
// ---------------------------------------------------------------------------
function PacerView({ built, state, setState }) {
  const names = state.pacerNames || {};
  const setName = (k, v) => setState({ ...state, pacerNames: { ...names, [k]: v } });

  return (
    <div>
      <SectionTitle note="Two pacers, 110.7 of the 253 miles between them. Nobody covers more than about 35 miles in a calendar day, and each gets a full rest cycle between shifts.">
        Pacer assignments
      </SectionTitle>
      <Card style={{ marginBottom: 12 }}><PacerStrip splits={built.splits} /></Card>

      {["A", "B"].map((k) => {
        const p = PACERS[k];
        return (
          <Card key={k} style={{ marginBottom: 12 }} edge={p.color}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                          gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: display, fontSize: 18, fontWeight: 700, color: p.color }}>{p.label}</div>
                <div style={{ fontSize: 12.5, color: C.dim }}>{p.role} · {p.totalMiles} miles total</div>
              </div>
              <input value={names[k] || ""} onChange={(e) => setName(k, e.target.value)}
                     placeholder={`Who is ${p.label}?`}
                     style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, borderRadius: 3,
                              padding: "9px 11px", fontSize: 13, width: 180, outline: "none" }} />
            </div>
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {p.shifts.map((sh) => {
                const on = built.splits.find((r) => r.station === sh.from);
                const off = built.splits.find((r) => r.station === sh.to);
                return (
                  <div key={sh.from} style={{ background: C.panel2, border: `1px solid ${C.line}`,
                                              borderRadius: 3, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 14.5 }}>
                        {sh.from} → {sh.to}
                      </div>
                      <div style={{ fontSize: 12.5, color: p.color, fontWeight: 700, ...figures }}>{sh.miles} mi</div>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.faint, marginTop: 5, ...figures }}>
                      on {on ? on.clock : "—"} → off {off ? off.clock : "—"}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.dim, marginTop: 8, lineHeight: 1.7 }}>{sh.why}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      <SectionTitle note="Legality boundaries, not preferences. A pacer on a closed section is a disqualification.">
        Where a pacer is not allowed
      </SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {SOLO_MANDATED.map((s) => (
          <Card key={s.fromMile} edge={C.danger} style={{ padding: 13 }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 14.5 }}>
              Mile {s.fromMile} → {s.toMile}
              <span style={{ color: C.dim, fontWeight: 400 }}> · {(s.toMile - s.fromMile).toFixed(1)} mi</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5 }}>{s.reason}</div>
          </Card>
        ))}
        <Card edge={C.warm} style={{ padding: 13 }}>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 14.5 }}>Mile 132.5 → 158.8 · 26.3 mi</div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5, lineHeight: 1.7 }}>
            <b style={{ color: C.warm }}>Pacers are legal here.</b> Run solo by choice: Deer Pass at mile 146.5
            has no crew access in 2026, so there is nowhere to swap and a pacer would be committed to the whole
            26.3 miles. If 2027 restores crew at Deer Pass this splits in two and the grid changes.
          </div>
        </Card>
      </div>

      <SectionTitle>If only one pacer materialises</SectionTitle>
      <Card>
        <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 10 }}>Cover in this order:</div>
        {SINGLE_PACER_FALLBACK.map((f, i) => (
          <div key={f} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0",
                                borderBottom: i < 2 ? `1px solid ${C.line}` : "none" }}>
            <span style={{ width: 21, height: 21, border: `1px solid ${C.accent}`, color: C.accent,
                           display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                           fontFamily: display }}>{i + 1}</span>
            <span style={{ fontSize: 13.5 }}>{f}</span>
          </div>
        ))}
      </Card>

      <SectionTitle>Rules that protect everyone</SectionTitle>
      <Card>
        {PACER_RULES.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 9, padding: "8px 0", fontSize: 13, lineHeight: 1.7,
                                borderBottom: i < PACER_RULES.length - 1 ? `1px solid ${C.line}` : "none" }}>
            <span style={{ color: C.accent }}>→</span><span style={{ color: C.dim }}>{r}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crew — with driving links
// ---------------------------------------------------------------------------
function CrewView({ built, state, setState }) {
  const drives = state.driveMin || {};
  const setDrive = (k, v) => setState({ ...state, driveMin: { ...drives, [k]: v } });
  const crewStops = built.splits.filter((s) => s.crew);

  return (
    <div>
      <SectionTitle note="Jackie's sequence. Eleven crew-accessible stations across four days, one crew vehicle per station.">
        Crew stops, drives and windows
      </SectionTitle>

      <Card style={{ marginBottom: 12 }} edge={C.warm}>
        <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.7 }}>
          <b style={{ color: C.warm }}>Drive times are not guessed.</b> The window column is real — it comes
          from the split table and says how long there is between the runner leaving one crew point and reaching
          the next. Measure the actual drives on recon and type them in; anything entered is saved on this device
          and makes the margin column live. The map links open your phone's navigation app and need a signal at
          the moment you tap them, so screenshot the route before you lose bars.
        </div>
      </Card>

      <div style={{ display: "grid", gap: 9 }}>
        {crewStops.map((s, i) => {
          const next = crewStops[i + 1];
          const win = next ? +(next.elapsed - s.elapsed).toFixed(1) : null;
          const dm = drives[s.station];
          const driveHrs = dm ? Number(dm) / 60 : null;
          const margin = win != null && driveHrs != null ? +(win - driveHrs).toFixed(1) : null;
          const c = cutoffFor(s.station);
          const here = c ? { lat: c.lat, lon: c.lon } : null;
          const there = next ? cutoffFor(next.station) : null;
          const L = here ? driveLinks(here.lat, here.lon, s.station) : null;

          return (
            <Card key={s.station} style={{ padding: 13 }} edge={i === 0 ? C.accent : C.line}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15 }}>
                    {s.station} <span style={{ color: C.dim, fontWeight: 400 }}>· mile {s.mile.toFixed(1)}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, ...figures }}>
                    runner in {s.clock}{c && ` · cutoff ${c.cut}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {s.sleep && <Pill color={C.accent}>{s.sleep}</Pill>}
                  {s.verify && <Pill color={C.danger}>Verify</Pill>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap", alignItems: "center" }}>
                {L && (
                  <>
                    <a href={L.google} target="_blank" rel="noreferrer" style={linkBtn}>Drive here</a>
                    <a href={L.apple} target="_blank" rel="noreferrer" style={linkBtnQuiet}>Apple Maps</a>
                  </>
                )}
                {there && here && (
                  <a href={driveLinks(there.lat, there.lon).leg(here.lat, here.lon)}
                     target="_blank" rel="noreferrer" style={linkBtnQuiet}>
                    → {next.station}
                  </a>
                )}
              </div>

              {next && (
                <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 11,
                              borderTop: `1px solid ${C.line}`, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div>
                    <div style={eyebrow}>Window</div>
                    <div style={{ fontSize: 15, fontWeight: 700, ...figures }}>{win} h</div>
                  </div>
                  <label>
                    <div style={eyebrow}>Drive (min)</div>
                    <input value={dm || ""} inputMode="numeric" placeholder="—"
                           onChange={(e) => setDrive(s.station, e.target.value.replace(/[^\d]/g, ""))}
                           style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text,
                                    borderRadius: 3, padding: "5px 8px", fontSize: 13, width: 64,
                                    textAlign: "right", outline: "none", ...figures }} />
                  </label>
                  <div>
                    <div style={eyebrow}>Margin</div>
                    <div style={{ fontSize: 15, fontWeight: 700, ...figures,
                                  color: margin == null ? C.faint : margin < 1 ? C.danger : C.good }}>
                      {margin == null ? "—" : `${margin} h`}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <SectionTitle note={GATE_RATIONALE}>Decision gates</SectionTitle>
      <div style={{ display: "grid", gap: 10 }}>
        {GATES.map((g) => {
          const row = built.splits.find((s) => s.station === g.station);
          return (
            <Card key={g.station} edge={g.external ? C.danger : C.warm}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15.5 }}>
                  {g.station}<span style={{ color: C.dim, fontWeight: 400 }}> · mile {g.mile}</span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {row && <span style={{ fontSize: 12, color: C.dim, ...figures }}>target {row.clock}</span>}
                  <Pill color={g.external ? C.danger : C.warm}>{g.owner} decides</Pill>
                </div>
              </div>
              <div style={{ fontSize: 13.5, marginTop: 9, lineHeight: 1.7 }}>{g.rule}</div>
              <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6, lineHeight: 1.7 }}>{g.why}</div>
            </Card>
          );
        })}
      </div>

      <SectionTitle>Sleep plan</SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {built.blocks.filter((b) => b.type === "SLEEP").map((b) => (
          <Card key={b.n} style={{ padding: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 14.5 }}>{b.at}</div>
              <div style={{ fontSize: 12.5, color: C.accent, ...figures }}>
                {b.startClock} → {b.endClock} · {b.sleepHrs} hr sleep
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5 }}>
              {b.facility}{b.detail ? ` — ${b.detail}` : ""}
            </div>
          </Card>
        ))}
        <Card style={{ padding: 13 }} edge={C.danger}>
          <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.7 }}>
            <b style={{ color: C.danger }}>Treat hallucinations and microsleeps as safety alerts, not toughness
            moments.</b> Sleep by design, not by collapse. When the runner cannot make that call, Jackie makes it.
          </div>
        </Card>
      </div>

      <SectionTitle note="Required and cold-weather gear is checked at these stations. Missing kit is a stop, not a warning.">
        Gear checks
      </SectionTitle>
      <Card>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATIONS.filter((s) => s.gearCheck).map((s) => (
            <div key={s.name} style={{ background: C.panel2, border: `1px solid ${C.warm}44`,
                                       borderRadius: 3, padding: "8px 11px", fontSize: 12.5 }}>
              <b>{s.name}</b> <span style={{ color: C.dim }}>· {s.mile}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 11, lineHeight: 1.7 }}>
          Fort Tuthill at mile 210.6 adds a <b style={{ color: C.text }}>mental status evaluation</b> on top of
          the gear check. That is the input to Jackie's Elden go/no-go.
        </div>
      </Card>
    </div>
  );
}

const linkBtn = {
  background: C.accent, color: "#1a1006", textDecoration: "none", padding: "7px 12px",
  borderRadius: 3, fontWeight: 700, fontSize: 12.5, display: "inline-block",
};
const linkBtnQuiet = {
  background: "transparent", color: C.accent, textDecoration: "none", padding: "6px 11px",
  borderRadius: 3, fontWeight: 600, fontSize: 12.5, border: `1px solid ${C.accent}66`,
  display: "inline-block",
};

// ---------------------------------------------------------------------------
// Blocks and Verify
// ---------------------------------------------------------------------------
function Timeline({ built }) {
  return (
    <div>
      <SectionTitle note="The plan as the runner and crew reference it. Block numbers are stable across all three scenarios, so 'we're behind on Block 19' means the same thing whichever table is live.">
        24-block timeline
      </SectionTitle>
      <div style={{ display: "grid", gap: 7 }}>
        {built.blocks.map((b) => {
          const isRun = b.type === "RUN", isSleep = b.type === "SLEEP";
          const accent = isSleep ? C.accent : b.type === "HANDOFF" ? C.dim
            : b.mandated ? C.danger : b.pacer === "A" ? C.A : b.pacer === "B" ? C.B : C.warm;
          return (
            <div key={b.n} style={{ background: isRun ? C.panel : C.panel2,
                  border: `1px solid ${C.line}`, borderLeft: `3px solid ${accent}`,
                  borderRadius: 3, padding: "11px 13px", opacity: b.type === "HANDOFF" ? 0.85 : 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: C.faint, minWidth: 22, ...figures }}>{b.n}</span>
                <span style={{ fontFamily: display, fontWeight: 700, fontSize: 14, flex: "1 1 200px" }}>{b.label}</span>
                {isRun && <Pill color={accent}>{b.mandated ? "Solo — required" : b.pacer === "solo" ? "Solo by choice" : `Pacer ${b.pacer}`}</Pill>}
                {isSleep && <Pill color={C.accent}>{b.sleepHrs} hr sleep</Pill>}
                {b.changed && b.type !== "HANDOFF" && <Pill color={built.scenario.color}>Adjusted</Pill>}
              </div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 5, ...figures }}>
                {b.startClock} → {b.endClock} · {b.hrs} h{isRun && ` · ${b.miles} mi · ${b.mph} mph`}
              </div>
              {b.detail && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6, lineHeight: 1.7 }}>{b.detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Verify() {
  return (
    <div>
      <SectionTitle note="Everything here is 2026 official Aravaipa data. This is what changes the plan if it moves.">
        Before this reaches anyone
      </SectionTitle>
      <DataWarning />

      <SectionTitle>Flagged in the station table</SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {STATIONS.filter((s) => s.verify).map((s) => (
          <Card key={s.name} edge={C.danger} style={{ padding: 13 }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 14.5 }}>
              {s.name} <span style={{ color: C.dim, fontWeight: 400 }}>· mile {s.mile}</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5, lineHeight: 1.7 }}>
              Unverified for 2027: <b style={{ color: C.text }}>{s.verify.join(", ")}</b>. Because the Walnut
              Canyon swap cannot be relied on, Block 22 is planned as one unbroken 23.1-mile shift for Pacer B.
              If 2027 confirms crew access that splits in two and B's longest shift drops to 16.2 miles.
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Open items carried from the handoff</SectionTitle>
      <div style={{ display: "grid", gap: 7 }}>
        {OPEN_ITEMS.map((o, i) => (
          <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`,
                borderLeft: `3px solid ${o.critical ? C.danger : C.line}`, borderRadius: 3,
                padding: "11px 13px", display: "flex", gap: 10, justifyContent: "space-between",
                alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, lineHeight: 1.6, flex: "1 1 240px" }}>{o.item}</span>
            <Pill color={o.critical ? C.danger : C.dim}>
              {o.critical ? "Blocks crew handoff" : o.owner === "—" ? "To build" : o.owner}
            </Pill>
          </div>
        ))}
      </div>

      <SectionTitle>Course table checksum</SectionTitle>
      <Card>
        <div style={{ fontSize: 13, lineHeight: 1.8, color: C.dim, ...figures }}>
          <div>segments summed: +{CHECKSUM.gain.toLocaleString()} / -{CHECKSUM.loss.toLocaleString()} / {CHECKSUM.miles} mi</div>
          <div>published:       +{RACE.gain.toLocaleString()} / -{RACE.loss.toLocaleString()} / {RACE.miles} mi</div>
          <div style={{ color: CHECKSUM.ok ? C.good : C.danger, fontWeight: 700, marginTop: 6 }}>
            {CHECKSUM.ok ? "✓ cross-foots exactly" : "✗ MISMATCH — fix the station table"}
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 11, lineHeight: 1.7 }}>
          Runs on every load, so a fat-fingered digit surfaces before a wrong split reaches a pacer. Separately,
          the GPX trace behind the profile sums to only {TRACE_CAVEAT.traceGain.toLocaleString()} ft because it
          is downsampled — that is expected and the trace is used for shape alone.
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
  { id: "live", label: "Live" },
  { id: "splits", label: "Splits" },
  { id: "pacers", label: "Pacers" },
  { id: "crew", label: "Crew" },
  { id: "field", label: "Field" },
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
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.bg + "f5",
                    backdropFilter: "blur(8px)", borderBottom: `2px solid ${C.rule}`,
                    paddingTop: "env(safe-area-inset-top)" }}>
        <div style={{ maxWidth: 940, margin: "0 auto", padding: "11px 16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ ...eyebrow, color: C.accent, fontSize: 11 }}>Cocodona 250 · Crew &amp; Pacer Brief</div>
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}
                    style={{ background: C.panel, color: built.scenario.color, border: `1px solid ${C.line}`,
                             borderRadius: 3, padding: "5px 8px", fontSize: 12, fontWeight: 700, outline: "none" }}>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id} style={{ color: C.text }}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 2, overflowX: "auto", marginTop: 9, paddingBottom: 1 }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: "none", border: "none", cursor: "pointer", fontFamily: display,
                color: tab === t.id ? C.accent : C.dim, fontSize: 14,
                fontWeight: tab === t.id ? 700 : 500, padding: "8px 11px",
                borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`, whiteSpace: "nowrap",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 940, margin: "0 auto", padding: "16px 16px calc(52px + env(safe-area-inset-bottom))" }}>
        {tab === "overview" && <Overview built={built} />}
        {tab === "live" && <Live built={built} state={state} setState={setState} />}
        {tab === "splits" && <Splits scenarioId={scenarioId} setScenarioId={setScenarioId} built={built} />}
        {tab === "pacers" && <PacerView built={built} state={state} setState={setState} />}
        {tab === "crew" && <CrewView built={built} state={state} setState={setState} />}
        {tab === "field" && <Field built={built} />}
        {tab === "blocks" && <Timeline built={built} />}
        {tab === "verify" && <Verify />}

        <Rule style={{ marginTop: 34 }} />
        <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.8 }}>
          Runner Alex · crew chief Jackie · two pacers. This brief works offline; nothing is sent anywhere, and
          names, measured drive times and live entries stay on this device. The 3D terrain view and the map
          links are the only parts that need a signal.
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
