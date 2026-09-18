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

import { runner, previewOf, bestMove, spent } from "../src/policy.js";
import { recorder } from "../src/route.js";
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
  // Hurt enough to leave. RUN is the fourth option on the action menu and the
  // cursor gets there by XOR, exactly like the moves -- which replaced a
  // blind B/DOWN/RIGHT/A sequence that only worked from a cursor position
  // nobody was reading.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34, stopBelowHp: 0.05 });
  const { keys, end } = drive(run, 24, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), hp: 12, record: { moves: [{ id: 84, pp: 20 }] } }],
    battle: { menu: "action", action: 0, cursor: 0, active: 0 },
  }));
  check("hurt in a battle, it runs instead of stopping", end === null);
  check(
    "and steers the action cursor towards RUN",
    keys.some((k) => k & BTN.RIGHT),
    "RUN is index 3, so bit 0 flips first"
  );
}

{
  // The same Pokémon, the same HP, against a trainer.
  //
  // "No! There's no running from a trainer battle!" -- the game refuses and
  // puts the cursor back, and nothing here could see that happen. An
  // interrupted walk pressed RUN at the Nugget Bridge for the full minute of
  // patience and then reported that the battle had stopped responding; the
  // battle was responding perfectly. `gBattleTypeFlags` says outright which
  // kind of battle this is, and the only right answer to a trainer is to win.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34, stopBelowHp: 0.05 });
  const { keys, end } = drive(run, 40, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), hp: 12, record: { moves: [{ id: 84, pp: 20 }] } }],
    battle: { menu: "action", action: 0, cursor: 0, active: 0, trainer: true },
  }));
  check("against a trainer it does not try to run", !keys.some((k) => k & (BTN.RIGHT | BTN.DOWN)));
  check("it fights instead", keys.some((k) => k & BTN.A) && end === null);
}

{
  // A cartridge whose battle type cannot be read says nothing rather than
  // false, and nothing has to mean "try to run" -- the behaviour that existed
  // before the flag did. Guessing "trainer" would turn every interrupted walk
  // into a fight it did not ask for.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34, stopBelowHp: 0.05 });
  const { keys } = drive(run, 24, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), hp: 12, record: { moves: [{ id: 84, pp: 20 }] } }],
    battle: { menu: "action", action: 0, cursor: 0, active: 0 },
  }));
  check("a battle type it cannot read still tries to run", keys.some((k) => k & BTN.RIGHT));
}

{
  // Already on RUN: confirm it rather than cycling past.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34, stopBelowHp: 0.05 });
  const { keys } = drive(run, 24, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), hp: 12, record: { moves: [{ id: 84, pp: 20 }] } }],
    battle: { menu: "action", action: 3, cursor: 0, active: 0 },
  }));
  check(
    "with the cursor already on RUN it presses A",
    keys.some((k) => k & BTN.A) && !keys.some((k) => k & (BTN.RIGHT | BTN.DOWN))
  );
}

{
  // Caught on the move list while wanting out: B goes back to where RUN is.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34, stopBelowHp: 0.05 });
  const { keys } = drive(run, 24, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), hp: 12, record: { moves: [{ id: 84, pp: 20 }] } }],
    battle: { menu: "move", action: 0, cursor: 0, active: 0 },
  }));
  check("from the move list it backs out with B", keys.some((k) => k & BTN.B));
}

{
  // The game opens "Choose a POKéMON" by itself when the one out faints. Two
  // A presses send out the next: the party member, then SHIFT.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys, end } = drive(run, 24, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), record: { moves: [{ id: 84, pp: 20 }] } }],
    battle: { menu: "party", action: 2, cursor: 0, active: 0 },
  }));
  check(
    "a forced switch is answered with A, not directions",
    end === null && keys.some((k) => k & BTN.A) && !keys.some((k) => k & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN))
  );
}

{
  // Judging the right animal. The trainee is slot 0 and healthy; slot 1 is
  // out and nearly dead. It is slot 1 that decides whether to run.
  const run = runner({ slot: 0, stopAtLevel: 30, fleeBelowHp: 0.34, stopBelowHp: 0.05 });
  const { keys } = drive(run, 24, (frame) => ({
    frame,
    inBattle: true,
    party: [
      { ...mon(), hp: 50, record: { moves: [{ id: 84, pp: 20 }] } },
      { ...mon(), slot: 1, name: "BEEDRILL", hp: 3, maxHp: 49, record: { moves: [{ id: 84, pp: 20 }] } },
    ],
    battle: { menu: "action", action: 0, cursor: 0, active: 1 },
  }));
  check(
    "it judges the Pokémon that is actually out",
    keys.some((k) => k & BTN.RIGHT),
    "the lead is fine; the one fighting is not, so it heads for RUN"
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
  // Every move spent. Now that it can choose, this is the only PP situation
  // that is actually fatal.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 40, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), record: { moves: [{ id: 84, pp: 0 }, { id: 98, pp: 0 }] } }],
  }));
  check(
    "no PP left in any move stops the run",
    end !== null && /no PP left in any move/.test(end.reason),
    end && end.reason
  );
}

