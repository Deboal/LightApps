//! A C-ABI shim so the core can be driven from JavaScript.
//!
//! The whole interface is plain functions plus the module's linear memory:
//! JavaScript allocates a buffer here, writes the ROM into it, and reads the
//! framebuffer and save data back out. No bindings generator, no build step
//! beyond `cargo build --target wasm32-unknown-unknown`.
//!
//! The module holds one emulator. WebAssembly is single threaded, so the
//! statics below are only ever touched from one place; every accessor goes
//! through a raw pointer rather than a reference to keep that explicit.

use core::ptr::addr_of_mut;

use gba_core::{Emulator, KeyState, FRAMEBUFFER_LEN};

static mut EMULATOR: Option<Emulator> = None;
/// The framebuffer converted to RGBA8888, ready for `putImageData`.
static mut PIXELS: [u8; FRAMEBUFFER_LEN * 4] = [0; FRAMEBUFFER_LEN * 4];
/// A second one, so a linked session can draw both screens in one pass without
/// the first being overwritten by the second.
static mut PIXELS_ALT: [u8; FRAMEBUFFER_LEN * 4] = [0; FRAMEBUFFER_LEN * 4];
/// Scratch for whichever save or save state was last requested.
static mut TRANSFER: Vec<u8> = Vec::new();

#[allow(static_mut_refs)]
fn emulator() -> Option<&'static mut Emulator> {
    unsafe { (*addr_of_mut!(EMULATOR)).as_mut() }
}

/// BGR555 to RGBA8888, replicating the top bits into the low ones so a
/// full-intensity channel reaches 255 rather than 248.
fn to_rgba(frame: &[u16; FRAMEBUFFER_LEN], out: &mut [u8; FRAMEBUFFER_LEN * 4]) {
    for (i, colour) in frame.iter().enumerate() {
        let pixel = &mut out[i * 4..i * 4 + 4];
        for (channel, shift) in [0u16, 5, 10].into_iter().enumerate() {
            let value = ((colour >> shift) & 0x1F) as u8;
            pixel[channel] = (value << 3) | (value >> 2);
        }
        pixel[3] = 0xFF;
    }
}

/// Reserve `len` bytes for JavaScript to write into. The pointer stays valid
/// until `gba_free` is called with the same length.
#[no_mangle]
pub extern "C" fn gba_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    core::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` and `len` must come from a matching `gba_alloc`.
#[no_mangle]
pub unsafe extern "C" fn gba_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// Boot a ROM. `save` may be null to start from an empty cartridge.
///
/// # Safety
/// Both pointers must reference at least the stated number of readable bytes.
#[no_mangle]
pub unsafe extern "C" fn gba_init(
    rom: *const u8,
    rom_len: usize,
    save: *const u8,
    save_len: usize,
) -> i32 {
    if rom.is_null() || rom_len < 0xC0 {
        return 0;
    }
    let rom = core::slice::from_raw_parts(rom, rom_len);
    let save = if save.is_null() || save_len == 0 {
        None
    } else {
        Some(core::slice::from_raw_parts(save, save_len))
    };
    *addr_of_mut!(EMULATOR) = Some(Emulator::new(rom, None, save));
    1
}

/// Run one frame with `keys` as a `KeyState` bitmask.
#[no_mangle]
pub extern "C" fn gba_run_frame(keys: u16) {
    if let Some(emulator) = emulator() {
        emulator.run_frame(KeyState(keys));
    }
}

/// Convert the frame to RGBA and return a pointer to it.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_pixels() -> *const u8 {
    if let Some(emulator) = emulator() {
        let pixels = unsafe { &mut *addr_of_mut!(PIXELS) };
        to_rgba(emulator.framebuffer(), pixels);
        pixels.as_ptr()
    } else {
        core::ptr::null()
    }
}

#[no_mangle]
pub extern "C" fn gba_pixels_len() -> usize {
    FRAMEBUFFER_LEN * 4
}

/// True once the game has written to cartridge flash since the last clear --
/// the signal to persist the save.
#[no_mangle]
pub extern "C" fn gba_save_dirty() -> i32 {
    emulator().map(|e| e.save_dirty() as i32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn gba_clear_save_dirty() {
    if let Some(emulator) = emulator() {
        emulator.clear_save_dirty();
    }
}

/// Copy the cartridge save into the transfer buffer and return its length.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_read_save() -> usize {
    let transfer = unsafe { &mut *addr_of_mut!(TRANSFER) };
    transfer.clear();
    if let Some(save) = emulator().and_then(|e| e.save_data()) {
        transfer.extend_from_slice(save);
    }
    transfer.len()
}

/// Serialize the whole machine into the transfer buffer.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_read_state() -> usize {
    let transfer = unsafe { &mut *addr_of_mut!(TRANSFER) };
    transfer.clear();
    if let Some(emulator) = emulator() {
        transfer.extend_from_slice(&emulator.serialize_state());
    }
    transfer.len()
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_transfer_ptr() -> *const u8 {
    unsafe { (*addr_of_mut!(TRANSFER)).as_ptr() }
}

/// Restore a save state. Returns 0 if it was refused -- a state from another
/// core version is rejected outright rather than loaded optimistically.
///
/// # Safety
/// `ptr` must reference at least `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn gba_write_state(ptr: *const u8, len: usize) -> i32 {
    let Some(emulator) = emulator() else { return 0 };
    let data = core::slice::from_raw_parts(ptr, len);
    emulator.deserialize_state(data).is_ok() as i32
}

