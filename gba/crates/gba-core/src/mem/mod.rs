//! The GBA memory map.
//!
//! Two details here are worth more than the rest put together for this
//! target: VRAM's non-power-of-two mirroring, and the save region's 8-bit
//! bus. Everything else is masking.

pub mod cart;
pub mod flash;

use crate::bus::Bus;
use crate::dma::{self, DmaChannel};
use crate::link::{self, Link};
use crate::ppu::{self, Ppu};
use crate::timers::{self, Timer};
use cart::Cartridge;

pub const EWRAM_SIZE: usize = 0x40000;
pub const IWRAM_SIZE: usize = 0x8000;
pub const PALRAM_SIZE: usize = 0x400;
pub const VRAM_SIZE: usize = 0x18000;
pub const OAM_SIZE: usize = 0x400;
pub const IO_SIZE: usize = 0x400;
pub const BIOS_SIZE: usize = 0x4000;

// Interrupt registers. The rest of the I/O space is a plain byte array until
// the PPU and DMA arrive.
pub const REG_IE: u32 = 0x200;
pub const REG_IF: u32 = 0x202;
pub const REG_IME: u32 = 0x208;
pub const REG_HALTCNT: u32 = 0x301;

pub struct Memory {
    pub bios: Vec<u8>,
    pub ewram: Box<[u8; EWRAM_SIZE]>,
    pub iwram: Box<[u8; IWRAM_SIZE]>,
    pub palram: Box<[u8; PALRAM_SIZE]>,
    pub vram: Box<[u8; VRAM_SIZE]>,
    pub oam: Box<[u8; OAM_SIZE]>,
    pub io: Box<[u8; IO_SIZE]>,
    pub cart: Cartridge,
    pub ppu: Ppu,
    pub dma: [DmaChannel; 4],
    pub timers: [Timer; 4],
    /// Serial link state. Inert unless a driver wires several machines
    /// together; a lone machine reads every remote slot as disconnected.
    pub link: Link,

    /// Elapsed cycles. The only notion of time the core has, and it advances
    /// solely through instruction execution.
    pub cycles: u64,
    /// The last word fetched from BIOS, returned for reads of the BIOS region
    /// made from outside it.
    bios_latch: u32,
    /// True while the CPU is fetching from BIOS, which unlocks BIOS reads.
    pub in_bios: bool,
    /// Set when the game writes HALTCNT; the emulator loop parks the CPU.
    pub halt_requested: bool,
    /// Words latched by a transfer in flight, delivered when it completes.
    link_incoming: [u16; 4],
}

impl Memory {
    pub fn new(rom: Vec<u8>, bios: Option<Vec<u8>>) -> Memory {
        let mut bios = bios.unwrap_or_default();
        bios.resize(BIOS_SIZE, 0);
        let mut memory = Memory {
            bios,
            ewram: Box::new([0; EWRAM_SIZE]),
            iwram: Box::new([0; IWRAM_SIZE]),
            palram: Box::new([0; PALRAM_SIZE]),
            vram: Box::new([0; VRAM_SIZE]),
            oam: Box::new([0; OAM_SIZE]),
            io: Box::new([0; IO_SIZE]),
            cart: Cartridge::new(rom),
            ppu: Ppu::default(),
            dma: [DmaChannel::default(); 4],
            timers: [Timer::default(); 4],
            link: Link::default(),
            cycles: 0,
            bios_latch: 0,
            in_bios: false,
            halt_requested: false,
            link_incoming: [link::DISCONNECTED; 4],
        };
        // KEYINPUT is active-low: with nothing pressed every bit reads high.
        memory.write_io16_raw(0x130, 0x03FF);
        // An empty cable reads as four absent units.
        for slot in 0..4 {
            memory.write_io16_raw(link::SIOMULTI0 + slot * 2, link::DISCONNECTED);
        }
        memory
    }

    /// VRAM is 96 KB in a 128 KB window: the upper 32 KB of each 128 KB block
    /// mirrors the 0x0601_0000 bank rather than continuing upward.
    #[inline(always)]
    fn vram_offset(addr: u32) -> usize {
        let offset = (addr & 0x1FFFF) as usize;
        if offset >= 0x18000 {
            offset - 0x8000
        } else {
            offset
        }
    }