{
  // A spent first move is no longer fatal: there is another one.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { end } = drive(run, 40, (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), record: { moves: [{ id: 84, pp: 0 }, { id: 98, pp: 20 }] } }],
  }));
  check("but a spent first move is not, when another has PP", end === null);
}

// -- choosing the move -------------------------------------------------------
//
// The reported bug three ways over: it mashed A, A takes the first move, and
// on a typical party that is Growl, or Leer, or something with no PP left.
// The cursor moves by XOR -- left/right flip bit 0, up/down flip bit 1 -- so
// each press is one axis and is checked against the cursor rather than
// counted.
const party4 = (specs) => [{ ...mon(), record: { moves: specs.map(([id, pp]) => ({ id, pp })) } }];
// LEER(0 power), PECK(35), FOCUS ENERGY(0), DOUBLE KICK(30) -- the real party
// member this was found with.
const NIDORAN = [[43, 30], [64, 35], [116, 30], [24, 20]];

const inMove = (cursor, party) => (frame) => ({
  frame, inBattle: true, party, battle: { menu: "move", cursor, action: 0, active: 0 },
});

{
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys } = drive(run, 24, inMove(0, party4(NIDORAN)));
  check(
    "on the move list it walks the cursor towards the best move",
    keys.some((k) => k & BTN.RIGHT) && !keys.some((k) => k & BTN.A),
    "PECK is index 1, so bit 0 has to flip and nothing should be confirmed yet"
  );
}

{
  // Cursor already on PECK: confirm, do not wander off it.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys } = drive(run, 24, inMove(1, party4(NIDORAN)));
  check(
    "once the cursor is on it, it presses A",
    keys.some((k) => k & BTN.A) && !keys.some((k) => k & (BTN.RIGHT | BTN.DOWN))
  );
}

{
  // Best move at index 3 from cursor 0 needs both bits. One axis per press.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const strong = party4([[43, 30], [45, 30], [116, 30], [25, 5]]); // MEGA KICK at 3
  const { keys } = drive(run, 24, inMove(0, strong));
  const pressed = keys.filter((k) => k !== 0);
  check(
    "two bits apart, it flips one axis at a time",
    pressed.every((k) => k === BTN.RIGHT) && pressed.length > 0,
    "bit 0 first; the next frame's cursor read decides the rest"
  );
}

{
  // Off the move list, A is right for everything: the action menu, text, an
  // animation. Nothing here should be pressing directions.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys } = drive(run, 24, (frame) => ({
    frame, inBattle: true, party: party4(NIDORAN),
    battle: { menu: "action", action: 0, cursor: 0, active: 0 },
  }));
  check("at the action menu it just presses A", keys.some((k) => k & BTN.A) && !keys.some((k) => k & (BTN.RIGHT | BTN.DOWN)));
}

