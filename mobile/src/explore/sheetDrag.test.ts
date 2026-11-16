import { describe, expect, it } from 'vitest'
import { CLOSE_FRACTION, DECIDE_PX, FLICK_SPEED, SHEET_MS, releaseMs, sheetDrag } from './sheetDrag'

/** YAZ-5472: the drag down of a sheet, its thresholds, its flick and its hand-off between scroll and drag. */
const H = 800

/** A finger from `y0` down by `dy` in `steps` moves, `ms` apart; returns the last offset. */
function pull(d = sheetDrag(), opts: { from?: 'head' | 'body'; atTop?: boolean; dy: number; steps?: number; ms?: number; t0?: number }) {
  const { from = 'body', atTop = true, dy, steps = 20, ms = 16, t0 = 0 } = opts
  d.start(100, 300, t0, from)
  let last: { offset: number | null; claim: boolean } = { offset: null, claim: false }
  for (let i = 1; i <= steps; i++) last = d.move(100, 300 + (dy * i) / steps, t0 + i * ms, atTop)
  return { d, last, t: t0 + steps * ms }
}

describe('a sheet drag (YAZ-5472)', () => {
  it('follows the finger 1:1 from the head at any scroll place, and from the body at its top', () => {
    const head = pull(undefined, { from: 'head', atTop: false, dy: 200 })
    expect(head.last.claim).toBe(true)
    // 1:1 from where the finger came down.
    expect(head.last.offset).toBe(200)
    const body = pull(undefined, { from: 'body', atTop: true, dy: 200 })
    expect(body.last).toEqual({ offset: head.last.offset, claim: true })
  })

  it('lets the body scroll: up at the top, or down when scrolled', () => {
    expect(pull(undefined, { atTop: true, dy: -200 }).last).toEqual({ offset: null, claim: false })
    expect(pull(undefined, { atTop: false, dy: 200 }).last).toEqual({ offset: null, claim: false })
  })

  it('waits for the first few px to decide, and leaves a sideways move alone', () => {
    const d = sheetDrag()
    d.start(100, 300, 0, 'body')
    expect(d.move(100, 300 + DECIDE_PX - 1, 10, true)).toEqual({ offset: null, claim: false })
    expect(d.dragging).toBe(false)
    const side = sheetDrag()
    side.start(10, 300, 0, 'head')
    expect(side.move(60, 310, 16, true)).toEqual({ offset: null, claim: false })
    expect(side.move(60, 500, 32, true)).toEqual({ offset: null, claim: false })
  })

  it('hands a scroll that reaches the top and keeps going down to the drag, in the same touch', () => {
    const d = sheetDrag()
    d.start(100, 300, 0, 'body')
    // A scroll down the page (the finger goes up), then back up to the top (the finger goes down).
    expect(d.move(100, 280, 16, false).offset).toBeNull()
    expect(d.move(100, 320, 32, false).offset).toBeNull()
    expect(d.move(100, 340, 48, true)).toEqual({ offset: 0, claim: true })
    expect(d.move(100, 400, 64, true)).toEqual({ offset: 60, claim: true })
  })

  it('closes past a quarter of the height, else springs back', () => {
    const far = pull(undefined, { dy: H * CLOSE_FRACTION + 20, steps: 40, ms: 30 })
    expect(far.d.end(far.t + 200, H).kind).toBe('close')
    const near = pull(undefined, { dy: H * CLOSE_FRACTION - 40, steps: 40, ms: 30 })
    expect(near.d.end(near.t + 200, H).kind).toBe('stay')
  })

  it('closes on a fast flick down, not on a twitch, and never on a flick up', () => {
    // 120 px in 80 ms: 1.5 px/ms, well over the flick's speed.
    const flick = pull(undefined, { dy: 126, steps: 6, ms: 16 })
    const end = flick.d.end(flick.t + 5, H)
    expect(end.kind).toBe('close')
    expect(end.kind === 'close' && end.speed).toBeGreaterThan(FLICK_SPEED)
    const twitch = pull(undefined, { dy: 18, steps: 2, ms: 8 })
    expect(twitch.d.end(twitch.t + 2, H).kind).toBe('stay')
    // Down far, then a flick back up: it stays.
    const d = sheetDrag()
    d.start(100, 100, 0, 'head')
    for (let i = 1; i <= 20; i++) d.move(100, 100 + i * 20, i * 16, true)
    for (let i = 1; i <= 4; i++) d.move(100, 500 - i * 40, 320 + i * 16, true)
    expect(d.end(390, H).kind).toBe('stay')
  })

  it('a finger that stopped before it lifted is no flick', () => {
    const slow = pull(undefined, { dy: 120, steps: 6, ms: 16 })
    expect(slow.d.end(slow.t + 300, H).kind).toBe('stay')
  })

  it('gives a little upward from the head; from the body it stops at its place', () => {
    const head = pull(undefined, { from: 'head', dy: -100 })
    expect(head.last.offset).toBeLessThan(0)
    expect(head.last.offset).toBeGreaterThan(-25)
    const d = sheetDrag()
    d.start(100, 300, 0, 'body')
    d.move(100, 320, 16, true)
    expect(d.move(100, 200, 32, true).offset).toBe(0)
  })

  it('a caught sheet is the finger’s at once, from where it was', () => {
    const d = sheetDrag()
    d.start(100, 300, 0, 'body', 120)
    expect(d.dragging).toBe(true)
    expect(d.move(100, 310, 16, false)).toEqual({ offset: 130, claim: true })
  })

  it('times a release to leave at the finger’s speed', () => {
    expect(releaseMs(400, 0)).toBe(SHEET_MS)
    expect(releaseMs(400, 3)).toBe(300)
    expect(releaseMs(400, 30)).toBe(180)
  })
})
