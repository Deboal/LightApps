//! Interrupts, BIOS, timers, DMA and PPU timing.
//!
//! Several of these are regressions from bringing a real game up: the pattern
//! they share is that nothing crashes, the machine simply stops making
//! progress, which is far harder to notice than a fault.

use gba_core::bus::Bus;
use gba_core::mem::Memory;
use gba_core::{bios, dma, irq, ppu, timers, Emulator, KeyState};

const IWRAM: u32 = 0x0300_0000;
const IE: u32 = 0x0400_0200;
const IME: u32 = 0x0400_0208;

fn machine() -> Emulator {
    let mut rom = vec![0u8; 0x1000];
    // A tight ARM self-branch, so the CPU has somewhere harmless to sit.
    rom[0..4].copy_from_slice(&0xEAFF_FFFEu32.to_le_bytes());
    Emulator::new(&rom, None, None)
}

#[test]
fn an_interrupt_reaches_the_handler_the_game_installed() {
    // The bug this pins down: BIOS memory is readable only from inside the
    // BIOS, and the exception vector is entered and fetched within a single
    // step. Deciding readability from the *previous* instruction's address
    // makes the CPU fetch the open-bus latch instead of the vector, and the
    // stale latch happened to be `subs pc, lr, #4` -- which sent the CPU
    // straight back to the interrupted instruction, forever.
    let mut emu = machine();
    let handler = IWRAM + 0x400;
    emu.mem.write32(bios::IRQ_HANDLER_POINTER, handler);
    // The handler is a single self-branch; reaching it at all is the point.
    emu.mem.write32(handler, 0xEAFF_FFFE);

    emu.mem.write16(IME, 1);
    emu.mem.write16(IE, irq::VBLANK);
    // IF is write-one-to-clear, so the flag has to be raised the way the
    // hardware raises it.
    emu.mem.raise_irq(irq::VBLANK);
    emu.cpu.cpsr.set_irq_disabled(false);

    // Exception entry, the vector branch, and the four instructions of the
    // BIOS prologue.
    for _ in 0..8 {
        emu.step();
    }
    assert_eq!(
        emu.cpu.r[15] & !3,
        handler,
        "never reached the game's handler"
    );
}

#[test]
fn bios_memory_is_unreadable_from_outside_it() {
    let mut emu = machine();
    // A fetch from the cartridge closes BIOS access.
    emu.mem.on_fetch(0x0800_0000);
    let leaked = emu.mem.read32(0x0000_0000);
    emu.mem.on_fetch(0x0000_0000);
    let genuine = emu.mem.read32(0x0000_0000);
    assert_ne!(leaked, genuine);
    // The synthesized reset vector jumps to the cartridge entry point.
    assert_eq!(genuine, 0xE3A0_F302);
}

#[test]
fn timers_count_at_their_prescaler_and_raise_an_interrupt_on_overflow() {
    let mut emu = machine();
    emu.mem.write16(0x0400_0100, 0xFFFE); // reload
    emu.mem.write16(0x0400_0102, 0x00C0 | 0x0003); // enable, IRQ, /1024

    timers::step(&mut emu.mem, 1023);
    assert_eq!(
        emu.mem.timers[0].counter, 0xFFFE,
        "ticked before the prescaler elapsed"
    );

    timers::step(&mut emu.mem, 1);
    assert_eq!(emu.mem.timers[0].counter, 0xFFFF);
    assert_eq!(emu.mem.read_io16(0x202) & irq::TIMER0, 0);

    // One more tick wraps, reloads, and raises the interrupt.
    timers::step(&mut emu.mem, 1024);
    assert_eq!(emu.mem.timers[0].counter, 0xFFFE);
    assert_ne!(emu.mem.read_io16(0x202) & irq::TIMER0, 0);
}

#[test]
fn a_cascading_timer_counts_its_predecessors_overflows() {
    let mut emu = machine();
    emu.mem.write16(0x0400_0100, 0xFFFF);
    emu.mem.write16(0x0400_0102, 0x0080); // enable, /1
    emu.mem.write16(0x0400_0104, 0);
    emu.mem.write16(0x0400_0106, 0x0084); // enable, cascade

    timers::step(&mut emu.mem, 3);
    // Timer 0 wrapped three times; timer 1 counted those, not the cycles.
    assert_eq!(emu.mem.timers[1].counter, 3);
}

