//! Link cable tests.
//!
//! The programs here are hand-assembled rather than compiled, for the same
//! reason the CPU tests are: it keeps the test honest about the exact encoding
//! being executed, with no toolchain in between.

mod common;
use common::*;
use gba_core::cable::Cable;
use gba_core::link;
use gba_core::{Emulator, KeyState};

/// A program that identifies which unit it is, contributes a word derived from
/// that id, and — if it is the parent — starts a multiplayer transfer. Both
/// units then sit in a loop reading the two received words into r5 and r6.
fn link_program() -> Vec<u8> {
    // Registers are addressed from 0x0400_0100 because a halfword transfer's
    // immediate offset is only 8 bits, and 0x128 does not fit.
    const IO: u32 = 0x100;
    let code = [
        mov(1, 0x04, 4),                                    // r1 = 0x04000000
        dp_imm(ADD, false, 1, 1, 1, 12),                    // r1 += 0x100
        ldrh_strh(true, true, true, false, 1, 0, 0x28, 1),  // r0 = SIOCNT
        dp_imm(AND, false, 0, 2, 0x30, 0),                  // r2 = id bits
        dp_reg(MOV, false, 0, 2, 2, LSR, 4),                // r2 = id
        dp_imm(ADD, false, 2, 3, 1, 10),                    // r3 = id + 0x1000
        ldrh_strh(false, true, true, false, 1, 3, 0x2A, 1), // SIOMLT_SEND = r3
        dp_imm(MOV, false, 0, 4, 1, 10),                    // r4 = 0x1000 (multiplayer)
        dp_imm(CMP, true, 2, 0, 0, 0),                      // is this the parent?
        // ORREQ r4, r4, #0x80 -- only the parent starts the transfer. Written
        // out because the helpers all encode the AL condition.
        (1 << 25) | (ORR << 21) | (4 << 16) | (4 << 12) | 0x80,
        ldrh_strh(false, true, true, false, 1, 4, 0x28, 1), // SIOCNT = r4
        ldrh_strh(true, true, true, false, 1, 5, 0x20, 1),  // r5 = SIOMULTI0
        ldrh_strh(true, true, true, false, 1, 6, 0x22, 1),  // r6 = SIOMULTI1
        branch(false, -4),                                  // spin
    ];
    let _ = IO;
    let mut rom = Vec::new();
    for word in code {
        rom.extend_from_slice(&word.to_le_bytes());
    }
    rom.resize(0xC0, 0);
    rom
}

fn machine(rom: &[u8]) -> Emulator {
    Emulator::new(rom, None, None)
}

#[test]
fn two_machines_exchange_a_word_over_the_cable() {
    let rom = link_program();
    let mut cable = Cable::new(vec![machine(&rom), machine(&rom)]);
    for _ in 0..4 {
        cable.run_frame(&[KeyState::default(), KeyState::default()]);
    }

    // Both units see the parent's word in slot 0 and the child's in slot 1.
    for (index, machine) in cable.machines.iter().enumerate() {
        assert_eq!(
            machine.cpu.r[5], 0x1000,
            "unit {index} did not see the parent's word"
        );
        assert_eq!(
            machine.cpu.r[6], 0x1001,
            "unit {index} did not see the child's word"
        );
    }
}

#[test]
fn each_unit_knows_which_one_it_is() {
    let rom = link_program();
    let mut cable = Cable::new(vec![machine(&rom), machine(&rom)]);
    cable.run_frame(&[KeyState::default(); 2]);

    // The multiplayer id and the parent/child terminal are driven by the
    // cable, not by whatever the game wrote to SIOCNT.
    let parent = cable.machines[0].mem.siocnt();
    let child = cable.machines[1].mem.siocnt();
    assert_eq!((parent >> 4) & 3, 0);
    assert_eq!((child >> 4) & 3, 1);
    assert_eq!(parent & (1 << 2), 0, "unit 0 should report as the parent");
    assert_ne!(child & (1 << 2), 0, "unit 1 should report as a child");
    // SD is set on both while every unit is present.
    assert_ne!(parent & (1 << 3), 0);
    assert_ne!(child & (1 << 3), 0);
}

#[test]
fn an_unplugged_cable_reads_as_absent_units() {
    let rom = link_program();
    let mut emulator = machine(&rom);
    for _ in 0..2 {
        emulator.run_frame(KeyState::default());
    }
    // With no cable the parent's own start never completes a transfer, and
    // every remote slot reads as disconnected.
    assert_eq!(emulator.cpu.r[6], link::DISCONNECTED as u32);
    assert_eq!(
        emulator.mem.siocnt() & (1 << 3),
        0,
        "SD must be clear with no cable"
    );
}

#[test]
fn a_transfer_raises_the_serial_interrupt_when_asked() {
    // A ROM that does nothing, so the test drives SIOCNT itself. The link
    // program above overwrites SIOCNT without the interrupt bit, which would
    // make this assert the program rather than the plumbing.
    let mut rom = Vec::new();
    rom.extend_from_slice(&0xEAFF_FFFEu32.to_le_bytes()); // b .
    rom.resize(0xC0, 0);

    let mut cable = Cable::new(vec![machine(&rom), machine(&rom)]);
    for (index, machine) in cable.machines.iter_mut().enumerate() {
        // Multiplayer mode, 115200 baud, interrupt on completion.
        machine
            .mem
            .write_io16_raw(link::SIOCNT, 0x1000 | 0x4000 | 0x0003);
        machine
            .mem
            .write_io16_raw(link::SIOMLT_SEND, 0xBEE0 + index as u16);
    }
    cable.machines[0].mem.link.phase = link::Phase::Requested;

    for _ in 0..2 {
        cable.run_frame(&[KeyState::default(); 2]);
    }

    for (index, machine) in cable.machines.iter().enumerate() {
        assert_ne!(
            machine.mem.read_io16(0x202) & gba_core::irq::SERIAL,
            0,
            "unit {index} never saw the serial interrupt"
        );
        assert_eq!(machine.mem.read_io16(link::SIOMULTI0), 0xBEE0);
        assert_eq!(machine.mem.read_io16(link::SIOMULTI1), 0xBEE1);
        // The busy bit clears when the transfer finishes.
        assert_eq!(machine.mem.siocnt() & 0x0080, 0);
    }
}

#[test]
fn a_cable_session_is_deterministic() {
    // The whole netplay design rests on this: two participants running the
    // same inputs must end up in identical states, or the session silently
    // diverges.
    let rom = link_program();
    let run = || {
        let mut cable = Cable::new(vec![machine(&rom), machine(&rom)]);
        for frame in 0..30u64 {
            let a = KeyState((frame.wrapping_mul(2654435761) >> 7) as u16 & 0x3FF);
            let b = KeyState((frame.wrapping_mul(40503) >> 3) as u16 & 0x3FF);
            cable.run_frame(&[a, b]);
        }
        cable.state_hash()
    };
    assert_eq!(run(), run());
}
