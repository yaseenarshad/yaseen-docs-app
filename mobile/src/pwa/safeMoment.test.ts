import { describe, expect, it } from 'vitest'
import { holdsOf, lineFor, swapNow, type Holds } from './safeMoment'

/**
 * The update rule (YAZ-5087; YAZ-5555): the app changes to a new version only on a tap on Restart, and never then when
 * something would be lost.
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
  it('YAZ-5269: a review in progress behind Friends or Search is noted; the person\'s own tap on Restart still takes it', () => {
    for (const tab of ['friends', 'search'] as const) {
      const holds = holdsOf({ ...calm, tab, reviewInProgress: true })
      expect(holds).toEqual(['review'])
      expect(swapNow({ ready: true, holds })).toBe(true)
    }
    expect(holdsOf({ ...calm, tab: 'friends', reviewInProgress: false })).toEqual([])
  })
  it('a screen over the tabs (a form: typed text is lost on a reload)', () => expect(holdsOf({ ...calm, routeOpen: true })).toEqual(['screen']))
  it('the first download', () => expect(holdsOf({ ...calm, downloading: true })).toEqual(['download']))
  it('the sign-in form and the start', () => {
    expect(holdsOf({ ...calm, phase: 'sign-in' })).toEqual(['screen'])
    expect(holdsOf({ ...calm, phase: 'loading' })).toEqual(['screen'])
  })
})

describe('YAZ-5555: the new version takes over ONLY on a tap on Restart', () => {
  const none: Holds = []
  it('never when no new version is ready', () => expect(swapNow({ ready: false, holds: none })).toBe(false))

  it('a tap: yes, also on the Review tab, over a review or a screen (the person chose it)', () => {
    expect(swapNow({ ready: true, holds: none })).toBe(true)
    expect(swapNow({ ready: true, holds: ['review'] })).toBe(true)
    expect(swapNow({ ready: true, holds: ['screen'] })).toBe(true)
  })

  it('never while answers wait, a comment box holds words, or the first download runs', () => {
    for (const hold of ['answers', 'typing', 'download'] as const) expect([hold, swapNow({ ready: true, holds: [hold] })]).toEqual([hold, false])
  })

  it('a comment box with words not sent is a hold', () => expect(holdsOf({ ...calm, unsentText: true })).toEqual(['typing']))
})

describe('the line', () => {
  it('"A new version is ready." with Restart', () => {
    expect(lineFor([])).toEqual({ text: 'A new version is ready.', restart: true })
    expect(lineFor(['review'])).toEqual({ text: 'A new version is ready.', restart: true })
  })
  it('held: it says why, and has no button', () => {
    expect(lineFor(['answers'])).toEqual({ text: 'A new version is ready. Restart after your answers are sent.', restart: false })
    expect(lineFor(['typing'])).toEqual({ text: 'A new version is ready. Restart after you send or clear your comment.', restart: false })
    expect(lineFor(['download'])).toEqual({ text: 'A new version is ready. Restart after the first download.', restart: false })
  })
})
