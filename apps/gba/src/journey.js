// journey.js — getting somewhere and back, written as if nothing were async.
//
// These are the routines that levelled a Charmeleon into a Charizard, moved
// out of the headless harness and into the tab. They read as ordinary
// imperative code because `drive.js` makes that possible: every
// `const state = yield BUTTONS` is one frame pressed and the result observed.
//
// Every one of them obeys the same rule, which is the only thing here worth
// remembering:
//
//     press towards a state, look, and only move on once the game agrees.
//
// The comments below say which specific failure each defensive line exists to
// prevent, because every one of them cost a run.

import { BTN, cursorStep } from "./buttons.js";
import { hold, settle, tap, beat } from "./drive.js";
import { bestMove, spent } from "./policy.js";
import { pathToAny, path, edgeTiles, DIR } from "./world.js";
import { MENU } from "./game.js";
import { sameMon, slotOfMon } from "./recovery.js";

/** Frames to keep pressing towards a tile before calling it blocked. A step is
 *  sixteen frames and a turn on the spot eight, so ninety is many steps' worth
 *  of patience -- this fires for walls and for people, not for slowness. */
const PATIENCE = 90;

const sameSpot = (a, b) =>
  a && b && a.x === b.x && a.y === b.y &&
  a.map.mapGroup === b.map.mapGroup && a.map.mapNum === b.map.mapNum;

const onMap = (here, m) =>
  here && here.map.mapGroup === m.mapGroup && here.map.mapNum === m.mapNum;

/** The direction that takes you from one tile to the one next to it. */
const towards = (from, to) =>
  to.x > from.x ? BTN.RIGHT : to.x < from.x ? BTN.LEFT : to.y > from.y ? BTN.DOWN : BTN.UP;

const whole = (party) =>
  party && party.length > 0 && party.every((mon) => mon.hp === mon.maxHp);

/**
 * Get through a battle, whatever kind it is.
 *
 * Running was the first attempt and it was not enough: the routes between
 * towns are lined with trainers, and a trainer battle cannot be fled. A
 * traveller that only knows how to run stops dead at the first one — which is
 * exactly what happened, reported as "could not get out of a battle" two tiles
 * from where it set off.
 *
 * So it fights by default and runs only when the Pokémon that is out is hurt
 * or has nothing left to hit with. Fighting is also the better trade on the
 * way somewhere: the trainers are worth more than the wild Pokémon walked past.
 */
export function* throughBattle({ runBelow = 0.3, prefer = "fight", limit = 60 * 60 * 10 } = {}) {
  // Running is free when it works and impossible when it does not. So "run"
  // is a preference, not a plan: try it, and once enough turns have gone by
  // with the battle still going, this is a trainer and the only way out is
  // through.
  let asked = 0;
  let running = prefer === "run";
  let state = yield 0;

  for (let frame = 0; frame < limit; frame++) {
    if (!state || !state.inBattle) return { ok: true, frames: frame };
    const on = beat(frame);
    const battle = state.battle;
    const active = battle && Number.isInteger(battle.active) ? battle.active : 0;
    const party = state.party || [];
    const fighter = party[active] || party[0];
    const share = fighter && fighter.maxHp ? fighter.hp / fighter.maxHp : 1;
    const want = fighter && bestMove(fighter);
    // Out of PP is a reason to stop fighting; a record that did not decode
    // this frame is not. They look identical through `bestMove`, so the
    // difference has to be asked for.
    const flee = running || share < runBelow || (fighter && spent(fighter));

    // No menu read means this build's battle addresses are unknown, and the
    // only honest move is A -- which takes the first move rather than the
    // best one. That is a worse fight, not a broken one.
    if (!battle || !battle.menu || battle.menu === "party") {
      state = yield on ? BTN.A : 0;
      continue;
    }
    if (battle.menu === "action") {
      if (running && ++asked > 6) running = false;
      // FIGHT is 0 and RUN is 3 in a two-by-two grid, so the difference
      // between where the cursor is and where it should be says which bit to
      // flip: the low one is the column, the high one the row. Which *press*
      // flips it depends on where the cursor is, because the grid does not
      // wrap -- `cursorStep` owns that, and it is the only place that should.
      const step = cursorStep(battle.action, flee ? 3 : 0);
      state = yield on ? (step || BTN.A) : 0;
      continue;
    }
    if (battle.menu === "move") {
      if (flee) {
        state = yield on ? BTN.B : 0;
        continue;
      }
      const step = cursorStep(battle.cursor, want.index);
      state = yield on ? (step || BTN.A) : 0;
      continue;
    }
    state = yield on ? BTN.A : 0;
  }
  return { ok: false, reason: "a battle would not end" };
}

