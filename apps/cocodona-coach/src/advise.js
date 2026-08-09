// advise.js — the next-day recommendation engine.
//
// Deterministic and explainable by design. It does not "decide" anything the plan
// does not already say; it evaluates the plan's own autoregulation table against
// the day's readiness numbers and reports which rules fired and what each one
// says to do. Every output line traces back to a rule with a source.
//
// The design constraint that matters: this runner's stated failure mode is that
// quitting is not in the mental model, which removes the internal safety valve.
// So a hard stop must never be negotiable by a good-looking number elsewhere.
// Hard rules are evaluated first and cannot be outranked.

import { DAY_ROLES, weekFor, mondayOf } from "./plan.js";

// Severity ladder. Higher wins when several rules fire.
export const VERDICTS = {
  GO:   { rank: 0, label: "Run it as planned",       tone: "good" },
  HOLD: { rank: 1, label: "Hold the plan, add nothing", tone: "neutral" },
  EASY: { rank: 2, label: "Convert to easy",         tone: "warn" },
  CUT:  { rank: 3, label: "Cut the session",         tone: "warn" },
  REST: { rank: 4, label: "Rest day",                tone: "bad" },
  STOP: { rank: 5, label: "Do not run",              tone: "bad" },
};

const isKey = (kind) => kind === "long" || kind === "b2b" || kind === "quality";

