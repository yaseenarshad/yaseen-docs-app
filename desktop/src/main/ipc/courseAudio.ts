import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure } from '../fs/fsUtils'
import { COURSE_AUDIO_DIR, courseAudioSource, createCourseAudio, parseCourseAudioManifest, type CourseAudio } from '../courseAudio/courseAudio'
import { isCourseId } from '../courseAudio/packFormat'
import manifestJson from '../courseAudio/course-audio.json'
import { broadcastAll } from './broadcast'
import { handleWithEvent } from './envelope'

/** A chapter id a renderer names; anything else is `BAD_REQUEST`. */
export function requireChapterId(v: unknown): string {
  if (isCourseId(v)) return v
  throw new BridgeFailure('BAD_REQUEST', "'chapter' must be a chapter id")
}

/**
 * The course sound's doors (YAZ-5159, 6D1). The core is `courseAudio/courseAudio.ts`; this is the thin wiring: the
 * window that asks is the one whose course is open, a window that goes closes its course, and each change goes to
 * every window. `index.ts` serves `app://course-voice/…` from the returned core and runs its `sweep` at app start.
 */
export function registerCourseAudioIpc({ userData, isPackaged, env = process.env, fetchImpl = globalThis.fetch }: { userData: string; isPackaged: boolean; env?: Record<string, string | undefined>; fetchImpl?: typeof globalThis.fetch }): CourseAudio {
  const audio = createCourseAudio({
    folder: join(userData, COURSE_AUDIO_DIR),
    manifest: parseCourseAudioManifest(manifestJson),
    source: courseAudioSource(env, isPackaged),
    fetch: fetchImpl,
    onChange: (change) => broadcastAll(CONTRACT.courseAudio.onChange.channel, change),
  })
  const watched = new Set<number>()
  /** The course is open in the window that sent `e`; its close (or its end) closes it. */
  const opened = (e: IpcMainInvokeEvent): number => {
    const id = e.sender.id
    if (!watched.has(id)) {
      watched.add(id)
      e.sender.once('destroyed', () => {
        watched.delete(id)
        audio.close(id)
      })
    }
    return id
  }
  handleWithEvent(CONTRACT.courseAudio.open, async (e, open: unknown) => {
    if (open === true) audio.open(opened(e))
    else audio.close(e.sender.id)
  })
  handleWithEvent(CONTRACT.courseAudio.chapterStarting, async (e, chapter: unknown) => audio.chapterStarting(opened(e), requireChapterId(chapter)))
  handleWithEvent(CONTRACT.courseAudio.chapter, async (_e, chapter: unknown) => audio.chapter(requireChapterId(chapter)))
  return audio
}
