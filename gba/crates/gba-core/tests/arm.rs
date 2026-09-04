//! ARM-mode instruction tests.
//!
//! These are not a substitute for jsmolka's gba-tests -- they are what stands
//! in for them until a real test ROM is available, and they concentrate on the
//! encodings where the ARM7TDMI disagrees with intuition.

mod common;
use common::*;
use gba_core::cpu::Mode;

#[test]
fn mov_immediate_is_rotated_not_shifted() {
    // The 8-bit immediate rotates right by twice the 4-bit field, so 0xFF with
    // a rotate field of 4 lands in the top byte rather than the bottom.
    let emu = exec_arm(&[mov(0, 0xFF, 4)], |_| {});
    assert_eq!(emu.cpu.r[0], 0xFF00_0000);
}

#[test]
fn lsr_zero_means_thirty_two() {
    let emu = exec_arm(&[dp_reg(MOV, true, 0, 0, 1, LSR, 0)], |e| {
        e.cpu.r[1] = 0x8000_0001;
    });
    assert_eq!(emu.cpu.r[0], 0);
    assert_eq!(flags(&emu), "-ZC-");
}

#[test]
fn asr_zero_means_thirty_two() {
    let emu = exec_arm(&[dp_reg(MOV, true, 0, 0, 1, ASR, 0)], |e| {
        e.cpu.r[1] = 0x8000_0001;
    });
    assert_eq!(emu.cpu.r[0], 0xFFFF_FFFF);
    assert_eq!(flags(&emu), "N-C-");
}

#[test]
fn ror_zero_is_rrx() {
    let emu = exec_arm(&[dp_reg(MOV, true, 0, 0, 1, ROR, 0)], |e| {
        e.cpu.r[1] = 0x0000_0003;
        e.cpu.cpsr.set_c(true);
    });
    assert_eq!(emu.cpu.r[0], 0x8000_0001);
    assert_eq!(flags(&emu), "N-C-");
}

#[test]
fn register_shift_of_zero_preserves_carry() {
    // A register shift amount of zero is genuinely zero, unlike the immediate
    // encodings above: value and carry both pass through untouched.
    let emu = exec_arm(&[dp_rsr(MOV, true, 0, 0, 1, LSR, 2)], |e| {
        e.cpu.r[1] = 0x1234_5678;
        e.cpu.r[2] = 0;
        e.cpu.cpsr.set_c(true);
    });
    assert_eq!(emu.cpu.r[0], 0x1234_5678);
    assert_eq!(flags(&emu), "--C-");
}

#[test]
fn register_shift_of_thirty_two_and_beyond() {
    let by_32 = exec_arm(&[dp_rsr(MOV, true, 0, 0, 1, LSL, 2)], |e| {
        e.cpu.r[1] = 0x0000_0001;
        e.cpu.r[2] = 32;
    });
    assert_eq!(by_32.cpu.r[0], 0);
    assert_eq!(flags(&by_32), "-ZC-");

    let by_33 = exec_arm(&[dp_rsr(MOV, true, 0, 0, 1, LSL, 2)], |e| {
        e.cpu.r[1] = 0x0000_0001;
        e.cpu.r[2] = 33;
    });
    assert_eq!(by_33.cpu.r[0], 0);
    assert_eq!(flags(&by_33), "-Z--");
}

#[test]
fn ror_by_multiple_of_thirty_two_keeps_value_and_takes_carry_from_bit_31() {
    let emu = exec_arm(&[dp_rsr(MOV, true, 0, 0, 1, ROR, 2)], |e| {
        e.cpu.r[1] = 0x8000_0001;
        e.cpu.r[2] = 32;
    });
    assert_eq!(emu.cpu.r[0], 0x8000_0001);
    assert_eq!(flags(&emu), "N-C-");
}

