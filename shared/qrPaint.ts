/**
 * Paints a QR grid (YAZ-5098 "Connect your phone"): black squares on white, with the quiet zone of 4 squares that
 * readers need. Pure, so a test can read back what the renderer paints with the phone's own reader. The renderer
 * paints on a canvas (`ConnectPhoneSheet`): pixels, never text or an attribute that holds the code.
 */

/** The white border around the code, in squares (the QR standard's quiet zone). */
export const QR_QUIET = 4

/** The part of a canvas 2D context this needs. */
export interface QrPainter {
  fillStyle: unknown
  fillRect(x: number, y: number, w: number, h: number): void
}

/** Paints `grid` at `scale` pixels a square, from (0, 0). Returns the side in pixels. Black on white in each theme: a camera reads that best. */
export function paintQr(ctx: QrPainter, grid: readonly (readonly boolean[])[], scale: number): number {
  const side = (grid.length + 2 * QR_QUIET) * scale
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, side, side)
  ctx.fillStyle = '#000'
  grid.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + QR_QUIET) * scale, (y + QR_QUIET) * scale, scale, scale)
    }),
  )
  return side
}
