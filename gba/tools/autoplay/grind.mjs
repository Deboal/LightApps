// grind.mjs — level a Pokémon up, unattended.
//
// The loop is small because everything hard is somewhere else: the policy
// decides what to press in a battle, the map decides where the walls are, and
// this only decides what to do next. Grind. When the lead is hurt or out of
// moves, walk to a Pokémon Center, heal, walk back. When the walking stops
// finding anything, step back into the grass. Stop when the goal is met, or
// when something happens that was not planned for — and say which.

import { BTN, game } from "./machine.mjs";
import { goTo, throughBattle } from "./travel.mjs";
import { healHere } from "./menus.mjs";
import { runner, spent } from "../../../apps/gba/src/policy.js";

/** Experience for a level, on the Medium Slow curve the Charmander line uses. */
export const mediumSlow = (n) =>
  Math.floor((6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140);

export async function grind(machine, {
  slot = 0,
  toLevel,
  spot,          // where to stand and fight
  centre,        // the tile outside the Pokémon Center door
  allowed,       // the only maps this run may set foot on
  // Set off for a Centre while still strong enough to survive the walk.
  // Route 6 is lined with trainers who cannot be run from, so leaving at the
  // point of actually needing a heal means arriving in worse shape than when
  // the decision was made -- or not arriving.
  healBelow = 0.8,
  budget = 2_000_000,
  onProgress = () => {},
} = {}) {
  const lead = () => machine.look().party[slot];
  const spent = () => {
    const mon = lead();
    return !!mon && spent(mon);
  };
  const hurt = () => {
    const mon = lead();
    return mon && mon.maxHp && mon.hp / mon.maxHp < healBelow;
  };

  let heals = 0;
  let battles = 0;
  const started = machine.frames;

  while (machine.frames - started < budget) {
    const mon = lead();
    if (!mon) return { ok: false, reason: "lost sight of the party" };

    if (mon.level >= toLevel) {
      // The level is reached mid-battle, and an evolution follows it. Let the
      // game finish whatever it is doing before calling this done.
      const out = throughBattle(machine, { limit: 20000, runBelow: 0 });
      if (!out.ok) return { ok: false, reason: out.reason };
      for (let i = 0; i < 600; i++) machine.step(i % 14 < 5 ? BTN.A : 0);
      return { ok: true, at: lead(), heals, battles };
    }

    if (hurt() || spent()) {
      onProgress({ what: "healing", mon: lead(), heals, battles });
      const there = goTo(machine, { ...centre, toward: BTN.DOWN }, { allowed });
      if (!there.ok) {
        // A failure on the way to a heal is the one worth a picture: the
        // reasons all read the same and look completely different.
        if (process.env.AUTOPLAY_SHOTS) machine.shoot(`${process.env.AUTOPLAY_SHOTS}/stuck-travel.png`);
        return { ok: false, reason: `could not reach the Centre: ${there.reason}`, at: machine.look().position };
      }
      const healed = await healHere(machine, { goTo });
      if (!healed.ok) return { ok: false, reason: healed.reason };
      heals++;
      const back = goTo(machine, { ...spot, toward: BTN.UP }, { allowed });
      if (!back.ok) return { ok: false, reason: `healed, but could not get back: ${back.reason}` };
      continue;
    }

    // Fight for a while. The policy walks, finds encounters and picks moves;
    // it is handed a level it will not reach so that *this* loop decides when
    // to stop, not that one.
    const run = runner({ slot, stopAtLevel: 100, fleeBelowHp: 0.2, stopBelowHp: 0.05 });
    const before = machine.frames;
    let stopped = null;
    while (machine.frames - before < 40000) {
      const state = machine.look();
      const out = run.step({ ...state, frame: machine.frames });
      if (out.done) { stopped = out.reason; break; }
      machine.step(out.keys);
      const now = state.party && state.party[slot];
      if (now && (now.level >= toLevel || (now.maxHp && now.hp / now.maxHp < healBelow))) break;
      if (now && spent(now)) break;
    }
    battles += run.battles;
    onProgress({ what: "grinding", mon: lead(), heals, battles, stopped });

    if (stopped && /never moved|encounter|grass/.test(stopped)) {
      // Wandered off the grass. Put it back.
      const back = goTo(machine, spot, { allowed });
      if (!back.ok) return { ok: false, reason: `lost the grind spot: ${back.reason}` };
    } else if (stopped && !/level|HP|PP|fainted/.test(stopped)) {
      return { ok: false, reason: stopped };
    }
  }
  return { ok: false, reason: "ran out of budget", at: lead(), heals, battles };
}
