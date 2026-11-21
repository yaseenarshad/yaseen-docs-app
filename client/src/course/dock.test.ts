import { describe, expect, it } from 'vitest'
import { applyCoursePatch, cleanCourseState, defaultCourseState } from '@shared/courseState'
import { COURSE_SIDE, cornerAvoiding, cornerBox, cornerToward, dockBox, dockStep, nearestCorner, SIDE_MIN_PX, sideAt, sideWidth, startDock } from './dock'

const VIEW = { width: 1200, height: 800 }

describe('who picks the size (YAZ-5365, decision 2 of YAZ-5357)', () => {
  it('the course asks; the person chooses; the person wins until the next part', () => {
    let s = startDock('full')
    let r = dockStep(s, { type: 'request', size: 'side', reason: 'show and do' })
    expect(r.answer).toBe('done')
    expect(r.state).toMatchObject({ size: 'side', reason: 'show and do', personChose: false })
    s = dockStep(r.state, { type: 'choose', size: 'corner' }).state
    expect(s).toMatchObject({ size: 'corner', personChose: true, reason: 'person' })
    r = dockStep(s, { type: 'request', size: 'full', reason: 'a lesson' })
    expect(r.answer).toBe('kept')
    expect(r.state).toBe(s)
    // The same part again changes nothing.
    s = dockStep(s, { type: 'part', part: 'p1' }).state
    s = dockStep(s, { type: 'choose', size: 'corner' }).state
    expect(dockStep(s, { type: 'part', part: 'p1', size: 'full' }).state).toBe(s)
    // The next part: the person's choice ends, and the part's size is asked for.
    r = dockStep(s, { type: 'part', part: 'p2', size: 'full', reason: 'clip p2' })
    expect(r.answer).toBe('done')
    expect(r.state).toMatchObject({ size: 'full', personChose: false, part: 'p2', reason: 'clip p2' })
    // A request for the size it has is 'same', and nothing changes.
    expect(dockStep(r.state, { type: 'request', size: 'full', reason: 'x' })).toEqual({ state: r.state, answer: 'same' })
  })
})

describe('the geometry (YAZ-5365)', () => {
  it('side: about a third on the right, the whole height, within its limits', () => {
    expect(dockBox('full', 'bottom-right', COURSE_SIDE.start, VIEW)).toBeNull()
    expect(dockBox('side', 'bottom-right', COURSE_SIDE.start, VIEW)).toEqual({ left: 1200 - 408, top: 0, width: 408, height: 800 })
    expect(sideWidth(0.9, VIEW)).toBe(600)
    expect(sideWidth(0.05, VIEW)).toBe(SIDE_MIN_PX)
    // A small window: never under the least width, never wider than the window.
    expect(sideWidth(COURSE_SIDE.start, { width: 600, height: 500 })).toBe(SIDE_MIN_PX)
    expect(sideWidth(COURSE_SIDE.start, { width: 300, height: 500 })).toBe(300)
    expect(sideAt(800, VIEW)).toBe(0.333)
    expect(sideAt(0, VIEW)).toBe(COURSE_SIDE.max)
    expect(sideAt(1190, VIEW)).toBe(COURSE_SIDE.min)
  })

  it('corner: each corner inside the window; the nearest corner to a drop; the arrows', () => {
    const br = cornerBox('bottom-right', VIEW)
    expect(br.left + br.width).toBe(1184)
    expect(br.top + br.height).toBe(784)
    expect(cornerBox('top-left', VIEW)).toMatchObject({ left: 16, top: 16 })
    expect(nearestCorner(100, 700, VIEW)).toBe('bottom-left')
    expect(nearestCorner(1000, 50, VIEW)).toBe('top-right')
    expect(cornerToward('bottom-right', 'ArrowUp')).toBe('top-right')
    expect(cornerToward('bottom-right', 'ArrowLeft')).toBe('bottom-left')
    expect(cornerToward('top-left', 'ArrowLeft')).toBe('top-left')
  })

  it('the corner moves away from a lit control, to the nearest corner that leaves it free', () => {
    const lit = { left: 1100, top: 740, width: 60, height: 30 }
    expect(cornerAvoiding('bottom-right', null, VIEW)).toBe('bottom-right')
    expect(cornerAvoiding('bottom-right', lit, VIEW)).toBe('bottom-left')
    expect(cornerAvoiding('top-left', lit, VIEW)).toBe('top-left')
    // A small window where the corner and the light share the bottom row: it goes up.
    const small = { width: 640, height: 480 }
    const wide = { left: 0, top: 440, width: 640, height: 30 }
    expect(cornerAvoiding('bottom-right', wide, small)).toBe('top-right')
  })
})

describe('AppState.course.dock… (YAZ-5365): kept across a restart', () => {
  it('cleans each field; a bad value keeps the base; a JSON round trip keeps the place', () => {
    const d = defaultCourseState()
    expect(d).toMatchObject({ dock: 'full', dockCorner: 'bottom-right', dockSide: COURSE_SIDE.start })
    expect(cleanCourseState({ dock: 'big', dockCorner: 'middle', dockSide: 0.9 })).toEqual(d)
    expect(cleanCourseState({ dockSide: '0.4' }).dockSide).toBe(COURSE_SIDE.start)
    const s = applyCoursePatch(d, { dock: 'corner', dockCorner: 'top-left', dockSide: 0.4 })
    expect(s).toMatchObject({ dock: 'corner', dockCorner: 'top-left', dockSide: 0.4 })
    expect(applyCoursePatch(s, { dock: 'corner' })).toBe(s)
    // The store writes JSON and reads it back through the same sanitizer at the next start.
    expect(cleanCourseState(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
})
