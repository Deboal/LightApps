# gba — a Game Boy Advance emulator core

Target: good enough to play the five mainline Pokémon GBA titles, with
cloud-synced saves across Mac and iPhone and lockstep link-cable netplay
later. Not a general-purpose emulator, not cycle-accurate, no audio.

The plan this follows is in the handoff document; this README records what
actually exists, what is verified, and what is assumed.

## Layout

```
gba/
  crates/
    gba-core/       # no I/O, no clock, no randomness, deterministic
      src/cpu/      # arm7tdmi: psr, alu (barrel shifter), arm, thumb
      src/mem/      # bus, memory map, cartridge, flash
      src/ppu/      # scanline timing, tiled/affine/bitmap layers, sprites
      src/bios.rs   # synthesized vectors and the HLE SWI layer
      src/dma.rs  timers.rs  irq.rs
      src/state.rs  # explicit ordered serialization
      tests/        # arm, thumb, memory, system, determinism, roms
    gba-headless/   # runs a ROM without a screen and dumps the machine
    gba-wasm/       # C-ABI shim; the web shell lives in ../apps/gba
```

`gba-core` has **zero dependencies**, by rule rather than by accident: every
dependency is a chance for someone else's iteration order or clock to leak
into emulator state and break determinism.

## Status

**Pokémon FireRed boots.** It reaches the copyright screen, the Game Freak
logo, the Gengar/Nidorino intro, the title screen, and — with scripted input
— into Professor Oak's opening dialogue with text advancing on button
presses. That covers the exit criteria for phases 4 and 5.

| Phase | State |
|---|---|
| 1 — CPU (ARM + Thumb) | Complete, tested against a hand-written suite and a commercial game; **not** yet against jsmolka's ROMs |
| 2 — Memory map and cartridge | Complete: mirroring, open bus, 8-bit save bus, header and save-type detection |
| 3 — BIOS | Complete enough. A real BIOS image loads and runs; without one, a synthesized image supplies the vectors and 25 SWIs are serviced in software |
| 4 — PPU | Modes 0–5, four backgrounds, affine, bitmap, priority compositing. No windows, blending or mosaic yet |
| 5 — Sprites, DMA, timers, IRQ | All four DMA channels with their timing modes, four timers with cascade, the interrupt controller, 128 sprites regular and affine |
| 6 — Flash save | **Complete.** FireRed saved in-game, the `.sav` was dumped, a fresh boot with it offers CONTINUE with the right name and playtime |
| 7 — Save states | Explicit versioned serialization, refuses a mismatched version |

Reproduce the milestones (the ROM is yours; nothing here ships one):

```sh
cargo run --release -p gba-headless -- FireRed.gba --frames 120  --screenshot copyright.png
cargo run --release -p gba-headless -- FireRed.gba --frames 600  --screenshot gamefreak.png
cargo run --release -p gba-headless -- FireRed.gba --frames 900  --screenshot intro.png
cargo run --release -p gba-headless -- FireRed.gba --frames 1800 --screenshot title.png
cargo run --release -p gba-headless -- FireRed.gba --frames 6000 \
    --script "1850:START" --mash-from 1900 --screenshot oak.png
```

Flash (phase 6) and save states (phase 7) landed early because both are
self-contained and independent of the CPU, and both are the kind of thing
that is miserable to retrofit onto a machine you have already started
trusting with a playthrough.

## Running it

```sh
cargo test --release                                    # 96 tests, about a second
cargo run --release -p gba-headless -- <rom.gba> --frames 600 --screenshot out.png
cargo run --release -p gba-headless -- <rom.gba> --determinism
cargo run --release -p gba-headless -- <rom.gba> --watch 081e3570   # trace from an address
```

The headless runner boots a ROM, runs it until it settles into a terminal
loop or the frame budget expires, then prints the register file, the cycle
count, the interrupt and timer state, and a hash of the whole machine. When
it stops making progress it prints the last twelve instructions with their
addresses and cycle stamps — which is how the interrupt bug below was found.

`--screenshot` writes a PNG (there is no image dependency; it emits stored
deflate blocks). `--script "1850:START,1900:A+B"` presses buttons at given
frames, and `--mash-from N` taps A periodically, which is enough to walk a
game through its opening dialogue.

