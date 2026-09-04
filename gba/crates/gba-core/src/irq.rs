//! Interrupt sources, as the bit positions IE and IF share.

pub const VBLANK: u16 = 1 << 0;
pub const HBLANK: u16 = 1 << 1;
pub const VCOUNT: u16 = 1 << 2;
pub const TIMER0: u16 = 1 << 3;
pub const SERIAL: u16 = 1 << 7;
pub const DMA0: u16 = 1 << 8;
pub const KEYPAD: u16 = 1 << 12;
pub const GAMEPAK: u16 = 1 << 13;

pub const fn timer(index: usize) -> u16 {
    TIMER0 << index
}

pub const fn dma(index: usize) -> u16 {
    DMA0 << index
}
