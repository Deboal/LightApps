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
// The heal point is not marked by hand. While recording, the party is
// watched; the moment every member reads full, that tile is where the nurse
// is. The route therefore only records what was actually seen to work.

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
  let healAt = -1;
  let wasFull = null;
  let held = 0;

  return {
    get length() {
      return tiles.length;
    },
    get healed() {
      return healAt >= 0;
    },

    sample(position, party, keys = 0) {
      if (!position) return;
      const here = point(position);
      if (!same(here, tiles[tiles.length - 1])) {
        // The direction held on the frame the tile changed is the one that
        // left the previous tile. Recorded there, not here.
        const previous = tiles[tiles.length - 1];
        if (previous && held) previous.dir = held;
        tiles.push(here);
      }
      if (keys) held = keys;

      // The nurse, found by watching rather than by being told. The edge is
      // what matters: a party that was already full when recording started
      // never went from hurt to whole, so nothing is marked.
      const full = allFull(party);
      if (wasFull === false && full === true) healAt = tiles.length - 1;
      if (party) wasFull = full;
    },

    stop() {
      if (tiles.length < 2) return null;
      return { tiles, healAt };
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

/** Whether a route is worth acting on: long enough to be a walk, and with a
 *  heal in it that was actually observed. */
export function usable(route) {
  return !!route && Array.isArray(route.tiles) && route.tiles.length >= 2 && route.healAt >= 0;
}