{
  // A build whose menus this cannot read falls back to what it did before.
  const run = runner({ slot: 0, stopAtLevel: 30 });
  const { keys, end } = drive(run, 24, (frame) => ({
    frame, inBattle: true, party: party4(NIDORAN), battle: null,
  }));
  check("with no menu read it falls back to mashing A", end === null && keys.some((k) => k & BTN.A));
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
    "and it is the move that will be chosen, not the first one",
    (() => {
      const p = previewOf({ slot: 0 }, party4(NIDORAN));
      return p && p.move === "PECK" && p.power === 35;
    })(),
    "LEER is in slot one and does nothing"
  );
  check(
    "a party of nothing but status moves reads as zero power",
    (() => {
      const p = previewOf({ slot: 0 }, party4([[45, 40], [43, 30]])); // GROWL, LEER
      return p && p.power === 0;
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

// -- the trip to the Pokemon Center -----------------------------------------
//
// The whole point of the feature: a run that heals is a run that lasts the
// night. What is checked is the loop end to end -- hurt enough to go, follow
// the route, be healed, come back, and resume grinding where it started --
// plus the two ways it can go wrong that must stop rather than wander.

const place = (x, y, mapNum = 24) => ({ x, y, map: { mapGroup: 3, mapNum } });

/** A route from the grass on Route 6 south into Vermilion, to a nurse, and
 *  back -- the actual shape of the trip this save would make. */
function centreRoute() {
  const rec = recorder();
  const hurtParty = [{ hp: 4, maxHp: 34 }];
  const wholeParty = [{ hp: 34, maxHp: 34 }];
  for (let y = 22; y >= 19; y--) rec.sample(place(20, y), hurtParty, BTN.UP);
  rec.sample(place(15, 7, 5), hurtParty, BTN.UP);   // north off Route 6 is the door
  rec.sample(place(15, 8, 5), hurtParty, BTN.DOWN);
  rec.sample(place(15, 8, 5), wholeParty, BTN.DOWN);
  rec.sample(place(15, 7, 5), wholeParty, BTN.UP);  // north out of Vermilion again
  for (let y = 19; y <= 22; y++) rec.sample(place(20, y), wholeParty, BTN.DOWN);
  return rec.stop();
}

{
  const route = centreRoute();
  const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0.4, stopBelowHp: 0.05 }, route);

  // A world that walks where it is told and heals when A is pressed at the
  // counter, so the loop itself is what is under test.
  let at = place(20, 22);
  let hp = 8; // 8/34 -- under the threshold, over the floor
  const seen = new Set();
  let healedAt = null;
  let last = 0, held = 0, out = null;

  for (let frame = 0; frame < 4000; frame++) {
    out = run.step({
      frame,
      inBattle: false,
      party: [{ ...mon(), hp, maxHp: 34, record: { moves: [{ id: 84, pp: 20 }] } }],
      position: at,
    });
    if (out.done) break;
    seen.add(run.mode);
    if (out.keys === last) held++; else { held = 0; last = out.keys; }
    if (held > 0 && held % 8 === 0) {
      const before = `${at.map.mapNum}:${at.x},${at.y}`;
      if (out.keys & BTN.LEFT) at = place(at.x - 1, at.y, at.map.mapNum);
      else if (out.keys & BTN.RIGHT) at = place(at.x + 1, at.y, at.map.mapNum);
      else if (out.keys & BTN.UP) at = place(at.x, at.y - 1, at.map.mapNum);
      else if (out.keys & BTN.DOWN) at = place(at.x, at.y + 1, at.map.mapNum);
      // The warp: walking north off Route 6 at y=18 lands in Vermilion.
      if (at.map.mapNum === 24 && at.y < 19) at = place(15, 7, 5);
      // And walking north out of Vermilion goes back to Route 6.
      if (at.map.mapNum === 5 && at.y < 7) at = place(20, 19, 24);
      if (before !== `${at.map.mapNum}:${at.x},${at.y}`) held = 0;
    }
    // The nurse: A at (15,8) in Vermilion heals.
    if (at.map.mapNum === 5 && at.x === 15 && at.y === 8 && (out.keys & BTN.A) && hp < 34) {
      hp = 34;
      healedAt = frame;
    }
  }

  check("hurt enough, it sets off for the Centre", seen.has("toNurse"));
  check("it reaches the nurse", seen.has("atNurse"));
  check("and is healed", healedAt !== null, healedAt !== null ? `at frame ${healedAt}` : "never");
  check("then walks back", seen.has("back"));
  check(
    "and resumes grinding where it started",
    run.mode === "grind" && at.map.mapNum === 24,
    `mode ${run.mode}, at map ${at.map.mapNum} (${at.x},${at.y})`
  );
  check(
    "within the leash of the route's first tile, so the next trip is short",
    Math.abs(at.x - 20) <= 5 && Math.abs(at.y - 22) <= 5,
    `route starts at (20,22), ended at (${at.x},${at.y})`
  );
  check("without stopping the run", out !== null && !out.done, out && out.reason);
}

{
  // No route: healing is not on the table, and low HP stops the run exactly
  // as it did before. This must not regress.
  const run = runner({ slot: 0, stopAtLevel: 99, stopBelowHp: 0.15 });
  const { end } = drive(run, 60, (frame) => ({
    frame, inBattle: false, position: place(20, 22),
    party: [{ ...mon(), hp: 4, maxHp: 34 }],
  }));
  check("with no route, low HP still stops the run", end !== null && /down to 4\/34/.test(end.reason), end && end.reason);
}

{
  // A route recorded without a heal in it is not a route to a Centre, and
  // must not be acted on as one.
  const rec = recorder();
  for (let y = 22; y >= 19; y--) rec.sample(place(20, y), [{ hp: 4, maxHp: 34 }], BTN.UP);
  const run = runner({ slot: 0, stopAtLevel: 99, stopBelowHp: 0.15 }, rec.stop());
  const { end } = drive(run, 60, (frame) => ({
    frame, inBattle: false, position: place(20, 22),
    party: [{ ...mon(), hp: 4, maxHp: 34 }],
  }));
  check("a route with no observed heal is not used", end !== null && /down to 4\/34/.test(end.reason));
}

{
  // Blocked on the way. An NPC standing in a doorway is patient-worthy; a
  // wall that was not there when the route was walked is not.
  const route = centreRoute();
  const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0.4, stopBelowHp: 0.02 }, route);
  const { end } = drive(run, 3000, (frame) => ({
    frame, inBattle: false, position: place(20, 22),
    party: [{ ...mon(), hp: 8, maxHp: 34, record: { moves: [{ id: 84, pp: 20 }] } }],
  }));
  check(
    "stuck on the way, it says where",
    end !== null && /Stuck on the way to the Pokémon Center/.test(end.reason),
    end && end.reason
  );
}

