// daily.js — the actual day-by-day plan. GENERATED, do not hand-edit.
//
// Source: Cocodona_250_Training_Tracker.xlsx, "Daily Log" tab, Box file
// 2267119561488. Extracted 330 rows covering 2026-06-08 to 2027-05-03.
//
// This replaces the week-level estimate the coach app previously used for
// weekday sessions. That estimate spread a week's planned hours evenly across
// Mon-Fri, which is an average of the plan rather than the plan: it could not
// tell a Tuesday hill session from a Wednesday strength day, and it silently
// invented durations the tracker states outright.
//
// SESSIONS is deduped — the same Friday strength text appears in ~47 rows — and
// DAYS references it by index. Regenerate with scratchpad/extract_daily.py.

export const PLAN_BLOCKS = [
  "Pre-Ecuador Primer",
  "Ecuador Expedition (Cotopaxi + Chimborazo)",
  "Post-Altitude Re-Entry",
  "Aerobic Base",
  "Strength & Vertical",
  "Volume Consolidation",
  "Race-Specific (Black Canyon build)",
  "Peak & Multi-Day Simulation",
  "Taper & Travel",
  "Race"
];

export const SESSIONS = [
  {
    "name": "Recovery + mobility",
    "detail": "Easy 30 to 40 min shakeout or rest, plus 15 min mobility. Optional if legs are flat after the weekend B2B."
  },
  {
    "name": "Easy + strides",
    "detail": "Easy 40 to 50 min plus a few strides to stay sharp."
  },
  {
    "name": "Easy + Strength (lower + core)",
    "detail": "Easy 40 to 50 min, then Hinge, single-leg, step-ups, calf/tibialis, posterior chain, anti-rotation core. 35 to 45 min. Heavy-ish, low rep, durability focus. Trains the trunk you want visible without compromising run legs."
  },
  {
    "name": "Medium-long",
    "detail": "1 hr steady aerobic."
  },
  {
    "name": "Easy + Strength (upper + core)",
    "detail": "Easy 30 to 40 min, then Push/pull, carries, hanging core, trunk stability. 30 to 40 min. Keep the upper body robust for poles, packs, and posture late in a 250."
  },
  {
    "name": "Long run (2 hr)",
    "detail": "Long run 2 hr easy, controlled. Maintain feel without digging a hole."
  },
  {
    "name": "B2B long run (1 hr 15 min)",
    "detail": "Back-to-back long run 1 hr 15 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Travel",
    "detail": "Fly to Quito. Hydrate aggressively, compression on the flight, easy mobility on arrival."
  },
  {
    "name": "Acclimatize",
    "detail": "Transfer toward San Cuco base. Easy walking only. Begin altitude acclimatization. Eat and sleep."
  },
  {
    "name": "Ecuador - Acclimatize",
    "detail": "San Augustin de Callo area. Acclimatization hike, light load, conversational. Monitor for AMS symptoms."
  },
  {
    "name": "Ecuador - Acclimatize",
    "detail": "Higher acclimatization hike. Hydrate, fuel, rest. Build red-cell response before the big objectives."
  },
  {
    "name": "Ecuador - Cotopaxi approach",
    "detail": "Move to Refugio Jose Rivas (approx 15,750 ft). Gear check, rest, early to bed for alpine start."
  },
  {
    "name": "Ecuador - Cotopaxi summit",
    "detail": "Alpine start, summit Cotopaxi (approx 19,347 ft). Long day on the rope. Descend, recover, rehydrate."
  },
  {
    "name": "Ecuador - Recover / transfer",
    "detail": "Active recovery and transfer toward Chimborazo. Easy legs, big calories, sleep."
  },
  {
    "name": "Ecuador - Chimborazo High Camp",
    "detail": "Move to High Camp. Final gear prep. Rest for the largest objective."
  },
  {
    "name": "Ecuador - Chimborazo summit",
    "detail": "Alpine start, summit Chimborazo (approx 20,548 ft). The big one. Descend carefully, eat, hydrate."
  },
  {
    "name": "Ecuador - Descend / celebrate",
    "detail": "Descend and recover. Expedition objectives complete. Begin rehydration and refueling in earnest."
  },
  {
    "name": "Travel home",
    "detail": "Fly home. Compression, hydration, movement in transit. Do not run today."
  },
  {
    "name": "Rest / walk",
    "detail": "Full rest or an easy 20 to 30 min walk. Let altitude and travel fatigue clear."
  },
  {
    "name": "Easy aerobic",
    "detail": "Easy 30 to 40 min, flat and relaxed. Reintroduce running gently."
  },
  {
    "name": "Easy + light strength",
    "detail": "Easy 30 to 40 min. Optional light, low-load strength. No intensity yet."
  },
  {
    "name": "Easy aerobic",
    "detail": "Easy 45 min on soft surface. Keep it conversational."
  },
  {
    "name": "Rest",
    "detail": "Full rest. Sleep, hydrate, refuel iron stores with red meat and a vitamin C pairing."
  },
  {
    "name": "Long run (1 hr 30 min)",
    "detail": "Long run 1 hr 30 min easy, controlled. Maintain feel without digging a hole."
  },
  {
    "name": "B2B long run (1 hr)",
    "detail": "Back-to-back long run 1 hr, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Easy + strides",
    "detail": "Easy aerobic 40 to 50 min, then 6 to 8 x 20 sec relaxed strides. Stay nasal-breathing easy."
  },
  {
    "name": "Aerobic medium-long",
    "detail": "1 hr steady aerobic on rolling trail. Hold easy discipline. Fuel if over 75 min."
  },
  {
    "name": "Long run (2 hr)",
    "detail": "Long run 2 hr easy aerobic on rolling trail. Fuel 60 to 80 g carb/hr past the first hour. Practice on-the-move eating and drinking."
  },
  {
    "name": "Long run (2 hr 15 min)",
    "detail": "Long run 2 hr 15 min easy aerobic on rolling trail. Fuel 60 to 80 g carb/hr past the first hour. Practice on-the-move eating and drinking."
  },
  {
    "name": "B2B long run (1 hr 30 min)",
    "detail": "Back-to-back long run 1 hr 30 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Easy + strides",
    "detail": "Easy aerobic 45 to 60 min, then 6 to 8 x 20 sec relaxed strides. Stay nasal-breathing easy."
  },
  {
    "name": "Easy + Strength (lower + core)",
    "detail": "Easy 45 to 60 min, then Hinge, single-leg, step-ups, calf/tibialis, posterior chain, anti-rotation core. 35 to 45 min. Heavy-ish, low rep, durability focus. Trains the trunk you want visible without compromising run legs."
  },
  {
    "name": "Aerobic medium-long",
    "detail": "1 hr 15 min steady aerobic on rolling trail. Hold easy discipline. Fuel if over 75 min."
  },
  {
    "name": "Long run (2 hr 45 min)",
    "detail": "Long run 2 hr 45 min easy aerobic on rolling trail. Fuel 60 to 80 g carb/hr past the first hour. Practice on-the-move eating and drinking."
  },
  {
    "name": "B2B long run (1 hr 45 min)",
    "detail": "Back-to-back long run 1 hr 45 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Long run (3 hr)",
    "detail": "Long run 3 hr easy aerobic on rolling trail. Fuel 60 to 80 g carb/hr past the first hour. Practice on-the-move eating and drinking."
  },
  {
    "name": "B2B long run (2 hr)",
    "detail": "Back-to-back long run 2 hr, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Aerobic medium-long",
    "detail": "1 hr 30 min steady aerobic on rolling trail. Hold easy discipline. Fuel if over 75 min."
  },
  {
    "name": "Long run (3 hr 30 min)",
    "detail": "Long run 3 hr 30 min easy aerobic on rolling trail. Fuel 60 to 80 g carb/hr past the first hour. Practice on-the-move eating and drinking."
  },
  {
    "name": "B2B long run (2 hr 15 min)",
    "detail": "Back-to-back long run 2 hr 15 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Long run (3 hr 15 min)",
    "detail": "Long run 3 hr 15 min easy aerobic on rolling trail. Fuel 60 to 80 g carb/hr past the first hour. Practice on-the-move eating and drinking."
  },
  {
    "name": "Recovery jog",
    "detail": "Easy 25 to 35 min plus mobility. Loosen up, nothing taxing."
  },
  {
    "name": "Hill repeats",
    "detail": "15 min warm-up, then 6 to 10 x 2 min uphill hard / jog down. Power-hike the last 2 reps. Cool down. ~45 to 60 min total moving."
  },
  {
    "name": "Easy + light strides",
    "detail": "Easy 35 to 45 min with a few strides. Sharpen, do not fatigue. Race is close."
  },
  {
    "name": "RACE: Colby Mountain 24K",
    "detail": "High-country tune-up in your backyard (Lassen NF, Butte Meadows). Run it hard as a fitness check on technical terrain. Approx 15 mi at elevation. Practice the full race-morning routine and fueling."
  },
  {
    "name": "Vert medium-long",
    "detail": "1 hr 30 min with deliberate climbing and controlled descents. Power-hike the steep, run the rest."
  },
  {
    "name": "Long run (4 hr)",
    "detail": "Long run 4 hr with significant vert. Hike the steep climbs with intent, run everything runnable, descend with control to build quad durability."
  },
  {
    "name": "B2B long run (2 hr 45 min)",
    "detail": "Back-to-back long run 2 hr 45 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Vert medium-long",
    "detail": "1 hr 15 min with deliberate climbing and controlled descents. Power-hike the steep, run the rest."
  },
  {
    "name": "Long run (3 hr)",
    "detail": "Long run 3 hr with significant vert. Hike the steep climbs with intent, run everything runnable, descend with control to build quad durability."
  },
  {
    "name": "Hill repeats",
    "detail": "15 min warm-up, then 6 to 10 x 2 min uphill hard / jog down. Power-hike the last 2 reps. Cool down. ~50 to 70 min total moving."
  },
  {
    "name": "Easy + Strength (lower + core)",
    "detail": "Easy 50 to 70 min, then Hinge, single-leg, step-ups, calf/tibialis, posterior chain, anti-rotation core. 35 to 45 min. Heavy-ish, low rep, durability focus. Trains the trunk you want visible without compromising run legs."
  },
  {
    "name": "Vert medium-long",
    "detail": "1 hr 45 min with deliberate climbing and controlled descents. Power-hike the steep, run the rest."
  },
  {
    "name": "Long run (4 hr 30 min)",
    "detail": "Long run 4 hr 30 min with significant vert. Hike the steep climbs with intent, run everything runnable, descend with control to build quad durability."
  },
  {
    "name": "B2B long run (3 hr)",
    "detail": "Back-to-back long run 3 hr, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Long run (5 hr)",
    "detail": "Long run 5 hr with significant vert. Hike the steep climbs with intent, run everything runnable, descend with control to build quad durability."
  },
  {
    "name": "B2B long run (3 hr 30 min)",
    "detail": "Back-to-back long run 3 hr 30 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Easy or rest",
    "detail": "Race or optional event handles the load this week. Otherwise easy 45 to 60 min."
  },
  {
    "name": "RACE: Bizz Johnson 50K",
    "detail": "Net-downhill, fast course (approx 1,300 ft descent over final 20 mi). Run controlled-strong. This is your long descent rehearsal: relax the quads, land soft, fuel every 30 min. Not an all-out PR day."
  },
  {
    "name": "Rolling steady",
    "detail": "45 to 60 min on rolling terrain at steady aerobic effort. Controlled, not a workout. Strides if fresh."
  },
  {
    "name": "Medium-long + night",
    "detail": "1 hr 30 min aerobic. Once this block, run the last 30 min in the dark with a headlamp to start night practice."
  },
  {
    "name": "Long run (4 hr)",
    "detail": "Long run 4 hr, time-on-feet focus. Carry full hydration kit and poles. Add a headlamp segment when the duration runs into darkness."
  },
  {
    "name": "Rolling steady",
    "detail": "50 to 70 min on rolling terrain at steady aerobic effort. Controlled, not a workout. Strides if fresh."
  },
  {
    "name": "Medium-long + night",
    "detail": "1 hr 45 min aerobic. Once this block, run the last 30 min in the dark with a headlamp to start night practice."
  },
  {
    "name": "Long run (4 hr 30 min)",
    "detail": "Long run 4 hr 30 min, time-on-feet focus. Carry full hydration kit and poles. Add a headlamp segment when the duration runs into darkness."
  },
  {
    "name": "B2B long run (3 hr 15 min)",
    "detail": "Back-to-back long run 3 hr 15 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Medium-long + night",
    "detail": "2 hr aerobic. Once this block, run the last 30 min in the dark with a headlamp to start night practice."
  },
  {
    "name": "Long run (5 hr)",
    "detail": "Long run 5 hr, time-on-feet focus. Carry full hydration kit and poles. Add a headlamp segment when the duration runs into darkness."
  },
  {
    "name": "Long run (5 hr 30 min)",
    "detail": "Long run 5 hr 30 min, time-on-feet focus. Carry full hydration kit and poles. Add a headlamp segment when the duration runs into darkness."
  },
  {
    "name": "B2B long run (3 hr 45 min)",
    "detail": "Back-to-back long run 3 hr 45 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Long run (3 hr 30 min)",
    "detail": "Long run 3 hr 30 min, time-on-feet focus. Carry full hydration kit and poles. Add a headlamp segment when the duration runs into darkness."
  },
  {
    "name": "B2B long run (2 hr 30 min)",
    "detail": "Back-to-back long run 2 hr 30 min, easy effort on tired legs from Saturday. The adaptation is in the fatigue, not the speed. Keep fueling steady."
  },
  {
    "name": "Climb intervals",
    "detail": "Sustained climbing: 3 to 4 x 8 to 10 min uphill at strong-steady, power-hike the steepest pitches. Run the descents relaxed."
  },
  {
    "name": "Race-terrain medium-long",
    "detail": "1 hr 45 min on terrain like Black Canyon: runnable grade plus a technical descent. Carry the vest, practice fueling."
  },
  {
    "name": "Long run (4 hr 30 min)",
    "detail": "Long run 4 hr 30 min in full race kit on Black-Canyon-style terrain. Exact race fueling, electrolytes, and caffeine timing. Treat fueling as a tested system, not a guess."
  },
  {
    "name": "B2B long run (3 hr 30 min)",
    "detail": "Back-to-back 3 hr 30 min on yesterday's legs, race kit on. Run easy, fuel exactly as raced. Note how the gut and feet hold up deep into fatigue."
  },
  {
    "name": "Long run (4 hr)",
    "detail": "Long run 4 hr in full race kit on Black-Canyon-style terrain. Exact race fueling, electrolytes, and caffeine timing. Treat fueling as a tested system, not a guess."
  },
  {
    "name": "B2B long run (3 hr)",
    "detail": "Back-to-back 3 hr on yesterday's legs, race kit on. Run easy, fuel exactly as raced. Note how the gut and feet hold up deep into fatigue."
  },
  {
    "name": "Travel + shakeout",
    "detail": "Travel to Glendale/Phoenix AZ. Easy 20 to 30 min shakeout, hydrate, legs up. Confirm loop-race plan, lighting, and overnight fueling."
  },
  {
    "name": "RACE: Across the Years 24-Hour (start)",
    "detail": "Aravaipa multi-day timed race, Glendale AZ. Your long multi-day practice race. Run the 24-hour starting 9 AM on a flat 1.05 mi loop you circle as long as you choose. Ideal for time-on-feet, overnight running, sleep strategy, and fueling rehearsal on Cocodona's home turf. The 24-hour is the recommended dose; the 48-hour and 100-mile options are more than needed this far out."
  },
  {
    "name": "Across the Years finish + recover",
    "detail": "24-hour clock ends 9 AM. Stop, refuel, rehydrate, then travel/rest. Capture an after-action review while it is fresh: what fueling, pacing, night, and sleep strategy worked and what to change."
  },
  {
    "name": "Recover",
    "detail": "Full rest or easy 20 min walk. Big calories, hydration, sleep. You just circled a loop for 24 hours."
  },
  {
    "name": "Recover / travel home",
    "detail": "Rest and travel home. Gentle walking only. Begin easing back into training next week."
  },
  {
    "name": "Easy / rest",
    "detail": "Optional easy 30 min jog if the legs are willing, otherwise rest. No structure."
  },
  {
    "name": "Easy / rest",
    "detail": "Easy 30 to 45 min recovery jog or rest. Let the multi-day effort absorb."
  },
  {
    "name": "Race-terrain medium-long",
    "detail": "1 hr 30 min on terrain like Black Canyon: runnable grade plus a technical descent. Carry the vest, practice fueling."
  },
  {
    "name": "Long run (3 hr 30 min)",
    "detail": "Long run 3 hr 30 min in full race kit on Black-Canyon-style terrain. Exact race fueling, electrolytes, and caffeine timing. Treat fueling as a tested system, not a guess."
  },
  {
    "name": "B2B long run (2 hr 30 min)",
    "detail": "Back-to-back 2 hr 30 min on yesterday's legs, race kit on. Run easy, fuel exactly as raced. Note how the gut and feet hold up deep into fatigue."
  },
  {
    "name": "Long run (5 hr 30 min)",
    "detail": "Long run 5 hr 30 min in full race kit on Black-Canyon-style terrain. Exact race fueling, electrolytes, and caffeine timing. Treat fueling as a tested system, not a guess."
  },
  {
    "name": "B2B long run (3 hr 45 min)",
    "detail": "Back-to-back 3 hr 45 min on yesterday's legs, race kit on. Run easy, fuel exactly as raced. Note how the gut and feet hold up deep into fatigue."
  },
  {
    "name": "Race-terrain medium-long",
    "detail": "2 hr on terrain like Black Canyon: runnable grade plus a technical descent. Carry the vest, practice fueling."
  },
  {
    "name": "Long run (6 hr)",
    "detail": "Long run 6 hr in full race kit on Black-Canyon-style terrain. Exact race fueling, electrolytes, and caffeine timing. Treat fueling as a tested system, not a guess."
  },
  {
    "name": "B2B long run (4 hr)",
    "detail": "Back-to-back 4 hr on yesterday's legs, race kit on. Run easy, fuel exactly as raced. Note how the gut and feet hold up deep into fatigue."
  },
  {
    "name": "Easy + Strength (lower + core)",
    "detail": "Easy 60 to 75 min, then Hinge, single-leg, step-ups, calf/tibialis, posterior chain, anti-rotation core. 35 to 45 min. Heavy-ish, low rep, durability focus. Trains the trunk you want visible without compromising run legs."
  },
  {
    "name": "Race-terrain medium-long",
    "detail": "2 hr 15 min on terrain like Black Canyon: runnable grade plus a technical descent. Carry the vest, practice fueling."
  },
  {
    "name": "B2B long run (4 hr 15 min)",
    "detail": "Back-to-back 4 hr 15 min on yesterday's legs, race kit on. Run easy, fuel exactly as raced. Note how the gut and feet hold up deep into fatigue."
  },
  {
    "name": "RACE: Black Canyon 100K (dress rehearsal)",
    "detail": "The single most important tune-up. Arizona desert terrain, the same region and climate as Cocodona. Run it as Cocodona at lower volume: identical shoes, vest, fueling, electrolytes, crew workflow, and pacing discipline. CONFIRM 2027 DATE when Aravaipa posts it."
  },
  {
    "name": "B2B long run (2 hr)",
    "detail": "Back-to-back 2 hr on yesterday's legs, race kit on. Run easy, fuel exactly as raced. Note how the gut and feet hold up deep into fatigue."
  },
  {
    "name": "Race-terrain medium-long",
    "detail": "1 hr 15 min on terrain like Black Canyon: runnable grade plus a technical descent. Carry the vest, practice fueling."
  },
  {
    "name": "Long run (3 hr)",
    "detail": "Long run 3 hr in full race kit on Black-Canyon-style terrain. Exact race fueling, electrolytes, and caffeine timing. Treat fueling as a tested system, not a guess."
  },
  {
    "name": "Race-effort climbs",
    "detail": "Long climbs at goal race effort with poles. Practice the run-hike transition you will use for 250 miles. Easy descents."
  },
  {
    "name": "Medium-long w/ surges",
    "detail": "2 hr with 4 to 6 climbing surges at race effort. Keep it specific, keep poles handy."
  },
  {
    "name": "Long run (6 hr)",
    "detail": "KEY long run 6 hr. Race kit, poles, full fueling. Where noted, start before dawn or push into the night to bank sleep-deprived miles. This is the 250-specific stimulus."
  },
  {
    "name": "B2B long run (4 hr 30 min)",
    "detail": "Back-to-back long run 4 hr 30 min on tired legs. This is the heart of 250-mile prep: teaching the body and mind to keep moving and fueling when already fatigued. Easy effort, strong fueling."
  },
  {
    "name": "OPTIONAL RACE: Way Too Cool 50K",
    "detail": "Optional fast sharpener near Auburn. Run controlled, treat as the weekend long. Good leg speed and race-day-logistics rehearsal. Easy Sunday after."
  },
  {
    "name": "B2B long run (3 hr)",
    "detail": "Back-to-back long run 3 hr on tired legs. This is the heart of 250-mile prep: teaching the body and mind to keep moving and fueling when already fatigued. Easy effort, strong fueling."
  },
  {
    "name": "Medium-long w/ surges",
    "detail": "2 hr 15 min with 4 to 6 climbing surges at race effort. Keep it specific, keep poles handy."
  },
  {
    "name": "Easy pre-load",
    "detail": "Easy 30 to 45 min, legs loose. Light strength optional. Prep for a big weekend; eat and hydrate ahead."
  },
  {
    "name": "Long run (7 hr)",
    "detail": "KEY long run 7 hr. Race kit, poles, full fueling. Where noted, start before dawn or push into the night to bank sleep-deprived miles. This is the 250-specific stimulus."
  },
  {
    "name": "B2B long run (5 hr)",
    "detail": "Back-to-back long run 5 hr on tired legs. This is the heart of 250-mile prep: teaching the body and mind to keep moving and fueling when already fatigued. Easy effort, strong fueling."
  },
  {
    "name": "Medium-long w/ surges",
    "detail": "2 hr 30 min with 4 to 6 climbing surges at race effort. Keep it specific, keep poles handy."
  },
  {
    "name": "Long run (8 hr)",
    "detail": "KEY long run 8 hr. Race kit, poles, full fueling. Where noted, start before dawn or push into the night to bank sleep-deprived miles. This is the 250-specific stimulus."
  },
  {
    "name": "B2B long run (5 hr 30 min)",
    "detail": "Back-to-back long run 5 hr 30 min on tired legs. This is the heart of 250-mile prep: teaching the body and mind to keep moving and fueling when already fatigued. Easy effort, strong fueling."
  },
  {
    "name": "Medium-long w/ surges",
    "detail": "1 hr 45 min with 4 to 6 climbing surges at race effort. Keep it specific, keep poles handy."
  },
  {
    "name": "Long run (5 hr)",
    "detail": "KEY long run 5 hr. Race kit, poles, full fueling. Where noted, start before dawn or push into the night to bank sleep-deprived miles. This is the 250-specific stimulus."
  },
  {
    "name": "B2B long run (3 hr 30 min)",
    "detail": "Back-to-back long run 3 hr 30 min on tired legs. This is the heart of 250-mile prep: teaching the body and mind to keep moving and fueling when already fatigued. Easy effort, strong fueling."
  },
  {
    "name": "B2B long run (6 hr)",
    "detail": "Back-to-back long run 6 hr on tired legs. This is the heart of 250-mile prep: teaching the body and mind to keep moving and fueling when already fatigued. Easy effort, strong fueling."
  },
  {
    "name": "Easy + strides",
    "detail": "Easy 45 to 60 min plus a few strides to stay sharp."
  },
  {
    "name": "Medium-long",
    "detail": "1 hr 30 min steady aerobic."
  },
  {
    "name": "Easy + mobility",
    "detail": "Easy 30 to 40 min plus mobility. Optional very light strength. Prioritize freshness."
  },
  {
    "name": "Long run (3 hr)",
    "detail": "Long run 3 hr easy, controlled. Maintain feel without digging a hole."
  },
  {
    "name": "Shakeout + strides",
    "detail": "20 to 25 min easy with 4 x 20 sec strides. Stay loose and sharp."
  },
  {
    "name": "Easy short",
    "detail": "Easy 25 to 30 min. Optional micro-strength to stay primed. Mostly rest."
  },
  {
    "name": "Travel day",
    "detail": "Travel to Arizona if not already. Easy 20 min shakeout on arrival, hydrate, legs up."
  },
  {
    "name": "Travel to Arizona",
    "detail": "Drive or fly to Black Canyon City / Flagstaff area. Easy 20 min shakeout on arrival. Hydrate, elevate legs, sleep."
  },
  {
    "name": "Pre-race: gear + drop bags",
    "detail": "20 to 30 min shakeout with a few strides. Final drop-bag pack, crew brief, pacer schedule confirmed. Off feet by afternoon. Big dinner, early night."
  },
  {
    "name": "Pre-race: rest + check-in",
    "detail": "Optional 15 min easy shakeout. Packet pickup, mandatory briefing, mental rehearsal of the first desert section and heat plan. Sleep early; bank rest before the 125-hour clock."
  },
  {
    "name": "COCODONA 250 START",
    "detail": "Black Canyon City to Flagstaff. 253 mi, ~38,800 ft gain, ~33,900 ft descent, 125-hr cutoff. Execute the plan: walk the hills, run the runnable, fuel every 30 min, manage heat early and cold high, sleep by design not by collapse. You built the machine. Go run it."
  }
];

