//! Thumb-mode instruction tests.
//!
//! Pokemon spends nearly all of its time here, so this file carries more
//! weight than its ARM counterpart despite the simpler encoding.

mod common;
use common::*;

// -- Thumb encoding helpers ----------------------------------------------

fn shifted(op: u16, offset: u16, rs: u16, rd: u16) -> u16 {
    op << 11 | offset << 6 | rs << 3 | rd
}
fn add_sub(imm: bool, sub: bool, operand: u16, rs: u16, rd: u16) -> u16 {
    0b00011 << 11 | (imm as u16) << 10 | (sub as u16) << 9 | operand << 6 | rs << 3 | rd
}
fn imm_op(op: u16, rd: u16, imm: u16) -> u16 {
    0b001 << 13 | op << 11 | rd << 8 | imm
}
fn alu(op: u16, rs: u16, rd: u16) -> u16 {
    0b010000 << 10 | op << 6 | rs << 3 | rd
}
fn hi_op(op: u16, rs: u16, rd: u16) -> u16 {
    0b010001 << 10
        | op << 8
        | ((rd & 8) >> 3) << 7
        | ((rs & 8) >> 3) << 6
        | (rs & 7) << 3
        | (rd & 7)
}
fn ldr_pc(rd: u16, word: u16) -> u16 {
    0b01001 << 11 | rd << 8 | word
}
fn ldr_str_reg(load: bool, byte: bool, ro: u16, rb: u16, rd: u16) -> u16 {
    0b0101 << 12 | (load as u16) << 11 | (byte as u16) << 10 | ro << 6 | rb << 3 | rd
}
fn ldr_str_sx(h: bool, s: bool, ro: u16, rb: u16, rd: u16) -> u16 {
    0b0101 << 12 | (h as u16) << 11 | (s as u16) << 10 | 1 << 9 | ro << 6 | rb << 3 | rd
}
fn ldr_str_imm(byte: bool, load: bool, offset: u16, rb: u16, rd: u16) -> u16 {
    0b011 << 13 | (byte as u16) << 12 | (load as u16) << 11 | offset << 6 | rb << 3 | rd
}
fn ldrh_strh_imm(load: bool, offset: u16, rb: u16, rd: u16) -> u16 {
    0b1000 << 12 | (load as u16) << 11 | offset << 6 | rb << 3 | rd
}
fn sp_rel(load: bool, rd: u16, word: u16) -> u16 {
    0b1001 << 12 | (load as u16) << 11 | rd << 8 | word
}
fn load_addr(sp: bool, rd: u16, word: u16) -> u16 {
    0b1010 << 12 | (sp as u16) << 11 | rd << 8 | word
}
fn add_sp(sub: bool, word: u16) -> u16 {
    0b1011_0000 << 8 | (sub as u16) << 7 | word
}
fn push_pop(load: bool, extra: bool, list: u16) -> u16 {
    0b1011 << 12 | (load as u16) << 11 | 0b10 << 9 | (extra as u16) << 8 | list
}
fn block(load: bool, rb: u16, list: u16) -> u16 {
    0b1100 << 12 | (load as u16) << 11 | rb << 8 | list
}
fn b_cond(cond: u16, offset: i16) -> u16 {
    0b1101 << 12 | cond << 8 | (offset as u16 & 0xFF)
}
fn b(offset: i16) -> u16 {
    0b11100 << 11 | (offset as u16 & 0x7FF)
}
fn bl(high: u16, low: u16) -> [u16; 2] {
    [0b11110 << 11 | high, 0b11111 << 11 | low]
}

// -- tests ---------------------------------------------------------------

#[test]
fn shifts_set_carry_from_the_last_bit_out() {
    let lsl = exec_thumb(&[shifted(0, 1, 1, 0)], |e| e.cpu.r[1] = 0x8000_0000);
    assert_eq!(lsl.cpu.r[0], 0);
    assert_eq!(flags(&lsl), "-ZC-");

    let asr = exec_thumb(&[shifted(2, 0, 1, 0)], |e| e.cpu.r[1] = 0x8000_0001);
    assert_eq!(asr.cpu.r[0], 0xFFFF_FFFF);
    assert_eq!(flags(&asr), "N-C-");
}

