import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CourseChapter } from './script'
import type { CourseCard, CourseHost } from './courseHost'
import { showOnlyHost } from './courseHost'
import { SHOW_ONLY } from './courseCards'
import { memoryHost } from './scenes/testing'
import { FINISH_MS, HINT_AFTER_MS, TourLayer, type TourLayerProps } from './TourLayer'
import { SHOW_ME_AFTER_MS } from './tourEngine'
import { onTourShow, tourEvent, tourPlaces, type TourPlace } from './tourBus'
import { TARGET_HELP } from './tourHelp'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const FOLDER = '/v/Course Cards'
/** A made-up chapter on made-up controls: a folder row, a menu row, a name box. */
const CHAPTER: CourseChapter = {
  id: 'first-card',
  title: 'Your first card',
  clips: [{ id: 'x1', text: 'Words.' }],
  tryIt: [
    { target: 'sidebar-course-cards', say: 'Right-click the Course Cards folder in the sidebar.', done: { event: 'folder-menu-open' } },
    { target: 'new-card', say: 'Choose New card.', done: 'click' },
    { target: 'new-card-name', say: 'Type a title, and press Enter.', done: { event: 'card-file-created' } },
  ],
}

function fakeHost(cards: CourseCard[] = [{ path: `${FOLDER}/A.md`, index: 0, id: null, title: 'A' }]): CourseHost {
  // The full host of YAZ-5124 (`memoryHost`), with this test's folder and cards.
  return { ...memoryHost('/v'), courseCards: () => Promise.resolve({ path: FOLDER }), watchCards: (_f, on) => (on(cards), () => undefined) }
}

let root: Root
let host: HTMLDivElement
let app: HTMLDivElement
let queue: FrameRequestCallback[] = []
let now = 0
function frames(n: number, ms = 100): void {
  for (let i = 0; i < n; i++) {
    now += ms
    const run = queue
    queue = []
    act(() => run.forEach((fn) => fn(now)))
  }
}
const flush = () => act(async () => undefined)

/** A real-looking control with a box, as jsdom lays nothing out. */
function control<K extends keyof HTMLElementTagNameMap>(tag: K, tour: string, box: { left: number; top: number; width: number; height: number }): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.dataset.tour = tour
  place(el, box)
  app.appendChild(el)
  return el
}
function place(el: Element, box: { left: number; top: number; width: number; height: number }): void {
  el.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box })
}

beforeEach(() => {
  queue = []
  now = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
    queue.push(fn)
    return queue.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  app = document.createElement('div')
  document.body.appendChild(app)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.textContent = ''
  vi.restoreAllMocks()
})

async function mount(props: Partial<TourLayerProps> = {}): Promise<TourLayerProps> {
  const all: TourLayerProps = { chapter: CHAPTER, steps: CHAPTER.tryIt!, host: fakeHost(), onEnd: vi.fn(), ...props }
  act(() => root.render(<TourLayer {...all} />))
  await flush()
  frames(1)
  return all
}
const coach = () => document.querySelector<HTMLElement>('.course-tour__coach')!
const say = () => document.querySelector('.course-tour__say')!.textContent
const ring = () => document.querySelector<HTMLElement>('.course-tour__ring')
const button = (name: string) => [...coach().querySelectorAll('button')].find((b) => b.textContent === name)
const key = (target: EventTarget, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void target.dispatchEvent(e))
  return e
}

