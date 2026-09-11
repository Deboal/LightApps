// world.js — where the walls are, in the browser.
//
// The player used to navigate by a route someone had walked for it and a
// four-tile leash around the spot it started on. That is all it could do: a
// static page has no map, so "walk to the Pokémon Center" was not a thing it
// could be asked. `tools/gen-world.mjs` turns the decompilation's own layout
// data into two files small enough to ship (about 28 KB over the wire, against
// a bundle already four hundred), and this reads them.
//
// Three things are modelled and one deliberately is not. Walkability, tall
// grass, and how maps join — by an edge you walk off or a door you step on.
// Not modelled: ledges, which are one-way, and people, who move. So every
// plan out of here is a proposal, and the thing walking it checks each step
// against the player's actual tile. That split is the whole design; it is why
// a wrong plan shows up as a step that did not happen rather than as a player
// wedged against a hedge for an hour.

/** Which way you leave a map to reach the one connected on that side. */
export const DIR = { DOWN: 0, UP: 1, LEFT: 2, RIGHT: 3 };

const OPEN = 1;
const GRASS = 2;

/**
 * Read the two files into something with methods.
 *
 * `fetch` is injected so this is testable without a browser — the checks run
 * it against the real generated files off disk.
 */
export async function loadWorld(base = "assets/world", { fetch: get = fetch } = {}) {
  const [meta, bin] = await Promise.all([
    get(`${base}.json`).then((r) => {
      if (!r.ok) throw new Error(`world.json: ${r.status}`);
      return r.json();
    }),
    get(`${base}.bin`).then((r) => {
      if (!r.ok) throw new Error(`world.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  return world(meta, new Uint8Array(bin));
}

/** The same thing, from data already in hand. */
export function world(meta, tiles) {
  const byLocation = new Map();
  meta.maps.forEach((m, i) => byLocation.set(m.g * 1000 + m.n, i));

  /** Whether these maps describe the cartridge that is running. */
  const covers = (code) => meta.games.includes(code);

  const indexOf = (mapGroup, mapNum) => {
    const found = byLocation.get(mapGroup * 1000 + mapNum);
    return found === undefined ? -1 : found;
  };

  const grids = new Map();
  /**
   * One map's walkability, unpacked on first use.
   *
   * Two bits a tile in the file; a byte a tile here. Unpacking every layout up
   * front would cost a quarter of a megabyte for the ninety-nine per cent of
   * Kanto a given run never visits, so this does it per map and keeps it.
   */
  const gridOf = (mapGroup, mapNum) => {
    const index = indexOf(mapGroup, mapNum);
    if (index < 0) return null;
    if (grids.has(index)) return grids.get(index);
    const map = meta.maps[index];
    const layout = meta.layouts[map.l];
    if (!layout) {
      grids.set(index, null);
      return null;
    }
    const { w: width, h: height, at } = layout;
    const open = new Uint8Array(width * height);
    const grass = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const packed = (tiles[at + (i >> 2)] >> ((i & 3) * 2)) & 3;
      open[i] = packed & OPEN ? 1 : 0;
      grass[i] = packed & GRASS ? 1 : 0;
    }
    const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
    const made = {
      index,
      name: map.name,
      width,
      height,
      indoor: !!map.in,
      at: (x, y) => (inside(x, y) ? open[y * width + x] === 1 : false),
      isGrass: (x, y) => (inside(x, y) ? grass[y * width + x] === 1 : false),
    };
    grids.set(index, made);
    return made;
  };

  const mapAt = (mapGroup, mapNum) => {
    const index = indexOf(mapGroup, mapNum);
    return index < 0 ? null : meta.maps[index];
  };
  const place = (index) => {
    const m = meta.maps[index];
    return m ? { mapGroup: m.g, mapNum: m.n, name: m.name } : null;
  };

  /**
   * How to get from one map to another, as a list of hops.
   *
   * Breadth-first over the map graph, where an edge is either a connection —
   * walk off that side — or a warp, which is a door to stand on. Tiles are
   * deliberately not planned here: each hop is planned from where the player
   * actually lands, because the honest answer to "did the walk go as
   * expected" is only available after walking it.
   */
  const mapRoute = (fromMap, toMap) => {
    const start = indexOf(fromMap.mapGroup, fromMap.mapNum);
    const goal = indexOf(toMap.mapGroup, toMap.mapNum);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [];

    const came = new Map([[start, null]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      if (at === goal) break;
      for (const step of exitsOf(at)) {
        if (came.has(step.to)) continue;
        came.set(step.to, { from: at, step });
        queue.push(step.to);
      }
    }
    if (!came.has(goal)) return null;

    const hops = [];
    for (let at = goal; came.get(at); at = came.get(at).from) {
      const { from, step } = came.get(at);
      hops.push({ from: place(from), to: place(at), via: step.via });
    }
    return hops.reverse();
  };

  const exitsOf = (index) => {
    const map = meta.maps[index];
    const out = [];
    for (const [dir, , to] of map.c) out.push({ to, via: { kind: "edge", dir } });
    for (const [x, y, to] of map.w) {
      if (to >= 0) out.push({ to, via: { kind: "warp", x, y } });
    }
    return out;
  };

  /** Every warp tile on a map, which the walker treats as a wall unless it is
   *  the one being aimed at — a path across town otherwise routes through
   *  somebody's front door and the next plan starts in their kitchen. */
  const doorsOf = (mapGroup, mapNum) => {
    const map = mapAt(mapGroup, mapNum);
    return new Set((map ? map.w : []).map(([x, y]) => `${x},${y}`));
  };

  /** The Pokémon Center nearest a place, by hops rather than by distance. */
  const nearestCentre = (from) => {
    const start = indexOf(from.mapGroup, from.mapNum);
    if (start < 0) return null;
    let best = null;
    for (const centre of meta.centres) {
      const outside = place(centre.outside);
      const hops = mapRoute(from, outside);
      if (!hops) continue;
      if (!best || hops.length < best.hops.length) {
        best = {
          hops,
          door: { ...outside, x: centre.door[0], y: centre.door[1] },
          inside: place(centre.map),
        };
      }
    }
    return best;
  };

  /**
   * The patch of tall grass a tile belongs to, as a set of "x,y".
   *
   * This is what a grind should be confined to, and the reason the leash it
   * replaces was never right: a leash is a square box around one anchor tile,
   * and grass is not square. Four tiles in every direction from the middle of
   * Route 6 includes the path, the ledge and the trainer standing on it, so a
   * walk that respects the leash perfectly still wanders steadily out of the
   * grass -- which is exactly what it did.
   *
   * Flood-filled over walkable grass, so it is the reachable patch rather
   * than every grass tile on the map: the grass across a river is not
   * somewhere this walk can get to, and including it would make "am I still
   * in my patch" answer yes from the wrong side of the water.
   */
  const grassPatch = (mapGroup, mapNum, from, { limit = 4000 } = {}) => {
    const grid = gridOf(mapGroup, mapNum);
    if (!grid) return null;
    const isPatch = (x, y) => grid.at(x, y) && grid.isGrass(x, y);

    // Start from `from` if it is grass, otherwise the nearest grass tile that
    // is: a run set going from the path beside the grass should still get the
    // patch it is plainly meant to work.
    let seed = isPatch(from.x, from.y) ? { x: from.x, y: from.y } : null;
    if (!seed) {
      const near = pathToAny(grid, from, grassOn(mapGroup, mapNum));
      if (!near) return null;
      seed = near.target;
    }

    const patch = new Set([`${seed.x},${seed.y}`]);
    const queue = [seed];
    for (let head = 0; head < queue.length && patch.size < limit; head++) {
      const { x, y } = queue[head];
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (patch.has(key) || !isPatch(nx, ny)) continue;
        patch.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    return { seed, tiles: patch, has: (x, y) => patch.has(`${x},${y}`) };
  };

  /** The Pokémon Center whose inside this map is, if it is one. */
  const centreInside = (mapGroup, mapNum) => {
    const index = indexOf(mapGroup, mapNum);
    if (index < 0) return null;
    return meta.centres.find((c) => c.map === index) || null;
  };

  /** Grass on this map, as tiles — where a grind can actually happen. */
  const grassOn = (mapGroup, mapNum) => {
    const grid = gridOf(mapGroup, mapNum);
    if (!grid) return [];
    const out = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) if (grid.isGrass(x, y)) out.push({ x, y });
    }
    return out;
  };

  /**
   * Places with tall grass the player could walk to, nearest first.
   *
   * This is what gets handed to the model when it is asked where to grind.
   * Without it the choice is made on whatever the model remembers about the
   * games, which is not the same thing as what is next door to the player --
   * and the walk to a Pokémon Center is the other half of the decision, so
   * each place carries how far its own nearest Centre is.
   */
  const placesNear = (from, { within = 3, limit = 12 } = {}) => {
    const start = indexOf(from.mapGroup, from.mapNum);
    if (start < 0) return [];
    const seen = new Map([[start, 0]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      const depth = seen.get(at);
      if (depth >= within) continue;
      for (const step of exitsOf(at)) {
        if (seen.has(step.to)) continue;
        seen.set(step.to, depth + 1);
        queue.push(step.to);
      }
    }
    const out = [];
    for (const [index, hops] of seen) {
      const m = meta.maps[index];
      if (m.in) continue; // no wild grass indoors
      const grass = grassOn(m.g, m.n);
      if (grass.length < 8) continue; // a stray tile is not a place to grind
      const centre = nearestCentre({ mapGroup: m.g, mapNum: m.n });
      out.push({
        name: m.name,
        mapGroup: m.g,
        mapNum: m.n,
        hops,
        tiles: grass.length,
        centre: centre ? centre.hops.length : null,
      });
    }
    // Somewhere with no reachable Centre is somewhere a run cannot recover
    // from, so it is not offered.
    return out.filter((p) => p.centre !== null).sort((a, b) => a.hops - b.hops).slice(0, limit);
  };

  /** The tile to stand on to grind a named map: the middle of its largest
   *  patch of grass, so the leash has grass on every side of it. */
  const grindSpot = (mapGroup, mapNum) => {
    const grass = grassOn(mapGroup, mapNum);
    if (grass.length === 0) return null;
    // The tile with the most grass around it, which is the middle of the
    // biggest patch without having to find the patches.
    const has = new Set(grass.map((t) => `${t.x},${t.y}`));
    let best = null;
    for (const t of grass) {
      let near = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) if (has.has(`${t.x + dx},${t.y + dy}`)) near++;
      }
      if (!best || near > best.near) best = { ...t, near };
    }
    return best ? { mapGroup, mapNum, x: best.x, y: best.y } : null;
  };

  return {
    meta, covers, mapAt, gridOf, mapRoute, doorsOf, nearestCentre,
    grassOn, place, indexOf, placesNear, grindSpot, grassPatch, centreInside,
  };
}

/**
 * The shortest walk to whichever of several tiles is closest — and, more to
 * the point, to one that can actually be reached.
 *
 * Picking the nearest candidate by straight-line distance is wrong in a way
 * that looks right: Route 6's bottom-left corner is open ground two tiles from
 * where the player stands and walled off from it entirely, and the way out is
 * a corridor nine tiles east. Only a search knows that.
 */
export function pathToAny(map, from, targets, { blocked = null, enterGoal = false } = {}) {
  // Two different kinds of "cannot go there", and conflating them plans a
  // path into a tree. The grid's own answer is terrain and is final. The
  // `blocked` overlay is doors and people -- things that are impassable on
  // the way past and are exactly where you are going when they are the goal.
  // So a goal may override the overlay and may never override the terrain.
  const terrain = (x, y) => map.at(x, y);
  const overlay = (x, y) => !(blocked && blocked.has(`${x},${y}`));
  const start = from.y * map.width + from.x;
  const goals = new Map();
  for (const t of targets) {
    if (t.x < 0 || t.y < 0 || t.x >= map.width || t.y >= map.height) continue;
    // A wall is not a destination -- but a door is, and every Pokémon Center
    // door in the game is a solid tile. The game warps you as you walk into
    // it; the collision bit never permits the step. So terrain rules out a
    // goal unless the caller says this goal is a warp.
    if (!enterGoal && !terrain(t.x, t.y)) continue;
    goals.set(t.y * map.width + t.x, t);
  }
  if (goals.size === 0) return null;

  const came = new Int32Array(map.width * map.height).fill(-1);
  const queue = [start];
  came[start] = start;
  let goal = -1;
  for (let head = 0; head < queue.length && goal === -1; head++) {
    const at = queue[head];
    if (goals.has(at)) { goal = at; break; }
    const x = at % map.width;
    const y = (at / map.width) | 0;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      const next = ny * map.width + nx;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (!terrain(nx, ny) && !(enterGoal && goals.has(next))) continue;
      // Past the overlay only if this is where we are going: a door is a wall
      // to walk around and the destination to step onto, and which one it is
      // depends only on whether it is being aimed at.
      if (!overlay(nx, ny) && !goals.has(next)) continue;
      if (came[next] !== -1) continue;
      came[next] = at;
      queue.push(next);
    }
  }
  if (goal === -1) return null;
  const tiles = [];
  for (let at = goal; at !== start; at = came[at]) {
    tiles.push({ x: at % map.width, y: (at / map.width) | 0 });
  }
  return { tiles: tiles.reverse(), target: goals.get(goal) };
}

/** A shortest walk from one tile to another. */
export function path(map, from, to, options) {
  const found = pathToAny(map, from, [to], options);
  return found ? found.tiles : null;
}

/** Every open tile along the side of a map you would walk off to reach the
 *  map connected there. */
export function edgeTiles(map, dir) {
  const out = [];
  if (dir === DIR.DOWN || dir === DIR.UP) {
    const y = dir === DIR.DOWN ? map.height - 1 : 0;
    for (let x = 0; x < map.width; x++) out.push({ x, y });
  } else {
    const x = dir === DIR.RIGHT ? map.width - 1 : 0;
    for (let y = 0; y < map.height; y++) out.push({ x, y });
  }
  return out;
}
