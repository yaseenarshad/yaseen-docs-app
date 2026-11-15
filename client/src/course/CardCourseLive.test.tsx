/**
 * LIVE STEPS IN THE COURSE LAYER (YAZ-5366): the course picks its size for each part, lights the real control on the
 * clip's mark, and holds a do step until the person's real action. A fake clock (the frame queue and `performance.now`)
 * and fake real controls (`data-tour` elements with a box), as the tour layer's own tests do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cleanCourseState, defaultCourseState, type CourseState } from '@shared/courseState'
import { storage } from '../lib/storage'
import { COURSE as SCRIPT, type CourseChapter } from './script'
import { CardCourse, LIVE_IN_APP_BUTTON, LIVE_IN_APP_LINE, type CardCourseProps } from './CardCourse'
import { memoryHost, placeholderScenes, type MemoryHost } from './scenes/testing'
import { clipSeconds } from './courseTime'
import { GAP_SECONDS } from './player'
import { tourEvent } from './tourBus'
import { TARGET_HELP } from './tourHelp'
import { HINT_AFTER_MS } from './TourLayer'
import { setLitBox } from './dockArea'
import { holdsLive } from './live'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const LESSON = { id: 'l1', text: 'A lesson about cards.', dock: 'full' as const }
const SHOW = { id: 'l2', text: 'Your card is in the folder called Course Cards.', marks: [0.5], dock: 'side' as const, live: [{ target: 'sidebar-course-cards', mark: 0 }] }
const SHOW_TOO = { id: 'l2b', text: 'It sits at the top of your vault.', dock: 'side' as const }
const DO = {
  id: 'l3',
  text: 'Right-click the folder, and choose New card.',
  marks: [0.2, 0.6],
  dock: 'corner' as const,
  live: [
    { target: 'sidebar-course-cards', mark: 0, say: 'Right-click the Course Cards folder.', done: { event: 'folder-menu-open' } },
    { target: 'new-card', mark: 1, say: 'Choose New card.', done: 'click' as const },
    { target: 'new-card-name', say: 'Type a title, and press Enter.', done: { event: 'card-file-created' }, example: { text: 'Protein', enter: true as const } },
  ],
}
const AFTER = { id: 'l4', text: 'Back to the lesson.', dock: 'full' as const }
/** A lesson in full whose step comes right after its words (no words for it yet): the step asks for the corner. */
const LATE = { id: 'i1', text: 'More than double the memory.', live: [{ target: 'review-folder', say: 'Choose Review this folder.', done: 'click' as const }] }
const COURSE: CourseChapter[] = [
  { id: 'first-card', title: 'Your first card', clips: [LESSON, SHOW, SHOW_TOO, DO, AFTER] },
  { id: 'inbox', title: 'The Inbox', clips: [LATE, { id: 'i2', text: 'The end.' }] },
]

let root: Root
let el: HTMLDivElement
let app: HTMLDivElement
let saved: CourseState
let queue: FrameRequestCallback[] = []
let now = 0
let host: MemoryHost

beforeEach(() => {
  saved = defaultCourseState()
  vi.spyOn(storage, 'getCourse').mockImplementation(() => saved)
  vi.spyOn(storage, 'setCourse').mockImplementation((patch) => {
    saved = cleanCourseState(patch, saved)
  })
  queue = []
  now = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
    queue.push(fn)
    return queue.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  Object.assign(window, { innerWidth: 1024, innerHeight: 768 })
  app = document.createElement('div')
  app.id = 'root'
  document.body.appendChild(app)
  el = document.createElement('div')
  app.appendChild(el)
  root = createRoot(el)
  host = memoryHost('/v')
  host.cards.push({ path: `${host.folder}/a.md`, index: 0, id: null, title: 'A' }, { path: `${host.folder}/b.md`, index: 0, id: null, title: 'B' })
})

afterEach(() => {
  act(() => root.unmount())
  document.body.textContent = ''
  setLitBox(null)
  vi.restoreAllMocks()
})

/** Frames of `ms` each: the course's clock and the tour layer's loop both run on them. */
function frames(n: number, ms = 100): void {
  for (let i = 0; i < n; i++) {
    now += ms
    const run = queue
    queue = []
    act(() => run.forEach((fn) => fn(now)))
  }
}
const flush = () => act(async () => undefined)
/** Seconds of play, in frames, with the promises (the live check) settled on the way. */
async function play(seconds: number): Promise<void> {
  const n = Math.ceil((seconds * 1000) / 100)
  for (let i = 0; i < n; i++) {
    frames(1)
    if (i % 5 === 0) await flush()
  }
}

