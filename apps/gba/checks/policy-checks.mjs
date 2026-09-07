// Checks for the policy runner, against synthetic game states.
//
// The runner is deliberately a pure function of the state it is handed, and
// this is what that buys: every branch that would otherwise need a running
// cartridge, a wild encounter and ninety seconds of walking can be driven here
// in a few lines. What matters most is not that it presses A in a battle --
// it is the refusals. This thing runs unattended, so each way it can stop is
// checked as carefully as the way it works.
//
// Run: node apps/gba/checks/policy-checks.mjs

import { runner, previewOf } from "../src/policy.js";
import { BTN } from "../src/buttons.js";

const LEG_FRAMES = 48;
const STUCK_FRAMES = 28;
const LEASH_TILES = 4;

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const mon = (over = {}) => ({
  slot: 0,
  name: "PIKACHU",
  level: 22,
  hp: 50,
  maxHp: 50,
  fainted: false,
  ...over,
});

/** Run the policy for a while. `at(frame)` returns the state that frame; the
 *  loop stops early the moment the runner says it is done. */
function drive(run, frames, at) {
  const keys = [];
  let end = null;
  for (let frame = 0; frame < frames && !end; frame++) {
    const out = run.step(at(frame));
    keys.push(out.keys);
    if (out.done) end = out;
  }
  return { keys, end, pressed: (mask) => keys.some((k) => k & mask) };
}

const walking = (over) => (frame) => ({ frame, inBattle: false, party: [mon(over)] });
const fighting = (over) => (frame) => ({ frame, inBattle: true, party: [mon(over)] });

// -- walking around ---------------------------------------------------------
{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys, end } = drive(run, 120, walking());
  check("walking does not stop on its own", end === null);
  check("a leg is walked one way", keys.slice(0, LEG_FRAMES).every((k) => k & BTN.LEFT));
  check("then it turns", keys.slice(LEG_FRAMES, LEG_FRAMES * 2).every((k) => k & BTN.DOWN));
  check(
    "and it runs rather than walks",
    keys.every((k) => k & BTN.B),
    "twice the encounters per minute, and nothing at all without the shoes"
  );
  check(
    "A is never pressed in the overworld",
    !keys.some((k) => k & BTN.A),
    "an A out here talks to whoever is standing nearby"
  );
  check("the phase is seek", run.phase === "seek");
}

// -- fighting ---------------------------------------------------------------
{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys } = drive(run, 36, fighting());
  check("a battle is fought with A", keys.some((k) => k === BTN.A));
  check("A is released between presses", keys.some((k) => k === 0), "the game reads edges");
  const held = keys.filter((k) => k === BTN.A).length;
  check("A is tapped, not leaned on", held === 12, `${held} of 36 frames`);
  check("the phase is battle", run.phase === "battle");
}

{
  // A battle is counted once, on the way in, not once per frame.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  drive(run, 200, (frame) => ({
    frame,
    inBattle: frame >= 20 && frame < 60,
    party: [mon()],
  }));
  check("one encounter counts as one battle", run.battles === 1, `counted ${run.battles}`);
  check("and it ends back in seek", run.phase === "seek");
}

// -- the reasons to stop ----------------------------------------------------
{
  const run = runner({ slot: 0, stopAtLevel: 25 });
  const { end } = drive(run, 200, (frame) => ({
    frame,
    inBattle: false,
    party: [mon({ level: frame < 50 ? 24 : 25 })],
  }));
  check("it stops at the level asked for", end !== null && /level 25/.test(end.reason), end && end.reason);
  check("and lets go of the buttons", end !== null && end.keys === 0);
}

{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 40, fighting({ hp: 0, fainted: true }));
  check("a fainted Pokémon stops the run", end !== null && /fainted/.test(end.reason));
}

{
  const run = runner({ slot: 0, stopAtLevel: 30, stopBelowHp: 0.15 });
  const { end } = drive(run, 40, fighting({ hp: 7 }));
  check(
    "low HP stops the run rather than fighting on",
    end !== null && /7\/50/.test(end.reason),
    end && end.reason
  );
}

{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end, keys } = drive(run, 200, (frame) => ({ frame, inBattle: false, party: [] }));
  check(
    "a party that stays unreadable stops the run",
    end !== null && /Lost sight/.test(end.reason),
    end && `after ${keys.length} frames`
  );
  check("and nothing is pressed while blind", keys.every((k) => k === 0));
}

{
  // A read that fails for a frame is a torn write, not a lost game: the party
  // is read out of memory the cartridge is writing to.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 300, (frame) => ({
    frame,
    inBattle: false,
    party: frame % 50 === 0 ? null : [mon()],
  }));
  check("a torn read here and there is tolerated", end === null);
}