/**
 * Walk a planned path, checking every step.
 *
 * The plan comes from the game's own collision data, which knows about walls
 * and knows nothing about ledges, people standing in doorways, or the wild
 * Pokémon that will interrupt halfway. So the plan is a proposal: press
 * towards the next tile, and only advance when the player is actually on it.
 */
export function* walkPath(tiles, { patience = PATIENCE, onStep = null } = {}) {
  let index = 0;
  let tries = 0;
  let state = yield 0;

  while (index < tiles.length) {
    if (!state) { state = yield 0; continue; }
    if (state.inBattle) {
      const out = yield* throughBattle();
      if (!out.ok) return out;
      tries = 0;
      state = yield 0;
      continue;
    }
    const here = state.position;
    if (!here) { state = yield 0; continue; }

    // Skip past tiles already stood on: running covers ground faster than one
    // tile per press, so the plan can be several ahead of the cursor.
    while (index < tiles.length && here.x === tiles[index].x && here.y === tiles[index].y) {
      if (onStep) onStep(here);
      index++;
      tries = 0;
    }
    if (index >= tiles.length) break;

    const next = tiles[index];
    if (Math.abs(next.x - here.x) + Math.abs(next.y - here.y) > 1) {
      // Knocked off the plan — a warp, or a ledge that only goes one way.
      return { ok: false, reason: "left the planned path", at: here, index };
    }
    // B is the run latch. It is held only while a direction is, so it can
    // never leak into a menu, where a held B backs straight out.
    state = yield towards(here, next) | BTN.B;
    if (++tries > patience) {
      return { ok: false, reason: `blocked heading to ${next.x},${next.y}`, at: here, blocked: next };
    }
  }
  return { ok: true, at: (yield 0).position };
}

/**
 * Walk to a tile, crossing maps as needed.
 *
 * The harness this came from could only cross a map edge it was told about by
 * hand. Here the connection and warp graph is on disk, so the route between
 * maps is searched like anything else, and each hop is re-planned from where
 * the player actually landed — which is the only honest way, because the
 * offsets between maps are real and so are the ways a walk goes differently
 * than planned.
 */
