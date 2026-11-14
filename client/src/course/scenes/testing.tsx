/**
 * Test helpers for scenes (YAZ-5121): a clock the test drives, a host double, and a mount. Only tests import this file.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SceneClock, SceneTime, Scene } from '../scene'
import type { CourseChapter, CourseClip } from '../script'
import type { CourseHost } from '../courseHost'
import type { CourseCardDraft } from './makeCard'

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

/** A host that makes cards in memory, as the real one of issue 6F will. */
export function memoryHost(): CourseHost & { made: CourseCardDraft[]; makeCard(folder: string, draft: CourseCardDraft): Promise<{ path: string }> } {
  const made: CourseCardDraft[] = []
  return {
    vault: '/demo',
    made,
    courseCards: () => Promise.resolve({ path: '/demo/Course Cards' }),
    watchCards: (_f, onCards) => {
      onCards([])
      return () => undefined
    },
    makeCard: (folder, draft) => {
      made.push(draft)
      return Promise.resolve({ path: `${folder}/${draft.title}.md` })
    },
  }
}

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
