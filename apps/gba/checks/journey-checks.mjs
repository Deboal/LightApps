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
//
/**
 * Move a 2x2 battle cursor the way the game does: **without wrapping**.
 *
 * These toys used to apply `^= 1` on RIGHT and `^= 2` on DOWN and ignore LEFT
 * and UP entirely, which made them agree with a walker that only ever pressed
 * RIGHT and DOWN — the two wrong out of four. A real cursor on the bottom-right
 * move has nowhere to go in either of those directions, and a press that goes
 * nowhere is indistinguishable from no press at all. Modelling it honestly is
 * what turns "it reached the move" into evidence.
 */
const steer = (battle, field, keys) => {
  const at = battle[field];
  if (keys & BTN.RIGHT && !(at & 1)) battle[field] = at | 1;
  else if (keys & BTN.LEFT && at & 1) battle[field] = at & ~1;
  else if (keys & BTN.DOWN && !(at & 2)) battle[field] = at | 2;
  else if (keys & BTN.UP && at & 2) battle[field] = at & ~2;
};

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
    steer(battle, "cursor", out.keys);
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
    steer(battle, "action", out.keys);
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
    steer(battle, "action", out.keys);
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
  // Not "is outside" -- leaving the building is `goTo`'s job now, and it is
  // the only thing that knows which of a Centre's three doormats is a door.
  // What this owes its caller is that the conversation is over and the player
  // can move, which is a step that lands rather than a count of presses.
  check("and the player can walk again afterwards",
    result.ok, result.ok ? `free at ${result.at && result.at.x},${result.at && result.at.y}` : result.reason);
  check("which means the nurse has stopped talking",
    result.ok && !talking, talking ? "still mid-sentence" : "done");
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