export function* goTo(world, target, { hops = 24, allowed = null, patience = PATIENCE } = {}) {
  // Tiles the map calls open and the game refuses. People stand in the way,
  // and they are in no layout file. Re-planning around a refusal is the
  // difference between a walk that arrives and a walk that leans on someone.
  const refused = new Set();
  const key = (here, tile) => `${here.map.mapGroup}/${here.map.mapNum}:${tile.x},${tile.y}`;
  const permitted = (here) =>
    !allowed || allowed.some((m) => onMap(here, m));

  for (let hop = 0; hop < hops; hop++) {
    let state = yield 0;
    if (state && state.inBattle) {
      const out = yield* throughBattle();
      if (!out.ok) return out;
      continue;
    }
    let here = state && state.position;
    if (!here) { yield* settle(10); continue; }

    if (!permitted(here)) {
      // One reading is not evidence. Crossing between maps rewrites the very
      // field this is read from, so a sample taken mid-transition can be
      // anything — and a trip that aborts on a single frame of nonsense is a
      // trip that aborts. Look again, several times, before believing it.
      let strayed = true;
      for (let look = 0; look < 12 && strayed; look++) {
        const again = (yield* settle(20)).position;
        if (again && permitted(again)) { strayed = false; here = again; }
      }
      if (strayed) {
        return { ok: false, reason: `strayed onto map ${here.map.mapGroup}/${here.map.mapNum}`, at: here };
      }
      continue;
    }

    const arrived = onMap(here, target);
    if (arrived && here.x === target.x && here.y === target.y) return { ok: true, at: here };

    const grid = world.gridOf(here.map.mapGroup, here.map.mapNum);
    if (!grid) return { ok: false, reason: "no map data for where the player is", at: here };

    // Doors are walkable and they are not passable: step on one and you are
    // somewhere else. A path across Vermilion otherwise routes through the
    // front door of a house, and the next plan starts in somebody's kitchen.
    // So every warp is a wall — except the one being aimed at.
    const doors = world.doorsOf(here.map.mapGroup, here.map.mapNum);
    const blocked = new Set([...refused].filter((k) => k.startsWith(`${here.map.mapGroup}/${here.map.mapNum}:`))
      .map((k) => k.slice(k.indexOf(":") + 1)));

    // Where this hop is heading: the target itself if it is on this map,
    // otherwise whatever gets us to the next map on the route.
    let goals;
    let leaving = null;
    if (arrived) {
      goals = [{ x: target.x, y: target.y }];
    } else {
      const route = world.mapRoute(here.map, target);
      if (!route || route.length === 0) {
        return { ok: false, reason: "no route to that map", at: here };
      }
      leaving = route[0].via;
      // Every warp to the next map, not only the one the route named. They are
      // not interchangeable -- see `warpsTo` -- and a walk that can only aim
      // at one of them ends at the first inert doormat it finds.
      goals = leaving.kind === "warp"
        ? (world.warpsTo
            ? world.warpsTo(here.map.mapGroup, here.map.mapNum, route[0].to)
            : [])
          .filter((g) => !blocked.has(`${g.x},${g.y}`))
          .concat(blocked.has(`${leaving.x},${leaving.y}`) ? [] : [{ x: leaving.x, y: leaving.y }])
          .filter((g, i, all) => all.findIndex((o) => o.x === g.x && o.y === g.y) === i)
        : edgeTiles(grid, leaving.dir);
      if (!goals.length) {
        // Every way out of this map has been tried and none of them worked.
        if (refused.size) { refused.clear(); continue; }
        return { ok: false, reason: "no way out of this map that works", at: here };
      }
    }

    // Doors and people go in as the overlay rather than as terrain, so the
    // search can tell "walk around this" from "this is where we are going".
    // Folding them into `at` instead would make a door being aimed at
    // unreachable and a wall being aimed at reachable, which is both halves of
    // the same mistake.
    const overlay = new Set([...doors, ...blocked]);
    // Whether this hop is aiming at a door. Every Pokémon Center door is a
    // solid tile — the warp is what lets you through, not the collision — so
    // a goal that is a warp is allowed to be one the terrain refuses. Asking
    // the door list rather than passing a flag around keeps the two answers
    // from ever disagreeing.
    const enterGoal = goals.some((g) => doors.has(`${g.x},${g.y}`));
    const found = pathToAny(grid, here, goals, { blocked: overlay, enterGoal });
    if (!found) {
      // The tiles this walk has been refused are people, and people move.
      // Enough of them along a three-tile corridor severs it, and the planner
      // then reports no path through ground it crossed a minute ago. Forget
      // them and look again before giving up.
      if (refused.size) { refused.clear(); continue; }
      return { ok: false, reason: "no path from here", at: here };
    }

    const walked = yield* walkPath(found.tiles, { patience });
    if (!walked.ok) {
      if (walked.blocked) { refused.add(key(here, walked.blocked)); continue; }
      if (walked.reason !== "left the planned path") return walked;
      continue;
    }

    if (leaving && leaving.kind === "warp") {
      // Long enough for a door to finish fading. A warp that worked is not
      // done being read at twenty frames, and pressing directions at a screen
      // mid-transition is how a tile that works gets written down as one that
      // does not.
      let after = (yield* settle(60)).position;

      // Standing on the warp, still on the same map.
      //
      // "Arriving on the tile is the whole of it" is true of most warps and
      // not of the one that matters most. A Pokémon Center's exit is three
      // mats side by side and exactly one of them is a door: the middle one,
      // and only if you press south while standing on it. Walking onto any of
      // the three -- from the left, from above, at a run -- does nothing at
      // all. Measured on a real cartridge, all nine ways.
      //
      // Nothing above notices. The walk succeeded, the goal tile was reached,
      // so the next pass plans a path of zero tiles to where the player
      // already is, walks it perfectly, and does that until the attempts run
      // out. Told to leave the Cerulean Pokémon Center, this stood on the
      // doormat forty times and then reported that it could not get there.
      if (after && onMap(after, here.map)) {
        // South first and by a distance -- an exit mat is in a building's
        // south wall and the press that opens it is the one that would walk
        // you through it. The others are tried because a door in another wall
        // is not impossible, and stop the moment the pressing walks the
        // player off the tile, since a press from the wrong tile proves
        // nothing about this one.
        for (const way of [BTN.DOWN, BTN.UP, BTN.LEFT, BTN.RIGHT]) {
          yield* hold(way, 24);
          after = (yield* settle(30)).position;
          if (!after || !onMap(after, here.map)) break;
          if (after.x !== found.target.x || after.y !== found.target.y) break;
        }
      }

      // Tried, and still on this map. Whatever that tile is, it is not a way
      // out -- so remember it exactly as a person standing in a doorway is
      // remembered, and let the next pass aim at one of the others.
      //
      // Refused whether or not the pressing wandered off the mat. It was
      // aimed at, it was stood on, it was pressed into, and nothing happened;
      // where the player ended up is not evidence about the tile. Making this
      // conditional on still standing there is how the first version of this
      // walked back to the same doormat forever: pressing left stepped off it,
      // so it was never written down as tried.
      if (after && onMap(after, here.map)) refused.add(key(here, found.target));
      continue;
    }

    // Off the edge into the next map.
    if (leaving && leaving.kind === "edge") {
      const before = (yield 0).position;
      const way = leaving.dir === DIR.DOWN ? BTN.DOWN
        : leaving.dir === DIR.UP ? BTN.UP
        : leaving.dir === DIR.LEFT ? BTN.LEFT : BTN.RIGHT;
      const after = yield* hold(way | BTN.B, 90);
      if (after && after.position && before && after.position.map.mapNum === before.map.mapNum
          && after.position.map.mapGroup === before.map.mapGroup) {
        return { ok: false, reason: "the edge did not lead anywhere", at: after.position };
      }
    }
    yield* settle(20);
  }
  return { ok: false, reason: "too many attempts" };
}

