// autopilot.js — the one network call the AI player makes.
//
// It is one call for the whole run, not one per frame, and that is the design
// rather than an optimisation: the model is asked once for a small object
// describing what to do, and `policy.js` then runs that object locally at
// whatever speed the emulator manages. A grind that takes twenty minutes of
// game time costs a single short request, works with the tab in the
// background, and cannot surprise anyone by changing its mind halfway.
//
// The key lives in a Supabase Edge Function (`supabase/functions/gba-policy`),
// never here. This file only knows the function's name.

import { sb, configured } from "../../../shared/client.js";

export const available = configured;

/** Everything the function is told about the game. Deliberately the whole
 *  list: resolving "grind Pikachu" onto a slot needs the names, and sending
 *  less would mean sending a slot number this app had guessed at instead. */
const brief = (party) =>
  party.map((mon) => ({
    slot: mon.slot,
    name: mon.name,
    level: mon.level,
    hp: mon.hp,
    maxHp: mon.maxHp,
  }));

/** Whatever the function actually said, rather than "non-2xx status code".
 *  supabase-js reports a 4xx as an opaque error with the response tucked into
 *  `context`; unwrapping it is the difference between a fix and a guess. */
async function reason(error) {
  try {
    const body = await error.context.json();
    if (body && body.error) return body.error;
  } catch {
    // No JSON body, or no response at all. Fall through.
  }
  return error.message || "The policy service did not answer.";
}

/**
 * Turn a sentence into a policy. Throws with something readable on failure —
 * this is shown to the person who typed the sentence.
 */
export async function compile(prompt, party) {
  if (!sb) {
    throw new Error("This build has no backend configured, so there is nothing to ask.");
  }
  const { data } = await sb.auth.getSession();
  if (!data || !data.session) {
    throw new Error("Sign in first — the policy service only answers signed-in players.");
  }

  const result = await sb.functions.invoke("gba-policy", {
    body: { prompt, party: brief(party) },
  });
  if (result.error) throw new Error(await reason(result.error));
  if (!result.data || !result.data.policy) {
    throw new Error("The policy service answered with nothing runnable.");
  }
  return result.data.policy;
}
