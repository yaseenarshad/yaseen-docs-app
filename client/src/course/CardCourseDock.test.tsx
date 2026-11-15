import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { cleanCourseState, defaultCourseState, type CourseState } from '@shared/courseState'
import { storage } from '../lib/storage'
import type { CourseChapter } from './script'
import { CardCourse, type CardCourseProps } from './CardCourse'
import type { CourseTour } from './courseTour'
import { placeholderScenes } from './scenes/testing'
import type { SceneFor, SceneProps } from './scene'
import { cornerBox, sideWidth, type CourseDockApi } from './dock'
import { courseArea, setLitBox } from './dockArea'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const COURSE: CourseChapter[] = [
  { id: 'a', title: 'First', clips: [{ id: 'a1', text: 'One two three.' }, { id: 'a2', text: 'Four five six.' }] },
  { id: 'b', title: 'Second', clips: [{ id: 'b1', text: 'Seven eight.' }], tryIt: [{ target: 'x', say: 'Click x.', done: 'click' }] },
]
const VIEW = { width: 1024, height: 768 }

let root: Root
let host: HTMLDivElement
let appRoot: HTMLDivElement
let saved: CourseState
let queue: FrameRequestCallback[] = []

beforeEach(() => {
  saved = defaultCourseState()
  vi.spyOn(storage, 'getCourse').mockImplementation(() => saved)
  // As the store does: each patch through the sanitizer.
  vi.spyOn(storage, 'setCourse').mockImplementation((patch) => {
    saved = cleanCourseState(patch, saved)
  })
  queue = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
    queue.push(fn)
    return queue.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  Object.assign(window, { innerWidth: VIEW.width, innerHeight: VIEW.height })
  // The app's own root, as in the window: the course renders inside it.
  appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
  host = document.createElement('div')
  appRoot.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.textContent = ''
  setLitBox(null)
  vi.restoreAllMocks()
})

function mount(props: Partial<CardCourseProps> = {}): CardCourseProps {
  const all: CardCourseProps = { vault: '/demo', onClose: vi.fn(), course: COURSE, scenes: placeholderScenes, ...props }
  act(() => root.render(<CardCourse {...all} />))
  return all
}
const layer = () => document.querySelector<HTMLElement>('.course')!
const caption = () => document.querySelector('.course__caption')!
const slider = () => document.querySelector<HTMLElement>('.course [role="slider"]')!
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.course button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
const click = (el: Element | undefined) => act(() => (el as HTMLElement).click())
const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => void target.dispatchEvent(e))
  return e
}
/** The app's part of the window: a field and a button, on the left. */
function appControls() {
  const field = document.createElement('input')
  const btn = document.createElement('button')
  btn.textContent = 'App button'
  appRoot.insertBefore(field, host)
  appRoot.insertBefore(btn, host)
  return { field, btn }
}
const boxOfLayer = () => ({ left: parseFloat(layer().style.left), top: parseFloat(layer().style.top), width: parseFloat(layer().style.width), height: parseFloat(layer().style.height) })