/// The state format version this build reads and writes.
///
/// A save state encodes the emulator's internal layout, so it breaks whenever
/// that layout changes. Exposing the version lets the shell mark an
/// incompatible state as unloadable in the list rather than failing on click.
#[no_mangle]
pub extern "C" fn gba_state_version() -> u32 {
    gba_core::state::STATE_VERSION
}

/// The cartridge's four-character game code, packed into a u32, so the shell
/// can key a save on the game rather than on a filename.
#[no_mangle]
pub extern "C" fn gba_game_code() -> u32 {
    emulator()
        .and_then(|e| e.mem.cart.header.as_ref())
        .map(|header| {
            let bytes = header.game_code.as_bytes();
            let mut code = 0u32;
            for (i, byte) in bytes.iter().take(4).enumerate() {
                code |= (*byte as u32) << (8 * i);
            }
            code
        })
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Linked play
// ---------------------------------------------------------------------------
//
// A session runs *both* machines here, on every participant's device. The
// network carries button presses and nothing else, which is the whole reason
// the core was made deterministic: two people pressing the same buttons on the
// same starting state compute the same cable traffic, so the cable itself
// never has to cross the wire.
//
// Both machines boot from their own cartridge save, the way two consoles do
// when you plug a real cable between them. That keeps the starting state small
// enough to hand over (128 KB each) and exactly specified -- `Emulator::new`
// is deterministic, so a save is a complete description of where to begin.

static mut CABLE: Option<gba_core::cable::Cable> = None;

#[allow(static_mut_refs)]
fn cable() -> Option<&'static mut gba_core::cable::Cable> {
    unsafe { (*addr_of_mut!(CABLE)).as_mut() }
}

/// Wire two machines together. Unit 0 is the cable's parent.
///
/// # Safety
/// Every pointer must reference at least the stated number of readable bytes;
/// either save may be null for a fresh cartridge.
#[no_mangle]
pub unsafe extern "C" fn gba_link_init(
    rom: *const u8,
    rom_len: usize,
    save0: *const u8,
    save0_len: usize,
    save1: *const u8,
    save1_len: usize,
) -> i32 {
    if rom.is_null() || rom_len < 0xC0 {
        return 0;
    }
    let rom = core::slice::from_raw_parts(rom, rom_len);
    let borrow = |ptr: *const u8, len: usize| {
        if ptr.is_null() || len == 0 {
            None
        } else {
            Some(core::slice::from_raw_parts(ptr, len))
        }
    };
    *addr_of_mut!(CABLE) = Some(gba_core::cable::Cable::new(vec![
        Emulator::new(rom, None, borrow(save0, save0_len)),
        Emulator::new(rom, None, borrow(save1, save1_len)),
    ]));
    1
}