// -- putting the right Pokémon at the front -----------------------------------
//
// Only the one that fights earns experience, so this is the difference between
// a run that works and one that cannot.
//
// The submenu is the fiddly part: it grows an entry for every field move the
// selected Pokémon knows, so SWITCH sits at a different index for a Charmeleon
// than for a Beedrill that knows Cut. The first version of this coped by
// searching -- press A on entry one, look at the party, press A on entry two,
// and so on. Entry three is ITEM. Pressing A there opens GIVE, and the next A
// in the sequence reaches into the bag and hands over whatever is at the top,
// which is how a player's Charizard came out of a two-level grind holding a
// Moon Stone.
//
// So the fake below is not a menu that politely ignores the wrong entry. ITEM
// costs an item, exactly as it does on the cartridge, and the check that
// matters is the one that says the bag was never opened.
{
  const { leadWith } = await import("../src/journey.js");
  const { MENU } = await import("../src/game.js");
  // `otId` because the real decoder always provides one: it is half of the
  // pair Gen 3 encrypts a record with, and it is half of what identifies a
  // Pokémon across a party that keeps reordering. A fake without it is a fake
  // that exercises a fallback path instead of the real one.
  const mon = (name, level, species, personality, otId = 24601) => ({
    name, level, species, maxHp: 40, hp: 40,
    record: { species, personality, otId, moves: [{ id: 52, pp: 20 }] },
  });

  /**
   * The field menu, the party screen, the submenu, and "move to where?".
   *
   * All four, because the walk to SWITCH goes through all four and a fake that
   * starts at the party screen mis-reads the START/A that opens it as cursor
   * movement. That off-by-one made attempt one look like attempt three, which
   * reads exactly like a fault in the code being tested.
   *
   * Edge-triggered per button, like the hardware: one shared "was it down"
   * flag across buttons is the other way a fake like this lies.
   *
   * `fieldMoves` is how many entries sit between SUMMARY and SWITCH, and
   * `readable` is whether the actions can be read at all -- a cartridge whose
   * layout is unknown has to end with nothing pressed rather than a guess.
   */
  const partyScreen = (order, { fieldMoves = 0, readable = true } = {}) => {
    const was = {};
    const edge = (keys, bit) => {
      const now = !!(keys & bit);
      const fired = now && !was[bit];
      was[bit] = now;
      return fired;
    };
    // SUMMARY, then one entry per field move, then SWITCH, ITEM, CANCEL --
    // the order the cartridge builds them in.
    const actions = [MENU.SUMMARY, ...Array(fieldMoves).fill(MENU.SUMMARY), MENU.SWITCH, MENU.ITEM, MENU.CANCEL];
    const FIELD_ENTRIES = 7; // POKéDEX POKéMON BAG PLAYER SAVE OPTION EXIT

    let screen = "overworld";
    let cursor = 0;
    let slot = 0;
    let moveTo = 0;
    let picked = null;
    let openedBag = 0;
    const where = { x: 5, y: 5 };
    let held = 0, progress = 0;

    const lastIndex = () =>
      screen === "field" ? FIELD_ENTRIES - 1 : screen === "submenu" ? actions.length - 1 : 0;

    return {
      order,
      get openedBag() { return openedBag; },
      get screen() { return screen; },
      get position() { return { x: where.x, y: where.y, map: { mapGroup: 3, mapNum: 24 } }; },
      get menu() {
        if (screen === "overworld") return null;
        // The field menu is a list like any other, and its cursor is the same
        // `sMenu` the party submenu uses -- so the fake reports one too.
        return {
          open: screen === "party" || screen === "submenu" || screen === "moving",
          actions: screen === "submenu" && readable ? actions.slice() : null,
          cursor,
          lastIndex: lastIndex(),
          slot: picked === null ? slot : picked,
          moveTo,
          switching: screen === "moving",
        };
      },
      press(keys) {
        const dir = keys & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
        if (screen === "overworld" && dir) {
          if (dir !== held) { held = dir; progress = 0; }
          else if (++progress >= 8) {
            progress = 0;
            where.x += dir & BTN.RIGHT ? 1 : dir & BTN.LEFT ? -1 : 0;
            where.y += dir & BTN.DOWN ? 1 : dir & BTN.UP ? -1 : 0;
          }
        } else if (!dir) { held = 0; progress = 0; }

        const a = edge(keys, BTN.A);
        const b = edge(keys, BTN.B);
        const down = edge(keys, BTN.DOWN);
        const up = edge(keys, BTN.UP);
        const start = edge(keys, BTN.START);

        if (start && screen === "overworld") { screen = "field"; cursor = 0; return; }
        if (b) {
          screen = screen === "moving" ? "submenu"
            : screen === "submenu" ? "party"
              : screen === "party" ? "field" : "overworld";
          cursor = 0;
          if (screen === "field" || screen === "overworld") picked = null;
          return;
        }

        // Cursors. None of them wrap, and each list has its own.
        if (down || up) {
          const step = down ? 1 : -1;
          if (screen === "field" || screen === "submenu") {
            cursor = Math.max(0, Math.min(lastIndex(), cursor + step));
          } else if (screen === "party") {
            slot = Math.max(0, Math.min(order.length - 1, slot + step));
          } else if (screen === "moving") {
            moveTo = Math.max(0, Math.min(order.length - 1, moveTo + step));
          }
          return;
        }

        if (!a) return;
        if (screen === "field") {
          if (cursor === 1) { screen = "party"; cursor = 0; slot = 0; }
          return;
        }
        if (screen === "party") { picked = slot; screen = "submenu"; cursor = 0; return; }
        if (screen === "submenu") {
          const chose = actions[cursor];
          if (chose === MENU.SWITCH) { screen = "moving"; moveTo = picked; cursor = 0; }
          else if (chose === MENU.ITEM) { openedBag++; }   // the Moon Stone
          return;
        }
        if (screen === "moving") {
          const [m] = order.splice(picked, 1);
          order.splice(moveTo, 0, m);
          picked = null;
          screen = "party";
          cursor = 0;
        }
      },
    };
  };

  const run = (party, target, options = {}) => {
    const order = party.slice();
    const screen = partyScreen(order, options);
    const want = order[target];
    const d = drive(() => leadWith(want), { budget: 200000 });
    for (let i = 0; i < 200000 && !d.done; i++) {
      const out = d.step({
        party: screen.order, inBattle: false, battle: null,
        position: screen.position, menu: screen.menu,
      });
      if (out.done) break;
      screen.press(out.keys);
    }
    return { result: d.result, order: screen.order, openedBag: screen.openedBag };
  };

  const three = [mon("CHARIZARD", 36, 6, 111), mon("BEEDRILL", 19, 15, 222), mon("CLEFAIRY", 15, 35, 333)];

  // First: can this fake even notice the thing it is here to notice? A test
  // that cannot fail is worse than no test, and three of the fakes in this
  // file have been wrong in exactly that direction before. So walk a cursor
  // onto ITEM by hand and press A, and check that it costs something.
  {
    const screen = partyScreen(three.slice());
    const push = (b) => { screen.press(b); screen.press(0); };
    push(BTN.START);
    push(BTN.DOWN);            // POKéDEX -> POKéMON
    push(BTN.A);               // the party screen
    push(BTN.A);               // the submenu, on SUMMARY
    push(BTN.DOWN);            // SWITCH
    push(BTN.DOWN);            // ITEM
    push(BTN.A);
    check("the fake charges for ITEM, so the check below can fail",
      screen.openedBag === 1, `bag opened ${screen.openedBag}× — the old blind search did this five times a run`);
  }

  // The check this whole rewrite exists for.
  for (const fieldMoves of [0, 1, 3]) {
    const out = run(three, 2, { fieldMoves });
    check(
      `with ${fieldMoves} field move${fieldMoves === 1 ? "" : "s"} in the way it still finds SWITCH`,
      out.result.ok && out.order[0].name === "CLEFAIRY",
      `${out.result.ok ? "ok" : out.result.reason} -> ${out.order[0].name}`
    );
    check(
      `and never opens the bag getting there`,
      out.openedBag === 0,
      out.openedBag ? `pressed A on ITEM ${out.openedBag}×` : "the bag was never opened"
    );
  }

  // A cartridge whose party menu cannot be read. Nothing is pressed, and that
  // is the right answer -- the alternative is pressing A at an unknown entry.
  {
    const out = run(three, 2, { readable: false });
    check("a party menu it cannot read is refused rather than guessed at",
      !out.result.ok && /could not read/i.test(out.result.reason), String(out.result.reason));
    check("and nothing is bought, given or thrown away finding that out",
      out.openedBag === 0, `bag opened ${out.openedBag}×`);
  }

  // Already leading is not work.
  {
    const order = [mon("CLEFAIRY", 15, 35, 333), mon("CHARIZARD", 36, 6, 111)];
    const d = drive(() => leadWith(order[0]));
    for (let i = 0; i < 50 && !d.done; i++) {
      d.step({
        party: order, inBattle: false, battle: null, menu: null,
        position: { x: 5, y: 5, map: { mapGroup: 3, mapNum: 24 } },
      });
    }
    check("a Pokémon already at the front is left alone",
      d.result && d.result.ok && d.result.note === "already leading", JSON.stringify(d.result));
  }

  // The regression this was reported as: the swap lands, the party screen
  // stays up, and the runner goes back to pressing directions at a menu that
  // swallows them. On screen that is a frozen game. Success is being able to
  // walk again, not having got what you came for.
  {
    const stuck = [mon("CHARIZARD", 36, 6, 111), mon("BEEDRILL", 19, 15, 222), mon("CLEFAIRY", 15, 35, 333)];
    const order = stuck.slice();
    const screen = partyScreen(order);
    const jammed = {
      order,
      get position() { return screen.position; },
      get menu() { return screen.menu; },
      press(keys) { screen.press(keys & ~BTN.B); }, // B never gets through
    };
    const want = order[2];
    const d = drive(() => leadWith(want), { budget: 200000 });
    for (let i = 0; i < 200000 && !d.done; i++) {
      const out = d.step({
        party: jammed.order, inBattle: false, battle: null,
        position: jammed.position, menu: jammed.menu,
      });
      if (out.done) break;
      jammed.press(out.keys);
    }
    check("a menu that will not close is reported, not called success",
      d.result && !d.result.ok && /back out of the menus/i.test(d.result.reason),
      JSON.stringify(d.result));
  }

  // Identity is the whole tuple. This player's party holds a CHARIZARD and a
  // CHARMELEON sharing the personality value 2003283047, and two of a species
  // share a name, so neither field identifies a Pokémon on its own.
  {
    const clash = [mon("CHARMELEON", 27, 5, 2003283047), mon("BEEDRILL", 19, 15, 222), mon("CHARIZARD", 36, 6, 2003283047)];
    const out = run(clash, 2);
    check("a shared personality does not confuse one Pokémon for another",
      out.result.ok && out.order[0].name === "CHARIZARD" && out.order[0].level === 36,
      `${out.result.ok ? "ok" : out.result.reason} -> ${out.order[0].name} L${out.order[0].level}`);
  }
}