#[test]
fn add_and_subtract_with_a_three_bit_immediate() {
    let add = exec_thumb(&[add_sub(true, false, 3, 1, 0)], |e| e.cpu.r[1] = 10);
    assert_eq!(add.cpu.r[0], 13);

    let sub = exec_thumb(&[add_sub(true, true, 3, 1, 0)], |e| e.cpu.r[1] = 10);
    assert_eq!(sub.cpu.r[0], 7);
    assert_eq!(flags(&sub), "--C-");
}

#[test]
fn immediate_operations_write_only_where_they_should() {
    let mov = exec_thumb(&[imm_op(0, 0, 0x42)], |_| {});
    assert_eq!(mov.cpu.r[0], 0x42);

    // CMP must not touch the destination.
    let cmp = exec_thumb(&[imm_op(1, 0, 0x42)], |e| e.cpu.r[0] = 0x42);
    assert_eq!(cmp.cpu.r[0], 0x42);
    assert_eq!(flags(&cmp), "-ZC-");

    let sub = exec_thumb(&[imm_op(3, 0, 1)], |e| e.cpu.r[0] = 0);
    assert_eq!(sub.cpu.r[0], 0xFFFF_FFFF);
    assert_eq!(flags(&sub), "N---");
}

#[test]
fn neg_is_a_reverse_subtract_from_zero() {
    let emu = exec_thumb(&[alu(0x9, 1, 0)], |e| e.cpu.r[1] = 5);
    assert_eq!(emu.cpu.r[0], 0xFFFF_FFFBu32);
    assert_eq!(flags(&emu), "N---");
}

#[test]
fn alu_shifts_take_their_amount_from_a_register() {
    let emu = exec_thumb(&[alu(0x3, 1, 0)], |e| {
        e.cpu.r[0] = 0x8000_0000;
        e.cpu.r[1] = 32;
    });
    assert_eq!(emu.cpu.r[0], 0);
    assert_eq!(flags(&emu), "-ZC-");
}

#[test]
fn alu_test_and_compare_do_not_write_back() {
    let tst = exec_thumb(&[alu(0x8, 1, 0)], |e| {
        e.cpu.r[0] = 0xF0;
        e.cpu.r[1] = 0x0F;
    });
    assert_eq!(tst.cpu.r[0], 0xF0);
    assert!(tst.cpu.cpsr.z());

    let cmn = exec_thumb(&[alu(0xB, 1, 0)], |e| {
        e.cpu.r[0] = 1;
        e.cpu.r[1] = 0xFFFF_FFFF;
    });
    assert_eq!(cmn.cpu.r[0], 1);
    assert_eq!(flags(&cmn), "-ZC-");
}

#[test]
fn multiply_in_thumb() {
    let emu = exec_thumb(&[alu(0xD, 1, 0)], |e| {
        e.cpu.r[0] = 7;
        e.cpu.r[1] = 6;
    });
    assert_eq!(emu.cpu.r[0], 42);
}

#[test]
fn high_register_operations_reach_r8_and_above() {
    let emu = exec_thumb(&[hi_op(2, 9, 0), hi_op(0, 0, 10)], |e| {
        e.cpu.r[9] = 0x1234;
        e.cpu.r[10] = 6;
    });
    assert_eq!(emu.cpu.r[0], 0x1234);
    assert_eq!(emu.cpu.r[10], 0x1234 + 6);
}

#[test]
fn bx_from_thumb_back_into_arm() {
    let emu = exec_thumb(&[hi_op(3, 0, 0)], |e| e.cpu.r[0] = ROM_BASE + 0x20);
    assert!(!emu.cpu.cpsr.thumb());
    assert_eq!(emu.cpu.r[15] & !3, ROM_BASE + 0x20);
}