## What is verified, and what is not

**Verified here:** 96 tests covering the barrel shifter's shift-by-zero
encodings, carry and overflow on every arithmetic form, PC's +8/+12 pipeline
bias, LDM/STM base-in-list behaviour, mode banking, exception entry, all 19
Thumb formats, VRAM's non-power-of-two mirroring, byte-write widening in
video memory, the save region's 8-bit bus, the flash command state machine,
a 600-frame double-run state hash, and a save-state round trip. The system
tests cover interrupt dispatch through the game's installed handler, BIOS
read protection, timer prescalers and cascading, DMA timing modes, scanline
and VBlank timing, tiled background rendering, and the BIOS maths and
decompressors.

**Verified by the game:** FireRed boots to its title screen and into
gameplay dialogue, and two 600-frame runs of it serialize to identical
bytes — 40M instructions of real ARM and Thumb code, bit-identical.

The save round trip is proven end to end, which is the one thing unit tests
could not settle. Scripted input drives the game through its intro to an
in-game save; the cartridge flash is then dumped and a fresh emulator booted
with it, and the game offers CONTINUE with the right player name and
playtime:

```sh
cargo run --release -p gba-headless -- FireRed.gba --frames 51000 \
    --mash-from 1900 --mash-until 42000 \
    --script "1850:START,42200:START,42500:DOWN,42800:A,43200:A,43600:A,44000:A,44400:A,44800:START,45100:DOWN,45400:A,45800:A,46200:A,46600:A,48200:DOWN,48500:A,48900:A,49500:A,50100:A,50600:A" \
    --save-out firered.sav
cargo run --release -p gba-headless -- FireRed.gba --save-in firered.sav \
    --frames 2100 --script "1850:START" --screenshot continue.png
```

**Not verified:** jsmolka's `gba-tests` are the real oracle for phase 1 and
they could not be fetched in the environment this was built in — the network
is scoped to this repository. A hand-written suite tests what its author
thought to test, which is exactly the blind spot the ROMs exist to cover.
Before building the PPU on top of this, drop `arm.gba`, `thumb.gba` and
`memory.gba` into `crates/gba-core/tests/roms/` and run `cargo test`; the
harness in `tests/roms.rs` picks them up automatically and skips cleanly when
they are absent. One assumption to confirm there: the harness reads the first
failing test number out of `r12`. If the ROM signals differently, it is that
one assertion that changes, not the harness around it.

## The bug worth remembering

Bringing FireRed up surfaced one defect that no unit test in the suite would
have caught, and it is a good example of the failure mode this hardware
produces: nothing crashed, the machine simply stopped making progress.

BIOS memory is readable only while the CPU is executing inside it. That
permission was being computed from the PC at the *start* of an emulator
step — but an exception is entered and its vector fetched inside a single
step, so the fetch at `0x18` was judged from the interrupted instruction's
address and returned the open-bus latch instead of the handler. The stale
latch happened to be `subs pc, lr, #4`, the last word of the BIOS interrupt
epilogue, which returns to the interrupted instruction. So every interrupt
"returned" without running the handler, the interrupt flag was never
acknowledged, and the game re-took the same interrupt forever, three cycles
at a time, with a perfectly plausible-looking PC.

The fix is a one-line seam: the bus is told the fetch address by the CPU
(`Bus::on_fetch`), so BIOS readability is decided by the access that is
actually happening. `tests/system.rs` pins it.

## Judgement calls where the documentation is ambiguous

These are the places a future bug is most likely to be hiding, recorded so
they can be re-litigated against a test ROM rather than rediscovered.

- **Save-region byte lane.** A 16- or 32-bit write to SRAM/flash delivers one
  byte, selected by the low bits of the address *before* alignment, and lands
  at that unaligned offset. This matches what mature emulators do; GBATEK is
  not explicit.
- **MUL and the carry flag.** `MULS` leaves C untouched. The ARM7TDMI
  destroys it in a way no documentation pins down, and leaving it alone is
  what real games are built against.
- **`LDRSH` from an odd address** degrades to `LDRSB`. Same for the ARM and
  Thumb encodings.
- **LDM with the base register in the list** performs no writeback: the
  loaded value wins.
