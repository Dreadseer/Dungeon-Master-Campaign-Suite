import { describe, it, expect } from 'vitest'
import imageSize from '../imageSize.js'

const { imageSizeFromBuffer, imageSizeFromFile } = imageSize

// Real headers, built byte by byte. Each fixture is the actual signature and
// dimension encoding for its format — not a mock, so a bug in the reader shows
// up here rather than on a DM's battle map.

const png = (w, h) => {
  const buf = Buffer.alloc(24)
  buf.writeUInt32BE(0x89504e47, 0)
  buf.writeUInt32BE(0x0d0a1a0a, 4)
  buf.writeUInt32BE(13, 8)            // IHDR length
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(w, 16)
  buf.writeUInt32BE(h, 20)
  return buf
}

const gif = (w, h, sig = 'GIF89a') => {
  const buf = Buffer.alloc(10)
  buf.write(sig, 0, 'ascii')
  buf.writeUInt16LE(w, 6)
  buf.writeUInt16LE(h, 8)
  return buf
}

// A JPEG with `leadingSegments` filler segments before the SOF, so the scanner
// is actually exercised rather than finding the answer at a fixed offset.
const jpeg = (w, h, { marker = 0xc0, leadingSegments = 0 } = {}) => {
  const parts = [Buffer.from([0xff, 0xd8])]
  for (let i = 0; i < leadingSegments; i++) {
    const payload = Buffer.alloc(100, 0x20)
    const seg = Buffer.alloc(4 + payload.length)
    seg[0] = 0xff
    seg[1] = 0xe0 + (i % 8)           // APPn
    seg.writeUInt16BE(payload.length + 2, 2)
    payload.copy(seg, 4)
    parts.push(seg)
  }
  const sof = Buffer.alloc(11)
  sof[0] = 0xff
  sof[1] = marker
  sof.writeUInt16BE(8 + 1, 2)         // segment length
  sof[4] = 8                          // precision
  sof.writeUInt16BE(h, 5)
  sof.writeUInt16BE(w, 7)
  sof[9] = 3                          // component count
  parts.push(sof)
  return Buffer.concat(parts)
}

const webpLossy = (w, h) => {
  const buf = Buffer.alloc(30)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(22, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8 ', 12, 'ascii')
  buf.writeUInt16LE(w, 26)
  buf.writeUInt16LE(h, 28)
  return buf
}

const webpLossless = (w, h) => {
  const buf = Buffer.alloc(30)
  buf.write('RIFF', 0, 'ascii')
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8L', 12, 'ascii')
  buf[20] = 0x2f
  buf.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21)
  return buf
}

const webpExtended = (w, h) => {
  const buf = Buffer.alloc(30)
  buf.write('RIFF', 0, 'ascii')
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8X', 12, 'ascii')
  const wm = w - 1
  const hm = h - 1
  buf[24] = wm & 0xff; buf[25] = (wm >> 8) & 0xff; buf[26] = (wm >> 16) & 0xff
  buf[27] = hm & 0xff; buf[28] = (hm >> 8) & 0xff; buf[29] = (hm >> 16) & 0xff
  return buf
}

describe('PNG', () => {
  it('reads dimensions from the IHDR chunk', () => {
    expect(imageSizeFromBuffer(png(1024, 768))).toEqual({ width: 1024, height: 768 })
  })

  it('handles a large battle map', () => {
    expect(imageSizeFromBuffer(png(8000, 6000))).toEqual({ width: 8000, height: 6000 })
  })

  it('handles a 1x1 image', () => {
    expect(imageSizeFromBuffer(png(1, 1))).toEqual({ width: 1, height: 1 })
  })

  it('rejects a correct signature with the wrong chunk type', () => {
    const buf = png(100, 100)
    buf.write('IDAT', 12, 'ascii')
    expect(imageSizeFromBuffer(buf)).toBeNull()
  })

  it('rejects a truncated header', () => {
    expect(imageSizeFromBuffer(png(100, 100).subarray(0, 20))).toBeNull()
  })
})

