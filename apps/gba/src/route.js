// route.js — a path the player walked, and how to walk it again.
//
// The alternative was a world map: read the map headers out of the ROM, model
// collision, connections, warps and ledges, and pathfind. That is weeks of
// work whose failure mode is walking confidently into a wall. A recorded
// route is minutes of work whose failure mode is "stuck at waypoint 7", and
// the path is *guaranteed* walkable because a person walked it.
//
// Waypoints are recorded on every tile change, so consecutive ones are always
// adjacent and the direction to press is arithmetic rather than a search.
//
// Warps are the exception, and the reason each waypoint also records the
// direction that was held when the player left it. A door is triggered by
// stepping onto it, and a recording of *positions* cannot say which way that
// step went: the tile before the warp and the tile after it are on different
// maps, with no arithmetic between them. So on the same map the follower does
// the arithmetic, and across a warp it presses the direction that worked when
// a person walked it.
//
// The heal point is not marked by hand: while recording, the party is watched
// and the tile where it gained the most HP is where the nurse is. That is a
// deliberately loose rule. The first version demanded the party go from "not
// all full" to "all full", which is exactly right and useless in practice --
// walk to the Centre already healthy and the nurse heals nothing, so there is
// no edge to see and the recording silently never marks anything. Watching
// for the largest gain works whether the party was half hurt or nearly dead,
// and still only marks something that was actually observed to happen.
//
// `markHere` is the override for when even that finds nothing.

/** Two readings on the same tile of the same map. */
const same = (a, b) =>
  a && b && a.x === b.x && a.y === b.y && a.mapGroup === b.mapGroup && a.mapNum === b.mapNum;

const sameMap = (a, b) => a && b && a.mapGroup === b.mapGroup && a.mapNum === b.mapNum;

const point = (position) => ({
  mapGroup: position.map.mapGroup,
  mapNum: position.map.mapNum,
  x: position.x,
  y: position.y,
  // Filled in when the player leaves this tile, so it is the direction that
  // actually worked from here -- including the one that opened a door.
  dir: 0,
});

const totalHp = (party) =>
  Array.isArray(party) && party.length > 0
    ? party.reduce((sum, mon) => sum + mon.hp, 0)
    : null;

const allFull = (party) =>
  Array.isArray(party) && party.length > 0 && party.every((mon) => mon.hp === mon.maxHp);

/**
 * Record a walk.
 *
 * Feed it a position and a party each frame; it keeps the tiles and notices
 * the heal. `stop()` returns the route, or null if nothing worth keeping was
 * walked.
 */
export function recorder() {
  const tiles = [];
  // HP gained per tile. A nurse fills the bars over a couple of seconds and
  // the player stands still for it, so the gain accumulates on one tile.
  const gains = new Map();
  let marked = -1;
  let lastTotal = null;
  let lastFull = null;
  let held = 0;

  return {
    get length() {
      return tiles.length;
    },
    get healed() {
      return this.healAt >= 0;
    },
    /** The tile with the largest gain, or whichever one was marked by hand. */
    get healAt() {
      if (marked >= 0) return marked;
      let best = -1;
      let most = 0;
      for (const [index, gained] of gains) {
        if (gained > most) {
          most = gained;
          best = index;
        }
      }
      return best;
    },
    /** How much was healed there — shown while recording, so "no heal yet"
     *  can be told apart from "healed 63". */
    get gained() {
      return gains.get(this.healAt) || 0;
    },
    /** Whether the party is currently untouched, which is the usual reason
     *  nothing gets marked: a full party has nothing for a nurse to do. */
    get full() {
      return lastFull === true;
    },
    /** Whether the walk has come back to the map it began on, after healing.
     *  Shown while recording so a missing return leg is visible before Done
     *  rather than discovered from inside a Pokémon Center. */
    get returned() {
      const healAt = this.healAt;
      return (
        healAt >= 0 &&
        healAt < tiles.length - 1 &&
        sameMap(tiles[0], tiles[tiles.length - 1])
      );
    },

    /** Mark the tile underfoot as the nurse, for when watching finds nothing
     *  -- a party that was already whole, most likely. */
    markHere() {
      marked = tiles.length - 1;
    },

    sample(position, party, keys = 0) {
      if (!position) return;
      // The tile the player was standing on when HP was last read. Any gain
      // measured now accrued *there*, not on whichever tile this sample may
      // be about to step onto -- which matters because the follower stops at
      // the marked tile, and being one past a nurse is as bad as one short.
      const wasAt = Math.max(0, tiles.length - 1);
      const here = point(position);
      if (!same(here, tiles[tiles.length - 1])) {
        // The direction held on the frame the tile changed is the one that
        // left the previous tile. Recorded there, not here.
        const previous = tiles[tiles.length - 1];
        if (previous && held) previous.dir = held;
        tiles.push(here);
      }
      if (keys) held = keys;

      // The nurse, found by watching rather than by being told: HP going up
      // is the only thing a counter does, and the tile it goes up most on is
      // where the counter is.
      const total = totalHp(party);
      if (total !== null) {
        if (lastTotal !== null && total > lastTotal) {
          gains.set(wasAt, (gains.get(wasAt) || 0) + (total - lastTotal));
        }
        lastTotal = total;
        lastFull = allFull(party);
      }
    },

    stop() {
      if (tiles.length < 2) return null;
      return { tiles, healAt: this.healAt };
    },
  };
}