- **No interworking on `LDR`/`LDM`/`POP` into PC.** This is ARMv4T, not v5;
  bit 0 is dropped and the instruction set does not change. Only `BX` switches.
- **Wait states** are a per-region approximation and ignore `WAITCNT`. They
  affect speed, not correctness, for this target — but they are deterministic,
  which is the property that matters.

## Determinism

Enforced by `tests/determinism.rs`, in CI from the first commit: two
600-frame runs with a scripted input sequence must serialize to identical
bytes. A companion test proves the input sequence actually reaches the
machine, so the determinism test cannot pass by ignoring input.

Time advances only as instructions retire. There is no `Instant`, no
`SystemTime`, no RNG, and no `HashMap` in emulator state anywhere below
`Emulator`. A frame is a fixed 280,896-cycle budget with the overshoot
carried forward, so a long session cannot drift.

## Throughput

Two measurements on the container this was built in:

| Workload | Emulated | Wall | Ratio |
|---|---|---|---|
| Tight ARM loop from ROM, no PPU work | 10.0 s | 0.32 s | 31× realtime |
| **FireRed, boot through Oak's intro** | 100.5 s | 12.3 s | **8.2× realtime** |

The second is the number that matters: 380M instructions with the PPU
drawing every scanline, sprites composited, and DMA running. WASM typically
costs another 1.5–2.5×, which leaves roughly 3–5× realtime on a comparable
phone — enough for 60 fps with headroom for 2× and 4× fast-forward, and not
enough to be complacent about the renderer.

## Playing it

The web shell is a LightApps app at `apps/gba/`. Open `/gba/` on the deployed
site, pick a `.gba` file, and it runs: canvas, touch controls on a phone,
keyboard on a desktop (arrows, Z/X for A/B, Enter for Start, Shift for
Select, A/S for the shoulders), tiered fast-forward and named save states.

It opens to a library rather than dropping straight into the game, because
the save states are the thing worth seeing first; resuming is one tap.

The touch pad is a pad, not a row of buttons. The area owns the pointer rather
than each button owning its own, so a thumb rolls from B to A and from up to
up-left without lifting — which is the one thing a real controller always does
and a grid of independent tap targets never can. The d-pad's corners carry no
face of their own; they press both neighbouring directions, so both arms light
and two bits go in. Each press sinks the cap onto its own side wall and
returns with a little overshoot, and buzzes: `navigator.vibrate` where it
exists, and on iOS — which has no vibrate at all — a hidden switch control,
whose toggle is the only system haptic a web page can reach there. `Buzz on`
in the header turns it off.

Storage is local-first. The emulator always reads and writes this browser's
IndexedDB, so the app works signed out and offline; the cartridge save is
written a few seconds after the game stops touching flash, and again on
`visibilitychange` — the last reliable moment before iOS kills a backgrounded
tab.

Signing in (optional, magic link, shared with the rest of the hub) adds a
durable copy:

- **Cartridges** are uploaded once, keyed by SHA-256, so a second device never
  needs the file again. A cartridge already loaded when you sign in is
  back-filled, and the header shows whether the one you are playing is backed
  up yet. This is a deliberate departure from the plan's "the
  server stores saves, not ROMs": the bucket is private and scoped to one
  account, and the alternative is re-picking a 16 MB file every time a browser
  evicts its storage.
- **Saves** carry a monotonic version and are pushed with a compare-and-swap,
  never last-write-wins on a timestamp — device clocks disagree, and "later"
  is not "correct". A losing push returns the server's copy and asks: keep
  mine, keep theirs, or keep both (which hands you the other side as a file
  before anything changes). Nothing is discarded silently.
- The last ten versions are retained and restorable from the History button.
  128 KB each; storage is cheap relative to losing a playthrough.
- **Save states** are named, dated, tagged with the device that took them, and
  carry the frame that was on screen — so the app opens to a shelf of
  screenshots you can resume from, on either device. They are gated on the
  core's state version: a state written by an older build is listed and
  labelled rather than failing when you click it, because a state encodes the
  emulator's internal layout and every core change invalidates it. The `.sav`
  stays the source of truth; states are a convenience.