/**
 * Heal at a Pokémon Center: in through the door, talk to the nurse, back out.
 *
 * The counter at (7,3) is solid — you stand at (7,4) and talk across it, which
 * the collision grid says plainly and a guess does not.
 *
 * Getting out again is the part that cost the most. The party reads full while
 * the nurse still has three boxes of text to go, so stopping there leaves the
 * game sitting on a "▼" forever; but mashing A past the last box talks to her
 * again — the player is standing at the counter facing her — and starts the
 * whole conversation over. Both mistakes look exactly like a frozen emulator,
 * and I diagnosed one as exactly that.
 *
 * The way out is to try leaving *before* pressing anything. A step that works
 * means the dialogue is over; a step that does not means a box is up, and only
 * then is A the right answer. So A is never pressed at a nurse who has
 * finished talking.
 */
export function* healInside(world, { limit = 60 * 60 * 4 } = {}) {
  let state = yield 0;
  const inside = state && state.position;
  if (!inside) return { ok: false, reason: "lost the player at the door" };

  // Where she is, from the map's own object events. This was the tile (7,4)
  // for a long time and that is right in sixteen of the nineteen Centres --
  // Indigo Plateau and One Island have different layouts and put her
  // somewhere else entirely, so a constant would walk into a wall there and
  // report never being healed.
  const where = counterOf(world, inside.map);
  if (!where) return { ok: false, reason: "no nurse on this map" };

  const walked = yield* goTo(world, {
    mapGroup: inside.map.mapGroup,
    mapNum: inside.map.mapNum,
    x: where.x,
    y: where.y,
  }, { hops: 6 });
  if (!walked.ok) return { ok: false, reason: `could not reach the counter: ${walked.reason}` };

  // Face her and talk. The whole exchange is A presses; what matters is the
  // party, so that is what is watched.
  yield* hold(BTN.UP, 20);
  let healed = false;
  for (let frame = 0; frame < limit && !healed; frame++) {
    state = yield beat(frame, { on: 5, cycle: 14 }) ? BTN.A : 0;
    healed = state && whole(state.party);
  }
  if (!healed) return { ok: false, reason: "stood at the counter and was never healed" };

  // Healed. Getting out of the building is not this function's job.
  //
  // It used to be, and it did it by holding DOWN and hoping: straight south
  // out of the door, up to sixty times. That works in a Centre whose counter
  // happens to sit above the one mat that opens, and reports "healed, but
  // could not get back out" in the others -- which is what a real run did,
  // eight minutes into a grind, standing on a doormat that is not a door.
  //
  // `goTo` knows the rule now (aim at every warp, press into the one you
  // reach, cross it off if nothing happens) and the caller runs it two lines
  // later to walk back to the grass. So all that is needed here is proof the
  // conversation is over and the player can move -- which is exactly what
  // `backToOverworld` establishes, by taking a step rather than by counting
  // presses.
  // A, not B: what is on screen is the nurse finishing her sentence, and B
  // does not advance a message box. The proof is still a step that lands.
  const free = yield* backToOverworld({ clear: BTN.A });
  if (!free.ok) return { ok: false, reason: `healed, but ${free.reason}` };
  return { ok: true, at: free.at || (yield 0).position };
}

