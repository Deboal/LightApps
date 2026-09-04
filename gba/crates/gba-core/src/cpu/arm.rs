//! ARM (32-bit) instruction execution.
//!
//! Decoding is ordered most-specific-first, because several ARM encodings
//! alias one another: multiply, swap and the halfword transfers all live
//! inside what would otherwise be data-processing space and must be peeled
//! off before it.

use super::alu::{add_with_carry, rotated_immediate, shift_immediate, shift_register, ShiftType};
use super::{Cpu, Mode};
use crate::bus::Bus;

#[inline(always)]
fn sign_extend(value: u32, bits: u32) -> u32 {
    let shift = 32 - bits;
    ((value << shift) as i32 >> shift) as u32
}

pub fn execute(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let cond = op >> 28;
    if cond != 0xE && !cpu.cond_passes(cond) {
        return;
    }

    if op & 0x0FFF_FFF0 == 0x012F_FF10 {
        return branch_exchange(cpu, op);
    }
    if op & 0x0FC0_00F0 == 0x0000_0090 {
        return multiply(cpu, bus, op);
    }
    if op & 0x0F80_00F0 == 0x0080_0090 {
        return multiply_long(cpu, bus, op);
    }
    if op & 0x0FB0_0FF0 == 0x0100_0090 {
        return swap(cpu, bus, op);
    }
    if op & 0x0E00_0090 == 0x0000_0090 && op & 0x60 != 0 {
        return halfword_transfer(cpu, bus, op);
    }
    if op & 0x0FBF_0FFF == 0x010F_0000 {
        return mrs(cpu, op);
    }
    if op & 0x0FB0_FFF0 == 0x0120_F000 || op & 0x0FB0_F000 == 0x0320_F000 {
        return msr(cpu, op);
    }
    match (op >> 25) & 0x7 {
        0b000 | 0b001 => data_processing(cpu, bus, op),
        // Bit 4 set in a register-offset single transfer is an undefined
        // encoding, not an addressing mode.
        0b011 if op & 0x10 != 0 => cpu.undefined_instruction(),
        0b010 | 0b011 => single_transfer(cpu, bus, op),
        0b100 => block_transfer(cpu, bus, op),
        0b101 => branch(cpu, op),
        0b111 if op & 0x0F00_0000 == 0x0F00_0000 => cpu.software_interrupt(),
        // Coprocessor space: the GBA has no coprocessor.
        _ => cpu.undefined_instruction(),
    }
}

fn branch(cpu: &mut Cpu, op: u32) {
    let offset = sign_extend(op & 0x00FF_FFFF, 24) << 2;
    if op & (1 << 24) != 0 {
        let lr = cpu.r[15].wrapping_sub(4);
        cpu.set(14, lr);
    }
    let target = cpu.r[15].wrapping_add(offset);
    cpu.set(15, target);
}

fn branch_exchange(cpu: &mut Cpu, op: u32) {
    let target = cpu.get((op & 0xF) as usize);
    cpu.cpsr.set_thumb(target & 1 != 0);
    cpu.set(15, target);
}

