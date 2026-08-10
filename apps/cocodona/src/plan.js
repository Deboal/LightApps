// plan.js — the race execution plan: 24 blocks, three scenarios, and the
// per-aid-station split table derived from them.
//
// PROVENANCE. The 24-block schedule and the 96-hour clock times are transcribed
// from artifacts/03-race-execution-plan.md in the handoff package, which was
// itself reconstructed from the July 17 2026 chat thread. That plan exists nowhere
// else. Treat this file as its canonical home now.
//
// WHAT IS TRANSCRIBED vs WHAT IS MODELLED — this distinction matters, do not blur it:
//   Transcribed: block boundaries, block durations, the 96-hour clock times, pacer
//                assignments, sleep locations and durations, the three gates.
//   Modelled:    per-aid-station arrival times INSIDE a multi-segment block, and
//                the whole 110-hour fallback table. Both are flagged in the UI.
//
// The 100-hour Elden-at-dawn variant is the PRIMARY plan per the source document.
// The straight 96 is the stretch case, taken only if Fort Tuthill arrives early
// and strong.

import { SEGMENTS, effort, RACE } from "./course.js";

export const PACERS = {
  A: {
    id: "A",
    label: "Pacer A",
    role: "Long continuous pulls",
    totalMiles: 50.3,
    color: "#6b7f9e",   // faded denim — theme.js C.A
    shifts: [
      { from: "Fain Ranch", to: "Jerome", miles: 29.3,
        why: "Navigation-heavy cross-country plus the Mingus climb into cold, on the second night without real sleep. The highest-value pacer window on the course." },
      { from: "Munds Park", to: "Fort Tuthill", miles: 21.0,
        why: "Deepest sleep-deprivation zone. The section where runners wake up in ditches." },
    ],
  },
  B: {
    id: "B",
    label: "Pacer B",
    role: "Four shorter distributed shifts",
    totalMiles: 60.4,
    color: "#9a6b8c",   // dusty plum — theme.js C.B
    shifts: [
      { from: "Watson Lake", to: "Fain Ranch", miles: 11.7, why: "First legal pacer leg. Easy terrain, gets the system running." },
      { from: "Jerome", to: "Dead Horse Ranch", miles: 8.7, why: "Short night descent into the second sleep block." },
      { from: "Sedona Posse Grounds", to: "Schnebly Hill", miles: 16.9, why: "The 3,600 ft climb straight out of the heat siesta." },
      { from: "Fort Tuthill", to: "Wildcat Hill", miles: 23.1, why: "Treated as one unbroken shift because the Walnut Canyon swap is unverified for 2027." },
    ],
  },
};

// Priority order if only one pacer materialises.
export const SINGLE_PACER_FALLBACK = [
  "Fain Ranch → Jerome",
  "Sedona → Schnebly",
  "Munds Park → Fort Tuthill",
];

export const PACER_RULES = [
  "Nobody exceeds ~35 miles in a calendar day.",
  "Each pacer gets a full rest cycle between shifts.",
  "Block 22 (Fort Tuthill → Wildcat Hill) is the designated pressure-relief valve. Jackie can move or drop it at Fort Tuthill if either pacer is cooked.",
  "Protect crew sleep. Tired crew make bad calls that cost the runner.",
  "Minimum pacer age 18, or younger with a parent or guardian present to sign the waiver.",
];

