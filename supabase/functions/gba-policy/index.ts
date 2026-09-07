// gba-policy — turns a sentence into a policy the emulator can run.
//
// This exists so the Anthropic key never reaches a browser. The app is a
// static page; anything it holds, anyone who opens it holds too. So the key
// lives here as a Supabase secret, the function is the only thing that sees
// it, and Supabase checks the caller's sign-in before this code runs at all
// (`verify_jwt` is on by default — leave it on).
//
// The model does not drive the game. It is asked once, for a small object
// describing what to do, and the emulator then runs that object at eight times
// speed with nothing on the network. That is the whole reason this is cheap:
// a prompt costs one short request, not one request per frame. It is also the
// reason it is safe — the model picks parameters from a fixed vocabulary and
// cannot emit code that runs on anyone's machine.

// Pinned, and the subpath is the load-bearing part: `helpers/zod` does
// `require("zod/v4")` and calls `z.toJSONSchema`, which exists only in zod v4.
// zod 3.25.x satisfies the SDK's `^3.25 || ^4` peer range and ships v4 under
// `zod/v4`, but its bare entry point is still classic v3 -- and a v3 schema
// handed to v4's converter fails as `Cannot read properties of undefined
// (reading 'def')`, which names neither zod nor the version. Hence `/v4`.
import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.124.0/helpers/zod";
import { z } from "npm:zod@3.25.76/v4";

/** What the emulator knows how to do. Adding a task means teaching the
 *  runtime first and widening this second — never the other way round, or the
 *  model will confidently ask for something that does not exist. */
const Policy = z.object({
  name: z.string().describe("Two or three words, for a button. e.g. 'Grind Pikachu'"),
  summary: z
    .string()
    .describe(
      "One sentence, addressed to the player, saying exactly what will happen " +
        "and when it will stop. This is shown before anything runs and is the " +
        "player's chance to disagree, so be concrete about the stopping condition."
    ),
  task: z.literal("grind").describe("The only task the runtime implements today."),
  slot: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe("Which party member this is about, as an index into the party given below."),
  stopAtLevel: z
    .number()
    .int()
    .min(2)
    .max(100)
    .describe(
      "Stop once the chosen party member reaches this level. If the player did " +
        "not say, pick their current level plus five."
    ),
  fleeBelowHp: z
    .number()
    .min(0)
    .max(1)
    .describe("Run from a battle when the lead's HP falls below this fraction of its maximum."),
  stopBelowHp: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Stop the whole run when HP falls below this fraction. The runtime cannot " +
        "walk to a Pokemon Center, so stopping is the honest end -- keep this " +
        "low but above zero."
    ),
});

const SYSTEM = `You turn a player's request into a small policy an emulator runs on its own.

You are given the player's actual party, read out of the running game's memory.
Resolve names against it: "grind Pikachu" means whichever slot holds PIKACHU.
If the request names nobody, use slot 0.

The runtime walks in grass to find wild Pokemon, fights with the lead's first
move, and runs away or stops on the thresholds you choose. It cannot heal,
cannot navigate to a Pokemon Center, cannot use items, and cannot switch
Pokemon. Choose thresholds that respect that: fleeing early is cheap, fainting
is not.

The player is left alone while this runs, so the summary must make the stopping
condition unmistakable.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    return json(
      {
        error:
          "This project has no ANTHROPIC_API_KEY set. Add it as a secret on the " +
          "gba-policy function and redeploy.",
      },
      501
    );
  }

  let body: { prompt?: string; party?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return json({ error: "Say what you want it to do" }, 400);
  if (prompt.length > 500) return json({ error: "That is longer than this needs" }, 400);

  const party = Array.isArray(body.party) ? body.party.slice(0, 6) : [];
  if (party.length === 0) {
    return json({ error: "No party was readable, so there is nothing to act on" }, 400);
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM,
      // Low effort on purpose: this is a short mapping from one sentence onto
      // a handful of parameters, not a problem that repays deliberation.
      output_config: { effort: "low", format: zodOutputFormat(Policy) },
      messages: [
        {
          role: "user",
          content:
            `The party, in slot order:\n` +
            party
              .map(
                (mon: Record<string, unknown>, i: number) =>
                  `${i}. ${mon.name} — level ${mon.level}, ${mon.hp}/${mon.maxHp} HP`
              )
              .join("\n") +
            `\n\nWhat the player asked for: ${prompt}`,
        },
      ],
    });

    // parsed_output is null when the model's object did not satisfy the
    // schema. Returning nothing is right: the alternative is handing the
    // runtime a half-formed policy to act on unattended.
    if (!response.parsed_output) {
      return json({ error: "Could not turn that into something runnable" }, 422);
    }
    return json({ policy: response.parsed_output });
  } catch (error) {
    // Whatever the API said, said plainly. A generic message here is the
    // difference between a fix and a guess.
    const detail = error instanceof Error ? error.message : String(error);
    const status = error instanceof Anthropic.APIError ? error.status ?? 502 : 502;
    return json({ error: detail }, status);
  }
});