fn data_processing(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let opcode = (op >> 21) & 0xF;
    let set_flags = op & (1 << 20) != 0;
    let rn = ((op >> 16) & 0xF) as usize;
    let rd = ((op >> 12) & 0xF) as usize;
    let carry_in = cpu.cpsr.c();

    // A register-specified shift costs an internal cycle, and that cycle is
    // why reads of PC see +12 instead of +8 for this one addressing mode.
    let shift_by_register = op & (1 << 25) == 0 && op & (1 << 4) != 0;
    let pc_bias = if shift_by_register { 4 } else { 0 };
    let read = |cpu: &Cpu, n: usize| {
        if n == 15 {
            cpu.r[15].wrapping_add(pc_bias)
        } else {
            cpu.r[n]
        }
    };

    let (operand2, shifter_carry) = if op & (1 << 25) != 0 {
        rotated_immediate(op, carry_in)
    } else {
        let ty = ShiftType::from_bits(op >> 5);
        let rm = read(cpu, (op & 0xF) as usize);
        if shift_by_register {
            bus.tick(1);
            let amount = read(cpu, ((op >> 8) & 0xF) as usize) & 0xFF;
            shift_register(ty, rm, amount, carry_in)
        } else {
            shift_immediate(ty, rm, (op >> 7) & 0x1F, carry_in)
        }
    };

    let a = read(cpu, rn);
    let b = operand2;
    let mut logical = true;
    let (result, carry, overflow) = match opcode {
        0x0 => (a & b, shifter_carry, false),
        0x1 => (a ^ b, shifter_carry, false),
        0x2 => {
            logical = false;
            add_with_carry(a, !b, true)
        }
        0x3 => {
            logical = false;
            add_with_carry(!a, b, true)
        }
        0x4 => {
            logical = false;
            add_with_carry(a, b, false)
        }
        0x5 => {
            logical = false;
            add_with_carry(a, b, carry_in)
        }
        0x6 => {
            logical = false;
            add_with_carry(a, !b, carry_in)
        }
        0x7 => {
            logical = false;
            add_with_carry(!a, b, carry_in)
        }
        0x8 => (a & b, shifter_carry, false),
        0x9 => (a ^ b, shifter_carry, false),
        0xA => {
            logical = false;
            add_with_carry(a, !b, true)
        }
        0xB => {
            logical = false;
            add_with_carry(a, b, false)
        }
        0xC => (a | b, shifter_carry, false),
        0xD => (b, shifter_carry, false),
        0xE => (a & !b, shifter_carry, false),
        _ => (!b, shifter_carry, false),
    };

    let writes_result = !(0x8..=0xB).contains(&opcode);

    if set_flags {
        // S with Rd = PC is the exception return: the flags come from SPSR
        // wholesale, not from the result.
        if writes_result && rd == 15 {
            cpu.restore_cpsr();
        } else {
            cpu.cpsr.set_nz(result);
            cpu.cpsr.set_c(carry);
            if !logical {
                cpu.cpsr.set_v(overflow);
            }
        }
    }
    if writes_result {
        cpu.set(rd, result);
    }
}

fn mrs(cpu: &mut Cpu, op: u32) {
    let rd = ((op >> 12) & 0xF) as usize;
    let value = if op & (1 << 22) != 0 {
        let mode = cpu.cpsr.mode();
        if mode.has_spsr() {
            cpu.spsr[mode.bank()].0
        } else {
            cpu.cpsr.0
        }
    } else {
        cpu.cpsr.0
    };
    cpu.set(rd, value);
}

fn msr(cpu: &mut Cpu, op: u32) {
    let value = if op & (1 << 25) != 0 {
        rotated_immediate(op, cpu.cpsr.c()).0
    } else {
        cpu.get((op & 0xF) as usize)
    };

    let mut mask = 0u32;
    if op & (1 << 16) != 0 {
        mask |= 0x0000_00FF;
    }
    if op & (1 << 17) != 0 {
        mask |= 0x0000_FF00;
    }
    if op & (1 << 18) != 0 {
        mask |= 0x00FF_0000;
    }
    if op & (1 << 19) != 0 {
        mask |= 0xFF00_0000;
    }

    if op & (1 << 22) != 0 {
        let mode = cpu.cpsr.mode();
        if mode.has_spsr() {
            let bank = mode.bank();
            cpu.spsr[bank].0 = (cpu.spsr[bank].0 & !mask) | (value & mask);
        }
        return;
    }

    // User mode may only touch the flag byte, and the T bit is never writable
    // through MSR in any mode -- changing it here would desynchronise the
    // instruction set from the pipeline.
    if cpu.cpsr.mode() == Mode::User {
        mask &= 0xFF00_0000;
    }
    let merged = (cpu.cpsr.0 & !mask) | (value & mask);
    if mask & 0xFF != 0 {
        cpu.set_mode(Mode::from_bits(merged));
    }
    let thumb = cpu.cpsr.thumb();
    cpu.cpsr.0 = (cpu.cpsr.0 & !mask) | (merged & mask);
    cpu.cpsr.set_thumb(thumb);
}

fn multiply(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let rd = ((op >> 16) & 0xF) as usize;
    let rn = ((op >> 12) & 0xF) as usize;
    let rs = ((op >> 8) & 0xF) as usize;
    let rm = (op & 0xF) as usize;

    let mut result = cpu.get(rm).wrapping_mul(cpu.get(rs));
    if op & (1 << 21) != 0 {
        result = result.wrapping_add(cpu.get(rn));
        bus.tick(1);
    }
    bus.tick(multiply_cycles(cpu.get(rs), false));
    cpu.set(rd, result);
    if op & (1 << 20) != 0 {
        // MUL leaves C unpredictable on ARM7TDMI; leaving it alone is the
        // behaviour the test ROMs and real games are built against.
        cpu.cpsr.set_nz(result);
    }
}