#[test]
fn an_immediate_dma_copies_and_then_disables_itself() {
    let mut emu = machine();
    for i in 0..4u32 {
        emu.mem.write32(IWRAM + i * 4, 0x1000 + i);
    }
    emu.mem.write32(0x0400_00B0, IWRAM); // source
    emu.mem.write32(0x0400_00B4, IWRAM + 0x100); // destination
    emu.mem.write16(0x0400_00B8, 4); // word count
    emu.mem.write16(0x0400_00BA, 0x8400); // enable, 32-bit, immediate

    assert!(dma::any_pending(&emu.mem));
    dma::run(&mut emu.mem);

    for i in 0..4u32 {
        assert_eq!(emu.mem.read32(IWRAM + 0x100 + i * 4), 0x1000 + i);
    }
    // A non-repeating channel clears its own enable bit when it finishes.
    assert_eq!(emu.mem.read_io16(0xBA) & 0x8000, 0);
    assert!(!dma::any_pending(&emu.mem));
}

#[test]
fn a_vblank_dma_waits_for_vblank_and_repeats() {
    let mut emu = machine();
    emu.mem.write32(IWRAM, 0xABCD_1234);
    emu.mem.write32(0x0400_00B0, IWRAM);
    emu.mem.write32(0x0400_00B4, IWRAM + 0x200);
    emu.mem.write16(0x0400_00B8, 1);
    // Enable, 32-bit, repeat, VBlank timing.
    emu.mem.write16(0x0400_00BA, 0x8600 | (1 << 12));

    assert!(
        !dma::any_pending(&emu.mem),
        "a VBlank channel must not fire immediately"
    );
    ppu::step(&mut emu.mem, ppu::LINE_CYCLES * 161);
    assert!(dma::any_pending(&emu.mem));
    dma::run(&mut emu.mem);
    assert_eq!(emu.mem.read32(IWRAM + 0x200), 0xABCD_1234);
    // Repeat keeps the channel armed for the next frame.
    assert_ne!(emu.mem.read_io16(0xBA) & 0x8000, 0);
}

#[test]
fn the_display_walks_scanlines_and_signals_vblank() {
    let mut emu = machine();
    emu.mem.write16(0x0400_0004, 1 << 3); // VBlank IRQ enable

    ppu::step(&mut emu.mem, ppu::LINE_CYCLES);
    assert_eq!(emu.mem.read_io16(0x006), 1);
    assert_eq!(
        emu.mem.read_io16(0x004) & 1,
        0,
        "VBlank set during the visible area"
    );

    ppu::step(&mut emu.mem, ppu::LINE_CYCLES * 159);
    assert_eq!(emu.mem.read_io16(0x006), 160);
    assert_ne!(emu.mem.read_io16(0x004) & 1, 0);
    assert_ne!(emu.mem.read_io16(0x202) & irq::VBLANK, 0);

    // A full frame is exactly 228 lines.
    ppu::step(&mut emu.mem, ppu::LINE_CYCLES * 68);
    assert_eq!(emu.mem.read_io16(0x006), 0);
}

#[test]
fn hblank_is_flagged_partway_through_each_line() {
    let mut emu = machine();
    ppu::step(&mut emu.mem, ppu::HDRAW_CYCLES - 1);
    assert_eq!(emu.mem.read_io16(0x004) & 2, 0);
    ppu::step(&mut emu.mem, 1);
    assert_ne!(emu.mem.read_io16(0x004) & 2, 0);
    ppu::step(&mut emu.mem, ppu::LINE_CYCLES - ppu::HDRAW_CYCLES);
    assert_eq!(emu.mem.read_io16(0x004) & 2, 0);
}

#[test]
fn a_forced_blank_drives_the_screen_white() {
    let mut emu = machine();
    emu.mem.write16(0x0400_0000, 1 << 7);
    // A scanline is drawn as it begins, so one line of cycles renders line 1.
    ppu::step(&mut emu.mem, ppu::LINE_CYCLES);
    assert_eq!(emu.framebuffer()[gba_core::SCREEN_WIDTH], 0x7FFF);
}

