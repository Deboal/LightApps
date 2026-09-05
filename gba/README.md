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

**Not yet a trade.** Confirming at that prompt ends in "Communication error",
so the handshake succeeds and the data phase that follows does not. The
leading suspect is `transfer_cycles`, which is derived from the baud rate
rather than measured, and the fact that this core's timing is
scanline-approximate with no wait-state accuracy.

Three bugs on the way here, each found by running the real game rather than by
re-reading the code, and none of which the unit tests caught:

- Multiplayer is SIOCNT mode 2, not 1. The hand-assembled test ROM encoded the
  same wrong value, so the test agreed with the code that shared its
  misunderstanding.
- SIOMULTI0-3 are writable. The games clear them between transfers; treating
  them as read-only left a stale word where the game expected a blank slate.
- Received words must appear when a transfer *completes*, not when it starts.
  Delivering early let the game read the answer before it had asked the
  question, and its own clear then wiped the real result.

## Next

1. **Windows and blending.** Deferred by the plan, and the plan was right to
   defer them, but FireRed's battle transitions and menus use both. This is
   the next thing that will look wrong.
2. **Get jsmolka's ROMs green.** A booting game is a strong smoke test and a
   weak instruction-level oracle; it exercises the paths Pokémon happens to
   use and nothing else.
3. **Exercise the sync against the live backend.** Cloud saves are built, but
   the conflict path has never run against a real Supabase project: this
   container cannot reach one, and magic-link sign-in needs an inbox. Two
   devices editing the same save is the case to try first.