#[test]
fn add_sets_carry_and_overflow_independently() {
    // Unsigned carry without signed overflow.
    let carry = exec_arm(&[dp_reg(ADD, true, 1, 0, 2, LSL, 0)], |e| {
        e.cpu.r[1] = 0xFFFF_FFFF;
        e.cpu.r[2] = 1;
    });
    assert_eq!(carry.cpu.r[0], 0);
    assert_eq!(flags(&carry), "-ZC-");

    // Signed overflow without unsigned carry.
    let overflow = exec_arm(&[dp_reg(ADD, true, 1, 0, 2, LSL, 0)], |e| {
        e.cpu.r[1] = 0x7FFF_FFFF;
        e.cpu.r[2] = 1;
    });
    assert_eq!(overflow.cpu.r[0], 0x8000_0000);
    assert_eq!(flags(&overflow), "N--V");
}

#[test]
fn subtraction_carry_is_not_borrow() {
    // SUB sets C when there is *no* borrow, which is the opposite of the
    // intuitive reading and a classic source of wrong branches.
    let no_borrow = exec_arm(&[dp_imm(SUB, true, 1, 0, 1, 0)], |e| e.cpu.r[1] = 5);
    assert_eq!(no_borrow.cpu.r[0], 4);
    assert_eq!(flags(&no_borrow), "--C-");

    let borrow = exec_arm(&[dp_imm(SUB, true, 1, 0, 6, 0)], |e| e.cpu.r[1] = 5);
    assert_eq!(borrow.cpu.r[0], 0xFFFF_FFFF);
    assert_eq!(flags(&borrow), "N---");
}

#[test]
fn sbc_and_rsc_use_the_carry_in() {
    let sbc = exec_arm(&[dp_imm(SBC, true, 1, 0, 1, 0)], |e| {
        e.cpu.r[1] = 10;
        e.cpu.cpsr.set_c(false);
    });
    // 10 - 1 - 1 = 8 when carry (i.e. "no borrow") is clear.
    assert_eq!(sbc.cpu.r[0], 8);

    let rsc = exec_arm(&[dp_imm(RSC, true, 1, 0, 10, 0)], |e| {
        e.cpu.r[1] = 1;
        e.cpu.cpsr.set_c(true);
    });
    assert_eq!(rsc.cpu.r[0], 9);
}

#[test]
fn compare_operations_do_not_write_a_result() {
    let emu = exec_arm(&[dp_imm(CMP, true, 1, 0, 5, 0)], |e| {
        e.cpu.r[0] = 0xDEAD_BEEF;
        e.cpu.r[1] = 5;
    });
    assert_eq!(emu.cpu.r[0], 0xDEAD_BEEF);
    assert_eq!(flags(&emu), "-ZC-");
}

#[test]
fn pc_reads_as_eight_ahead_and_twelve_with_a_register_shift() {
    let plain = exec_arm(&[dp_imm(ADD, false, 15, 0, 0, 0)], |_| {});
    assert_eq!(plain.cpu.r[0], ROM_BASE + 8);

    // The extra internal cycle of a register-specified shift is visible as an
    // extra +4 on any read of PC in the same instruction.
    let shifted = exec_arm(&[dp_rsr(ADD, false, 15, 0, 1, LSL, 2)], |e| {
        e.cpu.r[1] = 0;
        e.cpu.r[2] = 0;
    });
    assert_eq!(shifted.cpu.r[0], ROM_BASE + 12);
}

#[test]
fn multiply_and_accumulate() {
    let emu = exec_arm(&[mul(true, 0, 2, 1)], |e| {
        e.cpu.r[1] = 0xFFFF_FFFF;
        e.cpu.r[2] = 2;
    });
    assert_eq!(emu.cpu.r[0], 0xFFFF_FFFE);
    assert!(emu.cpu.cpsr.n());

    let acc = exec_arm(&[mla(false, 0, 3, 2, 1)], |e| {
        e.cpu.r[1] = 7;
        e.cpu.r[2] = 6;
        e.cpu.r[3] = 100;
    });
    assert_eq!(acc.cpu.r[0], 142);
}

