// Checks for the game reader, against a synthetic machine.
//
// The addresses in game.js were found by searching a real machine's RAM for
// the shape a party must have; that search is recorded in the module's own
// comment and is repeatable. What is checked here is everything downstream of
// them: that a party at those addresses decodes correctly, and — the part that
// matters more — that memory which is *not* a party is refused rather than
// reported as one. A policy acting on plausible nonsense is worse than one
// that waits.
//
// Run: node apps/gba/checks/game-checks.mjs

import { partyOf, supports, gameName } from "../src/game.js";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const EWRAM_BASE = 0x02000000;
const PARTY = 0x02024284;
const COUNT = 0x02024029;
const SLOT = 100;

// The game's own character set: 0xBB is 'A', 0xD5 is 'a', 0xFF terminates.
const encodeName = (text) =>
  [...text].map((c) => {
    if (c >= "A" && c <= "Z") return 0xbb + c.charCodeAt(0) - 65;
    if (c >= "a" && c <= "z") return 0xd5 + c.charCodeAt(0) - 97;
    if (c >= "0" && c <= "9") return 0xa1 + c.charCodeAt(0) - 48;
    return 0x00;
  });

function machine(party) {
  const view = new Uint8Array(0x40000);
  view[COUNT - EWRAM_BASE] = party.length;
  party.forEach((mon, slot) => {
    const at = PARTY - EWRAM_BASE + slot * SLOT;
    encodeName(mon.name).forEach((byte, i) => (view[at + 8 + i] = byte));
    view[at + 8 + mon.name.length] = 0xff;
    view[at + 84] = mon.level;
    view[at + 86] = mon.hp & 0xff;
    view[at + 87] = mon.hp >> 8;
    view[at + 88] = mon.maxHp & 0xff;
    view[at + 89] = mon.maxHp >> 8;
    // The five stats the shape test also requires.
    for (let i = 0; i < 5; i++) {
      view[at + 90 + i * 2] = 40 + i;
      view[at + 91 + i * 2] = 0;
    }
  });
  return view;
}

// The party from a real machine, as it read at the moment the addresses were
// found: same six the trade screen showed, a few levels earlier.
const REAL = [
  { name: "PIKACHU", level: 22, hp: 50, maxHp: 50 },
  { name: "BEEDRILL", level: 12, hp: 39, maxHp: 39 },
  { name: "CHARMELEON", level: 24, hp: 67, maxHp: 67 },
  { name: "NIDORAN", level: 6, hp: 22, maxHp: 22 },
  { name: "JIGGLYPUFF", level: 3, hp: 20, maxHp: 20 },
  { name: "CLEFAIRY", level: 10, hp: 36, maxHp: 36 },
];

{
  const party = partyOf(machine(REAL), "BPRE");
  check("a party is read back whole", party !== null && party.length === 6);
  check(
    "names decode from the game's character set",
    party && party.map((m) => m.name).join(",") === REAL.map((m) => m.name).join(","),
    party && party.map((m) => m.name).join(",")
  );
  check(
    "levels and HP come through",
    party && party[0].level === 22 && party[0].hp === 50 && party[2].maxHp === 67
  );
  check("a Pokémon at zero HP reads as fainted", (() => {
    const hurt = REAL.map((m, i) => (i === 1 ? { ...m, hp: 0 } : m));
    const read = partyOf(machine(hurt), "BPRE");
    return read && read[1].fainted === true && read[0].fainted === false;
  })());
}

// Everything below is a refusal. Each is memory that could plausibly sit at
// these addresses on a cartridge this does not understand, or mid-write.
{
  check("a cartridge it does not know is refused", partyOf(machine(REAL), "AXVE") === null);
  check("an unknown code is not claimed as supported", supports("AXVE") === false);
  check("FireRed is", supports("BPRE") === true && gameName("BPRE") === "FireRed");

  const empty = new Uint8Array(0x40000);
  check("zeroed memory is not a party of zero", partyOf(empty, "BPRE") === null);

  const noise = new Uint8Array(0x40000).fill(0xff);
  check("memory full of 0xFF is not a party", partyOf(noise, "BPRE") === null);

  const tooMany = machine(REAL);
  tooMany[COUNT - EWRAM_BASE] = 9;
  check("a count outside one to six is refused", partyOf(tooMany, "BPRE") === null);

  const impossible = machine(REAL);
  // Current HP above maximum: a real party never holds this, so memory that
  // does is either mid-write or not a party at all.
  impossible[PARTY - EWRAM_BASE + 86] = 0xff;
  impossible[PARTY - EWRAM_BASE + 87] = 0x01;
  check("HP above maximum is refused", partyOf(impossible, "BPRE") === null);

  const overLevelled = machine(REAL);
  overLevelled[PARTY - EWRAM_BASE + 2 * SLOT + 84] = 240;
  check("a level above a hundred is refused", partyOf(overLevelled, "BPRE") === null);

  check("no view at all is refused", partyOf(null, "BPRE") === null);
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
