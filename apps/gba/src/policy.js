// policy.js — the part that presses the buttons.
//
// A policy is a plain object; this turns one into a thing that is handed the
// game's state each frame and answers with a button mask. It holds no timers,
// touches no DOM and reads no memory itself, which is what makes it testable:
// every branch below can be driven from a synthetic state in a few lines.
//
// The model never gets to run code here. It fills in parameters — which party
// member, what level to stop at, when to run away — and this is the whole
// vocabulary those parameters select from. A policy that could emit behaviour
// would be a policy that could do anything while nobody was watching.

import { BTN } from "./buttons.js";
import { sameTile } from "./game.js";
import { MOVES, moveName } from "./moves.js";
import { follower, usable, ROUTE_STUCK } from "./route.js";

/** Buttons have to be released to be pressed again: the game reads edges, so a
 *  held A advances one message and then nothing. Four frames down, eight up. */
const TAP_DOWN = 4;
const TAP_CYCLE = 12;

/** How long to walk one way before turning around. Six tiles at a run: long
 *  enough to cross a patch of grass, short enough not to leave it. */
const LEG = 48;

/** The four ways to walk, in the order they are tried when something is in
 *  the way. Turning is the whole repertoire: this does not know what an item
 *  ball is, only that it is not moving. */
const DIRS = [BTN.LEFT, BTN.DOWN, BTN.RIGHT, BTN.UP];

/** How far from where it started the walk may wander, in tiles.
 *
 *  Pacing four equal-length legs only returns to where it began if all four
 *  cover the same ground -- and they do not, because a blocked leg turns
 *  early. The drift is systematic, so it walks steadily out of the grass it
 *  was put in. Now that the tile is readable the answer is a leash rather
 *  than a pattern: wander freely inside this radius, and head back the moment
 *  it is exceeded. */
const LEASH = 4;

/** Frames spent at the counter before giving up on being healed. The nurse
 *  takes a few seconds of text and animation; a minute means the route ended
 *  somewhere that is not a nurse. */
const HEAL_PATIENCE = 60 * 60;

/** A direction from a difference in tiles. Routes are recorded on every tile
 *  change, so consecutive waypoints are adjacent and this is arithmetic
 *  rather than pathfinding -- but it still works for a target several tiles
 *  off, which is what walking back to a route's start needs. */
const towards = (key) =>
  // A warp answers with the direction that worked when it was walked; a step
  // on the same map answers with the difference between two tiles.
  key.dir
    ? key.dir
    : key.dx > 0 ? BTN.RIGHT
    : key.dx < 0 ? BTN.LEFT
    : key.dy > 0 ? BTN.DOWN
    : key.dy < 0 ? BTN.UP
    : 0;

const everyoneWhole = (party) => party.every((mon) => mon.hp === mon.maxHp);

/** A recorded waypoint, shaped like a position read. */
const asPlace = (tile) => ({
  x: tile.x,
  y: tile.y,
  map: { mapGroup: tile.mapGroup, mapNum: tile.mapNum },
});

/** The move this will actually use.
 *
 *  It mashes A, and A picks the first move -- so the first move is the whole
 *  strategy until the move list can be navigated, which needs a battle-menu
 *  read this does not have yet. What it *can* do is know which move that is
 *  and refuse to pretend. A first move with no PP left is a battle the game
 *  will not let it start, and mashing A into "there's no PP left for this
 *  move" forever is the worst way to spend a night. */
const movesOf = (mon) => (mon && mon.record ? mon.record.moves : null);
const firstMove = (mon) => {
  const moves = movesOf(mon);
  return moves ? moves[0] : null;
};

/** Which of the four to use: the hardest-hitting one that still has PP.
 *
 *  Ties break towards the move with more PP left, so a long run leans on the
 *  one it can keep using. A party where every move is a status move picks the
 *  one with PP anyway -- there is nothing better to do, and stopping on that
 *  alone would be wrong when Sing can still be the thing that ends a fight. */
function bestMove(mon) {
  const moves = movesOf(mon);
  if (!moves) return null;
  let best = null;
  moves.forEach((move, index) => {
    if (!move.id || move.pp === 0) return;
    const power = MOVES[move.id] ? MOVES[move.id].p : 0;
    if (!best || power > best.power || (power === best.power && move.pp > best.pp)) {
      best = { index, id: move.id, power, pp: move.pp };
    }
  });
  return best;
}

/** Frames of holding a direction on the same tile before calling it blocked.
 *
 *  The slowest honest case is a turn on the spot (eight frames) followed by a
 *  walking step (sixteen), so twenty-four frames is the most a real step can
 *  take; twenty-eight leaves margin. It has to be comfortably *below* LEG or
 *  it never fires -- both were forty at first, which made this dead code that
 *  read as a feature. */
