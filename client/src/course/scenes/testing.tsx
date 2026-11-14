/**
 * Test helpers for scenes (YAZ-5121): a clock the test drives, a host double, and a mount. Only tests import this file.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SceneClock, SceneTime, Scene } from '../scene'
import type { CourseChapter, CourseClip } from '../script'
import { memoryHost as courseMemoryHost, type CourseHost, type MemoryHost } from '../courseHost'

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

/** The host double (YAZ-5124's `memoryHost`), in the vault `/demo`: it makes cards in memory, in `made`. */
export const memoryHost = (): MemoryHost => courseMemoryHost('/demo')

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
