//! Sprite (OAM) rendering: 128 entries, regular and affine, 1D and 2D tile
//! mapping.

use super::{palette, read16, TRANSPARENT};
use crate::mem::{IO_SIZE, OAM_SIZE, PALRAM_SIZE, VRAM_SIZE};
use crate::SCREEN_WIDTH;

/// Sprite tile data starts halfway through VRAM, after the background banks.
const OBJ_TILE_BASE: usize = 0x1_0000;
/// Sprite palettes occupy the second half of palette RAM.
const OBJ_PALETTE: usize = 256;

/// (width, height) indexed by shape then size.
const DIMENSIONS: [[(u32, u32); 4]; 3] = [
    [(8, 8), (16, 16), (32, 32), (64, 64)],
    [(16, 8), (32, 8), (32, 16), (64, 32)],
    [(8, 16), (8, 32), (16, 32), (32, 64)],
];

#[allow(clippy::too_many_arguments)]
pub fn render(
    out: &mut [u32; SCREEN_WIDTH],
    priorities: &mut [u8; SCREEN_WIDTH],
    io: &[u8; IO_SIZE],
    vram: &[u8; VRAM_SIZE],
    palram: &[u8; PALRAM_SIZE],
    oam: &[u8; OAM_SIZE],
    dispcnt: u16,
    line: u32,
) {
    let one_dimensional = dispcnt & (1 << 6) != 0;
    let _ = io;

    // Walk OAM in order. A sprite only claims a pixel if it outranks whatever
    // is already there, so on equal priority the lower OAM index wins -- the
    // hardware's ordering.
    for entry in 0..128 {
        let attr0 = read16(oam, entry * 8);
        let attr1 = read16(oam, entry * 8 + 2);
        let attr2 = read16(oam, entry * 8 + 4);

        let affine = attr0 & (1 << 8) != 0;
        let double_or_disabled = attr0 & (1 << 9) != 0;
        if !affine && double_or_disabled {
            continue;
        }
        // Object window sprites contribute a mask, not pixels; without window
        // support they are simply not drawn.
        if (attr0 >> 10) & 3 == 2 {
            continue;
        }

        let shape = ((attr0 >> 14) & 3) as usize;
        let size = ((attr1 >> 14) & 3) as usize;
        if shape == 3 {
            continue;
        }
        let (width, height) = DIMENSIONS[shape][size];
        let (box_width, box_height) = if affine && double_or_disabled {
            (width * 2, height * 2)
        } else {
            (width, height)
        };

        // Y wraps in 256 and X in 512, so a sprite can straddle the top or
        // left edge by being placed near the wrap point.
        let y = (attr0 & 0xFF) as i32;
        let top = if y + box_height as i32 > 256 {
            y - 256
        } else {
            y
        };
        let row = line as i32 - top;
        if row < 0 || row >= box_height as i32 {
            continue;
        }

        let x = (attr1 & 0x1FF) as i32;
        let left = if x >= 256 { x - 512 } else { x };

        let bpp8 = attr0 & (1 << 13) != 0;
        let tile = (attr2 & 0x3FF) as usize;
        let priority = ((attr2 >> 10) & 3) as u8;
        let palette_bank = ((attr2 >> 12) & 0xF) as usize;

        let (pa, pb, pc, pd) = if affine {
            let group = ((attr1 >> 9) & 0x1F) as usize;
            (
                read16(oam, group * 32 + 6) as i16 as i32,
                read16(oam, group * 32 + 14) as i16 as i32,
                read16(oam, group * 32 + 22) as i16 as i32,
                read16(oam, group * 32 + 30) as i16 as i32,
            )
        } else {
            (0x100, 0, 0, 0x100)
        };

        let hflip = !affine && attr1 & (1 << 12) != 0;
        let vflip = !affine && attr1 & (1 << 13) != 0;

        for column in 0..box_width as i32 {
            let screen_x = left + column;
            if !(0..SCREEN_WIDTH as i32).contains(&screen_x) {
                continue;
            }
            let slot = screen_x as usize;
            if out[slot] != TRANSPARENT && priorities[slot] <= priority {
                continue;
            }

            let (mut sx, mut sy) = if affine {
                // Map the screen pixel back through the inverse matrix, taken
                // relative to the centre of the (possibly doubled) box.
                let dx = column - box_width as i32 / 2;
                let dy = row - box_height as i32 / 2;
                let sx = (pa * dx + pb * dy) >> 8;
                let sy = (pc * dx + pd * dy) >> 8;
                (sx + width as i32 / 2, sy + height as i32 / 2)
            } else {
                (column, row)
            };
            if sx < 0 || sy < 0 || sx >= width as i32 || sy >= height as i32 {
                continue;
            }
            if hflip {
                sx = width as i32 - 1 - sx;
            }
            if vflip {
                sy = height as i32 - 1 - sy;
            }

            let tile_x = sx as usize / 8;
            let tile_y = sy as usize / 8;
            let stride = if one_dimensional {
                (width as usize / 8) * if bpp8 { 2 } else { 1 }
            } else {
                32
            };
            let tile_index = tile + tile_y * stride + tile_x * if bpp8 { 2 } else { 1 };
            let tile_at = OBJ_TILE_BASE + (tile_index & 0x3FF) * 32;

            let px = sx as usize % 8;
            let py = sy as usize % 8;
            let index = if bpp8 {
                vram.get(tile_at + py * 8 + px).copied().unwrap_or(0) as usize
            } else {
                let byte = vram.get(tile_at + py * 4 + px / 2).copied().unwrap_or(0);
                (if px & 1 == 0 { byte & 0xF } else { byte >> 4 }) as usize
            };
            if index == 0 {
                continue;
            }
            let entry = OBJ_PALETTE
                + if bpp8 {
                    index
                } else {
                    palette_bank * 16 + index
                };
            out[slot] = palette(palram, entry);
            priorities[slot] = priority;
        }
    }
}
