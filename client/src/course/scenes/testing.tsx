/**
 * Test helpers for the course (YAZ-5121): a clock the test drives, the host and voice doubles, a placeholder scene, and
 * a mount. Only tests and the dev preview (`tools/course-preview`) import this file.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SceneClock, SceneTime, Scene, SceneFor, SceneProps } from '../scene'
import type { CourseChapter, CourseClip } from '../script'
import { blankStep, courseCardKey, givenAfter, type AgentStepState, type CourseCard, type CourseHost, type MadeCard } from '../courseHost'
import type { ChapterSound, ClipSound, Voice } from '../courseVoice'

export function testClock(length = 6) {
  let time: SceneTime = { t: 0, length, fraction: 0, playing: false }
  const frames = new Set<() => void>()
  const clock: SceneClock = {
    now: () => time,
    subscribe: (fn) => {
      frames.add(fn)
      return () => frames.delete(fn)
    },
    onMark: () => () => undefined,
  }
  return {
    clock,
    at(fraction: number, playing = false) {
      time = { t: fraction * time.length, length: time.length, fraction, playing }
      act(() => frames.forEach((fn) => fn()))
    },
  }
}

/**
 * The test double (for the scene builders' tests): a host whose files live in memory. `arrive` plays an agent writing
 * a card into the folder; `step` is an AI step the test drives by hand (`set`). It has every member of `CourseHost`.
 */
export interface MemoryHost extends CourseHost {
  folder: string
  /** The cards the host "made" (first cards). */
  made: MadeCard[]
  /** The cards in the folder now, as `watchCards` gives them. */
  cards: CourseCard[]
  arrive(card: CourseCard, text?: string): void
  /** Sets the AI step's state directly, and wakes its listeners. */
  set(patch: Partial<AgentStepState>): void
}

export function memoryHost(vault = '/demo'): MemoryHost {
  const folder = `${vault}/course-cards`
  const texts = new Map<string, string>()
  const watchers = new Set<(cards: readonly CourseCard[]) => void>()
  let state = blankStep(null)
  const listeners = new Set<() => void>()
  const set = (patch: Partial<AgentStepState>): void => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  const host: MemoryHost = {
    vault,
    folder,
    made: [],
    cards: [],
    courseCards: () => Promise.resolve({ path: folder }),
    watchCards: (_at, onCards) => {
      watchers.add(onCards)
      onCards(host.cards)
      return () => void watchers.delete(onCards)
    },
    makeFirstCard: (input) => {
      const front = typeof input.hidden === 'string' ? input.front.replace(input.hidden, `{{${input.hidden}}}`) : `${input.front.slice(0, input.hidden.start)}{{${input.front.slice(input.hidden.start, input.hidden.end)}}}${input.front.slice(input.hidden.end)}`
      const made: MadeCard = { path: `${folder}/card-${host.made.length + 1}.md`, title: input.front.slice(0, 60), text: input.back === '' ? front : `${front}\n---\n${input.back}`, titleHidden: false }
      host.made.push(made)
      return Promise.resolve(made)
    },
    coursePage: () => Promise.resolve({ path: `${folder}/course-page.md` }),
    readCard: (card) => {
      const text = texts.get(courseCardKey(card))
      const known = host.cards.find((c) => courseCardKey(c) === courseCardKey(card))
      return Promise.resolve(text === undefined || known === undefined ? null : { title: known.title, sides: text.split('\n---\n') })
    },
    agentStep: {
      state: () => state,
      subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
      // As the real step: a new text needs a new prompt.
      setText: (text, how = 'typed') => set({ text, example: false, given: givenAfter(state.given, text, how), prompt: null, problem: null }),
      useExample: () => set({ text: 'Example text', example: true, given: true, prompt: null, problem: null }),
      preparePrompt: () => (set({ prompt: { text: `Prompt\n\n${state.text}`, folder } }), Promise.resolve()),
      copy: () => (set({ copiedAt: Date.now() }), Promise.resolve()),
      markRead: (card) => set({ read: [...new Set([...state.read, courseCardKey(card)])] }),
      showExamples: () => set({ examples: 'shown' }),
      makeExamples: () => (set({ examples: [] }), Promise.resolve()),
      stop: () => undefined,
    },
    summary: () => ({ folder, cards: host.cards.map((c) => ({ path: c.path, title: c.title, due: null })) }),
    arrive(card, text = 'A {{card}}\n---\nIts back') {
      host.cards = [...host.cards, card]
      texts.set(courseCardKey(card), text)
      watchers.forEach((w) => w(host.cards))
      if (state.copiedAt !== null) set({ cards: [...state.cards, card], quiet: false })
    },
    set,
  }
  return host
}