// [dateISO, blockIndex, weekNumber, weeksToRace, sessionIndex, plannedHours]
const DAYS = [["2026-06-08", 0, 1, 47, 0, 0.5], ["2026-06-09", 0, 1, 47, 1, 1.0], ["2026-06-10", 0, 1, 47, 2, 0.6], ["2026-06-11", 0, 1, 47, 3, 1.0], ["2026-06-12", 0, 1, 47, 4, 0.6], ["2026-06-13", 0, 1, 47, 5, 2.0], ["2026-06-14", 0, 1, 47, 6, 1.3], ["2026-06-15", 0, 2, 46, 0, 0.5], ["2026-06-16", 0, 2, 46, 1, 1.0], ["2026-06-17", 0, 2, 46, 2, 0.6], ["2026-06-18", 0, 2, 46, 7, null], ["2026-06-19", 0, 2, 46, 8, null], ["2026-06-20", 0, 2, 46, 9, null], ["2026-06-21", 0, 2, 46, 10, null], ["2026-06-22", 1, 3, 45, 11, null], ["2026-06-23", 1, 3, 45, 12, null], ["2026-06-24", 1, 3, 45, 13, null], ["2026-06-25", 1, 3, 45, 14, null], ["2026-06-26", 1, 3, 45, 15, null], ["2026-06-27", 1, 3, 45, 16, null], ["2026-06-28", 1, 3, 45, 17, null], ["2026-06-29", 2, 4, 44, 18, null], ["2026-06-30", 2, 4, 44, 19, 0.6], ["2026-07-01", 2, 4, 44, 20, 0.7], ["2026-07-02", 2, 4, 44, 21, 0.8], ["2026-07-03", 2, 4, 44, 22, null], ["2026-07-04", 2, 4, 44, 23, 1.5], ["2026-07-05", 2, 4, 44, 24, 1.0], ["2026-07-06", 3, 5, 43, 0, 0.5], ["2026-07-07", 3, 5, 43, 25, 1.0], ["2026-07-08", 3, 5, 43, 2, 0.6], ["2026-07-09", 3, 5, 43, 26, 1.0], ["2026-07-10", 3, 5, 43, 4, 0.6], ["2026-07-11", 3, 5, 43, 27, 2.0], ["2026-07-12", 3, 5, 43, 6, 1.3], ["2026-07-13", 3, 6, 42, 0, 0.5], ["2026-07-14", 3, 6, 42, 25, 1.0], ["2026-07-15", 3, 6, 42, 2, 0.6], ["2026-07-16", 3, 6, 42, 26, 1.0], ["2026-07-17", 3, 6, 42, 4, 0.6], ["2026-07-18", 3, 6, 42, 28, 2.3], ["2026-07-19", 3, 6, 42, 29, 1.5], ["2026-07-20", 3, 7, 41, 0, 0.5], ["2026-07-21", 3, 7, 41, 30, 1.0], ["2026-07-22", 3, 7, 41, 31, 0.8], ["2026-07-23", 3, 7, 41, 32, 1.3], ["2026-07-24", 3, 7, 41, 4, 0.6], ["2026-07-25", 3, 7, 41, 33, 2.8], ["2026-07-26", 3, 7, 41, 34, 1.8], ["2026-07-27", 3, 8, 40, 0, 0.5], ["2026-07-28", 3, 8, 40, 25, 1.0], ["2026-07-29", 3, 8, 40, 2, 0.6], ["2026-07-30", 3, 8, 40, 26, 1.0], ["2026-07-31", 3, 8, 40, 4, 0.6], ["2026-08-01", 3, 8, 40, 27, 2.0], ["2026-08-02", 3, 8, 40, 6, 1.3], ["2026-08-03", 3, 9, 39, 0, 0.5], ["2026-08-04", 3, 9, 39, 30, 1.0], ["2026-08-05", 3, 9, 39, 31, 0.8], ["2026-08-06", 3, 9, 39, 32, 1.3], ["2026-08-07", 3, 9, 39, 4, 0.6], ["2026-08-08", 3, 9, 39, 35, 3.0], ["2026-08-09", 3, 9, 39, 36, 2.0], ["2026-08-10", 3, 10, 38, 0, 0.5], ["2026-08-11", 3, 10, 38, 30, 1.0], ["2026-08-12", 3, 10, 38, 31, 0.9], ["2026-08-13", 3, 10, 38, 37, 1.5], ["2026-08-14", 3, 10, 38, 4, 0.6], ["2026-08-15", 3, 10, 38, 38, 3.5], ["2026-08-16", 3, 10, 38, 39, 2.3], ["2026-08-17", 3, 11, 37, 0, 0.5], ["2026-08-18", 3, 11, 37, 30, 1.0], ["2026-08-19", 3, 11, 37, 31, 0.9], ["2026-08-20", 3, 11, 37, 37, 1.5], ["2026-08-21", 3, 11, 37, 4, 0.6], ["2026-08-22", 3, 11, 37, 40, 3.3], ["2026-08-23", 3, 11, 37, 39, 2.3], ["2026-08-24", 3, 12, 36, 0, 0.5], ["2026-08-25", 3, 12, 36, 30, 1.0], ["2026-08-26", 3, 12, 36, 31, 0.9], ["2026-08-27", 3, 12, 36, 37, 1.5], ["2026-08-28", 3, 12, 36, 4, 0.6], ["2026-08-29", 3, 12, 36, 40, 3.3], ["2026-08-30", 3, 12, 36, 39, 2.3], ["2026-08-31", 4, 13, 35, 41, 0.5], ["2026-09-01", 4, 13, 35, 42, 1.3], ["2026-09-02", 4, 13, 35, 31, 0.8], ["2026-09-03", 4, 13, 35, 43, 0.6], ["2026-09-04", 4, 13, 35, 4, 0.6], ["2026-09-05", 4, 13, 35, 44, 2.5], ["2026-09-06", 4, 13, 35, 36, 2.0], ["2026-09-07", 4, 14, 34, 0, 0.5], ["2026-09-08", 4, 14, 34, 42, 1.3], ["2026-09-09", 4, 14, 34, 31, 0.9], ["2026-09-10", 4, 14, 34, 45, 1.5], ["2026-09-11", 4, 14, 34, 4, 0.6], ["2026-09-12", 4, 14, 34, 46, 4.0], ["2026-09-13", 4, 14, 34, 47, 2.8], ["2026-09-14", 4, 15, 33, 0, 0.5], ["2026-09-15", 4, 15, 33, 42, 1.3], ["2026-09-16", 4, 15, 33, 31, 0.8], ["2026-09-17", 4, 15, 33, 48, 1.3], ["2026-09-18", 4, 15, 33, 4, 0.6], ["2026-09-19", 4, 15, 33, 49, 3.0], ["2026-09-20", 4, 15, 33, 36, 2.0], ["2026-09-21", 4, 16, 32, 0, 0.5], ["2026-09-22", 4, 16, 32, 50, 1.3], ["2026-09-23", 4, 16, 32, 51, 1.0], ["2026-09-24", 4, 16, 32, 52, 1.8], ["2026-09-25", 4, 16, 32, 4, 0.6], ["2026-09-26", 4, 16, 32, 53, 4.5], ["2026-09-27", 4, 16, 32, 54, 3.0], ["2026-09-28", 4, 17, 31, 0, 0.5], ["2026-09-29", 4, 17, 31, 50, 1.3], ["2026-09-30", 4, 17, 31, 51, 1.0], ["2026-10-01", 4, 17, 31, 52, 1.8], ["2026-10-02", 4, 17, 31, 4, 0.6], ["2026-10-03", 4, 17, 31, 55, 5.0], ["2026-10-04", 4, 17, 31, 56, 3.5], ["2026-10-05", 4, 18, 30, 41, 0.5], ["2026-10-06", 4, 18, 30, 42, 1.3], ["2026-10-07", 4, 18, 30, 31, 0.8], ["2026-10-08", 4, 18, 30, 43, 0.6], ["2026-10-09", 4, 18, 30, 4, 0.6], ["2026-10-10", 4, 18, 30, 57, null], ["2026-10-11", 4, 18, 30, 58, 5.0], ["2026-10-12", 4, 19, 29, 0, 0.5], ["2026-10-13", 4, 19, 29, 42, 1.3], ["2026-10-14", 4, 19, 29, 31, 0.8], ["2026-10-15", 4, 19, 29, 48, 1.3], ["2026-10-16", 4, 19, 29, 4, 0.6], ["2026-10-17", 4, 19, 29, 49, 3.0], ["2026-10-18", 4, 19, 29, 36, 2.0], ["2026-10-19", 5, 20, 28, 0, 0.5], ["2026-10-20", 5, 20, 28, 59, 1.3], ["2026-10-21", 5, 20, 28, 31, 0.9], ["2026-10-22", 5, 20, 28, 60, 1.5], ["2026-10-23", 5, 20, 28, 4, 0.6], ["2026-10-24", 5, 20, 28, 61, 4.0], ["2026-10-25", 5, 20, 28, 54, 3.0], ["2026-10-26", 5, 21, 27, 0, 0.5], ["2026-10-27", 5, 21, 27, 62, 1.3], ["2026-10-28", 5, 21, 27, 51, 1.0], ["2026-10-29", 5, 21, 27, 63, 1.8], ["2026-10-30", 5, 21, 27, 4, 0.6], ["2026-10-31", 5, 21, 27, 64, 4.5], ["2026-11-01", 5, 21, 27, 65, 3.3], ["2026-11-02", 5, 22, 26, 0, 0.5], ["2026-11-03", 5, 22, 26, 62, 1.3], ["2026-11-04", 5, 22, 26, 51, 1.0], ["2026-11-05", 5, 22, 26, 66, 2.0], ["2026-11-06", 5, 22, 26, 4, 0.6], ["2026-11-07", 5, 22, 26, 67, 5.0], ["2026-11-08", 5, 22, 26, 56, 3.5], ["2026-11-09", 5, 23, 25, 0, 0.5], ["2026-11-10", 5, 23, 25, 62, 1.3], ["2026-11-11", 5, 23, 25, 51, 1.0], ["2026-11-12", 5, 23, 25, 66, 2.0], ["2026-11-13", 5, 23, 25, 4, 0.6], ["2026-11-14", 5, 23, 25, 68, 5.5], ["2026-11-15", 5, 23, 25, 69, 3.8], ["2026-11-16", 5, 24, 24, 0, 0.5], ["2026-11-17", 5, 24, 24, 59, 1.3], ["2026-11-18", 5, 24, 24, 31, 0.9], ["2026-11-19", 5, 24, 24, 60, 1.5], ["2026-11-20", 5, 24, 24, 4, 0.6], ["2026-11-21", 5, 24, 24, 70, 3.5], ["2026-11-22", 5, 24, 24, 71, 2.5], ["2026-11-23", 5, 25, 23, 0, 0.5], ["2026-11-24", 5, 25, 23, 62, 1.3], ["2026-11-25", 5, 25, 23, 51, 1.0], ["2026-11-26", 5, 25, 23, 63, 1.8], ["2026-11-27", 5, 25, 23, 4, 0.6], ["2026-11-28", 5, 25, 23, 67, 5.0], ["2026-11-29", 5, 25, 23, 56, 3.5], ["2026-11-30", 5, 26, 22, 0, 0.5], ["2026-12-01", 5, 26, 22, 62, 1.3], ["2026-12-02", 5, 26, 22, 51, 1.0], ["2026-12-03", 5, 26, 22, 63, 1.8], ["2026-12-04", 5, 26, 22, 4, 0.6], ["2026-12-05", 5, 26, 22, 67, 5.0], ["2026-12-06", 5, 26, 22, 56, 3.5], ["2026-12-07", 5, 27, 21, 0, 0.5], ["2026-12-08", 5, 27, 21, 59, 1.3], ["2026-12-09", 5, 27, 21, 31, 0.9], ["2026-12-10", 5, 27, 21, 60, 1.5], ["2026-12-11", 5, 27, 21, 4, 0.6], ["2026-12-12", 5, 27, 21, 61, 4.0], ["2026-12-13", 5, 27, 21, 71, 2.5], ["2026-12-14", 6, 28, 20, 0, 0.5], ["2026-12-15", 6, 28, 20, 72, 1.5], ["2026-12-16", 6, 28, 20, 51, 1.0], ["2026-12-17", 6, 28, 20, 73, 1.8], ["2026-12-18", 6, 28, 20, 4, 0.6], ["2026-12-19", 6, 28, 20, 74, 4.5], ["2026-12-20", 6, 28, 20, 75, 3.5], ["2026-12-21", 6, 29, 19, 0, 0.5], ["2026-12-22", 6, 29, 19, 72, 1.5], ["2026-12-23", 6, 29, 19, 51, 1.0], ["2026-12-24", 6, 29, 19, 73, 1.8], ["2026-12-25", 6, 29, 19, 4, 0.6], ["2026-12-26", 6, 29, 19, 76, 4.0], ["2026-12-27", 6, 29, 19, 77, 3.0], ["2026-12-28", 6, 30, 18, 78, 0.4], ["2026-12-29", 6, 30, 18, 79, 12.0], ["2026-12-30", 6, 30, 18, 80, null], ["2026-12-31", 6, 30, 18, 81, null], ["2027-01-01", 6, 30, 18, 82, null], ["2027-01-02", 6, 30, 18, 83, null], ["2027-01-03", 6, 30, 18, 84, null], ["2027-01-04", 6, 31, 17, 0, 0.5], ["2027-01-05", 6, 31, 17, 72, 1.5], ["2027-01-06", 6, 31, 17, 31, 0.9], ["2027-01-07", 6, 31, 17, 85, 1.5], ["2027-01-08", 6, 31, 17, 4, 0.6], ["2027-01-09", 6, 31, 17, 86, 3.5], ["2027-01-10", 6, 31, 17, 87, 2.5], ["2027-01-11", 6, 32, 16, 0, 0.5], ["2027-01-12", 6, 32, 16, 72, 1.5], ["2027-01-13", 6, 32, 16, 51, 1.0], ["2027-01-14", 6, 32, 16, 73, 1.8], ["2027-01-15", 6, 32, 16, 4, 0.6], ["2027-01-16", 6, 32, 16, 88, 5.5], ["2027-01-17", 6, 32, 16, 89, 3.8], ["2027-01-18", 6, 33, 15, 0, 0.5], ["2027-01-19", 6, 33, 15, 72, 1.5], ["2027-01-20", 6, 33, 15, 51, 1.0], ["2027-01-21", 6, 33, 15, 90, 2.0], ["2027-01-22", 6, 33, 15, 4, 0.6], ["2027-01-23", 6, 33, 15, 91, 6.0], ["2027-01-24", 6, 33, 15, 92, 4.0], ["2027-01-25", 6, 34, 14, 0, 0.5], ["2027-01-26", 6, 34, 14, 72, 1.5], ["2027-01-27", 6, 34, 14, 93, 1.0], ["2027-01-28", 6, 34, 14, 94, 2.3], ["2027-01-29", 6, 34, 14, 4, 0.6], ["2027-01-30", 6, 34, 14, 91, 6.0], ["2027-01-31", 6, 34, 14, 95, 4.3], ["2027-02-01", 6, 35, 13, 0, 0.5], ["2027-02-02", 6, 35, 13, 72, 1.5], ["2027-02-03", 6, 35, 13, 51, 1.0], ["2027-02-04", 6, 35, 13, 90, 2.0], ["2027-02-05", 6, 35, 13, 4, 0.6], ["2027-02-06", 6, 35, 13, 88, 5.5], ["2027-02-07", 6, 35, 13, 92, 4.0], ["2027-02-08", 6, 36, 12, 41, 0.5], ["2027-02-09", 6, 36, 12, 72, 1.5], ["2027-02-10", 6, 36, 12, 31, 0.8], ["2027-02-11", 6, 36, 12, 43, 0.6], ["2027-02-12", 6, 36, 12, 4, 0.6], ["2027-02-13", 6, 36, 12, 96, 12.0], ["2027-02-14", 6, 36, 12, 97, 2.0], ["2027-02-15", 6, 37, 11, 0, 0.5], ["2027-02-16", 6, 37, 11, 72, 1.5], ["2027-02-17", 6, 37, 11, 31, 0.8], ["2027-02-18", 6, 37, 11, 98, 1.3], ["2027-02-19", 6, 37, 11, 4, 0.6], ["2027-02-20", 6, 37, 11, 99, 3.0], ["2027-02-21", 6, 37, 11, 97, 2.0], ["2027-02-22", 7, 38, 10, 0, 0.5], ["2027-02-23", 7, 38, 10, 100, 1.5], ["2027-02-24", 7, 38, 10, 51, 1.0], ["2027-02-25", 7, 38, 10, 101, 2.0], ["2027-02-26", 7, 38, 10, 4, 0.6], ["2027-02-27", 7, 38, 10, 102, 6.0], ["2027-02-28", 7, 38, 10, 103, 4.5], ["2027-03-01", 7, 39, 9, 41, 0.5], ["2027-03-02", 7, 39, 9, 100, 1.5], ["2027-03-03", 7, 39, 9, 51, 1.0], ["2027-03-04", 7, 39, 9, 43, 0.6], ["2027-03-05", 7, 39, 9, 4, 0.6], ["2027-03-06", 7, 39, 9, 104, 5.0], ["2027-03-07", 7, 39, 9, 105, 3.0], ["2027-03-08", 7, 40, 8, 0, 0.5], ["2027-03-09", 7, 40, 8, 100, 1.5], ["2027-03-10", 7, 40, 8, 93, 1.0], ["2027-03-11", 7, 40, 8, 106, 2.3], ["2027-03-12", 7, 40, 8, 107, 0.6], ["2027-03-13", 7, 40, 8, 108, 7.0], ["2027-03-14", 7, 40, 8, 109, 5.0], ["2027-03-15", 7, 41, 7, 0, 0.5], ["2027-03-16", 7, 41, 7, 100, 1.5], ["2027-03-17", 7, 41, 7, 93, 1.0], ["2027-03-18", 7, 41, 7, 110, 2.5], ["2027-03-19", 7, 41, 7, 107, 0.6], ["2027-03-20", 7, 41, 7, 111, 8.0], ["2027-03-21", 7, 41, 7, 112, 5.5], ["2027-03-22", 7, 42, 6, 0, 0.5], ["2027-03-23", 7, 42, 6, 100, 1.5], ["2027-03-24", 7, 42, 6, 51, 1.0], ["2027-03-25", 7, 42, 6, 113, 1.8], ["2027-03-26", 7, 42, 6, 4, 0.6], ["2027-03-27", 7, 42, 6, 114, 5.0], ["2027-03-28", 7, 42, 6, 115, 3.5], ["2027-03-29", 7, 43, 5, 0, 0.5], ["2027-03-30", 7, 43, 5, 100, 1.5], ["2027-03-31", 7, 43, 5, 93, 1.0], ["2027-04-01", 7, 43, 5, 110, 2.5], ["2027-04-02", 7, 43, 5, 107, 0.6], ["2027-04-03", 7, 43, 5, 111, 8.0], ["2027-04-04", 7, 43, 5, 116, 6.0], ["2027-04-05", 7, 44, 4, 0, 0.5], ["2027-04-06", 7, 44, 4, 100, 1.5], ["2027-04-07", 7, 44, 4, 93, 1.0], ["2027-04-08", 7, 44, 4, 106, 2.3], ["2027-04-09", 7, 44, 4, 107, 0.6], ["2027-04-10", 7, 44, 4, 108, 7.0], ["2027-04-11", 7, 44, 4, 109, 5.0], ["2027-04-12", 7, 45, 3, 0, 0.5], ["2027-04-13", 7, 45, 3, 100, 1.5], ["2027-04-14", 7, 45, 3, 51, 1.0], ["2027-04-15", 7, 45, 3, 101, 2.0], ["2027-04-16", 7, 45, 3, 107, 0.6], ["2027-04-17", 7, 45, 3, 114, 5.0], ["2027-04-18", 7, 45, 3, 115, 3.5], ["2027-04-19", 8, 46, 2, 41, 0.5], ["2027-04-20", 8, 46, 2, 117, 1.0], ["2027-04-21", 8, 46, 2, 31, 0.9], ["2027-04-22", 8, 46, 2, 118, 1.5], ["2027-04-23", 8, 46, 2, 119, 0.6], ["2027-04-24", 8, 46, 2, 120, 3.0], ["2027-04-25", 8, 46, 2, 36, 2.0], ["2027-04-26", 8, 47, 1, 41, 0.4], ["2027-04-27", 8, 47, 1, 121, 0.4], ["2027-04-28", 8, 47, 1, 122, 0.4], ["2027-04-29", 8, 47, 1, 123, 0.3], ["2027-04-30", 8, 47, 1, 124, null], ["2027-05-01", 8, 47, 1, 125, null], ["2027-05-02", 8, 47, 1, 126, null], ["2027-05-03", 9, 48, 0, 127, null]];

