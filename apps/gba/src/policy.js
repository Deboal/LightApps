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

/** Fights' worth of damage to keep in hand before setting off for a Centre.
 *
 *  Three rather than one, because the walk is not free: it has battles in it,
 *  and leaving at the point of actually needing a heal means arriving in worse
 *  shape than when the decision was made -- or not arriving. Three of the
 *  worst hits seen here is enough to survive the trip and a surprise on the
 *  way, and little enough that a Pokémon shrugging off everything on the route
 *  never goes at all. */
const FIGHTS_OF_MARGIN = 3;

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

/**
 * Whether this Pokémon has genuinely run out of moves to use.
 *
 * This exists because `bestMove` returns null for two unrelated reasons and
 * the caller cannot tell them apart: every move is out of PP, or the party
 * record did not decode on this frame. The second is not a fact about the
 * Pokémon at all -- the record is checksummed and read out of memory the
 * cartridge is writing to during a battle, so a torn read is ordinary and
 * transient.
 *
 * Conflating the two sent a Charizard at full HP and full PP to a Pokémon
 * Center every few battles: one frame in which the record failed its checksum
 * read as "nothing to fight with", which is a reason to leave. Measured at 49
 * such frames in six minutes, and four trips it explains exactly.
 *
 * A record that decoded has a valid checksum, so its PP figures are true.
 * Asking for the moves first is the whole guard.
 */
