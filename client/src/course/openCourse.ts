/**
 * The one door to the card course for any part of the app (YAZ-5120): Settings › Review, the notice, the empty Inbox,
 * and the format hint's "Learn the formats" (issue 4 opens one chapter: `requestCourseChapter`). App listens and opens the course layer.
 * A DOM event, as the card UI calls the app (`CARD_OPEN`): a caller needs no prop chain and no import of the
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

/** The title of the course's chapter on good cards and formats in `script.ts`: "Learn the formats" (YAZ-5114) opens it. */
export const FORMATS_CHAPTER_TITLE = 'What makes a good card'

/**
 * Open the course at the chapter titled `title` (YAZ-5114 with YAZ-5120). The chapter's id comes from `COURSE` in the
 * script, loaded here with `import()`, so the startup bundle still holds no script (the course loads it to open
 * anyway). `fallback` runs instead when the course cannot open: the script does not load, or it has no such chapter.
 */
export async function requestCourseChapter(title: string, fallback: () => void, load: () => Promise<{ COURSE: readonly { id: string; title: string }[] }> = () => import('./script')): Promise<void> {
  let id: string | undefined
  try {
    id = (await load()).COURSE.find((chapter) => chapter.title === title)?.id
  } catch {
    id = undefined
  }
  if (id === undefined) fallback()
  else requestCourse(id)
}
