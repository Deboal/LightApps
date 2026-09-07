// buttons.js — the ten bits the core reads as a controller.
//
// This lives on its own because two unrelated things need it: the shell, which
// turns a keyboard and a touch pad into these bits, and the policy runner,
// which produces them with nobody touching anything. Neither should own the
// definition, and a second copy of a bitmask is a bug waiting for the day
// somebody adds a button.

/** Must match KeyState in gba-core. */
export const BTN = {
  A: 1 << 0,
  B: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  RIGHT: 1 << 4,
  LEFT: 1 << 5,
  UP: 1 << 6,
  DOWN: 1 << 7,
  R: 1 << 8,
  L: 1 << 9,
};

// Any direction. The run latch keys off this: B is only held while the
// character is actually moving, so a latched run never leaks into a menu,
// where a held B would back straight out of it.
export const DPAD = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT;
