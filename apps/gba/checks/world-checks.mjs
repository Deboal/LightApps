// Checks for the atlas — the map data the player navigates by.
//
// Two kinds of thing are worth checking here and they fail differently. The
// pathfinding is ordinary code and is checked against hand-built grids where
// the right answer is obvious by inspection. The generated data is not code:
// it is an assertion about Kanto, and the only way to check it is against
// facts established somewhere else. So the values below were taken from the
// run that levelled a Charmeleon into a Charizard — tiles that were actually
// stood on, a Centre that was actually walked to — and if the generator ever
// starts producing a different Kanto, these say so.
//
// Run: node apps/gba/checks/world-checks.mjs

import { readFileSync } from "node:fs";
import { world, path, pathToAny, edgeTiles, DIR } from "../src/world.js";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const here = new URL(".", import.meta.url);
const W = world(
  JSON.parse(readFileSync(new URL("../assets/world.json", here))),
  new Uint8Array(readFileSync(new URL("../assets/world.bin", here)))
);

// -- pathfinding, on grids where the answer is visible ------------------------
{
  // #####
  // #...#   a straight corridor
  // #####
  const open = (x, y) => y === 1 && x >= 1 && x <= 3;
  const map = { width: 5, height: 3, at: open, isGrass: () => false };
  const tiles = path(map, { x: 1, y: 1 }, { x: 3, y: 1 });
  check("a straight corridor is walked in a straight line", tiles && tiles.length === 2,
    tiles ? `${tiles.length} steps` : "no path");

  check("a wall is not walked through", path(map, { x: 1, y: 1 }, { x: 1, y: 0 }) === null);
}
{
  // Two open pockets with no join. The nearest tile by distance is in the
  // wrong one, which is the mistake that sent a walk into a corner of Route 6
  // it could not get out of.
  const map = {
    width: 7, height: 3,
    at: (x, y) => y === 1 && (x === 0 || x === 1 || x === 4 || x === 5 || x === 6),
    isGrass: () => false,
  };
  const found = pathToAny(map, { x: 5, y: 1 }, [{ x: 4, y: 1 }, { x: 0, y: 1 }]);
  check("an unreachable target is passed over for a reachable one",
    found && found.target.x === 4, found ? `chose ${found.target.x}` : "no path");
  check("a walled-off tile alone has no path",
    pathToAny(map, { x: 5, y: 1 }, [{ x: 0, y: 1 }]) === null);
}
{
  // A door is a wall to route around and a destination to step onto, and
  // which one it is depends only on whether it is being aimed at.
  const map = { width: 3, height: 3, at: (x, y) => !(x === 1 && y === 1), isGrass: () => false };
  const blocked = new Set(["1,0"]);
  check("a blocked tile is entered when it is the goal",
    path(map, { x: 0, y: 0 }, { x: 1, y: 0 }, { blocked }) !== null);
  check("a blocked tile is routed around when it is not",
    (path(map, { x: 0, y: 0 }, { x: 2, y: 0 }, { blocked }) || []).length > 2);
}
{
  const map = { width: 4, height: 3, at: () => true, isGrass: () => false };
  check("the bottom edge is the bottom row", edgeTiles(map, DIR.DOWN).every((t) => t.y === 2));
  check("the right edge is the last column", edgeTiles(map, DIR.RIGHT).every((t) => t.x === 3));
  check("an edge is as long as the side it is on", edgeTiles(map, DIR.LEFT).length === 3);
}

// -- the generated data, against a run that actually happened -----------------
check("the atlas is for FireRed and LeafGreen and nothing else",
  W.covers("BPRE") && W.covers("BPRG") && !W.covers("BPEE"));

