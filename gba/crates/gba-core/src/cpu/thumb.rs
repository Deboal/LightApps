//! Thumb (16-bit) instruction execution.
//!
//! Pokemon runs almost entirely in Thumb, so this half of the CPU carries
//! more weight than the ARM half despite being the simpler encoding.

use super::alu::{add_with_carry, shift_immediate, shift_register, ShiftType};
use super::Cpu;
use crate::bus::Bus;

#[inline(always)]
fn sign_extend(value: u32, bits: u32) -> u32 {
    let shift = 32 - bits;
    ((value << shift) as i32 >> shift) as u32
}

pub fn execute(cpu: &mut Cpu, bus: &mut impl Bus, raw: u16) {
    let op = raw as u32;
    match op >> 12 {
        0b0000 | 0b0001 => {
            if op & 0x1800 == 0x1800 {
                add_subtract(cpu, op)
            } else {
                move_shifted(cpu, bus, op)
            }
        }
        0b0010 | 0b0011 => immediate_op(cpu, op),
        0b0100 => match (op >> 10) & 3 {
            0 => alu_op(cpu, bus, op),
            1 => hi_register_op(cpu, op),
            _ => pc_relative_load(cpu, bus, op),
        },
        0b0101 => {
            if op & 0x200 != 0 {
                load_store_sign_extended(cpu, bus, op)
            } else {
                load_store_register(cpu, bus, op)
            }
        }
        0b0110 | 0b0111 => load_store_immediate(cpu, bus, op),
        0b1000 => load_store_halfword(cpu, bus, op),
        0b1001 => sp_relative_load_store(cpu, bus, op),
        0b1010 => load_address(cpu, op),
        0b1011 => {
            if op & 0x0F00 == 0x0000 {
                add_offset_to_sp(cpu, op)
            } else if op & 0x0600 == 0x0400 {
                push_pop(cpu, bus, op)
            } else {
                cpu.undefined_instruction()
            }
        }
        0b1100 => block_transfer(cpu, bus, op),
        0b1101 => match (op >> 8) & 0xF {
            0xF => cpu.software_interrupt(),
            0xE => cpu.undefined_instruction(),
            cond => conditional_branch(cpu, cond, op),
        },
        0b1110 => unconditional_branch(cpu, op),
        _ => long_branch_link(cpu, op),
    }
}

/// Format 1: LSL/LSR/ASR by an immediate.
fn move_shifted(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let ty = ShiftType::from_bits(op >> 11);
    let amount = (op >> 6) & 0x1F;
    let rs = ((op >> 3) & 7) as usize;
    let rd = (op & 7) as usize;
    let (result, carry) = shift_immediate(ty, cpu.get(rs), amount, cpu.cpsr.c());
    let _ = bus;
    cpu.set(rd, result);
    cpu.cpsr.set_nz(result);
    cpu.cpsr.set_c(carry);
}

/// Format 2: ADD/SUB with a register or a 3-bit immediate.
fn add_subtract(cpu: &mut Cpu, op: u32) {
    let operand = if op & (1 << 10) != 0 {
        (op >> 6) & 7
    } else {
        cpu.get(((op >> 6) & 7) as usize)
    };
    let rs = ((op >> 3) & 7) as usize;
    let rd = (op & 7) as usize;
    let a = cpu.get(rs);
    let (result, carry, overflow) = if op & (1 << 9) != 0 {
        add_with_carry(a, !operand, true)
    } else {
        add_with_carry(a, operand, false)
    };
    cpu.set(rd, result);
    cpu.cpsr.set_nz(result);
    cpu.cpsr.set_c(carry);
    cpu.cpsr.set_v(overflow);
}

/// Format 3: MOV/CMP/ADD/SUB against an 8-bit immediate.
fn immediate_op(cpu: &mut Cpu, op: u32) {
    let rd = ((op >> 8) & 7) as usize;
    let imm = op & 0xFF;
    let a = cpu.get(rd);
    match (op >> 11) & 3 {
        0 => {
            cpu.set(rd, imm);
            cpu.cpsr.set_nz(imm);
        }
        1 => {
            let (result, carry, overflow) = add_with_carry(a, !imm, true);
            cpu.cpsr.set_nz(result);
            cpu.cpsr.set_c(carry);
            cpu.cpsr.set_v(overflow);
        }
        2 => {
            let (result, carry, overflow) = add_with_carry(a, imm, false);
            cpu.set(rd, result);
            cpu.cpsr.set_nz(result);
            cpu.cpsr.set_c(carry);
            cpu.cpsr.set_v(overflow);
        }
        _ => {
            let (result, carry, overflow) = add_with_carry(a, !imm, true);
            cpu.set(rd, result);
            cpu.cpsr.set_nz(result);
            cpu.cpsr.set_c(carry);
            cpu.cpsr.set_v(overflow);
        }
    }
}