/**
 * Get back out to the overworld, proven rather than assumed.
 *
 * Every menu here ends the same way and the temptation is always the same:
 * press B a few times and declare it done, because the thing you went in for
 * has visibly happened. It is the nurse all over again -- the party reads
 * healed while she is still talking; the party reads reordered while the
 * screen is still open -- and the failure looks identical from outside. The
 * run carries on pressing directions at a menu that swallows them, which on
 * screen is a frozen game.
 *
 * So the test is not how many times B was pressed. It is whether a step
 * lands. All four directions, because a player standing against a wall would
 * otherwise fail the test while standing in the overworld.
 *
 * `clear` is the button pressed between attempts, and it is B because a menu
 * is what usually has to be closed. A *message box* is the other case and it
 * wants A -- B does not advance the nurse, and a run that comes out of a heal
 * pressing B at her is a run standing still in front of a talking nurse. The
 * caller knows which it is looking at; this does not.
 */
export function* backToOverworld({ tries = 14, clear = BTN.B } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const state = yield 0;
    // A battle starting is also a way out of a menu, and a fine one.
    if (state && state.inBattle) return { ok: true, note: "a battle started" };
    const before = state && state.position;
    if (before) {
      for (const way of [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN]) {
        // B alongside the direction is the run latch; it is never pressed on
        // its own here, so it cannot back out of anything by accident.
        const after = yield* hold(way | BTN.B, 26);
        if (after && after.inBattle) return { ok: true, note: "a battle started" };
        const now = (yield* settle(6)).position;
        if (now && !sameSpot(before, now)) return { ok: true, at: now };
      }
    }
    yield* tap(clear, { then: 40 });
  }
  return { ok: false, reason: "could not get back out of the menus" };
}

/**
 * Whether two party reads are the same Pokémon.
 *
 * Not by name, and not by personality either. This player's party contains a
 * CHARIZARD and a CHARMELEON sharing the personality value 2003283047 --
 * almost certainly a clone from trading -- and two Pokémon of the same species
 * share a name. Neither field is the unique identifier it looks like, so this
 * compares the whole tuple, which is unique enough for the only question being
 * asked: did the one we meant end up at the front?
 */
/**
 * Move a party member into the lead.
 *
 * Only the Pokémon that fights earns experience, so training the third member
 * of a party means putting it first. Without this the run fights with whoever
 * happens to lead, the intended Pokémon gains nothing, and the mismatch reads
 * as a reason to leave every battle -- which books a trip to a Pokémon Center
 * after each one, forever.
 *
 * The fiddly part is that the party submenu is not a fixed list: it grows an
 * entry for every field move the selected Pokémon knows, so SWITCH is second
 * for a Charmeleon and third for a Beedrill that knows Cut.
 *
 * This used to deal with that by *searching*: press A on entry one, look at
 * the party, press A on entry two, and so on up to five. It is hard to
 * overstate how bad that was. Entry three is ITEM. Pressing A there opens
 * GIVE, and the next A in the sequence walks into the bag and hands over
 * whatever is at the top of it -- which is how a player's Charizard ended up
 * holding a Moon Stone, from a run that had been asked to do nothing but
 * gain two levels. Every blind press in a menu is a press on whatever
 * happens to be under the cursor, and in this menu some of those cost
 * something that cannot be got back.
 *
 * So the submenu is read (`partyMenuOf` -> `actions`, straight out of the
 * game's own scratch struct) and A is pressed only once the cursor is
 * verifiably on SWITCH. If the entries cannot be read, or SWITCH is not among
 * them, or the cursor will not go where it is sent, this backs out with B and
 * says so. Doing nothing is always available and always safe; guessing is
 * neither.
 */
