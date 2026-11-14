import { describe, expect, it } from 'vitest'
import type { TourStep } from './tour'
import { COURSE } from './script'
import { coachPlace, currentStep, dimPath, eventCounts, exampleSafe, holeOf, lookingFor, offersShowMe, SETTLE_MS, SHOW_ME_AFTER_MS, shownStep, startTour, tourStep, type TourAction, type TourState } from './tourEngine'
import { tourStepsOf } from './live'

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
    // Another folder's menu does not end the step (it is only kept as where the person is, for the safe example).
    const other = tourStep(s, { type: 'event', name: 'folder-menu-open', detail: '/v/Other', at: 0 })
    expect(other.index).toBe(s.index)
    expect(other.lastMenu).toBe('/v/Other')
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
    // YAZ-5366: the six hands-on chapters moved to live steps; a chapter that keeps a tour still walks.
    for (const chapter of COURSE.filter((ch) => (ch.tryIt?.length ?? 0) > 0)) {
      let s = ready(chapter.tryIt!)
      let at = 0
      for (const [i, step] of chapter.tryIt!.entries()) {
        expect(currentStep(s), `${chapter.id} step ${i + 1}`).toBe(step)
        at += 10
        s = act(s, step, at)
        at += SETTLE_MS
        s = tourStep(s, { type: 'frame', at, onScreen: true })
      }
      expect(s.status, chapter.id).toBe('finished')
    }
  })
})

/** The fake real action that ends a step: its click, or its event (with the path, in the course's folder). */
function act(s: TourState, step: TourStep, at: number): TourState {
  if (step.done === 'show') return s
  if (step.done === 'click') return tourStep(s, { type: 'click', target: step.target })
  const event = step.done.event
  const detail = event === 'folder-menu-open' ? PLACES.folder : event.startsWith('card-file') ? `${PLACES.folder}/A.md` : undefined
  return tourStep(s, { type: 'event', name: event, detail, at })
}

describe('live steps in the engine (YAZ-5366)', () => {
  const LIVE: TourStep[] = [
    { target: 'sidebar-inbox', say: '', done: 'show' },
    { target: 'sidebar-course-cards', say: 'Right-click.', done: { event: 'folder-menu-open' } },
    { target: 'new-card', say: 'Choose New card.', done: 'click' },
    { target: 'settings-course', say: '', done: 'show' },
  ]
  const live = () => run(startTour(LIVE, 0), { type: 'ready', places: PLACES })

  it('a step is shown only once its moment has come; a show step moves on at the next moment', () => {
    let s = live()
    expect(currentStep(s)).toBe(LIVE[0])
    expect(shownStep(s)).toBeNull()
    // Not looked for before its moment.
    s = tourStep(s, { type: 'frame', at: 10, onScreen: false })
    expect(lookingFor(s)).toBe(false)
    s = tourStep(s, { type: 'reach', count: 1 })
    expect(shownStep(s)).toBe(LIVE[0])
    s = tourStep(s, { type: 'reach', count: 2 })
    expect(shownStep(s)).toBe(LIVE[1])
    // A show step takes no action.
    expect(tourStep(run(startTour(LIVE, 1), { type: 'ready', places: PLACES }), { type: 'click', target: 'sidebar-inbox' }).index).toBe(0)
  })

  it("the person's action counts before its moment: ahead of the voice, never left waiting", () => {
    let s = tourStep(live(), { type: 'reach', count: 2 })
    s = tourStep(s, { type: 'event', name: 'folder-menu-open', detail: PLACES.folder, at: 1 })
    expect(currentStep(s)).toBe(LIVE[2])
    // New card is clicked before George says it: the step is done, and the last show step waits for its moment.
    s = tourStep(s, { type: 'click', target: 'new-card' })
    expect(currentStep(s)).toBe(LIVE[3])
    expect(shownStep(s)).toBeNull()
    s = tourStep(s, { type: 'reach', count: 4 })
    expect(shownStep(s)).toBe(LIVE[3])
    // The last show step stays lit until the clip ends.
    expect(tourStep(s, { type: 'reach', count: 4 })).toBe(s)
    expect(s.status).toBe('running')
  })

  it('"Use an example" is safe only in Course Cards: the name box of its own folder, the editor of a card file in it', () => {
    const name: TourStep = { target: 'new-card-name', say: 'Type a title.', done: { event: 'card-file-created' }, example: { text: 'Protein', enter: true } }
    const front: TourStep = { target: 'card-editor', say: 'Type.', done: { event: 'card-text-changed' }, example: { text: 'A line.' } }
    let s = ready([name, front])
    expect(exampleSafe(s, name)).toBe(false)
    // Another folder's menu: its name box is not the course's.
    s = tourStep(s, { type: 'event', name: 'folder-menu-open', detail: '/v/Other', at: 1 })
    expect(exampleSafe(s, name)).toBe(false)
    s = tourStep(s, { type: 'event', name: 'folder-menu-open', detail: PLACES.folder, at: 2 })
    expect(exampleSafe(s, name)).toBe(true)
    // A card file outside Course Cards is open: no example in its editor.
    s = tourStep(s, { type: 'event', name: 'card-file-open', detail: '/v/Notes/B.md', at: 3 })
    expect(exampleSafe(s, front)).toBe(false)
    s = tourStep(s, { type: 'event', name: 'card-file-open', detail: `${PLACES.folder}/A.md`, at: 4 })
    expect(exampleSafe(s, front)).toBe(true)
    // With no course folder at all: never.
    expect(exampleSafe(startTour([front]), front)).toBe(false)
    // A step without an example: never.
    expect(exampleSafe(s, { ...front, example: undefined })).toBe(false)
  })

  it('every live clip of the script walks from its first to its last step on fake real actions', () => {
    const clips = COURSE.flatMap((ch) => ch.clips.filter((c) => (c.live?.length ?? 0) > 0))
    expect(clips.length).toBeGreaterThanOrEqual(20)
    for (const clip of clips) {
      const steps = tourStepsOf(clip)
      let s = run(startTour(steps, 0), { type: 'ready', places: PLACES })
      let at = 0
      for (const [i, step] of steps.entries()) {
        s = tourStep(s, { type: 'reach', count: i + 1 })
        expect(shownStep(s), `${clip.id} step ${i + 1}`).toBe(step)
        at += 10
        s = act(s, step, at)
        at += SETTLE_MS
        s = tourStep(s, { type: 'frame', at, onScreen: true })
      }
      const doneOrShowing = s.status === 'finished' || (s.status === 'running' && s.steps.slice(s.index).every((st) => st.done === 'show'))
      expect(doneOrShowing, clip.id).toBe(true)
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
