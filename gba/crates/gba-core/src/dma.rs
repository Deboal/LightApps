//! The four DMA channels.
//!
//! Games lean on DMA for nearly every bulk move: palette and tile uploads in
//! VBlank, per-scanline effects in HBlank, and OAM refreshes. A channel that
//! forgets to reload on repeat shows up as graphics that decay over seconds
//! rather than as an obvious crash.

use crate::bus::Bus;
use crate::irq;
use crate::mem::Memory;

pub const BASE: u32 = 0xB0;
pub const STRIDE: u32 = 12;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Timing {
    Immediate,
    VBlank,
    HBlank,
    Special,
}

impl Timing {
    fn from_control(control: u16) -> Timing {
        match (control >> 12) & 3 {
            0 => Timing::Immediate,
            1 => Timing::VBlank,
            2 => Timing::HBlank,
            _ => Timing::Special,
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct DmaChannel {
    /// Internal address registers, latched on enable and advanced during the
    /// transfer -- distinct from the SAD/DAD the game can still read back.
    pub src: u32,
    pub dst: u32,
    pub count: u32,
    pub enabled: bool,
    pub pending: bool,
}

fn control(mem: &Memory, index: usize) -> u16 {
    mem.read_io16(BASE + STRIDE * index as u32 + 10)
}

fn set_control(mem: &mut Memory, index: usize, value: u16) {
    mem.write_io16_raw(BASE + STRIDE * index as u32 + 10, value);
}

fn reload_count(mem: &Memory, index: usize) -> u32 {
    let raw = mem.read_io16(BASE + STRIDE * index as u32 + 8) as u32;
    let max = if index == 3 { 0x1_0000 } else { 0x4000 };
    let masked = raw & (max - 1);
    if masked == 0 {
        max
    } else {
        masked
    }
}

fn address_mask(index: usize, destination: bool) -> u32 {
    // Channel 0 cannot reach the cartridge at all, and only channel 3 may
    // write to it.
    if index == 0 || (destination && index != 3) {
        0x07FF_FFFE
    } else {
        0x0FFF_FFFE
    }
}

/// Called when the game writes a channel's control register.
pub fn write_control(mem: &mut Memory, index: usize, value: u16) {
    let was_enabled = mem.dma[index].enabled;
    let now_enabled = value & (1 << 15) != 0;
    set_control(mem, index, value);
    mem.dma[index].enabled = now_enabled;

    if now_enabled && !was_enabled {
        let base = BASE + STRIDE * index as u32;
        let src = mem.read_io32(base) & address_mask(index, false);
        let dst = mem.read_io32(base + 4) & address_mask(index, true);
        mem.dma[index].src = src;
        mem.dma[index].dst = dst;
        mem.dma[index].count = reload_count(mem, index);
        if Timing::from_control(value) == Timing::Immediate {
            mem.dma[index].pending = true;
        }
    } else if !now_enabled {
        mem.dma[index].pending = false;
    }
}

/// Arm every enabled channel waiting on this event.
pub fn trigger(mem: &mut Memory, timing: Timing) {
    for index in 0..4 {
        if mem.dma[index].enabled && Timing::from_control(control(mem, index)) == timing {
            mem.dma[index].pending = true;
        }
    }
}

pub fn any_pending(mem: &Memory) -> bool {
    mem.dma.iter().any(|c| c.pending)
}

/// Run every armed channel, lowest index first -- DMA0 outranks DMA3.
pub fn run(mem: &mut Memory) {
    for index in 0..4 {
        if mem.dma[index].pending {
            mem.dma[index].pending = false;
            run_channel(mem, index);
        }
    }
}

fn run_channel(mem: &mut Memory, index: usize) {
    let control = control(mem, index);
    let wide = control & (1 << 10) != 0;
    let unit = if wide { 4 } else { 2 };
    let dst_control = (control >> 5) & 3;
    let src_control = (control >> 7) & 3;
    let timing = Timing::from_control(control);

    let mut src = mem.dma[index].src;
    let mut dst = mem.dma[index].dst;
    let count = mem.dma[index].count;

    for _ in 0..count {
        if wide {
            let value = mem.read32(src);
            mem.write32(dst, value);
        } else {
            let value = mem.read16(src);
            mem.write16(dst, value);
        }
        src = step_address(src, src_control, unit);
        dst = step_address(dst, dst_control, unit);
    }

    mem.dma[index].src = src;
    mem.dma[index].dst = dst;

    let repeat = control & (1 << 9) != 0 && timing != Timing::Immediate;
    if repeat {
        mem.dma[index].count = reload_count(mem, index);
        if dst_control == 3 {
            // Increment-and-reload: the destination returns to where it
            // started so the next repeat overwrites the same block.
            let base = BASE + STRIDE * index as u32;
            mem.dma[index].dst = mem.read_io32(base + 4) & address_mask(index, true);
        }
    } else {
        mem.dma[index].enabled = false;
        set_control(mem, index, control & !(1 << 15));
    }

    if control & (1 << 14) != 0 {
        mem.raise_irq(irq::dma(index));
    }
}

fn step_address(addr: u32, control: u16, unit: u32) -> u32 {
    match control {
        0 | 3 => addr.wrapping_add(unit),
        1 => addr.wrapping_sub(unit),
        // 2 is "fixed"; 3 is increment with reload, which increments here and
        // is reset between repeats.
        _ => addr,
    }
}
