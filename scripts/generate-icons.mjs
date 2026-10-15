// Deterministic PNGs, without external fonts or image dependencies. The N stays inside
// the central maskable safe area. Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const directory = new URL('../public/icons/', import.meta.url)
mkdirSync(directory, { recursive: true })
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4)
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(payload))
  return Buffer.concat([size, payload, crc])
}
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['maskable-512', 512], ['apple-touch-icon', 180]]) {
  const pixels = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let coverage = 0
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const u = (x + (sx + .5) / 4) / size, v = (y + (sy + .5) / 4) / size
      if (v >= .30 && v <= .70 && ((u >= .28 && u <= .37) || (u >= .63 && u <= .72) || (u >= .34 && u <= .66 && Math.abs(v - (.30 + (u - .34) * 1.25)) < .065))) coverage++
    }
    const offset = y * (size * 3 + 1) + 1 + x * 3
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round([23, 63, 53][channel] + ([231, 242, 184][channel] - [23, 63, 53][channel]) * coverage / 16)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  writeFileSync(new URL(`${name}.png`, directory), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]))
}
