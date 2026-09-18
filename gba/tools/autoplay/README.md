# autoplay — driving the game from a script

A headless harness that plays Pokémon FireRed by booting the same wasm core
the app ships, stepping it a frame at a time, and reading the game's own
memory through the same decoders `apps/gba/src/` uses. It exists because
"level this Pokémon up" is a real task and nobody wants to hold the button.

It is not a macro recorder. Every routine here follows one shape:

> **press towards a state, look, and only move on once the machine agrees.**

That single rule is most of what makes it work, and it is the part worth
stealing for anything else that drives an emulator, a game, or any other
system that has no API and only a screen.

## Start here: `play.mjs`

The rest of this folder is the toolkit. `play.mjs` is the thing you run, and
it is the app's own autoplayer with the browser taken out — the same policy,
the same wasm core, the same atlas, the same reads. Not a second
implementation: that already existed, in the other files here, and the bugs it
did *not* share with the app were the expensive ones. `leadWith` lived here,
worked here, and was never ported, so for a week the app went back to the
Pokémon Center after every single battle.

```
node gba/tools/autoplay/play.mjs \
  --rom FireRed.gba --sav game.sav --mon CHARIZARD --to 40 --out after.sav
```

| flag | |
|---|---|
| `--rom` `--sav` | the cartridge and the save to start from. Required, and neither belongs in this repo. |
| `--mon` / `--slot` | who to train, by nickname or by party position. |
| `--to` | the level to stop at. Required. |
| `--spot` | the map to fight on. The default is where you are standing, or — because that is usually the upstairs of a Pokémon Center — the nearest map with grass. |
| `--out` | write the cartridge save here at the end; import it in the app under **Import .sav**. |
| `--minutes` | wall-clock budget, default 30. |
| `--tries` | how many times to pick the run back up after it stops, default 3. Each retry moves to the next place on the list. |
| `--dump` | a save state, a screenshot and the reason, written on every stop. |
| `--show` | draw the screen in the terminal while it runs. |

What makes it worth having is **not** speed, and the first version of this
paragraph said otherwise. Measured: the core runs at 209 frames a second in
Node and 210 in the browser, which is the same 3.5× real time either way. The
rendering this skips costs nothing next to the emulation.

What it buys is that a stop here is a *file*. `--dump` writes the save state,
a screenshot and the reason, so a run that goes wrong can be replayed and
picked apart in seconds instead of described from memory over a phone. Every
bug in this thing was found that way. It is also scriptable, it needs no tab,
and it will tell you the answer while you do something else.

`--show` draws the screen in the terminal and costs about a fifth of the
speed. It is usually worth it — a run that is going wrong looks wrong long
before it says so.

The browser is still where this is meant to be *watched*. It is a poor place
to debug it: a run takes as long as the game takes, and a fix cannot be tried
without a build, a deploy, and a service worker that may or may not have
noticed.

## The pieces

| file | what it owns |
|---|---|
| `play.mjs` | the entry point above: the app's policy and atlas, driven headless. |
| `machine.mjs` | boot / step / press / read. `look()` returns party, position, battle and menu state. `save()` returns the flash image. |
| `maps.mjs` | walls and grass, from pokefirered's `map.bin` + `metatile_attributes.bin`. `path()` and `pathToAny()` are BFS over that. |
| `menus.mjs` | the menus that need verifying: `leadWith`, `healHere`, `saveGame`. |
| `travel.mjs` | `walkPath`, `goTo` (across maps), `throughBattle`. |
| `grind.mjs` | the supervisor: grind → heal → return → repeat, until a goal or a surprise. |

Bring your own ROM and save; neither is in this repo and neither should be.

```
GBA_ROM=firered.gba GBA_SAV=game.sav node run.mjs out.sav
```

```js
import * as m from "./gba/tools/autoplay/machine.mjs";
import { grind } from "./gba/tools/autoplay/grind.mjs";
import { goTo } from "./gba/tools/autoplay/travel.mjs";
import { saveGame } from "./gba/tools/autoplay/menus.mjs";

const machine = await m.boot({ rom: process.env.GBA_ROM, save: process.env.GBA_SAV });
m.resume(machine);                                     // past the title screen

const SPOT   = { mapGroup: 3, mapNum: 24, x: 3, y: 18 };  // grass on Route 6
const CENTRE = { mapGroup: 3, mapNum: 5, x: 15, y: 7 };   // outside the Centre door

goTo(machine, SPOT);
const out = await grind(machine, {
  slot: 0, toLevel: 36, spot: SPOT, centre: CENTRE,
  allowed: [{ mapGroup: 3, mapNum: 24 }, { mapGroup: 3, mapNum: 5 }, { mapGroup: 9, mapNum: 1 }],
  onProgress: ({ what, mon, battles }) => console.log(what, mon.level, battles),
});
saveGame(machine);                                     // in-game save, or the file is stale
writeFileSync(process.argv[2], machine.save());
```

## What the game taught us, in the order it hurt

Each of these cost a run. They are all the same mistake wearing different
clothes: believing an input landed because it was sent.

- **A press is a request.** Walking is the honest example — after a step,
  re-read the tile. If it did not change, something is in the way, and the
  right answer is to re-plan, not to press harder.
- **"Done" needs a proof that is not the thing you are waiting on.** The
  nurse restores your party *before* she stops talking, so full HP is not
  proof the conversation ended. Mashing A past the last box re-opens it. The
  proof that dialogue is over is that you can **walk**.
