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

/**
 * The press that moves a 2×2 battle cursor one step towards `want`.
 *
 * Both battle menus are two by two — FIGHT / BAG over POKéMON / RUN, and the
 * four moves — and the cursor moves by XOR: left and right flip bit 0, up and
 * down flip bit 1. So any target is at most two presses away.
 *
 * What that does *not* mean, and what cost a run to find out: the direction
 * within an axis is not free. **The cursor does not wrap.** RIGHT from the
 * right-hand column is a no-op and DOWN from the bottom row is a no-op, and
 * pressing one of those is indistinguishable from pressing nothing.
 *
 * Every caller used to press RIGHT for bit 0 and DOWN for bit 1 regardless of
 * where the cursor was. From FIGHT that works, which is why it survived; from
 * anywhere on the right or the bottom it presses into a wall forever. A
 * CHARMELEON sat on METAL CLAW — the bottom-right move, out of PP — pressing
 * RIGHT at it for a full minute while SCRATCH waited at the top left with
 * thirty-five PP. The same hole is why a battle this ran from could not get
 * its cursor back off RUN.
 *
 * Returns 0 when the cursor is already where it should be, which is the
 * caller's cue to press A.
 */
export function cursorStep(at, want) {
  // A partial read gives no cursor at all, and a menu with no cursor is not a
  // menu to press directions into -- but treating it as the top left is the
  // same guess the game itself starts from, and it self-corrects on the next
  // read. What must not happen is NaN turning into a press of nothing.
  const from = Number.isInteger(at) ? at & 3 : 0;
  const differs = from ^ (want & 3);
  if (differs & 1) return from & 1 ? BTN.LEFT : BTN.RIGHT;
  if (differs & 2) return from & 2 ? BTN.UP : BTN.DOWN;
  return 0;
}
