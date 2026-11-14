import { decodeQR } from 'qr/decode.js'

/**
 * The QR reader (round 11, item 23: `BarcodeDetector` is not on iOS, so a small library reads the code). The library is
 * `qr` by Paul Miller (`qr/decode.js`: the reader only, pure JavaScript, no WebAssembly and no worker, so the page's
 * Content-Security-Policy of decision 8 needs nothing more). This file is the ONLY importer of it, and
 * `camera.ts` loads this file with `import()`: the reader is a chunk of its own, fetched when "Scan a code" opens, not
 * in the first load.
 */

/** One camera frame as RGBA pixels (a canvas's `ImageData`). */
export interface Frame {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

/** The code's text, or null when the frame holds no code that reads. Never throws. */
export function readQr(frame: Frame): string | null {
  try {
    return decodeQR(frame, { format: 'RGBA' })
  } catch {
    return null
  }
}
