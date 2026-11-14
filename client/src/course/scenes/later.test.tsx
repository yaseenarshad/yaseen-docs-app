/**
 * Chapters 9 to 12 and the end screen (YAZ-5121): every clip has a real scene; no clip of these chapters waits, and no
 * scene calls `done()`; each scene draws at 0, 0.5, 1 and at each mark in light, dark and reduced motion (also in
 * `scenes.test.tsx`); the papers keep the copyright rule; the marks are the voice's, sorted
 * fractions in (0, 1); the end screen shows zero, one and several made cards and when each comes back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { COURSE } from '../script'
import { WAITING_CLIPS } from '../waits'
import { showOnlyHost, type CourseHost, type CourseSummary } from '../courseHost'
import { SHOW_ONLY } from '../courseCards'
import { CHAPTER_SCENES, courseScenes } from '.'
import { PAPERS } from './papers'
import { CourseEnd, LAST_LINE, whenBack } from './finale'
import { memoryHost, mountScene, testClock } from './testing'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MINE = ['habits', 'links', 'care', 'where-things-are']
const chapter = (id: string) => COURSE.find((ch) => ch.id === id)!

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.body.textContent = ''
  vi.restoreAllMocks()
})

describe('chapters 9 to 12 (YAZ-5121)', () => {
  it('have their clips', () => {
    expect(MINE.map((id) => chapter(id).clips.length)).toEqual([15, 31, 18, 21])
  })

  it('have marks on the clips the voice times: sorted fractions in (0, 1)', () => {
    let marked = 0
    for (const id of MINE)
      for (const clip of chapter(id).clips) {
        const marks = clip.marks ?? []
        if (marks.length > 0) marked += 1
        for (const m of marks) expect(m > 0 && m < 1, `${clip.id} ${m}`).toBe(true)
        expect([...marks].sort((a, b) => a - b)).toEqual(marks)
      }
    expect(marked).toBe(84)
  })

  it('have no clip that waits, so no scene calls done()', () => {
    for (const id of MINE) for (const clip of chapter(id).clips) expect(WAITING_CLIPS.has(clip.id), clip.id).toBe(false)
    const done = vi.fn()
    for (const id of MINE)
      for (const entry of CHAPTER_SCENES.find((c) => c.chapter === id)!.entries) {
        const { clock, at } = testClock(5)
        const scene = mountScene(entry.scene, chapter(id), { clock, done, host: memoryHost(), waits: (c) => WAITING_CLIPS.has(c.id) })
        for (const clipId of entry.clips) {
          scene.render(chapter(id).clips.find((c) => c.id === clipId)!)
          at(1, true)
        }
        scene.unmount()
      }
    expect(done).not.toHaveBeenCalled()
  })

  for (const look of ['light', 'dark', 'reduced'] as const) {
    it(`draw each clip at 0, 0.5, 1 and each mark, with words for a screen reader, ${look}`, () => {
      const errors = vi.spyOn(console, 'error')
      document.documentElement.dataset.theme = look === 'dark' ? 'dark' : 'light'
      for (const id of MINE)
        for (const entry of CHAPTER_SCENES.find((c) => c.chapter === id)!.entries) {
          const { clock, at } = testClock(7)
          const scene = mountScene(entry.scene, chapter(id), { clock, done: () => undefined, reducedMotion: look === 'reduced', host: memoryHost() })
          for (const clipId of entry.clips) {
            const clip = chapter(id).clips.find((c) => c.id === clipId)!
            scene.render(clip)
            for (const f of [0, 0.5, 1, ...(clip.marks ?? [])]) {
              at(f, true)
              const stage = scene.el.querySelector('.kit-stage')
              expect(stage, `${clipId} @ ${f}`).not.toBeNull()
              expect(stage!.getAttribute('aria-label'), clipId).toBeTruthy()
              // Nothing is drawn with a number that is not one (a NaN in a transform or a path).
              expect(scene.el.innerHTML.includes('NaN'), `${clipId} @ ${f}`).toBe(false)
            }
          }
          scene.unmount()
        }
      expect(errors).not.toHaveBeenCalled()
    })
  }

  it('in reduced motion, nothing on the stage travels or turns: no translate or rotate in a style', () => {
    for (const id of MINE)
      for (const entry of CHAPTER_SCENES.find((c) => c.chapter === id)!.entries) {
        const { clock, at } = testClock(7)
        const scene = mountScene(entry.scene, chapter(id), { clock, done: () => undefined, reducedMotion: true, host: memoryHost() })
        for (const clipId of entry.clips) {
          const clip = chapter(id).clips.find((c) => c.id === clipId)!
          scene.render(clip)
          for (const f of [0.3, 0.6, 0.9]) {
            at(f, true)
            for (const el of scene.el.querySelectorAll<HTMLElement>('[style]')) {
              const t = el.style.transform
              expect(/translate[XY]?\((?!0(px|%)?[,)])|rotate[XY]?\((?!0)/.test(t), `${clipId} @ ${f}: ${t}`).toBe(false)
            }
          }
        }
        scene.unmount()
      }
  })

  it('pull up each paper on its clip, with its highlighted line', () => {
    const cases: [string, string, keyof typeof PAPERS][] = [
      ['habits', 'c9-05', 'kornell'],
      ['habits', 'c9-11', 'karpickeGuesses'],
      ['links', 'c10-07', 'collinsLoftus'],
    ]
    for (const [ch, clipId, paper] of cases) {
      const { clock, at } = testClock(8)
      const scene = mountScene(courseScenes(clipId), chapter(ch), { clock, done: () => undefined, host: memoryHost() })
      scene.render(chapter(ch).clips.find((c) => c.id === clipId)!)
      at(0.3, true)
      expect(scene.el.querySelector('.kit-paper__line')?.textContent, clipId).toBe(PAPERS[paper].line)
      scene.unmount()
    }
  })

  it('make "Folders ask … Links ask …" the big frame of chapter 10', () => {
    const { clock, at } = testClock(6)
    const scene = mountScene(courseScenes('c10-13'), chapter('links'), { clock, done: () => undefined, host: memoryHost() })
    scene.render(chapter('links').clips.find((c) => c.id === 'c10-13')!)
    at(0.9, true)
    const words = [...scene.el.querySelectorAll('.kit-words--display')].map((w) => w.textContent)
    expect(words).toEqual(['Where does this go?', 'What does this connect to?'])
    scene.unmount()
  })
})

/** A host that gives the end screen `summary` (the rest from the memory host). */
const hostWith = (summary: CourseSummary): CourseHost => ({ ...memoryHost(), summary: () => summary })
const NOW = new Date(2026, 10, 14, 9, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

function mountEnd(host: CourseHost) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(<CourseEnd host={host} now={NOW} />))
  return { el, unmount: () => act(() => root.unmount()) }
}

