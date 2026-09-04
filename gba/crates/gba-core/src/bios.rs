//! BIOS: a synthesized image for the exception vectors, plus HLE
//! implementations of the SWI calls.
//!
//! A real BIOS dump is supported and preferred, but shipping one is not an
//! option, so the core also runs without it. Two halves make that work:
//!
//! 1. A tiny synthesized BIOS image supplying the reset and IRQ vectors. The
//!    IRQ handler is genuine ARM code -- the same push, indirect call through
//!    0x0300_7FFC, pop and `subs pc, lr, #4` the real BIOS uses -- so
//!    interrupt dispatch needs no interception at all.
//! 2. SWI interception at the CPU, which never reaches the vector.
//!
//! Everything here is integer-only. A single `f64::sin` would make the core
//! non-deterministic across platforms, which is why the sine table below is a
//! fixed integer table rather than something computed at runtime.

use crate::bus::Bus;
use crate::cpu::{Cpu, Mode};
use crate::mem::BIOS_SIZE;

/// Where the game installs its interrupt handler, and where the BIOS keeps
/// the flag IntrWait polls.
pub const IRQ_HANDLER_POINTER: u32 = 0x0300_7FFC;
pub const IRQ_CHECK_FLAG: u32 = 0x0300_7FF8;

/// sin(2*pi*i/256) in Q14, so 16384 is 1.0.
static SINE: [i32; 256] = [
    0, 402, 804, 1205, 1606, 2006, 2404, 2801, 3196, 3590, 3981, 4370, 4756, 5139, 5520, 5897,
    6270, 6639, 7005, 7366, 7723, 8076, 8423, 8765, 9102, 9434, 9760, 10080, 10394, 10702, 11003,
    11297, 11585, 11866, 12140, 12406, 12665, 12916, 13160, 13395, 13623, 13842, 14053, 14256,
    14449, 14635, 14811, 14978, 15137, 15286, 15426, 15557, 15679, 15791, 15893, 15986, 16069,
    16143, 16207, 16261, 16305, 16340, 16364, 16379, 16384, 16379, 16364, 16340, 16305, 16261,
    16207, 16143, 16069, 15986, 15893, 15791, 15679, 15557, 15426, 15286, 15137, 14978, 14811,
    14635, 14449, 14256, 14053, 13842, 13623, 13395, 13160, 12916, 12665, 12406, 12140, 11866,
    11585, 11297, 11003, 10702, 10394, 10080, 9760, 9434, 9102, 8765, 8423, 8076, 7723, 7366, 7005,
    6639, 6270, 5897, 5520, 5139, 4756, 4370, 3981, 3590, 3196, 2801, 2404, 2006, 1606, 1205, 804,
    402, 0, -402, -804, -1205, -1606, -2006, -2404, -2801, -3196, -3590, -3981, -4370, -4756,
    -5139, -5520, -5897, -6270, -6639, -7005, -7366, -7723, -8076, -8423, -8765, -9102, -9434,
    -9760, -10080, -10394, -10702, -11003, -11297, -11585, -11866, -12140, -12406, -12665, -12916,
    -13160, -13395, -13623, -13842, -14053, -14256, -14449, -14635, -14811, -14978, -15137, -15286,
    -15426, -15557, -15679, -15791, -15893, -15986, -16069, -16143, -16207, -16261, -16305, -16340,
    -16364, -16379, -16384, -16379, -16364, -16340, -16305, -16261, -16207, -16143, -16069, -15986,
    -15893, -15791, -15679, -15557, -15426, -15286, -15137, -14978, -14811, -14635, -14449, -14256,
    -14053, -13842, -13623, -13395, -13160, -12916, -12665, -12406, -12140, -11866, -11585, -11297,
    -11003, -10702, -10394, -10080, -9760, -9434, -9102, -8765, -8423, -8076, -7723, -7366, -7005,
    -6639, -6270, -5897, -5520, -5139, -4756, -4370, -3981, -3590, -3196, -2801, -2404, -2006,
    -1606, -1205, -804, -402,
];

