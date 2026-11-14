import { describe, expect, it } from 'vitest'
import type { TourStep } from './tour'
import { COURSE } from './script'
import { coachPlace, currentStep, dimPath, eventCounts, holeOf, lookingFor, offersShowMe, SETTLE_MS, SHOW_ME_AFTER_MS, startTour, tourStep, type TourAction, type TourState } from './tourEngine'

const STEPS: TourStep[] = [
  { target: 'sidebar-course-cards', say: 'Right-click the folder.', done: { event: 'folder-menu-open' } },
  { target: 'new-card', say: 'Choose New card.', done: 'click' },
  { target: 'card-editor', say: 'Type.', done: { event: 'card-text-changed' } },
  { target: 'settings-course', say: 'Read this.', done: { event: 'tour-next' } },
]
const PLACES = { folder: '/v/Course Cards', page: '/v/Course Cards/Course page.md' }
const run = (s: TourState, ...actions: TourAction[]): TourState => actions.reduce(tourStep, s)
const ready = (steps = STEPS) => run(startTour(steps), { type: 'ready', places: PLACES })

describe('the tour engine (YAZ-5123)', () => {
  it('starts in the check; ready runs step 1, blocked shows one line and waits for the way back', () => {
    const s = startTour(STEPS)
    expect(s.status).toBe('checking')
    expect(currentStep(s)).toBeNull()
    // Nothing the person does counts during the check.
    expect(tourStep(s, { type: 'click', target: 'new-card' })).toBe(s)
    expect(currentStep(ready())).toBe(STEPS[0])
    const blocked = run(s, { type: 'blocked', reason: 'There is no card in Course Cards yet.' })
    expect(blocked.status).toBe('blocked')
    expect(blocked.blocked).toBe('There is no card in Course Cards yet.')
    expect(tourStep(blocked, { type: 'skip' })).toBe(blocked)
    expect(tourStep(blocked, { type: 'leave' }).status).toBe('left')
  })

  it('a step ends by its event, or by a click on its own target; a wrong action does nothing', () => {
    let s = ready()
    // A click on step 1's target does not end an event step; another event does nothing.
    expect(tourStep(s, { type: 'click', target: 'sidebar-course-cards' })).toBe(s)
    expect(tourStep(s, { type: 'event', name: 'card-edit-done', at: 0 })).toBe(s)
    s = tourStep(s, { type: 'event', name: 'folder-menu-open', detail: PLACES.folder, at: 0 })
    expect(s.index).toBe(1)
    // A click elsewhere, or the event of another step: nothing.
    expect(tourStep(s, { type: 'click', target: 'review-folder' })).toBe(s)
    expect(tourStep(s, { type: 'event', name: 'folder-menu-open', detail: PLACES.folder, at: 0 })).toBe(s)
    s = tourStep(s, { type: 'click', target: 'new-card' })
    expect(currentStep(s)?.target).toBe('card-editor')
  })

  it("a path event counts only for the tour's own folder", () => {
    const s = ready()
    expect(tourStep(s, { type: 'event', name: 'folder-menu-open', detail: '/v/Other', at: 0 })).toBe(s)
    expect(eventCounts('card-file-open', '/v/Course Cards/A.md', PLACES)).toBe(true)
    expect(eventCounts('card-file-open', '/v/Course Cards 2/A.md', PLACES)).toBe(false)
    expect(eventCounts('card-file-created', '/v/Elsewhere/A.md', PLACES)).toBe(false)
    expect(eventCounts('card-edit-done', '/v/Elsewhere/A.md', PLACES)).toBe(true)
    expect(eventCounts('folder-menu-open', '/v/Other', { folder: null, page: null })).toBe(true)
  })

  it('typing ends its step after a pause, not on the first letter; the card file is kept for Show me', () => {
    let s = run(ready(), { type: 'event', name: 'folder-menu-open', detail: PLACES.folder, at: 0 }, { type: 'click', target: 'new-card' })
    s = tourStep(s, { type: 'event', name: 'card-file-open', detail: '/v/Course Cards/Protein.md', at: 0 })
    expect(s.lastCard).toBe('/v/Course Cards/Protein.md')
    s = tourStep(s, { type: 'event', name: 'card-text-changed', at: 1000 })
    expect(s.index).toBe(2)
    s = tourStep(s, { type: 'frame', at: 1000 + SETTLE_MS - 1, onScreen: true })
    expect(s.index).toBe(2)
    // More typing pushes the end on.
    s = tourStep(s, { type: 'event', name: 'card-text-changed', at: 2000 })
    s = tourStep(s, { type: 'frame', at: 1000 + SETTLE_MS + 10, onScreen: true })
    expect(s.index).toBe(2)
    s = tourStep(s, { type: 'frame', at: 2000 + SETTLE_MS, onScreen: true })
    expect(currentStep(s)?.target).toBe('settings-course')
  })

  it('a target not on screen: the tour waits, then offers Show me; it never skips by itself', () => {
    let s = ready()
    s = tourStep(s, { type: 'frame', at: 100, onScreen: false })
    expect(lookingFor(s)).toBe(true)
    expect(offersShowMe(s, 100 + SHOW_ME_AFTER_MS - 1)).toBe(false)
    s = tourStep(s, { type: 'frame', at: 100 + SHOW_ME_AFTER_MS * 10, onScreen: false })
    expect(s.index).toBe(0)
    expect(s.status).toBe('running')
    expect(offersShowMe(s, 100 + SHOW_ME_AFTER_MS)).toBe(true)
    // The target shows late (the menu opened): the help goes.
    s = tourStep(s, { type: 'frame', at: 99999, onScreen: true })
    expect(lookingFor(s)).toBe(false)
    // A frame that changes nothing keeps the same state (no render).
    expect(tourStep(s, { type: 'frame', at: 100000, onScreen: true })).toBe(s)
  })

  it('Skip goes on, and on the last step leaves; Back and Esc leave; the last step done finishes', () => {
    let s = tourStep(ready(), { type: 'skip' })
    expect(s.index).toBe(1)
    expect(tourStep(s, { type: 'leave' }).status).toBe('left')
    s = run(s, { type: 'skip' }, { type: 'skip' })
    expect(currentStep(s)?.target).toBe('settings-course')
    expect(tourStep(s, { type: 'skip' }).status).toBe('left')
    const done = tourStep(s, { type: 'event', name: 'tour-next', at: 0 })
    expect(done.status).toBe('finished')
    // Over: nothing changes it.
    expect(tourStep(done, { type: 'leave' })).toBe(done)
    expect(startTour([]).status).toBe('finished')
  })

  it('every tryIt of the script walks from its first to its last step on fake real actions', () => {
    const tours = COURSE.filter((ch) => (ch.tryIt?.length ?? 0) > 0)
    expect(tours.length).toBeGreaterThanOrEqual(6)
    for (const chapter of tours) {
      let s = ready(chapter.tryIt!)
      let at = 0
      for (const [i, step] of chapter.tryIt!.entries()) {
        expect(currentStep(s), `${chapter.id} step ${i + 1}`).toBe(step)
        at += 10
        const detail = step.done !== 'click' && step.done.event === 'folder-menu-open' ? PLACES.folder : step.done !== 'click' && step.done.event.startsWith('card-file') ? `${PLACES.folder}/A.md` : undefined
        s = step.done === 'click' ? tourStep(s, { type: 'click', target: step.target }) : tourStep(s, { type: 'event', name: step.done.event, detail, at })
        at += SETTLE_MS
        s = tourStep(s, { type: 'frame', at, onScreen: true })
      }
      expect(s.status, chapter.id).toBe('finished')
    }
  })
})

