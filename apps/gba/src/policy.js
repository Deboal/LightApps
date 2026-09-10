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
// Circular, and deliberately: `journey.js` needs `bestMove` to fight its way
// to the Centre, and this needs `journey.js` to make the trip. Both uses are
// inside functions rather than at module scope, which is what makes it safe --
// by the time either is called, both modules have finished evaluating.
import { drive } from "./drive.js";
import { healTrip, goTo } from "./journey.js";

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
/** The action menu is the same two-bit grid as the moves: FIGHT 0, BAG 1,
 *  POKéMON 2, RUN 3. */
const FIGHT = 0;
const RUN = 3;

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
export function bestMove(mon) {
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

export function runner(policy, route = null, world = null) {
  const { slot = 0, stopAtLevel = 100, fleeBelowHp = 0.34, stopBelowHp = 0.15 } = policy || {};
  // Two ways to reach a Pokémon Center, and they are not equal.
  //
  // With the world data loaded, the trip is planned: the nearest Centre is
  // searched for over the map graph, the walk there is pathfound from the
  // game's own collision data, and the way back is to the exact tile the
  // grind was interrupted on. Nothing has to have been shown to it first.
  //
  // Without it -- an Emerald cartridge, or the asset failing to load -- the
  // fallback is the recorded route: a trip the player walked once, replayed
  // with the tile read as feedback. That is what this could do before, and it
  // still can, because a cartridge these maps do not describe is a cartridge
  // where a planned route would be confidently and invisibly wrong.
  const canPlan = !!world;
  const canHeal = canPlan || usable(route);
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
  // The journey currently being driven, when there is one, and what it is for.
  let trip = null;
  let tripKind = null;
  let heals = 0;
  // Somewhere better to do this than where Start was pressed. The model picks
  // it from the places the app offers; getting there is the first thing that
  // happens, before a single blade of grass is walked into.
  const spot = (canPlan && policy && policy.spot) || null;
  let travelled = !spot;
  // Set when a battle is left because something is wrong with the Pokémon
  // that is out -- hurt, spent, or knocked out. Acted on once the battle is
  // over and there is somewhere to walk to.
  let needsHeal = false;
  // Frames spent in a battle with a controller pointer this build does not
  // recognise. Without the menus the runner can only mash A, and A takes the
  // first move -- which looks exactly like the move picker choosing badly.
  // Counting it means it can say so instead.
  let menuBlind = 0;
  let strangeFn = 0;
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
    /** Trips to a Centre completed. Worth showing: a long run that has healed
     *  four times is working, and one that has healed forty is not. */
    get heals() {
      return heals;
    },
    /** What the journey under way is for, when `mode` is "journey": "heal" on
     *  the round trip to a Centre, "travel" on the way to the grinding spot.
     *  The readout says which, because a player watching their character walk
     *  across a town deserves to know why. */
    get trip() {
      return tripKind;
    },
    /** True once a battle has spent long enough in menus this build cannot
     *  read that the moves are certainly not being chosen. A minute of it is
     *  well past any animation. */
    get menuBlind() {
      return menuBlind > 60 * 60;
    },
    /** The pointer that was not recognised, for saying which build this is. */
    get strangeFn() {
      return strangeFn;
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
        // A Centre restores PP as well as HP, which is the whole reason
        // running dry does not have to end a run.
        if (!canHeal) {
          return {
            keys: 0,
            done: true,
            reason: `${mon.name} has no PP left in any move. Nothing to fight with.`,
          };
        }
        needsHeal = true;
      }
      if (mon.fainted) {
        // With a route this is an errand, not an ending: the game sends out
        // the next Pokémon, this runs from the fight and walks to a Centre.
        if (!canHeal) return { keys: 0, done: true, reason: `${mon.name} fainted.` };
        needsHeal = true;
      }
      if (mon.level >= stopAtLevel) {
        return { keys: 0, done: true, reason: `${mon.name} reached level ${mon.level}.` };
      }
      // With a route this is an errand rather than an ending, so the floor
      // only applies when there is nowhere to go.
      if (share < stopBelowHp && !canHeal) {
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

        const battle = state.battle;
        // Who is actually out. Without this a faint leaves the runner judging
        // the HP of a Pokémon that stopped fighting a minute ago -- it reads
        // zero, and every decision after that is about the wrong animal.
        // Defensive about a partial read: a menu state without a cursor must
        // not become a direction press into a menu.
        const activeSlot = battle && Number.isInteger(battle.active) ? battle.active : slot;
        const actionAt = battle && Number.isInteger(battle.action) ? battle.action : FIGHT;
        const fighter = party[activeSlot] || mon;
        const fighterShare = fighter.maxHp ? fighter.hp / fighter.maxHp : 0;

        // "Choose a POKéMON" -- which the game opens by itself the moment the
        // one that was out faints. Two A presses send out the next: the first
        // takes the highlighted party member, the second takes SHIFT, which is
        // already under the cursor. Learned by opening it and looking at it.
        if (battle && battle.menu === "party") {
          if (canHeal) needsHeal = true;
          return { keys: tapping(elapsed) ? BTN.A : 0 };
        }

        // Reasons to be somewhere else. Note what is *not* among them: being
        // hurt is not a reason to stop, it is a reason to go to a Centre --
        // and a Centre restores PP as well as HP, so running dry has exactly
        // the same remedy as running low.
        const leave =
          mode !== "grind" ||
          !bestMove(fighter) ||
          fighterShare < fleeBelowHp ||
          (activeSlot !== slot && canHeal);

        if (leave) {
          if (canHeal) needsHeal = true;
          // RUN is the fourth option, and the cursor reaches it the way the
          // move cursor does -- by XOR, one axis per press, checked rather
          // than counted. This replaces a blind B/DOWN/RIGHT/A sequence that
          // only worked from a cursor position nobody was reading.
          if (battle && battle.menu === "action") {
            const differs = actionAt ^ RUN;
            if (differs) {
              return { keys: tapping(elapsed) ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : 0 };
            }
            return { keys: tapping(elapsed) ? BTN.A : 0 };
          }
          // Backing out of the move list to where RUN lives.
          if (battle && battle.menu === "move") {
            return { keys: tapping(elapsed) ? BTN.B : 0 };
          }
          // Text or an animation: A advances it.
          return { keys: tapping(elapsed) ? BTN.A : 0 };
        }

        // Choosing a move, now that the game will say which menu is up.
        if (battle && battle.menu === "move") {
          const want = bestMove(fighter);
          if (want) {
            const differs = battle.cursor ^ want.index;
            if (differs) {
              return { keys: tapping(elapsed) ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : 0 };
            }
          }
        }
        // Put the action cursor back on FIGHT before confirming it. It starts
        // there and nothing here moves it -- except a battle this ran from,
        // which leaves it on RUN.
        if (battle && battle.menu === "action" && actionAt !== FIGHT) {
          const differs = actionAt ^ FIGHT;
          return { keys: tapping(elapsed) ? (differs & 1 ? BTN.RIGHT : BTN.DOWN) : 0 };
        }
        // The action menu on FIGHT, battle text, an animation: A for all.
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
        if (!home) home = usable(route) ? asPlace(route.tiles[0]) : here;
      }

      // Off the map it started on, while grinding rather than travelling.
      // Wandering into a town is not something a grind should be able to do,
      // and it means the leash has failed -- so this stops either way. What
      // differs is what can be said about it.
      if (
        mode === "grind" &&
        here && home &&
        (here.map.mapGroup !== home.map.mapGroup || here.map.mapNum !== home.map.mapNum)
      ) {
        return {
          keys: 0,
          done: true,
          reason: canPlan
            ? "Wandered off the map it was grinding on. It can find its way " +
              "back, but a grind that leaves the grass on its own is one that " +
              "has gone wrong somewhere."
            : "Walked off the map it started on, and it has no way back yet.",
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

      // -- the planned trip to the Centre ---------------------------------
      //
      // A journey generator, driven one frame at a time. Everything hard about
      // it -- pathfinding, doors, map edges, the nurse who keeps talking after
      // the party is whole -- lives in `journey.js`, written as straight-line
      // code. All this has to do is feed it frames and notice when it is done.
      if (mode === "journey") {
        const out = trip.step(state);
        if (!out.done) return { keys: out.keys };
        const was = tripKind;
        if (out.result && out.result.ok) {
          // Arrived. Re-anchor: the leash is measured from here, and "here"
          // is the tile it is actually standing on now.
          mode = "grind";
          needsHeal = false;
          trip = null;
          tripKind = null;
          home = here || home;
          if (was === "heal") heals++;
          else travelled = true;
          return { keys: 0 };
        }
        return {
          keys: 0,
          done: true,
          reason:
            was === "heal"
              ? `The trip to the Pokémon Center did not work out: ${
                  (out.result && out.result.reason) || "unknown"
                }.`
              : `Could not get to where this was meant to happen: ${
                  (out.result && out.result.reason) || "unknown"
                }.`,
        };
      }

      // Not there yet. Walk to the spot before doing anything else -- there
      // is no point grinding in the wrong place efficiently.
      if (!travelled && here) {
        mode = "journey";
        tripKind = "travel";
        trip = drive(() => goTo(world, spot));
        return { keys: 0 };
      }

      // -- the recorded trip to the Centre --------------------------------
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
          needsHeal = false;
          // Did the errand work? Walking to a counter and back without being
          // fixed would otherwise loop all night, so the same reads that sent
          // it are checked on the way back.
          const back = party[slot];
          if (back && (back.fainted || (movesOf(back) && !bestMove(back)))) {
            return {
              keys: 0,
              done: true,
              reason:
                `Came back from the Pokémon Center and ${back.name} is still ` +
                `${back.fainted ? "fainted" : "out of PP"}. Whatever the route ends at, it is not healing anything.`,
            };
          }
          // Back to the anchor, not to wherever the recording happened to
          // stop -- so the next trip starts from the same place this one did.
          home = asPlace(route.tiles[0]);
        } else {
          return { keys: towards(out.key) | BTN.B };
        }
      }

      // Hurt enough to be worth the trip, and there is a way to make it.
      // Hurt, spent, or knocked out. `needsHeal` on its own is enough: a
      // party at full HP with no PP left has nothing wrong that HP can show,
      // and a Centre fixes it all the same.
      if (canHeal && here && (needsHeal || (share < healBelowHp && !everyoneWhole(party)))) {
        needsHeal = false;
        walkStuck = 0;
        if (canPlan) {
          mode = "journey";
          tripKind = "heal";
          trip = drive(() => healTrip(world, { from: here }));
          return { keys: 0 };
        }
        mode = "toNurse";
        walk = follower(route, 0);
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
