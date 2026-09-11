// Checks for the journeys — the generators that walk, fight and heal.
//
// These run against a toy overworld rather than a cartridge, which is the
// point: the real thing needs a ROM nobody can commit, so without this the
// walking code could only be tested by playing. The toy is small and honest —
// tiles that are open or not, a step that takes a few frames, a nurse who
// keeps talking after the party is whole — and every failure it reproduces is
// one that actually happened.
//
// Run: node apps/gba/checks/journey-checks.mjs

import { drive } from "../src/drive.js";
import { walkPath, throughBattle, goTo, healInside } from "../src/journey.js";
import { BTN } from "../src/buttons.js";
import { world } from "../src/world.js";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

/** Run a journey against a fake machine until it finishes or the frames run out. */
function play(journeyFn, machine, { limit = 40000 } = {}) {
  const d = drive(journeyFn, { budget: limit });
  let frames = 0;
  while (!d.done && frames < limit) {
    const out = d.step(machine.look());
    if (out.done) break;
    machine.press(out.keys);
    frames++;
  }
  return { result: d.result, frames };
}

/**
 * A toy overworld: a grid, a player on it, and walking that takes time.
 *
 * `open` decides terrain. Walking is deliberately not instant — a step costs
 * frames — because a walker that only works when movement is immediate is a
 * walker that will fail on a real machine, and that is exactly the bug class
 * these journeys exist to survive.
 */
function overworld({ open, x, y, mapGroup = 3, mapNum = 24, step = 8, onTile = null }) {
  let held = 0;
  let progress = 0;
  const state = { x, y, mapGroup, mapNum, inBattle: false, battle: null, party: [{ name: "TEST", hp: 40, maxHp: 40, record: { moves: [] } }] };
  return {
    state,
    look: () => ({
      party: state.party,
      inBattle: state.inBattle,
      battle: state.battle,
      position: { x: state.x, y: state.y, map: { mapGroup: state.mapGroup, mapNum: state.mapNum } },
    }),
    press(keys) {
      const dir = keys & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
      if (!dir || dir !== held) { held = dir; progress = 0; return; }
      if (++progress < step) return;
      progress = 0;
      const dx = dir & BTN.RIGHT ? 1 : dir & BTN.LEFT ? -1 : 0;
      const dy = dir & BTN.DOWN ? 1 : dir & BTN.UP ? -1 : 0;
      if (!open(state.x + dx, state.y + dy, state)) return;
      state.x += dx;
      state.y += dy;
      if (onTile) onTile(state);
    },
  };
}

// -- walking ------------------------------------------------------------------
{
  // A clear corridor east.
  const m = overworld({ open: (x, y) => y === 5 && x >= 0 && x <= 6, x: 0, y: 5 });
  const tiles = [1, 2, 3].map((x) => ({ x, y: 5 }));
  const { result } = play(() => walkPath(tiles), m);
  check("a clear path is walked to the end", result.ok && m.state.x === 3, `at ${m.state.x}`);
}
{
  // Something is standing on the third tile and will not move.
  const m = overworld({ open: (x, y) => y === 5 && x >= 0 && x <= 6 && x !== 3, x: 0, y: 5 });
  const tiles = [1, 2, 3].map((x) => ({ x, y: 5 }));
  const { result } = play(() => walkPath(tiles), m);
  check("a blocked path says which tile it gave up on",
    !result.ok && result.blocked && result.blocked.x === 3, JSON.stringify(result.blocked));
  check("and reports where it actually stands", result.at && result.at.x === 2, `x ${result.at && result.at.x}`);
}
{
  // Knocked off the plan: a ledge drops the player two tiles away.
  const m = overworld({ open: () => true, x: 0, y: 5, onTile: (s) => { if (s.x === 2) s.y = 9; } });
  const { result } = play(() => walkPath([1, 2, 3].map((x) => ({ x, y: 5 }))), m);
  check("leaving the planned path is noticed rather than pressed through",
    !result.ok && result.reason === "left the planned path", result.reason);
}