// -- getting out of a building ------------------------------------------------
//
// A Pokémon Center's exit is three mats side by side and exactly one of them
// is a door: the middle one, and only if you press south while standing on it.
// Walking onto any of the three -- from the left, from above, at a run -- does
// nothing at all. That was measured on a real cartridge, all nine ways, after
// a headless run reported that it could not leave the Cerulean Pokémon Center
// and a screenshot showed it standing on the doormat.
//
// Nothing in the walker noticed. Reaching the goal tile *is* success, so the
// next pass planned a path of zero tiles to where the player already stood,
// walked it perfectly, and did that until the attempts ran out.
const ROOM = { w: 9, h: 5 }, STREET = { w: 9, h: 9 };

/** Two maps, both wide open, joined by three warp tiles along the room's south
 *  wall. Two bits a tile, exactly as the generated file packs them. */
function tinyWorld() {
  const roomAt = 0, streetAt = Math.ceil((ROOM.w * ROOM.h) / 4);
  const bytes = new Uint8Array(streetAt + Math.ceil((STREET.w * STREET.h) / 4));
  const open = (at, count) => {
    for (let i = 0; i < count; i++) bytes[at + (i >> 2)] |= 1 << ((i & 3) * 2);
  };
  open(roomAt, ROOM.w * ROOM.h);
  open(streetAt, STREET.w * STREET.h);
  return world(
    {
      games: ["BPRE"],
      centres: [],
      layouts: [{ w: ROOM.w, h: ROOM.h, at: roomAt }, { w: STREET.w, h: STREET.h, at: streetAt }],
      maps: [
        { g: 1, n: 1, name: "Room", l: 0, in: 1, w: [[3, 4, 1, 0], [4, 4, 1, 0], [5, 4, 1, 0]], c: [] },
        { g: 2, n: 2, name: "Street", l: 1, w: [[4, 0, 0, 0]], c: [] },
      ],
    },
    bytes
  );
}

