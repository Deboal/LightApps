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

import { decode } from "./mon.js";

/** Cartridges this knows how to read, by the four-character code in the ROM
 *  header. FireRed and LeafGreen share a layout. */
const KNOWN = {
  BPRE: {
    name: "FireRed",
    party: 0x02024284,
    partyCount: 0x02024029,
    main: 0x030030f0,
    saveBlock: 0x03005008,
    // Battle menus. These two are ROM addresses of a specific build, so
    // unlike the RAM layout above they are emphatically not shared with
    // LeafGreen -- a different build puts its code somewhere else. Absent
    // them, `battleMenuOf` returns nothing and the runner falls back to
    // mashing A, which is what it did before any of this.
    controllerFuncs: 0x03004fe0,
    actionCursor: 0x02023ff8,
    moveCursor: 0x02023ffc,
    battlerParty: 0x0203b0a8,
    atActionMenu: 0x0802e44d,
    atMoveList: 0x0802ea25,
    atPartyMenu: 0x08030699,
  },
  BPRG: { name: "LeafGreen", party: 0x02024284, partyCount: 0x02024029, main: 0x030030f0, saveBlock: 0x03005008 },
};

const EWRAM_BASE = 0x02000000;
const IWRAM_BASE = 0x03000000;

/** `gMain` is the game's per-frame bookkeeping struct, and the one field worth
 *  reading out of it is whether a battle is happening. It was found the same
 *  way as the party: the only word in IWRAM advancing by exactly forty over
 *  forty frames is its vblank counter, and the three callback pointers ahead
 *  of it all land in ROM, which nothing else at that address would.
 *
 *  The offset and the bit come from the game's own source rather than from
 *  observation -- unlike the party, this flag has never been *watched* turning
 *  on here. So nothing downstream trusts it on its own: the policy runner
 *  cross-checks it against HP actually falling and stops if the two disagree.
 *  Read `inBattleOf` as evidence, not as fact. */
const MAIN_FLAGS = 0x439;
const IN_BATTLE = 1 << 1;

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
      // The encrypted half: species, moves, PP, EVs, IVs. Null when the
      // checksum disagrees, which is a record caught mid-write rather than a
      // reason to throw away the plain fields that did read cleanly.
      record: decode(view, at),
    });
  }
  return party;
}

/** Which battle menu is up, and where its cursor is.
 *
 *  `gBattlerControllerFuncs[0]` is a function pointer that *is* the state:
 *  one address while the FIGHT/BAG/POKéMON/RUN menu waits for input, another
 *  while the move list does. Found by diffing a machine's RAM across a single
 *  A press in a real battle -- it was the only word in either RAM that
 *  changed from one ROM pointer to another -- and it stays put while the
 *  cursor moves, which is what makes it a state rather than a step counter.
 *
 *  The cursor is `gMoveSelectionCursor[0]`, and it moves by XOR: left and
 *  right flip bit 0, up and down flip bit 1. So any move is at most two
 *  presses away and the direction within an axis does not matter. Confirmed
 *  against all four values on a real cartridge.
 *
 *  Returns null when this is not a build these addresses describe, and
 *  `{ menu: null }` when a battle is doing something other than waiting for
 *  a menu choice -- text, an animation, or anything unrecognised. The
 *  difference matters: null means do not act on this at all. */
export function battleMenuOf(iwram, ewram, code) {
  const map = KNOWN[code];
  if (!map || !map.controllerFuncs || !iwram || !ewram) return null;

  const at = map.controllerFuncs - IWRAM_BASE;
  if (at < 0 || at + 4 > iwram.length) return null;
  const fn =
    (iwram[at] | (iwram[at + 1] << 8) | (iwram[at + 2] << 16) | (iwram[at + 3] << 24)) >>> 0;

  const cursorAt = map.moveCursor - EWRAM_BASE;
  if (cursorAt < 0 || cursorAt >= ewram.length) return null;

  const at8 = (address) => {
    const o = address - EWRAM_BASE;
    return o >= 0 && o < ewram.length ? ewram[o] : 0;
  };

  return {
    menu:
      fn === map.atActionMenu ? "action"
      : fn === map.atMoveList ? "move"
      // "Choose a POKéMON", which the game also opens by itself when the one
      // that was out faints. Learned by opening it: A picks the highlighted
      // party member, and A again takes SHIFT, which is already under the
      // cursor. Two presses and the next one is out.
      : fn === map.atPartyMenu ? "party"
      : null,
    cursor: at8(map.moveCursor) & 3,
    /** FIGHT 0, BAG 1, POKéMON 2, RUN 3 — the same XOR grid as the moves. */
    action: at8(map.actionCursor) & 3,
    /** Which party member is actually out. Without this a faint leaves the
     *  runner judging the HP of a Pokémon that is no longer fighting. */
    active: map.battlerParty ? at8(map.battlerParty) : 0,
  };
}