{
  // Started well away from the route. The anchor is the route's first tile,
  // not where Start was pressed, so the leash walks it back onto the path
  // rather than letting the heal trip straight-line across the scenery.
  const route = centreRoute();
  const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0.4, stopBelowHp: 0.02 }, route);
  const out = run.step({
    frame: 0,
    inBattle: false,
    party: [{ ...mon(), hp: 30, maxHp: 34, record: { moves: [{ id: 84, pp: 20 }] } }],
    position: place(28, 22),
  });
  // Healthy, so it is grinding -- and eight tiles east of the route's start,
  // which is outside the leash, so it should be heading west.
  check(
    "pressed Start away from the route, it drifts back towards it",
    (out.keys & BTN.LEFT) !== 0,
    "the anchor is the route's first tile, not wherever Start was pressed"
  );
}

// -- running dry, and what a Centre actually fixes ---------------------------
//
// Playing it surfaced the simplification the whole loop turns on: a Pokémon
// Center restores PP as well as HP. So "out of PP" and "nearly dead" are not
// two problems, they are one errand -- and only without a route are either of
// them an ending.
{
  const route = centreRoute();
  const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0.4, stopBelowHp: 0.02 }, route);
  const seen = new Set();
  // Fewer frames than the route's own stuck timeout: this world does not
  // move, and what is under test is that it sets off at all.
  const { end } = drive(run, 200, (frame) => {
    seen.add(run.mode);
    return {
      frame, inBattle: false, position: place(20, 22),
      party: [{ ...mon(), hp: 34, maxHp: 34, record: { moves: [{ id: 84, pp: 0 }, { id: 98, pp: 0 }] } }],
    };
  });
  check(
    "out of PP with a route is an errand, not an ending",
    end === null && seen.has("toNurse"),
    end ? end.reason : `modes seen: ${[...seen].join(", ")}`
  );
}

{
  // The same party with nowhere to go still stops, and says why.
  const run = runner({ slot: 0, stopAtLevel: 99, stopBelowHp: 0.02 });
  const { end } = drive(run, 60, (frame) => ({
    frame, inBattle: false, position: place(20, 22),
    party: [{ ...mon(), hp: 34, maxHp: 34, record: { moves: [{ id: 84, pp: 0 }] } }],
  }));
  check("and without one it still stops", end !== null && /no PP left in any move/.test(end.reason));
}

{
  // A faint with a route: the game forces a switch, this takes it and then
  // leaves for a Centre rather than ending the night.
  const route = centreRoute();
  const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0.4, stopBelowHp: 0.02 }, route);
  const seen = new Set();
  const { end } = drive(run, 200, (frame) => {
    seen.add(run.mode);
    return {
      frame, inBattle: false, position: place(20, 22),
      party: [
        { ...mon(), hp: 0, fainted: true, record: { moves: [{ id: 84, pp: 20 }] } },
        { ...mon(), slot: 1, name: "BEEDRILL", hp: 49, maxHp: 49, record: { moves: [{ id: 84, pp: 20 }] } },
      ],
    };
  });
  check(
    "a faint with a route sends it to a Centre rather than ending",
    end === null && seen.has("toNurse"),
    end ? end.reason : `modes seen: ${[...seen].join(", ")}`
  );
}

{
  const run = runner({ slot: 0, stopAtLevel: 99 });
  const { end } = drive(run, 60, (frame) => ({
    frame, inBattle: false, position: place(20, 22),
    party: [{ ...mon(), hp: 0, fainted: true }],
  }));
  check("a faint with nowhere to go still stops", end !== null && /fainted/.test(end.reason));
}

// -- out of PP is not the same as unreadable ---------------------------------
//
// `bestMove` answers null for two unrelated reasons, and a caller that cannot
// tell them apart sends a Pokémon at full HP and full PP to a Centre. The
// party record is checksummed and read out of memory the cartridge is writing
// to mid-battle, so a frame where it fails to decode is ordinary; measured at
// 49 such frames in six minutes of grinding, and four trips they explain.
{
  const readable = (moves) => ({ name: "TEST", hp: 40, maxHp: 40, record: { moves } });
  const torn = { name: "TEST", hp: 40, maxHp: 40, record: null };

  const healthy = readable([{ id: 52, pp: 25 }, { id: 106, pp: 30 }]);
  check("a Pokémon with PP has a move and is not spent", !!bestMove(healthy) && !spent(healthy));

  const empty = readable([{ id: 52, pp: 0 }, { id: 106, pp: 0 }]);
  check("a Pokémon with no PP anywhere is spent", spent(empty) && !bestMove(empty));

  check("a record that did not decode has no move to offer", bestMove(torn) === null);
  check("but is NOT spent — that is the distinction that matters", spent(torn) === false);

  const blank = readable([{ id: 0, pp: 0 }, { id: 0, pp: 0 }]);
  check("an empty move list counts as spent", spent(blank));

  // A status-only Pokémon still has something to do. Stopping on that would
  // be wrong when Sing can be the thing that ends a fight.
  const statusOnly = readable([{ id: 47, pp: 15 }]);
  check("a Pokémon with only status moves is not spent", !spent(statusOnly));
}

