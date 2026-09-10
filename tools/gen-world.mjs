// gen-world.mjs — turn a pokefirered checkout into two files the app can carry.
//
// The app's player used to navigate by a route the player had walked for it
// and a four-tile leash, because a browser bundle had no idea where the walls
// were. The walls are not a secret: they are in the decompilation, as a grid
// of sixteen-bit cells per layout, and the whole of Kanto compresses to less
// than a tenth of the bundle already being shipped.
//
// Two outputs, deliberately not one. `world.bin` is the tile data, two bits
// per tile, which is a shape no JSON can hold cheaply. `world.json` is
// everything else -- which map is which, where the doors lead, which edges
// join -- and that stays legible so a wrong answer can be read rather than
// disassembled.
//
//   node tools/gen-world.mjs [path-to-pokefirered]
//
// The output is committed. Netlify does not have a pokefirered checkout and
// should not need one; this runs when the data needs regenerating, which is
// approximately never.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const PRET = process.argv[2] || process.env.PRET || "/home/user/pret/pokefirered";
const OUT = new URL("../apps/gba/assets/", import.meta.url);

const COLLISION = 0x0c00;
const METATILE = 0x03ff;
const BEHAVIOR = 0x1ff;
/** Metatiles below this id come from the layout's primary tileset. */
const PRIMARY_COUNT = 640;

/** Behaviours a walking trainer cannot cross. Collision alone is not enough:
 *  a pond has collision zero, because Surf is meant to work there, and the
 *  game refuses the step on the behaviour instead. */
const WATER = new Set([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x22]);
/** Tall grass, where the wild Pokémon are. */
const GRASS = new Set([0x02, 0x03]);

const read = (p) => readFileSync(`${PRET}/${p}`);
const readJson = (p) => JSON.parse(read(p).toString("utf8"));

