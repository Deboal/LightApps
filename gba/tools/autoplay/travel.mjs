// travel.mjs — getting somewhere, with the tile read as the only judge.
//
// This is greedy walking, not pathfinding: press the direction that closes
// the larger gap, and when the tile stops changing, try something else. It
// works because towns and routes are mostly open, and because it never
// believes it has moved — every press is judged by whether the player's tile
// actually changed.
//
// Where it does not work, it says so with the tile it gave up on, which is a
// far better failure than a script that presses hopefully for an hour.

import { BTN, game } from "./machine.mjs";
import { bestMove, spent } from "../../../apps/gba/src/policy.js";
import { grid, path as planPath, pathToAny, layoutOf } from "./maps.mjs";

/** Frames to hold a direction before deciding it is blocked. A walking step
 *  is sixteen frames, so this is comfortably more than one step. */
const BLOCKED = 40;

const sameMap = (a, b) => a.map.mapGroup === b.mapGroup && a.map.mapNum === b.mapNum;

/**
 * Get through a battle, whatever kind it is.
 *
 * Running was the first attempt and it is not enough: routes between towns
 * are lined with trainers, and a trainer battle cannot be fled. A traveller
 * that only knows how to run stops dead at the first one — which is exactly
 * what happened, reported as "could not get out of a battle" two tiles from
 * where it set off.
 *
 * So it fights by default and runs only when the Pokémon that is out is hurt.
 * Fighting is also the better trade on the way to somewhere: the trainers are
 * worth more experience than the wild Pokémon being walked past.
 */
export function throughBattle(machine, { limit = 60000, runBelow = 0.3, prefer = "fight" } = {}) {
  // Running is free when it works and impossible when it does not: a wild
  // Pokemon can be left, a trainer cannot. So "run" is a preference, not a
  // plan -- try it, and once enough turns have gone by with the battle still
  // going, this is a trainer and the only way out is through.
  //
  // It matters most on the way to a Pokemon Center, which is a walk taken
  // because the lead is already hurt. Fighting everything along that walk is
  // how a trip for a heal becomes the thing that needed one.
  let asked = 0;
  let running = prefer === "run";

  for (let waited = 0; waited < limit; waited++) {
    const state = machine.look();
    if (!state.inBattle) return { ok: true, waited };

    const battle = state.battle;
    const beat = waited % 12 < 4;
    const active = battle && Number.isInteger(battle.active) ? battle.active : 0;
    const fighter = (state.party && state.party[active]) || (state.party && state.party[0]);
    const share = fighter && fighter.maxHp ? fighter.hp / fighter.maxHp : 1;
    const want = fighter && bestMove(fighter);
    // `spent`, not `!want`: a party record that failed its checksum this frame
    // is not a Pokemon out of PP, and fleeing on one is throwing away a battle
    // that was being won.
    const flee = running || share < runBelow || (fighter && spent(fighter));

    if (!battle || !battle.menu) {
      machine.step(beat ? BTN.A : 0);
      continue;
    }
    if (battle.menu === "party") {
      machine.step(beat ? BTN.A : 0);
      continue;
    }
    if (battle.menu === "action") {
      if (running && ++asked > 6) running = false;
      const target = flee ? 3 : 0;
      const differs = (battle.action ?? 0) ^ target;
      machine.step(beat ? (differs ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : BTN.A) : 0);
      continue;
    }
    if (battle.menu === "move") {
      if (flee) {
        machine.step(beat ? BTN.B : 0);
        continue;
      }
      const differs = (battle.cursor ?? 0) ^ want.index;
      machine.step(beat ? (differs ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : BTN.A) : 0);
      continue;
    }
    machine.step(beat ? BTN.A : 0);
  }
  return { ok: false, reason: "a battle would not end" };
}

/** Kept for callers that specifically want to leave rather than win. */
export const escape = (machine, options) =>
  throughBattle(machine, { ...options, runBelow: 2 });

