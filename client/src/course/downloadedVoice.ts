/**
 * THE REAL VOICE (YAZ-5159, 6D1): the course's sound, downloaded by main one chapter at a time
 * (`desktop/src/main/courseAudio/courseAudio.ts`). It fills the player's seam (`courseVoice.ts`):
 *
 * - `chapterStarting(id)` asks main for the chapter (main downloads it when it is not here, then the next one).
 * - `chapter(id)` is the chapter's sound when its checked file is here: each clip plays from
 *   `app://course-voice/<chapter>/<clip>.m4a`, for the seconds the manifest names. Else null: the chapter plays silent.
 * - `onArrive` hears main's `here`; `onMissing` hears `missing` (true) and `loading` / `here` (false), for the quiet
 *   line; `retry` ("Try again") asks for the chapter again.
 *
 * A bridge call that fails is silence, never an error the person sees. The course layer opens and closes it in main
 * (`open`), so main never downloads while the course is closed.
 */
import type { CourseAudioChange, CourseAudioSound } from '@shared/courseAudio'
import { api } from '../api'
import type { ChapterSound, Voice } from './courseVoice'

/** The part of the bridge the voice uses (the test passes a fake). */
export interface CourseAudioBridge {
  open(open: boolean): Promise<void>
  chapterStarting(chapter: string): Promise<void>
  chapter(chapter: string): Promise<CourseAudioSound | null>
  onChange(listener: (change: CourseAudioChange) => void): () => void
}

export interface DownloadedVoice extends Voice {
  /** The course layer opened (true) or closed (false) in this window. */
  open(open: boolean): void
}

export function downloadedVoice(bridge: CourseAudioBridge = api.courseAudio): DownloadedVoice {
  const arrive = new Set<(chapterId: string) => void>()
  const missing = new Set<(chapterId: string, missing: boolean) => void>()
  /** Subscribed to main while anyone listens. */
  let off: (() => void) | null = null
  const follow = () => {
    if (off !== null) return
    off = bridge.onChange(({ chapter, state }) => {
      missing.forEach((fn) => fn(chapter, state === 'missing'))
      if (state === 'here') arrive.forEach((fn) => fn(chapter))
    })
  }
  const unfollow = () => {
    if (arrive.size > 0 || missing.size > 0 || off === null) return
    off()
    off = null
  }
  const listen = <F>(set: Set<F>, fn: F): (() => void) => {
    set.add(fn)
    follow()
    return () => {
      set.delete(fn)
      unfollow()
    }
  }
  const soundOf = (sound: CourseAudioSound): ChapterSound => ({ clip: (id) => (Object.hasOwn(sound.clips, id) ? sound.clips[id] : null) })
  const start = (chapterId: string) => void bridge.chapterStarting(chapterId).catch(() => undefined)
  return {
    open: (open) => void bridge.open(open).catch(() => undefined),
    chapterStarting: start,
    chapter: (chapterId) => bridge.chapter(chapterId).then((sound) => (sound === null ? null : soundOf(sound)), () => null),
    onArrive: (fn) => listen(arrive, fn),
    onMissing: (fn) => listen(missing, fn),
    retry: start,
  }
}
