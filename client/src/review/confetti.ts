/**
 * ONE BURST OF CONFETTI (YAZ-5043 item 13, Yaseen: "make it great natural looking confetti, i think salesforce has a
 * great style"): loaded only when Due today is done (`DueTodayEnd`, a dynamic import), no library. About 2 s on one
 * canvas over the Inbox (never the whole window): pieces of a few shapes and colours shoot up from the ring, slow
 * down in the air, fall with gravity, drift, spin and flutter (each piece turns in 3D: its height follows a cosine),
 * and fade at the end. It plays once; the canvas goes away after it.
 */

const COLOURS = ['#3a9d5d', '#4fb573', '#5b6cff', '#7c8aff', '#e0b341', '#f2c94c', '#e06c6c', '#d6457a', '#2bb3c0', '#f08a4b']
const SHAPES = ['rect', 'strip', 'circle', 'triangle'] as const
const PIECES = 110
const LIFE = 2000

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  colour: string
  shape: (typeof SHAPES)[number]
  spin: number
  turn: number
  flip: number
  flipSpeed: number
  wobble: number
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

/** The pieces, all from (x, y): a fan upward, wider than tall, so they spread before they fall. */
export function confettiPieces(x: number, y: number, count = PIECES): Piece[] {
  return Array.from({ length: count }, () => {
    const angle = rand(-Math.PI * 0.92, -Math.PI * 0.08)
    const speed = rand(3.5, 9)
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(0.5, 2),
      size: rand(5, 10),
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      spin: rand(0, Math.PI * 2),
      turn: rand(-0.2, 0.2),
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(0.08, 0.22),
      wobble: rand(0, Math.PI * 2),
    }
  })
}

/** One frame of a piece (per 1/60 s): air slows it, gravity pulls it, it drifts side to side and turns. */
export function stepPiece(p: Piece, dt: number): void {
  const drag = Math.pow(0.965, dt)
  p.vx *= drag
  p.vy = p.vy * drag + 0.28 * dt
  p.wobble += 0.09 * dt
  p.x += (p.vx + Math.sin(p.wobble) * 0.6) * dt
  p.y += p.vy * dt
  p.spin += p.turn * dt
  p.flip += p.flipSpeed * dt
}

function draw(ctx: CanvasRenderingContext2D, p: Piece, alpha: number): void {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.spin)
  // The flutter: a piece seen edge-on is thin, and its back a touch darker.
  const face = Math.cos(p.flip)
  ctx.scale(1, Math.max(0.08, Math.abs(face)))
  ctx.globalAlpha = alpha * (face < 0 ? 0.8 : 1)
  ctx.fillStyle = p.colour
  const s = p.size
  if (p.shape === 'rect') ctx.fillRect(-s / 2, -s / 3, s, (s * 2) / 3)
  else if (p.shape === 'strip') ctx.fillRect(-s * 0.8, -s / 6, s * 1.6, s / 3)
  else if (p.shape === 'circle') {
    ctx.beginPath()
    ctx.arc(0, 0, s / 2.4, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(0, -s / 2)
    ctx.lineTo(s / 2, s / 2)
    ctx.lineTo(-s / 2, s / 2)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/**
 * How the phone plays it (YAZ-5495): over its Review screen (`within`), its canvas at most `maxDpr` (a phone's 3× costs
 * nine times the pixels), and fewer pieces on a small screen.
 */
export interface ConfettiOptions {
  within?: Element | null
  maxDpr?: number
  pieces?: number
}

/** Plays the burst from the middle of `from`, over the Inbox that holds it. Returns a stop (the canvas goes). */
export function confettiBurst(from: Element, options: ConfettiOptions = {}): () => void {
  const area = (options.within ?? from.closest('.card-inbox') ?? document.body).getBoundingClientRect()
  const ring = from.getBoundingClientRect()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (ctx === null) return () => undefined
  const dpr = Math.min(window.devicePixelRatio || 1, options.maxDpr ?? Infinity)
  canvas.className = 'due-end-confetti'
  Object.assign(canvas.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px` })
  canvas.width = Math.round(area.width * dpr)
  canvas.height = Math.round(area.height * dpr)
  ctx.scale(dpr, dpr)
  document.body.appendChild(canvas)
  const pieces = confettiPieces(ring.left + ring.width / 2 - area.left, ring.top + ring.height / 2 - area.top, options.pieces)
  let start: number | null = null
  let last = 0
  let frame = 0
  const stop = () => {
    cancelAnimationFrame(frame)
    canvas.remove()
  }
  const tick = (now: number) => {
    if (start === null) start = last = now
    const t = now - start
    if (t >= LIFE) return stop()
    const dt = Math.min(3, (now - last) / (1000 / 60))
    last = now
    // Full for the first 60%, then a soft fade.
    const alpha = t < LIFE * 0.6 ? 1 : 1 - (t - LIFE * 0.6) / (LIFE * 0.4)
    ctx.clearRect(0, 0, area.width, area.height)
    for (const p of pieces) {
      stepPiece(p, dt)
      draw(ctx, p, alpha)
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return stop
}