// -- battles ------------------------------------------------------------------
{
  // A move list where the strongest move is not the first, and one of the
  // strong ones has no PP left. This is the pair of bugs that made the player
  // look stupid: Harden first, and pressing a move that had run out.
  const party = [{
    name: "TEST", hp: 40, maxHp: 40,
    record: { moves: [
      { id: 106, pp: 30 }, // HARDEN, no power
      { id: 53, pp: 0 },   // FLAMETHROWER, out of PP
      { id: 52, pp: 25 },  // EMBER
      { id: 0, pp: 0 },
    ] },
  }];
  let chose = null;
  const battle = { menu: "move", cursor: 0, action: 0, active: 0 };
  const d = drive(() => throughBattle());
  for (let i = 0; i < 400 && !d.done; i++) {
    const out = d.step({ party, inBattle: true, battle, position: null });
    if (out.keys & BTN.A) { chose = battle.cursor; break; }
    if (out.keys & BTN.RIGHT) battle.cursor ^= 1;
    if (out.keys & BTN.DOWN) battle.cursor ^= 2;
  }
  check("the strongest move with PP is the one chosen", chose === 2, `chose slot ${chose}`);
}
{
  // Hurt enough that leaving beats winning.
  const party = [{ name: "TEST", hp: 4, maxHp: 40, record: { moves: [{ id: 52, pp: 20 }] } }];
  const battle = { menu: "action", cursor: 0, action: 0, active: 0 };
  const d = drive(() => throughBattle({ runBelow: 0.3 }));
  let landed = null;
  for (let i = 0; i < 400 && !d.done; i++) {
    const out = d.step({ party, inBattle: true, battle, position: null });
    if (out.keys & BTN.A) { landed = battle.action; break; }
    if (out.keys & BTN.RIGHT) battle.action ^= 1;
    if (out.keys & BTN.DOWN) battle.action ^= 2;
  }
  check("a hurt Pokémon is steered to RUN, not FIGHT", landed === 3, `landed on ${landed}`);
}
{
  // A trainer cannot be fled. Preferring to run must not mean standing there
  // asking forever — which is what stopped a walk two tiles from where it set off.
  const party = [{ name: "TEST", hp: 40, maxHp: 40, record: { moves: [{ id: 52, pp: 20 }] } }];
  const battle = { menu: "action", cursor: 0, action: 0, active: 0 };
  const d = drive(() => throughBattle({ prefer: "run" }));
  let fought = false;
  for (let i = 0; i < 4000 && !d.done; i++) {
    const out = d.step({ party, inBattle: true, battle, position: null });
    if (out.keys & BTN.A && battle.action === 0) { fought = true; break; }
    if (out.keys & BTN.A && battle.action === 3) battle.action = 0; // the run failed
    if (out.keys & BTN.RIGHT) battle.action ^= 1;
    if (out.keys & BTN.DOWN) battle.action ^= 2;
  }
  check("a battle that refuses to be fled is eventually fought", fought);
}
{
  const d = drive(() => throughBattle());
  const out = d.step({ party: [], inBattle: false, battle: null, position: null });
  const after = d.step({ party: [], inBattle: false, battle: null, position: null });
  check("a battle that is already over ends at once", after.done && after.result.ok);
}