export function* leadWith(want, { tries = 3 } = {}) {
  let state = yield 0;
  const partyNow = () => (state && state.party) || [];
  // `slotOfMon` rather than a bare search, because a search answers "not
  // here" for a frame whose record did not decode -- and the party is read
  // out of memory the game is writing to, so torn reads are ordinary. One of
  // them should not abort a switch with "it is not in the party any more".
  const at = slotOfMon(partyNow(), want, -1);
  if (at < 0) return { ok: false, reason: `${want.name} is not in the party any more` };
  if (at === 0) return { ok: true, note: "already leading", slot: 0 };

  /** Back out of whatever is open, then say why. Never leave a menu up: the
   *  walk that follows would press directions into it forever. */
  function* giveUp(reason) {
    const out = yield* backToOverworld();
    return { ok: false, reason: out.ok ? reason : `${reason} (and ${out.reason})` };
  }

  for (let attempt = 0; attempt < tries; attempt++) {
    // Into the party screen. The field menu is sticky, so the entry is found
    // by walking the cursor to it rather than by counting from the top --
    // `menu.cursor` is the game's own, and `lastIndex` is where the list ends.
    // Settle first. Pressing START while the player is still finishing a step
    // does nothing at all -- measured: zero idle frames and the menu never
    // opens, sixty and it always does -- and a run that presses on regardless
    // then counts cursor moves in a menu that is not there.
    yield* settle(60);
    yield* tap(BTN.START, { then: 50 });
    const opened = yield* toPartySlot(at);
    if (!opened.ok) { const bail = yield* giveUp(opened.reason); return bail; }
    state = opened.state;

    // The submenu. This is the part that used to cost items.
    state = yield* tap(BTN.A, { then: 80 });
    const menu = state && state.menu;
    if (!menu || !menu.actions) {
      return yield* giveUp("could not read what the party menu is offering, so nothing was pressed");
    }
    const wantSwitchAt = menu.actions.indexOf(MENU.SWITCH);
    if (wantSwitchAt < 0) {
      return yield* giveUp(`this party menu has no SWITCH entry (it offers ${menu.actions.join(", ")})`);
    }

    const onIt = yield* cursorTo(wantSwitchAt);
    if (!onIt.ok) return yield* giveUp(onIt.reason);
    state = onIt.state;

    // Only now.
    state = yield* tap(BTN.A, { then: 80 });
    if (!state || !state.menu || !state.menu.switching) {
      return yield* giveUp("SWITCH was taken but the game is not asking where to move to");
    }

    // "Move to where?" -- and the destination is a cursor we can read too.
    const home = yield* moveCursorTo(0);
    if (!home.ok) return yield* giveUp(home.reason);

    state = yield* tap(BTN.A, { then: 180 });
    if (sameMon(partyNow()[0], want)) {
      // The swap happened. That is not the same as being able to play again:
      // the party screen is still up, and a run that returns here walks into
      // a menu that eats every press.
      const out = yield* backToOverworld();
      if (!out.ok) return { ok: false, reason: `${want.name} is leading, but ${out.reason}` };
      return { ok: true, slot: 0 };
    }
    // It did not take. Close everything and start the whole thing over rather
    // than pressing on from a screen whose state is now a guess.
    const out = yield* backToOverworld();
    if (!out.ok) return { ok: false, reason: `the swap did not take, and ${out.reason}` };
  }
  return { ok: false, reason: `could not move ${want.name} to the front of the party` };
}

/** Walk the party screen's cursor onto `slot`, checking it each time. */
function* toPartySlot(slot) {
  // POKéMON in the field menu. The list is short and the cursor is readable,
  // so this walks to the entry rather than assuming where the menu opened.
  const FIELD_POKEMON = 1;
  const onEntry = yield* cursorTo(FIELD_POKEMON);
  if (!onEntry.ok) return { ok: false, reason: `could not reach POKéMON in the menu: ${onEntry.reason}` };
  let state = yield* tap(BTN.A, { then: 140 });

  // Wait for the screen itself, not for a cursor value. `open` is the party
  // menu's scratch struct existing, which is the game allocating it.
  for (let frame = 0; frame < 120; frame++) {
    if (state && state.menu && state.menu.open) break;
    state = yield 0;
  }
  if (!state || !state.menu || !state.menu.open) {
    return { ok: false, reason: "the party screen did not open" };
  }

  for (let press = 0; press <= 8; press++) {
    const now = state && state.menu;
    if (now && now.slot === slot) return { ok: true, state };
    state = yield* tap(BTN.DOWN, { then: 40 });
  }
  return { ok: false, reason: `the party cursor would not go to slot ${slot + 1}` };
}

