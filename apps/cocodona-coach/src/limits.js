// limits.js — the guardrails, transcribed from the training plan rather than invented.
//
// Section 8 of Cocodona_250_Training_Plan.docx is titled "Autoregulation: When to
// Back Off" and is already a rule table. This file encodes it verbatim in
// structure, plus the structural limits stated elsewhere in the plan (weekday
// time budget around a 4 AM start, hours as ceilings, down weeks inviolable,
// protect the weekend B2B over weekday runs).
//
// Every threshold is editable in the app and stored per-user. The DEFAULTS are
// the plan's own numbers. Where the plan says something qualitative ("HRV well
// down"), a number had to be chosen to make it testable — those are marked
// `interpreted: true` so it is obvious which lines are the plan's and which are
// a reading of it.

export const DEFAULTS = {
  // --- heart rate ---
  // maxHr is TESTED, not age-predicted, confirmed by Alex. This settles a
  // conflict that ran through the source documents: the heat-acclimation notes
  // configured Karvonen at max 200, while the Brokeoff Mountain log computed off
  // an age-predicted 184 and read an average of 126 bpm as "solid Zone 2". At the
  // tested max that same 126 is Zone 1 — see the note in LIMIT_DOCS.
  maxHr: 200,
  restHr: 45,

  // --- Section 8 autoregulation table ---
  rhrElevatedBpm: 5,          // "Resting HR elevated 5+ bpm..."
  rhrElevatedDays: 2,         // "...for 2+ days"
  hrvDropPct: 15,             // "or HRV well down" — interpreted
  minSleepBeforeKey: 6,       // "Poor sleep (under ~6 hr) before a key long run"
  longRunCutPctLow: 25,       // "Cut the long run by 25-40%"
  longRunCutPctHigh: 40,
  energyCraterDays: 3,        // "Unexplained energy crater lasting several days" — interpreted
  energyCraterScore: 4,       // on the plan's own 1-10 mood/energy scale — interpreted

  // --- structural limits stated elsewhere in the plan ---
  weekdayMaxHrs: 2.0,         // weekday runs are budgeted for a 4 AM start before a 6 AM work day
  peakWeeklyCeilingHrs: 18.0, // "Peak weekly volume of 16-18 hours"; treat as a ceiling
  treatHoursAsCeiling: true,  // "The numbers are targets and ceilings, not mandates"
  protectB2B: true,           // "If something has to give in a hard week, cut a weekday run, not the B2B"
  downWeeksInviolable: true,  // "Feeling great on a down week -> stay on the down week anyway"
};

export const LIMIT_DOCS = [
  { key: "maxHr", label: "Max heart rate", unit: "bpm", source: "Tested",
    verbatim: "Tested, not age-predicted. This resolves the conflict in the source documents: the heat-acclimation notes set Karvonen at max 200, the Brokeoff log used an age-predicted 184. 200 is correct, so every zone below is anchored to a measured number rather than a formula." },
  { key: "restHr", label: "Resting heart rate", unit: "bpm", source: "Heat notes",
    verbatim: "The Karvonen resting figure. Unlike max, this drifts with fitness — the app compares it against your rolling baseline from the feed and flags a material gap." },

  { key: "rhrElevatedBpm", label: "Resting HR elevated by", unit: "bpm",
    source: "Plan §8", verbatim: "Resting HR elevated 5+ bpm for 2+ days, or HRV well down → convert the next quality or long session to easy, or take a rest day. Reassess in 24 hours." },
  { key: "rhrElevatedDays", label: "...for consecutive days", unit: "days", source: "Plan §8" },
  { key: "hrvDropPct", label: "HRV below baseline by", unit: "%", source: "Plan §8", interpreted: true,
    verbatim: "The plan says 'HRV well down' without a number. 15% below your rolling baseline is the threshold used here; change it if your own data says otherwise." },
  { key: "minSleepBeforeKey", label: "Minimum sleep before a key session", unit: "hr",
    source: "Plan §8", verbatim: "Poor sleep (under ~6 hr) before a key long run → cut the long run by 25-40% or move it. Do not stack sleep debt and big volume." },
  { key: "energyCraterScore", label: "Energy crater at or below", unit: "/10", source: "Plan §8", interpreted: true,
    verbatim: "Unexplained energy crater lasting several days → test iron and ferritin before assuming overtraining. Back off volume meanwhile." },
  { key: "energyCraterDays", label: "...sustained for", unit: "days", source: "Plan §8", interpreted: true },
  { key: "weekdayMaxHrs", label: "Weekday session ceiling", unit: "hr", source: "Plan §1",
    verbatim: "Weekday runs are time-budgeted to fit the 4 AM start before a 6 AM work day." },
  { key: "peakWeeklyCeilingHrs", label: "Peak weekly ceiling", unit: "hr", source: "Plan §3",
    verbatim: "Peak weekly volume of 16-18 hours is appropriate and safe. Treat the hours as a ceiling and run the low end; the structure still works at 80%." },
];

// Rules the plan states as absolutes. These are not thresholds to tune — they are
// stops, and the engine will not let a good-looking HRV number override them.
export const HARD_RULES = [
  { id: "pain", label: "Sharp or localized pain, or a limp",
    verbatim: "Stop. Do not run through it. Two easy days now beats two weeks off later." },
  { id: "systemic-illness", label: "Chest symptoms, fever, or body aches",
    verbatim: "Rest until clear, then ease back. Neck and above, easy running is fine." },
];

export function loadLimits(saved) {
  return { ...DEFAULTS, ...(saved || {}) };
}
