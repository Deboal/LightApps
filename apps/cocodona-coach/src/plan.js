// plan.js — the 47-week training plan, machine-readable.
//
// PROVENANCE: transcribed from the handoff package's weekly-summary.csv, which
// came from the Weekly Summary tab of Cocodona_250_Training_Tracker.xlsx
// (Box file ID 2267119561488). Block narrative from Cocodona_250_Training_Plan.docx.
//
// `target` is the week's TARGET hours and `planned` is what the day-by-day
// schedule actually adds up to. They differ on purpose: the plan document is
// explicit that targets are ceilings to be earned, not quotas to be hit.

export const RACE_DATE = "2027-05-03"; // Monday, 5:00 AM

// wk, weekOf (Monday), block, wksToRace, target, planned, longHr, b2bHr, focus
export const WEEKS = [
  [1, "2026-06-08", "Pre-Ecuador Primer", 47, 6.0, 7.0, 2.0, 1.3, "Pre-Ecuador. Sharpen for altitude. Weighted pack hikes double as Cocodona power-hike work. Keep legs fresh."],
  [2, "2026-06-15", "Pre-Ecuador Primer", 46, 4.0, 2.1, 1.5, null, "Travel + acclimatization start. Fly to Quito, transfer to San Cuco base. Running drops to short shakeouts; the mountain is the work now."],
  [3, "2026-06-22", "Ecuador Expedition (Cotopaxi + Chimborazo)", 45, null, 0.0, null, null, "EXPEDITION WEEK. Cotopaxi and Chimborazo. No structured running. Massive aerobic and altitude stimulus."],
  [4, "2026-06-29", "Post-Altitude Re-Entry", 44, 4.0, 4.6, 1.5, 1.0, "Post-altitude re-entry. Very easy only. Expect travel fatigue and depressed iron after altitude. No quality. Sleep is the priority."],
  [5, "2026-07-06", "Aerobic Base", 43, 8.0, 7.0, 2.0, 1.3, "Base begins. All easy aerobic, nasal-breathing pace. Rebuild running-specific durability after the expedition."],
  [6, "2026-07-13", "Aerobic Base", 42, 9.0, 7.5, 2.3, 1.5, "Add strides twice weekly. Hold easy discipline."],
  [7, "2026-07-20", "Aerobic Base", 41, 10.5, 8.6, 2.8, 1.8, "First real back-to-back weekend. Practice fueling on anything over 2 hours."],
  [8, "2026-07-27", "Aerobic Base", 40, 7.5, 7.0, 2.0, 1.3, "Down week. Cut volume ~30%. Absorb the work, check sleep and resting HR trends."],
  [9, "2026-08-03", "Aerobic Base", 39, 11.0, 9.1, 3.0, 2.0, "Step volume back up. Long run moves onto rolling trail."],
  [10, "2026-08-10", "Aerobic Base", 38, 12.0, 10.3, 3.5, 2.3, "Biggest base week. Strong B2B weekend."],
  [11, "2026-08-17", "Aerobic Base", 37, 11.5, 10.0, 3.3, 2.3, "Strong base week. Keep stacking time on feet before the vertical block opens."],
  [12, "2026-08-24", "Aerobic Base", 36, 11.0, 10.0, 3.3, 2.3, "Close base block. Confirm aerobic gains before shifting to vertical."],
  [13, "2026-08-31", "Strength & Vertical", 35, 9.5, 8.2, null, 2.0, "Vertical block opens with the Colby Mountain 24K on Saturday Sep 5. Introduce hill work early, ease Thu/Fri, race Sat as a hard tune-up, easy Sunday."],
  [14, "2026-09-07", "Strength & Vertical", 34, 11.5, 11.5, 4.0, 2.8, "Vert target ramps. Hike the steep, run the runnable. Train descents deliberately for quad armor."],
  [15, "2026-09-14", "Strength & Vertical", 33, 8.5, 9.4, 3.0, 2.0, "Down week. Keep one short hill session, drop volume. Mobility and tissue care."],
  [16, "2026-09-21", "Strength & Vertical", 32, 12.0, 12.6, 4.5, 3.0, "Big vert weekend. Long run climbs and descends with full hydration kit."],
  [17, "2026-09-28", "Strength & Vertical", 31, 13.0, 13.6, 5.0, 3.5, "Peak of the vertical block. Longest sustained climbing to date."],
  [18, "2026-10-05", "Strength & Vertical", 30, 9.0, 8.7, null, 2.0, "Bizz Johnson 50K on Sunday. Net-downhill, fast: run it as a quad-pounding fitness test and long descent rehearsal, not an all-out PR effort."],
  [19, "2026-10-12", "Strength & Vertical", 29, 8.0, 9.4, 3.0, 2.0, "Recovery from Bizz. Legs will feel the downhill. Easy and short until the eccentric soreness clears."],
  [20, "2026-10-19", "Volume Consolidation", 28, 11.0, 11.8, 4.0, 3.0, "Volume consolidation begins. Reintroduce volume on fresh legs. First night-running session this block."],
  [21, "2026-10-26", "Volume Consolidation", 27, 12.0, 12.9, 4.5, 3.3, "B2B weekend grows. Add a headlamp segment to one long run."],
  [22, "2026-11-02", "Volume Consolidation", 26, 13.0, 13.9, 5.0, 3.5, "Strong build. Time on feet is the currency now, not pace."],
  [23, "2026-11-09", "Volume Consolidation", 25, 13.5, 14.6, 5.5, 3.8, "Largest fall B2B weekend. Rehearse full kit, poles, and real-food fueling."],
  [24, "2026-11-16", "Volume Consolidation", 24, 9.5, 10.8, 3.5, 2.5, "Down week. Recover and reset before the optional December effort."],
  [25, "2026-11-23", "Volume Consolidation", 23, 12.5, 13.6, 5.0, 3.5, "Thanksgiving week. Long run early, protect the weekend B2B. Travel-proof the plan."],
  [26, "2026-11-30", "Volume Consolidation", 22, 12.5, 13.6, 5.0, 3.5, "Strong build to close the volume block. Full kit on the long run; keep the night-running habit alive."],
  [27, "2026-12-07", "Volume Consolidation", 21, 9.0, 11.3, 4.0, 2.5, "Down week. Reset and bridge into the race-specific block with fresh legs."],
  [28, "2026-12-14", "Race-Specific (Black Canyon build)", 20, 12.0, 13.4, 4.5, 3.5, "Race-specific block begins. Everything now points at Black Canyon and Cocodona. Long runs start carrying full race kit."],
  [29, "2026-12-21", "Race-Specific (Black Canyon build)", 19, 11.0, 12.4, 4.0, 3.0, "Holiday week and pre-race week for Across the Years. Front-load easy long work early, then freshen up for the 24-hour on Dec 29."],
  [30, "2026-12-28", "Race-Specific (Black Canyon build)", 18, 10.0, 12.4, null, null, "ACROSS THE YEARS 24-HOUR, Tue Dec 29 (start 9 AM) to Wed Dec 30. Race the 24-hour as a multi-day, overnight, and sleep-strategy rehearsal, then recover."],
  [31, "2027-01-04", "Race-Specific (Black Canyon build)", 17, 9.0, 11.0, 3.5, 2.5, "Recovery from Across the Years and a natural point to check iron and ferritin given prior history and the altitude block."],
  [32, "2027-01-11", "Race-Specific (Black Canyon build)", 16, 13.0, 14.6, 5.5, 3.8, "Rebuild specific volume on Black-Canyon-style terrain. Dial caffeine and fueling timing exactly as you will race it."],
  [33, "2027-01-18", "Race-Specific (Black Canyon build)", 15, 14.0, 15.6, 6.0, 4.0, "Big specific weekend. Full race kit and exact fueling. This and next weekend are your largest before the Black Canyon taper."],
  [34, "2027-01-25", "Race-Specific (Black Canyon build)", 14, 14.0, 16.1, 6.0, 4.3, "Largest weekend before Black Canyon taper. Night segment plus dawn second run."],
  [35, "2027-02-01", "Race-Specific (Black Canyon build)", 13, 13.0, 15.1, 5.5, 4.0, "Begin pulling back slightly. Sharpen, do not add. Lock crew and drop-bag plan for Black Canyon."],
  [36, "2027-02-08", "Race-Specific (Black Canyon build)", 12, 8.0, 18.0, null, 2.0, "BLACK CANYON 100K on Saturday Feb 13 (full dress rehearsal). Taper Mon-Thu, travel Fri, race Sat. Same kit, fueling, pacing, crew workflow."],
  [37, "2027-02-15", "Race-Specific (Black Canyon build)", 11, 8.0, 9.6, 3.0, 2.0, "Recover from the 100K. Easy and unstructured. Write the after-action review while it is fresh."],
  [38, "2027-02-22", "Peak & Multi-Day Simulation", 10, 14.0, 16.1, 6.0, 4.5, "Peak block begins. Biggest training load of the cycle. Long runs now push past anything you have done this year."],
  [39, "2027-03-01", "Peak & Multi-Day Simulation", 9, 12.0, 12.2, null, 3.0, "OPTIONAL Way Too Cool 50K on Saturday Mar 6 as a fast sharpener. Run controlled, not all-out. Use as the weekend long."],
  [40, "2027-03-08", "Peak & Multi-Day Simulation", 8, 16.0, 17.9, 7.0, 5.0, "First giant B2B weekend. Sat 7 hr, Sun 5 hr on tired legs. This is the specific adaptation for a 250."],
  [41, "2027-03-15", "Peak & Multi-Day Simulation", 7, 17.0, 19.6, 8.0, 5.5, "Three-day simulation over the weekend: Fri medium, Sat long, Sun long. Practice running on under-slept legs."],
  [42, "2027-03-22", "Peak & Multi-Day Simulation", 6, 12.0, 13.9, 5.0, 3.5, "Down week inside the peak. MANDATORY. You cannot build through this much load without absorbing it."],
  [43, "2027-03-29", "Peak & Multi-Day Simulation", 5, 18.0, 20.1, 8.0, 6.0, "Largest weekend of the entire plan. Overnight effort into a dawn second long run. Begin heat exposure."],
  [44, "2027-04-05", "Peak & Multi-Day Simulation", 4, 16.0, 17.9, 7.0, 5.0, "Heat acclimation protocol starts in earnest (4 weeks out). Volume still high but trending down. Last big B2B."],
  [45, "2027-04-12", "Peak & Multi-Day Simulation", 3, 13.0, 14.1, 5.0, 3.5, "Last solid week before taper. Heat sessions continue. Finalize logistics, crew, pacers, drop bags."],
  [46, "2027-04-19", "Taper & Travel", 2, 9.0, 9.5, 3.0, 2.0, "Taper week 1. Volume drops ~40%, keep a little intensity to stay sharp. Sleep bank. Confirm every logistic."],
  [47, "2027-04-26", "Taper & Travel", 1, 5.0, 1.5, 1.5, null, "Race week. Minimal volume, frequent short shakeouts. Travel to Arizona Thu/Fri. Final gear and drop-bag check."],
  [48, "2027-05-03", "Race", 0, null, 0.0, null, null, "COCODONA 250 race day."],
].map(([wk, weekOf, block, wksToRace, target, planned, longHr, b2bHr, focus]) => ({
  wk, weekOf, block, wksToRace, target, planned, longHr, b2bHr, focus,
  // A down week is one whose target drops against the week before. Detected
  // rather than hand-tagged so it cannot fall out of sync with the numbers.
  down: /[Dd]own week/.test(focus),
  mandatoryDown: /MANDATORY/.test(focus),
  race: /\b(100K|24-HOUR|24K|50K|COCODONA)\b/.test(focus),
}));