fn sin(theta: usize) -> i32 {
    SINE[theta & 0xFF]
}

fn cos(theta: usize) -> i32 {
    SINE[(theta + 64) & 0xFF]
}

/// A 16 KB image carrying just the vectors the hardware needs.
pub fn synthesize() -> Vec<u8> {
    let mut bios = vec![0u8; BIOS_SIZE];
    let mut put = |addr: usize, word: u32| {
        bios[addr..addr + 4].copy_from_slice(&word.to_le_bytes());
    };

    // Reset: jump straight to the cartridge entry point.
    put(0x00, 0xE3A0_F302); // mov pc, #0x08000000
                            // SWI: unreachable while HLE is on; return harmlessly if it is not.
    put(0x08, 0xE1B0_F00E); // movs pc, lr
                            // IRQ: branch to the handler below.
    put(0x18, 0xEA00_0042); // b 0x128

    // The stock BIOS interrupt handler, verbatim in behaviour: save the
    // scratch registers, call through the pointer the game installed at
    // 0x0300_7FFC, then restore and return to the interrupted instruction.
    put(0x128, 0xE92D_500F); // stmfd sp!, {r0-r3, r12, lr}
    put(0x12C, 0xE3A0_0301); // mov r0, #0x04000000
    put(0x130, 0xE28F_E000); // add lr, pc, #0
    put(0x134, 0xE510_F004); // ldr pc, [r0, #-4]
    put(0x138, 0xE8BD_500F); // ldmfd sp!, {r0-r3, r12, lr}
    put(0x13C, 0xE25E_F004); // subs pc, lr, #4
    bios
}

/// Execute a SWI in place of the BIOS. Returns with the CPU still in the
/// caller's mode -- no exception is taken.
pub fn dispatch(cpu: &mut Cpu, bus: &mut impl Bus, comment: u32) {
    match comment {
        0x00 => soft_reset(cpu),
        0x01 => register_ram_reset(cpu, bus),
        0x02 | 0x03 => cpu.halted = true,
        0x04 => intr_wait(cpu, bus),
        0x05 => {
            cpu.r[0] = 1;
            cpu.r[1] = 1;
            intr_wait(cpu, bus);
        }
        0x06 => divide(cpu, cpu.r[0] as i32, cpu.r[1] as i32),
        0x07 => divide(cpu, cpu.r[1] as i32, cpu.r[0] as i32),
        0x08 => cpu.r[0] = integer_sqrt(cpu.r[0]),
        0x09 => cpu.r[0] = arctan(cpu.r[0] as i16 as i32) as u32 & 0xFFFF,
        0x0A => cpu.r[0] = arctan2(cpu.r[0] as i16 as i32, cpu.r[1] as i16 as i32),
        0x0B => cpu_set(cpu, bus),
        0x0C => cpu_fast_set(cpu, bus),
        // The AGB BIOS checksum, which a few games read to identify the model.
        0x0D => cpu.r[0] = 0xBAAE_187F,
        0x0E => bg_affine_set(cpu, bus),
        0x0F => obj_affine_set(cpu, bus),
        0x10 => bit_unpack(cpu, bus),
        0x11 => lz77(cpu, bus, false),
        0x12 => lz77(cpu, bus, true),
        0x13 => huffman(cpu, bus),
        0x14 => run_length(cpu, bus, false),
        0x15 => run_length(cpu, bus, true),
        0x16 => diff_unfilter(cpu, bus, 8, false),
        0x17 => diff_unfilter(cpu, bus, 8, true),
        0x18 => diff_unfilter(cpu, bus, 16, true),
        // MultiBoot: report failure rather than pretending a client attached.
        0x25 => cpu.r[0] = 1,
        // Sound and serial calls, which this build has no use for. Returning
        // quietly is better than trapping: the game does not check.
        _ => {}
    }
}

