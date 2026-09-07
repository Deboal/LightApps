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

import { partyOf, supports, gameName, inBattleOf, positionOf, sameTile, battleMenuOf } from "../src/game.js";

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

// The battle flag. This one is read out of IWRAM and, unlike the party, has
// never been watched turning on -- so what is checked here is only that the
// bit is decoded from the right byte and that unknown cartridges get nothing.
{
  const FLAGS = 0x03003529 - 0x03000000; // gMain + 0x439
  const iwram = new Uint8Array(0x8000);
  check("no battle in a zeroed machine", inBattleOf(iwram, "BPRE") === false);

  iwram[FLAGS] = 0b01;
  check("the neighbouring bit is not mistaken for it", inBattleOf(iwram, "BPRE") === false);

  iwram[FLAGS] = 0b10;
  check("bit one is the battle", inBattleOf(iwram, "BPRE") === true);

  iwram[FLAGS] = 0xff;
  check("and it survives the rest of the flags being set", inBattleOf(iwram, "BPRE") === true);

  check("an unknown cartridge yields nothing, not false", inBattleOf(iwram, "AXVE") === null);
  check("no view at all yields nothing", inBattleOf(null, "BPRE") === null);
  check("a view too short to hold gMain yields nothing", inBattleOf(new Uint8Array(16), "BPRE") === null);
}

// Where the player is standing. This one is read through a pointer, so the
// pointer is the verification: SaveBlock1 lives in EWRAM, and an address
// outside it means there is nothing to read rather than something to guess at.
{
  const IWRAM = 0x03000000, PTR = 0x03005008, BLOCK = 0x020255a4;
  const machine = (block = BLOCK, fill = (ew, base) => {
    ew[base] = 6; ew[base + 2] = 4;          // pos (6, 4)
    ew[base + 4] = 7; ew[base + 5] = 4;      // location: map 7/4
    ew[base + 0x1c] = 3; ew[base + 0x1d] = 3;
    ew[base + 0x20] = 22; ew[base + 0x22] = 20; // lastHeal (22, 20) -- +4, not +3
    ew[base + 0x34] = 6;                     // playerPartyCount
  }) => {
    const iwram = new Uint8Array(0x8000), ewram = new Uint8Array(0x40000);
    const at = PTR - IWRAM;
    for (let i = 0; i < 4; i++) iwram[at + i] = (block >>> (i * 8)) & 0xff;
    if (block >= EWRAM_BASE && block - EWRAM_BASE < ewram.length) fill(ewram, block - EWRAM_BASE);
    return { iwram, ewram };
  };

  const { iwram, ewram } = machine();
  const here = positionOf(iwram, ewram, "BPRE");
  check("the player's tile is read through the pointer", here && here.x === 6 && here.y === 4);
  check("so is the map they are on", here && here.map.mapGroup === 7 && here.map.mapNum === 4);
  check(
    "and where the game will heal them",
    here && here.lastHeal.mapGroup === 3 && here.lastHeal.x === 22 && here.lastHeal.y === 20,
    "WarpData pads to eight bytes -- coordinates start at +4, not +3"
  );

  // Being blocked and walking look identical from the buttons. This is the
  // only thing that tells them apart, so it is the whole fix for an item ball.
  const moved = machine(BLOCK, (ew, base) => {
    ew[base] = 5; ew[base + 2] = 4;
    ew[base + 4] = 7; ew[base + 5] = 4;
    ew[base + 0x34] = 6;
  });
  const there = positionOf(moved.iwram, moved.ewram, "BPRE");
  check("a step away is not the same tile", sameTile(here, there) === false);
  check("the same reading is", sameTile(here, here) === true);
  check("nothing is never the same tile as anything", sameTile(here, null) === false);

  const stray = machine(0x08000000); // a ROM address: not where SaveBlock1 lives
  check("a pointer outside EWRAM is refused", positionOf(stray.iwram, stray.ewram, "BPRE") === null);
  const zero = machine(0);
  check("a null pointer is refused", positionOf(zero.iwram, zero.ewram, "BPRE") === null);

  const noParty = machine(BLOCK, (ew, base) => { ew[base] = 6; ew[base + 2] = 4; ew[base + 0x34] = 0; });
  check(
    "a block with no party in it is not SaveBlock1",
    positionOf(noParty.iwram, noParty.ewram, "BPRE") === null
  );
  check("an unknown cartridge yields nothing", positionOf(iwram, ewram, "AXVE") === null);
  check("no views at all yield nothing", positionOf(null, null, "BPRE") === null);
}

// Which battle menu is up. Found by diffing a real machine's RAM across a
// single A press in a real battle, and confirmed against all four cursor
// values -- so what is checked here is the decoding and, more importantly,
// that a build these addresses do not describe gets nothing rather than a
// guess.
{
  const FUNCS = 0x03004fe0 - 0x03000000;
  const CURSOR = 0x02023ffc - 0x02000000;
  const machine = (fn, cursor) => {
    const iwram = new Uint8Array(0x8000), ewram = new Uint8Array(0x40000);
    for (let i = 0; i < 4; i++) iwram[FUNCS + i] = (fn >>> (i * 8)) & 0xff;
    ewram[CURSOR] = cursor;
    return { iwram, ewram };
  };

  const action = machine(0x0802e44d, 0);
  const move = machine(0x0802ea25, 3);
  check("the action menu is recognised", battleMenuOf(action.iwram, action.ewram, "BPRE").menu === "action");
  check("so is the move list", battleMenuOf(move.iwram, move.ewram, "BPRE").menu === "move");
  check("and the cursor comes with it", battleMenuOf(move.iwram, move.ewram, "BPRE").cursor === 3);

  // Battle text, an animation, the overworld: a menu is not up, and that is
  // different from not being able to tell.
  const elsewhere = machine(0x08012345, 0);
  check(
    "any other state reports no menu rather than guessing",
    battleMenuOf(elsewhere.iwram, elsewhere.ewram, "BPRE").menu === null
  );

  // The addresses are a specific build's ROM layout, so they emphatically do
  // not carry to LeafGreen. Nothing is worse here than a wrong guess: it
  // would press directions into a menu that is not there.
  check(
    "a build without verified menu addresses gets nothing",
    battleMenuOf(action.iwram, action.ewram, "BPRG") === null
  );
  check("an unknown cartridge gets nothing", battleMenuOf(action.iwram, action.ewram, "AXVE") === null);
  check("no views at all get nothing", battleMenuOf(null, null, "BPRE") === null);
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