// Standing weekly session architecture (plan Section 6). 0 = Sunday.
export const DAY_ROLES = {
  1: { role: "Recovery + mobility", kind: "recovery", note: "Easy shakeout or rest after the weekend double, plus mobility. Optional if legs are flat." },
  2: { role: "Quality A", kind: "quality", note: "Strides in base; hill repeats in the vertical block; climb intervals and race-effort climbs later." },
  3: { role: "Easy + strength (lower/core)", kind: "easy", note: "Aerobic run plus durability lifting and trunk work." },
  4: { role: "Quality B / midweek medium-long", kind: "quality", note: "The midweek longer effort; gains a night segment and race terrain as the cycle progresses." },
  5: { role: "Easy + strength (upper/core)", kind: "easy", note: "Recovery run plus the second strength session. Eases off near the peak and taper." },
  6: { role: "Long run", kind: "long", note: "The primary long effort. Grows from 2 hr in base to 8 hr at peak." },
  0: { role: "Back-to-back long run", kind: "b2b", note: "Second long run on tired legs. The most race-specific session of the week." },
};

// Karvonen zones. RHR 45 / max 200 per the heat-acclimation supplement's stated
// tool configuration.
export const HR = { rest: 45, max: 200 };

export function zones(rest = HR.rest, max = HR.max) {
  const hrr = max - rest;
  const z = (lo, hi) => [Math.round(rest + hrr * lo), Math.round(rest + hrr * hi)];
  return [
    { name: "Z1 Recovery", range: z(0.5, 0.6) },
    { name: "Z2 Aerobic", range: z(0.6, 0.7) },
    { name: "Z3 Tempo", range: z(0.7, 0.8) },
    { name: "Z4 Threshold", range: z(0.8, 0.9) },
    { name: "Z5 VO2", range: z(0.9, 1.0) },
  ];
}

// --- date helpers -----------------------------------------------------------

export function mondayOf(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x.toISOString().slice(0, 10);
}

export function weekFor(dateStr) {
  const monday = mondayOf(dateStr);
  return WEEKS.find((w) => w.weekOf === monday) || null;
}

export function daysToRace(dateStr) {
  return Math.round((new Date(RACE_DATE) - new Date(dateStr)) / 86400e3);
}

export const TOTAL_TARGET_HOURS = WEEKS.reduce((a, w) => a + (w.target || 0), 0);