/**
 * Walk a list menu's cursor to `index`, one press at a time, checking.
 *
 * Waits for the menu to exist first. `lastIndex` is the game's own "how far
 * this list goes", and it reads zero when no list is up -- so a menu that has
 * not finished opening is indistinguishable from a one-entry menu until it
 * does. Counting presses at that is how a run walks a cursor that is not on
 * screen and then reports that the cursor would not move.
 */
function* cursorTo(index, { wait = 90 } = {}) {
  let state = yield 0;
  for (let frame = 0; frame < wait; frame++) {
    const menu = state && state.menu;
    if (menu && menu.lastIndex >= index) break;
    state = yield 0;
  }
  const ready = state && state.menu;
  if (!ready || ready.lastIndex < index) {
    return { ok: false, reason: `no menu with an entry ${index} in it opened` };
  }

  for (let press = 0; press <= 12; press++) {
    const menu = state && state.menu;
    if (!menu) return { ok: false, reason: "the menu closed while its cursor was being moved" };
    if (menu.cursor === index) return { ok: true, state };
    state = yield* tap(menu.cursor < index ? BTN.DOWN : BTN.UP, { then: 40 });
  }
  return { ok: false, reason: `the cursor would not settle on entry ${index}` };
}

/** The same, for the second cursor the game uses while holding a Pokémon. */
function* moveCursorTo(slot) {
  let state = yield 0;
  for (let press = 0; press <= 8; press++) {
    const menu = state && state.menu;
    if (!menu) return { ok: false, reason: "lost the party menu mid-switch" };
    if (menu.moveTo === slot) return { ok: true, state };
    state = yield* tap(menu.moveTo < slot ? BTN.DOWN : BTN.UP, { then: 40 });
  }
  return { ok: false, reason: `could not aim the switch at slot ${slot + 1}` };
}

/**
 * The tile to stand on to talk to the nurse.
 *
 * You do not stand next to her: the counter between you is solid, so the spot
 * is the nearest walkable tile straight below her, and the conversation
 * happens across it. Searching downwards rather than assuming two tiles is
 * what makes this work in the Centres whose counters are a different depth.
 */
function counterOf(world, map) {
  const centre = world.centreInside(map.mapGroup, map.mapNum);
  if (!centre || !centre.nurse) return null;
  const grid = world.gridOf(map.mapGroup, map.mapNum);
  if (!grid) return null;
  const [nx, ny] = centre.nurse;
  for (let down = 1; down <= 4; down++) {
    if (grid.at(nx, ny + down)) return { x: nx, y: ny + down, nurse: { x: nx, y: ny } };
  }
  return null;
}

/**
 * The whole round trip: from wherever the player is standing to the nearest
 * Pokémon Center and back to the tile they left.
 *
 * This is what the recorded route used to buy, and it no longer has to be
 * bought: with the warp graph the app can work out which Center is nearest
 * and how to get inside one it has never been shown.
 */
export function* healTrip(world, { from = null, allowed = null } = {}) {
  let state = yield 0;
  const start = from || (state && state.position);
  if (!start) return { ok: false, reason: "no position to come back to" };

  const centre = world.nearestCentre(start.map);
  if (!centre) return { ok: false, reason: "no Pokémon Center reachable from here" };

  const out = yield* goTo(world, centre.door, { allowed });
  if (!out.ok) return { ok: false, reason: `could not reach the Center: ${out.reason}`, leg: "there" };

  yield* settle(60);
  const healed = yield* healInside(world);
  if (!healed.ok) return { ...healed, leg: "heal" };

  // Back to the exact tile the grind was interrupted on. Coming back to "the
  // town" is not coming back: the grass is a specific set of tiles and
  // standing next to it finds nothing all night.
  const back = yield* goTo(world, { ...start.map, x: start.x, y: start.y }, { allowed });
  if (!back.ok) return { ok: false, reason: `healed, but could not get back: ${back.reason}`, leg: "back" };
  return { ok: true, at: back.at, centre: centre.inside.name };
}
