// Cocodona 250 — Race Plan Guide.
//
// The printed document. Jackie's binder, and the thing that still works when the
// phones are dead, the truck has no signal, or the runner is too far gone to
// operate a screen. It exists because the crew brief is a phone app, and a phone
// app is a single point of failure at mile 200 in the dark.
//
// It imports the SAME data modules as the crew app rather than restating them.
// Cross-app imports are unusual in this repo, and the reason is worth stating:
// a second copy of the splits would drift, and the failure mode of drift here is
// a pacer standing at the wrong aid station for four hours. One source, two
// renderings — a dark screen and a sheet of paper.
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  RACE, STATIONS, SEGMENTS, CREW_STATIONS, SLEEP_STATIONS, VERIFY_FLAGS,
  SOLO_MANDATED, SOLO_MANDATED_MILES, PACER_LEGAL_MILES, PACER_START_MILE,
} from "../../cocodona/src/course.js";
import {
  SCENARIOS, PACERS, PACER_RULES, SINGLE_PACER_FALLBACK, GATES, GATE_RATIONALE,
  OPEN_ITEMS, buildScenario,
} from "../../cocodona/src/plan.js";
import { cutoffFor, FIELD_TOTALS, ALL_TIMES, percentileOf } from "../../cocodona/src/field.js";

// Paper palette. Same waybill idea as the app, inverted for ink on stock.
const P = {
  paper: "#efe4cd", ink: "#241a10", ink2: "#4a382a", faint: "#7d6b56",
  rule: "#6b4a22", hair: "#c3b295", wash: "#e5d8bd",
  danger: "#8c2f20", warm: "#8a5a12", good: "#4c5a2a",
};
const serif = 'Georgia,"Iowan Old Style","Times New Roman",serif';
const mono = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
const fig = { fontFamily: mono, fontVariantNumeric: "tabular-nums" };
const caps = {
  fontSize: 9, letterSpacing: ".2em", textTransform: "uppercase",
  fontWeight: 700, color: P.faint, fontFamily: serif,
};

// ---------------------------------------------------------------------------
// Print furniture
// ---------------------------------------------------------------------------
function DoubleRule({ style }) {
  return (
    <div style={{ borderTop: `2.5px solid ${P.rule}`, borderBottom: `1px solid ${P.hair}`,
                  height: 3, boxSizing: "content-box", ...style }} />
  );
}

/** One printed page. Numbered in the footer so a dropped binder can be reassembled. */
function Page({ n, of, title, children }) {
  return (
    <section className="page" style={{ marginBottom: 34 }}>
      {title && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                        gap: 12, marginBottom: 4 }}>
            <div style={caps}>{title}</div>
            <div style={{ ...caps, color: P.hair }}>Cocodona 250 · 2027</div>
          </div>
          <DoubleRule style={{ marginBottom: 16 }} />
        </>
      )}
      {children}
      <div className="keep" style={{ marginTop: 20, paddingTop: 7, borderTop: `1px solid ${P.hair}`,
                    display: "flex", justifyContent: "space-between", ...caps, color: P.hair }}>
        <span>Race Plan Guide</span><span>{n} of {of}</span>
      </div>
    </section>
  );
}

function H({ children, sub }) {
  return (
    <div className="keep" style={{ marginTop: 20, marginBottom: 9 }}>
      <h2 style={{ fontFamily: serif, fontSize: 17, margin: 0, fontWeight: 700, letterSpacing: "-.01em" }}>
        {children}
      </h2>
      {sub && <div style={{ fontSize: 11.5, color: P.ink2, marginTop: 4, lineHeight: 1.55 }}>{sub}</div>}
    </div>
  );
}

function Body({ children, style }) {
  return <p style={{ fontSize: 12, lineHeight: 1.62, margin: "0 0 9px", color: P.ink, ...style }}>{children}</p>;
}