async function mount(at: { chapter: string; clip: string } | null, props: Partial<CardCourseProps> = {}): Promise<void> {
  if (at !== null) saved = { ...saved, ...at }
  act(() => root.render(<CardCourse vault="/v" onClose={() => undefined} course={COURSE} scenes={placeholderScenes} host={host} {...props} />))
  await flush()
}
const layer = () => document.querySelector<HTMLElement>('.course')!
const caption = () => document.querySelector('.course__caption')!.textContent
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.course button, .course-tour button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
const click = (b: Element | undefined) => act(() => (b as HTMLElement).click())
const ring = () => document.querySelector<HTMLElement>('.course-tour--live .course-tour__ring')
const coachSay = () => document.querySelector('.course-tour--live .course-tour__say')?.textContent ?? null
const live = () => document.querySelector<HTMLElement>('.course-tour--live')
const arrow = () => document.querySelector<HTMLElement>('.course-tour--live .course-tour__arrow')
const seconds = (clip: { text: string }) => clipSeconds({ id: '', ...clip }, null)

/** A real-looking control in the app, with a box (jsdom lays nothing out). */
function control(tour: string, box = { left: 10, top: 100, width: 200, height: 28 }, tag: 'button' | 'input' | 'div' = 'button'): HTMLElement {
  const c = document.createElement(tag)
  c.dataset.tour = tour
  c.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box })
  app.insertBefore(c, el)
  return c
}

describe('the course picks its size for each part (YAZ-5366)', () => {
  it("a clip's size is applied when it starts; the person's choice wins until the next part", async () => {
    await mount({ chapter: 'first-card', clip: 'l1' })
    expect(layer().dataset.size).toBe('full')
    click(button('Next step'))
    expect(caption()).toBe(SHOW.text)
    expect(layer().dataset.size).toBe('side')
    // The person goes back to full in this part: it holds for the next clip of the same size.
    click(button('Full size'))
    click(button('Next step'))
    expect(caption()).toBe(SHOW_TOO.text)
    expect(layer().dataset.size).toBe('full')
    // The next part (the corner): the course asks again.
    click(button('Next step'))
    expect(caption()).toBe(DO.text)
    expect(layer().dataset.size).toBe('corner')
    click(button('Next step'))
    expect(layer().dataset.size).toBe('full')
    // Only the person's own choice is kept.
    expect(saved.dock).toBe('full')
  })

  it('a chapter with no size named is a lesson: full, even after the person chose a size in the chapter before', async () => {
    await mount({ chapter: 'first-card', clip: 'l4' })
    click(button('Side panel'))
    click(button('Next step'))
    expect(caption()).toMatch(/^Chapter 1 done/)
    click(button('Next step'))
    expect(caption()).toBe(LATE.text)
    expect(layer().dataset.size).toBe('full')
  })
})