fn soft_reset(cpu: &mut Cpu) {
    cpu.set_mode(Mode::Svc);
    cpu.r[13] = 0x0300_7FE0;
    cpu.set_mode(Mode::Irq);
    cpu.r[13] = 0x0300_7FA0;
    cpu.set_mode(Mode::Sys);
    cpu.r[13] = 0x0300_7F00;
    cpu.cpsr.set_thumb(false);
    cpu.set(15, 0x0800_0000);
}

fn register_ram_reset(cpu: &mut Cpu, bus: &mut impl Bus) {
    let flags = cpu.r[0];
    if flags & (1 << 0) != 0 {
        fill_words(bus, 0x0200_0000, 0x40000);
    }
    if flags & (1 << 1) != 0 {
        // Everything but the last 0x200 bytes, which hold the stacks and the
        // interrupt handler pointer this call must not destroy.
        fill_words(bus, 0x0300_0000, 0x7E00);
    }
    if flags & (1 << 2) != 0 {
        fill_words(bus, 0x0500_0000, 0x400);
    }
    if flags & (1 << 3) != 0 {
        fill_words(bus, 0x0600_0000, 0x18000);
    }
    if flags & (1 << 4) != 0 {
        fill_words(bus, 0x0700_0000, 0x400);
    }
}

fn fill_words(bus: &mut impl Bus, start: u32, len: u32) {
    let mut addr = start;
    while addr < start + len {
        bus.write32(addr, 0);
        addr += 4;
    }
}

/// IntrWait and VBlankIntrWait.
///
/// The BIOS parks the CPU until one of the requested interrupts has been
/// acknowledged, tracked through a flag word the game's own handler updates.
/// Rather than running a nested wait loop, this halts and rewinds PC to the
/// SWI, so the wait resumes naturally when the interrupt returns.
fn intr_wait(cpu: &mut Cpu, bus: &mut impl Bus) {
    let requested = cpu.r[1] as u16;

    if cpu.r[0] != 0 {
        // Discard interrupts that arrived before the wait began, once.
        let flags = bus.read16(IRQ_CHECK_FLAG) & !requested;
        bus.write16(IRQ_CHECK_FLAG, flags);
        cpu.r[0] = 0;
    }

    let pending = bus.read16(IRQ_CHECK_FLAG) & requested;
    if pending != 0 {
        let flags = bus.read16(IRQ_CHECK_FLAG) & !pending;
        bus.write16(IRQ_CHECK_FLAG, flags);
        return;
    }

    // Not yet: enable interrupts, halt, and arrange to re-run this SWI.
    bus.write16(0x0400_0208, 1);
    cpu.cpsr.set_irq_disabled(false);
    cpu.halted = true;
    let swi = if cpu.cpsr.thumb() {
        cpu.r[15].wrapping_sub(4)
    } else {
        cpu.r[15].wrapping_sub(8)
    };
    cpu.set(15, swi);
}

fn divide(cpu: &mut Cpu, numerator: i32, denominator: i32) {
    if denominator == 0 {
        // The hardware's behaviour here is undefined; returning the operands
        // unchanged at least keeps the core deterministic.
        return;
    }
    let quotient = numerator.wrapping_div(denominator);
    let remainder = numerator.wrapping_rem(denominator);
    cpu.r[0] = quotient as u32;
    cpu.r[1] = remainder as u32;
    cpu.r[3] = quotient.unsigned_abs();
}

fn integer_sqrt(value: u32) -> u32 {
    if value == 0 {
        return 0;
    }
    let mut root = value;
    let mut next = (root + value / root) / 2;
    while next < root {
        root = next;
        next = (root + value / root) / 2;
    }
    root
}

/// The BIOS arctangent: a fixed-point polynomial on a Q14 input.
fn arctan(x: i32) -> i32 {
    let a = -((x * x) >> 14);
    let mut b = ((0x0A9 * a) >> 14) + 0x390;
    b = ((b * a) >> 14) + 0x91C;
    b = ((b * a) >> 14) + 0xFB6;
    b = ((b * a) >> 14) + 0x16AA;
    b = ((b * a) >> 14) + 0x2081;
    b = ((b * a) >> 14) + 0x3651;
    b = ((b * a) >> 14) + 0xA2F9;
    (x * b) >> 16
}

