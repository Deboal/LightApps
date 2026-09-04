//! The GBA memory map.
//!
//! Two details here are worth more than the rest put together for this
//! target: VRAM's non-power-of-two mirroring, and the save region's 8-bit
//! bus. Everything else is masking.

pub mod cart;
pub mod flash;

use crate::bus::Bus;
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
}

impl Memory {
    pub fn new(rom: Vec<u8>, bios: Option<Vec<u8>>) -> Memory {
        let mut bios = bios.unwrap_or_default();
        bios.resize(BIOS_SIZE, 0);
        Memory {
            bios,
            ewram: Box::new([0; EWRAM_SIZE]),
            iwram: Box::new([0; IWRAM_SIZE]),
            palram: Box::new([0; PALRAM_SIZE]),
            vram: Box::new([0; VRAM_SIZE]),
            oam: Box::new([0; OAM_SIZE]),
            io: Box::new([0; IO_SIZE]),
            cart: Cartridge::new(rom),
            cycles: 0,
            bios_latch: 0,
            in_bios: false,
            halt_requested: false,
        }
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
        self.io.get(offset as usize).copied().unwrap_or(0)
    }

    fn write_io8(&mut self, offset: u32, value: u8) {
        match offset {
            // IF is write-one-to-clear: a game acknowledges an interrupt by
            // writing the bit back, not by clearing it.
            REG_IF | 0x203 => {
                let index = offset as usize;
                self.io[index] &= !value;
            }
            REG_HALTCNT => {
                if value & 0x80 == 0 {
                    self.halt_requested = true;
                }
            }
            _ => {
                if let Some(byte) = self.io.get_mut(offset as usize) {
                    *byte = value;
                }
            }
        }
    }

    pub fn read_io16(&self, offset: u32) -> u16 {
        u16::from_le_bytes([self.read_io8(offset), self.read_io8(offset + 1)])
    }

    pub fn write_io16(&mut self, offset: u32, value: u16) {
        self.write_io8(offset, value as u8);
        self.write_io8(offset + 1, (value >> 8) as u8);
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