/// Format 4: the 16 register-to-register ALU operations.
fn alu_op(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let rs = ((op >> 3) & 7) as usize;
    let rd = (op & 7) as usize;
    let a = cpu.get(rd);
    let b = cpu.get(rs);
    let carry_in = cpu.cpsr.c();

    let mut write = true;
    let mut set_cv = None;
    let result = match (op >> 6) & 0xF {
        0x0 => a & b,
        0x1 => a ^ b,
        0x2 => {
            bus.tick(1);
            let (v, c) = shift_register(ShiftType::Lsl, a, b & 0xFF, carry_in);
            cpu.cpsr.set_c(c);
            v
        }
        0x3 => {
            bus.tick(1);
            let (v, c) = shift_register(ShiftType::Lsr, a, b & 0xFF, carry_in);
            cpu.cpsr.set_c(c);
            v
        }
        0x4 => {
            bus.tick(1);
            let (v, c) = shift_register(ShiftType::Asr, a, b & 0xFF, carry_in);
            cpu.cpsr.set_c(c);
            v
        }
        0x5 => {
            let (v, c, o) = add_with_carry(a, b, carry_in);
            set_cv = Some((c, o));
            v
        }
        0x6 => {
            let (v, c, o) = add_with_carry(a, !b, carry_in);
            set_cv = Some((c, o));
            v
        }
        0x7 => {
            bus.tick(1);
            let (v, c) = shift_register(ShiftType::Ror, a, b & 0xFF, carry_in);
            cpu.cpsr.set_c(c);
            v
        }
        0x8 => {
            write = false;
            a & b
        }
        0x9 => {
            let (v, c, o) = add_with_carry(0, !b, true);
            set_cv = Some((c, o));
            v
        }
        0xA => {
            write = false;
            let (v, c, o) = add_with_carry(a, !b, true);
            set_cv = Some((c, o));
            v
        }
        0xB => {
            write = false;
            let (v, c, o) = add_with_carry(a, b, false);
            set_cv = Some((c, o));
            v
        }
        0xC => a | b,
        0xD => {
            bus.tick(super::arm::multiply_cycles(b, false));
            a.wrapping_mul(b)
        }
        0xE => a & !b,
        _ => !b,
    };

    if let Some((c, v)) = set_cv {
        cpu.cpsr.set_c(c);
        cpu.cpsr.set_v(v);
    }
    cpu.cpsr.set_nz(result);
    if write {
        cpu.set(rd, result);
    }
}

/// Format 5: ADD/CMP/MOV across the high registers, plus BX.
fn hi_register_op(cpu: &mut Cpu, op: u32) {
    let rs = (((op >> 3) & 7) | ((op >> 3) & 0x8)) as usize;
    let rd = ((op & 7) | ((op >> 4) & 0x8)) as usize;
    let b = cpu.get(rs);
    match (op >> 8) & 3 {
        0 => {
            let result = cpu.get(rd).wrapping_add(b);
            cpu.set(rd, if rd == 15 { result & !1 } else { result });
        }
        1 => {
            let (result, carry, overflow) = add_with_carry(cpu.get(rd), !b, true);
            cpu.cpsr.set_nz(result);
            cpu.cpsr.set_c(carry);
            cpu.cpsr.set_v(overflow);
        }
        2 => cpu.set(rd, if rd == 15 { b & !1 } else { b }),
        _ => {
            cpu.cpsr.set_thumb(b & 1 != 0);
            cpu.set(15, b);
        }
    }
}

/// Format 6: LDR Rd, [PC, #imm]. PC is word-aligned for the base.
fn pc_relative_load(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let rd = ((op >> 8) & 7) as usize;
    let addr = (cpu.r[15] & !2).wrapping_add((op & 0xFF) * 4);
    let value = bus.read32(addr);
    bus.tick(1);
    cpu.set(rd, value);
}