fn arctan2(x: i32, y: i32) -> u32 {
    let result = if y == 0 {
        if x < 0 {
            0x8000
        } else {
            0
        }
    } else if x == 0 {
        if y < 0 {
            0xC000
        } else {
            0x4000
        }
    } else if y >= 0 && x >= 0 {
        if x >= y {
            arctan((y << 14) / x)
        } else {
            0x4000 - arctan((x << 14) / y)
        }
    } else if y >= 0 {
        if -x >= y {
            arctan((y << 14) / x) + 0x8000
        } else {
            0x4000 - arctan((x << 14) / y)
        }
    } else if x <= 0 {
        if -x > -y {
            arctan((y << 14) / x) + 0x8000
        } else {
            0xC000 - arctan((x << 14) / y)
        }
    } else if x >= -y {
        arctan((y << 14) / x) + 0x1_0000
    } else {
        0xC000 - arctan((x << 14) / y)
    };
    result as u32 & 0xFFFF
}

fn cpu_set(cpu: &mut Cpu, bus: &mut impl Bus) {
    let (mut src, mut dst) = (cpu.r[0], cpu.r[1]);
    let control = cpu.r[2];
    let count = control & 0x1F_FFFF;
    let fill = control & (1 << 24) != 0;
    let wide = control & (1 << 26) != 0;

    if wide {
        src &= !3;
        dst &= !3;
        let source = bus.read32(src);
        for i in 0..count {
            let value = if fill {
                source
            } else {
                bus.read32(src + i * 4)
            };
            bus.write32(dst + i * 4, value);
        }
    } else {
        src &= !1;
        dst &= !1;
        let source = bus.read16(src);
        for i in 0..count {
            let value = if fill {
                source
            } else {
                bus.read16(src + i * 2)
            };
            bus.write16(dst + i * 2, value);
        }
    }
}

fn cpu_fast_set(cpu: &mut Cpu, bus: &mut impl Bus) {
    let src = cpu.r[0] & !3;
    let dst = cpu.r[1] & !3;
    let control = cpu.r[2];
    let fill = control & (1 << 24) != 0;
    // The fast variant moves eight words at a time and rounds the count up.
    let count = (control & 0x1F_FFFF).div_ceil(8) * 8;

    let source = bus.read32(src);
    for i in 0..count {
        let value = if fill {
            source
        } else {
            bus.read32(src + i * 4)
        };
        bus.write32(dst + i * 4, value);
    }
}

fn bg_affine_set(cpu: &mut Cpu, bus: &mut impl Bus) {
    let (mut src, mut dst) = (cpu.r[0], cpu.r[1]);
    for _ in 0..cpu.r[2] {
        let origin_x = bus.read32(src) as i32;
        let origin_y = bus.read32(src + 4) as i32;
        let display_x = bus.read16(src + 8) as i16 as i32;
        let display_y = bus.read16(src + 10) as i16 as i32;
        let scale_x = bus.read16(src + 12) as i16 as i32;
        let scale_y = bus.read16(src + 14) as i16 as i32;
        let theta = (bus.read16(src + 16) >> 8) as usize;

        let pa = (scale_x * cos(theta)) >> 14;
        let pb = -((scale_x * sin(theta)) >> 14);
        let pc = (scale_y * sin(theta)) >> 14;
        let pd = (scale_y * cos(theta)) >> 14;

        bus.write16(dst, pa as u16);
        bus.write16(dst + 2, pb as u16);
        bus.write16(dst + 4, pc as u16);
        bus.write16(dst + 6, pd as u16);
        bus.write32(dst + 8, (origin_x - pa * display_x - pb * display_y) as u32);
        bus.write32(
            dst + 12,
            (origin_y - pc * display_x - pd * display_y) as u32,
        );

        src += 20;
        dst += 16;
    }
}

