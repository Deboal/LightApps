//! Memory map, cartridge detection, and flash save tests.

use gba_core::bus::Bus;
use gba_core::mem::cart::{detect_save_type, Header, SaveType};
use gba_core::mem::Memory;
use gba_core::Emulator;

/// A ROM carrying a header and, optionally, a save-type tag.
fn rom_with(tag: Option<&[u8]>, game_code: &[u8; 4]) -> Vec<u8> {
    let mut rom = vec![0u8; 0x1000];
    rom[0xA0..0xAC].copy_from_slice(b"POKEMON EMER");
    rom[0xAC..0xB0].copy_from_slice(game_code);
    rom[0xB0..0xB2].copy_from_slice(b"01");
    if let Some(tag) = tag {
        rom[0x800..0x800 + tag.len()].copy_from_slice(tag);
    }
    rom
}

fn memory(rom: Vec<u8>) -> Memory {
    Memory::new(rom, None)
}

#[test]
fn header_parses_the_game_code() {
    let rom = rom_with(None, b"BPEE");
    let header = Header::parse(&rom).expect("header");
    assert_eq!(header.title, "POKEMON EMER");
    assert_eq!(header.game_code, "BPEE");
    assert_eq!(header.maker_code, "01");
}

#[test]
fn save_type_detection_prefers_the_most_specific_tag() {
    // FLASH1M_V contains "FLASH", so a naive scan would report a 64 KB chip
    // and quietly halve every Pokemon save.
    assert_eq!(
        detect_save_type(&rom_with(Some(b"FLASH1M_V103"), b"BPEE")),
        SaveType::Flash1M
    );
    assert_eq!(
        detect_save_type(&rom_with(Some(b"FLASH512_V130"), b"AXVE")),
        SaveType::Flash512
    );
    assert_eq!(
        detect_save_type(&rom_with(Some(b"FLASH_V126"), b"AXVE")),
        SaveType::Flash512
    );
    assert_eq!(
        detect_save_type(&rom_with(Some(b"SRAM_V113"), b"AXVE")),
        SaveType::Sram
    );
    assert_eq!(
        detect_save_type(&rom_with(Some(b"EEPROM_V122"), b"AXVE")),
        SaveType::Eeprom8K
    );
    assert_eq!(detect_save_type(&rom_with(None, b"AXVE")), SaveType::None);
}

#[test]
fn ram_regions_mirror_within_their_windows() {
    let mut mem = memory(rom_with(None, b"BPEE"));
    mem.write32(0x0200_0000, 0xDEAD_BEEF);
    assert_eq!(mem.read32(0x0204_0000), 0xDEAD_BEEF);

    mem.write32(0x0300_0000, 0x1234_5678);
    assert_eq!(mem.read32(0x0300_8000), 0x1234_5678);
}

#[test]
fn vram_mirrors_its_last_thirty_two_kilobytes() {
    // VRAM is 96 KB in a 128 KB window: the top 32 KB is a second view of the
    // 0x0601_0000 bank, not a continuation.
    let mut mem = memory(rom_with(None, b"BPEE"));
    mem.write16(0x0601_0000, 0xBEEF);
    assert_eq!(mem.read16(0x0601_8000), 0xBEEF);
    assert_eq!(mem.read16(0x0602_0000 + 0x1_8000), 0xBEEF);

    mem.write16(0x0600_0000, 0xCAFE);
    assert_eq!(mem.read16(0x0602_0000), 0xCAFE);
}

#[test]
fn byte_writes_to_video_memory_are_widened_or_dropped() {
    let mut mem = memory(rom_with(None, b"BPEE"));

    // Palette RAM has no byte lane: the byte is written to both halves.
    mem.write8(0x0500_0000, 0xAB);
    assert_eq!(mem.read16(0x0500_0000), 0xABAB);

    // Same in the background half of VRAM.
    mem.write8(0x0600_0000, 0xCD);
    assert_eq!(mem.read16(0x0600_0000), 0xCDCD);

    // The sprite half discards byte writes entirely.
    mem.write16(0x0601_0000, 0x1234);
    mem.write8(0x0601_0000, 0xFF);
    assert_eq!(mem.read16(0x0601_0000), 0x1234);

    // So does OAM.
    mem.write16(0x0700_0000, 0x5678);
    mem.write8(0x0700_0000, 0xFF);
    assert_eq!(mem.read16(0x0700_0000), 0x5678);
}

#[test]
fn the_save_region_is_an_eight_bit_bus() {
    let mut mem = memory(rom_with(Some(b"SRAM_V113"), b"AXVE"));

    mem.write8(0x0E00_0000, 0x42);
    // A halfword read returns the single byte duplicated, and a word read
    // returns it four times -- there is only one byte lane on the cartridge.
    assert_eq!(mem.read16(0x0E00_0000), 0x4242);
    assert_eq!(mem.read32(0x0E00_0000), 0x4242_4242);

    // A halfword write delivers exactly one byte, chosen by the low address
    // bit of the access.
    mem.write16(0x0E00_0004, 0xAABB);
    assert_eq!(mem.read8(0x0E00_0004), 0xBB);
    // An odd address selects the high byte and lands at that odd offset.
    mem.write16(0x0E00_0005, 0xCCDD);
    assert_eq!(mem.read8(0x0E00_0005), 0xCC);
    assert_eq!(mem.read8(0x0E00_0004), 0xBB);
}