#[test]
fn pc_relative_load_word_aligns_the_base() {
    // The literal pool is addressed from PC with bit 1 forced low, so the
    // same pool entry is reachable from either halfword slot.
    let mut from_even = thumb(&[ldr_pc(0, 0), 0, 0xCDEF, 0xABCD]);
    run(&mut from_even, 1);
    assert_eq!(from_even.cpu.r[0], 0xABCD_CDEF);

    let mut from_odd = thumb(&[0x46C0, ldr_pc(0, 0), 0xCDEF, 0xABCD]);
    run(&mut from_odd, 2);
    assert_eq!(from_odd.cpu.r[0], 0xABCD_CDEF);
}

#[test]
fn register_offset_loads_and_stores() {
    let emu = exec_thumb(
        &[
            ldr_str_reg(false, false, 2, 1, 0),
            ldr_str_reg(true, true, 2, 1, 3),
        ],
        |e| {
            e.cpu.r[0] = 0x1122_3344;
            e.cpu.r[1] = IWRAM;
            e.cpu.r[2] = 0;
        },
    );
    assert_eq!(emu.cpu.r[3], 0x44);
}

#[test]
fn sign_extended_loads() {
    let emu = exec_thumb(
        &[
            ldr_str_reg(false, false, 2, 1, 0),
            ldr_str_sx(false, true, 2, 1, 3), // LDSB
            ldr_str_sx(true, false, 2, 1, 4), // LDRH
            ldr_str_sx(true, true, 2, 1, 5),  // LDSH
        ],
        |e| {
            e.cpu.r[0] = 0x0000_80FF;
            e.cpu.r[1] = IWRAM;
            e.cpu.r[2] = 0;
        },
    );
    assert_eq!(emu.cpu.r[3], 0xFFFF_FFFF);
    assert_eq!(emu.cpu.r[4], 0x0000_80FF);
    assert_eq!(emu.cpu.r[5], 0xFFFF_80FF);
}

#[test]
fn immediate_offsets_are_scaled_by_the_access_width() {
    let emu = exec_thumb(
        &[
            ldr_str_imm(false, false, 1, 1, 0), // STR  [r1, #4]
            ldrh_strh_imm(false, 1, 1, 2),      // STRH [r1, #2]
            ldr_str_imm(false, true, 1, 1, 3),  // LDR  [r1, #4]
            ldrh_strh_imm(true, 1, 1, 4),       // LDRH [r1, #2]
        ],
        |e| {
            e.cpu.r[0] = 0xAABB_CCDD;
            e.cpu.r[1] = IWRAM;
            e.cpu.r[2] = 0x1234;
        },
    );
    assert_eq!(emu.cpu.r[3], 0xAABB_CCDD);
    assert_eq!(emu.cpu.r[4], 0x1234);
}

#[test]
fn stack_pointer_relative_access_and_address_forming() {
    let emu = exec_thumb(
        &[
            sp_rel(false, 0, 1),
            sp_rel(true, 1, 1),
            load_addr(true, 2, 2),
            add_sp(true, 4),
            load_addr(false, 3, 0),
        ],
        |e| e.cpu.r[0] = 0x5555_AAAA,
    );
    assert_eq!(emu.cpu.r[1], 0x5555_AAAA);
    assert_eq!(emu.cpu.r[2], 0x0300_7F00 + 8);
    assert_eq!(emu.cpu.r[13], 0x0300_7F00 - 16);
    // ADD Rd, PC, #0 at halfword 4 reads PC as instruction + 4, word aligned.
    assert_eq!(emu.cpu.r[3], ROM_BASE + 12);
}

