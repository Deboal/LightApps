// Checks for the decision a stopped run makes about itself.
//
// This module exists because the decision used to be written twice -- once in
// `play.mjs` and once inside a React callback -- and the two did different
// things. The command line picked a stopped run back up; the tab ended the
// night on the first bad minute. Nobody noticed for a release, because half of
// it lived in a component and logic in a component is logic nobody checks.
//
// So it is one module now, and this is the check that it behaves.
//
// Run: node apps/gba/checks/recovery-checks.mjs

import { recovery, slotOfMon, sameMon, TRIES } from "../src/recovery.js";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const stop = (reason, final = false) => ({ done: true, reason, final });

/** A party member with a real identity: the two words Gen 3 encrypts with. */
let nextKey = 1000;
const mon = (name, over = {}) => {
  const personality = over.personality ?? nextKey++;
  const otId = over.otId ?? 24601;
  return {
    name,
    level: over.level ?? 10,
    maxHp: over.maxHp ?? 40,
    record: { personality, otId, species: over.species ?? 1, moves: [] },
  };
};
const party = (...members) => members;

// -- which stops end a run ----------------------------------------------------
{
  const r = recovery();
  const out = r.after(stop("CHARMELEON reached level 28.", true), {});
  check("a final stop ends it", out.action === "stop" && out.final === true, JSON.stringify(out));
  check("and is not counted as an attempt", r.attempt === 0, `attempt ${r.attempt}`);
  check("nor listed as something it recovered from", r.stops.length === 0, JSON.stringify(r.stops));
}
{
  const r = recovery();
  const out = r.after(stop("Boxed in."), {});
  check("an ordinary stop is picked back up", out.action === "retry", JSON.stringify(out));
  check("and counted", r.attempt === 1 && r.stops.length === 1, `${r.attempt} / ${r.stops.length}`);
}

// -- and when to stop trying --------------------------------------------------
{
  const r = recovery({ tries: 3 });
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push(r.after(stop(`stumble ${i}`), {}).action);
  check(
    "three goes, then it says so",
    seen.join(",") === "retry,retry,retry,stop,stop,stop",
    seen.join(",")
  );
  check("the last word is that it ran out, not that it succeeded",
    r.after(stop("stumble"), {}).exhausted === true);
  check("and the default is three", TRIES === 3, String(TRIES));
}

// -- finding the Pokémon again ------------------------------------------------
//
// This is the failure that made a user say the thing was not working, and it
// is worth writing down exactly. Asked to train a CLEFAIRY sitting in slot six
// to level 20, a run put it in front -- correctly -- and then read the level
// out of slot six, which now held the PIKACHU that had been displaced. PIKACHU
// was already 38. The run announced that the level had been reached and
// stopped, six seconds in, with the party menu still open on screen.
//
// An index into a list that reorders is the whole bug, and it has now appeared
// four separate times in this project. So identity is what a Pokémon is found
// by, and identity is the pair of words the game encrypts its record with.
{
  const clefairy = mon("CLEFAIRY", { personality: 111, species: 35, level: 10 });
  const pikachu = mon("PIKACHU", { personality: 222, species: 25, level: 38 });
  const beedrill = mon("BEEDRILL", { personality: 333, species: 15 });

  const before = party(pikachu, beedrill, clefairy);
  const after = party(clefairy, beedrill, pikachu);
  check("before the swap it is where it started", slotOfMon(before, clefairy, 2) === 2);
  check("after the swap it is followed, not assumed", slotOfMon(after, clefairy, 2) === 0,
    `found at ${slotOfMon(after, clefairy, 2)} rather than the 2 it started in`);
  check("and the one that inherited the slot is not mistaken for it",
    slotOfMon(after, clefairy, 2) !== 2, "this is the CLEFAIRY-is-a-PIKACHU bug");

  // The part an earlier identity got wrong: it compared level and max HP, so
  // it stopped matching the moment the thing being trained did the thing it
  // was asked to do.
  const levelled = party(
    { ...clefairy, level: 14, maxHp: 48 },
    beedrill,
    pikachu
  );
  check("levelling up does not lose it", slotOfMon(levelled, clefairy, 2) === 0,
    `found at ${slotOfMon(levelled, clefairy, 2)}`);

  // And evolving, which is the goal of half these runs.
  const evolved = party({ ...clefairy, name: "CLEFABLE", level: 20, maxHp: 70,
    record: { ...clefairy.record, species: 36 } }, beedrill, pikachu);
  check("nor does evolving", slotOfMon(evolved, clefairy, 2) === 0,
    `found at ${slotOfMon(evolved, clefairy, 2)}`);

  const r = recovery();
  const out = r.after(stop("Boxed in."), { party: after, want: clefairy, fallbackSlot: 2 });
  check("and the retry is told the slot it is actually in", out.slot === 0, `slot ${out.slot}`);

  // An unreadable party is not a reason to guess at zero -- guessing at zero
  // is precisely how the run retargeted itself onto whoever was leading.
  const blind = recovery().after(stop("Boxed in."), { party: null, want: clefairy, fallbackSlot: 2 });
  check("an unreadable party falls back to the slot it was given", blind.slot === 2, `slot ${blind.slot}`);
  const gone = recovery().after(stop("Boxed in."), { party: party(pikachu), want: clefairy, fallbackSlot: 1 });
  check("a Pokémon that is no longer there does too", gone.slot === 1, `slot ${gone.slot}`);

  // A record that did not decode this frame. Torn reads are ordinary -- the
  // party is read out of memory the cartridge is writing to -- so this must
  // not be treated as "not my Pokémon".
  const torn = party({ name: "CLEFAIRY", level: 10, maxHp: 40, record: null }, beedrill, pikachu);
  check("a torn read falls back on the name rather than on nothing",
    slotOfMon(torn, clefairy, 2) === 2, `slot ${slotOfMon(torn, clefairy, 2)}`);

  // Two sharing a personality. This player really has a pair: a CHARIZARD and
  // a CHARMELEON both on 2003283047, near certainly a clone from a trade.
  const zard = mon("CHARIZARD", { personality: 2003283047, species: 6, level: 37 });
  const meleon = mon("CHARMELEON", { personality: 2003283047, species: 5, level: 27 });
  const clones = party(zard, meleon);
  check("a shared personality is separated by species", slotOfMon(clones, meleon, 0) === 1,
    `found at ${slotOfMon(clones, meleon, 0)}`);
  check("and the other one is too", slotOfMon(clones, zard, 1) === 0);
  check("two of the same species and key are not claimed to be told apart",
    sameMon(zard, { ...meleon, record: { ...meleon.record, species: 6 } }),
    "after the CHARMELEON evolves nothing in memory separates them, and this says so rather than guessing");
}

// -- the shape the callers rely on --------------------------------------------
{
  const r = recovery();
  r.after(stop("first"), {});
  r.after(stop("second"), {});
  check("it can say what it tried", r.stops.join(" | ") === "first | second", r.stops.join(" | "));
  r.stops.push("not really");
  check("and handing that list out does not let it be edited", r.stops.length === 2, String(r.stops.length));
  const nothing = recovery().after(null, {});
  check("a stop with no reason still reads as one", nothing.reason === "Stopped.", JSON.stringify(nothing));
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