/** One step, from one tile to an adjacent one. */
const stepKey = (from, to) =>
  to.x > from.x ? BTN.RIGHT : to.x < from.x ? BTN.LEFT : to.y > from.y ? BTN.DOWN : BTN.UP;

/**
 * Walk a planned path, checking every step.
 *
 * The plan comes from the game's own collision data, which knows about walls
 * and knows nothing about ledges, people standing in doorways, or the wild
 * Pokémon that will interrupt halfway. So the plan is a proposal: press
 * towards the next tile, and only advance when the player is actually on it.
 * A step that will not happen after enough tries is a wrong plan, and saying
 * so beats leaning on a hedge.
 */
export function walkPath(machine, tiles, { onMove = null, patience = 90 } = {}) {
  let index = 0;
  let tries = 0;
  while (index < tiles.length) {
    const state = machine.look();
    if (state.inBattle) {
      // Fight rather than run. Running looks cheaper and is not: it is a
      // different code path from the one the grind exercises thirty times a
      // minute, and against a wild Pokemon a healthy lead wins faster than it
      // escapes. Travelling now sets off at eight tenths health, which is
      // what makes fighting the way there affordable.
      const out = throughBattle(machine);
      if (!out.ok) return out;
      tries = 0;
      continue;
    }
    const here = state.position;
    if (!here) {
      machine.step(0);
      continue;
    }
    // Skip past any tiles already stood on -- a run covers ground faster than
    // one tile per press.
    while (index < tiles.length && here.x === tiles[index].x && here.y === tiles[index].y) {
      if (onMove) onMove(here);
      index++;
      tries = 0;
    }
    if (index >= tiles.length) break;

    const next = tiles[index];
    if (Math.abs(next.x - here.x) + Math.abs(next.y - here.y) > 1) {
      // Knocked off the plan, most likely by a warp or a ledge.
      return { ok: false, reason: "left the planned path", at: here, index };
    }
    machine.step(stepKey(here, next) | BTN.B);
    if (++tries > patience) {
      return { ok: false, reason: `blocked heading to ${next.x},${next.y}`, at: here, index, blocked: next };
    }
  }
  return { ok: true, at: machine.look().position };
}

/**
 * Get to a tile, on this map or an adjacent one.
 *
 * Crossing between maps is walking off an edge, so a target elsewhere is
 * approached by pathing to the edge tile nearest it and stepping off. Each
 * map crossed is re-planned from where the player actually lands, which is
 * the only honest way to do it: the offsets between connected maps are real
 * but so are the ways a walk can go differently than planned.
 */
