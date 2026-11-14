/**
 * Chapters 6 to 8 (YAZ-5121): the papers and the quote keep the copyright rule; each clip has marks on its words; each
 * scene draws at 0, 0.5, 1 and each mark, in light, dark and reduced motion, with a host that holds cards; the card
 * pick (c7-08) holds, then calls `done()` once; the AI step (c8-11 to c8-16) calls `done()` once on each clip's own
 * event, with the memory host, and again when a clip is entered again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { COURSE } from '../script'
import { WAITING_CLIPS } from '../waits'
import { PlaceholderScene } from '../PlaceholderScene'
import { BUILT_CHAPTERS, courseScenes } from '.'
import { KNOWLEDGE_BASE_SCENES } from './knowledgeBase'
import { GOOD_CARD_SCENES } from './goodCard'
import { AI_SCENES } from './ai'
import { lineWords } from './papers'
import { PAPERS_6_TO_8, QUOTES_6_TO_8, TEN_WAYS } from './papers6to8'
import { memoryHost, mountScene, testClock } from './testing'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MINE = [KNOWLEDGE_BASE_SCENES, GOOD_CARD_SCENES, AI_SCENES]
const chapter = (id: string) => COURSE.find((ch) => ch.id === id)!
const clipOf = (id: string) => COURSE.flatMap((ch) => ch.clips).find((c) => c.id === id)!
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click())
const flush = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })

describe('chapters 6 to 8 are built (YAZ-5121)', () => {
  it('gives every clip a real scene, and marks each clip on its words: sorted fractions inside (0, 1)', () => {
    for (const ch of MINE) {
      expect(BUILT_CHAPTERS).toContain(ch.chapter)
      for (const clip of chapter(ch.chapter).clips) {
        expect(courseScenes(clip.id), clip.id).not.toBe(PlaceholderScene)
        const marks = clip.marks ?? []
        expect(marks.length, clip.id).toBeGreaterThan(0)
        for (const m of marks) expect(m > 0 && m < 1, `${clip.id} ${m}`).toBe(true)
        expect([...marks].sort((a, b) => a - b)).toEqual(marks)
      }
    }
  })
})

describe('the papers and the quote of chapters 6 to 8 (the copyright rule)', () => {
  it('quotes fewer than 15 words; a paraphrase stays one short line', () => {
    for (const paper of Object.values(PAPERS_6_TO_8)) {
      if (paper.quote) expect(lineWords(paper.line), paper.id).toBeLessThan(15)
      else expect(lineWords(paper.line), paper.id).toBeLessThanOrEqual(20)
      expect(paper.authors.length).toBeGreaterThan(0)
      expect(paper.year).toBeGreaterThan(1800)
    }
    for (const quote of Object.values(QUOTES_6_TO_8)) expect(lineWords(quote.line), quote.id).toBeLessThan(15)
  })

  it('grades the ten ways as the 2013 review did: only testing and spacing get the top grade; re-reading and highlighting the lowest', () => {
    expect(TEN_WAYS).toHaveLength(10)
    expect(TEN_WAYS.filter((w) => w.grade === 'High').map((w) => w.key)).toEqual(['test', 'space'])
    for (const key of ['reread', 'highlight']) expect(TEN_WAYS.find((w) => w.key === key)?.grade).toBe('Low')
  })
})

describe('each scene of chapters 6 to 8 draws (YAZ-5121)', () => {
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
    it(`at 0, 0.5, 1 and each mark, ${look}, with a host that holds cards`, () => {
      document.documentElement.dataset.theme = look === 'dark' ? 'dark' : 'light'
      for (const ch of MINE) {
        for (const entry of ch.entries) {
          const host = memoryHost()
          host.set({ text: 'Bread notes', copiedAt: 1, prompt: { text: 'Prompt', folder: host.folder } })
          host.arrive({ path: `${host.folder}/a.md`, index: 0, id: 'A1B2', title: 'How bread rises' })
          const { clock, at } = testClock(6)
          const scene = mountScene(entry.scene, chapter(ch.chapter), { clock, done: () => undefined, reducedMotion: look === 'reduced', host })
          for (const id of entry.clips) {
            const clip = clipOf(id)
            scene.render(clip)
            for (const f of [0, 0.5, 1, ...(clip.marks ?? [])]) {
              at(f, true)
              expect(scene.el.querySelector('.kit-stage'), `${id} @ ${f}`).not.toBeNull()
            }
          }
          scene.unmount()
        }
      }
      expect(errors).not.toHaveBeenCalled()
    })
  }

  it('never moves a thing with reduced motion in the tree, the head and the report card', () => {
    for (const id of ['c7-23', 'c6-02', 'c7-11']) {
      const { clock, at } = testClock(6)
      const scene = mountScene(courseScenes(id), chapter(COURSE.find((ch) => ch.clips.some((c) => c.id === id))!.id), { clock, done: () => undefined, reducedMotion: true, host: memoryHost() })
      scene.render(clipOf(id))
      at(0.6, true)
      for (const el of scene.el.querySelectorAll<HTMLElement>('.kit-treecard')) expect(el.style.transform).toBe('translate(-50%, -50%) scale(1.0000)')
      for (const el of scene.el.querySelectorAll<HTMLElement>('.kit-report, .kit-report__row')) expect(el.style.transform).toBe('')
      scene.unmount()
    }
  })
})

describe('the card pick (c7-08, YAZ-5121)', () => {
  afterEach(() => {
    document.body.textContent = ''
  })

  it('holds until the person picks, calls done() once, and once more when the clip is entered again', () => {
    const Pick = courseScenes('c7-08')
    expect(courseScenes('c7-09')).toBe(Pick)
    expect(WAITING_CLIPS.has('c7-08')).toBe(true)
    const done = vi.fn()
    const { clock, at } = testClock(4)
    const scene = mountScene(Pick, chapter('good-card'), { clock, done, host: memoryHost(), waits: (c) => WAITING_CLIPS.has(c.id) })
    scene.render(clipOf('c7-08'))
    at(1)
    expect(done).not.toHaveBeenCalled()
    const cards = [...scene.el.querySelectorAll('button.gc-pick__card')]
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Card A: DNS stands for Domain Name System.', 'Card B: DNS stands for Domain Name System.'])
    click(cards[1])
    expect(done).toHaveBeenCalledTimes(1)
    click(cards[0])
    expect(done).toHaveBeenCalledTimes(1)
    expect(scene.el.textContent).toContain('You picked B')

    scene.render(clipOf('c7-09'))
    at(1)
    expect(scene.el.textContent).toContain('You picked B. Right.')
    expect(scene.el.querySelector('button.gc-pick__card')).toBeNull()
    // Back to the pick: it is done already, so the clip goes on (its own done()).
    scene.render(clipOf('c7-08'))
    expect(done).toHaveBeenCalledTimes(2)
    scene.unmount()
  })
})

describe('the AI step (c8-11 to c8-16, YAZ-5121 with YAZ-5124)', () => {
  afterEach(() => {
    document.body.textContent = ''
  })
  const button = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

  it("mounts the real panel with each clip's parts and calls done() once on each clip's own event", async () => {
    const Step = courseScenes('c8-11')
    for (const id of ['c8-12', 'c8-13', 'c8-14', 'c8-15', 'c8-16']) expect(courseScenes(id)).toBe(Step)
    const done = vi.fn()
    const host = memoryHost()
    const { clock, at } = testClock(5)
    const scene = mountScene(Step, chapter('ai'), { clock, done, host, waits: (c) => WAITING_CLIPS.has(c.id) })

    scene.render(clipOf('c8-11'))
    at(1)
    expect(done).not.toHaveBeenCalled()
    expect(scene.el.querySelector('#agent-step-text')).not.toBeNull()
    expect(scene.el.querySelector('.agent-step__prompt')).toBeNull()
    click(button(scene.el, 'Use the example'))
    expect(done).toHaveBeenCalledTimes(1)

    scene.render(clipOf('c8-12'))
    await flush()
    expect(done).toHaveBeenCalledTimes(1)
    expect(scene.el.querySelector('#agent-step-text')).toBeNull()
    expect(scene.el.querySelector('.agent-step__prompt')?.textContent).toContain('Example text')
    click(button(scene.el, 'Copy'))
    await flush()
    expect(done).toHaveBeenCalledTimes(2)

    scene.render(clipOf('c8-13'))
    await flush()
    expect(done).toHaveBeenCalledTimes(2)
    act(() => host.arrive({ path: `${host.folder}/how-bread-rises.md`, index: 0, id: 'B1R2', title: 'How bread rises' }, 'Dough rises because {{yeast}} makes gas.\n---\nThe gluten traps it.'))
    expect(done).toHaveBeenCalledTimes(3)
    act(() => host.arrive({ path: `${host.folder}/poke-test.md`, index: 0, id: 'P0K3', title: 'The poke test' }))
    expect(done).toHaveBeenCalledTimes(3)

    // c8-14 waits for nothing: no done(); its drawing of the minute shows only while no card has come.
    scene.render(clipOf('c8-14'))
    await flush()
    expect(done).toHaveBeenCalledTimes(3)
    expect(scene.el.querySelector('.ai-minute')).toBeNull()

    scene.render(clipOf('c8-15'))
    await flush()
    const opens = [...scene.el.querySelectorAll<HTMLButtonElement>('.agent-step__open')]
    expect(opens).toHaveLength(2)
    click(opens[0])
    await flush()
    expect(done).toHaveBeenCalledTimes(3)
    click(opens[1])
    await flush()
    expect(done).toHaveBeenCalledTimes(4)
    expect(scene.el.textContent).toContain('Handmade')

    scene.render(clipOf('c8-16'))
    await flush()
    click(button(scene.el, 'No agent? Skip'))
    expect(done).toHaveBeenCalledTimes(4)
    click(button(scene.el, 'Make these cards'))
    await flush()
    expect(done).toHaveBeenCalledTimes(5)

    // Back to a clip already done: its event is told at mount, so it goes on at once (one more done()).
    scene.render(clipOf('c8-12'))
    await flush()
    expect(done).toHaveBeenCalledTimes(6)
    scene.unmount()
  })

  it('shows the quiet minute on c8-14 while no card has come, and writes nothing itself', async () => {
    const host = memoryHost()
    host.set({ text: 'x', copiedAt: 1, prompt: { text: 'Prompt', folder: host.folder } })
    const { clock, at } = testClock(4)
    const scene = mountScene(courseScenes('c8-14'), chapter('ai'), { clock, done: () => undefined, host })
    scene.render(clipOf('c8-14'))
    at(0.9)
    await flush()
    expect(scene.el.querySelector('.ai-minute')).not.toBeNull()
    expect(host.made).toEqual([])
    scene.unmount()
  })
})
