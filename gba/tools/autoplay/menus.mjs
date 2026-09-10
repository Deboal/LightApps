// menus.mjs — things done through the game's own menus.
//
// Every routine here follows one rule: press towards the intended state, then
// read the game to find out whether it happened, and say so plainly if it did
// not. Menu layouts in these games are not fixed — the party submenu grows an
// entry for each field move the selected Pokémon knows, so SWITCH is the
// second item for a Charmeleon and the third for a Beedrill that knows Cut.
// A script that counts presses is a script that quietly does the wrong thing
// on someone else's party.

import { BTN, game } from "./machine.mjs";

const tap = (machine, key, then = 30) => machine.press(key, { hold: 4, then });

/** The party order, as short names, for checking against. */
export const order = (machine) => (machine.look().party || []).map((mon) => mon.name);

/**
 * Move a party member into the lead.
 *
 * Only the Pokémon that fights earns experience, so training the third
 * member of a party means putting it first — otherwise a grind runs all night
 * and the intended Pokémon gains nothing, which is exactly what the first
 * attempt at this did.
 *
 * The submenu index for SWITCH is searched rather than assumed, and the whole
 * thing is verified against the party afterwards.
 */
export function leadWith(machine, slot, { attempts = 4 } = {}) {
  const before = order(machine);
  if (slot === 0) return { ok: true, order: before, note: "already leading" };
  const wanted = before[slot];
  if (!wanted) return { ok: false, reason: `no party member in slot ${slot}` };

  for (let switchAt = 1; switchAt <= attempts; switchAt++) {
    // Open the party from the field menu.
    tap(machine, BTN.START, 50);
    tap(machine, BTN.DOWN, 30); // POKéMON
    tap(machine, BTN.A, 90);
    // One press per slot. The first is eaten while the screen opens, which is
    // why this is slot + 1 rather than slot.
    for (let i = 0; i < slot + 1; i++) tap(machine, BTN.DOWN, 30);
    tap(machine, BTN.A, 60); // SUMMARY / [field moves] / SWITCH / ITEM / CANCEL
    for (let i = 0; i < switchAt; i++) tap(machine, BTN.DOWN, 30);
    tap(machine, BTN.A, 60); // "Move to where?"
    tap(machine, BTN.LEFT, 30); // the lead is the box on its own
    tap(machine, BTN.A, 180);

    const after = order(machine);
    if (after[0] === wanted) {
      for (let i = 0; i < 4; i++) tap(machine, BTN.B, 40);
      return { ok: true, order: after, switchAt };
    }
    // Back out and try the next submenu position.
    for (let i = 0; i < 5; i++) tap(machine, BTN.B, 40);
  }
  return { ok: false, reason: `could not move ${wanted} into the lead`, order: order(machine) };
}

/**
 * Save the game.
 *
 * This is not bookkeeping — it is the whole deliverable. The cartridge save
 * is flash, and reading it back gives whatever the game last wrote there, not
 * what is in RAM. Hours of play that were never saved export as a file with
 * none of it in, and nothing about the file says so.
 *
 * Finding SAVE in the field menu is the fiddly part, and two facts defeat
 * counting presses: the menu remembers where its cursor was (leaving the
 * party screen leaves it on POKéMON), and it wraps, so there is no way to
 * pin it to the top by holding UP.
 *
 * So this walks one entry at a time and asks the machine after each: did the
 * cartridge get written? Every wrong entry opens something harmless — the
 * Pokédex, the bag, the trainer card — which B closes, leaving the cursor
 * where it was, so one DOWN really is one entry.
 */
export function saveGame(machine, { entries = 8 } = {}) {
  tap(machine, BTN.START, 60);
  for (let step = 0; step <= entries; step++) {
    const before = machine.save();
    tap(machine, BTN.A, 120);
    // "Save the game?" and then, when a file already exists, "overwrite it?".
    // Both take A, and the write to flash needs a moment to land.
    for (let i = 0; i < 5; i++) tap(machine, BTN.A, 120);
    for (let i = 0; i < 240; i++) machine.step(0);

    const after = machine.save();
    if (before && after && !before.equals(after)) {
      for (let i = 0; i < 4; i++) tap(machine, BTN.B, 40);
      return { ok: true, bytes: after.length, entry: step };
    }
    // Whatever that opened, close it, and move to the next entry.
    for (let i = 0; i < 5; i++) tap(machine, BTN.B, 50);
    tap(machine, BTN.START, 60); // in case B closed the menu itself
    tap(machine, BTN.DOWN, 30);
  }
  return { ok: false, reason: "no field-menu entry wrote to the cartridge" };
}