    /// Save region offsets wrap the 64 KB window the cartridge bus exposes.
    #[inline(always)]
    fn save_offset(addr: u32) -> u32 {
        addr & 0xFFFF
    }

    fn read_io8(&self, offset: u32) -> u8 {
        // SIOCNT reports the cable's shape, not what the game last wrote.
        if offset == link::SIOCNT || offset == link::SIOCNT + 1 {
            let value = self.siocnt();
            return (value >> (8 * (offset - link::SIOCNT))) as u8;
        }
        // A timer's counter and its reload value share an address: reads see
        // the live count, writes set the reload.
        if (0x100..0x110).contains(&offset) && offset % 4 < 2 {
            let timer = &self.timers[((offset - 0x100) / 4) as usize];
            return (timer.counter >> (8 * (offset % 4))) as u8;
        }
        self.io.get(offset as usize).copied().unwrap_or(0)
    }

    fn write_io8(&mut self, offset: u32, value: u8) {
        match offset {
            // IF is write-one-to-clear: a game acknowledges an interrupt by
            // writing the bit back, not by clearing it.
            REG_IF | 0x203 => {
                self.io[offset as usize] &= !value;
                return;
            }
            REG_HALTCNT => {
                if value & 0x80 == 0 {
                    self.halt_requested = true;
                }
                return;
            }
            // VCOUNT and KEYINPUT are driven by the hardware, not the game.
            0x006 | 0x007 | 0x130 | 0x131 => return,
            // DISPSTAT's low three bits are status, not settings.
            0x004 => {
                self.io[4] = (self.io[4] & 0x07) | (value & !0x07);
                return;
            }
            // A write to SIOCNT can start a transfer, and the read-only status
            // bits must survive it.
            link::SIOCNT | 0x129 => {
                self.io[offset as usize] = value;
                let control = self.read_raw16(link::SIOCNT);
                let rcnt = self.read_raw16(link::RCNT);
                if link::multiplayer_mode(control, rcnt)
                    && self.link.is_parent()
                    && control & 0x0080 != 0
                    && self.link.phase == link::Phase::Idle
                {
                    self.link.phase = link::Phase::Requested;
                }
                return;
            }
            0x100..=0x10F => {
                let index = ((offset - 0x100) / 4) as usize;
                self.io[offset as usize] = value;
                if offset % 4 < 2 {
                    self.timers[index].reload = self.read_raw16(0x100 + 4 * index as u32);
                } else {
                    let control = self.read_raw16(0x102 + 4 * index as u32);
                    timers::write_control(self, index, control);
                }
                return;
            }
            _ => {}
        }

        if let Some(byte) = self.io.get_mut(offset as usize) {
            *byte = value;
        }
        self.io_side_effect(offset);
    }

    /// Registers whose write does more than store a value.
    fn io_side_effect(&mut self, offset: u32) {
        match offset {
            // Writing a DMA control register can start a transfer.
            0xBA | 0xBB | 0xC6 | 0xC7 | 0xD2 | 0xD3 | 0xDE | 0xDF => {
                let index = ((offset - 0xBA) / dma::STRIDE) as usize;
                let control = self.read_raw16(0xBA + dma::STRIDE * index as u32);
                dma::write_control(self, index, control);
            }
            // Writing an affine reference point re-latches it immediately
            // rather than waiting for the next frame.
            0x28..=0x2F => ppu::write_affine_reference(self, 0, offset >= 0x2C),
            0x38..=0x3F => ppu::write_affine_reference(self, 1, offset >= 0x3C),
            _ => {}
        }
    }

    /// Read a register straight out of the backing array, bypassing the
    /// timer-counter aliasing.
    fn read_raw16(&self, offset: u32) -> u16 {
        u16::from_le_bytes([
            self.io.get(offset as usize).copied().unwrap_or(0),
            self.io.get(offset as usize + 1).copied().unwrap_or(0),
        ])
    }

    pub fn read_io16(&self, offset: u32) -> u16 {
        u16::from_le_bytes([self.read_io8(offset), self.read_io8(offset + 1)])
    }

    pub fn read_io32(&self, offset: u32) -> u32 {
        self.read_io16(offset) as u32 | ((self.read_io16(offset + 2) as u32) << 16)
    }

