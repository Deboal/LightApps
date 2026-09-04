//! gba-core: a Game Boy Advance emulator core with no platform I/O.
//!
//! Three properties this crate maintains, because they are expensive to add
//! later and cheap to keep:
//!
//! 1. **No I/O.** No files, sockets, windows or timers. The only way in is
//!    through `Emulator`, and the only way out is a framebuffer and a save.
//! 2. **No wall clock and no randomness.** Time advances only as instructions
//!    retire. There is no `Instant`, no `SystemTime`, no RNG anywhere below
//!    this line.
//! 3. **Deterministic.** Same ROM, same initial state, same input sequence
//!    produces bit-identical state on every platform and every run. Lockstep
//!    netplay depends on it, and so does trusting a save state.

pub mod bus;
pub mod cpu;
pub mod mem;
pub mod state;

use cpu::Cpu;
use mem::Memory;
use state::{Reader, StateError, Writer, STATE_MAGIC, STATE_VERSION};

/// One frame is a fixed budget, never "run until the frame looks done".
pub const CYCLES_PER_FRAME: u64 = 280_896;
pub const SCREEN_WIDTH: usize = 240;
pub const SCREEN_HEIGHT: usize = 160;
pub const FRAMEBUFFER_LEN: usize = SCREEN_WIDTH * SCREEN_HEIGHT;

/// The ten GBA buttons, as the bit layout KEYINPUT uses. Note that the
/// hardware register is active-low; the conversion happens at the boundary so
/// callers can think in terms of "pressed".
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct KeyState(pub u16);

impl KeyState {
    pub const A: u16 = 1 << 0;
    pub const B: u16 = 1 << 1;
    pub const SELECT: u16 = 1 << 2;
    pub const START: u16 = 1 << 3;
    pub const RIGHT: u16 = 1 << 4;
    pub const LEFT: u16 = 1 << 5;
    pub const UP: u16 = 1 << 6;
    pub const DOWN: u16 = 1 << 7;
    pub const R: u16 = 1 << 8;
    pub const L: u16 = 1 << 9;

    pub fn pressed(self, button: u16) -> bool {
        self.0 & button != 0
    }

    /// KEYINPUT reads 0 for a pressed button.
    pub fn to_keyinput(self) -> u16 {
        !self.0 & 0x03FF
    }
}

pub struct Emulator {
    pub cpu: Cpu,
    pub mem: Memory,
    framebuffer: Box<[u16; FRAMEBUFFER_LEN]>,
    /// Cycles carried over from the previous frame, so a long instruction at
    /// a frame boundary is not silently rounded away.
    cycle_debt: u64,
}

impl Emulator {
    /// `bios` may be `None`; the core then boots straight to the cartridge
    /// entry point with the register state the BIOS would have left.
    pub fn new(rom: &[u8], bios: Option<&[u8]>, save: Option<&[u8]>) -> Emulator {
        let mut mem = Memory::new(rom.to_vec(), bios.map(|b| b.to_vec()));
        if let Some(save) = save {
            mem.cart.load_save(save);
        }
        let mut cpu = Cpu::new();
        if bios.is_none() {
            cpu.skip_bios();
        }
        Emulator {
            cpu,
            mem,
            framebuffer: Box::new([0; FRAMEBUFFER_LEN]),
            cycle_debt: 0,
        }
    }

    /// Run exactly one frame's worth of cycles with `input` sampled once, at
    /// the frame boundary. The core never polls the host for input.
    pub fn run_frame(&mut self, input: KeyState) {
        // KEYINPUT lives at 0x0400_0130 and is active-low.
        self.mem.write_io16(0x130, input.to_keyinput());

        let target = self.mem.cycles + CYCLES_PER_FRAME - self.cycle_debt;
        while self.mem.cycles < target {
            self.step();
        }
        self.cycle_debt = self.mem.cycles - target;
    }

    /// Retire one instruction. Exposed so the test harness and the future
    /// debugger can single-step without a frame loop.
    pub fn step(&mut self) {
        self.mem.in_bios = self.cpu.r[15] < mem::BIOS_SIZE as u32;
        self.cpu.irq_line = self.mem.irq_pending();
        self.cpu.step(&mut self.mem);
        if self.mem.halt_requested {
            self.mem.halt_requested = false;
            self.cpu.halted = true;
        }
    }

    /// The rendered frame. Phase 4 fills this; until the PPU lands it stays
    /// blank rather than pretending.
    pub fn framebuffer(&self) -> &[u16; FRAMEBUFFER_LEN] {
        &self.framebuffer
    }

    pub fn save_data(&self) -> Option<&[u8]> {
        self.mem.cart.save_data()
    }

    pub fn save_dirty(&self) -> bool {
        self.mem.cart.save_dirty()
    }

    pub fn clear_save_dirty(&mut self) {
        self.mem.cart.clear_save_dirty();
    }

    pub fn serialize_state(&self) -> Vec<u8> {
        let mut w = Writer::default();
        w.u32(STATE_MAGIC);
        w.u32(STATE_VERSION);

        for r in self.cpu.r {
            w.u32(r);
        }
        w.u32(self.cpu.cpsr.0);
        for s in self.cpu.spsr {
            w.u32(s.0);
        }
        self.cpu.serialize_banks(&mut w);
        w.bool(self.cpu.irq_line);
        w.bool(self.cpu.halted);

        w.bytes(&self.mem.ewram[..]);
        w.bytes(&self.mem.iwram[..]);
        w.bytes(&self.mem.palram[..]);
        w.bytes(&self.mem.vram[..]);
        w.bytes(&self.mem.oam[..]);
        w.bytes(&self.mem.io[..]);
        w.u64(self.mem.cycles);
        w.u64(self.cycle_debt);
        self.mem.cart.serialize(&mut w);
        w.buf
    }

    pub fn deserialize_state(&mut self, data: &[u8]) -> Result<(), StateError> {
        let mut r = Reader::new(data);
        if r.u32()? != STATE_MAGIC {
            return Err(StateError::BadMagic);
        }
        let version = r.u32()?;
        if version != STATE_VERSION {
            return Err(StateError::VersionMismatch {
                found: version,
                expected: STATE_VERSION,
            });
        }

        for i in 0..16 {
            self.cpu.r[i] = r.u32()?;
        }
        self.cpu.cpsr = cpu::Psr(r.u32()?);
        for i in 0..6 {
            self.cpu.spsr[i] = cpu::Psr(r.u32()?);
        }
        self.cpu.deserialize_banks(&mut r)?;
        self.cpu.irq_line = r.bool()?;
        self.cpu.halted = r.bool()?;

        r.bytes_into(&mut self.mem.ewram[..])?;
        r.bytes_into(&mut self.mem.iwram[..])?;
        r.bytes_into(&mut self.mem.palram[..])?;
        r.bytes_into(&mut self.mem.vram[..])?;
        r.bytes_into(&mut self.mem.oam[..])?;
        r.bytes_into(&mut self.mem.io[..])?;
        self.mem.cycles = r.u64()?;
        self.cycle_debt = r.u64()?;
        self.mem.cart.deserialize(&mut r)?;
        Ok(())
    }
}