// -- running away -----------------------------------------------------------
{
  // Between the flee threshold and the stop threshold: hurt enough to leave,
  // not hurt enough to give up.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34, stopBelowHp: 0.15 });
  const { keys, end, pressed } = drive(run, 48, fighting({ hp: 12 }));
  check("hurt in a battle, it runs instead of stopping", end === null);
  check("B first, to back out of whichever menu is up", pressed(BTN.B));
  check("then down", pressed(BTN.DOWN));
  check("then right", pressed(BTN.RIGHT), "the step a shorter window used to skip entirely");
  check("then A", pressed(BTN.A));
  check(
    "every step of RUN is actually pressed in one cycle",
    [BTN.B, BTN.DOWN, BTN.RIGHT, BTN.A].every((m) => keys.some((k) => k & m))
  );
}

{
  // Healthy: no fleeing, so no stray directions into the move menu.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34 });
  const { pressed } = drive(run, 48, fighting({ hp: 50 }));
  check(
    "a healthy battle presses nothing but A",
    !pressed(BTN.DOWN | BTN.RIGHT | BTN.B),
    "the B held while walking must not follow it into a menu"
  );
}

// -- patience ---------------------------------------------------------------
{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end, keys } = drive(run, 4000, fighting());
  check(
    "a battle that never ends stops the run",
    end !== null && /stopped responding/.test(end.reason),
    end && `after ${keys.length} frames`
  );
}

{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end, keys } = drive(run, 6000, walking());
  check(
    "walking with no encounters stops the run",
    end !== null && /without a single encounter/.test(end.reason),
    end && `after ${keys.length} frames`
  );
}

// -- the flag against reality ----------------------------------------------
//
// `inBattle` was read out of a struct located by its shape, and its meaning
// taken from the game's own source, but it has never been watched turning on.
// So the runner does not trust it: HP falling is a fight, whatever the flag
// says, and a flag that keeps disagreeing is a flag to stop on.
{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const hp = [50, 48, 48, 45, 45, 42, 42, 42];
  const { end } = drive(run, hp.length, (frame) => ({
    frame,
    inBattle: false,
    party: [mon({ hp: hp[frame] })],
  }));
  check(
    "HP falling with the flag off stops the run",
    end !== null && /does not report a battle/.test(end.reason),
    end && end.reason
  );
}

{
  // The same damage with the flag on is just a battle, and must not trip it.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const hp = [50, 48, 45, 42, 40, 38, 36, 34, 32, 30];
  const { end } = drive(run, hp.length, (frame) => ({
    frame,
    inBattle: true,
    party: [mon({ hp: hp[frame] })],
  }));
  check("the same damage inside a battle does not", end === null);
}

{
  // One drop on the frame a battle ends is ordinary: the flag and the HP read
  // are a frame apart. Four battles in a row must not add up to a stop.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  let hp = 50;
  const { end } = drive(run, 400, (frame) => {
    const inBattle = frame % 100 < 40;
    if (frame % 100 === 40) hp -= 2; // the damage lands as the flag clears
    return { frame, inBattle, party: [mon({ hp })] };
  });
  check("a drop as each battle ends never adds up to a stop", end === null, end && end.reason);
}

// -- knowing whether it actually moved -------------------------------------
//
// This is the whole item-ball fix. Holding LEFT into a Poke Ball on the ground
// and walking left are the same buttons and the same screen; the only thing
// that tells them apart is the tile not changing. Nothing here knows what an
// item ball is -- it knows it is not moving, and turns.
const tile = (x, y, mapNum = 1) => ({ x, y, map: { mapGroup: 3, mapNum } });

{
  // Blocked from the first frame. It must not spend a whole forty-frame leg
  // walking into it.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys } = drive(run, 120, (frame) => ({
    frame,
    inBattle: false,
    party: [mon()],
    position: tile(9, 9),
  }));
  const turnedAt = keys.findIndex((k) => !(k & BTN.LEFT));
  check(
    "a wall it cannot pass makes it turn early",
    turnedAt === STUCK_FRAMES,
    `turned after ${turnedAt} frames rather than serving out all ${LEG_FRAMES}`
  );
  check(
    "and the stuck threshold is under a leg, or it would never fire",
    STUCK_FRAMES < LEG_FRAMES,
    "both were forty at first, which made it dead code that read as a feature"
  );
  check("and it tries a different direction", (keys[turnedAt] & BTN.DOWN) !== 0);
}

{
  // Walking normally: the tile changes, so nothing should turn early.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys } = drive(run, 40, (frame) => ({
    frame,
    inBattle: false,
    party: [mon()],
    position: tile(9 - Math.floor(frame / 8), 9),
  }));
  check("moving freely, it walks the whole leg", keys.every((k) => k & BTN.LEFT));
}