/// Format 7: LDR/STR/LDRB/STRB with a register offset.
fn load_store_register(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let ro = ((op >> 6) & 7) as usize;
    let rb = ((op >> 3) & 7) as usize;
    let rd = (op & 7) as usize;
    let addr = cpu.get(rb).wrapping_add(cpu.get(ro));
    let load = op & (1 << 11) != 0;
    let byte = op & (1 << 10) != 0;
    transfer(cpu, bus, load, byte, rd, addr);
}

/// Format 8: STRH/LDRH/LDRSB/LDRSH with a register offset.
fn load_store_sign_extended(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let ro = ((op >> 6) & 7) as usize;
    let rb = ((op >> 3) & 7) as usize;
    let rd = (op & 7) as usize;
    let addr = cpu.get(rb).wrapping_add(cpu.get(ro));
    match (op >> 10) & 3 {
        0 => bus.write16(addr, cpu.get(rd) as u16),
        1 => {
            let value = bus.read8(addr) as i8 as i32 as u32;
            bus.tick(1);
            cpu.set(rd, value);
        }
        2 => {
            let value = (bus.read16(addr) as u32).rotate_right(8 * (addr & 1));
            bus.tick(1);
            cpu.set(rd, value);
        }
        _ => {
            // LDRSH from an odd address behaves as LDRSB, as it does in ARM.
            let value = if addr & 1 != 0 {
                bus.read8(addr) as i8 as i32 as u32
            } else {
                bus.read16(addr) as i16 as i32 as u32
            };
            bus.tick(1);
            cpu.set(rd, value);
        }
    }
}

/// Format 9: LDR/STR/LDRB/STRB with a 5-bit immediate offset.
fn load_store_immediate(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let byte = op & (1 << 12) != 0;
    let load = op & (1 << 11) != 0;
    let offset = (op >> 6) & 0x1F;
    let rb = ((op >> 3) & 7) as usize;
    let rd = (op & 7) as usize;
    let scaled = if byte { offset } else { offset * 4 };
    let addr = cpu.get(rb).wrapping_add(scaled);
    transfer(cpu, bus, load, byte, rd, addr);
}

fn transfer(cpu: &mut Cpu, bus: &mut impl Bus, load: bool, byte: bool, rd: usize, addr: u32) {
    match (load, byte) {
        (true, true) => {
            let value = bus.read8(addr) as u32;
            bus.tick(1);
            cpu.set(rd, value);
        }
        (true, false) => {
            let value = bus.read32(addr).rotate_right(8 * (addr & 3));
            bus.tick(1);
            cpu.set(rd, value);
        }
        (false, true) => bus.write8(addr, cpu.get(rd) as u8),
        (false, false) => bus.write32(addr, cpu.get(rd)),
    }
}

/// Format 10: LDRH/STRH with a 5-bit immediate offset.
fn load_store_halfword(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let offset = ((op >> 6) & 0x1F) * 2;
    let rb = ((op >> 3) & 7) as usize;
    let rd = (op & 7) as usize;
    let addr = cpu.get(rb).wrapping_add(offset);
    if op & (1 << 11) != 0 {
        let value = (bus.read16(addr) as u32).rotate_right(8 * (addr & 1));
        bus.tick(1);
        cpu.set(rd, value);
    } else {
        bus.write16(addr, cpu.get(rd) as u16);
    }
}

/// Format 11: LDR/STR relative to SP.
fn sp_relative_load_store(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let rd = ((op >> 8) & 7) as usize;
    let addr = cpu.get(13).wrapping_add((op & 0xFF) * 4);
    if op & (1 << 11) != 0 {
        let value = bus.read32(addr).rotate_right(8 * (addr & 3));
        bus.tick(1);
        cpu.set(rd, value);
    } else {
        bus.write32(addr, cpu.get(rd));
    }
}

/// Format 12: ADD Rd, PC/SP, #imm.
fn load_address(cpu: &mut Cpu, op: u32) {
    let rd = ((op >> 8) & 7) as usize;
    let imm = (op & 0xFF) * 4;
    let base = if op & (1 << 11) != 0 {
        cpu.get(13)
    } else {
        cpu.r[15] & !2
    };
    cpu.set(rd, base.wrapping_add(imm));
}