/** A player in that room. `door` decides which mat, if any, actually opens —
 *  and it only opens on a press south, which is the whole point. */
function building({ door = null } = {}) {
  const state = {
    x: 1, y: 1, mapGroup: 1, mapNum: 1,
    party: [{ name: "TEST", hp: 40, maxHp: 40, record: { moves: [] } }],
  };
  let held = 0, progress = 0;
  const pressedInto = [];
  return {
    state, pressedInto,
    look: () => ({
      party: state.party, inBattle: false, battle: null,
      position: { x: state.x, y: state.y, map: { mapGroup: state.mapGroup, mapNum: state.mapNum } },
    }),
    press(keys) {
      const dir = keys & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
      if (!dir || dir !== held) { held = dir; progress = 0; return; }
      if (++progress < 8) return;
      progress = 0;
      if (dir & BTN.DOWN && state.mapGroup === 1 && state.y === 4) {
        pressedInto.push(state.x);
        if (door !== null && state.x === door) {
          Object.assign(state, { mapGroup: 2, mapNum: 2, x: 4, y: 1 });
        }
        return; // the south wall: a press into it either opens or does nothing
      }
      const dx = dir & BTN.RIGHT ? 1 : dir & BTN.LEFT ? -1 : 0;
      const dy = dir & BTN.DOWN ? 1 : dir & BTN.UP ? -1 : 0;
      const size = state.mapGroup === 1 ? ROOM : STREET;
      const nx = state.x + dx, ny = state.y + dy;
      if (nx < 0 || ny < 0 || nx >= size.w || ny >= size.h) return;
      state.x = nx; state.y = ny;
    },
  };
}

