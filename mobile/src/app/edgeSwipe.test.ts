import { describe, expect, it } from 'vitest'
import { EDGE_PX, edgeSwipe, swipeIsOurs } from './edgeSwipe'

/** A 390 px wide phone: a third is 130 px. */
const phone = () => edgeSwipe(() => 390)

/** A slow drag from `x0` to `x1` (10 px each 40 ms, 0.25 px/ms: never a flick), then a lift. */
function drag(x0: number, x1: number, dy = 0) {
  const s = phone()
  let t = 0
  const started = s.start(x0, 400, t)
  const offsets: (number | null)[] = []
  const step = Math.sign(x1 - x0) * 10
  for (let x = x0 + step; Math.abs(x - x0) <= Math.abs(x1 - x0); x += step) {
    t += 40
    offsets.push(s.move(x, 400 + dy, t))
  }
  return { started, offsets, end: s.end(t + 10) }
}

describe('YAZ-5435: the swipe from the left edge goes back', () => {
  it('starts only within 20 px of the left edge', () => {
    expect(EDGE_PX).toBe(20)
    expect(phone().start(0, 300, 0)).toBe(true)
    expect(phone().start(20, 300, 0)).toBe(true)
    expect(phone().start(21, 300, 0)).toBe(false)
    expect(phone().start(200, 300, 0)).toBe(false)
    // A drag that starts in a wide table (past the edge) is never the swipe.
    expect(drag(60, 300).end).toBe('none')
  })

  it('the screen follows the finger; a release past a third goes back', () => {
    const past = drag(5, 145)
    expect(past.offsets.at(-1)).toBe(140)
    expect(past.end).toBe('back')
  })

  it('a slow release before a third springs back', () => {
    expect(drag(5, 115).end).toBe('stay')
  })

  it('a fast flick goes back, even short of a third', () => {
    const s = phone()
    s.start(4, 300, 0)
    s.move(14, 300, 10)
    s.move(34, 300, 20)
    s.move(64, 300, 30) // 3 px/ms
    expect(s.end(35)).toBe('back')
  })

  it('a flick that stopped before the lift is no flick; a twitch at the edge is no back', () => {
    const stopped = phone()
    stopped.start(4, 300, 0)
    stopped.move(30, 300, 10)
    stopped.move(70, 300, 20)
    expect(stopped.end(400)).toBe('stay')
    const twitch = phone()
    twitch.start(4, 300, 0)
    twitch.move(14, 300, 5)
    twitch.move(20, 300, 8)
    expect(twitch.end(9)).toBe('stay')
  })

  it('an up or down move from the edge is a scroll: the swipe lets it go', () => {
    const s = phone()
    s.start(6, 300, 0)
    expect(s.move(9, 330, 10)).toBeNull()
    expect(s.move(200, 330, 20)).toBeNull() // decided: a scroll stays a scroll
    expect(s.end(30)).toBe('none')
  })

  it('a move to the left is never a back; the offset never goes under 0', () => {
    expect(drag(20, 0).end).toBe('none')
    const s = phone()
    s.start(10, 300, 0)
    s.move(40, 300, 10)
    expect(s.move(0, 300, 20)).toBe(0)
  })

  it('a cancel (the system took the touch) ends it with no back', () => {
    const s = phone()
    s.start(2, 300, 0)
    s.move(250, 300, 10)
    s.cancel()
    expect(s.end(20)).toBe('none')
  })

  it('a tap at the edge is no swipe', () => {
    const s = phone()
    s.start(10, 300, 0)
    expect(s.move(12, 302, 10)).toBeNull()
    expect(s.end(20)).toBe('none')
  })

  it('only the Home Screen app swipes; a Safari tab keeps Safari\'s own back swipe', () => {
    expect(swipeIsOurs('standalone')).toBe(true)
    expect(swipeIsOurs('ios-safari')).toBe(false)
    expect(swipeIsOurs('ios-other')).toBe(false)
    expect(swipeIsOurs('not-ios')).toBe(false)
  })
})
