// game.js — what the emulator can see of the game it is running.
//
// The core is a Game Boy Advance and knows nothing about Pokémon. This is the
// decoder ring: a handful of addresses in the cartridge's work RAM, and the
// structs they point at. It exists so that something driving the game — a
// policy, a readout — can act on what is actually true rather than on what a
// screenshot appears to show.
//
// Every address here was found by searching a real machine's RAM for the
// shape it must have, not taken on faith from a table. `gPlayerParty` is the
// only run of six consecutive hundred-byte records whose level, current HP,
// max HP and five stats are all in range and consistent; `gPlayerPartyCount`
// is the only byte equal to the party size in the three hundred before it.
// The check is repeatable: `partyOf` re-validates the shape on every read and
// returns null rather than plausible nonsense if the cartridge is not the one
// these addresses describe.

/** Cartridges this knows how to read, by the four-character code in the ROM
 *  header. FireRed and LeafGreen share a layout. */
const KNOWN = {
  BPRE: { name: "FireRed", party: 0x02024284, partyCount: 0x02024029 },
  BPRG: { name: "LeafGreen", party: 0x02024284, partyCount: 0x02024029 },
};

const EWRAM_BASE = 0x02000000;

/** One party slot: eighty bytes of box data, then the fields that only a
 *  Pokémon in a party has. */
const SLOT = 100;
const OFF = { nickname: 8, level: 84, hp: 86, maxHp: 88 };

// The games store text in their own character set. Only the printable run
// matters here: everything else in a nickname is padding.
function decodeName(bytes) {
  let out = "";
  for (const byte of bytes) {
    if (byte === 0xff) break;
    if (byte === 0x00) out += " ";
    else if (byte >= 0xa1 && byte <= 0xaa) out += String.fromCharCode(48 + byte - 0xa1);
    else if (byte >= 0xbb && byte <= 0xd4) out += String.fromCharCode(65 + byte - 0xbb);
    else if (byte >= 0xd5 && byte <= 0xee) out += String.fromCharCode(97 + byte - 0xd5);
    else if (byte === 0xae) out += "-";
    else if (byte === 0xb0) out += "…";
    else out += "";
  }
  return out.trim();
}

export function supports(code) {
  return Object.prototype.hasOwnProperty.call(KNOWN, code);
}

export function gameName(code) {
  return KNOWN[code] ? KNOWN[code].name : null;
}

/**
 * The player's party, or null if this cartridge is not one of the ones above
 * or its memory does not currently hold something shaped like a party.
 *
 * `view` is a Uint8Array over the machine's work RAM. It is re-derived by the
 * caller each read: WebAssembly memory can move when it grows, and a stale
 * view reads whatever is there now.
 */
export function partyOf(view, code) {
  const map = KNOWN[code];
  if (!map || !view) return null;

  const count = view[map.partyCount - EWRAM_BASE];
  if (!(count >= 1 && count <= 6)) return null;

  const base = map.party - EWRAM_BASE;
  const read16 = (at) => view[at] | (view[at + 1] << 8);
  const party = [];
  for (let slot = 0; slot < count; slot++) {
    const at = base + slot * SLOT;
    const level = view[at + OFF.level];
    const hp = read16(at + OFF.hp);
    const maxHp = read16(at + OFF.maxHp);
    // The same shape test that found the array in the first place. A party
    // read mid-write, or from a cartridge that merely shares a game code,
    // fails it -- and a policy acting on nonsense is worse than one that
    // waits.
    if (!(level >= 1 && level <= 100)) return null;
    if (!(maxHp >= 1 && maxHp <= 999) || hp > maxHp) return null;
    party.push({
      slot,
      name: decodeName(view.subarray(at + OFF.nickname, at + OFF.nickname + 10)),
      level,
      hp,
      maxHp,
      fainted: hp === 0,
    });
  }
  return party;
}

/** A view over the running machine's work RAM. */
export function ewram(core) {
  const ptr = core.gba_ewram();
  if (!ptr) return null;
  return new Uint8Array(core.memory.buffer, ptr, core.gba_ewram_len());
}
