/**
 * LIVE STEPS AS PURE LOGIC (YAZ-5366, phase 2 of YAZ-5357): the course's own clips drive the real app.
 *
 * - THE SIZE OF EACH PART. Each clip has a size (`CourseClip.dock`): full for the lessons, side for "show and do",
 *   corner while the person does a step. A clip without one keeps the size of the clip before it; a chapter starts in
 *   full. A PART is a run of clips with the same size (`partAt`): the course asks for the part's size when the part
 *   starts, and the person's own choice (the size switch) wins until the next part (`dockStep` in `dock.ts`).
 * - THE MOMENT OF EACH STEP. A clip's live steps (`CourseClip.live`) light up in order. Step i's moment is the clip's
 *   mark at its `mark` index, or the end of the clip's words (`liveReached`).
 * - THE HOLD. A clip with a do step (a step with `done`) holds at the end of its words until the steps are done
 *   (`holdsLive`), as a WAITS clip does. Next and Skip always go on.
 */
import type { CourseChapter, CourseClip } from './script'
import type { LiveStep, TourStep } from './tour'
import type { DockSize } from './dock'

export const liveOf = (clip: CourseClip): readonly LiveStep[] => clip.live ?? []
export const hasLive = (clip: CourseClip): boolean => liveOf(clip).length > 0
/** A do step: one that waits for the person's real action. */
export const isDo = (step: LiveStep): boolean => step.done !== undefined
/** Does the clip hold for the person (it has a do step)? */
export const holdsLive = (clip: CourseClip): boolean => liveOf(clip).some(isDo)

/** The live steps as tour steps for the tour layer: a show step is `done: 'show'`; no line is an empty one. */
export const tourStepsOf = (clip: CourseClip): TourStep[] =>
  liveOf(clip).map((st) => ({ target: st.target, say: st.say ?? '', done: st.done ?? 'show', ...(st.example === undefined ? {} : { example: st.example }) }))

/**
 * Pure: how many of the clip's steps have had their moment: the steps in order, while each one's mark has fired
 * (`marksFired` of the clip's marks) or, for a step with no mark, the words have ended.
 */
export function liveReached(steps: readonly LiveStep[], marksFired: number, wordsDone: boolean): number {
  let n = 0
  for (const st of steps) {
    const came = st.mark === undefined ? wordsDone : marksFired > st.mark || wordsDone
    if (!came) break
    n += 1
  }
  return n
}

export interface Part {
  /** The part's id: the id of its first clip, or `<chapter>:start` for a chapter's start with no size named. */
  id: string
  size: DockSize
  /** A clip named the size (else it is a chapter's start, full by default). */
  named: boolean
}

/** Pure: the part the clip at `index` of `chapter` is in. */
export function partAt(chapter: CourseChapter, index: number): Part {
  const sizeOf = (i: number): { size: DockSize; named: boolean } => {
    for (let j = i; j >= 0; j--) {
      const named = chapter.clips[j]?.dock
      if (named !== undefined) return { size: named, named: true }
    }
    return { size: 'full', named: false }
  }
  const here = sizeOf(index)
  let start = index
  while (start > 0) {
    const before = sizeOf(start - 1)
    if (before.size !== here.size || before.named !== here.named) break
    start -= 1
  }
  return { id: here.named ? chapter.clips[start].id : `${chapter.id}:start`, size: here.size, named: here.named }
}