Run `schema-gba.sql` once in the Supabase SQL editor before signing in. It
creates a private `gba` bucket whose objects are scoped to the uploader by
path, and a database trigger that refuses a save whose version does not
advance — so the compare-and-swap is an invariant rather than a convention the
client is trusted to follow.

Netlify does not build Rust, so the `.wasm` is a committed artifact. Rebuild
it whenever the core changes:

```sh
cd gba
cargo build --release --target wasm32-unknown-unknown -p gba-wasm
cp target/wasm32-unknown-unknown/release/gba_wasm.wasm \
   ../apps/gba/assets/gba-core.wasm
```

85 KB, no dependencies, no bindings generator: the interface is a dozen
exported functions plus the module's linear memory.

## Offline

There is a service worker, so the app works with no connection at all: the
cartridge and the saves were already on the device in IndexedDB, and this is
what makes the app that reads them available too. There is a manifest as well,
so it installs to a home screen and runs without browser chrome.

The rule it is built around: `bundle.js` and `gba-core.wasm` are two halves of
one program and must never be cached out of step. A save state encodes the
core's internal layout, so a new shell against an old core is not a cosmetic
mismatch — it is a state that will not load. So the whole shell is precached in
one pass into a cache named for a hash of its contents, and files are never
revalidated individually. A new build is a new worker, a new cache, and one
atomic swap; nothing has to be remembered to bump. It deliberately does not
`skipWaiting`: a running game holds emulator state in memory, and swapping the
core out from under it mid-session is worse than waiting for the next visit.

Proven the only way it can be — `context.setOffline(true)`, reload, and check
the cartridge still boots.

## How this reaches a phone

The core is deliberately I/O-free so the same crate serves a native shell, a
WASM shell, and a server. That is now real: `gba-wasm` and `apps/gba` share
the identical core with `gba-headless`, no fork.

Saves are still per-device. The next step is cloud sync, and the Supabase
store and magic-link auth already in `shared/` cover section 4 of the handoff
without a separate `gba-server` — what has to be added on top is the version
counter and the compare-and-swap, because last-write-wins on timestamps will
eat a playthrough the first time you play on the phone and then the Mac.

`build.sh` ignores the `gba/` directory entirely and publishes `apps/gba/`
like any other app.

## Link cable

`gba-core` emulates the serial port in multiplayer mode, and `cable::Cable`
runs two to four machines wired together in one process, stepped along a fixed
256-cycle grid so the interleaving does not depend on how long any instruction
happened to take.

That shape is the point. Each participant emulates *every* machine and feeds
each one its own player's buttons; the cable traffic is then generated
locally, by emulated hardware both sides compute identically. A network only
has to carry button presses, which is far more forgiving of latency than
forwarding link bytes would be — and it only works because the core is
deterministic, which is what decision 1.2 bought.

```sh
cargo run --release -p gba-headless -- rom.gba --link --frames 600 --screenshot out.png
```

Two machines cost almost exactly twice one: 4.7x realtime for the pair against
8.2x for a single machine.

**Two copies of FireRed now find each other.** Driven to the Cable Club
counter, both units configure multiplayer at 115200 baud, exchange the AGB
link library's 0xB9A0 handshake word, see each other in the receive registers,
and the game advances from "Please wait" to "When all players are ready".

**Both players now reach the Trade Center and stay linked.** Confirming at
that prompt used to end in "Communication error"; the two units now walk into
the trade room together and hold the link open indefinitely — 3,400 frames and
counting in the scripted run, against 244 before.

The last bug there was not in the link at all. The game's AGB link library
paces the master with timer 3 and requires nine cable transfers in every
single frame; one frame with eight and it declares the master lagging
(`LINK_STAT_ERROR_LAG_MASTER`) and puts up the error. Loading the trade room
calls `LZ77UnCompWram`, which this core performs in one go and then billed for
in one go — 107,513 cycles inside a single instruction, during which no
interrupt could be taken. Four transfers went missing and the game was right
to complain. On hardware that call is ordinary BIOS code running with
interrupts enabled, so the fix is to hand back everything past one
instruction's worth as a debt the CPU serves in slices, paid only at the
instruction that owes it: an interrupt moves the PC away, the handler runs at
full speed, and the debt resumes when it returns. Paying it *inside* the
handler was the first attempt and was worse than the bug — it pinned the
handler at its first instruction until the debt ran out.

