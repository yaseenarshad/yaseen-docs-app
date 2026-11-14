/**
 * THE SCENE SEAM (YAZ-5120 for issue 6C, YAZ-5121): what the stage shows during one clip.
 *
 * A scene is a React component, chosen by clip id (`SceneFor`). The layer mounts the clip's scene on the stage when
 * the clip starts and unmounts it when the clip ends; the same scene for the next clip mounts again, with its new
 * clip. The scene reads the time from `clock`, not from props: the clock changes on each frame, and a scene that does
 * not need each frame (most) renders only on a mark or on its own events. The caption is the layer's, never the scene's.
 *
 * - `clock.now()`: the clip's time in seconds at 1×, its length, the fraction (0 to 1), and whether it plays.
 * - `clock.subscribe(fn)`: `fn` on each frame while the clip runs, and on pause, play and seek. Returns the unsubscribe.
 * - `clock.onMark(fn)`: `fn(index)` when the clip's mark at `index` fires (its `marks` in `script.ts`).
 * - `done()`: the person did the step. A clip that waits (`WAITING_CLIPS`) ends only after it, or the person's Next.
 *   A call on a clip that does not wait is harmless.
 * - `reducedMotion`: `prefers-reduced-motion: reduce`. Cross-fade in place, never move (YAZ-5120).
 * - `host`: the course's side effects for the person's vault (issue 6F, `CourseHost`).
 *
 * Pause stops the motion: a scene that animates with the Web Animations API pauses its animations while
 * `clock.now().playing` is false.
 */
import type { ComponentType } from 'react'
import type { CourseChapter, CourseClip } from './script'
import type { CourseHost } from './courseHost'

export interface SceneTime {
  /** Seconds into the clip, at 1×. */
  t: number
  /** The clip's length in seconds, at 1× (the sound's, else the estimate). */
  length: number
  /** `t / length`, 0 to 1. */
  fraction: number
  playing: boolean
}

export interface SceneClock {
  now(): SceneTime
  subscribe(listener: () => void): () => void
  onMark(listener: (index: number) => void): () => void
}

export interface SceneProps {
  chapter: CourseChapter
  clip: CourseClip
  /** The clip waits for the person: the scene shows the step, and calls `done` when it is done. */
  waits: boolean
  clock: SceneClock
  done: () => void
  reducedMotion: boolean
  host: CourseHost
  /** Moves the course on exactly as its Next button does, without `done` (YAZ-5347: "Go on without it"). */
  next?: () => void
}

export type Scene = ComponentType<SceneProps>

/**
 * The scene of a clip, by its id. The course's own is `courseScenes` (`scenes/index.ts`).
 * `spanOf` (YAZ-5121): clips in a row that share one scene give the same span key, and the layer keeps that scene
 * mounted across them (it gets each clip as a new `clip` prop, with the same clock).
 */
export type SceneFor = ((clipId: string) => Scene) & { spanOf?: (clipId: string) => string | undefined }