export function goTo(machine, target, { hops = 12, allowed = null } = {}) {
  // Maps this walk is permitted to be on. Without it a trip is free to
  // wander: stepping onto an unnoticed warp puts the player somewhere the
  // plan knows nothing about, and the next hop heads for *that* map's edge,
  // and twelve hops later a walk to the Pokémon Center two screens away has
  // ended inside a house in Pallet Town. That happened. Straying is a thing
  // to stop on, because the alternative is a save left somewhere strange.
  const permitted = (here) =>
    !allowed || allowed.some((m) => m.mapGroup === here.map.mapGroup && m.mapNum === here.map.mapNum);
  // Tiles the map calls open and the game refuses. People stand in the way,
  // and they are not in any layout file. Re-planning around a refusal is the
  // difference between a walk that arrives and a walk that leans on someone.
  const refused = new Set();
  const key = (map, tile) => `${map}:${tile.x},${tile.y}`;

  for (let hop = 0; hop < hops; hop++) {
    const here = machine.look().position;
    if (!here) return { ok: false, reason: "no position" };
    if (!permitted(here)) {
      // One reading is not evidence. Crossing between maps rewrites the very
      // field this is read from, so a sample taken during the transition can
      // be anything -- and a trip that aborts on a single frame of nonsense
      // is a trip that aborts. Look again, a few times, before believing it.
      let strayed = true;
      for (let look = 0; look < 12 && strayed; look++) {
        for (let i = 0; i < 20; i++) machine.step(0);
        const again = machine.look().position;
        if (again && permitted(again)) strayed = false;
      }
      if (strayed) {
        const at = machine.look().position;
        return { ok: false, reason: `strayed onto map ${at.map.mapGroup}/${at.map.mapNum}`, at };
      }
      continue;
    }
    const onTarget =
      here.map.mapGroup === target.mapGroup && here.map.mapNum === target.mapNum;
    if (onTarget && here.x === target.x && here.y === target.y) {
      return { ok: true, at: here };
    }

    const layout = layoutOf(here.map.mapGroup, here.map.mapNum);
    const base = grid(layout.layout);

    // Doors are walkable and they are not passable: step on one and you are
    // somewhere else. The collision grid has no idea -- a path across
    // Vermilion happily routes through the front door of a house, and the
    // walk that follows ends up planning its way out of somebody's kitchen.
    // The map's own warp list is right there, so every warp is a wall, except
    // one we are deliberately aiming at.
    const doors = new Set(
      (layout.json.warp_events || [])
        .filter((w) => !(onTargetTile(target, here, w)))
        .map((w) => `${w.x},${w.y}`)
    );
    const map = {
      ...base,
      at: (x, y) =>
        base.at(x, y) &&
        !refused.has(key(layout.layout, { x, y })) &&
        !doors.has(`${x},${y}`),
    };

    let plan;
    if (onTarget) {
      const tiles = planPath(map, here, { x: target.x, y: target.y });
      if (!tiles) {
        // The tiles this walk has been refused are people, and people move.
        // Enough of them along a three-tile corridor severs it, and the
        // planner then reports no path through ground it crossed a minute
        // ago. Forget them and look again before giving up.
        if (refused.size) {
          refused.clear();
          continue;
        }
        return { ok: false, reason: `no path to ${target.x},${target.y} on ${layout.name}`, at: here };
      }
      plan = tiles;
    } else {
      // Off this map: head for the edge the connection lies on. Every open
      // tile along that edge is a candidate, and the search picks whichever
      // is genuinely reachable -- the nearest one often is not.
      const edge = target.toward;
      const candidates = [];
      if (edge === BTN.DOWN || edge === BTN.UP) {
        const y = edge === BTN.DOWN ? map.height - 1 : 0;
        for (let x = 0; x < map.width; x++) candidates.push({ x, y });
      } else {
        const x = edge === BTN.RIGHT ? map.width - 1 : 0;
        for (let y = 0; y < map.height; y++) candidates.push({ x, y });
      }
      const found = pathToAny(map, here, candidates);
      if (!found) return { ok: false, reason: `no way off ${layout.name}`, at: here };
      plan = found.tiles;
    }

    const walked = walkPath(machine, plan);
    if (!walked.ok) {
      if (walked.blocked) {
        refused.add(key(layout.layout, walked.blocked));
        continue; // re-plan around whoever that is
      }
      if (walked.reason !== "left the planned path") return walked;
      continue;
    }

    if (!onTarget) {
      // Step off the edge into the next map.
      const before = machine.look().position;
      for (let i = 0; i < 90; i++) machine.step(target.toward | BTN.B);
      const after = machine.look().position;
      if (after && before && after.map.mapNum === before.map.mapNum) {
        return { ok: false, reason: "the edge did not lead anywhere", at: after };
      }
    }
  }
  return { ok: false, reason: "too many attempts", at: machine.look().position };
}

/** Whether a warp is the very tile being walked to, in which case it is not a
 *  hazard but the destination. */
function onTargetTile(target, here, warp) {
  return (
    target.mapGroup === here.map.mapGroup &&
    target.mapNum === here.map.mapNum &&
    warp.x === target.x &&
    warp.y === target.y
  );
}