describe('the geometry of the dim and the coach card', () => {
  const view = { width: 1200, height: 800 }
  const coach = { width: 300, height: 160 }

  it('the hole is padded and kept in the window; the dim has a hole per box', () => {
    expect(holeOf({ left: 2, top: 10, width: 100, height: 20 }, view)).toEqual({ left: 0, top: 6, width: 106, height: 28 })
    const d = dimPath(view, [holeOf({ left: 100, top: 100, width: 50, height: 20 }, view), { left: 0, top: 0, width: 0, height: 0 }])
    expect(d.startsWith('M0 0H1200V800H0Z')).toBe(true)
    expect(d.match(/M/g)).toHaveLength(2)
  })

  it('the coach card sits near the target and never over it; with no target, in the bottom right corner', () => {
    const t = { left: 20, top: 100, width: 200, height: 30 }
    const below = coachPlace(t, coach, view)
    expect(below).toEqual({ left: 20, top: 142 })
    // A target at the bottom: the card goes above it.
    expect(coachPlace({ left: 600, top: 760, width: 100, height: 30 }, coach, view).top).toBe(760 - 12 - 160)
    // A tall target (the card editor): the card goes beside it.
    const tall = { left: 300, top: 20, width: 500, height: 760 }
    const side = coachPlace(tall, coach, view)
    expect(side.left).toBe(812)
    // No target: the corner.
    expect(coachPlace(null, coach, view)).toEqual({ left: 888, top: 628 })
    // A narrow window: the card stays inside it.
    const narrow = coachPlace({ left: 0, top: 0, width: 360, height: 700 }, coach, { width: 380, height: 760 })
    expect(narrow.left).toBeGreaterThanOrEqual(12)
    expect(narrow.top + coach.height).toBeLessThanOrEqual(760)
  })
})
