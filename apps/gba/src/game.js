// game.js — what the emulator can see of the game it is running.
//
// The core is a Game Boy Advance and knows nothing about Pokémon. This is the
// decoder ring: a handful of addresses in the cartridge's work RAM, and the
// structs they point at. It exists so that something driving the game — a
// policy, a readout — can act on what is actually true rather than on what a
// screenshot appears to show.
//
// The addresses come from `symbols.js`, which is generated (see the table
// below). The shape test that originally found them is still here and still
// runs: `partyOf` re-validates on every read and returns null rather than
// plausible nonsense. A named address and a shape that fits are different
// kinds of evidence, and the second one still catches a record read
// mid-write, which no address can.

import { decode } from "./mon.js";
import { SYMBOLS, PARTY_MENU_SLOT } from "./symbols.js";

/** Cartridges this knows how to read, by the four-character code in the ROM
 *  header.
 *
 *  The addresses are no longer found by searching a running machine's RAM for
 *  the shape they must have. That method worked -- and produced one answer
 *  that was wrong for weeks. `0x0203b0a8`, believed to be "which Pokémon is
 *  out in battle", is nine bytes into `gPartyMenu`; it reads zero in an
 *  ordinary battle, which is the right answer for the wrong reason, so it
 *  never failed loudly. They come from the decompilation's own symbol files
 *  now (`tools/gen-symbols.mjs`), which agreed with every hand-found address
 *  except that one.
 *
 *  FireRed and LeafGreen share their RAM layout exactly -- checked across both
 *  published builds, not assumed -- so both get the same table. The battle
 *  menus are ROM code addresses and do differ between builds, which is why
 *  they are lists: the running one is recognised rather than assumed, and a
 *  build in neither list simply fails to match and falls back to mashing A,
 *  which is what this did before any of it.
 */
const LAYOUT = {
  party: SYMBOLS.gPlayerParty,
  partyCount: SYMBOLS.gPlayerPartyCount,
  main: SYMBOLS.gMain,
  saveBlock: SYMBOLS.gSaveBlock1Ptr,
  controllerFuncs: SYMBOLS.gBattlerControllerFuncs,
  actionCursor: SYMBOLS.gActionSelectionCursor,
  moveCursor: SYMBOLS.gMoveSelectionCursor,
  battlerParty: SYMBOLS.gBattlerPartyIndexes,
  partyMenuSlot: PARTY_MENU_SLOT,
  fieldLocked: SYMBOLS.sLockFieldControls,
  partyMenu: SYMBOLS.gPartyMenu,
  partyMenuInternal: SYMBOLS.sPartyMenuInternal,
  listMenu: SYMBOLS.sMenu,
  battleType: SYMBOLS.gBattleTypeFlags,
  atActionMenu: SYMBOLS.HandleInputChooseAction,
  atMoveList: SYMBOLS.HandleInputChooseMove,
  atPartyMenu: SYMBOLS.WaitForMonSelection,
};

