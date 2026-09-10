// journey.js — getting somewhere and back, written as if nothing were async.
//
// These are the routines that levelled a Charmeleon into a Charizard, moved
// out of the headless harness and into the tab. They read as ordinary
// imperative code because `drive.js` makes that possible: every
// `const state = yield BUTTONS` is one frame pressed and the result observed.
//
// Every one of them obeys the same rule, which is the only thing here worth
// remembering:
//
//     press towards a state, look, and only move on once the game agrees.
//
// The comments below say which specific failure each defensive line exists to
// prevent, because every one of them cost a run.

import { BTN } from "./buttons.js";
import { hold, settle, tap, beat } from "./drive.js";
import { bestMove } from "./policy.js";
import { pathToAny, path, edgeTiles, DIR } from "./world.js";

/** Frames to keep pressing towards a tile before calling it blocked. A step is
 *  sixteen frames and a turn on the spot eight, so ninety is many steps' worth
 *  of patience -- this fires for walls and for people, not for slowness. */
const PATIENCE = 90;

const sameSpot = (a, b) =>
  a && b && a.x === b.x && a.y === b.y &&
  a.map.mapGroup === b.map.mapGroup && a.map.mapNum === b.map.mapNum;

const onMap = (here, m) =>
  here && here.map.mapGroup === m.mapGroup && here.map.mapNum === m.mapNum;

/** The direction that takes you from one tile to the one next to it. */
const towards = (from, to) =>
  to.x > from.x ? BTN.RIGHT : to.x < from.x ? BTN.LEFT : to.y > from.y ? BTN.DOWN : BTN.UP;

const whole = (party) =>
  party && party.length > 0 && party.every((mon) => mon.hp === mon.maxHp);

/**
 * Get through a battle, whatever kind it is.
 *
 * Running was the first attempt and it was not enough: the routes between
 * towns are lined with trainers, and a trainer battle cannot be fled. A
 * traveller that only knows how to run stops dead at the first one — which is
 * exactly what happened, reported as "could not get out of a battle" two tiles
 * from where it set off.
 *
 * So it fights by default and runs only when the Pokémon that is out is hurt
 * or has nothing left to hit with. Fighting is also the better trade on the
 * way somewhere: the trainers are worth more than the wild Pokémon walked past.
 */
export function* throughBattle({ runBelow = 0.3, prefer = "fight", limit = 60 * 60 * 10 } = {}) {
  // Running is free when it works and impossible when it does not. So "run"
  // is a preference, not a plan: try it, and once enough turns have gone by
  // with the battle still going, this is a trainer and the only way out is
  // through.
  let asked = 0;
  let running = prefer === "run";
  let state = yield 0;

  for (let frame = 0; frame < limit; frame++) {
    if (!state || !state.inBattle) return { ok: true, frames: frame };
    const on = beat(frame);
    const battle = state.battle;
    const active = battle && Number.isInteger(battle.active) ? battle.active : 0;
    const party = state.party || [];
    const fighter = party[active] || party[0];
    const share = fighter && fighter.maxHp ? fighter.hp / fighter.maxHp : 1;
    const want = fighter && bestMove(fighter);
    const flee = running || share < runBelow || !want;

    // No menu read means this build's battle addresses are unknown, and the
    // only honest move is A -- which takes the first move rather than the
    // best one. That is a worse fight, not a broken one.
    if (!battle || !battle.menu || battle.menu === "party") {
      state = yield on ? BTN.A : 0;
      continue;
    }
    if (battle.menu === "action") {
      if (running && ++asked > 6) running = false;
      // FIGHT is 0 and RUN is 3 in a two-by-two grid, so the difference
      // between where the cursor is and where it should be says which way to
      // move it: the low bit is the column, the high bit the row.
      const differs = (battle.action ?? 0) ^ (flee ? 3 : 0);
      state = yield on ? (differs ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : BTN.A) : 0;
      continue;
    }
    if (battle.menu === "move") {
      if (flee) {
        state = yield on ? BTN.B : 0;
        continue;
      }
      const differs = (battle.cursor ?? 0) ^ want.index;
      state = yield on ? (differs ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : BTN.A) : 0;
      continue;
    }
    state = yield on ? BTN.A : 0;
  }
  return { ok: false, reason: "a battle would not end" };
}

/**
 * Walk a planned path, checking every step.
 *
 * The plan comes from the game's own collision data, which knows about walls
 * and knows nothing about ledges, people standing in doorways, or the wild
 * Pokémon that will interrupt halfway. So the plan is a proposal: press
 * towards the next tile, and only advance when the player is actually on it.
 */
