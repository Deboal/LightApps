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
 * What identifies a Pokémon across a party that keeps moving.
 *
 * Not the slot: the first thing a run does is put its target in front, which
 * reorders the party for real, so the slot a run started with belongs to
 * somebody else within a minute. Every bug in this project's last month has
 * been some version of indexing a list that reorders underneath.
 *
 * Not the name either, and not the level, the species or the max HP:
 *
 *  - names are not unique, and this player's party has held two Pokémon of
 *    one species at once;
 *  - level and max HP change every time the thing being trained does the
 *    thing it was asked to do, so an identity built on them stops matching at
 *    exactly the wrong moment;
 *  - species changes on evolution, which is the *goal* of a lot of these runs.
 *
 * `personality` and `otId` are the two words Gen 3 encrypts the record with.
 * They are fixed for the life of a Pokémon and survive levelling, evolving,
 * renaming and being moved around. That is the key.
 */
const keyOf = (mon) => {
  const record = mon && mon.record;
  if (!record || record.personality === undefined || record.otId === undefined) return null;
  return `${record.personality >>> 0}/${record.otId >>> 0}`;
};

/** Whether two party reads are the same animal. */
export function sameMon(a, b) {
  const key = keyOf(a);
  if (key === null || key !== keyOf(b)) return false;
  // A clone -- same personality, same trainer -- is possible: this player has
  // a CHARIZARD and a CHARMELEON sharing 2003283047, almost certainly from a
  // trade. Species separates them right up until the CHARMELEON evolves, at
  // which point nothing in memory tells them apart and neither can this.
  const one = a.record.species;
  const two = b.record.species;
  return one === undefined || two === undefined || one === two;
}

/**
 * Where the Pokémon being trained is *now*.
 *
 * `fallback` is what to answer when the question cannot be: an unreadable
 * party, a record that did not decode this frame, a Pokémon that has left.
 * Answering zero instead would quietly retarget the run onto whoever leads,
 * which is how one asked to train a CLEFAIRY declared victory over a PIKACHU.
 */
export function slotOfMon(party, want, fallback = 0) {
  if (!party || !want) return fallback;
  const key = keyOf(want);
  if (key === null) {
    // The record did not decode. A name is all that is left and it is not an
    // identity, so this is a guess and is treated as one: it is only taken
    // when the fallback has nothing better to offer.
    const byName = party.findIndex((mon) => mon.name === want.name);
    return byName < 0 ? fallback : byName;
  }
  const hits = [];
  party.forEach((mon, at) => {
    if (keyOf(mon) === key) hits.push(at);
  });
  if (hits.length === 0) return fallback;
  if (hits.length === 1) return hits[0];
  // Two with the same key. Prefer the one that is also the same species, and
  // failing that stay where we were rather than jumping to the other.
  const species = hits.find((at) => party[at].record.species === want.record.species);
  if (species !== undefined) return species;
  return hits.includes(fallback) ? fallback : hits[0];
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
      return { action: "retry", attempt, reason, slot: slotOfMon(party, want, fallbackSlot) };
    },
  };
}