// ---------------------------------------------------------------------------
// The 24 blocks. `hrs` is the 96-hour plan. `segTo` gives the cumulative mile
// a RUN block ends at, which is how splits get attached to stations.
// ---------------------------------------------------------------------------
export const BLOCKS = [
  { n: 1,  type: "RUN",   label: "Start → Whiskey Row",                  fromMile: 0,     toMile: 75.7,  hrs: 21.0,  pacer: "solo", mandated: true },
  { n: 2,  type: "SLEEP", label: "SLEEP — Whiskey Row",                  at: "Whiskey Row (Prescott)", hrs: 3.25, sleepHrs: 2.5, facility: "Heated indoor cots" },
  { n: 3,  type: "RUN",   label: "Whiskey Row → Watson Lake",            fromMile: 75.7,  toMile: 82.8,  hrs: 2.25,  pacer: "solo", mandated: true },
  { n: 4,  type: "HANDOFF", label: "Pacer B ON — Watson Lake",           hrs: 0,    detail: "First legal pacer point of the race." },
  { n: 5,  type: "RUN",   label: "Watson Lake → Fain Ranch",             fromMile: 82.8,  toMile: 94.5,  hrs: 4.0,   pacer: "B" },
  { n: 6,  type: "HANDOFF", label: "B off / Pacer A ON — Fain Ranch",    hrs: 0.25, detail: "Gear check here." },
  { n: 7,  type: "RUN",   label: "Fain Ranch → Mingus → Jerome",         fromMile: 94.5,  toMile: 123.8, hrs: 10.25, pacer: "A" },
  { n: 8,  type: "HANDOFF", label: "A off / B back ON — Jerome",         hrs: 0.25 },
  { n: 9,  type: "RUN",   label: "Jerome → Dead Horse",                  fromMile: 123.8, toMile: 132.5, hrs: 3.25,  pacer: "B" },
  { n: 10, type: "SLEEP", label: "SLEEP — Dead Horse",                   at: "Dead Horse Ranch", hrs: 3.2, sleepHrs: 2.5, facility: "Sleeper tents (BYO bag)", detail: "Both pacers rest here too." },
  { n: 11, type: "RUN",   label: "Dead Horse → Deer Pass → Sedona",      fromMile: 132.5, toMile: 158.8, hrs: 9.8,   pacer: "solo", mandated: false,
           detail: "Pacers are LEGAL here. Run solo by choice: Deer Pass has no crew access, so a pacer would be committed to all 26.3 miles." },
  { n: 12, type: "SLEEP", label: "SIESTA — Sedona Posse Grounds",        at: "Sedona Posse Grounds", hrs: 0.75, sleepHrs: 0.75, facility: "Indoor cots", detail: "Peak-heat midday reset before the Schnebly climb in the cool." },
  { n: 13, type: "HANDOFF", label: "Pacer B ON — Sedona",                hrs: 0,    detail: "Gear check here." },
  { n: 14, type: "RUN",   label: "Sedona → Schnebly Hill",               fromMile: 158.8, toMile: 175.7, hrs: 6.25,  pacer: "B" },
  { n: 15, type: "HANDOFF", label: "B off — Schnebly Hill",              hrs: 0.25, detail: "Mandatory: no pacers on the next section." },
  { n: 16, type: "RUN",   label: "Schnebly → Munds Park",                fromMile: 175.7, toMile: 189.6, hrs: 4.75,  pacer: "solo", mandated: true },
  { n: 17, type: "SLEEP", label: "SLEEP — Munds Park",                   at: "Munds Park", hrs: 2.5, sleepHrs: 2.0, facility: "Unheated tents w/ cots", detail: "Plateau nights run upper-30s. Bag and layers must be in the drop bag." },
  { n: 18, type: "HANDOFF", label: "Pacer A ON — Munds Park",            hrs: 0,    detail: "Gear check here." },
  { n: 19, type: "RUN",   label: "Munds Park → Kelly Canyon → Fort Tuthill", fromMile: 189.6, toMile: 210.6, hrs: 8.0, pacer: "A", detail: "No swap possible at Kelly Canyon." },
  { n: 20, type: "SLEEP", label: "NAP — Fort Tuthill",                   at: "Fort Tuthill", hrs: 1.0, sleepHrs: 1.0, facility: "Heated indoor cots", detail: "Mental status evaluation here. Jackie's Elden go/no-go gate." },
  { n: 21, type: "HANDOFF", label: "A off / Pacer B ON — Fort Tuthill",  hrs: 0 },
  { n: 22, type: "RUN",   label: "Fort Tuthill → Walnut Canyon → Wildcat Hill", fromMile: 210.6, toMile: 233.7, hrs: 8.5, pacer: "B",
           detail: "One unbroken shift — the Walnut Canyon swap is unverified for 2027. This is the reassignable block." },
  { n: 23, type: "HANDOFF", label: "B off — Wildcat Hill",               hrs: 0.25, detail: "Mandatory: no pacers to the finish. Jackie's formal go/no-go gate." },
  { n: 24, type: "RUN",   label: "Wildcat Hill → Mt. Elden → Finish",    fromMile: 233.7, toMile: 252.9, hrs: 7.25,  pacer: "solo", mandated: true,
           detail: "+3,386 ft up the New Heart Trail to 9,000 ft, then 2,000 ft down in 2 miles over ~40 technical switchbacks. Night lows ~25°F with sub-zero wind chill." },
];

