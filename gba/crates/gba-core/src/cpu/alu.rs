//! Barrel shifter and the ALU primitives shared by ARM and Thumb.
//!
//! The shifter is the single most error-prone corner of ARM7TDMI: the
//! "shift by 0" encodings mean different things for immediate and register
//! shift amounts, and each shift type disagrees about the carry it produces.
//! Both paths are spelled out here rather than folded together.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ShiftType {
    Lsl = 0,
    Lsr = 1,
    Asr = 2,
    Ror = 3,
}

impl ShiftType {
    #[inline(always)]
    pub fn from_bits(bits: u32) -> ShiftType {
        match bits & 3 {
            0 => ShiftType::Lsl,
            1 => ShiftType::Lsr,
            2 => ShiftType::Asr,
            _ => ShiftType::Ror,
        }
    }
}

/// Shift with an *immediate* amount taken from the instruction word.
/// Here a zero amount is a distinct encoding: LSR/ASR #0 mean 32, and
/// ROR #0 means RRX (rotate right through carry by one).
#[inline]
pub fn shift_immediate(ty: ShiftType, value: u32, amount: u32, carry_in: bool) -> (u32, bool) {
    match ty {
        ShiftType::Lsl => {
            if amount == 0 {
                (value, carry_in)
            } else {
                (value << amount, value & (1 << (32 - amount)) != 0)
            }
        }
        ShiftType::Lsr => {
            if amount == 0 {
                // LSR #0 encodes LSR #32.
                (0, value & 0x8000_0000 != 0)
            } else {
                (value >> amount, value & (1 << (amount - 1)) != 0)
            }
        }
        ShiftType::Asr => {
            if amount == 0 {
                // ASR #0 encodes ASR #32: every bit becomes the sign bit.
                let sign = value & 0x8000_0000 != 0;
                (if sign { 0xFFFF_FFFF } else { 0 }, sign)
            } else {
                (
                    (value as i32 >> amount) as u32,
                    value & (1 << (amount - 1)) != 0,
                )
            }
        }
        ShiftType::Ror => {
            if amount == 0 {
                // ROR #0 encodes RRX.
                let out = (value >> 1) | ((carry_in as u32) << 31);
                (out, value & 1 != 0)
            } else {
                (value.rotate_right(amount), value & (1 << (amount - 1)) != 0)
            }
        }
    }
}

/// Shift with an amount taken from the bottom byte of a register.
/// A zero amount here is genuinely zero: the value and the carry both pass
/// through untouched. Amounts of 32 and above are defined but saturating.
#[inline]
pub fn shift_register(ty: ShiftType, value: u32, amount: u32, carry_in: bool) -> (u32, bool) {
    if amount == 0 {
        return (value, carry_in);
    }
    match ty {
        ShiftType::Lsl => match amount {
            1..=31 => (value << amount, value & (1 << (32 - amount)) != 0),
            32 => (0, value & 1 != 0),
            _ => (0, false),
        },
        ShiftType::Lsr => match amount {
            1..=31 => (value >> amount, value & (1 << (amount - 1)) != 0),
            32 => (0, value & 0x8000_0000 != 0),
            _ => (0, false),
        },
        ShiftType::Asr => {
            if amount >= 32 {
                let sign = value & 0x8000_0000 != 0;
                (if sign { 0xFFFF_FFFF } else { 0 }, sign)
            } else {
                (
                    (value as i32 >> amount) as u32,
                    value & (1 << (amount - 1)) != 0,
                )
            }
        }
        ShiftType::Ror => {
            let a = amount & 31;
            if a == 0 {
                // A multiple of 32: value is unchanged, carry comes from bit 31.
                (value, value & 0x8000_0000 != 0)
            } else {
                (value.rotate_right(a), value & (1 << (a - 1)) != 0)
            }
        }
    }
}

/// The 12-bit rotated immediate operand of a data-processing instruction.
/// Rotate amount 0 leaves the carry alone; anything else sets it from bit 31
/// of the result, exactly like ROR.
#[inline]
pub fn rotated_immediate(op: u32, carry_in: bool) -> (u32, bool) {
    let imm = op & 0xFF;
    let rot = ((op >> 8) & 0xF) * 2;
    if rot == 0 {
        (imm, carry_in)
    } else {
        let out = imm.rotate_right(rot);
        (out, out & 0x8000_0000 != 0)
    }
}

/// Add with carry-in, returning (result, carry_out, overflow).
/// Subtraction is expressed through this as `add_with_carry(a, !b, carry)`,
/// which is what the hardware actually does and removes a whole class of
/// borrow-polarity mistakes.
#[inline(always)]
pub fn add_with_carry(a: u32, b: u32, carry_in: bool) -> (u32, bool, bool) {
    let wide = a as u64 + b as u64 + carry_in as u64;
    let result = wide as u32;
    let carry = wide > 0xFFFF_FFFF;
    let overflow = (!(a ^ b) & (a ^ result)) & 0x8000_0000 != 0;
    (result, carry, overflow)
}