export function* walkPath(tiles, { patience = PATIENCE, onStep = null } = {}) {
  let index = 0;
  let tries = 0;
  let state = yield 0;

  while (index < tiles.length) {
    if (!state) { state = yield 0; continue; }
    if (state.inBattle) {
      const out = yield* throughBattle();
      if (!out.ok) return out;
      tries = 0;
      state = yield 0;
      continue;
    }
    const here = state.position;
    if (!here) { state = yield 0; continue; }

    // Skip past tiles already stood on: running covers ground faster than one
    // tile per press, so the plan can be several ahead of the cursor.
    while (index < tiles.length && here.x === tiles[index].x && here.y === tiles[index].y) {
      if (onStep) onStep(here);
      index++;
      tries = 0;
    }
    if (index >= tiles.length) break;

    const next = tiles[index];
    if (Math.abs(next.x - here.x) + Math.abs(next.y - here.y) > 1) {
      // Knocked off the plan — a warp, or a ledge that only goes one way.
      return { ok: false, reason: "left the planned path", at: here, index };
    }
    // B is the run latch. It is held only while a direction is, so it can
    // never leak into a menu, where a held B backs straight out.
    state = yield towards(here, next) | BTN.B;
    if (++tries > patience) {
      return { ok: false, reason: `blocked heading to ${next.x},${next.y}`, at: here, blocked: next };
    }
  }
  return { ok: true, at: (yield 0).position };
}

/**
 * Walk to a tile, crossing maps as needed.
 *
 * The harness this came from could only cross a map edge it was told about by
 * hand. Here the connection and warp graph is on disk, so the route between
 * maps is searched like anything else, and each hop is re-planned from where
 * the player actually landed — which is the only honest way, because the
 * offsets between maps are real and so are the ways a walk goes differently
 * than planned.
 */
export function* goTo(world, target, { hops = 24, allowed = null, patience = PATIENCE } = {}) {
  // Tiles the map calls open and the game refuses. People stand in the way,
  // and they are in no layout file. Re-planning around a refusal is the
  // difference between a walk that arrives and a walk that leans on someone.
  const refused = new Set();
  const key = (here, tile) => `${here.map.mapGroup}/${here.map.mapNum}:${tile.x},${tile.y}`;
  const permitted = (here) =>
    !allowed || allowed.some((m) => onMap(here, m));

  for (let hop = 0; hop < hops; hop++) {
    let state = yield 0;
    if (state && state.inBattle) {
      const out = yield* throughBattle();
      if (!out.ok) return out;
      continue;
    }
    let here = state && state.position;
    if (!here) { yield* settle(10); continue; }

    if (!permitted(here)) {
      // One reading is not evidence. Crossing between maps rewrites the very
      // field this is read from, so a sample taken mid-transition can be
      // anything — and a trip that aborts on a single frame of nonsense is a
      // trip that aborts. Look again, several times, before believing it.
      let strayed = true;
      for (let look = 0; look < 12 && strayed; look++) {
        const again = (yield* settle(20)).position;
        if (again && permitted(again)) { strayed = false; here = again; }
      }
      if (strayed) {
        return { ok: false, reason: `strayed onto map ${here.map.mapGroup}/${here.map.mapNum}`, at: here };
      }
      continue;
    }

    const arrived = onMap(here, target);
    if (arrived && here.x === target.x && here.y === target.y) return { ok: true, at: here };

    const grid = world.gridOf(here.map.mapGroup, here.map.mapNum);
    if (!grid) return { ok: false, reason: "no map data for where the player is", at: here };

    // Doors are walkable and they are not passable: step on one and you are
    // somewhere else. A path across Vermilion otherwise routes through the
    // front door of a house, and the next plan starts in somebody's kitchen.
    // So every warp is a wall — except the one being aimed at.
    const doors = world.doorsOf(here.map.mapGroup, here.map.mapNum);
    const blocked = new Set([...refused].filter((k) => k.startsWith(`${here.map.mapGroup}/${here.map.mapNum}:`))
      .map((k) => k.slice(k.indexOf(":") + 1)));

    // Where this hop is heading: the target itself if it is on this map,
    // otherwise whatever gets us to the next map on the route.
    let goals;
    let leaving = null;
    if (arrived) {
      goals = [{ x: target.x, y: target.y }];
    } else {
      const route = world.mapRoute(here.map, target);
      if (!route || route.length === 0) {
        return { ok: false, reason: "no route to that map", at: here };
      }
      leaving = route[0].via;
      goals = leaving.kind === "warp"
        ? [{ x: leaving.x, y: leaving.y }]
        : edgeTiles(grid, leaving.dir);
    }

    // Doors and people go in as the overlay rather than as terrain, so the
    // search can tell "walk around this" from "this is where we are going".
    // Folding them into `at` instead would make a door being aimed at
    // unreachable and a wall being aimed at reachable, which is both halves of
    // the same mistake.
    const overlay = new Set([...doors, ...blocked]);
    // Whether this hop is aiming at a door. Every Pokémon Center door is a
    // solid tile — the warp is what lets you through, not the collision — so
    // a goal that is a warp is allowed to be one the terrain refuses. Asking
    // the door list rather than passing a flag around keeps the two answers
    // from ever disagreeing.
    const enterGoal = goals.some((g) => doors.has(`${g.x},${g.y}`));
    const found = pathToAny(grid, here, goals, { blocked: overlay, enterGoal });
    if (!found) {
      // The tiles this walk has been refused are people, and people move.
      // Enough of them along a three-tile corridor severs it, and the planner
      // then reports no path through ground it crossed a minute ago. Forget
      // them and look again before giving up.
      if (refused.size) { refused.clear(); continue; }
      return { ok: false, reason: "no path from here", at: here };
    }

    const walked = yield* walkPath(found.tiles, { patience });
    if (!walked.ok) {
      if (walked.blocked) { refused.add(key(here, walked.blocked)); continue; }
      if (walked.reason !== "left the planned path") return walked;
      continue;
    }

    // Off the edge into the next map. Stepping onto a warp needs no extra
    // press — arriving on the tile is the whole of it — so only an edge
    // crossing has anything left to do here.
    if (leaving && leaving.kind === "edge") {
      const before = (yield 0).position;
      const way = leaving.dir === DIR.DOWN ? BTN.DOWN
        : leaving.dir === DIR.UP ? BTN.UP
        : leaving.dir === DIR.LEFT ? BTN.LEFT : BTN.RIGHT;
      const after = yield* hold(way | BTN.B, 90);
      if (after && after.position && before && after.position.map.mapNum === before.map.mapNum
          && after.position.map.mapGroup === before.map.mapGroup) {
        return { ok: false, reason: "the edge did not lead anywhere", at: after.position };
      }
    }
    yield* settle(20);
  }
  return { ok: false, reason: "too many attempts" };
}

