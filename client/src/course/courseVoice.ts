/**
 * THE VOICE SEAM (YAZ-5120, for issue 6D1, YAZ-5159): chapter → sound.
 *
 * The course's sound is not in the app (Yaseen: "download it so it stays light"). 6D1 downloads one file for each
 * chapter when the person starts that chapter, keeps it in `<userData>/card-course-audio/`, and deletes it later. The
 * player never reads sound from the app bundle. Until a chapter's sound is here, the chapter plays silent: captions,
 * and each clip on its reading-time estimate (`courseTime.ts`).
 *
 * - `chapterStarting(chapterId)`: the player calls it when a chapter starts (the course opens at a place in it, the
 *   person goes to it, or the chapter before ends). The downloader starts here (and may fetch the next chapter in the
 *   background). Never called while the course is closed.
 * - `chapter(chapterId)`: the chapter's sound if it is here now, else null. Never rejects with a reason the player
 *   must show: a failed or missing download is null. (6D1 shows its own quiet line, with "Try again".)
 * - `onArrive(listener)`: `listener(chapterId)` when a chapter's sound arrives (a download ended, "Try again"
 *   worked). The player then asks `chapter` again and uses the sound from the NEXT clip on, never in the middle of one.
 * - `ChapterSound.clip(clipId)`: the clip's sound — a URL the audio element can play and the length in seconds — or
 *   null for a clip it does not hold (that clip plays silent on its estimate).
 * - Optional, for the quiet line (6D1): `onMissing(listener)` calls `listener(chapterId, true)` when a chapter's sound
 *   could not come (offline, a failed download) and `listener(chapterId, false)` when it is coming again or here.
 *   `retry(chapterId)` is the line's "Try again". A voice without them shows no line.
 */
export interface ClipSound {
  url: string
  seconds: number
}

export interface ChapterSound {
  clip(clipId: string): ClipSound | null
}

export interface Voice {
  chapterStarting(chapterId: string): void
  chapter(chapterId: string): Promise<ChapterSound | null>
  onArrive(listener: (chapterId: string) => void): () => void
  onMissing?(listener: (chapterId: string, missing: boolean) => void): () => void
  retry?(chapterId: string): void
}

/** No sound at all: each clip runs on its estimate, with captions. The frame's voice until 6D1 plugs in. */
export const SILENT_VOICE: Voice = {
  chapterStarting: () => undefined,
  chapter: () => Promise.resolve(null),
  onArrive: () => () => undefined,
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
