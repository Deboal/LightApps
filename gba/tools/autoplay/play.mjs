// play.mjs — the app's autoplayer, without the app.
//
// The browser is where this is meant to be watched. It is a poor place to
// *debug* it: a run takes as long as the game takes, a stop reports one line
// in a panel, and a fix cannot be tried without a build, a deploy and a stale
// service worker. Every bug in this thing has cost more time in that loop than
// in the fix.
//
// So this runs the same policy against the same wasm core off the same atlas,
// with the browser taken out. That is the whole design: not a second
// autoplayer, the same one. The second autoplayer already existed -- the
// routines in this folder -- and the bugs it did not share with the app were
// the expensive ones. `leadWith` lived here, worked here, and was never ported,
// so the app booked a trip to the Pokémon Center after every battle for a week
// and nothing that ran headless could see it.
//
// It is not faster, whatever the first version of this comment said. The core
// runs at 209 frames a second here and 210 in a browser tab -- the same 3.5x
// real time -- and the rendering this skips costs nothing next to it. What it
// buys is that a stop becomes a file: `--dump` writes the state, the screen
// and the reason, and every bug in this thing was found by looking at one.
//
//   node gba/tools/autoplay/play.mjs --rom FireRed.gba --sav game.sav \
//     --mon CHARIZARD --to 40 --out after.sav --show
//
//   --rom      the cartridge (required)
//   --sav      the cartridge save to start from (required)
//   --mon      who to train, by nickname; or --slot N
//   --to       the level to stop at (required)
//   --spot     the map to grind on, by name. The default is where you are
//              standing -- or, because that is usually the upstairs of a
//              Pokémon Center, the nearest map with grass on it
//   --out      write the cartridge save here when it finishes
//   --minutes  wall-clock budget, default 30
//   --tries    how many times to pick the run back up after a stop, default 3
//   --dump     write a save state and a screenshot here on every stop
//   --show     draw the screen in the terminal while it runs
//
// `--show` costs about a fifth of the speed and is worth it: a run that is
// going wrong looks wrong long before it says so.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { boot, resume, BTN } from "./machine.mjs";
import { saveGame } from "./menus.mjs";
import { world } from "../../../apps/gba/src/world.js";
import { runner } from "../../../apps/gba/src/policy.js";
import { recovery, slotOfMon } from "../../../apps/gba/src/recovery.js";

const ARGS = (() => {
  const out = { minutes: 30, tries: 3 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (argv[i].startsWith("--") && (i + 1 >= argv.length || argv[i + 1].startsWith("--"))) out[key] = true;
    else if (argv[i].startsWith("--")) out[key] = argv[++i];
  }
  return out;
})();

const die = (why) => {
  console.error(why);
  console.error("\n  node gba/tools/autoplay/play.mjs --rom X.gba --sav Y.sav --mon NAME --to 40");
  process.exit(2);
};

if (!ARGS.rom || !ARGS.sav) die("--rom and --sav are both required");
if (!ARGS.to) die("--to <level> is required: this is a grinder, it needs somewhere to stop");

// -- the screen, in a terminal ----------------------------------------------
//
// Two rows of pixels per line of text: a half-block glyph with the upper row
// as the foreground colour and the lower as the background. That gets a square
// aspect ratio out of a character cell, which is what makes the picture
// readable rather than a smear.
const SCREEN = { w: 240, h: 160 };
function draw(core, cols = 80) {
  const ptr = core.gba_pixels();
  const rgba = new Uint8Array(core.memory.buffer, ptr, SCREEN.w * SCREEN.h * 4);
  const step = SCREEN.w / cols;
  const rows = Math.floor(SCREEN.h / step / 2);
  const at = (x, y) => {
    const i = ((Math.min(SCREEN.h - 1, y) | 0) * SCREEN.w + (Math.min(SCREEN.w - 1, x) | 0)) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]];
  };
  let out = "\x1b[H";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * step;
      const [tr, tg, tb] = at(x, row * step * 2);
      const [br, bg, bb] = at(x, row * step * 2 + step);
      out += `\x1b[38;2;${tr};${tg};${tb}m\x1b[48;2;${br};${bg};${bb}m▀`;
    }
    out += "\x1b[0m\n";
  }
  process.stdout.write(out);
}

// -- setting up --------------------------------------------------------------

const rom = readFileSync(ARGS.rom);
let code = "";
for (let i = 0; i < 4; i++) code += String.fromCharCode(rom[0xac + i]);

const machine = await boot({ rom: ARGS.rom, save: ARGS.sav, code });
console.error(`cartridge ${code}, revision ${rom[0xbc]}`);