/**
 * Heal at a Pokémon Center: in through the door, talk to the nurse, back out.
 *
 * The counter at (7,3) is solid — you stand at (7,4) and talk across it, which
 * the collision grid says plainly and a guess does not.
 *
 * Getting out again is the part that cost the most. The party reads full while
 * the nurse still has three boxes of text to go, so stopping there leaves the
 * game sitting on a "▼" forever; but mashing A past the last box talks to her
 * again — the player is standing at the counter facing her — and starts the
 * whole conversation over. Both mistakes look exactly like a frozen emulator,
 * and I diagnosed one as exactly that.
 *
 * The way out is to try leaving *before* pressing anything. A step that works
 * means the dialogue is over; a step that does not means a box is up, and only
 * then is A the right answer. So A is never pressed at a nurse who has
 * finished talking.
 */
export function* healInside(world, { limit = 60 * 60 * 4 } = {}) {
  let state = yield 0;
  const inside = state && state.position;
  if (!inside) return { ok: false, reason: "lost the player at the door" };

  const walked = yield* goTo(world, {
    mapGroup: inside.map.mapGroup,
    mapNum: inside.map.mapNum,
    x: 7,
    y: 4,
  }, { hops: 6 });
  if (!walked.ok) return { ok: false, reason: `could not reach the counter: ${walked.reason}` };

  // Face her and talk. The whole exchange is A presses; what matters is the
  // party, so that is what is watched.
  yield* hold(BTN.UP, 20);
  let healed = false;
  for (let frame = 0; frame < limit && !healed; frame++) {
    state = yield beat(frame, { on: 5, cycle: 14 }) ? BTN.A : 0;
    healed = state && whole(state.party);
  }
  if (!healed) return { ok: false, reason: "stood at the counter and was never healed" };

  for (let attempt = 0; attempt < 60; attempt++) {
    const before = (yield 0).position;
    const after = (yield* hold(BTN.DOWN, 40)) && (yield* settle(10)).position;
    if (!after) continue;
    if (after.map.mapNum !== inside.map.mapNum) return { ok: true, at: after };
    if (!sameSpot(before, after)) {
      // Free to walk. Straight south, out of the door.
      for (let i = 0; i < 400; i++) {
        const where = (yield BTN.DOWN).position;
        if (where && where.map.mapNum !== inside.map.mapNum) return { ok: true, at: where };
      }
      break;
    }
    // Still boxed in: one press to advance the text, and look again.
    yield* tap(BTN.A, { press: 4, then: 30 });
  }
  return { ok: false, reason: "healed, but could not get back out" };
}

/**
 * The whole round trip: from wherever the player is standing to the nearest
 * Pokémon Center and back to the tile they left.
 *
 * This is what the recorded route used to buy, and it no longer has to be
 * bought: with the warp graph the app can work out which Center is nearest
 * and how to get inside one it has never been shown.
 */
export function* healTrip(world, { from = null, allowed = null } = {}) {
  let state = yield 0;
  const start = from || (state && state.position);
  if (!start) return { ok: false, reason: "no position to come back to" };

  const centre = world.nearestCentre(start.map);
  if (!centre) return { ok: false, reason: "no Pokémon Center reachable from here" };

  const out = yield* goTo(world, centre.door, { allowed });
  if (!out.ok) return { ok: false, reason: `could not reach the Center: ${out.reason}`, leg: "there" };

  yield* settle(60);
  const healed = yield* healInside(world);
  if (!healed.ok) return { ...healed, leg: "heal" };

  // Back to the exact tile the grind was interrupted on. Coming back to "the
  // town" is not coming back: the grass is a specific set of tiles and
  // standing next to it finds nothing all night.
  const back = yield* goTo(world, { ...start.map, x: start.x, y: start.y }, { allowed });
  if (!back.ok) return { ok: false, reason: `healed, but could not get back: ${back.reason}`, leg: "back" };
  return { ok: true, at: back.at, centre: centre.inside.name };
}