#[test]
fn a_tiled_background_renders_from_vram() {
    let mut emu = machine();
    // Mode 0, BG0 on, 4bpp tiles at char block 0, map at screen block 31.
    emu.mem.write16(0x0400_0000, 1 << 8);
    emu.mem.write16(0x0400_0008, 31 << 8);
    // Palette entry 1 of bank 0 is red.
    emu.mem.write16(0x0500_0002, 0x001F);
    // Tile 1: every pixel uses colour index 1.
    for byte in 0..32u32 {
        emu.mem.write8(0x0600_0020 + byte, 0x11);
    }
    // Map entry (0,0) points at tile 1.
    emu.mem.write16(0x0600_0000 + 31 * 0x800, 1);

    ppu::step(&mut emu.mem, ppu::LINE_CYCLES);
    let line = gba_core::SCREEN_WIDTH;
    assert_eq!(emu.framebuffer()[line], 0x001F);
    // Beyond the one tile, the backdrop shows through.
    assert_eq!(emu.framebuffer()[line + 8], 0x0000);
}

#[test]
fn keypad_input_is_active_low_at_the_register() {
    let mut emu = machine();
    emu.run_frame(KeyState(KeyState::A | KeyState::START));
    let keyinput = emu.mem.read_io16(0x130);
    assert_eq!(keyinput & KeyState::A, 0, "a pressed button reads as zero");
    assert_eq!(keyinput & KeyState::START, 0);
    assert_ne!(keyinput & KeyState::B, 0);
}

// -- BIOS calls ----------------------------------------------------------

fn call(emu: &mut Emulator, swi: u32) {
    bios::dispatch(&mut emu.cpu, &mut emu.mem, swi);
}

#[test]
fn div_and_sqrt_match_the_bios_contract() {
    let mut emu = machine();
    emu.cpu.r[0] = 100;
    emu.cpu.r[1] = 7;
    call(&mut emu, 0x06);
    assert_eq!(emu.cpu.r[0], 14);
    assert_eq!(emu.cpu.r[1], 2);
    assert_eq!(emu.cpu.r[3], 14);

    // Division truncates toward zero, including for negatives.
    emu.cpu.r[0] = (-100i32) as u32;
    emu.cpu.r[1] = 7;
    call(&mut emu, 0x06);
    assert_eq!(emu.cpu.r[0] as i32, -14);
    assert_eq!(emu.cpu.r[3], 14);

    emu.cpu.r[0] = 12345;
    call(&mut emu, 0x08);
    assert_eq!(emu.cpu.r[0], 111);
}

#[test]
fn arctan2_covers_all_four_quadrants() {
    let mut emu = machine();
    let angle = |emu: &mut Emulator, x: i32, y: i32| {
        emu.cpu.r[0] = x as u32 & 0xFFFF;
        emu.cpu.r[1] = y as u32 & 0xFFFF;
        call(emu, 0x0A);
        emu.cpu.r[0]
    };
    assert_eq!(angle(&mut emu, 1, 0), 0x0000);
    assert_eq!(angle(&mut emu, 0, 1), 0x4000);
    assert_eq!(angle(&mut emu, -1, 0), 0x8000);
    assert_eq!(angle(&mut emu, 0, -1), 0xC000);
}

#[test]
fn cpu_set_copies_and_fills() {
    let mut emu = machine();
    emu.mem.write32(IWRAM, 0xDEAD_BEEF);
    emu.mem.write32(IWRAM + 4, 0x1234_5678);

    emu.cpu.r[0] = IWRAM;
    emu.cpu.r[1] = IWRAM + 0x100;
    emu.cpu.r[2] = 2 | (1 << 26);
    call(&mut emu, 0x0B);
    assert_eq!(emu.mem.read32(IWRAM + 0x100), 0xDEAD_BEEF);
    assert_eq!(emu.mem.read32(IWRAM + 0x104), 0x1234_5678);

    // Fill mode reads the source once.
    emu.cpu.r[0] = IWRAM;
    emu.cpu.r[1] = IWRAM + 0x200;
    emu.cpu.r[2] = 4 | (1 << 24) | (1 << 26);
    call(&mut emu, 0x0B);
    for i in 0..4 {
        assert_eq!(emu.mem.read32(IWRAM + 0x200 + i * 4), 0xDEAD_BEEF);
    }
}