// ---------------------------------------------------------------------------
// Scenarios. Each is a transform on the base 96-hour block list, so all three
// stay structurally identical and only the durations move. That is what makes a
// mid-race switch mechanical instead of a renegotiation.
// ---------------------------------------------------------------------------
export const SCENARIOS = [
  {
    id: "96",
    label: "96-hour",
    tag: "STRETCH",
    color: "#8a9a5b",   // sage
    blurb: "As originally written. Climbs Mt. Elden overnight, solo, on the fourth night. Take this only if Fort Tuthill arrives ahead of schedule and strong.",
    moveFactor: 1.0,
    overrides: {},
    derived: false,
  },
  {
    id: "100",
    label: "100-hour — Elden at dawn",
    tag: "PRIMARY",
    color: "#c8873f",   // brass — the live plan carries the accent colour
    blurb:
      "The primary plan. A real 3-hour sleep at Fort Tuthill's heated cots, then Elden climbed rested and in daylight instead of at 2 AM in a 25°F wind. Costs a few hours, removes the single worst risk on the course.",
    moveFactor: 1.0,
    // Fort Tuthill nap becomes a full rest-and-resupply; Wildcat becomes a short
    // functional hold to time the Elden start for first light. Elden itself runs
    // an hour faster rested and in daylight.
    overrides: { 20: { hrs: 5.5, sleepHrs: 3.0 }, 23: { hrs: 2.0 }, 24: { hrs: 6.25 } },
    derived: true,
    note:
      "Wildcat Hill has a drop bag but no sleep facility, so the long sleep sits at Fort Tuthill (heated indoor cots) and Wildcat is a 2-hour feet-and-food stop. Block 22 therefore runs overnight with Pacer B, which is the right trade: a paced night section instead of a solo one.",
  },
  {
    id: "110",
    label: "110-hour — fallback",
    tag: "GATE FALLBACK",
    color: "#d9a544",   // amber — caution, not failure
    blurb:
      "What the decision gates drop you into. Movement slows about 7.5% and every sleep block is restored to full length. This is not failure — it is the buffer being spent on the problem it was reserved for.",
    moveFactor: 1.075,
    overrides: {
      2: { hrs: 4.5, sleepHrs: 4.0 },
      10: { hrs: 4.5, sleepHrs: 4.0 },
      12: { hrs: 1.0, sleepHrs: 1.0 },
      17: { hrs: 4.0, sleepHrs: 3.5 },
      20: { hrs: 4.0, sleepHrs: 3.5 },
    },
    derived: true,
    note:
      "Fully modelled. The source plan named a 110-hour fallback at all three gates but never tabulated it — this is the first time it exists as numbers. Movement factor and sleep lengths are a modelling choice; adjust them and every split below recomputes.",
  },
];

// ---------------------------------------------------------------------------
// Builder. Walks the blocks, applies a scenario, and returns blocks stamped with
// clock times plus a flat per-aid-station split table.
// ---------------------------------------------------------------------------