/// Format 13: ADD SP, #+/-imm.
fn add_offset_to_sp(cpu: &mut Cpu, op: u32) {
    let imm = (op & 0x7F) * 4;
    let sp = cpu.get(13);
    cpu.set(
        13,
        if op & (1 << 7) != 0 {
            sp.wrapping_sub(imm)
        } else {
            sp.wrapping_add(imm)
        },
    );
}

/// Format 14: PUSH/POP, optionally including LR/PC.
fn push_pop(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let load = op & (1 << 11) != 0;
    let extra = op & (1 << 8) != 0;
    let list = op & 0xFF;
    let count = list.count_ones() + extra as u32;

    if load {
        let mut addr = cpu.get(13);
        for n in 0..8 {
            if list & (1 << n) != 0 {
                let value = bus.read32(addr);
                cpu.set(n, value);
                addr = addr.wrapping_add(4);
            }
        }
        if extra {
            let value = bus.read32(addr);
            // ARMv4 has no interworking on a POP: the core stays in Thumb.
            cpu.set(15, value & !1);
            addr = addr.wrapping_add(4);
        }
        bus.tick(1);
        cpu.set(13, addr);
    } else {
        let base = cpu.get(13).wrapping_sub(4 * count);
        let mut addr = base;
        for n in 0..8 {
            if list & (1 << n) != 0 {
                bus.write32(addr, cpu.get(n));
                addr = addr.wrapping_add(4);
            }
        }
        if extra {
            bus.write32(addr, cpu.get(14));
        }
        cpu.set(13, base);
    }
}

/// Format 15: LDMIA/STMIA Rb!, {Rlist}.
fn block_transfer(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let load = op & (1 << 11) != 0;
    let rb = ((op >> 8) & 7) as usize;
    let list = op & 0xFF;
    let base = cpu.get(rb);

    // An empty list transfers PC alone and still advances the base by 0x40,
    // matching the ARM-mode quirk.
    if list == 0 {
        if load {
            let value = bus.read32(base);
            cpu.set(15, value & !1);
        } else {
            bus.write32(base, cpu.r[15].wrapping_add(2));
        }
        cpu.set(rb, base.wrapping_add(0x40));
        return;
    }

    let mut addr = base;
    for n in 0..8 {
        if list & (1 << n) == 0 {
            continue;
        }
        if load {
            let value = bus.read32(addr);
            cpu.set(n, value);
        } else {
            // A base that is not first in the list observes the written-back
            // value, exactly as ARM-mode STM does.
            let value = if n == rb && list.trailing_zeros() as usize != rb {
                base.wrapping_add(4 * list.count_ones())
            } else {
                cpu.get(n)
            };
            bus.write32(addr, value);
        }
        addr = addr.wrapping_add(4);
    }

    if load {
        bus.tick(1);
        if list & (1 << rb) == 0 {
            cpu.set(rb, addr);
        }
    } else {
        cpu.set(rb, addr);
    }
}

/// Format 16: B<cond>.
fn conditional_branch(cpu: &mut Cpu, cond: u32, op: u32) {
    if !cpu.cond_passes(cond) {
        return;
    }
    let offset = sign_extend(op & 0xFF, 8) << 1;
    let target = cpu.r[15].wrapping_add(offset);
    cpu.set(15, target);
}

/// Format 18: unconditional B.
fn unconditional_branch(cpu: &mut Cpu, op: u32) {
    let offset = sign_extend(op & 0x7FF, 11) << 1;
    let target = cpu.r[15].wrapping_add(offset);
    cpu.set(15, target);
}

/// Format 19: the two halves of BL. The first half parks the high bits of the
/// offset in LR; the second half completes the branch.
fn long_branch_link(cpu: &mut Cpu, op: u32) {
    if op & (1 << 11) == 0 {
        let offset = sign_extend(op & 0x7FF, 11) << 12;
        let lr = cpu.r[15].wrapping_add(offset);
        cpu.set(14, lr);
    } else {
        let return_addr = cpu.r[15].wrapping_sub(2) | 1;
        let target = cpu.get(14).wrapping_add((op & 0x7FF) << 1);
        cpu.set(14, return_addr);
        cpu.set(15, target & !1);
    }
}