/**
 * The test double: a voice whose chapters are in memory. `arrive(chapterId, clips)` puts a chapter's sound here and
 * tells the listeners, as a finished download does; `fail(chapterId)` tells them it could not come; `started` lists
 * each `chapterStarting` call and `retried` each `retry`.
 */
export function memoryVoice(initial: Record<string, Record<string, ClipSound>> = {}) {
  const here = new Map(Object.entries(initial))
  const listeners = new Set<(chapterId: string) => void>()
  const missing = new Set<(chapterId: string, missing: boolean) => void>()
  const started: string[] = []
  const retried: string[] = []
  const soundOf = (clips: Record<string, ClipSound>): ChapterSound => ({ clip: (id) => clips[id] ?? null })
  const voice: Voice = {
    chapterStarting: (id) => void started.push(id),
    chapter: (id) => Promise.resolve(here.has(id) ? soundOf(here.get(id)!) : null),
    onArrive: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    onMissing: (fn) => {
      missing.add(fn)
      return () => missing.delete(fn)
    },
    retry: (id) => {
      retried.push(id)
      missing.forEach((fn) => fn(id, false))
    },
  }
  return {
    voice,
    started,
    retried,
    arrive(chapterId: string, clips: Record<string, ClipSound>) {
      here.set(chapterId, clips)
      missing.forEach((fn) => fn(chapterId, false))
      listeners.forEach((fn) => fn(chapterId))
    },
    fail(chapterId: string) {
      missing.forEach((fn) => fn(chapterId, true))
    },
  }
}

/** A stand-in scene for the layer's tests: the clip's words, and "Done, go on" on a clip that waits. */
export function PlaceholderScene({ clip, waits, done }: SceneProps) {
  return (
    <div className="course-scene">
      <p className="course-scene__words">{clip.text}</p>
      {waits && (
        <button type="button" className="course__btn course__btn--primary" onClick={done}>
          Done, go on
        </button>
      )}
    </div>
  )
}

/** Every clip on the stand-in scene. */
export const placeholderScenes: SceneFor = () => PlaceholderScene

export interface Mounted {
  root: Root
  el: HTMLDivElement
  render(clip: CourseClip): void
  unmount(): void
}

/** Mount a scene for `chapter`'s clips; `render(clip)` moves it to another clip with the same key (a span). */
export function mountScene(Scene: Scene, chapter: CourseChapter, props: { clock: SceneClock; done: () => void; reducedMotion?: boolean; host: CourseHost; waits?: (clip: CourseClip) => boolean }): Mounted {
  const el = document.createElement('div')
  el.className = 'course__stage'
  document.body.appendChild(el)
  const root = createRoot(el)
  const render = (clip: CourseClip): void => {
    act(() => root.render(<Scene key="scene" chapter={chapter} clip={clip} waits={props.waits?.(clip) ?? false} clock={props.clock} done={props.done} reducedMotion={props.reducedMotion ?? false} host={props.host} />))
  }
  return {
    root,
    el,
    render,
    unmount: () => {
      act(() => root.unmount())
      el.remove()
    },
  }
}
