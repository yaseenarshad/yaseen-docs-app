/**
 * How long a clip runs (YAZ-5120). With a sound file (issue 6D), the clip runs for the sound's length, as the voice
 * manifest gives it. Without one, it runs on a reading-time estimate, so the course works silent, with captions.
 */
import type { CourseChapter, CourseClip } from './script'
import { WORDS_PER_MINUTE } from './courseFacts'

/** A clip never runs shorter than this on the estimate: a caption of two words still has time to be read. */
export const MIN_CLIP_SECONDS = 1.5

/** The words of a text, as the script test counts them. */
export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => w !== '').length

/** Pure: a clip's reading time at `WORDS_PER_MINUTE`, in seconds at speed 1. */
export const estimateSeconds = (text: string): number => Math.max(MIN_CLIP_SECONDS, (wordCount(text) * 60) / WORDS_PER_MINUTE)

/** Pure: the clip's length — the sound's, when the voice has one (a positive, finite number), else the estimate. */
export function clipSeconds(clip: CourseClip, soundSeconds: number | null): number {
  return soundSeconds !== null && Number.isFinite(soundSeconds) && soundSeconds > 0 ? soundSeconds : estimateSeconds(clip.text)
}

/** Pure: the course's minutes, rounded, from its words (what `COURSE_MINUTES` must say). */
export function courseMinutes(course: readonly CourseChapter[]): number {
  const words = course.reduce((n, chapter) => n + chapter.clips.reduce((m, clip) => m + wordCount(clip.text), 0), 0)
  return Math.round(words / WORDS_PER_MINUTE)
}
