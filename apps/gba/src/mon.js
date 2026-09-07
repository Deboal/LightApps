// mon.js — the encrypted half of a Pokémon record.
//
// A party slot is a hundred bytes, and the interesting forty-eight of them are
// obfuscated: XOR'd with `personality ^ otId`, then split into four twelve-byte
// substructures whose *order* is `personality % 24`. Species, moves, PP, EVs
// and IVs all live in there. Everything `game.js` reads today — nickname,
// level, HP — is in the plain part, which is why it got that far without this.
//
// The reason this is worth more than it looks: **it verifies itself.** Offset
// 0x1C holds a checksum over the decrypted halfwords. Decrypt, sum, compare.
// Every other address in this project rests on an argument about shape; this
// one rests on the cartridge's own arithmetic, and a wrong key or a wrong
// permutation fails loudly instead of returning plausible nonsense.
//
// The permutation table and the checksum are transcribed from pokefirered's
// `GetSubstruct` and `CalculateBoxMonChecksum`.

/** Where each substructure sits, by `personality % 24`. Row `n` gives the slot
 *  holding Growth, Attacks, EVs and Misc, in that order. */
const ORDER = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 3, 1, 2], [0, 2, 3, 1], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [2, 0, 1, 3], [3, 0, 1, 2], [2, 0, 3, 1], [3, 0, 2, 1],
  [1, 2, 0, 3], [1, 3, 0, 2], [2, 1, 0, 3], [3, 1, 0, 2], [2, 3, 0, 1], [3, 2, 0, 1],
  [1, 2, 3, 0], [1, 3, 2, 0], [2, 1, 3, 0], [3, 1, 2, 0], [2, 3, 1, 0], [3, 2, 1, 0],
];

const GROWTH = 0, ATTACKS = 1, EVS = 2, MISC = 3;

/** The twenty-five natures, in the order `personality % 25` selects them. */
const NATURES = [
  "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
  "Bold", "Docile", "Relaxed", "Impish", "Lax",
  "Timid", "Hasty", "Serious", "Jolly", "Naive",
  "Modest", "Mild", "Quiet", "Bashful", "Rash",
  "Calm", "Gentle", "Sassy", "Careful", "Quirky",
];

/**
 * Decode one party slot.
 *
 * `view` is a byte view over work RAM and `at` the offset of the record's
 * first byte. Returns null if the checksum does not agree — which is the
 * whole point: a record caught mid-write, a slot that is not a Pokémon, or a
 * mistake in this file all land in the same place, and none of them is
 * reported as a Pokémon.
 */
export function decode(view, at) {
  if (!view || at < 0 || at + 80 > view.length) return null;

  const u16 = (o) => view[o] | (view[o + 1] << 8);
  const u32 = (o) => (u16(o) | (u16(o + 2) << 16)) >>> 0;

  const personality = u32(at);
  const otId = u32(at + 4);
  const key = (personality ^ otId) >>> 0;
  const stored = u16(at + 0x1c);

  // Decrypt in place into a local copy. Forty-eight bytes, twelve words.
  const plain = new Uint8Array(48);
  let sum = 0;
  for (let word = 0; word < 12; word++) {
    const value = (u32(at + 0x20 + word * 4) ^ key) >>> 0;
    plain[word * 4] = value & 0xff;
    plain[word * 4 + 1] = (value >>> 8) & 0xff;
    plain[word * 4 + 2] = (value >>> 16) & 0xff;
    plain[word * 4 + 3] = (value >>> 24) & 0xff;
    sum = (sum + (value & 0xffff) + (value >>> 16)) & 0xffff;
  }
  // The arithmetic that makes this trustworthy. An empty slot decrypts to
  // zeroes and sums to zero, which would agree with a zero checksum -- so a
  // record with no species is refused too.
  if (sum !== stored) return null;

  const slots = ORDER[personality % 24];
  const sub = (which) => slots[which] * 12;
  const p16 = (o) => plain[o] | (plain[o + 1] << 8);
  const p32 = (o) => (p16(o) | (p16(o + 2) << 16)) >>> 0;

  const g = sub(GROWTH), a = sub(ATTACKS), e = sub(EVS), m = sub(MISC);
  const species = p16(g);
  if (species === 0 || species > 411) return null;

  const ivs = p32(m + 4);
  return {
    personality,
    otId,
    species,
    heldItem: p16(g + 2),
    experience: p32(g + 4),
    friendship: plain[g + 9],
    nature: NATURES[personality % 25],
    // Four moves and the PP left in each. A move id of zero is an empty slot,
    // not a move -- a Pokémon with two moves has two, not four.
    moves: [0, 1, 2, 3].map((i) => ({ id: p16(a + i * 2), pp: plain[a + 8 + i] })),
    evs: {
      hp: plain[e], atk: plain[e + 1], def: plain[e + 2],
      spe: plain[e + 3], spa: plain[e + 4], spd: plain[e + 5],
    },
    ivs: {
      hp: ivs & 31, atk: (ivs >>> 5) & 31, def: (ivs >>> 10) & 31,
      spe: (ivs >>> 15) & 31, spa: (ivs >>> 20) & 31, spd: (ivs >>> 25) & 31,
    },
    isEgg: ((ivs >>> 30) & 1) === 1,
  };
}
