import { describe, expect, it } from 'vitest'
import { RESUME_AFTER_MS, holdsOf, lineFor, swapNow, type Holds } from './safeMoment'

/**
 * The safe moment (YAZ-5087): the app changes to a new version only when nothing is lost and nothing is cut in half.
 * The answer list is in IndexedDB and survives a reload (3C: `answers.test.ts`, "answers made with no signal, the
 * app closed: at the next start they are still there and go at once"), but a reload in the middle of a send or a
 * review is still not done.
 */

const calm = { phase: 'ready', routeOpen: false, tab: 'friends', downloading: false, answersWaiting: 0 } as const

describe('what holds the update back', () => {
  it('nothing, on a tab with no answers waiting', () => {
    expect(holdsOf(calm)).toEqual([])
  })
  it('answers that wait to be sent', () => expect(holdsOf({ ...calm, answersWaiting: 2 })).toEqual(['answers']))
  it('the Review tab (a review can be in its middle)', () => expect(holdsOf({ ...calm, tab: 'review' })).toEqual(['review']))
  it('a screen over the tabs (a form: typed text is lost on a reload)', () => expect(holdsOf({ ...calm, routeOpen: true })).toEqual(['screen']))
  it('the first download', () => expect(holdsOf({ ...calm, downloading: true })).toEqual(['download']))
  it('the sign-in form and the start', () => {
    expect(holdsOf({ ...calm, phase: 'sign-in' })).toEqual(['screen'])
    expect(holdsOf({ ...calm, phase: 'loading' })).toEqual(['screen'])
  })
})

describe('when the new version takes over', () => {
  const none: Holds = []
  it('never when no new version is ready', () => {
    for (const trigger of ['start', 'resume', 'tap'] as const) expect(swapNow({ ready: false, trigger, holds: none, hiddenMs: RESUME_AFTER_MS })).toBe(false)
  })

  it('at the start, before the app runs: always (nothing is open; the answer list survives a reload)', () => {
    expect(swapNow({ ready: true, trigger: 'start', holds: ['answers'], hiddenMs: 0 })).toBe(true)
  })

  it(`back from the background after ${RESUME_AFTER_MS / 60_000} minutes or more, with nothing held`, () => {
    expect(swapNow({ ready: true, trigger: 'resume', holds: none, hiddenMs: RESUME_AFTER_MS })).toBe(true)
    expect(swapNow({ ready: true, trigger: 'resume', holds: none, hiddenMs: RESUME_AFTER_MS - 1 })).toBe(false)
    for (const hold of ['answers', 'review', 'screen', 'download'] as const) {
      expect([hold, swapNow({ ready: true, trigger: 'resume', holds: [hold], hiddenMs: RESUME_AFTER_MS * 10 })]).toEqual([hold, false])
    }
  })

  it('a tap on "Restart": yes, also on the Review tab (the person chose it); never while answers wait or the first download runs', () => {
    expect(swapNow({ ready: true, trigger: 'tap', holds: ['review'], hiddenMs: 0 })).toBe(true)
    expect(swapNow({ ready: true, trigger: 'tap', holds: ['answers'], hiddenMs: 0 })).toBe(false)
    expect(swapNow({ ready: true, trigger: 'tap', holds: ['download'], hiddenMs: 0 })).toBe(false)
  })
})

describe('the line', () => {
  it('"A new version is ready." with Restart', () => {
    expect(lineFor([])).toEqual({ text: 'A new version is ready.', restart: true })
    expect(lineFor(['review'])).toEqual({ text: 'A new version is ready.', restart: true })
  })
  it('while answers wait: it says when, and has no button', () => {
    expect(lineFor(['answers'])).toEqual({ text: 'A new version is ready. It starts after your answers are sent.', restart: false })
  })
})