// The same two files the browser fetches, read off disk. `loadWorld` takes a
// fetch; there is nothing to fetch here, so this goes in through the door
// underneath it rather than faking one.
const assets = new URL("../../../apps/gba/assets/", import.meta.url);
const atlas = world(
  JSON.parse(readFileSync(new URL("world.json", assets), "utf8")),
  new Uint8Array(readFileSync(new URL("world.bin", assets)))
);
if (!atlas.covers(code)) {
  // Not fatal. Without the atlas the policy falls back to a recorded route,
  // and there is no recorded route here -- so it would grind in place and
  // never heal. Saying so beats a run that quietly cannot recover.
  console.error(`warning: the atlas does not describe ${code}; there will be no trips to a Pokémon Center`);
}

console.error("booting past the title...");
resume(machine);

const start = machine.look();
if (!start.party) die("booted, but the party is not readable -- is this the right cartridge for this save?");
if (!start.position) die("booted, but the player's position is not readable");

const slot = ARGS.mon
  ? start.party.findIndex((m) => m.name.toUpperCase() === String(ARGS.mon).toUpperCase())
  : Number(ARGS.slot || 0);
if (slot < 0) die(`no "${ARGS.mon}" in the party: ${start.party.map((m) => m.name).join(", ")}`);

// Which map to fight on, and which tile of it. The map is a judgement; the
// tile is arithmetic, and the atlas does it -- the middle of the largest patch
// of grass, exactly as the app does.
//
// The default is not quite "the map you are standing on", because that map is
// very often the second floor of a Pokémon Center -- the last place anyone
// saves. There is no grass there, and the honest end of grinding on a map with
// no grass is ninety seconds of walking and a stop that says so. Told to grind
// upstairs in Cerulean, the first version of this did that three times in a
// row and called it recovery.
//
// So: if where you stand has no grass, the nearby maps that do are the plan,
// nearest first. Recovering from a stop walks down that list rather than
// trying the same thing again.
const named = ARGS.spot
  ? atlas.meta.maps.find((m) => m.name.toLowerCase() === String(ARGS.spot).toLowerCase())
  : null;
if (ARGS.spot && !named) die(`no map called "${ARGS.spot}"`);

const here = atlas.mapAt(start.position.map.mapGroup, start.position.map.mapNum);
const plans = named
  ? [named]
  : [here, ...atlas.placesNear(start.position.map).map((p) => atlas.mapAt(p.mapGroup, p.mapNum))]
      .filter(Boolean)
      .filter((m, i, all) => all.findIndex((o) => o.g === m.g && o.n === m.n) === i)
      .filter((m) => !!atlas.grindSpot(m.g, m.n));
if (!plans.length) die("nowhere with grass within a few maps of here -- walk somewhere greener, or pass --spot");
const spotOn = plans[0];
const spot = atlas.grindSpot(spotOn.g, spotOn.n);

const target = start.party[slot];
if (!target) die(`there is no slot ${slot + 1} in a party of ${start.party.length}`);
console.error(
  `standing on ${here ? here.name : `map ${start.position.map.mapGroup}/${start.position.map.mapNum}`}` +
    ` at (${start.position.x}, ${start.position.y})`
);
console.error(
  `training ${target.name} (slot ${slot + 1}, level ${target.level}) to ${ARGS.to} on ${spotOn.name}` +
    (plans.length > 1 ? `, then ${plans.slice(1, 4).map((m) => m.name).join(", ")} if that goes wrong` : "")
);

// -- the run -----------------------------------------------------------------

const BUDGET = Number(ARGS.minutes) * 60 * 1000;
const began = Date.now();
const dumpDir = ARGS.dump || null;
if (dumpDir) mkdirSync(dumpDir, { recursive: true });
if (ARGS.show) process.stdout.write("\x1b[2J");

/** Everything the browser hands the policy each frame, read the same way. */
const look = () => ({ ...machine.look(), frame: machine.frames });

// Where the one being trained is now, and whether a stop is worth another go.
// Both shared with the app rather than written again here -- the last time
// they were written twice, the tab did not recover at all.
const slotNow = () => slotOfMon(machine.look().party, target, slot);
const supervisor = recovery({ tries: Number(ARGS.tries) });

let attempt = 0;
let outcome = null;
const stops = [];