const STUCK = 28;

/** Frames of a battle spent pressing A before concluding the menu is not where
 *  we think it is. A battle that will not advance is a stuck run, and a stuck
 *  run left alone all night is worse than one that stopped. */
const BATTLE_PATIENCE = 60 * 60;

/** Frames of walking with nothing happening before giving up on finding a
 *  fight. Standing in the wrong place is the most likely way this fails. */
const SEEK_PATIENCE = 90 * 60;

/** Frames the party may be unreadable before this gives up on it. Not zero:
 *  the party is read out of live memory while the game is writing to it, so a
 *  single frame that fails the shape test is a torn write, not a lost game.
 *  A second of them is something else. */
const BLIND_PATIENCE = 60;

const tapping = (frame) => (frame % TAP_CYCLE < TAP_DOWN);

/**
 * Build a runner for a policy.
 *
 * `step(state)` takes `{ party, inBattle, frame }` and returns
 * `{ keys, done, reason }`. It is a pure function of the state it is
 * given plus its own counters — no clock, no randomness — so a run is
 * reproducible and a test can drive it anywhere in seconds.
 */
/**
 * What a policy will actually do with a given party, in one line, before
 * anything runs. The move matters more than the thresholds: four of a typical
 * party's six have a status move in the first slot, and that is the move this
 * will use every turn.
 */
export function previewOf(policy, party) {
  const slot = (policy && policy.slot) || 0;
  const mon = party && party[slot];
  if (!mon) return null;
  const want = bestMove(mon);
  if (!want) {
    const first = firstMove(mon);
    return { name: mon.name, move: first && first.id ? moveName(first.id) : null, power: 0, pp: 0 };
  }
  return { name: mon.name, move: moveName(want.id), power: want.power, pp: want.pp };
}