// `history` is newest-last, each entry a check-in: {date, rhr, hrv, sleepHrs, energy, ...}
function baselineOf(history, field, days = 21) {
  const vals = history.slice(-days).map((h) => h[field]).filter((v) => typeof v === "number" && v > 0);
  if (vals.length < 3) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const dayBefore = (iso) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

// Consecutive days, counting back from `from`, on which `test` held.
//
// Contiguity is enforced by date, not by array position. Check-ins are sparse in
// real life, and without this a reading from Aug 1 and another from Aug 10 would
// count as a two-day streak and trip a rule that is explicitly about consecutive
// days. A missed day breaks the streak rather than being skipped over.
function streakBack(history, fromDate, test) {
  const byDate = new Map(history.map((h) => [h.date, h]));
  let n = 0;
  let cursor = fromDate;
  while (byDate.has(cursor) && test(byDate.get(cursor))) {
    n++;
    cursor = dayBefore(cursor);
  }
  return n;
}

/**
 * @param date     ISO date string for the day being planned
 * @param history  check-ins oldest-first, INCLUDING today's if entered
 * @param limits   from limits.js
 * @param weekActualHrs hours already logged this week
 */
export function advise({ date, history = [], limits, weekActualHrs = 0 }) {
  // Anchor "today" to the requested date, never to the newest row. Grabbing the
  // last entry silently presents yesterday's readiness as current on any day you
  // have not checked in yet, which is the worst possible failure for this engine.
  const today = history.find((h) => h.date === date) || null;
  const d = new Date(date + "T12:00:00");
  const dow = d.getDay();
  const week = weekFor(date);
  const role = DAY_ROLES[dow];

  const findings = [];
  const push = (f) => findings.push(f);

  // Planned session for the day, from the week's numbers.
  let plannedHrs = null;
  if (week) {
    if (role.kind === "long") plannedHrs = week.longHr;
    else if (role.kind === "b2b") plannedHrs = week.b2bHr;
    else if (week.planned && week.target) {
      // Weekday sessions are not itemised in the weekly summary. Spread whatever
      // the week's planned total leaves after the weekend double across Mon-Fri,
      // then respect the weekday ceiling. Flagged as an estimate in the UI.
      const weekend = (week.longHr || 0) + (week.b2bHr || 0);
      const weekdayPool = Math.max(0, week.planned - weekend);
      const perDay = weekdayPool / 5;
      plannedHrs = role.kind === "recovery" ? +(perDay * 0.6).toFixed(1) : +perDay.toFixed(1);
    }
  }
  const plannedEstimated = !!week && role.kind !== "long" && role.kind !== "b2b";

  // ---------------------------------------------------------------------------
  // HARD RULES — evaluated first, cannot be outranked.
  // ---------------------------------------------------------------------------
  if (today && today.pain === "sharp") {
    push({ verdict: "STOP", rule: "Sharp or localized pain, or a limp", source: "Plan §8", hard: true,
      says: "Stop. Do not run through it. Two easy days now beats two weeks off later.",
      evidence: "You logged sharp or localized pain today." });
  }
  if (today && today.illness === "systemic") {
    push({ verdict: "STOP", rule: "Chest symptoms, fever, or body aches", source: "Plan §8", hard: true,
      says: "Rest until clear, then ease back in.",
      evidence: "You logged systemic illness today." });
  }

  // ---------------------------------------------------------------------------
  // AUTOREGULATION — Section 8's table.
  // ---------------------------------------------------------------------------
  // Baselines exclude the day being judged so a bad day cannot raise its own bar.
  const prior = history.filter((h) => h.date < date);
  const rhrBase = baselineOf(prior, "rhr");
  const hrvBase = baselineOf(prior, "hrv");

  const streak = today && rhrBase != null
    ? streakBack(history, date, (h) => typeof h.rhr === "number" && h.rhr >= rhrBase + limits.rhrElevatedBpm)
    : 0;
  if (streak >= limits.rhrElevatedDays) {
    push({
      verdict: isKey(role.kind) ? "EASY" : "GO",
      rule: `Resting HR elevated ${limits.rhrElevatedBpm}+ bpm for ${limits.rhrElevatedDays}+ days`,
      source: "Plan §8",
      says: isKey(role.kind)
        ? "Convert the next quality or long session to easy, or take a rest day. Reassess in 24 hours."
        : "Today is not a key session, so there is nothing to convert. Hold it easy and reassess in 24 hours.",
      evidence: `RHR has been ≥ ${(rhrBase + limits.rhrElevatedBpm).toFixed(0)} bpm (baseline ${rhrBase.toFixed(0)} + ${limits.rhrElevatedBpm}) for ${streak} straight days.`,
    });
  }

  if (today && typeof today.hrv === "number" && hrvBase != null) {
    const dropPct = ((hrvBase - today.hrv) / hrvBase) * 100;
    if (dropPct >= limits.hrvDropPct) {
      push({
        verdict: isKey(role.kind) ? "EASY" : "GO",
        rule: `HRV ${limits.hrvDropPct}%+ below baseline`, source: "Plan §8", interpreted: true,
        says: "Same action as an elevated resting HR: convert the key session to easy, or rest. Reassess in 24 hours.",
        evidence: `HRV ${today.hrv} ms against a ${hrvBase.toFixed(0)} ms baseline — down ${dropPct.toFixed(0)}%.`,
      });
    }
  }

  if (today && typeof today.sleepHrs === "number" && today.sleepHrs < limits.minSleepBeforeKey && isKey(role.kind)) {
    push({
      verdict: "CUT",
      rule: `Under ${limits.minSleepBeforeKey} hr sleep before a key session`, source: "Plan §8",
      says: `Cut it by ${limits.longRunCutPctLow}-${limits.longRunCutPctHigh}% or move it. Do not stack sleep debt and big volume.`,
      evidence: `${today.sleepHrs} hr of sleep, and today is a ${role.role.toLowerCase()}.`,
      cut: [limits.longRunCutPctLow, limits.longRunCutPctHigh],
    });
  }

  const craterDays = today
    ? streakBack(history, date, (h) => typeof h.energy === "number" && h.energy <= limits.energyCraterScore)
    : 0;
  if (craterDays >= limits.energyCraterDays) {
    push({
      verdict: "EASY",
      rule: "Unexplained energy crater lasting several days", source: "Plan §8",
      says: "Test iron and ferritin before assuming overtraining. Back off volume meanwhile.",
      evidence: `Energy at or below ${limits.energyCraterScore}/10 for ${craterDays} straight days. Given the prior low-iron history and the Ecuador altitude block, this is the flagged pathway — not a motivation problem.`,
      action: "iron-panel",
    });
  }

  if (today && today.illness === "above-neck") {
    push({ verdict: "EASY", rule: "Getting sick, neck and above", source: "Plan §8",
      says: "Easy running is fine. Chest, fever or body aches would be a full stop instead.",
      evidence: "You logged above-the-neck symptoms today." });
  }

  if (today && today.pain === "dull") {
    push({ verdict: "EASY", rule: "Niggle short of sharp pain", source: "Plan §8", interpreted: true,
      says: "Not the plan's stop criterion, which is sharp or localized pain. Keep it easy and track it over days — the plan asks for niggles logged over time.",
      evidence: "You logged a dull ache today." });
  }

  if (today && today.lifeLoad === "spike") {
    push({
      verdict: role.kind === "b2b" || role.kind === "long" ? "GO" : "REST",
      rule: "Life or work load spike", source: "Plan §8",
      says: "Drop a weekday run first, protect the weekend B2B, hold the easy discipline.",
      evidence: role.kind === "b2b" || role.kind === "long"
        ? "Load is spiking, but this is the weekend double — the plan protects it above weekday running."
        : "Load is spiking and this is a weekday run, which is what the plan says to drop first.",
    });
  }

  // ---------------------------------------------------------------------------
  // STRUCTURAL LIMITS
  // ---------------------------------------------------------------------------
  if (week && week.down && limits.downWeeksInviolable) {
    push({
      verdict: "HOLD",
      rule: week.mandatoryDown ? "Down week — MANDATORY" : "Down week", source: "Plan §8",
      says: "Stay on the down week anyway. The whole point is to absorb. Feeling great is not a reason to add.",
      evidence: `Week ${week.wk} is a down week at a ${week.target} hr target.`,
    });
  }

  if (week && week.target && limits.treatHoursAsCeiling && weekActualHrs >= week.target) {
    push({
      verdict: "HOLD",
      rule: "Weekly hours are a ceiling, not a quota", source: "Plan §1 / §3",
      says: "The structure still works at 80%. There is no credit for exceeding the ceiling.",
      evidence: `${weekActualHrs.toFixed(1)} hr logged against a ${week.target} hr target.`,
    });
  }

  const weekday = dow >= 1 && dow <= 5;
  if (weekday && plannedHrs && plannedHrs > limits.weekdayMaxHrs) {
    push({
      verdict: "CUT",
      rule: `Weekday sessions capped at ${limits.weekdayMaxHrs} hr`, source: "Plan §1",
      says: "Weekday runs are budgeted around the 4 AM start before a 6 AM work day. Move the overflow to the weekend rather than shortening sleep.",
      evidence: `Estimated ${plannedHrs} hr on a weekday.`,
    });
  }

  // ---------------------------------------------------------------------------
  // RESOLVE
  // ---------------------------------------------------------------------------
  const hard = findings.filter((f) => f.hard);
  const pool = hard.length ? hard : findings;
  const verdict = pool.reduce((acc, f) => (VERDICTS[f.verdict].rank > VERDICTS[acc].rank ? f.verdict : acc), "GO");

  // Translate the verdict into an actual session.
  let session = { hrs: plannedHrs, effort: role.kind === "quality" ? "quality" : "easy", note: role.note };
  if (verdict === "STOP" || verdict === "REST") {
    session = { hrs: 0, effort: "rest", note: verdict === "STOP" ? "No running today." : "Full rest day." };
  } else if (verdict === "CUT") {
    const cutRule = findings.find((f) => f.cut);
    const pct = cutRule ? cutRule.cut[1] : null;
    const capped = weekday ? Math.min(plannedHrs || 0, limits.weekdayMaxHrs) : plannedHrs || 0;
    const reduced = pct ? +((plannedHrs || 0) * (1 - pct / 100)).toFixed(1) : capped;
    session = { hrs: Math.min(reduced, capped) || null, effort: "easy",
                note: pct ? `Reduced ${pct}% from ${plannedHrs} hr.` : `Capped at the weekday ceiling.` };
  } else if (verdict === "EASY") {
    session = { hrs: plannedHrs, effort: "easy", note: "Same duration, all easy. No quality." };
  }

  return {
    date, dow, role, week, verdict, verdictInfo: VERDICTS[verdict],
    plannedHrs, plannedEstimated, session, findings,
    baselines: { rhr: rhrBase, hrv: hrvBase },
    checkedIn: !!today,
    weekActualHrs,
  };
}
