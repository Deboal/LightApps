//! A minimal PNG writer, so a headless run can be looked at.
//!
//! Uses stored (uncompressed) deflate blocks: a real compressor would be a
//! dependency, and the only consumer is a developer squinting at a frame.

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for byte in data {
        a = (a + *byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    let mut framed = kind.to_vec();
    framed.extend_from_slice(body);
    out.extend_from_slice(&framed);
    out.extend_from_slice(&crc32(&framed).to_be_bytes());
}

/// Encode a BGR555 framebuffer as an RGB PNG, scaled by nearest neighbour.
pub fn encode(framebuffer: &[u16], width: usize, height: usize, scale: usize) -> Vec<u8> {
    let (out_width, out_height) = (width * scale, height * scale);

    let mut raw = Vec::with_capacity(out_height * (1 + out_width * 3));
    for y in 0..out_height {
        raw.push(0); // filter type: none
        for x in 0..out_width {
            let color = framebuffer[(y / scale) * width + (x / scale)];
            // BGR555 to RGB888, replicating the top bits into the low ones so
            // white stays white.
            for shift in [0, 5, 10] {
                let channel = ((color >> shift) & 0x1F) as u8;
                raw.push((channel << 3) | (channel >> 2));
            }
        }
    }

    let mut zlib = vec![0x78, 0x01];
    for (index, block) in raw.chunks(0xFFFF).enumerate() {
        let last = (index + 1) * 0xFFFF >= raw.len();
        zlib.push(last as u8);
        zlib.extend_from_slice(&(block.len() as u16).to_le_bytes());
        zlib.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut header = Vec::new();
    header.extend_from_slice(&(out_width as u32).to_be_bytes());
    header.extend_from_slice(&(out_height as u32).to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]); // 8 bits, truecolour RGB
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &zlib);
    chunk(&mut png, b"IEND", &[]);
    png
}
