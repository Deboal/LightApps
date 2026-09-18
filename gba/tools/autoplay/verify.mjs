// verify.mjs — does this actually work, and how often?
//
// Every check in `apps/gba/checks/` answers a question about a part. None of
// them answers the only question a person actually has, which is: if I ask it
// to train a Pokémon, does that Pokémon end up trained?
//
// That gap is not academic. Every one of the last three releases passed every
// check and then failed in front of the person using it -- once by giving a
// Charizard a Moon Stone, once by pressing RIGHT at a move with no PP for a
// full minute, and once by announcing that a CLEFAIRY had reached level 20 on
// the strength of a PIKACHU that was already 38. A part can be right in every
// particular and the whole still not do the job.
//
// So this runs the whole job, several times, from several starting points, and
// prints how many worked. A number, not an anecdote.
//
//   GBA_ROM=X.gba GBA_SAV=Y.sav node gba/tools/autoplay/verify.mjs [--minutes 6]
//
// It needs a real cartridge and a real save and is therefore not part of the
// committed check suite, which must run anywhere. It is the thing to run
// before saying "this works".

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { boot, resume, BTN } from "./machine.mjs";
import { world } from "../../../apps/gba/src/world.js";
import { runner } from "../../../apps/gba/src/policy.js";
import { recovery, slotOfMon } from "../../../apps/gba/src/recovery.js";

const ROM = process.env.GBA_ROM;
const SAV = process.env.GBA_SAV;
if (!ROM || !SAV) {
  console.error("set GBA_ROM and GBA_SAV");
  process.exit(2);
}
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
// The budget is in *emulated frames*, not wall-clock minutes.
//
// Wall clock was the first version and it makes this tool lie: the emulator
// runs at whatever rate the machine can manage, so a verifier run with a
// browser suite running alongside it gets less game time for the same six
// minutes, and a scenario can flip from pass to fail because of what else was
// running. A number that moves with the load on the box is not a measurement.
//
// Frames are what the game experiences. Sixty a second, so the minutes people
// think in still convert, and the answer is the same on a busy machine as on
// an idle one -- it just takes longer to arrive.
// Twenty, because that is roughly what the old wall-clock six bought.
//
// Worth spelling out, because switching the unit and keeping the number
// silently cut every budget by three and a half and turned a 3-of-4 run into
// a 0-of-4 one that looked exactly like a regression. Six minutes of wall
// clock at three and a half times real time is twenty-one minutes of game.
// The unit is the game's now, so the number has to be the game's too.
const MINUTES = Number(arg("minutes", 20));
const FRAME_BUDGET = Math.round(MINUTES * 60 * 60);
const ONLY = arg("only", null);
const DUMPS = arg("dump", "/tmp/verify-dumps");
mkdirSync(DUMPS, { recursive: true });

const rom = readFileSync(ROM);
let code = "";
for (let i = 0; i < 4; i++) code += String.fromCharCode(rom[0xac + i]);

const assets = new URL("../../../apps/gba/assets/", import.meta.url);
const atlas = world(
  JSON.parse(readFileSync(new URL("world.json", assets), "utf8")),
  new Uint8Array(readFileSync(new URL("world.bin", assets)))
);

// One boot, then a save state. Every scenario starts from exactly the same
// moment, which is what makes the results comparable rather than anecdotal.
const machine = await boot({ rom: ROM, save: SAV, code });
console.log(
  `cartridge ${code} rev ${rom[0xbc]} — booting once, then replaying from that moment` +
  `\n${MINUTES} game-minutes a scenario (${FRAME_BUDGET} frames), so the result does not move with the load on the box\n`
);
resume(machine);
const START = machine.snapshot();
const startParty = machine.look().party;
if (!startParty) {
  console.error("the party is not readable after booting; is this save for this cartridge?");
  process.exit(2);
}
console.log(`party: ${startParty.map((m, i) => `${i + 1}:${m.name} L${m.level}`).join("  ")}\n`);

/**
 * One scenario, run to a verdict.
 *
 * The verdict is deliberately harsher than "the runner said ok". What is
 * checked is the *outcome*: did the Pokémon that was named gain the levels
 * that were asked for, and is the game left somewhere a person could carry on
 * from. A run that reports success with the party menu open has not succeeded,
 * and that exact combination is what was reported from a real session.
 */