export function runner(policy, route = null) {
  const { slot = 0, stopAtLevel = 100, fleeBelowHp = 0.34, stopBelowHp = 0.15 } = policy || {};
  // Healing is only on the table with a route that was walked and whose heal
  // was actually watched happening. Without one this behaves exactly as it
  // did before: it stops when HP runs low.
  const canHeal = usable(route);
  const healBelowHp = canHeal ? (policy && policy.healBelowHp) || 0.4 : 0;

  let phase = "seek";
  let inPhase = 0;
  let ticks = 0;
  let battles = 0;
  let fleeing = 0;

  // The self-check. `inBattle` comes from an address found by its shape, and
  // the field's meaning from the game's own source -- but it has never been
  // watched turning on. So rather than trust it, watch for the thing it is
  // supposed to predict: HP falling is a fight. If that happens repeatedly
  // while the flag says otherwise, the flag is wrong and this stops instead of
  // pressing buttons into a game it is misreading. One battle seen resets
  // the count, so this cannot accumulate a stop out of the one-frame race
  // between a battle ending and the damage that ended it.
  let lastHp = null;
  let damageUnseen = 0;
  let blind = 0;

  // Walking, now that the game will say where the player is standing. Holding
  // LEFT into an item ball and walking left are the same buttons and the same
  // screen; the only thing that tells them apart is the tile not changing.
  let dir = 0;
  let sinceTurn = 0;
  let stuckFor = 0;
  let lastTile = null;
  let everMoved = false;
  let home = null;

  // The trip to the Pokemon Center. `mode` is what the walking is *for*;
  // `phase` above stays the question of whether a battle is happening.
  let mode = "grind";
  let walk = null;
  let healTicks = 0;
  let walkStuck = 0;

  return {
    get phase() {
      return phase;
    },
    get battles() {
      return battles;
    },
    /** What the walking is for right now: grinding, or somewhere in the trip
     *  to be healed. The panel says this out loud so a run that has wandered
     *  off to a Centre does not look like one that has wandered off. */
    get mode() {
      return mode;
    },
    get ticks() {
      return ticks;
    },

    step(state) {
      const party = state && state.party;
      if (!party || !party[slot]) {
        // Hold still rather than act on a read that failed, and only give up
        // once it has failed for long enough to mean something.
        if (++blind < BLIND_PATIENCE) return { keys: 0 };
        return { keys: 0, done: true, reason: "Lost sight of the party." };
      }
      blind = 0;
      const mon = party[slot];
      const share = mon.maxHp ? mon.hp / mon.maxHp : 0;
      ticks++;

      // -- the flag against reality ---------------------------------------
      if (lastHp !== null && mon.hp < lastHp && !state.inBattle) damageUnseen++;
      lastHp = mon.hp;
      if (damageUnseen >= 3) {
        return {
          keys: 0,
          done: true,
          reason:
            "Something is fighting back but the game does not report a battle. " +
            "Stopping rather than pressing buttons into a state I am misreading.",
        };
      }

      // -- the reasons to stop --------------------------------------------
      // The move it is about to use, checked before it is used rather than
      // after a minute of mashing A into a refusal.
      const moves = movesOf(mon);
      if (moves && !bestMove(mon)) {
        return {
          keys: 0,
          done: true,
          reason: `${mon.name} has no PP left in any move. Nothing to fight with.`,
        };
      }
      if (mon.fainted) {
        return { keys: 0, done: true, reason: `${mon.name} fainted.` };
      }
      if (mon.level >= stopAtLevel) {
        return { keys: 0, done: true, reason: `${mon.name} reached level ${mon.level}.` };
      }
      if (share < stopBelowHp && !(canHeal && mode !== "grind")) {
        return {
          keys: 0,
          done: true,
          reason: `${mon.name} is down to ${mon.hp}/${mon.maxHp} and there is no way to heal from here.`,
        };
      }

      // -- phases -----------------------------------------------------------
      const was = phase;
      phase = state.inBattle ? "battle" : "seek";
      if (phase !== was) {
        inPhase = 0;
        if (phase === "battle") {
          battles++;
          // A battle actually observed is the flag working. Whatever the
          // self-check below had counted was the one-frame race at the end of
          // the last one, not evidence against the flag.
          damageUnseen = 0;
        }
        if (phase === "seek") {
          fleeing = 0;
          // A battle moves nothing, but it does end with the player facing a
          // different way. Start the leg over rather than counting frames
          // spent fighting as frames spent walking.
          sinceTurn = 0;
          stuckFor = 0;
          lastTile = null;
        }
      }
      const elapsed = inPhase++;

      if (phase === "battle") {
        if (elapsed > BATTLE_PATIENCE) {
          return {
            keys: 0,
            done: true,
            reason: "A battle stopped responding. Stopping before this goes anywhere strange.",
          };
        }
        // Hurt enough to leave. Backing out with B first is what makes this
        // work from either menu: from the move list B returns to the main one,
        // and on the main menu it does nothing. Then down-right is RUN.
        // On the way to be healed, every fight is one to leave.
        if (share < fleeBelowHp || mode !== "grind") fleeing = 1;
        if (fleeing) {
          // One whole tap cycle per step, and that is not cosmetic: a window
          // shorter than the cycle can fall entirely between two taps, and the
          // step in it is then never pressed at all. Four steps of twelve.
          const beat = elapsed % (4 * TAP_CYCLE);
          const key =
            beat < TAP_CYCLE ? BTN.B
            : beat < 2 * TAP_CYCLE ? BTN.DOWN
            : beat < 3 * TAP_CYCLE ? BTN.RIGHT
            : BTN.A;
          return { keys: tapping(elapsed) ? key : 0 };
        }
        // Choosing a move, now that the game will say which menu is up.
        //
        // Without this the only button in a battle is A, and A takes the
        // first move -- which on a typical party is Growl about half the
        // time, and eventually a move with no PP. The menu read turns that
        // into a choice: the cursor moves by XOR, so any of the four is at
        // most two presses away, and each press is checked against the cursor
        // rather than counted.
        const battle = state.battle;
        if (battle && battle.menu === "move") {
          const want = bestMove(mon);
          if (want) {
            const differs = battle.cursor ^ want.index;
            if (differs) {
              // One axis per press. Which direction within it does not
              // matter: both flip the same bit.
              return { keys: tapping(elapsed) ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : 0 };
            }
          }
        }
        // The action menu, battle text, an animation: A is right for all of
        // them. FIGHT is where the action cursor starts and nothing here
        // moves it.
        return { keys: tapping(elapsed) ? BTN.A : 0 };
      }

      // Blocked, or just walking? The tile answers it. Without a position
      // read this falls back to turning on the clock alone, which is what it
      // did before and is still better than nothing.
      const here = state.position;
      if (here) {
        if (lastTile && sameTile(here, lastTile)) stuckFor++;
        else {
          if (lastTile) everMoved = true;
          stuckFor = 0;
        }
        lastTile = here;
        // Where this is anchored. With a route, that is the route's first
        // tile rather than wherever Start happened to be pressed: the leash
        // then guarantees the walk to the Centre never begins more than a few
        // tiles off the recorded path, which is the only path known to be
        // walkable. Without one it is simply where it was set going.
        if (!home) home = canHeal ? asPlace(route.tiles[0]) : here;
      }

      // Off the map it started on. It cannot find its way back -- it has no
      // route and no map -- so stopping is the honest end rather than
      // wandering further into a town.
      if (
        mode === "grind" &&
        here && home &&
        (here.map.mapGroup !== home.map.mapGroup || here.map.mapNum !== home.map.mapNum)
      ) {
        return {
          keys: 0,
          done: true,
          reason: "Walked off the map it started on, and it has no way back yet.",
        };
      }

      if (elapsed > SEEK_PATIENCE) {
        return {
          keys: 0,
          done: true,
          reason: here && !everMoved
            ? "Tried all four directions and never moved a single tile. " +
              "Something is in the way, or this is not somewhere it can walk."
            : "Walked for a minute and a half without a single encounter. " +
              "This wants to be standing in tall grass.",
        };
      }

      // -- the trip to the Centre -----------------------------------------
      //
      // A recorded route, walked with the tile read as feedback rather than
      // replayed blind: a wild encounter on the way is fought and the walk
      // resumes, because the next press is derived from where the player
      // actually is and not from a script.
      // Standing at the counter is not being stuck, so the walking modes are
      // the only ones this applies to.
      if (mode === "toNurse" || mode === "back") {
        if (!here) return { keys: 0 };
        walkStuck = stuckFor;
        if (walkStuck > ROUTE_STUCK) {
          return {
            keys: 0,
            done: true,
            reason: `Stuck on the way to the Pokémon Center, at tile (${here.x}, ${here.y}). Something is in the way that was not there when the route was walked.`,
          };
        }
      }

      if (mode === "toNurse") {
        const out = walk.step(here);
        if (out.lost) {
          return {
            keys: 0,
            done: true,
            reason: "Lost the route to the Pokémon Center — this is not a map it was walked through.",
          };
        }
        // Strictly past, not merely at: the follower advances the index off
        // every tile it has stood on, so `> healAt` is "we were there" while
        // `>= healAt` is "it is the next one along" -- which would stand at
        // the counter from one tile short of it.
        if (out.index > route.healAt) {
          mode = "atNurse";
          healTicks = 0;
        } else {
          return { keys: towards(out.key) | BTN.B };
        }
      }

      if (mode === "atNurse") {
        if (everyoneWhole(party)) {
          // Healed, and watched being healed -- the same edge the recording
          // used to find this tile in the first place.
          mode = "back";
          walk = follower(route, route.healAt);
          healTicks = 0;
        } else if (++healTicks > HEAL_PATIENCE) {
          return {
            keys: 0,
            done: true,
            reason: "Stood at the counter for a minute without being healed. The route ends somewhere that is not a nurse.",
          };
        } else {
          return { keys: tapping(elapsed) ? BTN.A : 0 };
        }
      }

      if (mode === "back") {
        const out = walk.step(here);
        if (out.lost) {
          return { keys: 0, done: true, reason: "Lost the route back from the Pokémon Center." };
        }
        if (out.arrived) {
          mode = "grind";
          // Back to the anchor, not to wherever the recording happened to
          // stop -- so the next trip starts from the same place this one did.
          home = asPlace(route.tiles[0]);
        } else {
          return { keys: towards(out.key) | BTN.B };
        }
      }

      // Hurt enough to be worth the trip, and there is a way to make it.
      if (canHeal && here && share < healBelowHp && !everyoneWhole(party)) {
        mode = "toNurse";
        walk = follower(route, 0);
        walkStuck = 0;
        return { keys: 0 };
      }

      // Too far from where it started: head back instead of wandering on.
      // The bigger of the two offsets is the one worth closing, and closing
      // it is one direction, not a plan.
      if (here && home) {
        const dx = here.x - home.x;
        const dy = here.y - home.y;
        if (Math.abs(dx) > LEASH || Math.abs(dy) > LEASH) {
          const back =
            Math.abs(dx) >= Math.abs(dy)
              ? dx > 0 ? BTN.LEFT : BTN.RIGHT
              : dy > 0 ? BTN.UP : BTN.DOWN;
          // Still turn if that direction is blocked, or it would lean into a
          // wall forever trying to get home.
          if (stuckFor < STUCK) {
            sinceTurn = 0;
            return { keys: back | BTN.B };
          }
        }
      }

      // Turn at the end of a leg, or the moment the tile stops changing.
      if (sinceTurn >= LEG || stuckFor >= STUCK) {
        dir = (dir + 1) % DIRS.length;
        sinceTurn = 0;
        stuckFor = 0;
      }
      sinceTurn++;
      // B is held the whole time: B is running, encounters are counted per
      // step, so this is close to twice the fights per minute for nothing --
      // and on a save without the Running Shoes it simply does nothing. What
      // is deliberately absent is A: an A press in the overworld talks to
      // whoever is standing nearby, and this is meant to be left alone.
      return { keys: DIRS[dir] | BTN.B };
    },
  };
}
