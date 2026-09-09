// machine.mjs — a Game Boy Advance you can drive from a script.
//
// The emulator already runs in three places: a browser tab, a Rust binary, and
// the checks. This is the fourth and the most useful one for getting work
// done: the same wasm core the app ships, booted from a real cartridge and
// save, stepped a frame at a time, with the game's own memory readable through
// the same decoders the app uses.
//
// What that buys is a loop that can *see*. A script that presses buttons
// blind has to be written by guessing and debugged by watching; a script that
// reads the party, the tile and the menu state can check after every press
// whether the thing it intended actually happened. Every routine built on top
// of this follows the same shape: press towards a state, look, and only move
// on once the machine agrees.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import * as game from "../../../apps/gba/src/game.js";
import { MOVES, moveName } from "../../../apps/gba/src/moves.js";
import { BTN } from "../../../apps/gba/src/buttons.js";

export { BTN, MOVES, moveName, game };

const WIDTH = 240;
const HEIGHT = 160;

/** Boot a cartridge. `save` is optional; without one the game starts fresh. */
export async function boot({ rom, save, code = "BPRE" }) {
  const wasm = readFileSync(new URL("../../../apps/gba/assets/gba-core.wasm", import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const core = instance.exports;

  const into = (bytes) => {
    const ptr = core.gba_alloc(bytes.length);
    new Uint8Array(core.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  };

  const romBytes = readFileSync(rom);
  const savBytes = save ? readFileSync(save) : null;
  const ok = core.gba_init(
    into(romBytes),
    romBytes.length,
    savBytes ? into(savBytes) : 0,
    savBytes ? savBytes.length : 0
  );
  if (!ok) throw new Error("the core refused this cartridge");

  let frames = 0;

  const machine = {
    core,
    code,
    get frames() {
      return frames;
    },

    /** One frame with `keys` held. */
    step(keys = 0) {
      core.gba_run_frame(keys);
      frames++;
    },

    /** Everything the app reads, read the same way. Views are rebuilt every
     *  call because WebAssembly memory moves when it grows. */
    look() {
      const ewram = game.ewram(core);
      const iwram = game.iwram(core);
      return {
        party: game.partyOf(ewram, code),
        inBattle: game.inBattleOf(iwram, code) === true,
        battle: game.battleMenuOf(iwram, ewram, code),
        position: game.positionOf(iwram, ewram, code),
      };
    },

    /**
     * Hold `keys` until `done(state)` is true, or give up.
     *
     * The give-up is the point. A press that does not produce the state it
     * was aimed at means the model of the game is wrong, and finding that out
     * in two seconds beats a script that presses hopefully for an hour.
     */
    until(done, { keys = 0, limit = 600, tap = 0 } = {}) {
      for (let waited = 0; waited < limit; waited++) {
        const state = machine.look();
        if (done(state, waited)) return { ok: true, waited, state };
        machine.step(tap ? (waited % tap < 4 ? keys : 0) : keys);
      }
      return { ok: false, waited: limit, state: machine.look() };
    },

    /** A single press: hold, then release, so the game sees an edge. */
    press(keys, { hold = 6, then = 10 } = {}) {
      for (let i = 0; i < hold; i++) machine.step(keys);
      for (let i = 0; i < then; i++) machine.step(0);
    },

    /** The current frame as a PNG, for when a number is not enough. */
    shoot(path) {
      const ptr = core.gba_pixels();
      const rgba = new Uint8Array(core.memory.buffer, ptr, WIDTH * HEIGHT * 4);
      writeFileSync(path, png(rgba, WIDTH, HEIGHT));
      return path;
    },

    /** The cartridge save, as the app would export it. */
    save() {
      const length = core.gba_read_save();
      if (!length) return null;
      const ptr = core.gba_transfer_ptr();
      return Buffer.from(new Uint8Array(core.memory.buffer, ptr, length).slice());
    },
  };

  return machine;
}

/**
 * Past the title screen and into the saved game.
 *
 * Two things make this harder than it looks, and both cost an hour to find.
 *
 * The obvious test — "is a party readable" — is wrong: the save is parsed
 * into RAM while the title screen is still up, so the party and the player's
 * tile both read correctly thousands of frames before the game is playable.
 * The title's attract demo even walks a player around several maps.
 *
 * And the obvious fix — "mash A, then check whether a direction moves you" —
 * is also wrong, because A in the overworld talks to whoever is standing
 * nearby and holds the text box open, so the walk never happens. The mashing
 * that gets you in is the mashing that keeps you still.
 *
 * So: mash A only until the player has been on one tile of one map long
 * enough that the attract demo cannot be what is happening, then let go of A
 * entirely and prove it by walking.
 */
export function resume(machine, { limit = 20000 } = {}) {
  let still = 0;
  let last = null;
  let waited = 0;

  // Through the title and the save menu, watching for the game to settle.
  while (waited < limit) {
    machine.step(waited % 24 < 6 ? BTN.A : 0);
    waited++;
    const here = machine.look().position;
    if (here && last && game.sameTile(here, last)) still++;
    else still = 0;
    last = here;
    if (still > 300) break;
  }

  // Hands off A. Anything it opened needs to close before a walk registers.
  for (let i = 0; i < 60; i++) machine.step(BTN.B);
  for (let i = 0; i < 30; i++) machine.step(0);

  const before = machine.look().position;
  for (const way of [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN]) {
    for (let i = 0; i < 30; i++) machine.step(way);
    for (let i = 0; i < 10; i++) machine.step(0);
    const after = machine.look();
    // Walking into a wild encounter is proof of a playable overworld too.
    if (after.inBattle || (after.position && before && !game.sameTile(before, after.position))) {
      return after;
    }
  }
  throw new Error("reached something, but it does not accept a walk");
}

// -- a minimal PNG writer ----------------------------------------------------
// Node ships zlib but no image encoder, and pulling one in for four calls
// would be a dependency to maintain. This is the whole format for one case:
// eight-bit RGBA, no interlacing.
function png(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1
    );
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)) >>> 0, 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c;
}