Worth noting what this was *not*, since both were plausible enough to cost
time: `transfer_cycles` is derived from the baud rate rather than measured,
and sweeping it from 1,024 to 18,560 cycles changed nothing (the failure
screen was byte-identical at every value bar the extreme). Nor was the data
wrong — the player blocks, the "GameFreak inc." magic and the trainer-card
blocks all arrived intact. Reading `gLinkStatus` out of the emulated machine's
IWRAM, against pret's `pokefirered` source for what the bits mean, is what
turned guesswork into a single answer.

Four bugs on the way here, each found by running the real game rather than by
re-reading the code, and none of which the unit tests caught:

- Multiplayer is SIOCNT mode 2, not 1. The hand-assembled test ROM encoded the
  same wrong value, so the test agreed with the code that shared its
  misunderstanding.
- SIOMULTI0-3 are writable. The games clear them between transfers; treating
  them as read-only left a stale word where the game expected a blank slate.
- Received words must appear when a transfer *completes*, not when it starts.
  Delivering early let the game read the answer before it had asked the
  question, and its own clear then wiped the real result.
- A BIOS call may not bill its cycles atomically. See above: it is the
  difference between a link session that survives a map load and one that
  does not, and `a_long_bios_call_is_interruptible` in `tests/system.rs`
  pins it.
- A DMA costs the timers the same time it costs the CPU. `dma::run` advanced
  the clock without telling the timers or the PPU, so every cycle spent
  moving data was invisible to them: the timers ran slow by exactly the
  transfer time while the link, which measures a transfer against that same
  clock, did not. Nothing looks wrong in a single-player game, where
  everything is late together. In a linked one the two disagreed, and they
  disagreed most on the screens that move the most data -- which is where a
  linked game does its heaviest work. Frames that fell short of the nine
  transfers the game demands went from 257 to 11 in the walk to the trade
  machine.
- The cartridge's "needs writing to disk" flag is the host's bookkeeping and
  must not be inside the state the two participants compare. Each side clears
  it on its own unit, so a real value there made them disagree the moment
  either game saved -- and a trade begins by saving.
- A save state has to carry the transfer in flight. It did not, so restoring
  one mid-exchange left the cable half-way through a word it would never
  finish. And `Cable` measures its quanta against a clock of its own: replace
  the machines' state wholesale and they arrive already past a grid still
  sitting at zero, so the loop that steps them until they catch up never runs
  them at all. `rebase` exists for that.

## Netplay

`apps/gba/src/netplay.js` is the wire; the cable itself is the core's. One
person starts a session and reads out a six-character code, the other types it
in.

What crosses the network is button presses. Nothing else. Each participant
already emulates *both* machines, so the cable traffic is generated locally by
hardware both sides compute identically — sending link bytes instead would put
a 16 MHz serial protocol on a 100 ms wire. That only works because the core is
deterministic, and it costs exactly one thing: a frame cannot run until both
players' inputs for it are known.

So inputs are scheduled eight frames ahead (~134 ms). You press A now, it lands
on frame N+8, and the packet carrying it has that long to arrive. If it does
not, both sides wait. Waiting is the only correct answer — an invented input is
a session where the two participants are playing different games and neither
knows it.

Three things keep that honest:

- **Fingerprints.** Every 120 frames the two sides exchange a hash of the whole
  session. Disagreement stops the session rather than letting one side write a
  save the other never saw. Taking one means serializing both machines, about a
  megabyte, so it is only taken on the frames that ask — computing it every
  frame instead cost nine tenths of the frame rate before that was noticed.
- **Frame-advantage limiting.** Lockstep self-paces without it, but it paces by
  spending the whole delay buffer on clock skew, leaving nothing for a late
  packet. A side more than a few frames ahead idles instead. The subtlety: a
  side that idles stops advancing, so it stops meeting the every-fourth-frame
  send condition, so it stops telling its partner where it is — and both wait
  for a number neither will send. Sending *while* waiting is what makes it work.
- **Redundancy.** Each packet repeats the sixteen frames around it, so a
  dropped one is covered by its neighbours instead of stalling the session.

