/**
 * Zero-dependency local QR Code SVG generator (YAZ-6200 Item 6).
 * Implements standard ISO/IEC 18004 Byte-mode QR Code (Versions 1–6, EC level L)
 * so invite links (`https://docs.yaseenarshad.com/friend#<code>`) render as real,
 * camera-scannable SVGs offline with zero network calls.
 */

// GF(256) with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}

const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]])

function rsGenPoly(ecLen: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i])
    }
    poly = next
  }
  return poly
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenPoly(ecLen)
  const out = new Uint8Array(ecLen)
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ out[0]
    out.copyWithin(0, 1)
    out[ecLen - 1] = 0
    for (let j = 0; j < ecLen; j++) out[j] ^= gfMul(gen[j + 1], factor)
  }
  return out
}

// Versions 1–6, EC level L (single-block for V1-V5, 2-block for V6): [version, size, dataCodewords, ecPerBlock, blocks, alignPos[]]
const VERSIONS: readonly [number, number, number, number, number, readonly number[]][] = [
  [1, 21, 19, 7, 1, []],
  [2, 25, 34, 10, 1, [6, 18]],
  [3, 29, 55, 15, 1, [6, 22]],
  [4, 33, 80, 20, 1, [6, 26]],
  [5, 37, 108, 26, 1, [6, 30]],
  [6, 41, 136, 18, 2, [6, 34]],
]

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  const spec = VERSIONS.find(([, , dc]) => bytes.length + 2 <= dc) ?? VERSIONS[VERSIONS.length - 1]
  const [, size, totalData, ecPerBlock, blocks, align] = spec

  // Build bit stream: 0100 (byte mode) + 8-bit length + bytes + terminator + pad bytes
  const bits: number[] = []
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1)
  }
  pushBits(0b0100, 4)
  pushBits(Math.min(bytes.length, totalData - 2), 8)
  for (let i = 0; i < Math.min(bytes.length, totalData - 2); i++) pushBits(bytes[i], 8)
  pushBits(0, Math.min(4, totalData * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const data = new Uint8Array(totalData)
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]
    data[i] = b
  }
  const padBytes = [0xec, 0x11]
  for (let i = bits.length / 8, p = 0; i < totalData; i++, p ^= 1) data[i] = padBytes[p]

  // Split into blocks & compute Reed-Solomon EC
  const blockLen = totalData / blocks
  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  for (let b = 0; b < blocks; b++) {
    const slice = data.subarray(b * blockLen, (b + 1) * blockLen)
    dataBlocks.push(slice)
    ecBlocks.push(rsEncode(slice, ecPerBlock))
  }
  const codewords: number[] = []
  for (let i = 0; i < blockLen; i++) for (let b = 0; b < blocks; b++) codewords.push(dataBlocks[b][i])
  for (let i = 0; i < ecPerBlock; i++) for (let b = 0; b < blocks; b++) codewords.push(ecBlocks[b][i])

  const mat: (boolean | null)[][] = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null))
  const func: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const setFunc = (r: number, c: number, v: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mat[r][c] = v
      func[r][c] = true
    }
  }

  // Finder patterns + separators
  const drawFinder = (tr: number, tc: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6
        const dark = inOuter && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))
        setFunc(tr + r, tc + c, dark)
      }
    }
  }
  drawFinder(0, 0)
  drawFinder(0, size - 7)
  drawFinder(size - 7, 0)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0)
    setFunc(i, 6, i % 2 === 0)
  }

  // Alignment patterns
  for (const r of align) {
    for (const c of align) {
      if ((r < 9 && c < 9) || (r < 9 && c > size - 9) || (r > size - 9 && c < 9)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunc(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
        }
      }
    }
  }

  // Reserve format info + dark module
  for (let i = 0; i < 9; i++) {
    if (!func[8][i]) setFunc(8, i, false)
    if (!func[i][8]) setFunc(i, 8, false)
  }
  for (let i = 0; i < 8; i++) {
    setFunc(8, size - 1 - i, false)
    setFunc(size - 1 - i, 8, false)
  }
  setFunc(size - 8, 8, true)

  // Place data bits with mask 0 ((r + c) % 2 === 0)
  let bitIdx = 0
  const totalBits = codewords.length * 8
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    const upward = ((right + 1) & 2) === 0
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j++) {
        const c = right - j
        if (func[r][c]) continue
        const bit = bitIdx < totalBits ? ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1 : false
        bitIdx++
        mat[r][c] = (r + c) % 2 === 0 ? !bit : bit
      }
    }
  }

  // Format bits for EC level L (01) + Mask 0 (000) -> 01000 -> BCH(15,5) ^ 0x5412 = 0x77c4
  const fmt = 0x77c4
  for (let i = 0; i <= 5; i++) setFunc(8, i, ((fmt >> (14 - i)) & 1) === 1)
  setFunc(8, 7, ((fmt >> 8) & 1) === 1)
  setFunc(8, 8, ((fmt >> 7) & 1) === 1)
  setFunc(7, 8, ((fmt >> 6) & 1) === 1)
  for (let i = 9; i < 15; i++) setFunc(14 - i, 8, ((fmt >> (14 - i)) & 1) === 1)
  for (let i = 0; i < 8; i++) setFunc(8, size - 1 - i, ((fmt >> i) & 1) === 1)
  for (let i = 8; i < 15; i++) setFunc(size - 15 + i, 8, ((fmt >> i) & 1) === 1)

  return mat.map((row) => row.map((v) => v === true))
}

/** Renders a clean SVG string for any invite URL. */
export function qrCodeSvg(text: string, quietZone = 2): string {
  const m = encodeQrMatrix(text)
  const dim = m.length + quietZone * 2
  const parts: string[] = []
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (m[r][c]) parts.push(`M${c + quietZone},${r + quietZone}h1v1h-1z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="Invite QR code"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${parts.join('')}" fill="#000"/></svg>`
}
