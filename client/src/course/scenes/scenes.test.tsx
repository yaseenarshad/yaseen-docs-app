/**
 * The course's scenes (YAZ-5121): the registry covers each clip of a built chapter; spans are clips in a row; marks
 * are sorted fractions; each scene draws at its clip's start, middle, end and each mark, in light, dark and reduced
 * motion; the hands-on steps of chapter 2 wait for the person and call `done()` once each; the paper lines keep the
 * copyright rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { COURSE } from '../script'
import { WAITING_CLIPS } from '../waits'
import { PlaceholderScene } from '../PlaceholderScene'
import { showOnlyHost, SHOW_ONLY_NOT_YET } from '../courseHost'
import { BUILT_CHAPTERS, CHAPTER_SCENES, NOT_BUILT_CHAPTERS, courseScenes } from '.'
import { PAPERS, lineWords } from './papers'
import { PAPERS_6_TO_8, QUOTES_6_TO_8 } from './papers6to8'
import { LATER_PAPERS } from './papersLater'
import { COULD_NOT_MAKE, draftText, draftTitle, firstCardInput, makeFirstCard } from './makeCard'
import { memoryHost, mountScene, testClock } from './testing'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const chapter = (id: string) => COURSE.find((ch) => ch.id === id)!
const clipIds = (id: string) => chapter(id).clips.map((c) => c.id)

describe('the scene registry (YAZ-5121)', () => {
  it('lists each chapter once: built or not built yet', () => {
    expect([...BUILT_CHAPTERS, ...NOT_BUILT_CHAPTERS].sort()).toEqual(COURSE.map((ch) => ch.id).sort())
    expect(BUILT_CHAPTERS.filter((id) => NOT_BUILT_CHAPTERS.includes(id))).toEqual([])
  })

  it('gives each clip of a built chapter a real scene, never the placeholder', () => {
    for (const id of BUILT_CHAPTERS) for (const clip of clipIds(id)) expect(courseScenes(clip), `${id}/${clip}`).not.toBe(PlaceholderScene)
  })

  it('keeps the placeholder for the chapters not built yet (the next builders flip them)', () => {
    for (const id of NOT_BUILT_CHAPTERS) for (const clip of clipIds(id)) expect(courseScenes(clip), `${id}/${clip}`).toBe(PlaceholderScene)
  })

  it('makes each entry clips in a row of its own chapter, and gives a span one key', () => {
    for (const ch of CHAPTER_SCENES) {
      const ids = clipIds(ch.chapter)
      for (const entry of ch.entries) {
        const at = ids.indexOf(entry.clips[0])
        expect(at, entry.clips[0]).toBeGreaterThanOrEqual(0)
        expect(ids.slice(at, at + entry.clips.length)).toEqual([...entry.clips])
        const spans = new Set(entry.clips.map((c) => courseScenes.spanOf(c)))
        expect(spans.size).toBe(1)
        expect([...spans][0] === undefined).toBe(entry.clips.length === 1)
      }
    }
  })

  it('has marks that are sorted fractions inside (0, 1), in every chapter', () => {
    for (const clip of COURSE.flatMap((ch) => ch.clips)) {
      const marks = clip.marks ?? []
      for (const m of marks) expect(m > 0 && m < 1, `${clip.id} ${m}`).toBe(true)
      expect([...marks].sort((a, b) => a - b)).toEqual(marks)
    }
  })
})

describe('the papers (YAZ-5121, the copyright rule)', () => {
  it('defines each paper once: chapter 9 points at chapter 3\'s Karpicke & Roediger 2008 with its own line', () => {
    const { line: _a, source: _b, ...later } = LATER_PAPERS.karpicke
    const { line: _c, source: _d, ...first } = PAPERS.karpicke2008
    expect(later).toEqual(first)
    const titles = [...Object.values(PAPERS), ...Object.values(PAPERS_6_TO_8), ...Object.values(LATER_PAPERS)].filter((p) => p !== LATER_PAPERS.karpicke).map((p) => p.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('quotes fewer than 15 words; a paraphrase stays one short line, in every paper file (papers.ts, papers6to8.ts, papersLater.ts)', () => {
    for (const quote of Object.values(QUOTES_6_TO_8)) expect(lineWords(quote.line), quote.id).toBeLessThan(15)
    for (const paper of [...Object.values(PAPERS), ...Object.values(PAPERS_6_TO_8), ...Object.values(LATER_PAPERS)]) {
      expect(typeof paper.quote).toBe('boolean')
      if (paper.quote) expect(lineWords(paper.line), paper.id).toBeLessThan(15)
      else expect(lineWords(paper.line), paper.id).toBeLessThanOrEqual(20)
      expect(paper.authors.length).toBeGreaterThan(0)
      expect(paper.year).toBeGreaterThan(1800)
    }
  })
})

describe('each scene draws (YAZ-5121)', () => {
  let errors: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errors = vi.spyOn(console, 'error')
  })
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.body.textContent = ''
    vi.restoreAllMocks()
  })

  for (const look of ['light', 'dark', 'reduced'] as const) {
    it(`at 0, 0.5, 1 and each mark of each clip of the built chapters, ${look}`, () => {
      document.documentElement.dataset.theme = look === 'dark' ? 'dark' : 'light'
      for (const id of BUILT_CHAPTERS) {
        for (const ch of CHAPTER_SCENES.filter((c) => c.chapter === id)) {
          for (const entry of ch.entries) {
            const { clock, at } = testClock(6)
            const scene = mountScene(entry.scene, chapter(id), { clock, done: () => undefined, reducedMotion: look === 'reduced', host: showOnlyHost('/demo') })
            for (const clipId of entry.clips) {
              const clip = chapter(id).clips.find((c) => c.id === clipId)!
              scene.render(clip)
              for (const f of [0, 0.5, 1, ...(clip.marks ?? [])]) {
                at(f, true)
                expect(scene.el.querySelector('.kit-stage'), `${clipId} @ ${f}`).not.toBeNull()
              }
            }
            scene.unmount()
          }
        }
      }
      expect(errors).not.toHaveBeenCalled()
    })
  }
})

describe('the first card, made in the course (chapter 2, YAZ-5121)', () => {
  afterEach(() => {
    document.body.textContent = ''
  })
  const ch = chapter('first-card')
  const clip = (id: string) => ch.clips.find((c) => c.id === id)!
  const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    act(() => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click())

  it('holds each step until the person acts, calls done() once per step, and makes the card through the host', async () => {
    const MakeCard = courseScenes('c2-07')
    const done = vi.fn()
    const host = memoryHost()
    const { clock, at } = testClock(4)
    const scene = mountScene(MakeCard, ch, { clock, done, host, waits: (c) => WAITING_CLIPS.has(c.id) })
    for (const id of ['c2-06', 'c2-07', 'c2-08', 'c2-09', 'c2-28', 'c2-10', 'c2-11', 'c2-12', 'c2-13']) expect(courseScenes(id)).toBe(MakeCard)

    scene.render(clip('c2-06'))
    scene.render(clip('c2-07'))
    at(1)
    expect(done).not.toHaveBeenCalled()
    const field = scene.el.querySelector<HTMLTextAreaElement>('#kit-front')!
    expect(document.activeElement).toBe(field)
    typeInto(field, 'Light from the Sun takes about eight minutes to reach Earth.')
    expect(done).not.toHaveBeenCalled()
    act(() => field.form!.requestSubmit())
    expect(done).toHaveBeenCalledTimes(1)
    act(() => field.form!.requestSubmit())
    expect(done).toHaveBeenCalledTimes(1)

    scene.render(clip('c2-08'))
    at(1)
    expect(done).toHaveBeenCalledTimes(1)
    const word = [...scene.el.querySelectorAll('.kit-word')].find((b) => b.textContent === 'eight')
    click(word)
    expect(done).toHaveBeenCalledTimes(2)
    click([...scene.el.querySelectorAll('.kit-word')].find((b) => b.textContent === 'minutes'))
    click(word)
    expect(done).toHaveBeenCalledTimes(2)

    scene.render(clip('c2-09'))
    expect(scene.el.querySelector('.card__blank')).not.toBeNull()

    scene.render(clip('c2-28'))
    const back = scene.el.querySelector<HTMLInputElement>('#kit-back')!
    typeInto(back, 'Light moves at about 300,000 km a second.')
    expect(done).toHaveBeenCalledTimes(2)
    act(() => back.form!.requestSubmit())
    expect(done).toHaveBeenCalledTimes(3)

    scene.render(clip('c2-10'))
    expect(scene.el.querySelector('.card__blank')).not.toBeNull()
    click(scene.el.querySelector('.kit-tap'))
    expect(scene.el.querySelector('.card__blank')).toBeNull()
    expect(done).toHaveBeenCalledTimes(3)
    click(scene.el.querySelector('.kit-tap'))
    expect(done).toHaveBeenCalledTimes(4)
    expect(scene.el.textContent).toContain('300,000 km')

    scene.render(clip('c2-11'))
    expect(done).toHaveBeenCalledTimes(4)
    click([...scene.el.querySelectorAll('.card-inbox__answer')].find((b) => b.textContent?.includes('Remembered')))
    expect(done).toHaveBeenCalledTimes(5)
    click([...scene.el.querySelectorAll('.card-inbox__answer')].find((b) => b.textContent?.includes('Forgot')))
    expect(done).toHaveBeenCalledTimes(5)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host.made.map((m) => m.text)).toEqual(['Light from the Sun takes about {{eight}} minutes to reach Earth.\n---\nLight moves at about 300,000 km a second.'])

    scene.render(clip('c2-12'))
    scene.render(clip('c2-13'))
    at(0.9)
    expect(scene.el.querySelector('.tree__label')?.textContent).toBe('Course Cards')
    // The made card's title, from the host.
    expect(scene.el.textContent).toContain(host.made[0].title)
    expect(done).toHaveBeenCalledTimes(5)
    scene.unmount()
  })

  it('takes the example and a skipped back, and says why when the host only shows', async () => {
    const MakeCard = courseScenes('c2-07')
    const done = vi.fn()
    const { clock } = testClock(4)
    const scene = mountScene(MakeCard, ch, { clock, done, host: showOnlyHost('/demo'), waits: (c) => WAITING_CLIPS.has(c.id) })
    scene.render(clip('c2-07'))
    click([...scene.el.querySelectorAll('button')].find((b) => b.textContent === 'Use this example'))
    scene.render(clip('c2-08'))
    click(scene.el.querySelectorAll('.kit-word')[6])
    scene.render(clip('c2-28'))
    click([...scene.el.querySelectorAll('button')].find((b) => b.textContent === 'Skip'))
    scene.render(clip('c2-10'))
    click(scene.el.querySelector('.kit-tap'))
    scene.render(clip('c2-11'))
    click([...scene.el.querySelectorAll('.card-inbox__answer')].find((b) => b.textContent?.includes('Forgot')))
    expect(done).toHaveBeenCalledTimes(5)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    scene.render(clip('c2-13'))
    expect(scene.el.textContent).toContain(SHOW_ONLY_NOT_YET)
    scene.unmount()
  })

  it('lets a step done before go on at once when the person comes back to it with Back (one done() for that entry)', () => {
    const MakeCard = courseScenes('c2-07')
    const done = vi.fn()
    const { clock } = testClock(4)
    const scene = mountScene(MakeCard, ch, { clock, done, host: showOnlyHost('/demo'), waits: (c) => WAITING_CLIPS.has(c.id) })
    scene.render(clip('c2-07'))
    click([...scene.el.querySelectorAll('button')].find((b) => b.textContent === 'Use this example'))
    scene.render(clip('c2-08'))
    scene.render(clip('c2-07'))
    expect(done).toHaveBeenCalledTimes(2)
    scene.unmount()
  })
})

describe('the first card file (YAZ-5121, the host seam for 6F)', () => {
  it('writes the front with the hidden word in braces, then the back on its own side', () => {
    expect(draftText(['The', 'sky', 'is', 'blue.'], 3, '')).toBe('The sky is {{blue}}.')
    expect(draftText(['The', 'sky', 'is', 'blue.'], 1, ' Rayleigh scattering. ')).toBe('The {{sky}} is blue.\n---\nRayleigh scattering.')
    expect(draftText(['A', 'b'], -1, '')).toBe('A b')
  })

  it('makes a title from the first words', () => {
    expect(draftTitle('The sky is {{blue}}.')).toBe('The sky is blue')
    expect(draftTitle('One two three four five six seven')).toBe('One two three four five six…')
    expect(draftTitle('')).toBe('My first card')
  })

  it('makes the card through host.makeFirstCard (YAZ-5124); a host that only shows says why; a failure is one line', async () => {
    const input = firstCardInput(['The', 'sky', 'is', 'blue.'], 3, ' Rayleigh scattering. ')
    expect(input).toEqual({ front: 'The sky is blue.', hidden: { start: 11, end: 15 }, back: 'Rayleigh scattering.' })
    const host = memoryHost()
    expect(await makeFirstCard(host, input)).toMatchObject({ text: 'The sky is {{blue}}.\n---\nRayleigh scattering.' })
    expect(host.made).toHaveLength(1)
    expect(await makeFirstCard(showOnlyHost(null), input)).toEqual({ showOnly: 'Open a vault to make real cards.' })
    expect(await makeFirstCard(showOnlyHost('/demo'), input)).toEqual({ showOnly: SHOW_ONLY_NOT_YET })
    const broken = { ...memoryHost(), makeFirstCard: () => Promise.reject(new Error('disk full')) }
    expect(await makeFirstCard(broken, input)).toEqual({ showOnly: COULD_NOT_MAKE })
  })
})
