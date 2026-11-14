import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultCourseState, type CourseState } from '@shared/courseState'
import { storage } from '../lib/storage'
import type { CourseChapter } from './script'
import { CardCourse, VOICE_LOADING_LINE, type CardCourseProps } from './CardCourse'
import type { CourseTour } from './courseTour'
import { useEscapeLast } from '../lib/escapeOrder'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { CourseHost, CourseVault } from './courseHost'
import { SHOW_ONLY } from './courseCards'
import { memoryVoice, placeholderScenes } from './scenes/testing'
import type { SceneProps } from './scene'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Made-up chapters. `b` has a tour; clip `c2-07` is one of the script's clips that wait. */
const COURSE: CourseChapter[] = [
  { id: 'a', title: 'First', clips: [{ id: 'a1', text: 'One two three.' }, { id: 'a2', text: 'Four five six.' }] },
  { id: 'b', title: 'Second', clips: [{ id: 'b1', text: 'Seven eight.' }, { id: 'c2-07', text: 'Type the short version.' }], tryIt: [{ target: 'x', say: 'Click x.', done: 'click' }] },
]

let root: Root
let host: HTMLDivElement
let saved: CourseState
let setCourse: ReturnType<typeof vi.fn>
/** The frame queue: `frames(n, ms)` runs n frames, each `ms` after the one before. */
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

beforeEach(() => {
  saved = defaultCourseState()
  setCourse = vi.fn((patch) => {
    saved = { ...saved, ...patch }
  })
  vi.spyOn(storage, 'getCourse').mockImplementation(() => saved)
  vi.spyOn(storage, 'setCourse').mockImplementation(setCourse)
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
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.textContent = ''
  vi.restoreAllMocks()
})

function mount(props: Partial<CardCourseProps> = {}): CardCourseProps {
  // The frame's own tests run on the frame's scenes (YAZ-5121: the course's real scenes are tested in `scenes/`).
  const all: CardCourseProps = { vault: '/demo', onClose: vi.fn(), course: COURSE, scenes: placeholderScenes, ...props }
  act(() => root.render(<CardCourse {...all} />))
  return all
}
const layer = () => document.querySelector<HTMLElement>('.course')!
const caption = () => document.querySelector('.course__caption')!.textContent
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.course button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)
const press = (target: EventTarget, key: string) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => void target.dispatchEvent(e))
  return e
}

