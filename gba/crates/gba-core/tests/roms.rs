//! Test-ROM harness.
//!
//! jsmolka's gba-tests are the correctness oracle for the CPU. They are not
//! vendored here (they are someone else's repository, and this environment
//! cannot reach it), so these tests look for the ROMs and skip cleanly when
//! they are absent. Drop `arm.gba`, `thumb.gba` and `memory.gba` into
//! `crates/gba-core/tests/roms/` and they run as part of `cargo test`.

use std::path::PathBuf;

use gba_core::{Emulator, KeyState};

fn rom_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/roms")
}

/// Run until the ROM settles into the tight loop it uses to signal that it is
/// finished, or until the frame budget runs out.
fn run_until_settled(rom: &[u8], frames: u64) -> Option<Emulator> {
    let mut emu = Emulator::new(rom, None, None);
    let budget = frames * gba_core::CYCLES_PER_FRAME;
    let mut last_pc = u32::MAX;
    let mut stuck = 0;
    while emu.mem.cycles < budget {
        emu.step();
        let pc = emu.cpu.r[15];
        if pc == last_pc {
            stuck += 1;
            if stuck > 64 {
                return Some(emu);
            }
        } else {
            stuck = 0;
            last_pc = pc;
        }
    }
    let _ = KeyState::default();
    None
}

fn check(name: &str) {
    let path = rom_dir().join(name);
    let Ok(rom) = std::fs::read(&path) else {
        eprintln!("skipping {name}: not present at {}", path.display());
        return;
    };
    let emu = run_until_settled(&rom, 600)
        .unwrap_or_else(|| panic!("{name} never reached a terminal loop"));
    // jsmolka's ROMs leave the number of the first failing test in r12.
    // Confirm this against the ROM you drop in; if the convention differs it
    // is this one assertion that changes, not the harness around it.
    assert_eq!(
        emu.cpu.r[12], 0,
        "{name} failed at test {} (r15 = {:08x})",
        emu.cpu.r[12], emu.cpu.r[15]
    );
}

#[test]
fn arm_test_rom() {
    check("arm.gba");
}

#[test]
fn thumb_test_rom() {
    check("thumb.gba");
}

#[test]
fn memory_test_rom() {
    check("memory.gba");
}