// -- when to set off for a Centre, measured rather than guessed --------------
//
// A fraction of max HP cannot answer "can I take another fight": 80% is a
// scratch to something losing three HP a battle and nearly fatal to something
// losing thirty. So the runner watches what the fights here actually cost and
// leaves when what is left would not cover a few more of them plus the walk.
{
  const mon = (hp, maxHp = 100) => ({
    name: "TEST", hp, maxHp, level: 5, fainted: hp === 0,
    record: { moves: [{ id: 52, pp: 25 }] },
  });
  const atlas = {
    covers: () => true,
    gridOf: () => ({ width: 9, height: 9, name: "F", at: () => true, isGrass: () => true }),
    doorsOf: () => new Set(),
    mapRoute: () => [],
    centreInside: () => null,
    nearestCentre: () => ({ hops: [], inside: { name: "C" }, door: { mapGroup: 3, mapNum: 5, x: 1, y: 1 } }),
    // A real patch answers `has` from a finite set. Saying yes to everything
    // makes the flood fill unbounded, which is a fault in the toy -- and was
    // worth finding, because the planner now refuses to outrun the patch.
    grassPatch: () => {
      const tiles = new Set(["4,4", "4,5", "5,4", "5,5"]);
      return { seed: { x: 4, y: 4 }, tiles, has: (x, y) => tiles.has(`${x},${y}`) };
    },
  };
  const at = { x: 4, y: 4, map: { mapGroup: 3, mapNum: 24 } };

  /** Run a party through `frames`, optionally fighting, and report the runner. */
  const play = (hpSeries, healBelowHp = 0.35) => {
    const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp, stopBelowHp: 0 }, null, atlas);
    let f = 0;
    for (const [hp, inBattle] of hpSeries) {
      for (let i = 0; i < 3; i++) {
        run.step({ frame: f++, party: [mon(hp)], inBattle, battle: null, position: at });
      }
    }
    return run;
  };

  // A gentle place: three HP a battle. Nothing here should ever send it away.
  const gentle = [];
  for (let i = 0; i < 6; i++) { gentle.push([100 - i * 3, true], [100 - (i + 1) * 3, false]); }
  const soft = play(gentle);
  check("a place that chips three HP a battle never books a trip",
    soft.mode === "grind" && !soft.healBecause,
    `${soft.mode} / ${soft.healBecause} / worst ${soft.worstHit}`);
  check("and it learned what the fights here cost", soft.worstHit === 3, `${soft.worstHit}`);

  // A rough place: thirty a battle. The same 82% HP has to mean something else.
  const rough = play([[100, true], [70, false], [70, true], [40, false]]);
  check("a place that takes thirty a battle sends it away with plenty left",
    rough.worstHit === 30 && (rough.mode === "journey" || rough.healBecause),
    `worst ${rough.worstHit}, ${rough.mode}, ${rough.healBecause}`);
  check("and says that is why", rough.healBecause === "not enough left for another fight",
    String(rough.healBecause));

  // The floor still catches the case nothing has measured yet.
  const unhit = play([[20, false]], 0.5);
  check("the floor still applies when nothing has hit yet",
    unhit.worstHit === 0 && (unhit.mode === "journey" || unhit.healBecause === "hurt"),
    `${unhit.mode} / ${unhit.healBecause}`);
}

// -- a box on screen, which the walk cannot see -----------------------------
//
// "CLEFAIRY fainted…" prints in the overworld with a "▼" waiting on A, and
// every direction is swallowed until it is pressed. That looked exactly like a
// freeze and was reported as one twice. The old answer was the clock: two
// seconds of a tile that will not change, then press A and hope. The new one
// is `sLockFieldControls`, the byte the overworld sets while a script, a
// cutscene or a message box has the controls.
//
// What is checked is both directions, because knowing changes both: a box is
// answered four times faster, and a *wall* -- unlocked, not moving -- stops
// being answered with an A press at all. An A press at a wall talks to
// whoever is standing behind it, which is its own way to lose a run.
{
  // Walk for a while so `everMoved` is true -- a player who has never taken a
  // step is walled in, which has a different answer -- then stop, locked.
  const STOPS = 24;
  // Three tiles, not thirty: far enough that `everMoved` is true, close enough
  // that the leash does not decide it has wandered and take over first.
  const frozen = (locked) => (frame) => ({
    frame,
    inBattle: false,
    party: [mon()],
    position: frame < STOPS ? tile(9 - Math.floor(frame / 8), 9) : tile(6, 9),
    // The lock arrives with the stall, as a real box would.
    ...(locked === null ? {} : { fieldLocked: locked && frame >= STOPS }),
  });
  const firstPress = (run) => run.keys.findIndex((k, i) => i > STOPS && k & BTN.A);

  const boxed = drive(runner({ slot: 0, stopAtLevel: 30 }), 400, frozen(true));
  const pressedAt = firstPress(boxed);
  check(
    "a message box is answered without waiting out the clock",
    pressedAt > STOPS && pressedAt < 90,
    pressedAt < 0 ? "never pressed A" : `pressed A at frame ${pressedAt}, where the clock alone needs ${STOPS + 121}`
  );
  check(
    "and not the instant it stalls, which would press A at every warp",
    pressedAt > STOPS + 30,
    `half a second of held controls is the bar; this pressed ${pressedAt - STOPS} frames in`
  );

  // The same stall with the controls in the player's hands is a wall.
  const walled = drive(runner({ slot: 0, stopAtLevel: 30 }), 400, frozen(false));
  check(
    "a wall is not answered by talking to it",
    firstPress(walled) < 0,
    "unlocked and not moving means blocked, and A in the overworld talks to whoever is there"
  );

  // A cartridge whose layout is unknown reads null, and null is not false.
  // The clock is still the fallback, because guessing "no box" and walking
  // into one is the freeze this whole thing exists to end.
  const blind = drive(runner({ slot: 0, stopAtLevel: 30 }), 400, frozen(null));
  const blindAt = firstPress(blind);
  check(
    "a cartridge that cannot answer falls back to the clock rather than to nothing",
    blindAt > STOPS + 110,
    blindAt < 0 ? "never pressed A, so an unknown build could freeze forever" : `pressed A at frame ${blindAt}`
  );
}

