// Checks for the encrypted half of a Pokémon record.
//
// The decoder is checked against records this file encrypts itself, which is
// worth more than it sounds: the encoder here is written from the same
// description as the decoder but in the opposite direction, so a round trip
// exercises the key, the twenty-four permutations and the checksum together.
// If the permutation table were transcribed wrong, a round trip would still
// pass — so the table is checked separately against the property that makes
// it a permutation, and the whole thing is checked against a real cartridge
// in game-checks.
//
// Run: node apps/gba/checks/mon-checks.mjs

import { decode } from "../src/mon.js";

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const ORDER = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 3, 1, 2], [0, 2, 3, 1], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [2, 0, 1, 3], [3, 0, 1, 2], [2, 0, 3, 1], [3, 0, 2, 1],
  [1, 2, 0, 3], [1, 3, 0, 2], [2, 1, 0, 3], [3, 1, 0, 2], [2, 3, 0, 1], [3, 2, 0, 1],
  [1, 2, 3, 0], [1, 3, 2, 0], [2, 1, 3, 0], [3, 1, 2, 0], [2, 3, 1, 0], [3, 2, 1, 0],
];

/** Build a record the way the cartridge would: fill the four substructures,
 *  place them where `personality % 24` says, checksum the result, then XOR. */
function encode({ personality, otId, species, moves, pp, evs, ivs }) {
  const rec = new Uint8Array(100);
  const put32 = (buf, o, v) => {
    buf[o] = v & 0xff; buf[o + 1] = (v >>> 8) & 0xff;
    buf[o + 2] = (v >>> 16) & 0xff; buf[o + 3] = (v >>> 24) & 0xff;
  };
  const put16 = (buf, o, v) => { buf[o] = v & 0xff; buf[o + 1] = (v >>> 8) & 0xff; };

  const plain = new Uint8Array(48);
  const slots = ORDER[personality % 24];
  const g = slots[0] * 12, a = slots[1] * 12, e = slots[2] * 12, m = slots[3] * 12;
  put16(plain, g, species);
  moves.forEach((id, i) => put16(plain, a + i * 2, id));
  pp.forEach((v, i) => (plain[a + 8 + i] = v));
  evs.forEach((v, i) => (plain[e + i] = v));
  put32(plain, m + 4, ivs);

  put32(rec, 0, personality);
  put32(rec, 4, otId);
  let sum = 0;
  const key = (personality ^ otId) >>> 0;
  for (let word = 0; word < 12; word++) {
    const o = word * 4;
    const value =
      (plain[o] | (plain[o + 1] << 8) | (plain[o + 2] << 16) | (plain[o + 3] << 24)) >>> 0;
    sum = (sum + (value & 0xffff) + (value >>> 16)) & 0xffff;
    put32(rec, 0x20 + o, (value ^ key) >>> 0);
  }
  put16(rec, 0x1c, sum);
  return rec;
}

const PIKACHU = {
  personality: 0x9c3f21ab, otId: 0x1234abcd, species: 25,
  moves: [84, 98, 5, 86], pp: [30, 30, 20, 20],
  evs: [11, 25, 19, 91, 3, 0],
  // hp 14, atk 3, def 7, spe 2, spa 14, spd 0
  ivs: 14 | (3 << 5) | (7 << 10) | (2 << 15) | (14 << 20) | (0 << 25),
};

{
  const view = new Uint8Array(200);
  view.set(encode(PIKACHU), 40);
  const got = decode(view, 40);
  check("a record decodes", got !== null);
  check("species comes back", got && got.species === 25);
  check("moves come back in order", got && got.moves.map((m) => m.id).join(",") === "84,98,5,86");
  check("and their PP with them", got && got.moves.map((m) => m.pp).join(",") === "30,30,20,20");
  check("EVs come back", got && Object.values(got.evs).join(",") === "11,25,19,91,3,0");
  check("IVs unpack from their bit fields", got && Object.values(got.ivs).join(",") === "14,3,7,2,14,0");
  check(
    "nature is derived from the personality",
    got && got.nature === "Impish",
    "and this personality is above 2^31, where a signed read would go negative"
  );
}

{
  // Nature is `personality % 25` and nothing else, so a record with
  // personality 2 is Brave whatever is in the rest of it.
  const view = new Uint8Array(120);
  view.set(encode({ ...PIKACHU, personality: 2 }), 0);
  const got = decode(view, 0);
  check("nature is the personality modulo twenty-five", got && got.nature === "Brave", got && got.nature);
}

{
  // The property that matters about the permutation table: every row places
  // the four substructures in four distinct slots. A transcription slip that
  // duplicated a slot would silently lose one of them.
  const bad = ORDER.filter((row) => new Set(row).size !== 4);
  check("all twenty-four rows are permutations", ORDER.length === 24 && bad.length === 0);
  // And every one of the 24 is distinct.
  check("and no two rows are the same", new Set(ORDER.map((r) => r.join(""))).size === 24);
}

{
  // Every permutation actually round-trips, not just the one this personality
  // happens to select.
  let ok = 0;
  for (let n = 0; n < 24; n++) {
    const mon = { ...PIKACHU, personality: (PIKACHU.personality - (PIKACHU.personality % 24) + n) >>> 0 };
    const view = new Uint8Array(120);
    view.set(encode(mon), 0);
    const got = decode(view, 0);
    if (got && got.species === 25 && got.moves[0].id === 84 && got.evs.spe === 91) ok++;
  }
  check("all twenty-four orderings round-trip", ok === 24, `${ok}/24`);
}

// Everything below is a refusal. The checksum is what makes these possible:
// a wrong key, a torn write and a slot that is not a Pokémon all fail it.
{
  const view = new Uint8Array(120);
  view.set(encode(PIKACHU), 0);

  const torn = view.slice();
  torn[0x24] ^= 0x01; // one bit inside the encrypted data
  check("a single flipped bit is refused", decode(torn, 0) === null);

  const wrongKey = view.slice();
  wrongKey[4] ^= 0xff; // a different OT id, so a different key
  check("a record decrypted with the wrong key is refused", decode(wrongKey, 0) === null);

  check("an empty slot is not a Pokémon", decode(new Uint8Array(120), 0) === null);

  const noSpecies = encode({ ...PIKACHU, species: 0 });
  const holder = new Uint8Array(120);
  holder.set(noSpecies, 0);
  check("a valid checksum over no species is still refused", decode(holder, 0) === null);

  const absurd = new Uint8Array(120);
  absurd.set(encode({ ...PIKACHU, species: 9999 }), 0);
  check("a species out of range is refused", decode(absurd, 0) === null);

  check("reading past the end is refused", decode(view, 100) === null);
  check("no view at all is refused", decode(null, 0) === null);
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