{
  const route6 = W.gridOf(3, 24);
  check("map 3/24 is Route 6", route6 && route6.name === "Route6", route6 && route6.name);
  // (4,21) is where the Charizard save is standing; (3,18) is where the grind
  // ran. Both were tall grass in the game, so both must be tall grass here.
  check("the tiles the grind ran on are grass",
    route6.isGrass(3, 18) && route6.isGrass(4, 21));
  check("Route 6 has grass worth standing in", W.grassOn(3, 24).length > 100,
    `${W.grassOn(3, 24).length} tiles`);
  check("the chosen grind spot is itself grass",
    (() => { const s = W.grindSpot(3, 24); return s && route6.isGrass(s.x, s.y); })());
}
{
  // The Centre the run actually used, found without being told.
  const found = W.nearestCentre({ mapGroup: 3, mapNum: 24 });
  check("the nearest Centre to Route 6 is Vermilion's",
    found && found.inside.name === "VermilionCity_PokemonCenter_1F", found && found.inside.name);
  check("its door is the tile the run walked to",
    found && found.door.mapGroup === 3 && found.door.mapNum === 5 &&
      found.door.x === 15 && found.door.y === 6,
    found && `${found.door.x},${found.door.y}`);
  check("it is one map crossing away", found && found.hops.length === 1);
}
{
  const hops = W.mapRoute({ mapGroup: 3, mapNum: 24 }, { mapGroup: 3, mapNum: 5 });
  check("Route 6 joins Vermilion by walking off an edge",
    hops && hops.length === 1 && hops[0].via.kind === "edge", hops && hops[0].via.kind);
  check("a map is no distance from itself",
    (W.mapRoute({ mapGroup: 3, mapNum: 5 }, { mapGroup: 3, mapNum: 5 }) || []).length === 0);
  check("a map that does not exist has no route",
    W.mapRoute({ mapGroup: 3, mapNum: 24 }, { mapGroup: 99, mapNum: 99 }) === null);
}
{
  const far = W.mapRoute({ mapGroup: 3, mapNum: 24 }, { mapGroup: 3, mapNum: 2 });
  check("Pewter is reachable from Route 6 across many maps", far && far.length > 3,
    far ? `${far.length} hops` : "no route");
}
{
  const places = W.placesNear({ mapGroup: 3, mapNum: 24 });
  check("the places offered start where the player is standing",
    places.length > 0 && places[0].name === "Route6", places[0] && places[0].name);
  check("every place offered has a Centre it can reach",
    places.every((p) => p.centre !== null));
  check("every place offered has grass in it", places.every((p) => p.tiles >= 8));
  check("nowhere indoors is offered as a place to grind",
    places.every((p) => !W.mapAt(p.mapGroup, p.mapNum).in));
}
{
  // Both halves of the rule that cost a live run: a door is solid terrain and
  // must still be reachable when it is the destination, and a wall must not be.
  const outside = W.gridOf(3, 5);
  check("a Pokémon Center door is solid ground", !outside.at(15, 6));
  check("and is reachable anyway when it is where you are going",
    path(outside, { x: 15, y: 9 }, { x: 15, y: 6 }, { enterGoal: true }) !== null);
  check("while a wall next to it stays unreachable",
    path(outside, { x: 15, y: 9 }, { x: 14, y: 6 }) === null);
  check("every Center door in the game is solid, so this is the rule not the exception",
    W.meta.centres.every((c) => {
      const o = W.meta.maps[c.outside];
      const g = W.gridOf(o.g, o.n);
      return !g || !g.at(c.door[0], c.door[1]);
    }));
}
{
  check("every Pokémon Center's door is outdoors",
    W.meta.centres.every((c) => !W.meta.maps[c.outside].in));
  check("all nineteen Centers are found", W.meta.centres.length === 19, `${W.meta.centres.length}`);
  // The counter is solid; the tile below it is where you stand and talk.
  const inside = W.gridOf(9, 1);
  check("a Center's counter is solid and the tile below it is not",
    inside && !inside.at(7, 3) && inside.at(7, 4));
}
{
  // Water has collision zero because Surf is meant to work there. A grid that
  // reads collision alone calls a pond walkable and plans confidently into it.
  const vermilion = W.gridOf(3, 5);
  check("the sea south of Vermilion is not walkable",
    vermilion && !vermilion.at(vermilion.width - 2, vermilion.height - 2));
}
{
  const doors = W.doorsOf(3, 5);
  check("Vermilion's doors are known, and the Centre's is among them",
    doors.has("15,6"), `${doors.size} doors`);
}