/** A boxed rule the crew is expected to act on rather than read past. */
function RuleBox({ label, color = P.rule, children }) {
  return (
    <div className="keep" style={{ border: `1px solid ${color}`, borderLeft: `4px solid ${color}`,
                  background: P.wash, padding: "10px 12px", margin: "10px 0", borderRadius: 2 }}>
      {label && <div style={{ ...caps, color, marginBottom: 5 }}>{label}</div>}
      <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

// Monospaced figures are for columns of numbers that have to line up. A cell built
// as an element is prose — a reason, a facility, a note — and setting it in mono made
// half this document read like a receipt. Column type is decided once, from the first
// row, so the header lands over its own column instead of drifting to the far side.
function Table({ head, widths, rows, prose = [] }) {
  const isProse = (j) =>
    j === 0 || prose.includes(j) || (rows[0] && rows[0][j] !== null && typeof rows[0][j] === "object");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed" }}>
      {widths && <colgroup>{widths.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>}
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} style={{ ...caps, textAlign: isProse(i) ? "left" : "right", padding: "5px 6px",
                  borderBottom: `2px solid ${P.rule}`, verticalAlign: "bottom" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ background: i % 2 ? "transparent" : P.wash }}>
            {r.map((c, j) => (
              <td key={j} style={{ padding: "4px 6px", fontSize: 11, verticalAlign: "top",
                    textAlign: isProse(j) ? "left" : "right", borderBottom: `1px solid ${P.hair}`,
                    ...(isProse(j) ? { fontFamily: serif } : fig) }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Fact({ label, value, sub }) {
  return (
    <div style={{ minWidth: 96 }}>
      <div style={caps}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, fontFamily: serif, ...fig, marginTop: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: P.faint }}>{sub}</div>}
    </div>
  );
}

/** An empty box the crew fills in by hand. The guide is printed before these are known. */
// The rule flexes rather than sitting at a fixed width, so the label never gets
// orphaned from its line and the form still fits a phone screen.
function Blank({ w = 150, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7, marginRight: 16,
                   maxWidth: "100%", verticalAlign: "baseline" }}>
      {label && <span style={{ ...caps, flex: "0 0 auto" }}>{label}</span>}
      <span style={{ flex: `1 1 ${w}px`, minWidth: 44, borderBottom: `1px solid ${P.ink2}`, height: 14 }} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------
function Guide({ scenarioId }) {
  const built = useMemo(() => buildScenario(scenarioId), [scenarioId]);
  const crewStops = built.splits.filter((s) => s.crew);
  const sleeps = built.blocks.filter((b) => b.type === "SLEEP");
  const gearStations = STATIONS.filter((s) => s.gearCheck);
  // Split rows carry crew/drop/sleep/verify but not gearCheck, so it comes off the
  // station record. Read straight off the split it silently rendered as "no gear
  // check" at every station, which is the wrong way for this to fail.
  const byName = useMemo(() => new Map(STATIONS.map((s) => [s.name, s])), []);
  const TOTAL = 10;
  const median = ALL_TIMES[Math.floor(ALL_TIMES.length / 2)];

  return (
    <>
      {/* 1 — cover ------------------------------------------------------- */}
      <Page n={1} of={TOTAL}>
        <div style={{ ...caps, fontSize: 10 }}>Race Plan Guide · Crew Copy</div>
        <DoubleRule style={{ margin: "6px 0 18px" }} />
        <h1 style={{ fontFamily: serif, fontSize: 40, margin: 0, lineHeight: 1.02, letterSpacing: "-.02em" }}>
          Cocodona 250
        </h1>
        <div style={{ fontSize: 13.5, color: P.ink2, marginTop: 8 }}>
          Monday May 3, 2027 · 5:00 AM · Black Canyon City to Flagstaff, Arizona
        </div>

        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", margin: "22px 0 4px" }}>
          <Fact label="Distance" value={RACE.miles} sub="miles" />
          <Fact label="Climbing" value={`${(RACE.gain / 1000).toFixed(1)}k`} sub="feet up" />
          <Fact label="Descent" value={`${(RACE.loss / 1000).toFixed(1)}k`} sub="feet down" />
          <Fact label="Cutoff" value={RACE.cutoffHours} sub="hours" />
        </div>
        <DoubleRule style={{ margin: "18px 0" }} />

        <H>What this document is</H>
        <Body>
          The plan on paper. The crew app on your phone holds the same numbers and can do arithmetic
          you cannot do here — where the runner is against plan, what time they reach the next stop.
          This exists because that phone is a single point of failure at mile 200 in the dark, and
          because a document in a binder can be handed to a pacer who has never seen the app.
        </Body>
        <Body>
          Everything here is generated from the same data the app uses. If the two ever disagree, the
          app is newer — but neither is the official source. The 2027 runner manual is, and it has not
          published yet. See page {TOTAL}.
        </Body>

        <H>Who does what</H>
        <Table
          widths={["24%", null]}
          head={["Role", "Responsibility"]}
          rows={[
            ["Alex", <span style={{ textAlign: "left", display: "block" }}>Runs. Owns the two split-table decision gates at Whiskey Row and Dead Horse Ranch.</span>],
            ["Jackie", <span style={{ textAlign: "left", display: "block" }}>Crew chief, non-running. Drives, stocks the {crewStops.length - 1} crew stations, and owns the Elden go/no-go at Fort Tuthill — see page 3.</span>],
            ["Pacer A", <span style={{ textAlign: "left", display: "block" }}>{PACERS.A.role}. {PACERS.A.totalMiles} miles across {PACERS.A.shifts.length} pulls. Not yet named.</span>],
            ["Pacer B", <span style={{ textAlign: "left", display: "block" }}>{PACERS.B.role}. {PACERS.B.totalMiles} miles across {PACERS.B.shifts.length} shifts. Not yet named.</span>],
          ]}
        />

        <H>Fill in before you leave</H>
        <div style={{ fontSize: 11.5, lineHeight: 2.4, marginTop: 6 }}>
          <div><Blank w={190} label="Pacer A name" /> <Blank w={140} label="mobile" /></div>
          <div><Blank w={190} label="Pacer B name" /> <Blank w={140} label="mobile" /></div>
          <div><Blank w={190} label="Crew vehicle / plate" /> <Blank w={140} label="lodging" /></div>
          <div><Blank w={190} label="Race HQ / medical" /> <Blank w={140} label="emergency contact" /></div>
        </div>
      </Page>

      {/* 2 — the plan ---------------------------------------------------- */}
      <Page n={2} of={TOTAL} title="The plan">
        <H sub={built.scenario.blurb}>
          {built.scenario.label} — {built.totals.elapsed} hours
        </H>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "12px 0 6px" }}>
          <Fact label="Finish" value={built.totals.finishClock} />
          <Fact label="Elapsed" value={`${built.totals.elapsed}h`} />
          <Fact label="Buffer" value={`${built.totals.cutoffMargin}h`} sub={`inside the ${RACE.cutoffHours}-hour limit`} />
          <Fact label="Sleep" value={`${built.totals.sleepHrs}h`} sub={`across ${sleeps.length} stops`} />
        </div>
        {built.scenario.note && (
          <Body style={{ fontSize: 11, color: P.ink2, fontStyle: "italic" }}>{built.scenario.note}</Body>
        )}

        <H>The other two tables</H>
        <Body>
          All three are the same twenty-four blocks with different durations. Block numbers do not move,
          so &ldquo;we are behind on Block 19&rdquo; means the same thing whichever table is live. That is
          what makes a mid-race switch mechanical instead of an argument.
        </Body>
        <Table
          widths={["26%", "16%", "16%", null]}
          head={["Table", "Finish", "Buffer", "When it is the right one"]}
          rows={SCENARIOS.map((s) => {
            const b = buildScenario(s.id);
            return [
              <span><b>{s.label}</b><br /><span style={{ ...caps, color: P.faint }}>{s.tag}</span></span>,
              b.totals.finishClock,
              `${b.totals.cutoffMargin}h`,
              <span style={{ display: "block", textAlign: "left", fontSize: 10.5, lineHeight: 1.5 }}>
                {s.id === "96" ? "Only if Fort Tuthill arrives ahead of schedule and strong. Climbs Elden overnight, solo, on the fourth night."
                  : s.id === "100" ? "The plan. Real sleep at Fort Tuthill, Elden climbed rested and in daylight."
                  : "What the gates drop you into. Movement slows ~7.5% and every sleep block returns to full length."}
              </span>,
            ];
          })}
        />

        <H>How this race actually goes for people</H>
        <Body>
          Six runnings, {FIELD_TOTALS.starters} starters, {FIELD_TOTALS.finishers} finishers — a{" "}
          {FIELD_TOTALS.finishRate}% finish rate. Median finish is {median.toFixed(1)} hours, which is
          within {(RACE.cutoffHours - median).toFixed(0)} hours of the cutoff: most people who finish this
          race finish it late. At {built.totals.elapsed} hours this plan sits at the{" "}
          {percentileOf(built.totals.elapsed)}th percentile.
        </Body>
        <RuleBox label="What that means for the crew" color={P.warm}>
          A third of the field does not finish, and the ones who do mostly arrive with hours to spare and
          no more. The buffer on this plan is not slack to be protected — it is the thing that absorbs a
          bad patch, a stomach shutdown, or a long sleep. Spending it on a real problem is the plan
          working. Defending it by cutting sleep is the plan failing.
        </RuleBox>

        <H>The four hard things</H>
        <Table
          widths={["30%", null]}
          head={["", ""]}
          rows={[
            ["Day 1 is the fastest pace against 44% of the climbing",
              <span style={{ display: "block", textAlign: "left", fontSize: 10.5, lineHeight: 1.55 }}>
                Whiskey Row is 75.7 miles with +17,215 ft. The failure mode is treating a
                runnable first 33 miles as licence to race the first 40.
              </span>],
            ["The first 83 miles are solo, and so are the last 19",
              <span style={{ display: "block", textAlign: "left", fontSize: 10.5, lineHeight: 1.55 }}>
                No pacer is legal until Watson Lake at mile {PACER_START_MILE}. Mt. Elden — 3,386 ft up then
                2,000 ft down over roughly 40 switchbacks — is climbed alone at the deepest point of sleep
                deprivation.
              </span>],
            ["Descent, not climbing, is what ends 250s",
              <span style={{ display: "block", textAlign: "left", fontSize: 10.5, lineHeight: 1.55 }}>
                {(RACE.loss / 1000).toFixed(1)}k ft down. Jerome alone drops 4,428 ft in 17 miles. Quad damage
                accumulates and does not recover mid-race.
              </span>],
            ["Desert heat for 36 hours, then 25°F on a 9,000 ft peak",
              <span style={{ display: "block", textAlign: "left", fontSize: 10.5, lineHeight: 1.55 }}>
                Exposed low-desert start in early May, a 7,000 ft finish, and Munds Park unheated tents at
                upper-30s in between. The layers for Elden have to be packed 40 hours earlier.
              </span>],
          ]}
        />
      </Page>

      {/* 3 — decision gates --------------------------------------------- */}
      <Page n={3} of={TOTAL} title="Decision gates">
        <H sub={GATE_RATIONALE}>Three pre-committed decisions</H>
        {GATES.map((g) => {
          const row = built.splits.find((s) => s.station === g.station);
          return (
            <div key={g.station} className="keep"
                 style={{ border: `1px solid ${g.external ? P.danger : P.hair}`,
                          borderLeft: `4px solid ${g.external ? P.danger : P.rule}`,
                          padding: "11px 13px", margin: "10px 0", background: g.external ? P.wash : "transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
                            alignItems: "baseline" }}>
                <div style={{ fontFamily: serif, fontSize: 14.5, fontWeight: 700 }}>
                  {g.station} <span style={{ color: P.faint, fontWeight: 400, fontSize: 12 }}>· mile {g.mile}</span>
                </div>
                <div style={{ ...caps, color: g.external ? P.danger : P.rule }}>{g.owner} decides</div>
              </div>
              {row && (
                <div style={{ fontSize: 10.5, color: P.faint, marginTop: 3, ...fig }}>
                  target arrival {row.clock} · {row.elapsed}h elapsed
                  {cutoffFor(g.station) ? ` · official cutoff ${cutoffFor(g.station).cut}` : ""}
                </div>
              )}
              <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6, fontWeight: 600 }}>{g.rule}</div>
              <div style={{ fontSize: 11, marginTop: 5, lineHeight: 1.6, color: P.ink2 }}>{g.why}</div>
              <div style={{ marginTop: 9, paddingTop: 7, borderTop: `1px solid ${P.hair}`, fontSize: 10.5 }}>
                <Blank w={70} label="actual arrival" /> &nbsp; <Blank w={70} label="call made" /> &nbsp;
                <Blank w={60} label="initials" />
              </div>
            </div>
          );
        })}

        <RuleBox label="Safety rules that override everything above" color={P.danger}>
          <div style={{ marginBottom: 6 }}>
            <b>Hallucinations and microsleeps are safety alerts, not toughness moments.</b> Sleep by design,
            not by collapse. When the runner cannot make that call, Jackie makes it and the runner does not
            get a vote.
          </div>
          <div>
            No pacer, and no crew member, is expected to talk the runner into continuing through any of
            this. If two people independently think something is wrong, that is enough to stop and sort it
            out — the plan has {built.totals.cutoffMargin} hours of room for exactly that.
          </div>
        </RuleBox>

        <H>If the plan is behind, in order</H>
        <Table
          widths={["12%", null]}
          head={["", "Sequence"]}
          rows={[
            ["1", <span style={{ display: "block", textAlign: "left" }}>Check it against the next gate, not against feelings. Under three hours behind is not a gate.</span>],
            ["2", <span style={{ display: "block", textAlign: "left" }}>Past the gate: switch tables formally and say it out loud. The 110-hour splits, with full sleep blocks restored.</span>],
            ["3", <span style={{ display: "block", textAlign: "left" }}>Do not chase. Do not cut a sleep block to buy back a deficit — that is the classic blow-up, and in the Verde Valley heat it is the common one.</span>],
            ["4", <span style={{ display: "block", textAlign: "left" }}>Re-check the tightest cutoff ahead, which is rarely the finish. Block 22 (Fort Tuthill → Wildcat Hill) is the designated pressure-relief valve and can be moved or dropped.</span>],
          ]}
        />
      </Page>

      {/* 4-5 — crew sequence -------------------------------------------- */}
      <Page n={4} of={TOTAL} title="Crew sequence">
        <H sub={`${crewStops.length - 1} crew-accessible stations across four days, plus the finish, on the ${built.scenario.label} table. The window is how long there is between the runner leaving one crew point and reaching the next — that is your drive time budget, and it is real, not padded.`}>
          Where Jackie has to be, and when
        </H>
        <RuleBox label="Measure the drives on recon" color={P.warm}>
          The window column comes from the split table. The drive column is blank because nobody has
          driven it yet — fill it in on recon and the margin is the number that tells you whether a stop
          is comfortable or a sprint. Coordinates are printed so a phone with a map but no signal can
          still route, and so they survive the app being unavailable.
        </RuleBox>
        <Table
          widths={["27%", "9%", "15%", "10%", "10%", null]}
          head={["Station", "Mile", "Runner in", "Window", "Drive", "Coordinates / notes"]}
          rows={crewStops.map((s, i) => {
            const next = crewStops[i + 1];
            const win = next ? +(next.elapsed - s.elapsed).toFixed(1) : null;
            const c = cutoffFor(s.station);
            const tags = [s.sleep, s.drop ? "drop bag" : null,
                          byName.get(s.station)?.gearCheck ? "gear check" : null,
                          s.verify ? `VERIFY 2027 — ${s.verify.join(", ")}` : null].filter(Boolean);
            return [
              <span><b>{s.station}</b>{c && <><br /><span style={{ ...caps, color: P.faint }}>cut {c.cut}</span></>}</span>,
              s.mile.toFixed(1),
              s.clock,
              win == null ? "—" : `${win} h`,
              "______",
              <span style={{ display: "block", textAlign: "left", fontSize: 9.5, lineHeight: 1.5, ...fig }}>
                {c ? `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}` : "coordinates not published"}
                {tags.length > 0 && (
                  <span style={{ fontFamily: serif, color: s.verify ? P.danger : P.ink2 }}>
                    <br />{tags.join(" · ")}
                  </span>
                )}
              </span>,
            ];
          })}
        />
        <Body style={{ fontSize: 10.5, color: P.faint, marginTop: 10 }}>
          Coordinates come from the 2026 course GPX, so they are the same ones the terrain model uses.
          Cutoff times are the official published per-station limits, expressed as race day and clock
          time — D6 10:00a is the {RACE.cutoffHours}-hour finish limit.
        </Body>
      </Page>

      <Page n={5} of={TOTAL} title="Sleep and gear">
        <H sub={`${built.totals.sleepHrs} hours of sleep across ${sleeps.length} stops, on the ${built.scenario.label} table. These are appointments, not options.`}>
          Sleep plan
        </H>
        <Table
          widths={["27%", "23%", "13%", null]}
          head={["Where", "Window", "Sleep", "Facility"]}
          rows={sleeps.map((b) => [
            <b>{b.at}</b>,
            `${b.startClock} → ${b.endClock}`,
            `${b.sleepHrs} h`,
            <span style={{ display: "block", textAlign: "left", fontSize: 10.5, lineHeight: 1.5 }}>
              {b.facility}{b.detail ? ` — ${b.detail}` : ""}
            </span>,
          ])}
        />
        <RuleBox label="Cold, and where it bites" color={P.warm}>
          Munds Park is unheated tents at upper-30s. Fort Tuthill has heated indoor cots and is where the
          long sleep sits in the {built.scenario.label} table. Wildcat Hill has a drop bag but no sleep
          facility, so it is a feet-and-food stop, never a nap. Elden layers have to be in the Fort
          Tuthill bag, packed roughly forty hours before they are needed.
        </RuleBox>

        <H sub="Missing kit is a stop, not a warning. Check the bag before the runner arrives, not after.">
          Gear checks
        </H>
        <Table
          widths={["40%", "16%", null]}
          head={["Station", "Mile", "What is checked"]}
          rows={gearStations.map((s) => [
            <b>{s.name}</b>, s.mile,
            <span style={{ display: "block", textAlign: "left", fontSize: 10.5 }}>
              {s.name === "Fort Tuthill"
                ? "Required and cold-weather kit, plus a mental status evaluation. That evaluation is the input to Jackie's Elden go/no-go."
                : "Required and cold-weather kit."}
            </span>,
          ])}
        />

        <H>Crew rules</H>
        <div style={{ fontSize: 11.5, lineHeight: 1.7 }}>
          {PACER_RULES.map((r, i) => (
            <div key={i} className="keep" style={{ display: "flex", gap: 9, marginBottom: 6 }}>
              <span style={{ ...caps, color: P.rule, minWidth: 14, paddingTop: 2 }}>{i + 1}</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
      </Page>

      {/* 6 — pacers ------------------------------------------------------ */}
      <Page n={6} of={TOTAL} title="Pacers">
        <H sub={`Of ${RACE.miles} miles, a pacer is legal on ${PACER_LEGAL_MILES}. This plan covers ${(PACERS.A.totalMiles + PACERS.B.totalMiles).toFixed(1)} of them.`}>
          Where a pacer can and cannot go
        </H>
        <Table
          widths={["16%", "20%", null]}
          head={["From", "To", "Why it is solo"]}
          prose={[1]}
          rows={SOLO_MANDATED.map((s) => [
            `mile ${s.fromMile}`, `mile ${s.toMile}`,
            <span style={{ display: "block", textAlign: "left", fontSize: 10.5 }}>{s.reason}</span>,
          ])}
        />
        <RuleBox label="Read this before assuming a hand-off is legal" color={P.danger}>
          {SOLO_MANDATED_MILES} of {RACE.miles} miles are mandatory solo — {(SOLO_MANDATED_MILES / RACE.miles * 100).toFixed(0)}%
          of the race. Two of the three closures are owl habitat, which is permit-driven and can move year
          to year. A closure that shifts by a few miles moves the entire hand-off grid below, which is why
          every one of these has to be re-checked against the 2027 manual before anyone books a flight.
        </RuleBox>

        {[PACERS.A, PACERS.B].map((p) => (
          <div key={p.id} className="keep" style={{ marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 700 }}>
                {p.label} <span style={{ fontSize: 11.5, color: P.faint, fontWeight: 400 }}>— {p.role}</span>
              </div>
              <div style={{ ...caps }}>{p.totalMiles} miles · {p.shifts.length} shifts</div>
            </div>
            <DoubleRule style={{ margin: "5px 0 0" }} />
            <Table
              widths={["23%", "23%", "11%", null]}
              head={["From", "To", "Miles", "Why this section"]}
              prose={[1]}
              rows={p.shifts.map((sh) => {
                const row = built.splits.find((s) => s.station === sh.from);
                return [
                  <span><b>{sh.from}</b>{row && <><br /><span style={{ ...caps, color: P.faint }}>{row.clock}</span></>}</span>,
                  sh.to, sh.miles,
                  <span style={{ display: "block", textAlign: "left", fontSize: 10.5, lineHeight: 1.5 }}>{sh.why}</span>,
                ];
              })}
            />
          </div>
        ))}

        <H sub="If only one pacer materialises, these are the three sections that get covered, in this order. Everything else becomes solo.">
          If a pacer falls through
        </H>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          {SINGLE_PACER_FALLBACK.map((f, i) => (
            <div key={f}><b style={{ color: P.rule }}>{i + 1}.</b> {f}</div>
          ))}
        </div>
      </Page>

      {/* 7-8 — full split table ------------------------------------------ */}
      <Page n={7} of={TOTAL} title="Splits">
        <H sub={`Every aid station on the ${built.scenario.label} table, against the official cutoff. Margin is how much room there is at that station — and note that the tightest one on the whole course is the first.`}>
          Full split table
        </H>
        <Table
          widths={["25%", "9%", "14%", "10%", "13%", null]}
          head={["Station", "Mile", "Clock", "Elapsed", "Cutoff", "Margin"]}
          rows={built.splits.map((s) => {
            const c = cutoffFor(s.station);
            const margin = c ? +(c.cutoffElapsed - s.elapsed).toFixed(1) : null;
            return [
              <span>
                <b>{s.station}</b>
                {(s.crew || s.mandated) && (
                  <><br /><span style={{ ...caps, color: s.mandated ? P.danger : P.faint }}>
                    {[s.crew ? "crew" : null, s.mandated ? "solo" : null].filter(Boolean).join(" · ")}
                  </span></>
                )}
              </span>,
              s.mile.toFixed(1), s.clock, `${s.elapsed}h`, c ? c.cut : "—",
              <span style={{ fontWeight: 700, color: margin == null ? P.faint : margin < 2 ? P.danger : margin < 6 ? P.warm : P.good }}>
                {margin == null ? "—" : `${margin}h`}
              </span>,
            ];
          })}
        />
      </Page>

      {/* Twenty-four blocks do not fit one sheet, and the footers claim a page
          count, so this is split rather than left to spill silently. */}
      {[[0, 12], [12, 24]].map(([from, to], k) => (
        <Page key={k} n={8 + k} of={TOTAL} title={k === 0 ? "Blocks" : "Blocks, continued"}>
          {k === 0 && (
            <H sub="The twenty-four blocks as the runner and crew reference them. Block numbers are stable across all three tables, so a block number means the same thing whichever one is live.">
              Block schedule
            </H>
          )}
          <Table
            widths={["7%", "26%", "13%", "9%", null]}
            head={["#", "Block", "Clock", "Hours", "What happens"]}
            rows={built.blocks.slice(from, to).map((bl) => [
              bl.n,
              <span><b>{bl.at || bl.label}</b><br /><span style={{ ...caps, color: P.faint }}>{bl.type}</span></span>,
              `${bl.startClock} → ${bl.endClock}`,
              `${bl.hrs}h`,
              <span style={{ display: "block", textAlign: "left", fontSize: 10, lineHeight: 1.5 }}>
                {bl.detail || bl.facility || bl.label || "—"}
              </span>,
            ])}
          />
        </Page>
      ))}

      {/* 9 — verify ------------------------------------------------------ */}
      <Page n={10} of={TOTAL} title="Before race day">
        <RuleBox label="Standing caveat" color={P.danger}>
          <b>Every course number in this guide is 2026 official data. The 2027 runner manual has not
          published.</b> Aid stations, cutoffs, crew access and the three owl-habitat pacer closures all
          have to be re-verified before any of this is treated as settled. A closure that moves shifts the
          entire pacer hand-off grid on page 6.
        </RuleBox>

        <H>Open items</H>
        <Table
          widths={["7%", null, "16%", "13%"]}
          head={["", "Item", "Owner", "Done"]}
          rows={OPEN_ITEMS.map((o, i) => [
            // Numbering the non-critical rows produced a list starting at 4, because
            // the blocking ones show a marker instead of their index. Marker or nothing.
            o.critical ? <span style={{ color: P.danger, fontWeight: 700 }}>!</span> : "",
            <span style={{ display: "block", textAlign: "left", fontSize: 11, lineHeight: 1.5,
                           fontWeight: o.critical ? 700 : 400 }}>{o.item}</span>,
            o.owner === "—" ? "______" : o.owner,
            "☐",
          ])}
        />
        <Body style={{ fontSize: 10.5, color: P.faint, marginTop: 8 }}>
          Items marked <b style={{ color: P.danger }}>!</b> are blocking: the plan cannot be trusted until
          they are closed.
        </Body>

        <H>Stations already flagged for 2027</H>
        {VERIFY_FLAGS.length ? (
          <Table
            widths={["34%", "13%", null]}
            head={["Station", "Mile", "What is unverified"]}
            rows={VERIFY_FLAGS.map((s) => [
              <b>{s.name}</b>, s.mile,
              <span style={{ display: "block", textAlign: "left", fontSize: 10.5 }}>{s.verify.join(", ")} unverified for 2027</span>,
            ])}
          />
        ) : (
          <Body>None flagged.</Body>
        )}

        <H>What is transcribed and what is modelled</H>
        <Body>
          <b>Transcribed</b> — station mileages, gain and loss, crew, pacer, drop-bag and sleep flags,
          block boundaries and durations, the 96-hour clock times, pacer assignments, the three decision
          gates, every guardrail threshold.
        </Body>
        <Body>
          <b>Modelled</b> — arrival times at aid stations that fall inside a multi-segment block,
          distributed by an effort score of flat miles plus 2.0 hours per 1,000 ft up and 0.5 per 1,000 ft
          down; the whole 110-hour fallback table. Modelled times are good enough to plan a crew stop and
          not good enough to argue with a timing mat.
        </Body>
        <Body style={{ fontSize: 10.5, color: P.faint, marginTop: 14 }}>
          Generated from the crew brief&rsquo;s own data modules. The segment table cross-foots against the
          published totals — {RACE.miles} mi, +{RACE.gain.toLocaleString()} / -{RACE.loss.toLocaleString()} ft —
          every time either the app or this document is built, so a mistyped digit surfaces before it
          reaches a pacer.
        </Body>
      </Page>
    </>
  );
}

// ---------------------------------------------------------------------------
function App() {
  const [scenarioId, setScenarioId] = useState("100");

  return (
    <div style={{ padding: "14px 10px 40px" }}>
      <div className="no-print" style={{ maxWidth: 760, margin: "0 auto 14px", display: "flex",
                    gap: 10, alignItems: "center", flexWrap: "wrap", fontFamily: serif }}>
        <div style={{ fontSize: 12, color: P.ink2 }}>Print this table:</div>
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => setScenarioId(s.id)}
                  style={{ background: scenarioId === s.id ? P.rule : "transparent",
                           color: scenarioId === s.id ? P.paper : P.rule,
                           border: `1px solid ${P.rule}`, borderRadius: 2, padding: "6px 11px",
                           fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            {s.id}-hour
          </button>
        ))}
        <button onClick={() => window.print()}
                style={{ marginLeft: "auto", background: P.rule, color: P.paper, border: "none",
                         borderRadius: 2, padding: "7px 14px", fontSize: 12, fontWeight: 700,
                         cursor: "pointer" }}>
          Print / save PDF
        </button>
      </div>

      {/* A sheet on screen, edge to edge on paper. */}
      <div className="sheet" style={{ maxWidth: 760, margin: "0 auto", background: P.paper,
                    padding: "34px 38px", boxShadow: "0 2px 14px rgba(0,0,0,.22)" }}>
        <Guide scenarioId={scenarioId} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
