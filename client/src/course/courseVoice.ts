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
 * - Optional (YAZ-5346): `onLoading(listener)` calls `listener(chapterId, true)` while a chapter's sound is downloading
 *   for the person (the downloader said `loading`; on subscribe, for each chapter that is loading now) and
 *   `listener(chapterId, false)` when it is here or missing. While it loads, the chapter holds at its start.
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
  onLoading?(listener: (chapterId: string, loading: boolean) => void): () => void
}

/** No sound at all: each clip runs on its estimate, with captions (a chapter whose sound is not here yet). */
export const SILENT_VOICE: Voice = {
  chapterStarting: () => undefined,
  chapter: () => Promise.resolve(null),
  onArrive: () => () => undefined,
}
