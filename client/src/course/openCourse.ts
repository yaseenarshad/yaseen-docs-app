/**
 * The one door to the card course for any part of the app (YAZ-5120): Settings › Review, the notice, the empty Inbox,
 * and later the format hint's "Learn the formats" (issue 4 opens one chapter). App listens and opens the course layer.
 * A DOM event, as the card UI calls the app (`NOTE_CARD_OPEN`): a caller needs no prop chain and no import of the
 * course itself, which loads only when it opens.
 */

/** The event's name. Its `detail` is a `CourseRequest`. */
export const COURSE_OPEN_EVENT = 'yd:course-open'

/** What to open: the course at the person's place, or one chapter by its id in `script.ts` (`'good-card'`). */
export interface CourseRequest {
  chapter?: string
}

/** Open the course: at the place, or at the start of `chapter`. Never forced: only a person's click calls this. */
export function requestCourse(chapter?: string): void {
  const detail: CourseRequest = chapter === undefined ? {} : { chapter }
  window.dispatchEvent(new CustomEvent<CourseRequest>(COURSE_OPEN_EVENT, { detail }))
}

/** App's listener; returns the way to stop listening. */
export function onCourseRequest(open: (request: CourseRequest) => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail
    const chapter = typeof detail === 'object' && detail !== null && typeof (detail as CourseRequest).chapter === 'string' ? (detail as CourseRequest).chapter : undefined
    open(chapter === undefined ? {} : { chapter })
  }
  window.addEventListener(COURSE_OPEN_EVENT, listener)
  return () => window.removeEventListener(COURSE_OPEN_EVENT, listener)
}