    pub fn write_io16(&mut self, offset: u32, value: u16) {
        self.write_io8(offset, value as u8);
        self.write_io8(offset + 1, (value >> 8) as u8);
    }

    /// Write a register as the hardware would, ignoring the read-only masks
    /// the game is subject to. Used by the PPU, DMA and the input latch.
    pub fn write_io16_raw(&mut self, offset: u32, value: u16) {
        if let Some(slot) = self.io.get_mut(offset as usize) {
            *slot = value as u8;
        }
        if let Some(slot) = self.io.get_mut(offset as usize + 1) {
            *slot = (value >> 8) as u8;
        }
    }

    /// SIOCNT as the hardware presents it: the game's own bits, overlaid with
    /// the multiplayer id, the parent/child terminal, and whether every unit
    /// is ready.
    pub fn siocnt(&self) -> u16 {
        let mut value = self.read_raw16(link::SIOCNT) & !0x007C;
        value |= (self.link.id as u16) << 4;
        if !self.link.is_parent() {
            value |= 1 << 2; // SI: this unit is a child
        }
        if self.link.connected() {
            value |= 1 << 3; // SD: all units present
        }
        if self.link.phase != link::Phase::Idle {
            value |= 0x0080;
        } else {
            value &= !0x0080;
        }
        value
    }

    /// The word this unit will contribute to the next transfer.
    pub fn link_outgoing(&self) -> u16 {
        self.read_raw16(link::SIOMLT_SEND)
    }

    /// Deliver the four exchanged words and finish the transfer.
    /// Latch the exchanged words and start the clock on the transfer.
    ///
    /// The words are held rather than delivered: on hardware the received data
    /// appears when the transfer *completes*. Writing it immediately let the
    /// game read the answer before it had asked the question, and the games
    /// clear these registers between transfers -- so an early write was
    /// promptly wiped and the real result never arrived.
    ///
    /// The duration comes from the parent, because the parent drives the
    /// clock; a child's own baud setting does not change how long the transfer
    /// takes.
    pub fn link_deliver(&mut self, words: [u16; 4], duration: u64) {
        self.link_incoming = words;
        self.link.phase = link::Phase::Active;
        self.link.finish_at = self.cycles + duration;
    }

    /// Called each quantum: completes an active transfer once its cycles have
    /// elapsed, raising the serial interrupt if the game asked for it.
    pub fn link_tick(&mut self) {
        if self.link.phase == link::Phase::Active && self.cycles >= self.link.finish_at {
            self.link.phase = link::Phase::Idle;
            let words = self.link_incoming;
            for (slot, word) in words.iter().enumerate() {
                self.write_io16_raw(link::SIOMULTI0 + slot as u32 * 2, *word);
            }
            let control = self.read_raw16(link::SIOCNT);
            self.write_io16_raw(link::SIOCNT, control & !0x0080);
            if control & 0x4000 != 0 {
                self.raise_irq(crate::irq::SERIAL);
            }
        }
    }

    /// A side-effect-free halfword read, for debuggers and tracing. Does not
    /// tick the clock, so it cannot perturb a run.
    pub fn peek16(&self, addr: u32) -> u16 {
        let addr = addr & !1;
        match addr >> 24 {
            0x00 | 0x01 => read_le16(&self.bios[..], (addr as usize).min(BIOS_SIZE - 2)),
            0x02 => read_le16(&self.ewram[..], addr as usize & (EWRAM_SIZE - 1)),
            0x03 => read_le16(&self.iwram[..], addr as usize & (IWRAM_SIZE - 1)),
            0x04 => self.read_io16(addr & 0x3FF),
            0x08..=0x0D => self.cart.read_rom16(addr & 0x01FF_FFFF),
            _ => 0,
        }
    }

    /// True when an enabled interrupt is pending and the master enable is set.
    pub fn irq_pending(&self) -> bool {
        self.read_io16(REG_IME) & 1 != 0 && (self.read_io16(REG_IE) & self.read_io16(REG_IF)) != 0
    }

    pub fn raise_irq(&mut self, bit: u16) {
        let flags = self.read_io16(REG_IF) | bit;
        let index = REG_IF as usize;
        self.io[index] = flags as u8;
        self.io[index + 1] = (flags >> 8) as u8;
    }

