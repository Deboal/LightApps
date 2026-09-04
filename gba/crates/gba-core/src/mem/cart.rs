//! Cartridge: header parsing, save-type detection, and backup storage.

use super::flash::Flash;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SaveType {
    None,
    Sram,
    Flash512,
    Flash1M,
    Eeprom512,
    Eeprom8K,
}

impl SaveType {
    pub fn size(self) -> usize {
        match self {
            SaveType::None => 0,
            SaveType::Sram => 0x8000,
            SaveType::Flash512 => 0x10000,
            SaveType::Flash1M => 0x20000,
            SaveType::Eeprom512 => 512,
            SaveType::Eeprom8K => 0x2000,
        }
    }
}

/// The ID strings a GBA cartridge's save routine leaves in the ROM image.
/// Order matters: FLASH1M_V and FLASH512_V both contain FLASH, so the longer
/// and more specific tags have to be tested first.
const SAVE_TAGS: [(&[u8], SaveType); 6] = [
    (b"EEPROM_V", SaveType::Eeprom8K),
    (b"FLASH1M_V", SaveType::Flash1M),
    (b"FLASH512_V", SaveType::Flash512),
    (b"FLASH_V", SaveType::Flash512),
    (b"SRAM_F_V", SaveType::Sram),
    (b"SRAM_V", SaveType::Sram),
];

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Header {
    pub title: String,
    pub game_code: String,
    pub maker_code: String,
}

impl Header {
    pub fn parse(rom: &[u8]) -> Option<Header> {
        if rom.len() < 0xC0 {
            return None;
        }
        let text = |range: core::ops::Range<usize>| {
            String::from_utf8_lossy(&rom[range])
                .trim_end_matches('\0')
                .trim()
                .to_string()
        };
        Some(Header {
            title: text(0xA0..0xAC),
            game_code: text(0xAC..0xB0),
            maker_code: text(0xB0..0xB2),
        })
    }
}

enum Backup {
    None,
    Sram(Vec<u8>),
    Flash(Flash),
}

pub struct Cartridge {
    pub rom: Vec<u8>,
    pub header: Option<Header>,
    pub save_type: SaveType,
    backup: Backup,
    /// SRAM has no command protocol, so writes are tracked here rather than
    /// inside a state machine.
    sram_dirty: bool,
}

impl Cartridge {
    pub fn new(rom: Vec<u8>) -> Cartridge {
        let save_type = detect_save_type(&rom);
        let backup = match save_type {
            SaveType::Sram => Backup::Sram(vec![0xFF; SaveType::Sram.size()]),
            SaveType::Flash512 => Backup::Flash(Flash::new(SaveType::Flash512.size())),
            SaveType::Flash1M => Backup::Flash(Flash::new(SaveType::Flash1M.size())),
            // EEPROM sits on the ROM bus rather than the save region and is
            // not wired up yet; no mainline Pokemon title needs it.
            _ => Backup::None,
        };
        let header = Header::parse(&rom);
        Cartridge {
            rom,
            header,
            save_type,
            backup,
            sram_dirty: false,
        }
    }

    pub fn load_save(&mut self, save: &[u8]) {
        match &mut self.backup {
            Backup::Sram(data) => {
                let n = save.len().min(data.len());
                data[..n].copy_from_slice(&save[..n]);
            }
            Backup::Flash(flash) => flash.load(save),
            Backup::None => {}
        }
    }

    pub fn save_data(&self) -> Option<&[u8]> {
        match &self.backup {
            Backup::Sram(data) => Some(data),
            Backup::Flash(flash) => Some(&flash.data),
            Backup::None => None,
        }
    }

    pub fn save_dirty(&self) -> bool {
        match &self.backup {
            Backup::Flash(flash) => flash.dirty(),
            Backup::Sram(_) => self.sram_dirty,
            Backup::None => false,
        }
    }

    pub fn clear_save_dirty(&mut self) {
        self.sram_dirty = false;
        if let Backup::Flash(flash) = &mut self.backup {
            flash.clear_dirty();
        }
    }

    /// ROM reads mirror across the three cartridge windows and return an
    /// open-bus pattern past the end of the image.
    pub fn read_rom16(&self, offset: u32) -> u16 {
        let index = offset as usize;
        if index + 1 < self.rom.len() {
            u16::from_le_bytes([self.rom[index], self.rom[index + 1]])
        } else {
            (offset >> 1) as u16
        }
    }

    pub fn read_rom8(&self, offset: u32) -> u8 {
        self.rom.get(offset as usize).copied().unwrap_or_else(|| {
            let half = (offset >> 1) as u16;
            (half >> (8 * (offset & 1))) as u8
        })
    }

    pub fn read_backup(&self, offset: u32) -> u8 {
        match &self.backup {
            Backup::Sram(data) => data[offset as usize & (data.len() - 1)],
            Backup::Flash(flash) => flash.read(offset),
            Backup::None => 0xFF,
        }
    }

    pub fn write_backup(&mut self, offset: u32, value: u8) {
        match &mut self.backup {
            Backup::Sram(data) => {
                let mask = data.len() - 1;
                data[offset as usize & mask] = value;
                self.sram_dirty = true;
            }
            Backup::Flash(flash) => flash.write(offset, value),
            Backup::None => {}
        }
    }
}

pub fn detect_save_type(rom: &[u8]) -> SaveType {
    for (tag, ty) in SAVE_TAGS {
        if rom.windows(tag.len()).any(|w| w == tag) {
            return ty;
        }
    }
    SaveType::None
}

impl Cartridge {
    pub(crate) fn serialize(&self, w: &mut crate::state::Writer) {
        match &self.backup {
            Backup::None => w.u8(0),
            Backup::Sram(data) => {
                w.u8(1);
                w.bytes(data);
            }
            Backup::Flash(flash) => {
                w.u8(2);
                flash.serialize(w);
            }
        }
    }

    pub(crate) fn deserialize(
        &mut self,
        r: &mut crate::state::Reader,
    ) -> Result<(), crate::state::StateError> {
        let tag = r.u8()?;
        match (&mut self.backup, tag) {
            (Backup::None, 0) => Ok(()),
            (Backup::Sram(data), 1) => r.bytes_into(data),
            (Backup::Flash(flash), 2) => flash.deserialize(r),
            // A state for a different cartridge is a load error, not something
            // to paper over: the save would be silently wrong.
            _ => Err(crate::state::StateError::Corrupt("backup type mismatch")),
        }
    }
}
