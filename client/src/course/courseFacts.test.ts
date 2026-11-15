import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultCourseState } from '@shared/courseState'
import { DEFAULT_SETTINGS } from '@shared/types'
import manifest from '../../../desktop/src/main/courseAudio/course-audio.json'
import { COURSE } from './script'
import { COURSE_HINT, COURSE_MINUTES, COURSE_NOTICE, newToCards, offerInInbox, offerNotice, type OfferVault } from './courseFacts'
import { WAITING_CLIPS } from './waits'

describe('the course facts the app has before the course loads (YAZ-5120)', () => {
  it('COURSE_MINUTES is the voice`s length (the manifest`s seconds, summed and rounded); the hint and the notice say it', () => {
    const seconds = Object.values(manifest.chapters as Record<string, { seconds: number }>).reduce((n, chapter) => n + chapter.seconds, 0)
    expect(COURSE_MINUTES, 'the voice changed its length: set COURSE_MINUTES in courseFacts.ts').toBe(Math.round(seconds / 60))
    expect(COURSE_HINT).toBe(`About ${COURSE_MINUTES} minutes. Learn how cards work, and make your first ones.`)
    expect(COURSE_NOTICE).toBe(`New to cards? Take the ${COURSE_MINUTES}-minute course`)
  })

  // YAZ-5272: both offers are for a person new to cards: the vault has cards on and holds no card yet.
  const NEW: OfferVault = { cardsOn: true, hasCards: false }
  const HAS_CARDS: OfferVault = { cardsOn: true, hasCards: true }
  const CARDS_OFF: OfferVault = { cardsOn: false, hasCards: false }
  const LOADING: OfferVault = { cardsOn: true, hasCards: null }

  it('newToCards (YAZ-5272): cards on and no card yet; a vault whose index has not loaded is not new yet', () => {
    expect(newToCards(NEW)).toBe(true)
    expect(newToCards(HAS_CARDS)).toBe(false)
    expect(newToCards(CARDS_OFF)).toBe(false)
    expect(newToCards(LOADING)).toBe(false)
  })

  it('the empty Inbox offers the course only to a person new to cards, and Card tips off hides it', () => {
    const c = defaultCourseState()
    expect(offerInInbox(c, DEFAULT_SETTINGS, NEW)).toBe(true)
    expect(offerInInbox(c, DEFAULT_SETTINGS, HAS_CARDS)).toBe(false)
    expect(offerInInbox(c, DEFAULT_SETTINGS, CARDS_OFF)).toBe(false)
    expect(offerInInbox({ ...c, done: true }, DEFAULT_SETTINGS, NEW)).toBe(false)
    expect(offerInInbox({ ...c, dismissed: true }, DEFAULT_SETTINGS, NEW)).toBe(false)
    expect(offerInInbox(c, { ...DEFAULT_SETTINGS, cardTips: false }, NEW)).toBe(false)
  })

  it('the notice shows once, to a person new to cards (YAZ-5272), with Card tips on and the course not done', () => {
    const c = defaultCourseState()
    expect(offerNotice(c, DEFAULT_SETTINGS, NEW)).toBe(true)
    expect(offerNotice(c, DEFAULT_SETTINGS, HAS_CARDS)).toBe(false)
    expect(offerNotice(c, DEFAULT_SETTINGS, CARDS_OFF)).toBe(false)
    expect(offerNotice(c, DEFAULT_SETTINGS, LOADING)).toBe(false)
    expect(offerNotice({ ...c, offered: true }, DEFAULT_SETTINGS, NEW)).toBe(false)
    expect(offerNotice({ ...c, done: true }, DEFAULT_SETTINGS, NEW)).toBe(false)
    expect(offerNotice(c, { ...DEFAULT_SETTINGS, cardTips: false }, NEW)).toBe(false)
  })
})

describe('the clips that wait (YAZ-5120)', () => {
  it('are exactly the clips whose comment in script.ts says "WAITS:"', () => {
    const lines = readFileSync(resolve(__dirname, 'script.ts'), 'utf8').split('\n')
    const waits: string[] = []
    lines.forEach((line, i) => {
      const id = /\{ id: '([^']+)'/.exec(line)?.[1]
      if (id === undefined) return
      const comments: string[] = []
      for (let j = i - 1; j >= 0 && lines[j].trim().startsWith('//'); j--) comments.push(lines[j])
      if (comments.some((c) => c.includes('WAITS:'))) waits.push(id)
    })
    expect(waits.length).toBeGreaterThan(0)
    expect([...WAITING_CLIPS].sort()).toEqual(waits.sort())
    const ids = new Set(COURSE.flatMap((ch) => ch.clips.map((c) => c.id)))
    for (const id of WAITING_CLIPS) expect(ids.has(id)).toBe(true)
  })
})
