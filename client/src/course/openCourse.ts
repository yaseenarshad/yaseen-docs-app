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

/**
 * The ONE vault a course run works in (YAZ-5201), chosen when the course opens and kept for the whole run: every write,
 * the AI step's watch, the tours' checks and the end screen use it, whichever tab is in front later.
 *
 * - A new run (a chapter asked for, or no place kept yet): the vault in front (`front`).
 * - The course opens again at its kept place: the vault kept with the place (`AppState.course.vault`). When that vault
 *   is not in the window any more, `lost` names it: the course says so in one line and offers to start over in front.
 */
export function courseVaultAt(chapter: string | undefined, saved: { chapter: string; clip: string; vault: string | null }, front: string | null, roots: readonly string[]): { vault: string | null; lost?: string } {
  const resumes = chapter === undefined && saved.vault !== null && (saved.chapter !== '' || saved.clip !== '')
  if (!resumes || saved.vault === null) return { vault: front }
  return roots.includes(saved.vault) ? { vault: saved.vault } : { vault: null, lost: saved.vault }
}

/** The one line when the run's vault is not in the window (YAZ-5201), and the button that starts over in the vault in front. */
export const courseLostLine = (vaultName: string): string => `${vaultName} is not open in this window, so the course makes no files.`
export const courseStartOverLabel = (vaultName: string): string => `Start over in ${vaultName}`