    /// Approximate access cost per region. Exact wait states move speed, not
    /// correctness, for this target -- but they must be deterministic.
    #[inline(always)]
    fn access_cycles(addr: u32, wide: bool) -> u32 {
        match addr >> 24 {
            0x02 => {
                if wide {
                    6
                } else {
                    3
                }
            }
            0x05 | 0x06 => {
                if wide {
                    2
                } else {
                    1
                }
            }
            0x08..=0x0D => {
                if wide {
                    8
                } else {
                    5
                }
            }
            0x0E | 0x0F => 5,
            _ => 1,
        }
    }
}

impl Bus for Memory {
    fn tick(&mut self, cycles: u32) {
        self.cycles += cycles as u64;
    }

    fn on_fetch(&mut self, addr: u32) {
        self.in_bios = (addr as usize) < BIOS_SIZE;
    }

    fn read8(&mut self, addr: u32) -> u8 {
        self.cycles += Memory::access_cycles(addr, false) as u64;
        match addr >> 24 {
            0x00 | 0x01 => {
                if self.in_bios && (addr as usize) < BIOS_SIZE {
                    self.bios[addr as usize]
                } else {
                    (self.bios_latch >> (8 * (addr & 3))) as u8
                }
            }
            0x02 => self.ewram[addr as usize & (EWRAM_SIZE - 1)],
            0x03 => self.iwram[addr as usize & (IWRAM_SIZE - 1)],
            0x04 => self.read_io8(addr & 0x3FF),
            0x05 => self.palram[addr as usize & (PALRAM_SIZE - 1)],
            0x06 => self.vram[Memory::vram_offset(addr)],
            0x07 => self.oam[addr as usize & (OAM_SIZE - 1)],
            0x08..=0x0D => self.cart.read_rom8(addr & 0x01FF_FFFF),
            _ => self.cart.read_backup(Memory::save_offset(addr)),
        }
    }

    fn read16(&mut self, unaligned: u32) -> u16 {
        let addr = unaligned & !1;
        self.cycles += Memory::access_cycles(addr, false) as u64;
        match addr >> 24 {
            0x00 | 0x01 => {
                if self.in_bios && (addr as usize) < BIOS_SIZE {
                    u16::from_le_bytes([self.bios[addr as usize], self.bios[addr as usize + 1]])
                } else {
                    (self.bios_latch >> (8 * (addr & 2))) as u16
                }
            }
            0x02 => read_le16(&self.ewram[..], addr as usize & (EWRAM_SIZE - 1)),
            0x03 => read_le16(&self.iwram[..], addr as usize & (IWRAM_SIZE - 1)),
            0x04 => self.read_io16(addr & 0x3FF),
            0x05 => read_le16(&self.palram[..], addr as usize & (PALRAM_SIZE - 1)),
            0x06 => read_le16(&self.vram[..], Memory::vram_offset(addr)),
            0x07 => read_le16(&self.oam[..], addr as usize & (OAM_SIZE - 1)),
            0x08..=0x0D => self.cart.read_rom16(addr & 0x01FF_FFFF),
            // The save region has an 8-bit bus: a halfword read returns the
            // one byte duplicated, not two adjacent bytes. The byte lane comes
            // from the address the CPU issued, before alignment.
            _ => {
                let byte = self.cart.read_backup(Memory::save_offset(unaligned)) as u16;
                byte * 0x0101
            }
        }
    }

    fn read32(&mut self, unaligned: u32) -> u32 {
        let addr = unaligned & !3;
        self.cycles += Memory::access_cycles(addr, true) as u64;
        match addr >> 24 {
            0x00 | 0x01 => {
                if self.in_bios && (addr as usize) < BIOS_SIZE {
                    let word = read_le32(&self.bios[..], addr as usize);
                    self.bios_latch = word;
                    word
                } else {
                    self.bios_latch
                }
            }
            0x02 => read_le32(&self.ewram[..], addr as usize & (EWRAM_SIZE - 1)),
            0x03 => read_le32(&self.iwram[..], addr as usize & (IWRAM_SIZE - 1)),
            0x04 => {
                self.read_io16(addr & 0x3FF) as u32
                    | ((self.read_io16((addr & 0x3FF) + 2) as u32) << 16)
            }
            0x05 => read_le32(&self.palram[..], addr as usize & (PALRAM_SIZE - 1)),
            0x06 => read_le32(&self.vram[..], Memory::vram_offset(addr)),
            0x07 => read_le32(&self.oam[..], addr as usize & (OAM_SIZE - 1)),
            0x08..=0x0D => {
                let base = addr & 0x01FF_FFFF;
                self.cart.read_rom16(base) as u32 | ((self.cart.read_rom16(base + 2) as u32) << 16)
            }
            _ => {
                let byte = self.cart.read_backup(Memory::save_offset(unaligned)) as u32;
                byte * 0x0101_0101
            }
        }
    }