fn obj_affine_set(cpu: &mut Cpu, bus: &mut impl Bus) {
    let (mut src, mut dst) = (cpu.r[0], cpu.r[1]);
    let stride = cpu.r[3];
    for _ in 0..cpu.r[2] {
        let scale_x = bus.read16(src) as i16 as i32;
        let scale_y = bus.read16(src + 2) as i16 as i32;
        let theta = (bus.read16(src + 4) >> 8) as usize;

        let pa = (scale_x * cos(theta)) >> 14;
        let pb = -((scale_x * sin(theta)) >> 14);
        let pc = (scale_y * sin(theta)) >> 14;
        let pd = (scale_y * cos(theta)) >> 14;

        bus.write16(dst, pa as u16);
        bus.write16(dst + stride, pb as u16);
        bus.write16(dst + stride * 2, pc as u16);
        bus.write16(dst + stride * 3, pd as u16);

        src += 8;
        dst += stride * 4;
    }
}

/// Read `len` bytes starting at `src`, for the decompressors.
fn read_bytes(bus: &mut impl Bus, src: u32, len: usize) -> Vec<u8> {
    (0..len).map(|i| bus.read8(src + i as u32)).collect()
}

/// Write a decompressed block out. The VRAM variants must use halfword
/// writes, because a byte write to video memory is widened by the hardware
/// and would corrupt the neighbouring pixel.
fn write_block(bus: &mut impl Bus, dst: u32, data: &[u8], halfwords: bool) {
    if halfwords {
        let mut i = 0;
        while i < data.len() {
            let low = data[i] as u16;
            let high = data.get(i + 1).copied().unwrap_or(0) as u16;
            bus.write16(dst + i as u32, low | (high << 8));
            i += 2;
        }
    } else {
        for (i, byte) in data.iter().enumerate() {
            bus.write8(dst + i as u32, *byte);
        }
    }
}

/// LZ77. Pokemon compresses nearly all of its graphics with this, so it runs
/// constantly and a bug here is visible immediately.
fn lz77(cpu: &mut Cpu, bus: &mut impl Bus, vram: bool) {
    let src = cpu.r[0];
    let dst = cpu.r[1];
    let header = bus.read32(src);
    let size = (header >> 8) as usize;
    let mut out: Vec<u8> = Vec::with_capacity(size);
    let mut at = src + 4;

    while out.len() < size {
        let flags = bus.read8(at);
        at += 1;
        for bit in 0..8 {
            if out.len() >= size {
                break;
            }
            if flags & (0x80 >> bit) != 0 {
                let first = bus.read8(at) as usize;
                let second = bus.read8(at + 1) as usize;
                at += 2;
                let length = (first >> 4) + 3;
                let distance = ((first & 0xF) << 8 | second) + 1;
                if distance > out.len() {
                    // Malformed stream; stop rather than read out of bounds.
                    return;
                }
                for _ in 0..length {
                    if out.len() >= size {
                        break;
                    }
                    let byte = out[out.len() - distance];
                    out.push(byte);
                }
            } else {
                out.push(bus.read8(at));
                at += 1;
            }
        }
    }
    write_block(bus, dst, &out, vram);
}

fn run_length(cpu: &mut Cpu, bus: &mut impl Bus, vram: bool) {
    let src = cpu.r[0];
    let dst = cpu.r[1];
    let size = (bus.read32(src) >> 8) as usize;
    let mut out: Vec<u8> = Vec::with_capacity(size);
    let mut at = src + 4;

    while out.len() < size {
        let flag = bus.read8(at);
        at += 1;
        if flag & 0x80 != 0 {
            let length = (flag & 0x7F) as usize + 3;
            let byte = bus.read8(at);
            at += 1;
            for _ in 0..length {
                if out.len() >= size {
                    break;
                }
                out.push(byte);
            }
        } else {
            let length = (flag & 0x7F) as usize + 1;
            for _ in 0..length {
                if out.len() >= size {
                    break;
                }
                out.push(bus.read8(at));
                at += 1;
            }
        }
    }
    write_block(bus, dst, &out, vram);
}

