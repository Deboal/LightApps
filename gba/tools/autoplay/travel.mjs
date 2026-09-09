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
import { bestMove } from "../../../apps/gba/src/policy.js";
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
export function throughBattle(machine, { limit = 12000, runBelow = 0.3 } = {}) {
  for (let waited = 0; waited < limit; waited++) {
    const state = machine.look();
    if (!state.inBattle) return { ok: true, waited };

    const battle = state.battle;
    const beat = waited % 12 < 4;
    const active = battle && Number.isInteger(battle.active) ? battle.active : 0;
    const fighter = (state.party && state.party[active]) || (state.party && state.party[0]);
    const share = fighter && fighter.maxHp ? fighter.hp / fighter.maxHp : 1;
    const want = fighter && bestMove(fighter);
    const flee = share < runBelow || !want;

    if (!battle || !battle.menu) {
      machine.step(beat ? BTN.A : 0); // text, animations, the intro
      continue;
    }
    if (battle.menu === "party") {
      machine.step(beat ? BTN.A : 0); // a faint: send out the next one
      continue;
    }
    if (battle.menu === "action") {
      const target = flee ? 3 : 0; // RUN or FIGHT
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
export function goTo(machine, target, { hops = 12 } = {}) {
  // Tiles the map calls open and the game refuses. People stand in the way,
  // and they are not in any layout file. Re-planning around a refusal is the
  // difference between a walk that arrives and a walk that leans on someone.
  const refused = new Set();
  const key = (map, tile) => `${map}:${tile.x},${tile.y}`;

  for (let hop = 0; hop < hops; hop++) {
    const here = machine.look().position;
    if (!here) return { ok: false, reason: "no position" };
    const onTarget =
      here.map.mapGroup === target.mapGroup && here.map.mapNum === target.mapNum;
    if (onTarget && here.x === target.x && here.y === target.y) {
      return { ok: true, at: here };
    }

    const layout = layoutOf(here.map.mapGroup, here.map.mapNum);
    const base = grid(layout.layout);
    const map = {
      ...base,
      at: (x, y) => base.at(x, y) && !refused.has(key(layout.layout, { x, y })),
    };

    let plan;
    if (onTarget) {
      const tiles = planPath(map, here, { x: target.x, y: target.y });
      if (!tiles) return { ok: false, reason: `no path to ${target.x},${target.y} on ${layout.name}`, at: here };
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