async function scenario({ name, monName, levels }) {
  machine.restore(START);
  for (let i = 0; i < 30; i++) machine.step(0);

  const party = machine.look().party;
  const at = party.findIndex((m) => m.name === monName);
  if (at < 0) return { name, ok: false, why: `no ${monName} in the party` };
  const want = party[at];
  const from = want.level;
  const to = from + levels;

  const here = atlas.mapAt(party && machine.look().position.map.mapGroup, machine.look().position.map.mapNum);
  const plans = [here, ...atlas.placesNear(machine.look().position.map).map((p) => atlas.mapAt(p.mapGroup, p.mapNum))]
    .filter(Boolean)
    .filter((m, i, all) => all.findIndex((o) => o.g === m.g && o.n === m.n) === i)
    .filter((m) => !!atlas.grindSpot(m.g, m.n));
  if (!plans.length) return { name, ok: false, why: "nowhere with grass near the save" };

  const began = Date.now();
  const startedAt = machine.frames;
  const spent = () => machine.frames - startedAt;
  const supervisor = recovery();
  const stops = [];
  let attempt = 0;
  let ended = null;

  while (!ended && spent() < FRAME_BUDGET) {
    const on = plans[Math.min(attempt, plans.length - 1)];
    const policy = {
      slot: slotOfMon(machine.look().party, want, at),
      stopAtLevel: to,
      spot: atlas.grindSpot(on.g, on.n),
    };
    const run = runner(policy, null, atlas);
    let stopped = null;
    while (spent() < FRAME_BUDGET) {
      const out = run.step({ ...machine.look(), frame: machine.frames });
      if (out.done) { stopped = out; break; }
      machine.step(out.keys);
    }
    if (!stopped) break;
    const verdict = supervisor.after(stopped, { party: machine.look().party, want, fallbackSlot: at });
    if (verdict.action !== "retry") { ended = verdict; break; }
    stops.push(verdict.reason);
    attempt = verdict.attempt;
    for (let i = 0; i < 240; i++) machine.step(i % 20 < 6 ? BTN.B : 0);
  }

  // The outcome, read off the cartridge rather than taken from the runner.
  const after = machine.look();
  const now = after.party && after.party[slotOfMon(after.party, want, at)];
  const reached = !!now && now.level >= to;

  // And: can a person carry on from here? A menu left open is not a finished
  // run, whatever the runner thinks. Proved by walking, because that is the
  // only thing a menu cannot fake.
  const before = after.position;
  let walked = false;
  for (const way of [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN]) {
    for (let i = 0; i < 30; i++) machine.step(way | BTN.B);
    for (let i = 0; i < 10; i++) machine.step(0);
    const nowAt = machine.look();
    if (nowAt.inBattle) { walked = true; break; }
    const p = nowAt.position;
    if (p && before && (p.x !== before.x || p.y !== before.y || p.map.mapNum !== before.map.mapNum)) {
      walked = true;
      break;
    }
  }

  const ok = reached && walked;
  if (!ok) {
    const tag = `${name.replace(/\W+/g, "-")}-${Date.now()}`;
    machine.shoot(`${DUMPS}/${tag}.png`);
    const state = machine.snapshot();
    if (state) writeFileSync(`${DUMPS}/${tag}.state`, state);
  }
  return {
    name, ok,
    why: !reached
      ? `${monName} went ${from} -> ${now ? now.level : "?"} of ${to} in ${(spent() / 3600).toFixed(1)}` +
        ` game-minutes${ended ? ` (${ended.reason})` : " (ran out of budget)"}`
      : !walked
        ? "reached the level but the game was left in a menu nobody can walk out of"
        : `${monName} ${from} -> ${now.level} in ${(spent() / 3600).toFixed(1)} game-minutes` +
          ` (${((Date.now() - began) / 60000).toFixed(1)}m of yours)`,
    stops,
  };
}

// The matrix. Each row is something a person actually asked for at some point.
const SCENARIOS = [
  { name: "the lead, two levels", monName: startParty[0].name, levels: 2 },
  { name: "the last slot, two levels", monName: startParty[startParty.length - 1].name, levels: 2 },
  { name: "a middle slot, two levels", monName: startParty[2].name, levels: 2 },
  // The reported one: a low-level Pokémon in the last slot, behind several
  // that are already past the target level.
  { name: "a low one behind high ones", monName: startParty[startParty.length - 1].name, levels: 1 },
];

let passed = 0;
const rows = [];
for (const spec of SCENARIOS) {
  if (ONLY && !spec.name.includes(ONLY)) continue;
  process.stdout.write(`${spec.name.padEnd(30)} `);
  const out = await scenario(spec);
  rows.push(out);
  if (out.ok) passed += 1;
  console.log(`${out.ok ? "PASS" : "FAIL"}  ${out.why}${out.stops.length ? `  [picked itself up ${out.stops.length}×]` : ""}`);
  for (const stop of out.stops) console.log(`${"".padEnd(30)}   · ${stop}`);
}

console.log(`\n${passed} of ${rows.length} scenarios reached the level and left the game walkable.`);
if (passed < rows.length) console.log(`screenshots and save states for the failures: ${DUMPS}`);
process.exit(passed === rows.length ? 0 : 1);