#[test]
fn cpu_fast_set_rounds_up_to_eight_words() {
    let mut emu = machine();
    for i in 0..8u32 {
        emu.mem.write32(IWRAM + i * 4, i);
    }
    emu.cpu.r[0] = IWRAM;
    emu.cpu.r[1] = IWRAM + 0x100;
    emu.cpu.r[2] = 3;
    call(&mut emu, 0x0C);
    for i in 0..8u32 {
        assert_eq!(emu.mem.read32(IWRAM + 0x100 + i * 4), i);
    }
}

#[test]
fn lz77_decompresses_a_back_reference() {
    // Pokemon compresses nearly all of its graphics with LZ77, so this path
    // runs constantly during a boot.
    let mut emu = machine();
    let stream: [u8; 8] = [
        0x10, 0x08, 0x00, 0x00, // type 0x10, 8 bytes out
        0x40, // one literal, then one back reference
        b'A', 0x40, 0x00, // copy 7 bytes from one byte back
    ];
    for (i, byte) in stream.iter().enumerate() {
        emu.mem.write8(IWRAM + i as u32, *byte);
    }
    emu.cpu.r[0] = IWRAM;
    emu.cpu.r[1] = IWRAM + 0x100;
    call(&mut emu, 0x11);

    for i in 0..8u32 {
        assert_eq!(emu.mem.read8(IWRAM + 0x100 + i), b'A');
    }
}

#[test]
fn run_length_decompresses_both_block_kinds() {
    let mut emu = machine();
    let stream: [u8; 10] = [
        0x30, 0x06, 0x00, 0x00, // type 0x30, 6 bytes out
        0x81, b'Z', // compressed: four Zs
        0x01, b'x', b'y', 0x00, // literal: two bytes
    ];
    for (i, byte) in stream.iter().enumerate() {
        emu.mem.write8(IWRAM + i as u32, *byte);
    }
    emu.cpu.r[0] = IWRAM;
    emu.cpu.r[1] = IWRAM + 0x100;
    call(&mut emu, 0x14);

    let out: Vec<u8> = (0..6).map(|i| emu.mem.read8(IWRAM + 0x100 + i)).collect();
    assert_eq!(out, b"ZZZZxy");
}

#[test]
fn a_vram_decompressor_writes_halfwords() {
    // Byte writes to video memory are widened by the hardware, so the VRAM
    // variants of the decompressors must not use them.
    let mut emu = machine();
    // Header, one flag byte of literals, then the four bytes themselves.
    let stream: [u8; 9] = [0x10, 0x04, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03];
    for (i, byte) in stream.iter().enumerate() {
        emu.mem.write8(IWRAM + i as u32, *byte);
    }
    emu.cpu.r[0] = IWRAM;
    emu.cpu.r[1] = 0x0600_0000;
    call(&mut emu, 0x12);
    assert_eq!(emu.mem.read16(0x0600_0000), 0x0100);
    assert_eq!(emu.mem.read16(0x0600_0002), 0x0302);
}

#[test]
fn register_ram_reset_spares_the_stacks_and_the_handler_pointer() {
    let mut emu = machine();
    emu.mem.write32(IWRAM, 0xFFFF_FFFF);
    emu.mem.write32(bios::IRQ_HANDLER_POINTER, 0x0300_1234);
    emu.cpu.r[0] = 0x02; // IWRAM only
    call(&mut emu, 0x01);
    assert_eq!(emu.mem.read32(IWRAM), 0);
    assert_eq!(emu.mem.read32(bios::IRQ_HANDLER_POINTER), 0x0300_1234);
}

