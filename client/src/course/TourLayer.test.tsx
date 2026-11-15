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
import { CreateInline } from '../sidebar/CreateInline'
import { COURSE } from './script'
import { setTourTyper, tourCardsFirst } from './tourBus'
import { litBox, setCourseArea } from './dockArea'
import { tourStepsOf } from './live'

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
/** The dim's holes, as `x y width height` (the mask's black rects). */
const holes = () => [...document.querySelectorAll('.course-tour__dim .course-tour__hole')].map((r) => ['x', 'y', 'width', 'height'].map((a) => r.getAttribute(a)).join(' '))
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
    expect(holes()).toContain('6 296 208 36')
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
    expect(holes()).toContain('400 200 180 120')
  })

  it('YAZ-5403: a menu over the lit control stays lit where they overlap: the holes are a union cut by a mask', async () => {
    // The `/` menu opens inside the lit card editor; "New card" lights up inside the open folder menu.
    control('div', 'sidebar-course-cards', { left: 10, top: 100, width: 400, height: 300 })
    await mount()
    const slash = document.createElement('div')
    slash.className = 'milkdown-slash-menu'
    slash.dataset.show = 'true'
    place(slash, { left: 40, top: 140, width: 220, height: 180 })
    app.appendChild(slash)
    frames(1)
    expect(holes()).toEqual(['6 96 408 308', '40 140 220 180'])
    // The dim is one rect under a mask (no even-odd path, which filled the overlap again).
    const dim = document.querySelector('.course-tour__dim')!
    expect(dim.querySelector('path')).toBeNull()
    const fill = dim.querySelector('.course-tour__dim-fill')!
    const mask = dim.querySelector('mask')!
    expect(fill.getAttribute('mask')).toBe(`url(#${mask.id})`)
    expect(mask.querySelector('rect')!.getAttribute('fill')).toBe('white')
    expect([...mask.querySelectorAll('.course-tour__hole')].every((r) => r.getAttribute('fill') === 'black')).toBe(true)
  })

  it('YAZ-5403: every kind of open popup is left lit: the selection toolbar, the [[ picker, a popover, a tooltip, any menu on the body', async () => {
    Object.assign(window, { innerWidth: 1024, innerHeight: 768 })
    await mount()
    const add = (className: string, box: { left: number; top: number; width: number; height: number }, attrs: Record<string, string> = {}, parent: Element = app): HTMLElement => {
      const el = document.createElement('div')
      el.className = className
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
      place(el, box)
      parent.appendChild(el)
      return el
    }
    add('milkdown-toolbar', { left: 100, top: 10, width: 240, height: 34 }, { 'data-show': 'true' })
    add('wikilink-picker', { left: 100, top: 60, width: 200, height: 160 }, { role: 'listbox' })
    add('view-popover', { left: 400, top: 60, width: 200, height: 100 }, { role: 'dialog' })
    add('hover-tip', { left: 650, top: 60, width: 90, height: 24 }, { role: 'tooltip' }, document.body)
    // A menu with none of the known names, portaled to the body (the card's ⋯ menu, a picker): lit too.
    add('some-new-menu', { left: 700, top: 300, width: 160, height: 90 }, { style: 'position: fixed' }, document.body)
    // Hidden ones are not: a toolbar that is not shown, and a scrim the size of the window stays dimmed.
    add('milkdown-slash-menu', { left: 10, top: 600, width: 100, height: 100 }, { 'data-show': 'false' })
    add('confirm-overlay', { left: 0, top: 0, width: 1024, height: 768 }, { style: 'position: fixed' }, document.body)
    frames(1)
    expect(holes()).toEqual(expect.arrayContaining(['100 10 240 34', '100 60 200 160', '400 60 200 100', '650 60 90 24', '700 300 160 90']))
    expect(holes()).not.toContain('10 600 100 100')
    expect(holes()).not.toContain('0 0 1024 768')
  })
})