describe('the course layer (YAZ-5120)', () => {
  it('opens as a modal dialog with the keyboard on Play, the caption on screen; Esc closes; the keyboard goes back where it was', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const props = mount()
    expect(layer().getAttribute('role')).toBe('dialog')
    expect(layer().getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(button('Play'))
    expect(caption()).toBe('One two three.')
    press(document.activeElement!, 'Escape')
    expect(props.onClose).toHaveBeenCalledOnce()
    act(() => root.render(<></>))
    expect(document.activeElement).toBe(opener)
  })

  it('Space plays and pauses while the course has the keyboard; no key reaches the app under it', () => {
    const page = document.createElement('div')
    page.tabIndex = 0
    document.body.appendChild(page)
    const appKeys = vi.fn()
    window.addEventListener('keydown', appKeys)
    mount()
    act(() => layer().focus())
    const e = press(layer(), ' ')
    expect(e.defaultPrevented).toBe(true)
    expect(button('Pause')).toBeDefined()
    press(layer(), ' ')
    expect(button('Play')).toBeDefined()
    // A key aimed at the page under the course: swallowed, and the keyboard comes back into the course.
    press(page, ' ')
    press(page, 'a')
    expect(button('Play')).toBeDefined()
    expect(appKeys).not.toHaveBeenCalled()
    expect(layer().contains(document.activeElement)).toBe(true)
    // Space in a text field of a scene is the field's.
    const field = document.createElement('input')
    document.querySelector('.course__stage')!.appendChild(field)
    act(() => field.focus())
    expect(press(field, ' ').defaultPrevented).toBe(false)
    window.removeEventListener('keydown', appKeys)
  })

  it('is in the app`s Esc order: one Esc closes the course alone, never the sidebar under it', () => {
    const aside = document.createElement('aside')
    document.body.appendChild(aside)
    const act2 = vi.fn()
    function Last() {
      useEscapeLast(() => ({ aside, searchShown: false, canClose: true }), act2)
      return null
    }
    const props: CardCourseProps = { vault: '/demo', onClose: vi.fn(), course: COURSE, scenes: placeholderScenes }
    act(() => root.render(<><Last /><CardCourse {...props} /></>))
    press(document.activeElement!, 'Escape')
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(act2).not.toHaveBeenCalled()
  })

  it('Tab stays inside the layer', () => {
    mount()
    const focusable = [...layer().querySelectorAll<HTMLElement>('button:not(:disabled)')]
    act(() => focusable.at(-1)!.focus())
    press(document.activeElement!, 'Tab')
    expect(document.activeElement).toBe(focusable[0])
  })

  it('walks the course silent on the estimate: clip by clip, the chapter end screen, then the next chapter; the place is kept', () => {
    mount()
    act(() => button('Play')!.click())
    // "One two three." is 3 words: 1.5 s at least, then the 0.45 s gap.
    frames(21)
    expect(caption()).toBe('Four five six.')
    expect(setCourse).toHaveBeenCalledWith({ chapter: 'a', clip: 'a2' })
    frames(21)
    expect(caption()).toBe('Chapter 1 done. Next: Second.')
    expect(setCourse).toHaveBeenCalledWith({ chapter: 'b', clip: '', finished: ['a'] })
    expect(document.querySelector('.course__chapter[data-finished="true"]')?.textContent).toContain('First')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.course__end-actions button')].find((b) => b.textContent === 'Next chapter')!.click())
    expect(caption()).toBe('Seven eight.')
    expect(button('Pause')).toBeDefined()
  })

  it('a clip that waits holds until its scene says done ("Done, go on" in the frame)', () => {
    mount()
    act(() => document.querySelectorAll<HTMLButtonElement>('.course__chapter')[1].click())
    act(() => button('Next step')!.click())
    expect(caption()).toBe('Type the short version.')
    act(() => button('Play')!.click())
    frames(60)
    expect(caption()).toBe('Type the short version.')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.course-scene button')].find((b) => b.textContent === 'Done, go on')!.click())
    frames(6)
    expect(caption()).toBe("That's the whole course.")
    expect(setCourse).toHaveBeenCalledWith(expect.objectContaining({ done: true }))
  })

  it('Mute and Speed are kept; the chapter list goes to a chapter', () => {
    mount()
    act(() => button('Mute')!.click())
    expect(setCourse).toHaveBeenCalledWith({ muted: true })
    act(() => button('1.5×')!.click())
    expect(setCourse).toHaveBeenCalledWith({ speed: 1.5 })
    expect(button('1.5×')!.getAttribute('aria-pressed')).toBe('true')
    act(() => document.querySelectorAll<HTMLButtonElement>('.course__chapter')[1].click())
    expect(setCourse).toHaveBeenCalledWith({ chapter: 'b', clip: 'b1' })
    expect(document.querySelectorAll('.course__chapter')[1].getAttribute('aria-current')).toBe('step')
  })

  it('opens at the saved place, or at the chapter another part asked for', () => {
    saved = { ...defaultCourseState(), chapter: 'b', clip: 'c2-07', finished: ['a'] }
    mount()
    expect(caption()).toBe('Type the short version.')
    expect(document.querySelectorAll('.course__chapter')[0].getAttribute('data-finished')).toBe('true')
    act(() => root.render(<></>))
    mount({ chapter: 'a' })
    expect(caption()).toBe('One two three.')
  })

  it('"Try it in the app" shows only on a chapter with tryIt; the course hides while the tour runs and comes back at the same place', async () => {
    let finish: (r: 'finished') => void = () => undefined
    const tour: CourseTour = { start: vi.fn(() => new Promise<'finished'>((r) => (finish = r))) }
    mount({ tour })
    expect(button('Try it in the app')).toBeUndefined()
    act(() => document.querySelectorAll<HTMLButtonElement>('.course__chapter')[1].click())
    act(() => button('Try it in the app')!.click())
    expect(tour.start).toHaveBeenCalledWith(COURSE[1], COURSE[1].tryIt)
    expect(layer().hidden).toBe(true)
    await act(async () => finish('finished'))
    expect(layer().hidden).toBe(false)
    expect(caption()).toBe('Seven eight.')
  })

  it('the default tour is the real one over the app (YAZ-5123): Esc goes back to the course at the same place', async () => {
    mount()
    act(() => document.querySelectorAll<HTMLButtonElement>('.course__chapter')[1].click())
    act(() => button('Next step')!.click())
    expect(caption()).toBe('Type the short version.')
    act(() => button('Try it in the app')!.click())
    expect(layer().hidden).toBe(true)
    await act(async () => undefined)
    const coach = document.querySelector('.course-tour__coach')!
    expect(coach.getAttribute('aria-label')).toBe('Try it in the app')
    // Chapter `b` needs no folder: its one step shows at once.
    expect(coach.querySelector('.course-tour__say')!.textContent).toBe('Click x.Step 1 of 1')
    const esc = press(document.body, 'Escape')
    expect(esc.defaultPrevented).toBe(true)
    await act(async () => undefined)
    expect(document.querySelector('.course-tour')).toBeNull()
    expect(layer().hidden).toBe(false)
    expect(caption()).toBe('Type the short version.')
    expect(saved.toured).toEqual([])
  })

  it('a finished tour marks its chapter as toured; the course comes back at the same place', async () => {
    mount()
    act(() => document.querySelectorAll<HTMLButtonElement>('.course__chapter')[1].click())
    act(() => button('Try it in the app')!.click())
    await act(async () => undefined)
    const x = document.createElement('button')
    x.dataset.tour = 'x'
    x.getBoundingClientRect = () => ({ left: 10, top: 10, width: 50, height: 20, right: 60, bottom: 30, x: 10, y: 10, toJSON: () => null })
    document.body.appendChild(x)
    act(() => x.click())
    frames(1)
    expect(document.querySelector('.course-tour__say')!.textContent).toBe('Done. You did it in the real app.')
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.course-tour__coach button')].find((b) => b.textContent === 'Back to the course')!.click())
    await act(async () => undefined)
    expect(saved.toured).toEqual(['b'])
    expect(layer().hidden).toBe(false)
    expect(caption()).toBe('Seven eight.')
  })

  it('the voice: the chapter start is told; a sound that arrives mid-clip is used from the next clip; its seconds time the clip', async () => {
    const v = memoryVoice()
    mount({ voice: v.voice })
    expect(v.started).toEqual(['a'])
    act(() => button('Play')!.click())
    // The first clip waits for the chapter's sound for at most VOICE_WAIT_LIMIT; then it plays silent.
    frames(24)
    await act(async () => v.arrive('a', { a1: { url: 'blob:a1', seconds: 9 }, a2: { url: 'blob:a2', seconds: 1 } }))
    // a1 started silent: it keeps its estimate (about 2 s) and no sound.
    frames(19)
    expect(caption()).toBe('Four five six.')
    const audio = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.at(-1) as HTMLAudioElement
    expect(audio.src).toBe('blob:a2')
    // The sound's clock times the clip: the sound says it is at its end, then the gap runs on the page clock.
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })
    Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => 1, set: () => undefined })
    frames(2)
    expect(document.querySelector<HTMLElement>('.course__bar span')!.style.transform).not.toBe('')
    frames(6)
    expect(caption()).toBe('Chapter 1 done. Next: Second.')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.course__end-actions button')].find((b) => b.textContent === 'Next chapter')!.click())
    expect(v.started).toEqual(['a', 'b'])
  })
  it('keeps one scene mounted across the clips of a span, with each clip as its prop (YAZ-5121)', () => {
    let mounts = 0
    function Spanning({ clip }: SceneProps) {
      useEffect(() => {
        mounts += 1
      }, [])
      return <p className="span-clip">{clip.id}</p>
    }
    const scenes = Object.assign(() => Spanning, { spanOf: (id: string) => (id === 'a1' || id === 'a2' ? 'a1-a2' : undefined) })
    mount({ scenes })
    expect(document.querySelector('.span-clip')?.textContent).toBe('a1')
    act(() => button('Next step')!.click())
    expect(document.querySelector('.span-clip')?.textContent).toBe('a2')
    expect(mounts).toBe(1)
  })

  it('the voice could not come (YAZ-5159): one quiet line with "Try again"; it goes when the sound arrives', async () => {
    const v = memoryVoice()
    mount({ voice: v.voice })
    const line = () => [...document.querySelectorAll('.course__note')].find((p) => p.textContent?.includes('The sound is not here'))
    expect(line()).toBeUndefined()
    act(() => v.fail('b'))
    expect(line()).toBeUndefined()
    act(() => v.fail('a'))
    expect(line()?.getAttribute('role')).toBe('status')
    expect(document.querySelector('[role="alertdialog"], [role="alert"]')).toBeNull()
    act(() => button('Try again')!.click())
    expect(v.retried).toEqual(['a'])
    expect(line()).toBeUndefined()
    act(() => v.fail('a'))
    await act(async () => v.arrive('a', { a1: { url: 'blob:a1', seconds: 2 } }))
    expect(line()).toBeUndefined()
  })
})