/** Whether the machine is back in a walkable overworld. */
export function walkable(machine) {
  const before = machine.look().position;
  if (!before) return false;
  for (const way of [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN]) {
    for (let i = 0; i < 30; i++) machine.step(way);
    for (let i = 0; i < 10; i++) machine.step(0);
    const after = machine.look();
    if (after.inBattle) return true;
    if (after.position && !game.sameTile(before, after.position)) return true;
  }
  return false;
}

/**
 * Heal at a Pokémon Center, from the door outside to back out again.
 *
 * The nurse is an object event in the map's own data — (7,2) in every
 * Center — but you do not stand next to her: (7,3) is the counter, which is
 * solid. The player stands at (7,4) and talks across it, which the collision
 * grid says plainly and a guess does not. What it does have to do is know when it worked,
 * and it does: the party reads full. Text that never ends and a party that
 * never fills are the same thing on screen and different things in memory.
 */
export async function healHere(machine, { goTo, BTN: B = BTN } = {}) {
  const whole = () => {
    const party = machine.look().party;
    return party && party.length > 0 && party.every((mon) => mon.hp === mon.maxHp);
  };
  if (whole()) return { ok: true, note: "nothing to heal" };

  // In through the door: the warp is the tile the player is facing.
  for (let i = 0; i < 90; i++) machine.step(B.UP);
  for (let i = 0; i < 60; i++) machine.step(0);
  const inside = machine.look().position;
  if (!inside) return { ok: false, reason: "lost the player at the door" };

  // Up to the counter.
  const walked = goTo(machine, {
    mapGroup: inside.map.mapGroup,
    mapNum: inside.map.mapNum,
    x: 7,
    y: 4,
  });
  if (!walked.ok) return { ok: false, reason: `could not reach the counter: ${walked.reason}` };

  // Face her and talk. The whole exchange is A presses; what matters is the
  // party, so that is what is watched.
  for (let i = 0; i < 20; i++) machine.step(B.UP);
  for (let waited = 0; waited < 4000; waited++) {
    if (whole()) break;
    machine.step(waited % 14 < 5 ? B.A : 0);
  }
  if (!whole()) return { ok: false, reason: "stood at the counter and was never healed" };

  // Getting out again is the fiddly part, and the trap is symmetric. The
  // party reads full while the nurse still has three boxes of text to go, so
  // stopping there leaves the game sitting on a "▼" forever. But mashing A
  // past the last box talks to her again — the player is standing at the
  // counter facing her — and starts the whole conversation over. Either
  // mistake looks exactly like a frozen game, and I diagnosed it as one.
  //
  // The way out is to try leaving *before* pressing anything. A step that
  // works means the dialogue is over; a step that does not means a box is up,
  // and only then is A the right answer. So A is never pressed at a nurse who
  // has finished talking.
  let left = false;
  for (let attempt = 0; attempt < 60 && !left; attempt++) {
    const before = machine.look().position;
    for (let i = 0; i < 40; i++) machine.step(B.DOWN);
    for (let i = 0; i < 10; i++) machine.step(0);
    const after = machine.look().position;
    if (!after) continue;
    if (after.map.mapNum !== inside.map.mapNum) { left = true; break; }
    if (!game.sameTile(before, after)) {
      // Free to walk. Straight south, out of the door.
      for (let i = 0; i < 400; i++) {
        const where = machine.look().position;
        if (!where || where.map.mapNum !== inside.map.mapNum) { left = true; break; }
        machine.step(B.DOWN);
      }
      break;
    }
    // Still boxed in: one press to advance the text, and look again.
    machine.press(B.A, { hold: 4, then: 30 });
  }
  for (let i = 0; i < 60; i++) machine.step(0);
  const back = machine.look().position;
  if (!back || back.map.mapNum === inside.map.mapNum) {
    return { ok: false, reason: "healed, but could not get back out" };
  }
  return { ok: true, at: back };
}
