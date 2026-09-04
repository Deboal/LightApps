//! Shared scaffolding for the CPU tests.
//!
//! Tests assemble instruction words by hand and run them through the real
//! memory map, so the bus is exercised alongside the CPU rather than being
//! stubbed out.

#![allow(dead_code)]

use gba_core::cpu::Mode;
use gba_core::Emulator;

pub const ROM_BASE: u32 = 0x0800_0000;
pub const IWRAM: u32 = 0x0300_0000;
pub const EWRAM: u32 = 0x0200_0000;

/// Build an emulator whose cartridge contains `code`, starting execution at
/// the first instruction with the post-BIOS register state.
pub fn arm(code: &[u32]) -> Emulator {
    let mut rom = Vec::with_capacity(code.len() * 4 + 0xC0);
    for word in code {
        rom.extend_from_slice(&word.to_le_bytes());
    }
    rom.resize(rom.len().max(0xC0), 0);
    Emulator::new(&rom, None, None)
}

pub fn thumb(code: &[u16]) -> Emulator {
    let mut rom = Vec::with_capacity(code.len() * 2 + 0xC0);
    for half in code {
        rom.extend_from_slice(&half.to_le_bytes());
    }
    rom.resize(rom.len().max(0xC0), 0);
    let mut emu = Emulator::new(&rom, None, None);
    emu.cpu.cpsr.set_thumb(true);
    emu
}

/// Retire exactly `n` instructions.
pub fn run(emu: &mut Emulator, n: usize) {
    for _ in 0..n {
        emu.step();
    }
}

/// Run `code` in ARM mode, apply `setup` first, and return the machine.
pub fn exec_arm(code: &[u32], setup: impl FnOnce(&mut Emulator)) -> Emulator {
    let mut emu = arm(code);
    setup(&mut emu);
    run(&mut emu, code.len());
    emu
}

pub fn exec_thumb(code: &[u16], setup: impl FnOnce(&mut Emulator)) -> Emulator {
    let mut emu = thumb(code);
    setup(&mut emu);
    run(&mut emu, code.len());
    emu
}

/// N, Z, C, V as a four-character string, for readable assertions.
pub fn flags(emu: &Emulator) -> String {
    let p = emu.cpu.cpsr;
    let bit = |b: bool, c: char| if b { c } else { '-' };
    format!(
        "{}{}{}{}",
        bit(p.n(), 'N'),
        bit(p.z(), 'Z'),
        bit(p.c(), 'C'),
        bit(p.v(), 'V')
    )
}

pub fn mode(emu: &Emulator) -> Mode {
    emu.cpu.cpsr.mode()
}

// -- ARM encoding helpers ------------------------------------------------

pub const AL: u32 = 0xE;

/// Data processing with a rotated 8-bit immediate.
pub fn dp_imm(opcode: u32, s: bool, rn: u32, rd: u32, imm: u32, rot: u32) -> u32 {
    AL << 28 | 1 << 25 | opcode << 21 | (s as u32) << 20 | rn << 16 | rd << 12 | rot << 8 | imm
}

/// Data processing with a register operand shifted by an immediate amount.
pub fn dp_reg(opcode: u32, s: bool, rn: u32, rd: u32, rm: u32, shift: u32, amount: u32) -> u32 {
    AL << 28 | opcode << 21 | (s as u32) << 20 | rn << 16 | rd << 12 | amount << 7 | shift << 5 | rm
}

/// Data processing with a register operand shifted by a register amount.
pub fn dp_rsr(opcode: u32, s: bool, rn: u32, rd: u32, rm: u32, shift: u32, rs: u32) -> u32 {
    AL << 28
        | opcode << 21
        | (s as u32) << 20
        | rn << 16
        | rd << 12
        | rs << 8
        | shift << 5
        | 1 << 4
        | rm
}

pub const AND: u32 = 0x0;
pub const EOR: u32 = 0x1;
pub const SUB: u32 = 0x2;
pub const RSB: u32 = 0x3;
pub const ADD: u32 = 0x4;
pub const ADC: u32 = 0x5;
pub const SBC: u32 = 0x6;
pub const RSC: u32 = 0x7;
pub const TST: u32 = 0x8;
pub const TEQ: u32 = 0x9;
pub const CMP: u32 = 0xA;
pub const CMN: u32 = 0xB;
pub const ORR: u32 = 0xC;
pub const MOV: u32 = 0xD;
pub const BIC: u32 = 0xE;
pub const MVN: u32 = 0xF;