#[test]
fn rom_reads_past_the_end_return_open_bus() {
    let rom = rom_with(None, b"BPEE");
    let mut mem = memory(rom);
    // 0x1000 bytes of ROM; anything above reads the address pattern.
    assert_eq!(mem.read16(0x0800_2000), 0x1000);
}

// -- flash ---------------------------------------------------------------

fn unlock(mem: &mut Memory, command: u8) {
    mem.write8(0x0E00_5555, 0xAA);
    mem.write8(0x0E00_2AAA, 0x55);
    mem.write8(0x0E00_5555, command);
}

#[test]
fn flash_reports_a_chip_id_the_game_will_accept() {
    // Pokemon reads the manufacturer and device ID and refuses to save if the
    // pair is not one it knows, so this is not cosmetic.
    let mut mem = memory(rom_with(Some(b"FLASH1M_V103"), b"BPEE"));
    unlock(&mut mem, 0x90);
    assert_eq!(mem.read8(0x0E00_0000), 0xC2);
    assert_eq!(mem.read8(0x0E00_0001), 0x09);

    unlock(&mut mem, 0xF0);
    assert_eq!(mem.read8(0x0E00_0000), 0xFF);
}

#[test]
fn flash_programs_a_byte_only_after_the_command_sequence() {
    let mut mem = memory(rom_with(Some(b"FLASH1M_V103"), b"BPEE"));

    // A bare write with no command does nothing.
    mem.write8(0x0E00_0010, 0x42);
    assert_eq!(mem.read8(0x0E00_0010), 0xFF);

    unlock(&mut mem, 0xA0);
    mem.write8(0x0E00_0010, 0x42);
    assert_eq!(mem.read8(0x0E00_0010), 0x42);

    // Only one byte per command: the next write is not program data.
    mem.write8(0x0E00_0011, 0x43);
    assert_eq!(mem.read8(0x0E00_0011), 0xFF);
}

#[test]
fn flash_programming_can_only_clear_bits() {
    let mut mem = memory(rom_with(Some(b"FLASH1M_V103"), b"BPEE"));
    unlock(&mut mem, 0xA0);
    mem.write8(0x0E00_0000, 0xF0);
    unlock(&mut mem, 0xA0);
    mem.write8(0x0E00_0000, 0x0F);
    // Without an erase the two writes AND together rather than replacing.
    assert_eq!(mem.read8(0x0E00_0000), 0x00);
}

#[test]
fn flash_sector_erase_clears_exactly_one_sector() {
    let mut mem = memory(rom_with(Some(b"FLASH1M_V103"), b"BPEE"));
    for addr in [0x0E00_0000u32, 0x0E00_1000] {
        unlock(&mut mem, 0xA0);
        mem.write8(addr, 0x00);
    }
    unlock(&mut mem, 0x80);
    mem.write8(0x0E00_5555, 0xAA);
    mem.write8(0x0E00_2AAA, 0x55);
    mem.write8(0x0E00_1000, 0x30);

    assert_eq!(mem.read8(0x0E00_1000), 0xFF);
    assert_eq!(mem.read8(0x0E00_0000), 0x00);
}

#[test]
fn flash_bank_switching_reaches_the_second_sixty_four_kilobytes() {
    let mut mem = memory(rom_with(Some(b"FLASH1M_V103"), b"BPEE"));
    unlock(&mut mem, 0xA0);
    mem.write8(0x0E00_0000, 0x11);

    unlock(&mut mem, 0xB0);
    mem.write8(0x0E00_0000, 1);
    // Bank 1 is untouched, and programming there does not disturb bank 0.
    assert_eq!(mem.read8(0x0E00_0000), 0xFF);
    unlock(&mut mem, 0xA0);
    mem.write8(0x0E00_0000, 0x22);
    assert_eq!(mem.read8(0x0E00_0000), 0x22);

    unlock(&mut mem, 0xB0);
    mem.write8(0x0E00_0000, 0);
    assert_eq!(mem.read8(0x0E00_0000), 0x11);

    let save = mem.cart.save_data().expect("flash backing store");
    assert_eq!(save.len(), 0x20000);
    assert_eq!(save[0], 0x11);
    assert_eq!(save[0x10000], 0x22);
}

#[test]
fn a_save_survives_being_written_out_and_loaded_back() {
    // The whole point of phase 6: quit, relaunch, and the progress is there.
    let rom = rom_with(Some(b"FLASH1M_V103"), b"BPEE");
    let mut first = Emulator::new(&rom, None, None);
    assert!(!first.save_dirty());
    unlock(&mut first.mem, 0xA0);
    first.mem.write8(0x0E00_1234, 0x5A);
    assert!(first.save_dirty());

    let save = first.save_data().expect("save").to_vec();
    let mut second = Emulator::new(&rom, None, Some(&save));
    assert_eq!(second.mem.read8(0x0E00_1234), 0x5A);
}