describe('the timeline can be scrubbed (YAZ-5120)', () => {
  const slider = () => document.querySelector<HTMLElement>('[role="slider"]')!
  const pointer = (type: string, x: number) => {
    const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
    act(() => void slider().dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: x, button: 0 })))
  }
  const setBox = () => {
    document.querySelector<HTMLElement>('.course__bar')!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 3, right: 100, bottom: 3, x: 0, y: 0, toJSON: () => ({}) })
  }

  it('is a named, focusable slider with a tick where each clip after the first starts, and says the time', () => {
    mount()
    expect(slider().getAttribute('aria-label')).toBe('Chapter progress')
    expect(slider().tabIndex).toBe(0)
    expect(document.querySelectorAll('.course__scrub-tick')).toHaveLength(1)
    expect(slider().getAttribute('aria-valuetext')).toMatch(/^0:00 of \d:\d\d$/)
  })

  it('a drag: the stage and the caption follow, a tip shows the clip\'s caption and the time; on release it plays again', () => {
    mount()
    setBox()
    act(() => button('Play')!.click())
    pointer('pointerdown', 90)
    expect(caption()).toBe('Four five six.')
    expect(button('Play')).toBeDefined() // paused while dragging
    expect(document.querySelector('.course__scrub-tip-text')?.textContent).toBe('Four five six.')
    expect(document.querySelector('.course__scrub-tip-time')?.textContent).toMatch(/^\d:\d\d \/ \d:\d\d$/)
    expect(saved.clip).toBe('a2')
    pointer('pointermove', 5)
    expect(caption()).toBe('One two three.')
    pointer('pointerup', 5)
    expect(document.querySelector('.course__scrub-tip')).toBeNull()
    expect(button('Pause')).toBeDefined()
    // The place kept is where the person stopped.
    expect(saved.clip).toBe('a1')
  })

  it('keys: Shift + arrows one clip, Home and End, arrows 5 s; Space still plays; no key reaches the page', () => {
    const appKeys = vi.fn()
    window.addEventListener('keydown', appKeys)
    mount()
    act(() => slider().focus())
    expect(press(slider(), 'ArrowRight').defaultPrevented).toBe(true)
    press(slider(), 'Home')
    expect(caption()).toBe('One two three.')
    const shiftRight = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
    act(() => void slider().dispatchEvent(shiftRight))
    expect(caption()).toBe('Four five six.')
    const shiftLeft = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true })
    act(() => void slider().dispatchEvent(shiftLeft))
    expect(caption()).toBe('One two three.')
    press(slider(), 'End')
    expect(caption()).toBe('Chapter 1 done. Next: Second.')
    expect(saved.finished).toEqual(['a'])
    press(slider(), 'Home')
    expect(caption()).toBe('One two three.')
    press(slider(), ' ')
    expect(button('Pause')).toBeDefined()
    expect(appKeys).not.toHaveBeenCalled()
    window.removeEventListener('keydown', appKeys)
  })
})