// -- the cursor does not wrap -------------------------------------------------
//
// Both battle menus are two by two and the cursor moves by XOR, so any target
// is at most two presses away. That much was right. What was missing is that
// the direction within an axis is not free: **the cursor does not wrap**.
// RIGHT from the right-hand column does nothing, DOWN from the bottom row does
// nothing, and pressing one of those is indistinguishable from pressing
// nothing at all.
//
// Every caller pressed RIGHT for bit 0 and DOWN for bit 1 regardless of where
// the cursor was. From FIGHT, in the top left, that works — which is why it
// survived. Found on a real cartridge: a CHARMELEON sat on METAL CLAW, the
// bottom-right move, out of PP, pressing RIGHT at it for a full minute while
// SCRATCH waited at the top left with thirty-five PP left. The same hole is
// why a battle this ran from could never get its cursor back off RUN.
//
// So the simulated menus below refuse a press that would leave the grid, as
// the game does. The old code cannot pass this.
{
  /** A 2x2 cursor that behaves like the game's: no wrapping. */
  const menu = (start) => {
    let at = start;
    return {
      get at() { return at; },
      press(keys) {
        if (keys & BTN.RIGHT && !(at & 1)) at |= 1;
        if (keys & BTN.LEFT && at & 1) at &= ~1;
        if (keys & BTN.DOWN && !(at & 2)) at |= 2;
        if (keys & BTN.UP && at & 2) at &= ~2;
      },
    };
  };

  // Every starting corner, and the move it has to reach is the far one.
  for (const from of [0, 1, 2, 3]) {
    const want = 3 - from;
    const moves = menu(from);
    const run = runner({ slot: 0, stopAtLevel: 30 });
    let confirmed = null;
    for (let frame = 0; frame < 300 && confirmed === null; frame++) {
      const out = run.step({
        frame,
        inBattle: true,
        party: [{
          ...mon(),
          record: { moves: [0, 1, 2, 3].map((i) => ({ id: i === want ? 53 : 106, pp: 20 })) },
        }],
        battle: { menu: "move", cursor: moves.at, action: 0, active: 0 },
      });
      if (out.keys & BTN.A) confirmed = moves.at;
      moves.press(out.keys);
    }
    check(
      `from move ${from} it reaches move ${want} and presses A there`,
      confirmed === want,
      confirmed === null ? "never pressed A — it is pressing into a wall" : `pressed A on ${confirmed}`
    );
  }

  // The action menu is the same grid, and the case that matters is RUN back to
  // FIGHT: a battle this ran from leaves the cursor on 3, and 3 is the corner
  // where both of the old presses are no-ops.
  const actions = menu(3);
  const run = runner({ slot: 0, stopAtLevel: 30 });
  let landed = null;
  for (let frame = 0; frame < 300 && landed === null; frame++) {
    const out = run.step({
      frame,
      inBattle: true,
      party: [{ ...mon(), record: { moves: [{ id: 52, pp: 20 }] } }],
      battle: { menu: "action", cursor: 0, action: actions.at, active: 0 },
    });
    if (out.keys & BTN.A) landed = actions.at;
    actions.press(out.keys);
  }
  check(
    "a cursor left on RUN gets back to FIGHT",
    landed === 0,
    landed === null ? "never pressed A — stuck in the corner" : `pressed A on action ${landed}`
  );
}

