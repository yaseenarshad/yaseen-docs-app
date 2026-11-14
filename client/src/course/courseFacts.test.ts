import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultCourseState } from '@shared/courseState'
import { DEFAULT_SETTINGS } from '@shared/types'
import { COURSE } from './script'
import { courseMinutes } from './courseTime'
import { COURSE_HINT, COURSE_MINUTES, COURSE_NOTICE, offerInInbox, offerNotice } from './courseFacts'
import { WAITING_CLIPS } from './waits'

describe('the course facts the app has before the course loads (YAZ-5120)', () => {
  it('COURSE_MINUTES is the script`s minutes (its words at 145 a minute); the hint and the notice say it', () => {
    expect(COURSE_MINUTES, 'script.ts changed its length: set COURSE_MINUTES in courseFacts.ts').toBe(courseMinutes(COURSE))
    expect(COURSE_HINT).toBe(`About ${courseMinutes(COURSE)} minutes. Learn how cards work, and make your first ones.`)
    expect(COURSE_NOTICE).toBe(`New to cards? Take the ${courseMinutes(COURSE)}-minute course`)
  })

  it('the empty Inbox offers the course only to a beginner, and Card tips off hides it', () => {
    const c = defaultCourseState()
    expect(offerInInbox(c, DEFAULT_SETTINGS, false)).toBe(true)
    expect(offerInInbox(c, DEFAULT_SETTINGS, true)).toBe(false)
    expect(offerInInbox({ ...c, done: true }, DEFAULT_SETTINGS, false)).toBe(false)
    expect(offerInInbox({ ...c, dismissed: true }, DEFAULT_SETTINGS, false)).toBe(false)
    expect(offerInInbox(c, { ...DEFAULT_SETTINGS, cardTips: false }, false)).toBe(false)
  })

  it('the notice shows once, with Review on, Card tips on and the course not done', () => {
    const c = defaultCourseState()
    expect(offerNotice(c, DEFAULT_SETTINGS, true)).toBe(true)
    expect(offerNotice(c, DEFAULT_SETTINGS, false)).toBe(false)
    expect(offerNotice({ ...c, offered: true }, DEFAULT_SETTINGS, true)).toBe(false)
    expect(offerNotice({ ...c, done: true }, DEFAULT_SETTINGS, true)).toBe(false)
    expect(offerNotice(c, { ...DEFAULT_SETTINGS, cardTips: false }, true)).toBe(false)
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