fn multiply_long(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let rd_hi = ((op >> 16) & 0xF) as usize;
    let rd_lo = ((op >> 12) & 0xF) as usize;
    let rs = ((op >> 8) & 0xF) as usize;
    let rm = (op & 0xF) as usize;
    let signed = op & (1 << 22) != 0;
    let accumulate = op & (1 << 21) != 0;

    let mut result: u64 = if signed {
        ((cpu.get(rm) as i32 as i64) * (cpu.get(rs) as i32 as i64)) as u64
    } else {
        (cpu.get(rm) as u64) * (cpu.get(rs) as u64)
    };
    if accumulate {
        let prior = ((cpu.get(rd_hi) as u64) << 32) | cpu.get(rd_lo) as u64;
        result = result.wrapping_add(prior);
        bus.tick(1);
    }
    bus.tick(1 + multiply_cycles(cpu.get(rs), signed));

    cpu.set(rd_lo, result as u32);
    cpu.set(rd_hi, (result >> 32) as u32);
    if op & (1 << 20) != 0 {
        cpu.cpsr.set_n(result & 0x8000_0000_0000_0000 != 0);
        cpu.cpsr.set_z(result == 0);
    }
}

/// The multiplier runs 1 to 4 internal cycles depending on how many leading
/// bytes of the multiplicand are all-zero (or all-one, when signed).
pub(super) fn multiply_cycles(operand: u32, signed: bool) -> u32 {
    let mut cycles = 1;
    for shift in [8, 16, 24] {
        let top = operand >> shift;
        let done = top == 0 || (signed && top == (0xFFFF_FFFFu32 >> shift));
        if done {
            break;
        }
        cycles += 1;
    }
    cycles
}

fn swap(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let rn = ((op >> 16) & 0xF) as usize;
    let rd = ((op >> 12) & 0xF) as usize;
    let rm = (op & 0xF) as usize;
    let addr = cpu.get(rn);
    let source = cpu.get(rm);
    if op & (1 << 22) != 0 {
        let loaded = bus.read8(addr);
        bus.write8(addr, source as u8);
        cpu.set(rd, loaded as u32);
    } else {
        let loaded = bus.read32(addr).rotate_right(8 * (addr & 3));
        bus.write32(addr, source);
        cpu.set(rd, loaded);
    }
    bus.tick(1);
}

fn halfword_transfer(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let pre = op & (1 << 24) != 0;
    let up = op & (1 << 23) != 0;
    let writeback = op & (1 << 21) != 0;
    let load = op & (1 << 20) != 0;
    let rn = ((op >> 16) & 0xF) as usize;
    let rd = ((op >> 12) & 0xF) as usize;

    let offset = if op & (1 << 22) != 0 {
        ((op >> 4) & 0xF0) | (op & 0xF)
    } else {
        cpu.get((op & 0xF) as usize)
    };

    let base = cpu.get(rn);
    let offset_addr = if up {
        base.wrapping_add(offset)
    } else {
        base.wrapping_sub(offset)
    };
    let addr = if pre { offset_addr } else { base };

    if load {
        let value = match (op >> 5) & 3 {
            // LDRH: an unaligned address reads the containing halfword and
            // rotates, the same way LDR does.
            1 => (bus.read16(addr) as u32).rotate_right(8 * (addr & 1)),
            2 => bus.read8(addr) as i8 as i32 as u32,
            // LDRSH from an odd address degrades to LDRSB on ARM7TDMI.
            _ => {
                if addr & 1 != 0 {
                    bus.read8(addr) as i8 as i32 as u32
                } else {
                    bus.read16(addr) as i16 as i32 as u32
                }
            }
        };
        bus.tick(1);
        // Writeback loses to the load when they name the same register.
        if writeback || !pre {
            cpu.set(rn, offset_addr);
        }
        cpu.set(rd, value);
    } else {
        let value = if rd == 15 {
            cpu.r[15].wrapping_add(4)
        } else {
            cpu.get(rd)
        };
        bus.write16(addr, value as u16);
        if writeback || !pre {
            cpu.set(rn, offset_addr);
        }
    }
}