describe('"Use an example" on a step that asks for typing (YAZ-5125)', () => {
  // YAZ-5366: the steps that ask for typing are live steps of the clips now.
  const typing = COURSE.flatMap((ch) => ch.clips.flatMap((c) => tourStepsOf(c))).filter((st) => st.example !== undefined)

  it('only the steps that ask for typing have an example; every step keeps Skip', () => {
    expect(typing.map((st) => st.target)).toEqual(['new-card-name', 'card-editor', 'card-editor', 'card-editor'])
    expect(typing.map((st) => st.example!.text)).toEqual(['Protein', 'Your body builds and repairs with protein.', 'An egg is mostly protein and fat.', '[['])
  })

  it('fills the real name box and presses its own Enter: the box makes the card, and the step ends on card-file-created', async () => {
    const made: string[] = []
    const boxRoot = createRoot(app)
    act(() =>
      boxRoot.render(
        <CreateInline
          kind="card"
          indent={0}
          onCancel={() => undefined}
          onSubmit={async (name) => {
            made.push(name)
            tourEvent('card-file-created', `${FOLDER}/${name}.md`)
          }}
        />,
      ),
    )
    const box = app.querySelector<HTMLInputElement>('[data-tour="new-card-name"]')!
    place(box, { left: 10, top: 120, width: 200, height: 24 })
    const step = typing[0]
    await mount({ steps: [step, { target: 'x', say: 'Next one.', done: 'click' }] })
    frames(1)
    expect(button('Skip')).toBeDefined()
    // The name box is the course folder's only once its menu was opened (YAZ-5366: the example writes only there).
    expect(button('Use an example')).toBeUndefined()
    act(() => tourEvent('folder-menu-open', FOLDER))
    frames(1)
    act(() => button('Use an example')!.click())
    await flush()
    expect(made).toEqual(['Protein'])
    expect(say()).toContain('Next one.')
    act(() => boxRoot.unmount())
  })

  it("types into the card editor through the editor's own typer; no button for a step without an example or a field", async () => {
    const editor = control('div', 'card-editor', { left: 10, top: 120, width: 300, height: 120 })
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editor.appendChild(editable)
    const typed: Array<[string, unknown]> = []
    setTourTyper(editable, { type: (text, o) => (typed.push([text, o]), tourEvent('card-side-added')) })
    await mount({ steps: [typing[2], { target: 'card-editor', say: 'No example here.', done: { event: 'card-edit-done' } }] })
    frames(1)
    // A card file outside Course Cards is open: no example (YAZ-5366). One in Course Cards: the example.
    act(() => tourEvent('card-file-open', '/v/Elsewhere/B.md'))
    frames(1)
    expect(button('Use an example')).toBeUndefined()
    act(() => tourEvent('card-file-open', `${FOLDER}/A.md`))
    frames(1)
    act(() => button('Use an example')!.click())
    expect(typed).toEqual([['An egg is mostly protein and fat.', { newSide: true, lineEnd: false }]])
    frames(1)
    expect(say()).toContain('No example here.')
    expect(button('Use an example')).toBeUndefined()
    setTourTyper(editable, null)
  })
})

