//! Explicit, ordered state serialization.
//!
//! Deliberately hand-written rather than derived. Save states are the one
//! place where a silent layout change corrupts a playthrough, so the format
//! is a sequence someone can read, versioned, and refused outright on
//! mismatch instead of being interpreted optimistically.

pub const STATE_MAGIC: u32 = 0x5342_4147; // "GABS" little-endian
/// Bump on every change to the state layout. A state from a different version
/// is refused, never coerced.
pub const STATE_VERSION: u32 = 2;

#[derive(Debug, PartialEq, Eq)]
pub enum StateError {
    BadMagic,
    VersionMismatch { found: u32, expected: u32 },
    Truncated,
    Corrupt(&'static str),
}

#[derive(Default)]
pub struct Writer {
    pub buf: Vec<u8>,
}

impl Writer {
    pub fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }
    pub fn bool(&mut self, v: bool) {
        self.buf.push(v as u8);
    }
    pub fn u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u64(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn bytes(&mut self, v: &[u8]) {
        self.u32(v.len() as u32);
        self.buf.extend_from_slice(v);
    }
}

pub struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8]) -> Reader<'a> {
        Reader { data, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], StateError> {
        let end = self.pos.checked_add(n).ok_or(StateError::Truncated)?;
        let slice = self.data.get(self.pos..end).ok_or(StateError::Truncated)?;
        self.pos = end;
        Ok(slice)
    }

    pub fn u8(&mut self) -> Result<u8, StateError> {
        Ok(self.take(1)?[0])
    }
    pub fn bool(&mut self) -> Result<bool, StateError> {
        Ok(self.u8()? != 0)
    }
    pub fn u16(&mut self) -> Result<u16, StateError> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    pub fn u32(&mut self) -> Result<u32, StateError> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    pub fn u64(&mut self) -> Result<u64, StateError> {
        let b = self.take(8)?;
        Ok(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }
    pub fn bytes(&mut self) -> Result<&'a [u8], StateError> {
        let len = self.u32()? as usize;
        self.take(len)
    }

    /// Read into a fixed buffer, refusing a length that does not match.
    pub fn bytes_into(&mut self, dest: &mut [u8]) -> Result<(), StateError> {
        let src = self.bytes()?;
        if src.len() != dest.len() {
            return Err(StateError::Corrupt("region size changed"));
        }
        dest.copy_from_slice(src);
        Ok(())
    }
}
