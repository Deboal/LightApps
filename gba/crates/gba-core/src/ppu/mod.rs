//! The picture processing unit: scanline timing and a scanline renderer.
//!
//! Timing matters more here than pixel exactness. The game's entire main loop
//! is built on VBlankIntrWait, so DISPSTAT, VCOUNT and the VBlank interrupt
//! have to be right before a single pixel is worth drawing.

mod objects;
mod text;

use crate::dma;
use crate::irq;
use crate::mem::{Memory, IO_SIZE, OAM_SIZE, PALRAM_SIZE, VRAM_SIZE};
use crate::{SCREEN_HEIGHT, SCREEN_WIDTH};

/// 240 visible dots plus 68 of HBlank, at four cycles per dot.
pub const CYCLES_PER_DOT: u32 = 4;
pub const HDRAW_CYCLES: u32 = 240 * CYCLES_PER_DOT;
pub const LINE_CYCLES: u32 = 308 * CYCLES_PER_DOT;
pub const VISIBLE_LINES: u32 = 160;
pub const TOTAL_LINES: u32 = 228;

// Register offsets inside the I/O window.
pub const DISPCNT: u32 = 0x000;
pub const DISPSTAT: u32 = 0x004;
pub const VCOUNT: u32 = 0x006;
pub const BG0CNT: u32 = 0x008;
pub const BG0HOFS: u32 = 0x010;
pub const BG2PA: u32 = 0x020;
pub const BG2X: u32 = 0x028;

/// A pixel slot that nothing has drawn into yet.
pub const TRANSPARENT: u32 = 0xFFFF_FFFF;

pub struct Ppu {
    pub framebuffer: Box<[u16; SCREEN_WIDTH * SCREEN_HEIGHT]>,
    /// Cycles elapsed within the current scanline.
    pub line_cycles: u32,
    /// Internal affine reference points for BG2 and BG3, latched at the start
    /// of each frame and advanced one row per scanline. Distinct from the
    /// BGxX/BGxY registers, which the game may rewrite mid-frame.
    pub affine_ref: [[i32; 2]; 2],
    /// Per-layer scratch, kept here so rendering allocates nothing.
    layers: [[u32; SCREEN_WIDTH]; 4],
    objects: [u32; SCREEN_WIDTH],
    object_priority: [u8; SCREEN_WIDTH],
}

impl Default for Ppu {
    fn default() -> Ppu {
        Ppu {
            framebuffer: Box::new([0; SCREEN_WIDTH * SCREEN_HEIGHT]),
            line_cycles: 0,
            affine_ref: [[0; 2]; 2],
            layers: [[TRANSPARENT; SCREEN_WIDTH]; 4],
            objects: [TRANSPARENT; SCREEN_WIDTH],
            object_priority: [4; SCREEN_WIDTH],
        }
    }
}

/// Advance the display by `cycles`, firing the events the game waits on.
pub fn step(mem: &mut Memory, cycles: u32) {
    let mut remaining = cycles;
    while remaining > 0 {
        let at = mem.ppu.line_cycles;
        let next = if at < HDRAW_CYCLES {
            HDRAW_CYCLES
        } else {
            LINE_CYCLES
        };
        let advance = remaining.min(next - at);
        mem.ppu.line_cycles += advance;
        remaining -= advance;

        if mem.ppu.line_cycles == HDRAW_CYCLES {
            enter_hblank(mem);
        } else if mem.ppu.line_cycles == LINE_CYCLES {
            mem.ppu.line_cycles = 0;
            next_line(mem);
        }
    }
}

fn enter_hblank(mem: &mut Memory) {
    let status = mem.read_io16(DISPSTAT);
    mem.write_io16_raw(DISPSTAT, status | (1 << 1));
    if status & (1 << 4) != 0 {
        mem.raise_irq(irq::HBLANK);
    }
    // HBlank DMA does not run during VBlank.
    if mem.read_io16(VCOUNT) < VISIBLE_LINES as u16 {
        dma::trigger(mem, dma::Timing::HBlank);
    }
}

fn next_line(mem: &mut Memory) {
    let line = (mem.read_io16(VCOUNT) as u32 + 1) % TOTAL_LINES;
    mem.write_io16_raw(VCOUNT, line as u16);

    let mut status = mem.read_io16(DISPSTAT) & !(1 << 1);
    let mut raised = 0u16;

    // The VBlank flag covers lines 160 to 226 -- not 227, which the hardware
    // treats as the last line of the frame rather than the first of the next.
    if line == VISIBLE_LINES {
        status |= 1 << 0;
        if status & (1 << 3) != 0 {
            raised |= irq::VBLANK;
        }
        dma::trigger(mem, dma::Timing::VBlank);
    } else if line == 0 || line == TOTAL_LINES - 1 {
        status &= !(1 << 0);
    }

    let target = (status >> 8) & 0xFF;
    if line as u16 == target {
        status |= 1 << 2;
        if status & (1 << 5) != 0 {
            raised |= irq::VCOUNT;
        }
    } else {
        status &= !(1 << 2);
    }

    mem.write_io16_raw(DISPSTAT, status);
    if raised != 0 {
        mem.raise_irq(raised);
    }

    if line == 0 {
        latch_affine_reference(mem);
    }
    if line < VISIBLE_LINES {
        render_scanline(mem, line);
    }
    if line == VISIBLE_LINES {
        // The affine reference advances one row per visible scanline; reset it
        // once the visible area is done so a mid-frame register write does not
        // leak into the next frame.
        latch_affine_reference(mem);
    }
}

