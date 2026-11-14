/**
 * The card course's place on this Mac (YAZ-5120, issue 6B of YAZ-5118): `AppState.course`. Per machine, never in a
 * vault. Main keeps it (`state:set-course`); the renderer reads it through `storage.getCourse`. Additive within
 * version 1: a file without it loads the default, and an old build drops the key.
 *
 * - `chapter`, `clip`: the place, by the ids of `client/src/course/script.ts`. '' is the start of the course. An id the
 *   script no longer has reads as the start of its chapter, or of the course (the player's `placeIn`).
 * - `finished`: the ids of the chapters the person played to their end (the chapter list's marks).
 * - `done`: the person reached the end of the last chapter. The offers stop (the empty Inbox line, the notice).
 * - `dismissed`: "Don't show again" on the empty Inbox line.
 * - `offered`: the one notice "New to cards? …" has shown on this Mac. It never shows again.
 * - `muted`, `speed`: the player's Mute and Speed (suggestion 21: "the course remembers Mute").
 * - `toured`: the ids of the chapters whose guided tour ("Try it in the app", YAZ-5123) the person finished.
 */

/** The player's speeds (YAZ-5059 suggestion 21). */
export const COURSE_SPEEDS = [1, 1.25, 1.5] as const
export type CourseSpeed = (typeof COURSE_SPEEDS)[number]

export interface CourseState {
  chapter: string
  clip: string
  finished: string[]
  done: boolean
  dismissed: boolean
  offered: boolean
  muted: boolean
  speed: CourseSpeed
  toured: string[]
}

/** One change to the course's state: only the fields it names. */
export type CoursePatch = Partial<CourseState>

/** The longest id kept, and the most finished chapters kept: far above the script's, so junk cannot grow the file. */
const MAX_ID = 64
const MAX_FINISHED = 64

export function defaultCourseState(): CourseState {
  return { chapter: '', clip: '', finished: [], done: false, dismissed: false, offered: false, muted: false, speed: 1, toured: [] }
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_ID && /^[A-Za-z0-9_-]*$/.test(v)
const isSpeed = (v: unknown): v is CourseSpeed => (COURSE_SPEEDS as readonly unknown[]).includes(v)

/**
 * Pure (the store's sanitizer, the bridge and the renderer's cache): `raw`'s valid fields over `base`. A field that is
 * missing or not valid keeps `base`'s value, so one bad field never resets the place. Unknown keys are dropped.
 */
export function cleanCourseState(raw: unknown, base: CourseState = defaultCourseState()): CourseState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base
  const r = raw as Record<string, unknown>
  const bool = (k: 'done' | 'dismissed' | 'offered' | 'muted'): boolean => (typeof r[k] === 'boolean' ? (r[k] as boolean) : base[k])
  const ids = (v: unknown, kept: string[]): string[] => (Array.isArray(v) ? [...new Set(v.filter((id): id is string => isId(id) && id !== ''))].slice(0, MAX_FINISHED) : kept)
  const finished = ids(r.finished, base.finished)
  return {
    chapter: isId(r.chapter) ? r.chapter : base.chapter,
    clip: isId(r.clip) ? r.clip : base.clip,
    finished,
    done: bool('done'),
    dismissed: bool('dismissed'),
    offered: bool('offered'),
    muted: bool('muted'),
    speed: isSpeed(r.speed) ? r.speed : base.speed,
    toured: ids(r.toured, base.toured),
  }
}

/** Two states with the same fields (the cache keeps its snapshot, the store skips a commit). */
export function sameCourseState(a: CourseState, b: CourseState): boolean {
  return a.chapter === b.chapter && a.clip === b.clip && a.done === b.done && a.dismissed === b.dismissed && a.offered === b.offered && a.muted === b.muted && a.speed === b.speed
    && a.finished.length === b.finished.length && a.finished.every((id, i) => id === b.finished[i])
    && a.toured.length === b.toured.length && a.toured.every((id, i) => id === b.toured[i])
}

/** Pure: `patch` applied to `state` by the rule of `cleanCourseState`; the same object when nothing changed. */
export function applyCoursePatch(state: CourseState, patch: unknown): CourseState {
  const next = cleanCourseState(patch, state)
  return sameCourseState(next, state) ? state : next
}