{
  // Boxed in on every side. Turning forever gets nowhere, and saying so beats
  // the generic "no encounters" message an hour later.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 6000, (frame) => ({
    frame,
    inBattle: false,
    party: [mon()],
    position: tile(9, 9),
  }));
  check(
    "boxed in, it says so rather than blaming the grass",
    end !== null && /never moved a single tile/.test(end.reason),
    end && end.reason
  );
}

{
  // A door is a warp onto a different map, and there is no route home yet, so
  // this stops rather than wandering off into a town.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 60, (frame) => ({
    frame,
    inBattle: false,
    party: [mon()],
    position: tile(9, 9, frame < 20 ? 1 : 2),
  }));
  check(
    "walking onto another map stops the run",
    end !== null && /off the map it started on/.test(end.reason),
    end && end.reason
  );
}

// -- the leash ---------------------------------------------------------------
//
// Four equal-length legs only return to where they began if all four cover
// the same ground, and a blocked leg turns early, so the drift is systematic:
// it walks steadily out of the grass it was put in. The tile read makes the
// fix a leash rather than a better pattern.
{
  // A world that actually moves. The player drifts west one tile every eight
  // frames while LEFT is held, and east while RIGHT is.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  let x = 20, y = 9, last = 0, held = 0;
  const trace = [];
  for (let frame = 0; frame < 900; frame++) {
    const out = run.step({ frame, inBattle: false, party: [mon()], position: tile(x, y) });
    if (out.done) break;
    if (out.keys === last) held++;
    else { held = 0; last = out.keys; }
    if (held > 0 && held % 8 === 0) {
      if (out.keys & BTN.LEFT) x--;
      else if (out.keys & BTN.RIGHT) x++;
      else if (out.keys & BTN.UP) y--;
      else if (out.keys & BTN.DOWN) y++;
    }
    trace.push([x, y]);
  }
  const far = trace.filter(([tx, ty]) => Math.abs(tx - 20) > LEASH_TILES + 1 || Math.abs(ty - 9) > LEASH_TILES + 1);
  check(
    "and never wanders more than the leash from where it started",
    far.length === 0,
    far.length ? `strayed to ${far[0]} from (20,9)` : `stayed within ${LEASH_TILES + 1} tiles over ${trace.length} frames`
  );
  const visited = new Set(trace.map((t) => t.join(",")));
  check(
    "while still covering ground rather than standing still",
    visited.size >= 4,
    `${visited.size} distinct tiles`
  );
}

{
  // No position read at all: it must still walk, on the clock alone.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys, end } = drive(run, 120, walking());
  check("with no position read it falls back to turning on the clock", end === null);
  check("and still holds a direction", keys.every((k) => k & (BTN.LEFT | BTN.DOWN | BTN.RIGHT | BTN.UP)));
}

// -- the move it will actually use ------------------------------------------
//
// A is the only button it presses in a battle, and A picks the first move.
// So the first move is the entire strategy, and the two ways that goes wrong
// -- no damage, and no PP -- are both worth catching before a night of it.
const withMoves = (first, pp = 30, rest = []) => ({
  ...mon(),
  record: { moves: [{ id: first, pp }, ...rest.map((id) => ({ id, pp: 10 }))] },
});

{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 40, (frame) => ({
    frame,
    inBattle: true,
    // THUNDER SHOCK, spent.
    party: [withMoves(84, 0)],
  }));
  check(
    "a first move with no PP stops the run and names it",
    end !== null && /no PP left for THUNDER SHOCK/.test(end.reason),
    end && end.reason
  );
}

{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end, keys } = drive(run, 40, (frame) => ({
    frame,
    inBattle: true,
    party: [withMoves(84, 12)],
  }));
  check("with PP left it fights on", end === null && keys.some((k) => k & BTN.A));
}

{
  // A party read whose checksum did not agree carries no record, and that
  // must not be mistaken for an empty move.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 40, fighting());
  check("no decoded record is not the same as no PP", end === null);
}

{
  // The preview, which is what the panel shows before anything runs.
  check(
    "the preview names the move and its power",
    (() => {
      const p = previewOf({ slot: 0 }, [withMoves(84, 30)]);
      return p && p.move === "THUNDER SHOCK" && p.power === 40 && p.pp === 30;
    })()
  );
  check(
    "a status move in the first slot reads as zero power",
    (() => {
      const p = previewOf({ slot: 0 }, [withMoves(45, 40)]); // GROWL
      return p && p.move === "GROWL" && p.power === 0;
    })()
  );
  check("no party means no preview", previewOf({ slot: 0 }, null) === null);
  check(
    "an undecodable record previews without a move rather than guessing",
    (() => {
      const p = previewOf({ slot: 0 }, [mon()]);
      return p && p.move === null;
    })()
  );
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
