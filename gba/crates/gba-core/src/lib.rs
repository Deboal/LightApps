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

pub mod bios;
pub mod bus;
pub mod cable;
pub mod cpu;
pub mod dma;
pub mod irq;
pub mod link;
pub mod mem;
pub mod ppu;
pub mod state;
pub mod timers;

use bus::Bus;
use cpu::Cpu;
use mem::{Memory, REG_IE, REG_IF};
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
    /// Cycles carried over from the previous frame, so a long instruction at
    /// a frame boundary is not silently rounded away.
    cycle_debt: u64,
}

impl Emulator {
    /// `bios` may be `None`; the core then runs a synthesized BIOS image for
    /// the exception vectors and services SWIs in software.
    pub fn new(rom: &[u8], bios: Option<&[u8]>, save: Option<&[u8]>) -> Emulator {
        let image = match bios {
            Some(bios) => bios.to_vec(),
            None => bios::synthesize(),
        };
        let mut mem = Memory::new(rom.to_vec(), Some(image));
        if let Some(save) = save {
            mem.cart.load_save(save);
        }
        let mut cpu = Cpu::new();
        if bios.is_none() {
            cpu.skip_bios();
            cpu.hle_bios = true;
        }
        Emulator {
            cpu,
            mem,
            cycle_debt: 0,
        }
    }

    /// Latch the buttons for the coming frame. Input is sampled once, at a
    /// frame boundary, and never polled from inside the core.
    pub fn set_input(&mut self, input: KeyState) {
        // KEYINPUT lives at 0x0400_0130 and is active-low.
        self.mem.write_io16_raw(0x130, input.to_keyinput());
    }

    /// Run exactly one frame's worth of cycles with `input` sampled once, at
    /// the frame boundary. The core never polls the host for input.
    pub fn run_frame(&mut self, input: KeyState) {
        self.set_input(input);

        let target = self.mem.cycles + CYCLES_PER_FRAME - self.cycle_debt;
        while self.mem.cycles < target {
            self.step();
        }
        self.cycle_debt = self.mem.cycles - target;
    }

    /// Retire one instruction and advance everything that runs alongside it.
    /// Exposed so the test harness and the future debugger can single-step.
    pub fn step(&mut self) {
        let pending = self.mem.irq_pending();
        self.cpu.irq_line = pending;
        if pending && !self.cpu.cpsr.irq_disabled() && self.cpu.hle_bios {
            // IntrWait waits on a flag word that the game's own handler is
            // expected to maintain. Mirroring the acknowledged bits there
            // costs nothing when the game does its part and prevents a hang
            // when it does not.
            let flags = self.mem.read_io16(REG_IE) & self.mem.read_io16(REG_IF);
            let seen = self.mem.read16(bios::IRQ_CHECK_FLAG);
            self.mem.write16(bios::IRQ_CHECK_FLAG, seen | flags);
        }

        let before = self.mem.cycles;
        self.cpu.step(&mut self.mem);
        if self.mem.halt_requested {
            self.mem.halt_requested = false;
            self.cpu.halted = true;
        }

        let elapsed = (self.mem.cycles - before) as u32;
        if elapsed > 0 {
            timers::step(&mut self.mem, elapsed);
            ppu::step(&mut self.mem, elapsed);
        }
        if dma::any_pending(&self.mem) {
            dma::run(&mut self.mem);
        }
    }

    /// The most recently rendered frame, as raw BGR555.
    pub fn framebuffer(&self) -> &[u16; FRAMEBUFFER_LEN] {
        &self.mem.ppu.framebuffer
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

        w.u32(self.mem.ppu.line_cycles);
        for reference in self.mem.ppu.affine_ref {
            w.u32(reference[0] as u32);
            w.u32(reference[1] as u32);
        }
        for pixel in self.mem.ppu.framebuffer.iter() {
            w.u16(*pixel);
        }
        for channel in self.mem.dma {
            w.u32(channel.src);
            w.u32(channel.dst);
            w.u32(channel.count);
            w.bool(channel.enabled);
            w.bool(channel.pending);
        }
        for timer in self.mem.timers {
            w.u16(timer.counter);
            w.u16(timer.reload);
            w.u32(timer.residual);
            w.u16(timer.control);
            w.bool(timer.enabled);
        }

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

        self.mem.ppu.line_cycles = r.u32()?;
        for bg in 0..2 {
            self.mem.ppu.affine_ref[bg][0] = r.u32()? as i32;
            self.mem.ppu.affine_ref[bg][1] = r.u32()? as i32;
        }
        for i in 0..FRAMEBUFFER_LEN {
            self.mem.ppu.framebuffer[i] = r.u16()?;
        }
        for index in 0..4 {
            let channel = &mut self.mem.dma[index];
            channel.src = r.u32()?;
            channel.dst = r.u32()?;
            channel.count = r.u32()?;
            channel.enabled = r.bool()?;
            channel.pending = r.bool()?;
        }
        for index in 0..4 {
            let timer = &mut self.mem.timers[index];
            timer.counter = r.u16()?;
            timer.reload = r.u16()?;
            timer.residual = r.u32()?;
            timer.control = r.u16()?;
            timer.enabled = r.bool()?;
        }

        self.mem.cart.deserialize(&mut r)?;
        Ok(())
    }
}