/** Where the player is standing.
 *
 *  `gSaveBlock1Ptr` is a word in IWRAM holding the address of SaveBlock1,
 *  which begins with the player's tile and the map they are on. It was found
 *  by walking six tiles left and looking for the only word pair in EWRAM whose
 *  x fell by six while y held -- and then confirmed twice over: the sole
 *  pointer anywhere in the machine to that address, and a second structure
 *  seven tiles away in both axes, which is the map border offset the games
 *  add to object coordinates. Five more fields of the struct then read
 *  correctly without being asked to (party count, the lead's level and HP).
 *
 *  Unlike the battle flag, this needs no faith: press LEFT and x falls by one.
 *  That is what makes it worth building on -- a runner that knows whether it
 *  actually moved can tell being blocked by an item ball from walking, which
 *  is the difference between pacing in a grass patch and bumping into a wall
 *  for ninety seconds. */
const SB = { pos: 0x00, location: 0x04, lastHeal: 0x1c, partyCount: 0x34 };

/** WarpData is eight bytes, not seven: an alignment pad sits after `warpId`,
 *  so the coordinates start at +4. Reading them at +3 gives plausible-looking
 *  nonsense, which is how this was found. */
const warpAt = (view, at) => ({
  mapGroup: view[at],
  mapNum: view[at + 1],
  x: (view[at + 4] | (view[at + 5] << 8)) << 16 >> 16,
  y: (view[at + 6] | (view[at + 7] << 8)) << 16 >> 16,
});

export function positionOf(iwram, ewram, code) {
  const map = KNOWN[code];
  if (!map || !map.saveBlock || !iwram || !ewram) return null;

  const at = map.saveBlock - IWRAM_BASE;
  if (at < 0 || at + 4 > iwram.length) return null;
  const block =
    (iwram[at] | (iwram[at + 1] << 8) | (iwram[at + 2] << 16) | (iwram[at + 3] << 24)) >>> 0;

  // The pointer is the whole verification. SaveBlock1 lives in EWRAM, so an
  // address outside it means the game has not built the block yet, or this
  // cartridge does not keep it here -- either way there is nothing to read.
  const base = block - EWRAM_BASE;
  if (!(base >= 0 && base + 0x40 <= ewram.length)) return null;

  const read16 = (o) => (ewram[o] | (ewram[o + 1] << 8)) << 16 >> 16;
  const x = read16(base + SB.pos);
  const y = read16(base + SB.pos + 2);
  // A map is at most a few hundred tiles across, and the party count is right
  // there to cross-check against. Memory that fails either is not SaveBlock1.
  if (!(x >= 0 && x < 1000 && y >= 0 && y < 1000)) return null;
  const count = ewram[base + SB.partyCount];
  if (!(count >= 1 && count <= 6)) return null;

  return {
    x,
    y,
    map: warpAt(ewram, base + SB.location),
    lastHeal: warpAt(ewram, base + SB.lastHeal),
  };
}

/** Whether two readings are the same tile of the same map. Being blocked and
 *  walking look identical from the buttons; they differ only here. */
export function sameTile(a, b) {
  return (
    !!a && !!b && a.x === b.x && a.y === b.y &&
    a.map.mapGroup === b.map.mapGroup && a.map.mapNum === b.map.mapNum
  );
}

/**
 * Whether the game currently believes it is in a battle, or null if this
 * cartridge is not one it can read. See MAIN_FLAGS above for why this is
 * evidence rather than fact.
 */
export function inBattleOf(view, code) {
  const map = KNOWN[code];
  if (!map || !view) return null;
  const at = map.main + MAIN_FLAGS - IWRAM_BASE;
  if (at < 0 || at >= view.length) return null;
  return (view[at] & IN_BATTLE) !== 0;
}

/** A view over the running machine's work RAM. */
export function ewram(core) {
  const ptr = core.gba_ewram();
  if (!ptr) return null;
  return new Uint8Array(core.memory.buffer, ptr, core.gba_ewram_len());
}

/** A view over the machine's fast internal RAM, where gMain lives. Both of
 *  these are rebuilt on every read on purpose: WebAssembly memory moves when
 *  it grows, and a view held across that reads whatever is there now. */
export function iwram(core) {
  const ptr = core.gba_iwram();
  if (!ptr) return null;
  return new Uint8Array(core.memory.buffer, ptr, core.gba_iwram_len());
}
