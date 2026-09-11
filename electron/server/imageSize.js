// Pixel dimensions of an image, read from its header bytes.
//
// Why this exists: server-side fog filtering (fogFilter.js) needs numCols to
// index the fog mask, and numCols is ceil(imageWidth / gridSize) — the renderer
// gets imageWidth for free from a loaded <img>, the main process does not. The
// tech stack is locked, so no image library. Every format the app can actually
// produce stores its dimensions in a fixed, documented header, and reading them
// is a few dozen lines of byte arithmetic.
//
// Supported: PNG, JPEG, GIF, WebP (all three VP8 variants). That is exactly the
// set the file picker accepts (fileHandlers.js allows png/jpg/jpeg/webp) plus
// GIF for safety.
//
// Returns null when the format is unrecognised or the header is malformed.
// Callers MUST treat null as "cannot measure" and fail closed — guessing a size
// here would mean guessing which fog cells are revealed, which is a leak.

// ── PNG ──────────────────────────────────────────────────────────────────────
// 8-byte signature, then the IHDR chunk: 4-byte length, 4-byte type, then
// width and height as big-endian uint32 at offsets 16 and 20.
function pngSize(buf) {
  if (buf.length < 24) return null
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// ── GIF ──────────────────────────────────────────────────────────────────────
// 'GIF87a' or 'GIF89a', then the logical screen descriptor: width and height as
// little-endian uint16 at offsets 6 and 8.
function gifSize(buf) {
  if (buf.length < 10) return null
  const sig = buf.toString('ascii', 0, 6)
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
}

// ── JPEG ─────────────────────────────────────────────────────────────────────
// SOI (FFD8), then a chain of segments. Dimensions live in whichever Start Of
// Frame marker appears — SOF0 through SOF15, excluding the non-frame markers
// C4 (DHT), C8 (JPG extension) and CC (DAC). Height precedes width.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpegSize(buf) {
  if (buf.length < 4) return null
  if (buf.readUInt16BE(0) !== 0xffd8) return null

  let offset = 2
  while (offset + 9 < buf.length) {
    // Segments start with 0xFF; padding bytes of 0xFF are legal between them.
    if (buf[offset] !== 0xff) { offset++; continue }

    const marker = buf[offset + 1]
    if (marker === 0xff) { offset++; continue }          // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2                                         // standalone, no payload
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null    // EOI / start of scan

    const length = buf.readUInt16BE(offset + 2)
    if (length < 2) return null                            // malformed

    if (SOF_MARKERS.has(marker)) {
      // payload: 1 byte precision, 2 bytes height, 2 bytes width
      if (offset + 9 > buf.length) return null
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) }
    }

    offset += 2 + length
  }
  return null
}

// ── WebP ─────────────────────────────────────────────────────────────────────
// 'RIFF' + 4-byte size + 'WEBP', then one of three chunk types.
function webpSize(buf) {
  if (buf.length < 30) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null

  const chunk = buf.toString('ascii', 12, 16)

  // Lossy: 'VP8 ' — 3-byte frame tag, 3-byte sync code, then 14-bit width and
  // height (the top two bits of each uint16 are the scaling factor).
  if (chunk === 'VP8 ') {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    }
  }

  // Lossless: 'VP8L' — 1-byte signature (0x2f), then 14 bits width and 14 bits
  // height packed across the next four bytes, each stored minus one.
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null
    const bits = buf.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  // Extended: 'VP8X' — canvas width and height as 24-bit little-endian, each
  // stored minus one.
  if (chunk === 'VP8X') {
    return {
      width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
      height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
    }
  }

  return null
}

const READERS = [pngSize, gifSize, jpegSize, webpSize]

/**
 * Measure an image from its bytes.
 *
 * @param {Buffer|Uint8Array} bytes
 * @returns {{ width: number, height: number } | null} null when unmeasurable
 */
function imageSizeFromBuffer(bytes) {
  if (!bytes || bytes.length === 0) return null
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

  for (const read of READERS) {
    let size = null
    try {
      size = read(buf)
    } catch {
      size = null   // truncated header — try the next reader
    }
    if (size && size.width > 0 && size.height > 0) return size
  }
  return null
}

/**
 * Measure an image on disk, reading only the head of the file.
 *
 * JPEG dimensions can sit behind a large EXIF thumbnail, so the default read is
 * generous; it is still a few KB rather than a whole battle map.
 *
 * @returns {{ width: number, height: number } | null}
 */
function imageSizeFromFile(filePath, fs = require('fs'), maxBytes = 65536) {
  if (!filePath) return null
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(maxBytes)
    const read = fs.readSync(fd, buf, 0, maxBytes, 0)
    return imageSizeFromBuffer(buf.subarray(0, read))
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* already closed */ }
    }
  }
}

module.exports = { imageSizeFromBuffer, imageSizeFromFile }