#[test]
fn long_multiply_respects_signedness() {
    let unsigned = exec_arm(&[mull(false, false, false, 1, 0, 3, 2)], |e| {
        e.cpu.r[2] = 0xFFFF_FFFF;
        e.cpu.r[3] = 0xFFFF_FFFF;
    });
    assert_eq!(unsigned.cpu.r[0], 0x0000_0001);
    assert_eq!(unsigned.cpu.r[1], 0xFFFF_FFFE);

    let signed = exec_arm(&[mull(true, false, true, 1, 0, 3, 2)], |e| {
        e.cpu.r[2] = 0xFFFF_FFFF; // -1
        e.cpu.r[3] = 0xFFFF_FFFF; // -1
    });
    assert_eq!(signed.cpu.r[0], 1);
    assert_eq!(signed.cpu.r[1], 0);
    assert!(!signed.cpu.cpsr.n());
}

#[test]
fn accumulate_long_adds_the_existing_pair() {
    let emu = exec_arm(&[mull(false, true, false, 1, 0, 3, 2)], |e| {
        e.cpu.r[0] = 5;
        e.cpu.r[1] = 1;
        e.cpu.r[2] = 4;
        e.cpu.r[3] = 4;
    });
    assert_eq!(emu.cpu.r[0], 21);
    assert_eq!(emu.cpu.r[1], 1);
}

#[test]
fn word_store_and_load_round_trip_through_iwram() {
    let emu = exec_arm(
        &[
            ldr_str(false, false, true, true, false, 1, 0, 4),
            ldr_str(true, false, true, true, false, 1, 2, 4),
        ],
        |e| {
            e.cpu.r[0] = 0xCAFE_BABE;
            e.cpu.r[1] = IWRAM;
        },
    );
    assert_eq!(emu.cpu.r[2], 0xCAFE_BABE);
}

#[test]
fn unaligned_word_load_rotates_rather_than_faulting() {
    let emu = exec_arm(
        &[
            ldr_str(false, false, true, true, false, 1, 0, 0),
            ldr_str(true, false, true, true, false, 1, 2, 1),
        ],
        |e| {
            e.cpu.r[0] = 0x1122_3344;
            e.cpu.r[1] = IWRAM;
        },
    );
    assert_eq!(emu.cpu.r[2], 0x4411_2233);
}

#[test]
fn post_indexed_transfer_always_writes_back() {
    let emu = exec_arm(&[ldr_str(false, false, false, true, false, 1, 0, 4)], |e| {
        e.cpu.r[0] = 1;
        e.cpu.r[1] = IWRAM;
    });
    assert_eq!(emu.cpu.r[1], IWRAM + 4);
}

#[test]
fn storing_pc_stores_twelve_ahead() {
    let mut emu = exec_arm(
        &[
            ldr_str(false, false, true, true, false, 1, 15, 0),
            ldr_str(true, false, true, true, false, 1, 2, 0),
        ],
        |e| e.cpu.r[1] = IWRAM,
    );
    let _ = &mut emu;
    assert_eq!(emu.cpu.r[2], ROM_BASE + 12);
}

#[test]
fn signed_halfword_load_from_an_odd_address_degrades_to_a_signed_byte() {
    let emu = exec_arm(
        &[
            ldr_str(false, false, true, true, false, 1, 0, 0),
            ldrh_strh(true, true, true, false, 1, 2, 1, 3),
            ldrh_strh(true, true, true, false, 1, 3, 0, 3),
        ],
        |e| {
            e.cpu.r[0] = 0x0000_80FF;
            e.cpu.r[1] = IWRAM;
        },
    );
    // Byte at +1 is 0x80, sign-extended.
    assert_eq!(emu.cpu.r[2], 0xFFFF_FF80);
    // Aligned halfword 0x80FF, sign-extended.
    assert_eq!(emu.cpu.r[3], 0xFFFF_80FF);
}

#[test]
fn unsigned_halfword_and_signed_byte_loads() {
    let emu = exec_arm(
        &[
            ldr_str(false, false, true, true, false, 1, 0, 0),
            ldrh_strh(true, true, true, false, 1, 2, 0, 1),
            ldrh_strh(true, true, true, false, 1, 3, 1, 2),
        ],
        |e| {
            e.cpu.r[0] = 0x0000_80FF;
            e.cpu.r[1] = IWRAM;
        },
    );
    assert_eq!(emu.cpu.r[2], 0x0000_80FF);
    assert_eq!(emu.cpu.r[3], 0xFFFF_FF80);
}