describe('the `[[` picker lists cards first during a step about card links (YAZ-5407)', () => {
  it('on while the step waits for the picker or the card row; off for other steps and when the layer goes', async () => {
    control('div', 'card-editor', { left: 10, top: 120, width: 300, height: 120 })
    await mount({
      steps: [
        { target: 'card-editor', say: 'Type two square brackets.', done: { event: 'link-picker-open' } },
        { target: 'link-picker', say: 'Click the row with the card icon.', done: { event: 'card-link-added' } },
        { target: 'card-editor', say: 'Done.', done: { event: 'card-edit-done' } },
      ],
    })
    expect(tourCardsFirst()).toBe(true)
    act(() => tourEvent('link-picker-open'))
    frames(1)
    expect(tourCardsFirst()).toBe(true)
    act(() => tourEvent('card-link-added'))
    frames(1)
    expect(tourCardsFirst()).toBe(false)
    act(() => root.unmount())
    root = createRoot(host)
    expect(tourCardsFirst()).toBe(false)
  })

  it('a step about something else leaves the picker as it is (pages first)', async () => {
    control('button', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    await mount()
    expect(tourCardsFirst()).toBe(false)
  })
})

describe('the red arrow on a live step (YAZ-5405)', () => {
  it('points at the lit control from outside it, takes no pointer, and follows the control', async () => {
    Object.assign(window, { innerWidth: 1024, innerHeight: 768 })
    const row = control('button', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    await mount({ variant: 'live', steps: [{ target: 'sidebar-course-cards', say: '', done: 'show' }], reached: () => 1 })
    frames(1)
    const arrow = () => document.querySelector<HTMLElement>('.course-tour__arrow')
    expect(arrow()).not.toBeNull()
    expect(arrow()!.getAttribute('aria-hidden')).toBe('true')
    expect(arrow()!.dataset.side).toBe('right')
    // Outside the ring's box (6 96 208 36), on the line through its middle.
    expect(Number.parseFloat(arrow()!.style.left)).toBeGreaterThan(6 + 208)
    expect(Number.parseFloat(arrow()!.style.top) + Number.parseFloat(arrow()!.style.height) / 2).toBe(114)
    // The control moves: the arrow goes with it.
    place(row, { left: 10, top: 400, width: 200, height: 28 })
    frames(1)
    expect(Number.parseFloat(arrow()!.style.top) + Number.parseFloat(arrow()!.style.height) / 2).toBe(414)
    // Reduced motion is the layer's: the CSS turns the nudge off under it.
    expect(document.querySelector('.course-tour--live')!.contains(arrow())).toBe(true)
  })

  it('draws nothing while the course fills the window', async () => {
    control('button', 'sidebar-course-cards', { left: 10, top: 100, width: 200, height: 28 })
    await mount({ variant: 'live', steps: [{ target: 'sidebar-course-cards', say: '', done: 'show' }], reached: () => 1, visible: false })
    frames(1)
    expect(document.querySelector('.course-tour__arrow')).toBeNull()
    expect(document.querySelector('.course-tour__ring')).toBeNull()
  })

  it('the arrow, its colour and its nudge: red in both themes, no pointer, no motion under reduced motion', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${__dirname}/tour.css`, 'utf8')
    expect(css).toMatch(/\.course-tour__arrow \{[^}]*pointer-events: none/)
    expect(css).toMatch(/--course-tour-arrow: #e0201b/)
    expect(css).toMatch(/:root\[data-theme='dark'\] \.course-tour \{\s*--course-tour-arrow: #ff4a42/)
    expect(css).toMatch(/\.course-tour\[data-reduced-motion='true'\] \.course-tour__arrow \{\s*transition: none;\s*animation: none;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.course-tour__arrow \{\s*transition: none;\s*animation: none;/)
    // A live step's ring is red too (the "light only" steps have no dim, so the ring must stand out).
    expect(css).toMatch(/\.course-tour--live \.course-tour__ring \{\s*box-shadow: 0 0 0 2px var\(--course-tour-arrow\)/)
  })
})

describe('the tour layer with a docked course (YAZ-5365)', () => {
  it('leaves the course out of the dim, keeps the coach card off it, and tells the course where the light is', async () => {
    Object.assign(window, { innerWidth: 1024, innerHeight: 768 })
    const side = { left: 676, top: 0, width: 348, height: 768 }
    setCourseArea(side)
    try {
      control('button', 'sidebar-course-cards', { left: 500, top: 300, width: 150, height: 28 })
      await mount()
      // The coach would sit right under the control, across the panel; it goes to the free side instead.
      const left = Number.parseFloat(coach().style.left)
      expect(left + 300).toBeLessThanOrEqual(side.left)
      // The course is a hole in the dim (its top-left corner, rounded), so it stays bright and usable.
      expect(holes()).toContain('676 0 348 768')
      expect(litBox()).toEqual({ left: 496, top: 296, width: 158, height: 36 })
    } finally {
      setCourseArea(null)
    }
    act(() => root.unmount())
    root = createRoot(host)
    expect(litBox()).toBeNull()
  })
})
