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
 * - `made` (YAZ-5124): what the course made, per vault: its "Course Cards" folder, the card files it wrote itself (the
 *   first card, the example cards) and its "Course page". A record, never the truth: each thing stays a plain file the
 *   person sees in the sidebar, and deleting any of it (the whole folder too) is safe; the course makes what a step
 *   needs again.
 * - `toured`: the ids of the chapters whose guided tour ("Try it in the app", YAZ-5123) the person finished.
 * - `vault` (YAZ-5201): the vault the course is bound to, kept with the place. The course works in ONE vault for its whole
 *   run: the vault in front when it was opened, or, when it opens again at this place, this one. null: none yet.
 */

/** The player's speeds (YAZ-5059 suggestion 21). */
export const COURSE_SPEEDS = [1, 1.25, 1.5] as const
export type CourseSpeed = (typeof COURSE_SPEEDS)[number]

/** What the course made in one vault (YAZ-5124). Absolute paths. */
export interface CourseMade {
  vault: string
  folder: string
  cards: string[]
  page: string | null
}

export interface CourseState {
  chapter: string
  clip: string
  finished: string[]
  done: boolean
  dismissed: boolean
  offered: boolean
  muted: boolean
  speed: CourseSpeed
  made: CourseMade[]
  toured: string[]
  vault: string | null
}

/** One change to the course's state: only the fields it names. */
export type CoursePatch = Partial<CourseState>

/** The longest id kept, and the most finished chapters kept: far above the script's, so junk cannot grow the file. */
const MAX_ID = 64
const MAX_FINISHED = 64
/** The most vaults, card paths per vault, and the longest path kept in `made`. */
const MAX_MADE_VAULTS = 32
const MAX_MADE_CARDS = 256
const MAX_PATH = 4096

export function defaultCourseState(): CourseState {
  return { chapter: '', clip: '', finished: [], done: false, dismissed: false, offered: false, muted: false, speed: 1, made: [], toured: [], vault: null }
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_ID && /^[A-Za-z0-9_-]*$/.test(v)
const isPath = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= MAX_PATH && (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('\\\\'))

/** One vault's record of `made`, or null when any part of it is not valid (the record is dropped whole, never half kept). */
function cleanMade(raw: unknown): CourseMade | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isPath(r.vault) || !isPath(r.folder) || !Array.isArray(r.cards) || !r.cards.every(isPath) || !(r.page === null || isPath(r.page))) return null
  return { vault: r.vault, folder: r.folder, cards: [...new Set(r.cards as string[])].slice(0, MAX_MADE_CARDS), page: r.page as string | null }
}

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
    made: Array.isArray(r.made) ? uniqueVaults(r.made.map(cleanMade).filter((m): m is CourseMade => m !== null)).slice(0, MAX_MADE_VAULTS) : base.made,
    toured: ids(r.toured, base.toured),
    vault: r.vault === null || isPath(r.vault) ? r.vault : base.vault,
  }
}

/** One record per vault: the first one kept. */
const uniqueVaults = (made: CourseMade[]): CourseMade[] => made.filter((m, i) => made.findIndex((o) => o.vault === m.vault) === i)

/** Two states with the same fields (the cache keeps its snapshot, the store skips a commit). */
export function sameCourseState(a: CourseState, b: CourseState): boolean {
  return a.chapter === b.chapter && a.clip === b.clip && a.done === b.done && a.dismissed === b.dismissed && a.offered === b.offered && a.muted === b.muted && a.speed === b.speed
    && a.finished.length === b.finished.length && a.finished.every((id, i) => id === b.finished[i])
    && JSON.stringify(a.made) === JSON.stringify(b.made)
    && a.toured.length === b.toured.length && a.toured.every((id, i) => id === b.toured[i])
    && a.vault === b.vault
}

/** Pure: `patch` applied to `state` by the rule of `cleanCourseState`; the same object when nothing changed. */
export function applyCoursePatch(state: CourseState, patch: unknown): CourseState {
  const next = cleanCourseState(patch, state)
  return sameCourseState(next, state) ? state : next
}
