/**
 * The card course's player, as pure logic (YAZ-5120): one reducer, `step`, over the script. No DOM and no clock of its
 * own: the layer (`CardCourse`) sends `tick` with the real seconds that passed, or `clock` with the sound's own time,
 * and acts on the events that come back (save the place, fire a scene's mark, mark a chapter done).
 *
 * THE RULES
 *  - A chapter plays its clips in order. A clip lasts its length (`PlayerContext.seconds`: the sound's, else the
 *    reading-time estimate), then a short quiet gap (`GAP_SECONDS`), then the next clip starts.
 *  - Time is the clip's own time, in seconds at 1×. Speed makes the page clock run faster (`tick` × speed); the sound
 *    plays faster by itself, and `clock` reads its time. Mute changes nothing here: the timing and the captions stay.
 *  - A clip that waits for the person (`PlayerContext.waits`, the script's "WAITS:") stops at the end of its words and
 *    stays there until its scene says the step is done (`release`), or the person presses Next.
 *  - A clip's `marks` are fractions of its length. Each fires once, when the time passes it (`mark` events), in order;
 *    a jump over several fires each of them.
 *  - The end of a chapter's last clip finishes the chapter (`chapter-end`): the chapter list marks it, and the player
 *    stops on the chapter's end screen ("Try it in the app", "Next chapter"). The last chapter's end is the course's end.
 *  - Next and Back move by one clip (Back first goes to the start of the clip, after its first `BACK_RESTART_SECONDS`);
 *    Next chapter skips the rest of a chapter without finishing it. The person can skip each step.
 */
import type { CourseSpeed, CourseState } from '@shared/courseState'
import type { CourseChapter, CourseClip } from './script'

/** The quiet after a clip, in seconds at 1×, before the next one starts (the sample's gaps were 0.35 to 0.8 s). */
export const GAP_SECONDS = 0.45
/** Back after this many seconds into a clip starts the clip again; before it, Back goes to the clip before. */
export const BACK_RESTART_SECONDS = 1.5

/** What the player needs to know about the script. */
export interface PlayerContext {
  course: readonly CourseChapter[]
  /** The clip's length in seconds at 1×: the sound's, else the estimate (`clipSeconds`). */
  seconds: (clip: CourseClip) => number
  /** The clip waits for the person (`WAITING_CLIPS`). */
  waits: (clip: CourseClip) => boolean
}

/** Where the player is: in a clip, on a chapter's end screen, or on the course's end screen. */
type PlayerPhase = 'clip' | 'chapter-end' | 'course-end'

export interface PlayerState {
  /** The index of the chapter in the course. */
  chapter: number
  /** The index of the clip in the chapter (on an end screen: its last clip). */
  clip: number
  /** Seconds into the clip, at 1×. From 0 to the clip's length plus the gap. */
  t: number
  phase: PlayerPhase
  playing: boolean
  /** The clip's scene said the person did the step (a clip that waits). */
  released: boolean
  /** How many of the clip's marks have fired. */
  marks: number
  speed: CourseSpeed
  muted: boolean
  /** The ids of the finished chapters, in the order they were finished. */
  finished: readonly string[]
}

export type PlayerAction =
  /** Real seconds that passed on the page clock (no sound, or the sound ended). Counts only while playing. */
  | { type: 'tick'; dt: number }
  /** The sound's own time in the clip, in seconds (it plays at the speed itself). Counts only while playing. */
  | { type: 'clock'; t: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'next-chapter' }
  | { type: 'prev-chapter' }
  /** Go to the start of the chapter at `index` (the chapter list). */
  | { type: 'chapter'; index: number }
  /** The scene says the person did the step: a clip that waits may end. */
  | { type: 'release' }
  | { type: 'speed'; speed: CourseSpeed }
  | { type: 'mute'; muted: boolean }

export type PlayerEvent =
  /** A clip starts (a new clip, or the same clip again): the place to keep, and the scene to show. */
  | { kind: 'enter'; chapter: string; clip: string }
  /** The clip's mark at `index` fired. */
  | { kind: 'mark'; clip: string; index: number }
  /** The chapter ended: its mark in the list. */
  | { kind: 'chapter-end'; chapter: string }
  /** The last chapter ended. */
  | { kind: 'course-end' }

export interface StepResult {
  state: PlayerState
  events: PlayerEvent[]
}