// -- which stops are worth picking back up ------------------------------------
//
// Both drivers -- the tab and `play.mjs` -- now restart a stopped run rather
// than ending the night on one bad minute. That is only safe if the runner
// says which stops must not be restarted, because the two that matter look
// exactly like the recoverable ones from outside: a fainted lead with nowhere
// to heal, and nothing left with any PP. Restarting either walks into the
// same wall with less to fight it with, which is how an unattended grind
// becomes a white-out.
//
// Reaching the goal is the third: not a failure at all, and restarting on it
// is how a run that finished grinds all night anyway.
{
  const stopOf = (run, frames, at) => {
    for (let frame = 0; frame < frames; frame++) {
      const out = run.step(at(frame));
      if (out.done) return out;
    }
    return null;
  };

  const reached = stopOf(runner({ slot: 0, stopAtLevel: 22 }), 40, (frame) => ({
    frame, inBattle: false, party: [mon()],
  }));
  check("reaching the level is final", reached && reached.final === true, reached && reached.reason);

  // Fainted, with no route and no atlas, so there is nowhere to heal.
  const fainted = stopOf(runner({ slot: 0, stopAtLevel: 30 }), 40, (frame) => ({
    frame, inBattle: false, party: [{ ...mon(), hp: 0, fainted: true }],
  }));
  check("a faint with nowhere to heal is final", fainted && fainted.final === true, fainted && fainted.reason);

  // Out of PP everywhere, same situation.
  const dry = stopOf(runner({ slot: 0, stopAtLevel: 30 }), 200, (frame) => ({
    frame, inBattle: false,
    party: [{ ...mon(), record: { moves: [{ id: 52, pp: 0 }, { id: 84, pp: 0 }] } }],
  }));
  check("no PP anywhere is final", dry && dry.final === true, dry && dry.reason);

  // And the ordinary kind. Walking forever without an encounter is a stumble:
  // somewhere else to stand usually fixes it, which is what a restart is.
  const barren = stopOf(runner({ slot: 0, stopAtLevel: 30 }), 90 * 60 + 200, (frame) => ({
    frame, inBattle: false, party: [mon()],
    position: { x: 9, y: 9, map: { mapGroup: 3, mapNum: 24 } },
  }));
  check(
    "but finding no encounters is not — that one is worth another go",
    barren && !barren.final,
    barren ? barren.reason : "never stopped"
  );
}

// -- the party menu the game opens after a faint ------------------------------
//
// Its submenu is SHIFT / SUMMARY / CANCEL. No ITEM, so unlike the field menu
// nothing here can be given away -- but A does not close a summary screen, so
// a run that mashes A onto SUMMARY sits in a stat page until its patience runs
// out, which on screen is a frozen game.
{
  const inBattleParty = (menu) => (frame) => ({
    frame,
    inBattle: true,
    party: [{ ...mon(), record: { moves: [{ id: 52, pp: 20 }] } }],
    battle: { menu: "party", cursor: 0, action: 0, active: 0 },
    menu,
  });
  void inBattleParty;

  // The cursor is on somebody who can fight: press A.
  const ready = drive(runner({ slot: 0, stopAtLevel: 30 }, null, {}), 24,
    inBattleParty({ open: true, actions: [11, 0, 2], cursor: 0, lastIndex: 2, slot: 0, moveTo: 0, switching: false }));
  check("on a Pokémon that can fight it presses A", ready.keys.some((k) => k & BTN.A));
  check("and does not wander off it first", !ready.keys.some((k) => k & (BTN.UP | BTN.DOWN)));
}

// -- and the one the game opens it for ----------------------------------------
//
// The cursor starts on the Pokémon that just fainted, and A on a fainted
// Pokémon does nothing at all. Pressing it anyway is a frozen game, and was: a
// level-ten CLEFAIRY sent to Route 24 was knocked out, the game asked who
// should come in, and the run pressed A at the corpse for a full minute and
// then reported that the battle had stopped responding — three times in a row,
// every time that scenario ran. It is the screen the player photographed.
{
  const fainted = (name) => ({ ...mon({ name }), hp: 0, fainted: true });
  const fit = (name) => mon({ name });
  const atSlot = (slot, party) => (frame) => ({
    frame,
    inBattle: true,
    party,
    battle: { menu: "party", cursor: 0, action: 0, active: 0 },
    menu: { open: true, actions: [11, 0, 2], cursor: 0, lastIndex: 2, slot, moveTo: 0, switching: false },
  });

  // With an atlas in hand the runner can heal, so a faint is an errand rather
  // than the end of the run -- which is the situation this screen appears in.
  // Without one, an earlier branch stops the run before the screen is reached,
  // and these checks would be testing that branch instead.
  const canHeal = {};
  const down = drive(runner({ slot: 0, stopAtLevel: 30 }, null, canHeal), 40,
    atSlot(0, [fainted("CLEFAIRY"), fit("BEEDRILL"), fit("PIKACHU")]));
  check("on a fainted one it moves the cursor instead", down.keys.some((k) => k & BTN.DOWN));
  check("and does not press A at it", !down.keys.some((k) => k & BTN.A),
    "A on a fainted Pokémon does nothing, which is what the freeze was");

  // The healthy one is above the cursor, so the press has to be the other way.
  const up = drive(runner({ slot: 0, stopAtLevel: 30 }, null, canHeal), 40,
    atSlot(2, [fit("BEEDRILL"), fit("PIKACHU"), fainted("CLEFAIRY")]));
  check("it goes up when that is where the healthy one is", up.keys.some((k) => k & BTN.UP));

  // Nobody left. There is no press that prevents a white-out, so say so and
  // do not spend a minute of patience finding out.
  const wiped = drive(runner({ slot: 0, stopAtLevel: 30 }, null, canHeal), 60,
    atSlot(0, [fainted("CLEFAIRY"), fainted("BEEDRILL")]));
  check("a wiped party is reported at once", wiped.end && /nobody left/i.test(wiped.end.reason),
    wiped.end ? wiped.end.reason : "never stopped");
  check("and is final, because there is no recovering from it", wiped.end && wiped.end.final === true);

  // Nothing readable: the old behaviour, which mostly works and never made
  // anything worse.
  const blind = drive(runner({ slot: 0, stopAtLevel: 30 }, null, canHeal), 24, (frame) => ({
    frame, inBattle: true,
    party: [fit("BEEDRILL")],
    battle: { menu: "party", cursor: 0, action: 0, active: 0 },
    menu: null,
  }));
  check("with nothing readable it still mashes A", blind.keys.some((k) => k & BTN.A));
}