#[test]
fn push_and_pop_round_trip_through_the_stack() {
    let emu = exec_thumb(
        &[
            push_pop(false, true, 0b0000_0011),
            imm_op(0, 0, 0),
            imm_op(0, 1, 0),
            push_pop(true, false, 0b0000_0011),
        ],
        |e| {
            e.cpu.r[0] = 0xAAAA;
            e.cpu.r[1] = 0xBBBB;
            e.cpu.r[14] = 0xCCCC;
        },
    );
    assert_eq!(emu.cpu.r[0], 0xAAAA);
    assert_eq!(emu.cpu.r[1], 0xBBBB);
    // LR was pushed but not popped, so the stack still holds one word.
    assert_eq!(emu.cpu.r[13], 0x0300_7F00 - 4);
}

#[test]
fn pop_pc_stays_in_thumb() {
    // ARMv4 has no interworking on POP: bit 0 of the loaded address is
    // dropped and the core keeps executing Thumb.
    let mut emu = thumb(&[push_pop(true, true, 0)]);
    emu.mem.iwram[0x7F00..0x7F04].copy_from_slice(&(ROM_BASE + 0x21).to_le_bytes());
    run(&mut emu, 1);
    assert!(emu.cpu.cpsr.thumb());
    assert_eq!(emu.cpu.r[15], ROM_BASE + 0x20);
}

#[test]
fn block_transfer_writes_back_unless_the_base_is_loaded() {
    let stored = exec_thumb(&[block(false, 3, 0b0000_0011)], |e| {
        e.cpu.r[0] = 1;
        e.cpu.r[1] = 2;
        e.cpu.r[3] = IWRAM;
    });
    assert_eq!(stored.cpu.r[3], IWRAM + 8);

    let mut setup = thumb(&[block(true, 0, 0b0000_0011)]);
    setup.mem.iwram[0..8].copy_from_slice(&[0x11, 0x11, 0, 0, 0x22, 0x22, 0, 0]);
    setup.cpu.r[0] = IWRAM;
    run(&mut setup, 1);
    assert_eq!(setup.cpu.r[0], 0x1111);
    assert_eq!(setup.cpu.r[1], 0x2222);
}

#[test]
fn conditional_branch_offsets_are_halfwords() {
    // PC already reads one instruction ahead, so an offset of zero skips the
    // next halfword rather than branching to it.
    let mut taken = thumb(&[b_cond(0x0, 0), imm_op(0, 0, 1), imm_op(0, 0, 2)]);
    taken.cpu.cpsr.set_z(true);
    run(&mut taken, 2);
    assert_eq!(taken.cpu.r[0], 2);

    let mut not_taken = thumb(&[b_cond(0x0, 0), imm_op(0, 0, 1), imm_op(0, 0, 2)]);
    not_taken.cpu.cpsr.set_z(false);
    run(&mut not_taken, 2);
    assert_eq!(not_taken.cpu.r[0], 1);
}

#[test]
fn unconditional_branch_reaches_backwards() {
    let mut emu = thumb(&[b(0), imm_op(0, 0, 1), imm_op(0, 0, 2), b(-4)]);
    run(&mut emu, 3);
    assert_eq!(emu.cpu.r[0], 2);
    assert_eq!(emu.cpu.r[15], ROM_BASE + 2);
}

#[test]
fn long_branch_with_link_assembles_from_two_halves() {
    let pair = bl(0, 2);
    let mut emu = thumb(&[pair[0], pair[1], 0, 0, imm_op(0, 0, 9)]);
    run(&mut emu, 2);
    assert_eq!(emu.cpu.r[15], ROM_BASE + 8);
    // The return address points past the second half and keeps the Thumb bit.
    assert_eq!(emu.cpu.r[14], ROM_BASE + 5);
}

#[test]
fn swi_from_thumb_returns_to_arm_at_the_vector() {
    let emu = exec_thumb(&[0xDF00], |e| e.cpu.hle_bios = false);
    assert!(!emu.cpu.cpsr.thumb());
    assert_eq!(emu.cpu.r[15], 0x0000_0008);
    assert_eq!(emu.cpu.r[14], ROM_BASE + 2);
}
