import { describe, expect, it } from 'vitest'
import { defaultCourseState } from '@shared/courseState'
import type { CourseChapter, CourseClip } from './script'
import { BACK_RESTART_SECONDS, GAP_SECONDS, chapterFraction, chapterTime, chapterTimes, placeOf, startState, step, waitingForPerson, type PlayerAction, type PlayerContext, type PlayerEvent, type PlayerState } from './player'
import { clipSeconds, estimateSeconds, MIN_CLIP_SECONDS } from './courseTime'

/** A small made-up course: 3 chapters; clip `b2` waits; clip `a2` has marks; chapter `b` has a tour. */
const COURSE: CourseChapter[] = [
  { id: 'a', title: 'First', clips: [{ id: 'a1', text: 'one two three' }, { id: 'a2', text: 'four five six', marks: [0.25, 0.5, 0.75] }] },
  { id: 'b', title: 'Second', clips: [{ id: 'b1', text: 'seven' }, { id: 'b2', text: 'eight nine' }], tryIt: [{ target: 'x', say: 'Click x.', done: 'click' }] },
  { id: 'c', title: 'Third', clips: [{ id: 'c1', text: 'ten' }] },
]
/** Every clip lasts 4 s, except where `sound` says. */
function ctxWith(sound: Record<string, number> = {}): PlayerContext {
  return { course: COURSE, seconds: (clip: CourseClip) => sound[clip.id] ?? 4, waits: (clip) => clip.id === 'b2' }
}
const CTX = ctxWith()
function run(ctx: PlayerContext, s: PlayerState, ...actions: PlayerAction[]): { state: PlayerState; events: PlayerEvent[] } {
  const events: PlayerEvent[] = []
  for (const a of actions) {
    const r = step(ctx, s, a)
    s = r.state
    events.push(...r.events)
  }
  return { state: s, events }
}
const fresh = (ctx = CTX) => startState(ctx, defaultCourseState())
const playing = (ctx = CTX) => run(ctx, fresh(ctx), { type: 'play' }).state
const ticks = (n: number, dt: number): PlayerAction[] => Array.from({ length: n }, () => ({ type: 'tick', dt }))

