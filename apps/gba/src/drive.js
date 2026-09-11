// drive.js — writing "walk there, then heal, then walk back" as a straight line.
//
// The runner in `policy.js` is a per-frame function: hand it the party and the
// tile and it answers with a button mask. That shape is forced by where it
// runs — inside a requestAnimationFrame loop that cannot block — and it is
// fine for a policy that only ever grinds, because grinding is a small state
// machine.
//
// It is the wrong shape for a trip. The headless harness that levelled a
// Charmeleon into a Charizard writes a journey the way a person would describe
// it: walk to the edge, step off, re-plan, walk to the door, go in, talk to
// the nurse until the party is whole, walk back out. That is ordinary
// imperative code with loops and early returns, and rewriting it as a flat
// state machine loses the thing that made it correct — you can read it and see
// that every press is checked.
//
// Generators are the bridge, and they are the whole reason this file exists.
// A journey is a `function*`; where the harness wrote
//
//     machine.step(BTN.UP); const state = machine.look();
//
// the journey writes
//
//     const state = yield BTN.UP;
//
// and gets back the state of the machine after that frame. The driver below
// turns such a generator into exactly the `step(state) -> { keys, done }`
// interface the frame loop already speaks. Nothing blocks, nothing is
// rewritten as a state machine, and `yield*` lets one journey call another the
// way the harness called functions.

/**
 * Run a journey generator one frame at a time.
 *
 * The contract is one line: a journey yields the buttons to hold for a frame
 * and receives the state that resulted. Returning from the generator ends the
 * journey, and whatever it returns is the outcome.
 */
export function drive(journey, { budget = 20 * 60 * 60 } = {}) {
  const steps = typeof journey === "function" ? journey() : journey;
  let started = false;
  let done = false;
  let result = null;
  let frames = 0;

  return {
    get done() {
      return done;
    },
    get result() {
      return result;
    },
    /** Matches the runner's interface, so this can stand where it stands. */
    step(state) {
      if (done) return { keys: 0, done: true, result };
      // A journey that never finishes is a tab pressing buttons at a game
      // nobody is watching. The budget is generous -- an hour at sixty frames
      // -- and its job is to be a stop rather than a limit.
      if (++frames > budget) {
        done = true;
        result = { ok: false, reason: "the journey ran out of time" };
        return { keys: 0, done: true, result };
      }
      // The first `next` cannot deliver a state: nothing is waiting on a
      // yield yet. It runs the journey up to its first press instead, which
      // costs exactly one frame of latency and keeps the contract honest --
      // every state a journey sees is the state *after* the press it asked
      // for.
      const out = started ? steps.next(state) : ((started = true), steps.next());
      if (out.done) {
        done = true;
        result = out.value === undefined ? { ok: true } : out.value;
        return { keys: 0, done: true, result };
      }
      return { keys: (out.value | 0) >>> 0, done: false };
    },
    /** Abandon the journey. Generators clean up through `finally`. */
    stop(reason = "stopped") {
      if (!done) {
        done = true;
        result = { ok: false, reason };
        if (steps.return) steps.return();
      }
      return result;
    },
  };
}

// ---- the small vocabulary every journey is written in ---------------------

/** Hold buttons for a number of frames; the last state seen comes back. */
export function* hold(keys, frames) {
  let state = null;
  for (let i = 0; i < frames; i++) state = yield keys;
  return state;
}

/** Hold nothing, which is how you let the game get on with something. */
export const settle = (frames) => hold(0, frames);

/**
 * One press, then a pause.
 *
 * Menus in these games ignore a button that was already down on the previous
 * frame, so a "press" is a few frames held and then released. The pause after
 * it is not politeness — it is the window in which the menu actually changes,
 * and reading before it has is how a script convinces itself nothing happened.
 */
export function* tap(keys, { press = 4, then = 30 } = {}) {
  yield* hold(keys, press);
  return yield* hold(0, then);
}

/**
 * Press a button in a rhythm rather than continuously.
 *
 * Advancing text needs the button to go down, come up, and go down again.
 * Holding A through a conversation advances exactly one box and then waits
 * forever, which reads on screen as a frozen game.
 */
export function beat(frame, { on = 4, cycle = 12 } = {}) {
  return frame % cycle < on;
}