pub const LSL: u32 = 0;
pub const LSR: u32 = 1;
pub const ASR: u32 = 2;
pub const ROR: u32 = 3;

/// MOV Rd, #imm -- the workhorse for setting up test state.
pub fn mov(rd: u32, imm: u32, rot: u32) -> u32 {
    dp_imm(MOV, false, 0, rd, imm, rot)
}

/// Single data transfer with a 12-bit immediate offset.
#[allow(clippy::too_many_arguments)]
pub fn ldr_str(
    load: bool,
    byte: bool,
    pre: bool,
    up: bool,
    wb: bool,
    rn: u32,
    rd: u32,
    off: u32,
) -> u32 {
    AL << 28
        | 1 << 26
        | (pre as u32) << 24
        | (up as u32) << 23
        | (byte as u32) << 22
        | (wb as u32) << 21
        | (load as u32) << 20
        | rn << 16
        | rd << 12
        | off
}

/// Halfword / signed transfer with an immediate offset. `sh` is 1 = H,
/// 2 = signed byte, 3 = signed halfword.
#[allow(clippy::too_many_arguments)]
pub fn ldrh_strh(
    load: bool,
    pre: bool,
    up: bool,
    wb: bool,
    rn: u32,
    rd: u32,
    off: u32,
    sh: u32,
) -> u32 {
    AL << 28
        | (pre as u32) << 24
        | (up as u32) << 23
        | 1 << 22
        | (wb as u32) << 21
        | (load as u32) << 20
        | rn << 16
        | rd << 12
        | (off & 0xF0) << 4
        | 1 << 7
        | sh << 5
        | 1 << 4
        | (off & 0xF)
}

/// LDM/STM.
pub fn block(load: bool, pre: bool, up: bool, s: bool, wb: bool, rn: u32, list: u32) -> u32 {
    AL << 28
        | 1 << 27
        | (pre as u32) << 24
        | (up as u32) << 23
        | (s as u32) << 22
        | (wb as u32) << 21
        | (load as u32) << 20
        | rn << 16
        | list
}

/// B / BL with a signed instruction-count offset relative to the next
/// instruction's pipeline position.
pub fn branch(link: bool, offset_words: i32) -> u32 {
    AL << 28 | 5 << 25 | (link as u32) << 24 | (offset_words as u32 & 0x00FF_FFFF)
}

pub fn bx(rm: u32) -> u32 {
    AL << 28 | 0x012F_FF10 | rm
}

pub fn mul(s: bool, rd: u32, rs: u32, rm: u32) -> u32 {
    AL << 28 | (s as u32) << 20 | rd << 16 | rs << 8 | 9 << 4 | rm
}

pub fn mla(s: bool, rd: u32, rn: u32, rs: u32, rm: u32) -> u32 {
    AL << 28 | 1 << 21 | (s as u32) << 20 | rd << 16 | rn << 12 | rs << 8 | 9 << 4 | rm
}

/// UMULL / SMULL / UMLAL / SMLAL.
pub fn mull(
    signed: bool,
    accumulate: bool,
    s: bool,
    rd_hi: u32,
    rd_lo: u32,
    rs: u32,
    rm: u32,
) -> u32 {
    AL << 28
        | 1 << 23
        | (signed as u32) << 22
        | (accumulate as u32) << 21
        | (s as u32) << 20
        | rd_hi << 16
        | rd_lo << 12
        | rs << 8
        | 9 << 4
        | rm
}

pub fn mrs(spsr: bool, rd: u32) -> u32 {
    AL << 28 | 1 << 24 | (spsr as u32) << 22 | 0xF << 16 | rd << 12
}

pub fn msr_reg(spsr: bool, fields: u32, rm: u32) -> u32 {
    AL << 28 | 1 << 24 | (spsr as u32) << 22 | 1 << 21 | fields << 16 | 0xF << 12 | rm
}

pub fn msr_imm(spsr: bool, fields: u32, imm: u32, rot: u32) -> u32 {
    AL << 28
        | 1 << 25
        | 1 << 24
        | (spsr as u32) << 22
        | 1 << 21
        | fields << 16
        | 0xF << 12
        | rot << 8
        | imm
}

pub fn swp(byte: bool, rn: u32, rd: u32, rm: u32) -> u32 {
    AL << 28 | 1 << 24 | (byte as u32) << 22 | rn << 16 | rd << 12 | 9 << 4 | rm
}

pub fn swi(comment: u32) -> u32 {
    AL << 28 | 0xF << 24 | (comment & 0x00FF_FFFF)
}