{
  const W = tinyWorld();
  const made = building({ door: 4 });
  const { result } = play(() => goTo(W, { mapGroup: 2, mapNum: 2, x: 6, y: 6 }), made, { limit: 80000 });
  check(
    "a mat that only opens when you press into it is pressed into",
    result.ok && made.state.mapGroup === 2,
    result.ok ? `out of the building and across the street to ${made.state.x},${made.state.y}` : result.reason
  );
  check(
    "and a mat that is not a door does not end the trip",
    new Set(made.pressedInto).size > 1,
    `tried the mats at x = ${[...new Set(made.pressedInto)].join(", ")}`
  );
}

{
  // The same room with no working mat at all. This has to end, and say so,
  // rather than walk the three of them until the sun comes up.
  const W = tinyWorld();
  const sealed = building({ door: null });
  const { result } = play(() => goTo(W, { mapGroup: 2, mapNum: 2, x: 6, y: 6 }), sealed, { limit: 80000 });
  check(
    "a room with no working way out is reported, not walked forever",
    result && !result.ok,
    result && result.reason
  );
}

// -- a long walk is not a stuck walk ------------------------------------------
//
// `goTo` used to budget times round its loop, which made the limit a function
// of distance: a five-tile walk had twenty-four goes and a fifty-four-tile
// walk across a town had the same twenty-four, most of them spent on hops
// that were working. A real run reported "too many attempts" while standing
// in a Cerulean street, having walked most of the way to Route 24 three times.
//
// The budget is hops that got nowhere now, so this walks a corridor longer
// than the old limit and expects to arrive.
{
  const LONG = 60;
  const bytes = new Uint8Array(Math.ceil((LONG * 3) / 4));
  for (let i = 0; i < LONG * 3; i++) bytes[i >> 2] |= 1 << ((i & 3) * 2);
  const W = world(
    {
      games: ["BPRE"], centres: [],
      layouts: [{ w: LONG, h: 3, at: 0 }],
      maps: [{ g: 1, n: 1, name: "Long", l: 0, w: [], c: [] }],
    },
    bytes
  );

  // People. Without them this test cannot fail and does not deserve to exist:
  // an unobstructed corridor is walked in one hop no matter what the budget
  // is, so the first version of this check passed against the very code it
  // was written to catch. A town is a corridor with somebody in it every few
  // tiles, and that is what costs hops -- each one is a walk that gets part
  // of the way, is refused, and has to be planned again.
  const standing = new Set();
  for (let x = 4; x < LONG - 2; x += 2) standing.add(x);
  const open = (x, y) => {
    if (x < 0 || x >= LONG || y < 0 || y >= 3) return false;
    return !(y === 1 && standing.has(x));
  };
  check(
    "the corridor has more people in it than the old budget had attempts",
    standing.size > 24,
    `${standing.size} in the way, against a budget of 24`
  );

  const m = overworld({ open, x: 0, y: 1, mapGroup: 1, mapNum: 1 });
  const { result } = play(() => goTo(W, { mapGroup: 1, mapNum: 1, x: LONG - 1, y: 1 }), m, { limit: 400000 });
  check(
    `a ${LONG}-tile walk past ${standing.size} of them arrives rather than running out of attempts`,
    result.ok && m.state.x === LONG - 1,
    result.ok ? `reached ${m.state.x}` : `${result.reason} at ${m.state.x},${m.state.y}`
  );
}

{
  // And the other half: a walk that genuinely cannot move still gives up
  // quickly. Hemmed in on every side, one tile of floor.
  const bytes = new Uint8Array(Math.ceil((9 * 9) / 4));
  for (let i = 0; i < 9 * 9; i++) bytes[i >> 2] |= 1 << ((i & 3) * 2);
  const W = world(
    {
      games: ["BPRE"], centres: [],
      layouts: [{ w: 9, h: 9, at: 0 }],
      maps: [{ g: 1, n: 1, name: "Cell", l: 0, w: [], c: [] }],
    },
    bytes
  );
  const stuck = overworld({ open: (x, y) => x === 4 && y === 4, x: 4, y: 4, mapGroup: 1, mapNum: 1 });
  const { result, frames } = play(() => goTo(W, { mapGroup: 1, mapNum: 1, x: 8, y: 8 }), stuck, { limit: 200000 });
  check("a walk that cannot move still gives up", !result.ok, result.reason);
  check("and does not take all day about it", frames < 120000, `${frames} frames`);
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