Both machines boot from their own cartridge save, the way two consoles do when
you plug a real cable between them: 128 KB each, chunked over the channel, and
a complete description of where to begin because `Emulator::new` is
deterministic. Leaving a session serializes your unit back into the
single-player machine, so a trade survives the session that made it.

Add `?link=local` to the URL to run the whole thing between two tabs over a
BroadcastChannel — same protocol, same lockstep, no backend. That is how it is
tested, and how anyone can check the plumbing before asking a friend to sit
down for it.

**What is measured, and what is not.** The core runs a linked pair at 235 fps
in wasm — about four times what 60 fps needs. The end-to-end two-tab check
verifies the handshake, the save exchange, the lockstep, that one side's
buttons reach the other's copy of their machine, and that the two sides never
stop agreeing. It cannot measure frame rate honestly: a browser cuts a
background tab to roughly one animation frame a second, and under lockstep one
side's pause is the other's. That is also the first thing a real pair will hit,
so a session that stops advancing says whose turn it is waiting on rather than
showing a frozen picture.

## Reading the running game

`apps/gba/src/game.js` is a decoder ring for the cartridge's work RAM. The
core is a Game Boy Advance and knows nothing about Pokémon; this is what lets
something act on what is *true* rather than on what a screenshot appears to
show — the party, its levels, whether anyone has fainted.

The addresses were found, not looked up. `gPlayerParty` is at `0x02024284`
because that is the only run of six consecutive hundred-byte records in EWRAM
whose level, current HP, maximum HP and five stats are all in range and
mutually consistent; `gPlayerPartyCount` is at `0x02024029` because that is
the only byte equal to the party size in the `0x300` before it. Both were then
confirmed against a real machine: the six names decode out of the game's own
character set as PIKACHU, BEEDRILL, CHARMELEON, NIDORAN, JIGGLYPUFF, CLEFAIRY,
which is the party that cartridge has.

The shape test is not just how they were found — it runs on every read. A
cartridge that merely shares a game code, or memory caught mid-write, fails it
and the read returns nothing. **A false party is worse than no party**: this is
meant to be the input to something that presses buttons on its own, and a
policy acting on plausible nonsense is worse than one that waits. Twelve of
the thirteen checks in `checks/game-checks.mjs` are refusals for that reason.

`gMain` is the other thing read out of memory, and it is read on weaker
evidence. It is at `0x030030F0` because that is the only word in IWRAM
advancing by exactly forty over forty frames (its vblank counter), and because
the three pointers ahead of it all land in ROM, which nothing else at that
address would. `inBattle` is bit 1 of the byte at `0x03003529` per the game's
own `struct Main` — but unlike the party, **that flag has never been watched
turning on here**. Three attempts to walk a snapshot out of a Pokémon Center
and into grass failed, and hunting further was worth less than the alternative:
nothing downstream trusts the flag on its own. See the self-check below.

## Playing it for you

`apps/gba/src/policy.js` is a runner: hand it the party and the battle flag
each frame and it answers with a button mask. `supabase/functions/gba-policy`
turns a sentence ("grind Pikachu to level 30") into the small object it runs.

The split is the design, not an optimisation:

- **The model is asked once.** One short request per run, not one per frame.
  A twenty-minute grind costs a single call, keeps working with the tab in the
  background, and cannot change its mind halfway through.
- **The model cannot emit behaviour.** It fills in parameters — slot, stop
  level, flee threshold, stop threshold — and `policy.js` is the entire
  vocabulary those select from. Something that could emit behaviour could do
  anything while nobody was watching, which is the whole situation here.
- **The key never reaches a browser.** It is a Supabase secret read via
  `Deno.env.get` inside the function, with `verify_jwt` left on.
- **Nothing is started without being read first.** The plan comes back in
  plain words with its stopping condition spelled out, and the player approves
  it before a button moves.

Every way it stops is checked (`checks/policy-checks.mjs`, 30 checks): the
level reached, HP below the floor, a faint, a battle that stops responding, a
minute and a half of walking with no encounter, and a party that stays
unreadable. The last of those tolerates a torn read for a second first — the
party is read out of memory the cartridge is writing to.

