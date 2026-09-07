// Checks for recorded routes.
//
// A route is the alternative to modelling the world: the player walks the way
// to the Pokémon Center once, and the trail they leave is a path that is
// walkable by construction. What has to be right is the following — warps,
// a round trip that crosses the same map twice, and knowing when it is lost
// rather than pressing hopefully into a wall.
//
// Run: node apps/gba/checks/route-checks.mjs

import { recorder, follower, usable } from "../src/route.js";
import { BTN } from "../src/buttons.js";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const at = (x, y, mapNum = 24, mapGroup = 3) => ({ x, y, map: { mapGroup, mapNum } });
const hurt = [{ hp: 4, maxHp: 34 }, { hp: 20, maxHp: 40 }];
const whole = [{ hp: 34, maxHp: 34 }, { hp: 40, maxHp: 40 }];

// -- recording ---------------------------------------------------------------
{
  const rec = recorder();
  // Walking south down Route 6 towards Vermilion, healing, and coming back.
  for (let y = 22; y >= 19; y--) rec.sample(at(20, y), hurt, BTN.UP);
  rec.sample(at(15, 7, 5), hurt, BTN.UP); // through the warp into Vermilion
  rec.sample(at(15, 8, 5), hurt, BTN.DOWN);
  rec.sample(at(15, 8, 5), whole, BTN.DOWN); // the nurse: hurt to whole on this tile
  rec.sample(at(15, 7, 5), whole, BTN.UP);
  for (let y = 19; y <= 22; y++) rec.sample(at(20, y), whole, BTN.DOWN);
  const route = rec.stop();

  check("a walk is recorded", route !== null && route.tiles.length === 11, route && `${route.tiles.length} tiles`);
  check("standing still does not add waypoints", route && route.tiles.filter((t) => t.x === 15 && t.y === 8).length === 1);
  check(
    "the nurse is found by watching the party, not by being told",
    route && route.healAt >= 0 && route.tiles[route.healAt].mapNum === 5 && route.tiles[route.healAt].y === 8,
    route && `healAt ${route.healAt}`
  );
  check("and the route is usable", usable(route));
}

{
  // A party already whole never goes from hurt to whole, so nothing is
  // marked -- and a route with no observed heal is not usable.
  const rec = recorder();
  for (let y = 22; y >= 19; y--) rec.sample(at(20, y), whole);
  const route = rec.stop();
  check("a walk with no heal in it is refused", route !== null && !usable(route), route && `healAt ${route.healAt}`);
  check("and a walk of one tile is nothing at all", recorder().stop() === null);
}

// -- following ---------------------------------------------------------------
const build = () => {
  const rec = recorder();
  for (let y = 22; y >= 19; y--) rec.sample(at(20, y), hurt, BTN.UP);
  rec.sample(at(15, 7, 5), hurt, BTN.UP);
  rec.sample(at(15, 8, 5), hurt, BTN.DOWN);
  rec.sample(at(15, 8, 5), whole, BTN.DOWN);
  rec.sample(at(15, 7, 5), whole, BTN.UP);
  for (let y = 19; y <= 22; y++) rec.sample(at(20, y), whole, BTN.DOWN);
  return rec.stop();
};

{
  const route = build();
  const walk = follower(route);
  const first = walk.step(at(20, 22));
  check("from the start it heads for the next tile", first.key && first.key.dy === -1 && first.key.dx === 0);

  // Standing a few tiles off the route's start -- which is where the leash
  // leaves the player. It walks back to the start rather than joining at the
  // nearest point: the recorded path is only guaranteed walkable from its
  // beginning, and the leash keeps that walk to a few tiles.
  const off = follower(route).step(at(20, 20));
  check(
    "started off the route, it heads for the route's beginning",
    off.key && off.key.dy === 2 && off.index === 0,
    "not the nearest waypoint: only the recorded path is known to be walkable"
  );
}

{
  // The warp. Route 6 (20,19) is the last tile before Vermilion; the next
  // waypoint is on another map entirely, and the follower has to notice it
  // arrived rather than press hopefully at a map it is not on.
  const route = build();
  const walk = follower(route);
  walk.step(at(20, 22));
  const after = walk.step(at(15, 7, 5));
  check(
    "a warp is followed by finding where the route is on the new map",
    after.key && after.key.dy === 1 && !after.lost,
    "arrived in Vermilion, next waypoint is one south"
  );

  // Standing on the last tile before the door. There is no arithmetic
  // between two maps, so this has to be the direction a person used.
  const doorway = follower(route);
  // Walked tile by tile, because the follower only advances off tiles it has
  // actually stood on -- skipping two would have it walk back for them.
  let through = null;
  for (let y = 22; y >= 19; y--) through = doorway.step(at(20, y));
  check(
    "at a warp it presses the direction that was walked, not a difference",
    through.key && through.key.dir === BTN.UP && !through.lost,
    "positions alone cannot say which way a door was entered"
  );
}

{
  // The round trip crosses Route 6 twice, and the second crossing is the one
  // that matters: a search from the start of the route would match the
  // outbound leg and send it back to the beginning. Walked tile by tile,
  // because teleporting between waypoints is not what following looks like.
  const route = build();
  const walk = follower(route);
  let home = null;
  for (const tile of route.tiles) {
    home = walk.step(at(tile.x, tile.y, tile.mapNum, tile.mapGroup));
    // Stop on the return leg's first Route 6 tile -- the ambiguous one.
    if (walk.index > 6 && tile.mapNum === 24) break;
  }
  check(
    "coming back onto a map it already crossed, it does not restart",
    walk.index > 6,
    `index ${walk.index} of ${walk.length}, which is the way home rather than the way out`
  );
}

{
  // Walk the recorded tiles in the order they were recorded, which is what
  // following one actually looks like.
  const route = build();
  const walk = follower(route);
  let last = null;
  for (const tile of route.tiles) {
    last = walk.step({ x: tile.x, y: tile.y, map: { mapGroup: tile.mapGroup, mapNum: tile.mapNum } });
  }
  check(
    "walking the recorded tiles in order reaches the end",
    last && last.arrived === true && !last.lost,
    `index ${walk.index}/${walk.length}`
  );
}

{
  // Somewhere the route never went. Being lost is a thing to report, not a
  // direction to guess at.
  const route = build();
  const walk = follower(route);
  const lost = walk.step(at(4, 4, 99));
  check("a map the route never touched reports lost", lost.lost === true && lost.key === 0);
}

{
  check("no position yields no direction", follower(build()).step(null).key === 0);
  check("an empty route is not usable", usable({ tiles: [], healAt: 0 }) === false);
  check("nor is one with no heal", usable({ tiles: [1, 2], healAt: -1 }) === false);
  check("nor nothing at all", usable(null) === false);
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
