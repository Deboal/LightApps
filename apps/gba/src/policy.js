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
export function runner(policy) {
  const { slot = 0, stopAtLevel = 100, fleeBelowHp = 0.34, stopBelowHp = 0.15 } = policy || {};

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

  return {
    get phase() {
      return phase;
    },
    get battles() {
      return battles;
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
      if (mon.fainted) {
        return { keys: 0, done: true, reason: `${mon.name} fainted.` };
      }
      if (mon.level >= stopAtLevel) {
        return { keys: 0, done: true, reason: `${mon.name} reached level ${mon.level}.` };
      }
      if (share < stopBelowHp) {
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
        if (share < fleeBelowHp) fleeing = 1;
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
        // Otherwise: A advances the text, picks FIGHT, and picks the first
        // move, which is all this needs to be able to do.
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
