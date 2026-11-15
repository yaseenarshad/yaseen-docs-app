import { describe, expect, it } from 'vitest'
import { COURSE, type CourseChapter } from './script'
import { holdsLive, liveReached, partAt, tourStepsOf } from './live'
import { TARGET_HELP } from './tourHelp'

const HANDS_ON = ['first-card', 'inbox', 'where', 'links', 'care', 'where-things-are']
const chapter = (id: string): CourseChapter => COURSE.find((ch) => ch.id === id)!

describe('the parts of the course and their sizes (YAZ-5366)', () => {
  const ch: CourseChapter = {
    id: 'x',
    title: 'X',
    clips: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B', dock: 'side' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D', dock: 'side' }, { id: 'e', text: 'E', dock: 'corner' }, { id: 'f', text: 'F', dock: 'full' }],
  }

  it('a chapter starts in full; a clip keeps the size before it; a run of one size is one part', () => {
    expect(partAt(ch, 0)).toEqual({ id: 'x:start', size: 'full', named: false })
    expect(partAt(ch, 1)).toEqual({ id: 'b', size: 'side', named: true })
    expect(partAt(ch, 2)).toEqual({ id: 'b', size: 'side', named: true })
    // The same size named again is the same part: the person's choice still holds.
    expect(partAt(ch, 3)).toEqual({ id: 'b', size: 'side', named: true })
    expect(partAt(ch, 4)).toEqual({ id: 'e', size: 'corner', named: true })
    expect(partAt(ch, 5)).toEqual({ id: 'f', size: 'full', named: true })
  })

  it('each clip of the six hands-on chapters names its size; the other chapters name none (lessons, full)', () => {
    for (const ch of COURSE) {
      for (const clip of ch.clips) {
        if (HANDS_ON.includes(ch.id)) expect(clip.dock, clip.id).toBeDefined()
        else expect(clip.dock, clip.id).toBeUndefined()
      }
    }
  })

  it('a clip with a do step is in the corner, or asks for it at the step; a show clip is beside the app', () => {
    for (const id of HANDS_ON) {
      for (const clip of chapter(id).clips) {
        const steps = clip.live ?? []
        if (steps.length === 0) continue
        if (holdsLive(clip)) expect(['corner', 'full'], clip.id).toContain(clip.dock)
        else expect(clip.dock, clip.id).toBe('side')
      }
    }
  })
})

describe('the live steps of the script (YAZ-5366)', () => {
  it('the six hands-on chapters have live steps and no "Try it in the app" any more', () => {
    for (const id of HANDS_ON) {
      expect(chapter(id).tryIt, id).toBeUndefined()
      expect(chapter(id).clips.some((c) => holdsLive(c)), id).toBe(true)
    }
  })

  it("each step's mark is one of its clip's marks, in order; each target has its help", () => {
    for (const clip of COURSE.flatMap((ch) => ch.clips)) {
      let last = -1
      for (const step of clip.live ?? []) {
        if (step.mark !== undefined) {
          expect(step.mark, clip.id).toBeLessThan(clip.marks?.length ?? 0)
          expect(step.mark, clip.id).toBeGreaterThanOrEqual(last)
          last = step.mark
        }
        expect(TARGET_HELP[step.target], step.target).toBeDefined()
      }
    }
  })

  it('a do step has its coach line; a step that asks for typing offers its example', () => {
    const steps = COURSE.flatMap((ch) => ch.clips.flatMap((c) => c.live ?? []))
    for (const step of steps.filter((s) => s.done !== undefined)) expect(step.say ?? '').not.toBe('')
    expect(steps.filter((s) => s.example !== undefined).map((s) => s.target)).toEqual(['new-card-name', 'card-editor', 'card-editor', 'card-editor'])
  })

  it('as tour steps: a show step is done "show"', () => {
    const clip = chapter('where-things-are').clips.find((c) => c.id === 'c12-07')!
    expect(tourStepsOf(clip).map((s) => s.done)).toEqual(['click', 'show', 'show'])
  })
})

describe('the moment of each step (YAZ-5366)', () => {
  const steps = [{ target: 'a', mark: 0 }, { target: 'b', mark: 2 }, { target: 'c' }]

  it('a step comes on its mark, in order; a step with no mark at the end of the words', () => {
    expect(liveReached(steps, 0, false)).toBe(0)
    expect(liveReached(steps, 1, false)).toBe(1)
    expect(liveReached(steps, 2, false)).toBe(1)
    expect(liveReached(steps, 3, false)).toBe(2)
    expect(liveReached(steps, 3, true)).toBe(3)
    // The end of the words brings every step.
    expect(liveReached(steps, 0, true)).toBe(3)
  })
})