describe('live steps (YAZ-5366)', () => {
  it("the light lands on the real control on the clip's mark, beside the docked course, and goes out with the clip", async () => {
    control('sidebar-course-cards', { left: 10, top: 120, width: 180, height: 26 })
    await mount({ chapter: 'first-card', clip: 'l2' })
    click(button('Play'))
    await play(seconds(SHOW) * 0.4)
    expect(caption()).toBe(SHOW.text)
    expect(ring()).toBeNull()
    expect(arrow()).toBeNull()
    await play(seconds(SHOW) * 0.2)
    expect(ring()).not.toBeNull()
    expect(ring()!.style.top).toBe('116px')
    // A show step ("light only"): the ring and the red arrow (YAZ-5405), no dim and no coach card.
    expect(live()!.dataset.liveStep).toBe('show')
    expect(document.querySelector('.course-tour--live .course-tour__dim')).toBeNull()
    expect(coachSay()).toBeNull()
    expect(arrow()).not.toBeNull()
    expect(arrow()!.getAttribute('aria-hidden')).toBe('true')
    // The arrow sits outside the lit row and points at it: its line goes through the row's middle (116 + 34 / 2).
    const a = arrow()!
    const side = a.dataset.side
    expect(['left', 'right']).toContain(side)
    expect(Number.parseFloat(a.style.top) + Number.parseFloat(a.style.height) / 2).toBe(133)
    // In full size the course draws nothing in the app: no ring, no arrow.
    click(button('Full size'))
    await play(0.2)
    expect(ring()).toBeNull()
    expect(arrow()).toBeNull()
    click(button('Side panel'))
    await play(0.2)
    expect(arrow()).not.toBeNull()
    // The course does not wait for a show step.
    await play(seconds(SHOW) * 0.5 + GAP_SECONDS + 0.2)
    expect(caption()).toBe(SHOW_TOO.text)
    expect(live()).toBeNull()
  })

  it('a do step holds the clip until the real event; each next step lights on its mark; then the course goes on', async () => {
    const row = control('sidebar-course-cards', { left: 10, top: 120, width: 180, height: 26 })
    const menu = control('new-card', { left: 40, top: 150, width: 140, height: 24 })
    const onMenu = vi.fn()
    menu.addEventListener('click', onMenu)
    await mount({ chapter: 'first-card', clip: 'l3' })
    click(button('Play'))
    await play(seconds(DO) * 0.3)
    expect(coachSay()).toBe('Right-click the Course Cards folder.')
    expect(live()!.dataset.liveStep).toBe('do')
    expect(document.querySelector('.course-tour--live .course-tour__dim')).not.toBeNull()
    expect(ring()!.style.top).toBe('116px')
    // A do step has the red arrow too, off the coach card (YAZ-5405).
    expect(arrow()).not.toBeNull()
    const box = (el: HTMLElement) => ({ left: Number.parseFloat(el.style.left), top: Number.parseFloat(el.style.top), width: Number.parseFloat(el.style.width) || 300, height: Number.parseFloat(el.style.height) || 170 })
    const [a, c] = [box(arrow()!), box(document.querySelector<HTMLElement>('.course-tour--live .course-tour__coach')!)]
    expect(a.left < c.left + c.width && c.left < a.left + a.width && a.top < c.top + c.height && c.top < a.top + a.height).toBe(false)
    // The voice ends; the course holds at the end of the words, and never runs ahead.
    await play(seconds(DO) + 3)
    expect(caption()).toBe(DO.text)
    // Another folder's menu is not the step.
    act(() => tourEvent('folder-menu-open', '/v/Other'))
    frames(1)
    expect(coachSay()).toBe('Right-click the Course Cards folder.')
    act(() => tourEvent('folder-menu-open', host.folder))
    frames(1)
    expect(coachSay()).toBe('Choose New card.')
    void row
    // The real click reaches the real control, and ends the step.
    act(() => menu.click())
    expect(onMenu).toHaveBeenCalledOnce()
    frames(1)
    expect(coachSay()).toBe('Type a title, and press Enter.')
    act(() => tourEvent('card-file-created', `${host.folder}/Protein.md`))
    await play(GAP_SECONDS + 0.3)
    expect(caption()).toBe(AFTER.text)
    expect(live()).toBeNull()
  })

  it('a do step that comes after a lesson asks for the corner; the person in full sees where the step is', async () => {
    control('review-folder')
    await mount({ chapter: 'inbox', clip: 'i1' })
    expect(layer().dataset.size).toBe('full')
    click(button('Play'))
    await play(seconds(LATE) + 1)
    expect(layer().dataset.size).toBe('corner')
    expect(coachSay()).toBe('Choose Review this folder.')
    // The person goes back to full: the course still holds, says where the step is, and offers the way back.
    click(button('Full size'))
    await play(1)
    expect(caption()).toBe(LATE.text)
    expect(live()!.querySelector('.course-tour__coach')).toBeNull()
    expect(document.querySelector('.course__note')!.textContent).toContain(LIVE_IN_APP_LINE)
    click(button(LIVE_IN_APP_BUTTON))
    expect(layer().dataset.size).toBe('corner')
    await play(0.3)
    expect(coachSay()).toBe('Choose Review this folder.')
  })

  it("Next always goes on; Skip moves past a step, and Skip on the last one lets the course go on", async () => {
    control('sidebar-course-cards')
    control('new-card')
    await mount({ chapter: 'first-card', clip: 'l3' })
    click(button('Play'))
    await play(seconds(DO) + 1)
    expect(coachSay()).toBe('Right-click the Course Cards folder.')
    click(button('Skip'))
    frames(1)
    expect(coachSay()).toBe('Choose New card.')
    click(button('Skip'))
    frames(1)
    expect(coachSay()).toBe('Type a title, and press Enter.')
    click(button('Skip'))
    await play(GAP_SECONDS + 0.3)
    expect(caption()).toBe(AFTER.text)

    // Next, on a held clip: at once.
    click(button('Back one step'))
    expect(caption()).toBe(DO.text)
    await play(seconds(DO) + 1)
    expect(caption()).toBe(DO.text)
    click(button('Next step'))
    expect(caption()).toBe(AFTER.text)
    expect(live()).toBeNull()
  })

  it('a control that is not on screen: the coach says where it is, and nothing blocks', async () => {
    await mount({ chapter: 'first-card', clip: 'l3' })
    click(button('Play'))
    await play(seconds(DO) * 0.3)
    expect(coachSay()).toBe('Right-click the Course Cards folder.')
    await play(HINT_AFTER_MS / 1000 + 0.3)
    expect(document.querySelector('.course-tour--live .course-tour__hint')!.textContent).toBe(TARGET_HELP['sidebar-course-cards'].where)
    expect(button('Skip')).toBeDefined()
    // A late control still gets its light.
    control('sidebar-course-cards', { left: 10, top: 300, width: 180, height: 26 })
    frames(1)
    expect(ring()!.style.top).toBe('296px')
    click(button('Next step'))
    expect(caption()).toBe(AFTER.text)
  })

  it('"Use an example" types only into the Course Cards name box; nothing is written anywhere else', async () => {
    control('sidebar-course-cards')
    const made: string[] = []
    const box = control('new-card-name', { left: 10, top: 150, width: 180, height: 24 }, 'input') as HTMLInputElement
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      made.push(box.value)
      tourEvent('card-file-created', `${host.folder}/${box.value}.md`)
    })
    const writes = { makeFirstCard: vi.spyOn(host, 'makeFirstCard'), coursePage: vi.spyOn(host, 'coursePage') }
    await mount({ chapter: 'first-card', clip: 'l3' })
    click(button('Play'))
    await play(seconds(DO) + 1)
    // The menu of ANOTHER folder, then New card: its name box is not the course's, so no example.
    act(() => tourEvent('folder-menu-open', '/v/Other'))
    click(button('Skip'))
    click(button('Skip'))
    frames(1)
    expect(coachSay()).toBe('Type a title, and press Enter.')
    expect(button('Use an example')).toBeUndefined()
    // The course's own folder menu: the example types into its name box, and its own Enter makes the card.
    act(() => tourEvent('folder-menu-open', host.folder))
    frames(1)
    click(button('Use an example'))
    expect(made).toEqual(['Protein'])
    await play(GAP_SECONDS + 0.3)
    expect(caption()).toBe(AFTER.text)
    // The live steps wrote nothing through the course's host.
    expect(writes.makeFirstCard).not.toHaveBeenCalled()
    expect(writes.coursePage).not.toHaveBeenCalled()
  })

  it('without a vault the steps cannot run: one line, and the course goes on by itself', async () => {
    control('sidebar-course-cards')
    await mount({ chapter: 'first-card', clip: 'l3' }, { host: undefined, vault: null })
    click(button('Play'))
    await play(seconds(DO) + GAP_SECONDS + 1)
    expect(caption()).toBe(AFTER.text)
  })
})