// -- the grass patch, which is what a grind is confined to --------------------
{
  const from = { x: 4, y: 21 };            // where the Charizard save stands
  const patch = W.grassPatch(3, 24, from);
  check("a patch is found from a tile in the grass", patch && patch.tiles.size > 20,
    patch ? `${patch.tiles.size} tiles` : "none");
  check("every tile in the patch is grass",
    [...patch.tiles].every((k) => {
      const [x, y] = k.split(",").map(Number);
      return W.gridOf(3, 24).isGrass(x, y);
    }));
  check("the patch is the reachable part, not all the grass on the map",
    patch.tiles.size < W.grassOn(3, 24).length,
    `${patch.tiles.size} of ${W.grassOn(3, 24).length}`);

  // The measurement behind replacing the leash: a four-tile box around the
  // grind tile is mostly not grass, so a walk obeying it still drifts out.
  let box = 0;
  let inside = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      box++;
      if (patch.has(from.x + dx, from.y + dy)) inside++;
    }
  }
  check("the old four-tile leash box was mostly not grass", inside / box < 0.5,
    `${inside} of ${box} tiles, ${Math.round((100 * inside) / box)}%`);

  // Route 6's grass comes in separate patches. A leash cannot tell them
  // apart; a flood fill can, and must.
  const other = W.grassPatch(3, 24, { x: 12, y: 30 });
  check("a separate patch of grass is a separate patch",
    other && other.tiles.size !== patch.tiles.size && !patch.has(other.seed.x, other.seed.y),
    other ? `${other.tiles.size} vs ${patch.tiles.size}` : "none");

  // Set going from the path beside the grass, it should still find the patch.
  const beside = W.grassPatch(3, 24, { x: 8, y: 21 });
  check("a run started off the grass still finds the patch beside it",
    beside && beside.tiles.size > 0 && W.gridOf(3, 24).isGrass(beside.seed.x, beside.seed.y));

  check("a map with no grass has no patch", W.grassPatch(9, 1, { x: 7, y: 5 }) === null);
}

// -- the nurse, read rather than assumed --------------------------------------
{
  check("every Centre knows where its nurse is", W.meta.centres.every((c) => c.nurse));
  check("the inside of a Centre knows which Centre it is",
    (() => { const c = W.centreInside(9, 1); return !!(c && c.nurse); })());
  check("a route is not the inside of a Pokémon Center", W.centreInside(3, 24) === null);

  // The tile to stand on is the nearest walkable one below her, and it must
  // exist everywhere -- otherwise the walk arrives and finds a wall.
  const stands = W.meta.centres.map((c) => {
    const m = W.meta.maps[c.map];
    const g = W.gridOf(m.g, m.n);
    const [nx, ny] = c.nurse;
    for (let d = 1; d <= 4; d++) if (g && g.at(nx, ny + d)) return { name: m.name, x: nx, y: ny + d };
    return { name: m.name, x: null, y: null };
  });
  check("every nurse can be stood in front of", stands.every((s) => s.x !== null),
    stands.filter((s) => s.x === null).map((s) => s.name).join(", "));
  // And the reason this is derived at all: two Centres are not at (7,4).
  const odd = stands.filter((s) => !(s.x === 7 && s.y === 4));
  check("and two of them are not where the old constant said", odd.length === 2,
    odd.map((s) => `${s.name} ${s.x},${s.y}`).join("; "));
}

console.log(failures === 0 ? "\nall good" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