// -- the nurse ----------------------------------------------------------------
{
  // The failure this exists for, in full. The party reads whole while the
  // nurse still has boxes of text to go; walking is refused until the text is
  // done; and pressing A once the text *is* done starts the conversation over.
  // Both mistakes look exactly like a frozen game, and one was diagnosed as one.
  const CENTRE = { mapGroup: 9, mapNum: 1 };
  let boxes = 3;          // text still to advance
  let talking = false;
  const m = overworld({
    open: (x, y) => x >= 1 && x <= 13 && y >= 1 && y <= 8 && !(y === 3 && x === 7) && !talking,
    x: 7, y: 6, ...CENTRE,
    // The door out. Stepping on it is the whole of leaving.
    onTile: (s) => { if (s.y === 8) { s.mapNum = 5; s.y = 7; } },
  });
  m.state.party = [{ name: "TEST", hp: 5, maxHp: 40, record: { moves: [] } }];
  let apresses = 0;
  let wasDown = false;
  const machine = {
    look: m.look,
    press(keys) {
      // Edge-triggered, like the hardware: a button that was already down on
      // the previous frame is not a new press. Getting this wrong in the toy
      // made a four-frame `tap` read as four presses and the nurse restart her
      // conversation — a failure of the model, not of the thing being tested,
      // and worth the comment because it looked exactly like the real bug.
      const down = !!(keys & BTN.A);
      if (down && !wasDown) {
        apresses++;
        if (m.state.x === 7 && m.state.y === 4) {
          if (!talking) { talking = true; boxes = 3; m.state.party[0].hp = 40; }
          else if (boxes > 0) { boxes--; if (boxes === 0) talking = false; }
          else { talking = true; boxes = 3; } // talked to her again
        }
      }
      wasDown = down;
      m.press(keys);
    },
  };
  // A tiny stand-in for the atlas: the Centre's interior only.
  const atlas = {
    gridOf: () => ({
      width: 15, height: 9, name: "Centre",
      at: (x, y) => x >= 1 && x <= 13 && y >= 1 && y <= 7 && !(y === 3 && x === 7),
      isGrass: () => false,
    }),
    doorsOf: () => new Set(["7,8"]),
    mapRoute: () => [],
    // She is at (7,2) here, as in sixteen of the game's nineteen Centres. The
    // counter at (7,3) is solid, so the tile to stand on is (7,4) -- found by
    // searching down from her rather than by knowing the answer.
    centreInside: () => ({ nurse: [7, 2] }),
  };
  const { result } = play(() => healInside(atlas), machine, { limit: 60000 });
  check("the nurse heals the party", m.state.party[0].hp === 40);
  check("and the player gets back out of the Center",
    result.ok && m.state.mapNum === 5, `${result.ok ? "ok" : result.reason} on map ${m.state.mapNum}`);
  check("without talking to her again forever", apresses < 200, `${apresses} A presses`);
}

// -- the grind stays in its patch of grass ------------------------------------
//
// The live version of this is `gba/tools/autoplay/measure-grind.mjs`, which
// walks a real cartridge for six minutes and counts. This is the same
// question asked of a toy map so it can be answered without a ROM: put the
// runner in a small patch of grass surrounded by open ground it is free to
// walk onto, and see whether it ever does.
{
  const { runner } = await import("../src/policy.js");

  // A 3x3 patch of grass in the middle of a 15x15 field. Everything is
  // walkable, so nothing but the patch rule keeps it in.
  const isGrass = (x, y) => x >= 6 && x <= 8 && y >= 6 && y <= 8;
  const grid = {
    width: 15, height: 15, name: "Field", indoor: false,
    at: (x, y) => x >= 0 && y >= 0 && x < 15 && y < 15,
    isGrass,
  };
  const tiles = new Set();
  for (let y = 6; y <= 8; y++) for (let x = 6; x <= 8; x++) tiles.add(`${x},${y}`);
  const atlas = {
    covers: () => true,
    gridOf: () => grid,
    doorsOf: () => new Set(),
    mapRoute: () => [],
    centreInside: () => null,
    nearestCentre: () => null,
    grassPatch: () => ({ seed: { x: 7, y: 7 }, tiles, has: (x, y) => tiles.has(`${x},${y}`) }),
  };

  const m = overworld({ open: grid.at, x: 7, y: 7, step: 8 });
  m.state.party = [{ name: "TEST", hp: 40, maxHp: 40, level: 5, record: { moves: [{ id: 52, pp: 20 }] } }];
  const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0, stopBelowHp: 0 }, null, atlas);

  let left = 0;
  let moved = 0;
  let last = "7,7";
  for (let frame = 0; frame < 20000; frame++) {
    const out = run.step({
      frame, party: m.state.party, inBattle: false, battle: null,
      position: { x: m.state.x, y: m.state.y, map: { mapGroup: 3, mapNum: 24 } },
    });
    if (out.done) break;
    m.press(out.keys);
    const at = `${m.state.x},${m.state.y}`;
    if (at !== last) { moved++; last = at; }
    if (!tiles.has(at)) left++;
  }
  check("the grind never steps out of the grass", left === 0, `${left} frames outside`);
  // Confinement is worthless if it achieves it by standing still: encounters
  // are counted per step taken in grass, so it has to keep walking.
  check("and keeps walking rather than standing still", moved > 30, `${moved} steps`);
}

