/**
 * The course sound's bridge types (YAZ-5159, 6D1). Main downloads a chapter's sound when the person starts that chapter
 * (`desktop/src/main/courseAudio/courseAudio.ts`); the renderer's voice (`client/src/course/downloadedVoice.ts`) reads it.
 */

/** A chapter's sound is here, it is downloading, or it could not come (offline, a failed download). */
export type CourseAudioState = 'here' | 'loading' | 'missing'

/** Pushed to every window when a chapter's state changes. */
export interface CourseAudioChange {
  chapter: string
  state: CourseAudioState
}

/** A chapter's sound for the player: each clip's `app://course-voice/…` URL and its length in seconds. */
export interface CourseAudioSound {
  clips: Record<string, { url: string; seconds: number }>
}