fn single_transfer(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let pre = op & (1 << 24) != 0;
    let up = op & (1 << 23) != 0;
    let byte = op & (1 << 22) != 0;
    let writeback = op & (1 << 21) != 0;
    let load = op & (1 << 20) != 0;
    let rn = ((op >> 16) & 0xF) as usize;
    let rd = ((op >> 12) & 0xF) as usize;

    let offset = if op & (1 << 25) != 0 {
        // Register offset: an immediate shift only, never a register shift.
        let ty = ShiftType::from_bits(op >> 5);
        shift_immediate(
            ty,
            cpu.get((op & 0xF) as usize),
            (op >> 7) & 0x1F,
            cpu.cpsr.c(),
        )
        .0
    } else {
        op & 0xFFF
    };

    let base = cpu.get(rn);
    let offset_addr = if up {
        base.wrapping_add(offset)
    } else {
        base.wrapping_sub(offset)
    };
    let addr = if pre { offset_addr } else { base };

    if load {
        let value = if byte {
            bus.read8(addr) as u32
        } else {
            bus.read32(addr).rotate_right(8 * (addr & 3))
        };
        bus.tick(1);
        if writeback || !pre {
            cpu.set(rn, offset_addr);
        }
        cpu.set(rd, value);
    } else {
        // Storing PC stores the fetch address plus 12.
        let value = if rd == 15 {
            cpu.r[15].wrapping_add(4)
        } else {
            cpu.get(rd)
        };
        if byte {
            bus.write8(addr, value as u8);
        } else {
            bus.write32(addr, value);
        }
        if writeback || !pre {
            cpu.set(rn, offset_addr);
        }
    }
}

fn block_transfer(cpu: &mut Cpu, bus: &mut impl Bus, op: u32) {
    let pre = op & (1 << 24) != 0;
    let up = op & (1 << 23) != 0;
    let s_bit = op & (1 << 22) != 0;
    let writeback = op & (1 << 21) != 0;
    let load = op & (1 << 20) != 0;
    let rn = ((op >> 16) & 0xF) as usize;
    let list = op & 0xFFFF;

    let base = cpu.get(rn);
    let count = list.count_ones();

    // An empty register list transfers r15 alone and moves the base by 0x40.
    let (mut addr, final_base) = if list == 0 {
        if up {
            (
                base.wrapping_add(if pre { 4 } else { 0 }),
                base.wrapping_add(0x40),
            )
        } else {
            (
                base.wrapping_sub(0x40)
                    .wrapping_add(if pre { 0 } else { 4 }),
                base.wrapping_sub(0x40),
            )
        }
    } else if up {
        (
            base.wrapping_add(if pre { 4 } else { 0 }),
            base.wrapping_add(4 * count),
        )
    } else {
        let low = base.wrapping_sub(4 * count);
        (low.wrapping_add(if pre { 0 } else { 4 }), low)
    };

    let transfers_pc = list & (1 << 15) != 0 || list == 0;
    // S outside of "LDM with PC" means the User bank is the target, and
    // writeback in that form is not defined.
    let user_bank = s_bit && !(load && transfers_pc);

    if list == 0 {
        if load {
            let value = bus.read32(addr);
            cpu.set(15, value & !3);
        } else {
            bus.write32(addr, cpu.r[15].wrapping_add(4));
        }
        if writeback {
            cpu.set(rn, final_base);
        }
        return;
    }

    if !load && writeback {
        // STM writes back mid-sequence, so every register except a base that
        // is first in the list observes the *new* value.
        let lowest = list.trailing_zeros() as usize;
        if list & (1 << rn) != 0 && lowest != rn {
            cpu.r[rn] = final_base;
        }
    }

    for n in 0..16 {
        if list & (1 << n) == 0 {
            continue;
        }
        if load {
            let value = bus.read32(addr);
            if user_bank {
                cpu.set_user(n, value);
            } else if n == 15 {
                cpu.set(15, value & !3);
            } else {
                cpu.set(n, value);
            }
        } else {
            let value = if n == 15 {
                cpu.r[15].wrapping_add(4)
            } else if user_bank {
                cpu.get_user(n)
            } else {
                cpu.get(n)
            };
            bus.write32(addr, value);
        }
        addr = addr.wrapping_add(4);
    }

    if load {
        bus.tick(1);
        // Writeback is suppressed when the base was loaded from memory.
        if writeback && list & (1 << rn) == 0 {
            cpu.set(rn, final_base);
        }
        if s_bit && transfers_pc {
            cpu.restore_cpsr();
        }
    } else if writeback {
        cpu.set(rn, final_base);
    }
}