// -- walked off the map: walk back, do not give up ----------------------------
//
// A ledge is one-way and is not modelled, so a patch can quietly contain a
// tile that drops the player onto the route below. This used to stop the run
// with a message that said, in as many words, that it could find its way back
// and was not going to.
{
  const { runner } = await import("../src/policy.js");
  const tiles = new Set(["7,7", "7,8", "8,7", "8,8"]);
  const home = { mapGroup: 3, mapNum: 24 };
  const elsewhere = { mapGroup: 3, mapNum: 25 };
  const atlas = {
    covers: () => true,
    gridOf: () => ({ width: 15, height: 15, name: "F", at: () => true, isGrass: (x, y) => tiles.has(`${x},${y}`) }),
    doorsOf: () => new Set(),
    // The two maps are joined by an edge, so a walk home is a thing that
    // exists. Returning no route would make the journey fail instantly and
    // the check would be measuring the toy rather than the runner.
    mapRoute: (from, to) =>
      from.mapGroup === to.mapGroup && from.mapNum === to.mapNum
        ? []
        : [{ from, to, via: { kind: "edge", dir: 0 } }],
    centreInside: () => null,
    nearestCentre: () => null,
    grassPatch: () => ({ seed: { x: 7, y: 7 }, tiles, has: (x, y) => tiles.has(`${x},${y}`) }),
  };
  const party = [{ name: "TEST", hp: 40, maxHp: 40, level: 5, record: { moves: [{ id: 52, pp: 20 }] } }];

  const run = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0, stopBelowHp: 0 }, null, atlas);
  // Settle on the home map so the anchor is set.
  for (let f = 0; f < 40; f++) {
    run.step({ frame: f, party, inBattle: false, battle: null, position: { x: 7, y: 7, map: home } });
  }
  check("it starts out grinding", run.mode === "grind", run.mode);

  // Now the ledge: the same run, suddenly on another map.
  let stopped = null;
  for (let f = 0; f < 30 && !stopped; f++) {
    const out = run.step({ frame: 100 + f, party, inBattle: false, battle: null, position: { x: 3, y: 3, map: elsewhere } });
    if (out.done) stopped = out.reason;
  }
  check("ending up on another map does not end the run", stopped === null, stopped || "");
  check("it sets off to walk back instead", run.mode === "journey" && run.trip === "travel",
    `${run.mode}/${run.trip}`);

  // But a patch that keeps throwing the player out is a loop, not a walk, and
  // the run has to be able to say so rather than bounce forever.
  const looper = runner({ slot: 0, stopAtLevel: 99, healBelowHp: 0, stopBelowHp: 0 }, null, atlas);
  for (let f = 0; f < 40; f++) {
    looper.step({ frame: f, party, inBattle: false, battle: null, position: { x: 7, y: 7, map: home } });
  }
  let gaveUp = null;
  for (let round = 0; round < 12 && !gaveUp; round++) {
    // Off the map...
    for (let f = 0; f < 4 && !gaveUp; f++) {
      const out = looper.step({ frame: 1000 + round * 20 + f, party, inBattle: false, battle: null, position: { x: 3, y: 3, map: elsewhere } });
      if (out.done) gaveUp = out.reason;
    }
    // ...and back, as if the walk home had worked, so it resumes grinding.
    for (let f = 0; f < 60 && !gaveUp; f++) {
      const out = looper.step({ frame: 1100 + round * 20 + f, party, inBattle: false, battle: null, position: { x: 7, y: 7, map: home } });
      if (out.done) gaveUp = out.reason;
    }
  }
  check("but a patch that keeps throwing it out is eventually called a loop",
    gaveUp !== null && /ledge|loop/i.test(gaveUp), gaveUp || "never gave up");
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
