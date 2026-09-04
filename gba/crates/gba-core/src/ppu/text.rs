//! Background layer rendering: tiled (text), affine, and the bitmap modes.

use super::{palette, read16, BG0CNT, BG0HOFS, BG2PA, TRANSPARENT};
use crate::mem::{IO_SIZE, PALRAM_SIZE, VRAM_SIZE};
use crate::SCREEN_WIDTH;

#[inline(always)]
fn vram_byte(vram: &[u8; VRAM_SIZE], offset: usize) -> u8 {
    // Character data can be addressed past the end of a bank; the hardware
    // wraps, and reading zero is the closest safe stand-in.
    vram.get(offset).copied().unwrap_or(0)
}

/// A tiled background. Four sizes, 4bpp or 8bpp tiles, wrapping in both axes.
pub fn render(
    out: &mut [u32; SCREEN_WIDTH],
    io: &[u8; IO_SIZE],
    vram: &[u8; VRAM_SIZE],
    palram: &[u8; PALRAM_SIZE],
    bg: usize,
    line: u32,
) {
    let control = read16(io, (BG0CNT + 2 * bg as u32) as usize);
    let char_base = ((control >> 2) & 3) as usize * 0x4000;
    let bpp8 = control & (1 << 7) != 0;
    let screen_base = ((control >> 8) & 0x1F) as usize * 0x800;
    let (width, height) = match (control >> 14) & 3 {
        0 => (256usize, 256usize),
        1 => (512, 256),
        2 => (256, 512),
        _ => (512, 512),
    };

    let scroll = (BG0HOFS + 4 * bg as u32) as usize;
    let hofs = read16(io, scroll) as usize & 0x1FF;
    let vofs = read16(io, scroll + 2) as usize & 0x1FF;

    let y = (line as usize + vofs) & (height - 1);
    let tile_y = y / 8;

    for (x, slot) in out.iter_mut().enumerate() {
        let sx = (x + hofs) & (width - 1);
        let tile_x = sx / 8;

        // A 512-pixel-wide map is two 32x32 screen blocks side by side, and a
        // 512-tall one stacks them; the block index is not a simple divide.
        let mut block = 0usize;
        if tile_x >= 32 {
            block += 1;
        }
        if tile_y >= 32 {
            block += if width == 512 { 2 } else { 1 };
        }
        let entry_at = screen_base + block * 0x800 + ((tile_y % 32) * 32 + (tile_x % 32)) * 2;
        if entry_at + 1 >= VRAM_SIZE {
            continue;
        }
        let entry = read16(vram, entry_at);
        let tile = (entry & 0x3FF) as usize;
        let mut px = sx % 8;
        let mut py = y % 8;
        if entry & (1 << 10) != 0 {
            px = 7 - px;
        }
        if entry & (1 << 11) != 0 {
            py = 7 - py;
        }

        let index = if bpp8 {
            vram_byte(vram, char_base + tile * 64 + py * 8 + px) as usize
        } else {
            let byte = vram_byte(vram, char_base + tile * 32 + py * 4 + px / 2);
            (if px & 1 == 0 { byte & 0xF } else { byte >> 4 }) as usize
        };
        if index == 0 {
            continue;
        }
        let entry_index = if bpp8 {
            index
        } else {
            ((entry >> 12) & 0xF) as usize * 16 + index
        };
        *slot = palette(palram, entry_index);
    }
}

/// An affine (rotation/scaling) background. 8bpp tiles, one byte per map
/// entry, and no flipping.
pub fn render_affine(
    out: &mut [u32; SCREEN_WIDTH],
    io: &[u8; IO_SIZE],
    vram: &[u8; VRAM_SIZE],
    palram: &[u8; PALRAM_SIZE],
    bg: usize,
    reference: [i32; 2],
) {
    let control = read16(io, (BG0CNT + 2 * bg as u32) as usize);
    let char_base = ((control >> 2) & 3) as usize * 0x4000;
    let screen_base = ((control >> 8) & 0x1F) as usize * 0x800;
    let wrap = control & (1 << 13) != 0;
    let tiles = 16i32 << ((control >> 14) & 3);
    let extent = tiles * 8;

    let matrix = (BG2PA + 0x10 * (bg as u32 - 2)) as usize;
    let pa = i16::from_le_bytes([io[matrix], io[matrix + 1]]) as i32;
    let pc = i16::from_le_bytes([io[matrix + 4], io[matrix + 5]]) as i32;

    for (x, slot) in out.iter_mut().enumerate() {
        let mut tx = (reference[0].wrapping_add(pa * x as i32)) >> 8;
        let mut ty = (reference[1].wrapping_add(pc * x as i32)) >> 8;
        if wrap {
            tx = tx.rem_euclid(extent);
            ty = ty.rem_euclid(extent);
        } else if tx < 0 || ty < 0 || tx >= extent || ty >= extent {
            continue;
        }

        let tile = vram_byte(
            vram,
            screen_base + (ty / 8) as usize * tiles as usize + (tx / 8) as usize,
        ) as usize;
        let index = vram_byte(
            vram,
            char_base + tile * 64 + (ty % 8) as usize * 8 + (tx % 8) as usize,
        ) as usize;
        if index != 0 {
            *slot = palette(palram, index);
        }
    }
}

/// Modes 3, 4 and 5: a framebuffer in VRAM, sampled through BG2's affine
/// transform exactly as a tiled affine background would be.
pub fn render_bitmap(
    out: &mut [u32; SCREEN_WIDTH],
    io: &[u8; IO_SIZE],
    vram: &[u8; VRAM_SIZE],
    palram: &[u8; PALRAM_SIZE],
    mode: u16,
    dispcnt: u16,
    reference: [i32; 2],
) {
    let (width, height, direct) = match mode {
        3 => (240i32, 160i32, true),
        4 => (240, 160, false),
        _ => (160, 128, true),
    };
    // Modes 4 and 5 are double buffered; mode 3 has no room for a second page.
    let base = if mode != 3 && dispcnt & (1 << 4) != 0 {
        0xA000
    } else {
        0
    };

    let pa = i16::from_le_bytes([io[BG2PA as usize], io[BG2PA as usize + 1]]) as i32;
    let pc = i16::from_le_bytes([io[BG2PA as usize + 4], io[BG2PA as usize + 5]]) as i32;

    for (x, slot) in out.iter_mut().enumerate() {
        let sx = (reference[0].wrapping_add(pa * x as i32)) >> 8;
        let sy = (reference[1].wrapping_add(pc * x as i32)) >> 8;
        if sx < 0 || sy < 0 || sx >= width || sy >= height {
            continue;
        }
        let offset = (sy * width + sx) as usize;
        if direct {
            let at = base + offset * 2;
            if at + 1 < VRAM_SIZE {
                *slot = read16(vram, at) as u32;
            }
        } else {
            let index = vram_byte(vram, base + offset) as usize;
            if index != 0 {
                *slot = palette(palram, index);
            }
        }
    }
    let _ = TRANSPARENT;
}
