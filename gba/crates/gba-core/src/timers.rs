//! The four hardware timers.
//!
//! Each counts up at a prescaled rate (or on the previous timer's overflow)
//! and reloads from a latched value when it wraps. Games use them for
//! everything from frame pacing to the random-number seed, so an overflow
//! that lands a cycle early is a determinism bug, not a rounding error.

use crate::irq;
use crate::mem::Memory;

pub const PRESCALER: [u32; 4] = [1, 64, 256, 1024];

#[derive(Clone, Copy, Default)]
pub struct Timer {
    /// The live 16-bit counter.
    pub counter: u16,
    /// The value written by the game, loaded on overflow and on enable.
    pub reload: u16,
    /// Cycles accumulated toward the next prescaler tick.
    pub residual: u32,
    pub control: u16,
    pub enabled: bool,
}

impl Timer {
    pub fn prescaler(&self) -> u32 {
        PRESCALER[(self.control & 3) as usize]
    }
    pub fn cascade(&self) -> bool {
        self.control & (1 << 2) != 0
    }
    pub fn irq_enabled(&self) -> bool {
        self.control & (1 << 6) != 0
    }
}

/// Advance all four timers by `cycles`, raising interrupts as they overflow.
pub fn step(mem: &mut Memory, cycles: u32) {
    let mut cascade_overflows = 0u32;
    let mut raised = 0u16;

    for index in 0..4 {
        let timer = &mut mem.timers[index];
        if !timer.enabled {
            cascade_overflows = 0;
            continue;
        }

        let ticks = if timer.cascade() && index > 0 {
            // A cascading timer ignores its prescaler and counts only the
            // previous timer's overflows.
            cascade_overflows
        } else {
            timer.residual += cycles;
            let prescaler = timer.prescaler();
            let ticks = timer.residual / prescaler;
            timer.residual %= prescaler;
            ticks
        };

        let mut overflows = 0u32;
        if ticks > 0 {
            let span = 0x1_0000u32 - timer.reload as u32;
            let total = timer.counter as u32 + ticks;
            if total > 0xFFFF {
                let past = total - 0x1_0000;
                overflows = 1 + past / span;
                timer.counter = (timer.reload as u32 + past % span) as u16;
            } else {
                timer.counter = total as u16;
            }
        }

        if overflows > 0 && timer.irq_enabled() {
            raised |= irq::timer(index);
        }
        cascade_overflows = overflows;
    }

    if raised != 0 {
        mem.raise_irq(raised);
    }
}

/// Handle a write to a timer's control register: enabling a timer latches the
/// reload value into the counter.
pub fn write_control(mem: &mut Memory, index: usize, value: u16) {
    let timer = &mut mem.timers[index];
    let was_enabled = timer.enabled;
    timer.control = value;
    timer.enabled = value & (1 << 7) != 0;
    if timer.enabled && !was_enabled {
        timer.counter = timer.reload;
        timer.residual = 0;
    }
}