/// Run one frame on both machines. Both players' buttons are required: a
/// participant that does not yet know the other's input must wait rather than
/// guess, or the two sides stop computing the same session.
#[no_mangle]
pub extern "C" fn gba_link_run_frame(keys0: u16, keys1: u16) {
    if let Some(cable) = cable() {
        cable.run_frame(&[KeyState(keys0), KeyState(keys1)]);
    }
}

/// Convert one unit's frame to RGBA and return a pointer to it.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_link_pixels(unit: u32) -> *const u8 {
    let Some(cable) = cable() else {
        return core::ptr::null();
    };
    let Some(machine) = cable.machines.get(unit as usize) else {
        return core::ptr::null();
    };
    let frame = machine.framebuffer();
    let pixels = unsafe { &mut *addr_of_mut!(PIXELS) };
    to_rgba(frame, pixels);
    pixels.as_ptr()
}

/// The second unit's frame, in its own buffer, so both screens can be drawn
/// from one pass without the first being overwritten.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_link_pixels_alt(unit: u32) -> *const u8 {
    let Some(cable) = cable() else {
        return core::ptr::null();
    };
    let Some(machine) = cable.machines.get(unit as usize) else {
        return core::ptr::null();
    };
    let frame = machine.framebuffer();
    let pixels = unsafe { &mut *addr_of_mut!(PIXELS_ALT) };
    to_rgba(frame, pixels);
    pixels.as_ptr()
}

/// A fingerprint of the whole session, for spotting a desync.
///
/// Two participants running the same inputs must agree on this. When they stop
/// agreeing the session is already wrong, and stopping loudly beats letting
/// one side write a corrupted save.
#[no_mangle]
pub extern "C" fn gba_link_hash() -> u32 {
    cable().map(|c| c.state_hash() as u32).unwrap_or(0)
}

/// Copy one unit's cartridge save into the transfer buffer.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_link_read_save(unit: u32) -> usize {
    let transfer = unsafe { &mut *addr_of_mut!(TRANSFER) };
    transfer.clear();
    if let Some(save) = cable()
        .and_then(|c| c.machines.get(unit as usize))
        .and_then(|m| m.save_data())
    {
        transfer.extend_from_slice(save);
    }
    transfer.len()
}

/// True once a unit has written to cartridge flash -- the signal that a trade
/// has been committed and the save is worth keeping.
#[no_mangle]
pub extern "C" fn gba_link_save_dirty(unit: u32) -> i32 {
    cable()
        .and_then(|c| c.machines.get(unit as usize))
        .map(|m| m.save_dirty() as i32)
        .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn gba_link_clear_save_dirty(unit: u32) {
    if let Some(machine) = cable().and_then(|c| c.machines.get_mut(unit as usize)) {
        machine.clear_save_dirty();
    }
}

/// Serialize one unit into the transfer buffer, so leaving a session can hand
/// the machine back to the single-player path exactly where it stood.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn gba_link_read_state(unit: u32) -> usize {
    let transfer = unsafe { &mut *addr_of_mut!(TRANSFER) };
    transfer.clear();
    if let Some(machine) = cable().and_then(|c| c.machines.get(unit as usize)) {
        transfer.extend_from_slice(&machine.serialize_state());
    }
    transfer.len()
}

/// Tear the session down and release both machines.
#[no_mangle]
pub extern "C" fn gba_link_end() {
    unsafe {
        *addr_of_mut!(CABLE) = None;
    }
}