describe('the voice starts with the first word (YAZ-5159)', () => {
  const A = { a1: { url: 'blob:a1', seconds: 3 }, a2: { url: 'blob:a2', seconds: 2 } }
  const B = { b1: { url: 'blob:b1', seconds: 2 }, 'c2-07': { url: 'blob:c2-07', seconds: 2 } }
  const playedSrc = () => (vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.at(-1) as HTMLAudioElement | undefined)?.src
  const pages = () => [...document.querySelectorAll('.course__note')].map((p) => p.textContent)
  const flush = () => act(async () => undefined)

  it('a chapter whose sound is here already starts with its sound at t = 0', async () => {
    const v = memoryVoice({ a: A })
    mount({ voice: v.voice })
    await flush()
    act(() => button('Play')!.click())
    frames(1)
    expect(playedSrc()).toBe('blob:a1')
    expect(pages()).toEqual([])
  })

  it('a sound that arrives after 300 ms: the first clip holds at its first frame, then starts with the sound from 0', async () => {
    const v = memoryVoice()
    mount({ voice: v.voice })
    await flush()
    act(() => button('Play')!.click())
    frames(3)
    expect(playedSrc()).toBeUndefined()
    expect(pages()).toEqual([]) // no line before 0.5 s
    await act(async () => v.arrive('a', A))
    expect(playedSrc()).toBe('blob:a1')
    expect(caption()).toBe('One two three.')
  })

  it('a sound that never comes: "Loading the voice…" after 0.5 s; after the limit the clip plays silent and "Try again" shows', async () => {
    const v = memoryVoice()
    mount({ voice: v.voice })
    await flush()
    act(() => button('Play')!.click())
    frames(6)
    expect(pages()).toEqual([VOICE_LOADING_LINE])
    frames(15)
    expect(pages().some((n) => n?.includes(VOICE_LOADING_LINE))).toBe(false)
    expect(button('Try again')).toBeDefined()
    frames(25)
    expect(caption()).toBe('Four five six.')
    expect(playedSrc()).toBeUndefined()
  })

  it('Mute: no wait at all', async () => {
    const v = memoryVoice()
    mount({ voice: v.voice })
    await flush()
    act(() => button('Mute')!.click())
    act(() => button('Play')!.click())
    frames(25)
    expect(caption()).toBe('Four five six.')
    expect(pages()).toEqual([])
  })

  it("the next chapter's sound is asked for once this chapter's is here; the next chapter then starts with its sound", async () => {
    const v = memoryVoice({ a: A, b: B })
    const asked = vi.spyOn(v.voice, 'chapter')
    mount({ voice: v.voice })
    await flush()
    await flush()
    expect(asked.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
    expect(v.started).toEqual(['a'])
    act(() => button('Next chapter')!.click())
    act(() => button('Play')!.click())
    frames(1)
    expect(caption()).toBe('Seven eight.')
    expect(playedSrc()).toBe('blob:b1')
  })

  it("the next clip's file is preloaded while this clip plays", async () => {
    const made: HTMLAudioElement[] = []
    const RealAudio = window.Audio
    vi.spyOn(window, 'Audio').mockImplementation(function (this: unknown) {
      const el = new RealAudio()
      made.push(el)
      return el
    } as unknown as () => HTMLAudioElement)
    const v = memoryVoice({ a: A })
    mount({ voice: v.voice })
    await flush()
    act(() => button('Play')!.click())
    frames(1)
    expect(made.map((el) => el.getAttribute('src'))).toEqual(['blob:a1', 'blob:a2'])
    expect(made[1].preload).toBe('auto')
  })
})

describe('VoicedCardCourse (YAZ-5159)', () => {
  it('tells main the course is open while it is mounted, and starts the chapter there', async () => {
    const { VoicedCardCourse } = await import('./CardCourse')
    const bridge = (window as unknown as { yaseenDocs?: unknown }).yaseenDocs
    const calls: string[] = []
    ;(window as unknown as { yaseenDocs: unknown }).yaseenDocs = {
      courseAudio: {
        open: async (open: boolean) => void calls.push(`open:${open}`),
        chapterStarting: async (chapter: string) => void calls.push(`start:${chapter}`),
        chapter: async () => null,
        onChange: () => () => undefined,
      },
    }
    try {
      act(() => root.render(<VoicedCardCourse vault="/demo" onClose={vi.fn()} course={COURSE} scenes={placeholderScenes} />))
      await act(async () => undefined)
      expect(calls).toEqual(['start:a', 'open:true'])
      act(() => root.render(<></>))
      await act(async () => undefined)
      expect(calls.at(-1)).toBe('open:false')
    } finally {
      ;(window as unknown as { yaseenDocs: unknown }).yaseenDocs = bridge
    }
  })
})

describe('the course host (YAZ-5124)', () => {
  it('with a vault view and no host, each scene gets the real host of that vault; without one, the host that only shows', () => {
    const seen: CourseHost[] = []
    const Scene = ({ host }: SceneProps) => (seen.push(host), null)
    const courseVault: CourseVault = {
      root: '/demo',
      index: { records: [], folders: [], ids: true, subscribe: () => () => undefined },
      ready: () => true,
      readOnly: () => true,
      review: () => ({ ready: true, on: true, settings: DEFAULT_REVIEW_SETTINGS }),
      cardSkill: null,
    }
    mount({ courseVault, scenes: () => Scene })
    expect(seen.at(-1)?.vault).toBe('/demo')
    expect(seen.at(-1)?.summary()).toEqual({ folder: null, cards: [] })
    return seen.at(-1)!.courseCards().then((at) => expect(at).toEqual({ showOnly: SHOW_ONLY.readOnly }))
  })

  it('YAZ-5201: the host is bound to the vault the course opened with; a new vault view (another tab in front) changes nothing', () => {
    const seen: CourseHost[] = []
    const Scene = ({ host }: SceneProps) => (seen.push(host), null)
    const view = (root: string): CourseVault => ({
      root,
      index: { records: [], folders: [], ids: true, subscribe: () => () => undefined },
      ready: () => true,
      readOnly: () => false,
      review: () => ({ ready: true, on: true, settings: DEFAULT_REVIEW_SETTINGS }),
      cardSkill: null,
    })
    const props = mount({ vault: '/a', courseVault: view('/a'), scenes: () => Scene })
    const first = seen.at(-1)
    expect(first?.vault).toBe('/a')
    act(() => root.render(<CardCourse {...props} vault="/b" courseVault={view('/b')} />))
    expect(seen.at(-1)?.vault).toBe('/a')
    expect(seen.at(-1)).toBe(first)
  })

  it('opened before its vault view: "still loading", then the real host of that vault once the view comes', async () => {
    const seen: CourseHost[] = []
    const Scene = ({ host }: SceneProps) => (seen.push(host), null)
    let ready = false
    const view = (root: string): CourseVault => ({
      root,
      index: { records: [], folders: [], ids: true, subscribe: () => () => undefined },
      ready: () => ready,
      readOnly: () => true,
      review: () => ({ ready, on: true, settings: DEFAULT_REVIEW_SETTINGS }),
      cardSkill: null,
    })
    const props = mount({ vault: '/a', scenes: () => Scene })
    expect(await seen.at(-1)!.courseCards()).toEqual({ showOnly: SHOW_ONLY.loading })
    // A view of another vault is not the course's.
    act(() => root.render(<CardCourse {...props} courseVault={view('/b')} />))
    expect(await seen.at(-1)!.courseCards()).toEqual({ showOnly: SHOW_ONLY.loading })
    // The view of its vault comes: the same run now has the real host. It says "loading" until the index is read.
    act(() => root.render(<CardCourse {...props} courseVault={view('/a')} />))
    const real = seen.at(-1)!
    expect(real.vault).toBe('/a')
    expect(await real.courseCards()).toEqual({ showOnly: SHOW_ONLY.loading })
    // Once the index is read, the host answers for the vault itself: this one is read only, a true refusal.
    ready = true
    expect(await real.courseCards()).toEqual({ showOnly: SHOW_ONLY.readOnly })
    act(() => root.render(<CardCourse {...props} courseVault={view('/a')} />))
    expect(seen.at(-1)).toBe(real)
  })

  it('YAZ-5201: a bound vault that is not in the window: one line, nothing is made, and "Start over" in the vault in front', async () => {
    const seen: CourseHost[] = []
    const Scene = ({ host }: SceneProps) => (seen.push(host), null)
    const startOver = vi.fn()
    mount({ vault: null, lost: { line: 'a is not open in this window, so the course makes no files.', startOver: { label: 'Start over in b', run: startOver } }, scenes: () => Scene })
    expect([...document.querySelectorAll('.course__note')].map((n) => n.textContent)).toEqual(['a is not open in this window, so the course makes no files. Start over in b'])
    expect(await seen.at(-1)!.courseCards()).toEqual({ showOnly: 'a is not open in this window, so the course makes no files.' })
    act(() => button('Start over in b')!.click())
    expect(startOver).toHaveBeenCalledTimes(1)
  })
})
