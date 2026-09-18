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

import { recovery, slotOf, TRIES } from "../src/recovery.js";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const stop = (reason, final = false) => ({ done: true, reason, final });
const party = (...names) => names.map((name) => ({ name }));

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
// The reason this is not just "keep the slot number": putting the target in
// front reorders the party for real, so the slot a run started with belongs to
// somebody else by the time anything goes wrong. An earlier version handed the
// stale number on and, told to train a CHARMELEON, recovered from a stop by
// promoting a PIKACHU and grinding that instead.
{
  const before = party("PIKACHU", "BEEDRILL", "CHARMELEON");
  const after = party("CHARMELEON", "BEEDRILL", "PIKACHU");
  check("before the swap it is where it started", slotOf(before, "CHARMELEON", 2) === 2);
  check("after the swap it is followed, not assumed", slotOf(after, "CHARMELEON", 2) === 0,
    `found at ${slotOf(after, "CHARMELEON", 2)} rather than the 2 it started in`);

  const r = recovery();
  const out = r.after(stop("Boxed in."), { party: after, want: "CHARMELEON", fallbackSlot: 2 });
  check("and the retry is told the slot it is actually in", out.slot === 0, `slot ${out.slot}`);

  // An unreadable party is not a reason to guess at zero.
  const blind = recovery().after(stop("Boxed in."), { party: null, want: "CHARMELEON", fallbackSlot: 2 });
  check("an unreadable party falls back to the slot it was given", blind.slot === 2, `slot ${blind.slot}`);
  // Nor is a Pokémon that has left the party -- traded, released, evolved into
  // a name this no longer recognises.
  const gone = recovery().after(stop("Boxed in."), { party: party("PIKACHU"), want: "CHARMELEON", fallbackSlot: 1 });
  check("a Pokémon that is no longer there does too", gone.slot === 1, `slot ${gone.slot}`);
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