describe('the end screen (YAZ-5121, the host of YAZ-5124)', () => {
  it('with no card: one quiet line, then the last line', () => {
    const end = mountEnd(showOnlyHost('/demo', SHOW_ONLY.readOnly))
    expect(end.el.querySelector('.later-end__none')?.textContent).toContain('No cards in Course Cards yet')
    expect(end.el.querySelectorAll('.later-end__card')).toHaveLength(0)
    expect(end.el.querySelector('.later-end__last')?.textContent).toBe(LAST_LINE)
    end.unmount()
  })

  it('with one card: that card, in the Inbox now', () => {
    const end = mountEnd(hostWith({ folder: '/demo/course-cards', cards: [{ path: '/demo/course-cards/a.md', title: 'Light takes eight minutes', due: null }] }))
    expect(end.el.querySelector('.later-end__head')?.textContent).toBe('The card you made in this course')
    expect([...end.el.querySelectorAll('.later-end__card')].map((li) => li.textContent)).toEqual(['Light takes eight minutesIn your Inbox now'])
    end.unmount()
  })

  it('with several cards: the soonest first, when each comes back, and how many more', () => {
    const cards = [
      { path: 'a', title: 'How bread rises', due: NOW + 11 * DAY },
      { path: 'b', title: 'The poke test for dough', due: NOW + DAY },
      { path: 'c', title: 'A slow rise for flavour', due: null },
      { path: 'd', title: 'Sleep debt adds up', due: NOW + 2 * DAY },
      { path: 'e', title: 'Protein', due: NOW + 3 * DAY },
      { path: 'f', title: 'candid', due: NOW + 200 * DAY },
      { path: 'g', title: 'Calories', due: NOW + 4 * DAY },
    ]
    const end = mountEnd(hostWith({ folder: '/demo/course-cards', cards }))
    expect(end.el.querySelector('.later-end__head')?.textContent).toBe('The 7 cards you made in this course')
    expect([...end.el.querySelectorAll('.later-end__title')].map((t) => t.textContent)).toEqual(['A slow rise for flavour', 'The poke test for dough', 'Sleep debt adds up', 'Protein', 'Calories'])
    expect([...end.el.querySelectorAll('.later-end__when')].map((t) => t.textContent)).toEqual(['In your Inbox now', 'Tomorrow', 'In 2 days', 'In 3 days', 'In 4 days'])
    expect(end.el.querySelector('.later-end__more')?.textContent).toBe('and 2 more in Course Cards')
    end.unmount()
  })

  it('follows the folder: a card made while it shows comes in', () => {
    const host = memoryHost()
    const end = mountEnd(host)
    expect(end.el.querySelectorAll('.later-end__card')).toHaveLength(0)
    act(() => host.arrive({ path: `${host.folder}/x.md`, index: 0, id: 'X1', title: 'A new card' }))
    expect(end.el.querySelector('.later-end__title')?.textContent).toBe('A new card')
    end.unmount()
  })

  it('says when a card comes back in words', () => {
    expect(whenBack(null, NOW)).toBe('In your Inbox now')
    expect(whenBack(NOW - 1, NOW)).toBe('In your Inbox now')
    expect(whenBack(NOW + 2 * 60 * 60 * 1000, NOW)).toBe('Later today')
    expect(whenBack(NOW + DAY, NOW)).toBe('Tomorrow')
    expect(whenBack(NOW + 46 * DAY, NOW)).toBe('In 46 days')
    expect(whenBack(new Date(2027, 3, 26, 9).getTime(), NOW)).toBe('On 26 April')
  })

  it('is not in the finale (YAZ-5128): the finale ends on the head alone, and the caption says the last line', () => {
    const host = hostWith({ folder: '/demo/course-cards', cards: [{ path: 'a', title: 'My first card', due: null }] })
    const { clock, at } = testClock(8)
    const scene = mountScene(courseScenes('c12-15'), chapter('where-things-are'), { clock, done: () => undefined, host })
    scene.render(chapter('where-things-are').clips.find((c) => c.id === 'c12-15')!)
    at(0.5, true)
    expect(scene.el.querySelectorAll('.later-tile')).toHaveLength(4)
    expect(scene.el.querySelector('.kit-head')).toBeNull()
    at(1, true)
    expect(scene.el.querySelector('.later-tile')).toBeNull()
    expect(scene.el.querySelector('.kit-head__light')).not.toBeNull()
    expect(scene.el.querySelector('.later-end')).toBeNull()
    expect(scene.el.textContent).not.toContain(LAST_LINE)
    scene.unmount()
  })
})
