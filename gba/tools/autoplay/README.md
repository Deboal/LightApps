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

## The pieces

| file | what it owns |
|---|---|
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
- **Leave before you need to.** Setting off for a Centre at 44% HP means
  arriving at 0%, because the route between is full of trainers you cannot
  run from. The departure threshold is 80% for that reason.
- **The save file is written by the game, not by you.** `gba_read_save` reads
  flash. Without an in-game save, the image you export is the one you loaded.

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