const clipAt = (ctx: PlayerContext, s: Pick<PlayerState, 'chapter' | 'clip'>): CourseClip => ctx.course[s.chapter].clips[s.clip]

/** Pure: the indexes of a saved place. An id the script no longer has is the start of its chapter, or of the course. */
export function placeIn(course: readonly CourseChapter[], chapterId: string, clipId: string): { chapter: number; clip: number } {
  const chapter = course.findIndex((ch) => ch.id === chapterId)
  if (chapter < 0) return { chapter: 0, clip: 0 }
  return { chapter, clip: Math.max(0, course[chapter].clips.findIndex((c) => c.id === clipId)) }
}

/**
 * Pure: the player when the course opens, paused. At `openAt`'s chapter when another part asked for one (issue 4's
 * "Learn the formats"), else at the saved place. Mute, Speed and the finished chapters come from the saved state.
 */
export function startState(ctx: PlayerContext, saved: CourseState, openAt?: string): PlayerState {
  const at = openAt !== undefined && ctx.course.some((ch) => ch.id === openAt) ? placeIn(ctx.course, openAt, '') : placeIn(ctx.course, saved.chapter, saved.clip)
  const known = new Set(ctx.course.map((ch) => ch.id))
  return { ...at, t: 0, phase: 'clip', playing: false, released: false, marks: 0, speed: saved.speed, muted: saved.muted, finished: saved.finished.filter((id) => known.has(id)) }
}

/** A clip from its start: the `enter` event with it. */
function enter(ctx: PlayerContext, s: PlayerState, chapter: number, clip: number, playing = s.playing): StepResult {
  const next: PlayerState = { ...s, chapter, clip, t: 0, phase: 'clip', released: false, marks: 0, playing }
  return { state: next, events: [{ kind: 'enter', chapter: ctx.course[chapter].id, clip: ctx.course[chapter].clips[clip].id }] }
}

/** The chapter's end: it is finished (once in the list), and the player stops on its end screen. */
function endChapter(ctx: PlayerContext, s: PlayerState): StepResult {
  const chapter = ctx.course[s.chapter]
  const last = s.chapter === ctx.course.length - 1
  const finished = s.finished.includes(chapter.id) ? s.finished : [...s.finished, chapter.id]
  const events: PlayerEvent[] = [{ kind: 'chapter-end', chapter: chapter.id }]
  if (last) events.push({ kind: 'course-end' })
  return { state: { ...s, clip: chapter.clips.length - 1, t: seconds0(ctx, s), phase: last ? 'course-end' : 'chapter-end', playing: false, finished }, events }
}
const seconds0 = (ctx: PlayerContext, s: PlayerState): number => ctx.seconds(clipAt(ctx, s)) + GAP_SECONDS

/** The clip after this one, or the chapter's end. */
function forward(ctx: PlayerContext, s: PlayerState): StepResult {
  if (s.clip + 1 < ctx.course[s.chapter].clips.length) return enter(ctx, s, s.chapter, s.clip + 1)
  return endChapter(ctx, s)
}

/**
 * The clip's time moves to `to` (never back): the marks it passes fire, a clip that waits holds at the end of its
 * words, and past the gap the next clip starts.
 */
function advanceTo(ctx: PlayerContext, s: PlayerState, to: number): StepResult {
  const clip = clipAt(ctx, s)
  const length = ctx.seconds(clip)
  const holds = ctx.waits(clip) && !s.released
  const t = Math.max(s.t, holds ? Math.min(to, length) : to)
  const events: PlayerEvent[] = []
  const marks = clip.marks ?? []
  let fired = s.marks
  while (fired < marks.length && t >= marks[fired] * length) {
    events.push({ kind: 'mark', clip: clip.id, index: fired })
    fired += 1
  }
  const moved: PlayerState = { ...s, t, marks: fired }
  if (t < length + GAP_SECONDS) return { state: moved, events }
  const after = forward(ctx, moved)
  return { state: after.state, events: [...events, ...after.events] }
}

