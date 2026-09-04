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
      src/state.rs  # explicit ordered serialization
      tests/        # arm, thumb, memory, determinism, roms
    gba-headless/   # runs a ROM without a screen and dumps the machine
```

`gba-core` has **zero dependencies**, by rule rather than by accident: every
dependency is a chance for someone else's iteration order or clock to leak
into emulator state and break determinism.

## Status

| Phase | State |
|---|---|
| 1 — CPU (ARM + Thumb) | Complete, tested against a hand-written suite; **not** yet against jsmolka's ROMs |
| 2 — Memory map and cartridge | Complete: mirroring, open bus, 8-bit save bus, header and save-type detection |
| 3 — BIOS | Not started. A real BIOS image loads and executes; the HLE SWI layer does not exist |
| 4 — PPU | Not started. `framebuffer()` returns a blank buffer rather than pretending |
| 5 — Sprites, DMA, timers, IRQ | Interrupt dispatch and `IE`/`IF`/`IME`/HALTCNT exist; DMA, timers and the PPU do not |
| 6 — Flash save | Command state machine complete and tested, including bank switching and chip ID |
| 7 — Save states | Explicit versioned serialization, refuses a mismatched version |

Flash (phase 6) and save states (phase 7) landed early because both are
self-contained and independent of the CPU, and both are the kind of thing
that is miserable to retrofit onto a machine you have already started
trusting with a playthrough.

## Running it

```sh
cargo test --release          # 75 tests, about a second
cargo run -p gba-headless -- <rom.gba> --frames 600
cargo run -p gba-headless -- <rom.gba> --determinism
```

The headless runner boots a ROM, runs it until it settles into a terminal
loop or the frame budget expires, then prints the register file, the cycle
count, and a hash of the whole machine state.

## What is verified, and what is not

**Verified here:** 75 tests covering the barrel shifter's shift-by-zero
encodings, carry and overflow on every arithmetic form, PC's +8/+12 pipeline
bias, LDM/STM base-in-list behaviour, mode banking, exception entry, all 19
Thumb formats, VRAM's non-power-of-two mirroring, byte-write widening in
video memory, the save region's 8-bit bus, the flash command state machine,
a 600-frame double-run state hash, and a save-state round trip.

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

600 frames (10 seconds of emulated time) of a tight ARM loop running from ROM
takes **0.32 s** on the container this was built in — about 31× realtime,
63M instructions/s. That is a CPU-only ceiling on cheap code; real game code
plus a scanline PPU will be substantially slower, and WASM typically costs
another 1.5–2.5×. The headroom is there for 60 fps and for tiered
fast-forward on a phone, but the PPU is what will decide it.

## How this reaches a phone

The core is deliberately I/O-free so the same crate serves a native shell, a
WASM shell, and a server. Note one consequence for this repository: LightApps
deploys by having Netlify run `build.sh`, which bundles JavaScript with
esbuild and has no Rust toolchain. So the eventual `apps/gba/` front-end will
load a **pre-built** `.wasm` committed under `apps/gba/assets/` (that
directory is copied verbatim by `build.sh`), with the wasm rebuilt by hand or
by CI rather than by Netlify. The Supabase store and magic-link auth already
in `shared/` cover the save-sync design in section 4 of the handoff without a
separate `gba-server`.

`build.sh` ignores this directory entirely; the LightApps deploy is unaffected.

## Next

1. Get jsmolka's ROMs green. Nothing above this line is trustworthy until
   that happens, and every later bug gets ten times harder to find if the CPU
   is wrong underneath it.
2. Phase 3: HLE the SWIs Pokémon uses, LZ77 first — it compresses nearly all
   its graphics.
3. Phase 4: the PPU timing skeleton (VCOUNT, DISPSTAT, the VBlank IRQ) before
   any pixel, because the game's whole main loop is built on `VBlankIntrWait`.
