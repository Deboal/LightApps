//! The CPU's view of memory. Kept as a trait so the CPU can be exercised
//! against a bare test bus without dragging in the whole GBA memory map.

pub trait Bus {
    fn read8(&mut self, addr: u32) -> u8;
    /// Reads the halfword containing `addr`; the bus forces alignment and the
    /// CPU applies any rotation the instruction calls for.
    fn read16(&mut self, addr: u32) -> u16;
    fn read32(&mut self, addr: u32) -> u32;
    fn write8(&mut self, addr: u32, value: u8);
    fn write16(&mut self, addr: u32, value: u16);
    fn write32(&mut self, addr: u32, value: u32);
    /// Account for internal (non-memory) cycles.
    fn tick(&mut self, cycles: u32);

    /// Announce the address the CPU is about to fetch from.
    ///
    /// BIOS memory is readable only while the CPU is executing inside it, and
    /// that has to be decided by the fetch itself: an exception vector is
    /// entered and fetched within a single step, so anything keyed to the
    /// previous instruction's address reads the open-bus latch instead of the
    /// handler and sends the CPU somewhere arbitrary.
    fn on_fetch(&mut self, _addr: u32) {}
}