    fn write8(&mut self, addr: u32, value: u8) {
        self.cycles += Memory::access_cycles(addr, false) as u64;
        match addr >> 24 {
            0x02 => self.ewram[addr as usize & (EWRAM_SIZE - 1)] = value,
            0x03 => self.iwram[addr as usize & (IWRAM_SIZE - 1)] = value,
            0x04 => self.write_io8(addr & 0x3FF, value),
            // A byte write to palette RAM is widened to a halfword. OAM
            // ignores byte writes entirely.
            0x05 => {
                let offset = addr as usize & (PALRAM_SIZE - 1) & !1;
                self.palram[offset] = value;
                self.palram[offset + 1] = value;
            }
            0x06 => {
                // Byte writes are widened in the background half of VRAM and
                // dropped in the sprite half.
                let offset = Memory::vram_offset(addr);
                if offset < 0x10000 {
                    let offset = offset & !1;
                    self.vram[offset] = value;
                    self.vram[offset + 1] = value;
                }
            }
            0x07 => {}
            0x08..=0x0D => {}
            _ => self.cart.write_backup(Memory::save_offset(addr), value),
        }
    }

    fn write16(&mut self, unaligned: u32, value: u16) {
        let addr = unaligned & !1;
        self.cycles += Memory::access_cycles(addr, false) as u64;
        match addr >> 24 {
            0x02 => write_le16(&mut self.ewram[..], addr as usize & (EWRAM_SIZE - 1), value),
            0x03 => write_le16(&mut self.iwram[..], addr as usize & (IWRAM_SIZE - 1), value),
            0x04 => self.write_io16(addr & 0x3FF, value),
            0x05 => write_le16(
                &mut self.palram[..],
                addr as usize & (PALRAM_SIZE - 1),
                value,
            ),
            0x06 => write_le16(&mut self.vram[..], Memory::vram_offset(addr), value),
            0x07 => write_le16(&mut self.oam[..], addr as usize & (OAM_SIZE - 1), value),
            0x08..=0x0D => {}
            // Only one byte reaches an 8-bit save chip, selected by the low
            // bit of the address the CPU issued.
            _ => {
                let byte = (value >> (8 * (unaligned & 1))) as u8;
                self.cart.write_backup(Memory::save_offset(unaligned), byte);
            }
        }
    }

    fn write32(&mut self, unaligned: u32, value: u32) {
        let addr = unaligned & !3;
        self.cycles += Memory::access_cycles(addr, true) as u64;
        match addr >> 24 {
            0x02 => write_le32(&mut self.ewram[..], addr as usize & (EWRAM_SIZE - 1), value),
            0x03 => write_le32(&mut self.iwram[..], addr as usize & (IWRAM_SIZE - 1), value),
            0x04 => {
                self.write_io16(addr & 0x3FF, value as u16);
                self.write_io16((addr & 0x3FF) + 2, (value >> 16) as u16);
            }
            0x05 => write_le32(
                &mut self.palram[..],
                addr as usize & (PALRAM_SIZE - 1),
                value,
            ),
            0x06 => write_le32(&mut self.vram[..], Memory::vram_offset(addr), value),
            0x07 => write_le32(&mut self.oam[..], addr as usize & (OAM_SIZE - 1), value),
            0x08..=0x0D => {}
            _ => {
                let byte = (value >> (8 * (unaligned & 3))) as u8;
                self.cart.write_backup(Memory::save_offset(unaligned), byte);
            }
        }
    }
}

#[inline(always)]
fn read_le16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

#[inline(always)]
fn read_le32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

#[inline(always)]
fn write_le16(data: &mut [u8], offset: usize, value: u16) {
    data[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

#[inline(always)]
fn write_le32(data: &mut [u8], offset: usize, value: u32) {
    data[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
