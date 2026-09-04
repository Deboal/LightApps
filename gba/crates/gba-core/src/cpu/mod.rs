//! ARM7TDMI: register file, mode banking, exceptions, and the step loop.

pub mod alu;
pub mod arm;
pub mod psr;
pub mod thumb;

use crate::bus::Bus;
pub use psr::{Mode, Psr};

/// Exception vector addresses in the BIOS.
pub const VECTOR_RESET: u32 = 0x0000_0000;
pub const VECTOR_UNDEFINED: u32 = 0x0000_0004;
pub const VECTOR_SWI: u32 = 0x0000_0008;
pub const VECTOR_IRQ: u32 = 0x0000_0018;

pub struct Cpu {
    /// The 16 currently visible registers. r15 always holds the address of the
    /// *next instruction to fetch*; during execution it is temporarily biased
    /// by the pipeline offset (+8 ARM, +4 Thumb) so reads of PC see what the
    /// hardware sees.
    pub r: [u32; 16],
    pub cpsr: Psr,
    /// Saved status registers, indexed by `Mode::bank()`. Index 0 (User/System)
    /// is never read; it exists only to keep the indexing uniform.
    pub spsr: [Psr; 6],

    /// r13/r14 for each bank, holding the *inactive* copy for every bank other
    /// than the current one.
    sp_lr: [[u32; 2]; 6],
    /// r8-r12 for the non-FIQ modes, valid while the CPU is in FIQ.
    usr_r8_r12: [u32; 5],
    /// r8-r12 for FIQ, valid while the CPU is not in FIQ.
    fiq_r8_r12: [u32; 5],

    /// Set by any write to r15 so the step loop knows not to auto-advance.
    pub(crate) branched: bool,
    /// Raised by the interrupt controller; the CPU consumes it at an
    /// instruction boundary when IRQs are enabled.
    pub irq_line: bool,
    /// HALTCNT: the CPU idles until an interrupt arrives. Tracked here rather
    /// than by a host sleep, because the core never touches the clock.
    pub halted: bool,
    /// Intercept SWI and service it in software instead of taking the
    /// exception. Set when no real BIOS image was supplied.
    pub hle_bios: bool,
}

impl Default for Cpu {
    fn default() -> Self {
        Cpu::new()
    }
}

impl Cpu {
    pub fn new() -> Cpu {
        let mut cpu = Cpu {
            r: [0; 16],
            cpsr: Psr(Mode::Svc as u32 | (1 << 7) | (1 << 6)),
            spsr: [Psr(0); 6],
            sp_lr: [[0; 2]; 6],
            usr_r8_r12: [0; 5],
            fiq_r8_r12: [0; 5],
            branched: false,
            irq_line: false,
            halted: false,
            hle_bios: false,
        };
        cpu.r[15] = VECTOR_RESET;
        cpu
    }

    /// The register state the GBA BIOS leaves behind, for booting a ROM
    /// directly at 0x0800_0000 without running the BIOS boot code.
    pub fn skip_bios(&mut self) {
        self.sp_lr[Mode::Irq.bank()] = [0x0300_7FA0, 0];
        self.sp_lr[Mode::Svc.bank()] = [0x0300_7FE0, 0];
        self.r[13] = 0x0300_7F00;
        self.r[15] = 0x0800_0000;
        self.cpsr = Psr(Mode::Sys as u32);
    }

    // -- register access ---------------------------------------------------

    #[inline(always)]
    pub fn get(&self, n: usize) -> u32 {
        self.r[n]
    }

    /// Write a register. Writing r15 is a branch, so it also flushes.
    #[inline(always)]
    pub fn set(&mut self, n: usize, value: u32) {
        self.r[n] = value;
        if n == 15 {
            self.branched = true;
        }
    }

    /// Read a register from the User bank regardless of the current mode.
    /// Used by LDM/STM with the S bit set.
    pub fn get_user(&self, n: usize) -> u32 {
        let mode = self.cpsr.mode();
        match n {
            8..=12 if mode == Mode::Fiq => self.usr_r8_r12[n - 8],
            13 | 14 if mode != Mode::User && mode != Mode::Sys => {
                self.sp_lr[Mode::User.bank()][n - 13]
            }
            _ => self.r[n],
        }
    }

    pub fn set_user(&mut self, n: usize, value: u32) {
        let mode = self.cpsr.mode();
        match n {
            8..=12 if mode == Mode::Fiq => self.usr_r8_r12[n - 8] = value,
            13 | 14 if mode != Mode::User && mode != Mode::Sys => {
                self.sp_lr[Mode::User.bank()][n - 13] = value
            }
            _ => self.set(n, value),
        }
    }

    /// Move to a new processor mode, swapping the banked registers.
    pub fn set_mode(&mut self, new: Mode) {
        let old = self.cpsr.mode();
        if old == new {
            return;
        }
        if (old == Mode::Fiq) != (new == Mode::Fiq) {
            let mut swap = [0u32; 5];
            swap.copy_from_slice(&self.r[8..13]);
            let (save_into, load_from) = if old == Mode::Fiq {
                (&mut self.fiq_r8_r12, self.usr_r8_r12)
            } else {
                (&mut self.usr_r8_r12, self.fiq_r8_r12)
            };
            *save_into = swap;
            self.r[8..13].copy_from_slice(&load_from);
        }
        if old.bank() != new.bank() {
            self.sp_lr[old.bank()] = [self.r[13], self.r[14]];
            let [sp, lr] = self.sp_lr[new.bank()];
            self.r[13] = sp;
            self.r[14] = lr;
        }
        self.cpsr.set_mode(new);
    }