const KNOWN = {
  BPRE: { name: "FireRed", ...LAYOUT },
  BPRG: { name: "LeafGreen", ...LAYOUT },
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

/** `BATTLE_TYPE_TRAINER`, from the game's own constants. */
const BATTLE_TYPE_TRAINER = 1 << 3;

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
 *  presses away -- but *which* of the two directions is not free, because the
 *  cursor does not wrap. RIGHT from the right-hand column does nothing at all.
 *  `cursorStep` in `buttons.js` is the only place that should decide this; the
 *  sentence that used to be here said the direction did not matter and cost a
 *  full minute of pressing RIGHT at a move with no PP.
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
  const at32 = (address) => {
    const o = address - EWRAM_BASE;
    if (o < 0 || o + 4 > ewram.length) return 0;
    return (ewram[o] | (ewram[o + 1] << 8) | (ewram[o + 2] << 16) | (ewram[o + 3] << 24)) >>> 0;
  };

  return {
    /** The raw controller pointer. Kept so a build whose menus this does not
     *  recognise can *say* the number instead of silently doing nothing --
     *  which is exactly how a wrong one went unnoticed. */
    fn,
    menu:
      // A list per build, because these are ROM code addresses and the two
      // published builds put them twenty bytes apart. Matching against the
      // list is its own proof that the right one was found.
      map.atActionMenu.includes(fn) ? "action"
      : map.atMoveList.includes(fn) ? "move"
      // "Choose a POKéMON", which the game also opens by itself when the one
      // that was out faints. Learned by opening it: A picks the highlighted
      // party member, and A again takes SHIFT, which is already under the
      // cursor. Two presses and the next one is out.
      : map.atPartyMenu.includes(fn) ? "party"
      : null,
    cursor: at8(map.moveCursor) & 3,
    /** FIGHT 0, BAG 1, POKéMON 2, RUN 3 — the same XOR grid as the moves. */
    action: at8(map.actionCursor) & 3,
    /** Which party member is actually out.
     *
     *  `gBattlerPartyIndexes` is one entry per battler and the player is the
     *  first, so the low byte of entry zero is the slot. This used to read
     *  `gPartyMenu + 8` instead -- the party menu's *type* -- which is zero in
     *  an ordinary battle and so looked correct until the menu opened. */
    active: at8(map.battlerParty),
    /** Where the cursor sits in the party menu, in battle or out of it. */
    slot: at8(map.partyMenuSlot),
    /** Whether this is a trainer, who cannot be run from.
     *
     *  Worth the address on its own. A run interrupted by a battle wants to
     *  leave, so it steers the cursor to RUN and presses A -- and against a
     *  trainer the game answers "No! There's no running from a trainer
     *  battle!" and puts the cursor back. Nothing could see that, so the
     *  policy pressed RUN at the Nugget Bridge for a full minute and then
     *  reported that the battle had stopped responding. The battle was
     *  responding perfectly. */
    trainer: (at32(map.battleType) & BATTLE_TYPE_TRAINER) !== 0,
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

/**
 * Whether the game currently has the controls.
 *
 * `sLockFieldControls` is one byte that the overworld sets whenever a script,
 * a cutscene or a message box is in charge, and clears when the player can
 * walk again. It is the direct answer to the question every freeze in this
 * app has really been asking.
 *
 * Before this, the answer was inferred: press a direction for two seconds, and
 * if the tile never changed, guess that something is on screen and press A.
 * That works, and it is slow, and it cannot tell a message box from a wall.
 * "CLEFAIRY fainted…" sat there for as long as the guard allowed because
 * nothing could see the box.
 *
 * Null rather than false when it cannot be read: not knowing and knowing there
 * is no lock are different, and a caller that treats them the same is the
 * mistake this file keeps making.
 */
export function fieldLockedOf(iwram, code) {
  const map = KNOWN[code];
  if (!map || !map.fieldLocked || !iwram) return null;
  const at = map.fieldLocked - IWRAM_BASE;
  if (at < 0 || at >= iwram.length) return null;
  return iwram[at] !== 0;
}

/**
 * `MENU_*`, the ids the party submenu is built from.
 *
 * Read rather than counted. The submenu is not a fixed list -- it grows an
 * entry for every field move the selected Pokémon knows -- and the two ways to
 * cope with that are to compute the offset or to find out. Computing it means
 * keeping a list of every field move in the game and being right about it
 * forever. Finding out means reading four bytes.
 *
 * What made this worth doing rather than interesting: the old code searched by
 * *trying*. It pressed A on entry one, saw whether the party had reordered,
 * pressed A on entry two, and so on. Entry three is ITEM, and pressing A there
 * opens GIVE, and the next A in the sequence gave a Moon Stone to the player's
 * Charizard. A menu where the wrong guess costs somebody an item is a menu you
 * read before you press.
 */
export const MENU = { SUMMARY: 0, SWITCH: 1, CANCEL: 2, ITEM: 3, GIVE: 4, TAKE: 5, SHIFT: 10 };

/** `gPartyMenu.action` while a Pokémon is held, waiting to be put somewhere. */
const SWITCHING = 8;

/**
 * The party menu as something to act on: which entries its submenu is
 * offering, where the cursor is, and which slot is held.
 *
 * Null when nothing can be read. Every field is a fact from the game's own
 * memory, so a caller can press one button and then check that the thing it
 * meant actually happened -- which is the rule this app keeps re-learning.
 */
export function partyMenuOf(ewram, code) {
  const map = KNOWN[code];
  if (!map || !map.partyMenuInternal || !ewram) return null;

  const at8 = (address) => {
    const o = address - EWRAM_BASE;
    return o >= 0 && o < ewram.length ? ewram[o] : 0;
  };
  const at32 = (address) => {
    const o = address - EWRAM_BASE;
    if (o < 0 || o + 4 > ewram.length) return 0;
    return (ewram[o] | (ewram[o + 1] << 8) | (ewram[o + 2] << 16) | (ewram[o + 3] << 24)) >>> 0;
  };

  // The scratch struct is allocated when the screen opens and freed when it
  // closes, so a null pointer is the ordinary answer for "no party menu".
  const internal = at32(map.partyMenuInternal);
  let actions = null;
  if (internal > EWRAM_BASE && internal < EWRAM_BASE + ewram.length) {
    const count = at8(internal + 23);
    // Eight is the array's size. A count outside it means this is not the
    // struct -- freed memory, a build that moved it -- and the honest answer
    // is that the entries are unknown, never a list read out of whatever is
    // there now.
    if (count >= 1 && count <= 8) {
      actions = [];
      for (let i = 0; i < count; i++) actions.push(at8(internal + 15 + i));
    }
  }

  return {
    /**
     * Whether the party screen is up at all.
     *
     * The scratch struct is allocated when it opens and freed when it closes,
     * so this is the game's own answer rather than an inference from a cursor
     * that might just be stale. It matters because every other field here
     * reads zero in the overworld, and zero is a legitimate cursor position --
     * a caller that cannot tell "closed" from "on the first entry" starts
     * pressing at a game that is not listening.
     */
    open: internal > EWRAM_BASE && internal < EWRAM_BASE + ewram.length,
    /** The submenu entries as `MENU_*` ids, or null when they cannot be read. */
    actions,
    /** Where the cursor sits in whichever list menu is up. */
    cursor: at8(map.listMenu + 2),
    /** The last valid index, so a cursor can be walked without falling off. */
    lastIndex: at8(map.listMenu + 4),
    /** The party slot under the cursor, or being held during a switch. */
    slot: at8(map.partyMenu + 9),
    /** Where a held Pokémon will go when A is pressed. */
    moveTo: at8(map.partyMenu + 10),
    /** True once SWITCH has been taken and the game is asking "move where?". */
    switching: at8(map.partyMenu + 11) === SWITCHING,
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