while (!outcome && Date.now() - began < BUDGET) {
  // A fresh runner each attempt, on purpose. Its counters are what a stop is
  // judged against -- how long since anything moved, how hard the hardest hit
  // was -- and carrying them across a recovery means judging the next attempt
  // on the last one's evidence.
  const on = plans[Math.min(attempt, plans.length - 1)];
  const where = atlas.grindSpot(on.g, on.n);
  if (attempt > 0) console.error(`trying ${on.name} instead`);
  const policy = { slot: slotNow(), stopAtLevel: Number(ARGS.to), ...(where ? { spot: where } : {}) };
  const run = runner(policy, null, atlas);
  let stopped = null;

  while (Date.now() - began < BUDGET) {
    const state = look();
    const out = run.step(state);
    if (out.done) { stopped = out; break; }
    machine.step(out.keys);

    if (ARGS.show && machine.frames % 6 === 0) draw(machine.core);
    if (machine.frames % 1800 === 0) {
      // By name, not by slot. Putting the target in front reorders the party
      // for real -- a slot number stops meaning what it meant the moment the
      // run does the one thing it was asked to do first.
      const mon = state.party && state.party[slotOfMon(state.party, target, slot)];
      const minutes = ((Date.now() - began) / 60000).toFixed(1);
      console.error(
        `[${minutes}m] ${mon ? `${mon.name} L${mon.level} ${mon.hp}/${mon.maxHp}` : "party unreadable"}` +
          ` · ${run.mode} · ${run.battles} battles · ${run.heals} heals` +
          // Only while a trip to a Centre is actually under way. `healBecause`
          // holds the reason for the *last* one, so printing it unconditionally
          // says "heading in" through half an hour of contented grinding.
          (run.trip === "heal" && run.healBecause ? ` · heading in: ${run.healBecause}` : "")
      );
    }
  }

  if (!stopped) break; // out of budget, not out of ideas

  // Reaching the goal is a stop like any other as far as the runner is
  // concerned, and it says so with `final`. Everything else gets another go.
  const verdict = supervisor.after(stopped, {
    party: machine.look().party, want: target, fallbackSlot: slot,
  });

  // A run that stopped for a reason worth keeping. The
  // state is a scenario the checks can replay in seconds; the picture is for
  // the reasons that all read the same and look completely different.
  // Dumped whenever the stop was a real problem -- which includes the last
  // one, the stop it gave up on. That is the most interesting of the lot and
  // an earlier version of this line threw it away.
  if (dumpDir && !verdict.final) {
    const tag = `${Date.now()}-${attempt}`;
    const state = machine.snapshot();
    if (state) writeFileSync(`${dumpDir}/stop-${tag}.state`, state);
    machine.shoot(`${dumpDir}/stop-${tag}.png`);
    writeFileSync(
      `${dumpDir}/stop-${tag}.json`,
      JSON.stringify({ reason: verdict.reason, at: machine.look().position, attempt, mon: target.name, spot: where }, null, 2)
    );
  }

  if (verdict.action !== "retry") {
    // Say why, always. An earlier version of this line broke out silently on
    // a final stop, so a run that ended six seconds in printed a level that
    // had not changed and nothing else at all -- which is indistinguishable
    // from the tool being broken, and wasted a debugging session proving it
    // was not.
    outcome = verdict.final ? "final" : "gave up";
    console.error(`\nstopped: ${verdict.reason}`);
    if (verdict.exhausted) console.error(`gave up after ${supervisor.attempt} attempts.`);
    break;
  }
  stops.push(verdict.reason);
  attempt = verdict.attempt;
  console.error(`\nstopped: ${verdict.reason}\npicking it back up (attempt ${attempt} of ${ARGS.tries})`);

  // Recovery, such as it is: let go of everything, close whatever is open, and
  // hand a fresh runner the machine. B rather than A -- B backs out of menus,
  // and A in the overworld starts conversations. The escalation beyond this
  // belongs in the policy, where it can see what it is escalating against.
  for (let i = 0; i < 240; i++) machine.step(i % 20 < 6 ? BTN.B : 0);
}

// -- what happened -----------------------------------------------------------

const ended = machine.look();
const mon = ended.party && ended.party[slotOfMon(ended.party, target, slot)];
const minutes = ((Date.now() - began) / 60000).toFixed(1);

if (ARGS.show) process.stdout.write("\x1b[2J\x1b[H");
console.error("");
if (mon) console.error(`${mon.name}: level ${target.level} -> ${mon.level} in ${minutes} minutes`);
if (stops.length) console.error(`picked back up ${stops.length}× along the way:\n  ${stops.join("\n  ")}`);

if (ARGS.out) {
  // In-game first. `gba_read_save` reads the cartridge's flash, and the game
  // writes flash only when the player saves -- so without this the file
  // handed over is a byte-for-byte copy of the one loaded, with every level
  // of the run missing, and it looks completely fine.
  const wrote = saveGame(machine);
  if (!wrote.ok) console.error(`could not save in-game (${wrote.reason}); the file would be the one you started with`);
  else {
    const sav = machine.save();
    if (!sav) console.error("the core would not hand over a save");
    else {
      writeFileSync(ARGS.out, sav);
      console.error(`wrote ${ARGS.out} (${sav.length} bytes) -- import it in the app under Import .sav`);
    }
  }
}

const reached = !!mon && mon.level >= Number(ARGS.to);
console.error(reached ? "reached the level asked for" : "did not reach the level asked for");
process.exit(reached ? 0 : 1);