describe('the tour layer (YAZ-5123)', () => {
  it('the coach card is a named region; its line is live; every control has a name; the layer takes no pointer', async () => {
    control('button', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    await mount()
    expect(coach().getAttribute('aria-label')).toBe('Try it in the app')
    expect(coach().getAttribute('role')).toBeNull() // not a dialog: the Inbox keeps its keys under it
    expect(document.querySelector('.course-tour__say')!.getAttribute('aria-live')).toBe('polite')
    expect(say()).toBe('Right-click the Course Cards folder in the sidebar.Step 1 of 3')
    for (const b of coach().querySelectorAll('button')) expect(b.textContent).not.toBe('')
    expect(button('Back to the course')).toBeDefined()
    expect(button('Skip')).toBeDefined()
    expect(document.querySelector('.course-tour__dim')!.getAttribute('aria-hidden')).toBe('true')
    // The tour's places are out for the sidebar's mark.
    expect(tourPlaces().folder).toBe(FOLDER)
  })

  it('the hole and the ring follow the control: a scroll or a resize moves them', async () => {
    const row = control('button', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    await mount()
    expect(ring()!.style.top).toBe('96px')
    expect(ring()!.style.width).toBe('208px')
    place(row, { left: 10, top: 300, width: 200, height: 28 })
    frames(1)
    expect(ring()!.style.top).toBe('296px')
    expect(document.querySelector('.course-tour__dim path')!.getAttribute('d')).toContain('M14 296')
    // The coach card sits below it, not over it.
    expect(Number.parseFloat(coach().style.top)).toBeGreaterThanOrEqual(296 + 36)
  })

  it('a step ends on the app event; the real control still gets its click and the step goes on', async () => {
    control('button', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    const onClick = vi.fn()
    const row = control('button', 'new-card', { left: 40, top: 140, width: 160, height: 26 })
    row.addEventListener('click', onClick)
    await mount()
    // Another folder's menu does nothing.
    act(() => tourEvent('folder-menu-open', '/v/Other'))
    expect(say()).toContain('Step 1 of 3')
    act(() => tourEvent('folder-menu-open', FOLDER))
    frames(1)
    expect(say()).toBe('Choose New card.Step 2 of 3')
    act(() => row.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    frames(1)
    expect(say()).toContain('Step 3 of 3')
  })

  it('the keyboard goes to the control from nowhere; the real typing reaches it; Esc in the field is the field’s', async () => {
    const box = control('input', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    const typed = vi.fn()
    box.addEventListener('keydown', (e) => typed(e.key))
    const props = await mount()
    expect(document.activeElement).toBe(box)
    const k = key(box, 'a')
    expect(typed).toHaveBeenCalledWith('a')
    expect(k.defaultPrevented).toBe(false)
    const esc = key(box, 'Escape')
    expect(esc.defaultPrevented).toBe(false)
    expect(props.onEnd).not.toHaveBeenCalled()
  })

  it('Esc leaves the tour, but a menu that shows keeps its own Esc first', async () => {
    const props = await mount()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    place(menu, { left: 0, top: 0, width: 100, height: 100 })
    document.body.appendChild(menu)
    key(document.body, 'Escape')
    expect(props.onEnd).not.toHaveBeenCalled()
    menu.remove()
    const esc = key(document.body, 'Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(props.onEnd).toHaveBeenCalledWith('left')
  })

  it('a control not on screen: the coach says where it is, then offers Show me (the app’s navigation); the control comes late', async () => {
    const asked: TourPlace[] = []
    const stop = onTourShow((p) => asked.push(p))
    await mount()
    expect(ring()).toBeNull()
    expect(document.querySelector('.course-tour__hint')).toBeNull()
    frames(Math.ceil(HINT_AFTER_MS / 100) + 1)
    expect(document.querySelector('.course-tour__hint')!.textContent).toBe(TARGET_HELP['sidebar-course-cards'].where)
    expect(button('Show me')).toBeUndefined()
    frames(Math.ceil(SHOW_ME_AFTER_MS / 100))
    act(() => button('Show me')!.click())
    expect(asked).toEqual([{ kind: 'folder', path: FOLDER }])
    // Skip is always there; the tour never skips by itself.
    expect(button('Skip')).toBeDefined()
    expect(say()).toContain('Step 1 of 3')
    control('button', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    frames(1)
    expect(ring()).not.toBeNull()
    expect(document.querySelector('.course-tour__hint')).toBeNull()
    stop()
  })

  it('a precondition that cannot be met: one line, and the way back to the course', async () => {
    // Chapter 3's tour needs a card in the folder.
    const props = await mount({ host: fakeHost([]), chapter: { ...CHAPTER, id: 'inbox' } })
    expect(say()).toBe('There is no card in Course Cards yet. Chapter 2 shows how to make one.')
    // Chapter 2 itself needs no card: only the folder. A host that only shows says why.
    act(() => root.render(<></>))
    const again = await mount({ host: showOnlyHost('/v', SHOW_ONLY.readOnly) })
    expect(say()).toBe(SHOW_ONLY.readOnly)
    expect(button('Skip')).toBeUndefined()
    act(() => button('Back to the course')!.click())
    expect(again.onEnd).toHaveBeenCalledWith('left')
    expect(props.onEnd).not.toHaveBeenCalled()
  })

  it('the last step done: one line, then the course comes back; Skip on the last step leaves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const props = await mount({ chapter: { ...CHAPTER, id: 'where-things-are' } })
      act(() => button('Skip')!.click())
      act(() => button('Skip')!.click())
      act(() => tourEvent('card-file-created', `${FOLDER}/B.md`))
      frames(1)
      expect(say()).toBe('Done. You did it in the real app.')
      expect(props.onEnd).not.toHaveBeenCalled()
      act(() => void vi.advanceTimersByTime(FINISH_MS))
      expect(props.onEnd).toHaveBeenCalledWith('finished')
      act(() => root.render(<></>))
      const skipped = await mount({ chapter: { ...CHAPTER, id: 'where-things-are' } })
      act(() => button('Skip')!.click())
      act(() => button('Skip')!.click())
      act(() => button('Skip')!.click())
      expect(skipped.onEnd).toHaveBeenCalledWith('left')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the course layer closed under the tour: the tour ends', async () => {
    let alive = true
    const props = await mount({ alive: () => alive })
    alive = false
    frames(1)
    expect(props.onEnd).toHaveBeenCalledWith('left')
  })

  it('the dim leaves an open menu lit', async () => {
    await mount()
    const menu = document.createElement('div')
    menu.className = 'ctx-menu'
    place(menu, { left: 400, top: 200, width: 180, height: 120 })
    document.body.appendChild(menu)
    frames(1)
    expect(document.querySelector('.course-tour__dim path')!.getAttribute('d')).toContain('M408 200')
  })
})