/// BGxX/BGxY are 28-bit signed fixed point with 8 fractional bits.
fn sign_extend_28(value: u32) -> i32 {
    ((value << 4) as i32) >> 4
}

fn latch_affine_reference(mem: &mut Memory) {
    for bg in 0..2 {
        let base = BG2X + 0x10 * bg as u32;
        mem.ppu.affine_ref[bg][0] = sign_extend_28(mem.read_io32(base));
        mem.ppu.affine_ref[bg][1] = sign_extend_28(mem.read_io32(base + 4));
    }
}

/// Called when the game writes BGxX/BGxY, which re-latches the internal
/// reference immediately rather than waiting for the next frame.
pub fn write_affine_reference(mem: &mut Memory, bg: usize, vertical: bool) {
    let base = BG2X + 0x10 * bg as u32 + if vertical { 4 } else { 0 };
    mem.ppu.affine_ref[bg][vertical as usize] = sign_extend_28(mem.read_io32(base));
}

fn render_scanline(mem: &mut Memory, line: u32) {
    let Memory {
        ppu,
        io,
        vram,
        palram,
        oam,
        ..
    } = mem;
    draw(ppu, io, vram, palram, oam, line);

    // Affine backgrounds walk one row down per scanline.
    for bg in 0..2 {
        let base = (BG2PA + 0x10 * bg as u32) as usize;
        let pb = i16::from_le_bytes([io[base + 2], io[base + 3]]) as i32;
        let pd = i16::from_le_bytes([io[base + 6], io[base + 7]]) as i32;
        ppu.affine_ref[bg][0] = ppu.affine_ref[bg][0].wrapping_add(pb);
        ppu.affine_ref[bg][1] = ppu.affine_ref[bg][1].wrapping_add(pd);
    }
}

pub(crate) fn read16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

/// Look up a palette entry, returning the raw BGR555 value.
pub(crate) fn palette(palram: &[u8; PALRAM_SIZE], index: usize) -> u32 {
    read16(palram, (index * 2) & (PALRAM_SIZE - 2)) as u32
}

fn draw(
    ppu: &mut Ppu,
    io: &[u8; IO_SIZE],
    vram: &[u8; VRAM_SIZE],
    palram: &[u8; PALRAM_SIZE],
    oam: &[u8; OAM_SIZE],
    line: u32,
) {
    let dispcnt = read16(io, DISPCNT as usize);
    let row = line as usize * SCREEN_WIDTH;

    // Forced blank drives the display white regardless of everything else;
    // games use it while they rebuild VRAM.
    if dispcnt & (1 << 7) != 0 {
        ppu.framebuffer[row..row + SCREEN_WIDTH].fill(0x7FFF);
        return;
    }

    for layer in ppu.layers.iter_mut() {
        layer.fill(TRANSPARENT);
    }
    ppu.objects.fill(TRANSPARENT);
    ppu.object_priority.fill(4);

    let mode = dispcnt & 7;
    match mode {
        0 => {
            for bg in 0..4 {
                if dispcnt & (1 << (8 + bg)) != 0 {
                    text::render(&mut ppu.layers[bg], io, vram, palram, bg, line);
                }
            }
        }
        1 => {
            for bg in 0..2 {
                if dispcnt & (1 << (8 + bg)) != 0 {
                    text::render(&mut ppu.layers[bg], io, vram, palram, bg, line);
                }
            }
            if dispcnt & (1 << 10) != 0 {
                text::render_affine(&mut ppu.layers[2], io, vram, palram, 2, ppu.affine_ref[0]);
            }
        }
        2 => {
            for bg in 2..4 {
                if dispcnt & (1 << (8 + bg)) != 0 {
                    let reference = ppu.affine_ref[bg - 2];
                    text::render_affine(&mut ppu.layers[bg], io, vram, palram, bg, reference);
                }
            }
        }
        3..=5 => {
            if dispcnt & (1 << 10) != 0 {
                text::render_bitmap(
                    &mut ppu.layers[2],
                    io,
                    vram,
                    palram,
                    mode,
                    dispcnt,
                    ppu.affine_ref[0],
                );
            }
        }
        _ => {}
    }

    if dispcnt & (1 << 12) != 0 {
        objects::render(
            &mut ppu.objects,
            &mut ppu.object_priority,
            io,
            vram,
            palram,
            oam,
            dispcnt,
            line,
        );
    }

    let backdrop = palette(palram, 0);
    for x in 0..SCREEN_WIDTH {
        let mut color = backdrop;
        let mut best = 5u8;
        // Backgrounds first, lowest priority value wins; a lower BG index wins
        // a tie, which is why this walks 0 upward and uses a strict compare.
        for bg in 0..4 {
            if ppu.layers[bg][x] == TRANSPARENT {
                continue;
            }
            let priority = (read16(io, (BG0CNT + 2 * bg as u32) as usize) & 3) as u8;
            if priority < best {
                best = priority;
                color = ppu.layers[bg][x];
            }
        }
        // A sprite ties with a background of equal priority and wins.
        if ppu.objects[x] != TRANSPARENT && ppu.object_priority[x] <= best {
            color = ppu.objects[x];
        }
        ppu.framebuffer[row + x] = color as u16;
    }
}