describe('GIF', () => {
  it('reads GIF89a', () => {
    expect(imageSizeFromBuffer(gif(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('reads GIF87a', () => {
    expect(imageSizeFromBuffer(gif(320, 200, 'GIF87a'))).toEqual({ width: 320, height: 200 })
  })

  it('rejects a near-miss signature', () => {
    expect(imageSizeFromBuffer(gif(320, 200, 'GIF90a'))).toBeNull()
  })
})

describe('JPEG', () => {
  it('reads a baseline SOF0', () => {
    expect(imageSizeFromBuffer(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  it('reads a progressive SOF2', () => {
    expect(imageSizeFromBuffer(jpeg(800, 600, { marker: 0xc2 }))).toEqual({ width: 800, height: 600 })
  })

  it('scans past leading APPn segments (EXIF, JFIF, colour profiles)', () => {
    expect(imageSizeFromBuffer(jpeg(1200, 900, { leadingSegments: 12 })))
      .toEqual({ width: 1200, height: 900 })
  })

  it('does not mistake DHT (0xC4) for a frame marker', () => {
    // 0xC4 sits inside the SOF numeric range but carries Huffman tables, not
    // dimensions. Reading it as a frame yields garbage.
    const parts = [Buffer.from([0xff, 0xd8])]
    const dht = Buffer.alloc(24)
    dht[0] = 0xff; dht[1] = 0xc4
    dht.writeUInt16BE(22, 2)
    dht.writeUInt16BE(9999, 5)        // would be "height" if misread
    dht.writeUInt16BE(8888, 7)
    parts.push(dht)
    parts.push(jpeg(640, 400).subarray(2))
    expect(imageSizeFromBuffer(Buffer.concat(parts))).toEqual({ width: 640, height: 400 })
  })

  it('tolerates 0xFF fill bytes between segments', () => {
    const base = jpeg(500, 400)
    const padded = Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xff]), base.subarray(2)])
    expect(imageSizeFromBuffer(padded)).toEqual({ width: 500, height: 400 })
  })

  it('returns null when the scan reaches SOS without a frame', () => {
    expect(imageSizeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x0c, 0, 0, 0, 0, 0, 0])))
      .toBeNull()
  })
})

describe('WebP', () => {
  it('reads lossy VP8', () => {
    expect(imageSizeFromBuffer(webpLossy(1280, 720))).toEqual({ width: 1280, height: 720 })
  })

  it('reads lossless VP8L', () => {
    expect(imageSizeFromBuffer(webpLossless(1024, 768))).toEqual({ width: 1024, height: 768 })
  })

  it('reads extended VP8X', () => {
    expect(imageSizeFromBuffer(webpExtended(4096, 2160))).toEqual({ width: 4096, height: 2160 })
  })

  it('masks the VP8 scaling bits out of the dimensions', () => {
    // The top two bits of each uint16 are a scale factor, not size.
    const buf = webpLossy(1000, 800)
    buf.writeUInt16LE(1000 | (0b11 << 14), 26)
    buf.writeUInt16LE(800 | (0b10 << 14), 28)
    expect(imageSizeFromBuffer(buf)).toEqual({ width: 1000, height: 800 })
  })

  it('rejects RIFF that is not WEBP', () => {
    const buf = webpLossy(100, 100)
    buf.write('WAVE', 8, 'ascii')
    expect(imageSizeFromBuffer(buf)).toBeNull()
  })

  it('rejects an unknown WebP chunk type', () => {
    const buf = webpLossy(100, 100)
    buf.write('ANIM', 12, 'ascii')
    expect(imageSizeFromBuffer(buf)).toBeNull()
  })
})

describe('unmeasurable input returns null, never a guess', () => {
  it('rejects empty and nullish input', () => {
    for (const value of [null, undefined, Buffer.alloc(0), new Uint8Array(0)]) {
      expect(imageSizeFromBuffer(value)).toBeNull()
    }
  })

  it('rejects arbitrary bytes', () => {
    expect(imageSizeFromBuffer(Buffer.from('this is not an image at all, it is prose'))).toBeNull()
  })

  it('rejects a PDF, which the compendium importer does handle elsewhere', () => {
    expect(imageSizeFromBuffer(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'))).toBeNull()
  })

  it('rejects an SVG — text, not a raster header', () => {
    expect(imageSizeFromBuffer(Buffer.from('<svg width="100" height="100"></svg>'))).toBeNull()
  })

  it('never returns a zero dimension', () => {
    expect(imageSizeFromBuffer(png(0, 100))).toBeNull()
    expect(imageSizeFromBuffer(png(100, 0))).toBeNull()
  })

  it('accepts a Uint8Array as readily as a Buffer', () => {
    expect(imageSizeFromBuffer(new Uint8Array(png(200, 300)))).toEqual({ width: 200, height: 300 })
  })
})

describe('imageSizeFromFile', () => {
  // A minimal injectable fs, so the test touches no real disk.
  const fakeFs = (contents) => ({
    openSync: (p) => {
      if (!(p in contents)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
      return 42
    },
    readSync: (_fd, buf, _off, len, _pos) => {
      const data = contents[Object.keys(contents)[0]]
      const n = Math.min(len, data.length)
      data.copy(buf, 0, 0, n)
      return n
    },
    closeSync: () => {},
  })

  it('measures a file it can read', () => {
    const fs = fakeFs({ 'C:/maps/town.png': png(1500, 1000) })
    expect(imageSizeFromFile('C:/maps/town.png', fs)).toEqual({ width: 1500, height: 1000 })
  })

  it('returns null for a missing file instead of throwing', () => {
    const fs = fakeFs({ 'C:/maps/town.png': png(100, 100) })
    expect(imageSizeFromFile('C:/maps/gone.png', fs)).toBeNull()
  })

  it('returns null for a null path', () => {
    expect(imageSizeFromFile(null, fakeFs({}))).toBeNull()
  })

  it('closes the descriptor even when parsing fails', () => {
    let closed = false
    const fs = {
      openSync: () => 7,
      readSync: (_fd, buf) => { Buffer.from('garbage').copy(buf); return 7 },
      closeSync: () => { closed = true },
    }
    expect(imageSizeFromFile('x', fs)).toBeNull()
    expect(closed).toBe(true)
  })

  it('returns null when the read itself throws', () => {
    const fs = {
      openSync: () => 7,
      readSync: () => { throw new Error('EIO') },
      closeSync: () => {},
    }
    expect(imageSizeFromFile('x', fs)).toBeNull()
  })
})