describe('the dockable player (YAZ-5365)', () => {
  it('the three sizes render and switch: full is a modal dialog; side and corner are regions of the window', () => {
    mount()
    expect(layer().dataset.size).toBe('full')
    expect(layer().getAttribute('role')).toBe('dialog')
    expect(layer().getAttribute('aria-modal')).toBe('true')
    expect(document.querySelector('.course__chapters')).not.toBeNull()
    expect(button('Full size')!.getAttribute('aria-pressed')).toBe('true')

    // A real click moves the keyboard to the button it presses (jsdom's `click()` does not).
    act(() => button('Side panel')!.focus())
    click(button('Side panel'))
    expect(layer().dataset.size).toBe('side')
    expect(layer().getAttribute('role')).toBe('region')
    expect(layer().hasAttribute('aria-modal')).toBe(false)
    expect(document.querySelector('.course__chapters')).toBeNull()
    const w = sideWidth(saved.dockSide, VIEW)
    expect(boxOfLayer()).toEqual({ left: VIEW.width - w, top: 0, width: w, height: VIEW.height })
    expect(document.querySelector('[role="separator"]')!.getAttribute('aria-label')).toBe('Resize the course')
    // The keyboard stays on the switch.
    expect(document.activeElement).toBe(button('Side panel'))

    click(button('Corner'))
    expect(layer().dataset.size).toBe('corner')
    expect(boxOfLayer()).toEqual(cornerBox('bottom-right', VIEW))
    // The corner keeps the essentials: Play / Pause, Back, Next, the size switch, Close.
    for (const name of ['Play', 'Back one step', 'Next step', 'Full size', 'Side panel', 'Corner', 'Close the course', 'Move the player']) expect(button(name), name).toBeDefined()
    for (const name of ['Next chapter', 'Mute', '1×', 'Try it in the app']) expect(button(name), name).toBeUndefined()

    click(button('Full size'))
    expect(layer().dataset.size).toBe('full')
    expect(layer().style.left + layer().style.width).toBe('')
  })

  it('the size, the corner and the side`s width are remembered across a restart', () => {
    mount()
    click(button('Side panel'))
    expect(saved.dock).toBe('side')
    press(document.querySelector('[role="separator"]')!, 'ArrowLeft')
    expect(saved.dockSide).toBe(0.36)
    click(button('Corner'))
    press(button('Move the player')!, 'ArrowUp')
    expect(saved.dockCorner).toBe('top-right')
    expect(layer().dataset.corner).toBe('top-right')
    act(() => root.unmount())
    // The next start: main reads its file back through the same sanitizer.
    saved = cleanCourseState(JSON.parse(JSON.stringify(saved)))
    root = createRoot(host)
    mount()
    expect(layer().dataset.size).toBe('corner')
    expect(layer().dataset.corner).toBe('top-right')
    expect(boxOfLayer()).toEqual(cornerBox('top-right', VIEW))
    click(button('Side panel'))
    expect(boxOfLayer().width).toBe(sideWidth(0.36, VIEW))
  })

  it('the corner drags to the nearest corner on release', () => {
    saved = { ...saved, dock: 'corner' }
    mount()
    const grip = button('Move the player')!
    const at = (type: string, x: number, y: number) => act(() => void grip.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 })))
    at('pointerdown', 900, 500)
    at('pointermove', 200, 520)
    expect(layer().style.transform).toBe('translate(-700px, 20px)')
    at('pointerup', 200, 520)
    expect(layer().dataset.corner).toBe('bottom-left')
    expect(saved.dockCorner).toBe('bottom-left')
    expect(layer().style.transform).toBe('')
  })

  it('docked, the app under it gets its clicks and its keys; the side moves the app over; Tab goes on into the app', () => {
    const { field, btn } = appControls()
    saved = { ...saved, dock: 'side' }
    mount()
    // The app moves over: its root leaves the panel's width free on the right.
    expect(appRoot.style.marginRight).toBe(`${sideWidth(saved.dockSide, VIEW)}px`)
    // No part of the course covers the app's part of the window.
    const box = boxOfLayer()
    expect(box.left).toBeGreaterThanOrEqual(VIEW.width - box.width)
    expect(200).toBeLessThan(box.left)
    // A pointer and a click on the app reach it, and nothing stops them.
    const got: string[] = []
    for (const type of ['pointerdown', 'mousedown', 'click']) btn.addEventListener(type, (e) => got.push(`${type}${e.defaultPrevented ? '!' : ''}`))
    act(() => {
      btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      btn.click()
    })
    expect(got).toEqual(['pointerdown', 'mousedown', 'click'])
    // Typing and the app's own keys: they reach the app, and the keyboard stays in the app.
    const appKeys = vi.fn()
    window.addEventListener('keydown', appKeys)
    act(() => field.focus())
    for (const k of ['a', ' ', 'ArrowRight', 'k']) expect(press(field, k, k === 'k' ? { metaKey: true } : {}).defaultPrevented).toBe(false)
    expect(appKeys).toHaveBeenCalledTimes(4)
    expect(document.activeElement).toBe(field)
    expect(button('Play')).toBeDefined()
    // Tab from the course's last control is not held in the course.
    const last = [...layer().querySelectorAll<HTMLElement>('button')].at(-1)!
    act(() => last.focus())
    expect(press(last, 'Tab').defaultPrevented).toBe(false)
    window.removeEventListener('keydown', appKeys)
    // Closed: the app has the whole window again.
    act(() => root.render(<></>))
    expect(appRoot.style.marginRight).toBe('')
  })

  it('docked, Esc: from the course it closes; from the app only when nothing nearer wants it', () => {
    const { field, btn } = appControls()
    saved = { ...saved, dock: 'corner' }
    const props = mount()
    act(() => field.focus())
    expect(press(field, 'Escape').defaultPrevented).toBe(false)
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    appRoot.appendChild(menu)
    act(() => btn.focus())
    press(btn, 'Escape')
    expect(props.onClose).not.toHaveBeenCalled()
    menu.remove()
    press(btn, 'Escape')
    expect(props.onClose).toHaveBeenCalledOnce()
    press(button('Play')!, 'Escape')
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('Space and the scrubber`s arrows act only with the keyboard in the course', () => {
    const { btn } = appControls()
    saved = { ...saved, dock: 'side' }
    mount()
    act(() => btn.focus())
    press(btn, ' ')
    expect(button('Play')).toBeDefined()
    press(btn, 'ArrowRight')
    expect(slider().getAttribute('aria-valuenow')).toBe('0')
    act(() => layer().focus())
    press(layer(), ' ')
    expect(button('Pause')).toBeDefined()
    press(layer(), ' ')
    act(() => slider().focus())
    press(slider(), 'End')
    expect(Number(slider().getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  })

  it('the scrubber and the caption in each size: the caption on screen and live; the slider named and working', () => {
    mount()
    for (const size of ['Full size', 'Side panel', 'Corner'] as const) {
      click(button(size))
      expect(caption().textContent, size).toBe('One two three.')
      expect(caption().getAttribute('aria-live')).toBe('polite')
      expect(slider().getAttribute('aria-label')).toBe('Chapter progress')
      act(() => slider().focus())
      press(slider(), 'Home')
      expect(slider().getAttribute('aria-valuenow')).toBe('0')
      press(slider(), 'End')
      expect(Number(slider().getAttribute('aria-valuenow')), size).toBeGreaterThan(0)
      press(slider(), 'Home')
    }
  })

  it('reduced motion: a size or corner change never glides', () => {
    mount()
    click(button('Side panel'))
    expect(layer().dataset.animate).toBe('true')
    act(() => root.unmount())
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList)
    root = createRoot(host)
    mount()
    expect(layer().dataset.reducedMotion).toBe('true')
    expect(layer().dataset.animate).toBeUndefined()
    click(button('Full size'))
    click(button('Corner'))
    expect(layer().dataset.animate).toBeUndefined()
  })

  it('the tour with a docked course: the course stays and tells the tour its box; full hides as before; the corner moves off a lit control', async () => {
    let finish: (() => void) | null = null
    const tour: CourseTour = { start: () => new Promise((resolve) => (finish = () => resolve('left'))) }
    saved = { ...saved, chapter: 'b', clip: 'b1', dock: 'side' }
    mount({ tour })
    expect(courseArea()).toEqual(boxOfLayer())
    click(button('Try it in the app'))
    expect(layer().hidden).toBe(false)
    expect(courseArea()).toEqual(boxOfLayer())
    await act(async () => finish!())
    click(button('Full size'))
    expect(courseArea()).toBeNull()
    click(button('Try it in the app'))
    expect(layer().hidden).toBe(true)
    await act(async () => finish!())
    expect(layer().hidden).toBe(false)
    // The corner: a lit control under it sends it to the nearest free corner, and back when the light goes.
    click(button('Corner'))
    const br = cornerBox('bottom-right', VIEW)
    act(() => setLitBox({ left: br.left + 20, top: br.top + 40, width: 80, height: 24 }))
    expect(layer().dataset.corner).toBe('bottom-left')
    expect(courseArea()).toEqual(cornerBox('bottom-left', VIEW))
    expect(saved.dockCorner).toBe('bottom-right')
    act(() => setLitBox(null))
    expect(layer().dataset.corner).toBe('bottom-right')
  })

  it('requestSize: a clip that names a size starts a part; the person`s choice wins until the next part; only the person`s choice is kept', () => {
    const parts: CourseChapter[] = [
      { id: 'p', title: 'Parts', clips: [{ id: 'p1', text: 'A lesson.', dock: 'side' }, { id: 'p2', text: 'Still the lesson.' }, { id: 'p3', text: 'Now you.', dock: 'corner' }] },
    ]
    let dock: CourseDockApi | undefined
    const Spy = (props: SceneProps) => {
      dock = props.dock
      return <p>{props.clip.id}</p>
    }
    const scenes: SceneFor = () => Spy
    mount({ course: parts, scenes })
    expect(layer().dataset.size).toBe('side')
    expect(dock!.size).toBe('side')
    let answer = ''
    act(() => void (answer = dock!.requestSize('corner', 'a test')))
    expect(answer).toBe('done')
    expect(layer().dataset.size).toBe('corner')
    expect(document.querySelector('.course__vh[aria-live]')!.textContent).toBe('The course moved to the corner.')
    click(button('Full size'))
    act(() => void (answer = dock!.requestSize('side', 'a test')))
    expect(answer).toBe('kept')
    expect(layer().dataset.size).toBe('full')
    click(button('Next step'))
    expect(caption().textContent).toBe('Still the lesson.')
    expect(layer().dataset.size).toBe('full')
    click(button('Next step'))
    expect(caption().textContent).toBe('Now you.')
    expect(layer().dataset.size).toBe('corner')
    expect(saved.dock).toBe('full')
  })
})
