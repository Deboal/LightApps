// The runner against a real machine.
//
// Everything else here is either the runner against a synthetic world or the
// reader against a captured dump. This is the join: the shipped wasm core,
// booted with a real cartridge and save, driven by the shipped policy through
// the shipped reads — the browser's code path with the browser taken out.
//
// It exists because a report ("my Pokémon keep using Harden") could not be
// told apart, from the outside, into "the move picker is off", "the move
// picker is running and choosing badly", or "the build never reached the
// device". Each of those looks identical over a network. This tells them
// apart in thirty seconds.
//
// Run: GBA_ROM=… GBA_SAV=… node apps/gba/checks/live-checks.mjs

import { readFileSync } from "node:fs";
import * as game from "../src/game.js";
import { MOVES, moveName } from "../src/moves.js";
import { runner } from "../src/policy.js";
import { BTN } from "../src/buttons.js";

const ROM = process.env.GBA_ROM;
const SAV = process.env.GBA_SAV;
if (!ROM || !SAV) {
  console.error("set GBA_ROM and GBA_SAV");
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const wasm = readFileSync(new URL("../assets/gba-core.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm, {});
const core = instance.exports;

const into = (bytes) => {
  const ptr = core.gba_alloc(bytes.length);
  new Uint8Array(core.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
};

const rom = readFileSync(ROM);
const sav = readFileSync(SAV);
const romPtr = into(rom);
const savPtr = into(sav);
check("the core boots the cartridge", core.gba_init(romPtr, rom.length, savPtr, sav.length) === 1);

const header = { code: "", version: rom[0xbc] };
for (let i = 0; i < 4; i++) header.code += String.fromCharCode(rom[0xac + i]);
console.log(`      cartridge ${header.code}, revision ${header.version}`);

/** What the app reads each frame, read the same way. */
const look = () => {
  const ewram = game.ewram(core);
  const iwram = game.iwram(core);
  return {
    party: game.partyOf(ewram, header.code),
    inBattle: game.inBattleOf(iwram, header.code) === true,
    battle: game.battleMenuOf(iwram, ewram, header.code),
    position: game.positionOf(iwram, ewram, header.code),
  };
};

// Past the title and into the save. A tap of A every so often does it.
for (let frame = 0; frame < 4000; frame++) {
  core.gba_run_frame(frame % 24 < 6 ? BTN.A : 0);
}
const started = look();
check("the save loads and the party is readable", !!started.party, started.party && `${started.party.length} members`);
check("and so is where the player is standing", !!started.position,
  started.position && `map ${started.position.map.mapGroup}/${started.position.map.mapNum}`);

// Walk until a wild battle starts. This is the same "hold a direction, turn
// when the tile stops changing" the runner does.
let dir = 0;
const DIRS = [BTN.LEFT, BTN.DOWN, BTN.RIGHT, BTN.UP];
let last = null;
let still = 0;
let sawBattle = false;
for (let frame = 0; frame < 12000 && !sawBattle; frame++) {
  const now = look();
  if (now.inBattle) { sawBattle = true; break; }
  if (now.position && last && game.sameTile(now.position, last)) still++;
  else still = 0;
  if (now.position) last = now.position;
  if (still > 28) { dir = (dir + 1) % 4; still = 0; }
  core.gba_run_frame(DIRS[dir] | BTN.B);
}
check("walking in the grass starts a wild battle", sawBattle);

// Now hand it to the runner and watch what it does with the menus.
const party = look().party;
const trainee = party.findIndex((mon) => mon.record && mon.record.moves.some((m) => m.id && m.pp > 0));
const lead = party[trainee];
const best = lead.record.moves
  .map((m, index) => ({ index, id: m.id, pp: m.pp, power: m.id && MOVES[m.id] ? MOVES[m.id].p : 0 }))
  .filter((m) => m.id && m.pp > 0)
  .sort((a, b) => b.power - a.power || b.pp - a.pp)[0];
console.log(
  `      training ${lead.name}: ${lead.record.moves.filter((m) => m.id).map((m) => `${moveName(m.id)}(${MOVES[m.id].p})`).join(", ")}` +
  ` — strongest is ${moveName(best.id)}`
);

const run = runner({ slot: trainee, stopAtLevel: 100, fleeBelowHp: 0.0, stopBelowHp: 0.0 });
const menusSeen = new Set();
const cursorsSeen = new Set();
let unknownFn = null;
let confirmedAt = null;

for (let frame = 0; frame < 4000; frame++) {
  const state = look();
  if (state.battle) {
    if (state.battle.menu) menusSeen.add(state.battle.menu);
    else if (unknownFn === null && state.inBattle) unknownFn = state.battle.fn;
    if (state.battle.menu === "move") {
      cursorsSeen.add(state.battle.cursor);
      // The moment it confirms with the cursor on the strongest move is the
      // whole feature working.
      if (state.battle.cursor === best.index && confirmedAt === null) confirmedAt = frame;
    }
  }
  const out = run.step({ ...state, frame });
  if (out.done) break;
  core.gba_run_frame(out.keys);
}

check(
  "the action menu is recognised on this cartridge",
  menusSeen.has("action"),
  unknownFn !== null ? `unrecognised pointer 0x${(unknownFn >>> 0).toString(16).toUpperCase()}` : ""
);
check("so is the move list", menusSeen.has("move"));
check(
  "and the runner moves the cursor off the first move",
  cursorsSeen.size > 1 || best.index === 0,
  `cursors seen: ${[...cursorsSeen].sort().join(",")}; strongest move is index ${best.index}`
);
check(
  "it lands the cursor on the strongest move it has",
  confirmedAt !== null || best.index === 0,
  confirmedAt !== null ? `after ${confirmedAt} frames` : "never reached it"
);

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