// Clock times are computed as pure arithmetic on elapsed hours against the
// Monday 5:00 AM gun, NOT with Date's local-time getters.
//
// This is deliberate. `new Date(...).getHours()` renders an absolute instant in
// whatever timezone the viewer's device happens to be in, which silently shifted
// every split by the container offset the first time this was written. Crew and
// pacers open this file on phones that may still be on Pacific time, and Arizona
// does not observe DST (MST, UTC-7, year round). Race clock is race clock.
const START_DAY = 1;   // Monday
const START_HOUR = 5;  // 5:00 AM
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtClock(elapsedHrs) {
  const total = START_HOUR + elapsedHrs;
  const dayOffset = Math.floor(total / 24);
  let hourOfDay = total - dayOffset * 24;
  let h = Math.floor(hourOfDay);
  let m = Math.round((hourOfDay - h) * 60);
  if (m === 60) { m = 0; h += 1; }
  const day = DAYS[(START_DAY + dayOffset) % 7];
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${day} ${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export function buildScenario(scenarioId) {
  const sc = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[1];
  let elapsed = 0; // hours since the gun
  const blocks = [];
  const splits = [];

  for (const b of BLOCKS) {
    const ov = sc.overrides[b.n] || {};
    // Movement scales with the scenario; rest and transitions are taken as given.
    const baseHrs = ov.hrs !== undefined ? ov.hrs : b.hrs;
    const hrs = b.type === "RUN" ? +(baseHrs * sc.moveFactor).toFixed(3) : baseHrs;
    const startEl = elapsed;
    const endEl = elapsed + hrs;

    const block = {
      ...b,
      hrs: +hrs.toFixed(2),
      sleepHrs: ov.sleepHrs !== undefined ? ov.sleepHrs : b.sleepHrs,
      startElapsed: startEl,
      endElapsed: endEl,
      startClock: fmtClock(startEl),
      endClock: fmtClock(endEl),
      changed: Object.keys(ov).length > 0 || (b.type === "RUN" && sc.moveFactor !== 1),
    };

    // A RUN block covering several segments gets its hours distributed by effort
    // score, so each station lands somewhere defensible rather than by mileage
    // alone. Single-segment blocks are exact.
    if (b.type === "RUN") {
      const segs = SEGMENTS.filter((s) => s.fromMile >= b.fromMile && s.toMile <= b.toMile);
      const totalEffort = segs.reduce((a, s) => a + effort(s), 0);
      let cursor = startEl;
      block.segments = segs.map((s) => {
        const share = totalEffort > 0 ? effort(s) / totalEffort : 1 / segs.length;
        const segHrs = hrs * share;
        cursor += segHrs;
        const row = {
          station: s.to,
          mile: s.toMile,
          segMiles: s.miles,
          gain: s.gain,
          loss: s.loss,
          hrs: +segHrs.toFixed(2),
          mph: segHrs > 0 ? +(s.miles / segHrs).toFixed(2) : 0,
          elapsed: +cursor.toFixed(2),
          clock: fmtClock(cursor),
          pacer: b.pacer,
          mandated: !!b.mandated,
          blockN: b.n,
          exact: segs.length === 1,
          crew: s.station.crew,
          swap: s.station.swap,
          drop: s.station.drop,
          sleep: s.station.sleep,
          verify: s.station.verify || null,
        };
        splits.push(row);
        return row;
      });
      block.mph = hrs > 0 ? +((b.toMile - b.fromMile) / hrs).toFixed(2) : 0;
      block.miles = +(b.toMile - b.fromMile).toFixed(1);
    }

    blocks.push(block);
    elapsed = endEl;
  }

  const moveHrs = blocks.filter((b) => b.type === "RUN").reduce((a, b) => a + b.hrs, 0);
  const restHrs = blocks.filter((b) => b.type === "SLEEP").reduce((a, b) => a + b.hrs, 0);
  const sleepHrs = blocks.filter((b) => b.type === "SLEEP").reduce((a, b) => a + (b.sleepHrs || 0), 0);
  const transitionHrs = blocks.filter((b) => b.type === "HANDOFF").reduce((a, b) => a + b.hrs, 0);

  return {
    scenario: sc,
    blocks,
    splits,
    totals: {
      elapsed: +elapsed.toFixed(2),
      moveHrs: +moveHrs.toFixed(2),
      restHrs: +restHrs.toFixed(2),
      sleepHrs: +sleepHrs.toFixed(2),
      transitionHrs: +transitionHrs.toFixed(2),
      cutoffMargin: +(RACE.cutoffHours - elapsed).toFixed(2),
      finishClock: fmtClock(elapsed),
      avgMph: +(RACE.miles / elapsed).toFixed(2),
    },
  };
}

// ---------------------------------------------------------------------------
// Decision gates. Pre-committed so race-brain does not get a vote.
// ---------------------------------------------------------------------------
export const GATES = [
  {
    station: "Whiskey Row (Prescott)",
    mile: 75.7,
    owner: "Alex",
    rule: "More than 3 hours behind the target arrival → formally shift to the 110-hour split table.",
    why: "Do not chase. Chasing a Day 1 deficit in the Verde Valley heat is the classic blow-up.",
  },
  {
    station: "Dead Horse Ranch",
    mile: 132.5,
    owner: "Alex",
    rule: "More than 3 hours behind → 110-hour splits, full sleep blocks restored.",
    why: "The buffer exists to be spent on problems, not defended by cutting sleep.",
  },
  {
    station: "Fort Tuthill",
    mile: 210.6,
    owner: "Jackie",
    rule: "Elden go/no-go. If the mental status check is marginal or the split is behind, the 3-hour sleep and dawn start are automatic, not optional.",
    why: "Jackie's checklist call, not the runner's. Quitting is not in Alex's mental model, which removes the internal safety valve — so the authority sits with whoever has the best telemetry.",
    external: true,
  },
];

export const GATE_RATIONALE =
  "A 4-day target held by someone whose engine does not include quitting needs these gates more, not less, than the average runner. The plan's job is to make 'slow down' a scheduled system state instead of a mid-race negotiation.";

// ---------------------------------------------------------------------------
// Open items carried forward from the handoff. Surfaced in the app so they stay
// visible rather than living in a document nobody reopens.
// ---------------------------------------------------------------------------
export const OPEN_ITEMS = [
  { item: "Re-verify every aid station, cutoff, crew access and pacer boundary against the 2027 runner manual", owner: "—", critical: true },
  { item: "Confirm the three owl-closure pacer boundaries for 2027", owner: "—", critical: true },
  { item: "Walnut Canyon crew access and drop bag — unverified for 2027", owner: "—", critical: true },
  { item: "Name Pacer A and Pacer B. Currently roles, not people.", owner: "Alex", critical: false },
  { item: "Build the Logistics document: travel, lodging, race-week timeline, comms, packing, contingencies", owner: "—", critical: false },
  { item: "Sweat sodium concentration test for desert electrolyte planning", owner: "Alex", critical: false },
  { item: "Ankle injury history — decides the BetterGuard brace", owner: "Alex", critical: false },
  { item: "Reconcile heat block duration: Workout Reference says 4 weeks, July supplement says 10–14 days", owner: "—", critical: false },
];