#[test]
fn halt_parks_the_cpu_until_an_interrupt_arrives() {
    let mut emu = machine();
    call(&mut emu, 0x02);
    assert!(emu.cpu.halted);

    let pc = emu.cpu.r[15];
    for _ in 0..100 {
        emu.step();
    }
    assert_eq!(
        emu.cpu.r[15], pc,
        "a halted CPU must not retire instructions"
    );
    assert!(emu.mem.cycles > 0, "but time must still pass");

    emu.mem.write16(IME, 1);
    emu.mem.write16(IE, irq::VBLANK);
    emu.mem.raise_irq(irq::VBLANK);
    emu.cpu.cpsr.set_irq_disabled(false);
    emu.step();
    assert!(!emu.cpu.halted);
}

#[test]
fn a_bare_memory_bus_needs_no_ppu() {
    // The Bus trait exists so the CPU can be exercised without the rest of
    // the machine; this keeps that seam honest.
    let mut mem = Memory::new(vec![0; 0x100], None);
    mem.write32(IWRAM, 0x1234_5678);
    assert_eq!(mem.read32(IWRAM), 0x1234_5678);
}

#[test]
fn a_long_bios_call_is_interruptible() {
    // The bug this pins down: a BIOS decompression is performed here in one
    // go, and the cycles it costs were billed inside the single instruction
    // that called it. Nothing could interrupt a hundred thousand cycles of
    // it, so a linked game -- whose master must complete nine cable
    // transfers every frame, paced by a timer interrupt -- lost four of them
    // whenever the map loader decompressed a tileset, declared the master
    // lagging, and put up "Communication error". On hardware the call is
    // ordinary BIOS code running with interrupts enabled.
    let mut rom = vec![0u8; 0x1000];
    // In ARM the SWI number is the top byte of the comment field.
    rom[0..4].copy_from_slice(&0xEF11_0000u32.to_le_bytes()); // swi 0x11
    rom[4..8].copy_from_slice(&0xEAFF_FFFEu32.to_le_bytes()); // b .
    rom[8..12].copy_from_slice(&0xE1A0_0000u32.to_le_bytes()); // mov r0, r0
    let mut emu = Emulator::new(&rom, None, None);

    // An LZ77 stream of nothing but literals: a zero flag byte, then eight
    // bytes copied straight through. Big enough that decompressing it costs
    // far more than any single instruction ever should.
    let src = 0x0200_0000u32;
    let dst = 0x0201_0000u32;
    let size = 0x4000u32;
    emu.mem.write32(src, 0x10 | (size << 8));
    let mut at = src + 4;
    for _ in 0..size / 8 {
        emu.mem.write8(at, 0);
        for i in 1..9 {
            emu.mem.write8(at + i, 0x5A);
        }
        at += 9;
    }
    emu.cpu.r[0] = src;
    emu.cpu.r[1] = dst;

    let before = emu.mem.cycles;
    emu.step();
    let billed = emu.mem.cycles - before;
    assert!(
        emu.cpu.stall > 10_000,
        "the call should leave a debt to serve, not bill it all at once"
    );
    assert!(
        billed < 1_000,
        "one step billed {billed} cycles; nothing can interrupt that"
    );
    assert_eq!(emu.mem.read8(dst), 0x5A, "and it still decompressed");

    // The debt is only served where it was incurred. An interrupt moves the
    // PC away, and the handler must then run at full speed -- serving the
    // debt inside the handler would hold it at its first instruction until
    // the debt ran out, which was the first attempt at this fix.
    let owed = emu.cpu.stall;
    let elsewhere = 0x0800_0008;
    emu.cpu.set(15, elsewhere);
    let before = emu.mem.cycles;
    emu.step();
    assert_eq!(emu.cpu.stall, owed, "the debt waited");
    assert!(
        emu.mem.cycles - before < 100,
        "and the instruction there ran at full speed"
    );

    // Back at the owing instruction, the debt is paid off a slice at a time.
    emu.cpu.set(15, emu.cpu.stall_pc);
    let mut steps = 0;
    while emu.cpu.stall > 0 && steps < 100_000 {
        emu.step();
        steps += 1;
    }
    assert_eq!(emu.cpu.stall, 0, "the debt is eventually paid in full");
    assert!(steps > 100, "and paid gradually, not in one jump");
}