describe('the course player (YAZ-5120)', () => {
  it('starts paused at the start; ticks count only while it plays; a clip runs its length plus the gap, then the next starts', () => {
    const s = fresh()
    expect(s).toMatchObject({ chapter: 0, clip: 0, t: 0, phase: 'clip', playing: false })
    expect(step(CTX, s, { type: 'tick', dt: 1 }).state).toBe(s)
    const p = playing()
    const before = run(CTX, p, { type: 'tick', dt: 4 + GAP_SECONDS - 0.01 })
    expect(before.state).toMatchObject({ clip: 0, playing: true })
    const after = run(CTX, before.state, { type: 'tick', dt: 0.02 })
    expect(after.state).toMatchObject({ chapter: 0, clip: 1, t: 0, playing: true })
    expect(after.events).toEqual([{ kind: 'enter', chapter: 'a', clip: 'a2' }])
  })

  it('pause stops the clock where it is; play goes on from there; toggle flips', () => {
    const half = run(CTX, playing(), { type: 'tick', dt: 2 }, { type: 'pause' }).state
    expect(half).toMatchObject({ t: 2, playing: false })
    expect(run(CTX, half, ...ticks(10, 1)).state.t).toBe(2)
    const on = run(CTX, half, { type: 'toggle' }, { type: 'tick', dt: 1 }).state
    expect(on).toMatchObject({ t: 3, playing: true })
    expect(step(CTX, on, { type: 'toggle' }).state.playing).toBe(false)
  })

  it('speed: the page clock runs faster; the sound clock is the sound`s own time; mute changes no timing', () => {
    const fast = run(CTX, playing(), { type: 'speed', speed: 1.5 }, { type: 'tick', dt: 2 }).state
    expect(fast.t).toBe(3)
    const muted = run(CTX, playing(), { type: 'mute', muted: true }, { type: 'tick', dt: 2 }).state
    expect(muted).toMatchObject({ t: 2, muted: true })
    // The sound reports its time; it never goes back, and never past the end of the words.
    const sound = run(CTX, playing(), { type: 'clock', t: 1.2 }, { type: 'clock', t: 1.0 }, { type: 'clock', t: 9 }).state
    expect(sound.t).toBe(4)
  })

  it('marks fire once each, in order, at their fractions of the clip; a jump fires each it passes', () => {
    const at = run(CTX, playing(), { type: 'next' }).state
    expect(at.clip).toBe(1)
    const r1 = run(CTX, at, { type: 'tick', dt: 0.99 })
    expect(r1.events).toEqual([])
    const r2 = run(CTX, r1.state, { type: 'tick', dt: 0.02 })
    expect(r2.events).toEqual([{ kind: 'mark', clip: 'a2', index: 0 }])
    const r3 = run(CTX, r2.state, { type: 'tick', dt: 2.5 })
    expect(r3.events).toEqual([
      { kind: 'mark', clip: 'a2', index: 1 },
      { kind: 'mark', clip: 'a2', index: 2 },
    ])
    expect(run(CTX, r3.state, { type: 'tick', dt: 0.1 }).events).toEqual([])
    // With a sound of 8 s, the same fraction is a later second.
    const long = ctxWith({ a2: 8 })
    const s = run(long, run(long, fresh(long), { type: 'play' }, { type: 'next' }).state, { type: 'tick', dt: 1.5 })
    expect(s.events).toEqual([])
    expect(run(long, s.state, { type: 'tick', dt: 0.6 }).events).toEqual([{ kind: 'mark', clip: 'a2', index: 0 }])
  })

  it('a clip that waits holds at the end of its words until the scene releases it; then the gap, then the next', () => {
    const at = run(CTX, playing(), { type: 'chapter', index: 1 }, { type: 'next' }).state
    expect(at).toMatchObject({ chapter: 1, clip: 1 })
    const held = run(CTX, at, ...ticks(40, 0.5)).state
    expect(held).toMatchObject({ clip: 1, t: 4, playing: true, phase: 'clip' })
    expect(waitingForPerson(CTX, held)).toBe(true)
    const released = run(CTX, held, { type: 'release' }).state
    expect(waitingForPerson(CTX, released)).toBe(false)
    const end = run(CTX, released, { type: 'tick', dt: GAP_SECONDS + 0.01 })
    expect(end.state.phase).toBe('chapter-end')
    // Released early (the person did the step while the words still played): it ends as any clip.
    const early = run(CTX, at, { type: 'tick', dt: 1 }, { type: 'release' }, { type: 'tick', dt: 3 + GAP_SECONDS + 0.01 })
    expect(early.state.phase).toBe('chapter-end')
    // Next skips the step.
    expect(run(CTX, held, { type: 'next' }).state.phase).toBe('chapter-end')
  })

  it('a chapter`s end finishes it once, stops on its end screen, and Play or Next goes to the next chapter', () => {
    const at = run(CTX, playing(), { type: 'next' }).state
    const end = run(CTX, at, { type: 'tick', dt: 4 + GAP_SECONDS + 0.01 })
    expect(end.state).toMatchObject({ chapter: 0, phase: 'chapter-end', playing: false, finished: ['a'] })
    expect(end.events).toContainEqual({ kind: 'chapter-end', chapter: 'a' })
    expect(placeOf(CTX, end.state)).toEqual({ chapter: 'b', clip: '' })
    const next = run(CTX, end.state, { type: 'play' })
    expect(next.state).toMatchObject({ chapter: 1, clip: 0, phase: 'clip', playing: true })
    expect(next.events).toEqual([{ kind: 'enter', chapter: 'b', clip: 'b1' }])
    // Done again: still once in the list.
    const again = run(CTX, next.state, { type: 'chapter', index: 0 }, { type: 'next' }, { type: 'next' }).state
    expect(again.finished).toEqual(['a'])
  })

  it('the last chapter`s end is the course`s end; Play starts again from the first chapter', () => {
    const r = run(CTX, playing(), { type: 'chapter', index: 2 }, { type: 'tick', dt: 4 + GAP_SECONDS + 0.01 })
    expect(r.state.phase).toBe('course-end')
    expect(r.events).toEqual([
      { kind: 'enter', chapter: 'c', clip: 'c1' },
      { kind: 'chapter-end', chapter: 'c' },
      { kind: 'course-end' },
    ])
    expect(placeOf(CTX, r.state)).toEqual({ chapter: 'a', clip: '' })
    expect(step(CTX, r.state, { type: 'next' }).state).toBe(r.state)
    expect(run(CTX, r.state, { type: 'play' }).state).toMatchObject({ chapter: 0, clip: 0, playing: true })
  })

  it('Back: the start of the clip after its first seconds, else the clip before (across chapters); Next chapter skips without finishing', () => {
    const late = run(CTX, playing(), { type: 'next' }, { type: 'tick', dt: BACK_RESTART_SECONDS + 0.5 }).state
    expect(run(CTX, late, { type: 'back' }).state).toMatchObject({ clip: 1, t: 0 })
    expect(run(CTX, late, { type: 'back' }, { type: 'back' }).state).toMatchObject({ clip: 0, t: 0 })
    const b1 = run(CTX, playing(), { type: 'next-chapter' }).state
    expect(b1).toMatchObject({ chapter: 1, clip: 0, finished: [] })
    expect(run(CTX, b1, { type: 'back' }).state).toMatchObject({ chapter: 0, clip: 1 })
    expect(run(CTX, b1, { type: 'prev-chapter' }).state).toMatchObject({ chapter: 0, clip: 0 })
    const last = run(CTX, b1, { type: 'next-chapter' }).state
    expect(step(CTX, last, { type: 'next-chapter' }).state).toBe(last)
  })

  it('seek to a chapter: its first clip, the play state kept; a bad index does nothing', () => {
    const s = run(CTX, playing(), { type: 'chapter', index: 2 })
    expect(s.state).toMatchObject({ chapter: 2, clip: 0, t: 0, playing: true })
    expect(s.events).toEqual([{ kind: 'enter', chapter: 'c', clip: 'c1' }])
    expect(step(CTX, s.state, { type: 'chapter', index: 9 }).state).toBe(s.state)
  })

  it('resumes at the saved place after a restart, with Mute, Speed and the finished chapters; an unknown id is the start', () => {
    const saved = { ...defaultCourseState(), chapter: 'b', clip: 'b2', finished: ['a', 'gone'], muted: true, speed: 1.25 as const }
    expect(startState(CTX, saved)).toMatchObject({ chapter: 1, clip: 1, playing: false, muted: true, speed: 1.25, finished: ['a'] })
    expect(startState(CTX, { ...saved, clip: 'gone' })).toMatchObject({ chapter: 1, clip: 0 })
    expect(startState(CTX, { ...saved, chapter: 'gone' })).toMatchObject({ chapter: 0, clip: 0 })
    // Another part asked for one chapter (issue 4's "Learn the formats"): its start, not the place.
    expect(startState(CTX, saved, 'c')).toMatchObject({ chapter: 2, clip: 0 })
    expect(startState(CTX, saved, 'nope')).toMatchObject({ chapter: 1, clip: 1 })
  })

  it('the chapter`s progress grows with time over its clips', () => {
    const s = playing()
    expect(chapterFraction(CTX, s)).toBe(0)
    const half = run(CTX, s, { type: 'tick', dt: 4 + GAP_SECONDS + 0.01 }).state
    expect(chapterFraction(CTX, half)).toBeCloseTo(0.5, 2)
  })
})

