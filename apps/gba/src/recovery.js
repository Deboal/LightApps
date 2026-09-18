// recovery.js — what to do when a run stops.
//
// This is four lines of logic and it lives in its own file for one reason:
// the last time it existed it was written twice, once in `play.mjs` and once
// in a React callback, and the two did different things. The command line
// picked a stopped run back up; the tab ended the night. That gap is most of
// why the two behaved so differently, and it was invisible because the React
// half could not be checked -- logic inside a component is logic nobody tests.
//
// So both callers use this, and this is checked.

/**
 * Where the Pokémon being trained is *now*.
 *
 * Not a constant, and not the slot the run was started with. The first thing
 * a run does is put its target in front, which reorders the party for real --
 * so by the time anything goes wrong, the original slot belongs to somebody
 * else. Handing that number to the next attempt trains whoever inherited it:
 * told to train a CHARMELEON, an earlier version recovered from a stop by
 * promoting a PIKACHU and grinding that instead.
 *
 * By name, because that is what survives the reorder. Falls back to the
 * original slot when the party cannot be read, which is the only answer that
 * is not a guess.
 */
export function slotOf(party, name, fallback = 0) {
  if (!party || !name) return fallback;
  const at = party.findIndex((mon) => mon.name === name);
  return at < 0 ? fallback : at;
}

/**
 * How many times a run picks itself back up before it gives up.
 *
 * Three, because the second attempt is worth a lot and the fourth is worth
 * nothing: a stop that survives three fresh starts is a situation rather than
 * a stumble, and the right answer to a situation is to say so instead of
 * prodding an unattended cartridge all night.
 */
export const TRIES = 3;

/**
 * The decision, and the count of how often it has been made.
 *
 * `after` is handed the stop the runner produced and the party as it reads
 * now, and answers with "retry" or "stop". It does not restart anything
 * itself -- the two callers restart very differently, one by building a
 * runner and one by setting React state, and the part worth sharing is the
 * judgement rather than the plumbing.
 */
export function recovery({ tries = TRIES } = {}) {
  let attempt = 0;
  const stops = [];

  return {
    get attempt() {
      return attempt;
    },
    /** Every stop picked back up from, in order, for saying what was tried. */
    get stops() {
      return stops.slice();
    },
    after(stop, { party = null, want = null, fallbackSlot = 0 } = {}) {
      const reason = (stop && stop.reason) || "Stopped.";
      // `final` is the runner saying this one must not be retried: the level
      // was reached, or the party cannot survive another attempt. Honouring it
      // is the difference between a run that finishes and a white-out.
      if (stop && stop.final) return { action: "stop", reason, final: true };
      if (attempt >= tries) return { action: "stop", reason, exhausted: true };

      attempt += 1;
      stops.push(reason);
      return { action: "retry", attempt, reason, slot: slotOf(party, want, fallbackSlot) };
    },
  };
}