/** Pure: the player after one action, and what happened. */
export function step(ctx: PlayerContext, s: PlayerState, action: PlayerAction): StepResult {
  const same: StepResult = { state: s, events: [] }
  switch (action.type) {
    case 'tick':
      if (!s.playing || s.phase !== 'clip' || !(action.dt > 0)) return same
      return advanceTo(ctx, s, s.t + action.dt * s.speed)
    case 'clock':
      // The sound's time is never past the end of its words; the gap after it runs on the page clock.
      if (!s.playing || s.phase !== 'clip' || !Number.isFinite(action.t)) return same
      return advanceTo(ctx, s, Math.min(action.t, ctx.seconds(clipAt(ctx, s))))
    case 'play':
      if (s.playing) return same
      if (s.phase === 'chapter-end') return enter(ctx, s, s.chapter + 1, 0, true)
      if (s.phase === 'course-end') return enter(ctx, s, 0, 0, true)
      return { state: { ...s, playing: true }, events: [] }
    case 'pause':
      return s.playing ? { state: { ...s, playing: false }, events: [] } : same
    case 'toggle':
      return step(ctx, s, { type: s.playing ? 'pause' : 'play' })
    case 'next':
      if (s.phase === 'chapter-end') return enter(ctx, s, s.chapter + 1, 0, true)
      if (s.phase === 'course-end') return same
      return forward(ctx, s)
    case 'back':
      if (s.phase !== 'clip') return enter(ctx, s, s.chapter, s.clip)
      if (s.t > BACK_RESTART_SECONDS) return enter(ctx, s, s.chapter, s.clip)
      if (s.clip > 0) return enter(ctx, s, s.chapter, s.clip - 1)
      if (s.chapter > 0) return enter(ctx, s, s.chapter - 1, ctx.course[s.chapter - 1].clips.length - 1)
      return enter(ctx, s, 0, 0)
    case 'next-chapter':
      return s.chapter + 1 < ctx.course.length ? enter(ctx, s, s.chapter + 1, 0) : same
    case 'prev-chapter':
      // As Back: within a chapter, its start first; at its start, the chapter before.
      if (s.phase === 'clip' && (s.clip > 0 || s.t > BACK_RESTART_SECONDS)) return enter(ctx, s, s.chapter, 0)
      return enter(ctx, s, Math.max(0, s.phase === 'clip' ? s.chapter - 1 : s.chapter), 0)
    case 'chapter':
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= ctx.course.length) return same
      return enter(ctx, s, action.index, 0)
    case 'release': {
      if (s.phase !== 'clip' || s.released) return same
      const released = { ...s, released: true }
      // Held at the end of the words: the gap starts now, and the clip ends after it as any other.
      return { state: released, events: [] }
    }
    case 'speed':
      return action.speed === s.speed ? same : { state: { ...s, speed: action.speed }, events: [] }
    case 'mute':
      return action.muted === s.muted ? same : { state: { ...s, muted: action.muted }, events: [] }
  }
}

/** Pure: does the player wait for the person now (a clip that waits, at the end of its words, not released)? */
export function waitingForPerson(ctx: PlayerContext, s: PlayerState): boolean {
  if (s.phase !== 'clip') return false
  const clip = clipAt(ctx, s)
  return ctx.waits(clip) && !s.released && s.t >= ctx.seconds(clip)
}

/** Pure: how far the clip is, 0 to 1 (the words only; the gap reads as 1). */
export function clipFraction(ctx: PlayerContext, s: PlayerState): number {
  if (s.phase !== 'clip') return 1
  const length = ctx.seconds(clipAt(ctx, s))
  return Math.min(1, s.t / length)
}

/** Pure: how far the chapter is, 0 to 1, by time: the progress bar. */
export function chapterFraction(ctx: PlayerContext, s: PlayerState): number {
  if (s.phase !== 'clip') return 1
  const clips = ctx.course[s.chapter].clips
  const lengths = clips.map((c) => ctx.seconds(c) + GAP_SECONDS)
  const total = lengths.reduce((a, b) => a + b, 0)
  const before = lengths.slice(0, s.clip).reduce((a, b) => a + b, 0)
  return total <= 0 ? 0 : Math.min(1, (before + Math.min(s.t, lengths[s.clip])) / total)
}

/**
 * Pure: the place to keep for this state (`AppState.course`). On a chapter's end screen it is the next chapter's
 * start, so a restart goes on from there; on the course's end, the course's start.
 */
export function placeOf(ctx: PlayerContext, s: PlayerState): { chapter: string; clip: string } {
  if (s.phase === 'course-end') return { chapter: ctx.course[0].id, clip: '' }
  if (s.phase === 'chapter-end') return { chapter: ctx.course[s.chapter + 1].id, clip: '' }
  return { chapter: ctx.course[s.chapter].id, clip: clipAt(ctx, s).id }
}
