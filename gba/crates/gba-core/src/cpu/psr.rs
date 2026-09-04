//! CPSR/SPSR representation and the processor mode encoding.

/// Processor mode, as encoded in CPSR[4:0].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Mode {
    User = 0b10000,
    Fiq = 0b10001,
    Irq = 0b10010,
    Svc = 0b10011,
    Abt = 0b10111,
    Und = 0b11011,
    Sys = 0b11111,
}

impl Mode {
    pub fn from_bits(bits: u32) -> Mode {
        match bits & 0x1F {
            0b10000 => Mode::User,
            0b10001 => Mode::Fiq,
            0b10010 => Mode::Irq,
            0b10011 => Mode::Svc,
            0b10111 => Mode::Abt,
            0b11011 => Mode::Und,
            // 0b11111 is System; anything else is an illegal encoding that the
            // hardware does not define. Treating it as System keeps the core
            // deterministic instead of panicking on a stray MSR.
            _ => Mode::Sys,
        }
    }

    /// Index into the banked-register and SPSR arrays.
    pub fn bank(self) -> usize {
        match self {
            Mode::User | Mode::Sys => 0,
            Mode::Fiq => 1,
            Mode::Irq => 2,
            Mode::Svc => 3,
            Mode::Abt => 4,
            Mode::Und => 5,
        }
    }

    /// User and System share the main register file and have no SPSR.
    pub fn has_spsr(self) -> bool {
        !matches!(self, Mode::User | Mode::Sys)
    }
}

/// A program status register. Stored as the raw u32 so serialization is
/// trivially exact and MSR field masking is a plain bit operation.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Psr(pub u32);

macro_rules! flag {
    ($get:ident, $set:ident, $bit:expr) => {
        #[inline(always)]
        pub fn $get(self) -> bool {
            self.0 & (1 << $bit) != 0
        }
        #[inline(always)]
        pub fn $set(&mut self, v: bool) {
            if v {
                self.0 |= 1 << $bit;
            } else {
                self.0 &= !(1 << $bit);
            }
        }
    };
}

impl Psr {
    flag!(n, set_n, 31);
    flag!(z, set_z, 30);
    flag!(c, set_c, 29);
    flag!(v, set_v, 28);
    flag!(irq_disabled, set_irq_disabled, 7);
    flag!(fiq_disabled, set_fiq_disabled, 6);
    flag!(thumb, set_thumb, 5);

    pub fn mode(self) -> Mode {
        Mode::from_bits(self.0)
    }

    pub fn set_mode(&mut self, m: Mode) {
        self.0 = (self.0 & !0x1F) | m as u32;
    }

    /// Set N and Z from a result word. C and V are op-specific.
    #[inline(always)]
    pub fn set_nz(&mut self, result: u32) {
        self.set_n(result & 0x8000_0000 != 0);
        self.set_z(result == 0);
    }
}
