// measure-grind.mjs — does the grind actually stay in the grass?
//
// "It wanders out of the grass" is a complaint about behaviour over minutes,
// which is the kind of thing a unit test cannot see and a person watching
// cannot quantify. So this counts: every tile the player stands on while
// seeking, what fraction of them are the patch it was put in, and how far it
// strays. Set NO_ATLAS=1 to run the same save against the old leash instead,
// which is the comparison that settled the question.
//
//   GBA_ROM=... GBA_SAV=... node gba/tools/autoplay/measure-grind.mjs
//   GBA_ROM=... GBA_SAV=... NO_ATLAS=1 node gba/tools/autoplay/measure-grind.mjs
//
// Frames spent on a trip to a Centre are excluded on purpose: leaving the map
// is what a heal trip is for, and counting it as wandering measures nothing.
import { readFileSync } from "node:fs";
import * as m from "./machine.mjs";
import { runner } from "../../../apps/gba/src/policy.js";
import { world } from "../../../apps/gba/src/world.js";

const W = world(JSON.parse(readFileSync(new URL("../../../apps/gba/assets/world.json", import.meta.url))), new Uint8Array(readFileSync(new URL("../../../apps/gba/assets/world.bin", import.meta.url))));
const machine = await m.boot({ rom: process.env.GBA_ROM, save: process.env.GBA_SAV });
m.resume(machine);
for (let i = 0; i < 90; i++) machine.step(0);

const at0 = machine.look().position;
const patch = W.grassPatch(at0.map.mapGroup, at0.map.mapNum, at0);
console.log(`start ${at0.map.mapGroup}/${at0.map.mapNum} (${at0.x},${at0.y}) | patch ${patch.tiles.size} tiles`);

const USE_ATLAS = process.env.NO_ATLAS !== "1";
const run = runner(
  { slot: 0, stopAtLevel: 99, healBelowHp: 0.5, fleeBelowHp: 0.2, stopBelowHp: 0.05 },
  null,
  USE_ATLAS ? W : null
);
const seen = new Map();
let frames = 0, offPatch = 0, offMap = 0, maxDist = 0, seekFrames = 0;
const LIMIT = 60 * 60 * 6;
while (frames < LIMIT) {
  const out = run.step({
    frame: frames++, party: machine.look().party, inBattle: machine.look().inBattle,
    battle: machine.look().battle, position: machine.look().position,
  });
  if (out.done) { console.log("STOPPED:", out.reason); break; }
  machine.step(out.keys);
  const p = machine.look().position;
  if (!p || machine.look().inBattle) continue;
  // Only the seeking counts. A heal trip leaves the map on purpose, and
  // counting its frames as wandering measures the wrong thing entirely.
  if (run.mode !== "grind") { offMap++; continue; }
  if (p.map.mapNum !== at0.map.mapNum || p.map.mapGroup !== at0.map.mapGroup) { offMap++; continue; }
  seekFrames++;
  const k = `${p.x},${p.y}`;
  seen.set(k, (seen.get(k) || 0) + 1);
  if (!patch.has(p.x, p.y)) offPatch++;
  maxDist = Math.max(maxDist, Math.abs(p.x - at0.x) + Math.abs(p.y - at0.y));
}
let onGrass = 0, total = 0;
for (const [k, n] of seen) { total += n; if (patch.has(...k.split(",").map(Number))) onGrass += n; }
console.log(`${USE_ATLAS ? "WITH atlas" : "WITHOUT atlas (old leash)"}: ${frames} frames, ${run.battles} battles`);
console.log(`  distinct tiles stood on: ${seen.size}`);
console.log(`  frames on grass: ${((100 * onGrass) / total).toFixed(1)}%   off-patch frames: ${offPatch}   frames not seeking (trips): ${offMap}`);
console.log(`  furthest from the start tile: ${maxDist} tiles`);
// Battles per minute of play, with trip time taken out. Per *seeking* frame
// is the tempting denominator and a useless one: most of the clock is spent
// inside battles, so it reports a rate nobody experiences.
const playing = (frames - offMap) / 3600;
console.log(`  ${(run.battles / playing).toFixed(1)} battles per minute of play (${playing.toFixed(1)} min, trips excluded)`);