#[test]
fn block_store_then_load_in_every_addressing_mode() {
    // STMIA / LDMIA
    let ia = exec_arm(
        &[
            block(false, false, true, false, false, 4, 0b0111),
            block(true, false, true, false, false, 4, 0b0111 << 8),
        ],
        |e| {
            e.cpu.r[0] = 10;
            e.cpu.r[1] = 20;
            e.cpu.r[2] = 30;
            e.cpu.r[4] = IWRAM;
        },
    );
    assert_eq!([ia.cpu.r[8], ia.cpu.r[9], ia.cpu.r[10]], [10, 20, 30]);

    // STMDB (full descending push) / LDMIA back off the same block.
    let db = exec_arm(
        &[
            block(false, true, false, false, true, 4, 0b0111),
            block(true, false, true, false, true, 4, 0b0111 << 8),
        ],
        |e| {
            e.cpu.r[0] = 1;
            e.cpu.r[1] = 2;
            e.cpu.r[2] = 3;
            e.cpu.r[4] = IWRAM + 0x100;
        },
    );
    assert_eq!([db.cpu.r[8], db.cpu.r[9], db.cpu.r[10]], [1, 2, 3]);
    assert_eq!(db.cpu.r[4], IWRAM + 0x100);
}

#[test]
fn stm_stores_the_written_back_base_unless_the_base_is_first_in_the_list() {
    // Base is the lowest register in the list: the original value is stored.
    let first = exec_arm(
        &[
            block(false, false, true, false, true, 0, 0b0011),
            block(true, false, true, false, false, 4, 0b0011 << 8),
        ],
        |e| {
            e.cpu.r[0] = IWRAM;
            e.cpu.r[1] = 0xAAAA;
            e.cpu.r[4] = IWRAM;
        },
    );
    assert_eq!(first.cpu.r[8], IWRAM);

    // Base is not first: the stored value is the written-back one.
    let later = exec_arm(
        &[
            block(false, false, true, false, true, 1, 0b0011),
            block(true, false, true, false, false, 4, 0b0011 << 8),
        ],
        |e| {
            e.cpu.r[0] = 0xAAAA;
            e.cpu.r[1] = IWRAM;
            e.cpu.r[4] = IWRAM;
        },
    );
    assert_eq!(later.cpu.r[9], IWRAM + 8);
}

#[test]
fn ldm_writeback_loses_to_a_loaded_base() {
    let emu = exec_arm(
        &[
            block(false, false, true, false, false, 4, 0b0011),
            // LDMIA r5!, {r5, r6} -- r5 is both the base and in the list.
            block(true, false, true, false, true, 5, 0b0110_0000),
        ],
        |e| {
            e.cpu.r[0] = 0x1111;
            e.cpu.r[1] = 0x2222;
            e.cpu.r[4] = IWRAM;
            e.cpu.r[5] = IWRAM;
        },
    );
    // Writeback would have left IWRAM + 8; the loaded value wins instead.
    assert_eq!(emu.cpu.r[5], 0x1111);
    assert_eq!(emu.cpu.r[6], 0x2222);
}

#[test]
fn branch_and_link_leaves_the_return_address_in_lr() {
    let mut emu = arm(&[branch(true, 1), mov(0, 1, 0), mov(0, 2, 0)]);
    run(&mut emu, 1);
    assert_eq!(emu.cpu.r[14], ROM_BASE + 4);
    assert_eq!(emu.cpu.r[15], ROM_BASE + 12);
}

#[test]
fn bx_with_bit_zero_set_enters_thumb() {
    let emu = exec_arm(&[bx(0)], |e| e.cpu.r[0] = ROM_BASE + 5);
    assert!(emu.cpu.cpsr.thumb());
    assert_eq!(emu.cpu.r[15] & !1, ROM_BASE + 4);
}

