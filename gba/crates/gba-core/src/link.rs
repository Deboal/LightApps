//! The serial link port, in multiplayer mode.
//!
//! Pokemon trades and battles over the multiplayer protocol: one unit is the
//! parent, up to three are children, and every transfer exchanges one 16-bit
//! word between all of them simultaneously. The parent starts a transfer; when
//! it completes, all four received words are readable by everyone and an
//! interrupt fires.
//!
//! Nothing here touches a socket. The core stays I/O-free: this is a plain
//! data structure that a driver reads and writes, so two emulated machines can
//! be wired together in one process and the network — if there is one — only
//! ever carries button presses. That is the whole reason the core was made
//! deterministic.

/// Registers, as offsets inside the I/O window.
pub const SIOMULTI0: u32 = 0x120;
pub const SIOMULTI1: u32 = 0x122;
pub const SIOCNT: u32 = 0x128;
pub const SIOMLT_SEND: u32 = 0x12A;
pub const RCNT: u32 = 0x134;

/// What an unconnected slot reads as.
pub const DISCONNECTED: u16 = 0xFFFF;

/// The GBA clock, for turning a baud rate into cycles.
const CLOCK: u32 = 16_777_216;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Phase {
    #[default]
    Idle,
    /// A transfer has been requested and is waiting for the driver to gather
    /// every unit's word.
    Requested,
    /// The words are exchanged; the transfer completes at `finish_at`.
    Active,
}

#[derive(Clone, Copy, Debug)]
pub struct Link {
    /// This unit's multiplayer id: 0 is the parent, 1 to 3 are children.
    pub id: u8,
    /// How many units are on the cable, including this one. One means the
    /// cable is unplugged and every remote slot reads as disconnected.
    pub players: u8,
    pub phase: Phase,
    /// Cycle count at which an active transfer completes.
    pub finish_at: u64,
}

impl Default for Link {
    fn default() -> Link {
        Link {
            id: 0,
            players: 1,
            phase: Phase::Idle,
            finish_at: 0,
        }
    }
}

impl Link {
    pub fn is_parent(&self) -> bool {
        self.id == 0
    }

    pub fn connected(&self) -> bool {
        self.players > 1
    }
}

/// Baud rate selected by SIOCNT bits 0-1.
pub fn baud(control: u16) -> u32 {
    match control & 3 {
        0 => 9_600,
        1 => 38_400,
        2 => 57_600,
        _ => 115_200,
    }
}

/// How long a multiplayer transfer takes.
///
/// All four time slots elapse whether or not every unit is present, which is
/// why this does not scale with the number of players. The figure is derived
/// rather than measured, and is the first thing to tune if a game decides the
/// cable has timed out.
pub fn transfer_cycles(control: u16) -> u64 {
    let per_bit = CLOCK / baud(control);
    (per_bit as u64) * 16 * 4
}

/// True when SIOCNT selects multiplayer mode (bits 13-12 = 01) and RCNT is not
/// holding the port in general-purpose or JOY mode.
pub fn multiplayer_mode(control: u16, rcnt: u16) -> bool {
    rcnt & 0x8000 == 0 && (control >> 12) & 3 == 1
}