And the self-check, which is there because of the paragraph above: HP falling
is a fight, whatever `inBattle` says. Three unexplained drops with no battle
observed between them and the run stops rather than pressing buttons into a
state it is misreading. Seeing one real battle resets the count, so the
one-frame race between a battle ending and the damage that ended it cannot add
up to a false stop. If the flag turns out to be wrong, the failure is a run
that halts and says so — not a fainted party.

### Where it can go

The runner used to be able to walk in a small circle and nothing else. It had
no map, so "walk to the Pokémon Center" was not a thing it could be asked:
healing meant the player walked the trip once and it replayed the trail, and a
run on a cartridge with no recorded route simply stopped when HP ran low.

The walls were never a secret. `tools/gen-world.mjs` turns the decompilation's
layout data into two files — `assets/world.json` and `assets/world.bin` — and
the whole of Kanto costs **about 28 KB gzipped**, against a bundle already over
four hundred:

| | raw | gzipped |
|---|---|---|
| `world.bin` — 242,469 tiles, two bits each (walkable, grass) | 59.3 KB | 13.9 KB |
| `world.json` — 425 maps, 1,294 warps, 120 connections, 19 Centers | 70.1 KB | 14.6 KB |

With it loaded the trip is planned rather than remembered: the nearest Centre
is searched for over the map graph, the walk there is pathfound from the game's
own collision data, and the way back is to the exact tile the grind was
interrupted on. It works for a Centre nobody has been shown.

Two rules in that data are worth stating because both cost a run to learn.
Collision alone is not walkability — a pond has collision zero, because Surf is
meant to work there — so metatile *behaviours* are read too. And every Pokémon
Center door in the game is a *solid* tile: the warp is what lets you through,
not the collision. So a door is a wall to route around and a destination to
step onto, and which one it is depends only on whether it is being aimed at.
Conflating that with terrain plans a path into a tree in one direction and
makes every Centre unreachable in the other; both happened.

The atlas is generated, committed, and gated on the cartridge — it describes
FireRed and LeafGreen and nothing else. On anything else it is not loaded and
the recorded route is still there.

### Writing a journey as a straight line

`policy.js` answers one question per frame, which is the only shape a
`requestAnimationFrame` loop allows. A trip does not fit in it: the harness
writes one the way a person would describe it, with loops and early returns.

`drive.js` bridges the two with generators. Where the harness wrote
`machine.step(BTN.UP)` and then looked, a journey writes

```js
const state = yield BTN.UP;
```

and gets back the state after that frame. The driver turns such a generator
into the `step(state) → { keys, done }` the frame loop already speaks, `yield*`
lets one journey call another, and nothing has to be flattened into a state
machine. `journey.js` is the harness's travel and heal routines moved over
essentially unchanged, which is the point — the code that was debugged against
a real cartridge is the code that runs in the tab.

## Playing it unattended

The in-app runner above answers one question per frame — which button now — and
that is the right shape for something running in a tab the player is watching.
It is the wrong shape for "get this Pokémon to level 36", which needs a map,
a Pokémon Center, and the patience to walk back afterwards.

`tools/autoplay/` is that: the same wasm core booted headless from a real
cartridge and save, stepped a frame at a time, with pokefirered's own map data
standing in for eyes. It levelled a Charmeleon into a Charizard in thirteen
minutes across 116 battles and four trips to the Centre, unattended.

Its one rule is the one the whole directory is built from — *press towards a
state, look, and only move on once the machine agrees* — and the walk back from
each mistake that taught it is written down in `tools/autoplay/README.md`.

## Next

1. **A trade, end to end.** Both players stand at the machine; completing a
   trade needs the two units driven with *different* buttons (they sit on
   opposite sides), which the headless driver does not do yet — it feeds both
   machines the same script. That, and a second save file with a different
   trainer.
2. **Windows and blending.** Deferred by the plan, and the plan was right to
   defer them, but FireRed's battle transitions and menus use both. This is
   the next thing that will look wrong.
3. **Get jsmolka's ROMs green.** A booting game is a strong smoke test and a
   weak instruction-level oracle; it exercises the paths Pokémon happens to
   use and nothing else.
4. **Exercise the sync against the live backend.** Cloud saves are built, but
   the conflict path has never run against a real Supabase project: this
   container cannot reach one, and magic-link sign-in needs an inbox. Two
   devices editing the same save is the case to try first.