describe('the hands-on chapters walk from their first to their last clip on fake real actions (YAZ-5366)', () => {
  const HANDS_ON = ['first-card', 'inbox', 'where', 'links', 'care', 'where-things-are']
  const targets = [...new Set(SCRIPT.flatMap((ch) => ch.clips.flatMap((c) => (c.live ?? []).map((s) => s.target))))]

  for (const id of HANDS_ON) {
    it(`chapter ${SCRIPT.findIndex((ch) => ch.id === id) + 1} (${id})`, async () => {
      const chapter = SCRIPT.find((ch) => ch.id === id)!
      targets.forEach((t, i) => control(t, { left: 10, top: 40 + i * 30, width: 160, height: 24 }))
      saved = { ...saved, speed: 1.5 }
      act(() => root.render(<CardCourse vault="/v" onClose={() => undefined} course={SCRIPT} chapter={id} scenes={placeholderScenes} host={host} />))
      await flush()
      click(button('Play'))
      const doSteps = chapter.clips.flatMap((c) => (c.live ?? []).filter((s) => s.done !== undefined).map((s) => `${c.id} ${s.say}`))
      const done: string[] = []
      const heldClips = new Set<string>()
      for (let i = 0; i < 4000 && !/^(Chapter \d+ done|That's the whole course)/.test(caption()); i++) {
        frames(1, 250)
        if (i % 4 === 0) await flush()
        // The scene's own steps (chapter 2's card in the course): the person does them.
        const sceneDone = [...document.querySelectorAll<HTMLButtonElement>('.course button')].find((b) => b.textContent === 'Done, go on')
        if (sceneDone !== undefined) click(sceneDone)
        const clip = chapter.clips.find((c) => c.text === caption())
        const say = document.querySelector('.course-tour--live[data-live-step="do"] .course-tour__say')?.textContent ?? null
        if (clip === undefined || say === null) continue
        const step = (clip.live ?? []).find((s) => s.say === say && s.done !== undefined && !done.includes(`${clip.id} ${s.say}`))
        if (step === undefined) continue
        if (holdsLive(clip)) heldClips.add(clip.id)
        done.push(`${clip.id} ${step.say}`)
        const target = document.querySelector<HTMLElement>(`#root > [data-tour="${step.target}"]`)!
        if (step.done === 'click') act(() => target.click())
        else {
          const event = step.done!.event
          const detail = event === 'folder-menu-open' ? host.folder : event.startsWith('card-file') ? `${host.folder}/a.md` : undefined
          act(() => tourEvent(event as Parameters<typeof tourEvent>[0], detail))
        }
      }
      expect(caption(), id).toMatch(/^(Chapter \d+ done|That's the whole course)/)
      expect(done, id).toEqual(doSteps)
      expect(heldClips.size, id).toBeGreaterThan(0)
    }, 120_000)
  }
})
