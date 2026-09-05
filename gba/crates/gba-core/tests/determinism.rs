//! Determinism and save-state tests.
//!
//! Decision 1.2 of the design: same ROM, same initial state, same input
//! sequence must produce a bit-identical machine every run, on every
//! platform. Lockstep netplay depends on it, and so does trusting that a save
//! state describes the machine it claims to.
//!
//! Run with `--release` if the 600-frame case feels slow; it is the same test.

mod common;
use common::*;
use gba_core::state::StateError;
use gba_core::{Emulator, KeyState};

/// A small ROM that reads the key register, mutates a register chain, and
/// writes into IWRAM in a loop -- enough moving parts that any nondeterminism
/// in the CPU, the bus or the cycle accounting shows up in the final state.
fn workload() -> Vec<u8> {
    let code = [
        mov(4, 0x03, 4),                                      // r4 = IWRAM base
        mov(2, 0x04, 4),                                      // r2 = I/O base
        mov(0, 0, 0),                                         // r0 = 0
        mov(1, 0, 0),                                         // r1 = 0
        ldr_str(true, false, true, true, false, 2, 3, 0x130), // r3 = KEYINPUT
        dp_reg(EOR, false, 0, 0, 3, LSL, 0),
        dp_imm(ADD, false, 0, 0, 1, 0),
        0xE784_0001, // str r0, [r4, r1]
        dp_imm(ADD, false, 1, 1, 4, 0),
        dp_imm(AND, false, 1, 1, 0xFC, 0),
        branch(false, -8),
    ];
    let mut rom = Vec::new();
    for word in code {
        rom.extend_from_slice(&word.to_le_bytes());
    }
    rom.resize(0xC0, 0);
    rom
}

/// A scripted input sequence: deterministic, but varied enough that the
/// emulator cannot pass by ignoring input entirely.
fn scripted_input(frame: u64) -> KeyState {
    KeyState((frame.wrapping_mul(2654435761) >> 7) as u16 & 0x03FF)
}

fn run_frames(rom: &[u8], frames: u64) -> Vec<u8> {
    let mut emu = Emulator::new(rom, None, None);
    for frame in 0..frames {
        emu.run_frame(scripted_input(frame));
    }
    emu.serialize_state()
}

#[test]
fn six_hundred_frames_twice_produce_identical_state() {
    let rom = workload();
    assert_eq!(run_frames(&rom, 600), run_frames(&rom, 600));
}

#[test]
fn input_actually_reaches_the_machine() {
    // A determinism test passes trivially if input is ignored, so prove that
    // two different input sequences diverge.
    let rom = workload();
    let mut held = Emulator::new(&rom, None, None);
    let mut idle = Emulator::new(&rom, None, None);
    for _ in 0..8 {
        held.run_frame(KeyState(KeyState::A | KeyState::START));
        idle.run_frame(KeyState::default());
    }
    assert_ne!(held.serialize_state(), idle.serialize_state());
}

#[test]
fn a_save_state_restores_the_machine_exactly() {
    let rom = workload();
    let mut emu = Emulator::new(&rom, None, None);
    for frame in 0..20 {
        emu.run_frame(scripted_input(frame));
    }
    let snapshot = emu.serialize_state();

    for frame in 20..40 {
        emu.run_frame(scripted_input(frame));
    }
    let expected = emu.serialize_state();

    // Restoring and replaying the same inputs has to land in the same place.
    let mut restored = Emulator::new(&rom, None, None);
    restored.deserialize_state(&snapshot).expect("restore");
    for frame in 20..40 {
        restored.run_frame(scripted_input(frame));
    }
    assert_eq!(restored.serialize_state(), expected);
}

#[test]
fn a_state_from_another_version_is_refused_rather_than_guessed_at() {
    let rom = workload();
    let mut emu = Emulator::new(&rom, None, None);
    let mut state = emu.serialize_state();
    // Corrupt the version word that follows the magic number.
    state[4..8].copy_from_slice(&0xDEAD_u32.to_le_bytes());
    assert!(matches!(
        emu.deserialize_state(&state),
        Err(StateError::VersionMismatch { found: 0xDEAD, .. })
    ));

    state[0..4].copy_from_slice(&0u32.to_le_bytes());
    assert_eq!(emu.deserialize_state(&state), Err(StateError::BadMagic));

    assert_eq!(
        emu.deserialize_state(&[1, 2, 3]),
        Err(StateError::Truncated)
    );
}

#[test]
fn a_frame_is_a_fixed_cycle_budget() {
    // The core never runs "until the frame looks done". Each frame targets an
    // exact cumulative cycle count, and the overshoot from the instruction
    // that straddles the boundary is carried into the next frame rather than
    // being dropped -- so error cannot accumulate over a session.
    let rom = workload();
    let mut emu = Emulator::new(&rom, None, None);
    for frame in 1..=100u64 {
        emu.run_frame(KeyState::default());
        let budget = frame * gba_core::CYCLES_PER_FRAME;
        assert!(emu.mem.cycles >= budget);
        assert!(
            emu.mem.cycles < budget + 64,
            "frame {frame} drifted to {} against a budget of {budget}",
            emu.mem.cycles
        );
    }
}

#[test]
fn a_state_written_before_the_stall_existed_still_loads() {
    // The interruptible-BIOS-call fix added two words to the state. They go
    // on the end and are read with a default so that the save states already
    // sitting in someone's cloud storage keep working; dropping them would
    // have been a version bump and a bad trade for two words of debt.
    let rom = workload();
    let mut emu = Emulator::new(&rom, None, None);
    for frame in 0..8 {
        emu.run_frame(scripted_input(frame));
    }
    let state = emu.serialize_state();
    let older = &state[..state.len() - 8];

    let mut restored = Emulator::new(&rom, None, None);
    restored
        .deserialize_state(older)
        .expect("a state without the stall words must still load");
    assert_eq!(restored.cpu.stall, 0);
}