export const spent = (mon) => !!movesOf(mon) && !bestMove(mon);

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
  // The patch of grass this grind belongs in, worked out from the map once
  // the anchor is known. `patchAt` is the anchor it was computed for, so a
  // heal trip that comes back to a different tile recomputes rather than
  // keeping a patch from somewhere else.
  let patch = null;
  let patchAt = null;
  // The leg currently being walked inside the patch, and which tiles this
  // sweep has already aimed at. Cycling through four directions and turning
  // whenever the next step would leave the grass produces a walk that paces
  // one row of it forever -- measured on Route 6 as twenty-seven frames per
  // step against a walking step's sixteen, so nearly half the time was spent
  // turning on the spot inside a patch of fifty-one tiles it never saw most
  // of. Walking a planned leg to a chosen tile instead is smooth, covers the
  // patch, and takes more steps per minute, which is the only thing an
  // encounter rate depends on.
  let leg = null;
  let legAt = 0;
  let swept = new Set();
  let strays = 0;
  // Set when a battle is left because something is wrong with the Pokémon
  // that is out -- hurt, spent, or knocked out. Acted on once the battle is
  // over and there is somewhere to walk to.
  let needsHeal = false;
  // Why the next trip to a Centre was booked. Reported, because "it keeps
  // going back to the Pokemon Center" is a complaint nobody can act on: the
  // reasons are several, they look identical from outside, and the one that
  // mattered turned out twice to be something other than the obvious one.
  let healBecause = null;
  // The worst damage seen in a single battle, which is what "can I take
  // another fight" actually depends on. A fixed fraction of max HP cannot
  // know it: 80% is barely a scratch to something losing three HP a battle
  // and not nearly enough for something losing thirty.
  let worstHit = 0;
  let hpEnteringBattle = null;
  // Frames spent in a battle the target is healthy for and somebody else is
  // fighting. See the check on it below -- one frame means nothing.
  let wrongFighter = 0;
  // Frames spent in a battle with a controller pointer this build does not
  // recognise. Without the menus the runner can only mash A, and A takes the
  // first move -- which looks exactly like the move picker choosing badly.
  // Counting it means it can say so instead.
  let menuBlind = 0;
  let strangeFn = 0;
  let walk = null;
  let healTicks = 0;
  let walkStuck = 0;

  /**
   * A leg to walk inside the patch: a path to the furthest tile this sweep
   * has not aimed at yet.
   *
   * Furthest rather than nearest on purpose. Nearest gives a one-tile hop,
   * and a hop means a turn, and a turn costs eight frames in which no step is
   * taken; furthest gives a long straight-ish walk across the grass. Once
   * every tile has been a target the sweep starts over, so the whole patch
   * gets covered rather than one row of it.
   */
  const planLeg = (from) => {
    if (!patch) return null;
    const key = (x, y) => `${x},${y}`;
    const came = new Map([[key(from.x, from.y), null]]);
    const order = [{ x: from.x, y: from.y }];
    // Bounded by the patch's own size. The patch is a finite set of tiles, so
    // this is belt and braces -- but a flood fill that trusts someone else's
    // `has` is a flood fill that hangs the tab if that someone is ever wrong,
    // and a grind loop is not a place to find that out.
    const limit = (patch.tiles ? patch.tiles.size : 0) + 1;
    for (let head = 0; head < order.length && order.length <= limit; head++) {
      const at = order[head];
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = at.x + dx;
        const ny = at.y + dy;
        const k = key(nx, ny);
        if (came.has(k) || !patch.has(nx, ny)) continue;
        came.set(k, at);
        order.push({ x: nx, y: ny });
      }
    }
    // `order` is breadth-first, so the last reachable tile is the furthest.
    let target = null;
    for (let i = order.length - 1; i > 0 && !target; i--) {
      if (!swept.has(key(order[i].x, order[i].y))) target = order[i];
    }
    if (!target) {
      // Every tile has been a target; go round again.
      swept = new Set();
      target = order[order.length - 1];
    }
    if (!target || (target.x === from.x && target.y === from.y)) return null;
    swept.add(key(target.x, target.y));
    const tiles = [];
    for (let at = target; at && !(at.x === from.x && at.y === from.y); at = came.get(key(at.x, at.y))) {
      tiles.push(at);
    }
    return tiles.reverse();
  };

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
    /**
     * The patch of grass this grind is confined to, or null if it is walking
     * on the leash instead.
     *
     * Worth saying out loud rather than only in a log. The two produce very
     * different behaviour -- one stays in the grass, the other wanders out of
     * it -- and from the outside they are the same character walking around.
     * A screenshot of the wrong one is indistinguishable from a stale tab, and
     * that cost a round trip of "I cannot reproduce this".
     */
    /** Why the last trip to a Pokémon Center was made. "It keeps going back"
     *  is a complaint nobody can act on without this. */
    get healBecause() {
      return healBecause;
    },
    /** The hardest hit seen in a single battle here, which is what the
     *  decision to leave is actually measured against. */
    get worstHit() {
      return worstHit;
    },
    get confined() {
      return patch ? { tiles: patch.tiles.size, x: patch.seed.x, y: patch.seed.y } : null;
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

      // The Pokémon being trained has to be the one that fights, because only
      // the one that fights earns experience.
      //
      // Someone else being out is usually a faint -- the game sends out the
      // next one by itself -- and that is an errand, not a misconfiguration:
      // it books a trip to a Centre and carries on. What is a
      // misconfiguration is the target standing there perfectly healthy while
      // something else does the fighting, because nothing here can reorder a
      // party. Left alone that books a trip after every battle, forever, and
      // the target never gains a level.
      //
      // Two seconds of it before saying so. One frame is a torn read, and
      // ending a run on one of those is the mistake this file has already
      // made once.
      const out = state.inBattle && state.battle && Number.isInteger(state.battle.active)
        ? state.battle.active : null;
      if (out !== null && out !== slot && party[out] && mon.hp > 0 && !mon.fainted) {
        if (++wrongFighter > 120) {
          return {
            keys: 0,
            done: true,
            reason:
              `${mon.name} is in slot ${slot + 1}, but ${party[out].name} is the one ` +
              `fighting — and only the one that fights earns experience. Put ` +
              `${mon.name} first in your party and start again.`,
          };
        }
      } else {
        wrongFighter = 0;
      }
      const share = mon.maxHp ? mon.hp / mon.maxHp : 0;
      ticks++;

      // How hard the fights here actually hit, which is what "can I take
      // another one" depends on. Watched rather than assumed: HP on entering
      // a battle against HP on leaving it.
      if (state.inBattle) {
        if (hpEnteringBattle === null) hpEnteringBattle = mon.hp;
      } else if (hpEnteringBattle !== null) {
        worstHit = Math.max(worstHit, hpEnteringBattle - mon.hp);
        hpEnteringBattle = null;
      }

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
      if (spent(mon)) {
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
        // Why to be somewhere else, as a reason rather than a boolean. Being
        // hurt is not among them: that is a reason to go to a Centre, not to
        // stop, and a Centre restores PP as well as HP so running dry has the
        // same remedy as running low.
        const why =
          mode !== "grind" ? "the walk was interrupted"
            // `spent`, not `!bestMove`: an unreadable record is not an empty
            // one, and treating it as one is a trip to a Centre for nothing.
            : spent(fighter) ? "out of PP"
              : fighterShare < fleeBelowHp ? "too hurt to keep fighting"
                : activeSlot !== slot && canHeal
                  ? `${party[slot] ? party[slot].name : "it"} is not the one fighting`
                  : null;

        if (why) {
          if (canHeal) { needsHeal = true; healBecause = healBecause || why; }
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
        // With a map, walking back is just a walk -- the same one the trip to
        // a Pokémon Center makes, in the other direction. Stopping here used
        // to be the answer and it was indefensible once the map was loaded:
        // the reason it printed said, in as many words, that it could find its
        // way back and was not going to.
        //
        // A ledge is the usual culprit. They are one-way and are not modelled,
        // so the grass patch does not know that one of its tiles drops onto
        // the route below.
        if (canPlan) {
          if (++strays > 6) {
            return {
              keys: 0,
              done: true,
              reason:
                "Kept ending up off the map it was grinding on, six times over. " +
                "Something here puts the player somewhere else -- most likely a " +
                "ledge inside the patch -- and walking back into it would be a loop.",
            };
          }
          mode = "journey";
          tripKind = "travel";
          leg = null;
          trip = drive(() =>
            goTo(world, { ...home.map, x: home.x, y: home.y }, { hops: 8 })
          );
          return { keys: 0 };
        }
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
          if (was === "heal") { heals++; healBecause = null; }
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
          if (back && (back.fainted || spent(back))) {
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
      // Enough left to fight, or not.
      //
      // A fraction of max HP cannot answer that on its own: 80% is barely a
      // scratch to something losing three HP a battle, and nowhere near enough
      // for something losing thirty. So the test is whether what is left
      // covers a few more of the fights this place has actually been giving,
      // plus the walk, which has fights in it too. `healBelowHp` stays as the
      // floor underneath it, for the case where nothing has hit hard enough
      // yet to have been measured.
      const cannotTakeMore = worstHit > 0 && mon.hp <= worstHit * FIGHTS_OF_MARGIN;
      if (cannotTakeMore && !healBecause) healBecause = "not enough left for another fight";
      if (share < healBelowHp && !everyoneWhole(party) && !healBecause) healBecause = "hurt";
      if (canHeal && here && (needsHeal || cannotTakeMore || (share < healBelowHp && !everyoneWhole(party)))) {
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

      // Stay in the grass, which is not the same thing as staying near where
      // it started.
      //
      // The leash below is a square box around one anchor tile, and grass is
      // not square: four tiles in every direction from the middle of Route 6
      // is only about a third tall grass, and the rest is path, ledge and
      // trees. A walk that respected the leash perfectly still drifted
      // steadily out of the grass, because two thirds of what the leash
      // permitted was never grass at all. With the map loaded the patch
      // itself is knowable, so it is used instead of a radius.
      if (here && canPlan && home) {
        const anchor = `${home.map.mapGroup}/${home.map.mapNum}:${home.x},${home.y}`;
        if (patchAt !== anchor) {
          patchAt = anchor;
          patch = world.grassPatch(home.map.mapGroup, home.map.mapNum, home);
        }
        if (patch && !patch.has(here.x, here.y)) {
          // Already out of it. Walking back is a path, not a direction --
          // pressing one way hopefully is how it ended up here.
          mode = "journey";
          tripKind = "travel";
          trip = drive(() =>
            goTo(world, { ...home.map, x: patch.seed.x, y: patch.seed.y }, { hops: 4 })
          );
          return { keys: 0 };
        }
      }

      // Without a map, the leash is still the best available answer: head
      // back the moment the anchor is more than a few tiles away.
      if (here && home && !patch) {
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

      // Walk a leg of the patch. Every tile of the path is inside the grass by
      // construction, so there is no "would this step leave" test to fail and
      // no turning on the spot when it does -- the walk simply goes somewhere.
      if (patch && here) {
        // Something in the way. Drop the plan and make another; the tile that
        // stopped it stays marked as visited, so the next leg aims elsewhere.
        if (stuckFor >= STUCK) {
          leg = null;
          stuckFor = 0;
        }
        while (leg && legAt < leg.length && leg[legAt].x === here.x && leg[legAt].y === here.y) {
          legAt++;
        }
        if (!leg || legAt >= leg.length) {
          leg = planLeg(here);
          legAt = 0;
        }
        if (leg && legAt < leg.length) {
          const next = leg[legAt];
          // A battle can end with the player a tile off the plan. Re-planning
          // is cheaper than reasoning about where they went.
          if (Math.abs(next.x - here.x) + Math.abs(next.y - here.y) !== 1) {
            leg = null;
            return { keys: 0 };
          }
          const going =
            next.x > here.x ? BTN.RIGHT
              : next.x < here.x ? BTN.LEFT
                : next.y > here.y ? BTN.DOWN
                  : BTN.UP;
          // B is held the whole time: B is running, encounters are counted per
          // step, so this is close to twice the fights per minute for nothing --
          // and on a save without the Running Shoes it simply does nothing.
          return { keys: going | BTN.B };
        }
      }

      // Without a map there is no patch to walk, so this is the old answer:
      // pick a direction and hold it, turning at the end of a leg or the
      // moment the tile stops changing.
      if (sinceTurn >= LEG || stuckFor >= STUCK) {
        dir = (dir + 1) % DIRS.length;
        sinceTurn = 0;
        stuckFor = 0;
      }
      sinceTurn++;
      // What is deliberately absent is A: an A press in the overworld talks to
      // whoever is standing nearby, and this is meant to be left alone.
      return { keys: DIRS[dir] | BTN.B };
    },
  };
}
