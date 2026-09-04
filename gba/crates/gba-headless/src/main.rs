//! Headless runner: boot a ROM, run it without a screen, and report what the
//! machine ended up doing.
//!
//! This exists to make CPU correctness observable before there is anything to
//! look at. jsmolka's arm.gba and thumb.gba stop in a tight terminal loop when
//! they finish; the number of the first failing test is left in r12, and zero
//! means every test passed.

use std::process::ExitCode;

use gba_core::{Emulator, KeyState};

fn usage() -> ExitCode {
    eprintln!(
        "usage: gba-headless <rom.gba> [--bios <bios.bin>] [--frames N] [--steps N] [--determinism]"
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut rom_path: Option<String> = None;
    let mut bios_path: Option<String> = None;
    let mut frames: Option<u64> = None;
    let mut steps: Option<u64> = None;
    let mut determinism = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bios" => bios_path = args.next(),
            "--frames" => frames = args.next().and_then(|v| v.parse().ok()),
            "--steps" => steps = args.next().and_then(|v| v.parse().ok()),
            "--determinism" => determinism = true,
            "-h" | "--help" => return usage(),
            other if other.starts_with("--") => return usage(),
            other => rom_path = Some(other.to_string()),
        }
    }

    let Some(rom_path) = rom_path else {
        return usage();
    };
    let rom = match std::fs::read(&rom_path) {
        Ok(rom) => rom,
        Err(e) => {
            eprintln!("cannot read {rom_path}: {e}");
            return ExitCode::FAILURE;
        }
    };
    let bios = match bios_path.as_deref().map(std::fs::read).transpose() {
        Ok(bios) => bios,
        Err(e) => {
            eprintln!("cannot read BIOS: {e}");
            return ExitCode::FAILURE;
        }
    };

    if determinism {
        let a = run(&rom, bios.as_deref(), frames.unwrap_or(600), steps);
        let b = run(&rom, bios.as_deref(), frames.unwrap_or(600), steps);
        if a.state_hash == b.state_hash {
            println!("deterministic: two runs agree (hash {:016x})", a.state_hash);
            return ExitCode::SUCCESS;
        }
        eprintln!(
            "NOT deterministic: {:016x} vs {:016x}",
            a.state_hash, b.state_hash
        );
        return ExitCode::FAILURE;
    }

    let outcome = run(&rom, bios.as_deref(), frames.unwrap_or(600), steps);
    print_report(&rom, &outcome);

    // jsmolka's convention: r12 holds the first failing test number.
    if outcome.reached_terminal_loop && outcome.registers[12] == 0 {
        println!("\nresult: PASS (terminal loop reached with r12 = 0)");
        ExitCode::SUCCESS
    } else if outcome.reached_terminal_loop {
        println!("\nresult: FAIL at test {} (r12)", outcome.registers[12]);
        ExitCode::FAILURE
    } else {
        println!("\nresult: INCONCLUSIVE (never settled into a terminal loop)");
        ExitCode::FAILURE
    }
}

struct Outcome {
    registers: [u32; 16],
    cpsr: u32,
    cycles: u64,
    executed: u64,
    reached_terminal_loop: bool,
    state_hash: u64,
}

fn run(rom: &[u8], bios: Option<&[u8]>, frames: u64, steps: Option<u64>) -> Outcome {
    let mut emu = Emulator::new(rom, bios, None);
    let budget = steps.unwrap_or(frames * gba_core::CYCLES_PER_FRAME);

    // A test ROM signals completion by branching to itself. Detect that by
    // watching for a PC that stops moving across a window of instructions.
    let mut last_pc = u32::MAX;
    let mut stuck = 0u32;
    let mut executed = 0u64;
    let mut reached_terminal_loop = false;

    while emu.mem.cycles < budget {
        emu.step();
        executed += 1;
        let pc = emu.cpu.r[15];
        if pc == last_pc {
            stuck += 1;
            if stuck > 64 {
                reached_terminal_loop = true;
                break;
            }
        } else {
            stuck = 0;
            last_pc = pc;
        }
    }
    let _ = KeyState::default();

    Outcome {
        registers: emu.cpu.r,
        cpsr: emu.cpu.cpsr.0,
        cycles: emu.mem.cycles,
        executed,
        reached_terminal_loop,
        state_hash: fnv1a(&emu.serialize_state()),
    }
}

fn print_report(rom: &[u8], outcome: &Outcome) {
    if let Some(header) = gba_core::mem::cart::Header::parse(rom) {
        println!("title      {}", header.title);
        println!("game code  {}", header.game_code);
        println!("maker      {}", header.maker_code);
    }
    println!(
        "save type  {:?}",
        gba_core::mem::cart::detect_save_type(rom)
    );
    println!("rom size   {} bytes", rom.len());
    println!();
    for row in 0..4 {
        let cells: Vec<String> = (0..4)
            .map(|col| {
                let n = row * 4 + col;
                format!("r{n:<2} {:08x}", outcome.registers[n])
            })
            .collect();
        println!("{}", cells.join("  "));
    }
    println!("cpsr {:08x}", outcome.cpsr);
    println!(
        "instructions {}  cycles {}",
        outcome.executed, outcome.cycles
    );
    println!("state hash {:016x}", outcome.state_hash);
}

/// FNV-1a. A stable, dependency-free hash for comparing two runs; it is a
/// determinism check, not a security primitive.
fn fnv1a(data: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}