const tilesetAttrs = (() => {
  const cache = new Map();
  return (name) => {
    if (!name) return null;
    if (cache.has(name)) return cache.get(name);
    const slug = name.replace(/^gTileset_/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    let found = null;
    for (const kind of ["primary", "secondary"]) {
      try {
        found = read(`data/tilesets/${kind}/${slug}/metatile_attributes.bin`);
        break;
      } catch {
        // the other kind, or neither
      }
    }
    cache.set(name, found);
    return found;
  };
})();

// ---- layouts: two bits a tile, walkable and grass -------------------------

const layoutsJson = readJson("data/layouts/layouts.json").layouts.filter(Boolean);
const layouts = [];
const layoutIndex = new Map();
const blobs = [];
let offset = 0;
const skipped = [];

for (const layout of layoutsJson) {
  let blocks;
  try {
    blocks = read(layout.blockdata_filepath);
  } catch {
    skipped.push([layout.id, "no blockdata"]);
    continue;
  }
  const primary = tilesetAttrs(layout.primary_tileset);
  const secondary = tilesetAttrs(layout.secondary_tileset);
  if (!primary) {
    // Without behaviours the water is invisible, and a grid that calls a lake
    // walkable is worse than no grid: it produces a confident plan into it.
    skipped.push([layout.id, `no tileset ${layout.primary_tileset}`]);
    continue;
  }
  const { width, height } = layout;
  const count = width * height;
  const packed = Buffer.alloc(Math.ceil(count / 4));

  const behaviourOf = (metatile) => {
    const from = metatile < PRIMARY_COUNT ? primary : secondary;
    const at = metatile < PRIMARY_COUNT ? metatile : metatile - PRIMARY_COUNT;
    if (!from || (at + 1) * 4 > from.length) return 0;
    return from.readUInt32LE(at * 4) & BEHAVIOR;
  };

  for (let i = 0; i < count; i++) {
    const cell = blocks.readUInt16LE(i * 2);
    const behaviour = behaviourOf(cell & METATILE);
    const open = (cell & COLLISION) === 0 && !WATER.has(behaviour);
    const grass = GRASS.has(behaviour);
    packed[i >> 2] |= ((open ? 1 : 0) | (grass ? 2 : 0)) << ((i & 3) * 2);
  }

  layoutIndex.set(layout.id, layouts.length);
  layouts.push({ id: layout.id, w: width, h: height, at: offset });
  blobs.push(packed);
  offset += packed.length;
}

const bin = Buffer.concat(blobs);

// ---- maps: who is where, which doors lead where, which edges join ---------

const groups = readJson("data/maps/map_groups.json");
const maps = [];
const mapIndex = new Map();

for (const [group, name] of groups.group_order.entries()) {
  for (const [num, mapName] of groups[name].entries()) {
    let json;
    try {
      json = readJson(`data/maps/${mapName}/map.json`);
    } catch {
      continue;
    }
    mapIndex.set(json.id, maps.length);
    maps.push({ g: group, n: num, name: mapName, id: json.id, json });
  }
}

const DIRS = { down: 0, up: 1, left: 2, right: 3 };

const out = {
  version: 1,
  // Which cartridges these maps describe. FireRed and LeafGreen share them;
  // nothing else does, and a policy that walks Emerald with Kanto's walls
  // would be confidently, invisibly wrong.
  games: ["BPRE", "BPRG"],
  bin: { tiles: bin.length },
  layouts: layouts.map((l) => ({ id: l.id, w: l.w, h: l.h, at: l.at })),
  maps: maps.map((m) => ({
    g: m.g,
    n: m.n,
    name: m.name,
    l: layoutIndex.has(m.json.layout) ? layoutIndex.get(m.json.layout) : -1,
    // Indoor maps have no connections and their own rules; worth knowing.
    in: m.json.map_type === "MAP_TYPE_INDOOR" ? 1 : 0,
    w: (m.json.warp_events || []).map((w) => [
      w.x,
      w.y,
      mapIndex.has(w.dest_map) ? mapIndex.get(w.dest_map) : -1,
      Number(w.dest_warp_id) || 0,
    ]),
    c: (m.json.connections || [])
      .filter((c) => DIRS[c.direction] !== undefined && mapIndex.has(c.map))
      .map((c) => [DIRS[c.direction], c.offset, mapIndex.get(c.map)]),
  })),
};

// Pokémon Centers, and the tile outside each one's door.
//
// This is the piece that retires the recorded route. A heal used to require
// the player to walk the trip once so it could be replayed; with the warp
// graph the app can work out where the nearest Center is and how to get in.
out.centres = out.maps
  .map((m, i) => ({ m, i }))
  .filter(({ m }) => /PokemonCenter_1F$/.test(m.name))
  .map(({ m, i }) => {
    // The way out is the warp that leads somewhere outdoors. Its destination
    // warp on that map is the door as seen from the street, which is the tile
    // to walk to and step onto.
    for (const [, , dest, id] of m.w) {
      if (dest < 0) continue;
      const outside = out.maps[dest];
      if (outside.in) continue; // the 2F stairs
      const door = outside.w[id];
      if (!door) continue;
      return { map: i, outside: dest, door: [door[0], door[1]] };
    }
    return null;
  })
  .filter(Boolean);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("world.bin", OUT), bin);
const json = JSON.stringify(out);
writeFileSync(new URL("world.json", OUT), json);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`layouts ${layouts.length} (${skipped.length} skipped), maps ${maps.length}, centres ${out.centres.length}`);
console.log(`world.bin  ${kb(bin.length)} raw, ${kb(gzipSync(bin, { level: 9 }).length)} gzipped`);
console.log(`world.json ${kb(json.length)} raw, ${kb(gzipSync(Buffer.from(json), { level: 9 }).length)} gzipped`);
if (skipped.length) console.log("skipped:", skipped.slice(0, 6).map((s) => s.join(" — ")).join("; "));