/** How long to press into the same tile before calling a route blocked. NPCs
 *  wander into doorways and wander out again, so this is patient — several
 *  seconds — where the grind's own stuck detector is not. */
export const ROUTE_STUCK = 240;

/**
 * Walk a recorded route.
 *
 * `step(here)` takes a position and answers `{ key, index, arrived, lost }`.
 * It holds no clock: the caller decides how often to press, and the caller
 * counts how long a tile has gone unchanged.
 */
export function follower(route, from = 0) {
  let index = from;

  return {
    get index() {
      return index;
    },
    get length() {
      return route.tiles.length;
    },

    step(here) {
      if (!here) return { key: 0, index, arrived: false, lost: false };
      const now = point(here);

      // Advance past every waypoint already stood on. Walking is faster than
      // this is sampled, so more than one can fall behind in a single step.
      const advance = () => {
        while (index < route.tiles.length && same(now, route.tiles[index])) index++;
      };
      advance();
      if (index >= route.tiles.length) return { key: 0, index, arrived: true, lost: false };

      // Close enough to the end is the end. Requiring the final tile exactly
      // makes arriving hinge on landing on one square, and a walk that
      // overshoots by one would press towards it forever.
      const last = route.tiles[route.tiles.length - 1];
      if (
        index >= route.tiles.length - 2 &&
        sameMap(now, last) &&
        Math.abs(now.x - last.x) + Math.abs(now.y - last.y) <= 1
      ) {
        return { key: 0, index: route.tiles.length, arrived: true, lost: false };
      }

      const aim = () => {
        const target = route.tiles[index];
        return { key: { dx: target.x - now.x, dy: target.y - now.y }, index, arrived: false, lost: false };
      };
      if (sameMap(now, route.tiles[index])) return aim();

      // The next waypoint is on another map, which means one of two things,
      // and telling them apart is the whole of this function's subtlety.
      //
      // Standing on the tile the route left through: the warp has not fired
      // yet, and there is no arithmetic between two maps, so press the
      // direction that worked when a person walked it. This holds frame after
      // frame while the step completes -- which is why it is checked before
      // the search below. Searching first would see "wrong map", find this
      // same map later in a round trip, and jump to the way home.
      const behind = route.tiles[index - 1];
      if (behind && sameMap(now, behind)) {
        if (!behind.dir) return { key: 0, index, arrived: false, lost: true };
        return { key: { dir: behind.dir }, index, arrived: false, lost: false };
      }

      // Otherwise this is somewhere the route did not expect. Look forward
      // only: a round trip crosses the same map twice, and searching from the
      // start would send it back to the beginning.
      const ahead = route.tiles.findIndex((tile, at) => at >= index && sameMap(tile, now));
      if (ahead < 0) return { key: 0, index, arrived: false, lost: true };
      index = ahead;
      // Having jumped, the tile underfoot may itself be a waypoint -- landing
      // squarely on one is the usual case after a warp -- so advance again
      // before working out a direction, or it would aim at where it stands.
      advance();
      if (index >= route.tiles.length) return { key: 0, index, arrived: true, lost: false };
      if (!sameMap(now, route.tiles[index])) return { key: 0, index, arrived: false, lost: true };
      return aim();
    },
  };
}

/** Whether a route is worth acting on.
 *
 *  Three things, and the third is the one that was missing: a walk, a heal
 *  that was actually observed, and *a way back*. A recording that stops at
 *  the counter has no return leg, so following it leaves the player standing
 *  in a Pokémon Center with the grind anchor a building away — which is
 *  exactly what "it does not take me back" looks like.
 *
 *  Ending on the map it started on is the test. It is not perfect — you could
 *  end up on the right map in the wrong place — but it cannot be passed by
 *  pressing Done at the nurse, which is the mistake that is easy to make. */
export function usable(route) {
  if (!route || !Array.isArray(route.tiles) || route.tiles.length < 2) return false;
  if (!(route.healAt >= 0)) return false;
  return returns(route);
}

/** Whether the walk came back to the map it set out from, after the heal. */
export function returns(route) {
  if (!route || !Array.isArray(route.tiles) || route.tiles.length < 2) return false;
  if (!(route.healAt >= 0) || route.healAt >= route.tiles.length - 1) return false;
  return sameMap(route.tiles[0], route.tiles[route.tiles.length - 1]);
}