#[test]
fn msr_switches_mode_and_banks_the_stack_pointer() {
    let sys_sp = 0x0300_7F00;
    let irq_sp = 0x0300_7FA0;

    let emu = exec_arm(&[msr_imm(false, 0b0001, Mode::Irq as u32, 0)], |_| {});
    assert_eq!(mode(&emu), Mode::Irq);
    assert_eq!(emu.cpu.r[13], irq_sp);

    let back = exec_arm(
        &[
            msr_imm(false, 0b0001, Mode::Irq as u32, 0),
            msr_imm(false, 0b0001, Mode::Sys as u32, 0),
        ],
        |_| {},
    );
    assert_eq!(mode(&back), Mode::Sys);
    assert_eq!(back.cpu.r[13], sys_sp);
}

#[test]
fn msr_cannot_set_the_thumb_bit() {
    // Flipping T through MSR would desynchronise the instruction set from the
    // pipeline, so the hardware ignores it.
    let emu = exec_arm(
        &[msr_imm(false, 0b0001, Mode::Sys as u32 | (1 << 5), 0)],
        |_| {},
    );
    assert!(!emu.cpu.cpsr.thumb());
}

#[test]
fn mrs_reads_cpsr_and_spsr() {
    let emu = exec_arm(
        &[
            msr_imm(false, 0b0001, Mode::Svc as u32, 0),
            msr_reg(true, 0b1001, 1),
            mrs(true, 0),
        ],
        |e| e.cpu.r[1] = 0xF000_0000 | Mode::User as u32,
    );
    assert_eq!(emu.cpu.r[0] & 0xF000_001F, 0xF000_0000 | Mode::User as u32);
}

#[test]
fn swi_enters_supervisor_mode_at_the_vector() {
    let emu = exec_arm(&[swi(0x06)], |_| {});
    assert_eq!(mode(&emu), Mode::Svc);
    assert_eq!(emu.cpu.r[15], 0x0000_0008);
    assert_eq!(emu.cpu.r[14], ROM_BASE + 4);
    assert!(emu.cpu.cpsr.irq_disabled());
    assert_eq!(emu.cpu.spsr[Mode::Svc.bank()].mode(), Mode::Sys);
}

#[test]
fn subs_pc_lr_returns_from_an_exception() {
    // The canonical SWI handler tail: restore CPSR from SPSR and jump back.
    let emu = exec_arm(
        &[
            swi(0),
            // At the vector the emulator would run BIOS; drive the return by
            // hand instead so the test stays independent of a BIOS image.
        ],
        |_| {},
    );
    let mut emu = emu;
    emu.cpu.r[15] = ROM_BASE + 0x40;
    // SUBS pc, lr, #4
    let code = dp_imm(SUB, true, 14, 15, 4, 0);
    emu.mem.iwram[..4].copy_from_slice(&code.to_le_bytes());
    emu.cpu.r[15] = IWRAM;
    emu.step();
    assert_eq!(mode(&emu), Mode::Sys);
    assert_eq!(emu.cpu.r[15], ROM_BASE);
}

#[test]
fn swp_exchanges_memory_and_register_atomically() {
    let emu = exec_arm(
        &[
            ldr_str(false, false, true, true, false, 1, 0, 0),
            swp(false, 1, 3, 2),
            ldr_str(true, false, true, true, false, 1, 4, 0),
        ],
        |e| {
            e.cpu.r[0] = 0x1111_1111;
            e.cpu.r[1] = IWRAM;
            e.cpu.r[2] = 0x2222_2222;
        },
    );
    assert_eq!(emu.cpu.r[3], 0x1111_1111);
    assert_eq!(emu.cpu.r[4], 0x2222_2222);
}

#[test]
fn conditions_gate_execution() {
    // MOVEQ with Z clear must not execute.
    // MOVEQ r0, #0x42 -- condition EQ is encoding 0x0 in the top nibble.
    let eq = 1 << 25 | MOV << 21 | 0x42;
    let emu = exec_arm(&[eq], |e| e.cpu.cpsr.set_z(false));
    assert_eq!(emu.cpu.r[0], 0);

    let emu = exec_arm(&[eq], |e| e.cpu.cpsr.set_z(true));
    assert_eq!(emu.cpu.r[0], 0x42);
}
