// maps.mjs — the game's own map data, used for getting somewhere.
//
// Greedy walking works in a town and fails on a route: press south against a
// line of trees and you press south forever. The fix is not a cleverer
// heuristic, it is knowing where the walls are — and the game's maps are
// right there in the pokefirered project, as a grid of sixteen-bit cells per
// layout.
//
// Each cell packs a metatile id, a collision field and an elevation. Only the
// collision matters here: zero is walkable, anything else is not. That is
// enough for a breadth-first search, and breadth-first is enough for a route.
//
// What this deliberately does not model: ledges (one-way), NPCs (they move),
// and warps (they teleport). So a path from here is a proposal, and the
// walker checks every step against the player's actual tile — a path that
// turns out to be wrong shows up as a step that did not happen, not as a
// player wedged against a hedge for an hour.

import { readFileSync } from "node:fs";

const COLLISION = 0x0c00;
const METATILE = 0x03ff;
const BEHAVIOR = 0x1ff;
/** Metatiles below this id come from the layout's primary tileset. */
const PRIMARY_COUNT = 640;

/** Behaviours that a walking Pokémon trainer cannot cross.
 *
 *  Collision alone is not enough, and the gap is water: a pond has collision
 *  zero, because Surf is supposed to work there, and the game refuses the step
 *  on the behaviour instead. A path planned on collision alone walks the
 *  player confidently into a lake and waits. */
const WATER = new Set([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x22]);
/** Tall grass, where wild Pokémon are. */
export const GRASS = new Set([0x02, 0x03]);

/** Where a pokefirered checkout lives. */
export const PRET = process.env.PRET || "/home/user/pret/pokefirered";

const layouts = JSON.parse(readFileSync(`${PRET}/data/layouts/layouts.json`, "utf8")).layouts;

const tilesetDir = (name) => {
  const slug = name.replace(/^gTileset_/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  for (const kind of ["primary", "secondary"]) {
    const path = `${PRET}/data/tilesets/${kind}/${slug}/metatile_attributes.bin`;
    try {
      return readFileSync(path);
    } catch {
      // try the other kind
    }
  }
  return null;
};

/**
 * One map's walkability and terrain, by layout id ("LAYOUT_ROUTE6").
 *
 * Two sources, because one is not enough. The layout's block data gives a
 * collision bit per cell; the tilesets give each metatile a *behaviour*, and
 * that is where water lives. A grid built on collision alone says a pond is
 * walkable, which is true only for a Pokémon that knows Surf.
 */
export function grid(layoutId) {
  const layout = layouts.find((l) => l && l.id === layoutId);
  if (!layout) throw new Error(`no layout ${layoutId}`);
  const blocks = readFileSync(`${PRET}/${layout.blockdata_filepath}`);
  const primary = tilesetDir(layout.primary_tileset);
  const secondary = layout.secondary_tileset ? tilesetDir(layout.secondary_tileset) : null;
  const { width, height } = layout;

  const behaviourOf = (metatile) => {
    const from = metatile < PRIMARY_COUNT ? primary : secondary;
    const index = metatile < PRIMARY_COUNT ? metatile : metatile - PRIMARY_COUNT;
    if (!from || (index + 1) * 4 > from.length) return 0;
    return from.readUInt32LE(index * 4) & BEHAVIOR;
  };

  const open = new Uint8Array(width * height);
  const grass = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const cell = blocks.readUInt16LE(i * 2);
    const behaviour = behaviourOf(cell & METATILE);
    open[i] = (cell & COLLISION) === 0 && !WATER.has(behaviour) ? 1 : 0;
    grass[i] = GRASS.has(behaviour) ? 1 : 0;
  }
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  return {
    id: layoutId,
    width,
    height,
    open,
    grass,
    at: (x, y) => (inside(x, y) ? open[y * width + x] === 1 : false),
    isGrass: (x, y) => (inside(x, y) ? grass[y * width + x] === 1 : false),
  };
}

/**
 * A shortest walk from one tile to another, as a list of tiles.
 *
 * Breadth-first, so the path is the fewest steps, which is also the fewest
 * chances for something to be standing in the way.
 */
export function path(map, from, to) {
  const found = pathToAny(map, from, [to]);
  return found ? found.tiles : null;
}

/**
 * The shortest walk to whichever of several tiles is closest — and, more to
 * the point, to one that can actually be reached.
 *
 * Picking the nearest edge tile by straight-line distance is wrong in a way
 * that looks right: Route 6's bottom-left corner is open ground, two tiles
 * from where the player stands, and walled off from it entirely. The way out
 * is a corridor nine tiles east. Only a search knows that.
 */
export function pathToAny(map, from, targets) {
  const start = from.y * map.width + from.x;
  const goals = new Map();
  for (const t of targets) {
    if (map.at(t.x, t.y)) goals.set(t.y * map.width + t.x, t);
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
      if (!map.at(nx, ny)) continue;
      const next = ny * map.width + nx;
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

function unusedPath(map, from, to) {
  const start = from.y * map.width + from.x;
  const goal = to.y * map.width + to.x;
  if (!map.at(to.x, to.y)) return null;
  const came = new Int32Array(map.width * map.height).fill(-1);
  const queue = [start];
  came[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (at === goal) break;
    const x = at % map.width;
    const y = (at / map.width) | 0;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.at(nx, ny)) continue;
      const next = ny * map.width + nx;
      if (came[next] !== -1) continue;
      came[next] = at;
      queue.push(next);
    }
  }
  if (came[goal] === -1) return null;
  const out = [];
  for (let at = goal; at !== start; at = came[at]) {
    out.push({ x: at % map.width, y: (at / map.width) | 0 });
  }
  return out.reverse();
}

/** The map a group/number pair refers to, as a layout id. */
export function layoutOf(mapGroup, mapNum) {
  const groups = JSON.parse(readFileSync(`${PRET}/data/maps/map_groups.json`, "utf8"));
  const groupName = groups.group_order[mapGroup];
  const mapName = groups[groupName][mapNum];
  const map = JSON.parse(readFileSync(`${PRET}/data/maps/${mapName}/map.json`, "utf8"));
  return { name: mapName, layout: map.layout, json: map };
}
