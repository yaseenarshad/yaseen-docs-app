import { readFileSync } from 'node:fs'
import encodeQR from 'qr'
import { describe, expect, it } from 'vitest'
import { formatScanCode, parseScanCode } from '../auth/scanCode'
import { readQr } from './qrDecode'

/** A code drawn as the Mac draws it: black modules on white, 6 px a module, a quiet zone of 4. As RGBA pixels. */
function frameOf(text: string) {
  const grid = encodeQR(text, 'raw')
  const scale = 6
  const side = (grid.length + 8) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  grid.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4
          data[i] = data[i + 1] = data[i + 2] = 0
        }
    }),
  )
  return { width: side, height: side, data }
}

describe('the QR reader (the library, with no camera)', () => {
  it("reads the Mac's code, and the text parses to the same values", () => {
    const code = { repo: 'yaseen/vault', branch: 'main', token: 'github_pat_11ABCDEFG0' + 'x'.repeat(72), expiresAt: '2026-11-20T00:00:00.000Z' }
    const text = readQr(frameOf(formatScanCode(code)))
    expect(text).not.toBeNull()
    expect(parseScanCode(text!)).toEqual({ ok: true, code })
  })

  it('gives null for a frame with no code', () => {
    expect(readQr({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) })).toBeNull()
  })

  it('only qrDecode.ts imports the library, and the camera loads it with import(), so it is not in the first load', () => {
    const camera = readFileSync(new URL('./camera.ts', import.meta.url), 'utf8')
    expect(camera).toMatch(/import\('\.\/qrDecode'\)/)
    expect(camera).not.toMatch(/^import .*qrDecode/m)
    expect(camera).not.toMatch(/from 'qr/)
  })
})