- **Collision is not the whole map.** Ponds have collision 0 because Surf
  exists. Doors are walkable because you are meant to go through them. Read
  metatile *behaviours* too, and treat every door but your target as a wall.
- **Reads can be garbage, not just wrong.** Position is nonsense mid-map-
  transition. A surprise worth acting on should survive a dozen re-reads.
- **Refusing a tile forever can sever the only corridor.** Remember blocked
  tiles, but clear them and re-plan when no path remains.
- **Menus drift.** The party submenu index depends on which Pokémon knows
  Cut; the field menu is sticky and wraps. Search for the entry and verify
  what you landed on — never count presses from a remembered index.
- **A cursor that moves by XOR is not a cursor that wraps.** Both battle menus
  are 2×2 and left/right flip bit 0, up/down flip bit 1 — so any target is two
  presses away and it is tempting to always press RIGHT then DOWN. From the
  top-left that works. From the right column RIGHT does nothing, and from the
  bottom row DOWN does nothing, and a press that does nothing looks exactly
  like no press. A CHARMELEON sat on METAL CLAW — bottom-right, no PP left —
  pressing RIGHT at it for a full minute while SCRATCH waited at the top left
  with thirty-five. Pick the direction from where the cursor *is*
  (`cursorStep` in `apps/gba/src/buttons.js`).
- **"Too long" is not "stuck".** A battle that has lasted a minute and a
  battle that has not changed in a minute are different claims, and only the
  second is evidence. Five trainers in a row on the Nugget Bridge keep
  `inBattle` true the whole time.
- **Leave before you need to.** Setting off for a Centre at 44% HP means
  arriving at 0%, because the route between is full of trainers you cannot
  run from. The departure threshold is 80% for that reason.
- **The save file is written by the game, not by you.** `gba_read_save` reads
  flash. Without an in-game save, the image you export is the one you loaded.
- **Not every warp is a door you can walk through.** A Pokémon Center's exit
  is three mats side by side; exactly one of them opens, and only to a press
  *south* while standing on it. Walking onto any of the three from any
  direction does nothing. Aim at every warp that leads where you are going,
  press into the one you reach, and cross it off if nothing happens.

## Where this ended up

Most of this now also runs in the browser. `apps/gba/src/journey.js` is
`travel.mjs` and `healHere` moved across essentially unchanged, with
`machine.step(k); machine.look()` becoming `yield k` — generators let the
imperative shape survive a per-frame loop that cannot block. The map data the
harness reads from a pokefirered checkout is generated into two committed files
(`tools/gen-world.mjs`, about 28 KB gzipped) so a static page can carry it.

The harness is still the place to develop: it runs headless, at whatever speed
the machine manages, with a real cartridge and no tab in the way. What changed
is that the result no longer has to stay here.

## Switch training, and why it is not here

The plan was: put the Pokémon being trained in front so it is sent out first,
switch to a strong one on turn one, let that win. Switching resolves before the
opponent attacks, so the weak one takes no damage, and Gen 3 splits experience
among everything that was sent out. Half the experience for none of the risk.

Measured against the cartridge, two facts kill it.

**A switch permanently reorders the party.** Not just `gBattlerPartyIndexes` --
the party array itself. Switching to the Pokémon in slot three leaves it in slot
zero and the one that led in slot three, and it stays that way after the battle
ends. So the trick works exactly once: the next battle sends out the *fighter*,
not the trainee, and getting back to the starting arrangement costs a full
party reorder (about fourteen seconds) before every single battle.

**The cursor cannot be driven blind.** The in-battle party menu exposes no
cursor this build can read -- a byte-level diff across two presses finds nothing
that counts -- and pressing A without moving first does nothing at all, because
the cursor starts on the Pokémon already out, which cannot be chosen. Four DOWN
presses selected slot three rather than slot four, and I could not establish the
mapping reliably. Guessing wrong does not fail safely: it silently and
permanently rearranges somebody's party.

So the arithmetic is worse than it looked. Against lead training, switch
training costs roughly a doubled battle time plus half the experience, which is
about four times worse per level, on top of a failure mode that edits the
player's save.

What actually protects a weak Pokémon, in order of sense:

1. **Lead training with the adaptive heal threshold.** It already exists: the
   runner watches what the fights here cost and leaves for a Centre while it
   can still survive the walk. Full experience, no new machinery.
2. **Exp. Share.** The trainee holds it, never enters a battle, and takes a
   share anyway. No reorder, no per-battle cost. It needs the bag, which is a
   menu nobody here has driven yet -- but it is an overworld menu, where a
   wrong press is recoverable.

## Porting this to something else

The transferable part is not the map data; it is the loop.

1. **Find a read.** Something that tells you the true state — memory, a
   pixel, an accessibility tree. Without it you are writing macros.
2. **Make every action a small closed loop:** act, read, confirm, or retry
   differently. Never chain two unverified actions.
3. **Model the world separately from the driver.** Here that is `maps.mjs`,
   derived from the game's own data rather than from exploration. Plans
   computed against a real model beat plans discovered by wandering.
4. **Supervise with a budget and a named stop.** `grind.mjs` stops on the
   goal, on the budget, or on a surprise — and says which. A loop that can
   only succeed will instead run forever.