const byDate = new Map(DAYS.map((d) => [d[0], d]));

/** The plan's own entry for a date, or null if outside the plan window. */
export function dayPlan(iso) {
  const d = byDate.get(iso);
  if (!d) return null;
  const s = SESSIONS[d[4]] || { name: "", detail: "" };
  return {
    date: d[0],
    block: PLAN_BLOCKS[d[1]],
    wk: d[2],
    wksToRace: d[3],
    session: s.name,
    details: s.detail,
    hrs: d[5],
  };
}

export const PLAN_FIRST_DAY = DAYS[0][0];
export const PLAN_LAST_DAY = DAYS[DAYS.length - 1][0];
export const PLAN_DAY_COUNT = DAYS.length;

/** Sum of planned hours for the Monday-to-Sunday week containing `iso`. */
export function weekPlannedHours(mondayIso) {
  let total = 0;
  const start = new Date(mondayIso + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const p = byDate.get(d.toISOString().slice(0, 10));
    if (p && typeof p[5] === "number") total += p[5];
  }
  return +total.toFixed(1);
}

// Classify a session by the plan's own name for it, rather than by day of week.
// The plan's §6 architecture puts quality on Tuesday and Thursday, but it also
// moves sessions around races, travel and the expedition — so the name is the
// authority and the weekday is not.
export function classify(name) {
  const n = (name || "").toLowerCase();
  if (/^rest|^easy \/ rest|^easy or rest|^rest \/ walk/.test(n)) return "rest";
  if (/cocodona 250 start|^race:|^optional race:|across the years/.test(n)) return "race";
  if (/^b2b/.test(n)) return "b2b";
  if (/^long run/.test(n)) return "long";
  if (/travel|acclimatize|^ecuador|pre-race/.test(n)) return "logistics";
  if (/hill repeats|climb intervals|race-effort|surges|medium-long|rolling steady/.test(n)) return "quality";
  return "easy";
}
