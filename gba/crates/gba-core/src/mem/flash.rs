//! Flash cartridge backup: the command state machine that decides whether a
//! game can save at all.
//!
//! Games do not write to flash directly. They unlock the chip with a fixed
//! 0xAA / 0x55 prefix pair, issue a command byte, and only then write data.
//! Get any step wrong and the game plays perfectly and never saves, which is
//! the failure mode that costs a playthrough before you notice it.

pub const SECTOR_SIZE: usize = 0x1000;
pub const BANK_SIZE: usize = 0x10000;

/// Command-prefix addresses, as offsets inside the save region.
const CMD_ADDR: u32 = 0x5555;
const CMD_ADDR_2: u32 = 0x2AAA;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    /// Waiting for 0xAA at 0x5555.
    Ready,
    /// Saw 0xAA, waiting for 0x55 at 0x2AAA.
    Unlock,
    /// Both prefix bytes seen, waiting for the command byte.
    Command,
    /// An erase command has been prepared; the next unlocked command selects
    /// chip erase or sector erase.
    EraseUnlock,
    EraseUnlock2,
    EraseCommand,
    /// The next write anywhere in the region programs one byte.
    Write,
    /// The next write to 0x0000 selects the bank.
    BankSelect,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FlashChip {
    pub manufacturer: u8,
    pub device: u8,
}

/// Macronix 128K. Pokemon reads these two bytes and refuses to save if the
/// pair is not one it recognises, so a plausible real chip must be reported.
pub const MACRONIX_128K: FlashChip = FlashChip {
    manufacturer: 0xC2,
    device: 0x09,
};
pub const PANASONIC_64K: FlashChip = FlashChip {
    manufacturer: 0x32,
    device: 0x1B,
};

pub struct Flash {
    pub data: Vec<u8>,
    chip: FlashChip,
    phase: Phase,
    id_mode: bool,
    bank: usize,
    dirty: bool,
}

impl Flash {
    pub fn new(size: usize) -> Flash {
        let chip = if size > BANK_SIZE {
            MACRONIX_128K
        } else {
            PANASONIC_64K
        };
        Flash {
            data: vec![0xFF; size],
            chip,
            phase: Phase::Ready,
            id_mode: false,
            bank: 0,
            dirty: false,
        }
    }

    pub fn load(&mut self, save: &[u8]) {
        let n = save.len().min(self.data.len());
        self.data[..n].copy_from_slice(&save[..n]);
    }

    pub fn dirty(&self) -> bool {
        self.dirty
    }

    pub fn clear_dirty(&mut self) {
        self.dirty = false;
    }

    fn banked(&self, offset: u32) -> usize {
        self.bank * BANK_SIZE + (offset as usize & (BANK_SIZE - 1))
    }

    pub fn read(&self, offset: u32) -> u8 {
        if self.id_mode {
            return match offset & 0xFFFF {
                0 => self.chip.manufacturer,
                1 => self.chip.device,
                _ => 0xFF,
            };
        }
        let index = self.banked(offset);
        self.data.get(index).copied().unwrap_or(0xFF)
    }

    pub fn write(&mut self, offset: u32, value: u8) {
        let offset = offset & 0xFFFF;
        match self.phase {
            Phase::Write => {
                // Flash programming can only clear bits; a set bit needs an
                // erase first. Games rely on this, so AND rather than assign.
                let index = self.banked(offset);
                if let Some(byte) = self.data.get_mut(index) {
                    *byte &= value;
                }
                self.dirty = true;
                self.phase = Phase::Ready;
            }
            Phase::BankSelect => {
                if offset == 0 {
                    self.bank = (value as usize) & 1;
                }
                self.phase = Phase::Ready;
            }
            Phase::Ready if offset == CMD_ADDR && value == 0xAA => self.phase = Phase::Unlock,
            Phase::Unlock if offset == CMD_ADDR_2 && value == 0x55 => self.phase = Phase::Command,
            Phase::Command if offset == CMD_ADDR => {
                self.phase = Phase::Ready;
                match value {
                    0x90 => self.id_mode = true,
                    0xF0 => self.id_mode = false,
                    0x80 => self.phase = Phase::EraseUnlock,
                    0xA0 => self.phase = Phase::Write,
                    0xB0 if self.data.len() > BANK_SIZE => self.phase = Phase::BankSelect,
                    _ => {}
                }
            }
            Phase::EraseUnlock if offset == CMD_ADDR && value == 0xAA => {
                self.phase = Phase::EraseUnlock2
            }
            Phase::EraseUnlock2 if offset == CMD_ADDR_2 && value == 0x55 => {
                self.phase = Phase::EraseCommand
            }
            Phase::EraseCommand => {
                self.phase = Phase::Ready;
                if offset == CMD_ADDR && value == 0x10 {
                    self.data.fill(0xFF);
                    self.dirty = true;
                } else if value == 0x30 {
                    let start = self.banked(offset) & !(SECTOR_SIZE - 1);
                    let end = (start + SECTOR_SIZE).min(self.data.len());
                    self.data[start..end].fill(0xFF);
                    self.dirty = true;
                }
            }
            // Any write that does not fit the sequence aborts it. Silently
            // staying in a half-unlocked state is how phantom saves happen.
            _ => self.phase = Phase::Ready,
        }
    }
}

impl Phase {
    fn to_u8(self) -> u8 {
        match self {
            Phase::Ready => 0,
            Phase::Unlock => 1,
            Phase::Command => 2,
            Phase::EraseUnlock => 3,
            Phase::EraseUnlock2 => 4,
            Phase::EraseCommand => 5,
            Phase::Write => 6,
            Phase::BankSelect => 7,
        }
    }

    fn from_u8(v: u8) -> Option<Phase> {
        Some(match v {
            0 => Phase::Ready,
            1 => Phase::Unlock,
            2 => Phase::Command,
            3 => Phase::EraseUnlock,
            4 => Phase::EraseUnlock2,
            5 => Phase::EraseCommand,
            6 => Phase::Write,
            7 => Phase::BankSelect,
            _ => return None,
        })
    }
}

impl Flash {
    pub(crate) fn serialize(&self, w: &mut crate::state::Writer) {
        w.bytes(&self.data);
        w.u8(self.phase.to_u8());
        w.bool(self.id_mode);
        w.u8(self.bank as u8);
        // Deliberately not `self.dirty`.
        //
        // Whether the host has written this flash to disk yet is the host's
        // bookkeeping, not the machine's state -- and a linked session hashes
        // the serialized state to check that both participants are computing
        // the same thing. Each side clears the flag on its *own* unit after
        // saving, so a real value here made the two sides disagree the moment
        // either game saved, and a trade begins by saving. A constant keeps
        // the format byte-for-byte compatible while taking the flag out of
        // the comparison.
        w.bool(false);
    }

    pub(crate) fn deserialize(
        &mut self,
        r: &mut crate::state::Reader,
    ) -> Result<(), crate::state::StateError> {
        r.bytes_into(&mut self.data)?;
        self.phase =
            Phase::from_u8(r.u8()?).ok_or(crate::state::StateError::Corrupt("flash phase"))?;
        self.id_mode = r.bool()?;
        self.bank = (r.u8()? & 1) as usize;
        // Read and discarded, to keep the layout. Restored flash may well
        // differ from whatever `.sav` is on disk, so the safe assumption is
        // that it needs writing; the cost of being wrong is one redundant
        // save, and the cost the other way is a lost one.
        let _ = r.bool()?;
        self.dirty = true;
        Ok(())
    }
}