    /// Restore CPSR from the current mode's SPSR (the tail of an exception
    /// return). In User/System there is no SPSR and the write is ignored,
    /// which is what the hardware does.
    pub fn restore_cpsr(&mut self) {
        let mode = self.cpsr.mode();
        if !mode.has_spsr() {
            return;
        }
        let saved = self.spsr[mode.bank()];
        self.set_mode(saved.mode());
        self.cpsr = saved;
    }

    // -- condition codes ---------------------------------------------------

    #[inline(always)]
    pub fn cond_passes(&self, cond: u32) -> bool {
        let p = self.cpsr;
        match cond {
            0x0 => p.z(),
            0x1 => !p.z(),
            0x2 => p.c(),
            0x3 => !p.c(),
            0x4 => p.n(),
            0x5 => !p.n(),
            0x6 => p.v(),
            0x7 => !p.v(),
            0x8 => p.c() && !p.z(),
            0x9 => !p.c() || p.z(),
            0xA => p.n() == p.v(),
            0xB => p.n() != p.v(),
            0xC => !p.z() && (p.n() == p.v()),
            0xD => p.z() || (p.n() != p.v()),
            0xE => true,
            // 0xF (NV) is not a condition on ARMv4T; nothing executes.
            _ => false,
        }
    }

    // -- exceptions --------------------------------------------------------

    fn enter_exception(&mut self, mode: Mode, vector: u32, return_addr: u32, disable_fiq: bool) {
        let saved = self.cpsr;
        self.set_mode(mode);
        self.spsr[mode.bank()] = saved;
        self.r[14] = return_addr;
        self.cpsr.set_thumb(false);
        self.cpsr.set_irq_disabled(true);
        if disable_fiq {
            self.cpsr.set_fiq_disabled(true);
        }
        self.set(15, vector);
    }

    /// Software interrupt. Called from the instruction handlers, where r15 is
    /// still pipeline-biased, so the return address is derived from it.
    pub fn software_interrupt(&mut self, comment: u32, bus: &mut impl Bus) {
        if self.hle_bios {
            crate::bios::dispatch(self, bus, comment);
            return;
        }
        let ret = if self.cpsr.thumb() {
            self.r[15].wrapping_sub(2)
        } else {
            self.r[15].wrapping_sub(4)
        };
        self.enter_exception(Mode::Svc, VECTOR_SWI, ret, false);
    }

    pub fn undefined_instruction(&mut self) {
        let ret = if self.cpsr.thumb() {
            self.r[15].wrapping_sub(2)
        } else {
            self.r[15].wrapping_sub(4)
        };
        self.enter_exception(Mode::Und, VECTOR_UNDEFINED, ret, false);
    }

    /// Taken at an instruction boundary, where r15 is the address of the
    /// instruction that will not now run. The hardware's LR is that address
    /// plus 4, and the handler returns with `subs pc, lr, #4`.
    fn interrupt(&mut self) {
        let ret = self.r[15].wrapping_add(4);
        self.enter_exception(Mode::Irq, VECTOR_IRQ, ret, false);
    }

    // -- step --------------------------------------------------------------

    /// Execute one instruction (or absorb one halted cycle).
    pub fn step(&mut self, bus: &mut impl Bus) {
        if self.irq_line && !self.cpsr.irq_disabled() {
            self.halted = false;
            self.interrupt();
        } else if self.halted {
            // Nothing retires while halted; time still advances so timers and
            // the PPU can eventually raise the interrupt that wakes us. One
            // dot at a time keeps the granularity fine enough for the PPU
            // without burning a step call per cycle.
            bus.tick(4);
            return;
        }

        self.branched = false;
        if self.cpsr.thumb() {
            let addr = self.r[15] & !1;
            self.r[15] = addr;
            bus.on_fetch(addr);
            let op = bus.read16(addr);
            self.r[15] = addr.wrapping_add(4);
            thumb::execute(self, bus, op);
            if !self.branched {
                self.r[15] = addr.wrapping_add(2);
            }
        } else {
            let addr = self.r[15] & !3;
            self.r[15] = addr;
            bus.on_fetch(addr);
            let op = bus.read32(addr);
            self.r[15] = addr.wrapping_add(8);
            arm::execute(self, bus, op);
            if !self.branched {
                self.r[15] = addr.wrapping_add(4);
            }
        }
    }
}

impl Cpu {
    pub(crate) fn serialize_banks(&self, w: &mut crate::state::Writer) {
        for bank in self.sp_lr {
            w.u32(bank[0]);
            w.u32(bank[1]);
        }
        for v in self.usr_r8_r12 {
            w.u32(v);
        }
        for v in self.fiq_r8_r12 {
            w.u32(v);
        }
    }

    pub(crate) fn deserialize_banks(
        &mut self,
        r: &mut crate::state::Reader,
    ) -> Result<(), crate::state::StateError> {
        for i in 0..6 {
            self.sp_lr[i][0] = r.u32()?;
            self.sp_lr[i][1] = r.u32()?;
        }
        for i in 0..5 {
            self.usr_r8_r12[i] = r.u32()?;
        }
        for i in 0..5 {
            self.fiq_r8_r12[i] = r.u32()?;
        }
        Ok(())
    }
}