describe('the clip`s length (YAZ-5120)', () => {
  it('is the sound`s seconds when there is a sound; else the reading time at 145 words a minute, at least 1.5 s', () => {
    const clip = { id: 'x', text: Array.from({ length: 29 }, () => 'word').join(' ') }
    expect(estimateSeconds(clip.text)).toBeCloseTo(12, 5)
    expect(clipSeconds(clip, null)).toBeCloseTo(12, 5)
    expect(clipSeconds(clip, 9.5)).toBe(9.5)
    expect(clipSeconds(clip, 0)).toBeCloseTo(12, 5)
    expect(clipSeconds(clip, Number.NaN)).toBeCloseTo(12, 5)
    expect(estimateSeconds('Hi.')).toBe(MIN_CLIP_SECONDS)
  })
})

describe('seek: the scrubber (YAZ-5120)', () => {
  const G = GAP_SECONDS
  it('the chapter\'s clip starts and length, and the time now', () => {
    expect(chapterTimes(CTX, 0)).toEqual({ starts: [0, 4 + G], lengths: [4 + G, 4 + G], total: 8 + 2 * G })
    const s = run(CTX, playing(), { type: 'tick', dt: 4 + G + 0.01 }, { type: 'tick', dt: 1 }).state
    expect(chapterTime(CTX, s)).toBeCloseTo(4 + G + 1)
    expect(chapterTime(CTX, run(CTX, s, { type: 'next' }).state)).toBe(8 + 2 * G)
  })

  it('into the middle of the clip it is in: the time moves (back too), no enter, and the marks before it count', () => {
    const p = run(CTX, playing(), { type: 'next' }, { type: 'tick', dt: 3.5 }).state
    expect(p.marks).toBe(3)
    const r = step(CTX, p, { type: 'seek', t: 4 + G + 1.5 })
    expect(r.events).toEqual([])
    expect(r.state).toMatchObject({ clip: 1, t: 1.5, marks: 1, playing: true })
  })

  it('across clips: the clip under the time starts there, with its enter event; playing or paused stays as it was', () => {
    const r = step(CTX, fresh(), { type: 'seek', t: 4 + G + 2.5 })
    expect(r.events).toEqual([{ kind: 'enter', chapter: 'a', clip: 'a2' }])
    expect(r.state).toMatchObject({ clip: 1, t: 2.5, marks: 2, playing: false })
    const back = step(CTX, r.state, { type: 'seek', t: 1 })
    expect(back.events).toEqual([{ kind: 'enter', chapter: 'a', clip: 'a1' }])
    expect(back.state).toMatchObject({ clip: 0, t: 1 })
  })

  it('to the very start and the very end: the end finishes the chapter (its mark in the list), as its last clip does', () => {
    const mid = run(CTX, playing(), { type: 'next' }, { type: 'tick', dt: 1 }).state
    expect(step(CTX, mid, { type: 'seek', t: -3 }).state).toMatchObject({ clip: 0, t: 0 })
    const end = step(CTX, mid, { type: 'seek', t: 99 })
    expect(end.state).toMatchObject({ phase: 'chapter-end', playing: false, finished: ['a'] })
    expect(end.events).toEqual([{ kind: 'chapter-end', chapter: 'a' }])
    // From the end screen, back into the chapter.
    expect(step(CTX, end.state, { type: 'seek', t: 2 }).state).toMatchObject({ phase: 'clip', clip: 0, t: 2 })
    expect(step(CTX, end.state, { type: 'seek', t: 99 }).state).toBe(end.state)
  })

  it('a clip that waits: past it is allowed; back into it holds at its words\' end until its scene says done again', () => {
    const inB = run(CTX, playing(), { type: 'chapter', index: 1 }).state
    const past = step(CTX, inB, { type: 'seek', t: 4 + G + 4 + G - 0.1 })
    expect(past.state).toMatchObject({ clip: 1, t: 4, released: false })
    expect(waitingForPerson(CTX, past.state)).toBe(true)
    // Done once, then away and back: it holds, and the scene's done (release) lets it go on.
    const done = run(CTX, past.state, { type: 'release' }, { type: 'tick', dt: 1 }).state
    expect(done.phase).toBe('chapter-end')
    const again = step(CTX, done, { type: 'seek', t: 4 + G + 2 })
    expect(again.state).toMatchObject({ clip: 1, t: 2, released: false })
    const later = run(CTX, again.state, { type: 'play' }, { type: 'release' }, ...ticks(5, 1)).state
    expect(later.phase).toBe('chapter-end')
  })

  it('with sound: the sound\'s seconds place the clips', () => {
    const ctx = ctxWith({ a1: 9, a2: 1 })
    expect(chapterTimes(ctx, 0).starts).toEqual([0, 9 + G])
    expect(step(ctx, fresh(ctx), { type: 'seek', t: 8 }).state).toMatchObject({ clip: 0, t: 8 })
    expect(step(ctx, fresh(ctx), { type: 'seek', t: 9 + G + 0.5 }).state).toMatchObject({ clip: 1, t: 0.5 })
  })
})

