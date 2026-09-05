//! Headless runner: boot a ROM, run it without a screen, and report what the
//! machine ended up doing.
//!
//! This exists to make CPU correctness observable before there is anything to
//! look at. jsmolka's arm.gba and thumb.gba stop in a tight terminal loop when
//! they finish; the number of the first failing test is left in r12, and zero
//! means every test passed.

mod png;

use std::process::ExitCode;

use gba_core::cable::Cable;
use gba_core::{Emulator, KeyState};

fn usage() -> ExitCode {
    eprintln!(
        "usage: gba-headless <rom.gba> [--bios <bios.bin>] [--frames N] [--steps N]\n                            [--determinism] [--screenshot out.png] [--scale N]\n                            [--link | --link-rom <second.gba>]"
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut rom_path: Option<String> = None;
    let mut bios_path: Option<String> = None;
    let mut frames: Option<u64> = None;
    let mut steps: Option<u64> = None;
    let mut watch: Option<u32> = None;
    let mut script: Vec<(u64, u16, u64)> = Vec::new();
    let mut mash_from: Option<u64> = None;
    let mut mash_until: Option<u64> = None;
    let mut save_in: Option<String> = None;
    let mut save_out: Option<String> = None;
    let mut link: Option<Option<String>> = None;
    let mut determinism = false;
    let mut screenshot: Option<String> = None;
    let mut scale: usize = 3;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bios" => bios_path = args.next(),
            "--frames" => frames = args.next().and_then(|v| v.parse().ok()),
            "--steps" => steps = args.next().and_then(|v| v.parse().ok()),
            "--determinism" => determinism = true,
            "--script" => script = args.next().map(|v| parse_script(&v)).unwrap_or_default(),
            "--mash-from" => mash_from = args.next().and_then(|v| v.parse().ok()),
            "--mash-until" => mash_until = args.next().and_then(|v| v.parse().ok()),
            "--save-in" => save_in = args.next(),
            "--save-out" => save_out = args.next(),
            // A bare --link runs two copies of the same cartridge; --link-rom
            // takes a second one. Making --link greedy would have it swallow
            // the next flag.
            "--link" => link = Some(link.flatten()),
            "--link-rom" => link = Some(args.next()),
            "--watch" => {
                watch = args
                    .next()
                    .and_then(|v| u32::from_str_radix(v.trim_start_matches("0x"), 16).ok())
            }
            "--screenshot" => screenshot = args.next(),
            "--scale" => scale = args.next().and_then(|v| v.parse().ok()).unwrap_or(3),
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

    let save = match save_in.as_deref().map(std::fs::read).transpose() {
        Ok(save) => save,
        Err(e) => {
            eprintln!("cannot read save: {e}");
            return ExitCode::FAILURE;
        }
    };
    let options = Run {
        save,
        frames: frames.unwrap_or(600),
        steps,
        watch,
        script,
        mash_from,
        mash_until,
    };

    if determinism {
        let quiet = Run {
            watch: None,
            ..options
        };
        let a = run(&rom, bios.as_deref(), &quiet);
        let b = run(&rom, bios.as_deref(), &quiet);
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

    // Two machines on a cable, stepped in lockstep by the same driver netplay
    // will use. The second ROM defaults to the first: two copies of the same
    // cartridge is the ordinary case.
    if let Some(second) = link {
        let other = match second.as_deref().map(std::fs::read).transpose() {
            Ok(Some(bytes)) => bytes,
            Ok(None) => rom.clone(),
            Err(e) => {
                eprintln!("cannot read the second ROM: {e}");
                return ExitCode::FAILURE;
            }
        };
        return run_cable(&rom, &other, bios.as_deref(), &options, screenshot, scale);
    }

    let outcome = run(&rom, bios.as_deref(), &options);
    print_report(&rom, &outcome);

    if let Some(path) = save_out {
        match &outcome.save {
            Some(save) => match std::fs::write(&path, save) {
                Ok(()) => println!("wrote {path} ({} bytes)", save.len()),
                Err(e) => eprintln!("cannot write {path}: {e}"),
            },
            None => eprintln!("this cartridge has no save memory"),
        }
    }

    if let Some(path) = screenshot {
        let image = png::encode(
            &outcome.framebuffer,
            gba_core::SCREEN_WIDTH,
            gba_core::SCREEN_HEIGHT,
            scale.max(1),
        );
        if let Err(e) = std::fs::write(&path, image) {
            eprintln!("cannot write {path}: {e}");
            return ExitCode::FAILURE;
        }
        println!("wrote {path}");
        return ExitCode::SUCCESS;
    }

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
    framebuffer: Vec<u16>,
    vcount: u16,
    dispcnt: u16,
    io: Vec<u8>,
    timers: Vec<(u16, u16, bool)>,
    trail: Vec<Trace>,
    save_len: usize,
    save_dirty: bool,
    save: Option<Vec<u8>>,
}

#[derive(Clone, Copy, Default)]
struct Trace {
    pc: u32,
    op: u16,
    next: u32,
    halted: bool,
    cycles: u64,
}

/// Everything that shapes a run, gathered so the signature stays readable as
/// the harness grows.
#[derive(Default)]
struct Run {
    frames: u64,
    save: Option<Vec<u8>>,
    steps: Option<u64>,
    watch: Option<u32>,
    script: Vec<(u64, u16, u64)>,
    mash_from: Option<u64>,
    mash_until: Option<u64>,
}

fn run(rom: &[u8], bios: Option<&[u8]>, options: &Run) -> Outcome {
    let Run {
        frames,
        steps,
        watch,
        script,
        mash_from,
        mash_until,
        save,
    } = options;
    let (frames, steps, watch, mash_from, mash_until) =
        (*frames, *steps, *watch, *mash_from, *mash_until);
    let mut emu = Emulator::new(rom, bios, save.as_deref());
    let budget = steps.unwrap_or(frames * gba_core::CYCLES_PER_FRAME);

    // A test ROM signals completion by branching to itself; a real game never
    // sits on one address this long unless something has gone wrong.
    const TRAIL: usize = 64;
    let mut history = [Trace::default(); TRAIL];
    let mut last_pc = u32::MAX;
    let mut stuck = 0u32;
    let mut executed = 0u64;
    let mut reached_terminal_loop = false;
    let mut watching = 0u32;
    let mut current_frame = u64::MAX;

    while emu.mem.cycles < budget {
        let pc = emu.cpu.r[15];
        let op = emu.mem.peek16(pc);
        if watch == Some(pc) && watching == 0 {
            watching = 60;
        }
        emu.step();
        executed += 1;
        history[(executed as usize - 1) % TRAIL] = Trace {
            pc,
            op,
            next: emu.cpu.r[15],
            halted: emu.cpu.halted,
            cycles: emu.mem.cycles,
        };
        if watching > 0 {
            watching -= 1;
            println!(
                "{:08x}:{:04x} -> {:08x} cpsr={:08x} halt={} irq={} r0={:08x} tm3={:04x}/{}",
                pc,
                op,
                emu.cpu.r[15],
                emu.cpu.cpsr.0,
                emu.cpu.halted as u8,
                emu.cpu.irq_line as u8,
                emu.cpu.r[0],
                emu.mem.timers[3].counter,
                emu.mem.timers[3].enabled as u8,
            );
        }

        if emu.cpu.r[15] == last_pc && !emu.cpu.halted {
            stuck += 1;
            if stuck > 200 {
                reached_terminal_loop = true;
                break;
            }
        } else {
            stuck = 0;
            last_pc = emu.cpu.r[15];
        }
        // Sample input once per frame boundary, exactly as run_frame does.
        let frame = emu.mem.cycles / gba_core::CYCLES_PER_FRAME;
        if frame != current_frame {
            current_frame = frame;
            let mut keys = 0u16;
            for (at, buttons, hold) in script {
                if frame >= *at && frame < at + hold {
                    keys |= buttons;
                }
            }
            if let Some(start) = mash_from {
                let stop = mash_until.unwrap_or(u64::MAX);
                if frame >= start && frame < stop && (frame - start) % 24 < 6 {
                    keys |= KeyState::A;
                }
            }
            emu.mem.write_io16_raw(0x130, KeyState(keys).to_keyinput());
        }
    }

    // Finish the frame in progress so the captured framebuffer holds one
    // complete image rather than two halves from different frames.
    if !reached_terminal_loop {
        let mut guard = 0;
        while emu.mem.read_io16(0x006) != gba_core::SCREEN_HEIGHT as u16 && guard < 400_000 {
            emu.step();
            guard += 1;
        }
    }

    let trail = (0..TRAIL)
        .map(|i| history[(executed as usize + i) % TRAIL])
        .collect();

    Outcome {
        registers: emu.cpu.r,
        cpsr: emu.cpu.cpsr.0,
        cycles: emu.mem.cycles,
        executed,
        reached_terminal_loop,
        state_hash: fnv1a(&emu.serialize_state()),
        framebuffer: emu.framebuffer().to_vec(),
        vcount: emu.mem.read_io16(0x006),
        dispcnt: emu.mem.read_io16(0x000),
        io: emu.mem.io.to_vec(),
        timers: emu
            .mem
            .timers
            .iter()
            .map(|t| (t.counter, t.control, t.enabled))
            .collect(),
        trail,
        save_len: emu.save_data().map(|s| s.len()).unwrap_or(0),
        save_dirty: emu.save_dirty(),
        save: emu.save_data().map(|s| s.to_vec()),
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
    println!(
        "cpsr {:08x}  dispcnt {:04x}  vcount {}",
        outcome.cpsr, outcome.dispcnt, outcome.vcount
    );
    println!(
        "instructions {}  cycles {}",
        outcome.executed, outcome.cycles
    );
    println!("state hash {:016x}", outcome.state_hash);
    println!("timers (count/ctrl/on) {:04x?}", outcome.timers);
    println!(
        "cartridge save: {} bytes, {}",
        outcome.save_len,
        if outcome.save_dirty {
            "written by the game"
        } else {
            "untouched"
        }
    );
    println!(
        "IE {:04x} IF {:04x} IME {:04x}",
        u16::from_le_bytes([outcome.io[0x200], outcome.io[0x201]]),
        u16::from_le_bytes([outcome.io[0x202], outcome.io[0x203]]),
        u16::from_le_bytes([outcome.io[0x208], outcome.io[0x209]])
    );
    if outcome.reached_terminal_loop {
        println!("stopped: no forward progress");
        for step in outcome.trail.iter().rev().take(12).rev() {
            println!(
                "  {:08x}:{:04x} -> {:08x}{} @{}",
                step.pc,
                step.op,
                step.next,
                if step.halted { " halted" } else { "" },
                step.cycles
            );
        }
    }
}

fn run_cable(
    first: &[u8],
    second: &[u8],
    bios: Option<&[u8]>,
    options: &Run,
    screenshot: Option<String>,
    scale: usize,
) -> ExitCode {
    let save = options.save.as_deref();
    let mut cable = Cable::new(vec![
        Emulator::new(first, bios, save),
        Emulator::new(second, bios, save),
    ]);
    // Both units get the same buttons: they are two people doing the same
    // thing, walking to the same counter. Netplay will feed each machine its
    // own player's input instead.
    for frame in 0..options.frames {
        let mut keys = 0u16;
        for (at, buttons, hold) in &options.script {
            if frame >= *at && frame < at + hold {
                keys |= buttons;
            }
        }
        if let Some(start) = options.mash_from {
            let stop = options.mash_until.unwrap_or(u64::MAX);
            if frame >= start && frame < stop && (frame - start) % 24 < 6 {
                keys |= KeyState::A;
            }
        }
        let input = KeyState(keys);
        cable.run_frame(&[input, input]);
    }

    for (index, machine) in cable.machines.iter().enumerate() {
        println!(
            "unit {index}: id {} of {}  pc {:08x}  siocnt {:04x}  multi {:04x} {:04x}",
            machine.mem.link.id,
            machine.mem.link.players,
            machine.cpu.r[15],
            machine.mem.siocnt(),
            machine.mem.read_io16(gba_core::link::SIOMULTI0),
            machine.mem.read_io16(gba_core::link::SIOMULTI1),
        );
    }
    println!("cable state hash {:016x}", cable.state_hash());

    if let Some(path) = screenshot {
        for (index, machine) in cable.machines.iter().enumerate() {
            let out = path.replace(".png", &format!("-{index}.png"));
            let image = png::encode(
                machine.framebuffer(),
                gba_core::SCREEN_WIDTH,
                gba_core::SCREEN_HEIGHT,
                scale.max(1),
            );
            if let Err(e) = std::fs::write(&out, image) {
                eprintln!("cannot write {out}: {e}");
                return ExitCode::FAILURE;
            }
            println!("wrote {out}");
        }
    }
    ExitCode::SUCCESS
}

/// Parse `frame:BUTTONS[:frames]` entries, e.g. "1850:START,1900:A+B,2000:LEFT:60".
///
/// The optional duration is what makes walking scriptable: a press has to be
/// held for the length of a step, not tapped.
fn parse_script(text: &str) -> Vec<(u64, u16, u64)> {
    text.split(',')
        .filter_map(|entry| {
            let mut parts = entry.split(':');
            let frame = parts.next()?;
            let buttons = parts.next()?;
            let hold: u64 = parts
                .next()
                .and_then(|d| d.trim().parse().ok())
                .unwrap_or(6);
            let mut mask = 0u16;
            for name in buttons.split('+') {
                mask |= match name.trim().to_ascii_uppercase().as_str() {
                    "A" => KeyState::A,
                    "B" => KeyState::B,
                    "SELECT" => KeyState::SELECT,
                    "START" => KeyState::START,
                    "RIGHT" => KeyState::RIGHT,
                    "LEFT" => KeyState::LEFT,
                    "UP" => KeyState::UP,
                    "DOWN" => KeyState::DOWN,
                    "R" => KeyState::R,
                    "L" => KeyState::L,
                    other => {
                        eprintln!("unknown button: {other}");
                        0
                    }
                };
            }
            Some((frame.trim().parse().ok()?, mask, hold))
        })
        .collect()
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