// -- a trip to be healed has to be able to heal something ---------------------
//
// The margin rule asks whether what is left covers a few more of the fights
// this place has been giving. For anything whose max HP is smaller than three
// of those hits, the answer is no *at full health*, so it walked to a Pokémon
// Center, was healed to full, walked back, and decided on arrival that it
// needed healing again.
//
// Measured on the cartridge before this was fixed: a level-ten CLEFAIRY with
// 36 max HP, hit for twelve, made two round trips to Cerulean in ninety
// seconds and did not fight a single battle. Both verifier scenarios that used
// it failed this way, identically, to the frame.
{
  const atFull = (over = {}) => ({
    ...mon(),
    hp: 36, maxHp: 36,
    record: { moves: [{ id: 52, pp: 20 }] },
    ...over,
  });
  // Enough of an atlas for the runner to believe it can heal. The grind path
  // asks it for a patch of grass, so a bare object is not enough -- answering
  // null is, and is honest: there is no map here, only a question about when
  // to set off for a Centre.
  const canHeal = {
    grassPatch: () => null,
    gridOf: () => null,
    nearestCentre: () => null,
    mapAt: () => null,
    grindSpot: () => null,
  };

  // A hit of twelve against a maximum of thirty-six: a third, so three of them
  // can never be covered, however healthy it is. It is left on twenty-four,
  // which is two thirds and nowhere near the fraction floor -- so nothing here
  // is a reason to walk anywhere, and the old code walked anyway.
  const hitThenFine = (frame) => ({
    frame,
    inBattle: frame > 40 && frame < 120,
    party: [atFull({ hp: frame > 60 ? 24 : 36 })],
    position: { x: 5, y: 5, map: { mapGroup: 3, mapNum: 24 } },
  });
  const run = runner({ slot: 0, stopAtLevel: 30 }, null, canHeal);
  drive(run, 400, hitThenFine);
  check(
    "a hit it cannot build a margin against is not a reason to leave",
    run.trip !== "heal",
    `mode ${run.mode}, trip ${run.trip}, because ${run.healBecause}`
  );
  check("and nothing claims it is short of health", !/enough left/.test(run.healBecause || ""),
    String(run.healBecause));

  // Back to full, and still nowhere to go.
  const settled = drive(run, 400, (frame) => ({
    frame: 400 + frame,
    inBattle: false,
    party: [atFull()],
    position: { x: 5, y: 5, map: { mapGroup: 3, mapNum: 24 } },
  }));
  check(
    "at full health it does not set off for a Pokémon Center",
    run.trip !== "heal",
    `mode ${run.mode}, trip ${run.trip} — healing a full Pokémon changes nothing`
  );
  void settled;

  // The rule still has to work for something the margin *can* cover: a
  // hundred max HP against a twelve-point hit wants healing below 36.
  const big = runner({ slot: 0, stopAtLevel: 30 }, null, canHeal);
  drive(big, 200, (frame) => ({
    frame,
    inBattle: frame > 40 && frame < 120,
    party: [{ ...mon(), hp: frame > 60 ? 88 : 100, maxHp: 100, record: { moves: [{ id: 52, pp: 20 }] } }],
    position: { x: 5, y: 5, map: { mapGroup: 3, mapNum: 24 } },
  }));
  drive(big, 400, (frame) => ({
    frame: 200 + frame,
    inBattle: false,
    party: [{ ...mon(), hp: 30, maxHp: 100, record: { moves: [{ id: 52, pp: 20 }] } }],
    position: { x: 5, y: 5, map: { mapGroup: 3, mapNum: 24 } },
  }));
  check(
    "but a margin that is reachable still sends it when it is low",
    big.trip === "heal" || /enough left|hurt/.test(big.healBecause || ""),
    `mode ${big.mode}, trip ${big.trip}, because ${big.healBecause}`
  );
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
