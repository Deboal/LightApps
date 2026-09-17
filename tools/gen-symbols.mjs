// gen-symbols.mjs — take the addresses from the decompilation instead of
// guessing them.
//
// Every address this app reads was originally found by searching a running
// machine's RAM for the shape it must have. That works, and it produced four
// correct answers -- and one wrong one that read plausibly for weeks:
// `0x0203b0a8`, believed to be "which Pokémon is out in battle", is actually
// `gPartyMenu + 8`, the party menu's type field. It returns zero in an
// ordinary battle, which is the right answer for the wrong reason, so nothing
// ever failed loudly enough to notice.
//
// pret publishes a symbol file per ROM revision. The one for FireRed rev 1
// agrees exactly with every address we had found by hand, names the one we had
// wrong, and hands over several we had been inferring badly -- the party menu
// cursor, the status conditions, and a byte that says outright whether the
// game has taken control away from the player.
//
//   node tools/gen-symbols.mjs [path-to.sym]
//
// The output is committed. It is a few dozen numbers; the input is 2.4 MB and
// downloading it at build time would make Netlify depend on GitHub being up.

import { readFileSync, writeFileSync } from "node:fs";

// Both published builds. The RAM addresses are identical between them --
// checked, not assumed -- so only the three code addresses differ, by exactly
// twenty bytes. Shipping both and matching whichever the cartridge is running
// beats gating on a revision: the match is its own proof, and a build we do
// not know simply fails to match and falls back to the behaviour that existed
// before any of this.
const SOURCES = process.argv.length > 2
  ? process.argv.slice(2)
  : ["/tmp/claude-0/pokefirered_rev1.sym", "/tmp/claude-0/pokefirered.sym"];

/** What we read, and why. Anything not here is not worth carrying. */
const WANTED = {
  // The party, and how much of it there is.
  gPlayerParty: "the six hundred bytes the whole policy is judged from",
  gPlayerPartyCount: "how many of them are real",
  // Where the player is standing lives behind this pointer.
  gSaveBlock1Ptr: "SaveBlock1, which holds the position and the last heal",
  gMain: "per-frame bookkeeping; the in-battle flag lives in its flags",
  // Battle.
  gBattlerControllerFuncs:
    "a function pointer that *is* the battle's state: one address while the " +
    "action menu waits for input, another while the move list does",
  gBattlerPartyIndexes: "which party slot each battler is -- the one we had wrong",
  gActionSelectionCursor: "FIGHT / BAG / POKéMON / RUN, as a two-bit grid",
  gMoveSelectionCursor: "which of the four moves is under the cursor",
  gBattleTypeFlags: "a trainer battle cannot be fled; this says which it is",
  // The party menu, in battle and out of it.
  gPartyMenu: "slotId at +9 is the cursor; switch training needs it",
  // The overworld's own answer to 'can the player act right now'.
  sLockFieldControls:
    "TRUE while the game holds the controls -- a script, a cutscene, or a " +
    "message box. Every freeze reported so far is this byte being set while " +
    "the walk pressed directions at it",
  // Battle menu states, read as the controller function that is executing.
  // Thumb, so the running value is the symbol with the low bit set.
  HandleInputChooseAction: "the action menu is up",
  HandleInputChooseMove: "the move list is up",
  WaitForMonSelection: "the in-battle party menu is up",
};

/** Symbols that are Thumb code rather than data: the pointer has bit 0 set. */
const CODE = new Set(["HandleInputChooseAction", "HandleInputChooseMove", "WaitForMonSelection"]);

const found = new Map(); // name -> Set of addresses across the builds
for (const source of SOURCES) {
  const seen = new Set();
  for (const line of readFileSync(source, "utf8").split("\n")) {
    // "02024284 g 00000258 gPlayerParty"
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [address, , , name] = parts;
    if (!(name in WANTED) || seen.has(name)) continue;
    // A name can appear more than once -- several battle controllers have a
    // function called HandleInputChooseAction. The player's is the first, in
    // the lowest bank, which is what the hand-found addresses agreed with.
    seen.add(name);
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(parseInt(address, 16));
  }
  // Per source, not across all of them. One of pret's published files is a
  // 404 page saved to disk; a check against the accumulated map would let it
  // pass silently behind a good file read earlier in the list.
  const gaps = Object.keys(WANTED).filter((name) => !seen.has(name));
  if (gaps.length) {
    console.error(`missing from ${source}: ${gaps.join(", ")}`);
    process.exit(1);
  }
}

// A data address that moved between builds would break everything downstream
// silently, so it is an error rather than a note.
for (const [name, addresses] of found) {
  if (!CODE.has(name) && addresses.size > 1) {
    console.error(`${name} is at different addresses in different builds; this generator assumes it is not`);
    process.exit(1);
  }
}

const hex = (n) => `0x${n.toString(16).padStart(8, "0")}`;
const body = [...found]
  .map(([name, addresses]) => {
    const values = [...addresses].sort((a, b) => a - b);
    const doc = `  /** ${WANTED[name]} */`;
    if (!CODE.has(name)) return `${doc}\n  ${name}: ${hex(values[0])},`;
    // Thumb, so the running pointer has the low bit set. One entry per build.
    return `${doc}\n  ${name}: [${values.map((v) => hex(v | 1)).join(", ")}],`;
  })
  .join("\n");

const out = `// symbols.js — addresses, from the decompilation rather than from guessing.
//
// GENERATED by tools/gen-symbols.mjs from pret's published symbol files. Do not
// edit by hand; re-run the generator.
//
// An address that is merely plausible is worse than no address at all -- that
// is the whole reason this file exists rather than a list of constants found
// by searching RAM for the right shape. The one that was found that way and
// was wrong, \`0x0203b0a8\`, is nine bytes into \`gPartyMenu\`.

/** The cartridges these describe. Every RAM address below is identical across
 *  both published builds; only the code addresses differ, and those are given
 *  as a list so the running one can be recognised rather than assumed. */
export const FOR = ["BPRE", "BPRG"];

export const SYMBOLS = {
${body}
};

/** \`gPartyMenu.slotId\` — the party cursor, nine bytes into the struct. */
export const PARTY_MENU_SLOT = SYMBOLS.gPartyMenu + 9;
`;

writeFileSync(new URL("../apps/gba/src/symbols.js", import.meta.url), out);
console.log(`wrote ${found.size} symbols from ${SOURCES.length} build(s)`);
for (const [name, addresses] of found) {
  const values = [...addresses].sort((a, b) => a - b).map((v) => hex(CODE.has(name) ? v | 1 : v));
  console.log(`  ${name.padEnd(28)} ${values.join("  ")}`);
}