/// Huffman. The tree is a compact array of nodes whose children are found by
/// an offset from the node's own (word-aligned) address.
fn huffman(cpu: &mut Cpu, bus: &mut impl Bus) {
    let src = cpu.r[0];
    let dst = cpu.r[1];
    let header = bus.read32(src);
    let symbol_bits = header & 0xF;
    let size = (header >> 8) as usize;
    if symbol_bits != 4 && symbol_bits != 8 {
        return;
    }

    let tree_size = bus.read8(src + 4) as u32;
    let tree = read_bytes(bus, src + 4, (tree_size as usize + 1) * 2);
    let root = 1usize;

    let mut out: Vec<u8> = Vec::with_capacity(size);
    let mut nibble: Option<u8> = None;
    let mut stream = src + 4 + (tree_size + 1) * 2;
    let mut node = root;
    let mut word = 0u32;
    let mut bits_left = 0u32;

    while out.len() < size {
        if bits_left == 0 {
            word = bus.read32(stream);
            stream += 4;
            bits_left = 32;
        }
        let bit = (word >> 31) & 1;
        word <<= 1;
        bits_left -= 1;

        let Some(&value) = tree.get(node) else { return };
        let child = (node & !1) + (value as usize & 0x3F) * 2 + 2 + bit as usize;
        let is_leaf = if bit == 1 {
            value & 0x40 != 0
        } else {
            value & 0x80 != 0
        };

        if is_leaf {
            let Some(&symbol) = tree.get(child) else {
                return;
            };
            if symbol_bits == 8 {
                out.push(symbol);
            } else {
                // Two symbols share a byte, low nibble first.
                match nibble.take() {
                    None => nibble = Some(symbol & 0xF),
                    Some(low) => out.push(low | (symbol << 4)),
                }
            }
            node = root;
        } else {
            node = child;
        }
    }
    write_block(bus, dst, &out, true);
}

/// Undo a delta filter: each entry in the stream is a difference from the one
/// before it.
fn diff_unfilter(cpu: &mut Cpu, bus: &mut impl Bus, width: u32, vram: bool) {
    let src = cpu.r[0];
    let dst = cpu.r[1];
    let size = (bus.read32(src) >> 8) as usize;
    let mut out: Vec<u8> = Vec::with_capacity(size);
    let mut at = src + 4;

    if width == 8 {
        let mut value = 0u8;
        while out.len() < size {
            value = value.wrapping_add(bus.read8(at));
            at += 1;
            out.push(value);
        }
    } else {
        let mut value = 0u16;
        while out.len() < size {
            value = value.wrapping_add(bus.read16(at));
            at += 2;
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
    write_block(bus, dst, &out, vram);
}

/// Widen a packed bit stream: 1, 2, 4 or 8 bit source units become 1 to 32
/// bit destination units, with an optional constant added to each.
fn bit_unpack(cpu: &mut Cpu, bus: &mut impl Bus) {
    let src = cpu.r[0];
    let dst = cpu.r[1];
    let info = cpu.r[2];

    let source_len = bus.read16(info) as u32;
    let source_width = bus.read8(info + 2) as u32;
    let dest_width = bus.read8(info + 3) as u32;
    let raw_offset = bus.read32(info + 4);
    let offset = raw_offset & 0x7FFF_FFFF;
    let offset_zero = raw_offset & 0x8000_0000 != 0;
    if source_width == 0 || dest_width == 0 || dest_width > 32 {
        return;
    }

    let mut out = 0u32;
    let mut used = 0u32;
    let mut at = dst;
    let mask = if source_width >= 32 {
        u32::MAX
    } else {
        (1 << source_width) - 1
    };

    for i in 0..source_len {
        let byte = bus.read8(src + i) as u32;
        let mut shift = 0;
        while shift < 8 {
            let unit = (byte >> shift) & mask;
            let value = if unit != 0 || offset_zero {
                unit + offset
            } else {
                unit
            };
            out |= value << used;
            used += dest_width;
            if used >= 32 {
                bus.write32(at, out);
                at += 4;
                out = 0;
                used = 0;
            }
            shift += source_width;
        }
    }
    if used > 0 {
        bus.write32(at, out);
    }
}
